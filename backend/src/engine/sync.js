const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { getAccessToken, evictClient } = require('../services/auth');
const { resolveTenantAuthContext } = require('../services/tenantAuth');
const { getCollector, LicenceUnavailableError, CollectorUnavailableError } = require('../collectors');
const { computeDrift } = require('./drift');
const { checkGrantedPermissions, buildAreaPermissionMap } = require('../services/permissions');
const { COLLECTORS } = require('../collectors');
const { fireWebhooksForDrift, clearWebhookFiredForArea } = require('./webhooks');
const comparator = require('../referenceTemplates/comparator');
const { persistPermissionState } = require('../services/permissionState');

const logger = require('../utils/logger');
const { nowInTimezone } = require('../utils/time');
const { emitSiemEvent } = require('../services/logAnalytics');

const jobs = new Map();

function getJob(jobId) { return jobs.get(jobId) || null; }

function createSyncJob(tenantDbId, areaKey) {
  const jobId = uuidv4();
  jobs.set(jobId, { id: jobId, tenantDbId, areaKey, status: 'pending', result: null, error: null });
  emitSiemEvent('jobs', 'sync.job.created', { jobId, tenantDbId, areaKey });
  return jobId;
}

async function runSync(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'running';

  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(job.tenantDbId);
  if (!tenant) { job.status = 'failed'; job.error = 'Tenant not found'; return; }

  try {
    const collector = getCollector(job.areaKey);
    const authCtx = resolveTenantAuthContext(tenant.id);
    const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);

    // ── Re-check permissions on every sync ────────────────────────────────────

    // Timezone logic removed — always use UTC timestamps

    try {
      const { granted } = await checkGrantedPermissions(token, authCtx.clientId, authCtx.authorityTenantId);
      const areas = buildAreaPermissionMap(granted, COLLECTORS);
      persistPermissionState(tenant.id, granted, areas, new Date().toISOString());
      job.updatedPermissions = { granted, areas };
    } catch (permErr) {
      logger.warn({ permErr, tenantId: tenant.tenant_id }, 'Permission re-check failed during sync — using cached');
    }

    // Attempt to pull live resources. If the tenant was recently granted new
    // application permissions, the MSAL client may still return a cached token
    // that doesn't include the new app roles. In that case a 403 from Graph
    // should trigger evicting the cached MSAL client and retrying once to
    // obtain a fresh token reflecting new admin consent.
    let liveResources;
    let retriedWithFreshToken = false;
    try {
      liveResources = await collector.pull(token);
    } catch (pullErr) {
      const isPermissionDenied = (pullErr && (pullErr.statusCode === 403 || String(pullErr.message || '').includes('Permission denied on')));
      if (isPermissionDenied && !retriedWithFreshToken) {
        // Evict cached MSAL client and request a fresh token
        try {
          evictClient(authCtx.authorityTenantId, authCtx.clientId);
        } catch (e) { /* ignore eviction errors */ }
        const freshToken = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
        // Re-run permission discovery to persist updated permissions
        try {
          const { granted } = await checkGrantedPermissions(freshToken, authCtx.clientId, authCtx.authorityTenantId);
          const areas = buildAreaPermissionMap(granted, COLLECTORS);
          persistPermissionState(tenant.id, granted, areas, new Date().toISOString());
          job.updatedPermissions = { granted, areas };
        } catch (permErr2) {
          logger.warn({ permErr2, tenantId: tenant.tenant_id }, 'Permission re-check failed after eviction — continuing to retry pull');
        }
        // Retry the pull with the fresh token
        liveResources = await collector.pull(freshToken);
        retriedWithFreshToken = true;
      } else {
        throw pullErr;
      }
    }

    const snapshotId = uuidv4();
    db.prepare('INSERT INTO live_snapshots (id, tenant_id, area_key, resources, pulled_at) VALUES (?,?,?,?,?)')
      .run(snapshotId, tenant.id, job.areaKey, JSON.stringify(liveResources), new Date().toISOString());
    db.prepare("UPDATE tenants SET last_synced_at = ? WHERE id = ?").run(new Date().toISOString(), tenant.id);
    db.prepare("UPDATE resource_areas SET last_pulled_at = ? WHERE tenant_id = ? AND area_key = ?")
      .run(new Date().toISOString(), tenant.id, job.areaKey);

    const baseline = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?')
      .get(tenant.id, job.areaKey);

    let driftResult = null;
    if (baseline) {
      const baselineResources = JSON.parse(baseline.resources);
      const watchedKeys = JSON.parse(baseline.watched_keys || '[]');
      const resourceModes = JSON.parse(baseline.resource_modes || '{}');
      const resourceHashes = JSON.parse(baseline.resource_hashes || '{}');
      const drift = computeDrift(liveResources, baselineResources, watchedKeys, resourceModes, resourceHashes);
      const driftId = uuidv4();
      db.prepare('INSERT INTO drift_results (id,tenant_id,area_key,status,drift_count,summary,live_snapshot_id) VALUES (?,?,?,?,?,?,?)')
        .run(driftId, tenant.id, job.areaKey, drift.status, drift.driftCount, JSON.stringify(drift.summary), snapshotId);
      driftResult = drift;
      logger.info({ tenantId: tenant.tenant_id, areaKey: job.areaKey, status: drift.status, driftCount: drift.driftCount }, 'Drift check complete');
      emitSiemEvent('drift', 'drift.check.completed', {
        jobId,
        tenantDbId: tenant.id,
        tenantId: tenant.tenant_id,
        areaKey: job.areaKey,
        status: drift.status,
        driftCount: drift.driftCount,
      });

      // ── Fire webhooks for genuine drift ───────────────────────────────────
      if (drift.status === 'drifted' && drift.driftCount > 0) {
        const driftRow = { ...drift, drift_count: drift.driftCount, summary: JSON.stringify(drift.summary) };
        fireWebhooksForDrift(tenant.id, job.areaKey, driftRow, driftId).catch(e =>
          logger.warn({ e }, 'Webhook fire failed (non-fatal)')
        );
      } else if (drift.status === 'clean') {
        // Area resolved — allow webhooks to fire again on next detection
        clearWebhookFiredForArea(tenant.id, job.areaKey);
      }

      // ── Auto-restore — triggered after drift when the area has it enabled ──
      const area = db.prepare('SELECT auto_restore FROM resource_areas WHERE tenant_id = ? AND area_key = ?')
        .get(tenant.id, job.areaKey);
      if (area?.auto_restore === 1 && drift.driftCount > 0) {
        const { restoreResource } = require('./restore');
        const driftedItems = drift.summary
          .filter(s => s.status === 'drifted' || s.status === 'missing');
        const autoRestoreResult = { attempted: driftedItems.length, succeeded: 0, failed: 0, resources: [] };

        for (const item of driftedItems) {
          try {
            await restoreResource(tenant.id, job.areaKey, item.resourceId, null, 'auto');
            autoRestoreResult.succeeded++;
            autoRestoreResult.resources.push({ name: item.resourceName, status: 'restored' });
            logger.info({ tenantId: tenant.tenant_id, areaKey: job.areaKey, resourceId: item.resourceId }, 'Auto-restored resource');
          } catch (restoreErr) {
            autoRestoreResult.failed++;
            autoRestoreResult.resources.push({ name: item.resourceName, status: 'failed', error: restoreErr.message });
            logger.warn({ restoreErr, resourceId: item.resourceId }, 'Auto-restore failed for resource');
          }
        }

        driftResult.autoRestoreResult = autoRestoreResult;
        logger.info({ areaKey: job.areaKey, ...autoRestoreResult }, 'Auto-restore complete');

        // Re-pull live data and recompute drift so the DB reflects the post-restore state.
        // This ensures the dashboard shows Clean immediately — not Drifted with 0 count.
        if (autoRestoreResult.succeeded > 0) {
          try {
            const freshResources = await collector.pull(token);
            const freshSnapshotId = uuidv4();
            db.prepare('INSERT INTO live_snapshots (id, tenant_id, area_key, resources, pulled_at) VALUES (?,?,?,?,?)')
              .run(freshSnapshotId, tenant.id, job.areaKey, JSON.stringify(freshResources), new Date().toISOString());

            const freshDrift = computeDrift(freshResources, baselineResources, watchedKeys, resourceModes, resourceHashes);
            const freshDriftId = uuidv4();
            db.prepare('INSERT INTO drift_results (id,tenant_id,area_key,status,drift_count,summary,live_snapshot_id) VALUES (?,?,?,?,?,?,?)')
              .run(freshDriftId, tenant.id, job.areaKey, freshDrift.status, freshDrift.driftCount, JSON.stringify(freshDrift.summary), freshSnapshotId);

            // Update job result to reflect post-restore state
            job.result.liveResources = freshResources;
            driftResult = { ...freshDrift, autoRestoreResult };
            logger.info({ areaKey: job.areaKey, status: freshDrift.status }, 'Post-restore drift check complete');
            emitSiemEvent('drift', 'drift.post_restore.completed', {
              jobId,
              tenantDbId: tenant.id,
              tenantId: tenant.tenant_id,
              areaKey: job.areaKey,
              status: freshDrift.status,
              driftCount: freshDrift.driftCount,
              autoRestoreAttempted: autoRestoreResult.attempted,
              autoRestoreSucceeded: autoRestoreResult.succeeded,
              autoRestoreFailed: autoRestoreResult.failed,
            });
          } catch (rePullErr) {
            logger.warn({ rePullErr }, 'Post-restore re-pull failed — UI will show stale drift until next sync');
            emitSiemEvent('jobs', 'sync.post_restore_repull.failed', {
              jobId,
              tenantDbId: tenant.id,
              tenantId: tenant.tenant_id,
              areaKey: job.areaKey,
              error: rePullErr.message,
            });
          }
        }
      }
    }

    job.status = 'complete';
    job.result = { snapshotId, liveResources, driftResult };
    // Clear any previous sync error on success
      db.prepare("UPDATE tenants SET last_sync_error = NULL, last_sync_error_at = NULL WHERE id = ?")
        .run(tenant.id);
    emitSiemEvent('jobs', 'sync.job.completed', {
      jobId,
      tenantDbId: tenant.id,
      tenantId: tenant.tenant_id,
      areaKey: job.areaKey,
      status: 'complete',
    });

  } catch (err) {
    if (
      err instanceof LicenceUnavailableError ||
      err instanceof CollectorUnavailableError ||
      err.code === 'LICENCE_UNAVAILABLE' ||
      err.code === 'COLLECTOR_UNAVAILABLE'
    ) {
      db.prepare("UPDATE resource_areas SET last_pulled_at = ? WHERE tenant_id = ? AND area_key = ?")
        .run(new Date().toISOString(), tenant.id, job.areaKey);
      const unavailableDriftId = uuidv4();
      db.prepare('INSERT INTO drift_results (id,tenant_id,area_key,status,drift_count,summary,live_snapshot_id) VALUES (?,?,?,?,?,?,?)')
        .run(
          unavailableDriftId,
          tenant.id,
          job.areaKey,
          'unavailable',
          0,
          JSON.stringify([{ status: 'unavailable', message: err.message }]),
          null
        );
      job.status = 'unavailable';
      job.error = err.message;
      logger.info({ areaKey: job.areaKey, tenantId: tenant.tenant_id, reason: err.code || 'unknown' }, 'Area unavailable for current tenant context');
      emitSiemEvent('jobs', 'sync.job.unavailable', {
        jobId,
        tenantDbId: tenant.id,
        tenantId: tenant.tenant_id,
        areaKey: job.areaKey,
        error: err.message,
      });
    } else {
      // Classify the error type for the UI banner.
      // Only persist errors that indicate the ENTIRE tenant connection is broken
      // (auth failure). Per-area permission errors (403) are expected for areas the
      // App Registration isn't scoped for — those show as "Locked" on the area card,
      // not as a tenant-wide banner. Network errors are transient and self-resolve.
      let errorType = 'unknown';
      const msg     = err.message || '';
      const status  = err.statusCode || err.status || 0;

      if (status === 401 || msg.includes('401') || msg.toLowerCase().includes('authentication failed') || msg.toLowerCase().includes('invalid_client') || msg.toLowerCase().includes('client secret')) {
        errorType = 'auth'; // Expired/revoked secret or client_id mismatch — tenant-wide
      } else if (msg.includes('timed out') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
        errorType = 'network'; // Transient — don't persist as a banner
      } else if (status === 403 || msg.includes('403')) {
        // 403 on an individual area = missing scope for that area, not a tenant auth problem.
        // Show as Locked on the area card — do NOT set a tenant-wide banner.
        errorType = 'permission_area'; // internal — will NOT be persisted
      }

      // Only persist auth errors as tenant-wide banners — everything else is per-area
      if (errorType === 'auth') {
        try {
          db.prepare("UPDATE tenants SET last_sync_error = ?, last_sync_error_at = ? WHERE id = ?")
            .run(JSON.stringify({ type: 'auth', message: msg }), new Date().toISOString(), tenant.id);
        } catch {}
      }

      job.status = 'failed';
      job.error = err.message;
      logger.error({ err, areaKey: job.areaKey, errorType }, 'Sync job failed');
      emitSiemEvent('jobs', 'sync.job.failed', {
        jobId,
        tenantDbId: tenant.id,
        tenantId: tenant.tenant_id,
        areaKey: job.areaKey,
        errorType,
        error: err.message,
      });
    }
  }
}

/**
 * runAllDriftChecks — called by the global cron in index.js.
 *
 * Respects per-tenant drift interval settings:
 *   - drift_check_auto = 0  → skip this tenant entirely (auto-check disabled)
 *   - drift_interval_minutes > 0 → only run if last_synced_at is older than the interval
 *   - falls back to the global DRIFT_CHECK_INTERVAL_MINUTES if per-tenant is not set
 */
async function runAllDriftChecks() {
  const db = getDb();
  // Respect per-area rate limits for expensive Graph endpoints (Teams, SharePoint)
  // Some Graph resources (notably Teams and SharePoint) impose polling guidance
  // of no more than once per day. To avoid violating the Microsoft Graph
  // polling guidance, scheduled automated checks will skip these areas if
  // they were pulled within the last 24 hours.
  const MIN_POLL_MS = 24 * 60 * 60 * 1000; // 24 hours in ms

  function isRateLimitedArea(areaKey) {
    return !!areaKey && (areaKey.startsWith('teams_') || areaKey === 'sharepoint_sites');
  }

  // Get all tenants that have at least one baselined area
  const tenants = db.prepare(`
    SELECT DISTINCT t.*
    FROM tenants t
    INNER JOIN resource_areas ra ON ra.tenant_id = t.id
    INNER JOIN baselines b ON b.tenant_id = t.id AND b.area_key = ra.area_key
  `).all();

  for (const tenant of tenants) {
    // Only use per-tenant settings for drift check automation
    const enabled = tenant.drift_check_auto === 1;
    const interval = tenant.drift_interval_minutes || 0;
    if (!enabled || interval <= 0) continue;

    // Check if enough time has passed since last sync
    if (tenant.last_synced_at) {
      const lastSync = new Date(tenant.last_synced_at);
      const minutesSince = (Date.now() - lastSync.getTime()) / 60000;
      if (minutesSince < interval) {
        logger.debug({ tenantId: tenant.tenant_id, minutesSince, interval }, 'Skipping — synced recently');
        continue;
      }
    }

    const areas = db.prepare('SELECT * FROM resource_areas WHERE tenant_id = ? AND has_baseline = 1').all(tenant.id);
    for (const area of areas) {
      // If this area is rate-limited (Teams/SharePoint), skip automated pulls
      // when it was already pulled within the last 24 hours. Manual pulls
      // initiated via the API are still allowed.
      if (isRateLimitedArea(area.area_key)) {
        const lastPulled = area.last_pulled_at ? Date.parse(area.last_pulled_at) : null;
        if (lastPulled && (Date.now() - lastPulled) < MIN_POLL_MS) {
          logger.info({ tenantId: tenant.tenant_id, areaKey: area.area_key, lastPulledAt: area.last_pulled_at },
            'Skipping scheduled pull — Teams/SharePoint polling limited to once per 24 hours to comply with Microsoft Graph API polling guidance.'
          );
          continue;
        }
      }

      const jobId = createSyncJob(area.tenant_id, area.area_key);
      await runSync(jobId);
    }
  }
}

module.exports = { createSyncJob, runSync, getJob, runAllDriftChecks };

// -------------------- Compare-job (async bulk compare) --------------------

function createCompareJob(template, tenantDbIds) {
  const jobId = uuidv4();
  jobs.set(jobId, {
    id: jobId,
    type: 'compare',
    templateId: (template && template.id) || null,
    template: template || null,
    tenantDbIds: Array.isArray(tenantDbIds) ? tenantDbIds.slice() : [],
    status: 'pending',
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    results: []
  });
  emitSiemEvent('jobs', 'compare.job.created', {
    jobId,
    templateId: (template && template.id) || null,
    tenantCount: Array.isArray(tenantDbIds) ? tenantDbIds.length : 0,
  });
  return jobId;
}

async function runCompareJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  const db = getDb();

  for (const tid of (job.tenantDbIds || [])) {
    const out = { tenantId: tid };
    try {
      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid);
      if (!tenant) { out.error = 'Tenant not found'; job.results.push(out); continue; }

      // Acquire token for this tenant
      let token = null;
      try {
        const authCtx = resolveTenantAuthContext(tenant.id);
        token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
      } catch (err) {
        out.error = 'Failed to acquire token'; out.message = err && err.message; job.results.push(out); continue;
      }

      const areaKey = (job.template && (job.template.area_key || job.template.areaKey)) || 'unknown';
      let liveResources = {};
      try {
        const collector = getCollector(areaKey);
        if (!collector) { out.error = 'Collector not available for area'; job.results.push(out); continue; }
        liveResources = await collector.pull(token);
      } catch (err) {
        out.error = 'Collector pull failed'; out.message = err && err.message; job.results.push(out); continue;
      }

      try {
        const items = await comparator.compareTemplateResources(job.template, liveResources) || [];
        const total = items.length;
        const matched = items.filter(i => i.status === 'matched').length;
        const partial = items.filter(i => i.status === 'partial').length;
        const noMatch = Math.max(0, total - matched - partial);
        out.summary = { total, matched, partial, noMatch };
        out.items = items;
      } catch (err) {
        out.error = 'Comparator failed'; out.message = err && err.message;
      }
    } catch (err) {
      out.error = 'Unexpected error'; out.message = err && err.message;
    }
    job.results.push(out);
  }

  job.status = 'complete';
  job.completedAt = new Date().toISOString();
  job.result = { results: job.results };
  emitSiemEvent('jobs', 'compare.job.completed', {
    jobId,
    templateId: job.templateId,
    tenantCount: Array.isArray(job.tenantDbIds) ? job.tenantDbIds.length : 0,
    resultCount: Array.isArray(job.results) ? job.results.length : 0,
  });
}

module.exports.createCompareJob = createCompareJob;
module.exports.runCompareJob = runCompareJob;


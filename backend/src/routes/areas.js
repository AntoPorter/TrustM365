const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { getCollector, getAllCollectors } = require('../collectors');
const { createSyncJob, runSync, getJob } = require('../engine/sync');
const { restoreResource } = require('../engine/restore');
const { computeDrift, stableHash } = require('../engine/drift');
const { getAccessToken } = require('../services/auth');
const { resolveTenantAuthContext } = require('../services/tenantAuth');
const logger = require('../utils/logger');
const router = express.Router();

function isCustomArea(areaKey) {
  try {
    const collector = getCollector(areaKey);
    return !!collector?.isCustom;
  } catch {
    return false;
  }
}

function validateAreaReadAccess(tenantPermRow, areaKey, noPermsMessage) {
  if (!tenantPermRow?.permissions_json) {
    if (isCustomArea(areaKey)) return null;
    return { error: 'permission_missing', message: noPermsMessage };
  }

  try {
    const { areas } = JSON.parse(tenantPermRow.permissions_json);
    const areaPerm = (areas || []).find(a => a.areaKey === areaKey);
    if (!areaPerm && isCustomArea(areaKey)) return null;
    if (!areaPerm || !areaPerm.canRead) {
      return {
        error: 'permission_missing',
        message: `Access denied. Add these permissions: ${(areaPerm?.missingRead || []).join(', ')}`,
        missingPermissions: areaPerm?.missingRead || [],
      };
    }
  } catch {
    if (isCustomArea(areaKey)) return null;
    return { error: 'permission_missing', message: 'Permissions are invalid. Run Refresh Permissions first.' };
  }

  return null;
}

// GET /api/areas/:tenantId — list all resource areas with latest drift status
router.get('/:tenantId', (req, res) => {
  const db = getDb();
  const areas = db.prepare('SELECT * FROM resource_areas WHERE tenant_id = ? ORDER BY display_name').all(req.params.tenantId);

  const enriched = areas.map(area => {
    const latestDrift = db.prepare('SELECT * FROM drift_results WHERE tenant_id = ? AND area_key = ? ORDER BY checked_at DESC LIMIT 1')
      .get(req.params.tenantId, area.area_key);
    let watchableKeys = [];
    let isCustom = false;
    let monitorOnlyKeys = [];
    try {
      const collector = getCollector(area.area_key);
      isCustom         = !!collector.isCustom;
      monitorOnlyKeys  = collector.monitorOnlyKeys  || [];

      // Prefer per-area overview grouping if available (e.g., 'exchange', 'teams')
      try {
        const areaGroup = (area.area_key || '').split('_')[0];
        // Support both grouped subfolder overview and flat per-area overview file naming
        let overview = null;
        try {
          // Prefer flat file: collectors/<areaGroup>_overview.js
          overview = require(`../collectors/${areaGroup}_overview`);
        } catch (err) {
          // Fallback to folder-based overview: collectors/<areaGroup>/overview.js
          try { overview = require(`../collectors/${areaGroup}/overview`); } catch (e) { overview = null; }
        }
        // Final fallback: unified collectors/overview.js exports group overviews
        if (!overview) {
          try {
            const grouped = require('../collectors/overview');
            if (grouped && (grouped[`${areaGroup}Overview`] || grouped[areaGroup] || (grouped.groupOverviews && grouped.groupOverviews[areaGroup]))) {
              overview = grouped[`${areaGroup}Overview`] || grouped[areaGroup] || (grouped.groupOverviews && grouped.groupOverviews[areaGroup]);
            }
          } catch (e) { overview = null; }
        }
        if (overview && overview.perCollectorWatchableKeys && overview.perCollectorWatchableKeys[area.area_key]) {
          watchableKeys = overview.perCollectorWatchableKeys[area.area_key];
        } else {
          watchableKeys = collector.watchableKeys || [];
        }
      } catch (e) {
        // No overview available for this group — fallback to collector
        watchableKeys = collector.watchableKeys || [];
      }
    } catch { /* unknown area — skip */ }
    return {
      ...area,
      latestDrift: latestDrift ? {
        status:     latestDrift.status,
        driftCount: latestDrift.drift_count,
        checkedAt:  latestDrift.checked_at,
        summary:    JSON.parse(latestDrift.summary || '[]')
      } : null,
      watchableKeys,
      isCustom,
      monitorOnlyKeys,
    };
  });

  res.json(enriched);
});

// POST /api/areas/:tenantId/:areaKey/pull — pull live config from Graph API
router.post('/:tenantId/:areaKey/pull', async (req, res) => {
  const { tenantId, areaKey } = req.params;
  const db = getDb();

  const tenant = db.prepare('SELECT permissions_json FROM tenants WHERE id = ?').get(tenantId);
  const permissionError = validateAreaReadAccess(
    tenant,
    areaKey,
    'Permissions not checked for this tenant. Run Refresh Permissions first.'
  );
  if (permissionError) {
    return res.status(403).json({
      ...permissionError,
      message: permissionError.message.replace('Access denied. Add these permissions:', 'Sync is locked. Add these permissions to your App Registration:'),
    });
  }

  const jobId = createSyncJob(tenantId, areaKey);
  runSync(jobId).catch(err => logger.error({ err, jobId }, 'Sync job error'));
  res.status(202).json({ jobId, message: 'Pull started. Poll /api/jobs/' + jobId });
});

// GET /api/areas/:tenantId/:areaKey/live — get latest live snapshot
router.get('/:tenantId/:areaKey/live', (req, res) => {
  const db = getDb();
  // Require read permission for this area before returning live data
  const tenantPermRow = db.prepare('SELECT permissions_json FROM tenants WHERE id = ?').get(req.params.tenantId);
  const permissionError = validateAreaReadAccess(
    tenantPermRow,
    req.params.areaKey,
    'Permissions not checked for this tenant. Run Refresh Permissions first.'
  );
  if (permissionError) return res.status(403).json(permissionError);
  const snap = db.prepare('SELECT * FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1')
    .get(req.params.tenantId, req.params.areaKey);
  if (!snap) return res.status(404).json({ error: 'No live snapshot yet. Pull first.' });
  res.json({ ...snap, resources: JSON.parse(snap.resources) });
});

// GET /api/areas/:tenantId/:areaKey/resource/:resourceId — get single resource detail
router.get('/:tenantId/:areaKey/resource/:resourceId', async (req, res) => {
  const { tenantId, areaKey, resourceId } = req.params;
  const db = getDb();

  // Require read permission for this area before returning resource data
  const tenantPermRow = db.prepare('SELECT permissions_json FROM tenants WHERE id = ?').get(tenantId);
  const permissionError = validateAreaReadAccess(
    tenantPermRow,
    areaKey,
    'Permissions not checked for this tenant. Run Refresh Permissions first.'
  );
  if (permissionError) return res.status(403).json(permissionError);

  // Try collector-specific live fetch if available (requires tenant credentials)
  try {
    const collector = getCollector(areaKey);
    if (collector && typeof collector.get === 'function') {
      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      const authCtx = resolveTenantAuthContext(tenant.id);
      const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
      const r = await collector.get(token, resourceId);
      if (!r) return res.status(404).json({ error: 'resource_not_found', message: 'Resource not found via collector' });
      return res.json(r);
    }
  } catch (err) {
    // Fall through to snapshot lookup on error
  }

  // Fallback: return from latest live snapshot if present
  const snap = db.prepare('SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1')
    .get(tenantId, areaKey);
  if (!snap) return res.status(404).json({ error: 'No live snapshot yet. Pull first.' });
  const resources = JSON.parse(snap.resources || '{}');
  const resObj = resources[resourceId];
  if (!resObj) return res.status(404).json({ error: 'Resource not found in latest snapshot' });
  res.json(resObj);
});

// GET /api/areas/:tenantId/:areaKey/baseline — get current baseline
router.get('/:tenantId/:areaKey/baseline', (req, res) => {
  const db = getDb();
  const tenantPermRow = db.prepare('SELECT permissions_json FROM tenants WHERE id = ?').get(req.params.tenantId);
  // Require read permission for baseline access
  const permissionError = validateAreaReadAccess(
    tenantPermRow,
    req.params.areaKey,
    'Permissions not checked for this tenant. Run Refresh Permissions first.'
  );
  if (permissionError) return res.status(403).json(permissionError);
  const baseline = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?')
    .get(req.params.tenantId, req.params.areaKey);
  if (!baseline) return res.status(404).json({ error: 'No baseline set for this area' });
  res.json({
    ...baseline,
    resources:          JSON.parse(baseline.resources),
    watched_keys:       JSON.parse(baseline.watched_keys      || '[]'),
    resource_modes:     JSON.parse(baseline.resource_modes    || '{}'),
    resource_hashes:    JSON.parse(baseline.resource_hashes   || '{}'),
    resource_groups:    JSON.parse(baseline.resource_groups   || '[]'),
    excluded_resources: JSON.parse(baseline.excluded_resources || '[]'),
  });
});

// POST /api/areas/:tenantId/:areaKey/baseline — save or update baseline
router.post('/:tenantId/:areaKey/baseline', (req, res) => {
  const { tenantId, areaKey } = req.params;
  const { resources, watchedKeys = [], label, resourceModes = {}, resourceGroups = [], excludedResources = [] } = req.body;
  if (!resources || typeof resources !== 'object') return res.status(400).json({ error: 'resources object required' });

  // Compute stable hashes for every snapshot-mode resource at save time
  const resourceHashes = {};
  for (const [id, resource] of Object.entries(resources)) {
    if (resourceModes[id] === 'snapshot') {
      resourceHashes[id] = stableHash(resource);
    }
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);

  if (existing) {
    const prev = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
    db.prepare('INSERT INTO baseline_history (id,tenant_id,area_key,resources,label,resource_modes,watched_keys) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), tenantId, areaKey, prev.resources, prev.label,
           prev.resource_modes || '{}', prev.watched_keys || '[]');
    db.prepare(`UPDATE baselines
       SET resources=?,watched_keys=?,label=?,resource_modes=?,resource_hashes=?,resource_groups=?,excluded_resources=?,updated_at=datetime('now')
       WHERE tenant_id=? AND area_key=?`)
      .run(JSON.stringify(resources), JSON.stringify(watchedKeys), label || 'Baseline',
           JSON.stringify(resourceModes), JSON.stringify(resourceHashes),
           JSON.stringify(resourceGroups), JSON.stringify(excludedResources),
           tenantId, areaKey);
  } else {
    db.prepare(`INSERT INTO baselines
        (id,tenant_id,area_key,label,resources,watched_keys,resource_modes,resource_hashes,resource_groups,excluded_resources)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), tenantId, areaKey, label || 'Baseline',
           JSON.stringify(resources), JSON.stringify(watchedKeys),
           JSON.stringify(resourceModes), JSON.stringify(resourceHashes),
           JSON.stringify(resourceGroups), JSON.stringify(excludedResources));
  }

  db.prepare("UPDATE resource_areas SET has_baseline=1, baseline_set_at=datetime('now') WHERE tenant_id=? AND area_key=?")
    .run(tenantId, areaKey);

  logger.info({ tenantId, areaKey }, 'Baseline saved');
  res.json({ message: 'Baseline saved successfully' });
});

// DELETE /api/areas/:tenantId/:areaKey/baseline — delete active baseline (archive first)
router.delete('/:tenantId/:areaKey/baseline', (req, res) => {
  const { tenantId, areaKey } = req.params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
  if (!existing) return res.status(404).json({ error: 'No baseline to delete' });

  // Archive it first
  db.prepare('INSERT INTO baseline_history (id,tenant_id,area_key,resources,label,resource_modes,watched_keys) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), tenantId, areaKey, existing.resources,
         `[Deleted] ${existing.label || 'Baseline'}`,
         existing.resource_modes || '{}', existing.watched_keys || '[]');

  db.prepare('DELETE FROM baselines WHERE tenant_id = ? AND area_key = ?').run(tenantId, areaKey);
  db.prepare("UPDATE resource_areas SET has_baseline=0, baseline_set_at=NULL WHERE tenant_id=? AND area_key=?").run(tenantId, areaKey);

  logger.info({ tenantId, areaKey }, 'Baseline deleted (archived)');
  res.json({ message: 'Baseline deleted and archived' });
});

// POST /api/areas/:tenantId/:areaKey/baseline/restore/:historyId — restore from archive
router.post('/:tenantId/:areaKey/baseline/restore/:historyId', (req, res) => {
  const { tenantId, areaKey, historyId } = req.params;
  const db = getDb();
  const historical = db.prepare('SELECT * FROM baseline_history WHERE id = ? AND tenant_id = ? AND area_key = ?')
    .get(historyId, tenantId, areaKey);
  if (!historical) return res.status(404).json({ error: 'Historical baseline not found' });

  const resources = JSON.parse(historical.resources);
  const resourceModes = JSON.parse(historical.resource_modes || '{}');
  const watchedKeys = JSON.parse(historical.watched_keys || '[]');

  // Archive current if exists
  const existing = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
  if (existing) {
    db.prepare('INSERT INTO baseline_history (id,tenant_id,area_key,resources,label,resource_modes,watched_keys) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), tenantId, areaKey, existing.resources,
           `[Superseded] ${existing.label}`, existing.resource_modes || '{}', existing.watched_keys || '[]');
    db.prepare(`UPDATE baselines SET resources=?,watched_keys=?,label=?,resource_modes=?,resource_hashes='{}',updated_at=datetime('now')
       WHERE tenant_id=? AND area_key=?`)
      .run(JSON.stringify(resources), JSON.stringify(watchedKeys),
           `[Restored] ${historical.label}`, JSON.stringify(resourceModes), tenantId, areaKey);
  } else {
    db.prepare(`INSERT INTO baselines (id,tenant_id,area_key,label,resources,watched_keys,resource_modes) VALUES (?,?,?,?,?,?,?)`)
      .run(uuidv4(), tenantId, areaKey, `[Restored] ${historical.label}`,
           JSON.stringify(resources), JSON.stringify(watchedKeys), JSON.stringify(resourceModes));
    db.prepare("UPDATE resource_areas SET has_baseline=1, baseline_set_at=datetime('now') WHERE tenant_id=? AND area_key=?")
      .run(tenantId, areaKey);
  }

  res.json({ message: 'Baseline restored from archive' });
});

// GET /api/areas/:tenantId/:areaKey/drift — latest drift result with full detail
router.get('/:tenantId/:areaKey/drift', (req, res) => {
  const db = getDb();
  const tenantPermRow = db.prepare('SELECT permissions_json FROM tenants WHERE id = ?').get(req.params.tenantId);
  const permissionError = validateAreaReadAccess(
    tenantPermRow,
    req.params.areaKey,
    'Permissions not checked for this tenant. Run Refresh Permissions first.'
  );
  if (permissionError) return res.status(403).json(permissionError);

  const drift = db.prepare('SELECT * FROM drift_results WHERE tenant_id = ? AND area_key = ? ORDER BY checked_at DESC LIMIT 1')
    .get(req.params.tenantId, req.params.areaKey);
  if (!drift) return res.status(404).json({ error: 'No drift check run yet' });

  const baseline = db.prepare('SELECT watched_keys FROM baselines WHERE tenant_id = ? AND area_key = ?')
    .get(req.params.tenantId, req.params.areaKey);

  const webhookDeliveries = db.prepare(`
    SELECT webhook_id, webhook_label, fire_mode, outcome, reason, error_message, http_status, attempted_at
    FROM webhook_delivery_events
    WHERE drift_result_id = ?
    ORDER BY attempted_at DESC
  `).all(drift.id);

  const webhookDeliverySummary = webhookDeliveries.reduce((acc, item) => {
    acc.attempted += 1;
    if (item.outcome === 'sent') acc.sent += 1;
    else if (item.outcome === 'failed') acc.failed += 1;
    else if (item.outcome === 'not_sent') acc.notSent += 1;
    if (!acc.lastAttemptAt) acc.lastAttemptAt = item.attempted_at;
    return acc;
  }, { attempted: 0, sent: 0, failed: 0, notSent: 0, lastAttemptAt: null });

  res.json({
    ...drift,
    summary: JSON.parse(drift.summary || '[]'),
    watchedKeys: JSON.parse(baseline?.watched_keys || '[]'),
    webhookDeliverySummary,
    webhookDeliveries: webhookDeliveries.map(item => ({
      webhookId: item.webhook_id,
      webhookLabel: item.webhook_label || '',
      fireMode: item.fire_mode || '',
      outcome: item.outcome,
      reason: item.reason || '',
      errorMessage: item.error_message,
      httpStatus: item.http_status,
      attemptedAt: item.attempted_at,
    }))
  });
});

// POST /api/areas/:tenantId/:areaKey/drift — trigger a fresh drift check
router.post('/:tenantId/:areaKey/drift', async (req, res) => {
  const { tenantId, areaKey } = req.params;
  const db = getDb();
  const baseline = db.prepare('SELECT id FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
  if (!baseline) return res.status(400).json({ error: 'Set a baseline before running drift checks' });

  const jobId = createSyncJob(tenantId, areaKey);
  runSync(jobId).catch(err => logger.error({ err, jobId }, 'Drift job error'));
  res.status(202).json({ jobId });
});

// POST /api/areas/:tenantId/:areaKey/restore — restore a resource (or property) to baseline
// Query param ?dryRun=true returns the PATCH body without executing it.
router.post('/:tenantId/:areaKey/restore', async (req, res) => {
  const { tenantId, areaKey } = req.params;
  const { resourceId, propertyPath = null, restoreType = null } = req.body;
  const dryRun = req.query.dryRun === 'true';
  if (!resourceId) return res.status(400).json({ error: 'resourceId required' });

  // Permission guards: dry-run requires read; actual restore requires write
  const db = getDb();
  const tenantPermRow = db.prepare('SELECT permissions_json FROM tenants WHERE id = ?').get(tenantId);
  if (!tenantPermRow?.permissions_json) {
    return res.status(403).json({ error: 'permission_missing', message: 'Permissions not checked for this tenant. Run Refresh Permissions first.' });
  }
  try {
    const { areas } = JSON.parse(tenantPermRow.permissions_json);
    const areaPerm = (areas || []).find(a => a.areaKey === areaKey);
    if (!areaPerm) {
      return res.status(403).json({ error: 'permission_missing', message: 'Area permissions not available. Run Refresh Permissions first.' });
    }
    if (dryRun) {
      if (!areaPerm.canRead) {
        return res.status(403).json({ error: 'permission_missing', message: `Read access required for dry-run. Missing: ${(areaPerm?.missingRead || []).join(', ')}`, missingPermissions: areaPerm?.missingRead || [] });
      }
    } else {
      if (areaPerm.restoreSupported === false) {
        return res.status(403).json({ error: 'restore_not_supported', message: areaPerm.restoreReason || 'Restore is not supported for this area.' });
      }
      if (!(areaPerm.canRestore ?? areaPerm.canWrite)) {
        return res.status(403).json({ error: 'permission_missing', message: `Write access required to perform restore. Missing: ${(areaPerm?.missingWrite || []).join(', ')}`, missingPermissions: areaPerm?.missingWrite || [] });
      }
    }
  } catch (e) {
    return res.status(403).json({ error: 'permission_missing', message: 'Permissions are invalid. Run Refresh Permissions first.' });
  }

  const effectiveType = restoreType || (propertyPath ? 'manual_property' : 'manual_full');

  if (dryRun) {
    // ── Dry-run: compute and return the PATCH body without executing ──────
    try {
      const db = getDb();
      const tenant   = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
      const baseline = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
      if (!tenant || !baseline) return res.status(404).json({ error: 'Tenant or baseline not found' });

      const resources     = JSON.parse(baseline.resources || '{}');
      const baselineRes   = resources[resourceId];
      if (!baselineRes) return res.status(404).json({ error: 'Resource not found in baseline' });

      const liveSnap = db.prepare(
        'SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1'
      ).get(tenantId, areaKey);
      const liveResources = liveSnap ? JSON.parse(liveSnap.resources) : {};
      const liveRes       = liveResources[resourceId];

      const { buildRestorePayload } = require('../engine/restore');

      let patchPayload;
      try {
        patchPayload = await buildRestorePayload(tenantId, areaKey, resourceId, propertyPath, baselineRes, liveRes);
      } catch {
        patchPayload = propertyPath
          ? { [propertyPath]: baselineRes[propertyPath] }
          : { ...baselineRes };
      }

      // Attempt to produce non-destructive repair guidance when available from the collector
      let repairPlan = null;
      try {
        const collector = getCollector(areaKey);
        if (collector && typeof collector.repairPlan === 'function') {
          const authCtx = resolveTenantAuthContext(tenant.id);
          const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
          repairPlan = await collector.repairPlan(token, resourceId, baselineRes, liveRes || {});
        }
      } catch (err) {
        logger.warn({ err, tenantId, areaKey, resourceId }, 'Collector repair plan generation failed');
      }

      logger.info({ tenantId, areaKey, resourceId, propertyPath, dryRun: true }, 'Restore dry-run computed');
      return res.json({
        dryRun: true,
        tenantId, areaKey, resourceId, propertyPath,
        resourceName: baselineRes.displayName || resourceId,
        patchUrl: `/api/areas/${tenantId}/${areaKey}/restore`,
        patchBody: patchPayload,
        baselineValues: propertyPath ? { [propertyPath]: baselineRes[propertyPath] } : baselineRes,
        liveValues:     propertyPath ? { [propertyPath]: liveRes?.[propertyPath] } : liveRes,
        repairPlan,
      });
    } catch (err) {
      logger.warn({ err, tenantId, areaKey, resourceId }, 'Restore dry-run failed');
      return res.status(500).json({ error: 'Dry-run failed', message: err.message });
    }
  }

  try {
    logger.info({ tenantId, areaKey, resourceId, propertyPath, restoreType: effectiveType }, 'Restore initiated');
    const result = await restoreResource(tenantId, areaKey, resourceId, propertyPath, effectiveType);
    logger.info({ tenantId, areaKey, resourceId, propertyPath, result }, 'Restore completed successfully');
    res.json(result);
  } catch (err) {
    logger.error({ err, tenantId, areaKey, resourceId, propertyPath, restoreType: effectiveType }, 'Restore FAILED — Graph PATCH rejected');
    res.status(500).json({ error: 'Restore failed', message: err.message });
  }
});

// PATCH /api/areas/:tenantId/:areaKey/auto-restore — toggle auto-restore
router.patch('/:tenantId/:areaKey/auto-restore', (req, res) => {
  const db = getDb();
  const { enabled } = req.body;
  db.prepare('UPDATE resource_areas SET auto_restore=? WHERE tenant_id=? AND area_key=?')
    .run(enabled ? 1 : 0, req.params.tenantId, req.params.areaKey);
  res.json({ message: `Auto-restore ${enabled ? 'enabled' : 'disabled'}` });
});

// GET /api/areas/:tenantId/:areaKey/restore-log
router.get('/:tenantId/:areaKey/restore-log', (req, res) => {
  const db = getDb();
  // Require read permission for restore log access
  const tenantPermRow = db.prepare('SELECT permissions_json FROM tenants WHERE id = ?').get(req.params.tenantId);
  if (!tenantPermRow?.permissions_json) {
    return res.status(403).json({ error: 'permission_missing', message: 'Permissions not checked for this tenant. Run Refresh Permissions first.' });
  }
  try {
    const { areas } = JSON.parse(tenantPermRow.permissions_json);
    const areaPerm = (areas || []).find(a => a.areaKey === req.params.areaKey);
    if (!areaPerm || !areaPerm.canRead) {
      return res.status(403).json({ error: 'permission_missing', message: `Access denied. Add these permissions: ${(areaPerm?.missingRead || []).join(', ')}`, missingPermissions: areaPerm?.missingRead || [] });
    }
  } catch (e) {
    return res.status(403).json({ error: 'permission_missing', message: 'Permissions are invalid. Run Refresh Permissions first.' });
  }
  const log = db.prepare('SELECT * FROM restore_log WHERE tenant_id=? AND area_key=? ORDER BY restored_at DESC LIMIT 50')
    .all(req.params.tenantId, req.params.areaKey);
  res.json(log);
});

// GET /api/areas/:tenantId/:areaKey/history — baseline version history (with resources for restore)
router.get('/:tenantId/:areaKey/history', (req, res) => {
  const db = getDb();
  const history = db.prepare('SELECT id,label,archived_at,resources,resource_modes,watched_keys FROM baseline_history WHERE tenant_id=? AND area_key=? ORDER BY archived_at DESC LIMIT 20')
    .all(req.params.tenantId, req.params.areaKey);
  res.json(history.map(h => ({
    ...h,
    resources:    JSON.parse(h.resources    || '{}'),
    resourceModes: JSON.parse(h.resource_modes || '{}'),
    watchedKeys:  JSON.parse(h.watched_keys  || '[]'),
  })));
});

module.exports = router;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const { getDb } = require('../database/init');
const { encrypt, decrypt } = require('../utils/encryption');
const { getAccessToken, evictClientsByClientId } = require('../services/auth');
const { getAllCollectors, COLLECTORS } = require('../collectors');
const { fetchTenantOverview, fetchTenantInsights } = require('../collectors/overview');
const { checkGrantedPermissions, buildAreaPermissionMap } = require('../services/permissions');
const { persistPermissionState } = require('../services/permissionState');
const { createSyncJob, runSync } = require('../engine/sync');
const { rotateTenantAuthSecret, resolveTenantAuthContext } = require('../services/tenantAuth');
const logger = require('../utils/logger');
const router = express.Router();

function asyncRoute(handler) {
  return function routeHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const TenantSchema = z.object({
  displayName: z.string().min(1).max(100),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  clientSecret: z.string().min(1)
});

const TenantWithAppSchema = z.object({
  displayName: z.string().min(1).max(100),
  tenantId: z.string().uuid(),
  appRegistrationId: z.string().uuid(),
  authorityTenantId: z.string().uuid().optional(),
});

const CheckPermissionsWithAppSchema = z.object({
  tenantId: z.string().uuid(),
  appRegistrationId: z.string().uuid(),
  authorityTenantId: z.string().uuid().optional(),
});

function parseMetadata(meta) {
  if (!meta) return {};
  try { return JSON.parse(meta); } catch { return {}; }
}

function getDefaultAuthorityFromApp(app) {
  const meta = parseMetadata(app.metadata);
  return meta.defaultAuthorityTenantId || null;
}

// In-memory caches — populated by /overview/refresh and /insights POST
// Declared here so portfolio route can read them without hoisting issues
const overviewCache  = new Map(); // tenantId → overview data
const insightsCache  = new Map(); // tenantId → insights data

// ── List all tenants with meta ────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const tenants = db.prepare(`
    SELECT t.id, t.display_name, t.tenant_id, t.client_id, t.app_registration_id,
           t.last_synced_at, t.created_at, t.drift_check_auto, t.drift_interval_minutes,
           t.permissions_json, t.permissions_checked_at,
           t.last_sync_error, t.last_sync_error_at,
           COALESCE(m.notes, '') as notes,
           COALESCE(m.tags, '[]') as tags
    FROM tenants t
    LEFT JOIN tenant_meta m ON m.tenant_id = t.id
    ORDER BY t.display_name
  `).all();
  res.json(tenants.map(t => ({ ...t, tags: JSON.parse(t.tags) })));
});

// ── Register tenant ───────────────────────────────────────────────────────────
router.post('/', asyncRoute(async (req, res) => {
  const parsed = TenantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const { displayName, tenantId, clientId, clientSecret } = parsed.data;

  try {
    await getAccessToken(tenantId, clientId, clientSecret);
  } catch (err) {
    return res.status(400).json({ error: 'Credential validation failed', message: err.message });
  }

  const db = getDb();
  if (db.prepare('SELECT id FROM tenants WHERE tenant_id = ?').get(tenantId)) {
    return res.status(409).json({ error: 'Tenant already registered' });
  }

  const id = uuidv4();
  const appRegistrationId = uuidv4();
  const encryptedSecret = encrypt(clientSecret);

  db.prepare('INSERT INTO app_registrations (id, display_name, client_id, client_secret_encrypted) VALUES (?,?,?,?)')
    .run(appRegistrationId, `${displayName} App Registration`, clientId, encryptedSecret);

  db.prepare('INSERT INTO tenants (id,display_name,tenant_id,client_id,client_secret_encrypted,app_registration_id) VALUES (?,?,?,?,?,?)')
    .run(id, displayName, tenantId, clientId, encryptedSecret, appRegistrationId);

  db.prepare('INSERT INTO tenant_app_bindings (id, tenant_id, app_registration_id, authority_tenant_id, is_primary) VALUES (?,?,?,?,1)')
    .run(uuidv4(), id, appRegistrationId, tenantId);

  // Initialise meta row
  db.prepare('INSERT INTO tenant_meta (tenant_id) VALUES (?)').run(id);

  // Auto-create resource area entries
  for (const c of getAllCollectors()) {
    db.prepare('INSERT OR IGNORE INTO resource_areas (id,tenant_id,area_key,display_name,description) VALUES (?,?,?,?,?)')
      .run(uuidv4(), id, c.areaKey, c.displayName, c.description);
  }

  // Run permission check immediately and persist — ensures each tenant's
  // permissions_json is scoped to its own App Registration from the moment
  // it is registered. Never null, never shared between tenants.
  try {
    const regToken = await getAccessToken(tenantId, clientId, clientSecret);
    const { granted } = await checkGrantedPermissions(regToken, clientId, tenantId);
    const areas = buildAreaPermissionMap(granted, COLLECTORS);
    persistPermissionState(id, granted, areas);
    logger.info({ tenantId, clientId }, 'Initial permission check stored on registration');
  } catch (permErr) {
    // Non-fatal — permissions will be checked on first sync
    logger.warn({ permErr, tenantId }, 'Initial permission check failed on registration — will retry on first sync');
  }

  // Return the full tenant row including permissions_json so the frontend
  // has the correct per-tenant permission state immediately after registration
  const tenant = db.prepare(`
    SELECT t.id, t.display_name, t.tenant_id, t.client_id, t.app_registration_id,
           t.last_synced_at, t.created_at, t.permissions_json, t.permissions_checked_at,
           COALESCE(m.notes, '') as notes,
           COALESCE(m.tags, '[]') as tags
    FROM tenants t
    LEFT JOIN tenant_meta m ON m.tenant_id = t.id
    WHERE t.id = ?
  `).get(id);
  res.status(201).json({ ...tenant, tags: JSON.parse(tenant.tags || '[]') });
}));

// ── Check permissions using existing app registration ────────────────────────
router.post('/check-permissions-with-app', asyncRoute(async (req, res) => {
  const parsed = CheckPermissionsWithAppSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const { tenantId, appRegistrationId, authorityTenantId } = parsed.data;

  const db = getDb();
  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(appRegistrationId);
  if (!app) return res.status(404).json({ error: 'App registration not found' });

  const authority = authorityTenantId || getDefaultAuthorityFromApp(app) || tenantId;

  try {
    const token = await getAccessToken(authority, app.client_id, decrypt(app.client_secret_encrypted));
    const { granted } = await checkGrantedPermissions(token, app.client_id, authority);
    const areas = buildAreaPermissionMap(granted, COLLECTORS);
    res.json({ granted, areas, authorityTenantId: authority });
  } catch (err) {
    logger.warn({ err, authority, appRegistrationId }, 'Permission check with app registration failed');
    res.status(400).json({ error: 'Credential validation failed', message: err.message });
  }
}));

// ── Register tenant using an existing shared app registration ────────────────
router.post('/with-app', asyncRoute(async (req, res) => {
  const parsed = TenantWithAppSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const { displayName, tenantId, appRegistrationId, authorityTenantId } = parsed.data;
  const db = getDb();

  if (db.prepare('SELECT id FROM tenants WHERE tenant_id = ?').get(tenantId)) {
    return res.status(409).json({ error: 'Tenant already registered' });
  }

  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(appRegistrationId);
  if (!app) return res.status(404).json({ error: 'App registration not found' });

  const authority = authorityTenantId || getDefaultAuthorityFromApp(app) || tenantId;

  let granted = [];
  let areas = [];
  try {
    const token = await getAccessToken(authority, app.client_id, decrypt(app.client_secret_encrypted));
    const permissionState = await checkGrantedPermissions(token, app.client_id, authority);
    granted = permissionState.granted || [];
    areas = buildAreaPermissionMap(granted, COLLECTORS);
  } catch (err) {
    return res.status(400).json({ error: 'Credential validation failed', message: err.message });
  }

  const id = uuidv4();
  db.prepare('INSERT INTO tenants (id,display_name,tenant_id,client_id,client_secret_encrypted,app_registration_id) VALUES (?,?,?,?,?,?)')
    .run(id, displayName, tenantId, app.client_id, app.client_secret_encrypted, app.id);

  db.prepare('INSERT INTO tenant_app_bindings (id, tenant_id, app_registration_id, authority_tenant_id, is_primary) VALUES (?,?,?,?,1)')
    .run(uuidv4(), id, app.id, authority);

  db.prepare('INSERT INTO tenant_meta (tenant_id) VALUES (?)').run(id);

  for (const c of getAllCollectors()) {
    db.prepare('INSERT OR IGNORE INTO resource_areas (id,tenant_id,area_key,display_name,description) VALUES (?,?,?,?,?)')
      .run(uuidv4(), id, c.areaKey, c.displayName, c.description);
  }

  persistPermissionState(id, granted, areas);

  const tenant = db.prepare(`
    SELECT t.id, t.display_name, t.tenant_id, t.client_id, t.app_registration_id,
           t.last_synced_at, t.created_at, t.permissions_json, t.permissions_checked_at,
           COALESCE(m.notes, '') as notes,
           COALESCE(m.tags, '[]') as tags
    FROM tenants t
    LEFT JOIN tenant_meta m ON m.tenant_id = t.id
    WHERE t.id = ?
  `).get(id);

  res.status(201).json({ ...tenant, tags: JSON.parse(tenant.tags || '[]') });
}));

// ── Delete tenant ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  const authCtx = resolveTenantAuthContext(t.id);
  db.prepare('DELETE FROM tenants WHERE id = ?').run(req.params.id);
  evictClientsByClientId(authCtx.clientId);
  res.json({ message: 'Tenant removed' });
});

// ── Update tenant credentials (rotate client secret) ─────────────────────────
router.patch('/:id/credentials', asyncRoute(async (req, res) => {
  const db = getDb();
  const { clientSecret } = req.body;
  if (!clientSecret?.trim()) return res.status(400).json({ error: 'clientSecret is required' });

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  try {
    const authCtx = resolveTenantAuthContext(tenant.id);
    // Validate the new secret authenticates successfully before saving
    const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, clientSecret.trim());
    if (!token) return res.status(400).json({ error: 'New credentials failed to authenticate — check the secret value' });

    // Save the new encrypted secret to linked app registration (and legacy tenant column for compatibility).
    rotateTenantAuthSecret(tenant.id, clientSecret.trim());

    // Shared app registrations may serve multiple tenants; clear by client ID.
    evictClientsByClientId(authCtx.clientId);

    logger.info({ tenantId: tenant.tenant_id }, 'Tenant credentials rotated successfully');
    res.json({ message: 'Credentials updated and validated successfully' });
  } catch (err) {
    logger.warn({ err, tenantId: tenant.tenant_id }, 'Credential rotation failed — new secret rejected');
    res.status(400).json({ error: `Credential validation failed: ${err.message}` });
  }
}));

// ── Update tenant settings ────────────────────────────────────────────────────
router.patch('/:id/settings', (req, res) => {
  const db = getDb();
  const { driftCheckAuto, driftIntervalMinutes } = req.body;
  db.prepare('UPDATE tenants SET drift_check_auto=?,drift_interval_minutes=? WHERE id=?')
    .run(driftCheckAuto ? 1 : 0, driftIntervalMinutes || 60, req.params.id);
  res.json({ message: 'Settings updated' });
});

// ── Update tenant notes and tags ──────────────────────────────────────────────
router.patch('/:id/meta', (req, res) => {
  const db = getDb();
  const { notes, tags } = req.body;
  if (notes === undefined && tags === undefined) {
    return res.status(400).json({ error: 'Provide notes and/or tags' });
  }
  const existing = db.prepare('SELECT * FROM tenant_meta WHERE tenant_id = ?').get(req.params.id);
  if (existing) {
    db.prepare(`UPDATE tenant_meta SET
      notes = COALESCE(?, notes),
      tags  = COALESCE(?, tags),
      updated_at = datetime('now')
      WHERE tenant_id = ?`)
      .run(notes ?? null, tags ? JSON.stringify(tags) : null, req.params.id);
  } else {
    db.prepare('INSERT INTO tenant_meta (tenant_id, notes, tags) VALUES (?,?,?)')
      .run(req.params.id, notes || '', JSON.stringify(tags || []));
  }
  res.json({ message: 'Tenant meta updated' });
});

// ── MSSP: Portfolio summary — all tenants with latest drift across all areas ──
router.get('/portfolio', (req, res) => {
  const db = getDb();
  const tenants = db.prepare(`
    SELECT t.id, t.display_name, t.tenant_id, t.last_synced_at,
           COALESCE(m.notes, '') as notes,
           COALESCE(m.tags, '[]') as tags
    FROM tenants t
    LEFT JOIN tenant_meta m ON m.tenant_id = t.id
    ORDER BY t.display_name
  `).all();

  const portfolio = tenants.map(tenant => {
    const areas = db.prepare('SELECT * FROM resource_areas WHERE tenant_id = ?').all(tenant.id);
    const areaStatus = areas.map(area => {
      const drift = db.prepare(`
        SELECT status, drift_count, checked_at
        FROM drift_results WHERE tenant_id = ? AND area_key = ?
        ORDER BY checked_at DESC LIMIT 1
      `).get(tenant.id, area.area_key);
      return {
        areaKey: area.area_key,
        displayName: area.display_name,
        hasBaseline: area.has_baseline === 1,
        lastPulledAt: area.last_pulled_at,
        drift: drift || null
      };
    });

    const driftedCount  = areaStatus.filter(a =>
      a.drift?.status === 'drifted' && (a.drift?.drift_count || 0) > 0
    ).length;
    const cleanCount    = areaStatus.filter(a =>
      a.drift?.status === 'clean' ||
      (a.drift?.status === 'drifted' && (a.drift?.drift_count || 0) === 0)
    ).length;
    const noBaseline    = areaStatus.filter(a => !a.hasBaseline).length;
    const baselined     = areaStatus.filter(a => a.hasBaseline).length;
    const totalDrifts   = areaStatus.reduce((sum, a) =>
      sum + ((a.drift?.status === 'drifted' && (a.drift?.drift_count || 0) > 0) ? (a.drift?.drift_count || 0) : 0)
    , 0);

    // overallStatus is based on BASELINED areas only — unmonitored areas are neutral.
    // A tenant is 'clean' when all baselined areas are clean (no active drift).
    // It is 'drifted' when any baselined area has genuine drift.
    // It is 'unconfigured' when nothing has a baseline yet.
    const baselinedClean = areaStatus.filter(a =>
      a.hasBaseline && (
        a.drift?.status === 'clean' ||
        (a.drift?.status === 'drifted' && (a.drift?.drift_count || 0) === 0)
      )
    ).length;
    const overallStatus = driftedCount > 0        ? 'drifted'
      : baselined === 0                           ? 'unconfigured'
      : baselinedClean === baselined              ? 'clean'
      : 'partial';

    // Pull cached overview data (groups, apps, devices) — populated by /overview/refresh
    let overview = overviewCache.get(tenant.id) || null;

    // Pull cached insights data (guestRatio) — populated by /insights POST
    const insightsCached = insightsCache.get(tenant.id) || null;

    return {
      ...tenant,
      tags: JSON.parse(tenant.tags),
      overallStatus,
      driftedAreas: driftedCount,
      cleanAreas: cleanCount,
      totalDrifts,
      noBaselineAreas: noBaseline,
      areaCount: areas.length,
      areas: areaStatus,
      // Cached telemetry for portfolio cards
      overview: overview ? {
        groups:  overview.groups  || null,
        apps:    overview.apps    || null,
        devices: overview.devices || null,
      } : null,
      guestRatio: insightsCached?.guestRatio || null,
    };
  });

  res.json(portfolio);
});

// ── MSSP: Bulk sync — all tenants, all areas, parallel ───────────────────────
router.post('/bulk-sync', asyncRoute(async (req, res) => {
  const db = getDb();
  const tenants = db.prepare('SELECT id FROM tenants').all();
  if (tenants.length === 0) return res.status(400).json({ error: 'No tenants registered' });

  const logId = uuidv4();
  db.prepare('INSERT INTO bulk_sync_log (id, tenant_count) VALUES (?,?)').run(logId, tenants.length);

  // Kick off async — return immediately
  res.status(202).json({ bulkSyncId: logId, tenantCount: tenants.length, message: 'Bulk sync started' });

  // Run all tenant syncs in parallel (capped at 5 concurrent)
  const collectors = getAllCollectors();
  const results = [];
  const CONCURRENCY = 5;

  const chunks = [];
  for (let i = 0; i < tenants.length; i += CONCURRENCY) {
    chunks.push(tenants.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async ({ id: tenantId }) => {
      const tenantResult = { tenantId, areas: [], errors: [] };
      for (const collector of collectors) {
        const jobId = createSyncJob(tenantId, collector.areaKey);
        try {
          await runSync(jobId);
          tenantResult.areas.push({ areaKey: collector.areaKey, status: 'ok' });
        } catch (err) {
          tenantResult.errors.push({ areaKey: collector.areaKey, error: err.message });
          logger.warn({ tenantId, areaKey: collector.areaKey, err }, 'Bulk sync area failed');
        }
      }
      results.push(tenantResult);
    }));
  }

  const successCount = results.filter(r => r.errors.length === 0).length;
  db.prepare(`UPDATE bulk_sync_log SET
    completed_at = datetime('now'),
    success_count = ?,
    error_count = ?,
    results = ?
    WHERE id = ?`)
    .run(successCount, tenants.length - successCount, JSON.stringify(results), logId);

  logger.info({ logId, successCount, total: tenants.length }, 'Bulk sync complete');
}));

// ── MSSP: Get bulk sync status ────────────────────────────────────────────────
router.get('/bulk-sync/:id', (req, res) => {
  const db = getDb();
  const log = db.prepare('SELECT * FROM bulk_sync_log WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Bulk sync not found' });
  res.json({ ...log, results: JSON.parse(log.results) });
});

// ── MSSP: Export cross-tenant drift report ────────────────────────────────────
router.get('/export/drift-report', (req, res) => {
  const db = getDb();
  const { format = 'json' } = req.query;

  const tenants = db.prepare('SELECT id, display_name, tenant_id FROM tenants ORDER BY display_name').all();
  const report = {
    generatedAt: new Date().toISOString(),
    tenantCount: tenants.length,
    tenants: tenants.map(tenant => {
      const areas = db.prepare('SELECT * FROM resource_areas WHERE tenant_id = ?').all(tenant.id);
      return {
        tenantId: tenant.id,
        tenantName: tenant.display_name,
        m365TenantId: tenant.tenant_id,
        areas: areas.map(area => {
          const drift = db.prepare(`
            SELECT * FROM drift_results
            WHERE tenant_id = ? AND area_key = ?
            ORDER BY checked_at DESC LIMIT 1
          `).get(tenant.id, area.area_key);
          return {
            areaKey: area.area_key,
            displayName: area.display_name,
            hasBaseline: area.has_baseline === 1,
            lastChecked: drift?.checked_at || null,
            status: drift?.status || 'unchecked',
            driftCount: drift?.drift_count || 0,
            driftedResources: drift
              ? JSON.parse(drift.summary).filter(s => s.status !== 'clean').map(s => ({
                  resourceId: s.resourceId,
                  resourceName: s.resourceName,
                  status: s.status,
                  propertyDrifts: s.drifts?.length || 0
                }))
              : []
          };
        })
      };
    })
  };

  if (format === 'csv') {
    const rows = [
      ['Tenant Name', 'M365 Tenant ID', 'Resource Area', 'Has Baseline', 'Last Checked', 'Status', 'Drift Count', 'Drifted Resources'].join(',')
    ];
    for (const t of report.tenants) {
      for (const a of t.areas) {
        rows.push([
          `"${t.tenantName}"`,
          t.m365TenantId,
          `"${a.displayName}"`,
          a.hasBaseline,
          a.lastChecked || '',
          a.status,
          a.driftCount,
          `"${a.driftedResources.map(r => r.resourceName).join('; ')}"`
        ].join(','));
      }
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trustm365-drift-report-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(rows.join('\n'));
  }

  res.json(report);
});

// ── Permission check — pre-registration and on-demand ────────────────────────
// POST /api/tenants/check-permissions  (pre-save, body: {tenantId, clientId, clientSecret})
// GET  /api/tenants/:id/permissions    (existing tenant, re-check)

router.post('/check-permissions', asyncRoute(async (req, res) => {
  const { tenantId, clientId, clientSecret } = req.body;
  if (!tenantId || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'tenantId, clientId, and clientSecret are required' });
  }
  try {
    const token = await getAccessToken(tenantId, clientId, clientSecret);
    const { granted } = await checkGrantedPermissions(token, clientId, tenantId);
    const areas = buildAreaPermissionMap(granted, COLLECTORS);
    res.json({ granted, areas });
  } catch (err) {
    logger.warn({ err }, 'Permission check failed');
    res.status(400).json({ error: err.message });
  }
}));

router.get('/:id/permissions', asyncRoute(async (req, res) => {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const authCtx = resolveTenantAuthContext(tenant.id);
    // Evict any cached MSAL client/token so newly granted admin consent
    // is reflected immediately when re-checking permissions.
    evictClientsByClientId(authCtx.clientId);
    const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
    const { granted } = await checkGrantedPermissions(token, authCtx.clientId, authCtx.authorityTenantId);
    const areas = buildAreaPermissionMap(granted, COLLECTORS);
    // Persist latest permission state to DB so the dashboard doesn't need to re-check on load
    persistPermissionState(tenant.id, granted, areas);
    res.json({ granted, areas });
  } catch (err) {
    logger.error({ err }, 'Permission re-check failed');
    res.status(500).json({ error: err.message });
  }
}));

// ── POST /api/tenants/:id/refresh-permissions — force live Graph re-check ─────
// Fetches currently granted app role assignments from Graph, rebuilds the area
// permission map with the latest ReadWrite→Read implication logic, and persists
// the result. Call this after adding new permissions to the App Registration.
router.post('/:id/refresh-permissions', asyncRoute(async (req, res) => {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const authCtx = resolveTenantAuthContext(tenant.id);
    // Ensure we don't reuse an existing cached token from before admin consent
    // was granted — evict the MSAL client so a fresh token is requested.
    evictClientsByClientId(authCtx.clientId);
    const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
    const { granted } = await checkGrantedPermissions(token, authCtx.clientId, authCtx.authorityTenantId);
    const areas = buildAreaPermissionMap(granted, COLLECTORS);
    persistPermissionState(tenant.id, granted, areas);
    // Clear any stale auth error — successful Graph call proves credentials work
    db.prepare("UPDATE tenants SET last_sync_error = NULL, last_sync_error_at = NULL WHERE id = ?")
      .run(tenant.id);
    logger.info({ tenantId: tenant.tenant_id, grantedCount: granted.length }, 'Permissions refreshed from Graph');
    res.json({ granted, areas, message: `${granted.length} permission${granted.length !== 1 ? 's' : ''} found — area access updated` });
  } catch (err) {
    logger.error({ err }, 'Permission refresh failed');
    res.status(500).json({ error: err.message });
  }
}));

// ── Tenant overview — live stats for the dashboard summary panel ──────────────
// GET  /api/tenants/:id/overview      → return cached overview from last snapshot
// POST /api/tenants/:id/overview/refresh → pull fresh stats from Graph API

router.get('/:id/overview', asyncRoute(async (req, res) => {
  const cached = overviewCache.get(req.params.id);
  if (cached) return res.json(cached);

  // No cache yet — trigger a fresh pull and return loading state
  res.json({ loading: true, message: 'Overview not yet fetched. POST /overview/refresh to load.' });
}));

router.post('/:id/overview/refresh', asyncRoute(async (req, res) => {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  try {
    const authCtx = resolveTenantAuthContext(tenant.id);
    const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
    const overview = await fetchTenantOverview(token);
    overviewCache.set(req.params.id, overview);
    logger.info({ tenantId: tenant.tenant_id }, 'Tenant overview refreshed');
    res.json(overview);
  } catch (err) {
    logger.error({ err, tenantId: tenant.tenant_id }, 'Overview refresh failed');
    res.status(500).json({ error: err.message });
  }
}));

// ── Tenant insights — extended Graph metrics (auth methods, MFA, device compliance) ──
// POST /api/tenants/:id/insights — fetch and return live insights (no cache, on-demand)

router.get('/:id/insights', (req, res) => {
  const cached = insightsCache.get(req.params.id);
  if (cached) return res.json(cached);
  res.json({ loading: true, message: 'Insights not yet fetched. POST /insights to load.' });
});

router.post('/:id/insights', asyncRoute(async (req, res) => {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const authCtx = resolveTenantAuthContext(tenant.id);
    const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
    const insights = await fetchTenantInsights(token);
    insightsCache.set(req.params.id, insights);
    logger.info({ tenantId: tenant.tenant_id }, 'Tenant insights refreshed');
    res.json(insights);
  } catch (err) {
    logger.error({ err, tenantId: tenant.tenant_id }, 'Insights fetch failed');
    res.status(500).json({ error: err.message });
  }
}));

module.exports = router;

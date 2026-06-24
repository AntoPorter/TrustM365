require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const path = require('path');
const { openDatabase } = require('./sqlite');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(PROJECT_ROOT, process.env.DATABASE_PATH)
  : path.resolve(PROJECT_ROOT, 'data/trustm365.db');

let db = null;

function getDb() {
  if (!db) throw new Error('Database not initialised. Call initDatabase() first.');
  return db;
}

async function initDatabase() {
  if (db) return db;

  db = await openDatabase(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id              TEXT PRIMARY KEY,
      display_name    TEXT NOT NULL,
      tenant_id       TEXT NOT NULL UNIQUE,
      client_id       TEXT NOT NULL,
      client_secret_encrypted TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at  TEXT,
      last_sync_error TEXT,
      last_sync_error_at TEXT,
      drift_check_auto INTEGER NOT NULL DEFAULT 0,
      drift_interval_minutes INTEGER NOT NULL DEFAULT 60,
      permissions_json TEXT,
      permissions_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS resource_areas (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      area_key    TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      has_baseline INTEGER NOT NULL DEFAULT 0,
      last_pulled_at TEXT,
      baseline_set_at TEXT,
      auto_restore INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      UNIQUE(tenant_id, area_key)
    );

    CREATE TABLE IF NOT EXISTS live_snapshots (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      area_key     TEXT NOT NULL,
      pulled_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resources    TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS baselines (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      area_key     TEXT NOT NULL,
      label        TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      resources    TEXT NOT NULL,
      watched_keys TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      UNIQUE(tenant_id, area_key)
    );

    CREATE TABLE IF NOT EXISTS drift_results (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      area_key        TEXT NOT NULL,
      checked_at      TEXT NOT NULL DEFAULT (datetime('now')),
      status          TEXT NOT NULL,
      drift_count     INTEGER NOT NULL DEFAULT 0,
      summary         TEXT NOT NULL DEFAULT '[]',
      live_snapshot_id TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS restore_log (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      area_key     TEXT NOT NULL,
      resource_id  TEXT NOT NULL,
      property_path TEXT,
      restored_at  TEXT NOT NULL DEFAULT (datetime('now')),
      restored_by  TEXT NOT NULL DEFAULT 'manual',
      old_value    TEXT,
      new_value    TEXT,
      success      INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS baseline_history (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      area_key     TEXT NOT NULL,
      archived_at  TEXT NOT NULL DEFAULT (datetime('now')),
      resources    TEXT NOT NULL,
      label        TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tenant_meta (
      tenant_id   TEXT PRIMARY KEY,
      notes       TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '[]',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS baseline_templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      area_key    TEXT NOT NULL,
      resources   TEXT NOT NULL,
      watched_keys TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      created_from_tenant TEXT
    );

    CREATE TABLE IF NOT EXISTS bulk_sync_log (
      id            TEXT PRIMARY KEY,
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT,
      tenant_count  INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      error_count   INTEGER NOT NULL DEFAULT 0,
      results       TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS baseline_policies (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color       TEXT NOT NULL DEFAULT '#6366f1',
      area_keys   TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_live_area     ON live_snapshots(tenant_id, area_key);
    CREATE INDEX IF NOT EXISTS idx_drift_area    ON drift_results(tenant_id, area_key);
    CREATE INDEX IF NOT EXISTS idx_baseline_area ON baselines(tenant_id, area_key);
    CREATE INDEX IF NOT EXISTS idx_template_area ON baseline_templates(area_key);
    CREATE INDEX IF NOT EXISTS idx_policy_tenant ON baseline_policies(tenant_id);
  `);

  // ── Migrations: add columns to existing databases ──────────────────────────
  const cols = db.prepare("PRAGMA table_info(baselines)").all().map(c => c.name);
  if (!cols.includes('resource_modes')) {
    db.exec("ALTER TABLE baselines ADD COLUMN resource_modes TEXT NOT NULL DEFAULT '{}'");
  }
  if (!cols.includes('resource_hashes')) {
    db.exec("ALTER TABLE baselines ADD COLUMN resource_hashes TEXT NOT NULL DEFAULT '{}'");
  }

  // Remove Security Defaults — not relevant for enterprise tenants
  db.exec("DELETE FROM resource_areas WHERE area_key = 'entra_security_defaults'");
  db.exec("DELETE FROM baselines     WHERE area_key = 'entra_security_defaults'");
  db.exec("DELETE FROM live_snapshots WHERE area_key = 'entra_security_defaults'");
  db.exec("DELETE FROM drift_results  WHERE area_key = 'entra_security_defaults'");

  // Normalise resource area display names — remove group prefix from names
  // that are shown in context (e.g. under the Intune group, "Intune Compliance
  // Policies" is redundant; "Compliance Policies" is cleaner).
  const displayNameFixes = [
    ['intune_compliance',     'Compliance Policies'],
    ['intune_config_profiles','Configuration Profiles'],
    // Entra areas — keep as-is (already clean from earlier sessions)
    // but patch any that still have legacy "Entra " prefix:
    ['entra_roles',           'Role Assignments'],
    ['entra_users',           'User Accounts'],
    ['entra_groups',          'Groups'],
    ['entra_apps',            'App Registrations'],
    ['entra_auth_policies',   'Authentication Policies'],
    ['entra_ca',              'Conditional Access Policies'],
  ];
  for (const [areaKey, name] of displayNameFixes) {
    db.prepare("UPDATE resource_areas SET display_name = ? WHERE area_key = ?").run(name, areaKey);
  }

  // resource_groups: named subsets of resources within a single area baseline
  // Shape: [ { id, name, color, resourceIds: [...] } ]
  const blCols = db.prepare("PRAGMA table_info(baselines)").all().map(c => c.name);
  if (!blCols.includes('resource_groups')) {
    db.exec("ALTER TABLE baselines ADD COLUMN resource_groups TEXT NOT NULL DEFAULT '[]'");
  }
  if (!blCols.includes('excluded_resources')) {
    db.exec("ALTER TABLE baselines ADD COLUMN excluded_resources TEXT NOT NULL DEFAULT '[]'");
  }

  // baseline_history: add resource_modes and watched_keys if not present
  const histCols = db.prepare("PRAGMA table_info(baseline_history)").all().map(c => c.name);
  if (!histCols.includes('resource_modes')) {
    db.exec("ALTER TABLE baseline_history ADD COLUMN resource_modes TEXT NOT NULL DEFAULT '{}'");
  }
  if (!histCols.includes('watched_keys')) {
    db.exec("ALTER TABLE baseline_history ADD COLUMN watched_keys TEXT NOT NULL DEFAULT '[]'");
  }

  // restore_log: add resource_name and restore_type for richer audit display
  const logCols = db.prepare("PRAGMA table_info(restore_log)").all().map(c => c.name);
  if (!logCols.includes('resource_name')) {
    db.exec("ALTER TABLE restore_log ADD COLUMN resource_name TEXT NOT NULL DEFAULT ''");
  }
  if (!logCols.includes('restore_type')) {
    db.exec("ALTER TABLE restore_log ADD COLUMN restore_type TEXT NOT NULL DEFAULT 'full'");
  }
  if (!logCols.includes('restored_properties')) {
    db.exec("ALTER TABLE restore_log ADD COLUMN restored_properties TEXT NOT NULL DEFAULT '[]'");
  }

  // mssp_settings — ensure table exists before running column migrations against it
  db.exec(`
    CREATE TABLE IF NOT EXISTS mssp_settings (
      id                      TEXT PRIMARY KEY DEFAULT 'singleton',
      company_name            TEXT NOT NULL DEFAULT '',
      logo_url                TEXT,
      brand_hue               TEXT,
      baseline_label_template TEXT NOT NULL DEFAULT '',
      tagline                 TEXT NOT NULL DEFAULT '',
      report_theme            TEXT NOT NULL DEFAULT 'dark',
      report_accent           TEXT NOT NULL DEFAULT '',
      la_enabled              INTEGER NOT NULL DEFAULT 0,
      la_workspace_id         TEXT NOT NULL DEFAULT '',
      la_shared_key_encrypted TEXT NOT NULL DEFAULT '',
      la_log_type_prefix      TEXT NOT NULL DEFAULT 'TrustM365',
      la_schema_version       TEXT NOT NULL DEFAULT '1.0',
      la_ingest_drift         INTEGER NOT NULL DEFAULT 1,
      la_ingest_restore       INTEGER NOT NULL DEFAULT 1,
      la_ingest_jobs          INTEGER NOT NULL DEFAULT 1,
      la_ingest_webhooks      INTEGER NOT NULL DEFAULT 1,
      la_ingest_api_logs      INTEGER NOT NULL DEFAULT 0,
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO mssp_settings (id) VALUES ('singleton');
  `);

  // mssp_settings column migrations — safe on both fresh and existing databases
  // ── Tenant table migrations ──────────────────────────────────────────────────
  const tenantCols = db.prepare("PRAGMA table_info(tenants)").all().map(c => c.name);
  if (!tenantCols.includes('last_sync_error')) {
    db.exec("ALTER TABLE tenants ADD COLUMN last_sync_error TEXT");
  }
  if (!tenantCols.includes('last_sync_error_at')) {
    db.exec("ALTER TABLE tenants ADD COLUMN last_sync_error_at TEXT");
  }
  if (!tenantCols.includes('app_registration_id')) {
    db.exec("ALTER TABLE tenants ADD COLUMN app_registration_id TEXT");
  }

  const msspCols = db.prepare("PRAGMA table_info(mssp_settings)").all().map(c => c.name);  if (!msspCols.includes('baseline_label_template')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN baseline_label_template TEXT NOT NULL DEFAULT ''");
  }
  if (!msspCols.includes('brand_hue')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN brand_hue TEXT");
  }
  if (!msspCols.includes('logo_url')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN logo_url TEXT");
  }
  if (!msspCols.includes('tagline')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN tagline TEXT NOT NULL DEFAULT ''");
  }
  if (!msspCols.includes('report_theme')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN report_theme TEXT NOT NULL DEFAULT 'dark'");
  }
  if (!msspCols.includes('report_accent')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN report_accent TEXT NOT NULL DEFAULT ''");
  }
  if (!msspCols.includes('la_enabled')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!msspCols.includes('la_workspace_id')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_workspace_id TEXT NOT NULL DEFAULT ''");
  }
  if (!msspCols.includes('la_shared_key_encrypted')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_shared_key_encrypted TEXT NOT NULL DEFAULT ''");
  }
  if (!msspCols.includes('la_log_type_prefix')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_log_type_prefix TEXT NOT NULL DEFAULT 'TrustM365'");
  }
  if (!msspCols.includes('la_schema_version')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_schema_version TEXT NOT NULL DEFAULT '1.0'");
  }
  if (!msspCols.includes('la_ingest_drift')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_ingest_drift INTEGER NOT NULL DEFAULT 1");
  }
  if (!msspCols.includes('la_ingest_restore')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_ingest_restore INTEGER NOT NULL DEFAULT 1");
  }
  if (!msspCols.includes('la_ingest_jobs')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_ingest_jobs INTEGER NOT NULL DEFAULT 1");
  }
  if (!msspCols.includes('la_ingest_webhooks')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_ingest_webhooks INTEGER NOT NULL DEFAULT 1");
  }
  if (!msspCols.includes('la_ingest_api_logs')) {
    db.exec("ALTER TABLE mssp_settings ADD COLUMN la_ingest_api_logs INTEGER NOT NULL DEFAULT 0");
  }
  // Timezone column removed from MSSP settings (no longer used)

  // Rename resource area display names to remove redundant product prefix.
  // Safe to run on every startup — idempotent UPDATE WHERE.
  const renames = [
    ['entra_roles',           'Role Assignments'],
    ['intune_compliance',     'Compliance Policies'],
    ['intune_config_profiles','Configuration Profiles'],
  ];
  for (const [areaKey, newName] of renames) {
    db.prepare("UPDATE resource_areas SET display_name = ? WHERE area_key = ?")
      .run(newName, areaKey);
  }

  // Security check results for Zero Trust policy checks (separate from tenant baselines)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_registrations (
      id                     TEXT PRIMARY KEY,
      display_name           TEXT NOT NULL,
      client_id              TEXT NOT NULL,
      client_secret_encrypted TEXT NOT NULL,
      auth_mode              TEXT NOT NULL DEFAULT 'client_secret',
      metadata               TEXT NOT NULL DEFAULT '{}',
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_app_reg_client_id ON app_registrations(client_id);

    CREATE TABLE IF NOT EXISTS tenant_app_bindings (
      id                     TEXT PRIMARY KEY,
      tenant_id              TEXT NOT NULL,
      app_registration_id    TEXT NOT NULL,
      authority_tenant_id    TEXT NOT NULL,
      is_primary             INTEGER NOT NULL DEFAULT 1,
      permissions_json       TEXT NOT NULL DEFAULT '{}',
      permissions_checked_at TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (app_registration_id) REFERENCES app_registrations(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_app_binding_unique ON tenant_app_bindings(tenant_id, app_registration_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_app_binding_tenant ON tenant_app_bindings(tenant_id, is_primary);

    CREATE TABLE IF NOT EXISTS security_check_results (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      check_id     TEXT NOT NULL,
      check_name   TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'unknown',
      detail       TEXT NOT NULL DEFAULT '',
      checked_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sec_check ON security_check_results(tenant_id, check_id);

    -- Custom (user-defined) read-only collectors
    -- Each row defines a Graph endpoint, the fields to pull, and which fields are watchable.
    -- Restore is never supported for custom collectors.
    CREATE TABLE IF NOT EXISTS custom_collectors (
      id              TEXT PRIMARY KEY,
      area_key        TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      graph_endpoint  TEXT NOT NULL,
      select_fields   TEXT NOT NULL DEFAULT '',
      id_field        TEXT NOT NULL DEFAULT 'id',
      name_field      TEXT NOT NULL DEFAULT 'displayName',
      watchable_keys  TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Webhook destinations — per-tenant outbound notifications on drift
    CREATE TABLE IF NOT EXISTS webhook_destinations (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT,                          -- NULL = all tenants (MSSP-wide)
      label        TEXT NOT NULL DEFAULT '',
      url          TEXT NOT NULL,
      fire_mode    TEXT NOT NULL DEFAULT 'first', -- first | every
      enabled      INTEGER NOT NULL DEFAULT 1,
      last_fired_at TEXT,
      last_error   TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhook_destinations(tenant_id);

    -- Track which areas have already fired for first-detection mode
    -- Cleared when drift resolves (area goes clean)
    CREATE TABLE IF NOT EXISTS webhook_fired (
      webhook_id   TEXT NOT NULL,
      tenant_id    TEXT NOT NULL,
      area_key     TEXT NOT NULL,
      fired_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (webhook_id, tenant_id, area_key),
      FOREIGN KEY (webhook_id) REFERENCES webhook_destinations(id) ON DELETE CASCADE
    );

    -- Per-drift webhook delivery outcomes (sent, failed, or not sent)
    CREATE TABLE IF NOT EXISTS webhook_delivery_events (
      id             TEXT PRIMARY KEY,
      drift_result_id TEXT NOT NULL,
      webhook_id     TEXT,
      webhook_label  TEXT NOT NULL DEFAULT '',
      fire_mode      TEXT NOT NULL DEFAULT '',
      tenant_id      TEXT NOT NULL,
      area_key       TEXT NOT NULL,
      outcome        TEXT NOT NULL,
      reason         TEXT NOT NULL DEFAULT '',
      error_message  TEXT,
      http_status    INTEGER,
      attempted_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (drift_result_id) REFERENCES drift_results(id) ON DELETE CASCADE,
      FOREIGN KEY (webhook_id) REFERENCES webhook_destinations(id) ON DELETE SET NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_delivery_drift ON webhook_delivery_events(drift_result_id, attempted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_webhook_delivery_area ON webhook_delivery_events(tenant_id, area_key, attempted_at DESC);

    -- tenant_id NULL = portfolio report (all tenants)
    CREATE TABLE IF NOT EXISTS reports (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT,
      report_type     TEXT NOT NULL DEFAULT 'tenant',
      title           TEXT NOT NULL DEFAULT '',
      date_range_start TEXT NOT NULL,
      date_range_end   TEXT NOT NULL,
      generated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      trigger         TEXT NOT NULL DEFAULT 'on-demand',
      html_content    TEXT NOT NULL DEFAULT '',
      notes_json      TEXT NOT NULL DEFAULT '{}',
      unread          INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_reports_tenant ON reports(tenant_id, generated_at);

    -- Report schedules: per-tenant weekly/monthly auto-generation
    CREATE TABLE IF NOT EXISTS report_schedules (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL UNIQUE,
      frequency       TEXT NOT NULL DEFAULT 'monthly',
      day_of_week     INTEGER NOT NULL DEFAULT 1,
      day_of_month    INTEGER NOT NULL DEFAULT 1,
      enabled         INTEGER NOT NULL DEFAULT 0,
      include_appendix INTEGER NOT NULL DEFAULT 1,
      last_run_at     TEXT,
      next_run_at     TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
  // Tenant-scoped reference templates (persisted per-tenant)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_reference_templates (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      template_id  TEXT NOT NULL,
      template_json TEXT NOT NULL,
      uploaded_by  TEXT NOT NULL DEFAULT '',
      metadata     TEXT NOT NULL DEFAULT '{}',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_ref_template_unique ON tenant_reference_templates(tenant_id, template_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_ref_template_tenant ON tenant_reference_templates(tenant_id);
  `);

  // ── Backfill new collector areas into existing tenants ───────────────────────
  // INSERT OR IGNORE — idempotent, runs safely on every startup.
  const NEW_COLLECTOR_AREAS = [
    ['intune_update_rings',       'Windows Update Rings',                       'Windows Update for Business rings — feature/quality update deferral, deadlines, pause state'],
    ['intune_mtd_connectors',     'Mobile Threat Defense Connectors',           'Defender for Endpoint and partner MTD connector states — enables mobile/endpoint threat integration'],
    ['intune_app_protection',     'App Protection Policies',                    'MAM policies for iOS and Android — data transfer restrictions, PIN requirements, encryption'],
    ['intune_ep_antivirus',       'Endpoint Security — Antivirus',              'Microsoft Defender antivirus policies — real-time protection, cloud protection, tamper protection, PUA blocking'],
    ['intune_ep_firewall',        'Endpoint Security — Firewall',               'Windows Firewall policies — domain, private and public profile enabled state, inbound/outbound default actions'],
    ['intune_ep_disk_encryption', 'Endpoint Security — Disk Encryption',        'BitLocker policies — encryption enabled, method (AES-256/AES-128), recovery key escrow to Entra ID'],
    ['intune_ep_asr',             'Endpoint Security — Attack Surface Reduction', 'ASR rules — Office macro blocking, credential theft prevention, ransomware protection, controlled folder access'],
    // Collaboration and content areas
    ['sharepoint_sites',          'SharePoint Sites',                             'SharePoint site collections and basic sharing settings'],
    ['sharepoint_tenant_settings','Tenant Security Settings',                     'SharePoint tenant-level security and sharing posture settings'],
    ['teams_policies_messaging',  'Messaging Policies',                           'Teams messaging policies — tenant-level messaging controls (Giphy, memes, stickers, external images)'],
    ['teams_policies_meetings',   'Meeting Policies',                             'Teams meeting & online meeting policies — recording, transcription, lobby settings'],
    ['teams_membership',          'Team Membership',                              'Per-team membership and owner lists — members and owners for Teams'],
    ['teams_app_permission_policies', 'App Permission Policies',                  'Teams app permission policies — monitor app allow/block policy posture'],
    ['teams_channels_policies',      'Channels Policies',                         'Teams channels policies — private/shared channel governance posture'],
    ['teams_org_app_settings',       'Org App Settings',                          'Teams organization app settings — sideloading and app request posture'],
    ['exchange_mailboxes',        'Mailboxes',                                    'Mailbox-level monitoring posture snapshot (mailbox settings, forwarding indicators, and inbox-rule indicators). Restore is not available for this area.'],
    ['exchange_mailbox_security', 'Mailbox Security Settings',                    'Mailbox security settings and forwarding indicators — mailbox settings can be restored; rules are monitored for drift'],
    ['exchange_connectors',       'Mail Flow Connectors',                         'Mail flow connectors discovered through Graph beta-backed endpoints. Empty results indicate no Graph-accessible connectors for this tenant context.'],
    ['exchange_transport_rules',  'Transport Rules',                              'Transport rules discovered through Graph beta-backed endpoints. Empty results indicate no Graph-accessible transport rules for this tenant context.'],
  ];
  {
    const existingTenants = db.prepare('SELECT id FROM tenants').all();
    const insertArea = db.prepare(
      'INSERT OR IGNORE INTO resource_areas (id, tenant_id, area_key, display_name, description) VALUES (?, ?, ?, ?, ?)'
    );
    const crypto = require('crypto');
    for (const tenant of existingTenants) {
      for (const [areaKey, displayName, description] of NEW_COLLECTOR_AREAS) {
        insertArea.run(crypto.randomUUID(), tenant.id, areaKey, displayName, description);
      }
    }
  }

  // Normalize legacy Teams display names (remove redundant "Teams -"/"Teams —").
  db.prepare(`
    UPDATE resource_areas
    SET display_name = CASE area_key
      WHEN 'teams_policies_messaging' THEN 'Messaging Policies'
      WHEN 'teams_policies_meetings' THEN 'Meeting Policies'
      WHEN 'teams_membership' THEN 'Team Membership'
      ELSE display_name
    END
    WHERE area_key IN ('teams_policies_messaging', 'teams_policies_meetings', 'teams_membership')
      AND (
        display_name LIKE 'Teams - %'
        OR display_name LIKE 'Teams — %'
        OR display_name IN ('Teams Membership', 'Teams - Membership', 'Teams — Membership')
      )
  `).run();

  // Backfill shared app-registration linkage for legacy tenant rows.
  {
    const crypto = require('crypto');
    const tenants = db.prepare('SELECT * FROM tenants').all();
    const hasApp = db.prepare('SELECT id FROM app_registrations WHERE id = ?');
    const insertApp = db.prepare(`
      INSERT INTO app_registrations (id, display_name, client_id, client_secret_encrypted)
      VALUES (?,?,?,?)
    `);
    const hasBindingByApp = db.prepare('SELECT id FROM tenant_app_bindings WHERE tenant_id = ? AND app_registration_id = ?');
    const hasAnyBinding = db.prepare('SELECT id FROM tenant_app_bindings WHERE tenant_id = ? LIMIT 1');
    const insertBinding = db.prepare(`
      INSERT INTO tenant_app_bindings (id, tenant_id, app_registration_id, authority_tenant_id, is_primary)
      VALUES (?,?,?,?,1)
    `);
    const setTenantApp = db.prepare('UPDATE tenants SET app_registration_id = ? WHERE id = ?');

    for (const tenant of tenants) {
      if (!tenant.client_id || !tenant.client_secret_encrypted) continue;

      let appRegistrationId = tenant.app_registration_id;
      if (!appRegistrationId) {
        appRegistrationId = crypto.randomUUID();
        insertApp.run(
          appRegistrationId,
          `${tenant.display_name || tenant.tenant_id} App Registration`,
          tenant.client_id,
          tenant.client_secret_encrypted
        );
        setTenantApp.run(appRegistrationId, tenant.id);
      } else if (!hasApp.get(appRegistrationId)) {
        insertApp.run(
          appRegistrationId,
          `${tenant.display_name || tenant.tenant_id} App Registration`,
          tenant.client_id,
          tenant.client_secret_encrypted
        );
      }

      const hasBoundTarget = hasBindingByApp.get(tenant.id, appRegistrationId);
      const hasBoundAny = hasAnyBinding.get(tenant.id);
      if (!hasBoundTarget && !hasBoundAny) {
        insertBinding.run(crypto.randomUUID(), tenant.id, appRegistrationId, tenant.tenant_id);
      }
    }
  }

  return db;
}

module.exports = { getDb, initDatabase };

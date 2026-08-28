const crypto = require('crypto');
const https = require('https');
const { getDb } = require('../database/init');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');

function toBool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  return Number(value) === 1 || value === true;
}

function sanitizeLogTypePrefix(prefix) {
  const safe = String(prefix || 'TrustM365').replace(/[^A-Za-z0-9_]/g, '');
  return safe || 'TrustM365';
}

function sanitizeSchemaVersion(version) {
  const raw = String(version || '1.0').trim();
  if (!raw) return '1.0';
  return raw.slice(0, 24);
}

function getLogType(prefix, category) {
  const suffixMap = {
    drift: 'Drift',
    restore: 'Restore',
    jobs: 'Jobs',
    webhooks: 'Webhooks',
    api_logs: 'Api',
  };
  const suffix = suffixMap[category] || 'Events';
  return `${sanitizeLogTypePrefix(prefix)}${suffix}`;
}

function getSettings() {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mssp_settings WHERE id = ?').get('singleton') || {};
  return {
    enabled: toBool(row.la_enabled, false),
    workspaceId: String(row.la_workspace_id || '').trim(),
    sharedKeyEncrypted: row.la_shared_key_encrypted || '',
    logTypePrefix: sanitizeLogTypePrefix(row.la_log_type_prefix),
    schemaVersion: sanitizeSchemaVersion(row.la_schema_version),
    categories: {
      drift: toBool(row.la_ingest_drift, true),
      restore: toBool(row.la_ingest_restore, true),
      jobs: toBool(row.la_ingest_jobs, true),
      webhooks: toBool(row.la_ingest_webhooks, true),
      api_logs: toBool(row.la_ingest_api_logs, false),
    }
  };
}

function shouldIngest(category, settings) {
  if (!settings.enabled) return false;
  if (!settings.workspaceId || !settings.sharedKeyEncrypted) return false;
  return !!settings.categories[category];
}

function buildSignature(workspaceId, sharedKey, date, contentLength) {
  const stringToSign = `POST\n${contentLength}\napplication/json\nx-ms-date:${date}\n/api/logs`;
  const decodedKey = Buffer.from(sharedKey, 'base64');
  const hash = crypto.createHmac('sha256', decodedKey)
    .update(stringToSign, 'utf8')
    .digest('base64');
  return `SharedKey ${workspaceId}:${hash}`;
}

function postToLogAnalytics({ workspaceId, sharedKey, logType, records }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(records);
    const date = new Date().toUTCString();
    const contentLength = Buffer.byteLength(body, 'utf8');
    const authorization = buildSignature(workspaceId, sharedKey, date, contentLength);

    const req = https.request({
      hostname: `${workspaceId}.ods.opinsights.azure.com`,
      path: '/api/logs?api-version=2016-04-01',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': contentLength,
        'Authorization': authorization,
        'Log-Type': logType,
        'x-ms-date': date,
        'time-generated-field': 'eventTime',
      },
      timeout: 10000,
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, statusCode: res.statusCode });
          return;
        }
        reject(new Error(`Log Analytics HTTP ${res.statusCode}: ${responseBody || 'Unknown error'}`));
      });
    });

    req.on('timeout', () => req.destroy(new Error('Log Analytics request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendRecords(category, records, overrideSettings = null) {
  const settings = overrideSettings || getSettings();
  if (!shouldIngest(category, settings)) {
    return { ok: false, skipped: true };
  }

  let sharedKey;
  try {
    sharedKey = decrypt(settings.sharedKeyEncrypted);
  } catch (err) {
    logger.warn({ err }, 'Failed to decrypt Log Analytics shared key');
    return { ok: false, skipped: true, error: 'invalid_key' };
  }

  const logType = getLogType(settings.logTypePrefix, category);
  return postToLogAnalytics({
    workspaceId: settings.workspaceId,
    sharedKey,
    logType,
    records,
  });
}

async function emitSiemEvent(category, eventType, payload = {}, overrideSettings = null) {
  const settings = overrideSettings || getSettings();
  if (!shouldIngest(category, settings)) return;

  const record = {
    eventTime: new Date().toISOString(),
    eventType,
    eventCategory: category,
    schemaVersion: settings.schemaVersion,
    sourcePlatform: 'TrustM365',
    sourceVersion: '1.2.1',
    ...payload,
  };

  try {
    await sendRecords(category, [record], settings);
  } catch (err) {
    logger.warn({ err, category, eventType }, 'SIEM event export failed');
  }
}

async function testConnection(overrides = {}) {
  const persisted = getSettings();
  const merged = {
    ...persisted,
    enabled: overrides.enabled !== undefined ? !!overrides.enabled : persisted.enabled,
    workspaceId: (overrides.workspaceId || persisted.workspaceId || '').trim(),
    logTypePrefix: sanitizeLogTypePrefix(overrides.logTypePrefix || persisted.logTypePrefix),
    schemaVersion: sanitizeSchemaVersion(overrides.schemaVersion || persisted.schemaVersion),
    sharedKeyEncrypted: overrides.sharedKeyEncrypted || persisted.sharedKeyEncrypted,
    categories: {
      ...persisted.categories,
      ...(overrides.categories || {}),
    },
  };

  const testRecord = {
    eventTime: new Date().toISOString(),
    eventType: 'trustm365.connection.test',
    eventCategory: 'jobs',
    schemaVersion: merged.schemaVersion,
    sourcePlatform: 'TrustM365',
    sourceVersion: '1.2.0',
    status: 'ok',
    message: 'Connection test from TrustM365 MSSP Settings',
  };

  const result = await sendRecords('jobs', [testRecord], merged);
  return { success: !result.skipped };
}

module.exports = {
  getSettings,
  emitSiemEvent,
  testConnection,
  sanitizeLogTypePrefix,
  sanitizeSchemaVersion,
};

# Changelog

All notable changes to TrustM365 are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.2.0] - Unreleased

### Scope

- All changes delivered after v1.1.0 are tracked as part of v1.2.0.

### Feature Highlights

- Per-drift webhook delivery status in Area View (Configuration tab):
  - New "Webhook Notification Status" panel with sent, failed, and not-sent counters for the latest drift result.
  - Expandable per-destination outcome rows with fire mode, reason, HTTP status, and error details.
  - Explicit not-sent reasons for skipped first-mode, disabled destinations, and no applicable destinations.
- Drift details API enrichment:
  - `GET /api/areas/:tenantId/:areaKey/drift` now includes `webhookDeliverySummary` and `webhookDeliveries` for the latest drift check.
- Backend delivery-event persistence:
  - Added `webhook_delivery_events` table to persist webhook outcomes per drift result for auditability and UI visibility.

### Bug Fixes

- Fixed tenant onboarding crash after **Validate -> Next**:
  - Added async route error wrapping for tenant API handlers so unhandled promise rejections are forwarded to Express error middleware instead of terminating the backend process.
  - Prevents dev/proxy cascade failures (`502`, `ECONNREFUSED`) caused by backend process exits during tenant registration flows.
- Fixed build-version consistency for release visibility:
  - Pinned frontend production build version via `frontend/.env.production` (`VITE_APP_BUILD_VERSION=v1.2.0`) so the sidebar build label remains aligned with the milestone/release metadata.

### Security

- Remediated dependency vulnerabilities identified during v1.2.0 release preparation:
  - Backend: upgraded `multer` to `^2.2.0` to address high-severity DoS advisory coverage for versions `< 2.2.0`.
  - Frontend: upgraded `vite` to `^8.1.0` to move past Windows path-handling advisory ranges affecting older `8.0.x` releases.
  - Frontend: upgraded `axios` and added an explicit `overrides` pin for `form-data` (`^4.0.6`) to remove the high-severity CRLF multipart injection range (`< 4.0.6`).
  - Lockfiles refreshed (`backend/package-lock.json`, `frontend/package-lock.json`) and `npm audit` now reports `0` high vulnerabilities for both backend and frontend.

### Maintenance

- Repository release-prep cleanup for v1.2.0:
  - Removed legacy test assets and test-results directories from backend/frontend workspaces.
  - Removed obsolete test scripts from package manifests.
  - Removed unused test-only dependencies and stale empty folders created by historical test/screenshot runs.

### Build Optimizations

- Improved frontend code-splitting with route-level lazy loading:
  - Converted primary app routes to lazy-loaded pages with `React.lazy` + `Suspense` so heavy views are loaded on demand.
  - Reduced the main entry bundle footprint (now split into page chunks with a smaller initial `index` chunk).
- Removed ineffective dynamic import path in baseline export flow:
  - Replaced mixed static + dynamic import usage of `reportApi` in `BaselineExportModal` to eliminate Vite's ineffective dynamic import warning.
- Cleaned PostCSS module parsing warning in production build:
  - Switched `frontend/postcss.config.js` to CommonJS export format to avoid Node reparsing/module-type warning noise during Vite builds.

## [1.1.0] — 2026-06-05

### Release Notes

- Bumped repository component versions to 1.1.0 (root, backend, frontend).
- All changes delivered after v1.0.0 are tracked as part of v1.1.0

### Added

- Native Log Analytics export pipeline (MSSP-scoped) with direct ingestion to custom tables using Azure Monitor Data Collector API:
  - New MSSP settings fields for workspace ID, shared key (encrypted at rest), table prefix, schema version, and per-category ingestion toggles
  - New backend ingestion service at `backend/src/services/logAnalytics.js`
  - New connection test endpoint: `POST /api/mssp/log-analytics/test`
  - Shared key is write-only from API responses (`la_has_shared_key` indicator only)
- Event-category export controls for cost management:
  - Drift lifecycle
  - Remediation/restore outcomes
  - Job/scheduler telemetry
  - Webhook delivery outcomes
  - API request logs (high-volume optional category)
- New SIEM event hooks across runtime pipelines:
  - API request middleware
  - Drift/sync and compare job lifecycle
  - Restore success/failure events
  - Webhook delivery success/failure/skip events
- Sentinel content pack assets included in repository:
  - KQL query library: `data/sentinel/kql/trustm365-queries.kql`
  - Analytic rule templates: `data/sentinel/analytics-rules/*.json`
  - Workbook definition: `data/sentinel/workbooks/TrustM365-Drift-Monthly.workbook.json`
  - Deployment notes: `data/sentinel/deployment/README.md`
- New deployment and validation helpers:
  - `scripts/sentinel/deploy/deploy_content_pack.ps1`
  - `scripts/sentinel/validate/validate_sentinel_assets.js`
  - Root scripts: `npm run sentinel:validate` and `npm run sentinel:deploy`
- New documentation and guides for SIEM workflows:
  - Integration reference: `docs/integrations/sentinel-log-analytics.md`
  - Guide 21: `docs/guides/21-log-analytics-and-sentinel.md`
  - Guide 22: `docs/guides/22-sentinel-content-pack-operations.md`
  - Sample event record: `docs/samples/sentinel-la-record-sample.json`

- Additional v1.1 workload collectors for SharePoint, Exchange Online, and Microsoft Teams:
  - SharePoint:
    - `sharepoint_sites` (SharePoint Sites) — monitor + restore
    - `sharepoint_tenant_settings` (Tenant Security Settings) — monitor + restore
  - Exchange Online:
    - `exchange_mailboxes` (Mailboxes) — monitor only
    - `exchange_mailbox_security` (Mailbox Security Settings) — monitor + restore
    - `exchange_connectors` (Mail Flow Connectors) — monitor only
    - `exchange_transport_rules` (Transport Rules) — monitor only
  - Microsoft Teams:
    - `teams_policies_messaging` (Messaging Policies) — monitor + restore
    - `teams_policies_meetings` (Meeting Policies) — monitor + restore
    - `teams_membership` (Team Membership) — monitor + restore
    - `teams_app_permission_policies` (App Permission Policies) — monitor only
    - `teams_channels_policies` (Channels Policies) — monitor only
    - `teams_org_app_settings` (Org App Settings) — monitor + restore

- Shared app registration model for multi-tenant auth management:
  - `app_registrations` table
  - `tenant_app_bindings` table
  - tenant linkage via `tenants.app_registration_id`
- New backend route group: `/api/app-registrations` for app registration CRUD and tenant binding lifecycle (bind, unbind, set primary, refresh permissions).
- New auth resolver service for runtime token acquisition through primary binding resolution (`backend/src/services/tenantAuth.js`).
- New centralized permission persistence helper (`backend/src/services/permissionState.js`) to keep tenant and primary binding permission state synchronized.
- New frontend page and route for centralized identity management:
  - `frontend/src/pages/AppRegistrations.jsx`
  - route: `/mssp-settings/app-registrations`
- New tenant onboarding path to reuse shared app registrations:
  - `POST /api/tenants/with-app`
  - `POST /api/tenants/check-permissions-with-app`
- Add Tenant enhancements for faster MSSP onboarding:
  - known multi-tenant app suggestions
  - one-click "Use suggestion"
  - one-click "Use and check"
- MSSP Settings: new **Identity & App Registrations** section with summary stats and direct navigation to app registration management.

### Updated

- Top-level README updated to document:
  - Log Analytics export and Sentinel content pack features
  - Updated architecture tree (`data/sentinel` assets)
  - New docs and guides navigation entries (Guides 21 and 22)
  - Roadmap adjusted to reflect this feature shipped in v1.1
- Documentation indexes and references updated:
  - `docs/README.md` now links Sentinel integration docs
  - `docs/guides/README.md` includes Guides 21 and 22
  - `docs/usage.md` includes operational Log Analytics/Sentinel section
  - `docs/deployment.md` includes optional SIEM enablement flow

- Security Templates and Reference Templates updated (Reference Sets):
  - Zero Trust Assessment V2 templates merged into the Security UI (32 Tests, associated to Identity and Devices)
  - Removal of Security Templates from Maester and CISA SCuBA (8 Tests)
  - `openintune` templates excluded from default Security view
  - owner-summary counts aggregated across selected tenants
  - per-template aggregated views with per-tenant breakdowns
  - failing-item export support in Security Templates (CSV and JSON)
  - added `Reload sets` action (`POST /api/reference-templates/reload`)
- **REMOVED:** Multi-tenant compare endpoint (`POST /api/reference-templates/:id/compare-multi`) and async multi-tenant compare endpoint (`POST /api/reference-templates/:id/compare-multi-async`) have been removed in v1.1. All compare operations are now single-tenant only.
- Token acquisition paths migrated from direct tenant credential usage to shared-auth resolver across:
  - sync engine
  - restore engine
  - area pulls and repair flows
  - custom collector test pull
  - report assembly overview refresh
  - reference template compare flows
  - tenant permission/overview/insight refresh flows
- Tenant credential rotation now supports shared auth model and cache eviction by client ID.
- Sidebar and dashboard UI now expose linked app registration state and deep-link into tenant app-registration settings.
- Tenant registration flow now supports both modes:
  - new dedicated credentials
  - reuse existing shared app registration
- Documentation set expanded and aligned for v1.1 scope, including updated guides and navigation for Security Templates and Reference Templates single-tenant behavior.
- Exchange Online: removed per-tenant mailbox captures (mailbox-level fields such as `mailboxSettings`, forwarding, automatic replies, and inbox rules) from built-in collectors and the default UI; these areas now show explanatory placeholders by default. Added optional migration and prune scripts to normalize mailbox permission names and remove historical mailbox fields (`backend/scripts/migrate_mailbox_permission_names.js`, `backend/scripts/prune_exchange_mailbox_fields.js`). Permission names for mailboxes are now canonical Microsoft Graph names: `MailboxSettings.Read` and `MailboxSettings.ReadWrite` (legacy `.All` variants are accepted at runtime for compatibility).
- UI: removed per-collector "Fields captured" / "Monitored Fields" lists from the Area View and Custom Collectors pages (frontend-only). Field discovery and selection is available via the Baseline Editor and the Custom Collectors Test Pull. Frontend files updated: `frontend/src/pages/AreaView.jsx`, `frontend/src/pages/CustomCollectors.jsx`.
- Documentation: updated docs index to be a true section intro (`docs/README.md`) and corrected top-level guide navigation in `README.md` to include guides 19 and 20 with the correct guide 19 path (`docs/guides/19-app-registrations.md`).

### Fixed

- Corrected stale auth cache eviction call during tenant deletion by switching to client-ID-based eviction.
- Improved binding validation handling by supporting explicit authority tenant override for cross-tenant app registrations.
- Reduced permission state drift by writing synchronized permission snapshots to both tenant and primary binding records.
- Fixed Azure App Service deployment: ensured `npm start` launches `node backend/src/index.js` as the entry point, Express serves `frontend/dist/` with SPA catch-all, and healthcheck endpoint is available. Azure CI and GitHub Actions workflow updated to set correct startup command and deployment steps.

(Big Shoutout to the Community for assisting in these fixes!)

---

## [1.0.0] — 2026-03-20

### Initial Public Release

### Platform foundation

- React 18 + Vite + Tailwind CSS frontend; Express 4 + MSAL Node + sql.js backend
- SQLite with WAL mode — pure JavaScript driver, no native compilation required on any platform
- AES-256-GCM encryption for all client secrets stored in the database
- JWT-free architecture — no user authentication required; all access via App Registration service principal
- `ENCRYPTION_KEY` environment variable — 64-char hex key, generated with `npm run generate:key`

### Baseline & Drift engine

- `computeDrift()` — property-level deep diff with `{ path, label }` watched key format
- Snapshot mode — SHA-256 hash of the resource (volatile fields excluded) stored at baseline save; any change detected on next sync
- Properties mode — per-field comparison against baseline values for only the watched fields
- Effective status rule: `drifted + drift_count=0` treated as clean everywhere (prevents post-auto-restore ghost alerts)
- Auto-restore — triggered per-area after drift; post-restore re-pull confirms clean state
- Restore dry-run — `?dryRun=true` returns exact PATCH body without executing

### Resource areas — 15 built-in collectors

| Area | API | Restorable |
| --- | --- | --- |
| Directory Role Assignments | v1.0 | ✅ |
| User Accounts | v1.0 | ✅ |
| Groups | v1.0 | ✅ |
| App Registrations | v1.0 | ✅ |
| Authentication Policies | v1.0 | ✅ |
| Conditional Access Policies | v1.0 | ✅ |
| Compliance Policies | v1.0 | ✅ |
| Configuration Profiles | v1.0 | ✅ |
| Windows Update Rings | v1.0 | ✅ |
| Mobile Threat Defense Connectors | v1.0 | ✅ |
| App Protection Policies (MAM) | v1.0 | Monitor only |
| Endpoint Security — Antivirus | Beta | ✅ |
| Endpoint Security — Firewall | Beta | ✅ |
| Endpoint Security — Disk Encryption | Beta | ✅ |
| Endpoint Security — Attack Surface Reduction | Beta | ✅ |

### Intune restore fixes

- Compliance policies — `deviceThreatProtectionEnabled` and `deviceThreatProtectionRequiredSecurityLevel` added to `monitorOnlyKeys`; Graph rejects these fields on tenants without Defender for Endpoint licensing
- Configuration profiles — restore now spreads captured `settings` as top-level PATCH fields on the `deviceConfigurations` endpoint (not nested under `settings`, which does not exist on that resource)
- Endpoint Security policies — `settings` is a navigation property on `configurationPolicies` and cannot be PATCHed in the root body; restore now uses a two-step approach: PATCH the policy metadata, then PATCH each setting individually via `/configurationPolicies/{id}/settings/{settingId}`

### Custom Collectors

- Define read-only monitoring areas from any Microsoft Graph list endpoint via a three-step wizard
- Auto-detected field types; per-field label editing; per-tenant deployment toggle
- Participate in the same pull, drift, baseline, and history flows as built-in areas

### Reporting

- HTML tenant reports — Executive Summary, Drift History, Remediation Log, Baseline Coverage, Current Configuration State, Technical Appendix
- Always light mode — clean, professional, print-ready for all reports
- Word (.docx) export — fully structured with proper headings, formatted tables with alternating row shading, MSSP branding throughout, per-page footer with company name
- PDF export via browser print-to-PDF from the in-app viewer
- Report scheduling — weekly or monthly automated generation stored with unread indicator
- MSSP commentary fields per section — label reads `"<CompanyName> Commentary"` when company name is set in MSSP Settings
- MSSP branding applied correctly — `getMsspBranding()` queries `WHERE id = 'singleton'`; company name, tagline, and accent colour appear on report cover pages, section headings, commentary labels, and footers

### Webhook notifications

- `webhook_destinations` table — per-destination URL, label, scope, fire mode, enabled state
- Fire modes: `first` (fires once per area per incident) or `every` (fires on every confirming sync)
- JSON payload with event, timestamp, tenant, area, drift count and properties
- Test endpoint — sends clearly labelled test payload without affecting fired state

### Permission system

- `buildAreaPermissionMap` — ReadWrite→Read implication covers all three permission name patterns: `.ReadWrite.` middle, `ReadWrite` compound, `.ReadWrite` suffix
- `POST /api/tenants/:id/refresh-permissions` — live Graph re-check that persists result to `permissions_json` and unlocks newly consented areas immediately
- Client-side permission re-evaluation in `Dashboard.jsx` — stale cached `permissions_json` corrected on load using the same implication logic
- **Permission Sync** button in Settings panel (⚙ → App Registration section) — triggers live refresh and updates area cards without page reload

### Credential rotation

- `PATCH /api/tenants/:id/credentials` — validates new secret against Graph before saving
- Evicts cached MSAL client on success; clears `last_sync_error`
- Accessible from Settings panel (⚙ → App Registration → Update Secret) at any time

### Auth failure banner

- Classifies errors: `auth` (401 — expired/revoked secret) shown as dashboard-level banner; 403 per-area permission errors shown as area Locked badge; network errors logged only
- Banner clears automatically on next successful sync

### Settings panel — two-section layout

- **⚙ → Drift Settings**: automatic drift checks toggle, interval input with quick presets (15m / 30m / 1h / 2h / 6h), Save/Cancel
- **⚙ → App Registration**: Update Secret (credential rotation), Sync Permissions (live permission re-check)
- Re-check Permissions removed from the dashboard header bar — consolidated into the Settings panel

### Portfolio Overview

- Scorecard view — per-tenant card with coverage bar, area status pills grouped by product
- Matrix view — compact table with one column per area, colour-coded by product group
- Tenant search, status filter, tag filter, and sort (drift count / A–Z / Z–A / recently synced) — all persisted to localStorage

### Sidebar

- Areas grouped under Microsoft Entra ID (6 areas) and Microsoft Intune (9 areas)
- Per-tenant favourites, collapsible groups, MSSP section
- Company name and tagline shown in sidebar header when set in MSSP Settings ("Powered by TrustM365" as subtitle)
- Logo renders in sidebar header when uploaded

### MSSP Settings

- Company name, tagline, logo, brand hue (dashboard accent colour)
- Report accent colour — independent of dashboard colour
- Default baseline label template with `{date}` placeholder
- Timezone — IANA timezone select; applied to report scheduler cron and all report timestamps; takes effect immediately on save

### White-labelling

- Company name drives report title, footer, and commentary label throughout
- Logo renders in sidebar header and on report cover pages
- Brand hue applies a full colour scale to the dashboard

### Security Templates (Security Checks)

- 13 checks across 5 groups referencing Zero Trust Assessment identifiers
- MFA, Authentication Methods, Guest & External Access, Admin Account Protection, CA Hygiene
- Per-tenant selection, read-only results, graceful unavailable handling

### Dashboard

- Per-tenant drift check interval (5 min – 24 hr) with quick presets
- Auto-Restore overview panel with per-area toggles and Enable All / Disable All
- Area group drag-and-drop reordering and collapse state, persisted to localStorage

### Deployment

- `npm start` → `node backend/src/index.js` (Azure App Service entry point)
- `npm run build` → builds frontend dist (Azure CI step)
- Express serves `frontend/dist/` with SPA catch-all in `NODE_ENV=production`
- Docker Compose with nginx frontend, healthcheck, named volume for SQLite
- `/api/health` endpoint — DB sanity check; used by Docker HEALTHCHECK and `service_healthy`
- GitHub Actions workflow — installs, runs tests, builds frontend, zips artefact, sets Azure startup command, deploys

### Unit tests — 53 passing

- `test/drift.test.js` — 10 tests: drift engine (properties mode, snapshot mode, none mode, missing resources)
- `test/assembler.test.js` — 28 tests: effectiveStatus, deduplication, outstanding computation
- `test/restore.test.js` — 15 tests: buildRestorePayload, monitor-only field handling, webhook fire-mode logic

### Permissions

- `AuditLog.Read.All` required for Tenant Insights MFA registration and authentication methods panels (replaces `Reports.Read.All`)
- `DeviceManagementServiceConfig.Read.All` / `ReadWrite.All` required for Mobile Threat Defense connector areas
- `DeviceManagementApps.Read.All` required for App Protection Policies (MAM)
- All ReadWrite permissions imply the corresponding Read — `buildAreaPermissionMap` handles this automatically

### Documentation

- `README.md` — full feature inventory, all 15 resource areas, complete permissions tables, architecture diagram
- `docs/prerequisites.md` — correct permissions for all areas including MTD `ServiceConfig` and `AuditLog.Read.All` for Tenant Insights
- `docs/deployment.md` — local, Azure App Service, Docker Compose; `TZ` timezone env var documented for all three deployment types
- `docs/guides/` — 18 step-by-step feature guides, all updated to reflect current feature set

---

## Roadmap

### v1.2 — Access Control

- [ ] Azure AD SSO login for the dashboard
- [ ] Role-based access — read-only vs restore permissions per user
- [ ] Multi-user audit trail

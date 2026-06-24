# Usage Guide

> **Before using TrustM365:** Complete the [App Registration](prerequisites.md) and [deploy TrustM365](deployment.md) first.

---

## Overview

TrustM365 follows a three-step workflow for each tenant:

```
1. Pull live config  →  2. Set Baseline  →  3. Monitor for drift
        ↑                                             |
        └──────────────── Restore ───────────────────┘
```

---

## The Homepage — Portfolio Overview

When you open TrustM365, the homepage shows all registered tenants at a glance.

Tenants are grouped into three sections:

| Section | Meaning |
|---|---|
| **Drift Detected** | One or more areas have drifted from their baseline |
| **Healthy** | All monitored areas match the baseline — no drift |
| **Not Yet Monitored** | Tenant registered but no baselines set or no sync run |

Drifted tenant cards show only the specific areas that are drifting, each as a clickable button that takes you directly to that area's Configuration view. Healthy tenant cards show a single clean indicator — no noise.

Cards are centred and scale automatically from 1 to 3 per row depending on how many tenants you have.

---

## Registering a Tenant

Click **Add Tenant** in the left sidebar. The wizard has three steps:

**Step 1 — App Registration guide**
Six numbered steps walk you through creating the App Registration and client secret in Entra ID. If you've already done this, skip ahead.

**Step 2 — Enter credentials**
Fill in:
- **Display Name** — a friendly label, e.g. `Contoso Production`
- **Directory (Tenant) ID** — from your App Registration Overview page
- **Application (Client) ID** — from your App Registration Overview page
- **Client Secret Value** — the value you copied when creating the secret

Click **Validate & Check Permissions**. TrustM365 validates your credentials and checks which Graph API permissions are actually granted.

**Step 3 — Permission results**
Each resource area is shown with one of:

| Badge | Meaning |
|---|---|
| **Full access** | Read + write permissions granted — monitoring and restore available |
| **Read only** | Read permissions granted — monitoring active, restore buttons hidden |
| **Locked** | Required read permission missing — area will not be monitored |
| **Licence required** | Permissions granted but the licence is not available on this tenant |

For collectors that are intentionally monitor-only, the tenant screens now explicitly show:
- `Read` badges with required read permissions
- `ReadWrite: Not available for this collector`

This makes it clear that no Graph ReadWrite permission exists for that collector, rather than a consent gap.

You can register with any combination. Permissions can be added at any time — TrustM365 re-checks on every sync.

---

## The Dashboard

Clicking a tenant in the sidebar opens its dashboard. Resource areas are grouped under **Microsoft Entra ID** and **Microsoft Intune**, each collapsible.

Each area card shows status (Clean / Drifted / No Baseline / Locked), drift count, and last checked time.

**Syncing a tenant:** Click **Sync All** in the dashboard header. All areas sync concurrently — you will see spinners per area as they complete. Areas unavailable on the tenant's licence tier (e.g. Intune on a tenant without Intune) stop their spinner automatically without raising an error.

**Sync individual area:** Click **Pull Live Data** inside any Area View.

---

## Tenant Overview

The dashboard shows three summary tiles immediately below the header:

| Tile | Shows |
|---|---|
| **Groups** | Total groups with breakdown: Security, Microsoft 365, Dynamic |
| **App Registrations** | Total apps with credential health: valid, expiring within 30 days, expired |
| **Devices** | Total with breakdown: AAD Joined, Registered, Hybrid Joined, OS breakdown |

A red banner appears when any App Registration credential has expired. A yellow banner appears when one is within 30 days of expiry.

---

## Tenant Insights

Below the Tenant Overview tiles, the **Tenant Insights** panel shows Graph-based security metrics:

| Panel | Shows |
|---|---|
| **MFA Registration** | % of users registered for MFA, count not registered, passwordless-capable |
| **Authentication Methods** | Method breakdown (Authenticator, FIDO2, Windows Hello, SMS, Voice) with phishable method warnings |
| **Users & Guests** | Member vs guest vs disabled ratio with high-guest-ratio warning |
| **Devices** | Compliance donut, managed vs unmanaged, OS breakdown |

Insights are fetched on demand. Click **Refresh** to pull updated data. If a panel shows "Requires additional Graph permissions", the App Registration is missing `AuditLog.Read.All` — see [prerequisites.md](prerequisites.md). The MFA and Authentication Methods panels also require a Microsoft Entra ID P1 or P2 licence on the tenant.

---

## Sidebar Navigation

The left sidebar organises areas per tenant into two collapsible groups:

- **Microsoft Entra ID** — Role Assignments, Users, Groups, Apps, Auth Policies, Conditional Access
- **Microsoft Intune** — Compliance Policies, Config Profiles, Windows Update Rings, MTD Connectors, App Protection Policies, Endpoint Security (Antivirus, Firewall, Disk Encryption, ASR)

**Favourites:** Hover over any area name to reveal a ⭐ star icon. Click it to pin that area to a **Favourites** section above the groups for quick access. Favourites are per-tenant and stored locally in your browser.

The **MSSP** section at the top of the sidebar contains:
- Portfolio Overview
- Security Templates
- MSSP Settings
- Custom Collectors

---

## Setting a Baseline

A baseline is your declaration of the correct, intended configuration for a resource area.

### Opening the Baseline Editor

Click **Manage** on an area card, then **Set Baseline** (or **Edit Baseline** if one exists).

### Resource inclusion

When opening the editor for the first time, all resources start in **Not in Baseline**. Add individual resources with the **+ Include** button, or click **Select All** to include everything at once. **Deselect All** removes everything.

Resources in the baseline appear in the "In Baseline" section. Resources outside it appear in a collapsed "Not in Baseline" section and are never monitored.

### Monitoring mode

Expand any included resource to choose how it is monitored:

| Mode | Behaviour |
|---|---|
| **Properties** | Monitor specific named fields only. Select which fields to watch — only those fields trigger drift. |
| **Snapshot** | Hash the entire resource. Any field change triggers drift. |
| **Remove** | Moves the resource back to "Not in Baseline". |

In Properties mode, tick the fields you want to watch. Field labels are shown alongside the field path.

Note: The Area View header no longer displays a per-collector "Fields captured" list. To discover or select fields to monitor, use the Baseline Editor (Edit Baseline) or, for custom collectors, run a Test Pull in Custom Collectors.

### Baseline Active / No Baseline

The area view header shows a clear status badge:
- 🟢 **Baseline Active** — a baseline exists and drift detection is running
- 🟡 **No Baseline** — live data has been pulled but no baseline has been set yet

### Resource groups

Organise included resources into named, colour-coded groups within an area. Groups appear as collapsible sections in the Area View with their own drift count.

### Saving

Click **Save Baseline**. A label field lets you name each version (e.g. `Production Baseline — March 2026`). The previous version is automatically archived.

---

## Detecting Drift

Every sync compares live configuration against the saved baseline.

### Drift states

| State | Meaning | Description |
|---|---|---|
| **Drifted** | 🔴 | One or more monitored properties differ from the baseline value |
| **Clean** | ✅ | All monitored properties exactly match the baseline |
| **Missing** | 🟠 | The resource was in the baseline but no longer exists in the tenant |

When all resources are clean after a sync, the Configuration tab shows a green **All clean** banner rather than the count tiles.

### Viewing drift

Click **Manage** on a drifted area card. The Configuration tab shows drifted resources expanded with a side-by-side diff:

```
Policy State
  Baseline (desired)   →   Live (current)
  "enabled"                "disabled"          [Fix]
```

Each drifted property has a **Fix** button to restore just that property.

Tip: When a resource has many nested arrays or JSON fields, use the **Expand all** control in the open resource panel to open every collapsible value for easier inspection. This expands arrays/objects in the UI (display-only) and does not change any stored baseline values.

---

## Restoring to Baseline

> **Restore requires write permissions.** If only read permissions are granted, restore buttons are hidden and a Read-only banner appears. See [prerequisites.md](prerequisites.md).

> **Some built-in collectors are read-only by design.** In that case, the Area/Dashboard permission badges show `ReadWrite: Not available for this collector`.

> **Custom collectors are always read-only** — restore is never available for user-defined areas.

| Action | How |
|---|---|
| Restore a single property | Click **Fix** next to the drifted property row |
| Restore a full resource | Click **Restore** on the resource card header |
| Restore all drifted resources | Click **Restore All (N)** in the area header |
| Auto-restore on sync | Toggle **Auto-Restore** in the area settings |

After any restore, TrustM365 automatically re-syncs the area and updates the drift status.

### Auto-Restore

When enabled per area, any drift detected during a sync is immediately reverted without manual intervention. Use with care — it reverts any change, including intentional ones, unless the baseline is updated first.

---

## Restore Audit Log

Click the **Log** tab in any Area View to see the full restore history for that area. Each entry shows:

- **Status** — OK or FAIL
- **Type** — Property, Full restore, Bulk restore, or Auto-restore
- **Resource name** — the human-readable name, not just the ID
- **Properties restored** — chip list of every field that was patched
- **Error detail** — shown inline when a restore failed, with the exact Graph API error

---

## Baseline Version History

Click the **Baseline History** tab in any Area View to browse all archived versions. Each entry shows the label, archive timestamp, resource count, and monitoring mode per resource.

Click **Restore** on any archived version to make it the active baseline. The current baseline is archived first.

Click **Delete Baseline** in the Baseline Editor header to remove the active baseline. It is archived before deletion — monitoring stops cleanly.

---

## Security Checks — Reference Sets (Security Templates)

Navigate to **Reference Sets** (Security Templates) in the MSSP sidebar. Reference Sets are curated JSON reference templates (for example, Zero Trust Assessment V2 and community contributions) stored in `backend/data/reference-templates` and evaluated in a read-only, assessment-only view.

Security checks run independently of tenant baselines and do not modify any configuration.

> **Note:** As of v1.1, Security Templates support only single-tenant selection. Multi-tenant selection is no longer available.

### Running checks

1. Select a tenant to assess.
2. Choose a specific owner or leave the owner as **All** to include all available reference sets.
3. Click **Run Reference Checks**. Results are returned for the selected tenant and summarized in the UI.

Key notes:
- The Security Templates view aggregates available owners and excludes the `openintune` owner/templates from this view by default.
- Use **Reload sets** to refresh templates from disk (backend reload endpoint).
- The owner summary cards show Matched / Not matched / Total counts for the tenant you selected. Hover the info icon for details.
- Use the **Export failing (CSV)** or **Export failing (JSON)** buttons to download failing reference items. Exports use current results from **Run Reference Checks** or the aggregated owner summary and do not perform live checks themselves.

| Group | Checks |
|---|---|
| Multi-Factor Authentication | MFA for all users · MFA for admins · Legacy auth blocked |
| Authentication Methods | SMS disabled · Voice disabled · Phishing-resistant method enabled |
| Guest & External Access | Guest invites restricted · MFA required for guests |
| Admin Account Protection | Compliant device required for admins · Global Admin count |
| Conditional Access Hygiene | No report-only policies · No permanently disabled policies |

Results reference owner identifiers for traceability. Checks that require missing permissions show as **Unavailable** rather than failing.

---

## Custom Collectors

Navigate to **Custom Collectors** in the MSSP sidebar section to define your own read-only monitoring areas using any Microsoft Graph endpoint.

> Custom collectors support pull and drift detection only. Restore is never available.

### Creating a custom collector

The wizard has three steps:

**Step 1 — Define**
Enter a display name, optional description, Graph API endpoint path (e.g. `/identity/conditionalAccess/namedLocations`), and optional `$select` fields. Use [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer) to find and test endpoints.

Advanced options let you override which field is used as the resource ID and display name if the endpoint doesn't use the standard `id` / `displayName` fields.

**Step 2 — Test Pull**
Choose a tenant and click **Run Test Pull**. TrustM365 calls the endpoint live, shows the result count, and displays a collapsible sample of the first resource's JSON. Only proceeds if the pull succeeds.

**Step 3 — Configure Fields**
All fields discovered from the live response are shown as a checklist with auto-detected types (boolean, number, array, json, string). Tick the fields to monitor. Labels are editable inline before saving.

### Deploying to tenants

Custom collectors are **not active on any tenant by default**. Expand a collector card and toggle each tenant individually. Only tenants you explicitly enable will see and sync the custom area.

Disabling a tenant removes it from that tenant's dashboard and deletes all associated baselines and drift history for that tenant. The collector definition and other tenants' data are untouched.

Deleting the collector entirely removes it from all tenants.

---

## Multi-Tenant Portfolio

Navigate to **Portfolio Overview** (MSSP section) to see all tenants at a glance with drift status.

**Drift export:** Click **CSV** or **JSON** to download a full drift report across all tenants.

**Bulk sync:** Click **Sync All Tenants** to refresh all tenants in parallel. A progress bar tracks completion.

---

## Scheduled Drift Checks

Set an interval in `.env` (local/Docker) or in App Service application settings (Azure):

```env
DRIFT_CHECK_INTERVAL_MINUTES=60
```

`0` disables automatic checks. Any positive integer sets the interval in minutes. Restart TrustM365 after changing this value.

---

## Backup and Restore

```bash
# Local
npm run db:backup

# Docker
docker compose exec backend node scripts/backup.js
```

Creates a timestamped copy in `data/backups/`. Includes all encrypted credentials, baselines, drift history, custom collector definitions, and audit logs.

To restore from backup: stop TrustM365, replace the database file at `DATABASE_PATH` with the backup, and restart.

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Authentication failed on register | Wrong credentials or trailing spaces | Re-copy each value fresh from Entra |
| 403 on sync after registration | Consent not fully propagated | Wait 5 minutes after granting consent and retry |
| Area shows Locked after sync | Read permission missing | Add the permission in Entra → grant consent → re-sync |
| Restore button not visible | Write permissions not granted | Add `ReadWrite` permissions in Entra → grant consent → re-sync |
| Restore returns 403 | Write permission missing for that area | Check [prerequisites.md](prerequisites.md) restore permissions table |
| Intune areas spin indefinitely | No Intune licence on this tenant | Expected — areas resolve to "Licence required" and stop automatically |
| Custom collector returns empty | Endpoint path incorrect or no data | Verify in Graph Explorer with the same App Registration |
| Custom collector returns 403 | Permission not granted | Add the required permission and grant admin consent |
| Drift shows Clean despite known change | That property is not included in the baseline | Edit Baseline → include the property → re-sync |
| Snapshot drift on every sync | Volatile timestamp fields included | Switch to Properties mode and select only stable fields |
| Tenant Insights shows "unavailable" | `AuditLog.Read.All` not granted, or tenant lacks Entra ID P1/P2 | Add `AuditLog.Read.All` to the App Registration, grant consent, and confirm the tenant has Entra ID P1/P2 |

---

## Dashboard Settings

### Per-Tenant Drift Check Interval

Click the **⚙ Settings** button in the top-right of the tenant dashboard to configure automatic drift checks for that tenant.

| Setting | Description |
|---|---|
| **Automatic drift checks** | Toggle to enable or disable scheduled checks for this tenant independently of the global `DRIFT_CHECK_INTERVAL_MINUTES` setting |
| **Check interval** | How often to run drift checks, in minutes. Minimum 5 min, maximum 1440 min (24 hrs). Quick presets: 15m, 30m, 1h, 2h, 6h |

When auto-check is disabled for a tenant, the global interval still applies if `DRIFT_CHECK_INTERVAL_MINUTES` is set in your environment. When a per-tenant interval is set and enabled, the engine checks whether enough time has passed since the last sync before running — short global intervals will not cause over-polling if the per-tenant interval is longer.

Settings are saved to the database and apply immediately. They persist across restarts and are deployment-agnostic.

### Auto-Restore Overview

Click the **Shield / Auto-Restore** button in the dashboard header to see the auto-restore state for all areas in one place.

- Each baselined area is listed with its current drift status and an Enabled / Disabled toggle
- **Enable All** and **Disable All** buttons apply the setting to all baselined areas in one action
- A warning banner reminds you that auto-restore reverts changes silently — update your baseline before enabling

> Auto-restore reverts any detected drift, including intentional changes made directly in M365. Always update the baseline first if you have made a deliberate configuration change.

### Group Order and Collapse State

Area groups on the dashboard (Microsoft Entra ID and Microsoft Intune) can be reordered and collapsed. Both preferences are saved to your browser and persist across page reloads.

- **Reorder groups:** Click and drag the ⠿ grip icon on any group header to drag it above or below other groups
- **Collapse/expand:** Click anywhere on the group header to toggle it collapsed
- **Reset order:** A "Reset order" link appears above the groups when a custom order is active — click it to restore the default ordering

Preferences are stored in `localStorage` and are per-browser. They survive server restarts, container rebuilds, and Azure redeployments without any action required.

---

## MSSP Settings — Default Baseline Label

Navigate to **MSSP Settings** in the sidebar. The **Default Baseline Label** field sets a template that pre-fills the label field every time a new baseline is created.

Use `{date}` anywhere in the template to insert today's date automatically.

Examples:
- `Baseline — {date}` → `Baseline — 19 Mar 2026`
- `Gold Standard` → `Gold Standard` (static, no date)
- `Post-audit {date}` → `Post-audit 19 Mar 2026`

Leave blank to use the default label `"Baseline"`. The label is always editable before saving, regardless of the template.

---

## Portfolio — Sort and Filter Preferences

The Portfolio Overview retains your last-used filter and sort settings between sessions. When you return to the Portfolio, the same filter and sort are applied automatically.

**Filters** — click any status button (Drifted, Clean, Partial, No Baselines) or tag pill to filter the tenant list. Click **All** to clear filters.

**Sort** — click the **⇅ Sort** button at the right of the filter bar to choose from:

| Sort | Description |
|---|---|
| Most drifted first | Tenants with the highest total drift count appear at the top (default) |
| A → Z | Alphabetical by tenant display name |
| Z → A | Reverse alphabetical |
| Recently synced | Most recently synced tenants appear first |

Sort and filter preferences are saved to `localStorage` and are per-browser, deployment-agnostic.

---

## Credential Rotation

When an App Registration client secret expires, a red banner appears on the tenant dashboard describing the failure. Click **Update Secret** in the banner to expand an inline rotation form, or click **⚙ Settings** at the top of any tenant dashboard to access the **Client Secret** section at any time — proactive rotation before expiry is recommended.

TrustM365 validates the new secret against Microsoft Graph before saving. If validation fails, the existing secret is left unchanged. On success the MSAL cache is evicted and monitoring resumes automatically.

See [Guide 17 — Credential rotation](guides/17-credential-rotation.md) for the full step-by-step procedure.

---

## Search

**Search** is available on every detail page as a local filter:

| Page | Filter controls |
|---|---|
| Portfolio | Tenant name/ID/tag search input + status pills + sort |
| Area View | Resource name/ID search + All/Drifted/Clean toggle |
| Baseline Editor | Resource name/ID search across both In Baseline and Not in Baseline lists |
| Reports | Title search + tenant dropdown + date range |

See [Guide 08 — Search and filtering](guides/08-search-and-filtering.md) for full details.

---

## Webhook Notifications

Navigate to **MSSP Settings** → **Webhook Notifications** to configure outbound drift alerts.

Each destination has a URL, label, scope (a specific tenant or all tenants), and a fire mode:

- **First detection only** — fires once when drift is first detected for an area, not again until the area resolves to clean and drifts again. Prevents notification storms.
- **Every sync** — fires on every sync that confirms drift, regardless of previous fires.

Click the **✈ Test** button on any destination to send a labelled test payload and confirm delivery. The last fired time and any delivery errors are shown on the destination card.

For drift-specific outcomes, open the affected area and check **Configuration → Webhook Notification Status**. This panel shows attempted/sent/failed/not-sent counts and expandable per-destination reasons for the latest drift result.

Payload format is JSON — compatible with Microsoft Teams Workflows incoming webhooks, Slack, and PagerDuty out of the box.

See [Guide 12 — Webhook notifications](guides/12-webhook-notifications.md) for payload schema and integration examples.

---

## Log Analytics and Sentinel

Navigate to **MSSP Settings** -> **Log Analytics and Sentinel** to configure SIEM export.

### Configuration fields

| Field | Purpose |
|---|---|
| Enable Log Analytics export | Master switch for direct telemetry ingestion |
| Workspace ID | Target Log Analytics workspace identifier |
| Shared key | Workspace key used for Data Collector API signing |
| Table prefix | Prefix for custom tables (default `TrustM365`) |
| Schema version | Event contract version tag for downstream rules |
| Ingestion categories | Per-category cost controls |

### Ingestion categories

- Drift lifecycle
- Remediation and restore outcomes
- Job and scheduler health
- Webhook delivery outcomes
- API request logs (high volume)

Use **Test Connection** before saving to confirm ingestion credentials and routing.

### Resulting tables

With default prefix, records land in:

- `TrustM365Drift_CL`
- `TrustM365Restore_CL`
- `TrustM365Jobs_CL`
- `TrustM365Webhooks_CL`
- `TrustM365Api_CL`

### Sentinel onboarding

1. Validate assets with `npm run sentinel:validate`.
2. Deploy analytic rules with `npm run sentinel:deploy -- -SubscriptionId <subId> -ResourceGroup <rg> -WorkspaceName <workspace> -TablePrefix TrustM365`.
3. Import workbook JSON from `data/sentinel/workbooks/TrustM365-Drift-Monthly.workbook.json`.
4. Trigger drift events in TrustM365 and verify incidents/workbook data in Sentinel.

See [Guide 21 — Log Analytics and Sentinel](guides/21-log-analytics-and-sentinel.md), [Guide 22 — Sentinel content pack operations](guides/22-sentinel-content-pack-operations.md), and [Sentinel integration reference](integrations/sentinel-log-analytics.md) for details.

---

## Generating Reports

Click **Report** on any tenant dashboard, or navigate to **Reports** in the sidebar.

The report modal shows a split view: section tabs on the left, live data preview in the centre, and MSSP commentary fields on the right. Commentary is optional — each section has its own text area. The commentary label in the generated report reads **"[Your Company] Commentary"** when a company name is set in MSSP Settings, or **"MSSP Commentary"** by default.

**Download options from the report viewer:**

- **PDF** — opens the report in a new tab and triggers the browser's print dialog. Choose "Save as PDF" from the print destination.
- **Download Word** — generates a structured `.docx` file server-side and downloads it directly. Contains all sections as Word headings, body paragraphs, and tables.

See [Guide 10 — Generating reports](guides/10-generating-reports.md) for the full report structure.

---

## Intune Endpoint Security Areas

TrustM365 monitors four additional Intune areas using the Graph beta API — Antivirus, Firewall, Disk Encryption (BitLocker), and Attack Surface Reduction. These require `DeviceManagementConfiguration.Read.All` and an Intune + Microsoft Defender for Endpoint licence.

Two further areas are monitor-only: **App Protection Policies** (MAM — iOS/Android data transfer restrictions). These are read via the Graph v1.0 API and cannot be restored via TrustM365.

See [Guide 16 — Intune endpoint security](guides/16-intune-endpoint-security.md) for recommended monitoring modes, key drift signals, and permission requirements per area.

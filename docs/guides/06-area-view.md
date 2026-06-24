# Guide 06 — Area View

The Area View is the resource-level detail screen for a single configuration area. Navigate here by clicking **Manage** on an area card, or by clicking the area name in the sidebar.

![Area View example](./visuals/guide-area-view.png)

_Visual reference: area header actions, status badges, and resource list layout._

---

## Header

```
← TenantName / Area Name

Area Name                    [Baseline Active]  [Read only]
Area description
Last synced: 20/03/2026, 4:53 am

                            [Restore All (2)]  [Pull Live Data]  [Edit Baseline]
```

- **Last synced** — the exact timestamp of the last successful pull for this area (per-area, not tenant-wide)
- **Restore All (N)** — appears when there is drift and write permissions are granted
- **Pull Live Data** — immediately pulls fresh configuration from Graph for this area only
- **Edit Baseline** — opens the Baseline Editor
- **Edit Baseline** — opens the Baseline Editor

Note: The Area View no longer displays a per-collector "Fields captured" list in the header. To discover or select which properties are watchable for drift monitoring, open the Baseline Editor (Edit Baseline) or use the Custom Collectors Test Pull for user-defined collectors.

---

## Tabs

| Tab | Content |
|---|---|
| **Configuration** | Live diff view — baseline vs current state |
| **Restore Log** | Full history of all restore actions for this area |
| **Baseline History** | All archived baseline versions |

---

## Configuration tab

### Filter bar

When an area has more than 4 resources, a filter bar appears above the resource list:

- **Search** — filter by resource name or ID
- **Status toggle** — All / Drifted / Clean
- A result count appears when a filter is active (e.g. "3 of 47")
- **Clear** removes all active filters

### Resource display

**When baselined:**

Resources are shown in two sections — monitored resources and (collapsed) resources not in the baseline.

Drifted and missing resources appear at the top. Each drifted resource is expanded by default:

```
┌─────────────────────────────────────────────────────┐
│ 🔴 Anto Porter                    [Properties]  [Restore] │
│                                                      │
│  Baseline (desired state)  ⟷  Live (current state)  │
│                                                      │
│  displayName                                         │
│  "Anto Porter"            →    "Anto Por"      [Fix] │
│                                                      │
│  department                                          │
│  "Engineering"            →    "AAAA"          [Fix] │
└─────────────────────────────────────────────────────┘
```

Clean resources appear below drifted ones, collapsed by default.

**Before baseline:**

All live resources are listed. A yellow prompt explains how to set a baseline to begin monitoring.

### Column headers

- **Baseline (desired state)** — the value saved when you created the baseline
- **Live (current state)** — the value pulled from Microsoft 365 right now

### Fix and Restore buttons

| Button | Location | Action |
|---|---|---|
| **Fix** | Next to a drifted property | Restore that single property to its baseline value |
| **Restore** | Resource card header | Restore all drifted properties on this resource |
| **Restore All (N)** | Area header | Restore all drifted resources in this area |

All restore actions are logged immediately in the Restore Log tab and trigger an automatic re-pull of the area.

### Webhook notification status

When a drift result exists, the Configuration tab also shows a **Webhook Notification Status** panel for that specific drift check.

![Area View webhook notification status panel](./visuals/guide-area-view-webhook-status.png)

It includes:

- **Attempted / Sent / Failed / Not sent** counters
- **Last attempt** timestamp
- Expandable **per-destination outcomes** with destination label, fire mode (First only / Every drift), outcome and reason, and HTTP status/error details for failures

This panel is drift-specific and complements (not replaces) the destination-level last fired/last error fields shown in MSSP Settings.

---

## Restore Log tab

Shows every restore action for this area in reverse chronological order.

| Column | Description |
|---|---|
| Status | ✅ Restored or ❌ Failed |
| Type | Property / Full / Bulk / Auto-restore |
| Resource | Human-readable name of the affected resource |
| Properties | Each field that was patched |
| Timestamp | When the restore executed |
| Error | Graph error message when a restore fails |

Up to 50 entries are shown. The log is append-only.

---

## Baseline History tab

Lists all archived baseline versions for this area in reverse chronological order.

Each version shows:

- **Label** — the name you gave when saving
- **Saved at** — timestamp of when this version was created
- **Resources** — count of resources included in that version
- **Monitoring modes** — a breakdown of Properties vs Snapshot resources

**To restore an archived version:**

Click **Restore** on any entry. The current baseline is archived first, then the selected version becomes active. All future syncs will compare against the restored version.

**To preview an archived version:**

Expand the version to see the resources and their saved property values. This is useful for understanding what has changed between versions.

---

## Read-only areas

Some areas are read-only either by design or by permission:

| Reason | What you see |
|---|---|
| No write permission | Yellow "Read only" badge in the header. All restore buttons are hidden. |
| Monitor-only collector (e.g. App Protection Policies) | "Monitor only" indicator. Restore is not possible. |
| Custom collector | "Custom · Read-Only" badge. Restore is not available for custom areas. |

---

## Locked areas

If a required read permission is missing, the area shows a **Locked** overlay with the specific permission name that needs to be added. Navigate to Entra ID → API permissions, add the permission, grant admin consent, and re-sync.

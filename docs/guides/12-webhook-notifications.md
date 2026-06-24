# Guide 12 — Webhook notifications

TrustM365 can POST a JSON payload to a URL whenever drift is detected. This lets you integrate with Teams, Slack, PagerDuty, or any service that accepts an HTTP webhook.

![MSSP Settings webhook section](./visuals/guide-mssp-settings.png)

_Visual reference: webhook setup area under MSSP Settings._

---

## Setting up a webhook

Navigate to **MSSP Settings** → **Webhook Notifications** → click **+ Add**.

### Fields

| Field | Required | Description |
|---|---|---|
| **Label** | No | A friendly name, e.g. "Teams — Security Alerts" |
| **Webhook URL** | Yes | The destination URL to POST to |
| **Scope** | No | All tenants (MSSP-wide) or a specific tenant |
| **Fire mode** | Yes | First detection only, or every sync |

### Fire modes

| Mode | Behaviour | Best for |
|---|---|---|
| **First detection only** | Fires once when drift is first detected for an area. Does not fire again until the area resolves to clean and drifts again. | Preventing notification storms — one alert per incident |
| **Every sync** | Fires on every sync that confirms drift, regardless of previous fires | Ticketing integrations where each fire creates a new record |

---

## Testing a webhook

After saving, click the **Send test** (✈) button on the destination card. TrustM365 POSTs a clearly labelled test payload to your URL:

```json
{
  "event": "drift.test",
  "note": "This is a test delivery from TrustM365.",
  ...
}
```

The card updates with the timestamp of the last successful delivery and any error messages.

Note: MSSP Settings cards show destination-level latest status. For drift-specific delivery results, open the relevant area and check **Area View → Configuration → Webhook Notification Status**.

---

## Payload format

All drift notifications use this JSON structure:

```json
{
  "event": "drift.detected",
  "timestamp": "2026-03-20T08:00:00.000Z",
  "tenant": {
    "id": "internal-db-id",
    "displayName": "Contoso Production",
    "tenantUUID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  },
  "area": {
    "key": "entra_ca",
    "displayName": "Conditional Access Policies"
  },
  "drift": {
    "count": 2,
    "properties": [
      {
        "resourceId": "policy-id",
        "resourceName": "MFA Required — All Users",
        "path": "state",
        "label": "Policy State",
        "baselineValue": "enabled",
        "liveValue": "disabled"
      }
    ]
  },
  "platform": "TrustM365",
  "version": "1.0.0"
}
```

The `drift.properties` array contains up to 20 property-level changes. For areas with many changes, the most significant ones are included first.

---

## Integration examples

### Microsoft Teams (Workflows incoming webhook)

1. In Teams, open a channel → **...** → **Workflows** → **Post to a channel when a webhook request is received**
2. Copy the webhook URL from the workflow
3. Paste it as the webhook URL in TrustM365

TrustM365's JSON payload is compatible with the Teams Workflows webhook format directly.

### Slack

1. In Slack, go to **Apps** → search **Incoming Webhooks** → **Add to Slack**
2. Choose a channel and copy the webhook URL
3. Paste it as the webhook URL in TrustM365

### PagerDuty

1. In PagerDuty, create a new **Service** with an **Events API v2** integration
2. Copy the **Integration Key**
3. The PagerDuty Events API URL is `https://events.pagerduty.com/v2/enqueue`
4. Set the webhook URL in TrustM365 to your integration endpoint

---

## Managing destinations

| Action | How |
|---|---|
| **Disable** | Click **Disable** — webhook is paused but configuration is kept |
| **Re-enable** | Click **Enable** |
| **Delete** | Click the 🗑 button — permanently removes the destination and all fired state |

When a webhook delivery fails, the error message is shown on the destination card. The next qualifying sync will retry delivery.

---

## Drift-specific delivery visibility

In addition to destination cards in MSSP Settings, TrustM365 records delivery outcomes for each drift check and exposes them in Area View.

Open an area with drift and review **Webhook Notification Status** in the Configuration tab to see:

- aggregate counts (attempted, sent, failed, not sent)
- last attempt time
- per-destination outcome details and reasons (including skipped first-detection mode and disabled destinations)

---

## Delivery guarantees

Webhook delivery is **best-effort** — if the destination is unreachable at delivery time, the error is logged but the sync continues. TrustM365 does not queue failed deliveries for retry. Design your webhook destination to handle occasional missed events gracefully.

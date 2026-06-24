# 21 - Log Analytics and Sentinel

This guide walks through configuring TrustM365 to export telemetry to Log Analytics and consume it in Microsoft Sentinel.

## Prerequisites

- TrustM365 v1.2.0+
- Azure Log Analytics workspace
- Microsoft Sentinel enabled on that workspace
- Workspace ID and primary shared key

## Step 1: Configure TrustM365

1. Open MSSP Settings.
2. In Log Analytics and Sentinel:
   - Enable export.
   - Enter workspace ID.
   - Enter shared key.
   - Keep table prefix as TrustM365 unless you need custom naming.
   - Choose event categories.
3. Select Test Connection.
4. Save Settings.

## Step 2: Trigger test telemetry

1. Run a sync for one tenant.
2. Perform a drift check on one area.
3. Optionally run a restore action.

These actions generate initial records for Drift, Jobs, and Restore categories.

## Step 3: Validate data in Log Analytics

Run this query in Logs:

union isfuzzy=true TrustM365Drift_CL, TrustM365Jobs_CL, TrustM365Restore_CL
| where TimeGenerated > ago(1h)
| order by TimeGenerated desc

If custom prefix is used, replace TrustM365 with your prefix.

## Step 4: Deploy Sentinel analytic rules

Use PowerShell:

scripts/sentinel/deploy/deploy_content_pack.ps1 -SubscriptionId <subId> -ResourceGroup <rg> -WorkspaceName <workspace> -TablePrefix TrustM365

## Step 5: Import workbook

1. Open Sentinel Workbooks.
2. Create new workbook from JSON.
3. Paste data/sentinel/workbooks/TrustM365-Drift-Monthly.workbook.json.
4. Save to your workspace.

## Step 6: Confirm incident flow

1. Introduce a controlled drift.
2. Wait for scheduled rule evaluation.
3. Confirm incident appears in Sentinel Incidents.
4. Confirm workbook charts update.

## Cost tuning

- Disable API logs first when reducing cost.
- Keep drift + restore on for SOC signal quality.
- Tune retention by table in Log Analytics.

## Related docs

- docs/integrations/sentinel-log-analytics.md
- data/sentinel/kql/trustm365-queries.kql

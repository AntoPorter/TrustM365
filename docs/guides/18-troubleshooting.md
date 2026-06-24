# Guide 18 — Troubleshooting

This guide covers the most common problems encountered when running TrustM365, with their causes and fixes.

![TrustM365 home and navigation overview](./visuals/guide-home-overview.png)

_Visual reference: primary navigation and tenant/area entry points used during troubleshooting._

---

## Authentication and permissions

### "Authentication failed" banner on the dashboard

**Cause:** The App Registration client secret has expired, been deleted, or was entered incorrectly.

**Fix:** Click **Update Secret** in the banner. Follow [Guide 17 — Credential rotation](17-credential-rotation.md).

---

### Area shows Locked (padlock icon)

**Cause:** The App Registration is missing the read permission required for that area.

**Fix:**
1. Note the permission name shown in the locked overlay
2. In Entra ID, go to the App Registration → API permissions → Add a permission → Microsoft Graph → Application permissions
3. Search for and add the missing permission
4. Click **Grant admin consent**
5. Wait 2–5 minutes, then run **Sync All** in TrustM365

The lock clears automatically on the next sync once consent propagates.

---

### Restore button not visible

**Cause:** Write permissions (`ReadWrite` variants) are not granted, or only read permissions are granted.

**Fix:** Add the appropriate `ReadWrite` permission for the area (see the [prerequisites guide](../prerequisites.md) restore permissions table) and grant admin consent.

---

### Restore returns "Permission denied"

**Cause:** The read permission is granted but the corresponding write permission is not.

**Fix:** Add the `ReadWrite` permission in Entra → grant admin consent → re-sync.

---

### "Permission denied" error on sync after successful registration

**Cause:** Admin consent propagation can take 2–5 minutes. Syncing immediately after granting consent may fail.

**Fix:** Wait 5 minutes and run **Sync All** again. If it persists, verify that all permissions show a green ✓ **Granted** tick in Entra ID under API permissions.

---

## Sync and drift detection

### Area spins indefinitely on sync

**Cause A:** The area requires a licence the tenant does not have (e.g. Intune areas on a non-Intune tenant).
**Fix A:** Expected behaviour. The area will self-resolve to **Licence required** and stop spinning. No action needed.

**Cause B:** The backend server crashed or restarted mid-sync.
**Fix B:** Refresh the page. The spinner clears on page load. Run **Sync All** again.

---

### Drift detected for a property you expect to be stable

**Cause A:** The field updates frequently due to system activity (e.g. `lastSignInDateTime`, `lastModifiedDateTime`).
**Fix A:** Remove the field from the watched properties in the Baseline Editor. These volatile fields are automatically excluded from Snapshot mode.

**Cause B:** The configuration genuinely changed and your baseline no longer reflects the intended state.
**Fix B:** If the change was intentional, update the baseline to match the new intended state. If it was accidental, restore the value.

---

### Drift not detected when a known change was made

**Cause A:** The changed field is not in the watched properties.
**Fix A:** Edit Baseline → tick the field in Properties mode → save → re-sync.

**Cause B:** The changed resource is not included in the baseline.
**Fix B:** Edit Baseline → include the resource → save → re-sync.

**Cause C:** Auto-restore reverted the change before you saw it.
**Fix C:** Check the **Restore Log** tab in the Area View for recent auto-restore activity.

---

### Snapshot mode drifts on every sync

**Cause:** A volatile field that is not in TrustM365's built-in volatile key exclusion list is being included in the hash. Some resources include operation-specific metadata.

**Fix:** Switch from Snapshot mode to Properties mode. Select only the fields you specifically care about. Snapshot mode is best for static objects — use Properties mode for anything that has system-managed fields.

---

### "Outstanding" in reports shows a non-zero count when everything is remediated

**Cause:** Outstanding is calculated against the *current* database state, not the event log. If a drift event was recorded but the subsequent clean check was not yet synced, it may still show as outstanding.

**Fix:** Run **Sync All** on the tenant to pull fresh data. If all areas return clean, the next report will show 0 outstanding.

---

## Reports

### Report shows "2 drift events" when only 1 occurred

**Cause:** This should not happen after v1.0.0 — drift events are deduplicated per area. If you see this, you are running an older version.

**Fix:** Update to v1.0.0 or later. The assembler now deduplicates by `area_key` and counts one event per area regardless of how many syncs confirmed the drift.

---

### Current Configuration State shows "not available"

**Cause:** Groups, Apps, and Devices data comes from the Microsoft Graph overview endpoint which is fetched fresh at report generation time. A network or credential error during generation causes these panels to be empty.

**Fix:** Ensure the tenant's credentials are valid (no auth failure banner on the dashboard) and re-generate the report. The data is always fetched fresh — it does not depend on cached sync data.

---

### Report PDF is missing images or has broken layout

**Cause:** Browser print-to-PDF varies by browser.

**Fix:** Use Chrome or Edge for best results. Print to PDF using the browser's native print dialog with:
- Paper size: A4 or Letter
- Margins: None or Minimum
- Background graphics: enabled

---

## Webhook notifications

### Webhook test delivery fails

**Cause A:** The URL is unreachable from the TrustM365 server (firewall, private network, incorrect URL).
**Fix A:** Verify the URL is accessible from your TrustM365 host. Check firewall rules if running on-premises.

**Cause B:** The destination service returned a non-2xx status code.
**Fix B:** The error message on the webhook card shows the HTTP status code. Check the destination service's logs.

**Cause C:** TLS certificate validation failed.
**Fix C:** Ensure the destination URL uses a valid public certificate. Self-signed certificates are not accepted.

---

### Webhook fires too frequently

**Cause:** Fire mode is set to **Every sync** and the area is drifting on every sync.

**Fix A:** Switch fire mode to **First detection only** — fires once per area until it resolves.
**Fix B:** If the drift is legitimate noise (volatile field, snapshot mode on a dynamic resource), fix the baseline configuration so drift stops occurring.

---

### Webhook does not fire when expected

**Cause A:** Fire mode is **First detection only** and it already fired for this area — it will not fire again until the area resolves and drifts again.
**Check:** The "Last fired" timestamp on the webhook card. If it is recent, the first-detection lock is in place.

**Check (drift-specific):** In the affected area, open **Configuration → Webhook Notification Status** to confirm whether delivery was sent, failed, or intentionally not sent (for example `skipped_first_mode` or `disabled`).

**Cause B:** The webhook destination is disabled.
**Fix:** Click **Enable** on the destination card.

**Cause C:** The webhook is scoped to a specific tenant but the drift is on a different tenant.
**Fix:** Either change the scope to "All tenants" or add a separate destination for the other tenant.

---

## Custom collectors

### Test pull returns empty results

**Cause A:** The endpoint path is wrong.
**Fix A:** Test the endpoint in [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer) using the same App Registration credentials.

**Cause B:** The tenant genuinely has no resources of that type.
**Fix B:** Expected. An empty pull is valid — you can still save the collector and monitor for future resources.

---

### Custom collector returns 403

**Cause:** The endpoint requires a permission not yet granted to the App Registration.

**Fix:**
1. In Graph Explorer, check the documentation tab for the endpoint to find the required permission
2. Add it in Entra ID → API permissions → grant admin consent
3. Re-run the test pull

---

## General

### Dashboard shows stale data after sync

**Cause:** The browser is displaying cached React state.

**Fix:** Click **Sync All** again. If the dashboard does not update, perform a hard refresh (`Ctrl+Shift+R` or `Cmd+Shift+R`).

---

### TrustM365 server not starting

**Cause A:** `DATABASE_PATH` directory does not exist or is not writable.
**Fix A:** Create the directory and ensure the process user has write access.

**Cause B:** Port already in use.
**Fix B:** Change `PORT` in your `.env` file or stop the conflicting service.

**Cause C:** Missing environment variables.
**Fix C:** Copy `.env.example` to `.env` and fill in all required values. See [deployment.md](../deployment.md).

---

### "Failed to load tenants" toast on load

**Cause:** The backend API is not reachable from the frontend.

**Fix:** Verify the backend is running (`node src/index.js` or `docker compose ps`). Check that `VITE_API_URL` in the frontend `.env` points to the correct backend address.

---

### Azure App Service — frontend shows a blank page or 404

**Cause:** The frontend has not been built. Azure App Service serves the React app via Express's static middleware in production — `frontend/dist/` must exist.

**Fix:** Run `npm run build` from the repo root. This compiles the React app into `frontend/dist/`. Redeploy after building.

---

### Azure App Service — app starts but API calls return 404

**Cause:** The startup command is not set correctly, or the app is starting from the wrong working directory.

**Fix:** In the Azure Portal, go to **App Service → Configuration → General settings** and set **Startup Command** to `cd backend && npm install && node src/index.js`.

---

### Docker — containers stay "unhealthy" indefinitely

**Cause:** The `/api/health` endpoint is unreachable, usually because the `DATABASE_PATH` directory is not writable by the container user.

**Fix:** Ensure `DATABASE_PATH=/data/trustm365.db` and the named volume is correctly mounted. Check `docker compose logs backend` for the specific error. The health endpoint performs a quick DB read — any DB initialisation error will cause it to fail.

---

### Word (.docx) download fails or produces a blank file

**Cause A:** A report section contains data that causes the docx renderer to throw during generation.
**Fix A:** Check the backend logs for the specific error. The route is `GET /api/reports/:id/docx` — errors are logged with the report ID.

**Cause B:** The `docx` npm package was not installed (e.g. `npm ci --omit=dev` was run incorrectly).
**Fix B:** `docx` is listed as a production dependency, not a dev dependency. Run `cd backend && npm ci` (without `--omit=dev`) to ensure it is installed.

---

### Frontend crashes or goes blank after typing in a filter

**Cause:** The frontend build is stale or the development server needs a restart.

**Fix:** Stop the dev server and run `npm run dev` again from the repo root. If running a production build, run `npm run build` then redeploy.

---

## Getting further help

1. Check the backend logs (`npm run dev` shows pino-formatted logs in the terminal)
2. Search [GitHub Issues](https://github.com/AntoPorter/trustm365/issues) for your error message
3. Open a new issue with your TrustM365 version, Node.js version, and the relevant log output

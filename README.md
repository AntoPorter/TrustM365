<p align="center">
  <img src="docs/assets/trustm365-banner.png" alt="TrustM365 — Monitor. Baseline. Restore." width="800" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%20LTS-green.svg" alt="Node.js 20 LTS"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://github.com/AntoPorter/trustm365/releases"><img src="https://img.shields.io/badge/version-1.2.0-blue.svg" alt="Version 1.2.0"></a>
</p>

---

TrustM365 is a **free, self-hosted** dashboard for Microsoft 365 administrators and MSSPs. Connect it to one or more M365 tenants, define a gold-standard baseline of critical configuration, and know the instant something drifts — with a full property-level diff, one-click restore, and a complete audit trail.

> **"Is my tenant still configured the way I intended?"**
> TrustM365 gives you a permanent, visual answer.

---

## What it does

Most M365 drift goes undetected. A Conditional Access policy gets quietly disabled. A guest invite setting gets broadened. An admin role gets assigned to the wrong account. TrustM365 is the safety net that catches those changes before they become incidents.

- **Pull** your live M365 configuration via the Microsoft Graph API
- **Baseline** it — choose exactly which resources and properties to monitor
- **Detect drift** automatically on every sync — property-level, not just "something changed"
- **Restore** with one click — push baseline values back to Graph per property, per resource, or all at once
- **Report** — generate branded PDF and Word reports for client delivery or internal audit
- **Alert** — push drift notifications to Teams, Slack, PagerDuty, or any webhook endpoint
- **Audit** every change — full restore log with before/after values and timestamps

---

## Features

### Baseline & Drift Detection

- **Selective monitoring** — include only the resources that matter; everything else sits in "Not in Baseline" and is ignored
- **Two monitoring modes per resource:**
  - **Properties mode** — monitor specific named fields. Only changes to those fields raise a drift alert
  - **Snapshot mode** — hash the entire resource. Any field change triggers drift
- **Property-level diff** — see exactly which field changed, from what value to what, side by side
- **Three drift states:** Drifted, Clean, Missing (resource no longer exists in tenant)
- **Baseline Active / No Baseline indicator** — clearly visible status badge on every area view
- **Per-area last-synced timestamp** — each area shows its own last pull time independently
- **Auto-restore** — toggle per area to automatically revert drift on the next sync
- **Bulk restore** — restore all drifted resources in an area with one button
- **Resource groups** — organise monitored resources into named, colour-coded groups within an area
- **Baseline version history** — every save archives the previous version; restore any archived version at any time
- **Select All / Deselect All** — bulk include or exclude all resources when setting a baseline
- **Resource search** — filter by name or ID within any area

### Tenant Management

- **Flexible App Registration model** — use dedicated per-tenant credentials or shared app registrations with tenant bindings, all stored encrypted with AES-256-GCM
- **Live permission checks** — permissions re-verified on every sync; area access badges update automatically
- **Permission Sync** — on-demand re-check of all App Registration permissions from Graph; unlocks newly consented areas immediately. Accessible from ⚙ → App Registration section
- **Credential rotation** — update an App Registration secret without losing any data. Validates the new secret before saving. Accessible from ⚙ → App Registration section at any time
- **Auth failure banner** — specific, plain-English error messages for expired secrets, missing permissions, and network failures — clears automatically on the next successful sync
- **Tenant Overview panel** — users, groups, devices, app registrations at a glance
- **Tenant Insights** — Graph-based security metrics including MFA registration rate, authentication method breakdown, guest ratio, and device compliance
- **Per-tenant notes and tags** — annotate tenants for easy identification in an MSSP context

### MSSP & Multi-Tenant

- **Portfolio Overview** — all tenants in Scorecard and Matrix views with cross-tenant drift visibility
- **Bulk sync** — refresh all tenants in parallel with one button
- **Cross-tenant drift export** — CSV and JSON reports across all tenants and areas
- **Webhook notifications** — push JSON drift alerts to any HTTP endpoint on first detection or every sync. Compatible with Teams, Slack, and PagerDuty out of the box
- **Security Templates (Security Checks)** — Zero Trust Assessment V2 security checks as a read-only assessment layer. **Now supports single-tenant selection only.**
- **Reference Templates** — policy-scoped comparisons with aggregated owner summaries. **Multi-tenant compare and async compare jobs have been removed in v1.1; all compare operations are now single-tenant only.**
- **MSSP Settings** — organisation name, tagline, logo, brand colour, report accent colour
- **Log Analytics export** — direct ingestion to custom tables with per-category controls (drift, restore, jobs, webhooks, API logs)
- **Sentinel content pack** — prebuilt KQL queries, analytic rule templates, and workbook JSON for SOC operations
- **White-labelling** — all generated reports carry your company name and branding; commentary label reads "YourCompany Commentary"

### Reporting

- **Tenant reports** — full HTML report with Executive Summary, Drift History, Remediation Log, Baseline Coverage, Current Configuration State, and Technical Appendix
- **Always light mode** — all reports use a professional light colour scheme suitable for printing, PDF, and formal client delivery
- **Download as PDF** — browser print-to-PDF via the in-app viewer
- **Download as Word (.docx)** — fully structured Word document with tables, formatted headings, MSSP branding, and a per-page footer
- **MSSP commentary** — add plain-English context to any section before generating; commentary label carries your company name
- **Report filtering** — filter by tenant, date range, or report type
- **Baseline Export** — report on your current baseline configuration, useful for audit proof, project documentation, or just peace of mind.

### Restore & Audit

- **Single property restore** — patch exactly one property back to its baseline value
- **Full resource restore** — restore all monitored properties for a resource in one operation
- **Bulk restore** — loop through all drifted resources in an area sequentially
- **Auto-restore** — trigger on sync automatically when enabled
- **Rich restore log** — every action logged with resource name, restore type (Property / Full / Bulk / Auto), properties restored, and error detail on failure

---

## Supported Resource Areas

### Microsoft Entra ID

| Area | Monitors | Restores |
|---|:---:|:---:|
| Directory Role Assignments | ✅ | ✅ |
| User Accounts | ✅ | ✅ |
| Groups | ✅ | ✅ |
| App Registrations | ✅ | ✅ |
| Authentication Policies | ✅ | ✅ |
| Conditional Access Policies | ✅ | ✅ |

### Microsoft Intune — Policy Management (requires Intune licence)

| Area | Monitors | Restores |
|---|:---:|:---:|
| Device Compliance Policies | ✅ | ✅ |
| Device Configuration Profiles | ✅ | ✅ |
| Windows Update Rings | ✅ | ✅ |
| Mobile Threat Defense Connectors | ✅ | ✅ |
| App Protection Policies (MAM) | ✅ | — Monitor only |

### Microsoft Intune — Endpoint Security (requires Intune + Defender for Endpoint)

| Area | Monitors | Restores |
|---|:---:|:---:|
| Endpoint Security — Antivirus | ✅ | ✅ |
| Endpoint Security — Firewall | ✅ | ✅ |
| Endpoint Security — Disk Encryption (BitLocker) | ✅ | ✅ |
| Endpoint Security — Attack Surface Reduction | ✅ | ✅ |

### SharePoint

| Area | Monitors | Restores |
|---|:---:|:---:|
| SharePoint Sites | ✅ | ✅ |
| Tenant Security Settings | ✅ | ✅ |

### Exchange Online

| Area | Monitors | Restores |
|---|:---:|:---:|
| Mailboxes | ✅ | — Monitor only |
| Mailbox Security Settings | ✅ | ✅ |
| Mail Flow Connectors | ✅ | — Monitor only |
| Transport Rules | ✅ | — Monitor only |

### Microsoft Teams

| Area | Monitors | Restores |
|---|:---:|:---:|
| Messaging Policies | ✅ | ✅ |
| Meeting Policies | ✅ | ✅ |
| Team Membership | ✅ | ✅ |
| App Permission Policies | ✅ | — Monitor only |
| Channels Policies | ✅ | — Monitor only |
| Org App Settings | ✅ | ✅ |

> Licence-gated areas show as **Licence required** rather than erroring. TrustM365 detects available features automatically on first sync.

> **Custom Collectors** — monitor any additional Microsoft Graph endpoint using the Custom Collectors wizard.

---

## Security Templates — Security Checks

The Security Templates section provides a **read-only security assessment** layer based on the Zero Trust Assessment V2 guidance. It runs independently of tenant baselines and does not modify any configuration.

v1.1 updates: Security Templates and Reference Templates now support only single-tenant selection. Multi-tenant compare and async compare jobs are no longer available.

| Group | Checks |
|---|---|
| Multi-Factor Authentication | MFA required for all users · MFA for privileged roles · Legacy auth blocked |
| Authentication Methods | SMS disabled · Voice call disabled · Phishing-resistant method enabled |
| Guest & External Access | Guest invitations restricted to admins · MFA required for guests |
| Admin Account Protection | Admins required to use compliant devices · Global Admin count within range |
| Conditional Access Hygiene | No policies in report-only mode · No permanently disabled policies |

---

## Architecture

```
trustm365/
├── frontend/               React 18 + Vite + Tailwind CSS
│   └── src/
│       ├── pages/          Dashboard, AreaView, BaselineEditor, Portfolio,
│       │                   Reports, Templates, MsspSettings, CustomCollectors…
│       └── components/     Sidebar, TenantOverview, TenantInsights,
│                           GenerateReportModal
├── backend/
│   ├── collectors/         Graph API pullers — 15 built-in areas + custom collectors
│   ├── engine/
│   │   ├── drift.js        Property-level deep diff + hash-based snapshot engine
│   │   ├── sync.js         Pull, re-check permissions, compute drift, fire webhooks
│   │   ├── restore.js      PATCH/PUT baseline values back to Graph API
│   │   └── webhooks.js     HTTP delivery engine — first/every fire modes
│   ├── reports/
│   │   ├── assembler.js    Collects drift history, remediation log, config state
│   │   ├── renderer.js     HTML report renderer (light mode, MSSP branding)
│   │   └── docx-renderer.js  Word document renderer (light mode, MSSP branding)
│   ├── routes/             REST API (Express 4)
│   ├── services/           MSAL auth · Graph API client · permission checker
│   └── database/           SQLite (WAL mode, AES-256-GCM encrypted secrets)
├── data/
│   └── sentinel/           KQL, analytic rules, workbook assets, deployment notes
├── docs/
│   ├── guides/             22 step-by-step feature guides
│   ├── prerequisites.md    App Registration setup
│   ├── deployment.md       Local, Azure App Service, Docker Compose
│   ├── security.md         Encryption model, network hardening
│   └── usage.md            Full usage reference
└── scripts/                Key generation, backup, and Sentinel deployment utilities
```

**Tech stack — all free, all open-source:**

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Frontend | React 18, Vite, Tailwind CSS |
| Backend | Express 4, MSAL Node, sql.js, Zod, Pino, docx |
| Auth | OAuth 2.0 client credentials (app-only, no user sign-in required) |
| Database | SQLite with WAL mode — zero extra infrastructure |
| Security | AES-256-GCM secret encryption, Helmet.js, CORS lockdown |
| Testing | Test artifacts are excluded from this deployment package build |

---

## Quick Start

**1. Create an Entra ID App Registration** (~10 minutes)

See [docs/prerequisites.md](docs/prerequisites.md) for the full step-by-step guide. At minimum, grant these Application permissions and consent them:

```
Policy.Read.All
RoleManagement.Read.Directory
User.Read.All
Group.Read.All
Application.Read.All
```

Note your **Directory (Tenant) ID**, **Application (Client) ID**, and **Client Secret Value**.

**2. Deploy TrustM365 locally**

```powershell
# Windows
git clone https://github.com/AntoPorter/trustm365.git
cd trustm365
npm run install:all
npm run generate:key      # generates a 64-char hex encryption key
notepad .env              # paste: ENCRYPTION_KEY=<the key above>
npm run dev               # opens on http://localhost:5173
```

```bash
# macOS / Linux
git clone https://github.com/AntoPorter/trustm365.git
cd trustm365
npm run install:all
npm run generate:key      # copy only the 64-char hex key output
cp .env.example .env
# edit .env and set: ENCRYPTION_KEY=<the key above>
npm run dev
```

**3. Register your first tenant**

Click **Add Tenant** in the sidebar. Paste your Tenant ID, Client ID, and Client Secret. TrustM365 validates your credentials and checks which permissions are granted — showing which areas are unlocked before you save.

**4. Pull live data and set a baseline**

Click **Sync All** on the tenant dashboard. Once data loads, click **Manage** on any area card, then **Set Baseline**. Select resources to monitor, choose Properties or Snapshot mode, and save. Drift detection starts on the next sync.

> For Docker and Azure App Service deployment options, see [docs/deployment.md](docs/deployment.md).

---

## How Baselines Work

```
Pull live config  →  Set Baseline  →  Sync  →  Drift detected?
                                                    │
                                          Yes ──→  View diff  →  Restore / Auto-restore
                                                    │
                                           No ──→  Clean ✓  →  Generate Report
```

**Monitoring modes:**
- **Properties** — select which specific fields to watch. Only those fields are compared on each sync.
- **Snapshot** — the entire resource is hashed at baseline save time. Any change to any field triggers drift.

**Drift states:**

| State | Meaning |
|---|---|
| **Drifted** | One or more monitored properties differ from the baseline value |
| **Clean** | All monitored properties exactly match the baseline |
| **Missing** | The resource was in the baseline but no longer exists in the tenant |

---

## Drift Status Reference

| Badge | Where shown | Meaning |
|---|---|---|
| 🟢 **Baseline Active** | Area header | A baseline is set and drift detection is running |
| 🟡 **No Baseline** | Area header | Live data has been pulled but no baseline has been set |
| ✅ **All clean** | Configuration tab | All monitored resources match the baseline exactly |
| 🔴 **Drifted (N)** | Configuration tab, sidebar, portfolio | N resources have properties that differ from baseline |
| 🟠 **Missing (N)** | Configuration tab | N baseline resources no longer exist in the tenant |

---

## Permissions Reference

### Core monitoring (read-only)

| Permission | Purpose |
|---|---|
| `Policy.Read.All` | Authentication policies, Conditional Access |
| `RoleManagement.Read.Directory` | Directory role assignments |
| `User.Read.All` | User accounts |
| `Group.Read.All` | Security and M365 groups |
| `Application.Read.All` | App registrations and credential expiry |
| `DeviceManagementConfiguration.Read.All` | Intune compliance, config, update rings, EP security |
| `DeviceManagementServiceConfig.Read.All` | Mobile Threat Defense connector states |
| `DeviceManagementApps.Read.All` | App Protection Policies (MAM) |
| `AuditLog.Read.All` | Tenant Insights — MFA registration rates and auth method breakdown |

### Restore capability (write — optional)

| Permission | Enables restore for |
|---|---|
| `Policy.ReadWrite.ConditionalAccess` | Conditional Access policies |
| `Policy.ReadWrite.AuthenticationMethod` | Authentication method policies |
| `RoleManagement.ReadWrite.Directory` | Directory role assignments |
| `User.ReadWrite.All` | User account properties |
| `Group.ReadWrite.All` | Group settings |
| `Application.ReadWrite.All` | App registration settings |
| `DeviceManagementConfiguration.ReadWrite.All` | All Intune policies (compliance, config, EP security) |
| `DeviceManagementServiceConfig.ReadWrite.All` | Mobile Threat Defense connector restore |

> All permissions are Application (not delegated). TrustM365 acts as itself — no user sign-in required. Read-only deployments can omit all `ReadWrite` permissions; restore buttons are hidden automatically.

---

## Documentation

| Document | Description |
|---|---|
| [**Prerequisites**](docs/prerequisites.md) | Entra ID App Registration — complete this before deployment |
| [**Deployment**](docs/deployment.md) | Local, Azure App Service, and Docker Compose |
| [**Usage Guide**](docs/usage.md) | Registering tenants, baselines, drift detection, restore, MSSP |
| [**Security**](docs/security.md) | Credential handling, encryption model, network hardening |
| [**Sentinel Integration**](docs/integrations/sentinel-log-analytics.md) | Log Analytics ingestion, Sentinel rules/workbook, and SOC operations |
| [**Contributing**](CONTRIBUTING.md) | How to add resource area collectors and contribute |
| [**Changelog**](CHANGELOG.md) | Release history |

### Feature guides

Step-by-step guides for every component of TrustM365, in [docs/guides/](docs/guides/):

| Guide | Description |
|---|---|
| [01 — Registering a tenant](docs/guides/01-registering-a-tenant.md) | Connect TrustM365 to a Microsoft 365 tenant |
| [02 — Configuring a baseline](docs/guides/02-configuring-a-baseline.md) | Define the intended state and start monitoring |
| [03 — Understanding drift detection](docs/guides/03-understanding-drift-detection.md) | How drift is detected, surfaced, and categorised |
| [04 — Restoring to baseline](docs/guides/04-restoring-to-baseline.md) | Per-property, full resource, bulk, auto-restore, and dry-run |
| [05 — The Dashboard](docs/guides/05-the-dashboard.md) | Tenant dashboard, sync, settings, credential rotation, auto-restore |
| [06 — Area View](docs/guides/06-area-view.md) | Resource-level diff view, restore log, baseline history |
| [07 — Tenant Insights](docs/guides/07-tenant-insights.md) | MFA, auth methods, devices, guest ratio panels |
| [08 — Search and filtering](docs/guides/08-search-and-filtering.md) | Local page filters — Portfolio, Area View, Baseline Editor, Reports |
| [09 — Portfolio Overview](docs/guides/09-portfolio-overview.md) | Cross-tenant Scorecard and Matrix views |
| [10 — Generating reports](docs/guides/10-generating-reports.md) | Tenant reports — HTML viewer, PDF, and Word (.docx) export |
| [11 — Report scheduling](docs/guides/11-report-scheduling.md) | Automated weekly and monthly report generation |
| [12 — Webhook notifications](docs/guides/12-webhook-notifications.md) | Drift alerts to Teams, Slack, PagerDuty, or any HTTP endpoint |
| [13 — White-labelling](docs/guides/13-white-labelling.md) | Company branding, logo, colours for client-facing output |
| [14 — Security Templates](docs/guides/14-security-templates.md) | Security posture checks (Zero Trust Assessment V2) |
| [15 — Custom Collectors](docs/guides/15-custom-collectors.md) | Monitor any Graph endpoint without code |
| [16 — Intune endpoint security](docs/guides/16-intune-endpoint-security.md) | Compliance, Update Rings, MTD, App Protection, Antivirus, Firewall, BitLocker, ASR |
| [17 — Credential rotation](docs/guides/17-credential-rotation.md) | Updating an App Registration secret without data loss |
| [18 — Troubleshooting](docs/guides/18-troubleshooting.md) | Common problems and how to fix them |
| [19 — App Registrations](docs/guides/19-app-registrations.md) | Detailed steps for managing App Registrations in TrustM365 |
| [20 — Reference Templates](docs/guides/20-reference-templates.md) | Managing and using Reference Templates effectively |
| [21 — Log Analytics and Sentinel](docs/guides/21-log-analytics-and-sentinel.md) | Configure direct telemetry ingestion and Sentinel detection workflows |
| [22 — Sentinel content pack operations](docs/guides/22-sentinel-content-pack-operations.md) | Validate, deploy, and maintain rules/workbook artifacts |

---

## Roadmap

### v1.2 — Access Control
- [ ] Azure AD SSO login for the dashboard
- [ ] Role-based access — read-only vs restore permissions per user
- [ ] Multi-user audit trail

### v1.3 — Platform Extensions
- [ ] Log Analytics DCR/AAD ingestion path (alternative to shared key)
- [ ] Sentinel workbook parameterization for custom table prefixes

---

## Support

- **Bugs:** [Open an issue](https://github.com/AntoPorter/trustm365/issues)
- **Questions & feature requests:** [Start a discussion](https://github.com/AntoPorter/trustm365/discussions)
- **Security vulnerabilities:** Email the maintainer directly — do not open a public issue

---

<p align="center">
  <strong>TrustM365</strong> — Open-source Microsoft 365 baseline drift monitoring<br>
  by <a href="https://securingm365.com">Anto Porter</a> · MIT License
</p>

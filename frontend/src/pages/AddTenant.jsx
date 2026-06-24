import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Shield, ExternalLink, CheckCircle, XCircle, Lock, Unlock,
  ChevronRight, AlertTriangle, RefreshCw, Eye, EyeOff
} from 'lucide-react'
import { appRegistrationApi, tenantApi } from '../api/client.js'

// ── Permission row inside the check results ───────────────────────────────────
function PermRow({ name, granted, purpose }) {
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-xs
      ${granted
        ? 'bg-green-950/20 border-green-900/40'
        : 'bg-gray-900 border-gray-800'}`}>
      <div className="mt-0.5 shrink-0">
        {granted
          ? <CheckCircle size={13} className="text-green-400" />
          : <XCircle    size={13} className="text-gray-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <code className={`block font-mono text-xs ${granted ? 'text-green-300' : 'text-gray-500'}`}>
          {name}
        </code>
        <span className="text-gray-600">{purpose}</span>
      </div>
    </div>
  )
}

// ── Area unlock summary ───────────────────────────────────────────────────────
function AreaRow({ area }) {
  const locked = !area.canRead
  const canRestore = area.canRestore ?? area.canWrite
  const readOnly = area.canRead && !canRestore
  const restoreBlockedByCapability = area.restoreSupported === false

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs
      ${locked   ? 'bg-gray-900/40 border-gray-800/40 opacity-60'
      : readOnly ? 'bg-yellow-950/20 border-yellow-900/40'
      :            'bg-green-950/20 border-green-900/40'}`}>

      <div className="shrink-0">
        {locked   ? <Lock   size={13} className="text-gray-600" />
        : readOnly ? <Eye   size={13} className="text-yellow-400" />
        :            <Unlock size={13} className="text-green-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className={`font-medium ${locked ? 'text-gray-600' : readOnly ? 'text-yellow-200' : 'text-white'}`}>
          {area.displayName}
          {area.licenceRequired && (
            <span className="ml-2 text-gray-600 font-normal">· {area.licenceRequired}</span>
          )}
        </div>
        {((area.readPermissions && area.readPermissions.length > 0) || (area.writePermissions && area.writePermissions.length > 0)) && (
          <div className="mt-0.5">
            <div className="text-gray-600 text-xs flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">Read:</span>
              {(area.readPermissions || []).map(p => {
                const missing = (area.missingRead || []).includes(p)
                return (
                  <code key={p} className={`font-mono text-xs px-1 py-0.5 rounded ${missing ? 'bg-gray-800 border border-gray-700 text-red-300' : 'bg-gray-800 border border-gray-700 text-green-300'}`}>
                    {p}
                  </code>
                )
              })}
            </div>
            {(area.writePermissions || []).length > 0 && (
              <div className="text-yellow-700 mt-0.5 text-xs flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">Write:</span>
                {(area.writePermissions || []).map(p => {
                  const missingW = (area.missingWrite || []).includes(p)
                  return (
                    <code key={p} className={`font-mono text-xs px-1 py-0.5 rounded ${missingW ? 'bg-yellow-950/20 border border-yellow-900 text-yellow-800' : 'bg-yellow-950/10 border border-yellow-900 text-green-300'}`}>
                      {p}
                    </code>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {readOnly && (
          <div className="text-yellow-700 mt-0.5">
            Sync only — restore disabled.
            {restoreBlockedByCapability && (
              <span> {area.restoreReason || 'Restore is not currently supported for this collector.'}</span>
            )}
            {!restoreBlockedByCapability && (area.missingWrite || []).length > 0 && <span> Add: <code className="text-yellow-800">{(area.missingWrite || []).join(', ')}</code></span>}
          </div>
        )}
      </div>

      <div className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded border
        ${locked   ? 'text-gray-600 border-gray-800 bg-gray-900'
        : readOnly ? 'text-yellow-400 border-yellow-900 bg-yellow-950/30'
        :            'text-green-400 border-green-900 bg-green-950/30'}`}>
        {locked ? 'Locked' : readOnly ? 'Read only' : 'Full access'}
      </div>
    </div>
  )
}

// ── Area groupings — mirrors Dashboard AREA_GROUPS ────────────────────────────
const AREA_GROUPS = [
  {
    key:      'entra',
    label:    'Microsoft Entra ID',
    areaKeys: ['entra_roles', 'entra_users', 'entra_groups', 'entra_apps', 'entra_auth_policies', 'entra_ca'],
  },
  {
    key:      'intune',
    label:    'Microsoft Intune',
    areaKeys: [
      'intune_compliance',
      'intune_config_profiles',
      'intune_update_rings',
      'intune_mtd_connectors',
      'intune_app_protection',
      'intune_ep_antivirus',
      'intune_ep_firewall',
      'intune_ep_disk_encryption',
      'intune_ep_asr',
    ],
  },
  {
    key:      'sharepoint',
    label:    'SharePoint',
    areaKeys: ['sharepoint_sites', 'sharepoint_tenant_settings'],
  },
  {
    key:      'exchange',
    label:    'Exchange Online',
    areaKeys: ['exchange_mailboxes', 'exchange_mailbox_security', 'exchange_connectors', 'exchange_transport_rules'],
  },
  {
    key:      'teams',
    label:    'Microsoft Teams',
    areaKeys: ['teams_policies_messaging', 'teams_policies_meetings', 'teams_membership', 'teams_app_permission_policies', 'teams_channels_policies', 'teams_org_app_settings'],
  },
]

// ── Permission list (shown on step 0 as the recommended baseline) ─────────────
const BASELINE_PERMISSIONS = [
  { p: 'Policy.Read.All',               purpose: 'Security Defaults, auth policies, CA policies',                            recommended: true },
  { p: 'RoleManagement.Read.Directory', purpose: 'Directory role assignments',                                               recommended: true },
  { p: 'User.Read.All',                 purpose: 'User accounts + Tenant Insights guest ratio',                              recommended: true },
  { p: 'Group.Read.All',                purpose: 'Security groups and Microsoft 365 groups',                                 recommended: true },
  { p: 'Application.Read.All',          purpose: 'App registrations + credential expiry monitoring',                         recommended: true },
  { p: 'AuditLog.Read.All',             purpose: 'MFA registration + authentication methods (Tenant Insights)',              recommended: true },
]

const WORKLOAD_PERMISSIONS = [
  { p: 'Sites.Read.All', purpose: 'SharePoint sites and sharing posture monitoring' },
  { p: 'Sites.Manage.All', purpose: 'SharePoint site-level restore operations' },
  { p: 'SharePointTenantSettings.Read.All', purpose: 'SharePoint tenant settings monitoring' },
  { p: 'SharePointTenantSettings.ReadWrite.All', purpose: 'SharePoint tenant settings restore' },
  { p: 'Team.ReadBasic.All', purpose: 'Teams metadata and membership monitoring' },
  { p: 'TeamSettings.ReadWrite.All', purpose: 'Teams policy restore (messaging/meeting/channels/app permissions)' },
  { p: 'TeamworkAppSettings.Read.All', purpose: 'Teams org app settings monitoring' },
  { p: 'TeamworkAppSettings.ReadWrite.All', purpose: 'Teams org app settings restore' },
  { p: 'GroupMember.ReadWrite.All', purpose: 'Teams membership restore (members and owners)' },
  { p: 'MailboxSettings.Read', purpose: 'Exchange mailbox monitoring' },
  { p: 'MailboxSettings.ReadWrite', purpose: 'Exchange mailbox security restore' },
  { p: 'Policy.Read.All', purpose: 'Exchange connector and transport-rule monitoring (best effort)' },
]

// ── Main page ─────────────────────────────────────────────────────────────────
const STEPS = ['App Registration', 'Credentials', 'Permissions']

export default function AddTenant({ navigate: propNavigate, showToast, onAdd }) {
  const routerNavigate = useNavigate()
  const [step, setStep]         = useState(0)
  const [mode, setMode]         = useState('new') // new | existing
  const [form, setForm]         = useState({
    displayName: '',
    tenantId: '',
    clientId: '',
    clientSecret: '',
    appRegistrationId: '',
    authorityTenantId: '',
  })
  const [appRegistrations, setAppRegistrations] = useState([])
  const [errors, setErrors]     = useState({})
  const [showSecret, setShowSecret] = useState(false)
  const [checking, setChecking] = useState(false)  // validating creds + checking permissions
  const [permData, setPermData] = useState(null)   // { granted: [], areas: [] }
  const [submitting, setSubmitting] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const guidRe = /^[0-9a-f-]{36}$/i

  useEffect(() => {
    appRegistrationApi.list()
      .then(setAppRegistrations)
      .catch(() => {})
  }, [])

  const tenantIdNormalized = (form.tenantId || '').trim().toLowerCase()
  const suggestedApps = appRegistrations
    .map(app => {
      const bindings = Array.isArray(app.bindings) ? app.bindings : []
      const exactBinding = guidRe.test(tenantIdNormalized)
        ? bindings.find(b => (b.tenant_uuid || '').toLowerCase() === tenantIdNormalized)
        : null
      const tenantCount = Number(app.tenant_count || 0)
      const hasHistory = tenantCount > 0
      const hasMultiTenantHistory = tenantCount > 1
      const score = exactBinding ? 100 : hasMultiTenantHistory ? 70 : hasHistory ? 40 : 0

      return {
        ...app,
        exactBinding,
        tenantCount,
        suggestedAuthorityTenantId: exactBinding?.authority_tenant_id || app.metadata?.defaultAuthorityTenantId || '',
        score,
      }
    })
    .filter(app => app.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.tenantCount - a.tenantCount))

  const applySuggestedApp = (app) => {
    setMode('existing')
    set('appRegistrationId', app.id)
    set('authorityTenantId', app.suggestedAuthorityTenantId)
    showToast(`Applied suggested app registration: ${app.display_name}`, 'success')
  }

  const useSuggestedAndCheck = async (app) => {
    const errs = {}
    if (!form.displayName.trim()) errs.displayName = 'Required'
    if (!form.tenantId.match(guidRe)) errs.tenantId = 'Must be a valid GUID'
    setErrors(prev => ({ ...prev, ...errs }))
    if (Object.keys(errs).length) {
      showToast('Enter display name and tenant ID first', 'error')
      return
    }

    setMode('existing')
    set('appRegistrationId', app.id)
    set('authorityTenantId', app.suggestedAuthorityTenantId)

    setChecking(true)
    try {
      const data = await tenantApi.checkPermissionsWithApp({
        tenantId: form.tenantId,
        appRegistrationId: app.id,
        authorityTenantId: app.suggestedAuthorityTenantId || undefined,
      })
      setPermData(data)
      setStep(2)
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Validation failed'
      showToast(msg, 'error')
    } finally {
      setChecking(false)
    }
  }

  // Step 1 → 2: validate form fields
  const goToCredentials = () => {
    setErrors({})
    setStep(1)
  }

  // Step 2 → 3: validate credentials AND check permissions
  const validateAndCheck = async () => {
    const errs = {}
    if (!form.displayName.trim())                     errs.displayName = 'Required'
    if (!form.tenantId.match(guidRe))                errs.tenantId    = 'Must be a valid GUID'
    if (mode === 'new') {
      if (!form.clientId.match(guidRe))              errs.clientId    = 'Must be a valid GUID'
      if (!form.clientSecret.trim())                    errs.clientSecret = 'Required'
    } else {
      if (!form.appRegistrationId)                      errs.appRegistrationId = 'Select an app registration'
      if (form.authorityTenantId && !form.authorityTenantId.match(guidRe)) {
        errs.authorityTenantId = 'Must be a valid GUID'
      }
    }
    setErrors(errs)
    if (Object.keys(errs).length) return

    setChecking(true)
    try {
      const data = mode === 'new'
        ? await tenantApi.checkPermissions({
            tenantId:     form.tenantId,
            clientId:     form.clientId,
            clientSecret: form.clientSecret,
          })
        : await tenantApi.checkPermissionsWithApp({
            tenantId: form.tenantId,
            appRegistrationId: form.appRegistrationId,
            authorityTenantId: form.authorityTenantId || undefined,
          })
      setPermData(data)
      setStep(2)
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Validation failed'
      showToast(msg, 'error')
    } finally {
      setChecking(false)
    }
  }

  // Step 3: final save
  const submit = async () => {
    setSubmitting(true)
    try {
      const newTenant = mode === 'new'
        ? await tenantApi.create({
            displayName: form.displayName,
            tenantId: form.tenantId,
            clientId: form.clientId,
            clientSecret: form.clientSecret,
          })
        : await tenantApi.createWithApp({
            displayName: form.displayName,
            tenantId: form.tenantId,
            appRegistrationId: form.appRegistrationId,
            authorityTenantId: form.authorityTenantId || undefined,
          })
      showToast(`"${form.displayName}" registered!`, 'success')
      onAdd(newTenant)   // updates sidebar + selects this tenant, then navigates to /
    } catch (err) {
      showToast(err.response?.data?.message || err.response?.data?.error || 'Registration failed', 'error')
    } finally { setSubmitting(false) }
  }

  const unlockedCount  = permData?.areas?.filter(a => a.canRead).length ?? 0
  const totalCount     = permData?.areas?.length ?? 0
  const allLocked      = permData && unlockedCount === 0

  const handleCancel = () => {
    if (typeof propNavigate === 'function') {
      propNavigate('dashboard')
      return
    }
    routerNavigate('/')
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Shield className="text-brand-500" size={26} />
        <div>
          <h1 className="text-xl font-bold text-white">Register Tenant</h1>
          <p className="text-gray-500 text-sm">Connect an M365 tenant to TrustM365</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center mb-7">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                ${i < step  ? 'bg-green-600 text-white'
                : i === step ? 'bg-brand-500 text-white'
                :              'bg-gray-800 text-gray-500'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <div className={`text-xs mt-1 text-center max-w-20 leading-tight ${i === step ? 'text-white' : 'text-gray-600'}`}>
                {s}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 mb-4 transition-colors ${i < step ? 'bg-green-600' : 'bg-gray-800'}`} />
            )}
          </div>
        ))}
      </div>

      {/* ── Step 0: App Registration guide ──────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">

          {/* Create the registration */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-white">Create an App Registration</h2>
            <ol className="space-y-3 text-sm text-gray-300">
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-brand-900/60 border border-brand-700/60 text-brand-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                <span>Go to <a href="https://entra.microsoft.com" target="_blank" rel="noopener noreferrer"
                  className="text-brand-400 hover:underline inline-flex items-center gap-0.5">
                  entra.microsoft.com <ExternalLink size={11} /></a> and sign in as a Global Administrator</span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-brand-900/60 border border-brand-700/60 text-brand-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                <span>Identity → Applications → App registrations → <strong className="text-white">New registration</strong></span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-brand-900/60 border border-brand-700/60 text-brand-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                <span>Name it <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-gray-200">TrustM365</code>, select <strong className="text-white">This organizational directory only</strong>, then click <strong className="text-white">Register</strong></span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-brand-900/60 border border-brand-700/60 text-brand-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
                <span>Copy the <strong className="text-white">Application (client) ID</strong> and <strong className="text-white">Directory (tenant) ID</strong> from the Overview page</span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-brand-900/60 border border-brand-700/60 text-brand-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">5</span>
                <span>Certificates &amp; secrets → <strong className="text-white">New client secret</strong> → set an expiry → <strong className="text-white">Add</strong></span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-yellow-900/60 border border-yellow-700/60 text-yellow-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">!</span>
                <span className="text-yellow-300"><strong>Copy the Value immediately</strong> — Azure hides it once you navigate away</span>
              </li>
            </ol>
          </div>

          {/* Permissions — core only, clean visual list */}
          <div className="card space-y-3">
            <div>
              <h2 className="font-semibold text-white">Add API Permissions</h2>
              <p className="text-gray-500 text-xs mt-1">
                API permissions → Add a permission → Microsoft Graph → Application permissions
              </p>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {BASELINE_PERMISSIONS.map(({ p, purpose, recommended }) => (
                <div key={p} className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 border ${
                  recommended
                    ? 'bg-brand-950/30 border-brand-800/50'
                    : 'bg-gray-900/60 border-gray-800'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${recommended ? 'bg-brand-400' : 'bg-brand-500'}`}/>
                  <div className="min-w-0">
                    <code className={`text-xs ${recommended ? 'text-brand-300' : 'text-brand-300'}`}>{p}</code>
                    {purpose && <p className="text-xs text-gray-500 mt-0.5">{purpose}</p>}
                  </div>
                  {recommended && (
                    <span className="ml-auto text-xs text-brand-400 font-medium shrink-0">Recommended</span>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-2">
              <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Workload Permissions (Teams, SharePoint, Exchange)</h3>
              <div className="grid grid-cols-1 gap-1.5">
                {WORKLOAD_PERMISSIONS.map(({ p, purpose }) => (
                  <div key={p} className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 border bg-gray-900/60 border-gray-800">
                    <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0 bg-brand-400"/>
                    <div className="min-w-0">
                      <code className="text-xs text-brand-300">{p}</code>
                      {purpose && <p className="text-xs text-gray-500 mt-0.5">{purpose}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-gray-900/40 border border-gray-800 px-3 py-2.5 text-xs text-gray-500 space-y-1">
              <p>
                All six permissions are recommended for full monitoring coverage.{' '}
                <code className="text-brand-300">AuditLog.Read.All</code> additionally requires{' '}
                <strong className="text-gray-300">Entra ID P1 or P2</strong> on the tenant to populate
                the MFA Registration and Authentication Methods panels in Tenant Insights.
                You can add permissions at any time without re-registering — locked areas unlock automatically on the next sync.
              </p>
            </div>

            <p className="text-xs text-gray-500">
              After adding permissions, click{' '}
              <strong className="text-white">Grant admin consent for [your organisation]</strong>{' '}
              and confirm. Each permission should show a green ✓.
            </p>
          </div>
        </div>
      )}

      {/* ── Step 1: Credentials ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-white">Enter App Registration Details</h2>
          <p className="text-gray-500 text-sm">
            TrustM365 will authenticate and then check which permissions are granted, unlocking the relevant areas automatically.
          </p>

          {suggestedApps.length > 0 && (
            <div className="rounded-xl border border-brand-900/40 bg-brand-950/20 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-brand-300 uppercase tracking-wider">Known Multi-Tenant App Suggestions</h3>
                <span className="text-xs text-brand-200/80">{suggestedApps.length} available</span>
              </div>
              <p className="text-xs text-brand-100/80">
                These app registrations have successful binding history and are likely reusable for this tenant.
              </p>
              <div className="space-y-2">
                {suggestedApps.slice(0, 3).map(app => (
                  <div key={app.id} className="rounded-lg border border-brand-900/40 bg-gray-900/40 p-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{app.display_name}</p>
                        <p className="text-xs text-gray-500 font-mono truncate">{app.client_id}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {app.exactBinding && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded border border-green-900/60 bg-green-950/30 text-green-300">
                              Previously bound to this tenant
                            </span>
                          )}
                          <span className="text-[11px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900 text-gray-300">
                            Used by {app.tenantCount} tenant{app.tenantCount === 1 ? '' : 's'}
                          </span>
                          {app.tenantCount > 1 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded border border-blue-900/60 bg-blue-950/30 text-blue-300">
                              Multi-tenant proven
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => applySuggestedApp(app)}
                          className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800 transition-colors">
                          Use suggestion
                        </button>
                        <button
                          type="button"
                          onClick={() => useSuggestedAndCheck(app)}
                          disabled={checking}
                          className="text-xs px-2 py-1 rounded border border-brand-700/60 text-brand-300 hover:text-brand-200 hover:bg-brand-950/40 transition-colors disabled:opacity-60">
                          Use and check
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`px-3 py-2 rounded border transition-colors ${mode === 'new' ? 'border-brand-600 bg-brand-950/30 text-brand-300' : 'border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              New app credentials
            </button>
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`px-3 py-2 rounded border transition-colors ${mode === 'existing' ? 'border-brand-600 bg-brand-950/30 text-brand-300' : 'border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              Reuse existing app registration
            </button>
          </div>

          <div className="space-y-3">
            {[
              { k: 'displayName', label: 'Display Name',              placeholder: 'e.g. Contoso Production', mono: false },
              { k: 'tenantId',    label: 'Directory (Tenant) ID',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', mono: true },
            ].map(({ k, label, placeholder, mono }) => (
              <div key={k}>
                <label className="block text-xs text-gray-400 mb-1">{label}</label>
                <input
                  className={`input ${mono ? 'font-mono' : ''}`}
                  placeholder={placeholder}
                  value={form[k]}
                  onChange={e => set(k, e.target.value)}
                />
                {errors[k] && <p className="text-red-400 text-xs mt-1">{errors[k]}</p>}
              </div>
            ))}

            {mode === 'new' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Application (Client) ID</label>
                <input
                  className="input font-mono"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={form.clientId}
                  onChange={e => set('clientId', e.target.value)}
                />
                {errors.clientId && <p className="text-red-400 text-xs mt-1">{errors.clientId}</p>}
              </div>
            )}

            {mode === 'existing' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Shared App Registration</label>
                  <select
                    className="input"
                    value={form.appRegistrationId}
                    onChange={e => set('appRegistrationId', e.target.value)}>
                    <option value="">Select app registration…</option>
                    {appRegistrations.map(app => (
                      <option key={app.id} value={app.id}>{app.display_name} ({app.client_id})</option>
                    ))}
                  </select>
                  {errors.appRegistrationId && <p className="text-red-400 text-xs mt-1">{errors.appRegistrationId}</p>}
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Authority Tenant ID (optional)</label>
                  <input
                    className="input font-mono"
                    placeholder="Defaults to app default authority or this tenant"
                    value={form.authorityTenantId}
                    onChange={e => set('authorityTenantId', e.target.value)}
                  />
                  {errors.authorityTenantId && <p className="text-red-400 text-xs mt-1">{errors.authorityTenantId}</p>}
                </div>
              </>
            )}

            {mode === 'new' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Client Secret Value</label>
                <div className="relative">
                  <input
                    className="input font-mono pr-10"
                    type={showSecret ? 'text' : 'password'}
                    placeholder="Paste secret value"
                    value={form.clientSecret}
                    onChange={e => set('clientSecret', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(s => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 transition-colors">
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {errors.clientSecret && <p className="text-red-400 text-xs mt-1">{errors.clientSecret}</p>}
                <p className="text-xs text-gray-600 mt-1">Encrypted with AES-256-GCM at rest. Never logged or transmitted in plain text.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2: Permission results ───────────────────────────────────────── */}
      {step === 2 && permData && (
        <div className="space-y-4">

          {/* Summary banner */}
          <div className={`rounded-xl px-4 py-3 border flex items-center gap-3 text-sm
            ${allLocked
              ? 'bg-red-950/30 border-red-900/60 text-red-300'
              : unlockedCount === totalCount
                ? 'bg-green-950/30 border-green-900/60 text-green-300'
                : 'bg-yellow-950/30 border-yellow-900/60 text-yellow-300'}`}>
            {allLocked
              ? <XCircle size={16} className="shrink-0" />
              : unlockedCount === totalCount
                ? <CheckCircle size={16} className="shrink-0" />
                : <AlertTriangle size={16} className="shrink-0" />}
            <div>
              <span className="font-medium">
                {allLocked
                  ? 'No areas unlocked'
                  : `${unlockedCount} of ${totalCount} areas unlocked`}
              </span>
              <span className="text-xs opacity-70 ml-2">
                {allLocked
                  ? 'Grant at least one permission and re-check, or save and add permissions later.'
                  : 'You can add more permissions to your App Registration at any time to unlock additional areas.'}
              </span>
            </div>
          </div>

          {/* Area-by-area unlock state — grouped */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-white text-sm">Area Access</h2>
            {AREA_GROUPS.map(group => {
              const groupAreas = permData.areas.filter(a => group.areaKeys.includes(a.areaKey))
              if (groupAreas.length === 0) return null
              const unlockedInGroup = groupAreas.filter(a => a.canRead).length
              return (
                <div key={group.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-gray-800"/>
                    <span className="text-xs text-gray-600">
                      {unlockedInGroup}/{groupAreas.length} unlocked
                    </span>
                  </div>
                  {groupAreas.map(area => <AreaRow key={area.areaKey} area={area} />)}
                </div>
              )
            })}
            {/* Any areas not in a defined group (future-proofing) */}
            {(() => {
              const allGrouped = AREA_GROUPS.flatMap(g => g.areaKeys)
              const ungrouped  = permData.areas.filter(a => !allGrouped.includes(a.areaKey))
              if (ungrouped.length === 0) return null
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Other</span>
                    <div className="flex-1 h-px bg-gray-800"/>
                  </div>
                  {ungrouped.map(area => <AreaRow key={area.areaKey} area={area} />)}
                </div>
              )
            })()}
          </div>

          {/* Detected permissions */}
          <details className="group">
            <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors list-none flex items-center gap-1 px-1">
              <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
              {permData.granted.length} permission{permData.granted.length !== 1 ? 's' : ''} detected on this App Registration
            </summary>
            <div className="mt-2 bg-gray-900 border border-gray-800 rounded-lg p-3 font-mono text-xs text-gray-400 space-y-1">
              {permData.granted.length === 0
                ? <span className="text-gray-600">No Graph API permissions granted yet.</span>
                : permData.granted.map(p => <div key={p}>{p}</div>)}
            </div>
          </details>

          {/* Re-check button if they want to add more permissions before saving */}
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <RefreshCw size={11} />
            Added more permissions?
            <button
              onClick={validateAndCheck}
              disabled={checking}
              className="text-brand-400 hover:text-brand-300 transition-colors">
              {checking ? 'Checking…' : 'Re-check now'}
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => step > 0 ? setStep(s => s - 1) : handleCancel()}
          className="btn-secondary"
          disabled={checking || submitting}>
          {step === 0 ? 'Cancel' : '← Back'}
        </button>

        {step === 0 && (
          <button onClick={goToCredentials} className="btn-primary">
            Next → Connection Details
          </button>
        )}

        {step === 1 && (
          <button onClick={validateAndCheck} disabled={checking} className="btn-primary">
            {checking
              ? <><RefreshCw size={13} className="animate-spin" /> Checking…</>
              : 'Validate & Check Permissions →'}
          </button>
        )}

        {step === 2 && (
          <button onClick={submit} disabled={submitting} className="btn-primary">
            {submitting ? 'Saving…' : 'Register Tenant →'}
          </button>
        )}
      </div>
    </div>
  )
}

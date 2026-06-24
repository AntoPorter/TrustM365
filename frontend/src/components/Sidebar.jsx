import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle, Circle, Plus, Trash2, ChevronDown, ChevronRight,
  Layers, Tag, Edit2, Check, X, ShieldAlert, Home, Shield, Settings, Star,
  Zap, Sun, Moon, FileText, Search, KeyRound
} from 'lucide-react'
import { tenantApi, reportApi } from '../api/client.js'
import { useBranding } from '../App.jsx'

const PLATFORM_BUILD_VERSION = String(import.meta.env.VITE_APP_BUILD_VERSION || 'v1.2.0').trim()
const PLATFORM_REPOSITORY_URL = 'https://github.com/AntoPorter/trustm365'

// Area groupings matching Dashboard
const AREA_GROUPS = [
  {
    key: 'entra',
    label: 'Microsoft Entra ID',
    areaKeys: ['entra_roles', 'entra_users', 'entra_groups', 'entra_apps', 'entra_auth_policies', 'entra_ca'],
  },
  {
    key: 'intune',
    label: 'Microsoft Intune',
    areaKeys: [
      // Policy management (v1.0)
      'intune_compliance',
      'intune_config_profiles',
      'intune_update_rings',
      'intune_mtd_connectors',
      'intune_app_protection',
      // Endpoint Security (beta — Settings Catalog)
      'intune_ep_antivirus',
      'intune_ep_firewall',
      'intune_ep_disk_encryption',
      'intune_ep_asr',
    ],
  },
  {
    key: 'sharepoint',
    label: 'SharePoint',
    areaKeys: ['sharepoint_sites', 'sharepoint_tenant_settings'],
  },
  {
    key: 'teams',
    label: 'Microsoft Teams',
    areaKeys: ['teams_policies_messaging', 'teams_policies_meetings', 'teams_membership', 'teams_app_permission_policies', 'teams_channels_policies', 'teams_org_app_settings'],
  },
  {
    key: 'exchange',
    label: 'Exchange Online',
    areaKeys: ['exchange_mailboxes', 'exchange_mailbox_security', 'exchange_connectors', 'exchange_transport_rules'],
  },
]

// Favourites stored in localStorage keyed by tenantId
function getFavourites(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(`trustm365_favs_${tenantId}`) || '[]')
  } catch { return [] }
}
function saveFavourites(tenantId, favs) {
  try { localStorage.setItem(`trustm365_favs_${tenantId}`, JSON.stringify(favs)) } catch {}
}

const DRIFT_ICON = {
  drifted: <AlertTriangle size={12} className="text-red-400 shrink-0" />,
  clean:   <CheckCircle  size={12} className="text-green-400 shrink-0" />,
  default: <Circle       size={12} className="text-gray-700 shrink-0" />,
}

function DeleteTenantModal({ tenant, onConfirm, onCancel, loading }) {
  const [input, setInput] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])
  const confirmToken = tenant.tenant_id
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-gray-900 border border-red-900/60 rounded-xl w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-gray-800 flex items-center gap-3">
          <div className="p-2 bg-red-950/60 rounded-lg"><ShieldAlert size={18} className="text-red-400" /></div>
          <div>
            <h2 className="font-semibold text-white">Remove Tenant</h2>
            <p className="text-xs text-gray-500 mt-0.5">{tenant.display_name}</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3">
            <p className="text-sm text-red-300 font-medium">This action cannot be undone.</p>
            <p className="text-xs text-red-400/80 mt-1">All baselines, drift history, and restore logs will be permanently deleted.</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-2">Type the <span className="text-white font-medium">Tenant ID</span> to confirm:</label>
            <code className="block text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded px-3 py-2 mb-2 font-mono select-all">{confirmToken}</code>
            <input ref={inputRef} type="text"
              className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-red-600 font-mono"
              placeholder="Paste or type the Tenant ID…" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && input === confirmToken) onConfirm(); if (e.key === 'Escape') onCancel() }}/>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-gray-800">
          <button onClick={onCancel} className="btn-secondary" disabled={loading}>Cancel</button>
          <button onClick={onConfirm} disabled={input !== confirmToken || loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${input === confirmToken && !loading ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>
            <Trash2 size={13} /> {loading ? 'Removing…' : 'Remove Tenant'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SidebarLogo() {
  const { logoUrl } = useBranding()
  if (logoUrl) {
    return (
      <img src={logoUrl} alt="Logo" width={32} height={32}
        className="shrink-0 w-8 h-8 object-contain rounded"
        onError={e => { e.currentTarget.style.display = 'none' }}/>
    )
  }
  return (
    <svg width="32" height="32" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <defs>
        <linearGradient id="sl-stroke" x1="100" y1="10" x2="100" y2="185" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#818cf8"/><stop offset="100%" stopColor="#6d28d9"/></linearGradient>
        <linearGradient id="sl-fill" x1="100" y1="10" x2="100" y2="185" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#312e81" stopOpacity="0.55"/><stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.25"/></linearGradient>
        <linearGradient id="sl-line" x1="30" y1="0" x2="170" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#34d399"/><stop offset="44%" stopColor="#34d399"/><stop offset="56%" stopColor="#f87171"/><stop offset="72%" stopColor="#f87171"/><stop offset="86%" stopColor="#34d399"/><stop offset="100%" stopColor="#34d399"/></linearGradient>
        <filter id="sl-glow"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="sl-dot"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <path d="M100 18 L174 47 C174 47 174 112 174 120 C174 153 139 174 100 186 C61 174 26 153 26 120 C26 112 26 47 26 47 Z" fill="url(#sl-fill)" stroke="url(#sl-stroke)" strokeWidth="5" strokeLinejoin="round"/>
      <line x1="38" y1="114" x2="162" y2="114" stroke="#34d399" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.25"/>
      <polyline points="38,114 72,114 88,80 104,114 162,114" stroke="url(#sl-line)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#sl-glow)"/>
      <circle cx="38" cy="114" r="5" fill="#34d399" opacity="0.9"/>
      <circle cx="88" cy="80" r="7" fill="#f87171" filter="url(#sl-dot)"/>
      <circle cx="162" cy="114" r="5.5" fill="#34d399"/>
    </svg>
  )
}

// Shows company name + tagline when MSSP branding is configured, else TrustM365 defaults
function SidebarBrandText() {
  const { companyName, tagline } = useBranding()
  if (companyName) {
    return (
      <div className="min-w-0 flex-1">
        <div className="font-bold text-white text-sm leading-tight tracking-tight group-hover:text-brand-300 transition-colors truncate">
          {companyName}
        </div>
        <div className="text-gray-600 text-xs leading-tight mt-0.5 truncate">
          {tagline || 'Powered by TrustM365'}
        </div>
      </div>
    )
  }
  return (
    <div className="min-w-0 flex-1">
      <div className="font-bold text-white text-sm leading-tight tracking-tight group-hover:text-indigo-300 transition-colors">
        Trust<span className="text-indigo-400">M365</span>
      </div>
      <div className="text-gray-600 text-xs leading-tight mt-0.5">by Anto Porter</div>
    </div>
  )
}

// ── Per-tenant area list with groupings + favourites ──────────────────────────
function TenantAreaList({ tenant, tenantAreas, location, navigate }) {
  const [favourites, setFavourites] = useState(() => getFavourites(tenant.id))

  // Group collapse state — persisted to localStorage per tenant
  const COLLAPSE_KEY = `trustm365_sidebar_collapse_${tenant.id}`
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') } catch { return {} }
  })

  const toggleFav = (e, areaKey) => {
    e.stopPropagation()
    setFavourites(prev => {
      const next = prev.includes(areaKey) ? prev.filter(k => k !== areaKey) : [...prev, areaKey]
      saveFavourites(tenant.id, next)
      return next
    })
  }

  const toggleGroup = (groupKey) => {
    setCollapsed(prev => {
      const next = { ...prev, [groupKey]: !prev[groupKey] }
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const renderAreaButton = (area) => {
    const st = area.latestDrift?.status
    const isFav = favourites.includes(area.area_key)
    const isActive = location.pathname === `/area/${tenant.id}/${area.area_key}`
    return (
      <div key={area.area_key} className="group/area flex items-center">
        <button
          onClick={() => navigate(`/area/${tenant.id}/${area.area_key}`)}
          className={`flex-1 flex items-center gap-2 pl-2 pr-1 py-1.5 rounded text-xs text-left transition-colors hover:bg-gray-800
            ${isActive ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            (st === 'drifted' && (area.latestDrift?.driftCount || 0) > 0) ? 'bg-red-500'
            : (st === 'clean' || (st === 'drifted' && (area.latestDrift?.driftCount || 0) === 0)) ? 'bg-green-500'
            : 'bg-gray-700'
          }`}/>
          <span className="truncate flex-1">{area.display_name}</span>
          {st === 'drifted' && area.latestDrift?.driftCount > 0 && (
            <span className="text-xs text-red-400 font-bold shrink-0">{area.latestDrift.driftCount}</span>
          )}
        </button>
        {/* Favourite toggle — visible on hover or when active */}
        <button
          onClick={(e) => toggleFav(e, area.area_key)}
          title={isFav ? 'Remove from favourites' : 'Add to favourites'}
          className={`ml-0.5 p-1 rounded transition-all shrink-0
            ${isFav
              ? 'text-yellow-400 opacity-100'
              : 'text-gray-700 opacity-0 group-hover/area:opacity-100 hover:text-yellow-400'}`}>
          <Star size={9} className={isFav ? 'fill-current' : ''}/>
        </button>
      </div>
    )
  }

  // Separate favourited areas from the rest
  const safeAreas = (tenantAreas || []).filter(a => a.area_key !== 'teams_teams')
  const favAreas = safeAreas.filter(a => favourites.includes(a.area_key))

  return (
    <div className="space-y-0.5">
      {/* Favourites section */}
      {favAreas.length > 0 && (
        <div className="mb-1">
          <div className="flex items-center gap-1.5 px-2 py-1">
            <Star size={9} className="text-yellow-400 fill-current shrink-0"/>
            <span className="text-xs font-semibold text-yellow-400/70 uppercase tracking-wider">Favourites</span>
          </div>
          {favAreas.map(area => renderAreaButton(area))}
          <div className="h-px bg-gray-800/60 mx-2 mt-1"/>
        </div>
      )}

      {/* Grouped areas */}
      {AREA_GROUPS.map(group => {
        const groupAreas = safeAreas.filter(a => group.areaKeys.includes(a.area_key))
        groupAreas.sort((a, b) => group.areaKeys.indexOf(a.area_key) - group.areaKeys.indexOf(b.area_key))
        if (groupAreas.length === 0) return null
        const isCollapsed = !!collapsed[group.key]
        const driftedInGroup = groupAreas.filter(a =>
          a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) > 0
        ).length
        const nonFavAreas = groupAreas.filter(a => !favourites.includes(a.area_key))
        const shortLabel = group.label.replace('Microsoft ', '')

        return (
          <div key={group.key}>
            <button
              onClick={() => toggleGroup(group.key)}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-800/50 transition-colors group/grp">
              {isCollapsed
                ? <ChevronRight size={10} className="text-gray-600 shrink-0"/>
                : <ChevronDown size={10} className="text-gray-600 shrink-0"/>}
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex-1 text-left">
                {shortLabel}
              </span>
              {driftedInGroup > 0 && (
                <span className="text-xs bg-red-950 text-red-400 border border-red-900 px-1 py-0.5 rounded font-bold">
                  {driftedInGroup}
                </span>
              )}
            </button>

            {!isCollapsed && nonFavAreas.length > 0 && (
              <div className="space-y-0.5">
                {nonFavAreas.map(area => renderAreaButton(area))}
              </div>
            )}
            {!isCollapsed && nonFavAreas.length === 0 && groupAreas.length > 0 && (
              <p className="text-xs text-gray-700 px-4 py-1 italic">All in favourites</p>
            )}
          </div>
        )
      })}

      {/* Any ungrouped areas (future-proofing) */}
      {(() => {
        const allGrouped = AREA_GROUPS.flatMap(g => g.areaKeys)
        const ungrouped = safeAreas.filter(a => !allGrouped.includes(a.area_key))
        return ungrouped.map(area => renderAreaButton(area))
      })()}
    </div>
  )
}

export default function Sidebar({ tenants, setTenants, selectedTenant, setSelectedTenant, areas, showToast, theme, onToggleTheme }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [expandedTenant, setExpandedTenant] = useState(null)
  const [editingMeta, setEditingMeta] = useState(null)
  const [metaForm, setMetaForm] = useState({ notes: '', tags: '' })
  const [savingMeta, setSavingMeta] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [unreadReports, setUnreadReports] = useState(0)

  // Poll unread report count every 60s so badge updates after scheduled generation
  useEffect(() => {
    const check = () => reportApi.list().then(d => setUnreadReports(d.unreadCount || 0)).catch(() => {})
    check()
    const id = setInterval(check, 60000)
    return () => clearInterval(id)
  }, [])

  // Clear badge when navigating to /reports
  useEffect(() => {
    if (location.pathname === '/reports') {
      setUnreadReports(0)
      reportApi.markRead().catch(() => {})
    }
  }, [location.pathname])

  useEffect(() => { if (selectedTenant) setExpandedTenant(selectedTenant.id) }, [selectedTenant])

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await tenantApi.remove(deleteTarget.id)
      setTenants(prev => prev.filter(t => t.id !== deleteTarget.id))
      if (selectedTenant?.id === deleteTarget.id) { setSelectedTenant(null); navigate('/home') }
      showToast(`${deleteTarget.display_name} removed`, 'success')
      setDeleteTarget(null)
    } catch { showToast('Remove failed', 'error') }
    finally { setDeleting(false) }
  }

  const saveMeta = async (e, tenantId) => {
    e.stopPropagation()
    setSavingMeta(true)
    try {
      const tags = metaForm.tags.split(',').map(t => t.trim()).filter(Boolean)
      await tenantApi.updateMeta(tenantId, { notes: metaForm.notes, tags })
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, notes: metaForm.notes, tags } : t))
      setEditingMeta(null)
      showToast('Notes & tags saved', 'success')
    } catch { showToast('Save failed', 'error') }
    finally { setSavingMeta(false) }
  }

  const selectTenant = (tenant, navState = null) => {
    setSelectedTenant(tenant)
    setExpandedTenant(expandedTenant === tenant.id ? null : tenant.id)
    if (navState) {
      navigate('/', { state: navState })
    } else {
      navigate('/')
    }
  }

  const isActive = (path) => location.pathname === path

  return (
    <>
      <aside className="w-80 border-r flex flex-col h-screen" style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}>

        {/* Logo — home button */}
        <button onClick={() => navigate('/home')} title="Home"
          className="px-4 py-4 border-b border-gray-800 hover:bg-gray-900/60 transition-colors text-left group">
          <div className="flex items-center gap-3">
            <SidebarLogo />
            <SidebarBrandText />
            <Home size={11} className="text-gray-700 group-hover:text-gray-400 transition-colors shrink-0"/>
          </div>
        </button>

        {/* MSSP section */}
        <div className="px-3 pt-3 pb-1">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider px-2 pb-1.5">MSSP</div>
          <div className="space-y-0.5">
            <button onClick={() => navigate('/portfolio')}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${isActive('/portfolio') ? 'bg-indigo-700/70 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
              <Layers size={13} /> Portfolio Overview
            </button>
            <button onClick={() => navigate('/reports')}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${isActive('/reports') ? 'bg-indigo-700/70 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
              <FileText size={13} />
              <span className="flex-1 text-left">Reports</span>
              {unreadReports > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-brand-600 text-white text-xs font-semibold leading-none">
                  {unreadReports}
                </span>
              )}
            </button>
            <button onClick={() => navigate('/custom-collectors')}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${isActive('/custom-collectors') ? 'bg-indigo-700/70 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
              <Zap size={13} /> Custom Collectors
            </button>
            <button onClick={() => navigate('/mssp-settings')}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${isActive('/mssp-settings') ? 'bg-indigo-700/70 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
              <Settings size={13} /> MSSP Settings
            </button>
          </div>
        </div>

        {/* Security section */}
        <div className="px-3 pt-1 pb-1">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider px-2 pb-1.5">Security</div>
          <div className="space-y-0.5">
            <button onClick={() => navigate('/security/templates')}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${isActive('/security/templates') || isActive('/templates') ? 'bg-indigo-700/70 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
              <Shield size={13} /> Security Templates
            </button>
            <button onClick={() => navigate('/security/reference-templates')}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${isActive('/security/reference-templates') ? 'bg-indigo-700/70 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
              <FileText size={13} /> Intune Reference Templates
            </button>
          </div>
        </div>

        <div className="px-4 pt-3 pb-1">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Tenants</span>
        </div>

        {/* Tenant list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {tenants.length === 0 && <p className="text-xs text-gray-600 px-2 py-3">No tenants yet.</p>}

          {tenants.map(tenant => {
            const tenantAreas  = areas[tenant.id] || []
            const driftedCount = tenantAreas.filter(a =>
              a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) > 0
            ).length
            const overallStatus = driftedCount > 0 ? 'drifted'
              : tenantAreas.length > 0 && tenantAreas.every(a =>
                  a.latestDrift?.status === 'clean' ||
                  (a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) === 0) ||
                  a.latestDrift?.status === 'unavailable'
                ) ? 'clean'
              : 'default'
            const isExpanded = expandedTenant === tenant.id
            const isSelected = selectedTenant?.id === tenant.id

            return (
              <div key={tenant.id}>
                <div onClick={() => selectTenant(tenant)}
                  className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}>
                  {DRIFT_ICON[overallStatus] || DRIFT_ICON.default}
                  <span className="flex-1 text-xs font-medium truncate">{tenant.display_name}</span>
                  {tenant.app_registration_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        selectTenant(tenant, { focus: 'app-registration', tenantId: tenant.id })
                      }}
                      title="Open App Registration settings"
                      className="shrink-0 p-0.5 rounded hover:bg-gray-700/50">
                      <KeyRound size={10} className="text-brand-400" />
                    </button>
                  )}
                  {driftedCount > 0 && (
                    <span className="text-xs bg-red-950 text-red-400 border border-red-900 px-1.5 py-0.5 rounded font-bold shrink-0">{driftedCount}</span>
                  )}
                  {(tenant.tags || []).length > 0 && <Tag size={10} className="text-gray-600 shrink-0" />}
                  <button onClick={(e) => { e.stopPropagation(); setEditingMeta(t => t === tenant.id ? null : tenant.id); setMetaForm({ notes: tenant.notes || '', tags: (tenant.tags || []).join(', ') }) }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-gray-300 transition-all shrink-0" title="Edit notes & tags">
                    <Edit2 size={11} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setExpandedTenant(isExpanded ? null : tenant.id) }}
                    className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors shrink-0">
                    {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(tenant) }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-700 hover:text-red-400 transition-all shrink-0" title="Remove tenant">
                    <Trash2 size={11} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="ml-3 mt-0.5 mb-1">
                    {editingMeta === tenant.id ? (
                      <div className="px-2 py-2 rounded-lg space-y-2 border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Tags (comma-separated)</label>
                          <input className="input text-xs py-1"
                            placeholder="e.g. production, client-a" value={metaForm.tags} onChange={e => setMetaForm(f => ({ ...f, tags: e.target.value }))}/>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Notes</label>
                          <textarea className="input text-xs py-1 resize-none h-14"
                            placeholder="Any notes…" value={metaForm.notes} onChange={e => setMetaForm(f => ({ ...f, notes: e.target.value }))}/>
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={(e) => saveMeta(e, tenant.id)} disabled={savingMeta}
                            className="flex items-center gap-1 text-xs bg-green-900/60 hover:bg-green-800/60 text-green-300 px-2 py-1 rounded border border-green-800/60 transition-colors">
                            <Check size={10}/> Save
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setEditingMeta(null) }}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded border border-gray-700 transition-colors">
                            <X size={10}/> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <TenantAreaList
                          tenant={tenant}
                          tenantAreas={tenantAreas}
                          location={location}
                          navigate={navigate}
                        />
                        {tenant.notes && <p className="text-xs text-gray-600 italic px-2 py-1 truncate">{tenant.notes}</p>}
                        {(tenant.tags || []).length > 0 && (
                          <div className="flex flex-wrap gap-1 px-2 pb-1">
                            {tenant.tags.map(tag => (
                              <span key={tag} className="text-xs bg-gray-800 text-gray-500 border border-gray-700 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <Tag size={8}/> {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Theme toggle */}
        <div className="px-3 pb-2">
          <button
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-800 hover:border-gray-700 transition-colors">
            <span className="flex items-center gap-2">
              {theme === 'dark'
                ? <Sun  size={12} className="text-yellow-400"/>
                : <Moon size={12} className="text-indigo-400"/>}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </span>
            <span className="text-gray-600 text-xs">{theme === 'dark' ? 'Off' : 'On'}</span>
          </button>
        </div>

        {/* Add tenant */}
        <div className="px-3 pb-3 border-t border-gray-800 pt-2">
          <button onClick={() => navigate('/add-tenant')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-800 hover:border-gray-700 transition-colors">
            <Plus size={12}/> Add Tenant
          </button>
          <div className="mt-2 flex justify-center" title="Platform build version">
            <a
              href={PLATFORM_REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full border border-indigo-800/70 bg-indigo-950/40 px-2.5 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-900/50 hover:text-indigo-200 transition-colors"
            >
              Build Version: {PLATFORM_BUILD_VERSION}
            </a>
          </div>
        </div>
      </aside>

      {deleteTarget && (
        <DeleteTenantModal tenant={deleteTarget} onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)} loading={deleting}/>
      )}
    </>
  )
}

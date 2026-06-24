import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { tenantApi, areaApi, msspApi } from './api/client.js'

const HomePage = lazy(() => import('./pages/HomePage.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const AreaView = lazy(() => import('./pages/AreaView.jsx'))
const BaselineEditor = lazy(() => import('./pages/BaselineEditor.jsx'))
const AddTenant = lazy(() => import('./pages/AddTenant.jsx'))
const Portfolio = lazy(() => import('./pages/Portfolio.jsx'))
const SecurityTemplates = lazy(() => import('./pages/SecurityTemplates.jsx'))
const ReferenceTemplates = lazy(() => import('./pages/ReferenceTemplates.jsx'))
const MsspSettings = lazy(() => import('./pages/MsspSettings.jsx'))
const AppRegistrations = lazy(() => import('./pages/AppRegistrations.jsx'))
const CustomCollectors = lazy(() => import('./pages/CustomCollectors.jsx'))
const Reports = lazy(() => import('./pages/Reports.jsx'))

// ── Brand hue application ─────────────────────────────────────────────────────
export function applyBrandHue(hue) {
  const root = document.documentElement
  if (!hue) {
    document.getElementById('brand-hue-override')?.remove()
    return
  }
  const h = parseInt(hue)
  const scale = [
    ['--brand-950', `hsl(${h},65%,12%)`],
    ['--brand-900', `hsl(${h},62%,20%)`],
    ['--brand-800', `hsl(${h},58%,29%)`],
    ['--brand-700', `hsl(${h},55%,38%)`],
    ['--brand-600', `hsl(${h},52%,47%)`],
    ['--brand-500', `hsl(${h},80%,63%)`],
    ['--brand-400', `hsl(${h},85%,72%)`],
    ['--brand-300', `hsl(${h},88%,80%)`],
    ['--brand-200', `hsl(${h},90%,87%)`],
  ]
  let existing = document.getElementById('brand-hue-override')
  if (!existing) {
    existing = document.createElement('style')
    existing.id = 'brand-hue-override'
    document.head.appendChild(existing)
  }
  existing.textContent = `:root, [data-theme="dark"], [data-theme="light"] { ${scale.map(([k, v]) => `${k}:${v}`).join(';')} }`
}

// ── Branding context ──────────────────────────────────────────────────────────
import { createContext, useContext } from 'react'
export const BrandingContext = createContext({ logoUrl: null, companyName: '', tagline: '', setLogoUrl: () => {}, setCompanyName: () => {}, setTagline: () => {} })
export const useBranding = () => useContext(BrandingContext)

function AppShell() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const [tenants,        setTenants]        = useState([])
  const [selectedTenant, setSelectedTenant] = useState(null)
  const [areas,          setAreas]          = useState({})
  const [toast,          setToast]          = useState(null)
  const [theme,          setTheme]          = useState(() => {
    try { return localStorage.getItem('trustm365_theme') || 'dark' } catch { return 'dark' }
  })

  // Branding — loaded from MSSP settings on startup
  const [logoUrl,     setLogoUrl]     = useState(null)
  const [companyName, setCompanyName] = useState('')
  const [tagline,     setTagline]     = useState('')

  useEffect(() => {
    msspApi.getSettings().then(s => {
      if (s.logo_url)     setLogoUrl(s.logo_url)
      if (s.company_name) setCompanyName(s.company_name)
      if (s.tagline)      setTagline(s.tagline)
      if (s.brand_hue)    applyBrandHue(s.brand_hue)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.getElementById('theme-color-meta')?.setAttribute(
      'content', theme === 'light' ? '#f8fafc' : '#0f1117'
    )
    try { localStorage.setItem('trustm365_theme', theme) } catch {}
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const showToast = (message, type = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4500)
  }

  useEffect(() => {
    const loadTenants = (isRefresh = false) => {
      tenantApi.list()
        .then(data => {
          setTenants(data)
          if (!isRefresh && data.length > 0 && !selectedTenant) setSelectedTenant(data[0])
          if (isRefresh && selectedTenant) {
            const fresh = data.find(t => t.id === selectedTenant.id)
            if (fresh) setSelectedTenant(fresh)
          }
        })
        .catch(() => { if (!isRefresh) showToast('Failed to load tenants', 'error') })
    }
    loadTenants()
    const handler = () => loadTenants(true)
    window.addEventListener('trustm365:tenants-changed', handler)
    return () => window.removeEventListener('trustm365:tenants-changed', handler)
  }, [])

  useEffect(() => {
    tenants.forEach(tenant => {
      if (!areas[tenant.id]) {
        areaApi.list(tenant.id)
          .then(data => setAreas(prev => ({ ...prev, [tenant.id]: data })))
          .catch(() => {})
      }
    })
  }, [tenants])

  const refreshAreas = (tenantId) => {
    areaApi.list(tenantId)
      .then(data => setAreas(prev => ({ ...prev, [tenantId]: data })))
      .catch(() => {})
  }

  const pageLoadingFallback = (
    <div className="p-6 text-sm text-gray-500">Loading page...</div>
  )

  return (
    <BrandingContext.Provider value={{ logoUrl, companyName, tagline, setLogoUrl, setCompanyName, setTagline }}>
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--page-bg)' }}>
      <Sidebar
        tenants={tenants}
        setTenants={setTenants}
        selectedTenant={selectedTenant}
        setSelectedTenant={setSelectedTenant}
        areas={areas}
        showToast={showToast}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="flex-1 overflow-y-auto">
        <ErrorBoundary>
        <Suspense fallback={pageLoadingFallback}>
        <Routes>
          <Route path="/home" element={
            <HomePage tenants={tenants} areas={areas} selectedTenant={selectedTenant} setSelectedTenant={setSelectedTenant} showToast={showToast} />
          } />
          <Route path="/" element={
            selectedTenant
              ? <Dashboard selectedTenant={selectedTenant} navigate={navigate} showToast={showToast} onSyncComplete={() => selectedTenant && refreshAreas(selectedTenant.id)} />
              : <Navigate to="/home" replace />
          } />
          <Route path="/portfolio" element={<Portfolio navigate={navigate} setSelectedTenant={setSelectedTenant} showToast={showToast} />} />
          <Route path="/templates" element={<SecurityTemplates tenants={tenants} showToast={showToast} />} />
          <Route path="/security/templates" element={<SecurityTemplates tenants={tenants} showToast={showToast} />} />
          <Route path="/security/reference-templates" element={<ReferenceTemplates tenants={tenants} showToast={showToast} />} />
          <Route path="/mssp-settings" element={<MsspSettings showToast={showToast} />} />
          <Route path="/mssp-settings/app-registrations" element={<AppRegistrations showToast={showToast} />} />
          <Route path="/custom-collectors" element={<CustomCollectors showToast={showToast} />} />
          <Route path="/reports" element={<Reports showToast={showToast} navigate={navigate} setSelectedTenant={setSelectedTenant} />} />
          <Route path="/area/:tenantId/:areaKey" element={<AreaView showToast={showToast} onSync={() => selectedTenant && refreshAreas(selectedTenant.id)} />} />
          <Route path="/baseline-editor/:tenantId/:areaKey" element={<BaselineEditor showToast={showToast} />} />
          <Route path="/add-tenant" element={
            <AddTenant showToast={showToast} onAdd={(newTenant) => {
              tenantApi.list().then(all => { setTenants(all); setSelectedTenant(all.find(t => t.id === newTenant.id) || newTenant) })
                .catch(() => { setTenants(prev => { const w = prev.filter(t => t.id !== newTenant.id); return [...w, newTenant] }); setSelectedTenant(newTenant) })
              navigate('/')
            }} />
          } />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium border transition-all
          ${toast.type === 'success' ? 'bg-green-900 text-green-100 border-green-700'
          : toast.type === 'error'   ? 'bg-red-950 text-red-100 border-red-800'
          : 'bg-gray-800 text-gray-100 border-gray-700'}`}>
          {toast.message}
        </div>
      )}
    </div>
    </BrandingContext.Provider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { X, Download, FileText, RefreshCw, ChevronDown, History, AlertCircle, CheckCircle2, Layers } from 'lucide-react'
import { reportApi, tenantApi } from '../api/client.js'

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

// ── Version picker per area ───────────────────────────────────────────────────
function AreaVersionPicker({ areaKey, displayName, currentLabel, currentSavedAt, history = [], selected, onChange }) {
  const [open, setOpen] = useState(false)
  const selectedHist = history.find(h => h.id === selected)

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 bg-gray-900/50">
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={12} className="text-brand-400 shrink-0"/>
          <span className="text-sm font-medium text-white truncate">{displayName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {selected
            ? <span className="text-xs text-amber-400 flex items-center gap-1">
                <History size={10}/> Archived
              </span>
            : <span className="text-xs text-green-400 flex items-center gap-1">
                <CheckCircle2 size={10}/> Current
              </span>
          }
          {history.length > 0 && (
            <button
              onClick={() => setOpen(v => !v)}
              className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors">
              <History size={10}/>
              {history.length} version{history.length !== 1 ? 's' : ''}
              <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`}/>
            </button>
          )}
        </div>
      </div>

      {/* Current / selected version info */}
      <div className="px-3 py-1.5 text-xs text-gray-500 bg-gray-900/20 border-t border-gray-800/50">
        {selected
          ? <>Using archived: <span className="text-amber-300">{selectedHist?.label || selected}</span> · {fmtDate(selectedHist?.archivedAt)}</>
          : <>Using current: <span className="text-gray-300">{currentLabel}</span> · saved {fmtDate(currentSavedAt)}</>
        }
      </div>

      {/* History dropdown */}
      {open && (
        <div className="border-t border-gray-800">
          <button
            onClick={() => { onChange(null); setOpen(false) }}
            className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between
              ${!selected ? 'bg-brand-950/40 text-brand-300' : 'text-gray-400 hover:bg-gray-800/40 hover:text-white'}`}>
            <span>Current baseline — {currentLabel}</span>
            <span className="text-gray-600">{fmtDate(currentSavedAt)}</span>
          </button>
          {history.map(h => (
            <button key={h.id}
              onClick={() => { onChange(h.id); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between border-t border-gray-800/50
                ${selected === h.id ? 'bg-amber-950/30 text-amber-300' : 'text-gray-400 hover:bg-gray-800/40 hover:text-white'}`}>
              <span className="flex items-center gap-1.5"><History size={9}/>{h.label}</span>
              <span className="text-gray-600">{fmtDate(h.archivedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function BaselineExportModal({ tenantId, onClose, showToast }) {
  const [tenants,         setTenants]         = useState([])
  const [activeTenantId,  setActiveTenantId]  = useState(tenantId || '')
  const [history,         setHistory]         = useState({})   // { [areaKey]: [{id,label,archivedAt}] }
  const [preview,         setPreview]         = useState(null) // assembler payload
  const [versionOverrides, setVersionOverrides] = useState({}) // { [areaKey]: historyId }
  const [loadingPreview,  setLoadingPreview]  = useState(false)
  const [generating,      setGenerating]      = useState(false)
  const [savedReport,     setSavedReport]     = useState(null) // after generate
  const [viewingHtml,     setViewingHtml]     = useState(false)

  // Load tenant list
  useEffect(() => {
    tenantApi.list().then(setTenants).catch(() => {})
  }, [])

  // Load history and preview when tenant changes
  const loadForTenant = useCallback(async (tid, overrides = {}) => {
    if (!tid) return
    setLoadingPreview(true)
    setPreview(null)
    setSavedReport(null)
    try {
      const [hist, prev] = await Promise.all([
        reportApi.baselineHistory(tid),
        reportApi.baselinePreview({ tenantId: tid, versionOverrides: overrides }),
      ])
      setHistory(hist)
      setPreview(prev)
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to load baseline data', 'error')
    } finally {
      setLoadingPreview(false)
    }
  }, [])

  useEffect(() => {
    if (activeTenantId) loadForTenant(activeTenantId, versionOverrides)
  }, [activeTenantId])

  const handleVersionChange = (areaKey, historyId) => {
    const next = { ...versionOverrides }
    if (historyId === null) delete next[areaKey]
    else next[areaKey] = historyId
    setVersionOverrides(next)
    loadForTenant(activeTenantId, next)
  }

  const handleGenerate = async () => {
    if (!activeTenantId) return
    setGenerating(true)
    try {
      const report = await reportApi.baselineGenerate({
        tenantId: activeTenantId,
        versionOverrides,
        title: `Baseline Export — ${preview?.meta?.tenantName || activeTenantId}`,
      })
      setSavedReport(report)
      showToast('Baseline export generated', 'success')
    } catch (err) {
      showToast(err.response?.data?.error || 'Generation failed', 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleViewHtml = () => setViewingHtml(true)

  const handlePdf = () => {
    if (!savedReport) return
    const win = window.open('', '_blank')
    // Re-fetch the saved HTML from the reports API
    reportApi.get(savedReport.id).then(full => {
      win.document.write(full.html_content || '')
      win.document.close()
      setTimeout(() => win.print(), 400)
    })
  }

  const handleDocx = () => {
    if (!savedReport) return
    reportApi.baselineDocx(savedReport.id, savedReport.title)
  }

  // ── Full-screen HTML viewer ───────────────────────────────────────────────
  if (viewingHtml && savedReport) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 shrink-0 bg-gray-900">
          <span className="text-sm font-medium text-white truncate">{savedReport.title}</span>
          <div className="flex items-center gap-2">
            <button onClick={handlePdf}
              className="btn-secondary text-xs"><Download size={12}/> PDF</button>
            <button onClick={handleDocx}
              className="btn-secondary text-xs"><FileText size={12}/> Word</button>
            <button onClick={() => setViewingHtml(false)}
              className="btn-secondary text-xs"><X size={12}/> Close viewer</button>
          </div>
        </div>
        <BaselineHtmlViewer reportId={savedReport.id}/>
      </div>
    )
  }

  // ── Main modal ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Layers size={14} className="text-brand-400"/> Baseline Export
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Export monitored policies and configuration from active baselines
            </p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors">
            <X size={16}/>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Tenant selector */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Tenant</label>
            <select className="input w-full text-sm"
              value={activeTenantId}
              onChange={e => { setActiveTenantId(e.target.value); setVersionOverrides({}) }}>
              <option value="">Select a tenant…</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.display_name}</option>
              ))}
            </select>
          </div>

          {/* Loading */}
          {loadingPreview && (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
              <RefreshCw size={14} className="animate-spin"/> Loading baseline data…
            </div>
          )}

          {/* No baselines */}
          {!loadingPreview && activeTenantId && preview?.areas?.length === 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3.5 py-3 text-sm text-amber-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0"/>
              <span>No active baselines found for this tenant. Set a baseline on at least one area first.</span>
            </div>
          )}

          {/* Preview summary + version pickers */}
          {!loadingPreview && preview?.areas?.length > 0 && (
            <div className="space-y-3">
              {/* Summary strip */}
              <div className="flex items-center gap-6 px-3 py-2.5 rounded-lg bg-gray-800/40 border border-gray-800">
                <div>
                  <div className="text-lg font-bold text-brand-400">{preview.meta.totalAreas}</div>
                  <div className="text-xs text-gray-500">Baselined areas</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-brand-400">{preview.meta.totalResources}</div>
                  <div className="text-xs text-gray-500">Total resources</div>
                </div>
                <div className="ml-auto text-xs text-gray-600">
                  Tenant: {preview.meta.tenantUUID}
                </div>
              </div>

              {/* Version pickers */}
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  Each area will use its current baseline. Expand to select a historical version.
                </p>
                {preview.areas.map(area => (
                  <AreaVersionPicker
                    key={area.areaKey}
                    areaKey={area.areaKey}
                    displayName={area.areaDisplayName}
                    currentLabel={area.label}
                    currentSavedAt={area.savedAt}
                    history={history[area.areaKey] || []}
                    selected={versionOverrides[area.areaKey] || null}
                    onChange={id => handleVersionChange(area.areaKey, id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Post-generate actions */}
          {savedReport && (
            <div className="rounded-lg border border-green-800/40 bg-green-950/20 px-3.5 py-3 space-y-2">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <CheckCircle2 size={14}/> Export ready — {savedReport.title}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={handleViewHtml} className="btn-secondary text-xs">
                  <FileText size={12}/> View Report
                </button>
                <button onClick={handlePdf} className="btn-secondary text-xs">
                  <Download size={12}/> PDF
                </button>
                <button onClick={handleDocx} className="btn-secondary text-xs">
                  <FileText size={12}/> Download Word
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800 shrink-0">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleGenerate}
            disabled={!activeTenantId || !preview?.areas?.length || generating || loadingPreview}
            className="btn-primary text-sm">
            {generating
              ? <><RefreshCw size={13} className="animate-spin"/> Generating…</>
              : <><Layers size={13}/> Generate Export</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Inline HTML viewer — fetches the saved report HTML ────────────────────────
function BaselineHtmlViewer({ reportId }) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    reportApi.get(reportId).then(r => setHtml(r.html_content || '')).catch(() => {})
  }, [reportId])
  return (
    <iframe
      srcDoc={html}
      className="flex-1 w-full border-0"
      title="Baseline Export"
    />
  )
}

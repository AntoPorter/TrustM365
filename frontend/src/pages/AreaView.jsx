import { useState, useEffect } from 'react'
import { useBranding } from '../App.jsx'
import { useParams, useNavigate } from 'react-router-dom'
import {
  RefreshCw, BookMarked, RotateCcw, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle, Plus, Minus, Eye, Lock, ArrowRight, ArrowLeft,
  ShieldCheck, ShieldAlert, Camera, SlidersHorizontal, Hash, RotateCw,
  Clock, Trash2, Search, X
} from 'lucide-react'
import { areaApi, tenantApi } from '../api/client.js'
import { usePollJob } from '../hooks/usePollJob.js'
import { applyImpliedRead } from '../utils/permissions.js'

// ── Value formatter ───────────────────────────────────────────────────────────

function ObjectPreview({ value, depth = 0, maxDepth = 3, forceOpen = false }) {

  // Guard against explicit null/undefined which `typeof` reports as 'object' for null
  if (value === null) return <span className="text-xs font-mono">null</span>
  if (value === undefined) return <span className="text-xs font-mono">—</span>

  // Admin Consent Request Policy — concise summary
    if (value && (value.notifyReviewers !== undefined || value.remindersEnabled !== undefined || value.requestDurationInDays !== undefined || value.reviewers !== undefined)) {
      const enabled = value.isEnabled === true ? true : (value.isEnabled === false ? false : null);
      const notify = value.notifyReviewers;
      const reminders = value.remindersEnabled;
      const reqDur = value.requestDurationInDays ?? null;
      const reviewers = Array.isArray(value.reviewers) ? value.reviewers : (Array.isArray(notify) ? notify : []);
      return (
        <details className="text-xs" open={forceOpen}>
          <summary className="cursor-pointer text-gray-400">Admin Consent Request Policy — {enabled === true ? 'Enabled' : enabled === false ? 'Disabled' : 'Configuration'}</summary>
          <div className="pl-3 mt-1 space-y-1 text-xs text-gray-400">
            <div>Notify reviewers: <strong className="text-white">{Array.isArray(notify) ? `${notify.length} configured` : (notify ? String(notify) : 'No')}</strong></div>
            <div>Reminders: <strong className="text-white">{reminders ? 'Enabled' : 'Disabled'}</strong></div>
            <div>Request duration (days): <strong className="text-white">{reqDur ?? '—'}</strong></div>
            <div>Reviewers: <strong className="text-white">{Array.isArray(reviewers) ? reviewers.length : (reviewers ? 1 : 0)}</strong></div>
            <div className="pt-1">
              <details className="text-xs" open={forceOpen}><summary className="cursor-pointer text-gray-500">Full policy JSON</summary>
                <div className="pl-3 mt-1 text-xs text-gray-400"><ObjectPreview value={value} depth={depth+1} maxDepth={maxDepth} forceOpen={forceOpen} /></div>
              </details>
            </div>
          </div>
        </details>
      );
    }

    // Authorization / AuthorizationPolicy — show top-level allow/SSPR invites flags
    if (value && (value.allowInvitesFrom !== undefined || value.allowedToUseSSPR !== undefined || value.allowEmailVerifiedUsersToJoinOrganization !== undefined || value.guestUserRoleId !== undefined)) {
      return (
        <details className="text-xs" open={forceOpen}>
          <summary className="cursor-pointer text-gray-400">Authorization Policy</summary>
          <div className="pl-3 mt-1 space-y-1 text-xs text-gray-400">
            {value.allowInvitesFrom !== undefined && <div>Allow invites from: <strong className="text-white">{humanizeAllowInvitesFrom(value.allowInvitesFrom)}</strong></div>}
            {value.allowedToUseSSPR !== undefined && <div>Self-service password reset: <strong className="text-white">{value.allowedToUseSSPR ? 'Allowed' : 'Blocked'}</strong></div>}
            {value.allowEmailVerifiedUsersToJoinOrganization !== undefined && <div>Email-verified join: <strong className="text-white">{value.allowEmailVerifiedUsersToJoinOrganization ? 'Allowed' : 'Blocked'}</strong></div>}
            {value.guestUserRoleId && <div>Guest user role id: <strong className="text-white">{String(value.guestUserRoleId)}</strong></div>}
            <div className="pt-1">
              <details className="text-xs" open={forceOpen}><summary className="cursor-pointer text-gray-500">Full policy JSON</summary>
                <div className="pl-3 mt-1 text-xs text-gray-400"><ObjectPreview value={value} depth={depth+1} maxDepth={maxDepth} forceOpen={forceOpen} /></div>
              </details>
            </div>
          </div>
        </details>
      );
    }

    // device management choice setting instance
    const sd = value?.settingDefinitionId || value?.settingInstance?.settingDefinitionId || null;

  if (typeof value === 'boolean')
    return <span className={`font-mono font-bold ${value ? 'text-green-400' : 'text-red-400'}`}>{String(value)}</span>

  if (typeof value !== 'object')
    return <span className="font-mono text-xs break-all">{String(value)}</span>

  // Arrays — show a summary and allow expansion
  if (Array.isArray(value)) {
    const len = value.length;
    return (
      <details className="text-xs" open={forceOpen}>
        <summary className="cursor-pointer text-gray-400">Array[{len}] {len > 0 ? '(expand)' : ''}</summary>
        <div className="pl-3 mt-1 space-y-1">
          {value.slice(0, 50).map((v, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="text-gray-500 text-xs w-10 truncate">[{i}]</div>
              <div className="flex-1"><ObjectPreview value={v} depth={depth + 1} maxDepth={maxDepth} forceOpen={forceOpen} /></div>
            </div>
          ))}
          {len > 50 && <div className="text-xs text-gray-500">... {len - 50} more</div>}
        </div>
      </details>
    );
  }

  // Objects — collapse when deep
  // Special-cases: Admin Consent, Entra Authentication Methods Policy and common setting shapes (Intune/MDM)
  try {
    // Admin Consent Request Policy
    if (value && (value.notifyReviewers !== undefined || value.requestDurationInDays !== undefined || value.remindersEnabled !== undefined)) {
      const summ = summarizeAdminConsentPolicy(value);
      return (
        <details className="text-xs" open={forceOpen}>
          <summary className="cursor-pointer text-gray-400">Admin Consent Request Policy</summary>
          <div className="pl-3 mt-1 text-xs text-gray-400 space-y-1">
            <div>Enabled: <strong className="text-white">{summ?.isEnabled === true ? 'Yes' : summ?.isEnabled === false ? 'No' : '—'}</strong></div>
            <div>Reminders enabled: <strong className="text-white">{summ?.remindersEnabled === true ? 'Yes' : summ?.remindersEnabled === false ? 'No' : '—'}</strong></div>
            <div>Request duration (days): <strong className="text-white">{summ?.requestDurationInDays ?? '—'}</strong></div>
            <div>Reviewers: <strong className="text-white">{Array.isArray(summ?.reviewers) ? summ.reviewers.length : (summ?.reviewers ? '1' : '0')}</strong></div>
            {Array.isArray(summ?.reviewers) && summ.reviewers.length > 0 && (
              <div className="mt-1 text-xs text-gray-300 space-y-0.5">{summ.reviewers.slice(0,10).map((r, i) => <div key={i}>{r}</div>)}</div>
            )}
          </div>
        </details>
      );
    }

    // Entra Authentication Methods Policy — concise summary + configurations
    if (value && (value.registrationEnforcement || Array.isArray(value.authenticationMethodConfigurations) || Array.isArray(value.authenticationMethodsConfigurations))) {
      const reg = value.registrationEnforcement || null;
      const cfgs = value.authenticationMethodConfigurations || value.authenticationMethodsConfigurations || [];
      const regSummary = humanizeRegistrationEnforcement(reg);
      return (
        <details className="text-xs" open={forceOpen}>
          <summary className="cursor-pointer text-gray-400">Authentication Methods Policy — {Array.isArray(cfgs) ? cfgs.length : 0} configuration{Array.isArray(cfgs) && cfgs.length!==1?'s':''}</summary>
          <div className="pl-3 mt-1 space-y-1">
            {regSummary && (
              <div className="text-xs text-gray-400 space-y-1">
                {regSummary.campaign && <div>Campaign: <strong className="text-white">{humanizeLabel(regSummary.campaign)}</strong></div>}
                <div>State: <strong className="text-white">{regSummary.state ? humanizeLabel(regSummary.state) : '—'}</strong></div>
                <div>Snooze (days): <strong className="text-white">{regSummary.snoozeDays ?? '—'}</strong></div>
                <div>Include targets: <strong className="text-white">{Array.isArray(regSummary.includeTargets) ? regSummary.includeTargets.length : 0}</strong></div>
                <div>Exclude targets: <strong className="text-white">{Array.isArray(regSummary.excludeTargets) ? regSummary.excludeTargets.length : 0}</strong></div>
              </div>
            )}
            {Array.isArray(cfgs) && cfgs.length > 0 && (
              <div className="space-y-1">
                {cfgs.map((c, i) => {
                  const s = summarizeAuthConfig(c) || { name: `Config ${i+1}` };
                  return (
                    <details key={i} className="text-xs" open={forceOpen}>
                      <summary className="cursor-pointer text-gray-300">{s.name}{s.state ? ` — ${s.state}` : ''}</summary>
                      <div className="pl-3 mt-1 text-xs text-gray-400">
                        <ObjectPreview value={c} depth={depth+1} maxDepth={maxDepth} forceOpen={forceOpen} />
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        </details>
      );
    }

    // device management choice setting instance
    const sd = value.settingDefinitionId || value.settingInstance?.settingDefinitionId || value.settingInstance?.settingDefinitionId;
    if (sd) {
      const defLabel = humanizeSettingDefinitionId(sd);
      const choiceVal = value?.choiceSettingValue?.value || value?.settingInstance?.choiceSettingValue?.value || null;
      const choiceLabel = choiceVal ? humanizeChoiceValue(choiceVal) : null;
      return (
        <details className="text-xs" open={forceOpen}>
          <summary className="cursor-pointer text-gray-400">{defLabel}{choiceLabel ? ` — ${choiceLabel}` : ''}</summary>
          <div className="pl-3 mt-1 space-y-1">
            {value?.id !== undefined && <div className="text-xs text-gray-400">ID: {String(value.id)}</div>}
            {value?.settingInstance && <div className="text-xs text-gray-400">Instance: <ObjectPreview value={value.settingInstance} depth={depth+1} maxDepth={maxDepth} forceOpen={forceOpen} /></div>}
            {Object.keys(value || {}).filter(k => !['id','settingDefinitionId','choiceSettingValue','settingInstance'].includes(k)).map(k => (
              <div key={k} className="flex items-start gap-3 text-xs">
                <div className="text-gray-500 w-36">{makeLabelFromPath(k)}</div>
                <div className="flex-1"><ObjectPreview value={value[k]} depth={depth+1} maxDepth={maxDepth} forceOpen={forceOpen} /></div>
              </div>
            ))}
          </div>
        </details>
      );
    }
  } catch (e) { /* fall through to generic rendering */ }

  if (depth >= maxDepth) {
    try {
      return <pre className="text-xs font-mono break-all">{JSON.stringify(value, null, 2)}</pre>;
    } catch { return <span className="text-xs font-mono">[object]</span>; }
  }

  const entries = Object.entries(value || {}).slice(0, 200);
  return (
    <details className="text-xs" open={forceOpen}>
      <summary className="cursor-pointer text-gray-400">Object {entries.length ? '' : '(empty)'}</summary>
      <div className="pl-3 mt-1 space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-start gap-3">
            <div className="text-gray-500 text-xs w-44 truncate">{k}</div>
            <div className="flex-1"><ObjectPreview value={v} depth={depth + 1} maxDepth={maxDepth} forceOpen={forceOpen} /></div>
          </div>
        ))}
      </div>
    </details>
  );
}

function formatValue(val, opts = {}) {
  return <ObjectPreview value={val} forceOpen={!!opts.forceOpen} />;
}

// Default max depth when flattening nested properties for comparison rows.
const DEFAULT_FLATTEN_MAX_DEPTH = 3;

function humanizeLabel(s) {
  if (!s) return '';
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  // Insert space between camelCase boundaries
  const spaced = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  // Title case
  return spaced.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function makeLabelFromPath(path) {
  const segs = String(path).split('.').filter(Boolean);
  if (segs.length >= 2) {
    return `${humanizeLabel(segs[0])} — ${humanizeLabel(segs[segs.length - 1])}`;
  }
  return humanizeLabel(segs[0] || path);
}

function splitKnownWords(token) {
  if (!token) return token;
  const dict = ['require','allow','configure','recovery','password','rotation','warning','other','disk','encryption','device','msft','bitlocker','allowwarning','for','allowwarningfor','allowwarningforother','allowwarningforotherdiskencryption'];
  const lower = token.toLowerCase();
  const parts = [];
  let pos = 0;
  // Sort dictionary by length descending for greedy match
  const sorted = [...dict].sort((a,b) => b.length - a.length);
  while (pos < lower.length) {
    let matched = false;
    for (const w of sorted) {
      if (lower.startsWith(w, pos)) {
        parts.push(w);
        pos += w.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // no known word matched — take the rest and break
      parts.push(lower.slice(pos));
      break;
    }
  }
  return parts.map(p => p === 'msft' ? 'Microsoft' : (p === 'bitlocker' ? 'BitLocker' : humanizeLabel(p))).join(' ');
}

function humanizeSettingDefinitionId(id) {
  if (!id) return '';
  const tokens = String(id).split(/[_-]+/).filter(Boolean);
  if (tokens.length === 1) {
    // try to split known compound words
    return splitKnownWords(tokens[0]);
  }
  return tokens.map(t => (t.toLowerCase() === 'msft' ? 'Microsoft' : humanizeLabel(t))).join(' ');
}

function humanizeChoiceValue(val) {
  if (!val) return '';
  // choice values sometimes include tokens and suffixes — trim trailing numeric suffixes
  const cleaned = String(val).replace(/_\d+$/, '').replace(/_/g, ' ');
  return humanizeLabel(cleaned);
}

function humanizeRegistrationEnforcement(re) {
  if (!re || typeof re !== 'object') return null;
  return {
    campaign: re.authenticationMethodsRegistrationCampaign || re.authenticationMethodsRegistrationCampaign || null,
    snoozeDays: re.snoozeDurationInDays ?? null,
    state: re.state || null,
    includeTargets: Array.isArray(re.includeTargets) ? re.includeTargets : (Array.isArray(re.includeTargets) ? re.includeTargets : []),
    excludeTargets: Array.isArray(re.excludeTargets) ? re.excludeTargets : (Array.isArray(re.excludeTargets) ? re.excludeTargets : []),
  };
}

function summarizeAuthConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const name = cfg.displayName || cfg.id || cfg.name || cfg.authenticatorType || `Config ${cfg.id || ''}`;
  const state = cfg.state || (cfg.isEnabled === false ? 'Disabled' : (cfg.isEnabled === true ? 'Enabled' : null));
  return { name: humanizeLabel(name), state };
}

function summarizeAdminConsentPolicy(policy) {
  if (!policy || typeof policy !== 'object') return null;
  const notify = policy.notifyReviewers || policy.notifyReviewers?.reviewers || null;
  const reviewers = Array.isArray(notify) ? notify.map(r => (r?.displayName || r?.id || String(r))) : (notify && notify.reviewers ? notify.reviewers.map(r => (r?.displayName || r?.id || String(r))) : null);
  return {
    isEnabled: policy.isEnabled ?? null,
    remindersEnabled: policy.remindersEnabled ?? null,
    requestDurationInDays: policy.requestDurationInDays ?? null,
    reviewers: reviewers || null,
  };
}

function summarizeAuthMethodTemplate(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const name = cfg.displayName || cfg.id || cfg.name || cfg.authenticationMethodId || cfg.authenticatorType || null;
  const state = cfg.state || (cfg.isEnabled === false ? 'Disabled' : (cfg.isEnabled === true ? 'Enabled' : null));
  const target = cfg.target || cfg.authenticationMethodTarget || cfg.includes?.length ? cfg.includes : null;
  return { name: humanizeLabel(name), state, target };
}

function humanizeAllowInvitesFrom(val) {
  if (!val) return 'None';
  const map = {
    none: 'No invites',
    adminsAndGuestInviters: 'Admins & Guest Inviters',
    adminsGuestInvitersAndAllMembers: 'Admins, Guest Inviters & All Members',
    everyone: 'Everyone',
  };
  return map[val] || humanizeLabel(val);
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj)
}

// ── Property comparison row ───────────────────────────────────────────────────
function PropRow({ label, baselineVal, liveVal, hasDrift, onRestore, restoring, monitorOnly, expandAll }) {
  return (
    <div className={`grid grid-cols-[1fr_24px_1fr] gap-1 items-start px-3 py-2 rounded-lg text-xs
      ${hasDrift ? 'bg-red-950/20 border border-red-900/40' : 'bg-gray-900/40 border border-transparent'}`}>
      <div className="min-w-0">
        <div className="text-gray-600 text-xs mb-0.5 font-medium truncate">{label}</div>
        <div className={hasDrift ? 'text-green-300' : 'text-gray-400'}>{formatValue(baselineVal, { forceOpen: expandAll })}</div>
      </div>
      <div className="flex items-center justify-center pt-5">
        <ArrowRight size={12} className={hasDrift ? 'text-red-600' : 'text-gray-700'} />
      </div>
      <div className="min-w-0 flex items-start justify-between gap-1">
        <div className={hasDrift ? 'text-red-300' : 'text-gray-400'}>{formatValue(liveVal, { forceOpen: expandAll })}</div>
        {hasDrift && monitorOnly && (
          <span title="This field is monitored for changes but cannot be restored via the Graph API. Update it manually in the Microsoft 365 admin centre."
            className="shrink-0 flex items-center gap-1 text-xs text-amber-500/70 border border-amber-900/40 px-1.5 py-0.5 rounded cursor-help">
            <Eye size={9}/> Monitor only
          </span>
        )}
        {hasDrift && onRestore && !monitorOnly && (
          <button onClick={onRestore} disabled={restoring}
            className="shrink-0 flex items-center gap-1 text-xs bg-green-950/60 hover:bg-green-900/60 border border-green-900/60 text-green-400 px-1.5 py-0.5 rounded transition-colors">
            <RotateCcw size={9} className={restoring ? 'animate-spin' : ''} /> Fix
          </button>
        )}
      </div>
    </div>
  )
}

// ── Per-resource card ─────────────────────────────────────────────────────────
function ResourceCard({
  resourceId, resourceName, baselineResource, liveResource,
  watchedKeys, driftItem, onRestore, restoring, hasBaseline, defaultOpen,
  monitorOnlyKeys, resourceDetails, areaKey
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [expandAll, setExpandAll] = useState(false)

  const status = driftItem?.status || (
    !hasBaseline       ? 'no-baseline'
    : !liveResource    ? 'missing'
    : !baselineResource ? 'not-in-baseline'
    : 'clean'
  )

  const driftedPaths = new Set((driftItem?.drifts || []).map(d => d.path))
  const driftCount   = driftItem?.drifts?.length || 0

  // Surface area-specific summary badges when available on liveResource
  const anonCount = liveResource?.anonymousLinkCount ?? null
  const externalShareCount = liveResource?.externalShareCount ?? null
  const guestCount = (areaKey === 'teams_membership') ? null : (liveResource?.guestCount ?? null)
  const installedAppCount = liveResource?.installedAppCount ?? null
  const showAnonExtBadges = areaKey !== 'sharepoint_sites'

  // Props to show in the comparison
  function normalizeWatchedKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    return keys.map(k => {
      if (typeof k === 'string') return { path: k, label: makeLabelFromPath(k) };
      if (k && k.path) return { path: k.path, label: k.label || makeLabelFromPath(k.path) };
      return null;
    }).filter(Boolean);
  }

  function flattenProps(obj, prefix = '', depth = 0, maxDepth = DEFAULT_FLATTEN_MAX_DEPTH, maxEntries = 200) {
    const out = [];
    if (!obj || typeof obj !== 'object') return out;
    const exclude = new Set(['id','createdDateTime','lastModifiedDateTime','modifiedDateTime','renewedDateTime']);
    const keys = Object.keys(obj || {});
    for (const key of keys) {
      const base = key;
      const path = prefix ? `${prefix}.${key}` : key;
      if (exclude.has(base)) continue;
      const val = obj[key];
      out.push({ path, label: makeLabelFromPath(path) });
      if (val && typeof val === 'object' && !Array.isArray(val) && depth < maxDepth) {
        const child = flattenProps(val, path, depth + 1, maxDepth, maxEntries - out.length);
        out.push(...child);
      }
      if (out.length >= maxEntries) break;
    }
    const seen = new Set();
    return out.filter(item => { if (seen.has(item.path)) return false; seen.add(item.path); return true; });
  }

  const propsToShow = (watchedKeys && watchedKeys.length > 0)
    ? normalizeWatchedKeys(watchedKeys)
    : (baselineResource || liveResource)
      ? flattenProps(baselineResource || liveResource, '', 0, 2)
      : [];

  const statusCfg = {
    clean:            { border: 'border-green-900/30',  bg: 'bg-green-950/10',  icon: <CheckCircle size={14} className="text-green-400"/>,  label: 'Clean' },
    drifted:          { border: 'border-red-900/50',    bg: 'bg-red-950/15',    icon: <ShieldAlert size={14} className="text-red-400"/>,    label: `${driftCount} drift${driftCount!==1?'s':''}` },
    missing:          { border: 'border-orange-900/50', bg: 'bg-orange-950/15', icon: <Minus       size={14} className="text-orange-400"/>, label: 'Missing from tenant' },
    'not-in-baseline':{ border: 'border-gray-800',      bg: '',                  icon: <Eye         size={14} className="text-gray-600"/>,   label: 'Not in baseline' },
    'no-baseline':    { border: 'border-gray-800',      bg: '',                  icon: <Eye         size={14} className="text-gray-600"/>,   label: 'No baseline set' },
  }[status] || { border: 'border-gray-800', bg: '', icon: null, label: '' }

  return (
    <div className={`rounded-xl border overflow-hidden ${statusCfg.border} ${statusCfg.bg}`}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(v => !v)}>
        {statusCfg.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{resourceName}</span>
            {driftItem?.monitorMode === 'snapshot'
              ? <span className="flex items-center gap-1 text-xs bg-violet-950/60 border border-violet-800/60 text-violet-300 px-2 py-0.5 rounded-full"><Camera size={9}/> Snapshot</span>
              : driftItem?.monitorMode === 'properties'
              ? <span className="flex items-center gap-1 text-xs bg-brand-950/60 border border-brand-800/60 text-brand-300 px-2 py-0.5 rounded-full"><SlidersHorizontal size={9}/> Properties</span>
              : null}

            {((showAnonExtBadges && (anonCount !== null || externalShareCount !== null)) || (areaKey !== 'teams_membership' && guestCount !== null) || installedAppCount !== null) && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {showAnonExtBadges && anonCount !== null && (
                  <span className="text-xs text-gray-400 bg-gray-900/20 border border-gray-800/50 px-2 py-0.5 rounded-full">Anon {anonCount}</span>
                )}
                {showAnonExtBadges && externalShareCount !== null && (
                  <span className="text-xs text-gray-400 bg-gray-900/20 border border-gray-800/50 px-2 py-0.5 rounded-full">Ext {externalShareCount}</span>
                )}
                {areaKey !== 'teams_membership' && guestCount !== null && (
                  <span className="text-xs text-gray-400 bg-gray-900/20 border border-gray-800/50 px-2 py-0.5 rounded-full">Guests {guestCount}</span>
                )}
                {installedAppCount !== null && (
                  <span className="text-xs text-gray-400 bg-gray-900/20 border border-gray-800/50 px-2 py-0.5 rounded-full">Apps {installedAppCount}</span>
                )}
              </div>
            )}
          </div>
          <span className={`text-xs ${status==='drifted'?'text-red-400':status==='not-in-baseline'?'text-gray-500':status==='missing'?'text-orange-400':'text-gray-600'}`}>
            {statusCfg.label}
          </span>
        </div>
        {status === 'drifted' && onRestore && (
          <button onClick={e => { e.stopPropagation(); onRestore(resourceId) }}
            disabled={restoring[`${resourceId}:null`]}
            className="shrink-0 flex items-center gap-1.5 text-xs bg-green-950/60 hover:bg-green-900/60 border border-green-900/60 text-green-300 px-2.5 py-1 rounded transition-colors">
            <RotateCcw size={10} className={restoring[`${resourceId}:null`] ? 'animate-spin' : ''} />
            {restoring[`${resourceId}:null`] ? 'Restoring…' : 'Restore'}
          </button>
        )}
        {status === 'missing' && onRestore && (
          <button onClick={e => { e.stopPropagation(); onRestore(resourceId) }}
            disabled={restoring[`${resourceId}:null`]}
            className="shrink-0 flex items-center gap-1.5 text-xs bg-orange-950/60 hover:bg-orange-900/60 border border-orange-900/60 text-orange-300 px-2.5 py-1 rounded transition-colors">
            <RotateCcw size={10}/> Restore
          </button>
        )}
        {open ? <ChevronDown size={14} className="text-gray-600 shrink-0"/> : <ChevronRight size={14} className="text-gray-600 shrink-0"/>}
      </button>

      {open && (
        <div className="border-t border-gray-800/60 px-4 py-3 space-y-1.5">
          {driftItem?.monitorMode === 'snapshot' && driftItem?.status === 'drifted' && (
            <div className="flex items-start gap-2 bg-violet-950/20 border border-violet-900/40 rounded-lg px-3 py-2 mb-2 text-xs text-violet-300">
              <Hash size={11} className="shrink-0 mt-0.5 text-violet-500"/>
              <div>
                <strong className="text-violet-200">Configuration hash changed.</strong>
                {' '}Monitored as a whole — any field change triggers drift.
                {driftItem.baseHash && <span className="block mt-0.5 text-violet-500 font-mono">baseline: {driftItem.baseHash} → live: {driftItem.liveHash}</span>}
              </div>
            </div>
          )}

          {hasBaseline && (
            <div className="grid grid-cols-[1fr_24px_1fr] gap-1 text-xs font-semibold text-gray-600 pb-1 px-3">
              <span className="flex items-center gap-1"><ShieldCheck size={10}/> Baseline (desired)</span>
              <span/>
              <span className="flex items-center gap-1"><Eye size={10}/> Live (current)</span>
            </div>
          )}

          {status === 'missing' && (
            <div className="text-xs text-orange-400 px-3 py-2 bg-orange-950/20 border border-orange-900/40 rounded-lg">
              This resource was in the baseline but no longer exists in the tenant.
            </div>
          )}
          {status === 'not-in-baseline' && (
            <div className="text-xs text-gray-500 px-3 py-2 bg-gray-900/40 border border-gray-800 rounded-lg">
              This resource exists in the tenant but is not included in the baseline — it will not trigger drift alerts.{' '}
              <span className="text-brand-400">Edit baseline</span> to include it.
            </div>
          )}
          {status === 'no-baseline' && (
            <div className="text-xs text-yellow-400/80 px-3 py-2 bg-yellow-950/10 border border-yellow-900/30 rounded-lg">
              No baseline set for this area — showing live values only. Set a baseline to enable drift detection.
            </div>
          )}

          <div className="flex justify-between pb-2">
            <div>
              <button onClick={(e) => { e.stopPropagation(); setExpandAll(v => !v); }}
                className="text-xs text-gray-400 bg-gray-900/20 border border-gray-800/50 px-2 py-0.5 rounded">
                {expandAll ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
            <div />
          </div>

          {propsToShow.map(({ path, label }) => {
            const bVal = baselineResource ? getByPath(baselineResource, path) : undefined
            const lVal = liveResource     ? getByPath(liveResource,    path) : undefined
            const hasDrift   = driftedPaths.has(path)
            const isMonitorOnly = (monitorOnlyKeys || []).includes(path)
            return (
              <PropRow key={path} label={label} baselineVal={bVal} liveVal={lVal} hasDrift={hasDrift}
                onRestore={hasDrift && onRestore && !isMonitorOnly ? () => onRestore(resourceId, path) : null}
                restoring={restoring[`${resourceId}:${path}`]}
                monitorOnly={isMonitorOnly}
                expandAll={expandAll} />
            )
          })}

          {propsToShow.length === 0 && (
            <p className="text-xs text-gray-600 px-3">No properties to display.</p>
          )}

          {resourceDetails && resourceDetails[resourceId] && (
            <div className="pt-3 border-t border-gray-800/40 mt-2 px-3 space-y-2 text-xs">
              <div className="text-sm font-semibold text-white">Mailbox details</div>
              {resourceDetails[resourceId].mailboxSettings && (
                <div>
                  <div className="text-xs text-gray-400">Mailbox settings</div>
                  <div className="mt-1"><ObjectPreview value={resourceDetails[resourceId].mailboxSettings} /></div>
                </div>
              )}

              {resourceDetails[resourceId].forwardingRules && (
                <div>
                  <div className="text-xs text-gray-400 mt-2">Forwarding rules</div>
                  <div className="mt-1 space-y-1">
                    {resourceDetails[resourceId].forwardingRules.map(fr => (
                      <div key={fr.id} className="text-xs text-gray-200">{fr.displayName || fr.id}</div>
                    ))}
                  </div>
                </div>
              )}

              {resourceDetails[resourceId].messageRules && (
                <div>
                  <div className="text-xs text-gray-400 mt-2">Inbox message rules</div>
                  <div className="mt-1"><ObjectPreview value={resourceDetails[resourceId].messageRules} /></div>
                </div>
              )}

              {resourceDetails[resourceId].inferenceClassification && (
                <div>
                  <div className="text-xs text-gray-400 mt-2">Inference classification</div>
                  <div className="mt-1"><ObjectPreview value={resourceDetails[resourceId].inferenceClassification} /></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Resource group section ────────────────────────────────────────────────────
function ResourceGroup({ group, resourceIds, liveResources, baselineResources, watchedKeys, driftMap, onRestore, restoring, hasBaseline, monitorOnlyKeys, resourceDetails, areaKey }) {
  const [open, setOpen] = useState(true)
  const driftedInGroup = resourceIds.filter(id => driftMap[id]?.status === 'drifted').length
  const totalInGroup   = resourceIds.length

  if (totalInGroup === 0) return null

  return (
    <div className="space-y-1.5">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full group">
        <div className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor: group.color}}/>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{group.name}</span>
        {driftedInGroup > 0 && (
          <span className="text-xs bg-red-900/40 text-red-400 border border-red-900/60 px-1.5 py-0.5 rounded">{driftedInGroup} drift{driftedInGroup!==1?'s':''}</span>
        )}
        <span className="text-xs text-gray-700">{totalInGroup} resource{totalInGroup!==1?'s':''}</span>
        <div className="flex-1 h-px bg-gray-800"/>
        {open ? <ChevronDown size={11} className="text-gray-700"/> : <ChevronRight size={11} className="text-gray-700"/>}
      </button>
      {open && resourceIds.map(id => (
        <ResourceCard key={id}
          resourceId={id}
          resourceName={liveResources[id]?.displayName || baselineResources[id]?.displayName || id}
          baselineResource={baselineResources[id]}
          liveResource={liveResources[id]}
          watchedKeys={watchedKeys}
          driftItem={driftMap[id]}
          onRestore={onRestore}
          restoring={restoring}
          hasBaseline={hasBaseline}
          monitorOnlyKeys={monitorOnlyKeys}
          defaultOpen={driftMap[id]?.status === 'drifted'}
          resourceDetails={resourceDetails}
          areaKey={areaKey} />
      ))}
    </div>
  )
}

function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="card text-center py-12 space-y-3">
      <Icon size={40} className="text-gray-700 mx-auto"/>
      <p className="text-gray-400 font-medium">{title}</p>
      {body && <p className="text-gray-600 text-sm max-w-sm mx-auto">{body}</p>}
      {action}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AreaView({ showToast, onSync }) {
  const { tenantId, areaKey } = useParams()
  const navigate = useNavigate()

  // Block navigation to legacy removed collector
  useEffect(() => {
    if (areaKey === 'teams_teams') {
      navigate('/', { replace: true })
    }
  }, [areaKey, navigate])

  const { timezone } = useBranding()

  const [tenant,      setTenant]      = useState(null)
  const [area,        setArea]        = useState(null)
  const [perm,        setPerm]        = useState(null)
  const [liveData,    setLiveData]    = useState(null)
  const [baseline,    setBaseline]    = useState(null)
  const [drift,       setDrift]       = useState(null)
  const [restoreLog,  setRestoreLog]  = useState([])
  const [pulling,     setPulling]     = useState(false)
  const [restoring,   setRestoring]   = useState({})
  const [restoringAll,setRestoringAll]= useState(false)
  const [tab,         setTab]         = useState('compare')
  const [autoRestore, setAutoRestore] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [resourceSearch,       setResourceSearch]       = useState('')
  const [resourceStatusFilter, setResourceStatusFilter] = useState('all') // all | drifted | clean
  const [resourceDetails,      setResourceDetails]      = useState({})
  const [resourceDetailsLoading, setResourceDetailsLoading] = useState({})
  const [webhookDetailsOpen, setWebhookDetailsOpen] = useState(false)
  const { poll } = usePollJob()

  // ── Load metadata ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || !areaKey) return
    setLoading(true)
    setLiveData(null); setDrift(null); setBaseline(null); setTab('compare')

    Promise.all([tenantApi.list(), areaApi.list(tenantId)])
      .then(([tenants, areas]) => {
        const t = tenants.find(t => t.id === tenantId)
        const a = areas.find(a => a.area_key === areaKey)
        setTenant(t || null)
        setArea(a || null)
        if (a) setAutoRestore(a.auto_restore === 1)
        refreshPerm(t)
      })
      .catch(() => showToast('Failed to load area', 'error'))
      .finally(() => setLoading(false))
  }, [tenantId, areaKey])

  const refreshPerm = (t) => {
    const src = t || tenant
    if (src?.permissions_json) {
      try {
        const parsed = JSON.parse(src.permissions_json)
        const pa = applyImpliedRead(parsed.areas || [], parsed.granted || [])
        const hit = pa?.find(p => p.areaKey === areaKey) || null
        if (hit) {
          setPerm(hit)
          return
        }
      } catch {}
    }
    tenantApi.getPermissions(tenantId)
      .then(data => {
        const pa = data.areas || []
        setPerm(pa.find(p => p.areaKey === areaKey) || null)
      })
      .catch(() => setPerm(null))
  }

  const loadAreaData = async () => {
    if (!tenantId || !areaKey) return
    try {
      const [live, log] = await Promise.all([
        areaApi.getLive(tenantId, areaKey).catch(() => null),
        areaApi.getRestoreLog(tenantId, areaKey).catch(() => []),
      ])
      setLiveData(live)
      setRestoreLog(log)
      const bl = await areaApi.getBaseline(tenantId, areaKey).catch(() => null)
      setBaseline(bl)
      if (bl) {
        const d = await areaApi.getDrift(tenantId, areaKey).catch(() => null)
        setDrift(d)
      }
    } catch {}
  }

  useEffect(() => { if (area) loadAreaData() }, [area])

  // ── Pull live data ─────────────────────────────────────────────────────────
  const pull = async () => {
    setPulling(true)
    try {
      const { jobId } = await areaApi.pull(tenantId, areaKey)
      poll(
        jobId,
        // onComplete
        (job) => {
          setPulling(false)
          loadAreaData()
          onSync?.()
          if (job?.updatedPermissions) {
            const pa = job.updatedPermissions.areas || []
            setPerm(pa.find(p => p.areaKey === areaKey) || null)
          } else {
            tenantApi.getPermissions(tenantId).then(data => {
              const pa = data.areas || []
              setPerm(pa.find(p => p.areaKey === areaKey) || null)
            }).catch(() => {})
          }
          showToast('Synced from Graph API', 'success')
        },
        // onError
        err => { setPulling(false); showToast(err, 'error') },
        // onUnavailable — area not licenced, stop spinner and show informational message
        () => {
          setPulling(false)
          showToast('This area is not available on this tenant\'s licence tier', 'info')
        }
      )
    } catch (err) {
      setPulling(false)
      showToast(err.response?.data?.message || 'Pull failed', 'error')
    }
  }

  // ── Restore single resource (or single property) ───────────────────────────
  const restore = async (resourceId, propertyPath = null) => {
    const key = `${resourceId}:${propertyPath}`
    const restoreType = propertyPath ? 'manual_property' : 'manual_full'
    setRestoring(r => ({ ...r, [key]: true }))
    try {
      const result = await areaApi.restore(tenantId, areaKey, resourceId, propertyPath, restoreType)
      showToast(result.message, 'success')
      // Re-pull to update drift state after restore
      const { jobId } = await areaApi.pull(tenantId, areaKey)
      poll(jobId, () => loadAreaData(), () => {}, () => loadAreaData())
    } catch (err) {
      showToast(err.response?.data?.message || 'Restore failed', 'error')
    } finally {
      setRestoring(r => ({ ...r, [key]: false }))
    }
  }

  // ── Bulk restore all drifted resources ─────────────────────────────────────
  const restoreAll = async () => {
    const driftedIds = (drift?.summary || [])
      .filter(s => s.status === 'drifted' || s.status === 'missing')
      .map(s => s.resourceId)
    if (driftedIds.length === 0) return

    setRestoringAll(true)
    let successCount = 0
    let failCount    = 0
    for (const resourceId of driftedIds) {
      try {
        await areaApi.restore(tenantId, areaKey, resourceId, null, 'bulk')
        successCount++
      } catch {
        failCount++
      }
    }
    setRestoringAll(false)
    showToast(
      failCount === 0
        ? `${successCount} resource${successCount!==1?'s':''} restored to baseline`
        : `${successCount} restored, ${failCount} failed`,
      failCount === 0 ? 'success' : 'error'
    )
    const { jobId } = await areaApi.pull(tenantId, areaKey).catch(() => ({ jobId: null }))
    if (jobId) poll(jobId, () => loadAreaData(), () => {}, () => loadAreaData())
  }

  // Fetch per-resource details on-demand and cache them in component state
  const fetchResourceDetails = async (resourceId, forceReload = false) => {
    if (!tenantId || !areaKey) return null
    if (!forceReload && resourceDetails[resourceId]) return resourceDetails[resourceId]
    setResourceDetailsLoading(s => ({ ...s, [resourceId]: true }))
    try {
      const details = await areaApi.getResource(tenantId, areaKey, resourceId)
      setResourceDetails(s => ({ ...s, [resourceId]: details }))
      return details
    } catch (err) {
      showToast(err?.response?.data?.message || 'Failed to load resource details', 'error')
      return null
    } finally {
      setResourceDetailsLoading(s => { const c = { ...s }; delete c[resourceId]; return c })
    }
  }

  const toggleAutoRestore = async () => {
    const next = !autoRestore
    await areaApi.setAutoRestore(tenantId, areaKey, next)
    setAutoRestore(next)
    showToast(`Auto-restore ${next ? 'enabled' : 'disabled'}`, 'success')
  }

  // When a baseline exists, preload per-resource details for included resources
  // This replaces the previous manual "Load details" button and ensures the
  // UI has mailbox/collector-specific details available after a baseline is set.
  useEffect(() => {
    if (!baseline) return
    const ids = Object.keys(baseline.resources || {})
    if (ids.length === 0) return
    const concurrency = 8
    ;(async () => {
      for (let i = 0; i < ids.length; i += concurrency) {
        const batch = ids.slice(i, i + concurrency)
        await Promise.all(batch.map(id => fetchResourceDetails(id, true).catch(() => null)))
      }
    })()
  }, [baseline])

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading…</div>
  )
  if (!tenant || !area) return (
    <div className="p-8 text-center">
      <p className="text-gray-500">Area not found. <button onClick={() => navigate('/')} className="text-brand-400 hover:underline">Go home</button></p>
    </div>
  )

  const isLocked   = !(perm && perm.canRead)
  const canRestore = (perm && (perm.canRestore ?? perm.canWrite)) || false
  const restoreBlockedByCapability = perm?.restoreSupported === false

  if (isLocked) return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <button onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 transition-colors mb-1 group">
          <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform"/>
          <span>{tenant.display_name}</span>
          <ChevronRight size={10} className="text-gray-700"/>
          <span className="text-gray-600">{area.display_name}</span>
        </button>
        <h1 className="text-xl font-bold text-white">{area.display_name}</h1>
      </div>
      <div className="card border-gray-800/60 bg-gray-900/40 space-y-4 text-center py-10">
        <Lock size={40} className="text-gray-700 mx-auto"/>
        <p className="text-gray-400 font-medium">This area is locked</p>
        <p className="text-gray-600 text-sm">Required permissions for this area — add them to your App Registration and grant admin consent.</p>
        {(perm?.missingPermissions || perm?.missingRead || []).length > 0 && (
          <div className="mt-2 flex flex-wrap justify-center gap-2 items-center">
            <span className="text-xs text-gray-400 mr-2">Requires:</span>
            {(perm.missingPermissions || perm.missingRead || []).map(p => (
              <code key={p} className="text-sm bg-gray-800 border border-gray-700 px-3 py-1.5 rounded font-mono text-red-300">{p}</code>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 items-center">
          <div className="flex flex-wrap justify-center gap-2 items-center">
            <span className="text-xs text-gray-400 mr-2">Read:</span>
            {(perm?.readPermissions || []).map(p => {
              const missing = (perm?.missingRead || []).includes(p)
              return (
                <code key={p} className={`text-sm bg-gray-800 border border-gray-700 px-3 py-1.5 rounded font-mono ${missing ? 'text-red-300' : 'text-green-300'}`}>
                  {p}
                </code>
              )
            })}
          </div>

          {perm?.writePermissions?.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 items-center">
              <span className="text-xs text-gray-400 mr-2">ReadWrite:</span>
              {(perm?.writePermissions || []).map(p => {
                const missingW = (perm?.missingWrite || []).includes(p)
                return (
                  <code key={p} className={`text-sm bg-yellow-950/10 border border-yellow-900/40 px-3 py-1.5 rounded font-mono ${missingW ? 'text-yellow-300' : 'text-green-300'}`}>
                    {p}
                  </code>
                )
              })}
            </div>
          )}
          {(!perm?.writePermissions || perm.writePermissions.length === 0) && (
            <div className="flex flex-wrap justify-center gap-2 items-center">
              <span className="text-xs text-gray-400 mr-2">ReadWrite:</span>
              <span className="text-sm bg-gray-800 border border-gray-700 px-3 py-1.5 rounded text-gray-500">Not available for this collector</span>
            </div>
          )}
        </div>
        <button onClick={() => navigate('/')} className="btn-secondary mx-auto">← Back to Dashboard</button>
      </div>
    </div>
  )

  // ── Build resource sets ────────────────────────────────────────────────────
  const liveResources     = liveData?.resources     || {}
  const baselineResources = baseline?.resources     || {}
  const watchedKeys       = baseline?.watched_keys  || []
  const resourceGroups    = baseline?.resource_groups || []
  const monitorOnlyKeys   = area?.monitorOnlyKeys   || []
  const driftMap          = {}
  for (const item of (drift?.summary || [])) driftMap[item.resourceId] = item

  const hasBaseline  = !!baseline
  const liveHasResources = !!(liveData && Object.keys(liveData.resources || {}).length > 0)
  const baselineHasResources = !!(baseline && Object.keys(baseline.resources || {}).length > 0)
  const hasAnyData   = liveHasResources || baselineHasResources

  // When a baseline exists, the configuration tab shows ONLY baseline resources.
  // Resources not in baseline go in the collapsed "Not in Baseline" section.
  // Deduplicate IDs to prevent double-rendering.
  const allBaselineIds  = hasBaseline ? [...new Set(Object.keys(baselineResources))] : []
  const allLiveIds      = [...new Set(Object.keys(liveResources))]

  // monitoredIds = resources that have an active monitoring mode (snapshot or properties)
  // For pre-baseline view, show all live resources
  const baselineIdsSet  = new Set(allBaselineIds)
  const monitoredIds    = hasBaseline
    ? allBaselineIds.filter(id => {
        const mode = baseline?.resource_modes?.[id] || 'properties'
        return mode !== 'none'
      })
    : allLiveIds

  // noMonitoringIds = baseline resources explicitly set to "none" mode
  const noMonitoringIds = hasBaseline
    ? allBaselineIds.filter(id => (baseline?.resource_modes?.[id] || 'properties') === 'none')
    : []

  // liveOnlyIds = live resources not in baseline at all
  const liveOnlyIds     = hasBaseline
    ? allLiveIds.filter(id => !baselineIdsSet.has(id))
    : []

  const driftedCount  = monitoredIds.filter(id => driftMap[id]?.status === 'drifted').length
  const cleanCount    = monitoredIds.filter(id => driftMap[id]?.status === 'clean').length
  const missingCount  = monitoredIds.filter(id => !liveResources[id]).length
  const newCount      = liveOnlyIds.length

  const totalDrifted  = driftedCount + missingCount
  const hasAnythingDrifted = totalDrifted > 0

  // Sort monitored: drifted/missing first, then clean
  const sortedMonitoredIds = [
    ...monitoredIds.filter(id => ['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id] ? '' : 'missing'))),
    ...monitoredIds.filter(id => !['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id] ? '' : 'missing'))),
  ]

  // Apply search + status filter to ALL resource lists
  const matchesSearch = (id) => {
    if (!resourceSearch) return true
    const q = resourceSearch.toLowerCase()
    const res = liveResources[id] || baselineResources[id] || {}
    return (
      (res.displayName || '').toLowerCase().includes(q) ||
      id.toLowerCase().includes(q)
    )
  }
  const matchesStatus = (id) => {
    if (resourceStatusFilter === 'all') return true
    const st = driftMap[id]?.status || (liveResources[id] ? 'no-baseline' : 'missing')
    if (resourceStatusFilter === 'drifted') return st === 'drifted' || st === 'missing'
    if (resourceStatusFilter === 'clean')   return st === 'clean'
    return true
  }

  const filteredSortedMonitoredIds = sortedMonitoredIds.filter(id => matchesSearch(id) && matchesStatus(id))
  const filteredLiveOnlyIds        = liveOnlyIds.filter(id => matchesSearch(id))

  // Build grouped and ungrouped resource lists (from filtered set)
  const groupedResourceIds    = resourceGroups.flatMap(g => g.resourceIds)
  const ungroupedMonitoredIds = filteredSortedMonitoredIds.filter(id => !groupedResourceIds.includes(id))

  const hasActiveResourceFilter = !!(resourceSearch || resourceStatusFilter !== 'all')

  const webhookDeliverySummary = drift?.webhookDeliverySummary || {
    attempted: 0,
    sent: 0,
    failed: 0,
    notSent: 0,
    lastAttemptAt: null,
  }
  const webhookDeliveries = Array.isArray(drift?.webhookDeliveries) ? drift.webhookDeliveries : []
  const formatTimestamp = (iso) => {
    if (!iso) return '—'
    try {
      return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(iso))
    } catch {
      return iso
    }
  }
  const labelWebhookReason = (reason) => {
    switch (reason) {
      case 'delivered': return 'Delivered'
      case 'delivery_failed': return 'Delivery failed'
      case 'skipped_first_mode': return 'Already sent for this drift cycle (first mode)'
      case 'disabled': return 'Destination disabled'
      case 'no_applicable_destinations': return 'No applicable webhook destinations'
      default: return reason ? reason.replace(/_/g, ' ') : '—'
    }
  }
  const labelWebhookMode = (mode) => {
    if (mode === 'first') return 'First only'
    if (mode === 'every') return 'Every drift'
    return 'System'
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {/* Breadcrumb / back button */}
          <button onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 transition-colors mb-1 group">
            <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform"/>
            <span>{tenant.display_name}</span>
            <ChevronRight size={10} className="text-gray-700"/>
            <span className="text-gray-600">{area.display_name}</span>
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white">{area.display_name}</h1>
            {/* Custom collector — read-only indicator */}
            {area.isCustom && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-950/30 border border-amber-900/50 px-2.5 py-1 rounded-full">
                <Eye size={11}/> Custom · Read-Only
              </span>
            )}
            {/* Baseline status indicator */}
            {hasBaseline ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400 bg-green-950/30 border border-green-900/50 px-2.5 py-1 rounded-full">
                <ShieldCheck size={11}/> Baseline Active
              </span>
            ) : hasAnyData ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-yellow-400 bg-yellow-950/30 border border-yellow-900/50 px-2.5 py-1 rounded-full">
                <AlertTriangle size={11}/> No Baseline
              </span>
            ) : null}
          </div>
          <p className="text-gray-500 text-sm mt-1">{area.description}</p>
          {/* Per-area last-synced timestamp */}
          <p className="text-xs text-gray-700 mt-1 flex items-center gap-1.5">
            <Clock size={10}/>
            {area.last_pulled_at
              ? (() => {
                  const fmtTs = (iso) => {
                    if (!iso) return '—';
                    try {
                      return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(iso));
                    } catch {
                      return iso;
                    }
                  };
                  return <>Last synced: <span className="text-gray-500">{fmtTs(area.last_pulled_at)}</span></>;
                })()
              : <span className="text-gray-700">Never synced — pull live data to start</span>}
          </p>
          {/* Fields captured UI removed (frontend-only) */}
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk restore — only when there are drifted items and write access */}
          {hasAnythingDrifted && canRestore && (
            <button onClick={restoreAll} disabled={restoringAll}
              className="btn-danger text-xs flex items-center gap-1.5">
              <RotateCw size={12} className={restoringAll ? 'animate-spin' : ''}/>
              {restoringAll ? 'Restoring…' : `Restore All (${totalDrifted})`}
            </button>
          )}
          <button onClick={pull} disabled={pulling} className="btn-secondary">
            <RefreshCw size={13} className={pulling ? 'animate-spin' : ''}/>
            {pulling ? 'Pulling…' : 'Pull Live Data'}
          </button>
          <button onClick={() => navigate(`/baseline-editor/${tenantId}/${areaKey}`)} className="btn-primary">
            <BookMarked size={13}/>
            {hasBaseline ? 'Edit Baseline' : 'Set Baseline'}
          </button>
        </div>
      </div>

      {/* Read-only / permission banner — live, updated on every pull */}
      {!canRestore && perm && (
        <div className="flex items-center gap-2 bg-yellow-950/20 border border-yellow-900/40 rounded-lg px-4 py-2.5 text-xs text-yellow-300">
          <Eye size={13} className="shrink-0"/>
          <span>
            Read-only — drift detection active, restore disabled.{' '}
            {(perm?.writePermissions || []).length === 0 && (
              <>
                This collector is read-only and does not expose a ReadWrite Graph capability.
              </>
            )}
            {(perm?.writePermissions || []).length > 0 && (
              <>
            {restoreBlockedByCapability
              ? (perm.restoreReason || 'Restore is not currently supported for this collector.')
              : (
                <>
                  Add{' '}
                  {(perm.missingWrite || []).map((p, i, arr) => (
                    <span key={p}><code className="font-mono bg-yellow-950/40 px-1 rounded">{p}</code>{i < arr.length-1 ? ', ' : ''}</span>
                  ))}{' '}to your App Registration and re-pull to enable restore.
                </>
              )}
              </>
            )}
          </span>
        </div>
      )}

      {/* Auto-restore toggle */}
      {hasBaseline && canRestore && (
        <div className="flex items-center justify-between card-sm">
          <div>
            <div className="text-sm font-medium text-white">Auto-Restore</div>
            <div className="text-xs text-gray-500">Automatically restore drifted resources to baseline on next sync</div>
          </div>
          <button onClick={toggleAutoRestore}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoRestore ? 'bg-brand-500' : 'bg-gray-700'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoRestore ? 'translate-x-6' : 'translate-x-1'}`}/>
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-800">
        {[
          ['compare', 'Configuration', driftedCount > 0 || missingCount > 0 ? totalDrifted : null],
          ['log',     'Restore Log',   null],
          ['history', 'Baseline History', null],
        ].map(([key, label, badge]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px
              ${tab===key ? 'border-brand-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {label}
            {badge != null && (
              <span className="ml-1.5 bg-red-900 text-red-300 text-xs px-1.5 py-0.5 rounded-full">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Configuration tab ─────────────────────────────────────────────── */}
      {tab === 'compare' && (
        <div className="space-y-4">

          {/* No data */}
          {!hasAnyData && (
            <EmptyState icon={RefreshCw} title="No data yet"
              body="Pull the live configuration to see what exists in this area, then set a baseline to start drift monitoring."
              action={
                <button onClick={pull} disabled={pulling} className="btn-secondary mx-auto">
                  <RefreshCw size={12} className={pulling ? 'animate-spin' : ''}/>
                  {pulling ? 'Pulling…' : 'Pull Live Data'}
                </button>
              }
            />
          )}

          {/* No baseline yet — prompt to set one */}
          {hasAnyData && !hasBaseline && (
            <div className="flex items-start gap-3 bg-yellow-950/20 border border-yellow-900/40 rounded-xl px-4 py-3 text-sm">
              <AlertTriangle size={15} className="text-yellow-400 shrink-0 mt-0.5"/>
              <div>
                <span className="text-yellow-300 font-medium">No baseline set.</span>
                <span className="text-yellow-400/70 ml-2">
                  Showing all live resources below. Click <strong className="text-white">Set Baseline</strong> to choose which resources to monitor and enable drift detection.
                </span>
              </div>
            </div>
          )}

          {/* Drift summary strip */}
          {hasBaseline && drift && (
            <>
              {/* All-clean banner replaces the grid when fully clean */}
              {driftedCount === 0 && missingCount === 0 && cleanCount > 0 ? (
                <div className="flex items-center gap-3 bg-green-950/20 border border-green-900/40 rounded-xl px-4 py-3">
                  <CheckCircle size={16} className="text-green-400 shrink-0"/>
                  <div>
                    <span className="text-sm font-medium text-green-300">All clean</span>
                    <span className="text-xs text-green-500/70 ml-2">{cleanCount} resource{cleanCount !== 1 ? 's' : ''} match baseline</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      label:   'Drifted',
                      value:   driftedCount,
                      color:   driftedCount>0 ? 'text-red-400' : 'text-gray-500',
                      border:  driftedCount>0 ? 'border-red-900/60' : 'border-gray-800',
                      desc:    'Drifted from desired baseline',
                      tooltip: 'Resources whose current configuration no longer matches the saved baseline.',
                    },
                    {
                      label:   'Clean',
                      value:   cleanCount,
                      color:   'text-green-400',
                      border:  'border-gray-800',
                      desc:    'Matches desired baseline',
                      tooltip: 'Resources whose current configuration exactly matches the saved baseline.',
                    },
                    {
                      label:   'Missing',
                      value:   missingCount,
                      color:   missingCount>0 ? 'text-orange-400' : 'text-gray-500',
                      border:  missingCount>0 ? 'border-orange-900/60' : 'border-gray-800',
                      desc:    'No longer exists in tenant',
                      tooltip: 'Resources that were in the baseline but can no longer be found in the tenant.',
                    },
                  ].map(({ label, value, color, border, desc, tooltip }) => (
                    <div key={label} title={tooltip}
                      className={`card-sm text-center border cursor-default group relative ${border}`}>
                      <div className={`text-xl font-bold ${color}`}>{value}</div>
                      <div className="text-xs text-gray-400 mt-0.5 font-medium">{label}</div>
                      <div className="text-xs text-gray-600 mt-1 leading-tight">{desc}</div>
                      {/* Hover tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 shadow-xl
                        opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 leading-relaxed">
                        {tooltip}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700"/>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Webhook delivery status for this drift check */}
              <div className="card-sm border border-gray-800 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">Webhook Notification Status</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Last attempt: <span className="text-gray-400">{formatTimestamp(webhookDeliverySummary.lastAttemptAt)}</span>
                    </div>
                  </div>
                  {webhookDeliveries.length > 0 && (
                    <button
                      onClick={() => setWebhookDetailsOpen(v => !v)}
                      className="text-xs text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
                    >
                      {webhookDetailsOpen ? 'Hide details' : `Show details (${webhookDeliveries.length})`}
                      <ChevronDown size={12} className={`transition-transform ${webhookDetailsOpen ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-2 py-2">
                    <div className="text-sm font-semibold text-white">{webhookDeliverySummary.attempted}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">Attempted</div>
                  </div>
                  <div className="rounded-lg border border-green-900/40 bg-green-950/20 px-2 py-2">
                    <div className="text-sm font-semibold text-green-300">{webhookDeliverySummary.sent}</div>
                    <div className="text-[11px] text-green-500/80 mt-0.5">Sent</div>
                  </div>
                  <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-2 py-2">
                    <div className="text-sm font-semibold text-red-300">{webhookDeliverySummary.failed}</div>
                    <div className="text-[11px] text-red-500/80 mt-0.5">Failed</div>
                  </div>
                  <div className="rounded-lg border border-yellow-900/40 bg-yellow-950/20 px-2 py-2">
                    <div className="text-sm font-semibold text-yellow-300">{webhookDeliverySummary.notSent}</div>
                    <div className="text-[11px] text-yellow-500/80 mt-0.5">Not sent</div>
                  </div>
                </div>

                {webhookDeliveries.length === 0 && (
                  <div className="text-xs text-gray-500 bg-gray-900/30 border border-gray-800 rounded-lg px-3 py-2">
                    No webhook notification activity has been recorded for this drift result.
                  </div>
                )}

                {webhookDetailsOpen && webhookDeliveries.length > 0 && (
                  <div className="space-y-2">
                    {webhookDeliveries.map((item, idx) => {
                      const statusTone = item.outcome === 'sent'
                        ? 'bg-green-950/30 text-green-300 border-green-900/50'
                        : item.outcome === 'failed'
                          ? 'bg-red-950/30 text-red-300 border-red-900/50'
                          : 'bg-yellow-950/30 text-yellow-300 border-yellow-900/50'
                      const statusLabel = item.outcome === 'sent'
                        ? 'Sent'
                        : item.outcome === 'failed'
                          ? 'Failed'
                          : 'Not sent'
                      return (
                        <div key={`${item.webhookId || 'system'}-${idx}`} className="rounded-lg border border-gray-800 bg-gray-900/30 px-3 py-2 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-xs text-gray-200 font-medium truncate">
                              {item.webhookLabel || (item.webhookId ? `Webhook ${item.webhookId.slice(0, 8)}` : 'System event')}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-gray-500 border border-gray-800 px-1.5 py-0.5 rounded">
                                {labelWebhookMode(item.fireMode)}
                              </span>
                              <span className={`text-[11px] border px-1.5 py-0.5 rounded ${statusTone}`}>
                                {statusLabel}
                              </span>
                            </div>
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {labelWebhookReason(item.reason)}
                            {item.httpStatus ? ` · HTTP ${item.httpStatus}` : ''}
                            {item.errorMessage ? ` · ${item.errorMessage}` : ''}
                          </div>
                          <div className="text-[11px] text-gray-600">{formatTimestamp(item.attemptedAt)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Resource display */}
          {hasAnyData && (
            <div className="space-y-4">

              {/* ── Search + status filter bar ───────────────────────────── */}
              {monitoredIds.length > 4 && (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"/>
                    <input
                      className="input w-full pl-7 py-1.5 text-xs"
                      placeholder={`Search ${area?.display_name || 'resources'}…`}
                      value={resourceSearch}
                      onChange={e => setResourceSearch(e.target.value)}
                    />
                    {resourceSearch && (
                      <button onClick={() => setResourceSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                        <X size={11}/>
                      </button>
                    )}
                  </div>
                  <div className="flex border border-gray-800 rounded-lg overflow-hidden shrink-0">
                    {[['all','All'], ['drifted','Drifted'], ['clean','Clean']].map(([val, label]) => (
                      <button key={val} onClick={() => setResourceStatusFilter(val)}
                        className={`px-2.5 py-1.5 text-xs transition-colors
                          ${resourceStatusFilter === val
                            ? 'bg-brand-700/50 text-brand-300'
                            : 'text-gray-500 hover:text-gray-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {hasActiveResourceFilter && (
                    <button onClick={() => { setResourceSearch(''); setResourceStatusFilter('all') }}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors flex items-center gap-1">
                      <X size={10}/> Clear
                    </button>
                  )}
                  {hasActiveResourceFilter && (
                    <span className="text-xs text-gray-600 shrink-0">
                      {filteredSortedMonitoredIds.length} of {monitoredIds.length}
                    </span>
                  )}
                </div>
              )}
              {/* Column header */}
              {hasBaseline && (
                <div className="grid grid-cols-[1fr_24px_1fr] gap-1 text-xs font-semibold text-gray-600 px-4 py-1">
                  <span className="flex items-center gap-1.5"><ShieldCheck size={11} className="text-brand-600"/> Baseline (desired state)</span>
                  <span/>
                  <span className="flex items-center gap-1.5"><Eye size={11} className="text-gray-500"/> Live (current state)</span>
                </div>
              )}

              {/* ── Named groups first ───────────────────────────────────── */}
              {resourceGroups.map(group => {
                const groupSortedIds = [
                  ...group.resourceIds.filter(id => monitoredIds.includes(id) && ['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id]?'':'missing'))),
                  ...group.resourceIds.filter(id => monitoredIds.includes(id) && !['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id]?'':'missing'))),
                ]
                return (
                  <ResourceGroup key={group.id}
                    group={group}
                    resourceIds={groupSortedIds}
                    liveResources={liveResources}
                    baselineResources={baselineResources}
                    watchedKeys={watchedKeys}
                    driftMap={driftMap}
                    onRestore={canRestore ? restore : null}
                    restoring={restoring}
                    hasBaseline={hasBaseline}
                    monitorOnlyKeys={monitorOnlyKeys}
                    areaKey={areaKey}
                    resourceDetails={resourceDetails} />
                )
              })}

              {/* ── Ungrouped monitored resources ────────────────────────── */}
              {ungroupedMonitoredIds.length > 0 && (
                <div className="space-y-2">
                  {resourceGroups.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Other</span>
                      <div className="flex-1 h-px bg-gray-800"/>
                    </div>
                  )}
                  {ungroupedMonitoredIds.map(id => (
                    <ResourceCard key={id}
                      resourceId={id}
                      resourceName={liveResources[id]?.displayName || baselineResources[id]?.displayName || id}
                      baselineResource={baselineResources[id]}
                      liveResource={liveResources[id]}
                      watchedKeys={watchedKeys}
                      driftItem={driftMap[id]}
                      onRestore={canRestore ? restore : null}
                      restoring={restoring}
                      hasBaseline={hasBaseline}
                      monitorOnlyKeys={monitorOnlyKeys}
                      resourceDetails={resourceDetails}
                      areaKey={areaKey}
                      defaultOpen={['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id]?'':'missing'))}/>
                  ))}
                </div>
              )}

              {/* ── Resources not in baseline (live-only) — collapsed section */}
              {hasBaseline && filteredLiveOnlyIds.length > 0 && (
                <NotInBaselineSection
                  ids={filteredLiveOnlyIds}
                  liveResources={liveResources}
                  watchedKeys={watchedKeys}
                  driftMap={driftMap}
                  onNavigateBaseline={() => navigate(`/baseline-editor/${tenantId}/${areaKey}`)}/>
              )}

              {/* ── Resources in baseline but set to "No Monitoring" — collapsed */}
              {hasBaseline && noMonitoringIds.length > 0 && (
                <NoMonitoringSection
                  ids={noMonitoringIds}
                  liveResources={liveResources}
                  baselineResources={baselineResources}
                  onNavigateBaseline={() => navigate(`/baseline-editor/${tenantId}/${areaKey}`)}/>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Restore Log tab ──────────────────────────────────────────────── */}
      {tab === 'log' && (
        <div className="space-y-2">
          {restoreLog.length === 0 ? (
            <EmptyState icon={RotateCcw} title="No restores yet" body="Restore actions will appear here with a full audit trail."/>
          ) : (
            restoreLog.map(entry => {
              const typeLabel = {
                manual_property: 'Property',
                manual_full:     'Full restore',
                bulk:            'Bulk restore',
                auto:            'Auto-restore',
              }[entry.restore_type] || (entry.property_path ? 'Property' : 'Full restore')

              const typeCls = {
                manual_property: 'text-brand-300 border-brand-900/60 bg-brand-950/20',
                manual_full:     'text-violet-300 border-violet-900/60 bg-violet-950/20',
                bulk:            'text-orange-300 border-orange-900/60 bg-orange-950/20',
                auto:            'text-teal-300 border-teal-900/60 bg-teal-950/20',
              }[entry.restore_type] || 'text-gray-400 border-gray-700 bg-gray-800/50'

              let restoredProps = []
              try { restoredProps = JSON.parse(entry.restored_properties || '[]') } catch {}

              return (
                <div key={entry.id} className={`border rounded-xl overflow-hidden ${entry.success ? 'border-gray-800' : 'border-red-900/50'}`}>
                  <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/30">
                    {/* Status badge */}
                    <span className={`text-xs px-2 py-0.5 rounded border shrink-0 font-medium
                      ${entry.success ? 'text-green-400 border-green-900 bg-green-950/30' : 'text-red-400 border-red-900 bg-red-950/30'}`}>
                      {entry.success ? 'OK' : 'FAIL'}
                    </span>

                    {/* Type badge */}
                    <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${typeCls}`}>
                      {typeLabel}
                    </span>

                    {/* Resource name + property */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">
                        {entry.resource_name || entry.resource_id}
                      </div>
                      {entry.property_path && (
                        <div className="text-xs text-gray-500 mt-0.5 font-mono truncate">
                          → {entry.property_path}
                        </div>
                      )}
                      {!entry.property_path && restoredProps.length > 0 && (
                        <div className="text-xs text-gray-600 mt-0.5 truncate">
                          {restoredProps.length} propert{restoredProps.length !== 1 ? 'ies' : 'y'} restored
                        </div>
                      )}
                    </div>

                    <span className="text-gray-600 text-xs shrink-0">{new Date(entry.restored_at).toLocaleString()}</span>
                  </div>

                  {/* Error detail */}
                  {!entry.success && entry.error_message && (
                    <div className="px-4 py-2 border-t border-red-900/30 bg-red-950/10">
                      <p className="text-xs text-red-400 font-mono">{entry.error_message}</p>
                    </div>
                  )}

                  {/* Restored properties detail — show for full/bulk/auto restores */}
                  {entry.success && restoredProps.length > 0 && !entry.property_path && (
                    <div className="px-4 py-2 border-t border-gray-800 bg-gray-900/20">
                      <div className="flex flex-wrap gap-1.5">
                        {restoredProps.slice(0, 8).map((p, i) => (
                          <span key={i} className="text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded font-mono">
                            {typeof p === 'object' ? p.path : p}
                          </span>
                        ))}
                        {restoredProps.length > 8 && (
                          <span className="text-xs text-gray-600">+{restoredProps.length - 8} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── Baseline History tab ─────────────────────────────────────────── */}
      {tab === 'history' && (
        <BaselineHistoryTab tenantId={tenantId} areaKey={areaKey} showToast={showToast}
          onRestored={() => { setBaseline(null); loadAreaData() }}/>
      )}
    </div>
  )
}

// ── Collapsible "No Monitoring" section ──────────────────────────────────────
function NoMonitoringSection({ ids, liveResources, baselineResources, onNavigateBaseline }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full group mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">No Monitoring</span>
        <span className="text-xs text-gray-700">{ids.length} resource{ids.length!==1?'s':''} — in baseline, monitoring disabled</span>
        <div className="flex-1 h-px bg-gray-800/50"/>
        {open ? <ChevronDown size={11} className="text-gray-700"/> : <ChevronRight size={11} className="text-gray-700"/>}
      </button>
      {open && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-600 mb-2">
            These resources are included in the baseline but have monitoring mode set to None — they will not trigger drift alerts.{' '}
            <button onClick={onNavigateBaseline} className="text-brand-400 hover:underline">Edit baseline</button> to enable monitoring.
          </p>
          {ids.map(id => {
            const res = liveResources[id] || baselineResources[id]
            return (
              <div key={id} className="flex items-center gap-3 border border-gray-800/40 rounded-xl px-4 py-2.5 opacity-50">
                <Eye size={14} className="text-gray-700 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-500 truncate">{res?.displayName || id}</div>
                  <div className="text-xs text-gray-700 font-mono mt-0.5 truncate">{id}</div>
                </div>
                <span className="text-xs text-gray-700 shrink-0">Not monitored</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Baseline History tab ──────────────────────────────────────────────────────
function BaselineHistoryTab({ tenantId, areaKey, showToast, onRestored }) {
  const [history, setHistory]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [restoring, setRestoring] = useState(null)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    areaApi.getHistory(tenantId, areaKey)
      .then(setHistory)
      .catch(() => showToast('Failed to load history', 'error'))
      .finally(() => setLoading(false))
  }, [tenantId, areaKey])

  const restore = async (historyId, label) => {
    if (!confirm(`Restore baseline "${label}"? This will overwrite the current baseline (which will be archived automatically).`)) return
    setRestoring(historyId)
    try {
      await areaApi.restoreBaseline(tenantId, areaKey, historyId)
      showToast('Baseline restored from archive', 'success')
      onRestored()
    } catch { showToast('Restore failed', 'error') }
    finally { setRestoring(null) }
  }

  if (loading) return <div className="text-sm text-gray-500 py-4">Loading history…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3 text-xs text-gray-400">
        <Clock size={13} className="shrink-0 mt-0.5"/>
        Every time a baseline is saved, the previous version is automatically archived here. Restore any version — the current baseline is archived before the restore.
      </div>

      {history.length === 0 ? (
        <div className="card text-center py-8">
          <Clock size={32} className="text-gray-700 mx-auto mb-2"/>
          <p className="text-gray-500 text-sm">No archived versions yet.</p>
          <p className="text-gray-600 text-xs mt-1">History is created each time you save a baseline.</p>
        </div>
      ) : (
        history.map(h => {
          const isDeleted    = h.label?.startsWith('[Deleted]')
          const isSuperseded = h.label?.startsWith('[Superseded]')
          const isRestored   = h.label?.startsWith('[Restored]')
          return (
            <div key={h.id} className="border border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/30">
                <Clock size={13} className="text-gray-600 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{h.label || 'Baseline'}</span>
                    {isDeleted    && <span className="text-xs bg-red-950/40 border border-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Deleted</span>}
                    {isSuperseded && <span className="text-xs bg-gray-800 border border-gray-700 text-gray-500 px-1.5 py-0.5 rounded">Superseded</span>}
                    {isRestored   && <span className="text-xs bg-blue-950/40 border border-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded">Restored</span>}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    Archived {new Date(h.archived_at).toLocaleString()} · {Object.keys(h.resources || {}).length} resources
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setExpanded(expanded === h.id ? null : h.id)}
                    className="btn-secondary text-xs">
                    {expanded === h.id ? <ChevronDown size={11}/> : <ChevronRight size={11}/>} View
                  </button>
                  <button onClick={() => restore(h.id, h.label)} disabled={restoring === h.id}
                    className="btn-secondary text-xs flex items-center gap-1.5 text-blue-400 hover:text-blue-300 border-blue-900/50">
                    <RotateCcw size={11} className={restoring === h.id ? 'animate-spin' : ''}/>
                    {restoring === h.id ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              </div>
              {expanded === h.id && (
                <div className="border-t border-gray-800 px-4 py-3">
                  <p className="text-xs text-gray-500 mb-2">Archived resources ({Object.keys(h.resources || {}).length})</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {Object.entries(h.resources || {}).map(([id, res]) => (
                      <div key={id} className="flex items-center gap-2 text-xs py-1 border-b border-gray-800/50 last:border-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          (h.resourceModes?.[id] || 'none') === 'snapshot'    ? 'bg-violet-500'
                          : (h.resourceModes?.[id] || 'none') === 'properties' ? 'bg-brand-500'
                          : 'bg-gray-600'}`}/>
                        <span className="text-gray-300 truncate">{res.displayName || id}</span>
                        <span className="text-gray-600 shrink-0 font-mono ml-auto">{h.resourceModes?.[id] || 'none'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Collapsible "Not in Baseline" section ────────────────────────────────────
function NotInBaselineSection({ ids, liveResources, watchedKeys, driftMap, onNavigateBaseline }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full group mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Not in Baseline</span>
        <span className="text-xs text-gray-700">{ids.length} resource{ids.length!==1?'s':''} — excluded from monitoring</span>
        <div className="flex-1 h-px bg-gray-800/50"/>
        {open ? <ChevronDown size={11} className="text-gray-700"/> : <ChevronRight size={11} className="text-gray-700"/>}
      </button>
      {open && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-600 mb-2">
            These resources exist in the tenant but were not included in the baseline. They are not monitored for drift.{' '}
            <button onClick={onNavigateBaseline} className="text-brand-400 hover:underline">Edit baseline</button> to include them.
          </p>
          {ids.map(id => (
            <div key={id} className="flex items-center gap-3 border border-gray-800/40 rounded-xl px-4 py-2.5 opacity-50">
              <Eye size={14} className="text-gray-700 shrink-0"/>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-500 truncate">{liveResources[id]?.displayName || id}</div>
                <div className="text-xs text-gray-700 font-mono mt-0.5 truncate">{id}</div>
              </div>
              <span className="text-xs text-gray-700 shrink-0">Not monitored</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

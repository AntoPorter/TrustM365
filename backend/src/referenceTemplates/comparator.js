const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

function normalizeValue(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return '';
  const low = s.toLowerCase();
  if (['enabled','true','on','yes','1'].includes(low)) return 'true';
  if (['disabled','false','off','no','0'].includes(low)) return 'false';
  if (/^-?\d+$/.test(low)) return Number(low);
  return low;
}

function normalizeForCompare(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '') return '';
  const low = s.toLowerCase();

  // If value looks like a Graph machine token (contains underscores), prefer the
  // last suffix token as the meaningful value (e.g. ..._block, ..._true, ..._1)
  const sufMatch = low.match(/_([^_]+)$/);
  const token = sufMatch ? sufMatch[1].replace(/[^a-z0-9]+/g,'') : low.replace(/[^a-z0-9]+/g,'');

  const map = {
    'true': true, 'false': false,
    'enabled': true, 'disabled': false, 'on': true, 'off': false,
    'allowed': 'allow', 'allow': 'allow',
    'block': 'block', 'blocked': 'block',
    'audit': 'audit', 'auditmode': 'audit',
    'warn': 'warn'
  };

  if (/^[0-9]+$/.test(token)) return Number(token);
  if (map[token] !== undefined) return map[token];

  // Common "not configured" tokens should be treated as null
  if (['notconfigured','not_configured','not configured','na','n/a','notapplicable','not-applicable'].includes(low)) return null;

  // Fallback: return normalized alphanumeric string
  return low.replace(/[^a-z0-9]+/g,'');
}

function findMatchingSetting(templateSetting, actualSettings) {
  const exact = actualSettings.find(s => (s.name || '').trim().toLowerCase() === (templateSetting.title || '').trim().toLowerCase());
  if (exact) return exact;
  const tslug = slugify(templateSetting.title || '');
  const slugMatch = actualSettings.find(s => slugify(s.name) === tslug);
  if (slugMatch) return slugMatch;
  const contains = actualSettings.find(s => {
    const a = (s.name || '').toLowerCase();
    const t = (templateSetting.title || '').toLowerCase();
    return a && t && (a.includes(t) || t.includes(a));
  });
  if (contains) return contains;
  return null;
}

function compareTemplateWithPolicy(template, policy) {
  const actualSettings = (policy.settings || []).map(s => ({
    name: s.name || s.Name || s.Title || '',
    value: s.value !== undefined ? s.value : (s.Value !== undefined ? s.Value : '')
  }));

  const report = (template.settings || []).map(ts => {
    const match = findMatchingSetting(ts, actualSettings);
    const actual = match ? match.value : null;
    const normActual = normalizeValue(actual);
    const normRecommended = normalizeValue(ts.recommended_value);
    let status = 'missing';
    if (actual !== null) {
      if (normActual === normRecommended) status = 'compliant';
      else status = 'non-compliant';
    }
    return {
      control_id: ts.control_id || (template.id ? `${template.id}:${slugify(ts.title)}` : slugify(ts.title)),
      title: ts.title,
      recommended_value: ts.recommended_value,
      actual_value: actual,
      status,
      mdm_csp: ts.mdm_csp || null,
      registry_key: ts.registry_key || null,
      notes: ts.notes || null
    };
  });

  return report;
}

function getByPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (let p of parts) {
    if (cur === undefined || cur === null) return undefined;

    const sel = p.match(/^([^\[]+)\[([^=]+)=([^\]]+)\]$/);
    if (sel) {
      const prop = sel[1];
      const idProp = sel[2];
      const idVal = sel[3];
      // support multiple storage shapes: `settings` may be an array, or there
      // may be an alternate array like `settings_array` produced by the mapper
      let arr = cur[prop];
      if (!Array.isArray(arr)) {
        const altNames = [`${prop}_array`, `${prop}_list`, `${prop}_items`, `${prop}Array`, `${prop}List`, `${prop}_arr`];
        for (const a of altNames) {
          if (Array.isArray(cur[a])) { arr = cur[a]; break; }
        }
      }
      if (!Array.isArray(arr)) return undefined;
      const found = arr.find(el => String((el && el[idProp]) ?? '') === String(idVal));
      cur = found;
      continue;
    }

    if (Array.isArray(cur) && /^[0-9]+$/.test(p)) {
      cur = cur[Number(p)];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

function extractSettingValue(el) {
  if (el === undefined || el === null) return undefined;
  let raw;
  if (el.value !== undefined) raw = el.value;
  else if (el.Value !== undefined) raw = el.Value;
  else if (el.settingInstance && el.settingInstance.value !== undefined) raw = el.settingInstance.value;
  else if (el.settingInstance && el.settingInstance.choiceSettingValue && el.settingInstance.choiceSettingValue.value !== undefined) raw = el.settingInstance.choiceSettingValue.value;
  else if (el.choiceSettingValue && el.choiceSettingValue.value !== undefined) raw = el.choiceSettingValue.value;
  else if (el.settingInstance && el.settingInstance.intValue !== undefined) raw = el.settingInstance.intValue;
  else if (el.intValue !== undefined) raw = el.intValue;
  else raw = el;

  // Normalize common Graph machine tokens to friendly values for comparison
  if (typeof raw === 'string') return normalizeForCompare(raw);
  return raw;
}

function normalizeSettingDefinitionId(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9_]+/g, '');
}

function stripSettingNumericSuffix(v) {
  const n = normalizeSettingDefinitionId(v);
  return n.replace(/_[0-9]+$/, '');
}

function getTemplateExpectedValue(setting) {
  if (!setting || typeof setting !== 'object') return undefined;
  if (setting.recommended_value !== undefined) return setting.recommended_value;
  if (setting.recommendedValue !== undefined) return setting.recommendedValue;
  if (setting.value !== undefined) return setting.value;
  return undefined;
}

function getTemplateSettingByDefinitionId(template, settingDefinitionId) {
  const target = stripSettingNumericSuffix(settingDefinitionId);
  if (!target) return null;
  const settings = Array.isArray(template && template.settings) ? template.settings : [];
  for (const s of settings) {
    const sid = stripSettingNumericSuffix(
      s && (s.settingDefinitionId || s.setting_definition_id || s.settingDefinitionID || s.settingDefinition)
    );
    if (sid && sid === target) return s;
  }
  return null;
}

function getLiveValueBySettingDefinitionId(resource, settingDefinitionId) {
  const target = stripSettingNumericSuffix(settingDefinitionId);
  if (!target || !resource || !Array.isArray(resource.settings)) return undefined;
  const found = resource.settings.find(el => {
    const sid = stripSettingNumericSuffix(
      el && (el.settingDefinitionId || (el.settingInstance && el.settingInstance.settingDefinitionId) || el.settingDefinitionID || el.settingDefinition)
    );
    return sid && sid === target;
  });
  if (!found) return undefined;
  return extractSettingValue(found);
}

function parseAnchorSettingDefinitionId(path) {
  const am = String(path || '').match(/^anchor:settingDefinitionId:(.+)$/);
  return am ? am[1] : null;
}

function deriveCanonicalRelevantForRef(refKey, ref, template) {
  const settings = Array.isArray(template && template.settings) ? template.settings : [];
  if (!settings.length) return [];

  const candidates = new Set();
  const pushCandidate = (v) => {
    const normalized = stripSettingNumericSuffix(v);
    if (normalized) candidates.add(normalized);
  };

  pushCandidate(refKey);
  pushCandidate(ref && ref.settingDefinitionId);
  pushCandidate(ref && ref.setting_definition_id);
  pushCandidate(ref && ref.settingDefinition);
  pushCandidate(ref && ref.id);

  const out = [];
  for (const setting of settings) {
    const sidRaw = setting && (setting.settingDefinitionId || setting.setting_definition_id || setting.settingDefinitionID || setting.settingDefinition);
    const sid = stripSettingNumericSuffix(sidRaw);
    if (!sid || !candidates.has(sid)) continue;
    out.push({
      path: `anchor:settingDefinitionId:${sidRaw || sid}`,
      label: setting.title || sidRaw || sid,
      match: 'equals',
    });
  }

  return out;
}

function findSettingInArrayByHints(arr, { propName, label }, templateSetting) {
  // optional third parameter for templateSetting can be passed to improve matching
  if (!Array.isArray(arr)) return null;
  const normalizeKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const normal = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const tokens = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const templateMdm = templateSetting ? normalizeKey(templateSetting.mdm_csp || templateSetting.mdmCsp || templateSetting.mdmCSP || '') : null;
  const templateRegistry = templateSetting ? normalizeKey(templateSetting.registry_key || templateSetting.registryKey || templateSetting.registry || '') : null;
  const pnorm = normal(propName || '');
  const lnorm = normal(label || '');
  const pTokens = tokens(propName || '').filter(t => !/^[0-9]+$/.test(t));
  const lTokens = tokens(label || '').filter(t => !/^[0-9]+$/.test(t));
  // Collect scored candidates rather than returning the first match so we can
  // prefer the best token-match when multiple nested children exist.
  const candidates = [];
  function makeCandidate(el, score) {
    const sid = String(el && (el.settingDefinitionId || (el.settingInstance && el.settingInstance.settingDefinitionId) || el.settingDefinitionID || el.settingDefinition || '')).toLowerCase().replace(/[^a-z0-9]+/g,'');
    const name = String(el && (el.name || el.Name || el.title || el.Title || '')).toLowerCase().replace(/[^a-z0-9]+/g,'');
    return { el, score, sid, name };
  }
  function scoreCandidate(el) {
    if (!el) return 0;
    const sid = String(el.settingDefinitionId || (el.settingInstance && el.settingInstance.settingDefinitionId) || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
    const name = String(el.name || el.Name || el.title || el.Title || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
    let score = 0;
    for (const t of lTokens) if (t && sid.includes(t)) score += 3;
    for (const t of lTokens) if (t && name.includes(t)) score += 1;
    for (const t of pTokens) if (t && sid.includes(t)) score += 2;
    if (lnorm && sid === lnorm) score += 20;
    if (pnorm && sid === pnorm) score += 18;
    if (lnorm && sid.startsWith(lnorm)) score += 8;
    if (pnorm && sid.startsWith(pnorm)) score += 7;
    // prefer candidates that expose mdm_csp or registry_key matching the template
    const elMdm = String(el.mdm_csp || el.mdmCsp || el.mdmCSP || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
    const elRegistry = String(el.registry_key || el.registryKey || el.registry || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
    if (templateMdm && elMdm && elMdm.includes(templateMdm)) score += 6;
    if (templateRegistry && elRegistry && elRegistry.includes(templateRegistry)) score += 5;
    return score;
  }

  for (const el of arr) {
    // If template provided, check mdm_csp/registry_key exact matches first
    if (templateSetting) {
      const elM = String(el.mdm_csp || el.mdmCsp || el.mdmCSP || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
      const elR = String(el.registry_key || el.registryKey || el.registry || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
      if (templateMdm && elM && elM.includes(templateMdm)) { candidates.push(makeCandidate(el, 50)); continue; }
      if (templateRegistry && elR && elR.includes(templateRegistry)) { candidates.push(makeCandidate(el, 45)); continue; }
    }
    // direct definition id on element
    if (el && (el.settingDefinitionId || el.settingDefinitionID || el.settingDefinition)) {
      const sidRaw = String(el.settingDefinitionId || el.settingDefinitionID || el.settingDefinition).toLowerCase();
      const sid = sidRaw.replace(/[^a-z0-9]+/g,'');
      const sidMatchesPTokens = pTokens.length > 0 ? pTokens.every(t => sid.includes(t)) : false;
      const sidMatchesLTokens = lTokens.length > 0 ? lTokens.every(t => sid.includes(t)) : false;
      if (sid && (((pnorm) && sid.includes(pnorm)) || ((lnorm) && sid.includes(lnorm)) || sidMatchesPTokens || sidMatchesLTokens)) candidates.push(makeCandidate(el, scoreCandidate(el) + 10));
    }

    // try element name/title
    const en = String(el.name || el.Name || el.title || el.Title || '').toLowerCase();
    if (en) {
      if (pnorm && en.includes(pnorm)) candidates.push(makeCandidate(el, scoreCandidate(el) + 5));
      if (lnorm && en.includes(lnorm)) candidates.push(makeCandidate(el, scoreCandidate(el) + 5));
      if (pnorm && pnorm.includes(en)) candidates.push(makeCandidate(el, scoreCandidate(el) + 3));
    }

    // inspect nested settingInstance metadata and descend into child collections
    const inst = el.settingInstance || el.SettingInstance || null;
    if (inst) {
      const iid = String(inst.settingDefinitionId || inst.settingDefinitionID || '').toLowerCase();
      if (iid && (pnorm && iid.includes(pnorm) || lnorm && iid.includes(lnorm))) candidates.push(makeCandidate(el, scoreCandidate(el) + 4));

      // groupSettingCollectionValue -> children (ASR uses grouped children)
      if (Array.isArray(inst.groupSettingCollectionValue)) {
        for (const grp of inst.groupSettingCollectionValue) {
          const children = grp.children || grp.childSettings || [];
          for (const child of children) {
            const sc = scoreCandidate(child);
            if (sc > 0) candidates.push(makeCandidate(child, sc + 2));
            // deeper nested children
            const nested = (child.choiceSettingValue && child.choiceSettingValue.children) || child.children || [];
            if (Array.isArray(nested)) {
              for (const gc of nested) {
                const gsc = scoreCandidate(gc);
                if (gsc > 0) candidates.push(makeCandidate(gc, gsc + 1));
              }
            }
          }
        }
      }

      // choiceSettingValue children directly under settingInstance
      if (inst.choiceSettingValue && Array.isArray(inst.choiceSettingValue.children)) {
        for (const child of inst.choiceSettingValue.children) {
          const sc = scoreCandidate(child);
          if (sc > 0) candidates.push(makeCandidate(child, sc + 2));
        }
      }
    }

    // choiceSettingValue children under element itself
    if (el.choiceSettingValue && Array.isArray(el.choiceSettingValue.children)) {
      for (const child of el.choiceSettingValue.children) {
        const sc = scoreCandidate(child);
        if (sc > 0) candidates.push(makeCandidate(child, sc + 2));
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a,b) =>
    (b.score - a.score) ||
    (Number(b.sid === lnorm) - Number(a.sid === lnorm)) ||
    (Number(b.sid === pnorm) - Number(a.sid === pnorm)) ||
    (a.sid || '').localeCompare(b.sid || '') ||
    (a.name || '').localeCompare(b.name || '')
  );
  return candidates[0].el;
}

function evalMatch(expected, actual, op) {
  const operator = op || 'equals';
  // Normalize both sides to improve matching across Graph machine tokens
  const ne = normalizeForCompare(expected);
  const na = normalizeForCompare(actual);
  if (operator === 'equals') return JSON.stringify(ne) === JSON.stringify(na);
  if (operator === 'notEquals') return JSON.stringify(ne) !== JSON.stringify(na);
  if (operator === 'exists') return actual !== undefined && actual !== null;
  if (operator === 'existsNonEmpty') {
    if (actual === undefined || actual === null) return false;
    if (Array.isArray(actual)) return actual.length > 0;
    if (typeof actual === 'string') return actual.trim().length > 0;
    if (typeof actual === 'object') return Object.keys(actual).length > 0;
    return true;
  }
  if (operator === 'includes') {
    if (Array.isArray(actual)) {
      if (Array.isArray(expected)) return expected.every(e => actual.some(a => JSON.stringify(a) === JSON.stringify(e)));
      return actual.some(a => JSON.stringify(a) === JSON.stringify(expected));
    }
    if (typeof actual === 'string' && typeof expected === 'string') return actual.includes(expected);
    return JSON.stringify(expected) === JSON.stringify(actual);
  }
  if (operator === 'notIncludes') {
    if (Array.isArray(actual)) {
      if (Array.isArray(expected)) return expected.every(e => !actual.some(a => JSON.stringify(a) === JSON.stringify(e)));
      return !actual.some(a => JSON.stringify(a) === JSON.stringify(expected));
    }
    if (typeof actual === 'string' && typeof expected === 'string') return !actual.includes(expected);
    return JSON.stringify(expected) !== JSON.stringify(actual);
  }
  if (operator === 'in') {
    if (Array.isArray(expected)) return expected.some(e => JSON.stringify(e) === JSON.stringify(actual));
    return JSON.stringify(expected) === JSON.stringify(actual);
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function normalizeLogicalKey(wkPath, wkLabel) {
  const source = wkLabel || wkPath || '';
  return String(source)
    .toLowerCase()
    .replace(/\[name=[^\]]+\]\.value/g, '')
    .replace(/\[settingdefinitionid=[^\]]+\]\.value/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'setting';
}

function collectCollectorSettings(resource) {
  const out = {};
  const visit = (node, hintPath = 'settings') => {
    if (!node) return;
    const sid = String(node.settingDefinitionId || (node.settingInstance && node.settingInstance.settingDefinitionId) || '').trim();
    const name = String(node.name || node.Name || node.title || node.Title || '').trim();
    const value = extractSettingValue(node);
    if (sid || name) {
      const label = sid || name;
      const logicalKey = normalizeLogicalKey('', label);
      if (!out[logicalKey] && value !== undefined) {
        out[logicalKey] = {
          logicalKey,
          label,
          actual: value,
          collectorPath: hintPath,
        };
      }
    }

    const inst = node.settingInstance || node.SettingInstance;
    if (inst && Array.isArray(inst.groupSettingCollectionValue)) {
      inst.groupSettingCollectionValue.forEach((grp, gIdx) => {
        const children = grp && (grp.children || grp.childSettings || []);
        if (Array.isArray(children)) {
          children.forEach((child, cIdx) => visit(child, `${hintPath}.groupSettingCollectionValue.${gIdx}.children.${cIdx}`));
        }
      });
    }

    const instChildren = inst && inst.choiceSettingValue && Array.isArray(inst.choiceSettingValue.children)
      ? inst.choiceSettingValue.children
      : [];
    instChildren.forEach((child, idx) => visit(child, `${hintPath}.settingInstance.choiceSettingValue.children.${idx}`));

    const choiceChildren = node.choiceSettingValue && Array.isArray(node.choiceSettingValue.children)
      ? node.choiceSettingValue.children
      : [];
    choiceChildren.forEach((child, idx) => visit(child, `${hintPath}.choiceSettingValue.children.${idx}`));

    if (Array.isArray(node.children)) {
      node.children.forEach((child, idx) => visit(child, `${hintPath}.children.${idx}`));
    }
  };

  const arr = resource && Array.isArray(resource.settings) ? resource.settings : [];
  arr.forEach((el, idx) => visit(el, `settings.${idx}`));
  return out;
}

function summarizeMappings(rows) {
  const totalSettings = rows.length;
  const matchedSettings = rows.filter(r => r.status === 'matched').length;
  const partialSettings = 0;
  const extraSettings = rows.filter(r => r.status === 'extra').length;
  const noMatchSettings = rows.filter(r => r.status === 'noMatch').length + rows.filter(r => r.status === 'partial').length + extraSettings;
  return { totalSettings, matchedSettings, partialSettings, noMatchSettings, extraSettings };
}

function buildSettingMappings(relevant, perKeyEvidence, liveMap) {
  const groups = {};
  for (const wk of (relevant || [])) {
    const path = typeof wk === 'string' ? wk : wk.path;
    const label = (wk && wk.label) || null;
    const logicalKey = normalizeLogicalKey(path, label);
    if (!groups[logicalKey]) groups[logicalKey] = { logicalKey, label: label || logicalKey, paths: [] };
    groups[logicalKey].paths.push(path);
  }

  const groupList = Object.values(groups);
  const candidatePolicyIds = new Set();
  for (const path of Object.keys(perKeyEvidence || {})) {
    for (const [resourceId, ev] of Object.entries(perKeyEvidence[path] || {})) {
      if (!ev) continue;
      if (ev.ok || (ev.actual !== undefined && ev.actual !== null)) candidatePolicyIds.add(resourceId);
    }
  }
  if (candidatePolicyIds.size === 0) {
    for (const id of Object.keys(liveMap || {})) candidatePolicyIds.add(id);
  }

  const settingMappingsByPolicy = {};
  const counterpartPolicies = [];

  for (const policyId of candidatePolicyIds) {
    const counterpart = liveMap && liveMap[policyId] ? liveMap[policyId] : null;
    const rows = [];

    for (const group of groupList) {
      const entries = [];
      for (const path of group.paths) {
        const ev = (perKeyEvidence[path] || {})[policyId];
        if (ev) entries.push({ path, resourceId: policyId, ...ev });
      }

      const hasMatched = entries.some(e => e.ok === true);
      const hasObserved = entries.some(e => e.actual !== undefined && e.actual !== null);
      const status = hasMatched ? 'matched' : 'noMatch';
      const comparisonReason = hasMatched ? 'match' : (hasObserved ? 'valueMismatch' : 'missingSetting');
      const primary =
        entries.find(e => e.ok === true) ||
        entries.find(e => e.actual !== undefined && e.actual !== null) ||
        entries[0] ||
        null;

      rows.push({
        logicalKey: group.logicalKey,
        label: group.label,
        status,
        comparisonReason,
        expected: primary ? primary.expected : undefined,
        actual: primary ? primary.actual : undefined,
        referencePath: primary ? primary.path : (group.paths[0] || null),
        collectorPath: primary ? primary.path : null,
        operator: primary ? primary.operator : 'equals',
        counterpart: {
          id: policyId,
          displayName: (counterpart && (counterpart.displayName || counterpart.name)) || (primary && primary.displayName) || policyId,
        },
        variants: group.paths,
      });
    }

    const templateKeys = new Set(groupList.map(g => g.logicalKey));
    const extras = collectCollectorSettings(counterpart);
    for (const extra of Object.values(extras)) {
      if (templateKeys.has(extra.logicalKey)) continue;
      rows.push({
        logicalKey: extra.logicalKey,
        label: extra.label,
        status: 'extra',
        comparisonReason: 'extraInCollector',
        expected: undefined,
        actual: extra.actual,
        referencePath: null,
        collectorPath: extra.collectorPath,
        operator: 'equals',
        counterpart: {
          id: policyId,
          displayName: (counterpart && (counterpart.displayName || counterpart.name)) || policyId,
        },
        variants: [],
      });
    }

    settingMappingsByPolicy[policyId] = rows;
    const summary = summarizeMappings(rows);
    counterpartPolicies.push({
      id: policyId,
      displayName: (counterpart && (counterpart.displayName || counterpart.name)) || policyId,
      summary,
    });
  }

  counterpartPolicies.sort((a, b) =>
    (b.summary.matchedSettings - a.summary.matchedSettings) ||
    (b.summary.partialSettings - a.summary.partialSettings) ||
    (a.summary.noMatchSettings - b.summary.noMatchSettings) ||
    String(a.displayName || a.id).localeCompare(String(b.displayName || b.id))
  );

  const defaultPolicyId = counterpartPolicies[0] ? counterpartPolicies[0].id : null;
  const settingMappings = defaultPolicyId ? (settingMappingsByPolicy[defaultPolicyId] || []) : [];
  const settingSummary = summarizeMappings(settingMappings);

  return { settingMappings, settingSummary, counterpartPolicies, settingMappingsByPolicy, defaultPolicyId };
}

function buildSettingMappingsFromPerKeyMatches(relevant, perKeyMatches, liveMap) {
  const perKeyEvidence = {};
  for (const wk of (relevant || [])) {
    const path = typeof wk === 'string' ? wk : wk.path;
    const label = (wk && wk.label) || null;
    perKeyEvidence[path] = {};
    const matches = Array.isArray(perKeyMatches && perKeyMatches[path]) ? perKeyMatches[path] : [];
    for (const m of matches) {
      const id = m && m.id ? m.id : null;
      if (!id) continue;
      perKeyEvidence[path][id] = {
        expected: undefined,
        actual: undefined,
        operator: 'equals',
        ok: true,
        displayName: (m && m.displayName) || id,
        path,
        label,
      };
    }
  }
  return buildSettingMappings(relevant, perKeyEvidence, liveMap);
}

let testsModule = {};
try {
  // Optional module: may be absent in lean/release builds.
  testsModule = require('./tests');
} catch (err) {
  testsModule = {};
}

async function compareTemplateResources(template, liveMap) {
  const watched = template.watched_keys || [];
  const refResources = template.resources || {};
  const items = [];

  for (const refKey of Object.keys(refResources)) {
    const ref = refResources[refKey];

    // If the resource declares a server-side custom test (testId), run that
    // implementation and use its result instead of watched_keys matching.
    if (ref && ref.testId && testsModule && typeof testsModule[ref.testId] === 'function') {
      try {
        const res = await testsModule[ref.testId]({ liveMap, template, resource: ref });
        const status = res && res.status ? res.status : 'noMatch';
        const relevantFiltered = (watched || []).filter(wk => {
          const path = typeof wk === 'string' ? wk : wk.path;
          if (String(path || '').startsWith('anchor:')) return true;
          return getByPath(ref, path) !== undefined;
        });
        const matchAll = (res && Array.isArray(res.matchAll)) ? res.matchAll : [];
        const matchedSamples = (res && Array.isArray(res.matchedSamples)) ? res.matchedSamples.slice(0,3) : [];
        const presentInPolicies = (res && Array.isArray(res.presentInPolicies)) ? res.presentInPolicies : [];
        const perKeyMatches = res && res.perKeyMatches ? res.perKeyMatches : {};
        const fallbackWatched = (watched || []).map(wk => (typeof wk === 'string' ? { path: wk, label: wk } : wk)).filter(wk => wk && wk.path);
        const relevant = (Array.isArray(relevantFiltered) && relevantFiltered.length > 0)
          ? relevantFiltered
          : (Object.keys(perKeyMatches).length > 0
            ? Object.keys(perKeyMatches).map(path => ({ path, label: path }))
            : fallbackWatched);
        const matchedCount = (typeof res.matchedCount === 'number') ? res.matchedCount : matchAll.length;
        const settingsCoverage = buildSettingMappingsFromPerKeyMatches(relevant, perKeyMatches, liveMap);
        const settingMappings = settingsCoverage.settingMappings;
        const settingSummary = settingsCoverage.settingSummary;
        const counterpartPolicies = settingsCoverage.counterpartPolicies;
        const settingMappingsByPolicy = settingsCoverage.settingMappingsByPolicy;
        const defaultPolicyId = settingsCoverage.defaultPolicyId;
        items.push({ refId: refKey, refDisplayName: ref.displayName || '', status, matchAll, perKeyMatches, matchedCount, matchedSamples, presentInPolicies, detail: res && res.detail ? res.detail : '', settingMappings, settingSummary, counterpartPolicies, settingMappingsByPolicy, defaultPolicyId });
        continue;
      } catch (err) {
        items.push({ refId: refKey, refDisplayName: ref.displayName || '', status: 'error', detail: err && err.message ? err.message : 'Test execution failed' });
        continue;
      }
    }

    const relevantFromWatched = (watched || []).filter(wk => {
      const path = typeof wk === 'string' ? wk : wk.path;
      if (String(path || '').startsWith('anchor:')) return true;
      return getByPath(ref, path) !== undefined;
    });

    const canonicalRelevant = deriveCanonicalRelevantForRef(refKey, ref, template);
    const relevant = (Array.isArray(relevantFromWatched) ? relevantFromWatched : []).concat(canonicalRelevant || []);

    if (!Array.isArray(relevant) || relevant.length === 0) {
      items.push({ refId: refKey, status: 'no_watched_keys' });
      continue;
    }

    const matchAll = [];
    const perKeyMatches = {};
    const perKeyEvidence = {};
    for (const wk of relevant) perKeyMatches[wk.path] = [];
    for (const wk of relevant) perKeyEvidence[wk.path] = {};

    for (const [lid, lres] of Object.entries(liveMap || {})) {
      let allMatch = true;
      for (const wk of relevant) {
        const path = typeof wk === 'string' ? wk : wk.path;
        const anchorSettingDefinitionId = parseAnchorSettingDefinitionId(path);
        let refVal = anchorSettingDefinitionId
          ? (getTemplateExpectedValue(getTemplateSettingByDefinitionId(template, anchorSettingDefinitionId)))
          : getByPath(ref, path);
        let liveVal = anchorSettingDefinitionId
          ? getLiveValueBySettingDefinitionId(lres, anchorSettingDefinitionId)
          : getByPath(lres, path);
        // Fallback: if live value not found and the live resource exposes settings as an array,
        // try to locate by settingDefinitionId or by name/title heuristics inside the array.
        if ((liveVal === undefined || liveVal === null) && lres && Array.isArray(lres.settings)) {
          const propMatch = String(path || '').match(/^settings\.([A-Za-z0-9_]+)$/);
          const selectorMatch = String(path || '').match(/^settings\[(name|settingDefinitionId)=([^\]]+)\]\.value$/i);
          const label = wk.label || (selectorMatch ? selectorMatch[2] : null) || (wk.path && String(wk.path).split('.').slice(-1)[0]) || null;
          const propName = propMatch ? propMatch[1] : (selectorMatch ? selectorMatch[2] : null);
          const templateSettingForLabel = (template.settings || []).find(s => {
            const t = (s.title || s.control_id || s.settingDefinitionId || '').toString().toLowerCase();
            const l = (label || '').toString().toLowerCase();
            return t === l || (t && l && (t.includes(l) || l.includes(t))) || String(s.settingDefinitionId || '').toLowerCase().includes(l) || (s.mdm_csp && String(s.mdm_csp).toLowerCase().includes(l));
          });
          // Quick heuristic: try to find an array element whose name/definition
          // includes the template label (without numeric suffix). This helps
          // property-style watchers (e.g., `settings.defenderRequireCloudProtection`)
          // match array-based collector payloads where elements use vendor tokens.
          let found = null;
          try {
            if (label) {
              const labelCore = String(label).toLowerCase().replace(/_[0-9]+$/,'').replace(/[^a-z0-9]+/g,'');
              found = (lres.settings || []).find(el => {
                if (!el) return false;
                const cand = String(el.name || el.settingDefinitionId || el.title || el.Name || el.settingDefinition || el.settingDefinitionID || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
                return cand && cand.includes(labelCore);
              });
            }
          } catch (e) { found = null; }

          if (!found && selectorMatch && selectorMatch[1].toLowerCase() === 'settingdefinitionid') {
            const target = String(selectorMatch[2] || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
            found = (lres.settings || []).find(el => {
              const sid = String(el.settingDefinitionId || (el.settingInstance && el.settingInstance.settingDefinitionId) || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
              return sid && sid === target;
            }) || null;
          }

          if (!found) {
            found = findSettingInArrayByHints(lres.settings, { propName, label }, templateSettingForLabel);
          }
          // (no-op) fallback matching
          if (found) liveVal = extractSettingValue(found);
          // If the live value is a numeric token (Graph enumerations) and the
          // template setting provides `allowed_values`, try to map the numeric
          // suffix to the corresponding allowed label (1-based or 0-based).
          try {
            const templateSetting = (template.settings || []).find(s => {
              const t = (s.title || '').toLowerCase();
              const l = (label || '').toString().toLowerCase();
              return t === l || t.includes(l) || l.includes(t);
            });
            if ((typeof liveVal === 'number' || (/^[0-9]+$/.test(String(liveVal || '')))) && templateSetting && Array.isArray(templateSetting.allowed_values)) {
              const n = typeof liveVal === 'number' ? liveVal : Number(String(liveVal).match(/[0-9]+$/)?.[0] || NaN);
              const av = templateSetting.allowed_values || [];
              // Map numeric token to allowed_values: prefer zero-based index, fallback to one-based
              if (!Number.isNaN(n) && av.length > 0) {
                  if (av[n] !== undefined) {
                    liveVal = av[n];
                  } else if (av[n - 1] !== undefined) {
                    liveVal = av[n - 1];
                  }
                  // Also map the template/ref value to the same allowed_values
                  try {
                    const nRef = typeof refVal === 'number' ? refVal : Number(String(refVal).match(/[0-9]+$/)?.[0] || NaN);
                    if (!Number.isNaN(nRef) && av.length > 0) {
                      if (av[nRef] !== undefined) refVal = av[nRef];
                      else if (av[nRef - 1] !== undefined) refVal = av[nRef - 1];
                    }
                  } catch (e) { /* ignore */ }
                }
            }
          } catch (e) { /* ignore mapping errors */ }
        }
        const op = wk.match || wk.operator || 'equals';
        const ok = evalMatch(refVal, liveVal, op);

        perKeyEvidence[path][lid] = {
          expected: refVal,
          actual: liveVal,
          operator: op,
          ok,
          displayName: lres.displayName || lres.name || lid,
        };
        
        if (ok) perKeyMatches[path].push({ id: lid, displayName: lres.displayName || lres.name || lid });
        if (!ok) allMatch = false;
      }
      if (allMatch) matchAll.push({ id: lid, displayName: lres.displayName || lres.name || lid });
    }

    const matchedCount = matchAll.length;
    const matchedSamples = matchAll.slice(0, 3).map(m => {
      const r = liveMap && liveMap[m.id] ? liveMap[m.id] : null;
      const matchedPaths = (relevant || []).map(wk => {
        const p = (wk && wk.path) || wk;
        if (typeof p === 'string' && p.startsWith('anchor:')) {
          const am = String(p).match(/^anchor:([^:]+):(.+)$/);
          if (am && am[1] === 'settingDefinitionId') {
            const aid = am[2];
            const ts = (template.settings || []).find(s => {
              const sid = String(s.settingDefinitionId || s.setting_definition_id || s.settingDefinitionID || s.settingDefinition || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
              return sid && sid === String(aid).toLowerCase().replace(/[^a-z0-9]+/g,'');
            });
            const expected = ts ? (ts.recommended_value !== undefined ? ts.recommended_value : (ts.value !== undefined ? ts.value : (ts.recommendedValue !== undefined ? ts.recommendedValue : undefined))) : getByPath(ref, p);
            let actual = undefined;
            if (r && Array.isArray(r.settings)) {
              const found = r.settings.find(el => {
                const sid = String(el.settingDefinitionId || (el.settingInstance && el.settingInstance.settingDefinitionId) || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
                return sid && sid === String(aid).toLowerCase().replace(/[^a-z0-9]+/g,'');
              });
              if (found) actual = extractSettingValue(found);
            } else {
              actual = getByPath(r, p);
            }
            return { path: p, expected, actual, operator: (wk && (wk.match || wk.operator)) || 'equals' };
          }
        }
        return { path: p, expected: getByPath(ref, p), actual: getByPath(r, p), operator: (wk && (wk.match || wk.operator)) || 'equals' };
      });
      return { id: m.id, displayName: m.displayName || m.id, area_key: template.area_key, matchedPaths };
    });
    const presentInPolicies = matchAll.map(m => m.displayName || m.id);
    const settingsCoverage = buildSettingMappings(relevant, perKeyEvidence, liveMap);
    const settingMappings = settingsCoverage.settingMappings;
    const settingSummary = settingsCoverage.settingSummary;
    const counterpartPolicies = settingsCoverage.counterpartPolicies;
    const settingMappingsByPolicy = settingsCoverage.settingMappingsByPolicy;
    const defaultPolicyId = settingsCoverage.defaultPolicyId;

    // Determine partial matches (any watched_key present) and build matchAny summary
    const anyKeyMatches = Object.values(perKeyMatches || {}).some(arr => Array.isArray(arr) && arr.length > 0);

    if (matchedCount > 0) {
      const detail = `Found in ${matchedCount} live resource(s): ${presentInPolicies.slice(0, 3).join(', ')}`;
      items.push({ refId: refKey, refDisplayName: ref.displayName || '', status: 'matched', matchAll, perKeyMatches, matchedCount, matchedSamples, presentInPolicies, detail, settingMappings, settingSummary, counterpartPolicies, settingMappingsByPolicy, defaultPolicyId });
    } else if (anyKeyMatches) {
      // Build a map of resources that matched at least one watched_key
      const matchAnyMap = {};
      for (const [p, arr] of Object.entries(perKeyMatches || {})) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          const id = e && e.id ? e.id : null;
          if (!id) continue;
          if (!matchAnyMap[id]) matchAnyMap[id] = { id, displayName: e.displayName || id, matchedPaths: [] };
          const wk = relevant.find(rw => ((rw.path || '') === p));
          // Support anchor paths when constructing matchAny matchedPaths
          if (typeof p === 'string' && p.startsWith('anchor:')) {
            const am = String(p).match(/^anchor:([^:]+):(.+)$/);
            if (am && am[1] === 'settingDefinitionId') {
              const aid = am[2];
              const ts = (template.settings || []).find(s => {
                const sid = String(s.settingDefinitionId || s.setting_definition_id || s.settingDefinitionID || s.settingDefinition || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
                return sid && sid === String(aid).toLowerCase().replace(/[^a-z0-9]+/g,'');
              });
              const expected = ts ? (ts.recommended_value !== undefined ? ts.recommended_value : (ts.value !== undefined ? ts.value : (ts.recommendedValue !== undefined ? ts.recommendedValue : undefined))) : getByPath(ref, p);
              let actual = getByPath(liveMap[id], p);
              const r = liveMap[id];
              if ((actual === undefined || actual === null) && r && Array.isArray(r.settings)) {
                const found = r.settings.find(el => {
                  const sid = String(el.settingDefinitionId || (el.settingInstance && el.settingInstance.settingDefinitionId) || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
                  return sid && sid === String(aid).toLowerCase().replace(/[^a-z0-9]+/g,'');
                });
                if (found) actual = extractSettingValue(found);
              }
              matchAnyMap[id].matchedPaths.push({ path: p, expected, actual, operator: wk ? (wk.match || wk.operator || 'equals') : 'equals' });
              continue;
            }
          }
          matchAnyMap[id].matchedPaths.push({ path: p, expected: getByPath(ref, p), actual: getByPath(liveMap[id], p), operator: wk ? (wk.match || wk.operator || 'equals') : 'equals' });
        }
      }
      const matchAny = Object.values(matchAnyMap).slice(0, 10).map(m => ({ id: m.id, displayName: m.displayName, area_key: template.area_key, matchedPaths: m.matchedPaths }));
      const matchAnyCount = Object.keys(matchAnyMap).length;
      const detail = matchAnyCount > 0 ? `Found partial matches in ${matchAnyCount} resource(s)` : 'Setting not present in any live resource';
      items.push({ refId: refKey, refDisplayName: ref.displayName || '', status: 'partial', matchAll, perKeyMatches, matchedCount: 0, matchAny, matchAnyCount, matchedSamples, presentInPolicies, detail, settingMappings, settingSummary, counterpartPolicies, settingMappingsByPolicy, defaultPolicyId });
    } else {
      const detail = 'Setting not present in any live resource';
      items.push({ refId: refKey, refDisplayName: ref.displayName || '', status: 'noMatch', matchAll, perKeyMatches, matchedCount: 0, matchedSamples, presentInPolicies, detail, settingMappings, settingSummary, counterpartPolicies, settingMappingsByPolicy, defaultPolicyId });
    }
  }

  return items;
}

module.exports = { compareTemplateWithPolicy, normalizeValue, compareTemplateResources };

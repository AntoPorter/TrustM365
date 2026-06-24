const { graphGet, graphGetAll, graphPatch, graphPost } = require('../services/graph');

// Inlined SharePoint Sites collector
const sharepointSites = {
  areaKey: 'sharepoint_sites',
  displayName: 'SharePoint Sites',
  description: 'SharePoint site collections and basic sharing settings',
  licenceRequired: null,
  readPermissions: ['Sites.Read.All'],
  writePermissions: ['Sites.Manage.All'],
  graphBasePath: '/sites',

  async pull(token) {
    let sites;
    try {
      sites = await graphGetAll(token, '/sites?search=*');
    } catch (err) {
      const single = await graphGet(token, '/sites/root').catch(() => null);
      sites = single ? [single] : [];
    }
    const resources = {};
    for (const s of sites) {
      const id = s.id || s.siteCollection?.hostname || s.webUrl || Math.random().toString(36).slice(2,10)
      const base = {
        id,
        displayName: s.displayName || s.name || s.webUrl || id,
        webUrl: s.webUrl || null,
        siteCollection: s.siteCollection || null,
        createdDateTime: s.createdDateTime || null,
      };

      try {
        const drive = await graphGet(token, `/sites/${id}/drive`).catch(() => null);
        if (drive) base.driveId = drive.id;
      } catch {}

      try {
        const perms = await graphGetAll(token, `/sites/${id}/permissions`).catch(() => []);
        if (Array.isArray(perms)) {
          base.permissionCount = perms.length;
          base.permissions = perms.slice(0, 500).map(p => {
            const entry = { id: p.id, roles: p.roles || [] };
            if (p.grantedTo) {
              const g = p.grantedTo.user || p.grantedTo;
              entry.grantedTo = g ? { id: g.id || null, displayName: g.displayName || null, email: g.email || g.userPrincipalName || null } : null;
            }
            if (p.grantedToIdentities) {
              entry.grantedToIdentities = p.grantedToIdentities.map(i => ({
                id: i?.user?.id || i?.application?.id || i?.device?.id || null,
                displayName: i?.user?.displayName || i?.application?.displayName || i?.displayName || null,
              }));
            }
            if (p.link) {
              entry.link = { scope: p.link.scope || null, webUrl: p.link.webUrl || null, type: p.link.type || null };
            }
            return entry;
          });
        }
      } catch {}

      try {
        if (base.driveId) {
          const drivePerms = await graphGetAll(token, `/drives/${base.driveId}/permissions`).catch(() => []);
          if (Array.isArray(drivePerms)) {
            base.drivePermissions = drivePerms.slice(0, 500).map(p => ({ id: p.id, roles: p.roles || [], grantedTo: p.grantedTo || null }));
          }
        } else {
          const drivePerms = await graphGetAll(token, `/sites/${id}/drive/permissions`).catch(() => []);
          if (Array.isArray(drivePerms) && drivePerms.length) {
            base.drivePermissions = drivePerms.slice(0, 500).map(p => ({ id: p.id, roles: p.roles || [], grantedTo: p.grantedTo || null }));
          }
        }
      } catch {}

      try {
        const settings = await graphGet(token, `/sites/${id}?$select=webUrl,displayName,createdDateTime` ).catch(() => null);
        if (settings) {
          base.displayName = base.displayName || settings.displayName;
          base.webUrl = base.webUrl || settings.webUrl;
        }
      } catch {}

      try {
        const anonSamples = [];
        const externalSamples = [];
        const tenantGuess = base.siteCollection && base.siteCollection.hostname
          ? String(base.siteCollection.hostname).split('.')[0]
          : null;

        const processPerm = (p) => {
          if (!p) return;
          if (p.link && p.link.scope && String(p.link.scope).toLowerCase().includes('anon')) {
            anonSamples.push({ id: p.id || null, webUrl: p.link.webUrl || p.webUrl || null, roles: p.roles || [], grantedTo: p.grantedTo || null });
          }

          const email = p.grantedTo && (p.grantedTo.email || p.grantedTo.userPrincipalName || p.grantedTo.user?.userPrincipalName);
          if (email) {
            const isExternal = tenantGuess ? !String(email).toLowerCase().includes(String(tenantGuess).toLowerCase()) : true;
            if (isExternal) externalSamples.push({ id: p.id || null, webUrl: p.link?.webUrl || p.webUrl || null, roles: p.roles || [], grantedToEmail: email });
          }

          if (Array.isArray(p.grantedToIdentities)) {
            for (const i of p.grantedToIdentities) {
              const disp = i?.user?.displayName || i?.application?.displayName || i?.displayName || '';
              if (String(disp).toLowerCase().includes('guest')) {
                externalSamples.push({ id: p.id || null, displayName: disp, roles: p.roles || [] });
              }
            }
          }
        };

        if (Array.isArray(base.permissions)) base.permissions.forEach(processPerm);
        if (Array.isArray(base.drivePermissions)) base.drivePermissions.forEach(processPerm);

        base.anonymousLinkCount = anonSamples.length;
        base.anonymousLinks = anonSamples.slice(0, 5);
        base.externalShareCount = externalSamples.length;
        base.externalShareSamples = externalSamples.slice(0, 5);

        const combined = [...anonSamples, ...externalSamples];
        const seen = new Set();
        base.topExternallyShared = combined.filter(s => {
          const key = s.webUrl || s.id || JSON.stringify(s);
          if (!key) return false;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 5);
      } catch (err) { }

      resources[base.id] = base;
    }
    return resources;
  },

  monitorOnlyKeys: ['permissionCount', 'permissions', 'drivePermissions'],

  watchableKeys: [
    { path: 'displayName', label: 'Site Title', type: 'string' },
    { path: 'webUrl', label: 'Site URL', type: 'string' },
    { path: 'siteCollection', label: 'Site Collection', type: 'json' },
    { path: 'driveId', label: 'Default Document Library', type: 'string' },
    { path: 'permissionCount', label: 'Permission Entries Count (monitor only)', type: 'number' },
    { path: 'permissions', label: 'Permission Entries (monitor only, summarized)', type: 'json' },
    { path: 'drivePermissions', label: 'Drive Permission Entries (monitor only, summarized)', type: 'json' },
    { path: 'anonymousLinkCount', label: 'Anonymous Link Count (monitor only)', type: 'number' },
    { path: 'externalShareCount', label: 'External Share Count (monitor only)', type: 'number' },
    { path: 'externalShareSamples', label: 'External Share Samples (monitor only)', type: 'json' },
    { path: 'topExternallyShared', label: 'Top Externally Shared Items (monitor only)', type: 'json' },
  ],

  async restore(token, resourceId, baselineResource) {
    const patch = {};
    if (baselineResource.displayName) patch.displayName = baselineResource.displayName;
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/sites/${resourceId}`, patch);
  },

  async repairPlan(token, resourceId, baselineResource = {}, liveResource = {}) {
    const plan = [];
    const baselinePerms = Array.isArray(baselineResource.permissions) ? baselineResource.permissions : [];
    const livePerms = Array.isArray(liveResource?.permissions) ? liveResource.permissions : [];

    const extractIds = (p) => {
      const ids = [];
      if (!p) return ids;
      const grant = p.grantedTo || p.grantedTo?.user || null;
      if (grant) {
        if (grant.id) ids.push(grant.id);
        if (grant.userPrincipalName) ids.push(grant.userPrincipalName);
        if (grant.email) ids.push(grant.email);
      }
      if (Array.isArray(p.grantedToIdentities)) {
        for (const i of p.grantedToIdentities) {
          if (i?.user?.id) ids.push(i.user.id);
          if (i?.application?.id) ids.push(i.application.id);
        }
      }
      return ids;
    };

    const missing = [];
    for (const bp of baselinePerms) {
      const match = livePerms.find(lp => {
        const a = extractIds(bp);
        const b = extractIds(lp);
        if (a.some(id => b.includes(id))) return true;
        if (bp.link?.webUrl && lp.link?.webUrl && bp.link.webUrl === lp.link.webUrl) return true;
        if (JSON.stringify(bp.roles || []) === JSON.stringify(lp.roles || []) && bp.grantedTo?.displayName && lp.grantedTo?.displayName && bp.grantedTo.displayName === lp.grantedTo.displayName) return true;
        return false;
      });
      if (!match) missing.push(bp);
    }

    if (missing.length) {
      plan.push({ type: 'info', message: `Found ${missing.length} permission entries present in baseline but missing in live snapshot` });
      for (const m of missing) {
        if (m.grantedTo) {
          const principal = m.grantedTo.user || m.grantedTo;
          const title = principal?.displayName || principal?.email || principal?.id || 'Principal';
          plan.push({
            type: 'suggestion',
            title: `Add permission for ${title}`,
            description: `Restore permission roles ${ (m.roles || []).join(', ') } for ${title}. This will re-grant access present in the baseline.`,
            api: {
              method: 'POST',
              path: `/sites/${resourceId}/permissions`,
              body: {
                grantee: principal?.user ? { user: { id: principal.user.id } } : { user: { id: principal.id } },
                roles: m.roles || []
              }
            }
          });
        } else if (m.link) {
          plan.push({
            type: 'manual',
            title: 'Recreate sharing link',
            description: 'Baseline contained a sharing link; recreate via the SharePoint UI or use the Graph invite APIs for the specific drive item.'
          });
        } else {
          plan.push({ type: 'manual', title: 'Review permission entry', description: 'Baseline includes a permission entry that could not be auto-suggested — review manually.' });
        }
      }
    } else {
      plan.push({ type: 'info', message: 'No missing permission entries detected in baseline vs live snapshot' });
    }

    const baselineDrivePerms = Array.isArray(baselineResource.drivePermissions) ? baselineResource.drivePermissions : [];
    const liveDrivePerms = Array.isArray(liveResource?.drivePermissions) ? liveResource.drivePermissions : [];
    const missingDrive = baselineDrivePerms.filter(bp => !liveDrivePerms.some(lp => JSON.stringify(lp.roles || []) === JSON.stringify(bp.roles || []) && ((lp.grantedTo?.user?.id && lp.grantedTo.user.id === bp.grantedTo?.user?.id) || (lp.grantedTo?.id && lp.grantedTo.id === bp.grantedTo?.id))));
    if (missingDrive.length) {
      plan.push({ type: 'info', message: `Found ${missingDrive.length} drive-level permission entries missing from live snapshot` });
      for (const m of missingDrive) {
        const grantee = m.grantedTo && (m.grantedTo.user || m.grantedTo);
        if (grantee?.id) {
          plan.push({
            type: 'suggestion',
            title: `Add drive permission for ${grantee.displayName || grantee.id}`,
            description: `Add missing drive permission with roles ${(m.roles || []).join(', ')}.`,
            api: {
              method: 'POST',
              path: m.driveId ? `/drives/${m.driveId}/permissions` : `/sites/${resourceId}/drive/permissions`,
              body: {
                grantee: grantee.user ? { user: { id: grantee.user.id } } : { user: { id: grantee.id } },
                roles: m.roles || []
              }
            }
          });
        } else {
          plan.push({ type: 'manual', title: 'Review drive permission', description: 'Cannot auto-suggest drive permission for this entry; review manually in the SharePoint or OneDrive admin UI.' });
        }
      }
    }

    return plan;
  },
};

const sharepointTenantSettings = {
  areaKey: 'sharepoint_tenant_settings',
  displayName: 'Tenant Security Settings',
  description: 'SharePoint tenant-level security and sharing posture settings.',
  licenceRequired: null,
  readPermissions: ['SharePointTenantSettings.Read.All'],
  writePermissions: ['SharePointTenantSettings.ReadWrite.All'],
  restoreSupported: true,
  graphBasePath: '/admin/sharepoint/settings',

  async pull(token) {
    const settings = await graphGet(token, '/admin/sharepoint/settings').catch(() => null);
    if (!settings) return {};
    return {
      tenant: {
        id: 'tenant',
        displayName: 'Tenant SharePoint Settings',
        sharingCapability: settings.sharingCapability ?? null,
        sharingDomainRestrictionMode: settings.sharingDomainRestrictionMode ?? null,
        sharingAllowedDomainList: settings.sharingAllowedDomainList ?? [],
        sharingBlockedDomainList: settings.sharingBlockedDomainList ?? [],
        isRequireAcceptingUserToMatchInvitedUserEnabled: settings.isRequireAcceptingUserToMatchInvitedUserEnabled ?? null,
        isResharingByExternalUsersEnabled: settings.isResharingByExternalUsersEnabled ?? null,
        idleSessionSignOut: settings.idleSessionSignOut ?? null,
        isLegacyAuthProtocolsEnabled: settings.isLegacyAuthProtocolsEnabled ?? null,
        isUnmanagedSyncAppForTenantRestricted: settings.isUnmanagedSyncAppForTenantRestricted ?? null,
        allowedDomainGuidsForSyncApp: settings.allowedDomainGuidsForSyncApp ?? [],
        excludedFileExtensionsForSyncApp: settings.excludedFileExtensionsForSyncApp ?? [],
        isSiteCreationEnabled: settings.isSiteCreationEnabled ?? null,
        isSiteCreationUIEnabled: settings.isSiteCreationUIEnabled ?? null,
        siteCreationDefaultManagedPath: settings.siteCreationDefaultManagedPath ?? null,
        raw: settings,
      }
    };
  },

  async get(token) {
    const resources = await this.pull(token);
    return resources.tenant || null;
  },

  monitorOnlyKeys: ['raw'],
  watchableKeys: [
    { path: 'sharingCapability', label: 'Sharing Capability', type: 'string' },
    { path: 'sharingDomainRestrictionMode', label: 'Sharing Domain Restriction Mode', type: 'string' },
    { path: 'sharingAllowedDomainList', label: 'Sharing Allowed Domain List', type: 'array' },
    { path: 'sharingBlockedDomainList', label: 'Sharing Blocked Domain List', type: 'array' },
    { path: 'isRequireAcceptingUserToMatchInvitedUserEnabled', label: 'Require Invitee Match', type: 'boolean' },
    { path: 'isResharingByExternalUsersEnabled', label: 'Allow External Resharing', type: 'boolean' },
    { path: 'idleSessionSignOut', label: 'Idle Session Sign-out', type: 'json' },
    { path: 'isLegacyAuthProtocolsEnabled', label: 'Legacy Auth Protocols Enabled', type: 'boolean' },
    { path: 'isUnmanagedSyncAppForTenantRestricted', label: 'Restrict Unmanaged Sync App', type: 'boolean' },
    { path: 'allowedDomainGuidsForSyncApp', label: 'Allowed Domain GUIDs For Sync App', type: 'array' },
    { path: 'excludedFileExtensionsForSyncApp', label: 'Excluded File Extensions For Sync App', type: 'array' },
    { path: 'isSiteCreationEnabled', label: 'Site Creation Enabled', type: 'boolean' },
    { path: 'isSiteCreationUIEnabled', label: 'Site Creation UI Enabled', type: 'boolean' },
    { path: 'siteCreationDefaultManagedPath', label: 'Site Creation Default Managed Path', type: 'string' },
  ],

  async restore(token, _resourceId, baselineResource = {}) {
    const patch = {};
    const fields = [
      'sharingCapability',
      'sharingDomainRestrictionMode',
      'sharingAllowedDomainList',
      'sharingBlockedDomainList',
      'isRequireAcceptingUserToMatchInvitedUserEnabled',
      'isResharingByExternalUsersEnabled',
      'idleSessionSignOut',
      'isLegacyAuthProtocolsEnabled',
      'isUnmanagedSyncAppForTenantRestricted',
      'allowedDomainGuidsForSyncApp',
      'excludedFileExtensionsForSyncApp',
      'isSiteCreationEnabled',
      'isSiteCreationUIEnabled',
      'siteCreationDefaultManagedPath',
    ];
    for (const f of fields) {
      if (baselineResource[f] !== undefined && baselineResource[f] !== null) patch[f] = baselineResource[f];
    }
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, '/admin/sharepoint/settings', patch);
  },
};

// Inlined grouped collectors for Exchange and Teams (moved into index.js)
// Reuse service methods already required above: graphGet, graphGetAll, graphPatch, graphPost
const BETA_URL = 'https://graph.microsoft.com/beta';

// --- Exchange collectors (inlined) ---
const exchangeMailboxes = {
  areaKey: 'exchange_mailboxes',
  displayName: 'Mailboxes',
  description: 'Mailbox-level settings and forwarding indicators for monitoring posture.',
  licenceRequired: null,
  readPermissions:  ['MailboxSettings.Read'],
  writePermissions: ['MailboxSettings.ReadWrite'],
  restoreSupported: false,
  monitorOnlyKeys: [],
  watchableKeys: [
    { path: 'displayName', label: 'Display Name', type: 'string' },
    { path: 'mail', label: 'Primary SMTP address', type: 'string' },
    { path: 'raw.userPrincipalName', label: 'User Principal Name', type: 'string' },
    { path: 'mailboxSettings.timeZone', label: 'Mailbox Time Zone', type: 'string' },
    { path: 'mailboxSettings.delegateMeetingMessageDeliveryOptions', label: 'Delegate Meeting Delivery', type: 'string' },
    { path: 'mailboxSettings.automaticRepliesSetting.status', label: 'Automatic Replies Status', type: 'string' },
    { path: 'mailboxSettings.automaticRepliesSetting.externalAudience', label: 'Automatic Replies External Audience', type: 'string' },
    { path: 'mailboxSettings.workingHours', label: 'Working Hours', type: 'json' },
    { path: 'forwardingRules', label: 'Forwarding Rules (summary)', type: 'array' },
    { path: 'messageRules', label: 'Inbox Message Rules (full)', type: 'json' },
    { path: 'inferenceClassification', label: 'Inference Classification', type: 'json' },
  ],

  async pull(token) {
    const resources = {};
    let users = [];
    try {
      users = await graphGetAll(token, '/users?$select=id,displayName,mail,userPrincipalName');
    } catch (err) {
      throw err;
    }

    const concurrency = 8;
    for (let i = 0; i < users.length; i += concurrency) {
      const batch = users.slice(i, i + concurrency);
      await Promise.all(batch.map(async (u) => {
        const id = u.id || u.userPrincipalName || (u.mail || '').toLowerCase() || (`user_${Math.random().toString(36).slice(2,9)}`);
        const displayName = u.displayName || u.mail || u.userPrincipalName || id;
        const res = { id, displayName, mail: u.mail || null, raw: u };

        try {
          const mb = await graphGet(token, `/users/${encodeURIComponent(u.id)}/mailboxSettings`).catch(() => null);
          if (mb) res.mailboxSettings = mb;
        } catch (e) { }

        try {
          const rules = await graphGetAll(token, `/users/${encodeURIComponent(u.id)}/mailFolders/inbox/messageRules`).catch(() => []);
          if (Array.isArray(rules) && rules.length > 0) {
            res.messageRules = rules;
            const forwarding = rules.filter(r => {
              const a = r?.actions || {};
              return (!!a.forwardTo || !!a.forwardAsAttachmentTo || !!a.redirectTo);
            }).map(r => ({ id: r.id, displayName: r.displayName || '', actions: r.actions || {}, conditions: r.conditions || {} }));
            if (forwarding.length > 0) res.forwardingRules = forwarding;
          }
        } catch (e) { }

        try {
          const inf = await graphGet(token, `/users/${encodeURIComponent(u.id)}/inferenceClassification`).catch(() => null);
          if (inf) res.inferenceClassification = inf;
        } catch (e) { }

        resources[id] = res;
      }));
    }

    return resources;
  },

  async get(token, resourceId) {
    try {
      const user = await graphGet(token, `/users/${encodeURIComponent(resourceId)}?$select=id,displayName,mail,userPrincipalName`).catch(() => null);
      if (user) {
        let mailboxSettings = null;
        try { mailboxSettings = await graphGet(token, `/users/${encodeURIComponent(resourceId)}/mailboxSettings`).catch(() => null); } catch (_) { mailboxSettings = null; }

        let messageRules = null;
        try {
          const rules = await graphGetAll(token, `/users/${encodeURIComponent(resourceId)}/mailFolders/inbox/messageRules`).catch(() => []);
          if (Array.isArray(rules) && rules.length > 0) messageRules = rules;
        } catch (e) { }

        let forwardingRules = null;
        if (Array.isArray(messageRules) && messageRules.length > 0) {
          const forwarding = messageRules.filter(r => {
            const a = r?.actions || {};
            return (!!a.forwardTo || !!a.forwardAsAttachmentTo || !!a.redirectTo);
          }).map(r => ({ id: r.id, displayName: r.displayName || '', actions: r.actions || {}, conditions: r.conditions || {} }));
          if (forwarding.length > 0) forwardingRules = forwarding;
        }

        let inferenceClassification = null;
        try {
          const inf = await graphGet(token, `/users/${encodeURIComponent(resourceId)}/inferenceClassification`).catch(() => null);
          if (inf) inferenceClassification = inf;
        } catch (e) { }

        return {
          id: user.id || resourceId,
          displayName: user.displayName || user.mail || user.userPrincipalName || resourceId,
          mail: user.mail || null,
          mailboxSettings,
          messageRules,
          forwardingRules,
          inferenceClassification,
          raw: { user, mailboxSettings, messageRules, inferenceClassification }
        };
      }
    } catch (err) { }
    return null;
  },

  async restore() { throw new Error('Restore not supported for mailboxes in this collector.'); },
};

const exchangeMailboxSecurity = {
  areaKey: 'exchange_mailbox_security',
  displayName: 'Mailbox Security Settings',
  description: 'Mailbox security-relevant settings and forwarding indicators.',
  licenceRequired: null,
  readPermissions: ['MailboxSettings.Read'],
  writePermissions: ['MailboxSettings.ReadWrite'],
  restoreSupported: true,
  graphBasePath: '/users',

  async pull(token) {
    const resources = {};
    let users = [];
    try {
      users = await graphGetAll(token, '/users?$select=id,displayName,mail,userPrincipalName');
    } catch (err) {
      throw err;
    }

    const concurrency = 8;
    for (let i = 0; i < users.length; i += concurrency) {
      const batch = users.slice(i, i + concurrency);
      await Promise.all(batch.map(async (u) => {
        const id = u.id || u.userPrincipalName || (u.mail || '').toLowerCase() || (`user_${Math.random().toString(36).slice(2,9)}`);
        const entry = {
          id,
          displayName: u.displayName || u.mail || u.userPrincipalName || id,
          mail: u.mail || null,
          userPrincipalName: u.userPrincipalName || null,
        };

        try {
          const mailboxSettings = await graphGet(token, `/users/${encodeURIComponent(u.id)}/mailboxSettings`).catch(() => null);
          if (mailboxSettings) entry.mailboxSettings = mailboxSettings;
        } catch {}

        try {
          const rules = await graphGetAll(token, `/users/${encodeURIComponent(u.id)}/mailFolders/inbox/messageRules`).catch(() => []);
          if (Array.isArray(rules) && rules.length > 0) {
            entry.messageRules = rules.slice(0, 200);
            entry.forwardingRules = rules
              .filter(r => {
                const a = r?.actions || {};
                return !!a.forwardTo || !!a.forwardAsAttachmentTo || !!a.redirectTo;
              })
              .map(r => ({
                id: r.id,
                displayName: r.displayName || null,
                isEnabled: r.isEnabled ?? null,
                actions: r.actions || {},
              }));
            entry.riskyForwardingRuleCount = entry.forwardingRules.length;
          } else {
            entry.riskyForwardingRuleCount = 0;
          }
        } catch {
          entry.riskyForwardingRuleCount = 0;
        }

        resources[id] = entry;
      }));
    }

    return resources;
  },

  async get(token, resourceId) {
    const user = await graphGet(token, `/users/${encodeURIComponent(resourceId)}?$select=id,displayName,mail,userPrincipalName`).catch(() => null);
    if (!user) return null;
    const resources = await this.pull(token);
    return resources[user.id] || null;
  },

  monitorOnlyKeys: ['messageRules', 'forwardingRules', 'riskyForwardingRuleCount'],
  watchableKeys: [
    { path: 'mail', label: 'Primary SMTP Address', type: 'string' },
    { path: 'mailboxSettings.timeZone', label: 'Mailbox Time Zone', type: 'string' },
    { path: 'mailboxSettings.language', label: 'Mailbox Language', type: 'json' },
    { path: 'mailboxSettings.workingHours', label: 'Working Hours', type: 'json' },
    { path: 'mailboxSettings.delegateMeetingMessageDeliveryOptions', label: 'Delegate Meeting Message Delivery', type: 'string' },
    { path: 'mailboxSettings.automaticRepliesSetting', label: 'Automatic Replies Setting', type: 'json' },
    { path: 'riskyForwardingRuleCount', label: 'Risky Forwarding Rules Count (monitor only)', type: 'number' },
    { path: 'forwardingRules', label: 'Forwarding Rules (monitor only)', type: 'json' },
  ],

  async restore(token, resourceId, baselineResource = {}) {
    const baseline = baselineResource.mailboxSettings || {};
    const patch = {};
    const fields = [
      'timeZone',
      'language',
      'workingHours',
      'delegateMeetingMessageDeliveryOptions',
      'automaticRepliesSetting',
    ];
    for (const f of fields) {
      if (baseline[f] !== undefined && baseline[f] !== null) patch[f] = baseline[f];
    }
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/users/${encodeURIComponent(resourceId)}/mailboxSettings`, patch);
  },
};

const DEFAULT_ENV = 'EXCHANGE_CONNECTORS_ENDPOINTS';
const exchangeConnectors = {
  areaKey: 'exchange_connectors',
  displayName: 'Mail Flow Connectors',
  description: 'Mail flow connectors (mail routing) — best-effort via Microsoft Graph endpoints when configured.',
  licenceRequired: null,
  readPermissions:  ['Policy.Read.All'],
  writePermissions: [],
  restoreSupported: false,
  graphBasePath: null,

  async pull(token) {
    const raw = process.env[DEFAULT_ENV] || '';
    const endpoints = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (endpoints.length === 0) {
      throw new CollectorUnavailableError(
        'Mail Flow Connectors',
        'Mail flow connectors are not exposed through Microsoft Graph app-only endpoints by default. Configure EXCHANGE_CONNECTORS_ENDPOINTS with explicit tenant-supported endpoints to enable this collector.'
      );
    }
    const resources = {};
    let successfulPulls = 0;
    const endpointErrors = [];

    for (const ep of endpoints) {
      let path = ep;
      if (!path.startsWith('http')) {
        if (path.startsWith('beta:')) path = `${BETA_URL}${path.slice(5)}`;
        else if (path.startsWith('/beta')) path = `${BETA_URL}${path.slice(5)}`;
        else if (!path.startsWith('/')) path = `/${path}`;
      }

      let items;
      try {
        items = await graphGetAll(token, path);
        successfulPulls++;
      } catch (err) {
        endpointErrors.push(`${path}: ${err?.message || 'request failed'}`);
        continue;
      }
      if (!Array.isArray(items) || items.length === 0) continue;
      for (const it of items) {
        const id = it.id || it.name || it.connectorId || (`connector_${Math.random().toString(36).slice(2,9)}`);
        if (resources[id]) continue;
        const displayName = it.displayName || it.name || `Connector ${id}`;
        resources[id] = { id, displayName, type: it.connectorType || it.type || null, raw: it };
      }
    }

    if (successfulPulls === 0) {
      const detail = endpointErrors.slice(0, 3).join(' | ');
      throw new CollectorUnavailableError(
        'Mail Flow Connectors',
        detail
          ? `Configured connector endpoints are not reachable in this tenant context. ${detail}`
          : 'Configured connector endpoints are not reachable in this tenant context.'
      );
    }

    return resources;
  },

  async get(token, resourceId) {
    const raw = process.env[DEFAULT_ENV] || '';
    const endpoints = raw.split(',').map(s => s.trim()).filter(Boolean);
    const tryPaths = endpoints.map(ep => {
      let path = ep;
      if (!path.startsWith('http')) {
        if (path.startsWith('beta:')) path = `${BETA_URL}${path.slice(5)}`;
        else if (path.startsWith('/beta')) path = `${BETA_URL}${path.slice(5)}`;
        else if (!path.startsWith('/')) path = `/${path}`;
      }
      if (path.includes('{id}')) return path.replace('{id}', encodeURIComponent(resourceId));
      return `${path.replace(/\/$/, '')}/${encodeURIComponent(resourceId)}`;
    });
    for (const p of tryPaths) {
      try {
        const it = await graphGet(token, p).catch(() => null);
        if (!it) continue;
        const id = it.id || resourceId;
        const displayName = it.displayName || it.name || `Connector ${id}`;
        return { id, displayName, type: it.connectorType || it.type || null, raw: it };
      } catch (err) { continue; }
    }
    return null;
  },

  monitorOnlyKeys: ['raw'],
  watchableKeys: [
    { path: 'displayName', label: 'Connector Name', type: 'string' },
    { path: 'type', label: 'Connector Type', type: 'string' },
    { path: 'raw', label: 'Connector Payload (monitor only)', type: 'json' },
  ],
  async restore() { throw new Error('Restore not supported for mail flow connectors via Graph'); },
};

const DEFAULT_ENV_TR = 'EXCHANGE_TRANSPORT_RULES_ENDPOINTS';
const exchangeTransportRules = {
  areaKey: 'exchange_transport_rules',
  displayName: 'Transport Rules',
  description: 'Exchange transport rules / mail flow rules — best-effort via Microsoft Graph endpoints when configured.',
  licenceRequired: null,
  readPermissions:  ['Policy.Read.All'],
  writePermissions: [],
  restoreSupported: false,
  graphBasePath: null,

  async pull(token) {
    const raw = process.env[DEFAULT_ENV_TR] || '';
    const endpoints = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (endpoints.length === 0) {
      throw new CollectorUnavailableError(
        'Transport Rules',
        'Exchange transport rules are not exposed through Microsoft Graph app-only endpoints by default. Configure EXCHANGE_TRANSPORT_RULES_ENDPOINTS with explicit tenant-supported endpoints to enable this collector.'
      );
    }
    const resources = {};
    let successfulPulls = 0;
    const endpointErrors = [];
    for (const ep of endpoints) {
      let path = ep;
      if (!path.startsWith('http')) {
        if (path.startsWith('beta:')) path = `${BETA_URL}${path.slice(5)}`;
        else if (path.startsWith('/beta')) path = `${BETA_URL}${path.slice(5)}`;
        else if (!path.startsWith('/')) path = `/${path}`;
      }

      let items;
      try {
        items = await graphGetAll(token, path);
        successfulPulls++;
      } catch (err) {
        endpointErrors.push(`${path}: ${err?.message || 'request failed'}`);
        continue;
      }
      if (!Array.isArray(items) || items.length === 0) continue;
      for (const it of items) {
        const id = it.id || it.ruleId || it.name || (`rule_${Math.random().toString(36).slice(2,9)}`);
        if (resources[id]) continue;
        const displayName = it.displayName || it.name || `Transport Rule ${id}`;
        resources[id] = {
          id,
          displayName,
          isEnabled: (it.state !== undefined) ? (String(it.state).toLowerCase() === 'enabled') : (it.isEnabled !== undefined ? !!it.isEnabled : null),
          priority: it.priority ?? it.order ?? null,
          conditions: it.conditions || it.predicates || null,
          actions: it.actions || it.applyActions || null,
          raw: it,
        };
      }
    }

    if (successfulPulls === 0) {
      const detail = endpointErrors.slice(0, 3).join(' | ');
      throw new CollectorUnavailableError(
        'Transport Rules',
        detail
          ? `Configured transport rule endpoints are not reachable in this tenant context. ${detail}`
          : 'Configured transport rule endpoints are not reachable in this tenant context.'
      );
    }

    return resources;
  },

  async get(token, resourceId) {
    const raw = process.env[DEFAULT_ENV_TR] || '';
    const endpoints = raw.split(',').map(s => s.trim()).filter(Boolean);
    const tryPaths = endpoints.map(ep => {
      let path = ep;
      if (!path.startsWith('http')) {
        if (path.startsWith('beta:')) path = `${BETA_URL}${path.slice(5)}`;
        else if (path.startsWith('/beta')) path = `${BETA_URL}${path.slice(5)}`;
        else if (!path.startsWith('/')) path = `/${path}`;
      }
      if (path.includes('{id}')) return path.replace('{id}', encodeURIComponent(resourceId));
      return `${path.replace(/\/$/, '')}/${encodeURIComponent(resourceId)}`;
    });
    for (const p of tryPaths) {
      try {
        const it = await graphGet(token, p).catch(() => null);
        if (!it) continue;
        const id = it.id || it.ruleId || resourceId;
        const displayName = it.displayName || it.name || `Transport Rule ${id}`;
        return {
          id,
          displayName,
          isEnabled: (it.state !== undefined) ? (String(it.state).toLowerCase() === 'enabled') : (it.isEnabled !== undefined ? !!it.isEnabled : null),
          priority: it.priority ?? it.order ?? null,
          conditions: it.conditions || it.predicates || null,
          actions: it.actions || it.applyActions || null,
          raw: it,
        };
      } catch (err) { continue; }
    }
    return null;
  },

  monitorOnlyKeys: ['conditions', 'actions', 'raw'],
  watchableKeys: [
    { path: 'displayName', label: 'Rule Name', type: 'string' },
    { path: 'isEnabled', label: 'Enabled', type: 'boolean' },
    { path: 'priority', label: 'Priority', type: 'number' },
    { path: 'conditions', label: 'Rule Conditions (monitor only)', type: 'json' },
    { path: 'actions', label: 'Rule Actions (monitor only)', type: 'json' },
    { path: 'raw', label: 'Rule Payload (monitor only)', type: 'json' },
  ],
  async restore() { throw new Error('Restore not supported for transport rules via Graph'); },
};

const exchangeGroup = {
  exchange_mailboxes: exchangeMailboxes,
  exchange_mailbox_security: exchangeMailboxSecurity,
  exchange_connectors: exchangeConnectors,
  exchange_transport_rules: exchangeTransportRules,
};

// --- Teams collectors (inlined) ---
const DEFAULT_ENV_MSG = 'TEAMS_MESSAGING_POLICIES_ENDPOINTS';
const DEFAULT_ENV_MEET = 'TEAMS_MEETING_POLICIES_ENDPOINTS';
const teamsMessagingPolicies = {
  areaKey: 'teams_policies_messaging',
  displayName: 'Messaging Policies',
  description: 'Tenant-level Teams messaging policies (Giphy, memes, edit/delete, profanity).',
  licenceRequired: null,
  readPermissions:  ['Policy.Read.All'],
  writePermissions: ['TeamSettings.ReadWrite.All'],
  restoreSupported: true,
  graphBasePath: '/policies/teamsMessagingPolicies',

  async pull(token) {
    const raw = process.env[DEFAULT_ENV_MSG] || '';
    const endpoints = [`${BETA_URL}/policies/teamsMessagingPolicies`].concat(raw.split(',').map(s => s.trim()).filter(Boolean));
    const resources = {};
    for (const ep of endpoints) {
      let path = ep;
      if (!path.startsWith('http')) {
        if (path.startsWith('beta:')) path = `${BETA_URL}${path.slice(5)}`;
        else if (path.startsWith('/beta')) path = `${BETA_URL}${path.slice(5)}`;
        else if (!path.startsWith('/')) path = `/${path}`;
      }

      let items;
      try { items = await graphGetAll(token, path); } catch (err) { continue; }
      if (!Array.isArray(items) || items.length === 0) continue;
      for (const it of items) {
        const id = it.id || it.displayName || (`teams_msg_policy_${Math.random().toString(36).slice(2,9)}`);
        if (resources[id]) continue;
        const displayName = it.displayName || `Messaging Policy ${id}`;
        resources[id] = {
          id,
          displayName,
          allowGiphy: it.allowGiphy ?? null,
          giphyContentRating: it.giphyContentRating || null,
          allowMemes: it.allowMemes ?? null,
          allowStickersAndMemes: it.allowStickersAndMemes ?? null,
          allowUserEditMessages: it.allowUserEditMessages ?? null,
          allowUserDeleteMessages: it.allowUserDeleteMessages ?? null,
          raw: it,
        };
      }
    }
    return resources;
  },

  async get(token, resourceId) {
    const tryPaths = [ `${BETA_URL}/policies/teamsMessagingPolicies/${resourceId}`, `/policies/teamsMessagingPolicies/${resourceId}` ];
    for (const p of tryPaths) {
      try {
        const it = await graphGet(token, p).catch(() => null);
        if (!it) continue;
        const id = it.id || resourceId;
        return {
          id,
          displayName: it.displayName || `Messaging Policy ${id}`,
          allowGiphy: it.allowGiphy ?? null,
          giphyContentRating: it.giphyContentRating ?? null,
          allowMemes: it.allowMemes ?? null,
          allowStickersAndMemes: it.allowStickersAndMemes ?? null,
          allowUserEditMessages: it.allowUserEditMessages ?? null,
          allowUserDeleteMessages: it.allowUserDeleteMessages ?? null,
          raw: it,
        };
      } catch (err) { continue; }
    }
    return null;
  },

  monitorOnlyKeys: ['raw'],

  watchableKeys: [
    { path: 'allowGiphy', label: 'Allow Giphy', type: 'boolean' },
    { path: 'giphyContentRating', label: 'Giphy Content Rating', type: 'string' },
    { path: 'allowMemes', label: 'Allow Memes', type: 'boolean' },
    { path: 'allowStickersAndMemes', label: 'Allow Stickers & Memes', type: 'boolean' },
    { path: 'allowUserEditMessages', label: 'Allow Edit Messages', type: 'boolean' },
    { path: 'allowUserDeleteMessages', label: 'Allow Delete Messages', type: 'boolean' },
  ],

  async restore(token, resourceId, baselineResource) {
    const patch = {};
    const fields = ['allowGiphy', 'giphyContentRating', 'allowMemes', 'allowStickersAndMemes', 'allowUserEditMessages', 'allowUserDeleteMessages'];
    for (const f of fields) {
      if (baselineResource[f] !== undefined && baselineResource[f] !== null) patch[f] = baselineResource[f];
    }
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/policies/teamsMessagingPolicies/${resourceId}`, patch);
  },
};

const teamsMeetingPolicies = {
  areaKey: 'teams_policies_meetings',
  displayName: 'Meeting Policies',
  description: 'Tenant-level Teams meeting policies (recording, transcription, lobby, anonymous join).',
  licenceRequired: null,
  readPermissions:  ['Policy.Read.All'],
  writePermissions: ['TeamSettings.ReadWrite.All'],
  restoreSupported: true,
  graphBasePath: '/policies/onlineMeetingPolicies',

  async pull(token) {
    const raw = process.env[DEFAULT_ENV_MEET] || '';
    const endpoints = [`${BETA_URL}/policies/onlineMeetingPolicies`].concat(raw.split(',').map(s => s.trim()).filter(Boolean));
    const resources = {};
    for (const ep of endpoints) {
      let path = ep;
      if (!path.startsWith('http')) {
        if (path.startsWith('beta:')) path = `${BETA_URL}${path.slice(5)}`;
        else if (path.startsWith('/beta')) path = `${BETA_URL}${path.slice(5)}`;
        else if (!path.startsWith('/')) path = `/${path}`;
      }

      let items;
      try { items = await graphGetAll(token, path); } catch (err) { continue; }
      if (!Array.isArray(items) || items.length === 0) continue;
      for (const it of items) {
        const id = it.id || it.displayName || (`teams_meet_policy_${Math.random().toString(36).slice(2,9)}`);
        if (resources[id]) continue;
        resources[id] = {
          id,
          displayName: it.displayName || `Meeting Policy ${id}`,
          allowTranscription: it.allowTranscription ?? null,
          allowRecording: it.allowRecording ?? null,
          recordingStorageExpirationDays: it.recordingStorageExpirationDays || null,
          allowAnonymousJoin: it.allowAnonymousJoin ?? null,
          lobbyBypass: it.lobbyBypass || null,
          raw: it,
        };
      }
    }
    return resources;
  },

  async get(token, resourceId) {
    const tryPaths = [ `${BETA_URL}/policies/onlineMeetingPolicies/${resourceId}`, `/policies/onlineMeetingPolicies/${resourceId}` ];
    for (const p of tryPaths) {
      try {
        const it = await graphGet(token, p).catch(() => null);
        if (!it) continue;
        return {
          id: it.id || resourceId,
          displayName: it.displayName || `Meeting Policy ${resourceId}`,
          allowTranscription: it.allowTranscription ?? null,
          allowRecording: it.allowRecording ?? null,
          recordingStorageExpirationDays: it.recordingStorageExpirationDays || null,
          allowAnonymousJoin: it.allowAnonymousJoin ?? null,
          lobbyBypass: it.lobbyBypass || null,
          raw: it,
        };
      } catch (err) { continue; }
    }
    return null;
  },

  monitorOnlyKeys: ['raw'],

  watchableKeys: [
    { path: 'allowTranscription', label: 'Allow Transcription', type: 'boolean' },
    { path: 'allowRecording', label: 'Allow Recording', type: 'boolean' },
    { path: 'recordingStorageExpirationDays', label: 'Recording Expiry (days)', type: 'number' },
    { path: 'allowAnonymousJoin', label: 'Allow Anonymous Join', type: 'boolean' },
    { path: 'lobbyBypass', label: 'Lobby Bypass Settings', type: 'json' },
  ],

  async restore(token, resourceId, baselineResource) {
    const patch = {};
    const fields = ['allowTranscription', 'allowRecording', 'recordingStorageExpirationDays', 'allowAnonymousJoin'];
    for (const f of fields) {
      if (baselineResource[f] !== undefined && baselineResource[f] !== null) patch[f] = baselineResource[f];
    }
    if (baselineResource.lobbyBypass !== undefined && baselineResource.lobbyBypass !== null) patch.lobbyBypass = baselineResource.lobbyBypass;
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/policies/onlineMeetingPolicies/${resourceId}`, patch);
  },
};

const teamsMembership = {
  areaKey: 'teams_membership',
  displayName: 'Team Membership',
  description: 'Team membership and owners — monitor members, owners and guest counts.',
  licenceRequired: null,
  readPermissions:  ['Group.Read.All', 'Team.ReadBasic.All'],
  writePermissions: ['GroupMember.ReadWrite.All'],
  restoreSupported: true,
  graphBasePath: '/groups',

  async pull(token) {
    let groups;
    try {
      groups = await graphGetAll(token, "/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id,displayName");
    } catch (err) { groups = []; }

    const resources = {};
    for (const g of groups) {
      const id = g.id;
      const base = { id, displayName: g.displayName || id };

      try {
        const members = await graphGetAll(token, `/groups/${id}/members`).catch(() => []);
        if (Array.isArray(members)) {
          base.memberCount = members.length;
          base.members = members.slice(0, 500).map(m => ({ id: m.id || null, displayName: m.displayName || m.userPrincipalName || null, userPrincipalName: m.userPrincipalName || null }));
        }
      } catch (err) { }

      try {
        const owners = await graphGetAll(token, `/groups/${id}/owners`).catch(() => []);
        if (Array.isArray(owners)) {
          base.ownerCount = owners.length;
          base.owners = owners.slice(0, 200).map(o => ({ id: o.id || null, displayName: o.displayName || o.userPrincipalName || null, userPrincipalName: o.userPrincipalName || null }));
        }
      } catch (err) { }

      try {
        const guestSamples = Array.isArray(base.members) ? base.members.filter(m => m.userPrincipalName && String(m.userPrincipalName).includes('#EXT#')) : [];
        base.guestCount = guestSamples.length;
        base.guestSamples = guestSamples.slice(0, 5);
      } catch (err) { }

      resources[id] = base;
    }

    return resources;
  },

  async get(token, resourceId) {
    try {
      const group = await graphGet(token, `/groups/${resourceId}?$select=id,displayName`).catch(() => null);
      if (!group) return null;
      const base = { id: group.id, displayName: group.displayName || group.id };
      try { base.members = await graphGetAll(token, `/groups/${resourceId}/members`); } catch (e) { base.members = []; }
      try { base.owners = await graphGetAll(token, `/groups/${resourceId}/owners`); } catch (e) { base.owners = []; }
      base.memberCount = Array.isArray(base.members) ? base.members.length : 0;
      base.ownerCount = Array.isArray(base.owners) ? base.owners.length : 0;
      base.guestCount = Array.isArray(base.members) ? base.members.filter(m => m.userPrincipalName && String(m.userPrincipalName).includes('#EXT#')).length : 0;
      return base;
    } catch (err) { return null; }
  },

  monitorOnlyKeys: ['memberCount', 'ownerCount', 'guestCount'],

  watchableKeys: [
    { path: 'owners', label: 'Owners (list)', type: 'array' },
    { path: 'members', label: 'Members (list)', type: 'array' },
    { path: 'guestCount', label: 'Guest Members Count', type: 'number' },
    { path: 'isMembershipLimitedToOwners', label: 'Membership limited to owners', type: 'boolean' },
  ],

  async restore(token, resourceId, baselineResource = {}) {
    const baselineMembers = Array.isArray(baselineResource.members) ? baselineResource.members : [];
    const baselineOwners = Array.isArray(baselineResource.owners) ? baselineResource.owners : [];

    let liveMembers = [];
    try { liveMembers = await graphGetAll(token, `/groups/${resourceId}/members`).catch(() => []); } catch (err) { liveMembers = []; }
    let liveOwners = [];
    try { liveOwners = await graphGetAll(token, `/groups/${resourceId}/owners`).catch(() => []); } catch (err) { liveOwners = []; }

    const liveMemberIds = new Set(liveMembers.map(m => m.id));
    const liveOwnerIds = new Set(liveOwners.map(o => o.id));

    const resolvePrincipalId = async (item) => {
      if (!item) return null;
      if (item.id) return item.id;
      if (item.userPrincipalName) {
        try {
          const u = await graphGet(token, `/users/${encodeURIComponent(item.userPrincipalName)}`).catch(() => null);
          if (u && u.id) return u.id;
        } catch (err) { }
      }
      return null;
    };

    for (const bm of baselineMembers) {
      try {
        const pid = await resolvePrincipalId(bm);
        if (!pid || liveMemberIds.has(pid)) continue;
        await graphPost(token, `/groups/${resourceId}/members/$ref`, { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${pid}` });
      } catch (err) { }
    }

    for (const bo of baselineOwners) {
      try {
        const pid = await resolvePrincipalId(bo);
        if (!pid || liveOwnerIds.has(pid)) continue;
        await graphPost(token, `/groups/${resourceId}/owners/$ref`, { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${pid}` });
      } catch (err) { }
    }
  },
};

const DEFAULT_ENV_APP_PERMISSION = 'TEAMS_APP_PERMISSION_POLICIES_ENDPOINTS';
const DEFAULT_ENV_CHANNELS = 'TEAMS_CHANNELS_POLICIES_ENDPOINTS';
const ENABLE_TEAMS_POLICY_RESTORE = String(process.env.TEAMS_POLICY_RESTORE_ENABLE || '').toLowerCase() === 'true';
const APP_PERMISSION_POLICY_ALLOWLIST = ['displayName', 'description', 'defaultCatalogAppsType', 'globalCatalogAppsType', 'privateCatalogAppsType'];
const CHANNELS_POLICY_ALLOWLIST = ['displayName', 'description', 'allowPrivateChannelCreation', 'allowSharedChannelCreation'];

const teamsAppPermissionPolicies = {
  areaKey: 'teams_app_permission_policies',
  displayName: 'App Permission Policies',
  description: 'Teams app permission policies — controls org app access posture.',
  licenceRequired: null,
  readPermissions: ['Policy.Read.All'],
  writePermissions: ['TeamSettings.ReadWrite.All'],
  restoreSupported: ENABLE_TEAMS_POLICY_RESTORE,
  restoreReason: ENABLE_TEAMS_POLICY_RESTORE ? null : 'Restore is disabled by default. Set TEAMS_POLICY_RESTORE_ENABLE=true after validating policy write behavior in your tenant.',
  graphBasePath: '/policies/teamsAppPermissionPolicies',

  async pull(token) {
    const raw = process.env[DEFAULT_ENV_APP_PERMISSION] || '';
    const endpoints = [`${BETA_URL}/policies/teamsAppPermissionPolicies`].concat(raw.split(',').map(s => s.trim()).filter(Boolean));
    const resources = {};
    for (const ep of endpoints) {
      let path = ep;
      if (!path.startsWith('http')) {
        if (path.startsWith('beta:')) path = `${BETA_URL}${path.slice(5)}`;
        else if (path.startsWith('/beta')) path = `${BETA_URL}${path.slice(5)}`;
        else if (!path.startsWith('/')) path = `/${path}`;
      }

      let items;
      try { items = await graphGetAll(token, path); } catch { continue; }
      if (!Array.isArray(items) || items.length === 0) continue;
      for (const it of items) {
        const id = it.id || it.displayName || (`teams_app_perm_${Math.random().toString(36).slice(2,9)}`);
        if (resources[id]) continue;
        resources[id] = {
          id,
          displayName: it.displayName || `App Permission Policy ${id}`,
          description: it.description || null,
          defaultCatalogAppsType: it.defaultCatalogAppsType ?? null,
          globalCatalogAppsType: it.globalCatalogAppsType ?? null,
          privateCatalogAppsType: it.privateCatalogAppsType ?? null,
          raw: it,
        };
      }
    }
    return resources;
  },

  async get(token, resourceId) {
    const tryPaths = [ `${BETA_URL}/policies/teamsAppPermissionPolicies/${resourceId}`, `/policies/teamsAppPermissionPolicies/${resourceId}` ];
    for (const p of tryPaths) {
      try {
        const it = await graphGet(token, p).catch(() => null);
        if (!it) continue;
        return {
          id: it.id || resourceId,
          displayName: it.displayName || `App Permission Policy ${resourceId}`,
          description: it.description || null,
          defaultCatalogAppsType: it.defaultCatalogAppsType ?? null,
          globalCatalogAppsType: it.globalCatalogAppsType ?? null,
          privateCatalogAppsType: it.privateCatalogAppsType ?? null,
          raw: it,
        };
      } catch { continue; }
    }
    return null;
  },

  monitorOnlyKeys: ['raw'],
  watchableKeys: [
    { path: 'displayName', label: 'Policy Name', type: 'string' },
    { path: 'description', label: 'Description', type: 'string' },
    { path: 'defaultCatalogAppsType', label: 'Default Catalog Apps Type', type: 'string' },
    { path: 'globalCatalogAppsType', label: 'Global Catalog Apps Type', type: 'string' },
    { path: 'privateCatalogAppsType', label: 'Private Catalog Apps Type', type: 'string' },
    { path: 'raw', label: 'Policy Payload (monitor only)', type: 'json' },
  ],

  async restore(token, resourceId, baselineResource = {}) {
    if (!ENABLE_TEAMS_POLICY_RESTORE) {
      throw new Error('Teams policy restore is disabled. Set TEAMS_POLICY_RESTORE_ENABLE=true to enable after tenant validation.');
    }
    const patch = {};
    for (const f of APP_PERMISSION_POLICY_ALLOWLIST) {
      if (baselineResource[f] !== undefined && baselineResource[f] !== null) patch[f] = baselineResource[f];
    }
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/policies/teamsAppPermissionPolicies/${resourceId}`, patch);
  },
};

const teamsChannelsPolicies = {
  areaKey: 'teams_channels_policies',
  displayName: 'Channels Policies',
  description: 'Teams channels policies — private/shared channel governance posture.',
  licenceRequired: null,
  readPermissions: ['Policy.Read.All'],
  writePermissions: ['TeamSettings.ReadWrite.All'],
  restoreSupported: ENABLE_TEAMS_POLICY_RESTORE,
  restoreReason: ENABLE_TEAMS_POLICY_RESTORE ? null : 'Restore is disabled by default. Set TEAMS_POLICY_RESTORE_ENABLE=true after validating policy write behavior in your tenant.',
  graphBasePath: '/policies/teamsChannelsPolicies',

  async pull(token) {
    const raw = process.env[DEFAULT_ENV_CHANNELS] || '';
    const endpoints = [`${BETA_URL}/policies/teamsChannelsPolicies`].concat(raw.split(',').map(s => s.trim()).filter(Boolean));
    const resources = {};
    for (const ep of endpoints) {
      let path = ep;
      if (!path.startsWith('http')) {
        if (path.startsWith('beta:')) path = `${BETA_URL}${path.slice(5)}`;
        else if (path.startsWith('/beta')) path = `${BETA_URL}${path.slice(5)}`;
        else if (!path.startsWith('/')) path = `/${path}`;
      }

      let items;
      try { items = await graphGetAll(token, path); } catch { continue; }
      if (!Array.isArray(items) || items.length === 0) continue;
      for (const it of items) {
        const id = it.id || it.displayName || (`teams_channels_policy_${Math.random().toString(36).slice(2,9)}`);
        if (resources[id]) continue;
        resources[id] = {
          id,
          displayName: it.displayName || `Channels Policy ${id}`,
          description: it.description || null,
          allowPrivateChannelCreation: it.allowPrivateChannelCreation ?? null,
          allowSharedChannelCreation: it.allowSharedChannelCreation ?? null,
          raw: it,
        };
      }
    }
    return resources;
  },

  async get(token, resourceId) {
    const tryPaths = [ `${BETA_URL}/policies/teamsChannelsPolicies/${resourceId}`, `/policies/teamsChannelsPolicies/${resourceId}` ];
    for (const p of tryPaths) {
      try {
        const it = await graphGet(token, p).catch(() => null);
        if (!it) continue;
        return {
          id: it.id || resourceId,
          displayName: it.displayName || `Channels Policy ${resourceId}`,
          description: it.description || null,
          allowPrivateChannelCreation: it.allowPrivateChannelCreation ?? null,
          allowSharedChannelCreation: it.allowSharedChannelCreation ?? null,
          raw: it,
        };
      } catch { continue; }
    }
    return null;
  },

  monitorOnlyKeys: ['raw'],
  watchableKeys: [
    { path: 'displayName', label: 'Policy Name', type: 'string' },
    { path: 'description', label: 'Description', type: 'string' },
    { path: 'allowPrivateChannelCreation', label: 'Allow Private Channel Creation', type: 'boolean' },
    { path: 'allowSharedChannelCreation', label: 'Allow Shared Channel Creation', type: 'boolean' },
    { path: 'raw', label: 'Policy Payload (monitor only)', type: 'json' },
  ],

  async restore(token, resourceId, baselineResource = {}) {
    if (!ENABLE_TEAMS_POLICY_RESTORE) {
      throw new Error('Teams policy restore is disabled. Set TEAMS_POLICY_RESTORE_ENABLE=true to enable after tenant validation.');
    }
    const patch = {};
    for (const f of CHANNELS_POLICY_ALLOWLIST) {
      if (baselineResource[f] !== undefined && baselineResource[f] !== null) patch[f] = baselineResource[f];
    }
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/policies/teamsChannelsPolicies/${resourceId}`, patch);
  },
};

const teamsOrgAppSettings = {
  areaKey: 'teams_org_app_settings',
  displayName: 'Org App Settings',
  description: 'Teams organization app settings — sideloading and app request posture.',
  licenceRequired: null,
  readPermissions: ['TeamworkAppSettings.Read.All'],
  writePermissions: ['TeamworkAppSettings.ReadWrite.All'],
  restoreSupported: true,
  graphBasePath: '/teamwork/teamsAppSettings',

  async pull(token) {
    const settings = await graphGet(token, '/teamwork/teamsAppSettings').catch(() => null);
    if (!settings) return {};
    return {
      tenant: {
        id: 'tenant',
        displayName: 'Teams Org App Settings',
        isSideloadingEnabled: settings.isSideloadingEnabled ?? null,
        isUserRequestsForAppAccessEnabled: settings.isUserRequestsForAppAccessEnabled ?? null,
        raw: settings,
      }
    };
  },

  async get(token) {
    const resources = await this.pull(token);
    return resources.tenant || null;
  },

  monitorOnlyKeys: ['raw'],
  watchableKeys: [
    { path: 'isSideloadingEnabled', label: 'Sideloading Enabled', type: 'boolean' },
    { path: 'isUserRequestsForAppAccessEnabled', label: 'User Requests For App Access Enabled', type: 'boolean' },
    { path: 'raw', label: 'Teams App Settings Payload (monitor only)', type: 'json' },
  ],

  async restore(token, _resourceId, baselineResource = {}) {
    const patch = {};
    for (const f of ['isSideloadingEnabled', 'isUserRequestsForAppAccessEnabled']) {
      if (baselineResource[f] !== undefined && baselineResource[f] !== null) patch[f] = baselineResource[f];
    }
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, '/teamwork/teamsAppSettings', patch);
  },
};

const teamsGroup = {
  teams_policies_messaging: teamsMessagingPolicies,
  teams_policies_meetings: teamsMeetingPolicies,
  teams_membership: teamsMembership,
  teams_app_permission_policies: teamsAppPermissionPolicies,
  teams_channels_policies: teamsChannelsPolicies,
  teams_org_app_settings: teamsOrgAppSettings,
};

// grouped collectors are defined above as `exchangeMailboxes`, `exchangeConnectors`,
// `exchangeTransportRules`, `teamsMessagingPolicies`, `teamsMeetingPolicies`, `teamsMembership`.

// ─── LICENCE-AWARE ERROR CLASSIFICATION ──────────────────────────────────────
const LICENCE_ERROR_PATTERNS = [
  'request not applicable to target tenant',
  'request not applicable to target domain',
  'does not have a license',
  'does not have premium',
  'subscription',
];
function isLicenceError(err) {
  const msg = (err?.message || '').toLowerCase();
  return LICENCE_ERROR_PATTERNS.some(p => msg.includes(p));
}
class LicenceUnavailableError extends Error {
  constructor(featureName) {
    super(`${featureName} is not available on this tenant's current licence tier.`);
    this.code = 'LICENCE_UNAVAILABLE';
  }
}
class CollectorUnavailableError extends Error {
  constructor(featureName, detail = '') {
    super(detail ? `${featureName} is currently unavailable. ${detail}` : `${featureName} is currently unavailable.`);
    this.code = 'COLLECTOR_UNAVAILABLE';
  }
}

// ─── COLLECTOR: Entra Role Assignments ───────────────────────────────────────
// Restore model: assignments are immutable — re-create if missing.
const entraRoles = {
  areaKey: 'entra_roles',
  displayName: 'Role Assignments',
  description: 'Active directory role assignments — who holds which admin role',
  licenceRequired: null,
  readPermissions:  ['RoleManagement.Read.Directory'],
  writePermissions: ['RoleManagement.ReadWrite.Directory'],
  graphBasePath: '/roleManagement/directory/roleAssignments',

  async pull(token) {
    const assignments = await graphGetAll(token,
      '/roleManagement/directory/roleAssignments?$expand=principal'
    );
    const roleDefCache = {};
    const getRoleName = async (roleDefinitionId) => {
      if (roleDefCache[roleDefinitionId]) return roleDefCache[roleDefinitionId];
      try {
        const def = await graphGet(token, `/roleManagement/directory/roleDefinitions/${roleDefinitionId}`);
        roleDefCache[roleDefinitionId] = def?.displayName || 'Unknown Role';
      } catch { roleDefCache[roleDefinitionId] = 'Unknown Role'; }
      return roleDefCache[roleDefinitionId];
    };
    const resources = {};
    for (const a of assignments) {
      const roleName = await getRoleName(a.roleDefinitionId);
      resources[a.id] = {
        id: a.id,
        displayName: `${roleName} — ${a.principal?.displayName || a.principalId}`,
        roleDefinitionId: a.roleDefinitionId,
        roleName,
        principalId: a.principalId,
        principalDisplayName: a.principal?.displayName || 'Unknown',
        principalType: a.principal?.['@odata.type']?.split('.').pop() || 'unknown',
        directoryScopeId: a.directoryScopeId,
      };
    }
    return resources;
  },

  monitorOnlyKeys: ['roleName', 'principalDisplayName', 'principalType', 'directoryScopeId'],

  watchableKeys: [
    { path: 'roleName',             label: 'Role Name',            type: 'string' },
    { path: 'principalDisplayName', label: 'Principal Name',       type: 'string' },
    { path: 'principalType',        label: 'Principal Type',       type: 'string' },
    { path: 'directoryScopeId',     label: 'Scope',                type: 'string' },
  ],

  async restore(token, resourceId, baselineResource) {
    const existing = await graphGet(token, `/roleManagement/directory/roleAssignments/${resourceId}`)
      .catch(() => null);
    if (!existing) {
      await graphPost(token, '/roleManagement/directory/roleAssignments', {
        roleDefinitionId: baselineResource.roleDefinitionId,
        principalId:      baselineResource.principalId,
        directoryScopeId: baselineResource.directoryScopeId,
      });
    }
  },
};

// ─── COLLECTOR: User Accounts ─────────────────────────────────────────────────
// Expanded to include all writable profile fields.
// Excluded (read-only or system-managed): mail, userType, onPremisesSyncEnabled,
//   licenceCount, assignedLicenses, lastPasswordChangeDateTime, createdDateTime,
//   proxyAddresses (Exchange), externalUserState.
// userPrincipalName: monitor-only (changing UPN changes login — too destructive for auto-restore).
const entraUsers = {
  areaKey: 'entra_users',
  displayName: 'User Accounts',
  description: 'Entra ID user accounts — account status, password policies, profile and address attributes',
  licenceRequired: null,
  readPermissions:  ['User.Read.All'],
  writePermissions: ['User.ReadWrite.All'],
  graphBasePath: '/users',

  async pull(token) {
    const users = await graphGetAll(token,
      '/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,' +
      'passwordPolicies,department,jobTitle,officeLocation,mobilePhone,usageLocation,' +
      'streetAddress,city,state,postalCode,country,businessPhones,faxNumber,preferredLanguage'
    );
    const resources = {};
    for (const u of users) {
      resources[u.id] = {
        id:                 u.id,
        displayName:        u.displayName,
        userPrincipalName:  u.userPrincipalName,
        accountEnabled:     u.accountEnabled,
        userType:           u.userType    || 'Member',
        department:         u.department  || '',
        jobTitle:           u.jobTitle    || '',
        officeLocation:     u.officeLocation || '',
        mobilePhone:        u.mobilePhone || '',
        usageLocation:      u.usageLocation || '',
        passwordPolicies:   u.passwordPolicies || 'None',
        // Address fields
        streetAddress:      u.streetAddress  || '',
        city:               u.city           || '',
        state:              u.state          || '',
        postalCode:         u.postalCode     || '',
        country:            u.country        || '',
        // Communication
        businessPhones:     u.businessPhones || [],
        faxNumber:          u.faxNumber      || '',
        preferredLanguage:  u.preferredLanguage || '',
      };
    }
    return resources;
  },

  // userPrincipalName: monitor for UPN changes but excluded from restore (changes login)
  // userType: read-only for most tenants
  monitorOnlyKeys: ['userPrincipalName', 'userType'],

  // graphRejectsEmpty: Graph rejects empty strings for these optional string fields
  graphRejectsEmpty: new Set([
    'department', 'jobTitle', 'officeLocation', 'mobilePhone', 'usageLocation',
    'streetAddress', 'city', 'state', 'postalCode', 'country', 'faxNumber', 'preferredLanguage',
  ]),

  watchableKeys: [
    { path: 'displayName',       label: 'Display Name',         type: 'string' },
    { path: 'userPrincipalName', label: 'User Principal Name (monitor only)', type: 'string' },
    { path: 'accountEnabled',    label: 'Account Enabled',      type: 'boolean' },
    { path: 'department',        label: 'Department',           type: 'string' },
    { path: 'jobTitle',          label: 'Job Title',            type: 'string' },
    { path: 'officeLocation',    label: 'Office Location',      type: 'string' },
    { path: 'mobilePhone',       label: 'Mobile Phone',         type: 'string' },
    { path: 'usageLocation',     label: 'Usage Location',       type: 'string' },
    { path: 'passwordPolicies',  label: 'Password Policies',    type: 'string' },
    { path: 'streetAddress',     label: 'Street Address',       type: 'string' },
    { path: 'city',              label: 'City',                 type: 'string' },
    { path: 'state',             label: 'State / Province',     type: 'string' },
    { path: 'postalCode',        label: 'Postal Code',          type: 'string' },
    { path: 'country',           label: 'Country',              type: 'string' },
    { path: 'businessPhones',    label: 'Business Phones',      type: 'array' },
    { path: 'faxNumber',         label: 'Fax Number',           type: 'string' },
    { path: 'preferredLanguage', label: 'Preferred Language',   type: 'string' },
    { path: 'userType',          label: 'User Type (monitor only)', type: 'string' },
  ],

  async restore(token, resourceId, baselineResource) {
    const patch = {};
    const safeStringFields = [
      'displayName', 'department', 'jobTitle', 'officeLocation', 'mobilePhone',
      'usageLocation', 'passwordPolicies', 'streetAddress', 'city', 'state',
      'postalCode', 'country', 'faxNumber', 'preferredLanguage',
    ];
    for (const field of safeStringFields) {
      const val = baselineResource[field];
      if (val !== undefined && val !== null && val !== '') patch[field] = val;
    }
    // Boolean: false is valid and must not be skipped
    if (baselineResource.accountEnabled !== undefined && baselineResource.accountEnabled !== null) {
      patch.accountEnabled = baselineResource.accountEnabled;
    }
    // Array: businessPhones — restore if baseline has values
    if (Array.isArray(baselineResource.businessPhones) && baselineResource.businessPhones.length > 0) {
      patch.businessPhones = baselineResource.businessPhones;
    }
    // userPrincipalName + userType: deliberately excluded
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/users/${resourceId}`, patch);
  },
};

// ─── COLLECTOR: Groups ────────────────────────────────────────────────────────
// mailNickname: monitor-only (affects email routing)
// groupType/membershipType: immutable after creation — monitor-only
const entraGroups = {
  areaKey: 'entra_groups',
  displayName: 'Groups',
  description: 'Entra ID security and M365 groups — settings, visibility, dynamic rules',
  licenceRequired: null,
  readPermissions:  ['Group.Read.All'],
  writePermissions: ['Group.ReadWrite.All'],
  graphBasePath: '/groups',

  async pull(token) {
    const groups = await graphGetAll(token,
      '/groups?$select=id,displayName,description,groupTypes,securityEnabled,mailEnabled,' +
      'visibility,membershipRule,membershipRuleProcessingState,mailNickname,classification,' +
      'resourceBehaviorOptions,resourceProvisioningOptions,preferredDataLocation,theme'
    );
    const resources = {};
    for (const g of groups) {
      const isM365    = (g.groupTypes || []).includes('Unified');
      const isDynamic = (g.groupTypes || []).includes('DynamicMembership');
      resources[g.id] = {
        id:             g.id,
        displayName:    g.displayName,
        description:    g.description || '',
        mailNickname:   g.mailNickname || '',
        groupType:      isM365 ? 'Microsoft 365' : g.securityEnabled ? 'Security' : 'Distribution',
        membershipType: isDynamic ? 'Dynamic' : 'Assigned',
        securityEnabled: g.securityEnabled,
        visibility:     g.visibility || 'Private',
        membershipRule: g.membershipRule || null,
        membershipRuleProcessingState: g.membershipRuleProcessingState || null,
        classification: g.classification || '',
        // M365-only settings
        resourceBehaviorOptions:    g.resourceBehaviorOptions    || [],
        resourceProvisioningOptions: g.resourceProvisioningOptions || [],
        preferredDataLocation:      g.preferredDataLocation      || null,
        theme:                      g.theme                      || null,
      };
    }
    return resources;
  },

  monitorOnlyKeys: ['mailNickname', 'groupType', 'membershipType'],

  watchableKeys: [
    { path: 'displayName',                   label: 'Display Name',                type: 'string' },
    { path: 'description',                   label: 'Description',                 type: 'string' },
    { path: 'visibility',                    label: 'Visibility',                  type: 'enum', options: ['Private', 'Public', 'HiddenMembership'] },
    { path: 'classification',                label: 'Classification',              type: 'string' },
    { path: 'membershipRule',                label: 'Dynamic Membership Rule',     type: 'string' },
    { path: 'membershipRuleProcessingState', label: 'Dynamic Membership State',    type: 'string' },
    { path: 'resourceBehaviorOptions',       label: 'Resource Behaviour Options',  type: 'array' },
    { path: 'resourceProvisioningOptions',   label: 'Resource Provisioning Options', type: 'array' },
    { path: 'preferredDataLocation',         label: 'Preferred Data Location',     type: 'string' },
    { path: 'theme',                         label: 'Group Theme (M365)',          type: 'string' },
    { path: 'mailNickname',                  label: 'Mail Nickname (monitor only)', type: 'string' },
    { path: 'groupType',                     label: 'Group Type (monitor only)',    type: 'string' },
    { path: 'membershipType',                label: 'Membership Type (monitor only)', type: 'string' },
  ],

  async restore(token, resourceId, baselineResource) {
    const patch = {};
    const mutableFields = ['displayName', 'description', 'visibility', 'classification'];
    for (const field of mutableFields) {
      const val = baselineResource[field];
      if (val !== undefined && val !== null) patch[field] = val;
    }
    // Dynamic group membership rule
    if (baselineResource.membershipType === 'Dynamic') {
      if (baselineResource.membershipRule != null)
        patch.membershipRule = baselineResource.membershipRule;
      if (baselineResource.membershipRuleProcessingState != null)
        patch.membershipRuleProcessingState = baselineResource.membershipRuleProcessingState;
    }
    // M365-specific fields
    if (baselineResource.groupType === 'Microsoft 365') {
      if (Array.isArray(baselineResource.resourceBehaviorOptions) && baselineResource.resourceBehaviorOptions.length > 0)
        patch.resourceBehaviorOptions = baselineResource.resourceBehaviorOptions;
      if (baselineResource.theme != null)
        patch.theme = baselineResource.theme;
      if (baselineResource.preferredDataLocation != null)
        patch.preferredDataLocation = baselineResource.preferredDataLocation;
    }
    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/groups/${resourceId}`, patch);
  },
};

// ─── COLLECTOR: App Registrations ────────────────────────────────────────────
// Expanded to include full permission set (requiredResourceAccess) and redirect URIs.
// Credential expiry fields remain monitor-only — secrets must be rotated manually.
const entraAppRegistrations = {
  areaKey: 'entra_apps',
  displayName: 'App Registrations',
  description: 'Entra ID app registrations — permissions, redirect URIs, sign-in audience, credential expiry',
  licenceRequired: null,
  readPermissions:  ['Application.Read.All'],
  writePermissions: ['Application.ReadWrite.All'],
  graphBasePath: '/applications',

  async pull(token) {
    const apps = await graphGetAll(token,
      '/applications?$select=id,appId,displayName,description,requiredResourceAccess,' +
      'passwordCredentials,keyCredentials,signInAudience,tags,notes,web,spa,publicClient,' +
      'identifierUris,optionalClaims'
    );
    const now = new Date();
    const resources = {};
    for (const app of apps) {
      const allCreds = [...(app.passwordCredentials || []), ...(app.keyCredentials || [])];
      const hasExpiredCreds = allCreds.some(c => c.endDateTime && new Date(c.endDateTime) < now);
      const hasExpiringSoon = allCreds.some(c => {
        if (!c.endDateTime) return false;
        const exp = new Date(c.endDateTime);
        return exp >= now && (exp - now) < 30 * 86400000;
      });
      resources[app.id] = {
        id:                     app.id,
        displayName:            app.displayName,
        description:            app.description || '',
        signInAudience:         app.signInAudience,
        tags:                   app.tags || [],
        notes:                  app.notes || '',
        // Full permission set — enables drift detection when permissions are added/removed
        requiredResourceAccess: app.requiredResourceAccess || [],
        permissionCount: (app.requiredResourceAccess || []).reduce(
          (sum, r) => sum + (r.resourceAccess || []).length, 0
        ),
        // Redirect URIs
        webRedirectUris:        (app.web?.redirectUris)          || [],
        spaRedirectUris:        (app.spa?.redirectUris)          || [],
        publicClientRedirectUris: (app.publicClient?.redirectUris) || [],
        webLogoutUrl:           app.web?.logoutUrl               || '',
        // Implicit grant
        enableAccessTokenIssuance:  app.web?.implicitGrantSettings?.enableAccessTokenIssuance  ?? false,
        enableIdTokenIssuance:      app.web?.implicitGrantSettings?.enableIdTokenIssuance      ?? false,
        // Identifier URIs
        identifierUris:         app.identifierUris || [],
        // Optional claims summary
        hasOptionalClaims:      !!(app.optionalClaims && (
          (app.optionalClaims.accessToken?.length || 0) +
          (app.optionalClaims.idToken?.length     || 0) +
          (app.optionalClaims.saml2Token?.length  || 0)
        ) > 0),
        // Credential expiry — monitor-only signals
        hasExpiredCreds,
        hasExpiringSoon,
      };
    }
    return resources;
  },

  monitorOnlyKeys: ['permissionCount', 'hasExpiredCreds', 'hasExpiringSoon'],

  watchableKeys: [
    { path: 'displayName',          label: 'Display Name',                        type: 'string' },
    { path: 'description',          label: 'Description',                         type: 'string' },
    { path: 'signInAudience',       label: 'Sign-in Audience',                    type: 'enum', options: ['AzureADMyOrg', 'AzureADMultipleOrgs', 'AzureADandPersonalMicrosoftAccount'] },
    { path: 'tags',                 label: 'Application Tags',                    type: 'array' },
    { path: 'notes',                label: 'Notes',                               type: 'string' },
    // Full permission set — detect when API permissions are added or removed
    { path: 'requiredResourceAccess', label: 'API Permissions (full set)',        type: 'json' },
    { path: 'permissionCount',      label: 'API Permission Count (monitor only)', type: 'number' },
    // Redirect URIs
    { path: 'webRedirectUris',      label: 'Web Redirect URIs',                  type: 'array' },
    { path: 'spaRedirectUris',      label: 'SPA Redirect URIs',                  type: 'array' },
    { path: 'publicClientRedirectUris', label: 'Mobile/Desktop Redirect URIs',   type: 'array' },
    { path: 'webLogoutUrl',         label: 'Logout URL',                         type: 'string' },
    { path: 'enableAccessTokenIssuance', label: 'Implicit Access Token Enabled', type: 'boolean' },
    { path: 'enableIdTokenIssuance',     label: 'Implicit ID Token Enabled',     type: 'boolean' },
    { path: 'identifierUris',       label: 'Identifier URIs',                    type: 'array' },
    { path: 'hasOptionalClaims',    label: 'Has Optional Claims',                type: 'boolean' },
    // Credential expiry monitoring
    { path: 'hasExpiredCreds',      label: 'Has Expired Credentials (monitor only)', type: 'boolean' },
    { path: 'hasExpiringSoon',      label: 'Credentials Expiring Soon (monitor only)', type: 'boolean' },
  ],

  async restore(token, resourceId, baselineResource) {
    const patch = {};

    // Simple scalar fields
    const mutableFields = ['displayName', 'description', 'notes', 'tags', 'signInAudience'];
    for (const field of mutableFields) {
      const val = baselineResource[field];
      if (val !== undefined && val !== null) patch[field] = val;
    }

    // Full permission set — restore exact set of required resource access
    if (Array.isArray(baselineResource.requiredResourceAccess)) {
      patch.requiredResourceAccess = baselineResource.requiredResourceAccess;
    }

    // Identifier URIs
    if (Array.isArray(baselineResource.identifierUris)) {
      patch.identifierUris = baselineResource.identifierUris;
    }

    // Web configuration (redirect URIs, logout URL, implicit grant)
    const web = {};
    if (Array.isArray(baselineResource.webRedirectUris))
      web.redirectUris = baselineResource.webRedirectUris;
    if (baselineResource.webLogoutUrl !== undefined && baselineResource.webLogoutUrl !== null)
      web.logoutUrl = baselineResource.webLogoutUrl;
    if (baselineResource.enableAccessTokenIssuance !== undefined ||
        baselineResource.enableIdTokenIssuance    !== undefined) {
      web.implicitGrantSettings = {
        enableAccessTokenIssuance: baselineResource.enableAccessTokenIssuance ?? false,
        enableIdTokenIssuance:     baselineResource.enableIdTokenIssuance     ?? false,
      };
    }
    if (Object.keys(web).length > 0) patch.web = web;

    // SPA redirect URIs
    if (Array.isArray(baselineResource.spaRedirectUris)) {
      patch.spa = { redirectUris: baselineResource.spaRedirectUris };
    }

    // Public client (mobile/desktop) redirect URIs
    if (Array.isArray(baselineResource.publicClientRedirectUris)) {
      patch.publicClient = { redirectUris: baselineResource.publicClientRedirectUris };
    }

    if (Object.keys(patch).length === 0) return;
    await graphPatch(token, `/applications/${resourceId}`, patch);
  },
};

// ─── COLLECTOR: Authentication Policies ──────────────────────────────────────
// Added: Security Defaults policy (/policies/identitySecurityDefaultsEnforcementPolicy)
// This is one of the most critical security controls — enables/disables Security Defaults.
const entraAuthPolicies = {
  areaKey: 'entra_auth_policies',
  displayName: 'Authentication Policies',
  description: 'Security Defaults, guest invite settings, SSPR, auth method configuration, admin consent',
  licenceRequired: null,
  readPermissions:  ['Policy.Read.All'],
  writePermissions: ['Policy.ReadWrite.AuthenticationMethod'],

  async pull(token) {
    const resources = {};

    // Security Defaults — one of the most critical tenant-level security controls
    try {
      let secDefaults = null;
      try {
        secDefaults = await graphGet(token, '/policies/identitySecurityDefaultsEnforcementPolicy');
      } catch (err) {
        // Some tenants only expose this under the Graph beta API and v1.0 returns 400.
        if (err && err.statusCode === 400) {
          try {
            secDefaults = await graphGet(token, `${BETA}/policies/identitySecurityDefaultsEnforcementPolicy`);
          } catch (err2) { if (!isLicenceError(err2)) throw err2; }
        } else if (!isLicenceError(err)) throw err;
      }

      if (secDefaults) {
        resources['security_defaults'] = {
          id: 'security_defaults',
          displayName: 'Security Defaults',
          isEnabled: secDefaults.isEnabled,
        };
      }
    } catch (err) { if (!isLicenceError(err)) throw err; }

    // Authorization policy — guest invites, SSPR, default user permissions
    try {
      let authz = null;
      try {
        authz = await graphGet(token, '/policies/authorizationPolicy');
      } catch (err) {
        // Some tenants expose this under Graph beta when v1.0 returns 400
        if (err && err.statusCode === 400) {
          try {
            authz = await graphGet(token, `${BETA}/policies/authorizationPolicy`);
          } catch (err2) { if (!isLicenceError(err2)) throw err2; }
        } else if (!isLicenceError(err)) throw err;
      }
      if (authz) {
        resources['authorization_policy'] = {
          id: 'authorization_policy',
          displayName: 'Authorization Policy',
          allowInvitesFrom:                          authz.allowInvitesFrom,
          allowedToSignUpEmailBasedSubscriptions:    authz.allowedToSignUpEmailBasedSubscriptions,
          allowedToUseSSPR:                          authz.allowedToUseSSPR,
          allowEmailVerifiedUsersToJoinOrganization: authz.allowEmailVerifiedUsersToJoinOrganization,
          blockMsolPowerShell:                       authz.blockMsolPowerShell,
          defaultUserRolePermissions:                authz.defaultUserRolePermissions,
          guestUserRoleId:                           authz.guestUserRoleId,
        };
      }
    } catch (err) { if (!isLicenceError(err)) throw err; }

    // Authentication methods policy — per-method enable/disable
    try {
      let authMethods = null;
      try {
        authMethods = await graphGet(token, '/policies/authenticationMethodsPolicy');
      } catch (err) {
        // Some tenants expose this under Graph beta when v1.0 returns 400
        if (err && err.statusCode === 400) {
          try {
            authMethods = await graphGet(token, `${BETA}/policies/authenticationMethodsPolicy`);
          } catch (err2) { if (!isLicenceError(err2)) throw err2; }
        } else if (!isLicenceError(err)) throw err;
      }
      if (authMethods) {
        resources['auth_methods_policy'] = {
          id: 'auth_methods_policy',
          displayName: 'Authentication Methods Policy',
          policyVersion: authMethods.policyVersion,
          registrationEnforcement: authMethods.registrationEnforcement,
          authenticationMethodConfigurations: (authMethods.authenticationMethodConfigurations || [])
            .map(m => ({ id: m.id, state: m.state })),
        };
      }
    } catch (err) { if (!isLicenceError(err)) throw err; }

    // Admin consent request policy
    try {
      const consent = await graphGet(token, '/policies/adminConsentRequestPolicy');
      if (consent) {
        resources['admin_consent_policy'] = {
          id: 'admin_consent_policy',
          displayName: 'Admin Consent Request Policy',
          isEnabled:             consent.isEnabled,
          notifyReviewers:       consent.notifyReviewers,
          remindersEnabled:      consent.remindersEnabled,
          requestDurationInDays: consent.requestDurationInDays,
        };
      }
    } catch (err) { if (!isLicenceError(err)) throw err; }

    return resources;
  },

  monitorOnlyKeys: [],

  watchableKeys: [
    // Security Defaults
    { path: 'isEnabled',                                 label: 'Security Defaults Enabled',           type: 'boolean' },
    // Authorization policy
    { path: 'allowInvitesFrom',                          label: 'Allow Guest Invites From',            type: 'enum', options: ['none', 'adminsAndGuestInviters', 'adminsGuestInvitersAndAllMembers', 'everyone'] },
    { path: 'allowedToUseSSPR',                          label: 'SSPR Enabled',                        type: 'boolean' },
    { path: 'allowEmailVerifiedUsersToJoinOrganization', label: 'Allow Email Verified Users to Join',  type: 'boolean' },
    { path: 'blockMsolPowerShell',                       label: 'Block MSOL PowerShell',               type: 'boolean' },
    { path: 'defaultUserRolePermissions',                label: 'Default User Role Permissions',       type: 'json' },
    { path: 'guestUserRoleId',                           label: 'Guest User Role',                     type: 'string' },
    // Auth methods policy
    { path: 'authenticationMethodConfigurations',        label: 'Auth Method States',                  type: 'json' },
    // Admin consent policy
    { path: 'requestDurationInDays',                     label: 'Consent Request Duration (days)',      type: 'number' },
  ],

  async restore(token, resourceId, baselineResource) {
    // Security Defaults
    if (resourceId === 'security_defaults') {
      try {
        await graphPatch(token, '/policies/identitySecurityDefaultsEnforcementPolicy',
          { isEnabled: baselineResource.isEnabled }
        );
      } catch (err) {
        // If v1.0 rejects this tenant, try the beta endpoint as a fallback
        if (err && err.statusCode === 400) {
          await graphPatch(token, `${BETA}/policies/identitySecurityDefaultsEnforcementPolicy`,
            { isEnabled: baselineResource.isEnabled }
          );
        } else if (!isLicenceError(err)) throw err;
      }
    }

    // Authorization policy
    if (resourceId === 'authorization_policy') {
      const { id, displayName, ...patchBody } = baselineResource;
      await graphPatch(token, '/policies/authorizationPolicy', patchBody);
    }

    // Auth methods policy — each method patched individually
    if (resourceId === 'auth_methods_policy') {
      const methods = baselineResource.authenticationMethodConfigurations || [];
      for (const method of methods) {
        if (!method.id || !method.state) continue;
        try {
          await graphPatch(
            token,
            `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/${method.id}`,
            { state: method.state }
          );
        } catch (err) {
          if (!isLicenceError(err)) throw err;
        }
      }
    }

    // Admin consent policy
    if (resourceId === 'admin_consent_policy') {
      const { id, displayName, ...patchBody } = baselineResource;
      await graphPatch(token, '/policies/adminConsentRequestPolicy', patchBody);
    }
  },
};

// ─── COLLECTOR: Conditional Access Policies (P1/P2) ──────────────────────────
// Full conditions object is stored including all user/group/role assignment arrays.
// Restore patches the full policy body — restores assigned users/groups if removed.
// Added: conditions.devices, grantControls.authenticationStrength,
//        conditions.users.includeGuestsOrExternalUsers
const entraCA = {
  areaKey: 'entra_ca',
  displayName: 'Conditional Access Policies',
  description: 'Entra ID Conditional Access policies — conditions, assignments, grant and session controls. Requires Entra ID P1 or P2',
  licenceRequired: 'Entra ID P1 / P2',
  readPermissions:  ['Policy.Read.All'],
  writePermissions: ['Policy.ReadWrite.ConditionalAccess'],
  graphBasePath: '/identity/conditionalAccess/policies',

  async pull(token) {
    let policies;
    try {
      try {
        policies = await graphGetAll(token, '/identity/conditionalAccess/policies');
      } catch (err) {
        // Some tenants return 400 on v1.0 for CA endpoints — try beta
        if (err && err.statusCode === 400) {
          try {
            policies = await graphGetAll(token, `${BETA}/identity/conditionalAccess/policies`);
          } catch (err2) {
            if (isLicenceError(err2)) throw new LicenceUnavailableError('Conditional Access Policies');
            throw err2;
          }
        } else if (isLicenceError(err)) {
          throw new LicenceUnavailableError('Conditional Access Policies');
        } else {
          throw err;
        }
      }
    } catch (err) {
      throw err;
    }
    const resources = {};
    for (const p of policies) {
      resources[p.id] = {
        id:              p.id,
        displayName:     p.displayName,
        description:     p.description || '',
        state:           p.state,
        // Full conditions object — captures all user/group/role/app/platform/location assignments
        conditions:      p.conditions,
        grantControls:   p.grantControls,
        sessionControls: p.sessionControls,
      };
    }
    return resources;
  },

  monitorOnlyKeys: [],

  // Deep nested paths like 'conditions.users.includeUsers' cannot be PATCHed
  // individually via Graph — the full parent object must be sent. Property-level
  // restore at these sub-paths is blocked; use full resource restore instead.
  complexRestoreFields: new Set(['conditions', 'grantControls', 'sessionControls']),

  watchableKeys: [
    { path: 'displayName',                                    label: 'Policy Name',                type: 'string' },
    { path: 'state',                                          label: 'Policy State',               type: 'enum', options: ['enabled', 'disabled', 'enabledForReportingButNotEnforced'] },
    // User/group/role assignments
    { path: 'conditions.users.includeUsers',                  label: 'Include Users',              type: 'array' },
    { path: 'conditions.users.excludeUsers',                  label: 'Exclude Users',              type: 'array' },
    { path: 'conditions.users.includeGroups',                 label: 'Include Groups',             type: 'array' },
    { path: 'conditions.users.excludeGroups',                 label: 'Exclude Groups',             type: 'array' },
    { path: 'conditions.users.includeRoles',                  label: 'Include Roles',              type: 'array' },
    { path: 'conditions.users.excludeRoles',                  label: 'Exclude Roles',              type: 'array' },
    { path: 'conditions.users.includeGuestsOrExternalUsers',  label: 'Include External Users',     type: 'json' },
    // Application assignments
    { path: 'conditions.applications.includeApplications',    label: 'Include Applications',       type: 'array' },
    { path: 'conditions.applications.excludeApplications',    label: 'Exclude Applications',       type: 'array' },
    { path: 'conditions.applications.includeAuthenticationContextClassReferences', label: 'Auth Context', type: 'array' },
    // Client app types and platforms
    { path: 'conditions.clientAppTypes',                      label: 'Client App Types',           type: 'array' },
    { path: 'conditions.platforms.includePlatforms',          label: 'Include Platforms',          type: 'array' },
    { path: 'conditions.platforms.excludePlatforms',          label: 'Exclude Platforms',          type: 'array' },
    // Locations
    { path: 'conditions.locations.includeLocations',          label: 'Include Locations',          type: 'array' },
    { path: 'conditions.locations.excludeLocations',          label: 'Exclude Locations',          type: 'array' },
    // Risk levels
    { path: 'conditions.signInRiskLevels',                    label: 'Sign-in Risk Levels',        type: 'array' },
    { path: 'conditions.userRiskLevels',                      label: 'User Risk Levels',           type: 'array' },
    { path: 'conditions.servicePrincipalRiskLevels',          label: 'Service Principal Risk',     type: 'array' },
    // Device filter
    { path: 'conditions.devices.deviceFilter',                label: 'Device Filter',              type: 'json' },
    // Grant controls
    { path: 'grantControls.builtInControls',                  label: 'Grant Controls',             type: 'array' },
    { path: 'grantControls.operator',                         label: 'Grant Operator (AND/OR)',    type: 'enum', options: ['AND', 'OR'] },
    { path: 'grantControls.customAuthenticationFactors',      label: 'Custom Auth Factors',        type: 'array' },
    { path: 'grantControls.termsOfUse',                       label: 'Terms of Use',               type: 'array' },
    { path: 'grantControls.authenticationStrength',           label: 'Authentication Strength',    type: 'json' },
    // Session controls
    { path: 'sessionControls',                                label: 'Session Controls',           type: 'json' },
  ],

  async restore(token, resourceId, baselineResource) {
    // Restore full policy body — this includes all user/group/role assignments in conditions.
    // If a user was removed from includeUsers, this PATCH re-adds them.
    const { id, ...patchBody } = baselineResource;
    await graphPatch(token, `/identity/conditionalAccess/policies/${resourceId}`, patchBody);
  },
};

// ─── COLLECTOR: Intune Compliance Policies ───────────────────────────────────
// Expanded: added device threat protection fields and TPM requirement.
const intuneCompliance = {
  areaKey: 'intune_compliance',
  displayName: 'Compliance Policies',
  description: 'Device compliance policies — encryption, password, OS version, threat protection requirements',
  licenceRequired: 'Microsoft Intune',
  readPermissions:  ['DeviceManagementConfiguration.Read.All'],
  writePermissions: ['DeviceManagementConfiguration.ReadWrite.All'],
  graphBasePath: '/deviceManagement/deviceCompliancePolicies',

  async pull(token) {
    let policies;
    try {
      try {
        policies = await graphGetAll(token, '/deviceManagement/deviceCompliancePolicies');
      } catch (err) {
        // Some tenants return 400 on v1.0 for deviceManagement endpoints — try beta
        if (err && err.statusCode === 400) {
          try {
            policies = await graphGetAll(token, `${BETA}/deviceManagement/deviceCompliancePolicies`);
          } catch (err2) {
            if (isLicenceError(err2)) throw new LicenceUnavailableError('Intune Compliance Policies');
            throw err2;
          }
        } else if (isLicenceError(err)) {
          throw new LicenceUnavailableError('Intune Compliance Policies');
        } else {
          throw err;
        }
      }
    } catch (err) {
      throw err;
    }
    const resources = {};
    for (const p of policies) {
      resources[p.id] = {
        id:           p.id,
        displayName:  p.displayName,
        description:  p.description || '',
        platform:     p['@odata.type']?.replace('#microsoft.graph.', '') || 'unknown',
        // Password settings
        passwordRequired:                      p.passwordRequired,
        passwordMinimumLength:                 p.passwordMinimumLength,
        passwordRequiredType:                  p.passwordRequiredType,
        passwordBlockSimple:                   p.passwordBlockSimple,
        passwordExpirationDays:                p.passwordExpirationDays,
        passwordPreviousPasswordBlockCount:    p.passwordPreviousPasswordBlockCount,
        passwordMinutesOfInactivityBeforeLock: p.passwordMinutesOfInactivityBeforeLock,
        // Encryption & secure boot
        storageRequireEncryption:  p.storageRequireEncryption,
        bitLockerEnabled:          p.bitLockerEnabled,
        secureBootEnabled:         p.secureBootEnabled,
        codeIntegrityEnabled:      p.codeIntegrityEnabled,
        tpmRequired:               p.tpmRequired,
        // OS version
        osMinimumVersion:          p.osMinimumVersion,
        osMaximumVersion:          p.osMaximumVersion,
        // Security software
        activeFirewallRequired:    p.activeFirewallRequired,
        defenderEnabled:           p.defenderEnabled,
        antivirusRequired:         p.antivirusRequired,
        antiSpywareRequired:       p.antiSpywareRequired,
        rtpEnabled:                p.rtpEnabled,
        // Threat protection (Defender ATP / Microsoft Defender for Endpoint)
        deviceThreatProtectionEnabled:               p.deviceThreatProtectionEnabled,
        deviceThreatProtectionRequiredSecurityLevel: p.deviceThreatProtectionRequiredSecurityLevel,
        // Advanced Windows checks
        earlyLaunchAntiMalwareDriverEnabled: p.earlyLaunchAntiMalwareDriverEnabled,
      };
    }
    return resources;
  },

  // These fields require Defender for Endpoint licensing.
  // Graph rejects them in PATCH when MDE is not provisioned — monitor only.
  monitorOnlyKeys: [
    'deviceThreatProtectionEnabled',
    'deviceThreatProtectionRequiredSecurityLevel',
  ],

  watchableKeys: [
    { path: 'displayName',                         label: 'Policy Name',               type: 'string' },
    { path: 'description',                         label: 'Description',               type: 'string' },
    { path: 'passwordRequired',                    label: 'Password Required',         type: 'boolean' },
    { path: 'passwordMinimumLength',               label: 'Minimum Password Length',   type: 'number' },
    { path: 'passwordRequiredType',                label: 'Password Type',             type: 'string' },
    { path: 'passwordBlockSimple',                 label: 'Block Simple Passwords',    type: 'boolean' },
    { path: 'passwordExpirationDays',              label: 'Password Expiry (days)',    type: 'number' },
    { path: 'passwordMinutesOfInactivityBeforeLock', label: 'Lock After Inactivity (min)', type: 'number' },
    { path: 'storageRequireEncryption',            label: 'Require Storage Encryption', type: 'boolean' },
    { path: 'bitLockerEnabled',                    label: 'BitLocker Required',        type: 'boolean' },
    { path: 'secureBootEnabled',                   label: 'Secure Boot Required',      type: 'boolean' },
    { path: 'codeIntegrityEnabled',                label: 'Code Integrity Required',   type: 'boolean' },
    { path: 'tpmRequired',                         label: 'TPM Required',              type: 'boolean' },
    { path: 'osMinimumVersion',                    label: 'Minimum OS Version',        type: 'string' },
    { path: 'osMaximumVersion',                    label: 'Maximum OS Version',        type: 'string' },
    { path: 'activeFirewallRequired',              label: 'Firewall Required',         type: 'boolean' },
    { path: 'defenderEnabled',                     label: 'Defender Required',         type: 'boolean' },
    { path: 'antivirusRequired',                   label: 'Antivirus Required',        type: 'boolean' },
    { path: 'rtpEnabled',                          label: 'Real-Time Protection',      type: 'boolean' },
    { path: 'deviceThreatProtectionEnabled',       label: 'Device Threat Protection',  type: 'boolean' },
    { path: 'deviceThreatProtectionRequiredSecurityLevel', label: 'Required Threat Level', type: 'string' },
    { path: 'earlyLaunchAntiMalwareDriverEnabled', label: 'Early Launch Anti-Malware', type: 'boolean' },
  ],

  async restore(token, resourceId, baselineResource) {
    const { id, createdDateTime, lastModifiedDateTime, ...patchBody } = baselineResource;
    await graphPatch(token, `/deviceManagement/deviceCompliancePolicies/${resourceId}`, patchBody);
  },
};

// ─── COLLECTOR: Intune Configuration Profiles ────────────────────────────────
// Settings captured in full — restore patches full settings body.
const intuneConfigProfiles = {
  areaKey: 'intune_config_profiles',
  displayName: 'Configuration Profiles',
  description: 'Device configuration profiles and settings applied to managed devices',
  licenceRequired: 'Microsoft Intune',
  readPermissions:  ['DeviceManagementConfiguration.Read.All'],
  writePermissions: ['DeviceManagementConfiguration.ReadWrite.All'],
  graphBasePath: '/deviceManagement/deviceConfigurations',

  async pull(token) {
    let profiles;
    try {
      profiles = await graphGetAll(token, '/deviceManagement/deviceConfigurations');
    } catch (err) {
      if (isLicenceError(err)) throw new LicenceUnavailableError('Intune Configuration Profiles');
      throw err;
    }
    const resources = {};
    for (const p of profiles) {
      const { id, displayName, description, version, createdDateTime, lastModifiedDateTime,
              '@odata.type': odataType, ...settings } = p;
      resources[p.id] = {
        id,
        displayName,
        description:  description || '',
        platform:     odataType?.replace('#microsoft.graph.', '') || 'unknown',
        version:      version || 0,
        settings,
      };
    }
    return resources;
  },

  // 'settings' in our snapshot is a flat object of all platform-specific fields.
  // Property-level restore on 'settings' would send { settings: {...} } which
  // is not a valid field on deviceConfigurations — use full resource restore instead.
  // 'version' is a read-only field incremented by Graph on every change.
  monitorOnlyKeys: ['settings', 'version'],

  watchableKeys: [
    { path: 'displayName', label: 'Profile Name',        type: 'string' },
    { path: 'description', label: 'Description',         type: 'string' },
    { path: 'version',     label: 'Version',             type: 'number' },
    { path: 'settings',    label: 'All Settings (JSON)', type: 'json' },
  ],

  async restore(token, resourceId, baselineResource) {
    // 'settings' in our snapshot is the bag of flat properties captured from
    // /deviceManagement/deviceConfigurations (e.g. windows10GeneralConfiguration).
    // Restoring means PATCHing those settings back as top-level fields —
    // NOT nested under a 'settings' key, which is not a valid field on this endpoint.
    const { id, createdDateTime, lastModifiedDateTime, platform, version, settings, ...meta } = baselineResource;
    const patchBody = {
      ...meta,           // displayName, description, etc.
      ...(settings || {}), // the captured flat platform-specific properties
    };
    // Strip any remaining read-only or Graph-rejected keys
    const readOnly = ['@odata.type', '@odata.context', 'version', 'deviceStatuses', 'userStatuses', 'deviceStatusOverview'];
    for (const key of readOnly) delete patchBody[key];
    await graphPatch(token, `/deviceManagement/deviceConfigurations/${resourceId}`, patchBody);
  },
};

// ─── BETA BASE URL ────────────────────────────────────────────────────────────
const BETA = 'https://graph.microsoft.com/beta';

// ─── HELPER: pull configurationPolicies by templateFamily (beta) ─────────────
async function pullConfigPolicies(token, templateFamily) {
  let policies;
  try {
    policies = await graphGetAll(token,
      `${BETA}/deviceManagement/configurationPolicies` +
      `?$filter=templateReference/templateFamily eq '${templateFamily}'` +
      `&$expand=settings,assignments`
    );
  } catch (err) {
    if (isLicenceError(err)) throw new LicenceUnavailableError(`Endpoint Security (${templateFamily})`);
    throw err;
  }
  const resources = {};
  for (const p of policies) {
    resources[p.id] = {
      id:              p.id,
      displayName:     p.name,
      description:     p.description || '',
      platforms:       p.platforms,
      technologies:    p.technologies,
      templateFamily,
      templateId:      p.templateReference?.templateId || '',
      templateVersion: p.templateReference?.templateDisplayVersion || '',
      settingCount:    p.settingCount || 0,
      settings:        (p.settings || []).map(s => ({
        id:              s.id,              // Graph-assigned setting GUID — needed for individual PATCH
        settingInstance: s.settingInstance, // the actual configuration values
      })).filter(s => s.settingInstance),
      assignments:     (p.assignments || []).map(a => ({
        groupId:    a.target?.groupId || null,
        intent:     a.intent || 'apply',
        targetType: a.target?.['@odata.type']?.split('.').pop() || 'unknown',
      })),
    };
  }
  return resources;
}

async function restoreConfigPolicy(token, resourceId, baselineResource) {
  // Step 1: PATCH the policy metadata (name/description only).
  // 'settings' is a navigation property — it cannot be included in the root PATCH body.
  await graphPatch(token,
    `${BETA}/deviceManagement/configurationPolicies/${resourceId}`,
    {
      name:        baselineResource.displayName,
      description: baselineResource.description || '',
    }
  );

  const baselineSettings = baselineResource.settings || [];
  if (baselineSettings.length === 0) return;

  // Step 2: Fetch the LIVE setting IDs from Graph.
  // The baseline may store sequential keys ('0','1') from Graph's internal index scheme
  // rather than stable GUIDs. These sequential keys are rejected by Graph PATCH.
  // The only reliable approach is to fetch live settings, match by settingDefinitionId,
  // and use the live setting IDs for the PATCH URLs.
  let liveSettingMap = {}; // settingDefinitionId → live setting id
  try {
    const liveSettings = await graphGetAll(token,
      `${BETA}/deviceManagement/configurationPolicies/${resourceId}/settings`
    );
    for (const ls of liveSettings) {
      const defId = ls.settingInstance?.settingDefinitionId;
      if (defId && ls.id) liveSettingMap[defId] = ls.id;
    }
  } catch {
    // If we can't fetch live settings, fall back to baseline IDs (may fail with '0' etc.)
    liveSettingMap = {};
  }

  const errors   = [];
  const skipped  = []; // settings with no valid live ID → portal redirect

  for (const setting of baselineSettings) {
    const settingInstance = setting.settingInstance;
    if (!settingInstance) continue;

    const defId = settingInstance.settingDefinitionId;

    // Prefer the live ID (looked up by settingDefinitionId); fall back to stored ID
    // only if it is a real GUID (not a sequential index like '0', '1', '2').
    const liveId    = defId ? liveSettingMap[defId] : null;
    const storedId  = setting.id;
    const isRealId  = storedId && /^[0-9a-f\-]{36}$/i.test(storedId);
    const settingId = liveId || (isRealId ? storedId : null);

    if (!settingId) {
      // No resolvable ID — this setting cannot be patched via Graph API
      skipped.push(defId || storedId || 'unknown');
      continue;
    }

    try {
      await graphPatch(token,
        `${BETA}/deviceManagement/configurationPolicies/${resourceId}/settings/${settingId}`,
        { settingInstance }
      );
    } catch (err) {
      const label = defId || settingId;
      errors.push(`${label}: ${err.message}`);
    }
  }

  // Build the combined error message if anything failed or was skipped
  const problems = [];
  if (errors.length > 0) {
    problems.push(
      `${errors.length} setting(s) failed to restore via the Graph API:\n` +
      errors.map(e => `  • ${e}`).join('\n')
    );
  }
  if (skipped.length > 0) {
    problems.push(
      `${skipped.length} setting(s) could not be resolved to a live Graph ID and must be corrected manually:\n` +
      skipped.map(s => `  • ${s}`).join('\n')
    );
  }

  if (problems.length > 0) {
    throw new Error(
      problems.join('\n\n') +
      '\n\nFor any settings listed above, restore them manually via the Intune portal: ' +
      'Endpoint Security → [policy type] → select the policy → Settings.'
    );
  }
}

// ─── COLLECTOR: Windows Update Rings (v1.0) ──────────────────────────────────
const intuneUpdateRings = {
  areaKey: 'intune_update_rings',
  displayName: 'Windows Update Rings',
  description: 'Windows Update for Business rings — feature/quality update deferral, deadlines, pause state',
  licenceRequired: 'Microsoft Intune',
  readPermissions:  ['DeviceManagementConfiguration.Read.All'],
  writePermissions: ['DeviceManagementConfiguration.ReadWrite.All'],
  graphBasePath: '/deviceManagement/deviceConfigurations',

  async pull(token) {
    let configs;
    try {
      configs = await graphGetAll(token, '/deviceManagement/deviceConfigurations');
      configs = configs.filter(c => c['@odata.type'] === '#microsoft.graph.windowsUpdateForBusinessConfiguration');
    } catch (err) {
      if (isLicenceError(err)) throw new LicenceUnavailableError('Windows Update Rings');
      throw err;
    }
    const resources = {};
    for (const c of configs) {
      // Also fetch assignments for this ring
      let assignments = [];
      try {
        const asgn = await graphGetAll(token, `/deviceManagement/deviceConfigurations/${c.id}/assignments`);
        assignments = asgn.map(a => ({ groupId: a.target?.groupId || null, targetType: a.target?.['@odata.type']?.split('.').pop() || 'unknown' }));
      } catch {}
      resources[c.id] = {
        id: c.id,
        displayName: c.displayName,
        description: c.description || '',
        qualityUpdatesDeferralPeriodInDays:  c.qualityUpdatesDeferralPeriodInDays  ?? null,
        qualityUpdatesPaused:                c.qualityUpdatesPaused                ?? false,
        deadlineForQualityUpdatesInDays:     c.deadlineForQualityUpdatesInDays     ?? null,
        featureUpdatesDeferralPeriodInDays:  c.featureUpdatesDeferralPeriodInDays  ?? null,
        featureUpdatesPaused:                c.featureUpdatesPaused                ?? false,
        deadlineForFeatureUpdatesInDays:     c.deadlineForFeatureUpdatesInDays     ?? null,
        deadlineGracePeriodInDays:           c.deadlineGracePeriodInDays           ?? null,
        automaticUpdateMode:                 c.automaticUpdateMode                 || 'autoInstallAtMaintenanceTime',
        updateNotificationLevel:             c.updateNotificationLevel             || 'defaultNotifications',
        allowWindows11Upgrade:               c.allowWindows11Upgrade               ?? null,
        assignments,
      };
    }
    return resources;
  },

  monitorOnlyKeys: ['assignments'],

  watchableKeys: [
    { path: 'displayName',                            label: 'Ring Name',                        type: 'string' },
    { path: 'qualityUpdatesDeferralPeriodInDays',     label: 'Quality Update Deferral (days)',   type: 'number' },
    { path: 'qualityUpdatesPaused',                   label: 'Quality Updates Paused',           type: 'boolean' },
    { path: 'deadlineForQualityUpdatesInDays',        label: 'Quality Update Deadline (days)',   type: 'number' },
    { path: 'featureUpdatesDeferralPeriodInDays',     label: 'Feature Update Deferral (days)',   type: 'number' },
    { path: 'featureUpdatesPaused',                   label: 'Feature Updates Paused',           type: 'boolean' },
    { path: 'deadlineForFeatureUpdatesInDays',        label: 'Feature Update Deadline (days)',   type: 'number' },
    { path: 'deadlineGracePeriodInDays',              label: 'Deadline Grace Period (days)',     type: 'number' },
    { path: 'automaticUpdateMode',                    label: 'Automatic Update Mode',            type: 'string' },
    { path: 'updateNotificationLevel',                label: 'Update Notification Level',        type: 'string' },
    { path: 'assignments',                            label: 'Assigned Groups (monitor only)',   type: 'json' },
  ],

  async restore(token, resourceId, baselineResource) {
    const { id, assignments, ...patchBody } = baselineResource;
    await graphPatch(token, `/deviceManagement/deviceConfigurations/${resourceId}`, patchBody);
  },
};

// ─── COLLECTOR: Mobile Threat Defense Connectors (v1.0) ──────────────────────
const intuneMtdConnectors = {
  areaKey: 'intune_mtd_connectors',
  displayName: 'Mobile Threat Defense Connectors',
  description: 'Defender for Endpoint and partner MTD connector states — enables mobile/endpoint threat integration',
  licenceRequired: 'Microsoft Intune',
  readPermissions:  ['DeviceManagementServiceConfig.Read.All'],
  writePermissions: ['DeviceManagementServiceConfig.ReadWrite.All'],
  graphBasePath: '/deviceManagement/mobileThreatDefenseConnectors',

  async pull(token) {
    let connectors;
    try {
      connectors = await graphGetAll(token, '/deviceManagement/mobileThreatDefenseConnectors');
    } catch (err) {
      if (isLicenceError(err)) throw new LicenceUnavailableError('MTD Connectors');
      throw err;
    }
    const resources = {};
    for (const c of connectors) {
      resources[c.id] = {
        id:               c.id,
        displayName:      c.partnerDisplayName || c.id,
        partnerDisplayName: c.partnerDisplayName || '',
        partnerState:     c.partnerState,
        androidEnabled:   c.androidEnabled   ?? false,
        iosEnabled:       c.iosEnabled       ?? false,
        windowsEnabled:   c.windowsEnabled   ?? false,
        macEnabled:       c.macEnabled       ?? false,
        androidDeviceBlockedOnMissingPartnerData: c.androidDeviceBlockedOnMissingPartnerData ?? false,
        iosDeviceBlockedOnMissingPartnerData:     c.iosDeviceBlockedOnMissingPartnerData     ?? false,
        partnerUnresponsivenessThresholdInDays:   c.partnerUnresponsivenessThresholdInDays   ?? 7,
        lastHeartbeatDateTime: c.lastHeartbeatDateTime || null,
      };
    }
    return resources;
  },

  monitorOnlyKeys: ['partnerState', 'lastHeartbeatDateTime'],

  watchableKeys: [
    { path: 'partnerDisplayName',                       label: 'Partner Name',                      type: 'string' },
    { path: 'partnerState',                             label: 'Partner State (monitor only)',       type: 'string' },
    { path: 'androidEnabled',                           label: 'Android Integration Enabled',        type: 'boolean' },
    { path: 'iosEnabled',                               label: 'iOS Integration Enabled',            type: 'boolean' },
    { path: 'windowsEnabled',                           label: 'Windows Integration Enabled',        type: 'boolean' },
    { path: 'macEnabled',                               label: 'macOS Integration Enabled',          type: 'boolean' },
    { path: 'androidDeviceBlockedOnMissingPartnerData', label: 'Block Android — No Partner Data',   type: 'boolean' },
    { path: 'iosDeviceBlockedOnMissingPartnerData',     label: 'Block iOS — No Partner Data',       type: 'boolean' },
    { path: 'partnerUnresponsivenessThresholdInDays',   label: 'Unresponsive Threshold (days)',     type: 'number' },
  ],

  async restore(token, resourceId, baselineResource) {
    const { id, partnerState, lastHeartbeatDateTime, displayName, partnerDisplayName, ...patchBody } = baselineResource;
    await graphPatch(token, `/deviceManagement/mobileThreatDefenseConnectors/${resourceId}`, patchBody);
  },
};

// ─── COLLECTOR: App Protection Policies — MAM (v1.0, monitor-only) ───────────
const intuneAppProtection = {
  areaKey: 'intune_app_protection',
  displayName: 'App Protection Policies',
  description: 'MAM policies for iOS and Android — data transfer restrictions, PIN requirements, encryption',
  licenceRequired: 'Microsoft Intune / Intune App Protection',
  readPermissions:  ['DeviceManagementApps.Read.All'],
  writePermissions: [],

  async pull(token) {
    let policies;
    try {
      policies = await graphGetAll(token, '/deviceAppManagement/managedAppPolicies');
    } catch (err) {
      if (isLicenceError(err)) throw new LicenceUnavailableError('App Protection Policies');
      throw err;
    }
    const resources = {};
    for (const p of policies) {
      const platform = p['@odata.type']?.includes('ios') ? 'iOS'
        : p['@odata.type']?.includes('ndroid') ? 'Android' : 'Unknown';
      resources[p.id] = {
        id:          p.id,
        displayName: `${p.displayName} (${platform})`,
        description: p.description || '',
        platform,
        allowedInboundDataTransferSources:       p.allowedInboundDataTransferSources       || 'allApps',
        allowedOutboundDataTransferDestinations: p.allowedOutboundDataTransferDestinations || 'allApps',
        allowedOutboundClipboardSharingLevel:    p.allowedOutboundClipboardSharingLevel    || 'allApps',
        dataBackupBlocked:                       p.dataBackupBlocked                       ?? false,
        deviceComplianceRequired:                p.deviceComplianceRequired                ?? false,
        managedBrowserToOpenLinksRequired:       p.managedBrowserToOpenLinksRequired       ?? false,
        organizationalCredentialsRequired:       p.organizationalCredentialsRequired       ?? false,
        pinRequired:                             p.pinRequired                             ?? false,
        maximumPinRetries:                       p.maximumPinRetries                       ?? null,
        simplePinBlocked:                        p.simplePinBlocked                        ?? false,
        screenCaptureBlocked:                    p.screenCaptureBlocked                    ?? false,
        encryptAppData:                          p.encryptAppData                          ?? null,
        minimumRequiredOsVersion:                p.minimumRequiredOsVersion                || null,
        minimumWarningOsVersion:                 p.minimumWarningOsVersion                 || null,
      };
    }
    return resources;
  },

  // All restore is portal-only — MAM policies involve complex app targeting arrays
  // (apps[], assignments[]) that cannot be safely reconstructed via Graph API alone.
  monitorOnlyKeys: [],
  portalOnlyRestore: true,

  watchableKeys: [
    { path: 'allowedInboundDataTransferSources',        label: 'Inbound Data Transfer Allowed From', type: 'string' },
    { path: 'allowedOutboundDataTransferDestinations',  label: 'Outbound Data Transfer Allowed To',  type: 'string' },
    { path: 'allowedOutboundClipboardSharingLevel',     label: 'Clipboard Sharing Level',            type: 'string' },
    { path: 'dataBackupBlocked',                        label: 'Backup Blocked',                     type: 'boolean' },
    { path: 'deviceComplianceRequired',                 label: 'Device Compliance Required',          type: 'boolean' },
    { path: 'pinRequired',                              label: 'PIN Required',                        type: 'boolean' },
    { path: 'maximumPinRetries',                        label: 'Max PIN Retries',                     type: 'number' },
    { path: 'simplePinBlocked',                         label: 'Simple PIN Blocked',                  type: 'boolean' },
    { path: 'screenCaptureBlocked',                     label: 'Screen Capture Blocked',              type: 'boolean' },
    { path: 'encryptAppData',                           label: 'Encrypt App Data',                    type: 'boolean' },
    { path: 'minimumRequiredOsVersion',                 label: 'Minimum Required OS Version',         type: 'string' },
  ],

  async restore() {
    throw new Error(
      'App Protection Policies (MAM) cannot be restored via the Graph API — ' +
      'the policy involves complex app targeting and assignment arrays that must be ' +
      'corrected manually in the Intune portal: Apps → App protection policies → ' +
      'select the policy → edit the relevant settings.'
    );
  },
};

// ─── COLLECTOR: Endpoint Security — Antivirus (beta) ─────────────────────────
const intuneEpAntivirus = {
  areaKey: 'intune_ep_antivirus',
  displayName: 'Endpoint Security — Antivirus',
  description: 'Microsoft Defender antivirus policies — real-time protection, cloud protection, tamper protection, PUA blocking',
  licenceRequired: 'Microsoft Intune + Microsoft Defender',
  readPermissions:  ['DeviceManagementConfiguration.Read.All'],
  writePermissions: ['DeviceManagementConfiguration.ReadWrite.All'],
  graphBasePath: `${BETA}/deviceManagement/configurationPolicies`,
  isBeta: true,
  async pull(token) { return pullConfigPolicies(token, 'endpointSecurityAntivirus'); },
  // 'settings' is a navigation property — cannot be patched on the policy root.
  // 'settingCount' is read-only. Both must be restored via full resource restore,
  // which uses the dedicated two-step restoreConfigPolicy function.
  // Individual settings cannot be property-restored; use full restore or the Intune portal.
  monitorOnlyKeys: ['assignments', 'settings', 'settingCount'],
  watchableKeys: [
    { path: 'displayName',  label: 'Policy Name',                       type: 'string' },
    { path: 'settingCount', label: 'Setting Count',                     type: 'number' },
    { path: 'settings',     label: 'All Antivirus Settings (full diff)', type: 'json' },
    { path: 'assignments',  label: 'Assigned Groups (monitor only)',     type: 'json' },
  ],
  async restore(token, resourceId, baselineResource) { await restoreConfigPolicy(token, resourceId, baselineResource); },
};

// ─── COLLECTOR: Endpoint Security — Firewall (beta) ──────────────────────────
const intuneEpFirewall = {
  areaKey: 'intune_ep_firewall',
  displayName: 'Endpoint Security — Firewall',
  description: 'Windows Firewall policies — domain, private and public profile enabled state, inbound/outbound default actions',
  licenceRequired: 'Microsoft Intune',
  readPermissions:  ['DeviceManagementConfiguration.Read.All'],
  writePermissions: ['DeviceManagementConfiguration.ReadWrite.All'],
  graphBasePath: `${BETA}/deviceManagement/configurationPolicies`,
  isBeta: true,
  async pull(token) { return pullConfigPolicies(token, 'endpointSecurityFirewall'); },
  monitorOnlyKeys: ['assignments', 'settings', 'settingCount'],
  watchableKeys: [
    { path: 'displayName',  label: 'Policy Name',                     type: 'string' },
    { path: 'settingCount', label: 'Setting Count',                   type: 'number' },
    { path: 'settings',     label: 'All Firewall Settings (full diff)', type: 'json' },
    { path: 'assignments',  label: 'Assigned Groups (monitor only)',  type: 'json' },
  ],
  async restore(token, resourceId, baselineResource) { await restoreConfigPolicy(token, resourceId, baselineResource); },
};

// ─── COLLECTOR: Endpoint Security — Disk Encryption (beta) ───────────────────
const intuneEpDiskEncryption = {
  areaKey: 'intune_ep_disk_encryption',
  displayName: 'Endpoint Security — Disk Encryption',
  description: 'BitLocker policies — encryption enabled, method (AES-256/AES-128), recovery key escrow to Entra ID',
  licenceRequired: 'Microsoft Intune',
  readPermissions:  ['DeviceManagementConfiguration.Read.All'],
  writePermissions: ['DeviceManagementConfiguration.ReadWrite.All'],
  graphBasePath: `${BETA}/deviceManagement/configurationPolicies`,
  isBeta: true,
  async pull(token) { return pullConfigPolicies(token, 'endpointSecurityDiskEncryption'); },
  monitorOnlyKeys: ['assignments', 'settings', 'settingCount'],
  watchableKeys: [
    { path: 'displayName',  label: 'Policy Name',                             type: 'string' },
    { path: 'settingCount', label: 'Setting Count',                           type: 'number' },
    { path: 'settings',     label: 'All Disk Encryption Settings (full diff)', type: 'json' },
    { path: 'assignments',  label: 'Assigned Groups (monitor only)',           type: 'json' },
  ],
  async restore(token, resourceId, baselineResource) { await restoreConfigPolicy(token, resourceId, baselineResource); },
};

// ─── COLLECTOR: Endpoint Security — Attack Surface Reduction (beta) ──────────
const intuneEpAsr = {
  areaKey: 'intune_ep_asr',
  displayName: 'Endpoint Security — Attack Surface Reduction',
  description: 'ASR rules — Office macro blocking, credential theft prevention, ransomware protection, controlled folder access',
  licenceRequired: 'Microsoft Intune + Microsoft Defender for Endpoint',
  readPermissions:  ['DeviceManagementConfiguration.Read.All'],
  writePermissions: ['DeviceManagementConfiguration.ReadWrite.All'],
  graphBasePath: `${BETA}/deviceManagement/configurationPolicies`,
  isBeta: true,
  async pull(token) { return pullConfigPolicies(token, 'endpointSecurityAttackSurfaceReduction'); },
  monitorOnlyKeys: ['assignments', 'settings', 'settingCount'],
  watchableKeys: [
    { path: 'displayName',  label: 'Policy Name',                  type: 'string' },
    { path: 'settingCount', label: 'Setting Count',                type: 'number' },
    { path: 'settings',     label: 'All ASR Settings (full diff)', type: 'json' },
    { path: 'assignments',  label: 'Assigned Groups (monitor only)', type: 'json' },
  ],
  async restore(token, resourceId, baselineResource) { await restoreConfigPolicy(token, resourceId, baselineResource); },
};

// ─── REGISTRY ─────────────────────────────────────────────────────────────────
const COLLECTORS = {
  entra_roles:                      entraRoles,
  entra_users:                      entraUsers,
  entra_groups:                     entraGroups,
  entra_apps:                       entraAppRegistrations,
  entra_auth_policies:              entraAuthPolicies,
  entra_ca:                         entraCA,
  intune_compliance:                intuneCompliance,
  intune_config_profiles:           intuneConfigProfiles,
  // ── New Intune collectors ───────────────────────────────────────────────────
  intune_update_rings:              intuneUpdateRings,
  intune_mtd_connectors:            intuneMtdConnectors,
  intune_app_protection:            intuneAppProtection,
  intune_ep_antivirus:              intuneEpAntivirus,
  intune_ep_firewall:               intuneEpFirewall,
  intune_ep_disk_encryption:        intuneEpDiskEncryption,
  intune_ep_asr:                    intuneEpAsr,
  sharepoint_sites:                  sharepointSites,
  sharepoint_tenant_settings:        sharepointTenantSettings,
  teams_policies_messaging:          teamsMessagingPolicies,
  teams_membership:                  teamsMembership,
  teams_policies_meetings:           teamsMeetingPolicies,
  teams_app_permission_policies:     teamsAppPermissionPolicies,
  teams_channels_policies:           teamsChannelsPolicies,
  teams_org_app_settings:            teamsOrgAppSettings,
  exchange_mailboxes:                exchangeMailboxes,
  exchange_mailbox_security:         exchangeMailboxSecurity,
  exchange_connectors:               exchangeConnectors,
  exchange_transport_rules:          exchangeTransportRules,
};

// Merge grouped per-area collector exports (if available) into the registry.
// This allows collectors to be organized under `collectors/<area>/index.js`
// while preserving existing top-level keys.
try {
  if (exchangeGroup) {
    for (const [k, v] of Object.entries(exchangeGroup)) {
      if (!COLLECTORS[k]) COLLECTORS[k] = v;
    }
  }
} catch (e) {}
try {
  if (teamsGroup) {
    for (const [k, v] of Object.entries(teamsGroup)) {
      if (!COLLECTORS[k]) COLLECTORS[k] = v;
    }
  }
} catch (e) {}

const ALL_PERMISSIONS = [
  { permission: 'Policy.Read.All',                           type: 'Application', purpose: 'Read CA policies, auth policies, security defaults' },
  { permission: 'RoleManagement.Read.Directory',             type: 'Application', purpose: 'Read Entra role assignments' },
  { permission: 'User.Read.All',                             type: 'Application', purpose: 'Read user accounts and profile attributes' },
  { permission: 'Group.Read.All',                            type: 'Application', purpose: 'Read security and M365 groups' },
  { permission: 'Application.Read.All',                      type: 'Application', purpose: 'Read app registrations, permissions, redirect URIs' },
  { permission: 'AuditLog.Read.All',                         type: 'Application', purpose: 'Read MFA registration and authentication method data (Tenant Insights — requires Entra ID P1/P2)' },
  { permission: 'Sites.Read.All',                            type: 'Application', purpose: 'Read SharePoint site collections, drives and sharing entries' },
  { permission: 'Sites.Manage.All',                          type: 'Application', purpose: 'Manage SharePoint sites and drive-level sharing (restore)' },
  { permission: 'SharePointTenantSettings.Read.All',         type: 'Application', purpose: 'Read SharePoint tenant-level security and sharing settings' },
  { permission: 'SharePointTenantSettings.ReadWrite.All',    type: 'Application', purpose: 'Restore SharePoint tenant-level security and sharing settings' },
  { permission: 'Team.ReadBasic.All',                        type: 'Application', purpose: 'Read basic Microsoft Teams metadata, members and owners' },
  { permission: 'TeamSettings.ReadWrite.All',                type: 'Application', purpose: 'Restore Teams settings and configuration' },
  { permission: 'TeamworkAppSettings.Read.All',              type: 'Application', purpose: 'Read Teams organization app settings' },
  { permission: 'TeamworkAppSettings.ReadWrite.All',         type: 'Application', purpose: 'Restore Teams organization app settings' },
  { permission: 'GroupMember.ReadWrite.All',                 type: 'Application', purpose: 'Restore Teams and Microsoft 365 group membership (members and owners)' },
  { permission: 'MailboxSettings.Read',                       type: 'Application', purpose: 'Read user mailbox settings (automatic replies, time zone, language)' },
  { permission: 'MailboxSettings.ReadWrite',                  type: 'Application', purpose: 'Restore user mailbox security settings (automatic replies, time zone, language)' },
  { permission: 'DeviceManagementConfiguration.Read.All',    type: 'Application', purpose: 'Read Intune compliance and config policies' },
  { permission: 'DeviceManagementApps.Read.All',                  type: 'Application', purpose: 'Read app protection policies (MAM)' },
  { permission: 'DeviceManagementServiceConfig.Read.All',         type: 'Application', purpose: 'Read Mobile Threat Defense connector states' },
  { permission: 'DeviceManagementServiceConfig.ReadWrite.All',    type: 'Application', purpose: 'Restore Mobile Threat Defense connector states' },
  { permission: 'Policy.ReadWrite.ConditionalAccess',        type: 'Application', purpose: 'Restore CA policies including user/group assignments' },
  { permission: 'Policy.ReadWrite.AuthenticationMethod',     type: 'Application', purpose: 'Restore auth method policies and security defaults' },
  { permission: 'RoleManagement.ReadWrite.Directory',        type: 'Application', purpose: 'Restore Entra role assignments' },
  { permission: 'User.ReadWrite.All',                        type: 'Application', purpose: 'Restore user account and profile properties' },
  { permission: 'Group.ReadWrite.All',                       type: 'Application', purpose: 'Restore group settings' },
  { permission: 'Application.ReadWrite.All',                 type: 'Application', purpose: 'Restore app registration settings, permissions, redirect URIs' },
  { permission: 'DeviceManagementConfiguration.ReadWrite.All', type: 'Application', purpose: 'Restore Intune policies — compliance, config, endpoint security (v1.0 + beta)' },
];

function buildCustomCollector(row) {
  const watchableKeys = JSON.parse(row.watchable_keys || '[]');
  const idField   = row.id_field   || 'id';
  const nameField = row.name_field || 'displayName';
  return {
    areaKey:          row.area_key,
    displayName:      row.display_name,
    description:      row.description || '',
    licenceRequired:  null,
    readPermissions:  [],
    writePermissions: [],
    isCustom:         true,
    graphBasePath:    row.graph_endpoint,
    watchableKeys,
    async pull(token) {
      const { graphGetAll, graphGet } = require('../services/graph');
      const endpoint = row.select_fields
        ? `${row.graph_endpoint}?$select=${row.select_fields}`
        : row.graph_endpoint;
      let raw;
      try { raw = await graphGetAll(token, endpoint); } catch { raw = null; }
      if (!Array.isArray(raw) || raw.length === 0) {
        const single = await graphGet(token, endpoint).catch(() => null);
        if (single && !single.value) {
          raw = [{ ...single, id: single[idField] || row.area_key }];
        }
      }
      if (!Array.isArray(raw)) return {};
      const resources = {};
      for (const item of raw) {
        const id   = item[idField] || item.id || require('crypto').randomBytes(8).toString('hex');
        const name = item[nameField] || item.displayName || item.id || id;
        resources[id] = { ...item, id, displayName: name };
      }
      return resources;
    },
    async restore() {
      throw new Error('Restore is not supported for custom (read-only) collectors.');
    },
  };
}

function getCollector(areaKey) {
  if (COLLECTORS[areaKey]) return COLLECTORS[areaKey];
  try {
    const { getDb } = require('../database/init');
    const row = getDb().prepare('SELECT * FROM custom_collectors WHERE area_key = ?').get(areaKey);
    if (row) return buildCustomCollector(row);
  } catch {}
  throw new Error(`Unknown area key: ${areaKey}`);
}

function getAllCollectors() {
  const builtin = Object.values(COLLECTORS);
  try {
    const { getDb } = require('../database/init');
    const custom = getDb().prepare('SELECT * FROM custom_collectors').all();
    return [...builtin, ...custom.map(buildCustomCollector)];
  } catch { return builtin; }
}

module.exports = {
  COLLECTORS,
  ALL_PERMISSIONS,
  getCollector,
  getAllCollectors,
  LicenceUnavailableError,
  CollectorUnavailableError,
  isLicenceError,
};

// Also expose individual collectors at top-level keyed by their areaKey
for (const key of Object.keys(COLLECTORS)) {
  module.exports[key] = COLLECTORS[key];
}

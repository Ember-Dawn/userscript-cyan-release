// ==UserScript==
// @name         ChatGPT文件夹
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @version      0.6.4
// @description  ChatGPT 普通聊天文件夹管理：v0.6.4；延后首次侧边栏 DOM 注入以避开 React hydration，并保留侧边栏重建挂载保护。
// @author       ChatGPT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

/*
ChatGPT文件夹维护摘要（完整说明见 userscripts/chatgpt/chatgpt-folders.md）

- 作用：在 ChatGPT 原生侧边栏中增加本地“文件夹”索引；只保存聊天引用、文件夹结构和非敏感设置，不修改 ChatGPT 后端，也不保存完整聊天正文。
- 数据：内存 state 是当前账号单一数据源；本地 profile 按 ChatGPT 账号隔离；同浏览器通过 revision key 事件同步；跨设备通过 WebDAV schema 3、操作日志、基准快照和墓碑进行合并。
- DOM：#cgfm-root 必须挂在 ChatGPT 原生历史侧边栏中，并与脚本自身 DOM 严格隔离。宿主探测不得把 #cgfm-root 内的 /c/ 链接当作原生聊天，也不得把 root 挂到自身或其后代。
- Hydration：document-idle 不代表 React hydration 已结束。首次挂载必须等待同一原生 sidebar host 稳定至少 INITIAL_MOUNT_STABLE_MS；稳定前不要注入脚本样式、宽度覆盖或根节点。首次成功后，React 重建/休眠恢复可继续快速 remount。
- 性能：禁止长期观察 document/sidebar 的 MutationObserver、mousemove 热路径、最近聊天逐项常驻注入和高频全量扫描。仅原生三点菜单允许短时 observer，捕捉成功或超时立即断开。
- 交互：聊天拖拽优先复用浏览器原生 drag/drop，不破坏 ChatGPT Projects；聊天跳转优先复用原生 /c/ 链接，不强行 history.pushState。
- 安全：WebDAV 凭据仅保存在本地；导出、远端 JSON、日志和诊断不得包含密码、token、cookie 或完整 client-bootstrap。
- 修改要求：行为变更需提升 @version；修改架构、同步、挂载、存储或关键交互时同步更新 chatgpt-folders.md；发布前至少执行 node --check。
*/


(function () {
  'use strict';

  const APP = 'cgfm';
  const APP_NAME = 'ChatGPT文件夹';
  const VERSION = '0.6.4';
  const ACCOUNT_PROFILE_PREFIX = 'cgfm.v3.profile.';
  const ACCOUNT_REVISION_PREFIX = 'cgfm.v3.revision.';
  const ACCOUNT_FILE_MAP_KEY = 'cgfm.v3.remoteFileMap';
  const DEVICE_ID_KEY = 'cgfm.v3.deviceId';
  const RUNTIME_LOCK_ATTR = 'data-cgfm-runtime-active';
  const LAST_ACCOUNT_KEY = 'cgfm.v1.lastAccount';
  const CURRENT_PROFILE_ID = 'local_current';
  const ROOT_ID = 'root';
  const DRAG_MIME = 'application/x-chatgpt-folder-manager';
  const DEFAULT_FOLDER_COLOR = '#6b7280';
  const DEFAULT_DEBOUNCE_MS = 12000;
  const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // legacy setting fallback
  const DEFAULT_REMOTE_CHECK_MS = 30 * 1000;
  const MIN_REMOTE_CHECK_MS = 15 * 1000;
  const MAX_REMOTE_OPERATIONS = 1500;
  const MAX_LOCAL_OPERATIONS = 500;
  const SYNC_EPOCH = '1970-01-01T00:00:00.000Z';
  const DEFAULT_SIDEBAR_WIDTH_PX = 312;
  const INITIAL_MOUNT_STABLE_MS = 1200;
  const MIN_SIDEBAR_WIDTH_PX = 240;
  const MAX_SIDEBAR_WIDTH_PX = 520;
  const FOLDER_SORT_LOCALE = undefined;
  const folderCollator = new Intl.Collator(FOLDER_SORT_LOCALE, { numeric: true, sensitivity: 'base' });
  const TAB_ID = 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  // Safari userscript managers may inject the same script more than once during SPA
  // restoration. A document-level lock prevents duplicate roots, listeners and timers.
  if (document.documentElement.hasAttribute(RUNTIME_LOCK_ATTR)) {
    console.info(APP_NAME, 'duplicate runtime blocked');
    return;
  }
  document.documentElement.setAttribute(RUNTIME_LOCK_ATTR, VERSION);

  let state = null;
  let currentAccount = null;
  let selectedFolderId = ROOT_ID; // 仅当前页面使用，不持久化、不跨标签同步
  let rootEl = null;
  let treeEl = null;
  let sidebarEl = null;
  let mounted = false;
  let renderQueued = false;
  let pendingPersistTimer = null;
  let pendingPersistReason = '';
  let pendingWebdavTimer = null;
  let periodicWebdavTimer = null;
  let dirtySincePush = false;
  let editingFolderId = '';
  let editingNewFolderId = '';
  let editingOriginalName = '';
  let dragPayload = null;
  let pointerPayload = null;
  let dragStartPayload = null;
  let lastHoveredFolderId = '';
  let lastHoveredFolderAt = 0;
  let dropCommitted = false;
  let menuEl = null;
  let modalEl = null;
  let sidebarWidthStyleEl = null;
  let syncStatus = 'off';
  let settingsModalSnapshot = null;
  let settingsWidthPreviewApplied = false;
  let sidebarToggleBound = false;
  let nativeMenuChat = null;
  let nativeMenuTriggerId = '';
  let nativeMenuObserver = null;
  let nativeMenuObserveTimer = null;
  let nativeFolderSubmenus = [];
  let nativeMenuPollTimer = null;
  let resumeRecoveryTimers = [];
  let sidebarVisibilityTimers = [];
  let storageWriteSeq = 0;
  let lastSeenStorageRevision = '';
  let lastSeenStorageProjection = '';
  let localUnsavedChanges = false;
  let storageSyncBound = false;
  let storageSyncListenerId = null;
  let storageSyncListenerKey = '';
  let crossTabApplyTimer = null;
  let transientDragAnchor = null;
  let transientDragOriginalDraggable = null;
  let transientDragRestoreTimer = null;
  let lockedAccountKey = '';
  let pendingAccountKey = '';
  let pendingAccountHits = 0;
  let webdavOperation = null;
  let lastRemoteCheckAt = 0;
  let accountSwitching = false;
  let accountGeneration = 0;
  let mutationBaseline = null;
  let initialMountCandidate = null;
  let initialMountCandidateSince = 0;
  const DEVICE_ID = getOrCreateDeviceId();

  // ---------------------------------------------------------------------------
  // 1. Constants, small utilities and safe Tampermonkey storage wrappers
  // ---------------------------------------------------------------------------

  function nowIso() { return new Date().toISOString(); }
  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function cleanText(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function unique(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
  function safeError(err) { return err && (err.message || err.toString()) || String(err || 'Unknown error'); }
  function shortTime(iso) { try { return new Date(iso).toLocaleString(); } catch (_) { return String(iso || ''); } }
  function normalizeColor(color) { return /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? String(color) : DEFAULT_FOLDER_COLOR; }
  function cssEscape(value) { return window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

  function gmGet(key, fallback) {
    try {
      const value = GM_getValue(key, fallback);
      return value === undefined ? fallback : value;
    } catch (err) {
      console.warn(APP_NAME, 'GM_getValue failed', err);
      return fallback;
    }
  }

  function gmSet(key, value) {
    try { GM_setValue(key, value); }
    catch (err) { console.warn(APP_NAME, 'GM_setValue failed', err); }
  }

  function getOrCreateDeviceId() {
    let id = String(gmGet(DEVICE_ID_KEY, '') || '');
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      gmSet(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function accountStableKey(info) {
    const acct = info || currentAccount || readLastAccountInfo() || {};
    const raw = cleanText(acct.accountId || acct.email || acct.id || 'acct_default');
    return sanitizeFilePart(raw).slice(0, 120) || 'acct_default';
  }

  function activeProfileStorageKey(info) { return ACCOUNT_PROFILE_PREFIX + accountStableKey(info); }
  function activeRevisionStorageKey(info) { return ACCOUNT_REVISION_PREFIX + accountStableKey(info); }

  // ---------------------------------------------------------------------------
  // 2. Account-scoped state and folder data normalization (no legacy migration)
  // ---------------------------------------------------------------------------

  function makeEmptyState(label) {
    return makeProfile(CURRENT_PROFILE_ID, label || 'ChatGPT account');
  }

  function makeProfile(id, label) {
    const t = nowIso();
    return {
      id,
      label: label || 'ChatGPT account',
      createdAt: t,
      updatedAt: t,
      folders: {
        [ROOT_ID]: { id: ROOT_ID, name: 'root', parentId: '', childFolderIds: [], chatIds: [], color: DEFAULT_FOLDER_COLOR, collapsed: false, createdAt: t, updatedAt: t }
      },
      conversations: {},
      settings: {
        ui: { sectionCollapsed: false, sidebarWidthEnabled: false, sidebarWidthPx: DEFAULT_SIDEBAR_WIDTH_PX },
        webdav: { enabled: false, url: '', username: '', password: '', debounceMs: DEFAULT_DEBOUNCE_MS, intervalMs: DEFAULT_INTERVAL_MS, remoteCheckMs: DEFAULT_REMOTE_CHECK_MS, lastPushAt: '', lastPullAt: '', lastStatus: '', lastError: '', remoteEtag: '', remoteRevision: 0, lastRemoteCheckAt: '', conflict: false, pendingPush: false, remoteInitialized: false, syncTarget: '', lastMergeAt: '', lastMergeSummary: '' }
      }
    };
  }

  function loadState(info) {
    const accountInfo = info || currentAccount || readLastAccountInfo() || { id: 'acct_default', label: 'ChatGPT account' };
    const accountKey = activeProfileStorageKey(accountInfo);
    const direct = gmGet(accountKey, '');
    if (direct) {
      try {
        const parsed = typeof direct === 'string' ? JSON.parse(direct) : direct;
        return normalizeLoadedProfile(parsed, accountInfo.label || 'ChatGPT account');
      } catch (err) {
        console.warn(APP_NAME, 'failed to parse account profile; starting empty', err);
      }
    }

    // v0.5.0+ intentionally does not import v1/v2 single-profile storage. A device with
    // no account-scoped profile starts empty, then initializes from the configured
    // account-specific WebDAV JSON. This keeps account ownership explicit and removes
    // the historical migration branches that could duplicate data across accounts.
    return makeEmptyState(accountInfo.label);
  }

  function normalizeLoadedProfile(data, label) {
    const profile = data && data.profile ? data.profile : data;
    if (profile && profile.folders && profile.conversations) return normalizeProfile(profile, CURRENT_PROFILE_ID, label || profile.label);
    return makeEmptyState(label);
  }

  function normalizeProfile(profile, id, label) {
    const p = profile && typeof profile === 'object' ? profile : makeProfile(id, label);
    p.id = id || p.id || 'default';
    p.label = label || p.label || 'ChatGPT account';
    p.createdAt = p.createdAt || nowIso();
    p.updatedAt = p.updatedAt || p.createdAt;
    p.folders = p.folders && typeof p.folders === 'object' ? p.folders : {};
    p.conversations = p.conversations && typeof p.conversations === 'object' ? p.conversations : {};
    p.settings = p.settings && typeof p.settings === 'object' ? p.settings : {};
    delete p.selectedFolderId; // 兼容旧数据：选中高亮不再属于持久化 profile。
    p.settings.ui = Object.assign({ sectionCollapsed: false, sidebarWidthEnabled: false, sidebarWidthPx: DEFAULT_SIDEBAR_WIDTH_PX }, p.settings.ui || {});
    p.settings.webdav = Object.assign({ enabled: false, url: '', username: '', password: '', debounceMs: DEFAULT_DEBOUNCE_MS, intervalMs: DEFAULT_INTERVAL_MS, remoteCheckMs: DEFAULT_REMOTE_CHECK_MS, lastPushAt: '', lastPullAt: '', lastStatus: '', lastError: '', remoteEtag: '', remoteRevision: 0, lastRemoteCheckAt: '', conflict: false, pendingPush: false, remoteInitialized: false, syncTarget: '', lastMergeAt: '', lastMergeSummary: '' }, p.settings.webdav || {});
    p.settings.webdav.remoteCheckMs = clamp(Number(p.settings.webdav.remoteCheckMs || DEFAULT_REMOTE_CHECK_MS), MIN_REMOTE_CHECK_MS, 5 * 60 * 1000);
    if (!p.settings.webdav.pendingPush && (/conflict|push failed|pushing/i.test(String(p.settings.webdav.lastStatus || '')) || /PUT failed with HTTP 412/i.test(String(p.settings.webdav.lastError || '')))) {
      p.settings.webdav.pendingPush = true;
    }
    // ETag is transaction-scoped in v0.5.0+. Keep only revision/snapshot metadata as the durable base.
    p.settings.webdav.remoteEtag = '';
    p.settings.webdav.remoteInitialized = !!(p.settings.webdav.remoteInitialized || Number(p.settings.webdav.remoteRevision || 0) > 0);
    if (!p.folders[ROOT_ID]) p.folders[ROOT_ID] = { id: ROOT_ID, name: 'root', parentId: '', childFolderIds: [], chatIds: [], color: DEFAULT_FOLDER_COLOR, collapsed: false, createdAt: nowIso(), updatedAt: nowIso() };

    for (const fid of Object.keys(p.folders)) {
      const f = p.folders[fid] || {};
      f.id = fid;
      f.name = fid === ROOT_ID ? 'root' : String(f.name || '新建文件夹');
      f.parentId = fid === ROOT_ID ? '' : (p.folders[f.parentId] ? f.parentId : ROOT_ID);
      f.childFolderIds = unique(Array.isArray(f.childFolderIds) ? f.childFolderIds : []);
      f.chatIds = unique(Array.isArray(f.chatIds) ? f.chatIds : []);
      f.color = normalizeColor(f.color || DEFAULT_FOLDER_COLOR);
      f.collapsed = !!f.collapsed;
      f.createdAt = f.createdAt || nowIso();
      f.updatedAt = f.updatedAt || f.createdAt;
      p.folders[fid] = f;
    }

    for (const fid of Object.keys(p.folders)) {
      if (fid === ROOT_ID) continue;
      const f = p.folders[fid];
      const parent = p.folders[f.parentId] || p.folders[ROOT_ID];
      if (!parent.childFolderIds.includes(fid)) parent.childFolderIds.push(fid);
    }

    const seenChat = new Set();
    for (const cid of Object.keys(p.conversations)) {
      const c = p.conversations[cid] || {};
      c.id = cid;
      c.title = String(c.title || 'Untitled chat');
      c.url = normalizeStoredUrl(c.url || ('/c/' + cid));
      c.folderId = p.folders[c.folderId] ? c.folderId : ROOT_ID;
      c.addedAt = c.addedAt || nowIso();
      c.updatedAt = c.updatedAt || c.addedAt;
      p.conversations[cid] = c;
    }
    for (const fid of Object.keys(p.folders)) {
      const f = p.folders[fid];
      f.childFolderIds = unique(f.childFolderIds).filter(child => child !== fid && p.folders[child] && p.folders[child].parentId === fid);
      f.chatIds = unique(f.chatIds).filter(cid => p.conversations[cid] && !seenChat.has(cid));
      for (const cid of f.chatIds) {
        p.conversations[cid].folderId = fid;
        seenChat.add(cid);
      }
    }
    for (const cid of Object.keys(p.conversations)) {
      if (!seenChat.has(cid)) {
        const fid = p.conversations[cid].folderId || ROOT_ID;
        (p.folders[fid] || p.folders[ROOT_ID]).chatIds.push(cid);
        seenChat.add(cid);
      }
    }
    sortAllFolders(p);
    ensureSyncMeta(p);
    return p;
  }

  function sortFolderChildren(p, parentId) {
    const parent = p.folders[parentId];
    if (!parent) return;
    parent.childFolderIds = unique(parent.childFolderIds).filter(fid => p.folders[fid]).sort((a, b) => {
      const fa = p.folders[a];
      const fb = p.folders[b];
      return folderCollator.compare(fa.name || '', fb.name || '');
    });
  }

  function sortAllFolders(p) {
    for (const fid of Object.keys(p.folders || {})) sortFolderChildren(p, fid);
  }

  function profileHasUserData(p) {
    return !!(p && ((p.conversations && Object.keys(p.conversations).length) || (p.folders && Object.keys(p.folders).some(id => id !== ROOT_ID))));
  }


  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function stableStringify(value) {
    const visit = item => {
      if (Array.isArray(item)) return item.map(visit);
      if (!item || typeof item !== 'object') return item;
      const out = {};
      Object.keys(item).sort().forEach(key => { out[key] = visit(item[key]); });
      return out;
    };
    return JSON.stringify(visit(value));
  }

  function emptySyncProjection(label) {
    return {
      id: CURRENT_PROFILE_ID,
      label: label || 'ChatGPT account',
      createdAt: SYNC_EPOCH,
      updatedAt: SYNC_EPOCH,
      folders: {
        [ROOT_ID]: { id: ROOT_ID, name: 'root', parentId: '', childFolderIds: [], chatIds: [], color: DEFAULT_FOLDER_COLOR, createdAt: SYNC_EPOCH, updatedAt: SYNC_EPOCH }
      },
      conversations: {},
      settings: { ui: { sidebarWidthEnabled: false, sidebarWidthPx: DEFAULT_SIDEBAR_WIDTH_PX } }
    };
  }

  function syncProjection(profile) {
    const source = profile || emptySyncProjection('ChatGPT account');
    const out = {
      id: source.id || CURRENT_PROFILE_ID,
      label: source.label || 'ChatGPT account',
      createdAt: SYNC_EPOCH,
      updatedAt: SYNC_EPOCH,
      folders: {},
      conversations: {},
      settings: {
        ui: {
          sidebarWidthEnabled: !!(((source.settings || {}).ui || {}).sidebarWidthEnabled),
          sidebarWidthPx: clamp(Number((((source.settings || {}).ui || {}).sidebarWidthPx) || DEFAULT_SIDEBAR_WIDTH_PX), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX)
        }
      }
    };
    for (const [id, raw] of Object.entries(source.folders || {})) {
      const f = raw || {};
      out.folders[id] = {
        id,
        name: id === ROOT_ID ? 'root' : String(f.name || '新建文件夹'),
        parentId: id === ROOT_ID ? '' : String(f.parentId || ROOT_ID),
        childFolderIds: unique(Array.isArray(f.childFolderIds) ? f.childFolderIds : []),
        chatIds: unique(Array.isArray(f.chatIds) ? f.chatIds : []),
        color: normalizeColor(f.color || DEFAULT_FOLDER_COLOR),
        createdAt: f.createdAt || SYNC_EPOCH,
        updatedAt: f.updatedAt || f.createdAt || SYNC_EPOCH
      };
    }
    if (!out.folders[ROOT_ID]) out.folders[ROOT_ID] = emptySyncProjection(out.label).folders[ROOT_ID];
    for (const [id, raw] of Object.entries(source.conversations || {})) {
      const c = raw || {};
      out.conversations[id] = {
        id,
        title: String(c.title || 'Untitled chat'),
        url: normalizeStoredUrl(c.url || ('/c/' + id)),
        folderId: out.folders[c.folderId] ? c.folderId : ROOT_ID,
        addedAt: c.addedAt || SYNC_EPOCH,
        updatedAt: c.updatedAt || c.addedAt || SYNC_EPOCH
      };
    }
    return out;
  }

  function makeSyncMeta(profile) {
    const w = ((profile || {}).settings || {}).webdav || {};
    return {
      baseRevision: Number(w.remoteRevision || 0),
      baseProfile: w.remoteInitialized ? syncProjection(profile) : null,
      operations: [],
      tombstones: { folders: {}, conversations: {} },
      lastCompactedAt: ''
    };
  }

  function ensureSyncMeta(profile) {
    if (!profile || typeof profile !== 'object') return makeSyncMeta(profile);
    const existing = profile.__cgfmSync && typeof profile.__cgfmSync === 'object' ? profile.__cgfmSync : {};
    const meta = profile.__cgfmSync = Object.assign(makeSyncMeta(profile), existing);
    meta.baseRevision = Number(meta.baseRevision || (((profile.settings || {}).webdav || {}).remoteRevision) || 0);
    meta.baseProfile = meta.baseProfile && meta.baseProfile.folders ? syncProjection(meta.baseProfile) : ((((profile.settings || {}).webdav || {}).remoteInitialized) ? syncProjection(profile) : null);
    meta.operations = Array.isArray(meta.operations) ? meta.operations.filter(Boolean).slice(-MAX_LOCAL_OPERATIONS) : [];
    meta.tombstones = meta.tombstones && typeof meta.tombstones === 'object' ? meta.tombstones : {};
    meta.tombstones.folders = meta.tombstones.folders && typeof meta.tombstones.folders === 'object' ? meta.tombstones.folders : {};
    meta.tombstones.conversations = meta.tombstones.conversations && typeof meta.tombstones.conversations === 'object' ? meta.tombstones.conversations : {};
    const w = ((profile.settings || {}).webdav || {});
    if (meta.operations.length || (meta.baseProfile && stableStringify(syncProjection(profile)) !== stableStringify(meta.baseProfile))) w.pendingPush = true;
    return meta;
  }

  function makeOperation(kind, entityId, value, reason, options) {
    const opts = options || {};
    const at = opts.at || nowIso();
    return {
      id: opts.id || uid('op'),
      kind,
      entityId: String(entityId || ''),
      value: value == null ? null : deepClone(value),
      reason: String(reason || opts.reason || 'change'),
      at,
      deviceId: String(opts.deviceId || DEVICE_ID),
      baseRevision: Number(opts.baseRevision || 0),
      revision: Number(opts.revision || 0)
    };
  }

  function deriveOperations(before, after, reason, options) {
    const opts = options || {};
    const a = before && before.folders ? before : emptySyncProjection((after || {}).label);
    const b = after && after.folders ? after : emptySyncProjection((before || {}).label);
    const ops = [];
    const compareMap = (kindPrefix, left, right) => {
      const ids = unique([...Object.keys(left || {}), ...Object.keys(right || {})]).sort();
      ids.forEach(id => {
        if (!(id in (right || {}))) {
          if (kindPrefix === 'folder' && id === ROOT_ID) return;
          ops.push(makeOperation(kindPrefix + '-delete', id, null, reason, opts));
        } else if (!(id in (left || {})) || stableStringify(left[id]) !== stableStringify(right[id])) {
          ops.push(makeOperation(kindPrefix + '-upsert', id, right[id], reason, opts));
        }
      });
    };
    compareMap('folder', a.folders || {}, b.folders || {});
    compareMap('conversation', a.conversations || {}, b.conversations || {});
    if (stableStringify(((a.settings || {}).ui || {})) !== stableStringify(((b.settings || {}).ui || {}))) {
      ops.push(makeOperation('settings-update', 'ui', ((b.settings || {}).ui || {}), reason, opts));
    }
    return ops;
  }

  function operationSort(a, b) {
    const ta = Date.parse(a && a.at || '') || 0;
    const tb = Date.parse(b && b.at || '') || 0;
    if (ta !== tb) return ta - tb;
    return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
  }

  function mergeOperationLists(...lists) {
    const map = new Map();
    lists.flat().filter(Boolean).forEach(op => {
      const normalized = Object.assign({}, op, { id: String(op.id || uid('op')) });
      const old = map.get(normalized.id);
      if (!old || operationSort(old, normalized) <= 0) map.set(normalized.id, normalized);
    });
    return Array.from(map.values()).sort(operationSort);
  }

  function applySyncOperation(snapshot, operation) {
    const op = operation || {};
    const id = String(op.entityId || '');
    if (!id) return;
    if (op.kind === 'folder-upsert' && op.value) snapshot.folders[id] = deepClone(op.value);
    else if (op.kind === 'folder-delete' && id !== ROOT_ID) delete snapshot.folders[id];
    else if (op.kind === 'conversation-upsert' && op.value) snapshot.conversations[id] = deepClone(op.value);
    else if (op.kind === 'conversation-delete') delete snapshot.conversations[id];
    else if (op.kind === 'settings-update') {
      snapshot.settings = snapshot.settings || {};
      snapshot.settings.ui = Object.assign({}, snapshot.settings.ui || {}, deepClone(op.value || {}));
    }
  }

  function applyOperationsToProjection(base, operations) {
    const result = deepClone(base && base.folders ? base : emptySyncProjection((state || {}).label));
    mergeOperationLists(operations || []).forEach(op => applySyncOperation(result, op));
    result.updatedAt = SYNC_EPOCH;
    return syncProjection(normalizeProfile(result, result.id || CURRENT_PROFILE_ID, result.label || 'ChatGPT account'));
  }

  function updateTombstones(meta, operations) {
    const syncMeta = meta || ensureSyncMeta(getProfile());
    const tombstones = syncMeta.tombstones;
    (operations || []).forEach(op => {
      const id = String(op.entityId || '');
      if (!id) return;
      const isFolder = /^folder-/.test(op.kind || '');
      const isConversation = /^conversation-/.test(op.kind || '');
      if (!isFolder && !isConversation) return;
      const bucket = isFolder ? tombstones.folders : tombstones.conversations;
      if (/-delete$/.test(op.kind || '')) {
        bucket[id] = { deletedAt: op.at || nowIso(), deviceId: op.deviceId || DEVICE_ID, operationId: op.id || '' };
      } else if (/-upsert$/.test(op.kind || '')) {
        const old = bucket[id];
        if (!old || (Date.parse(op.at || '') || 0) >= (Date.parse(old.deletedAt || '') || 0)) delete bucket[id];
      }
    });
    return tombstones;
  }

  function mergeTombstones(...values) {
    const out = { folders: {}, conversations: {} };
    values.filter(Boolean).forEach(value => {
      ['folders', 'conversations'].forEach(kind => {
        Object.entries(value[kind] || {}).forEach(([id, item]) => {
          const old = out[kind][id];
          if (!old || (Date.parse(item.deletedAt || '') || 0) >= (Date.parse(old.deletedAt || '') || 0)) out[kind][id] = deepClone(item);
        });
      });
    });
    return out;
  }

  function captureSyncOperations(reason) {
    const p = getProfile();
    const current = syncProjection(p);
    if (!mutationBaseline) mutationBaseline = current;
    const meta = ensureSyncMeta(p);
    const ops = deriveOperations(mutationBaseline, current, reason || 'change', { baseRevision: meta.baseRevision, deviceId: DEVICE_ID });
    if (ops.length) {
      meta.operations = mergeOperationLists(meta.operations, ops).slice(-MAX_LOCAL_OPERATIONS);
      updateTombstones(meta, ops);
    }
    mutationBaseline = current;
    return ops;
  }

  function localHasSyncChanges(profile) {
    const p = profile || getProfile();
    const meta = ensureSyncMeta(p);
    const w = p.settings.webdav || {};
    if (w.pendingPush || dirtySincePush || meta.operations.length) return true;
    if (!meta.baseProfile) return profileHasUserData(p);
    return stableStringify(syncProjection(p)) !== stableStringify(meta.baseProfile);
  }

  function preserveLocalUiState(target, local) {
    if (!target || !local) return target;
    target.settings = target.settings || {};
    target.settings.ui = Object.assign({}, target.settings.ui || {}, {
      sectionCollapsed: !!(((local.settings || {}).ui || {}).sectionCollapsed)
    });
    Object.keys(target.folders || {}).forEach(id => {
      if (local.folders && local.folders[id]) target.folders[id].collapsed = !!local.folders[id].collapsed;
    });
    return target;
  }

  function makeStorageRevision() {
    storageWriteSeq += 1;
    return Date.now() + ':' + TAB_ID + ':' + storageWriteSeq;
  }

  function getProfileStorageMeta(profile) {
    return profile && profile.__cgfm && typeof profile.__cgfm === 'object' ? profile.__cgfm : {};
  }

  function getProfileStorageRevision(profile) {
    return String(getProfileStorageMeta(profile).storageRevision || '');
  }

  function getProfileStorageWriter(profile) {
    return String(getProfileStorageMeta(profile).writerTabId || '');
  }

  function revisionTime(revision) {
    const n = Number(String(revision || '').split(':')[0]);
    return Number.isFinite(n) ? n : 0;
  }

  function isRevisionNewer(candidate, base) {
    if (!candidate) return false;
    if (!base) return true;
    const ca = revisionTime(candidate);
    const ba = revisionTime(base);
    if (ca !== ba) return ca > ba;
    return String(candidate) > String(base);
  }

  function parseStoredProfileRaw(raw) {
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed && (parsed.profile || parsed);
    } catch (_) {
      return null;
    }
  }

  function markStorageRevision(profile, revision) {
    if (!profile || typeof profile !== 'object') return revision || '';
    const rev = revision || makeStorageRevision();
    profile.__cgfm = Object.assign({}, profile.__cgfm || {}, {
      storageRevision: rev,
      writerTabId: TAB_ID,
      writtenAt: nowIso()
    });
    return rev;
  }

  function parseRevisionMeta(raw) {
    if (!raw) return { revision: '', writer: '', writtenAt: '' };
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!obj || typeof obj !== 'object') return { revision: '', writer: '', writtenAt: '' };
      return {
        revision: String(obj.revision || obj.storageRevision || ''),
        writer: String(obj.writerTabId || obj.writer || ''),
        writtenAt: String(obj.writtenAt || '')
      };
    } catch (_) {
      return { revision: '', writer: '', writtenAt: '' };
    }
  }

  function writeRevisionMeta(revision) {
    const meta = { revision: String(revision || ''), writerTabId: TAB_ID, writtenAt: nowIso() };
    gmSet(activeRevisionStorageKey(), JSON.stringify(meta));
    return meta;
  }

  function currentStorageRevisionInfo() {
    const meta = parseRevisionMeta(gmGet(activeRevisionStorageKey(), ''));
    if (meta.revision) return meta;

    // Backward-compatible fallback for profiles written by v0.3.13 or earlier.
    // This reads the large profile only when the small revision key is missing.
    const stored = parseStoredProfileRaw(gmGet(activeProfileStorageKey(), ''));
    if (!stored) return { revision: '', writer: '', writtenAt: '' };
    return { revision: getProfileStorageRevision(stored), writer: getProfileStorageWriter(stored), writtenAt: '' };
  }

  function currentStoredProfileInfo() {
    const stored = parseStoredProfileRaw(gmGet(activeProfileStorageKey(), ''));
    if (!stored) return { profile: null, revision: '', writer: '' };
    return { profile: stored, revision: getProfileStorageRevision(stored), writer: getProfileStorageWriter(stored) };
  }

  function storageBusinessProjectionKey(profile) {
    const projection = syncProjection(profile);
    // The storage key already scopes data to one ChatGPT account. Profile id/label can
    // be normalized differently while loading, so exclude that identity noise here.
    projection.id = CURRENT_PROFILE_ID;
    projection.label = '';
    return stableStringify(projection);
  }

  function crossTabRenderProjectionKey(profile) {
    const p = profile || {};
    const collapsed = {};
    Object.entries(p.folders || {}).forEach(([id, folder]) => { collapsed[id] = !!(folder && folder.collapsed); });
    return stableStringify({
      business: storageBusinessProjectionKey(p),
      sectionCollapsed: !!((((p.settings || {}).ui || {}).sectionCollapsed)),
      collapsed
    });
  }

  function applyStoredProfileFromRaw(raw, reason) {
    const incoming = parseStoredProfileRaw(raw);
    if (!incoming || !incoming.folders || !incoming.conversations) return false;
    const rev = getProfileStorageRevision(incoming);
    if (rev && !isRevisionNewer(rev, lastSeenStorageRevision)) return false;

    const previousBusinessProjection = lastSeenStorageProjection || storageBusinessProjectionKey(state);
    const previousRenderProjection = crossTabRenderProjectionKey(state);
    const oldWebdav = state && state.settings && state.settings.webdav ? JSON.parse(JSON.stringify(state.settings.webdav)) : null;
    const normalized = normalizeProfile(incoming, CURRENT_PROFILE_ID, incoming.label || (state && state.label) || 'ChatGPT account');
    if (oldWebdav && normalized.settings && normalized.settings.webdav) {
      // WebDAV credentials are local-only. Do not replace this tab's credentials with
      // the sanitized username/password from another tab or an exported payload.
      normalized.settings.webdav.username = oldWebdav.username || normalized.settings.webdav.username || '';
      normalized.settings.webdav.password = oldWebdav.password || normalized.settings.webdav.password || '';
    }

    const incomingBusinessProjection = storageBusinessProjectionKey(normalized);
    const incomingRenderProjection = crossTabRenderProjectionKey(normalized);
    const businessChanged = incomingBusinessProjection !== previousBusinessProjection;
    const renderChanged = incomingRenderProjection !== previousRenderProjection;

    state = normalized;
    mutationBaseline = syncProjection(state);
    if (!state.folders[selectedFolderId]) selectedFolderId = ROOT_ID;
    dirtySincePush = !!((state.settings.webdav || {}).pendingPush);
    syncStatus = (state.settings.webdav || {}).conflict ? 'error' : 'off';
    lastSeenStorageRevision = getProfileStorageRevision(state) || rev || lastSeenStorageRevision;
    lastSeenStorageProjection = incomingBusinessProjection;
    localUnsavedChanges = false;
    if (pendingPersistTimer) {
      clearTimeout(pendingPersistTimer);
      pendingPersistTimer = null;
    }
    pendingPersistReason = '';
    if (renderChanged) queueRender();
    if (businessChanged) applySidebarWidth();
    restartPeriodicBackup();
    updateSyncStatusIcon();
    if (reason === 'external-change' && businessChanged) toast('已同步另一个标签页的文件夹更新。');
    return true;
  }

  function maybeApplyNewerStoredProfile(reason) {
    const stored = currentStorageRevisionInfo();
    if (!stored.revision || stored.writer === TAB_ID || !isRevisionNewer(stored.revision, lastSeenStorageRevision)) return false;
    const raw = gmGet(activeProfileStorageKey(), '');
    const incoming = parseStoredProfileRaw(raw);
    const incomingProjection = incoming && incoming.folders && incoming.conversations ? storageBusinessProjectionKey(incoming) : '';
    const knownProjection = lastSeenStorageProjection || storageBusinessProjectionKey(state);
    const businessChanged = !incomingProjection || incomingProjection !== knownProjection;
    if (localUnsavedChanges || editingFolderId || (modalEl && !modalEl.hidden)) {
      // Metadata-only writes (for example lastRemoteCheckAt after a WebDAV verification)
      // must not masquerade as folder changes or block this tab's pending business edit.
      if (!businessChanged && incomingProjection) {
        lastSeenStorageRevision = getProfileStorageRevision(incoming) || stored.revision || lastSeenStorageRevision;
        return true;
      }
      if (reason === 'external-change') toast('另一个标签页有文件夹更新；完成当前编辑后会同步。');
      return false;
    }
    return applyStoredProfileFromRaw(raw, reason || 'newer-storage');
  }

  function flushPendingPersist(webdav) {
    if (pendingPersistTimer || localUnsavedChanges) persistNow({ webdav: !!webdav });
  }

  function schedulePersist(reason, opts) {
    const options = Object.assign({ webdav: true, touch: true }, opts || {});
    const p = getProfile();
    if (options.touch) {
      p.updatedAt = nowIso();

    }
    localUnsavedChanges = true;
    pendingPersistReason = reason || pendingPersistReason || 'change';
    if (options.webdav) {
      captureSyncOperations(reason || 'change');
      const w = p.settings.webdav || (p.settings.webdav = {});
      w.pendingPush = true;
      dirtySincePush = true;
      updateSyncStatusIcon();
    }
    if (pendingPersistTimer) clearTimeout(pendingPersistTimer);
    pendingPersistTimer = setTimeout(() => persistNow({ webdav: options.webdav }), 850);
  }

  function persistNow(opts) {
    const options = Object.assign({ webdav: true }, opts || {});
    if (pendingPersistTimer) {
      clearTimeout(pendingPersistTimer);
      pendingPersistTimer = null;
    }

    const stored = currentStorageRevisionInfo();
    if (stored.revision && stored.writer !== TAB_ID && isRevisionNewer(stored.revision, lastSeenStorageRevision)) {
      const raw = gmGet(activeProfileStorageKey(), '');
      const incoming = parseStoredProfileRaw(raw);
      const incomingProjection = incoming && incoming.folders && incoming.conversations ? storageBusinessProjectionKey(incoming) : '';
      const knownProjection = lastSeenStorageProjection || storageBusinessProjectionKey(state);
      if (incomingProjection && incomingProjection === knownProjection) {
        // Another tab only persisted runtime/storage metadata. Acknowledge its revision
        // and continue saving this tab's pending business change instead of discarding it.
        lastSeenStorageRevision = getProfileStorageRevision(incoming) || stored.revision || lastSeenStorageRevision;
      } else {
        // A genuinely newer business projection exists. Keep the established safety rule:
        // do not overwrite it with this tab's stale in-memory copy.
        applyStoredProfileFromRaw(raw, 'newer-before-write');
        localUnsavedChanges = false;
        updateSyncStatusIcon();
        return;
      }
    }

    state.version = VERSION;
    const revision = markStorageRevision(state);
    lastSeenStorageRevision = revision;
    lastSeenStorageProjection = storageBusinessProjectionKey(state);
    gmSet(activeProfileStorageKey(), JSON.stringify(state));
    writeRevisionMeta(revision);
    localUnsavedChanges = false;
    if (options.webdav) scheduleAutoBackup(pendingPersistReason || 'change');
    else updateSyncStatusIcon();
    pendingPersistReason = '';
  }

  // ---------------------------------------------------------------------------
  // 3. ChatGPT account detection; used only for WebDAV remote filename isolation
  // ---------------------------------------------------------------------------

  function getCurrentAccountInfo() {
    const boot = getBootstrapAccountInfo();
    if (boot && boot.id) return boot;

    const buttons = Array.from(document.querySelectorAll('[data-testid="accounts-profile-button"]'));
    if (!buttons.length) return null;
    let best = null;
    for (const btn of buttons) {
      const rawText = cleanText(btn.textContent || '');
      const aria = cleanAccountLabel(btn.getAttribute('aria-label') || '');
      const img = btn.querySelector('img') ? String(btn.querySelector('img').src || '').split('?')[0] : '';
      const labelSource = rawText.length >= 3 ? rawText : aria;
      if (!labelSource && !img) continue;
      const label = (labelSource || 'ChatGPT account').slice(0, 100);
      const score = (labelSource ? labelSource.length : 0) + (img ? 20 : 0) + (rawText ? 10 : 0);
      if (!best || score > best.score) best = { label, img, score };
    }
    if (!best) return null;
    const raw = location.host + '|' + best.label + '|' + best.img;
    return { id: 'acct_' + fnv1a(raw), label: best.label, email: '', accountId: '' };
  }

  function getBootstrapAccountInfo() {
    try {
      const script = document.getElementById('client-bootstrap');
      if (!script || !script.textContent) return null;
      const data = JSON.parse(script.textContent);
      const user = (data.session && data.session.user) || data.user || {};
      const account = (data.session && data.session.account) || data.account || {};
      const email = cleanText(user.email || '');
      const name = cleanText(user.name || '');
      const accountId = cleanText(account.id || '');
      if (!email && !accountId && !name) return null;
      const label = email || name || 'ChatGPT account';
      const idSource = email || name || accountId || 'ChatGPT account';
      return {
        id: 'acct_' + fnv1a(location.host + '|' + idSource + '|' + accountId),
        label,
        email,
        accountId
      };
    } catch (_) {
      return null;
    }
  }

  function cleanAccountLabel(text) {
    return cleanText(text)
      .replace(/open.*profile.*menu/ig, '')
      .replace(/打开.*个人资料.*菜单/ig, '')
      .replace(/profile menu/ig, '')
      .replace(/personal profile/ig, '')
      .replace(/，?\s*打开.*$/ig, '')
      .replace(/,?\s*open.*$/ig, '')
      .replace(/\s+/g, ' ')
      .trim() || '';
  }

  function readLastAccountInfo() {
    try {
      const raw = gmGet(LAST_ACCOUNT_KEY, '');
      const info = raw ? JSON.parse(raw) : null;
      return info && info.id ? info : null;
    } catch (_) { return null; }
  }

  function rememberAccountInfo(info) {
    if (!info || !info.id) return;
    try { gmSet(LAST_ACCOUNT_KEY, JSON.stringify({ id: info.id, label: info.label || 'ChatGPT account', email: info.email || '', accountId: info.accountId || '' })); } catch (_) {}
  }

  function isStrongAccountInfo(info) {
    return !!(info && (info.accountId || info.email));
  }

  function teardownCrossTabStorageSync() {
    if (storageSyncListenerId != null && typeof GM_removeValueChangeListener === 'function') {
      try { GM_removeValueChangeListener(storageSyncListenerId); } catch (_) {}
    }
    storageSyncListenerId = null;
    storageSyncListenerKey = '';
    storageSyncBound = false;
  }

  function stopWebdavTimers() {
    if (pendingWebdavTimer) clearTimeout(pendingWebdavTimer);
    pendingWebdavTimer = null;
    if (periodicWebdavTimer) clearInterval(periodicWebdavTimer);
    periodicWebdavTimer = null;
  }

  function activateAccount(info, initial) {
    if (!info || !info.id || accountSwitching) return state;
    accountSwitching = true;
    try {
      if (!initial && state) {
        if (localUnsavedChanges) persistNow({ webdav: false });
        if (dirtySincePush) {
          console.warn(APP_NAME, 'account switched with unsynchronized local changes; automatic upload paused');
          toast('检测到 ChatGPT 账号切换；旧账号存在未同步修改，已保留待上传状态。');
        }
      }
      stopWebdavTimers();
      teardownCrossTabStorageSync();
      accountGeneration += 1;
      currentAccount = info;
      lockedAccountKey = accountStableKey(info);
      rememberAccountInfo(info);
      state = loadState(info);
      state = normalizeProfile(state, lockedAccountKey, info.label || 'ChatGPT account');
      state.id = lockedAccountKey;
      state.label = info.label || state.label || 'ChatGPT account';
      ensureSyncMeta(state);
      mutationBaseline = syncProjection(state);
      selectedFolderId = ROOT_ID;
      dirtySincePush = !!((state.settings.webdav || {}).pendingPush);
      localUnsavedChanges = false;
      syncStatus = (state.settings.webdav || {}).conflict ? 'error' : 'off';
      lastSeenStorageRevision = currentStorageRevisionInfo().revision || getProfileStorageRevision(state);
      lastSeenStorageProjection = storageBusinessProjectionKey(state);
      setupCrossTabStorageSync();
      restartPeriodicBackup();
      if (!initial) {
        queueRender();
        applySidebarWidth();
        setTimeout(() => checkRemoteUpdate(false, 'account-switch'), 800);
      }
      return state;
    } finally {
      accountSwitching = false;
    }
  }

  function ensureActiveProfile() {
    const detected = getCurrentAccountInfo();
    if (!currentAccount) {
      const first = detected || readLastAccountInfo() || { id: 'acct_default', label: 'ChatGPT account', email: '', accountId: '' };
      return activateAccount(first, true);
    }
    if (detected && isStrongAccountInfo(detected)) {
      const key = accountStableKey(detected);
      if (key !== lockedAccountKey) {
        if (pendingAccountKey === key) pendingAccountHits += 1;
        else { pendingAccountKey = key; pendingAccountHits = 1; }
        // Require two observations to avoid a transient hydration identity switching profiles.
        if (pendingAccountHits >= 2) {
          pendingAccountKey = '';
          pendingAccountHits = 0;
          return activateAccount(detected, false);
        }
      } else {
        pendingAccountKey = '';
        pendingAccountHits = 0;
        currentAccount = detected;
        rememberAccountInfo(detected);
      }
    }
    if (!state) { state = normalizeProfile(loadState(currentAccount), accountStableKey(currentAccount), (currentAccount && currentAccount.label) || 'ChatGPT account'); mutationBaseline = syncProjection(state); lastSeenStorageProjection = storageBusinessProjectionKey(state); }
    return state;
  }

  function getProfile() {
    if (!state) return ensureActiveProfile();
    return state;
  }

  // ---------------------------------------------------------------------------
  // 4. UI styles and icons
  // ---------------------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById('cgfm-style')) return;
    const style = document.createElement('style');
    style.id = 'cgfm-style';
    style.textContent = `
      #cgfm-root { color: var(--text-primary, var(--token-text-primary, inherit)); font-size:14px; margin-bottom:12px; --cgfm-muted: var(--text-secondary, var(--token-text-tertiary, #6b7280)); --cgfm-text: var(--text-primary, var(--token-text-primary, #111827)); --cgfm-hover: var(--sidebar-surface-secondary, rgba(128,128,128,.12)); --cgfm-active: var(--sidebar-surface-secondary, rgba(128,128,128,.18)); --cgfm-danger:#ef4444; contain: layout paint style; }
      #cgfm-root * { box-sizing:border-box; }
      #cgfm-root button { font:inherit; }
      #cgfm-root .cgfm-header { display:flex; align-items:center; min-height:32px; padding:7px 10px 4px 16px; gap:6px; color:var(--cgfm-text); }
      #cgfm-root .cgfm-header.cgfm-root-drop { outline:1.5px solid #3b82f6; background:rgba(59,130,246,.10); border-radius:10px; }
      #cgfm-root .cgfm-title { flex:1; display:flex; align-items:center; gap:0; border:0; background:transparent; color:inherit; font-weight:600; font-size:14px; padding:0; cursor:pointer; min-width:0; }
      #cgfm-root .cgfm-title-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #cgfm-root .cgfm-actions { display:flex; align-items:center; gap:4px; }
      #cgfm-root .cgfm-icon { border:0; background:transparent; color:var(--cgfm-muted); cursor:pointer; border-radius:8px; width:28px; height:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; opacity:1; }
      #cgfm-root .cgfm-icon:hover { background:var(--cgfm-hover); color:var(--cgfm-text); }
      #cgfm-root .cgfm-icon svg { width:18px; height:18px; stroke-width:2; display:block; }
      #cgfm-root .cgfm-sync-status { position:relative; }
      #cgfm-root .cgfm-sync-status::before { content:''; width:17px; height:17px; border-radius:999px; border:2px solid currentColor; display:block; }
      #cgfm-root .cgfm-sync-off { color:#9ca3af; opacity:.9; }
      #cgfm-root .cgfm-sync-idle { color:#16a34a; }
      #cgfm-root .cgfm-sync-dirty { color:#f59e0b; }
      #cgfm-root .cgfm-sync-error { color:#ef4444; }
      #cgfm-root .cgfm-sync-syncing { color:#2563eb; }
      #cgfm-root .cgfm-sync-syncing::before { border-top-color:transparent; animation:cgfm-spin .75s linear infinite; }
      @keyframes cgfm-spin { to { transform:rotate(360deg); } }
      #cgfm-root .cgfm-tree { height:auto; max-height:none; overflow:visible; padding:2px 4px 6px 0; }
      #cgfm-root .cgfm-folder-children[hidden] { display:none !important; }
      #cgfm-root .cgfm-empty { color:var(--cgfm-muted); padding:7px 12px 11px 16px; font-size:12px; line-height:1.45; }
      #cgfm-root .cgfm-folder-row, #cgfm-root .cgfm-chat-row { display:flex; align-items:center; min-height:32px; gap:4px; padding:2px 6px 2px calc(8px + var(--depth, 0) * 20px); border-radius:9px; margin:1px 8px; position:relative; color:var(--cgfm-text); }
      #cgfm-root .cgfm-folder-row:hover, #cgfm-root .cgfm-chat-row:hover { background:var(--cgfm-hover); }
      #cgfm-root .cgfm-folder-row[draggable="true"] { cursor:grab; }
      #cgfm-root .cgfm-folder-row.cgfm-dragging-folder { opacity:.55; cursor:grabbing; }
      #cgfm-root .cgfm-folder-row.cgfm-selected { background:var(--cgfm-active); }
      #cgfm-root .cgfm-caret { width:18px; min-width:18px; height:22px; border:0; padding:0; background:transparent; display:flex; align-items:center; justify-content:center; color:var(--cgfm-muted); border-radius:6px; cursor:pointer; }
      #cgfm-root .cgfm-caret:hover { background:rgba(128,128,128,.12); color:var(--cgfm-text); }
      #cgfm-root .cgfm-caret svg { width:17px; height:17px; stroke-width:2; transition:transform .12s ease; }
      #cgfm-root .cgfm-caret.cgfm-open svg { transform:rotate(90deg); }
      #cgfm-root .cgfm-spacer { width:18px; min-width:18px; }
      #cgfm-root .cgfm-folder-icon { width:20px; min-width:20px; height:20px; display:flex; align-items:center; justify-content:center; color:var(--folder-color); }
      #cgfm-root .cgfm-folder-icon svg { width:20px; height:20px; stroke-width:2; }
      #cgfm-root .cgfm-chat-icon { width:16px; min-width:16px; height:20px; display:flex; align-items:center; justify-content:center; color:var(--cgfm-muted); margin-right:1px; }
      #cgfm-root .cgfm-chat-icon svg { width:16px; height:16px; stroke-width:1.9; }
      #cgfm-root .cgfm-folder-name, #cgfm-root .cgfm-chat-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; line-height:20px; }
      #cgfm-root .cgfm-folder-name { cursor:pointer; font-weight:500; }
      #cgfm-root .cgfm-chat-title { color:inherit; text-decoration:none; }
      #cgfm-root .cgfm-folder-more { flex:0 0 auto; color:var(--cgfm-muted); }
      #cgfm-root .cgfm-row-actions { display:none; align-items:center; gap:1px; }
      #cgfm-root .cgfm-chat-row:hover .cgfm-row-actions { display:flex; }
      #cgfm-root .cgfm-row-actions .cgfm-icon { width:24px; height:24px; }
      #cgfm-root .cgfm-row-actions .cgfm-icon svg { width:16px; height:16px; }
      #cgfm-root .cgfm-folder-name-input { flex:1; min-width:0; height:26px; border-radius:7px; border:1px solid rgba(128,128,128,.35); background:var(--main-surface-primary,#fff); color:var(--cgfm-text); padding:0 7px; font:inherit; }
      #cgfm-root .cgfm-folder-row.cgfm-drop-inside { outline:1.5px solid #3b82f6; background:rgba(59,130,246,.12); }
      .cgfm-menu, .cgfm-color-popover { position:fixed; z-index:2147483647; min-width:172px; padding:6px; border-radius:12px; background:var(--main-surface-primary,#fff); color:var(--text-primary,#111827); border:1px solid rgba(128,128,128,.25); box-shadow:0 12px 34px rgba(0,0,0,.22); font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
      .cgfm-menu-item { width:100%; display:flex; align-items:center; gap:9px; height:32px; border:0; background:transparent; color:inherit; border-radius:8px; padding:0 9px; cursor:pointer; text-align:left; }
      .cgfm-menu-item:hover { background:rgba(128,128,128,.12); }
      .cgfm-menu-item svg { width:16px; height:16px; stroke-width:2; }
      .cgfm-menu-item.cgfm-danger { color:var(--cgfm-danger,#ef4444); }
      .cgfm-color-popover { min-width:224px; padding:10px; display:grid; grid-template-columns:repeat(4,44px); gap:10px; }
      .cgfm-color-swatch { width:44px; height:44px; border:0; border-radius:10px; cursor:pointer; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
      .cgfm-color-custom { display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#fff,#eee); color:#111827; }
      .cgfm-color-custom svg { width:20px; height:20px; }
      .cgfm-confirm { min-width:220px; padding:10px; }
      .cgfm-confirm p { margin:0 0 10px; line-height:1.45; }
      .cgfm-confirm-actions { display:flex; justify-content:flex-end; gap:8px; }
      .cgfm-confirm-actions button { border:0; border-radius:8px; height:30px; padding:0 10px; cursor:pointer; }
      .cgfm-confirm-actions .cgfm-danger-btn { background:#ef4444; color:#fff; }
      .cgfm-modal-backdrop { position:fixed; inset:0; z-index:2147483646; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; }
      .cgfm-modal-backdrop[hidden] { display:none !important; }
      .cgfm-modal { width:min(620px,calc(100vw - 32px)); max-height:calc(100vh - 48px); overflow:auto; border-radius:14px; padding:18px; background:var(--main-surface-primary,#fff); color:var(--text-primary,#111827); box-shadow:0 18px 50px rgba(0,0,0,.28); font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
      .cgfm-modal h2 { font-size:16px; margin:0 0 12px; }
      .cgfm-modal label { display:block; margin:10px 0 4px; color:var(--text-secondary,#666); font-size:12px; }
      .cgfm-modal input[type="text"], .cgfm-modal input[type="password"], .cgfm-modal input[type="number"] { width:100%; height:34px; border-radius:8px; border:1px solid rgba(128,128,128,.32); background:var(--main-surface-primary,#fff); color:inherit; padding:0 9px; }
      .cgfm-modal-row { display:flex; align-items:center; gap:8px; margin:8px 0; }
      .cgfm-sidebar-width-grid { display:grid; grid-template-columns:1fr auto; align-items:center; gap:10px; }
      .cgfm-sidebar-width-badge { min-width:52px; text-align:right; color:var(--text-secondary,#666); font-variant-numeric:tabular-nums; }
      .cgfm-modal-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; margin-top:16px; }
      .cgfm-modal-actions button { height:34px; border-radius:9px; border:1px solid rgba(128,128,128,.25); padding:0 12px; cursor:pointer; background:transparent; color:inherit; }
      .cgfm-modal-actions .cgfm-primary-btn { background:#2563eb; border-color:#2563eb; color:#fff; }
      .cgfm-modal-actions .cgfm-cancel-btn { background:rgba(128,128,128,.12); }
      .cgfm-native-menu-item { user-select:none; }
      .cgfm-native-menu-item[data-cgfm-native-add] { cursor:default; width:100%; }
      .cgfm-native-menu-item[data-cgfm-native-add] > .cgfm-native-menu-leading { min-width:0; flex:1 1 auto; }
      .cgfm-native-menu-item .cgfm-native-menu-label { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cgfm-native-menu-item[data-cgfm-native-add] > svg { width:16px !important; height:16px !important; flex:0 0 16px !important; margin-inline-start:auto !important; transform:translateX(-12px) !important; }
      .cgfm-native-folder-menu { position:fixed; z-index:2147483647; min-width:210px; max-width:320px; max-height:min(70vh,520px); overflow:auto; padding:6px; border-radius:14px; background:var(--main-surface-primary,#fff); color:var(--text-primary,#111827); border:1px solid rgba(128,128,128,.22); box-shadow:0 12px 34px rgba(0,0,0,.22); font:14px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
      .cgfm-native-folder-item { width:100%; display:flex; align-items:center; gap:8px; min-height:34px; border:0; border-radius:9px; background:transparent; color:inherit; padding:0 8px; cursor:pointer; text-align:left; }
      .cgfm-native-folder-item:hover, .cgfm-native-folder-item.cgfm-open { background:rgba(128,128,128,.12); }
      .cgfm-native-folder-item svg { width:18px; height:18px; stroke-width:2; flex:0 0 auto; }
      .cgfm-native-folder-item .cgfm-native-folder-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .cgfm-native-folder-item .cgfm-native-folder-arrow { width:14px; height:14px; opacity:.72; }
      .cgfm-native-folder-empty { color:var(--text-secondary,#777); padding:8px 10px; white-space:nowrap; }
      .cgfm-toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); z-index:2147483647; background:rgba(17,24,39,.94); color:white; padding:8px 12px; border-radius:999px; font:13px/1.3 system-ui,sans-serif; box-shadow:0 10px 24px rgba(0,0,0,.25); max-width:70vw; }
    `;
    document.head.appendChild(style);
  }

  function icon(name) {
    const icons = {
      chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4.5 6.5A4.5 4.5 0 0 1 9 2h6a4.5 4.5 0 0 1 4.5 4.5v4A4.5 4.5 0 0 1 15 15H9l-4.5 4v-4.8A4.5 4.5 0 0 1 2 10.5v-4Z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>',
      settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.07A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 0 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.07A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 0 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.07A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.07A1.7 1.7 0 0 0 19.4 15Z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15V3m0 0 4 4m-4-4-4 4M5 19h14" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14 7 3 3" stroke-linecap="round"/></svg>',
      palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3a9 9 0 0 0 0 18h1.2a1.8 1.8 0 0 0 1.3-3 1.8 1.8 0 0 1 1.3-3H17a4 4 0 0 0 4-4 8 8 0 0 0-9-8Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="14" cy="7.5" r="1"/><circle cx="16.5" cy="10" r="1"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 12a8 8 0 0 1-14.9 4M4 12A8 8 0 0 1 18.9 8M19 4v4h-4M5 20v-4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/></svg>',
      custom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>'
    };
    return icons[name] || '';
  }

  // ---------------------------------------------------------------------------
  // 5. Mounting and folder tree rendering
  // ---------------------------------------------------------------------------

  function findNativeChatLink(scope) {
    const searchRoot = scope && scope.querySelector ? scope : document;
    const selector = 'a[href^="/c/"]:not(.cgfm-chat-title), a[href*="/c/"]:not(.cgfm-chat-title)';
    const link = searchRoot.querySelector(selector);
    return link && !(rootEl && rootEl.contains(link)) ? link : null;
  }

  function findHistorySection() {
    const history = document.getElementById('history');
    // In current ChatGPT markup, #history is inside the whole "最近" section.
    // Returning the section itself lets us insert our root as a sibling before Recent,
    // instead of mutating inside React's history list section.
    if (history) return (history.parentElement && history.parentElement !== document.body) ? history.parentElement : history;
    const firstChat = findNativeChatLink(document.getElementById('stage-slideover-sidebar') || document);
    if (!firstChat) return null;
    let node = firstChat;
    for (let i = 0; i < 8 && node && node !== document.body; i++, node = node.parentElement) {
      if (node.tagName === 'DIV' && node.querySelectorAll && node.querySelectorAll('a[href*="/c/"]:not(.cgfm-chat-title)').length >= 2) return node;
    }
    return firstChat.parentElement;
  }

  function findSidebarParent() {
    const history = document.getElementById('history');
    if (history) return history.closest('nav[aria-label], nav, aside, [id*="sidebar"]') || history.parentElement;
    const nav = document.querySelector('#stage-slideover-sidebar nav, nav[aria-label*="Chat"], nav[aria-label*="历史"], nav[aria-label*="sidebar"], aside nav');
    if (nav) return nav;
    const link = findNativeChatLink(document.getElementById('stage-slideover-sidebar') || document);
    return link ? (link.closest('nav, aside, [id*="sidebar"]') || link.parentElement) : null;
  }

  function isSafeMountParent(parent) {
    return !!(parent && parent instanceof Element && (!rootEl || (parent !== rootEl && !rootEl.contains(parent))));
  }

  function initialMountHostStable(parent) {
    if (mounted) return true;
    if (document.readyState !== 'complete' || !isSafeMountParent(parent) || !parent.isConnected) {
      initialMountCandidate = null;
      initialMountCandidateSince = 0;
      return false;
    }
    const now = Date.now();
    if (initialMountCandidate !== parent) {
      initialMountCandidate = parent;
      initialMountCandidateSince = now;
      return false;
    }
    return now - initialMountCandidateSince >= INITIAL_MOUNT_STABLE_MS;
  }

  function mount() {
    ensureActiveProfile();
    const recent = findHistorySection();
    const parent = (recent && recent.parentElement) || findSidebarParent();
    // The first mount must not mutate React-managed DOM until the same native host has
    // remained connected for a short stability window. Later remounts stay immediate.
    if (!isSafeMountParent(parent) || !initialMountHostStable(parent)) return false;
    injectStyle();
    applySidebarWidth();
    sidebarEl = findSidebarParent() || parent;
    if (!rootEl) {
      document.querySelectorAll('#cgfm-root').forEach(el => el.remove());
      rootEl = document.createElement('div');
      rootEl.id = 'cgfm-root';
      rootEl.setAttribute('data-cgfm-version', VERSION);
      bindRootEvents(rootEl);
    }
    if (!document.body.contains(rootEl) || rootEl.parentElement !== parent) {
      if (recent && recent.parentElement === parent) parent.insertBefore(rootEl, recent);
      else parent.appendChild(rootEl);
    }
    render();
    syncSidebarVisibility();
    setupNativeDragCache();
    setupNativeMenuHook();
    mounted = true;
    initialMountCandidate = null;
    initialMountCandidateSince = 0;
    return true;
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!rootEl || !document.body.contains(rootEl)) mount();
      else render();
    });
  }

  function render() {
    if (!rootEl) return;
    const p = getProfile();
    const collapsed = !!p.settings.ui.sectionCollapsed;
    rootEl.innerHTML = `
      <div class="cgfm-header" data-root-drop="1">
        <button class="cgfm-title" data-action="toggle-section" title="折叠/展开文件夹">
          <span class="cgfm-title-text">文件夹</span>
        </button>
        <div class="cgfm-actions">
          <button class="cgfm-icon" data-action="export-json" title="导出 JSON">${icon('download')}</button>
          <button class="cgfm-icon" data-action="import-json" title="导入 JSON">${icon('upload')}</button>
          <button class="cgfm-icon cgfm-sync-status cgfm-sync-${computeSyncStatus()}" data-sync-status="1" data-action="sync-status" title="${escapeAttr(syncStatusTitle())}" aria-label="${escapeAttr(syncStatusTitle())}"></button>
          <button class="cgfm-icon" data-action="settings" title="设置">${icon('settings')}</button>
          <button class="cgfm-icon" data-action="new-folder" title="新建顶层文件夹">${icon('plus')}</button>
        </div>
      </div>
      ${collapsed ? '' : `<div class="cgfm-tree" data-folder-tree="1">${renderTree(p)}</div>`}
    `;
    treeEl = rootEl.querySelector('[data-folder-tree]');
    focusInlineFolderEditor();
  }

  function renderTree(p) {
    const root = p.folders[ROOT_ID];
    const parts = [];
    for (const fid of root.childFolderIds || []) parts.push(renderFolder(p, fid, 0));
    for (const cid of root.chatIds || []) parts.push(renderChat(p, cid, ROOT_ID, 0));
    return parts.length ? parts.join('') : '<div class="cgfm-empty">点击右上角 + 新建文件夹。直接把 ChatGPT 最近对话拖到文件夹。</div>';
  }

  function renderFolder(p, fid, depth) {
    const f = p.folders[fid];
    if (!f) return '';
    const selected = selectedFolderId === fid ? ' cgfm-selected' : '';
    const open = !f.collapsed;
    const isEditing = editingFolderId === fid;
    const nameHtml = isEditing
      ? `<input class="cgfm-folder-name-input" data-folder-edit-id="${escapeAttr(fid)}" value="${escapeAttr(f.name)}" spellcheck="false" autocomplete="off">`
      : `<span class="cgfm-folder-name" data-action="select-folder" data-folder-id="${escapeAttr(fid)}" title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span>`;
    const childHtml = [
      ...(f.childFolderIds || []).map(child => renderFolder(p, child, depth + 1)),
      ...(f.chatIds || []).map(cid => renderChat(p, cid, fid, depth))
    ].join('');
    return `
      <div class="cgfm-folder-block" data-folder-block="${escapeAttr(fid)}">
        <div class="cgfm-folder-row${selected}" data-folder-id="${escapeAttr(fid)}" data-depth="${depth}" draggable="${isEditing ? 'false' : 'true'}" style="--depth:${depth};--folder-color:${escapeAttr(normalizeColor(f.color))}">
          <button class="cgfm-caret ${open ? 'cgfm-open' : ''}" data-action="toggle-folder" data-folder-id="${escapeAttr(fid)}" title="折叠/展开">${icon('chevron')}</button>
          <span class="cgfm-folder-icon">${icon('folder')}</span>
          ${nameHtml}
          <button class="cgfm-icon cgfm-folder-more" data-action="folder-menu" data-folder-id="${escapeAttr(fid)}" title="文件夹菜单">${icon('more')}</button>
        </div>
        <div class="cgfm-folder-children" data-folder-children="${escapeAttr(fid)}" ${open ? '' : 'hidden'}>${childHtml}</div>
      </div>`;
  }

  function renderChat(p, cid, folderId, depth) {
    const c = p.conversations[cid];
    if (!c) return '';
    const title = c.title || 'Untitled chat';
    const url = normalizeStoredUrl(c.url || ('/c/' + cid));
    return `
      <div class="cgfm-chat-row" data-chat-id="${escapeAttr(cid)}" data-folder-id="${escapeAttr(folderId)}" data-depth="${depth}" style="--depth:${depth}">
        <span class="cgfm-spacer"></span>
        <span class="cgfm-chat-icon">${icon('chat')}</span>
        <a class="cgfm-chat-title" href="${escapeAttr(url)}" title="${escapeAttr(title)}">${escapeHtml(title)}</a>
        <span class="cgfm-row-actions">
          <button class="cgfm-icon" data-action="refresh-chat-title" data-chat-id="${escapeAttr(cid)}" title="刷新标题">${icon('refresh')}</button>
          <button class="cgfm-icon" data-action="remove-chat" data-chat-id="${escapeAttr(cid)}" title="从管理器移除">${icon('x')}</button>
        </span>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // 6. Folder tree actions and inline menus
  // ---------------------------------------------------------------------------

  function bindRootEvents(el) {
    el.addEventListener('click', onRootClick);
    el.addEventListener('dragstart', onRootDragStart);
    el.addEventListener('dragover', onRootDragOver);
    el.addEventListener('dragleave', onRootDragLeave);
    el.addEventListener('drop', onRootDrop);
    el.addEventListener('keydown', onRootKeydown, true);
    el.addEventListener('focusout', onRootFocusOut, true);
  }

  function onRootClick(event) {
    const chatLink = event.target.closest && event.target.closest('a.cgfm-chat-title[href]');
    if (chatLink && rootEl.contains(chatLink)) {
      event.preventDefault();
      navigateToConversation(chatLink.getAttribute('href') || chatLink.href || '');
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || !rootEl.contains(button)) return;
    const action = button.getAttribute('data-action');
    const fid = button.getAttribute('data-folder-id');
    const cid = button.getAttribute('data-chat-id');
    if (action !== 'select-folder') event.preventDefault();
    if (action === 'toggle-section') toggleSection();
    else if (action === 'new-folder') createFolder(ROOT_ID);
    else if (action === 'export-json') exportJson();
    else if (action === 'import-json') importJson();
    else if (action === 'settings') showSettings();
    else if (action === 'sync-status') webdavSync(true, 'status-button');
    else if (action === 'toggle-folder') toggleFolder(fid);
    else if (action === 'select-folder') selectFolder(fid);
    else if (action === 'folder-menu') showFolderMenu(fid, button);
    else if (action === 'refresh-chat-title') refreshChatTitle(cid);
    else if (action === 'remove-chat') removeChat(cid);
  }

  function toggleSection() {
    const p = getProfile();
    p.settings.ui.sectionCollapsed = !p.settings.ui.sectionCollapsed;
    queueRender();
    schedulePersist('toggle-section', { webdav: false });
  }

  function selectFolder(fid) {
    const p = getProfile();
    if (!p.folders[fid]) return;
    selectedFolderId = selectedFolderId === fid ? ROOT_ID : fid;
    queueRender();
  }

  function toggleFolder(fid) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f) return;
    f.collapsed = !f.collapsed;
    updateFolderCollapseDom(fid, f.collapsed);
    schedulePersist('toggle-folder', { webdav: false, touch: false });
  }

  function updateFolderCollapseDom(fid, collapsed) {
    if (!rootEl) return;
    const row = rootEl.querySelector('.cgfm-folder-row[data-folder-id="' + cssEscape(fid) + '"]');
    const children = rootEl.querySelector('.cgfm-folder-children[data-folder-children="' + cssEscape(fid) + '"]');
    const caret = row && row.querySelector('.cgfm-caret');
    if (children) children.hidden = !!collapsed;
    if (caret) caret.classList.toggle('cgfm-open', !collapsed);
  }

  function createFolder(parentId) {
    const p = getProfile();
    const parent = p.folders[parentId] || p.folders[ROOT_ID];
    const id = uid('fld');
    p.folders[id] = { id, name: '新建文件夹', parentId: parent.id, childFolderIds: [], chatIds: [], color: DEFAULT_FOLDER_COLOR, collapsed: false, createdAt: nowIso(), updatedAt: nowIso() };
    parent.childFolderIds.push(id);
    parent.collapsed = false;
    sortFolderChildren(p, parent.id);
    editingFolderId = id;
    editingNewFolderId = id;
    editingOriginalName = '新建文件夹';
    selectedFolderId = id;
    queueRender();
    schedulePersist('new-folder');
  }

  function beginRename(fid) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f || fid === ROOT_ID) return;
    editingFolderId = fid;
    editingNewFolderId = '';
    editingOriginalName = f.name;
    queueRender();
  }

  function onRootKeydown(event) {
    const input = event.target.closest('[data-folder-edit-id]');
    if (!input || !rootEl.contains(input)) return;
    if (event.key === 'Enter') { event.preventDefault(); commitFolderEdit(input, false); }
    else if (event.key === 'Escape') { event.preventDefault(); commitFolderEdit(input, true); }
  }

  function onRootFocusOut(event) {
    const input = event.target.closest('[data-folder-edit-id]');
    if (!input || !rootEl.contains(input)) return;
    setTimeout(() => {
      if (editingFolderId === input.getAttribute('data-folder-edit-id')) commitFolderEdit(input, false);
    }, 0);
  }

  function focusInlineFolderEditor() {
    if (!editingFolderId || !rootEl) return;
    const input = rootEl.querySelector('[data-folder-edit-id="' + cssEscape(editingFolderId) + '"]');
    if (!input) return;
    requestAnimationFrame(() => { try { input.focus(); input.select(); } catch (_) {} });
  }

  function commitFolderEdit(input, cancel) {
    const p = getProfile();
    const fid = input ? input.getAttribute('data-folder-edit-id') : editingFolderId;
    if (!fid || editingFolderId !== fid) return;
    const f = p.folders[fid];
    const isNew = editingNewFolderId === fid;
    if (!f) { clearEdit(); return; }
    const value = cleanText(input ? input.value : '');
    if (cancel) {
      if (isNew) deleteFolderImmediate(fid);
      else f.name = editingOriginalName || f.name;
      clearEdit();
      sortFolderChildren(p, f.parentId || ROOT_ID);
      queueRender();
      schedulePersist('cancel-edit');
      return;
    }
    if (!value) {
      if (isNew) deleteFolderImmediate(fid);
      else f.name = editingOriginalName || '新建文件夹';
    } else {
      f.name = value;
      f.updatedAt = nowIso();
      sortFolderChildren(p, f.parentId || ROOT_ID);
    }
    clearEdit();
    queueRender();
    schedulePersist('rename-folder');
  }

  function clearEdit() {
    editingFolderId = '';
    editingNewFolderId = '';
    editingOriginalName = '';
  }

  function showFolderMenu(fid, anchor) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f) return;
    closeMenu();
    const rect = anchor.getBoundingClientRect();
    menuEl = document.createElement('div');
    menuEl.className = 'cgfm-menu';
    menuEl.style.left = Math.round(rect.left) + 'px';
    menuEl.style.top = Math.round(rect.bottom + 4) + 'px';
    menuEl.innerHTML = `
      <button class="cgfm-menu-item" data-menu="child">${icon('plus')}<span>新建子文件夹</span></button>
      <button class="cgfm-menu-item" data-menu="rename">${icon('rename')}<span>重命名</span></button>
      <button class="cgfm-menu-item" data-menu="color">${icon('palette')}<span>设置颜色</span></button>
      <button class="cgfm-menu-item cgfm-danger" data-menu="delete">${icon('trash')}<span>删除文件夹</span></button>
    `;
    document.body.appendChild(menuEl);
    menuEl.addEventListener('click', event => {
      const item = event.target.closest('[data-menu]');
      if (!item) return;
      const action = item.getAttribute('data-menu');
      const left = parseInt(menuEl.style.left, 10) || rect.left;
      const top = parseInt(menuEl.style.top, 10) || rect.top;
      if (action === 'child') { closeMenu(); createFolder(fid); }
      else if (action === 'rename') { closeMenu(); beginRename(fid); }
      else if (action === 'color') showColorPopover(fid, left, top);
      else if (action === 'delete') showDeleteConfirm(fid, left, top);
    });
    setTimeout(() => document.addEventListener('mousedown', closeMenuOnOutside, true), 0);
  }

  function closeMenuOnOutside(event) {
    if (menuEl && !menuEl.contains(event.target)) closeMenu();
  }

  function closeMenu() {
    document.removeEventListener('mousedown', closeMenuOnOutside, true);
    if (menuEl) menuEl.remove();
    menuEl = null;
  }

  function showColorPopover(fid, left, top) {
    closeMenu();
    const colors = ['#6b7280', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
    menuEl = document.createElement('div');
    menuEl.className = 'cgfm-color-popover';
    menuEl.style.left = Math.round(left) + 'px';
    menuEl.style.top = Math.round(top) + 'px';
    menuEl.innerHTML = colors.map(c => `<button class="cgfm-color-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('') +
      `<button class="cgfm-color-swatch cgfm-color-custom" data-color="custom" title="自定义颜色">${icon('custom')}</button>`;
    document.body.appendChild(menuEl);
    menuEl.addEventListener('click', event => {
      const swatch = event.target.closest('[data-color]');
      if (!swatch) return;
      const color = swatch.getAttribute('data-color');
      if (color === 'custom') return showCustomColorInput(fid, left, top);
      setFolderColor(fid, color);
      closeMenu();
    });
    setTimeout(() => document.addEventListener('mousedown', closeMenuOnOutside, true), 0);
  }

  function showCustomColorInput(fid, left, top) {
    const p = getProfile();
    const current = normalizeColor((p.folders[fid] || {}).color);
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'cgfm-menu';
    menuEl.style.left = Math.round(left) + 'px';
    menuEl.style.top = Math.round(top) + 'px';
    menuEl.innerHTML = `<input id="cgfm-custom-color" value="${escapeAttr(current)}" style="width:150px;height:32px;border-radius:8px;border:1px solid rgba(128,128,128,.3);padding:0 8px;background:var(--main-surface-primary,#fff);color:inherit">`;
    document.body.appendChild(menuEl);
    const input = menuEl.querySelector('input');
    input.focus(); input.select();
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        const color = normalizeHex(input.value);
        if (!color) return toast('请输入合法 HEX 颜色。');
        setFolderColor(fid, color);
        closeMenu();
      } else if (event.key === 'Escape') closeMenu();
    });
    setTimeout(() => document.addEventListener('mousedown', closeMenuOnOutside, true), 0);
  }

  function normalizeHex(value) {
    const s = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s.slice(1).split('').map(ch => ch + ch).join('');
    return '';
  }

  function setFolderColor(fid, color) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f) return;
    f.color = normalizeColor(color);
    f.updatedAt = nowIso();
    const row = rootEl && rootEl.querySelector('[data-folder-id="' + cssEscape(fid) + '"]');
    if (row) row.style.setProperty('--folder-color', f.color);
    schedulePersist('folder-color');
  }

  function showDeleteConfirm(fid, left, top) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f || fid === ROOT_ID) return;
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'cgfm-menu cgfm-confirm';
    menuEl.style.left = Math.round(left) + 'px';
    menuEl.style.top = Math.round(top) + 'px';
    menuEl.innerHTML = `<p>删除“${escapeHtml(f.name)}”？<br><span style="color:var(--text-secondary,#777)">只会删除文件夹索引，不会删除 ChatGPT 原聊天。</span></p><div class="cgfm-confirm-actions"><button data-confirm="cancel">取消</button><button class="cgfm-danger-btn" data-confirm="delete">删除</button></div>`;
    document.body.appendChild(menuEl);
    menuEl.addEventListener('click', event => {
      const b = event.target.closest('[data-confirm]');
      if (!b) return;
      if (b.getAttribute('data-confirm') === 'delete') {
        deleteFolderImmediate(fid);
        queueRender();
        schedulePersist('delete-folder');
      }
      closeMenu();
    });
    setTimeout(() => document.addEventListener('mousedown', closeMenuOnOutside, true), 0);
  }

  function deleteFolderImmediate(fid) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f || fid === ROOT_ID) return;
    const parent = p.folders[f.parentId] || p.folders[ROOT_ID];
    parent.childFolderIds = parent.childFolderIds.filter(x => x !== fid);
    const ids = collectFolderIds(fid, p);
    for (const id of ids) {
      const folder = p.folders[id];
      if (folder) {
        for (const cid of folder.chatIds || []) delete p.conversations[cid];
      }
      delete p.folders[id];
    }
    if (!p.folders[selectedFolderId]) selectedFolderId = ROOT_ID;
  }

  function collectFolderIds(fid, p) {
    const out = [];
    const walk = id => {
      out.push(id);
      const f = p.folders[id];
      for (const child of (f && f.childFolderIds) || []) walk(child);
    };
    walk(fid);
    return out;
  }

  function removeChat(cid) {
    const p = getProfile();
    const c = p.conversations[cid];
    if (!c) return;
    const f = p.folders[c.folderId] || p.folders[ROOT_ID];
    f.chatIds = f.chatIds.filter(x => x !== cid);
    delete p.conversations[cid];
    queueRender();
    schedulePersist('remove-chat');
  }

  function refreshChatTitle(cid) {
    const p = getProfile();
    const c = p.conversations[cid];
    if (!c) return;
    const oldTitle = c.title || '';
    const native = findNativeConversationAnchor(cid);
    const nativeTitle = native ? extractTitleFromAnchor(native) : '';
    const currentPageTitle = extractTitleFromCurrentPage(cid);
    // If the user is currently viewing this conversation, document.title is often the
    // freshest source after a rename. Otherwise prefer the native sidebar link, never
    // the script's own folder link.
    const title = cleanConversationTitle((currentPageTitle && currentPageTitle !== oldTitle) ? currentPageTitle : (nativeTitle || currentPageTitle));
    if (!title) {
      toast('当前最近列表中找不到该对话。');
      return;
    }
    if (title === oldTitle) {
      toast('标题没有变化。');
      return;
    }
    c.title = title;
    c.updatedAt = nowIso();
    queueRender();
    schedulePersist('refresh-title');
    toast('标题已刷新。');
  }

  // ---------------------------------------------------------------------------
  // 7. Firefox-friendly native drag/drop integration
  // ---------------------------------------------------------------------------

  function setupNativeDragCache() {
    if (document.__cgfmNativeDragBound) return;
    document.__cgfmNativeDragBound = true;
    document.addEventListener('pointerdown', onNativeHistoryPointerDown, true);
    document.addEventListener('mousedown', onNativeHistoryPointerDown, true);
    document.addEventListener('dragstart', onNativeHistoryDragStart, true);
    document.addEventListener('dragend', onNativeHistoryDragEnd, true);
    document.addEventListener('mouseup', restoreTransientNativeChatDrag, true);
    document.addEventListener('click', restoreTransientNativeChatDrag, true);
  }

  function resetNativeDragState() {
    restoreTransientNativeChatDrag();
    dragPayload = null;
    dragStartPayload = null;
    pointerPayload = null;
    lastHoveredFolderId = '';
    lastHoveredFolderAt = 0;
    dropCommitted = false;
    clearDropHighlight();
  }

  function payloadKind(payload) {
    if (!payload) return '';
    if (payload.kind === 'folder' && payload.folderId) return 'folder';
    if (payload.kind === 'chat' && payload.id) return 'chat';
    if (payload.id) return 'chat';
    return '';
  }

  function onRootDragStart(event) {
    if (!event || !event.target || !rootEl || !rootEl.contains(event.target)) return;
    const interactive = event.target.closest && event.target.closest('button,input,textarea,select,a,[contenteditable="true"]');
    if (interactive) return;
    const row = event.target.closest && event.target.closest('.cgfm-folder-row[data-folder-id]');
    if (!row || !rootEl.contains(row)) return;
    const fid = row.getAttribute('data-folder-id');
    if (!fid || fid === ROOT_ID || !getProfile().folders[fid]) return;
    closeMenu();
    const payload = { kind: 'folder', folderId: fid };
    dragPayload = payload;
    dragStartPayload = payload;
    pointerPayload = null;
    dropCommitted = false;
    row.classList.add('cgfm-dragging-folder');
    try {
      if (event.dataTransfer) {
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.setData('text/plain', 'chatgpt-folder:' + fid);
        event.dataTransfer.effectAllowed = 'move';
      }
    } catch (_) {}
  }

  function onNativeHistoryPointerDown(event) {
    if (!event || !(event.target instanceof Element)) return;
    if (rootEl && event.target instanceof Node && rootEl.contains(event.target)) return;
    const chat = maybeEnableTransientNativeChatDrag(event) || extractChatFromEvent(event);
    if (chat) pointerPayload = chat;
  }

  function maybeEnableTransientNativeChatDrag(event) {
    const target = event && event.target;
    if (!(target instanceof Element)) return null;
    // Do not alter the trailing three-dot menu click path; that already has its own menu-based add flow.
    if (target.closest('button,input,textarea,select,[contenteditable="true"],[data-trailing-button],[data-conversation-options-trigger]')) return null;
    const anchor = target.closest('#history a[href*="/c/"]');
    if (!anchor || (rootEl && rootEl.contains(anchor))) return null;
    const chat = extractChatFromAnchor(anchor);
    if (!chat) return null;

    // Some GPT-generated conversations in ChatGPT's Recent list are rendered as
    // draggable="false" even though they are normal /c/<conversation-id> links.
    // To keep the native Firefox drag/drop route, temporarily enable native dragging
    // only for the pressed row, then restore it on dragend/mouseup/click/timeout.
    if (anchor.getAttribute('draggable') === 'false') {
      restoreTransientNativeChatDrag();
      transientDragAnchor = anchor;
      transientDragOriginalDraggable = anchor.getAttribute('draggable');
      anchor.setAttribute('draggable', 'true');
      anchor.setAttribute('data-cgfm-temp-draggable', '1');
      transientDragRestoreTimer = setTimeout(restoreTransientNativeChatDrag, 2500);
    }
    return chat;
  }

  function restoreTransientNativeChatDrag() {
    if (transientDragRestoreTimer) {
      clearTimeout(transientDragRestoreTimer);
      transientDragRestoreTimer = null;
    }
    const anchor = transientDragAnchor;
    if (anchor) {
      try {
        if (document.contains(anchor) && anchor.getAttribute('data-cgfm-temp-draggable') === '1') {
          if (transientDragOriginalDraggable === null) anchor.removeAttribute('draggable');
          else anchor.setAttribute('draggable', transientDragOriginalDraggable);
          anchor.removeAttribute('data-cgfm-temp-draggable');
        }
      } catch (_) {}
    }
    transientDragAnchor = null;
    transientDragOriginalDraggable = null;
  }

  function onNativeHistoryDragStart(event) {
    if (!event || !(event.target instanceof Element)) return;
    if (rootEl && event.target instanceof Node && rootEl.contains(event.target)) return;
    if (!event.target.closest('a[href*="/c/"]') && !pointerPayload) return;
    const chat = extractChatFromEvent(event) || pointerPayload;
    if (!chat) { dragPayload = null; dragStartPayload = null; return; }
    chat.kind = 'chat';
    dragPayload = chat;
    dragStartPayload = chat;
    dropCommitted = false;
    try {
      if (event.dataTransfer) {
        // Add our own payload without clearing ChatGPT's original drag data, so native Project drag remains intact.
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify(chat));
        event.dataTransfer.setData('text/uri-list', location.origin + chat.url);
        event.dataTransfer.setData('text/plain', location.origin + chat.url);
        event.dataTransfer.effectAllowed = 'copyMove';
      }
    } catch (_) {}
  }

  function onNativeHistoryDragEnd() {
    const shouldFallback = !dropCommitted && lastHoveredFolderId && (Date.now() - lastHoveredFolderAt < 900);
    const payload = dragPayload || dragStartPayload || pointerPayload;
    if (shouldFallback && payload) {
      commitDropPayload(payload, lastHoveredFolderId);
      dropCommitted = true;
    }
    if (rootEl) rootEl.querySelectorAll('.cgfm-dragging-folder').forEach(el => el.classList.remove('cgfm-dragging-folder'));
    resetNativeDragState();
  }

  function onRootDragOver(event) {
    const target = resolveFolderDropTarget(event, true);
    if (!target) return;
    event.preventDefault();
    const payload = getDragPayload(event, false);
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = payloadKind(payload) === 'folder' ? 'move' : 'copy';
    } catch (_) {}
    lastHoveredFolderId = target.folderId;
    lastHoveredFolderAt = Date.now();
    clearDropHighlight(target.element);
    target.element.classList.add(target.isRoot ? 'cgfm-root-drop' : 'cgfm-drop-inside');
  }

  function onRootDragLeave(event) {
    const row = event.target.closest && event.target.closest('.cgfm-folder-row[data-folder-id]');
    if (row && (!event.relatedTarget || !row.contains(event.relatedTarget))) row.classList.remove('cgfm-drop-inside');
    const header = event.target.closest && event.target.closest('.cgfm-header[data-root-drop]');
    if (header && (!event.relatedTarget || !header.contains(event.relatedTarget))) header.classList.remove('cgfm-root-drop');
  }

  function onRootDrop(event) {
    const target = resolveFolderDropTarget(event, true);
    clearDropHighlight();
    if (!target) return;
    event.preventDefault();
    const payload = getDragPayload(event, true);
    if (!payload) {
      toast('没有识别到被拖动的聊天或文件夹。');
      return;
    }
    commitDropPayload(payload, target.folderId);
    dropCommitted = true;
  }

  function resolveFolderDropTarget(event, allowUnknownChat) {
    if (!event || !event.target || !rootEl) return null;
    const payload = getDragPayload(event, false);
    const kind = payloadKind(payload);
    const header = event.target.closest && event.target.closest('.cgfm-header[data-root-drop]');
    if (header && rootEl.contains(header)) {
      if (kind === 'folder' && canMoveFolderTo(payload.folderId, ROOT_ID)) return { folderId: ROOT_ID, element: header, isRoot: true };
      return null;
    }
    const row = event.target.closest && event.target.closest('.cgfm-folder-row[data-folder-id]');
    if (!row || !rootEl.contains(row)) return null;
    const fid = row.getAttribute('data-folder-id');
    if (!fid || !getProfile().folders[fid]) return null;
    if (kind === 'folder') return canMoveFolderTo(payload.folderId, fid) ? { folderId: fid, element: row, isRoot: false } : null;
    if (kind === 'chat' || allowUnknownChat) return { folderId: fid, element: row, isRoot: false };
    return null;
  }

  function clearDropHighlight(except) {
    if (!rootEl) return;
    rootEl.querySelectorAll('.cgfm-drop-inside,.cgfm-root-drop').forEach(el => { if (el !== except) el.classList.remove('cgfm-drop-inside', 'cgfm-root-drop'); });
  }

  function commitDropPayload(payload, folderId) {
    const kind = payloadKind(payload);
    if (kind === 'folder') return moveFolderToFolder(payload.folderId, folderId);
    if (kind === 'chat') return addChatToFolder(payload, folderId);
    toast('没有识别到被拖动的聊天或文件夹。');
  }

  function getDragPayload(event, allowRead) {
    if (dragPayload) return dragPayload;
    if (dragStartPayload) return dragStartPayload;
    if (pointerPayload) return pointerPayload;
    if (!allowRead || !event || !event.dataTransfer) return null;
    try {
      const raw = event.dataTransfer.getData(DRAG_MIME);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (payloadKind(parsed)) return parsed;
      }
    } catch (_) {}
    const types = ['text/uri-list', 'text/plain', 'text/html'];
    for (const type of types) {
      try {
        const text = event.dataTransfer.getData(type);
        const chat = extractChatFromText(text);
        if (chat) return chat;
      } catch (_) {}
    }
    return null;
  }

  function extractChatFromEvent(event) {
    const anchor = findChatAnchorFromEvent(event);
    return anchor ? extractChatFromAnchor(anchor) : null;
  }

  function findChatAnchorFromEvent(event) {
    if (!event) return null;
    const isElement = node => node && node.nodeType === 1;
    const isChatAnchor = node => isElement(node) && node.matches && node.matches('a[href*="/c/"]');
    const insideRoot = node => {
      try { return !!(rootEl && node instanceof Node && rootEl.contains(node)); }
      catch (_) { return false; }
    };
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      // Firefox composedPath() contains Window/Document objects. Never pass them into Node.contains().
      if (!(node instanceof Node)) continue;
      if (insideRoot(node)) return null;
      if (isChatAnchor(node)) return node;
      if (isElement(node) && node.closest) {
        const a = node.closest('a[href*="/c/"]');
        if (a && !insideRoot(a)) return a;
      }
    }
    const target = event.target;
    if (target instanceof Element && target.closest) {
      const a = target.closest('a[href*="/c/"]');
      if (a && !insideRoot(a)) return a;
    }
    return null;
  }

  function extractChatFromText(text) {
    const id = extractConversationId(text);
    if (!id) return null;
    let title = '';
    try {
      const anchor = document.querySelector('a[href*="/c/' + cssEscape(id) + '"]');
      title = anchor ? extractTitleFromAnchor(anchor) : '';
    } catch (_) {}
    return { kind: 'chat', id, title: title || 'Untitled chat', url: '/c/' + id };
  }

  function canMoveFolderTo(sourceId, targetParentId) {
    const p = getProfile();
    if (!sourceId || sourceId === ROOT_ID || !p.folders[sourceId]) return false;
    const targetId = targetParentId || ROOT_ID;
    if (!p.folders[targetId]) return false;
    if (sourceId === targetId) return false;
    let cur = targetId;
    while (cur && cur !== ROOT_ID) {
      if (cur === sourceId) return false;
      const f = p.folders[cur];
      cur = f ? f.parentId : '';
    }
    return true;
  }

  function moveFolderToFolder(sourceId, targetParentId) {
    const p = getProfile();
    const source = p.folders[sourceId];
    const targetId = targetParentId || ROOT_ID;
    const target = p.folders[targetId];
    if (!source || !target) return;
    if (!canMoveFolderTo(sourceId, targetId)) {
      toast('不能把文件夹移动到自己或自己的子文件夹中。');
      return;
    }
    if (source.parentId === targetId) {
      sortFolderChildren(p, targetId);
      queueRender();
      return;
    }
    const oldParent = p.folders[source.parentId] || p.folders[ROOT_ID];
    oldParent.childFolderIds = oldParent.childFolderIds.filter(id => id !== sourceId);
    source.parentId = targetId;
    source.updatedAt = nowIso();
    if (!target.childFolderIds.includes(sourceId)) target.childFolderIds.push(sourceId);
    if (targetId !== ROOT_ID) target.collapsed = false;
    sortFolderChildren(p, oldParent.id);
    sortFolderChildren(p, targetId);
    selectedFolderId = sourceId;
    queueRender();
    schedulePersist('move-folder');
    toast(targetId === ROOT_ID ? '文件夹已移动到顶层。' : '文件夹已移动。');
  }

  function addChatToFolder(chat, folderId) {
    const p = getProfile();
    const f = p.folders[folderId];
    if (!f || !chat || !chat.id) return;
    const existing = p.conversations[chat.id];
    if (existing && existing.folderId && p.folders[existing.folderId]) {
      p.folders[existing.folderId].chatIds = p.folders[existing.folderId].chatIds.filter(x => x !== chat.id);
    }
    p.conversations[chat.id] = Object.assign({}, existing || {}, {
      id: chat.id,
      title: chat.title || (existing && existing.title) || 'Untitled chat',
      url: normalizeStoredUrl(chat.url || ('/c/' + chat.id)),
      folderId,
      addedAt: existing && existing.addedAt || nowIso(),
      updatedAt: nowIso()
    });
    if (!f.chatIds.includes(chat.id)) f.chatIds.push(chat.id);
    f.collapsed = false;
    queueRender();
    schedulePersist('add-chat');
    toast('聊天已加入文件夹。');
  }


  // ---------------------------------------------------------------------------
  // 7b. Add-to-folder entry in ChatGPT's native Recent-chat options menu
  // ---------------------------------------------------------------------------

  function setupNativeMenuHook() {
    if (document.__cgfmNativeMenuBound) return;
    document.__cgfmNativeMenuBound = true;
    document.addEventListener('pointerdown', onNativeConversationMenuPointer, true);
    document.addEventListener('click', onNativeConversationMenuClick, true);
  }

  function onNativeConversationMenuPointer(event) {
    rememberNativeConversationMenuTarget(event);
  }

  function onNativeConversationMenuClick(event) {
    if (rememberNativeConversationMenuTarget(event)) armNativeMenuInjection();
  }

  function rememberNativeConversationMenuTarget(event) {
    const target = event && event.target;
    if (!(target instanceof Element)) return false;
    const button = target.closest('[data-conversation-options-trigger]');
    if (!button) return false;
    if (rootEl && rootEl.contains(button)) return false;
    const chat = extractChatFromOptionsButton(button);
    if (!chat) return false;
    chat.kind = 'chat';
    nativeMenuChat = chat;
    nativeMenuTriggerId = button.id || '';
    return true;
  }

  function extractChatFromOptionsButton(button) {
    if (!button) return null;
    const id = cleanText(button.getAttribute('data-conversation-options-trigger') || '');
    const anchor = button.closest('a[href*="/c/"]') || (id ? document.querySelector('a[href*="/c/' + cssEscape(id) + '"]') : null);
    const fromAnchor = anchor ? extractChatFromAnchor(anchor) : null;
    if (fromAnchor) return fromAnchor;
    if (!id) return null;
    const aria = button.getAttribute('aria-label') || '';
    const title = cleanConversationAriaLabel(aria) || 'Untitled chat';
    return { id, title, url: '/c/' + id };
  }

  function armNativeMenuInjection() {
    disconnectNativeMenuObserver();
    closeNativeFolderMenus();
    const tryNow = () => {
      try {
        if (injectNativeAddToFolderItem()) {
          disconnectNativeMenuObserver();
          startNativeMenuLivenessPoll();
          return true;
        }
      } catch (err) {
        console.warn(APP_NAME, 'native menu injection failed', err);
      }
      return false;
    };
    if (tryNow()) return;
    nativeMenuObserver = new MutationObserver(() => tryNow());
    try { nativeMenuObserver.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    [40, 90, 180, 360, 700, 1200].forEach(delay => setTimeout(tryNow, delay));
    nativeMenuObserveTimer = setTimeout(disconnectNativeMenuObserver, 1800);
  }

  function disconnectNativeMenuObserver() {
    if (nativeMenuObserver) nativeMenuObserver.disconnect();
    nativeMenuObserver = null;
    if (nativeMenuObserveTimer) clearTimeout(nativeMenuObserveTimer);
    nativeMenuObserveTimer = null;
  }

  function findVisibleNativeChatMenu() {
    const menus = Array.from(document.querySelectorAll('[role="menu"][data-radix-menu-content]'));
    const visible = menus.filter(isVisibleElement);
    if (!visible.length) return null;
    if (nativeMenuTriggerId) {
      const byTrigger = visible.find(menu => menu.getAttribute('aria-labelledby') === nativeMenuTriggerId);
      if (byTrigger) return byTrigger;
    }
    return visible.find(menu => menu.querySelector('[data-testid="delete-chat-menu-item"], [data-testid="share-chat-menu-item"]') && /分享|Share|重命名|Rename|归档|Archive|删除|Delete/.test(cleanText(menu.textContent || ''))) || null;
  }

  function injectNativeAddToFolderItem() {
    if (!nativeMenuChat || !nativeMenuChat.id) return false;
    const menu = findVisibleNativeChatMenu();
    if (!menu) return false;
    if (menu.querySelector('[data-cgfm-native-add="1"]')) return true;
    const item = document.createElement('div');
    const firstGroup = menu.querySelector('[role="group"]') || menu.firstElementChild || menu;
    const projectItem = Array.from(firstGroup.querySelectorAll('[role="menuitem"]')).find(el => /移至项目|Move to project/i.test(cleanText(el.textContent || '')));
    const projectArrow = projectItem && projectItem.querySelector(':scope > svg');
    const arrowHtml = projectArrow
      ? projectArrow.outerHTML
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" aria-hidden="true" data-rtl-flip="" class="icon-sm -me-0.25" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.setAttribute('data-cgfm-native-add', '1');
    item.setAttribute('data-orientation', 'vertical');
    item.setAttribute('data-has-submenu', '');
    item.setAttribute('aria-haspopup', 'menu');
    item.setAttribute('aria-expanded', 'false');
    item.className = 'group __menu-item cgfm-native-menu-item';
    item.innerHTML = '<div class="flex min-w-0 items-center gap-1.5 cgfm-native-menu-leading"><div class="flex items-center justify-center [opacity:var(--menu-item-icon-opacity,1)] icon">' + icon('folder') + '</div><div class="flex min-w-0 grow items-center gap-2.5 cgfm-native-menu-label">移至文件夹</div></div>' + arrowHtml;
    item.addEventListener('mouseenter', () => showNativeFolderRootMenu(item));
    item.addEventListener('focus', () => showNativeFolderRootMenu(item));
    item.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); showNativeFolderRootMenu(item); });
    item.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });

    if (projectItem && projectItem.parentElement === firstGroup) projectItem.insertAdjacentElement('afterend', item);
    else firstGroup.appendChild(item);
    return true;
  }

  function showNativeFolderRootMenu(anchor) {
    if (!nativeMenuChat || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    showNativeFolderSubmenu(ROOT_ID, rect.right + 4, rect.top, 0, nativeMenuChat);
    startNativeMenuLivenessPoll();
  }

  function showNativeFolderSubmenu(parentId, left, top, level, chat) {
    const p = getProfile();
    const parent = p.folders[parentId] || p.folders[ROOT_ID];
    closeNativeFolderMenusFrom(level);
    const menu = document.createElement('div');
    menu.className = 'cgfm-native-folder-menu';
    menu.setAttribute('data-cgfm-folder-menu-level', String(level));
    const ids = (parent.childFolderIds || []).filter(fid => p.folders[fid]);
    if (!ids.length) {
      menu.innerHTML = '<div class="cgfm-native-folder-empty">暂无文件夹</div>';
    } else {
      menu.innerHTML = ids.map(fid => {
        const f = p.folders[fid];
        const hasChildren = (f.childFolderIds || []).some(child => p.folders[child]);
        return '<button type="button" class="cgfm-native-folder-item" data-folder-id="' + escapeAttr(fid) + '" data-has-children="' + (hasChildren ? '1' : '0') + '" style="--folder-color:' + escapeAttr(normalizeColor(f.color)) + '"><span style="color:var(--folder-color)">' + icon('folder') + '</span><span class="cgfm-native-folder-name">' + escapeHtml(f.name) + '</span>' + (hasChildren ? '<span class="cgfm-native-folder-arrow">' + icon('chevron') + '</span>' : '') + '</button>';
      }).join('');
    }
    document.body.appendChild(menu);
    positionFloatingMenu(menu, left, top);
    nativeFolderSubmenus[level] = menu;
    menu.addEventListener('mousemove', event => {
      const item = event.target.closest && event.target.closest('.cgfm-native-folder-item[data-folder-id]');
      if (!item || !menu.contains(item)) return;
      menu.querySelectorAll('.cgfm-native-folder-item.cgfm-open').forEach(el => { if (el !== item) el.classList.remove('cgfm-open'); });
      item.classList.add('cgfm-open');
      const fid = item.getAttribute('data-folder-id');
      if (item.getAttribute('data-has-children') === '1') {
        const r = item.getBoundingClientRect();
        showNativeFolderSubmenu(fid, r.right + 4, r.top, level + 1, chat);
      } else {
        closeNativeFolderMenusFrom(level + 1);
      }
    });
    menu.addEventListener('mousedown', event => {
      const item = event.target.closest && event.target.closest('.cgfm-native-folder-item[data-folder-id]');
      if (!item || !menu.contains(item)) return;
      event.preventDefault();
      event.stopPropagation();
      const fid = item.getAttribute('data-folder-id');
      addChatToFolder(chat, fid);
      closeNativeFolderMenus();
      closeNativeChatMenu();
    }, true);
  }

  function positionFloatingMenu(menu, left, top) {
    const margin = 8;
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    const rect = menu.getBoundingClientRect();
    let x = left;
    let y = top;
    if (x + rect.width > window.innerWidth - margin) x = Math.max(margin, left - rect.width - 8);
    if (y + rect.height > window.innerHeight - margin) y = Math.max(margin, window.innerHeight - rect.height - margin);
    menu.style.left = Math.round(x) + 'px';
    menu.style.top = Math.round(y) + 'px';
  }

  function closeNativeFolderMenusFrom(level) {
    for (let i = level; i < nativeFolderSubmenus.length; i++) {
      const menu = nativeFolderSubmenus[i];
      if (menu) menu.remove();
    }
    nativeFolderSubmenus.length = Math.max(0, level);
  }

  function closeNativeFolderMenus() {
    closeNativeFolderMenusFrom(0);
    stopNativeMenuLivenessPoll();
  }

  function closeNativeChatMenu() {
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); } catch (_) {}
  }

  function startNativeMenuLivenessPoll() {
    if (nativeMenuPollTimer) return;
    const check = () => {
      if (!findVisibleNativeChatMenu()) {
        closeNativeFolderMenus();
        nativeMenuChat = null;
        nativeMenuTriggerId = '';
      }
    };
    nativeMenuPollTimer = setInterval(check, 600);
  }

  function stopNativeMenuLivenessPoll() {
    if (nativeMenuPollTimer) clearInterval(nativeMenuPollTimer);
    nativeMenuPollTimer = null;
  }

  function navigateToConversation(url) {
    const id = extractConversationId(url);
    if (!id) return;
    const targetPath = '/c/' + id;
    const currentId = extractConversationId(location.pathname + location.search + location.hash);
    if (currentId === id) return;

    // Safest SPA-like path: reuse ChatGPT's own sidebar link if it is already present.
    // Do not force history.pushState here; ChatGPT's router has extra state beyond the URL.
    const native = findNativeConversationAnchor(id);
    if (native) {
      try {
        native.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
        return;
      } catch (_) {
        try { native.click(); return; } catch (__) {}
      }
    }

    // Last resort only. This may reload, but it is safer than faking router state.
    location.assign(targetPath);
  }

  function findNativeConversationAnchor(id) {
    try {
      const selector = 'a[href*="/c/' + cssEscape(id) + '"]';
      const anchors = Array.from(document.querySelectorAll(selector))
        .filter(a => !(rootEl && rootEl.contains(a)));
      if (!anchors.length) return null;
      // Prefer visible native sidebar/history links. Hidden portal/menu copies or other
      // framework anchors may contain stale text.
      return anchors.find(isVisibleElement) || anchors[0] || null;
    } catch (_) { return null; }
  }

  function extractChatFromAnchor(anchor) {
    if (!anchor) return null;
    const href = anchor.getAttribute('href') || anchor.href || '';
    const id = extractConversationId(href);
    if (!id) return null;
    const title = extractTitleFromAnchor(anchor) || 'Untitled chat';
    return { kind: 'chat', id, title, url: '/c/' + id };
  }

  function extractConversationId(href) {
    const m = String(href || '').match(/\/c\/([0-9a-fA-F-]{10,}|[^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function cleanConversationTitle(title) {
    return cleanText(title || '').slice(0, 200);
  }

  function cleanConversationAriaLabel(label) {
    const value = cleanText(label || '');
    const chinese = value.match(/^打开[“"]?(.+?)[”"]?的对话选项(?:.*)?$/);
    if (chinese) return cleanConversationTitle(chinese[1]);

    const englishFor = value.match(/^Open\s+(?:(?:conversation|chat)\s+)?options\s+for\s+[“"]?(.+?)[”"]?(?:[.!])?$/i);
    if (englishFor) return cleanConversationTitle(englishFor[1]);

    const english = value.match(/^Open(?:\s+[“"]?|[“"])(.+?)[”"]?(?:['’]s)?\s+(?:(?:conversation|chat)\s+)?options(?:[.!])?$/i);
    return english ? cleanConversationTitle(english[1]) : cleanConversationTitle(value);
  }

  function cleanDocumentConversationTitle(title) {
    return cleanConversationTitle(title)
      .replace(/\s*(?:[|｜·•]|[-–—])\s*ChatGPT\s*$/i, '')
      .trim()
      .slice(0, 200);
  }

  function extractTitleFromAnchor(anchor) {
    if (!anchor) return '';
    const clone = anchor.cloneNode(true);
    clone.querySelectorAll('[data-cgfm], button, svg, [aria-hidden="true"]').forEach(n => n.remove());
    const visibleText = cleanConversationTitle(clone.textContent || anchor.textContent || '');
    const ariaText = cleanConversationAriaLabel(anchor.getAttribute('aria-label') || '');
    // ChatGPT sometimes updates visible menu/sidebar text before aria-label, so prefer
    // visible text and use aria-label only as a fallback.
    return visibleText || ariaText;
  }

  function extractTitleFromCurrentPage(id) {
    try {
      const currentId = extractConversationId(location.pathname + location.search + location.hash);
      if (currentId !== id) return '';
      const title = cleanDocumentConversationTitle(document.title || '');
      if (!title || /^ChatGPT$/i.test(title)) return '';
      return title;
    } catch (_) { return ''; }
  }
  function normalizeStoredUrl(url) {
    const id = extractConversationId(url);
    return id ? '/c/' + id : String(url || '');
  }

  // ---------------------------------------------------------------------------
  // 8. Import / export and WebDAV remote-file helpers
  // ---------------------------------------------------------------------------

  function sanitizedRemoteProfile(p) {
    const copy = JSON.parse(JSON.stringify(p));
    delete copy.__cgfm;
    delete copy.__cgfmSync;
    Object.values(copy.folders || {}).forEach(folder => { if (folder) delete folder.collapsed; });
    if (copy.settings) {
      const ui = copy.settings.ui || {};
      copy.settings = {
        ui: {
          sidebarWidthEnabled: !!ui.sidebarWidthEnabled,
          sidebarWidthPx: clamp(Number(ui.sidebarWidthPx || DEFAULT_SIDEBAR_WIDTH_PX), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX)
        }
      };
    }
    return copy;
  }

  function exportPayload(p, revisionOverride, syncOverride) {
    const acct = currentAccount || getCurrentAccountInfo() || readLastAccountInfo() || { id: 'acct_default', label: 'ChatGPT account', email: '', accountId: '' };
    const revision = Math.max(1, Number(revisionOverride || 0) || (Number((p.settings.webdav || {}).remoteRevision || 0) + 1));
    const meta = ensureSyncMeta(p);
    const override = syncOverride || {};
    const operations = mergeOperationLists(override.operations || meta.operations || []).slice(-MAX_REMOTE_OPERATIONS);
    const tombstones = mergeTombstones(meta.tombstones, override.tombstones);
    return {
      app: APP_NAME,
      version: VERSION,
      schema: 3,
      exportedAt: nowIso(),
      account: {
        id: acct.id,
        accountId: acct.accountId || '',
        email: acct.email || '',
        key: accountStableKey(acct),
        label: acct.label || 'ChatGPT account'
      },
      sync: {
        model: 'operation-log-v1',
        revision,
        updatedAt: nowIso(),
        deviceId: DEVICE_ID,
        operations,
        tombstones
      },
      profile: sanitizedRemoteProfile(p)
    };
  }

  function exportJson() {
    const p = getProfile();
    const blob = new Blob([JSON.stringify(exportPayload(p), null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ChatGPT文件夹-' + (p.label || 'profile').replace(/[\\/:*?"<>|]+/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || '{}'));
          const profile = data.profile || data;
          if (!profile || !profile.folders || !profile.conversations) throw new Error('不是有效的文件夹配置。');
          const p = getProfile();
          const currentWebdav = JSON.parse(JSON.stringify(p.settings.webdav || {}));
          const currentSyncMeta = deepClone(ensureSyncMeta(p));
          const normalized = normalizeProfile(profile, p.id, p.label);
          normalized.id = p.id;
          normalized.label = p.label;
          normalized.settings.webdav = Object.assign({}, normalized.settings.webdav || {}, currentWebdav);
          normalized.__cgfmSync = currentSyncMeta;
          state = normalized;
          if (!state.folders[selectedFolderId]) selectedFolderId = ROOT_ID;
          queueRender();
          schedulePersist('import-json');
          toast('导入完成。');
        } catch (err) {
          toast('导入失败：' + safeError(err));
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }


  function sanitizeFilePart(value) {
    const base = String(value || 'acct_default').trim() || 'acct_default';
    return base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96) || 'acct_default';
  }

  function sanitizeEmailFilePart(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return '';
    return sanitizeFilePart(e.replace('@', '_at_').replace(/\./g, '_'));
  }

  function getWebdavAccountInfo() {
    const detected = getCurrentAccountInfo();
    if (detected && detected.id) {
      currentAccount = detected;
      rememberAccountInfo(detected);
      return detected;
    }
    return currentAccount || readLastAccountInfo() || { id: 'acct_default', label: 'ChatGPT account', email: '', accountId: '' };
  }

  function readRemoteFileMap() {
    try {
      const raw = gmGet(ACCOUNT_FILE_MAP_KEY, '{}');
      const map = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return map && typeof map === 'object' ? map : {};
    } catch (_) { return {}; }
  }

  function defaultWebdavFileName(acct) {
    const emailPart = sanitizeEmailFilePart(acct.email || '');
    const accountPart = acct.accountId ? sanitizeFilePart(String(acct.accountId).slice(0, 8)) : '';
    if (emailPart) return emailPart + (accountPart ? '-' + accountPart : '') + '.json';
    return sanitizeFilePart(acct.id || 'acct_default') + '.json';
  }

  function currentWebdavFileName() {
    const acct = currentAccount || getWebdavAccountInfo();
    const key = accountStableKey(acct);
    const map = readRemoteFileMap();
    if (map[key] && /\.json$/i.test(map[key])) return map[key];
    const fileName = defaultWebdavFileName(acct);
    map[key] = fileName;
    gmSet(ACCOUNT_FILE_MAP_KEY, JSON.stringify(map));
    return fileName;
  }

  function normalizeWebdavFolderUrl(raw) {
    let url = cleanText(raw || '');
    if (!url) return '';
    url = url.replace(/\\/g, '/');
    try {
      const u = new URL(url, location.href);
      if (/\.json$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/[^/]*\.json$/i, '/');
      u.search = '';
      u.hash = '';
      url = u.href;
    } catch (_) {
      url = url.replace(/\/[^/]*\.json(?:[?#].*)?$/i, '/');
    }
    return url.endsWith('/') ? url : url + '/';
  }

  function effectiveWebdavFileUrl(settings) {
    const folder = normalizeWebdavFolderUrl(settings && settings.url);
    return folder ? folder + currentWebdavFileName() : '';
  }

  function webdavFolderLabel(settings) {
    return normalizeWebdavFolderUrl(settings && settings.url) || '';
  }

  function isIgnorableMkcolError(err) {
    return err && (err.status === 405 || err.status === 409 || err.status === 301 || err.status === 302);
  }

  async function tryMkcol(folderUrl, settings) {
    if (!folderUrl) return;
    try { await davRequest('MKCOL', folderUrl, null, settings); }
    catch (err) { if (!isIgnorableMkcolError(err)) throw err; }
  }

  function responseHeader(res, name) {
    const raw = String((res && res.responseHeaders) || '');
    const match = raw.match(new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'im'));
    return match ? match[1].trim() : '';
  }

  function captureWebdavContext(settings) {
    const fileName = currentWebdavFileName();
    const folder = normalizeWebdavFolderUrl(settings && settings.url);
    return {
      generation: accountGeneration,
      accountKey: lockedAccountKey || accountStableKey(currentAccount),
      accountId: currentAccount && currentAccount.id || '',
      fileName,
      fileUrl: folder ? folder + fileName : '',
      target: folder ? folder + fileName : ''
    };
  }

  function assertWebdavContext(ctx) {
    if (!ctx || ctx.generation !== accountGeneration || ctx.accountKey !== lockedAccountKey) {
      const err = new Error('ChatGPT 账号已切换，已忽略旧账号的 WebDAV 响应。');
      err.isStaleAccount = true;
      throw err;
    }
  }

  function validateRemoteAccount(data, ctx) {
    const remote = data && data.account;
    if (!remote || typeof remote !== 'object') return;
    if (remote.key && String(remote.key) !== String(ctx.accountKey)) {
      throw new Error('远程 JSON 属于另一个 ChatGPT 账号，已停止同步。');
    }
    const live = currentAccount || {};
    if (remote.accountId && live.accountId && String(remote.accountId) !== String(live.accountId)) {
      throw new Error('远程 JSON 的 accountId 与当前 ChatGPT 账号不一致，已停止同步。');
    }
    if (!remote.key && remote.id && ctx.accountId && String(remote.id) !== String(ctx.accountId)) {
      throw new Error('远程 JSON 的账号标识与当前 ChatGPT 账号不一致，已停止同步。');
    }
  }

  function parseRemotePayload(res, ctx) {
    const data = JSON.parse((res && res.responseText) || '{}');
    validateRemoteAccount(data, ctx);
    return data;
  }

  async function putDavJson(settings, body, options, ctx) {
    const opts = Object.assign({ force: false, createOnly: false, ifMatch: '' }, options || {});
    const fileUrl = ctx && ctx.fileUrl || effectiveWebdavFileUrl(settings);
    if (!fileUrl) throw new Error('Missing WebDAV folder URL');
    const headers = { 'Content-Type': 'application/json;charset=utf-8' };
    if (opts.createOnly) headers['If-None-Match'] = '*';
    else if (!opts.force && opts.ifMatch) headers['If-Match'] = opts.ifMatch;
    try {
      return await davRequest('PUT', fileUrl, body, settings, headers);
    } catch (err) {
      if (err && err.status === 409) {
        await tryMkcol(webdavFolderLabel(settings), settings);
        return await davRequest('PUT', fileUrl, body, settings, headers);
      }
      if (err && (err.status === 412 || err.status === 409)) err.isConflict = true;
      throw err;
    }
  }

  async function getDavJson(settings, ctx) {
    const fileUrl = ctx && ctx.fileUrl || effectiveWebdavFileUrl(settings);
    if (!fileUrl) throw new Error('Missing WebDAV folder URL');
    return davRequest('GET', fileUrl, null, settings);
  }



  // ---------------------------------------------------------------------------
  // 9. Sidebar width, sync status and settings modal
  // ---------------------------------------------------------------------------

  function sidebarIsExpandedNow() {
    try { return officialSidebarExpanded(); }
    catch (_) { return true; }
  }

  function syncSidebarWidthClass(expandedOverride) {
    const p = getProfile();
    const enabled = !!((p.settings.ui || {}).sidebarWidthEnabled);
    const expanded = typeof expandedOverride === 'boolean' ? expandedOverride : sidebarIsExpandedNow();
    document.documentElement.classList.toggle('cgfm-sidebar-width-enabled', enabled);
    document.documentElement.classList.toggle('cgfm-sidebar-width-active', enabled && expanded);
    document.documentElement.classList.toggle('cgfm-official-sidebar-collapsed', !expanded);
  }
  function ensureSidebarWidthStyle(cssPx) {
    if (!sidebarWidthStyleEl) {
      sidebarWidthStyleEl = document.getElementById('cgfm-sidebar-width-style') || document.createElement('style');
      sidebarWidthStyleEl.id = 'cgfm-sidebar-width-style';
      document.head.appendChild(sidebarWidthStyleEl);
    }
    // Match ChatGPT's native markup: #stage-slideover-sidebar already has width: var(--sidebar-width),
    // and its inner panels already use w-(--sidebar-width). We only override the CSS variable while
    // the official sidebar is expanded. When it is collapsed, the class is removed and ChatGPT's own
    // tiny-bar/collapsed layout can reclaim the width.
    sidebarWidthStyleEl.textContent = `
      html.cgfm-sidebar-width-active body {
        --sidebar-width:${cssPx} !important;
      }
    `;
  }

  function applySidebarWidth(enabledOverride, pxOverride) {
    try {
      const p = getProfile();
      const ui = p.settings.ui || {};
      const hasOverride = arguments.length > 0;
      const enabled = hasOverride ? !!enabledOverride : !!ui.sidebarWidthEnabled;
      const px = clamp(Number(hasOverride ? pxOverride : (ui.sidebarWidthPx || DEFAULT_SIDEBAR_WIDTH_PX)), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX);
      if (!sidebarWidthStyleEl) {
        sidebarWidthStyleEl = document.getElementById('cgfm-sidebar-width-style') || document.createElement('style');
        sidebarWidthStyleEl.id = 'cgfm-sidebar-width-style';
        document.head.appendChild(sidebarWidthStyleEl);
      }

      // Clean up custom-property overrides left by older versions. Do not remove ChatGPT's native
      // inline width: var(--sidebar-width) from #stage-slideover-sidebar.
      document.documentElement.style.removeProperty('--sidebar-width');
      const stage = document.getElementById('stage-slideover-sidebar');
      if (stage) stage.style.removeProperty('--sidebar-width');

      if (!enabled) {
        sidebarWidthStyleEl.textContent = '';
        document.documentElement.classList.remove('cgfm-sidebar-width-enabled', 'cgfm-sidebar-width-active');
        return;
      }
      ensureSidebarWidthStyle(px + 'px');
      syncSidebarWidthClass();
    } catch (err) {
      console.warn(APP_NAME, 'apply sidebar width failed', err);
    }
  }

  function computeSyncStatus() {
    const w = getProfile().settings.webdav || {};
    if (!w.enabled || !normalizeWebdavFolderUrl(w.url)) return 'off';
    if (syncStatus === 'syncing') return syncStatus;
    if (w.conflict || syncStatus === 'error' || /failed|conflict/i.test(String(w.lastStatus || ''))) return 'error';
    if (dirtySincePush || w.pendingPush) return 'dirty';
    return 'idle';
  }

  function syncStatusTitle() {
    const w = getProfile().settings.webdav || {};
    const st = computeSyncStatus();
    if (st === 'off') return 'WebDAV：未启用；点击圆圈可在配置后立即同步';
    if (st === 'syncing') return 'WebDAV：正在读取、合并并校验云端数据';
    if (st === 'dirty') return 'WebDAV：有本地改动等待同步；点击立即同步';
    if (st === 'error') return 'WebDAV：同步失败' + (w.lastError ? '：' + w.lastError : '') + '；点击重试';
    const checked = w.lastRemoteCheckAt ? '，上次云端核对 ' + shortTime(w.lastRemoteCheckAt) : '';
    const merged = w.lastMergeAt ? '，上次合并 ' + shortTime(w.lastMergeAt) : '';
    return 'WebDAV：已与云端核对' + checked + merged + '；点击立即同步';
  }

  function setSyncStatus(status) {
    syncStatus = status || 'off';
    updateSyncStatusIcon();
  }

  function updateSyncStatusIcon() {
    const el = rootEl && rootEl.querySelector('[data-sync-status]');
    if (!el) return;
    const st = computeSyncStatus();
    el.className = 'cgfm-icon cgfm-sync-status cgfm-sync-' + st;
    const title = syncStatusTitle();
    el.title = title;
    el.setAttribute('aria-label', title);
  }

  function ensureSettingsModal() {
    if (modalEl && document.body.contains(modalEl)) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'cgfm-modal-backdrop';
    modalEl.className = 'cgfm-modal-backdrop';
    modalEl.hidden = true;
    modalEl.innerHTML = `
      <div class="cgfm-modal" role="dialog" aria-modal="true">
        <h2>WebDAV 多端同步</h2>
        <div class="cgfm-modal-row"><input id="cgfm-dav-enabled" type="checkbox"><span>本地修改后自动同步</span></div>
        <label for="cgfm-dav-url">WebDAV 文件夹地址</label><input id="cgfm-dav-url" type="text" placeholder="https://example.com/dav/chatgpt-folders">
        <label for="cgfm-dav-file">当前账号远程 JSON 文件名</label><input id="cgfm-dav-file" type="text" placeholder="account-name.json"><div style="margin:6px 0 8px;color:var(--text-secondary,#777);font-size:12px">仅影响当前 ChatGPT 账号；切换账号后会使用该账号自己的映射。</div>
        <label for="cgfm-dav-username">用户名</label><input id="cgfm-dav-username" type="text" autocomplete="username">
        <label for="cgfm-dav-password">密码 / 应用密码</label><input id="cgfm-dav-password" type="password" autocomplete="current-password">
        <label for="cgfm-dav-debounce">本地修改同步延迟（毫秒）</label><input id="cgfm-dav-debounce" type="number" min="1000" step="1000">
        <label for="cgfm-dav-interval">前台云端检查间隔（秒）</label><input id="cgfm-dav-interval" type="number" min="15" max="300" step="5">
        <hr style="border:0;border-top:1px solid rgba(128,128,128,.22);margin:14px 0">
        <h2>界面</h2>
        <div class="cgfm-modal-row"><input id="cgfm-sidebar-width-enabled" type="checkbox"><span>自定义左侧侧边栏宽度</span></div>
        <div class="cgfm-sidebar-width-grid"><input id="cgfm-sidebar-width-range" type="range" min="240" max="520" step="1"><span id="cgfm-sidebar-width-label" class="cgfm-sidebar-width-badge">312px</span></div>
        <p style="margin:10px 0 0;color:var(--text-secondary,#777)">多端同步：前台页面按设定间隔检查云端；点击状态圆圈或“立即同步”会立即读取、合并、上传并校验。折叠状态保留在各设备本地，避免无意义冲突。</p>
        <div class="cgfm-modal-actions">
          <button id="cgfm-dav-push" type="button">立即同步</button>
          <button id="cgfm-dav-pull" type="button">强制拉取</button>
          <button id="cgfm-dav-test" type="button">测试连接</button>
          <button id="cgfm-dav-cancel" class="cgfm-cancel-btn" type="button">取消</button>
          <button id="cgfm-dav-save" class="cgfm-primary-btn" type="button">保存</button>
        </div>
      </div>`;
    document.body.appendChild(modalEl);
    bindSettingsModalEvents();
    return modalEl;
  }

  function modalById(id) { return modalEl && modalEl.querySelector('#' + id); }

  function bindSettingsModalEvents() {
    const byId = modalById;
    const updateWidthLabel = () => {
      const px = clamp(Number(byId('cgfm-sidebar-width-range').value || DEFAULT_SIDEBAR_WIDTH_PX), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX);
      byId('cgfm-sidebar-width-label').textContent = px + 'px';
      return px;
    };
    const applyWidthFromControls = () => {
      const enabled = !!byId('cgfm-sidebar-width-enabled').checked;
      const px = updateWidthLabel();
      applySidebarWidth(enabled, px);
      settingsWidthPreviewApplied = true;
    };
    byId('cgfm-sidebar-width-range').addEventListener('input', updateWidthLabel);
    byId('cgfm-sidebar-width-range').addEventListener('change', applyWidthFromControls);
    byId('cgfm-sidebar-width-range').addEventListener('pointerup', applyWidthFromControls);
    byId('cgfm-sidebar-width-enabled').addEventListener('change', applyWidthFromControls);
    byId('cgfm-dav-url').addEventListener('input', () => {});
    byId('cgfm-dav-cancel').addEventListener('click', cancelSettingsModal);
    byId('cgfm-dav-save').addEventListener('click', saveSettingsModal);
    byId('cgfm-dav-push').addEventListener('click', () => runSettingsButton('cgfm-dav-push', () => webdavSync(true, 'settings-button')));
    byId('cgfm-dav-pull').addEventListener('click', () => runSettingsButton('cgfm-dav-pull', () => webdavPull(true)));
    byId('cgfm-dav-test').addEventListener('click', () => runSettingsButton('cgfm-dav-test', testWebdavFromModal));
    modalEl.addEventListener('click', event => { if (event.target === modalEl) cancelSettingsModal(); });
  }

  function fillSettingsModal() {
    ensureSettingsModal();
    const p = getProfile();
    const w = p.settings.webdav || {};
    const byId = modalById;
    byId('cgfm-dav-enabled').checked = !!w.enabled;
    byId('cgfm-dav-url').value = w.url ? normalizeWebdavFolderUrl(w.url).replace(/\/$/, '') : '';
    byId('cgfm-dav-file').value = currentWebdavFileName();
    byId('cgfm-dav-username').value = w.username || '';
    byId('cgfm-dav-password').value = w.password || '';
    byId('cgfm-dav-debounce').value = String(w.debounceMs || DEFAULT_DEBOUNCE_MS);
    byId('cgfm-dav-interval').value = String(Math.max(15, Math.round((w.remoteCheckMs || DEFAULT_REMOTE_CHECK_MS) / 1000)));
    const enabled = !!p.settings.ui.sidebarWidthEnabled;
    const px = clamp(Number(p.settings.ui.sidebarWidthPx || DEFAULT_SIDEBAR_WIDTH_PX), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX);
    settingsModalSnapshot = { sidebarWidthEnabled: enabled, sidebarWidthPx: px };
    settingsWidthPreviewApplied = false;
    byId('cgfm-sidebar-width-enabled').checked = enabled;
    byId('cgfm-sidebar-width-range').value = String(px);
    byId('cgfm-sidebar-width-label').textContent = px + 'px';
  }

  function showSettings() {
    fillSettingsModal();
    modalEl.hidden = false;
  }

  function cancelSettingsModal() {
    if (settingsWidthPreviewApplied && settingsModalSnapshot) applySidebarWidth(settingsModalSnapshot.sidebarWidthEnabled, settingsModalSnapshot.sidebarWidthPx);
    closeModal();
  }

  function saveSettingsModal() {
    const p = getProfile();
    const byId = modalById;
    const oldW = p.settings.webdav || {};
    const oldTarget = normalizeWebdavFolderUrl(oldW.url) + currentWebdavFileName();
    const w = Object.assign({}, oldW);
    w.enabled = !!byId('cgfm-dav-enabled').checked;
    w.url = byId('cgfm-dav-url').value.trim();
    w.username = byId('cgfm-dav-username').value;
    w.password = byId('cgfm-dav-password').value;
    w.debounceMs = Math.max(1000, Number(byId('cgfm-dav-debounce').value || DEFAULT_DEBOUNCE_MS));
    w.remoteCheckMs = clamp(Number(byId('cgfm-dav-interval').value || 30) * 1000, MIN_REMOTE_CHECK_MS, 5 * 60 * 1000);
    const requestedFile = sanitizeFilePart(String(byId('cgfm-dav-file').value || '').replace(/\.json$/i, '')) + '.json';
    const fileMap = readRemoteFileMap();
    fileMap[accountStableKey(currentAccount)] = requestedFile;
    gmSet(ACCOUNT_FILE_MAP_KEY, JSON.stringify(fileMap));
    const newTarget = normalizeWebdavFolderUrl(w.url) + requestedFile;
    const targetChanged = oldTarget !== newTarget;
    if (targetChanged) {
      w.remoteEtag = '';
      w.remoteRevision = 0;
      w.remoteInitialized = false;
      w.syncTarget = '';
      w.conflict = false;
      w.lastError = '';
      w.lastStatus = '';
      w.lastRemoteCheckAt = '';
      // A new/empty profile may safely initialize from remote. Existing local data must
      // be reviewed rather than silently replaced when the target changes.
      w.pendingPush = profileHasUserData(p);
      const meta = ensureSyncMeta(p);
      meta.baseRevision = 0;
      meta.baseProfile = null;
      meta.operations = [];
      meta.tombstones = { folders: {}, conversations: {} };
      mutationBaseline = syncProjection(p);
    }
    p.settings.webdav = w;
    p.settings.ui.sidebarWidthEnabled = !!byId('cgfm-sidebar-width-enabled').checked;
    p.settings.ui.sidebarWidthPx = clamp(Number(byId('cgfm-sidebar-width-range').value || DEFAULT_SIDEBAR_WIDTH_PX), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX);
    dirtySincePush = !!w.pendingPush;
    applySidebarWidth();
    restartPeriodicBackup();
    closeModal();
    updateSyncStatusIcon();
    // Saving connection details must not upload an empty profile before the first pull.
    setTimeout(() => {
      const syncSettings = !!(w.remoteInitialized && !targetChanged);
      schedulePersist('settings', { webdav: syncSettings, touch: true });
      if (!syncSettings) persistNow({ webdav: false });
      if (w.enabled && !w.pendingPush) setTimeout(() => checkRemoteUpdate(true, 'settings-save'), 300);
    }, 0);
    toast('设置已保存。');
  }

  async function runSettingsButton(buttonId, task) {
    const btn = modalById(buttonId);
    if (!btn || btn.disabled) return;
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '处理中…';
    try { await task(); }
    finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  async function testWebdavFromModal() {
    try {
      setSyncStatus('syncing');
      const tmp = { url: modalById('cgfm-dav-url').value.trim(), username: modalById('cgfm-dav-username').value, password: modalById('cgfm-dav-password').value };
      if (!normalizeWebdavFolderUrl(tmp.url)) throw new Error('Missing WebDAV folder URL');
      const requestedFile = sanitizeFilePart(String(modalById('cgfm-dav-file').value || '').replace(/\.json$/i, '')) + '.json';
      const folder = normalizeWebdavFolderUrl(tmp.url);
      const ctx = {
        generation: accountGeneration,
        accountKey: lockedAccountKey || accountStableKey(currentAccount),
        accountId: currentAccount && currentAccount.id || '',
        fileName: requestedFile,
        fileUrl: folder + requestedFile,
        target: folder + requestedFile
      };
      try {
        const res = await getDavJson(tmp, ctx);
        parseRemotePayload(res, ctx);
        setSyncStatus('idle');
        toast('测试成功：当前账号远程文件已存在且账号匹配。');
      } catch (err) {
        if (err && err.status === 404) {
          setSyncStatus('dirty');
          toast('连接成功，但当前账号远程文件尚未创建。');
          return;
        }
        throw err;
      }
    } catch (err) {
      setSyncStatus('error');
      toast('测试连接失败：' + safeError(err));
    }
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
    settingsModalSnapshot = null;
    settingsWidthPreviewApplied = false;
  }

  async function withWebdavOperation(name, task) {
    if (webdavOperation) throw new Error('另一个 WebDAV 操作正在进行：' + webdavOperation);
    webdavOperation = name;
    try { return await task(); }
    finally { webdavOperation = null; }
  }

  function remoteOperations(data) {
    return Array.isArray(((data || {}).sync || {}).operations) ? data.sync.operations.filter(Boolean) : [];
  }

  function prepareOperationsForRevision(operations, revision) {
    return mergeOperationLists(operations || []).map(op => Object.assign({}, op, {
      revision: Number(op.revision || 0) > 0 ? Number(op.revision) : Number(revision || 0)
    })).slice(-MAX_REMOTE_OPERATIONS);
  }

  function buildMergeResult(localProfile, remoteData) {
    const meta = ensureSyncMeta(localProfile);
    const remoteProfile = normalizeProfile(deepClone(remoteData.profile || remoteData), localProfile.id, localProfile.label);
    const remoteProjection = syncProjection(remoteProfile);
    const localProjection = syncProjection(localProfile);
    const remoteRevision = Number(((remoteData || {}).sync || {}).revision || 0);
    const baseRevision = Number(meta.baseRevision || (localProfile.settings.webdav || {}).remoteRevision || 0);
    const base = meta.baseProfile && meta.baseProfile.folders ? syncProjection(meta.baseProfile) : syncProjection(localProfile);

    let remoteOps = remoteOperations(remoteData).filter(op => Number(op.revision || 0) > baseRevision);
    const remoteFromOps = applyOperationsToProjection(base, remoteOps);
    if (stableStringify(remoteFromOps) !== stableStringify(remoteProjection)) {
      remoteOps = mergeOperationLists(remoteOps, deriveOperations(base, remoteProjection, 'remote-snapshot-diff', {
        at: ((remoteData.sync || {}).updatedAt) || nowIso(),
        deviceId: ((remoteData.sync || {}).deviceId) || 'remote',
        baseRevision,
        revision: remoteRevision
      }));
    }

    let localOps = mergeOperationLists(meta.operations || []);
    const localFromOps = applyOperationsToProjection(base, localOps);
    if (stableStringify(localFromOps) !== stableStringify(localProjection)) {
      localOps = mergeOperationLists(localOps, deriveOperations(base, localProjection, 'local-snapshot-diff', {
        deviceId: DEVICE_ID,
        baseRevision,
        revision: 0
      }));
    }

    const mergedOps = mergeOperationLists(remoteOps, localOps);
    const mergedProjection = applyOperationsToProjection(base, mergedOps);
    let mergedProfile = normalizeProfile(mergedProjection, localProfile.id, localProfile.label);
    mergedProfile = preserveLocalUiState(mergedProfile, localProfile);
    mergedProfile.settings.webdav = deepClone(localProfile.settings.webdav || {});
    mergedProfile.__cgfmSync = deepClone(meta);

    return {
      profile: mergedProfile,
      remoteRevision,
      baseRevision,
      localOperations: localOps,
      remoteOperations: remoteOps,
      allOperations: mergeOperationLists(remoteOperations(remoteData), localOps, remoteOps),
      tombstones: mergeTombstones(meta.tombstones, (remoteData.sync || {}).tombstones),
      summary: '本地操作 ' + localOps.length + ' 条，云端新操作 ' + remoteOps.length + ' 条'
    };
  }

  function adoptRemotePayload(data, res, ctx, options) {
    assertWebdavContext(ctx);
    const opts = options || {};
    const current = getProfile();
    const currentWebdav = deepClone(current.settings.webdav || {});
    let normalized = normalizeProfile(deepClone(data.profile || data), current.id, current.label);
    normalized = preserveLocalUiState(normalized, current);
    normalized.settings.webdav = Object.assign({}, currentWebdav, {
      remoteEtag: responseHeader(res, 'ETag') || '',
      remoteRevision: Number((data.sync || {}).revision || 0),
      remoteInitialized: true,
      syncTarget: ctx.target,
      pendingPush: false,
      lastPullAt: opts.wasPull ? nowIso() : (currentWebdav.lastPullAt || ''),
      lastPushAt: opts.wasPush ? nowIso() : (currentWebdav.lastPushAt || ''),
      lastRemoteCheckAt: nowIso(),
      lastStatus: opts.status || 'sync OK at ' + shortTime(nowIso()),
      lastError: '',
      conflict: false,
      lastMergeAt: opts.wasMerge ? nowIso() : (currentWebdav.lastMergeAt || ''),
      lastMergeSummary: opts.mergeSummary || (currentWebdav.lastMergeSummary || '')
    });
    const meta = ensureSyncMeta(normalized);
    meta.baseRevision = Number((data.sync || {}).revision || 0);
    meta.baseProfile = syncProjection(normalized);
    meta.operations = [];
    meta.tombstones = mergeTombstones((data.sync || {}).tombstones);
    state = normalized;
    mutationBaseline = syncProjection(state);
    if (!state.folders[selectedFolderId]) selectedFolderId = ROOT_ID;
    dirtySincePush = false;
    localUnsavedChanges = false;
    setSyncStatus('idle');
    queueRender();
    applySidebarWidth();
    restartPeriodicBackup();
    schedulePersist('webdav-adopt-remote', { webdav: false, touch: false });
    return true;
  }

  async function guardedPut(settings, ctx, beforeRes, body, attempt) {
    const etag = responseHeader(beforeRes, 'ETag');
    if (etag) {
      try {
        return await putDavJson(settings, body, { ifMatch: etag }, ctx);
      } catch (err) {
        if (!(err && err.status === 412)) throw err;
        const recheck = await getDavJson(settings, ctx);
        assertWebdavContext(ctx);
        if (String(recheck.responseText || '') !== String(beforeRes.responseText || '')) throw err;
        if (attempt < 2) throw err;
        // Some Nextcloud/proxy combinations reject a freshly read ETag even when the
        // file is byte-for-byte unchanged. Only after a confirming GET is an
        // unconditional compatibility retry allowed.
        return putDavJson(settings, body, { force: true }, ctx);
      }
    }
    const recheck = await getDavJson(settings, ctx);
    assertWebdavContext(ctx);
    if (String(recheck.responseText || '') !== String(beforeRes.responseText || '')) {
      const err = new Error('上传前云端文件发生变化，正在重新合并。');
      err.status = 412;
      err.isConflict = true;
      throw err;
    }
    if (attempt < 2) {
      const err = new Error('服务器 GET 响应缺少 ETag，重新读取后再尝试。');
      err.status = 412;
      err.isConflict = true;
      throw err;
    }
    return putDavJson(settings, body, { force: true }, ctx);
  }

  async function webdavSync(manual, reason) {
    const p = getProfile();
    const w = p.settings.webdav || {};
    if (!w.enabled || !normalizeWebdavFolderUrl(w.url)) {
      if (manual) toast('请先在设置中启用并配置 WebDAV。');
      return;
    }
    if (webdavOperation) {
      if (manual) toast('WebDAV 正在进行其他操作，请稍后再点一次。');
      return;
    }
    if (localUnsavedChanges || pendingPersistTimer) persistNow({ webdav: false });
    captureSyncOperations(reason || 'sync');
    const ctx = captureWebdavContext(w);
    try {
      await withWebdavOperation('sync', async () => {
        setSyncStatus('syncing');
        w.lastStatus = 'syncing';
        for (let attempt = 0; attempt < 3; attempt++) {
          assertWebdavContext(ctx);
          let remoteRes;
          let remoteData;
          try {
            remoteRes = await getDavJson(w, ctx);
            assertWebdavContext(ctx);
            remoteData = parseRemotePayload(remoteRes, ctx);
          } catch (err) {
            if (!(err && err.status === 404)) throw err;
            const meta = ensureSyncMeta(p);
            const initialOps = meta.operations.length ? meta.operations : deriveOperations(emptySyncProjection(p.label), syncProjection(p), 'initialize-remote', { baseRevision: 0, deviceId: DEVICE_ID });
            const revision = 1;
            const operations = prepareOperationsForRevision(initialOps, revision);
            const payload = exportPayload(p, revision, { operations, tombstones: meta.tombstones });
            await putDavJson(w, JSON.stringify(payload, null, 2), { createOnly: true }, ctx);
            const verify = await getDavJson(w, ctx);
            const verified = parseRemotePayload(verify, ctx);
            adoptRemotePayload(verified, verify, ctx, { wasPush: true, status: 'created and synced at ' + shortTime(nowIso()) });
            if (manual) toast('已创建远程文件并完成同步。');
            return;
          }

          const remoteRevision = Number((remoteData.sync || {}).revision || 0);
          const meta = ensureSyncMeta(p);
          const baseRevision = Number(meta.baseRevision || w.remoteRevision || 0);
          const remoteProjection = syncProjection(remoteData.profile || remoteData);
          const baseProjection = meta.baseProfile && meta.baseProfile.folders ? syncProjection(meta.baseProfile) : null;
          const remoteContentChanged = !baseProjection || stableStringify(remoteProjection) !== stableStringify(baseProjection);
          const localDirty = localHasSyncChanges(p);

          if (!w.remoteInitialized || w.syncTarget !== ctx.target || !meta.baseProfile) {
            if (!profileHasUserData(p) && !localDirty) {
              adoptRemotePayload(remoteData, remoteRes, ctx, { wasPull: true, status: 'initialized from remote at ' + shortTime(nowIso()) });
              if (manual) toast('已从云端初始化当前设备。');
              return;
            }
            const err = new Error('本地已有数据但尚未建立当前远端基线；请先导出本地备份，再使用“强制拉取”或重新初始化。');
            err.isConflict = true;
            throw err;
          }

          if (!localDirty && remoteRevision === baseRevision && !remoteContentChanged) {
            w.remoteEtag = responseHeader(remoteRes, 'ETag') || '';
            w.lastRemoteCheckAt = nowIso();
            w.lastStatus = 'verified at ' + shortTime(w.lastRemoteCheckAt);
            w.lastError = '';
            w.conflict = false;
            setSyncStatus('idle');
            schedulePersist('webdav-verified', { webdav: false, touch: false });
            if (manual) toast('已与云端核对，内容一致。');
            return;
          }

          if (!localDirty && (remoteRevision !== baseRevision || remoteContentChanged)) {
            adoptRemotePayload(remoteData, remoteRes, ctx, { wasPull: true, status: 'auto pull at ' + shortTime(nowIso()) });
            if (manual) toast('已下载并应用云端更新。');
            return;
          }

          const merge = buildMergeResult(p, remoteData);
          const nextRevision = Math.max(remoteRevision, baseRevision) + 1;
          const operations = prepareOperationsForRevision(merge.allOperations, nextRevision);
          const payload = exportPayload(merge.profile, nextRevision, { operations, tombstones: merge.tombstones });
          const body = JSON.stringify(payload, null, 2);
          try {
            await guardedPut(w, ctx, remoteRes, body, attempt);
          } catch (err) {
            if (err && err.status === 412 && attempt < 2) continue;
            throw err;
          }

          const verify = await getDavJson(w, ctx);
          assertWebdavContext(ctx);
          const verified = parseRemotePayload(verify, ctx);
          const verifiedSync = verified.sync || {};
          if (Number(verifiedSync.revision || 0) !== nextRevision || String(verifiedSync.deviceId || '') !== DEVICE_ID) {
            if (attempt < 2) continue;
            throw new Error('同步写入后的远程校验失败。');
          }
          adoptRemotePayload(verified, verify, ctx, {
            wasPush: true,
            wasMerge: remoteRevision !== baseRevision,
            mergeSummary: merge.summary,
            status: (remoteRevision !== baseRevision ? 'merged and synced at ' : 'pushed at ') + shortTime(nowIso())
          });
          if (manual) toast(remoteRevision !== baseRevision ? '已合并本地与云端修改并完成同步。' : '本地修改已同步到云端。');
          return;
        }
        throw new Error('云端持续变化，三次合并重试仍未完成；请稍后再次同步。');
      });
    } catch (err) {
      if (err && err.isStaleAccount) return;
      const current = getProfile();
      const currentW = current.settings.webdav || {};
      currentW.lastError = safeError(err);
      currentW.lastStatus = 'sync failed';
      currentW.conflict = !!(err && err.isConflict);
      currentW.pendingPush = localHasSyncChanges(current);
      dirtySincePush = !!currentW.pendingPush;
      setSyncStatus('error');
      schedulePersist('webdav-sync-fail', { webdav: false, touch: false });
      if (manual) toast('WebDAV 同步失败：' + currentW.lastError);
      else console.warn(APP_NAME, 'WebDAV sync failed:', reason || '', err);
    }
  }

  async function webdavPush(manual) {
    return webdavSync(!!manual, 'push-compat');
  }

  async function webdavPull(manual) {
    const p = getProfile();
    const w = p.settings.webdav || {};
    if (!normalizeWebdavFolderUrl(w.url)) { if (manual) toast('请先填写 WebDAV 文件夹地址。'); return; }
    if (webdavOperation) { if (manual) toast('另一个 WebDAV 操作正在进行。'); return; }
    if (localUnsavedChanges || pendingPersistTimer) persistNow({ webdav: false });
    if (manual && localHasSyncChanges(p) && !confirm('强制拉取会放弃当前设备尚未同步的修改。确定继续吗？')) return;
    const ctx = captureWebdavContext(w);
    try {
      await withWebdavOperation('pull', async () => {
        setSyncStatus('syncing');
        const res = await getDavJson(w, ctx);
        const data = parseRemotePayload(res, ctx);
        adoptRemotePayload(data, res, ctx, { wasPull: true, status: 'forced pull at ' + shortTime(nowIso()) });
        if (manual) toast('已强制拉取云端数据。');
      });
    } catch (err) {
      if (err && err.isStaleAccount) return;
      w.lastError = safeError(err);
      w.lastStatus = 'pull failed';
      setSyncStatus('error');
      schedulePersist('webdav-pull-fail', { webdav: false, touch: false });
      if (manual) toast('WebDAV 拉取失败：' + w.lastError);
    }
  }

  async function checkRemoteUpdate(showToast, reason) {
    const w = getProfile().settings.webdav || {};
    if (!w.enabled || !normalizeWebdavFolderUrl(w.url) || webdavOperation || document.hidden) return;
    if (Date.now() - lastRemoteCheckAt < 10000) return;
    lastRemoteCheckAt = Date.now();
    await webdavSync(!!showToast, reason || 'remote-check');
  }

  // ---------------------------------------------------------------------------
  // 10. WebDAV network operations and deferred backup scheduling
  // ---------------------------------------------------------------------------

  function scheduleAutoBackup(reason) {
    const p = getProfile();
    const w = p.settings.webdav || {};
    if (!w.enabled || !normalizeWebdavFolderUrl(w.url)) { updateSyncStatusIcon(); return; }
    if (pendingWebdavTimer) clearTimeout(pendingWebdavTimer);
    const delay = Math.max(3000, Number(w.debounceMs || DEFAULT_DEBOUNCE_MS));
    pendingWebdavTimer = setTimeout(() => {
      pendingWebdavTimer = null;
      if (!document.hidden && localHasSyncChanges(getProfile())) webdavSync(false, reason || 'auto-local-change');
    }, delay);
  }

  function restartPeriodicBackup() {
    if (periodicWebdavTimer) clearInterval(periodicWebdavTimer);
    periodicWebdavTimer = null;
    const w = getProfile().settings.webdav || {};
    if (!w.enabled || !normalizeWebdavFolderUrl(w.url)) return;
    const interval = clamp(Number(w.remoteCheckMs || DEFAULT_REMOTE_CHECK_MS), MIN_REMOTE_CHECK_MS, 5 * 60 * 1000);
    periodicWebdavTimer = setInterval(() => {
      if (!document.hidden) checkRemoteUpdate(false, 'foreground-interval');
    }, interval);
  }

  function davRequest(method, url, body, settings, extraHeaders) {
    return new Promise((resolve, reject) => {
      const headers = Object.assign({}, extraHeaders || {});
      if (settings && settings.username) headers.Authorization = 'Basic ' + base64(settings.username + ':' + (settings.password || ''));
      const details = {
        method, url, data: body || undefined, headers, timeout: 30000,
        user: settings && settings.username ? settings.username : undefined,
        password: settings && settings.username ? (settings.password || '') : undefined,
        onload: res => {
          if (res.status >= 200 && res.status < 300) resolve(res);
          else {
            const err = new Error(method + ' failed with HTTP ' + res.status + ' ' + (res.statusText || ''));
            err.status = res.status;
            err.statusText = res.statusText || '';
            err.responseText = res.responseText || '';
            err.responseHeaders = res.responseHeaders || '';
            reject(err);
          }
        },
        onerror: err => reject(new Error('Network error' + (err && err.error ? ': ' + err.error : ''))),
        ontimeout: () => reject(new Error('Request timed out'))
      };
      try {
        if (typeof GM_xmlhttpRequest === 'function') GM_xmlhttpRequest(details);
        else if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') GM.xmlHttpRequest(details).catch(reject);
        else reject(new Error('当前油猴扩展不支持 GM_xmlhttpRequest'));
      } catch (err) { reject(err); }
    });
  }

  function base64(str) { return btoa(unescape(encodeURIComponent(str))); }

  // ---------------------------------------------------------------------------
  // 10b. Same-browser multi-tab synchronization
  // ---------------------------------------------------------------------------

  function setupCrossTabStorageSync() {
    const revisionKey = activeRevisionStorageKey();
    if (storageSyncBound && storageSyncListenerKey === revisionKey) return;
    teardownCrossTabStorageSync();
    storageSyncBound = true;
    storageSyncListenerKey = revisionKey;
    const current = currentStorageRevisionInfo();
    if (current.revision) lastSeenStorageRevision = current.revision;

    if (typeof GM_addValueChangeListener !== 'function') {
      console.info(APP_NAME, 'GM_addValueChangeListener is unavailable; multi-tab sync disabled.');
      return;
    }

    try {
      storageSyncListenerId = GM_addValueChangeListener(revisionKey, (_key, _oldValue, newValue, remote) => {
        if (!remote || revisionKey !== activeRevisionStorageKey()) return;
        const meta = parseRevisionMeta(newValue);
        const rev = meta.revision;
        const writer = meta.writer;
        if (!rev || writer === TAB_ID || !isRevisionNewer(rev, lastSeenStorageRevision)) return;
        if (crossTabApplyTimer) clearTimeout(crossTabApplyTimer);
        crossTabApplyTimer = setTimeout(() => {
          crossTabApplyTimer = null;
          maybeApplyNewerStoredProfile('external-change');
        }, 300);
      });
    } catch (err) {
      storageSyncListenerId = null;
      console.warn(APP_NAME, 'GM_addValueChangeListener failed; multi-tab sync disabled.', err);
    }
  }

  // ---------------------------------------------------------------------------
  // 11. Low-cost remount checks and boot
  // ---------------------------------------------------------------------------

  function toast(message) {
    const old = document.querySelector('.cgfm-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'cgfm-toast';
    el.textContent = String(message || '');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function isVisibleElement(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && el.getClientRects().length > 0;
    } catch (_) {
      return false;
    }
  }

  function nativeSidebarContentVisible() {
    try {
      const sidebar = document.getElementById('stage-slideover-sidebar') || document;
      const history = document.getElementById('history');
      if (history && !history.closest('[inert]') && isVisibleElement(history)) return true;

      // Keep this check intentionally narrow. Do not querySelectorAll() every chat link:
      // sidebar open/close and sleep-resume checks should not scan the whole Recent list.
      const closeBtn = sidebar.querySelector('[data-testid="close-sidebar-button"]');
      if (closeBtn && !closeBtn.closest('[inert]') && isVisibleElement(closeBtn)) return true;

      const oneNativeChat = sidebar.querySelector('a[href^="/c/"], a[href*="/c/"]');
      if (oneNativeChat && !(rootEl && rootEl.contains(oneNativeChat)) && !oneNativeChat.closest('[inert]') && isVisibleElement(oneNativeChat)) return true;
    } catch (_) {}
    return false;
  }

  function officialSidebarExpanded() {
    const sidebar = document.getElementById('stage-slideover-sidebar');
    if (!sidebar) return true;

    // After Windows/Firefox sleep restore, ChatGPT can briefly show tiny-bar remnants
    // while the expanded history area is already visible. Prefer visible native history
    // content / close button over the tiny-bar signal to avoid keeping our root hidden.
    if (nativeSidebarContentVisible()) return true;

    const closeBtn = sidebar.querySelector('[data-testid="close-sidebar-button"]');
    if (closeBtn && closeBtn.getAttribute('aria-expanded') === 'true' && isVisibleElement(closeBtn)) return true;

    const tiny = document.getElementById('stage-sidebar-tiny-bar');
    if (tiny && !tiny.hasAttribute('inert') && isVisibleElement(tiny)) return false;

    const openBtn = sidebar.querySelector('button[aria-label*="打开边栏"],button[aria-label*="Open sidebar"],button[aria-label*="open sidebar"]');
    if (openBtn && !openBtn.closest('[inert]') && isVisibleElement(openBtn) && openBtn.getAttribute('aria-expanded') === 'false') return false;
    return true;
  }

  function syncSidebarVisibility() {
    const expanded = officialSidebarExpanded();
    if (rootEl) rootEl.hidden = !expanded;
    syncSidebarWidthClass(expanded);
  }

  function scheduleSidebarVisibilityCheck() {
    // Debounce sidebar animation checks. Firefox may emit multiple resize/click-related
    // events during ChatGPT's sidebar transition; avoid accumulating timer storms.
    sidebarVisibilityTimers.forEach(timer => clearTimeout(timer));
    sidebarVisibilityTimers = [80, 220, 500, 900].map(delay => setTimeout(() => {
      try { syncSidebarVisibility(); }
      finally { /* timers are cleared/replaced on the next schedule */ }
    }, delay));
  }

  function scheduleResumeRecovery(reason) {
    // Sleep / tab restore is not a full page load, so Tampermonkey does not rerun boot().
    // Run a short, sparse self-healing window after focus/pageshow/visibilitychange.
    // No long-running observer, no interval, and each check is the same lightweight mount check.
    resumeRecoveryTimers.forEach(timer => clearTimeout(timer));
    resumeRecoveryTimers = [];
    [0, 200, 800, 2000, 5000, 10000, 15000].forEach(delay => {
      const timer = setTimeout(() => {
        try {
          maybeApplyNewerStoredProfile('resume-' + reason);
          ensureMountedLight();
        }
        finally {
          resumeRecoveryTimers = resumeRecoveryTimers.filter(t => t !== timer);
        }
      }, delay);
      resumeRecoveryTimers.push(timer);
    });
  }

  function bindSidebarToggleWatcher() {
    if (sidebarToggleBound) return;
    sidebarToggleBound = true;
    document.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[aria-controls="stage-slideover-sidebar"], [data-testid="close-sidebar-button"]')) scheduleSidebarVisibilityCheck();
    }, true);
    window.addEventListener('resize', scheduleSidebarVisibilityCheck, { passive: true });
  }

  function ensureMountedLight() {
    try {
      const beforeAccount = currentAccount && currentAccount.id;
      ensureActiveProfile();
      const afterAccount = currentAccount && currentAccount.id;
      const recent = findHistorySection();
      const expectedParent = (recent && recent.parentElement) || findSidebarParent();
      const rootMissing = !rootEl || !document.body.contains(rootEl);
      const parentChanged = !!(rootEl && isSafeMountParent(expectedParent) && rootEl.parentElement !== expectedParent);

      if (rootMissing || parentChanged) mount();
      else {
        setupNativeDragCache();
        setupNativeMenuHook();
        applySidebarWidth();
        syncSidebarVisibility();
        // If sleep restore left the root hidden while the native history area is visible,
        // unhide it after syncSidebarVisibility has had a chance to update width classes.
        if (rootEl && rootEl.hidden && nativeSidebarContentVisible()) rootEl.hidden = false;
        if (beforeAccount && afterAccount && beforeAccount !== afterAccount) queueRender();
      }
    } catch (err) {
      console.warn(APP_NAME, 'ensure mount failed', err);
    }
  }

  function boot() {
    try {
      ensureActiveProfile();
      ensureSyncMeta(state);
      mutationBaseline = syncProjection(state);
      dirtySincePush = !!(((state || {}).settings || {}).webdav || {}).pendingPush;
      lastSeenStorageRevision = currentStorageRevisionInfo().revision || getProfileStorageRevision(state);
      lastSeenStorageProjection = storageBusinessProjectionKey(state);
      setupCrossTabStorageSync();
      bindSidebarToggleWatcher();
      // Sparse finite remount checks. The first successful mount additionally requires the
      // same native sidebar host to stay connected for a short stability window, so we do not
      // inject into React-managed DOM while hydration is still replacing the sidebar. Later
      // remounts stay immediate. There is no long-running observer.
      [700, 1500, 2800, 4800, 8000, 13000, 21000, 34000, 55000, 90000].forEach(delay => setTimeout(ensureMountedLight, delay));
      const idle = window.requestIdleCallback || (fn => setTimeout(fn, 3500));
      idle(() => { try { if (mounted) ensureSettingsModal(); } catch (_) {} });
      restartPeriodicBackup();
      setTimeout(() => checkRemoteUpdate(false, 'boot'), 1800);
      window.addEventListener('beforeunload', () => { flushPendingPersist(false); teardownCrossTabStorageSync(); });
      window.addEventListener('pagehide', () => flushPendingPersist(false));
      window.addEventListener('focus', () => { scheduleResumeRecovery('focus'); setTimeout(() => checkRemoteUpdate(false, 'focus'), 500); }, { passive: true });
      window.addEventListener('pageshow', () => { scheduleResumeRecovery('pageshow'); setTimeout(() => checkRemoteUpdate(false, 'pageshow'), 700); }, { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) flushPendingPersist(false);
        else { scheduleResumeRecovery('visibilitychange'); setTimeout(() => checkRemoteUpdate(false, 'visibilitychange'), 700); }
      }, { passive: true });
    } catch (err) {
      console.error(APP_NAME, 'boot failed', err);
    }
  }

  boot();
})();

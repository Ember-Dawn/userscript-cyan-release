// ==UserScript==
// @name         NocoDB 文件夹
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-folders.user.js
// @version      11.2.0
// @description  NocoDB folder tree with draft-safe editing, verified WebDAV conflict detection, live feedback, and daily snapshots
// @author       Cyan
// @match        *://nocodb.380782744.xyz/*
// @match        *://*/dashboard/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    if (window.__NDF_SCRIPT_INITIALIZED__) {
        console.info('[NocoDB Folder] Script already initialized; duplicate bootstrap skipped.');
        return;
    }
    window.__NDF_SCRIPT_INITIALIZED__ = true;

    const SCRIPT_VERSION = '11.2.0';
    const STORAGE_KEY = 'nc_folder_config_v9';
    const SYNC_STATE_KEY = 'nc_folder_sync_state_v11';
    const CONFLICT_KEY = 'nc_folder_sync_conflict_v11';
    const MAX_FOLDER_NAME_LENGTH = 120;
    const PUSH_DEBOUNCE_MS = 2000;
    const POLL_INTERVAL_MS = 30000;
    const MIN_REMOTE_CHECK_INTERVAL_MS = 5000;
    const REQUEST_TIMEOUT_MS = 20000;
    const DAILY_BACKUP_RETENTION_DAYS = 14;
    const VALIDATORLESS_GET_INTERVAL_MS = 5 * 60 * 1000;

    console.log(`--- [NocoDB Folder] V${SCRIPT_VERSION} started ---`);

    const defaultSettings = {
        spacing: 0,
        indent: 20,
        tableOffset: 0,
        enableTableOffset: false,
        clickDelay: 0,
        webdav: { enabled: false, url: '', user: '', pass: '' },
        bases: {}
    };

    const HTML_ESCAPE_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char]);
    const normalizeString = value => typeof value === 'string' ? value.trim() : '';
    const asInt = (value, fallback = 0) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    const clampInt = (value, min, max, fallback = 0) => Math.min(max, Math.max(min, asInt(value, fallback)));
    const deepClone = value => JSON.parse(JSON.stringify(value));

    const sanitizeFolderName = (name, fallback = 'Untitled Folder') => {
        const cleaned = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME_LENGTH);
        return cleaned || fallback;
    };

    const sanitizeColor = color => {
        const normalized = normalizeString(color);
        return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)
            ? normalized.toUpperCase()
            : '';
    };

    const generateId = () => `f_${window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

    const generateDeviceId = () => `device_${window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`}`;

    const stableStringify = value => {
        const seen = new WeakSet();
        const sortValue = input => {
            if (input === null || typeof input !== 'object') return input;
            if (seen.has(input)) throw new TypeError('Circular structure cannot be serialized.');
            seen.add(input);
            if (Array.isArray(input)) return input.map(sortValue);
            const sorted = {};
            Object.keys(input).sort().forEach(key => {
                sorted[key] = sortValue(input[key]);
            });
            return sorted;
        };
        return JSON.stringify(sortValue(value));
    };

    // Fast non-cryptographic content fingerprint. ETag/If-Match remains the real concurrency guard.
    const hashString = text => {
        let h1 = 0x811c9dc5;
        let h2 = 0x9e3779b9;
        for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= code + index;
            h2 = Math.imul(h2, 0x85ebca6b);
        }
        return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
    };

    const getBaseId = () => {
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2) return pathParts[1];
        const hashParts = window.location.hash.split('/').filter(Boolean);
        if (hashParts.length >= 2) return hashParts[1];
        return 'default_base';
    };

    const normalizeBaseState = input => {
        const rawFolders = Array.isArray(input?.folders) ? input.folders : [];
        const folders = [];
        const folderById = new Map();

        rawFolders.forEach(rawFolder => {
            let id = normalizeString(rawFolder?.id) || generateId();
            if (folderById.has(id)) id = generateId();
            const folder = {
                id,
                name: sanitizeFolderName(rawFolder?.name, 'Untitled Folder'),
                parentId: normalizeString(rawFolder?.parentId) || null,
                color: sanitizeColor(rawFolder?.color)
            };
            folders.push(folder);
            folderById.set(id, folder);
        });

        folders.forEach(folder => {
            if (!folder.parentId || !folderById.has(folder.parentId) || folder.parentId === folder.id) {
                folder.parentId = null;
            }
        });

        const parentByFolderId = new Map(folders.map(folder => [folder.id, folder.parentId || null]));
        const wouldCreateCycle = (folderId, parentId) => {
            let current = parentId;
            const seen = new Set([folderId]);
            while (current) {
                if (seen.has(current)) return true;
                seen.add(current);
                current = parentByFolderId.get(current) || null;
            }
            return false;
        };

        folders.forEach(folder => {
            if (folder.parentId && wouldCreateCycle(folder.id, folder.parentId)) folder.parentId = null;
        });

        const folderIdSet = new Set(folders.map(folder => folder.id));
        const map = {};
        if (input?.map && typeof input.map === 'object') {
            Object.entries(input.map).forEach(([tableId, folderId]) => {
                if (typeof tableId !== 'string' || !tableId) return;
                if (typeof folderId === 'string' && folderIdSet.has(folderId)) map[tableId] = folderId;
            });
        }

        const collapsed = {};
        if (input?.collapsed && typeof input.collapsed === 'object') {
            Object.entries(input.collapsed).forEach(([folderId, value]) => {
                if (folderIdSet.has(folderId) && Boolean(value)) collapsed[folderId] = true;
            });
        }

        return { folders, map, collapsed };
    };

    const normalizeConfig = rawConfig => {
        const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const normalized = { ...defaultSettings, ...source };
        normalized.spacing = clampInt(normalized.spacing, -12, 12, defaultSettings.spacing);
        normalized.indent = clampInt(normalized.indent, 8, 32, defaultSettings.indent);
        normalized.tableOffset = clampInt(normalized.tableOffset, -10, 10, defaultSettings.tableOffset);
        normalized.enableTableOffset = Boolean(normalized.enableTableOffset);
        normalized.clickDelay = clampInt(normalized.clickDelay, 0, 500, defaultSettings.clickDelay);
        normalized.webdav = {
            enabled: Boolean(source.webdav?.enabled),
            url: normalizeString(source.webdav?.url),
            user: normalizeString(source.webdav?.user),
            pass: normalizeString(source.webdav?.pass)
        };
        normalized.bases = {};

        if (source.bases && typeof source.bases === 'object') {
            Object.entries(source.bases).forEach(([baseId, baseState]) => {
                const safeBaseId = normalizeString(baseId);
                if (safeBaseId) normalized.bases[safeBaseId] = normalizeBaseState(baseState);
            });
        } else if (Array.isArray(source.folders) || (source.map && typeof source.map === 'object')) {
            normalized.bases.default_base = normalizeBaseState(source);
        }

        return normalized;
    };

    const loadStoredJson = (key, fallback) => {
        try {
            const raw = GM_getValue(key);
            if (raw === undefined || raw === null || raw === '') return fallback;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (error) {
            console.warn(`[NocoDB Folder] Failed to parse ${key}:`, error);
            return fallback;
        }
    };

    let config = normalizeConfig(defaultSettings);
    const storedConfig = loadStoredJson(STORAGE_KEY, null);
    if (storedConfig) {
        const migrated = { ...config, ...storedConfig };
        if (storedConfig.webdav) migrated.webdav = { ...defaultSettings.webdav, ...storedConfig.webdav };
        if (typeof storedConfig.enableTableOffset === 'undefined' && typeof storedConfig.tableOffset !== 'undefined') {
            migrated.enableTableOffset = false;
            migrated.tableOffset = asInt(storedConfig.tableOffset, 0) + 11;
        }
        config = normalizeConfig(migrated);
    }

    const defaultSyncState = {
        deviceId: '',
        remoteEtag: '',
        remoteLastModified: '',
        remoteSize: '',
        remoteExists: null,
        remoteContentHash: '',
        pendingHash: '',
        autoSyncArmed: false,
        lastCheckAt: 0,
        lastPushAt: 0,
        lastPullAt: 0,
        lastSuccessAt: 0,
        lastContentCheckAt: 0,
        lastDailyBackupDate: '',
        lastBackupCleanupDate: '',
        status: 'idle',
        message: ''
    };

    const normalizeSyncState = raw => {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            ...defaultSyncState,
            ...source,
            deviceId: normalizeString(source.deviceId) || generateDeviceId(),
            remoteEtag: normalizeString(source.remoteEtag),
            remoteLastModified: normalizeString(source.remoteLastModified),
            remoteSize: normalizeString(source.remoteSize),
            remoteContentHash: normalizeString(source.remoteContentHash),
            pendingHash: normalizeString(source.pendingHash),
            autoSyncArmed: Boolean(source.autoSyncArmed),
            lastCheckAt: Number(source.lastCheckAt) || 0,
            lastPushAt: Number(source.lastPushAt) || 0,
            lastPullAt: Number(source.lastPullAt) || 0,
            lastSuccessAt: Number(source.lastSuccessAt) || 0,
            lastContentCheckAt: Number(source.lastContentCheckAt) || 0,
            status: normalizeString(source.status) || 'idle',
            message: normalizeString(source.message)
        };
    };

    const storedSyncState = loadStoredJson(SYNC_STATE_KEY, defaultSyncState);
    let syncState = normalizeSyncState(storedSyncState);
    if (typeof storedSyncState?.autoSyncArmed === 'undefined') {
        syncState.autoSyncArmed = Boolean(
            syncState.remoteContentHash ||
            syncState.remoteEtag ||
            syncState.remoteLastModified ||
            syncState.remoteSize ||
            syncState.remoteExists !== null ||
            syncState.lastCheckAt
        );
    }
    let syncConflict = loadStoredJson(CONFLICT_KEY, null);

    const persistSyncState = () => GM_setValue(SYNC_STATE_KEY, JSON.stringify(syncState));
    const persistConflict = () => {
        if (syncConflict) GM_setValue(CONFLICT_KEY, JSON.stringify(syncConflict));
        else GM_setValue(CONFLICT_KEY, '');
    };

    const hasWebDAVEndpoint = () => Boolean(config.webdav.enabled && config.webdav.url);
    const isAutoSyncReady = () => Boolean(hasWebDAVEndpoint() && syncState.autoSyncArmed);

    const getActive = () => {
        const currentBaseId = getBaseId();
        if (!config.bases[currentBaseId]) config.bases[currentBaseId] = normalizeBaseState({});
        return config.bases[currentBaseId];
    };

    const buildCloudData = sourceConfig => {
        const normalized = normalizeConfig(sourceConfig);
        const draftFolderId = folderEditSession?.isNew ? folderEditSession.folderId : '';
        const bases = {};
        Object.entries(normalized.bases).sort(([a], [b]) => a.localeCompare(b)).forEach(([baseId, baseState]) => {
            const safeBase = normalizeBaseState(baseState);
            const folders = safeBase.folders.filter(folder => folder.id !== draftFolderId);
            const validFolderIds = new Set(folders.map(folder => folder.id));
            const map = {};
            Object.entries(safeBase.map).forEach(([tableId, folderId]) => {
                if (validFolderIds.has(folderId)) map[tableId] = folderId;
            });
            bases[baseId] = {
                folders: folders.map(folder => ({
                    id: folder.id,
                    name: folder.name,
                    parentId: folder.parentId,
                    color: folder.color
                })),
                map
            };
        });
        return { schemaVersion: 2, bases };
    };

    const cloudContentHash = cloudData => hashString(stableStringify(cloudData));

    const buildCloudPayload = () => {
        const cloudData = buildCloudData(config);
        const contentHash = cloudContentHash(cloudData);
        return {
            ...cloudData,
            __meta: {
                savedAt: new Date().toISOString(),
                version: SCRIPT_VERSION,
                deviceId: syncState.deviceId,
                contentHash
            }
        };
    };

    const extractCloudData = raw => {
        const source = raw && typeof raw === 'object' ? raw : {};
        if (source.schemaVersion === 2 && source.bases && typeof source.bases === 'object') {
            return buildCloudData({ bases: source.bases });
        }
        // Compatibility with V10 full-config payloads and older single-base exports.
        return buildCloudData(normalizeConfig(source));
    };

    const hasStructuralData = cloudData => Object.values(cloudData?.bases || {}).some(base =>
        (Array.isArray(base.folders) && base.folders.length > 0) || Object.keys(base.map || {}).length > 0
    );

    const getInitialSyncDecision = (localCloudData, remoteCloudData) => {
        const localHash = cloudContentHash(localCloudData);
        const remoteHash = cloudContentHash(remoteCloudData);
        if (localHash === remoteHash) return 'same';
        const localHasData = hasStructuralData(localCloudData);
        const remoteHasData = hasStructuralData(remoteCloudData);
        if (!localHasData && remoteHasData) return 'pull-cloud';
        if (localHasData && !remoteHasData) return 'push-local';
        if (localHasData && remoteHasData) return 'choose';
        return 'same';
    };

    const applyCloudData = cloudData => {
        const previousBases = config.bases;
        const nextBases = {};
        Object.entries(cloudData.bases || {}).forEach(([baseId, remoteBase]) => {
            const normalizedRemote = normalizeBaseState(remoteBase);
            const previousCollapsed = previousBases[baseId]?.collapsed || {};
            const validIds = new Set(normalizedRemote.folders.map(folder => folder.id));
            normalizedRemote.collapsed = {};
            Object.entries(previousCollapsed).forEach(([folderId, collapsed]) => {
                if (collapsed && validIds.has(folderId)) normalizedRemote.collapsed[folderId] = true;
            });
            nextBases[baseId] = normalizedRemote;
        });
        config = normalizeConfig({ ...config, bases: nextBases });
        saveLocalConfig({ structural: false });
        triggerRebuild();
    };

    const updateGlobalCSSVars = () => {
        document.documentElement.style.setProperty('--ndf-spacing', `${config.spacing}px`);
        document.documentElement.style.setProperty('--ndf-indent', `${config.indent}px`);
        const actualOffset = config.enableTableOffset ? (-11 + asInt(config.tableOffset, 0)) : -11;
        document.documentElement.style.setProperty('--ndf-table-offset', `${actualOffset}px`);
    };

    let pushTimer = null;
    let rebuildTimer = null;
    let observer = null;
    let isRebuilding = false;
    let clickTimer = null;
    let editingFolderId = null;
    let folderEditSession = null;
    let searchQuery = '';
    let syncQueue = Promise.resolve();
    let pollTimer = null;

    const isFolderEditing = () => Boolean(editingFolderId);

    const getPersistableConfig = () => {
        const persistable = normalizeConfig(config);
        const draftFolderId = folderEditSession?.isNew ? folderEditSession.folderId : '';
        if (!draftFolderId) return persistable;
        Object.values(persistable.bases).forEach(base => {
            base.folders = base.folders.filter(folder => folder.id !== draftFolderId);
            delete base.collapsed[draftFolderId];
            Object.keys(base.map).forEach(tableId => {
                if (base.map[tableId] === draftFolderId) delete base.map[tableId];
            });
        });
        return persistable;
    };

    const beginFolderEdit = (folder, { isNew = false } = {}) => {
        clearTimeout(pushTimer);
        pushTimer = null;
        editingFolderId = folder.id;
        folderEditSession = {
            folderId: folder.id,
            baseId: getBaseId(),
            isNew,
            originalName: folder.name
        };
        if (isAutoSyncReady()) setSyncStatus('idle', '文件夹名称编辑中，自动同步已暂缓。');
    };

    const resumeSyncAfterFolderEdit = () => {
        if (!isAutoSyncReady() || syncConflict) return;
        enqueueSync(() => checkRemoteUpdate({ reason: 'edit-finished', force: true }));
    };

    const finishFolderEditSession = ({ resumeSync = true } = {}) => {
        editingFolderId = null;
        folderEditSession = null;
        if (resumeSync) resumeSyncAfterFolderEdit();
    };

    function saveLocalConfig({ structural = true, schedulePush = true } = {}) {
        config = normalizeConfig(config);
        GM_setValue(STORAGE_KEY, JSON.stringify(getPersistableConfig()));
        updateGlobalCSSVars();

        if (structural) {
            syncState.pendingHash = cloudContentHash(buildCloudData(config));
            persistSyncState();
        }
        if (structural && schedulePush && isAutoSyncReady() && !isFolderEditing()) scheduleWebDAVPush();
        updateSyncIndicator();
        updateSettingsSyncFeedback();
    }

    const scheduleWebDAVPush = () => {
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            pushTimer = null;
            if (isFolderEditing()) return;
            enqueueSync(() => performPush({ reason: 'debounced-change' }));
        }, PUSH_DEBOUNCE_MS);
    };

    const triggerRebuild = () => {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(rebuildUI, 60);
    };

    const enqueueSync = task => {
        syncQueue = syncQueue.then(task, task);
        return syncQueue;
    };

    const setSyncStatus = (status, message = '') => {
        syncState.status = status;
        syncState.message = message;
        if (status === 'ok') syncState.lastSuccessAt = Date.now();
        persistSyncState();
        updateSyncIndicator();
        updateSettingsSyncFeedback();
    };

    const parseHeaders = rawHeaders => {
        const headers = {};
        String(rawHeaders || '').split(/\r?\n/).forEach(line => {
            const separator = line.indexOf(':');
            if (separator <= 0) return;
            const name = line.slice(0, separator).trim().toLowerCase();
            const value = line.slice(separator + 1).trim();
            if (name) headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
        });
        return headers;
    };

    const encodeBasicAuth = (username, password) => {
        const bytes = new TextEncoder().encode(`${username}:${password}`);
        let binary = '';
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return `Basic ${btoa(binary)}`;
    };

    const getAuthHeaders = (includeJson = false) => {
        const headers = { Authorization: encodeBasicAuth(config.webdav.user, config.webdav.pass) };
        if (includeJson) headers['Content-Type'] = 'application/json; charset=utf-8';
        return headers;
    };

    const gmFetch = (url, options = {}) => new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: options.method || 'GET',
            url,
            headers: options.headers || {},
            data: options.body,
            timeout: options.timeout || REQUEST_TIMEOUT_MS,
            anonymous: true,
            onload: response => {
                const headers = parseHeaders(response.responseHeaders);
                resolve({
                    ok: response.status >= 200 && response.status < 300,
                    status: response.status,
                    text: response.responseText || '',
                    headers,
                    finalUrl: response.finalUrl || url,
                    json() {
                        return JSON.parse(response.responseText || 'null');
                    }
                });
            },
            ontimeout: () => reject(new Error(`Request timed out: ${options.method || 'GET'} ${url}`)),
            onerror: error => reject(error instanceof Error ? error : new Error(`Network error: ${url}`))
        });
    });

    const parsePropfindMetadata = xmlText => {
        try {
            const documentXml = new DOMParser().parseFromString(xmlText, 'application/xml');
            const localText = name => {
                const nodes = Array.from(documentXml.getElementsByTagNameNS('*', name));
                return normalizeString(nodes[0]?.textContent);
            };
            return {
                etag: localText('getetag'),
                lastModified: localText('getlastmodified'),
                size: localText('getcontentlength')
            };
        } catch (error) {
            console.warn('[NocoDB Folder] Failed to parse PROPFIND response:', error);
            return { etag: '', lastModified: '', size: '' };
        }
    };

    const metadataToken = metadata => {
        if (!metadata?.exists) return 'missing';
        if (metadata.etag) return `etag:${metadata.etag}`;
        if (metadata.lastModified || metadata.size) {
            return `weak:${metadata.lastModified || ''}|${metadata.size || ''}`;
        }
        return '';
    };

    const storedMetadataToken = () => {
        if (syncState.remoteExists === false) return 'missing';
        if (syncState.remoteEtag) return `etag:${syncState.remoteEtag}`;
        if (syncState.remoteLastModified || syncState.remoteSize) {
            return `weak:${syncState.remoteLastModified}|${syncState.remoteSize}`;
        }
        return '';
    };

    const updateStoredMetadata = metadata => {
        syncState.remoteExists = metadata.exists;
        syncState.remoteEtag = normalizeString(metadata.etag);
        syncState.remoteLastModified = normalizeString(metadata.lastModified);
        syncState.remoteSize = normalizeString(metadata.size);
        persistSyncState();
    };

    const probeRemote = async () => {
        const url = config.webdav.url;
        const headers = getAuthHeaders(false);
        let headResponse;
        try {
            headResponse = await gmFetch(url, { method: 'HEAD', headers });
            if (headResponse.status === 404) return { exists: false, status: 404, etag: '', lastModified: '', size: '' };
            if (headResponse.ok) {
                const metadata = {
                    exists: true,
                    status: headResponse.status,
                    etag: normalizeString(headResponse.headers.etag),
                    lastModified: normalizeString(headResponse.headers['last-modified']),
                    size: normalizeString(headResponse.headers['content-length'])
                };
                if (metadata.etag || metadata.lastModified || metadata.size) return metadata;
            }
        } catch (error) {
            console.debug('[NocoDB Folder] HEAD probe failed; falling back to PROPFIND.', error);
        }

        const body = '<?xml version="1.0" encoding="utf-8"?>' +
            '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>';
        const response = await gmFetch(url, {
            method: 'PROPFIND',
            headers: { ...headers, Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
            body
        });
        if (response.status === 404) return { exists: false, status: 404, etag: '', lastModified: '', size: '' };
        if (response.ok || response.status === 207) {
            return { exists: true, status: response.status, ...parsePropfindMetadata(response.text) };
        }
        return { exists: null, status: response.status, etag: '', lastModified: '', size: '' };
    };

    const refreshMetadataAfterWrite = async fallbackResponse => {
        const responseMetadata = {
            exists: true,
            etag: normalizeString(fallbackResponse?.headers?.etag),
            lastModified: normalizeString(fallbackResponse?.headers?.['last-modified']),
            size: normalizeString(fallbackResponse?.headers?.['content-length'])
        };
        if (responseMetadata.etag || responseMetadata.lastModified) {
            updateStoredMetadata(responseMetadata);
            return;
        }
        try {
            updateStoredMetadata(await probeRemote());
        } catch (error) {
            syncState.remoteExists = true;
            persistSyncState();
        }
    };

    const getParentUrl = urlString => {
        const url = new URL(urlString);
        const parts = url.pathname.split('/').filter(Boolean);
        parts.pop();
        url.pathname = `/${parts.join('/')}${parts.length ? '/' : ''}`;
        url.search = '';
        url.hash = '';
        return url.toString();
    };

    const joinWebDAVUrl = (directoryUrl, childName) => {
        const url = new URL(directoryUrl);
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        url.pathname += childName.split('/').map(segment => encodeURIComponent(segment)).join('/');
        return url.toString();
    };

    const ensureDirectory = async directoryUrl => {
        const headers = getAuthHeaders(false);
        const url = directoryUrl.endsWith('/') ? directoryUrl.slice(0, -1) : directoryUrl;
        const parts = new URL(url).pathname.split('/').filter(Boolean);
        const origin = new URL(url).origin;
        let current = origin;
        for (const part of parts) {
            current += `/${part}`;
            const check = await gmFetch(current, { method: 'PROPFIND', headers: { ...headers, Depth: '0' } });
            if (check.ok || check.status === 207) continue;
            if (check.status !== 404 && check.status !== 409) throw new Error(`Cannot inspect WebDAV directory: HTTP ${check.status}`);
            const create = await gmFetch(current, { method: 'MKCOL', headers });
            if (!create.ok && create.status !== 405) throw new Error(`Cannot create WebDAV directory: HTTP ${create.status}`);
        }
    };

    const ensureMainParentDirectory = async () => ensureDirectory(getParentUrl(config.webdav.url));

    const getBackupDirectoryUrl = () => joinWebDAVUrl(getParentUrl(config.webdav.url), 'backups');

    const timestampForFilename = () => new Date().toISOString().replace(/[:.]/g, '-');
    const localDateString = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const putBackupFile = async (filename, payload, { createOnly = false } = {}) => {
        const backupDirectory = getBackupDirectoryUrl();
        await ensureDirectory(backupDirectory);
        const headers = getAuthHeaders(true);
        if (createOnly) headers['If-None-Match'] = '*';
        const response = await gmFetch(joinWebDAVUrl(backupDirectory, filename), {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload, null, 2)
        });
        if (response.ok || (createOnly && response.status === 412)) return true;
        throw new Error(`WebDAV backup PUT failed: HTTP ${response.status}`);
    };

    const backupLocalSnapshot = async (prefix, payload = buildCloudPayload()) => {
        try {
            const filename = `${prefix}-${timestampForFilename()}-${syncState.deviceId.slice(-8)}.json`;
            await putBackupFile(filename, payload);
            return true;
        } catch (error) {
            console.warn('[NocoDB Folder] Failed to write safety backup:', error);
            return false;
        }
    };

    const parseBackupListing = xmlText => {
        try {
            const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
            const responses = Array.from(xml.getElementsByTagNameNS('*', 'response'));
            return responses.map(response => {
                const text = name => normalizeString(Array.from(response.getElementsByTagNameNS('*', name))[0]?.textContent);
                return { href: text('href'), lastModified: text('getlastmodified') };
            }).filter(item => item.href);
        } catch (error) {
            return [];
        }
    };

    const cleanupOldDailyBackups = async () => {
        const today = localDateString();
        if (syncState.lastBackupCleanupDate === today) return;
        const directoryUrl = getBackupDirectoryUrl();
        try {
            const response = await gmFetch(directoryUrl, {
                method: 'PROPFIND',
                headers: { ...getAuthHeaders(false), Depth: '1' }
            });
            if (!response.ok && response.status !== 207) return;
            const cutoff = Date.now() - DAILY_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
            for (const item of parseBackupListing(response.text)) {
                const decodedHref = decodeURIComponent(item.href);
                const match = decodedHref.match(/nocodb-folders-(\d{4}-\d{2}-\d{2})\.json$/);
                if (!match) continue;
                const fileTime = new Date(`${match[1]}T00:00:00`).getTime();
                if (!Number.isFinite(fileTime) || fileTime >= cutoff) continue;
                const deleteUrl = new URL(item.href, directoryUrl).toString();
                await gmFetch(deleteUrl, { method: 'DELETE', headers: getAuthHeaders(false) });
            }
            syncState.lastBackupCleanupDate = today;
            persistSyncState();
        } catch (error) {
            console.debug('[NocoDB Folder] Daily backup cleanup skipped:', error);
        }
    };

    const maybeCreateDailyBackup = async payload => {
        const today = localDateString();
        if (syncState.lastDailyBackupDate === today) return;
        try {
            await putBackupFile(`nocodb-folders-${today}.json`, payload, { createOnly: true });
            syncState.lastDailyBackupDate = today;
            persistSyncState();
            await cleanupOldDailyBackups();
        } catch (error) {
            console.warn('[NocoDB Folder] Daily backup failed:', error);
        }
    };

    const setConflict = async ({ reason, remoteMetadata = null, localPayload = null }) => {
        const payload = localPayload || buildCloudPayload();
        const initialSync = reason === 'initial-sync-both-have-data';
        syncConflict = {
            createdAt: new Date().toISOString(),
            reason,
            localPayload: payload,
            remoteMetadata: remoteMetadata || null
        };
        persistConflict();
        setSyncStatus(
            'conflict',
            initialSync
                ? '首次同步发现本机与云端都有不同数据，请选择保留哪一版。'
                : '远端和本地都发生了变化，已暂停自动覆盖。'
        );
        await backupLocalSnapshot(
            initialSync ? 'nocodb-folders-initial-sync-local' : 'nocodb-folders-conflict-local',
            payload
        );
        showSyncPanel();
    };

    const clearConflict = () => {
        syncConflict = null;
        persistConflict();
        if (syncState.status === 'conflict') setSyncStatus('idle', '');
    };

    const verifyRemoteContentBeforeConflict = async ({ metadata, localPayload, reason }) => {
        const localHash = localPayload.__meta?.contentHash || cloudContentHash(extractCloudData(localPayload));
        const response = await gmFetch(config.webdav.url, { method: 'GET', headers: getAuthHeaders(false) });
        if (isFolderEditing()) {
            setSyncStatus('idle', '文件夹名称编辑中，冲突检查已延后。');
            return { action: 'deferred', metadata };
        }
        if (response.status === 404) {
            await setConflict({ reason: `${reason}-remote-missing`, remoteMetadata: { ...metadata, exists: false }, localPayload });
            return { action: 'conflict', metadata: { ...metadata, exists: false } };
        }
        if (!response.ok) throw new Error(`WebDAV conflict verification failed: HTTP ${response.status}`);

        const remoteData = extractCloudData(response.json());
        const remoteHash = cloudContentHash(remoteData);
        const freshMetadata = {
            exists: true,
            status: response.status,
            etag: response.headers.etag || metadata.etag || '',
            lastModified: response.headers['last-modified'] || metadata.lastModified || '',
            size: response.headers['content-length'] || metadata.size || ''
        };
        syncState.lastContentCheckAt = Date.now();

        if (remoteHash === localHash) {
            syncState.remoteContentHash = remoteHash;
            syncState.pendingHash = '';
            updateStoredMetadata(freshMetadata);
            setSyncStatus('ok', '远端已包含本地最新文件夹数据，无需重复上传。');
            return { action: 'already-synced', metadata: freshMetadata };
        }

        if (syncState.remoteContentHash && remoteHash === syncState.remoteContentHash) {
            updateStoredMetadata(freshMetadata);
            persistSyncState();
            return { action: 'metadata-only-change', metadata: freshMetadata };
        }

        updateStoredMetadata(freshMetadata);
        await setConflict({ reason, remoteMetadata: freshMetadata, localPayload });
        return { action: 'conflict', metadata: freshMetadata };
    };

    const performPull = async ({ reason = 'pull', force = false } = {}) => {
        if (!hasWebDAVEndpoint()) return false;
        if (syncConflict && !force) return false;
        if (!force && isFolderEditing()) return false;
        setSyncStatus('syncing', `正在拉取：${reason}`);

        try {
            const response = await gmFetch(config.webdav.url, { method: 'GET', headers: getAuthHeaders(false) });
            if (response.status === 404) {
                updateStoredMetadata({ exists: false, etag: '', lastModified: '', size: '' });
                setSyncStatus('idle', '远端文件尚不存在；若本机已有文件夹数据，将自动创建云端文件。');
                return false;
            }
            if (!response.ok) throw new Error(`WebDAV GET failed: HTTP ${response.status}`);
            if (!force && isFolderEditing()) {
                setSyncStatus('idle', '文件夹名称编辑中，云端拉取已延后。');
                return false;
            }

            const rawPayload = response.json();
            const cloudData = extractCloudData(rawPayload);
            const remoteHash = cloudContentHash(cloudData);
            const localCloudData = buildCloudData(config);
            const localHash = cloudContentHash(localCloudData);
            const hadBaseline = Boolean(syncState.remoteContentHash || storedMetadataToken());
            const metadata = {
                exists: true,
                etag: response.headers.etag || '',
                lastModified: response.headers['last-modified'] || '',
                size: response.headers['content-length'] || ''
            };

            if (!hadBaseline && !force) {
                const decision = getInitialSyncDecision(localCloudData, cloudData);
                updateStoredMetadata(metadata);

                if (decision === 'same') {
                    syncState.remoteContentHash = remoteHash;
                    syncState.pendingHash = '';
                    syncState.lastContentCheckAt = Date.now();
                    persistSyncState();
                    clearConflict();
                    setSyncStatus('ok', '本机与 WebDAV 内容一致，已建立同步基线。');
                    return true;
                }

                if (decision === 'choose') {
                    await setConflict({
                        reason: 'initial-sync-both-have-data',
                        remoteMetadata: metadata,
                        localPayload: buildCloudPayload()
                    });
                    return false;
                }

                if (decision === 'push-local') {
                    syncState.remoteContentHash = remoteHash;
                    syncState.pendingHash = localHash;
                    syncState.lastContentCheckAt = Date.now();
                    persistSyncState();
                    return performPush({ reason: 'initial-local-only' });
                }
                // pull-cloud continues into the normal apply path below.
            }

            if (syncState.pendingHash && localHash !== remoteHash && !force) {
                await setConflict({ reason: 'pull-with-local-pending-changes', remoteMetadata: metadata });
                return false;
            }

            applyCloudData(cloudData);
            syncState.remoteContentHash = remoteHash;
            syncState.pendingHash = '';
            syncState.lastPullAt = Date.now();
            syncState.lastContentCheckAt = Date.now();
            updateStoredMetadata(metadata);
            clearConflict();
            setSyncStatus('ok', '已从 WebDAV 拉取最新文件夹数据。');
            return true;
        } catch (error) {
            console.error('[NocoDB Folder] Pull failed:', error);
            setSyncStatus('error', error.message || 'WebDAV 拉取失败。');
            return false;
        }
    };

    const performPush = async ({ reason = 'push', force = false } = {}) => {
        if (!hasWebDAVEndpoint()) return false;
        if (syncConflict && !force) return false;
        if (!force && isFolderEditing()) return false;

        const payload = buildCloudPayload();
        const localHash = payload.__meta.contentHash;
        if (!force && localHash === syncState.remoteContentHash) {
            syncState.pendingHash = '';
            persistSyncState();
            setSyncStatus('ok', '本地与远端内容一致，无需上传。');
            return true;
        }

        setSyncStatus('syncing', `正在上传：${reason}`);

        try {
            let metadata = await probeRemote();
            syncState.lastCheckAt = Date.now();
            persistSyncState();

            if (!force && isFolderEditing()) {
                setSyncStatus('idle', '文件夹名称编辑中，自动上传已延后。');
                return false;
            }
            if (metadata.exists === null) throw new Error(`无法确认远端状态：HTTP ${metadata.status}`);

            const previousToken = storedMetadataToken();
            const currentToken = metadataToken(metadata);

            if (!force && metadata.exists && !previousToken) {
                // Validator-less servers require a content check immediately before writing.
                const response = await gmFetch(config.webdav.url, { method: 'GET', headers: getAuthHeaders(false) });
                if (!response.ok) throw new Error(`Cannot establish remote baseline: HTTP ${response.status}`);
                const remotePayload = response.json();
                const remoteData = extractCloudData(remotePayload);
                const remoteHash = cloudContentHash(remoteData);
                if (remoteHash === localHash) {
                    syncState.remoteContentHash = remoteHash;
                    syncState.pendingHash = '';
                    syncState.lastContentCheckAt = Date.now();
                    updateStoredMetadata({
                        exists: true,
                        etag: response.headers.etag || metadata.etag,
                        lastModified: response.headers['last-modified'] || metadata.lastModified,
                        size: response.headers['content-length'] || metadata.size
                    });
                    setSyncStatus('ok', '本地与远端内容一致。');
                    return true;
                }
                if (!syncState.remoteContentHash || remoteHash !== syncState.remoteContentHash) {
                    await setConflict({ reason: 'validatorless-remote-changed-before-push', remoteMetadata: metadata, localPayload: payload });
                    return false;
                }
                // Best-effort fallback: the remote body still matches the last pulled hash.
                // A standards-compliant ETag remains the only race-free cross-device guard.
                syncState.lastContentCheckAt = Date.now();
                persistSyncState();
            }

            if (!force && previousToken && previousToken !== currentToken) {
                const verification = await verifyRemoteContentBeforeConflict({
                    metadata,
                    localPayload: payload,
                    reason: 'remote-changed-before-push'
                });
                if (verification.action === 'already-synced') return true;
                if (verification.action === 'conflict' || verification.action === 'deferred') return false;
                metadata = verification.metadata;
            }

            if (!force && isFolderEditing()) {
                setSyncStatus('idle', '文件夹名称编辑中，自动上传已延后。');
                return false;
            }
            if (!metadata.exists) await ensureMainParentDirectory();

            const headers = getAuthHeaders(true);
            if (!force) {
                if (!metadata.exists) headers['If-None-Match'] = '*';
                else if (metadata.etag) headers['If-Match'] = metadata.etag;
                else if (metadata.lastModified) headers['If-Unmodified-Since'] = metadata.lastModified;
            }

            let response = await gmFetch(config.webdav.url, {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload)
            });

            if ((response.status === 404 || response.status === 409) && !metadata.exists) {
                await ensureMainParentDirectory();
                response = await gmFetch(config.webdav.url, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify(payload)
                });
            }

            if (response.status === 412 || (response.status === 409 && metadata.exists)) {
                if (!force && isFolderEditing()) {
                    setSyncStatus('idle', '文件夹名称编辑中，冲突处理已延后。');
                    return false;
                }
                await setConflict({ reason: `precondition-failed-${response.status}`, remoteMetadata: metadata, localPayload: payload });
                return false;
            }
            if (!response.ok) throw new Error(`WebDAV PUT failed: HTTP ${response.status}`);

            syncState.remoteContentHash = localHash;
            syncState.pendingHash = '';
            syncState.lastPushAt = Date.now();
            syncState.remoteExists = true;
            persistSyncState();
            await refreshMetadataAfterWrite(response);
            clearConflict();
            setSyncStatus('ok', '文件夹数据已安全上传到 WebDAV。');
            await maybeCreateDailyBackup(payload);
            return true;
        } catch (error) {
            console.error('[NocoDB Folder] Push failed:', error);
            setSyncStatus('error', error.message || 'WebDAV 上传失败。');
            return false;
        }
    };

    const checkRemoteUpdate = async ({ reason = 'poll', force = false } = {}) => {
        if (!hasWebDAVEndpoint() || syncConflict) return false;
        if (!force && !syncState.autoSyncArmed) return false;
        if (!force && isFolderEditing()) return false;
        if (!force && document.visibilityState !== 'visible') return false;
        if (!force && Date.now() - syncState.lastCheckAt < MIN_REMOTE_CHECK_INTERVAL_MS) return false;

        setSyncStatus('syncing', `正在检查远端：${reason}`);
        try {
            const metadata = await probeRemote();
            syncState.lastCheckAt = Date.now();
            persistSyncState();

            if (!force && isFolderEditing()) {
                setSyncStatus('idle', '文件夹名称编辑中，远端检查已延后。');
                return false;
            }
            if (metadata.exists === null) throw new Error(`WebDAV 检查失败：HTTP ${metadata.status}`);
            const oldToken = storedMetadataToken();
            const newToken = metadataToken(metadata);

            if (!metadata.exists) {
                if (syncState.pendingHash && oldToken && oldToken !== 'missing') {
                    await setConflict({ reason: 'remote-deleted-during-local-pending', remoteMetadata: metadata });
                    return false;
                }
                const localCloudData = buildCloudData(config);
                const localHash = cloudContentHash(localCloudData);
                const localHasData = hasStructuralData(localCloudData);
                updateStoredMetadata(metadata);
                if (!oldToken && localHasData) {
                    syncState.pendingHash = localHash;
                    persistSyncState();
                    return performPush({ reason: 'initial-local-only' });
                }
                if (syncState.pendingHash) return performPush({ reason: 'remote-missing' });
                setSyncStatus('idle', '远端文件尚不存在；本机也没有可上传的文件夹结构。');
                return false;
            }

            if (!newToken) {
                updateStoredMetadata(metadata);
                if (syncState.pendingHash) return performPush({ reason: `validatorless-pending-${reason}` });
                const shouldDownload = force || reason !== 'poll' ||
                    Date.now() - syncState.lastContentCheckAt >= VALIDATORLESS_GET_INTERVAL_MS;
                if (shouldDownload) return performPull({ reason: `validatorless-${reason}` });
                setSyncStatus('ok', 'WebDAV 未提供版本标识；等待下一次内容检查。');
                return true;
            }

            if (!oldToken || oldToken !== newToken) {
                if (syncState.pendingHash && oldToken) {
                    const localPayload = buildCloudPayload();
                    const verification = await verifyRemoteContentBeforeConflict({
                        metadata,
                        localPayload,
                        reason: 'remote-changed-during-local-pending'
                    });
                    if (verification.action === 'already-synced') return true;
                    if (verification.action === 'metadata-only-change') {
                        return performPush({ reason: `verified-pending-after-${reason}` });
                    }
                    return false;
                }
                return performPull({ reason: `remote-update-${reason}` });
            }

            updateStoredMetadata(metadata);
            if (syncState.pendingHash) return performPush({ reason: `pending-after-${reason}` });
            setSyncStatus('ok', '远端没有新变化。');
            return true;
        } catch (error) {
            console.error('[NocoDB Folder] Remote check failed:', error);
            setSyncStatus('error', error.message || 'WebDAV 检查失败。');
            return false;
        }
    };

    const resolveConflictUseCloud = async () => {
        syncState.pendingHash = '';
        syncState.autoSyncArmed = true;
        persistSyncState();
        clearConflict();
        return performPull({ reason: 'conflict-use-cloud', force: true });
    };

    const resolveConflictOverwriteCloud = async () => {
        if (!syncConflict) return performPush({ reason: 'manual-force', force: true });
        try {
            const remoteResponse = await gmFetch(config.webdav.url, { method: 'GET', headers: getAuthHeaders(false) });
            if (remoteResponse.ok) {
                await backupLocalSnapshot('nocodb-folders-remote-before-overwrite', remoteResponse.json());
            }
        } catch (error) {
            console.warn('[NocoDB Folder] Could not back up remote before force overwrite:', error);
        }
        const localPayload = syncConflict.localPayload || buildCloudPayload();
        applyCloudData(extractCloudData(localPayload));
        syncState.pendingHash = localPayload.__meta?.contentHash || cloudContentHash(extractCloudData(localPayload));
        syncState.autoSyncArmed = true;
        persistSyncState();
        clearConflict();
        return performPush({ reason: 'conflict-force-overwrite', force: true });
    };

    const downloadJson = (filename, data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    };

    const exportConflictLocal = () => {
        const payload = syncConflict?.localPayload || buildCloudPayload();
        downloadJson(`nocodb-folders-conflict-${timestampForFilename()}.json`, payload);
    };

    const resetRemoteBaselineIfEndpointChanged = (oldUrl, oldUser, oldPass) => {
        if (
            oldUrl === config.webdav.url &&
            oldUser === config.webdav.user &&
            oldPass === config.webdav.pass
        ) return;
        const localCloudData = buildCloudData(config);
        syncState.remoteEtag = '';
        syncState.remoteLastModified = '';
        syncState.remoteSize = '';
        syncState.remoteExists = null;
        syncState.remoteContentHash = '';
        syncState.pendingHash = hasStructuralData(localCloudData) ? cloudContentHash(localCloudData) : '';
        syncState.autoSyncArmed = false;
        syncState.lastCheckAt = 0;
        syncState.lastContentCheckAt = 0;
        syncState.lastSuccessAt = 0;
        clearConflict();
        persistSyncState();
    };

    const getSyncStatusText = () => {
        if (syncConflict?.reason === 'initial-sync-both-have-data') return '首次同步：请选择本机或云端版本';
        if (syncConflict) return '冲突：自动覆盖已暂停';
        if (syncState.status === 'syncing') return syncState.message || '正在同步';
        if (syncState.status === 'error') return `错误：${syncState.message || '同步失败'}`;
        if (config.webdav.enabled && !syncState.autoSyncArmed) return '等待点击 Save and Check Now 建立或验证同步';
        if (syncState.pendingHash) return '本地有待上传更改';
        if (syncState.status === 'ok') return syncState.message || '同步正常';
        return syncState.message || '等待同步';
    };

    const getSyncIcon = () => {
        const spinning = syncState.status === 'syncing';
        const className = spinning ? 'ndf-spin' : '';
        const badgeClass = syncConflict ? 'ndf-sync-conflict' :
            syncState.status === 'error' ? 'ndf-sync-error' :
                !syncState.autoSyncArmed ? 'ndf-sync-pending' :
                    syncState.pendingHash ? 'ndf-sync-pending' : 'ndf-sync-ok';
        return `<span class="ndf-sync-icon-wrap ${badgeClass}"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="${className}"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg></span>`;
    };

    function updateSyncIndicator() {
        const button = document.getElementById('ndf-btn-sync');
        if (!button) return;
        button.style.display = config.webdav.enabled ? 'flex' : 'none';
        button.innerHTML = getSyncIcon();
        button.title = getSyncStatusText();
    }

    const formatSyncTimestamp = timestamp => {
        if (!timestamp) return 'Never';
        try {
            return new Date(timestamp).toLocaleString();
        } catch (error) {
            return 'Unknown';
        }
    };

    const getSettingsButtonPresentation = panel => {
        if (panel?.dataset.syncStage === 'saving') {
            return { label: 'Saving…', tone: 'primary', busy: true };
        }
        if (syncConflict) return { label: 'Resolve Sync Conflict', tone: 'warning', busy: false };
        if (syncState.status === 'syncing') {
            const message = syncState.message || '';
            if (message.includes('拉取')) return { label: 'Pulling from Cloud…', tone: 'primary', busy: true };
            if (message.includes('上传')) return { label: 'Uploading…', tone: 'primary', busy: true };
            return { label: 'Checking WebDAV…', tone: 'primary', busy: true };
        }
        if (syncState.status === 'error') return { label: 'Sync Failed — Retry', tone: 'error', busy: false };
        if (config.webdav.enabled && !syncState.autoSyncArmed) {
            return { label: 'Save and Check Now', tone: 'primary', busy: false };
        }
        if (syncState.status === 'ok') {
            const message = syncState.message || '';
            if (message.includes('上传')) return { label: 'Uploaded Successfully ✓', tone: 'success', busy: false };
            if (message.includes('拉取')) return { label: 'Pulled Successfully ✓', tone: 'success', busy: false };
            return { label: 'Up to Date ✓', tone: 'success', busy: false };
        }
        return { label: 'Save and Check Now', tone: 'primary', busy: false };
    };

    function updateSettingsSyncFeedback() {
        const panel = document.querySelector('.ndf-settings-panel');
        if (!panel) return;
        const button = panel.querySelector('#btn-dav-force');
        const status = panel.querySelector('#ndf-dav-status');
        const lastSync = panel.querySelector('#ndf-dav-last-sync');
        if (!button || !status || !lastSync) return;

        const presentation = getSettingsButtonPresentation(panel);
        button.disabled = presentation.busy;
        button.classList.remove('ndf-btn-primary', 'ndf-btn-green', 'ndf-btn-red', 'ndf-btn-warning');
        button.classList.add(
            presentation.tone === 'success' ? 'ndf-btn-green' :
                presentation.tone === 'error' ? 'ndf-btn-red' :
                    presentation.tone === 'warning' ? 'ndf-btn-warning' : 'ndf-btn-primary'
        );
        button.innerHTML = `${presentation.busy ? '<span class="ndf-btn-spinner" aria-hidden="true"></span>' : ''}${escapeHtml(presentation.label)}`;

        status.textContent = getSyncStatusText();
        status.className = 'ndf-sync-feedback';
        if (syncConflict) status.classList.add('ndf-feedback-warning');
        else if (syncState.status === 'error') status.classList.add('ndf-feedback-error');
        else if (syncState.status === 'ok') status.classList.add('ndf-feedback-ok');

        lastSync.textContent = `Last successful sync: ${formatSyncTimestamp(syncState.lastSuccessAt)}`;
        ['#inp-dav-enable', '#inp-dav-url', '#inp-dav-user', '#inp-dav-pass'].forEach(selector => {
            const input = panel.querySelector(selector);
            if (input) input.disabled = presentation.busy;
        });
    }

    const setSettingsSavingState = saving => {
        const panel = document.querySelector('.ndf-settings-panel');
        if (!panel) return;
        panel.dataset.syncStage = saving ? 'saving' : '';
        updateSettingsSyncFeedback();
    };

    const createModal = ({ title, bodyHtml, width = 380 }) => {
        document.querySelectorAll('.ndf-modal-overlay').forEach(node => node.remove());
        const overlay = document.createElement('div');
        overlay.className = 'ndf-modal-overlay';
        overlay.innerHTML = `<div class="ndf-modal" style="width:${width}px;max-width:calc(100vw - 32px)">
            <div class="ndf-modal-title"><span>${title}</span><button class="ndf-modal-close" type="button">×</button></div>
            <div class="ndf-modal-body">${bodyHtml}</div>
        </div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.ndf-modal-close').onclick = close;
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.addEventListener('keydown', event => event.stopPropagation());
        return { overlay, modal: overlay.querySelector('.ndf-modal'), close };
    };

    function showSyncPanel() {
        const initialSyncConflict = syncConflict?.reason === 'initial-sync-both-have-data';
        const conflictHtml = syncConflict ? `
            <div class="ndf-alert ndf-alert-warning">
                <strong>${initialSyncConflict ? '首次同步需要选择' : '检测到同步冲突'}</strong><br>
                ${initialSyncConflict
                    ? '本机与 WebDAV 都已有不同的文件夹数据。脚本没有合并或覆盖任何一方，请明确选择要采用的版本。'
                    : '远端与本地都发生了变化。脚本没有覆盖任何一方，并已尝试把本地快照写入 WebDAV 的 backups 目录。'}
            </div>
            <button class="ndf-btn ndf-btn-green" id="ndf-conflict-cloud">${initialSyncConflict ? '采用云端版本（替换本机结构）' : '使用云端版本'}</button>
            <button class="ndf-btn ndf-btn-red" id="ndf-conflict-local">${initialSyncConflict ? '上传本机版本（替换云端结构）' : '用本地版本覆盖云端'}</button>
            <button class="ndf-btn" id="ndf-conflict-export">导出本地安全副本</button>
        ` : '';
        const { modal, close } = createModal({
            title: 'WebDAV 自动同步',
            bodyHtml: `
                <div class="ndf-sync-summary">
                    <div><span>状态</span><strong>${escapeHtml(getSyncStatusText())}</strong></div>
                    <div><span>检查策略</span><strong>页面可见时每 30 秒；聚焦时立即检查</strong></div>
                    <div><span>待上传</span><strong>${syncState.pendingHash ? '是' : '否'}</strong></div>
                    <div><span>远端 ETag</span><code>${escapeHtml(syncState.remoteEtag || '未获得')}</code></div>
                    <div><span>每日快照</span><strong>保留约 ${DAILY_BACKUP_RETENTION_DAYS} 天</strong></div>
                </div>
                ${conflictHtml}
                ${syncConflict ? '' : `
                    <button class="ndf-btn ndf-btn-primary" id="ndf-sync-check">立即检查并同步</button>
                    <button class="ndf-btn" id="ndf-sync-pull">手动拉取云端</button>
                    <button class="ndf-btn" id="ndf-sync-push">上传本地待处理更改</button>
                `}
            `
        });

        if (!syncConflict) {
            const armManualSync = () => {
                syncState.autoSyncArmed = true;
                persistSyncState();
            };
            modal.querySelector('#ndf-sync-check').onclick = async () => {
                armManualSync();
                await enqueueSync(() => checkRemoteUpdate({ reason: 'manual-check', force: true }));
                close();
            };
            modal.querySelector('#ndf-sync-pull').onclick = async () => {
                armManualSync();
                await enqueueSync(() => performPull({ reason: 'manual-pull' }));
                close();
            };
            modal.querySelector('#ndf-sync-push').onclick = async () => {
                armManualSync();
                await enqueueSync(() => performPush({ reason: 'manual-push' }));
                close();
            };
        }
        if (syncConflict) {
            modal.querySelector('#ndf-conflict-cloud').onclick = async () => { await enqueueSync(resolveConflictUseCloud); close(); };
            modal.querySelector('#ndf-conflict-local').onclick = async () => { await enqueueSync(resolveConflictOverwriteCloud); close(); };
            modal.querySelector('#ndf-conflict-export').onclick = exportConflictLocal;
        }
    }

    const ICON_ADD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
    const ICON_IMPORT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>';
    const ICON_EXPORT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
    const ICON_EXPAND_ALL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"/></svg>';
    const ICON_SETTINGS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54A.49.49 0 0 0 13.9 2.4h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.61.22L2.68 8.87a.5.5 0 0 0 .12.64l2.03 1.58c-.05.3-.09.63-.09.94s.03.64.08.94L2.8 14.55a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.29.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.02-1.61zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';
    const getArrowIcon = collapsed => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="transition:transform .2s;transform:rotate(${collapsed ? '-90deg' : '0deg'})"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`;

    const style = document.createElement('style');
    style.textContent = `
        :root { --ndf-base-pad: 12px; }
        #ndf-folder-toolbar-container { margin: 8px 0; border-bottom: 1px dashed #ddd; }
        .ndf-folder-toolbar { padding:4px 12px; display:flex; align-items:center; gap:8px; }
        .ndf-add-folder-btn { flex:0 0 auto; padding:0; border:0; background:transparent; cursor:pointer; color:#3366ff; font:inherit; font-size:13px; font-weight:700; display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
        .ndf-add-folder-btn:hover { color:#1677ff; }
        .ndf-add-folder-btn:focus-visible { outline:2px solid #91caff; outline-offset:1px; }
        .ndf-toolbar-right { margin-left:auto; display:flex; align-items:center; gap:12px; color:#666; }
        .ndf-action-btn { cursor:pointer; opacity:.72; transition:.2s; display:flex; align-items:center; justify-content:center; }
        .ndf-action-btn:hover { opacity:1; color:#1677ff; transform:scale(1.08); }
        .ndf-spin { animation:ndf-spin 1s linear infinite; }
        @keyframes ndf-spin { to { transform:rotate(360deg); } }
        .ndf-sync-icon-wrap { display:inline-flex; position:relative; }
        .ndf-sync-icon-wrap::after { content:''; position:absolute; width:6px; height:6px; border-radius:50%; right:-2px; bottom:-2px; border:1px solid #fff; background:#52c41a; }
        .ndf-sync-pending::after { background:#faad14; }
        .ndf-sync-error::after, .ndf-sync-conflict::after { background:#ff4d4f; }
        .ndf-search-box { padding:4px 12px 10px; display:flex; align-items:center; position:relative; }
        .ndf-search-input { width:100%; padding:6px 28px 6px 32px; border:1px solid #d9d9d9; border-radius:6px; font-size:13px; outline:none; background:#fafafa; color:#333; }
        .ndf-search-input:focus { border-color:#3366ff; background:#fff; box-shadow:0 0 0 2px rgba(51,102,255,.1); }
        .ndf-search-icon { position:absolute; left:22px; color:#bfbfbf; pointer-events:none; }
        .ndf-search-clear { position:absolute; right:22px; cursor:pointer; color:#bfbfbf; display:none; font-size:18px; line-height:1; font-weight:700; }
        .ndf-folder-header { display:flex; align-items:center; padding:6px 12px; font-size:13px; font-weight:700; color:#444; cursor:pointer; border-radius:4px; transition:background .2s; position:relative; padding-left:calc(var(--ndf-base-pad) + var(--ndf-level, 0) * var(--ndf-indent)) !important; margin-top:var(--ndf-spacing); }
        .ndf-folder-header:hover { background:#f0f0f0; }
        .ndf-folder-header.drag-over { background:#e3f2fd !important; box-shadow:0 0 0 2px #2196f3 inset; }
        .ndf-folder-header > span { pointer-events:none; }
        .ndf-folder-icon { display:inline-flex; justify-content:center; align-items:center; width:18px; margin-right:6px; }
        .ndf-inline-input { flex:1; margin-right:auto; padding:2px 6px; border:2px solid #1677ff; border-radius:4px; font-size:13px; font-weight:700; outline:none; background:#fff; color:#333; pointer-events:auto !important; }
        .nc-tree-item.ndf-table-nested { margin-left:0 !important; padding-left:0 !important; }
        .ndf-table-nested > div:first-child, .ndf-table-nested > div:nth-child(2) { position:relative; padding-left:calc(var(--ndf-base-pad) + var(--ndf-level, 0) * var(--ndf-indent) + var(--ndf-table-offset)) !important; }
        .ndf-folder-header::before, .ndf-table-nested > div:first-child::before, .ndf-table-nested > div:nth-child(2)::before { content:''; position:absolute; left:0; width:1px; background:transparent; box-shadow:var(--ndf-lines, none); pointer-events:none; z-index:10; top:0; bottom:0; }
        .ndf-folder-header::before { top:calc(-1 * var(--ndf-spacing)); }
        .ndf-item-collapsed { display:none !important; }
        .nc-tree-item[draggable="true"], .ndf-folder-header[draggable="true"] { cursor:grab; }
        .drag-over-table { box-shadow:0 0 0 2px #2196f3 inset !important; background:#e3f2fd !important; border-radius:4px; }
        #ndf-root-dropzone { display:none; order:999999; margin:16px 12px; padding:16px; text-align:center; border:2px dashed #ccc; border-radius:6px; color:#888; font-size:13px; font-weight:700; }
        body.ndf-is-dragging-table #ndf-root-dropzone, body.ndf-is-dragging-folder #ndf-root-dropzone { display:block; }
        #ndf-root-dropzone.drag-over { background:#f0f7ff; border-color:#1677ff; color:#1677ff; }
        .ndf-settings-panel, .ndf-popover-menu { position:fixed; background:#fff; border:1px solid #e0e0e0; box-shadow:0 12px 32px rgba(0,0,0,.15); border-radius:8px; z-index:999999; font-family:inherit; color:#333; }
        .ndf-settings-panel { padding:16px; width:290px; max-height:calc(100vh - 32px); overflow:auto; }
        .ndf-settings-panel h3 { margin:0 0 12px; font-size:14px; color:#111; border-bottom:1px solid #eee; padding-bottom:6px; }
        .ndf-setting-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; font-size:13px; gap:12px; }
        .ndf-setting-input { width:100%; box-sizing:border-box; padding:6px; margin-top:4px; border:1px solid #ccc; border-radius:4px; font-size:12px; margin-bottom:8px; }
        .ndf-switch { position:relative; display:inline-block; width:34px; height:18px; flex:0 0 auto; }
        .ndf-switch input { opacity:0; width:0; height:0; }
        .ndf-slider { position:absolute; inset:0; cursor:pointer; background:#ccc; transition:.3s; border-radius:18px; }
        .ndf-slider::before { content:''; position:absolute; height:14px; width:14px; left:2px; bottom:2px; background:#fff; transition:.3s; border-radius:50%; }
        input:checked + .ndf-slider { background:#1677ff; }
        input:checked + .ndf-slider::before { transform:translateX(16px); }
        .ndf-popover-menu { padding:6px 0; min-width:180px; }
        .ndf-menu-item { padding:8px 16px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:8px; }
        .ndf-menu-item:hover { background:#f4f4f4; }
        .ndf-menu-divider { border-top:1px solid #eee; margin:4px 0; }
        .ndf-color-row { display:flex; padding:8px 16px; gap:8px; align-items:center; }
        .ndf-color-dot { width:18px; height:18px; border-radius:50%; cursor:pointer; border:1px solid #ddd; }
        .ndf-native-color { width:24px; height:24px; border:0; padding:0; background:transparent; cursor:pointer; }
        .ndf-modal-overlay { position:fixed; inset:0; z-index:1000000; background:rgba(0,0,0,.34); display:flex; align-items:center; justify-content:center; padding:16px; }
        .ndf-modal { background:#fff; border-radius:10px; box-shadow:0 20px 60px rgba(0,0,0,.25); color:#333; overflow:hidden; }
        .ndf-modal-title { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; font-size:15px; font-weight:700; border-bottom:1px solid #eee; }
        .ndf-modal-close { border:0; background:transparent; font-size:22px; line-height:1; cursor:pointer; color:#777; }
        .ndf-modal-body { padding:16px; }
        .ndf-btn { width:100%; box-sizing:border-box; border:1px solid #d9d9d9; background:#fff; color:#333; border-radius:5px; padding:8px 10px; margin-top:8px; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center; gap:7px; }
        .ndf-btn:hover { background:#f5f5f5; }
        .ndf-btn:disabled { cursor:not-allowed; opacity:.68; }
        .ndf-btn-primary { color:#fff; background:#1677ff; border-color:#1677ff; }
        .ndf-btn-primary:hover { background:#0958d9; }
        .ndf-btn-green { color:#fff; background:#52c41a; border-color:#52c41a; }
        .ndf-btn-green:hover { background:#389e0d; }
        .ndf-btn-red { color:#fff; background:#ff4d4f; border-color:#ff4d4f; }
        .ndf-btn-red:hover { background:#cf1322; }
        .ndf-btn-warning { color:#613400; background:#ffd666; border-color:#ffc53d; }
        .ndf-btn-warning:hover { background:#ffc53d; }
        .ndf-btn-spinner { width:13px; height:13px; border:2px solid rgba(255,255,255,.5); border-top-color:currentColor; border-radius:50%; animation:ndf-spin .8s linear infinite; }
        .ndf-sync-feedback { margin-top:9px; padding:8px 9px; border-radius:5px; background:#f5f5f5; color:#555; font-size:11px; line-height:1.45; overflow-wrap:anywhere; }
        .ndf-feedback-ok { background:#f6ffed; color:#237804; border:1px solid #b7eb8f; }
        .ndf-feedback-error { background:#fff2f0; color:#a8071a; border:1px solid #ffccc7; }
        .ndf-feedback-warning { background:#fffbe6; color:#874d00; border:1px solid #ffe58f; }
        .ndf-sync-last { margin-top:5px; color:#888; font-size:10px; line-height:1.4; }
        .ndf-alert { padding:10px; border-radius:6px; font-size:12px; line-height:1.5; margin-bottom:8px; }
        .ndf-alert-warning { background:#fffbe6; border:1px solid #ffe58f; }
        .ndf-sync-summary { display:grid; gap:8px; font-size:12px; margin-bottom:10px; }
        .ndf-sync-summary > div { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
        .ndf-sync-summary span { color:#777; flex:0 0 auto; }
        .ndf-sync-summary strong, .ndf-sync-summary code { text-align:right; overflow-wrap:anywhere; }
    `;
    document.head.appendChild(style);
    updateGlobalCSSVars();

    document.addEventListener('dragend', () => {
        document.body.classList.remove('ndf-is-dragging-table', 'ndf-is-dragging-folder');
        document.querySelectorAll('.drag-over, .drag-over-table').forEach(element => element.classList.remove('drag-over', 'drag-over-table'));
    });

    const buildStateIndexes = (active, knownTableIds = null) => {
        const folderById = new Map();
        const parentByFolderId = new Map();
        const childrenByParentId = new Map([[null, []]]);
        const tablesByFolderId = new Map();
        const mappedTableIds = new Set();
        const addTable = (tableId, parentId) => {
            if (!tableId) return;
            const key = parentId || null;
            if (!tablesByFolderId.has(key)) tablesByFolderId.set(key, []);
            tablesByFolderId.get(key).push(tableId);
        };
        active.folders.forEach(folder => {
            folderById.set(folder.id, folder);
            parentByFolderId.set(folder.id, folder.parentId || null);
            const parentId = folder.parentId || null;
            if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
            childrenByParentId.get(parentId).push(folder);
        });
        Object.entries(active.map || {}).forEach(([tableId, folderId]) => {
            mappedTableIds.add(tableId);
            addTable(tableId, folderId);
        });
        if (knownTableIds instanceof Set) {
            knownTableIds.forEach(tableId => { if (!mappedTableIds.has(tableId)) addTable(tableId, null); });
        }
        return {
            folderById,
            folderIdSet: new Set(folderById.keys()),
            parentByFolderId,
            childrenByParentId,
            tablesByFolderId
        };
    };

    const compactBaseState = (active, knownTableIds = null) => {
        const indexes = buildStateIndexes(active);
        let changed = false;
        Object.keys(active.collapsed || {}).forEach(folderId => {
            if (!indexes.folderIdSet.has(folderId)) {
                delete active.collapsed[folderId];
                changed = true;
            }
        });
        Object.keys(active.map || {}).forEach(tableId => {
            const folderId = active.map[tableId];
            if ((folderId && !indexes.folderIdSet.has(folderId)) || (knownTableIds && !knownTableIds.has(tableId))) {
                delete active.map[tableId];
                changed = true;
            }
        });
        return changed;
    };

    const isDescendant = (targetId, sourceId, parentMap = null) => {
        if (!targetId || !sourceId) return false;
        const parents = parentMap || buildStateIndexes(getActive()).parentByFolderId;
        let current = targetId;
        const seen = new Set();
        while (current && !seen.has(current)) {
            if (current === sourceId) return true;
            seen.add(current);
            current = parents.get(current) || null;
        }
        return false;
    };

    const buildRenderTree = (tableNameMap, indexes) => {
        const active = getActive();
        const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'accent' });
        const renderMap = new Map();
        let order = -10000;
        indexes.childrenByParentId.forEach(folders => folders.sort((a, b) => collator.compare(a.name, b.name)));
        indexes.tablesByFolderId.forEach(tables => tables.sort((a, b) => collator.compare(tableNameMap[a] || '', tableNameMap[b] || '')));

        const matchedFolders = new Set();
        const matchedTables = new Set();
        if (searchQuery) {
            indexes.tablesByFolderId.forEach((tables, folderId) => {
                tables.forEach(tableId => {
                    if (!(tableNameMap[tableId] || '').includes(searchQuery)) return;
                    matchedTables.add(tableId);
                    let current = folderId;
                    while (current) {
                        matchedFolders.add(current);
                        current = indexes.parentByFolderId.get(current) || null;
                    }
                });
            });
        }

        const traverse = (parentId, depth, hidden, activeDepths) => {
            const items = [
                ...(indexes.childrenByParentId.get(parentId) || []).map(data => ({ type: 'folder', data })),
                ...(indexes.tablesByFolderId.get(parentId) || []).map(data => ({ type: 'table', data }))
            ];
            items.forEach(item => {
                const nextDepths = [...activeDepths, depth];
                if (item.type === 'folder') {
                    const folder = item.data;
                    if (searchQuery && !matchedFolders.has(folder.id)) return;
                    const childHidden = searchQuery ? false : hidden || Boolean(active.collapsed[folder.id]);
                    renderMap.set(folder.id, { type: 'folder', order: order++, depth, hidden, activeDepths });
                    traverse(folder.id, depth + 1, childHidden, nextDepths);
                } else {
                    const tableId = item.data;
                    if (searchQuery && !matchedTables.has(tableId)) return;
                    renderMap.set(`tbl_${tableId}`, { type: 'table', order: order++, depth, hidden, folderId: parentId, activeDepths });
                }
            });
        };
        traverse(null, 0, false, []);
        return renderMap;
    };

    const getListRoot = () => {
        let root = document.querySelector('.nc-data-menu');
        if (!root) {
            const firstTable = document.querySelector('.nc-tree-item[data-type="table"][data-table-id]');
            if (firstTable) root = firstTable.parentNode;
        }
        return root;
    };

    const handleExport = () => {
        const exportData = deepClone(config);
        delete exportData.webdav;
        downloadJson('nocodb_folders_backup.json', exportData);
    };

    const handleImport = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = event => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = loadEvent => {
                try {
                    const imported = JSON.parse(loadEvent.target.result);
                    if (!imported || (!imported.bases && !imported.folders)) throw new Error('Invalid structure.');
                    const localWebdav = { ...config.webdav };
                    config = normalizeConfig({ ...config, ...imported, webdav: localWebdav });
                    saveLocalConfig({ structural: true });
                    triggerRebuild();
                    alert('Import successful!');
                } catch (error) {
                    console.error('[NocoDB Folder] Import failed:', error);
                    alert('Invalid backup file.');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    const closeFloatingPanels = () => document.querySelectorAll('.ndf-settings-panel, .ndf-popover-menu').forEach(node => node.remove());

    const showSettingsPanel = event => {
        event.stopPropagation();
        closeFloatingPanels();
        const panel = document.createElement('div');
        panel.className = 'ndf-settings-panel';
        panel.style.left = `${Math.min(event.clientX + 16, window.innerWidth - 322)}px`;
        panel.style.top = `${Math.min(event.clientY, window.innerHeight - 450)}px`;
        panel.innerHTML = `
            <h3>🎨 Appearance & Behavior</h3>
            <div class="ndf-setting-row"><span>Folder Margin</span><strong id="lbl-spacing">${config.spacing}px</strong></div>
            <input type="range" min="-12" max="12" value="${config.spacing}" class="ndf-setting-input" id="inp-spacing">
            <div class="ndf-setting-row"><span>Folder Indent</span><strong id="lbl-indent">${config.indent}px</strong></div>
            <input type="range" min="8" max="32" step="2" value="${config.indent}" class="ndf-setting-input" id="inp-indent">
            <div class="ndf-setting-row"><span>Double Click Delay</span><strong id="lbl-delay">${config.clickDelay}ms</strong></div>
            <input type="range" min="0" max="500" step="50" value="${config.clickDelay}" class="ndf-setting-input" id="inp-delay">
            <div class="ndf-setting-row"><span>Custom Table Offset</span><label class="ndf-switch"><input type="checkbox" id="inp-offset-enable" ${config.enableTableOffset ? 'checked' : ''}><span class="ndf-slider"></span></label></div>
            <div id="offset-fields" style="display:${config.enableTableOffset ? 'block' : 'none'}">
                <div class="ndf-setting-row"><span>Offset</span><strong id="lbl-table-offset">${config.tableOffset}px</strong></div>
                <input type="range" min="-10" max="10" value="${config.tableOffset}" class="ndf-setting-input" id="inp-table-offset">
            </div>
            <h3 style="margin-top:18px">☁️ WebDAV Auto Sync</h3>
            <div class="ndf-setting-row"><span>Enable WebDAV</span><label class="ndf-switch"><input type="checkbox" id="inp-dav-enable" ${config.webdav.enabled ? 'checked' : ''}><span class="ndf-slider"></span></label></div>
            <div id="dav-fields" style="display:${config.webdav.enabled ? 'block' : 'none'}">
                <input type="text" class="ndf-setting-input" id="inp-dav-url" placeholder="Full JSON file URL" value="${escapeHtml(config.webdav.url)}">
                <input type="text" class="ndf-setting-input" id="inp-dav-user" placeholder="Username" value="${escapeHtml(config.webdav.user)}">
                <input type="password" class="ndf-setting-input" id="inp-dav-pass" placeholder="Password" value="${escapeHtml(config.webdav.pass)}">
                <div style="font-size:11px;color:#777;line-height:1.5;margin:4px 0 8px">Only folder structure and table mappings are synchronized. Collapse state and appearance stay local to each device. Enabling WebDAV alone does not connect; click the button below to start or verify synchronization.</div>
                <button class="ndf-btn ndf-btn-primary" id="btn-dav-force" type="button">Save and Check Now</button>
                <div class="ndf-sync-feedback" id="ndf-dav-status" role="status" aria-live="polite">${escapeHtml(getSyncStatusText())}</div>
                <div class="ndf-sync-last" id="ndf-dav-last-sync">Last successful sync: ${escapeHtml(formatSyncTimestamp(syncState.lastSuccessAt))}</div>
            </div>
        `;
        document.body.appendChild(panel);
        ['keydown', 'keyup', 'keypress', 'copy', 'paste', 'cut'].forEach(type => panel.addEventListener(type, e => e.stopPropagation()));

        const localSetting = (inputId, labelId, key, suffix = '') => {
            const input = panel.querySelector(`#${inputId}`);
            input.oninput = e => {
                config[key] = asInt(e.target.value);
                panel.querySelector(`#${labelId}`).textContent = `${config[key]}${suffix}`;
                updateGlobalCSSVars();
            };
            input.onchange = () => saveLocalConfig({ structural: false, schedulePush: false });
        };
        localSetting('inp-spacing', 'lbl-spacing', 'spacing', 'px');
        localSetting('inp-indent', 'lbl-indent', 'indent', 'px');
        localSetting('inp-delay', 'lbl-delay', 'clickDelay', 'ms');
        localSetting('inp-table-offset', 'lbl-table-offset', 'tableOffset', 'px');

        const offsetToggle = panel.querySelector('#inp-offset-enable');
        offsetToggle.onchange = e => {
            config.enableTableOffset = e.target.checked;
            panel.querySelector('#offset-fields').style.display = config.enableTableOffset ? 'block' : 'none';
            saveLocalConfig({ structural: false, schedulePush: false });
        };

        const davToggle = panel.querySelector('#inp-dav-enable');
        davToggle.onchange = e => {
            config.webdav.enabled = e.target.checked;
            syncState.autoSyncArmed = false;
            persistSyncState();
            panel.querySelector('#dav-fields').style.display = config.webdav.enabled ? 'block' : 'none';
            saveLocalConfig({ structural: false, schedulePush: false });
            setSyncStatus(
                'idle',
                config.webdav.enabled
                    ? 'WebDAV 已启用；保存连接信息后点击 Save and Check Now。'
                    : 'WebDAV 已关闭。'
            );
        };

        const saveWebDAVFields = () => {
            const oldUrl = config.webdav.url;
            const oldUser = config.webdav.user;
            const oldPass = config.webdav.pass;
            config.webdav.url = normalizeString(panel.querySelector('#inp-dav-url').value);
            config.webdav.user = normalizeString(panel.querySelector('#inp-dav-user').value);
            config.webdav.pass = panel.querySelector('#inp-dav-pass').value;
            resetRemoteBaselineIfEndpointChanged(oldUrl, oldUser, oldPass);
            saveLocalConfig({ structural: false, schedulePush: false });
        };

        panel.querySelector('#btn-dav-force').onclick = async () => {
            if (syncConflict) {
                showSyncPanel();
                return;
            }
            setSettingsSavingState(true);
            await new Promise(resolve => setTimeout(resolve, 0));
            saveWebDAVFields();
            if (!config.webdav.url) {
                setSettingsSavingState(false);
                setSyncStatus('error', '请填写完整的 WebDAV JSON 文件 URL。');
                return;
            }
            syncState.autoSyncArmed = true;
            persistSyncState();
            setSettingsSavingState(false);
            await enqueueSync(() => checkRemoteUpdate({ reason: 'settings-save', force: true }));
            updateSyncIndicator();
            updateSettingsSyncFeedback();
        };

        updateSettingsSyncFeedback();

        setTimeout(() => {
            const close = clickEvent => {
                if (panel.contains(clickEvent.target)) return;
                if (panel.dataset.syncStage === 'saving' || syncState.status === 'syncing') return;
                if (config.webdav.enabled) saveWebDAVFields();
                panel.remove();
                document.removeEventListener('click', close);
            };
            document.addEventListener('click', close);
        }, 0);
    };

    const showFolderMenu = (event, folder, header, active, indexes) => {
        event.preventDefault();
        closeFloatingPanels();
        const menu = document.createElement('div');
        menu.className = 'ndf-popover-menu';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.innerHTML = `
            <div class="ndf-menu-item" data-action="new-sub">➕ New Subfolder</div>
            <div class="ndf-menu-item" data-action="rename">✏️ Rename</div>
            <div class="ndf-menu-divider"></div>
            <div style="padding:4px 16px;font-size:11px;color:#888">Color</div>
            <div class="ndf-color-row">
                ${['', '#F44336', '#FF9800', '#4CAF50', '#2196F3', '#9C27B0'].map(color => `<button type="button" class="ndf-color-dot" data-color="${color}" title="${color || 'Default'}" style="background:${color || '#eee'}"></button>`).join('')}
                <input class="ndf-native-color" type="color" value="${folder.color || '#1677FF'}" title="Custom color">
            </div>
            <div class="ndf-menu-divider"></div>
            <div class="ndf-menu-item" data-action="delete" style="color:#d32f2f">🗑️ Delete</div>
        `;
        document.body.appendChild(menu);
        menu.querySelectorAll('[data-color]').forEach(button => {
            button.onclick = e => {
                folder.color = e.currentTarget.dataset.color;
                saveLocalConfig({ structural: true });
                triggerRebuild();
                menu.remove();
            };
        });
        menu.querySelector('.ndf-native-color').onchange = e => {
            folder.color = sanitizeColor(e.target.value);
            saveLocalConfig({ structural: true });
            triggerRebuild();
            menu.remove();
        };
        menu.querySelector('[data-action="rename"]').onclick = () => {
            beginFolderEdit(folder, { isNew: false });
            triggerRebuild();
            menu.remove();
        };
        menu.querySelector('[data-action="new-sub"]').onclick = () => {
            const id = generateId();
            const draftFolder = { id, name: 'New Subfolder', parentId: folder.id, color: '' };
            active.folders.push(draftFolder);
            active.collapsed[folder.id] = false;
            beginFolderEdit(draftFolder, { isNew: true });
            saveLocalConfig({ structural: false, schedulePush: false });
            triggerRebuild();
            menu.remove();
        };
        menu.querySelector('[data-action="delete"]').onclick = () => {
            if (!confirm(`Delete folder “${folder.name}”? Its direct children and tables will move to the parent level.`)) return;
            active.folders = active.folders.filter(item => item.id !== folder.id);
            delete active.collapsed[folder.id];
            active.folders.forEach(item => { if (item.parentId === folder.id) item.parentId = folder.parentId || null; });
            Object.keys(active.map).forEach(tableId => {
                if (active.map[tableId] === folder.id) {
                    if (folder.parentId) active.map[tableId] = folder.parentId;
                    else delete active.map[tableId];
                }
            });
            saveLocalConfig({ structural: true });
            triggerRebuild();
            menu.remove();
        };
        setTimeout(() => {
            const close = e => {
                if (menu.contains(e.target)) return;
                menu.remove();
                document.removeEventListener('click', close);
            };
            document.addEventListener('click', close);
        }, 0);
    };

    function rebuildUI() {
        if (isRebuilding) return;
        const listRoot = getListRoot();
        if (!listRoot) return;
        isRebuilding = true;
        if (observer) observer.disconnect();

        try {
            const active = getActive();
            const tableNodes = Array.from(listRoot.querySelectorAll('.nc-tree-item[data-type="table"][data-table-id]'));
            const tableNameMap = {};
            const tableIdSet = new Set();
            tableNodes.forEach(node => {
                const id = node.getAttribute('data-table-id');
                if (!id) return;
                tableIdSet.add(id);
                tableNameMap[id] = (node.getAttribute('data-title') || node.textContent || '').trim().toLowerCase();
            });

            if (compactBaseState(active, tableNodes.length ? tableIdSet : null)) {
                saveLocalConfig({ structural: true });
            }
            const indexes = buildStateIndexes(active, tableNodes.length ? tableIdSet : null);
            const renderTree = buildRenderTree(tableNameMap, indexes);

            document.querySelectorAll('.ndf-folder-header').forEach(header => {
                const id = header.id.replace('ndf-fhdr-', '');
                if (!indexes.folderIdSet.has(id)) header.remove();
            });

            let toolbar = document.getElementById('ndf-folder-toolbar-container');
            if (!toolbar) {
                toolbar = document.createElement('div');
                toolbar.id = 'ndf-folder-toolbar-container';
                toolbar.innerHTML = `
                    <div class="ndf-folder-toolbar">
                        <button type="button" class="ndf-add-folder-btn" title="Create New Folder" aria-label="Create New Folder">${ICON_ADD}<span>Folder</span></button>
                        <div class="ndf-toolbar-right">
                            <span class="ndf-action-btn" id="ndf-btn-import" title="Import Local Backup">${ICON_IMPORT}</span>
                            <span class="ndf-action-btn" id="ndf-btn-export" title="Export Local Backup">${ICON_EXPORT}</span>
                            <span class="ndf-action-btn" id="ndf-btn-toggle-all" title="Toggle All Folders">${ICON_EXPAND_ALL}</span>
                            <span class="ndf-action-btn" id="ndf-btn-sync" title="WebDAV Sync" style="display:${config.webdav.enabled ? 'flex' : 'none'}">${getSyncIcon()}</span>
                            <span class="ndf-action-btn" id="ndf-btn-settings" title="Settings">${ICON_SETTINGS}</span>
                        </div>
                    </div>
                    <div class="ndf-search-box">
                        <svg class="ndf-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0-2.07 4.23l-.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 9.5 5a4.5 4.5 0 0 1 0 9z"/></svg>
                        <input type="text" id="ndf-search-input" class="ndf-search-input" placeholder="Search tables...">
                        <span id="ndf-search-clear" class="ndf-search-clear">×</span>
                    </div>`;
                listRoot.parentNode.insertBefore(toolbar, listRoot);

                const searchInput = toolbar.querySelector('#ndf-search-input');
                const searchClear = toolbar.querySelector('#ndf-search-clear');
                let searchTimer;
                searchInput.oninput = e => {
                    searchClear.style.display = e.target.value ? 'block' : 'none';
                    clearTimeout(searchTimer);
                    searchTimer = setTimeout(() => {
                        searchQuery = e.target.value.trim().toLowerCase();
                        triggerRebuild();
                    }, 250);
                };
                searchClear.onclick = () => {
                    searchInput.value = '';
                    searchClear.style.display = 'none';
                    searchQuery = '';
                    triggerRebuild();
                };
                ['keydown', 'keyup', 'keypress'].forEach(type => searchInput.addEventListener(type, e => e.stopPropagation()));
                toolbar.querySelector('.ndf-add-folder-btn').onclick = () => {
                    const id = generateId();
                    const draftFolder = { id, name: 'New Folder', parentId: null, color: '' };
                    getActive().folders.push(draftFolder);
                    beginFolderEdit(draftFolder, { isNew: true });
                    saveLocalConfig({ structural: false, schedulePush: false });
                    triggerRebuild();
                };
                toolbar.querySelector('#ndf-btn-import').onclick = handleImport;
                toolbar.querySelector('#ndf-btn-export').onclick = handleExport;
                toolbar.querySelector('#ndf-btn-sync').onclick = showSyncPanel;
                toolbar.querySelector('#ndf-btn-settings').onclick = showSettingsPanel;
                toolbar.querySelector('#ndf-btn-toggle-all').onclick = () => {
                    const base = getActive();
                    const ids = base.folders.map(folder => folder.id);
                    if (!ids.length) return;
                    const collapse = ids.filter(id => base.collapsed[id]).length < ids.length / 2;
                    ids.forEach(id => { base.collapsed[id] = collapse; });
                    saveLocalConfig({ structural: false, schedulePush: false });
                    triggerRebuild();
                };
            }
            updateSyncIndicator();

            if (!tableNodes.length) return;
            const container = tableNodes[0].parentNode;
            container.style.display = 'flex';
            container.style.flexDirection = 'column';

            let rootDropZone = document.getElementById('ndf-root-dropzone');
            if (!rootDropZone) {
                rootDropZone = document.createElement('div');
                rootDropZone.id = 'ndf-root-dropzone';
                rootDropZone.textContent = '📥 Drop here to move to Root';
                container.appendChild(rootDropZone);
                rootDropZone.ondragover = e => { e.preventDefault(); e.stopPropagation(); rootDropZone.classList.add('drag-over'); };
                rootDropZone.ondragleave = e => { e.preventDefault(); e.stopPropagation(); rootDropZone.classList.remove('drag-over'); };
                rootDropZone.ondrop = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    rootDropZone.classList.remove('drag-over');
                    try {
                        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                        const current = getActive();
                        if (data.type === 'table' && data.id) delete current.map[data.id];
                        if (data.type === 'folder' && data.id) {
                            const folder = current.folders.find(item => item.id === data.id);
                            if (folder) folder.parentId = null;
                        }
                        saveLocalConfig({ structural: true });
                        triggerRebuild();
                    } catch (error) {
                        console.error('[NocoDB Folder] Root drop failed:', error);
                    }
                };
            }

            active.folders.forEach(folder => {
                const renderState = renderTree.get(folder.id);
                let header = document.getElementById(`ndf-fhdr-${folder.id}`);
                if (!renderState) {
                    header?.remove();
                    return;
                }
                if (!header || header.parentNode !== container) {
                    header?.remove();
                    header = document.createElement('div');
                    header.id = `ndf-fhdr-${folder.id}`;
                    header.className = 'ndf-folder-header';
                    container.appendChild(header);
                }

                const collapsed = Boolean(active.collapsed[folder.id]);
                header.style.setProperty('--ndf-level', renderState.depth);
                header.style.order = renderState.order;
                const shadowDepths = [...new Set([...(renderState.activeDepths || []), ...(renderState.depth > 0 ? [renderState.depth - 1] : [])])];
                header.style.setProperty('--ndf-lines', shadowDepths.map(depth => `calc(var(--ndf-base-pad) + ${depth} * var(--ndf-indent) + 9px) 0 0 0 #d4d4d4`).join(', ') || 'none');
                header.classList.toggle('ndf-item-collapsed', renderState.hidden);

                if (editingFolderId === folder.id && !searchQuery) {
                    const initial = ['New Folder', 'New Subfolder'].includes(folder.name) ? '' : folder.name;
                    header.innerHTML = `<span class="ndf-folder-icon" style="color:${folder.color || 'inherit'}">${getArrowIcon(collapsed)}</span><input type="text" class="ndf-inline-input" value="${escapeHtml(initial)}" placeholder="Enter folder name...">`;
                    const input = header.querySelector('input');
                    input.onclick = e => e.stopPropagation();
                    input.ondblclick = e => e.stopPropagation();
                    input.onkeydown = e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                        if (e.key === 'Escape') {
                            const session = folderEditSession?.folderId === folder.id ? folderEditSession : null;
                            if (session?.isNew) active.folders = active.folders.filter(item => item.id !== folder.id);
                            finishFolderEditSession({ resumeSync: false });
                            saveLocalConfig({ structural: false, schedulePush: false });
                            triggerRebuild();
                            resumeSyncAfterFolderEdit();
                        }
                    };
                    input.onblur = () => {
                        if (editingFolderId !== folder.id) return;
                        const session = folderEditSession?.folderId === folder.id ? folderEditSession : null;
                        const name = sanitizeFolderName(input.value, '');
                        let structuralChanged = false;
                        if (name) {
                            structuralChanged = Boolean(session?.isNew || folder.name !== name);
                            folder.name = name;
                        } else if (session?.isNew) {
                            active.folders = active.folders.filter(item => item.id !== folder.id);
                        }
                        finishFolderEditSession({ resumeSync: false });
                        saveLocalConfig({ structural: structuralChanged, schedulePush: false });
                        triggerRebuild();
                        resumeSyncAfterFolderEdit();
                    };
                    setTimeout(() => { input.focus(); input.select(); }, 0);
                    header.onclick = null;
                    header.ondblclick = null;
                    header.oncontextmenu = null;
                    header.removeAttribute('draggable');
                    return;
                }

                header.innerHTML = `<span class="ndf-folder-icon" style="color:${folder.color || 'inherit'}">${getArrowIcon(collapsed)}</span><span style="flex:1;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${folder.color || 'inherit'}">${escapeHtml(folder.name)}</span>`;
                header.onclick = e => {
                    if (e.target.tagName === 'INPUT' || searchQuery) return;
                    clearTimeout(clickTimer);
                    const toggle = () => {
                        active.collapsed[folder.id] = !collapsed;
                        saveLocalConfig({ structural: false, schedulePush: false });
                        triggerRebuild();
                    };
                    if (config.clickDelay > 0) clickTimer = setTimeout(toggle, config.clickDelay);
                    else toggle();
                };
                header.ondblclick = e => {
                    e.preventDefault();
                    if (searchQuery) return;
                    clearTimeout(clickTimer);
                    beginFolderEdit(folder, { isNew: false });
                    triggerRebuild();
                };
                header.oncontextmenu = e => { if (!searchQuery) showFolderMenu(e, folder, header, active, indexes); };

                if (searchQuery) {
                    header.removeAttribute('draggable');
                } else {
                    header.draggable = true;
                    header.ondragstart = e => {
                        e.stopPropagation();
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'folder', id: folder.id }));
                        e.dataTransfer.effectAllowed = 'move';
                        document.body.classList.add('ndf-is-dragging-folder');
                    };
                    header.ondragend = () => document.body.classList.remove('ndf-is-dragging-folder');
                    header.ondragover = e => { e.preventDefault(); e.stopPropagation(); header.classList.add('drag-over'); };
                    header.ondragleave = e => { e.preventDefault(); e.stopPropagation(); header.classList.remove('drag-over'); };
                    header.ondrop = e => {
                        e.preventDefault();
                        e.stopPropagation();
                        header.classList.remove('drag-over');
                        try {
                            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                            if (data.type === 'table' && data.id) active.map[data.id] = folder.id;
                            else if (data.type === 'folder' && data.id && data.id !== folder.id) {
                                if (isDescendant(folder.id, data.id, indexes.parentByFolderId)) {
                                    alert('Cannot move a parent folder into its descendant.');
                                    return;
                                }
                                const dragged = active.folders.find(item => item.id === data.id);
                                if (dragged) dragged.parentId = folder.id;
                            }
                            saveLocalConfig({ structural: true });
                            triggerRebuild();
                        } catch (error) {
                            console.error('[NocoDB Folder] Folder drop failed:', error);
                        }
                    };
                }
            });

            tableNodes.forEach(node => {
                const tableId = node.getAttribute('data-table-id');
                const renderState = renderTree.get(`tbl_${tableId}`);
                if (searchQuery) node.removeAttribute('draggable');
                else {
                    node.draggable = true;
                    node.ondragstart = e => {
                        if (e.target !== node) return;
                        e.stopPropagation();
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'table', id: tableId }));
                        e.dataTransfer.effectAllowed = 'move';
                        document.body.classList.add('ndf-is-dragging-table');
                    };
                    node.ondragend = () => document.body.classList.remove('ndf-is-dragging-table');
                    node.ondragover = e => {
                        if (!document.body.classList.contains('ndf-is-dragging-table') && !document.body.classList.contains('ndf-is-dragging-folder')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        node.classList.add('drag-over-table');
                    };
                    node.ondragleave = e => { e.preventDefault(); e.stopPropagation(); node.classList.remove('drag-over-table'); };
                    node.ondrop = e => {
                        if (!document.body.classList.contains('ndf-is-dragging-table') && !document.body.classList.contains('ndf-is-dragging-folder')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        node.classList.remove('drag-over-table');
                        try {
                            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                            const targetFolderId = active.map[tableId] || null;
                            if (data.type === 'table' && data.id) {
                                if (targetFolderId) active.map[data.id] = targetFolderId;
                                else delete active.map[data.id];
                            } else if (data.type === 'folder' && data.id && data.id !== targetFolderId) {
                                if (isDescendant(targetFolderId, data.id, indexes.parentByFolderId)) {
                                    alert('Cannot move a parent folder into its descendant.');
                                    return;
                                }
                                const draggedFolder = active.folders.find(item => item.id === data.id);
                                if (draggedFolder) draggedFolder.parentId = targetFolderId;
                            }
                            saveLocalConfig({ structural: true });
                            triggerRebuild();
                        } catch (error) {
                            console.error('[NocoDB Folder] Table drop failed:', error);
                        }
                    };
                }

                if (renderState) {
                    node.style.order = renderState.order;
                    node.classList.toggle('ndf-item-collapsed', renderState.hidden);
                    if (renderState.folderId === null && renderState.depth === 0) {
                        node.classList.remove('ndf-table-nested');
                        node.style.removeProperty('--ndf-level');
                        node.style.removeProperty('--ndf-lines');
                    } else {
                        node.classList.add('ndf-table-nested');
                        node.style.setProperty('--ndf-level', renderState.depth);
                        const depths = [...new Set([...(renderState.activeDepths || []), ...(renderState.depth > 0 ? [renderState.depth - 1] : [])])];
                        node.style.setProperty('--ndf-lines', depths.map(depth => `calc(var(--ndf-base-pad) + ${depth} * var(--ndf-indent) + 9px) 0 0 0 #d4d4d4`).join(', ') || 'none');
                    }
                } else {
                    node.classList.remove('ndf-table-nested');
                    node.style.removeProperty('--ndf-level');
                    node.style.removeProperty('--ndf-lines');
                    node.style.order = '';
                    node.classList.toggle('ndf-item-collapsed', Boolean(searchQuery) && !(tableNameMap[tableId] || '').includes(searchQuery));
                }
            });
        } finally {
            isRebuilding = false;
            if (observer) observer.observe(listRoot, { childList: true, subtree: true });
        }
    }

    const startUI = () => {
        const target = getListRoot();
        if (!target) {
            setTimeout(startUI, 1000);
            return;
        }
        observer?.disconnect();
        observer = new MutationObserver(triggerRebuild);
        observer.observe(target, { childList: true, subtree: true });
        triggerRebuild();
    };

    const runFocusCheck = reason => {
        if (!isAutoSyncReady() || isFolderEditing() || document.visibilityState !== 'visible') return;
        enqueueSync(() => checkRemoteUpdate({ reason }));
    };

    const startAutoSync = () => {
        clearInterval(pollTimer);
        pollTimer = setInterval(() => runFocusCheck('poll'), POLL_INTERVAL_MS);
        window.addEventListener('focus', () => runFocusCheck('focus'));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') runFocusCheck('visible');
        });
        if (isAutoSyncReady()) enqueueSync(() => checkRemoteUpdate({ reason: 'startup', force: true }));
    };

    let currentActiveBaseId = getBaseId();
    const handleRouteChange = () => {
        const nextBaseId = getBaseId();
        if (nextBaseId === currentActiveBaseId) {
            triggerRebuild();
            return;
        }
        currentActiveBaseId = nextBaseId;
        if (folderEditSession?.isNew) {
            const draftId = folderEditSession.folderId;
            Object.values(config.bases).forEach(base => {
                base.folders = base.folders.filter(folder => folder.id !== draftId);
            });
        }
        finishFolderEditSession({ resumeSync: false });
        saveLocalConfig({ structural: false, schedulePush: false });
        closeFloatingPanels();
        observer?.disconnect();
        document.getElementById('ndf-folder-toolbar-container')?.remove();
        setTimeout(startUI, 800);
    };

    if (!window.__NDF_HISTORY_PATCHED__) {
        window.__NDF_HISTORY_PATCHED__ = true;
        const patchHistoryMethod = methodName => {
            const original = history[methodName];
            history[methodName] = function (...args) {
                const result = original.apply(this, args);
                window.dispatchEvent(new Event('ndf_locationchange'));
                return result;
            };
        };
        patchHistoryMethod('pushState');
        patchHistoryMethod('replaceState');
        window.addEventListener('popstate', () => window.dispatchEvent(new Event('ndf_locationchange')));
    }

    window.addEventListener('ndf_locationchange', handleRouteChange);
    startUI();
    startAutoSync();
})();

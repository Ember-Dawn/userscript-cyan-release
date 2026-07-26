// ==UserScript==
// @name         NocoDB 文件夹
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-folders.user.js
// @version      10.0.3
// @description  Hardened folder UI, safer rendering, indexed tree rebuilds, smarter WebDAV queue, root table sorting, state cleanup
// @author       Cyan
// @match        *://nocodb.380782744.xyz/*
// @match        *://*/dashboard/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    if (window.__NDF_SCRIPT_INITIALIZED__) {
        console.info('[NocoDB Folder] Script already initialized, skip duplicate bootstrap.');
        return;
    }
    window.__NDF_SCRIPT_INITIALIZED__ = true;

    const SCRIPT_VERSION = '10.0.1';
    console.log(`--- [NocoDB Folder] V${SCRIPT_VERSION} Started (Hardened, Optimized & Root-Sorted) ---`);

    // 保持原存储Key不变，防止丢失原有配置和数据
    const STORAGE_KEY = 'nc_folder_config_v9';
    const MAX_FOLDER_NAME_LENGTH = 120;
    const defaultSettings = {
        spacing: 0,
        indent: 20,
        tableOffset: 0,
        enableTableOffset: false,
        clickDelay: 0,
        webdav: { enabled: false, url: '', user: '', pass: '' },
        bases: {}
    };
    const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch]);
    const normalizeString = (value) => typeof value === 'string' ? value.trim() : '';
    const asInt = (value, fallback = 0) => {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    const clampInt = (value, min, max, fallback = 0) => Math.min(max, Math.max(min, asInt(value, fallback)));
    const sanitizeFolderName = (name, fallback = 'Untitled Folder') => {
        const cleaned = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME_LENGTH);
        return cleaned || fallback;
    };
    const sanitizeColor = (color) => {
        const normalized = normalizeString(color);
        return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized) ? normalized.toUpperCase() : '';
    };
    const generateId = () => `f_${window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`}`;

    const getBaseId = () => {
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2) return pathParts[1];
        const hashParts = window.location.hash.split('/').filter(Boolean);
        if (hashParts.length >= 2) return hashParts[1];
        return 'default_base';
    };

    const normalizeBaseState = (input) => {
        const rawFolders = Array.isArray(input?.folders) ? input.folders : [];
        const folders = [];
        const folderById = new Map();

        rawFolders.forEach((rawFolder) => {
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

        folders.forEach((folder) => {
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
        folders.forEach((folder) => {
            if (folder.parentId && wouldCreateCycle(folder.id, folder.parentId)) {
                folder.parentId = null;
            }
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
                if (folderIdSet.has(folderId) && !!value) collapsed[folderId] = true;
            });
        }

        return { folders, map, collapsed };
    };

    const normalizeConfig = (rawConfig) => {
        const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const normalized = { ...defaultSettings, ...source };
        normalized.spacing = clampInt(normalized.spacing, -12, 12, defaultSettings.spacing);
        normalized.indent = clampInt(normalized.indent, 8, 32, defaultSettings.indent);
        normalized.tableOffset = clampInt(normalized.tableOffset, -10, 10, defaultSettings.tableOffset);
        normalized.enableTableOffset = !!normalized.enableTableOffset;
        normalized.clickDelay = clampInt(normalized.clickDelay, 0, 500, defaultSettings.clickDelay);
        normalized.webdav = {
            enabled: !!source.webdav?.enabled,
            url: normalizeString(source.webdav?.url),
            user: normalizeString(source.webdav?.user),
            pass: normalizeString(source.webdav?.pass)
        };
        normalized.bases = {};

        if (source.bases && typeof source.bases === 'object') {
            Object.entries(source.bases).forEach(([baseId, baseState]) => {
                const safeBaseId = normalizeString(baseId);
                if (!safeBaseId) return;
                normalized.bases[safeBaseId] = normalizeBaseState(baseState);
            });
        } else if (Array.isArray(source.folders) || (source.map && typeof source.map === 'object')) {
            normalized.bases.default_base = normalizeBaseState(source);
        }

        return normalized;
    };

    let config = normalizeConfig(defaultSettings);
    try {
        const rawV9 = GM_getValue(STORAGE_KEY);
        if (rawV9) {
            const parsedV9 = typeof rawV9 === 'string' ? JSON.parse(rawV9) : rawV9;
            const migrated = { ...config, ...parsedV9 };
            if (parsedV9?.webdav) migrated.webdav = { ...defaultSettings.webdav, ...parsedV9.webdav };
            if (typeof parsedV9?.enableTableOffset === 'undefined' && typeof parsedV9?.tableOffset !== 'undefined') {
                migrated.enableTableOffset = false;
                migrated.tableOffset = asInt(parsedV9.tableOffset, 0) + 11;
            }
            config = normalizeConfig(migrated);
        }
    } catch (e) {
        console.warn('[NocoDB Folder] Failed to parse config, using defaults. Error:', e);
    }

    const getActive = () => {
        const currentBaseId = getBaseId();
        if (!config.bases[currentBaseId]) {
            config.bases[currentBaseId] = normalizeBaseState({});
        }
        return config.bases[currentBaseId];
    };

    const buildStateIndexes = (active, knownTableIds = null) => {
        const folderById = new Map();
        const parentByFolderId = new Map();
        const childrenByParentId = new Map([[null, []]]);
        const tablesByFolderId = new Map();
        const mappedTableIds = new Set();

        const addTableToParent = (tableId, parentId) => {
            if (typeof tableId !== 'string' || !tableId) return;
            const safeParentId = parentId || null;
            if (!tablesByFolderId.has(safeParentId)) tablesByFolderId.set(safeParentId, []);
            tablesByFolderId.get(safeParentId).push(tableId);
        };

        active.folders.forEach((folder) => {
            folderById.set(folder.id, folder);
            parentByFolderId.set(folder.id, folder.parentId || null);
            const parentId = folder.parentId || null;
            if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
            childrenByParentId.get(parentId).push(folder);
        });

        Object.entries(active.map || {}).forEach(([tableId, folderId]) => {
            mappedTableIds.add(tableId);
            addTableToParent(tableId, folderId || null);
        });

        // Root tables are intentionally not written into active.map.
        // When rendering, temporarily treat every visible table that has no folder mapping
        // as a root-level table so it can participate in locale/numeric sorting.
        if (knownTableIds instanceof Set) {
            knownTableIds.forEach((tableId) => {
                if (!mappedTableIds.has(tableId)) addTableToParent(tableId, null);
            });
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

        Object.keys(active.collapsed || {}).forEach((folderId) => {
            if (!indexes.folderIdSet.has(folderId)) {
                delete active.collapsed[folderId];
                changed = true;
            }
        });

        Object.keys(active.map || {}).forEach((tableId) => {
            const folderId = active.map[tableId];
            if (folderId && !indexes.folderIdSet.has(folderId)) {
                delete active.map[tableId];
                changed = true;
                return;
            }
            if (knownTableIds && !knownTableIds.has(tableId)) {
                delete active.map[tableId];
                changed = true;
            }
        });

        return changed;
    };

    const updateGlobalCSSVars = () => {
        document.documentElement.style.setProperty('--ndf-spacing', `${config.spacing}px`);
        document.documentElement.style.setProperty('--ndf-indent', `${config.indent}px`);
        const actualOffset = config.enableTableOffset ? (-11 + asInt(config.tableOffset, 0)) : -11;
        document.documentElement.style.setProperty('--ndf-table-offset', `${actualOffset}px`);
    };
    updateGlobalCSSVars();
    let isRebuilding = false;
    let observer = null;
    let clickTimer = null;
    let editingFolderId = null;
    let isSyncing = false;
    let rebuildTimer = null;
    let searchQuery = ''; // 全局搜索状态

    const triggerRebuild = () => {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(rebuildUI, 60);
    };

    const saveConfig = (pushToCloud = true) => {
        config = normalizeConfig(config);
        GM_setValue(STORAGE_KEY, JSON.stringify(config));
        updateGlobalCSSVars();
        if (pushToCloud && config.webdav.enabled) debounceWebDAVPush();
    };

    let syncTimeout;
    let syncQueue = Promise.resolve();
    const debounceWebDAVPush = () => {
        clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => syncWebDAV('push'), 2000);
    };
    const enqueueSync = (task) => {
        syncQueue = syncQueue.then(task, task);
        return syncQueue;
    };

    const updateSyncState = (state) => {
        isSyncing = state;
        const syncBtn = document.getElementById('ndf-btn-sync');
        if (syncBtn) syncBtn.innerHTML = getSyncIcon();
    };
    const gmFetch = (url, options) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || "GET",
                url: url,
                headers: options.headers || {},
                data: options.body,
                anonymous: true,
                onload: (res) => {
                    resolve({
                        ok: res.status >= 200 && res.status < 300,
                        status: res.status,
                        text: () => Promise.resolve(res.responseText),
                        json: () => {
                            try { return Promise.resolve(JSON.parse(res.responseText)); }
                            catch(e) { return Promise.reject(e); }
                        }
                    });
                },
                onerror: (err) => reject(err)
            });
        });
    };

    const performWebDAVSync = async (mode = 'pull', callback) => {
        if (!config.webdav.url || !config.webdav.enabled) {
            if (callback) callback(false, 0);
            return false;
        }

        updateSyncState(true);
        const headers = {
            Authorization: 'Basic ' + btoa(config.webdav.user + ':' + config.webdav.pass),
            'Content-Type': 'application/json'
        };

        try {
            if (mode === 'push') {
                const payload = JSON.parse(JSON.stringify(normalizeConfig(config)));
                delete payload.webdav;
                payload.__meta = { savedAt: new Date().toISOString(), version: SCRIPT_VERSION };

                let res = await gmFetch(config.webdav.url, { method: 'PUT', headers, body: JSON.stringify(payload) });
                if (res.status === 409 || res.status === 404) {
                    const urlParts = config.webdav.url.split('/');
                    urlParts.pop();
                    const dirsToCreate = [];
                    let currentDir = urlParts.join('/');

                    while (currentDir.split('/').length > 3) {
                        const check = await gmFetch(currentDir, { method: 'PROPFIND', headers: { ...headers, Depth: '0' } });
                        if (check.ok || check.status === 207) break;
                        dirsToCreate.unshift(currentDir);
                        currentDir = currentDir.substring(0, currentDir.lastIndexOf('/'));
                    }

                    for (const dir of dirsToCreate) {
                        await gmFetch(dir, { method: 'MKCOL', headers });
                    }

                    res = await gmFetch(config.webdav.url, { method: 'PUT', headers, body: JSON.stringify(payload) });
                }

                if (!res.ok) console.error(`[NocoDB Folder] WebDAV Push failed: ${res.status}`);
                if (callback) callback(res.ok, res.status);
                return res.ok;
            }

            const res = await gmFetch(config.webdav.url, { method: 'GET', headers });
            if (res.ok) {
                try {
                    const cloudData = normalizeConfig(await res.json());
                    const localWebdav = { ...config.webdav };
                    config = normalizeConfig({ ...config, ...cloudData, webdav: localWebdav });
                    saveConfig(false);
                    triggerRebuild();
                } catch (e) {
                    console.error('[NocoDB Folder] Failed to parse pulled WebDAV data:', e);
                    if (callback) callback(false, res.status);
                    return false;
                }
            }
            if (callback) callback(res.ok, res.status);
            return res.ok;
        } catch (err) {
            console.error('[NocoDB Folder] WebDAV Sync Network Error:', err);
            if (callback) callback(false);
            return false;
        } finally {
            updateSyncState(false);
        }
    };

    const syncWebDAV = (mode = 'pull', callback) => enqueueSync(() => performWebDAVSync(mode, callback));

    function getListRoot() {
        // --- NEW UI FIX: Fetch updated container class or fallback to parent node ---
        let root = document.querySelector('.nc-data-menu');
        if (!root) {
            const firstTable = document.querySelector('.nc-tree-item[data-type="table"][data-table-id]');
            if (firstTable) root = firstTable.parentNode;
        }
        return root;
    }

    const ICON_ADD = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
    const ICON_IMPORT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>`;
    const ICON_EXPORT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
    const ICON_EXPAND_ALL = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12,5.83L15.17,9l1.41-1.41L12,3L7.41,7.59L8.83,9L12,5.83z M12,18.17L8.83,15l-1.41,1.41L12,21l4.59-4.59L15.17,15L12,18.17z"/></svg>`;
    const ICON_SETTINGS = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
    const ICON_CLOUD = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: text-bottom; margin-right: 6px;"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.36 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>`;
    const getSyncIcon = () => `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="${isSyncing ? 'ndf-spin' : ''}"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>`;
    const getArrowIcon = (isCollapsed) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="transition: transform 0.2s ease; transform: rotate(${isCollapsed ? '-90deg' : '0deg'});"><path d="M7.41 8.59L12 13.17l4.59-4.59L18 10l-6 6-6-6 1.41-1.41z"/></svg>`;

    const style = document.createElement('style');
    style.innerHTML = `
        :root { --ndf-base-pad: 12px; }
        #ndf-folder-toolbar-container { margin: 8px 0; border-bottom: 1px dashed #ddd; }
        .ndf-folder-toolbar { padding: 4px 12px; display: flex; align-items: center; }
        .ndf-add-folder-btn { cursor: pointer; font-size: 13px; color: #3366ff; font-weight: bold; display: flex; align-items: center; gap: 4px;}
        .ndf-toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; color: #666; }
        .ndf-action-btn { cursor: pointer; opacity: 0.7; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
        .ndf-action-btn:hover { opacity: 1; color: #1677ff; transform: scale(1.1); }
        .ndf-spin { animation: ndf-spin 1s linear infinite; color: #4caf50; opacity: 1; }
        @keyframes ndf-spin { 100% { transform: rotate(360deg); } }

        .ndf-search-box { padding: 4px 12px 10px 12px; display: flex; align-items: center; position: relative; }
        .ndf-search-input { width: 100%; padding: 6px 28px 6px 32px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; outline: none; transition: border-color 0.2s; background: #fafafa; color: #333; }
        .ndf-search-input:focus { border-color: #3366ff; background: #fff; box-shadow: 0 0 0 2px rgba(51,102,255,0.1); }
        .ndf-search-icon { position: absolute; left: 22px; color: #bfbfbf; pointer-events: none; }
        .ndf-search-clear { position: absolute; right: 22px; cursor: pointer; color: #bfbfbf; display: none; font-size: 18px; line-height: 1; font-weight: bold; }
        .ndf-search-clear:hover { color: #666; }

        body.ndf-is-dragging-table #ndf-folder-toolbar-container, body.ndf-is-dragging-folder #ndf-folder-toolbar-container { background-color: transparent; border-bottom: 1px dashed #ddd; }
        .ndf-folder-header { display: flex; align-items: center; padding: 6px 12px; font-size: 13px; font-weight: bold; color: #444; cursor: pointer; border-radius: 4px; transition: background 0.2s; position: relative; padding-left: calc(var(--ndf-base-pad) + var(--ndf-level, 0) * var(--ndf-indent)) !important; margin-top: var(--ndf-spacing); }
        .ndf-folder-header:hover { background: #f0f0f0; }
        .ndf-folder-header.drag-over { background: #e3f2fd !important; box-shadow: 0 0 0 2px #2196f3 inset; }
        .ndf-folder-header > span { pointer-events: none; }
        .ndf-folder-icon { display: inline-flex; justify-content: center; align-items: center; width: 18px; margin-right: 6px; font-size: 14px; }
        .ndf-inline-input { flex: 1; margin-right: auto; padding: 2px 6px; border: 2px solid #1677ff; border-radius: 4px; font-size: 13px; font-weight: bold; outline: none; background: #fff; color: #333; pointer-events: auto !important; }

        /* 这里的 .nc-tree-item 必须保留，因为这是 NocoDB 原生类的挂载点 */
        .nc-tree-item.ndf-table-nested { margin-left: 0 !important; padding-left: 0 !important; }
        .ndf-table-nested > div:first-child, .ndf-table-nested > div:nth-child(2) { position: relative; padding-left: calc(var(--ndf-base-pad) + var(--ndf-level, 0) * var(--ndf-indent) + var(--ndf-table-offset)) !important; }

        .ndf-folder-header::before, .ndf-table-nested > div:first-child::before, .ndf-table-nested > div:nth-child(2):before { content: ''; position: absolute; left: 0; width: 1px; background: transparent; box-shadow: var(--ndf-lines, none); pointer-events: none; z-index: 10; }
        .ndf-folder-header::before { top: calc(-1 * var(--ndf-spacing)); bottom: 0; }
        .ndf-table-nested > div:first-child::before, .ndf-table-nested > div:nth-child(2)::before { top: 0; bottom: 0; }

        .ndf-item-collapsed { display: none !important; }
        .nc-tree-item[draggable="true"], .ndf-folder-header[draggable="true"] { cursor: grab; }
        .nc-tree-item[draggable="true"]:active, .ndf-folder-header[draggable="true"]:active { cursor: grabbing; }
        .drag-over-table { box-shadow: 0 0 0 2px #2196f3 inset !important; background: #e3f2fd !important; border-radius: 4px; }

        #ndf-root-dropzone { display: none; order: 999999; margin: 16px 12px; padding: 16px; text-align: center; border: 2px dashed #ccc; border-radius: 6px; color: #888; font-size: 13px; font-weight: bold; transition: all 0.2s; }
        body.ndf-is-dragging-table #ndf-root-dropzone, body.ndf-is-dragging-folder #ndf-root-dropzone { display: block; }
        #ndf-root-dropzone.drag-over { background: #f0f7ff; border-color: #1677ff; color: #1677ff; }

        .ndf-settings-panel { position: fixed; background: #fff; border: 1px solid #e0e0e0; box-shadow: 0 12px 32px rgba(0,0,0,0.15); border-radius: 8px; padding: 16px; z-index: 999999; width: 280px; font-family: inherit; color: #333; }
        .ndf-settings-panel h3 { margin: 0 0 12px 0; font-size: 14px; color: #111; border-bottom: 1px solid #eee; padding-bottom: 6px; }
        .ndf-setting-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; font-size: 13px; }
        .ndf-setting-input { width: 100%; box-sizing: border-box; padding: 6px; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; margin-bottom: 8px; }
        .ndf-btn-primary { background: #1677ff; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%; }
        .ndf-btn-primary:hover { background: #0958d9; }
        .ndf-switch { position: relative; display: inline-block; width: 34px; height: 18px; }
        .ndf-switch input { opacity: 0; width: 0; height: 0; }
        .ndf-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 18px; }
        .ndf-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .ndf-slider { background-color: #1677ff; }
        input:checked + .ndf-slider:before { transform: translateX(16px); }
        .ndf-popover-menu { position: fixed; background: #fff; border: 1px solid #e0e0e0; box-shadow: 0 8px 24px rgba(0,0,0,0.12); border-radius: 8px; padding: 6px 0; z-index: 999999; min-width: 160px; box-sizing: border-box; }
        .ndf-menu-item { padding: 8px 16px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .ndf-menu-item:hover { background: #f4f4f4; }
        .ndf-color-row { display: flex; padding: 8px 16px; gap: 8px; justify-content: space-between; }
        .ndf-color-dot { width: 18px; height: 18px; border-radius: 50%; cursor: pointer; border: 1px solid #ddd; }
        .ndf-color-dot:hover { transform: scale(1.2); }
        .ndf-conflict-popup { position: absolute; bottom: 0; right: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.95); border-radius: 8px; padding: 16px; box-sizing: border-box; z-index: 10; display: flex; flex-direction: column; justify-content: center; backdrop-filter: blur(4px); text-align: center; border: 1px solid #1677ff; }
        .ndf-conflict-popup button { margin-bottom: 8px; width: 100%; }
    `;
    document.head.appendChild(style);

    document.addEventListener('dragend', () => {
        document.body.classList.remove('ndf-is-dragging-table', 'ndf-is-dragging-folder');
        document.querySelectorAll('.drag-over, .drag-over-table').forEach(el => el.classList.remove('drag-over', 'drag-over-table'));
    });

    // Deprecated hidden color input removed in V10.0.0; custom color menu is self-contained.

    const isDescendant = (targetId, sourceId, parentByFolderId = null) => {
        if (!targetId || !sourceId) return false;
        const parentMap = parentByFolderId || buildStateIndexes(getActive()).parentByFolderId;
        let current = targetId;
        const seen = new Set();
        while (current && !seen.has(current)) {
            if (current === sourceId) return true;
            seen.add(current);
            current = parentMap.get(current) || null;
        }
        return false;
    };

    function buildRenderTree(tableNameMap, indexes) {
        const active = getActive();
        const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'accent' });
        const renderMap = new Map();
        let currentOrder = -10000;

        indexes.childrenByParentId.forEach((folders) => {
            folders.sort((a, b) => collator.compare(a.name, b.name));
        });
        indexes.tablesByFolderId.forEach((tables) => {
            tables.sort((a, b) => collator.compare(tableNameMap[a] || '', tableNameMap[b] || ''));
        });

        const matchedFolders = new Set();
        const matchedTables = new Set();
        if (searchQuery) {
            indexes.tablesByFolderId.forEach((tables, folderId) => {
                tables.forEach((tableId) => {
                    if (tableNameMap[tableId] && tableNameMap[tableId].includes(searchQuery)) {
                        matchedTables.add(tableId);
                        let currentFolderId = folderId;
                        while (currentFolderId) {
                            matchedFolders.add(currentFolderId);
                            currentFolderId = indexes.parentByFolderId.get(currentFolderId) || null;
                        }
                    }
                });
            });
        }

        const traverse = (parentId, currentDepth, isHidden, activeDepths) => {
            const children = indexes.childrenByParentId.get(parentId) || [];
            const tables = indexes.tablesByFolderId.get(parentId) || [];
            const items = [
                ...children.map(folder => ({ type: 'folder', data: folder })),
                ...tables.map(tableId => ({ type: 'table', data: tableId }))
            ];

            items.forEach((item) => {
                const nextActive = [...activeDepths, currentDepth];
                if (item.type === 'folder') {
                    const folder = item.data;
                    if (searchQuery && !matchedFolders.has(folder.id)) return;
                    const folderHidden = searchQuery ? false : (isHidden || !!active.collapsed[folder.id]);
                    renderMap.set(folder.id, {
                        type: 'folder',
                        order: currentOrder++,
                        depth: currentDepth,
                        hidden: isHidden,
                        folderData: folder,
                        activeDepths
                    });
                    traverse(folder.id, currentDepth + 1, folderHidden, nextActive);
                    return;
                }

                const tableId = item.data;
                if (searchQuery && !matchedTables.has(tableId)) return;
                renderMap.set(`tbl_${tableId}`, {
                    type: 'table',
                    order: currentOrder++,
                    depth: currentDepth,
                    hidden: isHidden,
                    folderId: parentId,
                    activeDepths
                });
            });
        };

        traverse(null, 0, false, []);
        return renderMap;
    }

    const handleExport = () => {
        const exportData = JSON.parse(JSON.stringify(config));
        delete exportData.webdav;

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "nocodb_folders_backup.json");
        dlAnchorElem.click();
    };

    const handleImport = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const imported = JSON.parse(ev.target.result);
                    if (imported && (imported.bases || imported.folders)) {
                        const localWebdav = { ...config.webdav };
                        const merged = normalizeConfig({ ...config, ...imported, webdav: localWebdav });
                        config = merged;
                        saveConfig();
                        triggerRebuild();
                        alert('Import successful!');
                    } else {
                        throw new Error('Invalid structure format.');
                    }
                } catch (err) {
                    alert('Invalid backup file. Check console for details.');
                    console.error('[NocoDB Folder] Import File Parse Error:', err);
                }
            };
            reader.readAsText(file);
        };
        input.click();
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

            // --- NEW UI FIX: Fetch table name from data-title ---
            tableNodes.forEach(node => {
                const tid = node.getAttribute('data-table-id');
                if (!tid) return;
                tableIdSet.add(tid);
                const rawTitle = node.getAttribute('data-title');
                tableNameMap[tid] = rawTitle ? rawTitle.trim().toLowerCase() : node.textContent.trim().toLowerCase();
            });

            if (compactBaseState(active, tableNodes.length > 0 ? tableIdSet : null)) saveConfig(false);
            const indexes = buildStateIndexes(active, tableNodes.length > 0 ? tableIdSet : null);
            const renderTree = buildRenderTree(tableNameMap, indexes);

            document.querySelectorAll('.ndf-folder-header').forEach(header => {
                const fid = header.id.replace('ndf-fhdr-', '');
                if (fid !== 'root-dropzone' && !indexes.folderIdSet.has(fid)) header.remove();
            });

            let toolbarRoot = document.getElementById('ndf-folder-toolbar-container');
            if (!toolbarRoot) {
                toolbarRoot = document.createElement('div');
                toolbarRoot.id = 'ndf-folder-toolbar-container';
                toolbarRoot.innerHTML = `
                    <div class="ndf-folder-toolbar">
                        <span class="ndf-add-folder-btn" title="Create New Folder">${ICON_ADD} New Folder</span>
                        <div class="ndf-toolbar-right">
                            <span class="ndf-action-btn" id="ndf-btn-import" title="Import Local Backup">${ICON_IMPORT}</span>
                            <span class="ndf-action-btn" id="ndf-btn-export" title="Export Local Backup">${ICON_EXPORT}</span>
                            <span class="ndf-action-btn" id="ndf-btn-toggle-all" title="Toggle All Folders">${ICON_EXPAND_ALL}</span>
                            <span class="ndf-action-btn" id="ndf-btn-sync" title="WebDAV Sync Status" style="display:${config.webdav.enabled ? 'block' : 'none'}">${getSyncIcon()}</span>
                            <span class="ndf-action-btn" id="ndf-btn-settings" title="Settings">${ICON_SETTINGS}</span>
                        </div>
                    </div>
                    <div class="ndf-search-box">
                        <svg class="ndf-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                        <input type="text" id="ndf-search-input" class="ndf-search-input" placeholder="Search tables...">
                        <span id="ndf-search-clear" class="ndf-search-clear">×</span>
                    </div>`;

                const searchInput = toolbarRoot.querySelector('#ndf-search-input');
                const searchClear = toolbarRoot.querySelector('#ndf-search-clear');
                let searchTimeout;

                searchInput.addEventListener('input', (e) => {
                    searchClear.style.display = e.target.value ? 'block' : 'none';
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        searchQuery = e.target.value.trim().toLowerCase();
                        triggerRebuild();
                    }, 250);
                });

                searchClear.addEventListener('click', () => {
                    searchInput.value = '';
                    searchClear.style.display = 'none';
                    searchQuery = '';
                    triggerRebuild();
                });

                ['keydown', 'keyup', 'keypress'].forEach(evt => {
                    searchInput.addEventListener(evt, ev => ev.stopPropagation());
                });

                toolbarRoot.querySelector('.ndf-add-folder-btn').onclick = () => {
                    const newId = generateId();
                    getActive().folders.push({ id: newId, name: 'New Folder', parentId: null, color: '' });
                    editingFolderId = newId;
                    saveConfig(); triggerRebuild();
                };

                toolbarRoot.querySelector('#ndf-btn-import').onclick = handleImport;
                toolbarRoot.querySelector('#ndf-btn-export').onclick = handleExport;
                toolbarRoot.querySelector('#ndf-btn-sync').onclick = () => syncWebDAV('pull');

                toolbarRoot.querySelector('#ndf-btn-toggle-all').onclick = () => {
                    const activeBase = getActive();
                    const allIds = activeBase.folders.map(f => f.id);
                    if (allIds.length === 0) return;
                    const collapsedCount = allIds.filter(id => activeBase.collapsed[id]).length;
                    const shouldCollapse = collapsedCount < (allIds.length / 2);
                    allIds.forEach(id => activeBase.collapsed[id] = shouldCollapse);
                    saveConfig(); triggerRebuild();
                };

                toolbarRoot.querySelector('#ndf-btn-settings').onclick = (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.ndf-settings-panel').forEach(n => n.remove());
                    const panel = document.createElement('div');
                    panel.className = 'ndf-settings-panel';

                    const panelOffsetX = 16;
                    const panelOffsetY = 0;
                    panel.style.left = Math.min(e.clientX + panelOffsetX, window.innerWidth - 300) + 'px';
                    panel.style.top = (e.clientY + panelOffsetY) + 'px';

                    panel.innerHTML = `
                        <h3>🎨 Appearance & Behavior</h3>
                        <div class="ndf-setting-row"><span>Folder Margin (px)</span><span style="font-weight:bold" id="lbl-spacing">${config.spacing}</span></div>
                        <input type="range" min="-12" max="12" value="${config.spacing}" class="ndf-setting-input" id="inp-spacing" style="padding:0">

                        <div class="ndf-setting-row" style="margin-top:10px;"><span>Folder Indent (px)</span><span style="font-weight:bold" id="lbl-indent">${config.indent}</span></div>
                        <input type="range" min="8" max="32" step="2" value="${config.indent}" class="ndf-setting-input" id="inp-indent" style="padding:0">

                        <div class="ndf-setting-row" style="margin-top:10px;"><span>Double Click Delay (ms)</span><span style="font-weight:bold" id="lbl-delay">${config.clickDelay}</span></div>
                        <input type="range" min="0" max="500" step="50" value="${config.clickDelay}" class="ndf-setting-input" id="inp-delay" style="padding:0">

                        <div class="ndf-setting-row" style="margin-top:10px;">
                            <span>Custom Table Offset</span>
                            <label class="ndf-switch">
                                <input type="checkbox" id="inp-offset-enable" ${config.enableTableOffset ? 'checked' : ''}>
                                <span class="ndf-slider"></span>
                            </label>
                        </div>
                        <div id="offset-fields" style="display: ${config.enableTableOffset ? 'block' : 'none'};">
                            <div class="ndf-setting-row"><span>Offset (px)</span><span style="font-weight:bold; color: #1677ff;" id="lbl-table-offset">${config.tableOffset}</span></div>
                            <div style="font-size:11px; color:#888; margin-bottom:4px;">(0 is perfect alignment by default)</div>
                            <input type="range" min="-10" max="10" step="1" value="${config.tableOffset}" class="ndf-setting-input" id="inp-table-offset" style="padding:0">
                        </div>

                        <h3 style="margin-top: 20px;">${ICON_CLOUD}WebDAV Sync</h3>
                        <div class="ndf-setting-row"><span>Enable WebDAV</span><label class="ndf-switch"><input type="checkbox" id="inp-dav-enable" ${config.webdav.enabled ? 'checked' : ''}><span class="ndf-slider"></span></label></div>
                        <div id="dav-fields" style="display: ${config.webdav.enabled ? 'block' : 'none'}; relative">
                            <input type="text" class="ndf-setting-input" id="inp-dav-url" placeholder="URL" value="${escapeHtml(config.webdav.url)}">
                            <input type="text" class="ndf-setting-input" id="inp-dav-user" placeholder="Username" value="${escapeHtml(config.webdav.user)}">
                            <input type="password" class="ndf-setting-input" id="inp-dav-pass" placeholder="Password" value="${escapeHtml(config.webdav.pass)}">
                            <button class="ndf-btn-primary" id="btn-dav-force">Force Sync Now</button>
                        </div>
                    `;
                    document.body.appendChild(panel);

                    ['keydown', 'keyup', 'keypress', 'copy', 'paste', 'cut'].forEach(evt => {
                        panel.addEventListener(evt, ev => ev.stopPropagation());
                    });

                    panel.querySelector('#inp-spacing').oninput = (ev) => {
                        const val = asInt(ev.target.value);
                        panel.querySelector('#lbl-spacing').innerText = val; config.spacing = val;
                        updateGlobalCSSVars();
                    };
                    panel.querySelector('#inp-spacing').onchange = () => saveConfig();

                    panel.querySelector('#inp-indent').oninput = (ev) => {
                        const val = asInt(ev.target.value);
                        panel.querySelector('#lbl-indent').innerText = val; config.indent = val;
                        updateGlobalCSSVars();
                    };
                    panel.querySelector('#inp-indent').onchange = () => saveConfig();

                    const offsetToggle = panel.querySelector('#inp-offset-enable');
                    const offsetFields = panel.querySelector('#offset-fields');
                    offsetToggle.onchange = (ev) => {
                        config.enableTableOffset = ev.target.checked;
                        offsetFields.style.display = config.enableTableOffset ? 'block' : 'none';
                        saveConfig(); updateGlobalCSSVars();
                    };

                    panel.querySelector('#inp-table-offset').oninput = (ev) => {
                        const val = asInt(ev.target.value);
                        panel.querySelector('#lbl-table-offset').innerText = val; config.tableOffset = val;
                        updateGlobalCSSVars();
                    };
                    panel.querySelector('#inp-table-offset').onchange = () => saveConfig();

                    panel.querySelector('#inp-delay').oninput = (ev) => {
                        const val = asInt(ev.target.value);
                        panel.querySelector('#lbl-delay').innerText = val; config.clickDelay = val;
                    };
                    panel.querySelector('#inp-delay').onchange = () => saveConfig();

                    const davToggle = panel.querySelector('#inp-dav-enable');
                    const davFields = panel.querySelector('#dav-fields');
                    davToggle.onchange = (ev) => {
                        config.webdav.enabled = ev.target.checked;
                        davFields.style.display = config.webdav.enabled ? 'block' : 'none';
                        saveConfig(); triggerRebuild();
                    };

                    const showPanelMsg = (title, text, isError) => {
                        let popup = panel.querySelector('.ndf-conflict-popup');
                        if (!popup) {
                            popup = document.createElement('div');
                            popup.className = 'ndf-conflict-popup';
                            panel.appendChild(popup);
                        }
                        popup.innerHTML = `
                            <div style="font-weight:bold; font-size:14px; margin-bottom:8px; color:${isError ? '#ff4d4f' : '#52c41a'};">${title}</div>
                            <div style="font-size:12px; color:#666; margin-bottom:16px;">${text}</div>
                            <button class="ndf-btn-primary" id="btn-msg-ok" style="background:#1677ff;">OK</button>
                        `;
                        popup.querySelector('#btn-msg-ok').onclick = () => popup.remove();
                    };

                    panel.querySelector('#btn-dav-force').onclick = async () => {
                        config.webdav.url = panel.querySelector('#inp-dav-url').value;
                        config.webdav.user = panel.querySelector('#inp-dav-user').value;
                        config.webdav.pass = panel.querySelector('#inp-dav-pass').value;
                        saveConfig(false);

                        updateSyncState(true);
                        const btn = panel.querySelector('#btn-dav-force');
                        btn.innerText = "Checking...";
                        btn.style.opacity = '0.5';

                        syncWebDAV('pull', (ok, status) => {
                            btn.innerText = "Force Sync Now";
                            btn.style.opacity = '1';

                            if (status === 404) {
                                syncWebDAV('push', (pushOk) => {
                                    showPanelMsg(
                                        pushOk ? '✅ Auto-created' : '❌ Error',
                                        pushOk ? 'Cloud file was missing. It has been auto-created recursively!' : 'Auto-create failed. (Check console)',
                                        !pushOk
                                    );
                                });
                            } else if (ok) {
                                let popup = panel.querySelector('.ndf-conflict-popup');
                                if (!popup) {
                                    popup = document.createElement('div');
                                    popup.className = 'ndf-conflict-popup';
                                    popup.innerHTML = `
                                        <div style="font-weight:bold; font-size:14px; margin-bottom:4px; color:#1677ff;">⚠️ Cloud File Exists</div>
                                        <div style="font-size:12px; color:#666; margin-bottom:16px;">Choose your sync action:</div>
                                        <button class="ndf-btn-primary" id="btn-conf-push" style="background:#ff4d4f;">Overwrite Cloud</button>
                                        <button class="ndf-btn-primary" id="btn-conf-pull" style="background:#52c41a;">Restore Local</button>
                                        <button class="ndf-btn-primary" id="btn-conf-cancel" style="background:#f5f5f5; color:#333; border:1px solid #d9d9d9;">Cancel</button>
                                    `;
                                    panel.appendChild(popup);

                                    popup.querySelector('#btn-conf-push').onclick = () => {
                                        popup.innerHTML = `<div class="ndf-spin" style="margin:auto; font-size:24px;">⏳</div>`;
                                        syncWebDAV('push', pushOk => showPanelMsg(pushOk ? '✅ Success' : '❌ Error', pushOk ? 'Cloud data successfully overwritten!' : 'Failed to overwrite cloud.', !pushOk));
                                    };
                                    popup.querySelector('#btn-conf-pull').onclick = () => {
                                        popup.innerHTML = `<div class="ndf-spin" style="margin:auto; font-size:24px;">⏳</div>`;
                                        syncWebDAV('pull', pullOk => showPanelMsg(pullOk ? '✅ Success' : '❌ Error', pullOk ? 'Local data successfully restored from cloud!' : 'Failed to restore local data.', !pullOk));
                                    };
                                    popup.querySelector('#btn-conf-cancel').onclick = () => popup.remove();
                                }
                            } else {
                                showPanelMsg('❌ Connection Failed', `Sync Check Failed. HTTP ${status||'Unknown'}`, true);
                            }
                        });
                    };

                    setTimeout(() => document.addEventListener('click', function close(ev){
                        if (!panel.contains(ev.target)) {
                            if (config.webdav.enabled) {
                                config.webdav.url = panel.querySelector('#inp-dav-url').value;
                                config.webdav.user = panel.querySelector('#inp-dav-user').value;
                                config.webdav.pass = panel.querySelector('#inp-dav-pass').value;
                                saveConfig();
                            }
                            panel.remove(); document.removeEventListener('click', close);
                        }
                    }), 0);
                };

                listRoot.parentNode.insertBefore(toolbarRoot, listRoot);
            } else {
                const syncBtn = toolbarRoot.querySelector('#ndf-btn-sync');
                if (syncBtn) {
                    syncBtn.style.display = config.webdav.enabled ? 'block' : 'none';
                    syncBtn.innerHTML = getSyncIcon();
                }
            }

            if (tableNodes.length === 0) return;
            const actualContainer = tableNodes[0].parentNode;
            actualContainer.style.display = 'flex';
            actualContainer.style.flexDirection = 'column';

            let rootDropZone = document.getElementById('ndf-root-dropzone');
            if (!rootDropZone) {
                rootDropZone = document.createElement('div');
                rootDropZone.id = 'ndf-root-dropzone';
                rootDropZone.innerHTML = `📥 Drop here to move to Root`;
                actualContainer.appendChild(rootDropZone);

                rootDropZone.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); rootDropZone.classList.add('drag-over'); };
                rootDropZone.ondragleave = (e) => { e.preventDefault(); e.stopPropagation(); rootDropZone.classList.remove('drag-over'); };
                rootDropZone.ondrop = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    rootDropZone.classList.remove('drag-over');
                    try {
                        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                        const currentActive = getActive();
                        if (data.type === 'table' && data.id) {
                            delete currentActive.map[data.id];
                        }
                        else if (data.type === 'folder' && data.id) {
                            const folder = currentActive.folders.find(f => f.id === data.id);
                            if (folder) folder.parentId = null;
                        }
                        saveConfig();
                        triggerRebuild();
                    } catch(err) {
                        console.error("[NocoDB Folder] Root Drop Parsing Error:", err);
                    }
                };
            }

            active.folders.forEach((folder) => {
                let headerId = `ndf-fhdr-${folder.id}`;
                let header = document.getElementById(headerId);
                const renderState = renderTree.get(folder.id);

                if (!renderState) {
                    if (header) header.remove();
                    return;
                }

                if (!header || header.parentNode !== actualContainer) {
                    if (header) header.remove();
                    header = document.createElement('div');
                    header.id = headerId;
                    header.className = 'ndf-folder-header';
                    actualContainer.appendChild(header);
                }

                const isCollapsed = !!active.collapsed[folder.id];

                header.style.setProperty('--ndf-level', renderState.depth);
                header.style.order = renderState.order;

                let shadowsToDraw = [...(renderState.activeDepths || [])];
                if (renderState.depth > 0) shadowsToDraw.push(renderState.depth - 1);
                const uniqueShadows = [...new Set(shadowsToDraw)];
                const lineShadows = uniqueShadows.map(d => `calc(var(--ndf-base-pad) + ${d} * var(--ndf-indent) + 9px) 0 0 0 #d4d4d4`).join(', ');
                header.style.setProperty('--ndf-lines', lineShadows || 'none');

                if (renderState.hidden) header.classList.add('ndf-item-collapsed');
                else header.classList.remove('ndf-item-collapsed');

                const svgArrow = getArrowIcon(isCollapsed);
                if (editingFolderId === folder.id && !searchQuery) {
                    header.innerHTML = `<span class="ndf-folder-icon" style="color:${folder.color || 'inherit'}">${svgArrow}</span><input type="text" class="ndf-inline-input" value="${escapeHtml(folder.name === 'New Folder' || folder.name === 'New Subfolder' ? '' : folder.name)}" placeholder="Enter folder name...">`;
                    const input = header.querySelector('.ndf-inline-input');

                    input.onclick = e => e.stopPropagation();
                    input.ondblclick = e => e.stopPropagation();
                    input.onkeydown = (e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                        if (e.key === 'Escape') {
                            editingFolderId = null;
                            if (!folder.name || folder.name.includes('New ')) active.folders = active.folders.filter(f => f.id !== folder.id);
                            triggerRebuild();
                        }
                    };
                    setTimeout(() => { input.focus(); input.select(); }, 0);

                    const finishEdit = () => {
                        if (editingFolderId !== folder.id) return;
                        const newName = sanitizeFolderName(input.value, '');
                        if (newName) {
                            folder.name = newName;
                        }
                        else if (!folder.name || folder.name.includes('New ')) {
                            active.folders = active.folders.filter(f => f.id !== folder.id);
                        }
                        editingFolderId = null;
                        saveConfig(); triggerRebuild();
                    };
                    input.onblur = finishEdit;

                    header.onclick = null;
                    header.ondblclick = null;
                    header.removeAttribute('draggable');
                } else {
                    header.innerHTML = `<span class="ndf-folder-icon" style="color:${folder.color || 'inherit'}">${svgArrow}</span><span style="flex: 1; margin-right: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color:${folder.color || 'inherit'}">${escapeHtml(folder.name)}</span>`;
                    header.onclick = (e) => {
                        if (e.target.tagName === 'INPUT' || searchQuery) return;
                        clearTimeout(clickTimer);
                        if (config.clickDelay > 0) {
                            clickTimer = setTimeout(() => { active.collapsed[folder.id] = !isCollapsed; saveConfig(); triggerRebuild(); }, config.clickDelay);
                        } else {
                            active.collapsed[folder.id] = !isCollapsed;
                            saveConfig(); triggerRebuild();
                        }
                    };
                    header.ondblclick = (e) => {
                        e.preventDefault();
                        if (searchQuery) return;
                        clearTimeout(clickTimer);
                        editingFolderId = folder.id;
                        triggerRebuild();
                    };

                    header.oncontextmenu = (e) => {
                        e.preventDefault();
                        if (searchQuery) return;
                        document.querySelectorAll('.ndf-popover-menu').forEach(n => n.remove());
                        const menu = document.createElement('div');
                        menu.className = 'ndf-popover-menu';
                        menu.style.left = e.clientX + 'px';
                        menu.style.top = e.clientY + 'px';
                        menu.innerHTML = `
                            <div class="ndf-menu-item" data-action="new-sub">➕ New Subfolder</div>
                            <div class="ndf-menu-item" data-action="rename">✏️ Rename</div>
                            <div class="ndf-menu-divider"></div>

                            <div style="padding: 4px 16px; font-size: 11px; color: #888;">Color</div>
                            <div class="ndf-color-row">
                                ${['', '#f44336', '#ff9800', '#4caf50', '#2196f3', '#9c27b0'].map(c => `<div class="ndf-color-dot" style="background:${c||'#eee'}" data-color="${c}" title="${c||'Default'}"></div>`).join('')}
                                <div class="ndf-color-dot" style="background:conic-gradient(red, yellow, lime, aqua, blue, magenta, red);" title="Custom Color" data-action="custom-color"></div>
                            </div>
                            <div class="ndf-menu-divider"></div>
                            <div class="ndf-menu-item" data-action="delete" style="color: #d32f2f;">🗑️ Delete</div>
                        `;
                        menu.onclick = (ev) => {
                            ev.stopPropagation();
                            const action = ev.target.dataset.action;
                            const color = ev.target.dataset.color;

                            if (color !== undefined) {
                                folder.color = color;
                                saveConfig(); triggerRebuild(); menu.remove();
                            }
                            else if (action === 'custom-color') {
                                ev.stopPropagation(); // 阻止点击事件冒泡
                                const currentWidth = menu.offsetWidth;
                                // 稍微加宽一点，确保能放下三个并排的输入框
                                menu.style.width = Math.max(currentWidth, 230) + 'px';

                                // 全局唯一真相源：当前颜色
                                let currentHex = folder.color && folder.color.startsWith('#') ? folder.color : '#1677FF';
                                let currentTab = 'HEX'; // 默认选项卡

                                // --- 颜色转换工具函数 ---
                                const hexToRgb = (hex) => {
                                    let h = hex.replace('#', '');
                                    if(h.length === 3) h = h.split('').map(x=>x+x).join('');
                                    const num = parseInt(h, 16);
                                    return { r: num >> 16, g: (num >> 8) & 255, b: num & 255 };
                                };
                                const rgbToHex = (r, g, b) => {
                                    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
                                };
                                const rgbToHsl = (r, g, b) => {
                                    r /= 255; g /= 255; b /= 255;
                                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                                    let h, s, l = (max + min) / 2;
                                    if (max === min) { h = s = 0; } else {
                                        const d = max - min;
                                        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                                        switch (max) {
                                            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                                            case g: h = (b - r) / d + 2; break;
                                            case b: h = (r - g) / d + 4; break;
                                        }
                                        h /= 6;
                                    }
                                    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
                                };
                                const hslToRgb = (h, s, l) => {
                                    h /= 360; s /= 100; l /= 100;
                                    let r, g, b;
                                    if (s === 0) { r = g = b = l; } else {
                                        const hue2rgb = (p, q, t) => {
                                            if (t < 0) t += 1;
                                            if (t > 1) t -= 1;
                                            if (t < 1/6) return p + (q - p) * 6 * t;
                                            if (t < 1/2) return q;
                                            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                                            return p;
                                        };
                                        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                                        const p = 2 * l - q;
                                        r = hue2rgb(p, q, h + 1/3);
                                        g = hue2rgb(p, q, h);
                                        b = hue2rgb(p, q, h - 1/3);
                                    }
                                    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
                                };

                                // --- 核心渲染与绑定逻辑 ---
                                const renderUI = () => {
                                    const rgb = hexToRgb(currentHex);
                                    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

                                    // 根据当前选中的 Tab 渲染对应的输入框
                                    let inputHtml = '';
                                    if (currentTab === 'HEX') {
                                        inputHtml = `<input type="text" id="ndf-hex-val" value="${currentHex}" maxlength="7" style="width: 100%; box-sizing: border-box; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; font-size: 13px; outline: none; text-transform: uppercase; text-align: center;">`;
                                    } else if (currentTab === 'RGB') {
                                        inputHtml = `
                                            <div style="display:flex; gap:6px;">
                                                <input type="number" id="ndf-r-val" value="${rgb.r}" min="0" max="255" title="Red (0-255)" style="flex:1; width:0; padding:6px 2px; border:1px solid #ccc; border-radius:4px; font-size:12px; text-align:center; outline:none;">
                                                <input type="number" id="ndf-g-val" value="${rgb.g}" min="0" max="255" title="Green (0-255)" style="flex:1; width:0; padding:6px 2px; border:1px solid #ccc; border-radius:4px; font-size:12px; text-align:center; outline:none;">
                                                <input type="number" id="ndf-b-val" value="${rgb.b}" min="0" max="255" title="Blue (0-255)" style="flex:1; width:0; padding:6px 2px; border:1px solid #ccc; border-radius:4px; font-size:12px; text-align:center; outline:none;">
                                            </div>`;
                                    } else if (currentTab === 'HSL') {
                                        inputHtml = `
                                            <div style="display:flex; gap:6px;">
                                                <input type="number" id="ndf-h-val" value="${hsl.h}" min="0" max="360" title="Hue (0-360)" style="flex:1; width:0; padding:6px 2px; border:1px solid #ccc; border-radius:4px; font-size:12px; text-align:center; outline:none;">
                                                <input type="number" id="ndf-s-val" value="${hsl.s}" min="0" max="100" title="Saturation (0-100%)" style="flex:1; width:0; padding:6px 2px; border:1px solid #ccc; border-radius:4px; font-size:12px; text-align:center; outline:none;">
                                                <input type="number" id="ndf-l-val" value="${hsl.l}" min="0" max="100" title="Lightness (0-100%)" style="flex:1; width:0; padding:6px 2px; border:1px solid #ccc; border-radius:4px; font-size:12px; text-align:center; outline:none;">
                                            </div>`;
                                    }

                                    menu.innerHTML = `
                                        <div style="padding: 12px; box-sizing: border-box; cursor: default; width: 100%;">
                                            <div style="font-size: 13px; font-weight: bold; color: #333; margin-bottom: 12px;">🎨 Custom Color</div>

                                            <div style="display: flex; gap: 12px; margin-bottom: 12px; align-items: center; justify-content: space-between;">
                                                <div id="ndf-color-preview" style="width: 28px; height: 28px; border-radius: 4px; border: 1px solid #d9d9d9; background: ${currentHex}; flex-shrink: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05);"></div>

                                                <div style="display:flex; background:#f5f5f5; border-radius:6px; padding:3px; border: 1px solid #ebebeb;">
                                                    ${['HEX', 'RGB', 'HSL'].map(tab =>
                                                        `<div class="ndf-tab-btn" data-tab="${tab}" style="padding: 3px 8px; font-size: 11px; cursor:pointer; border-radius:4px; transition:all 0.2s; background:${currentTab===tab ? '#fff':'transparent'}; box-shadow:${currentTab===tab ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'}; font-weight:${currentTab===tab ? 'bold':'normal'}; color:${currentTab===tab ? '#1677ff':'#666'}">${tab}</div>`
                                                    ).join('')}
                                                </div>
                                            </div>

                                            <div id="ndf-input-container" style="margin-bottom: 16px;">
                                                ${inputHtml}
                                            </div>

                                            <div style="display: flex; gap: 8px;">
                                                <button id="btn-color-cancel" style="flex: 1; padding: 6px; border: 1px solid #d9d9d9; background: #fff; border-radius: 4px; cursor: pointer; color: #333; font-size: 12px; transition: background 0.2s;">Cancel</button>
                                                <button id="btn-color-confirm" style="flex: 1; padding: 6px; border: none; background: #1677ff; color: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.2s;">Apply</button>
                                            </div>
                                        </div>
                                    `;

                                    // 阻止点击面板内部时触发全局关闭
                                    menu.onclick = (ev2) => ev2.stopPropagation();

                                    // 绑定 Tab 切换事件
                                    menu.querySelectorAll('.ndf-tab-btn').forEach(btn => {
                                        btn.onclick = (e) => {
                                            currentTab = e.target.dataset.tab;
                                            renderUI(); // 切换时根据当前 currentHex 重新渲染 UI，实现完美同步
                                        };
                                    });

                                    // 实时更新颜色预览块
                                    const updatePreview = () => {
                                        menu.querySelector('#ndf-color-preview').style.background = currentHex;
                                    };

                                    // 绑定各个模式下的输入事件
                                    if (currentTab === 'HEX') {
                                        const hexInp = menu.querySelector('#ndf-hex-val');
                                        hexInp.oninput = (e) => {
                                            let val = e.target.value.trim();
                                            if(!val.startsWith('#')) { val = '#' + val; e.target.value = val; }
                                            if(/^#[0-9A-Fa-f]{6}$/i.test(val) || /^#[0-9A-Fa-f]{3}$/i.test(val)) {
                                                currentHex = val;
                                                updatePreview();
                                            }
                                        };
                                    } else if (currentTab === 'RGB') {
                                        const rInp = menu.querySelector('#ndf-r-val'), gInp = menu.querySelector('#ndf-g-val'), bInp = menu.querySelector('#ndf-b-val');
                                        const updateRgbToHex = () => {
                                            let r = Math.min(255, Math.max(0, parseInt(rInp.value)||0));
                                            let g = Math.min(255, Math.max(0, parseInt(gInp.value)||0));
                                            let b = Math.min(255, Math.max(0, parseInt(bInp.value)||0));
                                            currentHex = rgbToHex(r, g, b);
                                            updatePreview();
                                        };
                                        [rInp, gInp, bInp].forEach(inp => inp.oninput = updateRgbToHex);
                                    } else if (currentTab === 'HSL') {
                                        const hInp = menu.querySelector('#ndf-h-val'), sInp = menu.querySelector('#ndf-s-val'), lInp = menu.querySelector('#ndf-l-val');
                                        const updateHslToHex = () => {
                                            let h = Math.min(360, Math.max(0, parseInt(hInp.value)||0));
                                            let s = Math.min(100, Math.max(0, parseInt(sInp.value)||0));
                                            let l = Math.min(100, Math.max(0, parseInt(lInp.value)||0));
                                            const newRgb = hslToRgb(h, s, l);
                                            currentHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
                                            updatePreview();
                                        };
                                        [hInp, sInp, lInp].forEach(inp => inp.oninput = updateHslToHex);
                                    }

                                    // 绑定底部按钮事件
                                    const btnCancel = menu.querySelector('#btn-color-cancel');
                                    const btnConfirm = menu.querySelector('#btn-color-confirm');

                                    btnCancel.onmouseover = () => btnCancel.style.background = '#f0f0f0';
                                    btnCancel.onmouseout = () => btnCancel.style.background = '#fff';
                                    btnConfirm.onmouseover = () => btnConfirm.style.background = '#0958d9';
                                    btnConfirm.onmouseout = () => btnConfirm.style.background = '#1677ff';

                                    btnCancel.onclick = (ev) => { ev.stopPropagation(); menu.remove(); };
                                    btnConfirm.onclick = (ev) => {
                                        ev.stopPropagation();
                                        let finalHex = currentHex;
                                        // 自动补全简写的 HEX
                                        if(finalHex.length === 4) {
                                            finalHex = '#' + finalHex[1]+finalHex[1] + finalHex[2]+finalHex[2] + finalHex[3]+finalHex[3];
                                        }
                                        folder.color = finalHex.toUpperCase();
                                        saveConfig();
                                        triggerRebuild();
                                        menu.remove();
                                    };
                                };

                                // 初次挂载面板
                                renderUI();
                            }
                            else if (action === 'rename') {
                                header.ondblclick(e);
                                menu.remove();
                            }
                            else if (action === 'new-sub') {
                                const newId = generateId();
                                active.folders.push({ id: newId, name: 'New Subfolder', parentId: folder.id, color: '' });
                                active.collapsed[folder.id] = false; editingFolderId = newId; saveConfig(); triggerRebuild(); menu.remove();
                            }
                            else if (action === 'delete') {
                                ev.stopPropagation();
                                const currentWidth = menu.offsetWidth;
                                menu.style.width = currentWidth + 'px';
                                menu.innerHTML = `
                                    <div style="padding: 12px; width: 100%; box-sizing: border-box; text-align: center; cursor: default;">
                                        <div style="font-size: 14px; font-weight: bold; color: #333; margin-bottom: 6px;">Confirm?</div>
                                        <div style="font-size: 12px; color: #888; margin-bottom: 12px; line-height: 1.4; word-wrap: break-word;">Delete <b>${escapeHtml(folder.name)}</b>?</div>
                                        <div style="display: flex; gap: 8px;">
                                            <button id="btn-del-cancel" style="flex: 1; padding: 6px; border: 1px solid #d9d9d9; background: #fff; border-radius: 4px; cursor: pointer; color: #333; font-size: 12px; transition: background 0.2s;">Cancel</button>
                                            <button id="btn-del-confirm" style="flex: 1; padding: 6px; border: none; background: #ff4d4f; color: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.2s;">Delete</button>
                                        </div>
                                    </div>
                                `;
                                menu.onclick = (ev2) => ev2.stopPropagation();

                                menu.querySelector('#btn-del-cancel').onmouseover = (ev) => ev.target.style.background = '#f0f0f0';
                                menu.querySelector('#btn-del-cancel').onmouseout = (ev) => ev.target.style.background = '#fff';
                                menu.querySelector('#btn-del-confirm').onmouseover = (ev) => ev.target.style.background = '#d9363e';
                                menu.querySelector('#btn-del-confirm').onmouseout = (ev) => ev.target.style.background = '#ff4d4f';

                                menu.querySelector('#btn-del-cancel').onclick = (ev) => { ev.stopPropagation(); menu.remove(); };
                                menu.querySelector('#btn-del-confirm').onclick = (ev) => {
                                    ev.stopPropagation();
                                    active.folders = active.folders.filter(f => f.id !== folder.id);
                                    delete active.collapsed[folder.id];
                                    active.folders.forEach(f => { if(f.parentId === folder.id) f.parentId = folder.parentId || null; });
                                    Object.keys(active.map).forEach(tid => { if(active.map[tid] === folder.id) active.map[tid] = folder.parentId || null; });
                                    Object.keys(active.map).forEach(tid => { if(active.map[tid] === null) delete active.map[tid]; });
                                    saveConfig(); triggerRebuild(); menu.remove();
                                };
                            }
                        };
                        document.body.appendChild(menu);
                        setTimeout(() => document.addEventListener('click', function close(ev){
                            if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); }
                        }), 0);
                    };

                    if (searchQuery) {
                        header.removeAttribute('draggable');
                    } else {
                        header.setAttribute('draggable', 'true');
                        header.ondragstart = (e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'folder', id: folder.id }));
                            e.dataTransfer.effectAllowed = 'move'; document.body.classList.add('ndf-is-dragging-folder');
                        };
                        header.ondragend = () => document.body.classList.remove('ndf-is-dragging-folder');
                        header.ondragenter = (e) => { e.preventDefault(); e.stopPropagation(); };
                        header.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); header.classList.add('drag-over'); e.dataTransfer.dropEffect = 'move'; };
                        header.ondragleave = (e) => { e.preventDefault(); e.stopPropagation(); header.classList.remove('drag-over'); };
                        header.ondrop = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            header.classList.remove('drag-over');
                            try {
                                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                                if (data.type === 'table' && data.id) {
                                    active.map[data.id] = folder.id;
                                } else if (data.type === 'folder' && data.id && data.id !== folder.id) {
                                    if (!isDescendant(folder.id, data.id, indexes.parentByFolderId)) {
                                        const draggedFolder = active.folders.find(f => f.id === data.id);
                                        if (draggedFolder) draggedFolder.parentId = folder.id;
                                    } else {
                                        alert('Logic error: Cannot drop a parent folder into its descendant!');
                                    }
                                }
                                saveConfig();
                                triggerRebuild();
                            } catch(err) {
                                console.error("[NocoDB Folder] Folder Drop Parsing Error:", err);
                            }
                        };
                    }
                }
            });

            tableNodes.forEach(node => {
                const tid = node.getAttribute('data-table-id');
                const renderState = renderTree.get(`tbl_${tid}`);

                if (searchQuery) {
                    node.removeAttribute('draggable');
                } else {
                    node.setAttribute('draggable', 'true');

                    node.ondragstart = (e) => {
                        if (e.target !== node) return;

                        e.stopPropagation();
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'table', id: tid }));
                        e.dataTransfer.effectAllowed = 'move';
                        document.body.classList.add('ndf-is-dragging-table');
                    };

                    node.ondragend = () => document.body.classList.remove('ndf-is-dragging-table');

                    node.ondragover = (e) => {
                        if (!document.body.classList.contains('ndf-is-dragging-table') && !document.body.classList.contains('ndf-is-dragging-folder')) return;
                        if (e.dataTransfer.types.includes('text/plain')) {
                            e.preventDefault();
                            e.stopPropagation();
                            node.classList.add('drag-over-table');
                        }
                    };

                    node.ondragleave = (e) => {
                        if (!document.body.classList.contains('ndf-is-dragging-table') && !document.body.classList.contains('ndf-is-dragging-folder')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        node.classList.remove('drag-over-table');
                    };

                    node.ondrop = (e) => {
                        if (!document.body.classList.contains('ndf-is-dragging-table') && !document.body.classList.contains('ndf-is-dragging-folder')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        node.classList.remove('drag-over-table');
                        try {
                            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                            const targetFolderId = active.map[tid] || null;
                            if (data.type === 'table' && data.id) {
                                if (targetFolderId) active.map[data.id] = targetFolderId;
                                else delete active.map[data.id];
                            } else if (data.type === 'folder' && data.id && data.id !== targetFolderId) {
                                if (!isDescendant(targetFolderId, data.id, indexes.parentByFolderId)) {
                                    const folder = active.folders.find(f => f.id === data.id);
                                    if (folder) folder.parentId = targetFolderId;
                                } else {
                                    alert('Logic error: Cannot drop a parent folder into its descendant!');
                                }
                            }
                            saveConfig();
                            triggerRebuild();
                        } catch(err) {
                            console.error("[NocoDB Folder] Table Drop Parsing Error:", err);
                        }
                    };
                }

                if (renderState) {
                    node.style.order = renderState.order;

                    // Keep root-level tables visually identical to NocoDB's native root table rows.
                    // They only need a flex order value for locale/numeric sorting.
                    if (renderState.folderId === null && renderState.depth === 0) {
                        node.classList.remove('ndf-table-nested');
                        node.style.removeProperty('--ndf-level');
                        node.style.removeProperty('--ndf-lines');
                        if (renderState.hidden) node.classList.add('ndf-item-collapsed'); else node.classList.remove('ndf-item-collapsed');
                    } else {
                        node.style.setProperty('--ndf-level', renderState.depth);

                        let activeDepths = renderState.activeDepths || [];
                        let shadowsToDraw = [...activeDepths];
                        if (renderState.depth > 0) shadowsToDraw.push(renderState.depth - 1);
                        const uniqueShadows = [...new Set(shadowsToDraw)];
                        const lineShadows = uniqueShadows.map(d => `calc(var(--ndf-base-pad) + ${d} * var(--ndf-indent) + 9px) 0 0 0 #d4d4d4`).join(', ');
                        node.style.setProperty('--ndf-lines', lineShadows || 'none');

                        node.classList.add('ndf-table-nested');
                        if (renderState.hidden) node.classList.add('ndf-item-collapsed'); else node.classList.remove('ndf-item-collapsed');
                    }
                } else {
                    node.classList.remove('ndf-table-nested');
                    node.style.removeProperty('--ndf-lines');
                    node.style.order = '';

                    if (searchQuery) {
                        const tName = tableNameMap[tid] || '';
                        if (tName.includes(searchQuery)) {
                            node.classList.remove('ndf-item-collapsed');
                        } else {
                            node.classList.add('ndf-item-collapsed');
                        }
                    } else {
                        node.classList.remove('ndf-item-collapsed');
                    }
                }
            });
        } finally {
            isRebuilding = false;
            if (observer) observer.observe(listRoot, { childList: true, subtree: true });
        }
    }

    const start = () => {
        const target = getListRoot();
        if (target) {
            if (observer) observer.disconnect(); // 防止重复绑定
            observer = new MutationObserver(() => triggerRebuild());
            observer.observe(target, { childList: true, subtree: true });
            triggerRebuild();
        } else {
            setTimeout(start, 1000);
        }
    };

    // 1. 初次加载时执行
    if (config.webdav.enabled) syncWebDAV('pull');
    start();

    // 记录当前所在的 Base ID
    let currentActiveBaseId = getBaseId();

    // 2. 监听单页应用 (SPA) 的路由变化
    const handleRouteChange = () => {
        const newBaseId = getBaseId();

        // 如果 Base ID 没变，说明只是在同一个 Base 里点击/切换表格，不需要销毁工具栏
        if (newBaseId === currentActiveBaseId) {
            triggerRebuild(); // 轻量级触发一次重绘即可
            return;
        }

        // 如果 Base ID 变了，说明是真的切库了，执行深度重置
        currentActiveBaseId = newBaseId;
        editingFolderId = null;
        document.querySelectorAll('.ndf-settings-panel, .ndf-popover-menu').forEach(node => node.remove());

        if (observer) observer.disconnect();
        const oldToolbar = document.getElementById('ndf-folder-toolbar-container');
        if (oldToolbar) oldToolbar.remove();

        setTimeout(start, 800);
    };

    // 劫持浏览器的 History API，为其注入自定义事件（带幂等保护）
    if (!window.__NDF_HISTORY_PATCHED__) {
        window.__NDF_HISTORY_PATCHED__ = true;
        (function(history){
            const pushState = history.pushState;
            history.pushState = function(state) {
                const ret = pushState.apply(history, arguments);
                window.dispatchEvent(new Event('ndf_locationchange'));
                return ret;
            };
            const replaceState = history.replaceState;
            history.replaceState = function(state) {
                const ret = replaceState.apply(history, arguments);
                window.dispatchEvent(new Event('ndf_locationchange'));
                return ret;
            };
            window.addEventListener('popstate', () => window.dispatchEvent(new Event('ndf_locationchange')));
        })(window.history);
    }

    // 监听我们注入的自定义路由变化事件
    window.addEventListener('ndf_locationchange', handleRouteChange);

})();

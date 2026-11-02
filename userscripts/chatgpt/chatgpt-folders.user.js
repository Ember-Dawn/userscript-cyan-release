// ==UserScript==
// @name         ChatGPT文件夹
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @version      2.0.9
// @description  ChatGPT 多级文件夹与 WebDAV 同步（TypeScript 重写）
// @author       ChatGPT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function(){'use strict';const registry={"model":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.natural = exports.defaultLocal = exports.uid = exports.copy = exports.blank = void 0;
exports.validate = validate;
exports.command = command;
exports.diff = diff;
const blank = () => ({ schema: 1, folders: {}, conversations: {} });
exports.blank = blank;
const copy = (v) => JSON.parse(JSON.stringify(v));
exports.copy = copy;
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
exports.uid = uid;
const defaultLocal = () => ({ data: (0, exports.blank)(), base: (0, exports.blank)(), preferences: { sidebarWidth: 312, customWidth: false }, dav: { url: '', username: '', password: '', file: 'chatgpt-folders-ts-v1.json' }, pending: [], baseRevision: 0, etag: null, conflicts: [] });
exports.defaultLocal = defaultLocal;
exports.natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function validate(data) {
    if (data?.schema !== 1 || !data.folders || !data.conversations || Array.isArray(data.folders) || Array.isArray(data.conversations))
        throw Error('不支持的数据格式');
    for (const [id, f] of Object.entries(data.folders)) {
        if (f.id !== id || typeof f.name !== 'string' || typeof f.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(f.color))
            throw Error('文件夹数据损坏');
        if (f.parentId !== null && !data.folders[f.parentId])
            throw Error('文件夹的父级不存在');
        const visited = new Set([id]);
        let parent = f.parentId;
        while (parent) {
            if (visited.has(parent))
                throw Error('检测到文件夹循环');
            visited.add(parent);
            parent = data.folders[parent]?.parentId ?? null;
        }
    }
    for (const [id, c] of Object.entries(data.conversations))
        if (c.id !== id || !data.folders[c.folderId] || typeof c.title !== 'string')
            throw Error('对话归属无效');
}
function command(data, change) {
    const d = (0, exports.copy)(data), now = Date.now();
    const f = change.id ? d.folders[change.id] : undefined;
    switch (change.type) {
        case 'folder.create': {
            if (change.parentId && !d.folders[change.parentId])
                throw Error('父文件夹不存在');
            const id = (0, exports.uid)();
            d.folders[id] = { id, parentId: change.parentId ?? null, name: (change.name ?? '新建文件夹').trim() || '新建文件夹', color: '#6b7280', collapsed: false, createdAt: now, updatedAt: now };
            break;
        }
        case 'folder.rename':
            if (!f)
                throw Error('文件夹不存在');
            f.name = (change.name ?? '').trim() || f.name;
            f.updatedAt = now;
            break;
        case 'folder.color':
            if (!f || !/^#[a-f0-9]{6}$/i.test(change.color ?? ''))
                throw Error('无效颜色');
            f.color = change.color;
            f.updatedAt = now;
            break;
        case 'folder.collapse':
            if (!f)
                throw Error('文件夹不存在');
            f.collapsed = !f.collapsed;
            f.updatedAt = now;
            break;
        case 'folder.move':
            if (!f)
                throw Error('文件夹不存在');
            if (change.parentId && !d.folders[change.parentId])
                throw Error('目标文件夹不存在');
            f.parentId = change.parentId ?? null;
            f.updatedAt = now;
            break;
        case 'folder.delete': {
            if (!f)
                throw Error('文件夹不存在');
            const ids = new Set([f.id]);
            let old = 0;
            while (ids.size !== old) {
                old = ids.size;
                for (const x of Object.values(d.folders))
                    if (x.parentId && ids.has(x.parentId))
                        ids.add(x.id);
            }
            for (const id of ids)
                delete d.folders[id];
            for (const c of Object.values(d.conversations))
                if (ids.has(c.folderId))
                    delete d.conversations[c.id];
            break;
        }
        case 'conversation.assign': {
            const id = change.id, folderId = change.folderId;
            if (!d.folders[folderId])
                throw Error('目标文件夹不存在');
            const prev = d.conversations[id];
            d.conversations[id] = { id, folderId, title: change.title || prev?.title || '未命名对话', addedAt: prev?.addedAt || now, updatedAt: now };
            break;
        }
        case 'conversation.remove':
            delete d.conversations[change.id];
            break;
        case 'conversation.title':
            if (d.conversations[change.id]) {
                d.conversations[change.id].title = change.title ?? '';
                d.conversations[change.id].updatedAt = now;
            }
            break;
        default: throw Error('未知业务命令');
    }
    validate(d);
    return d;
}
function diff(before, after, device, sequence) {
    const result = [];
    for (const type of ['folder', 'conversation']) {
        const a = type === 'folder' ? before.folders : before.conversations, b = type === 'folder' ? after.folders : after.conversations;
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
            if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
                result.push({ id: (0, exports.uid)(), device, seq: ++sequence, time: Date.now(), type: `${type}.${b[key] ? 'upsert' : 'delete'}`, key, ...(b[key] ? { value: (0, exports.copy)(b[key]) } : {}) });
            }
    }
    return result;
}

},
"sync":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.merge = merge;
exports.davRequest = davRequest;
exports.decodeRemote = decodeRemote;
exports.createRemote = createRemote;
exports.addPending = addPending;
const model_1 = require("./model");
/* Merge each changed field against a shared snapshot, with deletion winning and
   a deterministic tie-break on conflicting same-field values. */
function merge(base, local, remote) {
    (0, model_1.validate)(base);
    (0, model_1.validate)(local);
    (0, model_1.validate)(remote);
    const result = (0, model_1.blank)(), conflicts = [];
    const mergeSet = (kind, b, l, r) => {
        const out = {};
        for (const id of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
            const bv = b[id], lv = l[id], rv = r[id];
            if (!bv) {
                if (lv && rv) {
                    if (JSON.stringify(lv) !== JSON.stringify(rv))
                        conflicts.push(`${kind}:${id}:concurrent-create`);
                    out[id] = (0, model_1.copy)(JSON.stringify(lv) < JSON.stringify(rv) ? lv : rv);
                }
                else if (lv || rv)
                    out[id] = (0, model_1.copy)((lv || rv));
                continue;
            }
            if (!lv || !rv) {
                if (lv !== rv) {
                    conflicts.push(`${kind}:${id}:delete-vs-edit`);
                    if (kind === 'conversation') {
                        const surviving = lv || rv;
                        if (surviving && JSON.stringify(surviving) !== JSON.stringify(bv))
                            out[id] = (0, model_1.copy)(surviving);
                    }
                }
                continue;
            }
            const v = {};
            for (const field of new Set([...Object.keys(bv), ...Object.keys(lv), ...Object.keys(rv)])) {
                const old = bv[field], a = lv[field], z = rv[field];
                if (JSON.stringify(a) === JSON.stringify(z))
                    v[field] = a;
                else if (JSON.stringify(a) === JSON.stringify(old))
                    v[field] = z;
                else if (JSON.stringify(z) === JSON.stringify(old))
                    v[field] = a;
                else {
                    v[field] = JSON.stringify(a) < JSON.stringify(z) ? a : z;
                    conflicts.push(`${kind}:${id}:${field}`);
                }
            }
            out[id] = v;
        }
        return out;
    };
    result.folders = mergeSet('folder', base.folders, local.folders, remote.folders);
    result.conversations = mergeSet('conversation', base.conversations, local.conversations, remote.conversations);
    // Concurrent moves may form a cycle; normalize to root deterministically.
    for (const f of Object.values(result.folders))
        if (f.parentId && !result.folders[f.parentId]) {
            conflicts.push(`folder:${f.id}:missing-parent`);
            f.parentId = null;
        }
    for (const id of Object.keys(result.folders).sort()) {
        const f = result.folders[id], visited = new Set([id]);
        let p = f.parentId;
        while (p) {
            if (visited.has(p)) {
                conflicts.push(`folder:${id}:cycle`);
                f.parentId = null;
                break;
            }
            visited.add(p);
            p = result.folders[p]?.parentId ?? null;
        }
    }
    // Never silently discard an assignment during delete-vs-move conflicts.
    // Attach unresolved conversation references to a stable recovery folder.
    const orphans = Object.values(result.conversations).filter(c => !result.folders[c.folderId]);
    if (orphans.length) {
        const recoveryId = 'cgfm-recovered-conversations';
        if (!result.folders[recoveryId])
            result.folders[recoveryId] = { id: recoveryId, parentId: null, name: '冲突恢复的对话', color: '#d97706', collapsed: false, createdAt: 0, updatedAt: 0 };
        for (const c of orphans) {
            conflicts.push(`conversation:${c.id}:orphan:${c.folderId}`);
            c.folderId = recoveryId;
        }
    }
    (0, model_1.validate)(result);
    return { data: result, conflicts };
}
function davRequest(config, method, extra = {}, body) {
    const path = config.url.replace(/\/+$/, '') + '/' + encodeURIComponent(config.file || 'chatgpt-folders-ts-v1.json');
    if (!/^https:\/\//i.test(path))
        return Promise.reject(Error('WebDAV 必须使用 HTTPS'));
    return new Promise((resolve, reject) => {
        const headers = { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${config.username}:${config.password}`))), ...extra };
        if (body !== undefined)
            headers['Content-Type'] = 'application/json; charset=utf-8';
        GM_xmlhttpRequest({ method, url: path, headers, data: body, timeout: 20000, onload: (r) => {
                const rawEtag = (r.responseHeaders || '').match(/^etag:\s*(.+)$/im)?.[1]?.trim() ?? null;
                let etag = null;
                if (rawEtag) {
                    etag = rawEtag.replace(/^W\//i, '').replace(/-gzip(?="?$)/i, '').replace(/-br(?="?$)/i, '').trim();
                    if (!etag.startsWith('"'))
                        etag = `"${etag}"`;
                }
                resolve({ status: r.status, text: String(r.responseText || ''), etag });
            }, onerror: () => reject(Error('WebDAV 网络错误')), ontimeout: () => reject(Error('WebDAV 请求超时')) });
    });
}
function decodeRemote(raw, account) {
    const e = JSON.parse(raw);
    if (e.protocol !== 'cgfm-ts' || e.version !== 1 || e.account !== account || !Number.isSafeInteger(e.revision))
        throw Error('云端文件版本或账号不匹配');
    (0, model_1.validate)(e.data);
    return e;
}
function createRemote(account, device, revision, data) {
    return { protocol: 'cgfm-ts', version: 1, account, revision, writer: device, data: (0, model_1.copy)(data) };
}
function addPending(old, newItems) { return [...old, ...newItems].slice(-5000); }

},
"icons":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.icon = icon;
// Lucide official SVG path data, from https://github.com/lucide-icons/lucide/tree/main/icons
// Use original paths without external runtime dependencies.
const paths = {
    "folder-plus": "<path d=\"M12 10v6\"/><path d=\"M9 13h6\"/><path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>",
    "refresh-cw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"/><path d=\"M8 16H3v5\"/>",
    "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
    "pin": "<path d=\"M12 17v5\"/><path d=\"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z\"/>",
    "pin-off": "<path d=\"M12 17v5\"/><path d=\"M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89\"/><path d=\"m2 2 20 20\"/><path d=\"M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11\"/>",
    "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>",
    "message-circle": "<path d=\"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719\"/>",
    "chevron-right": "<path d=\"m9 18 6-6-6-6\"/>",
    "chevron-down": "<path d=\"m6 9 6 6 6-6\"/>",
    "ellipsis": "<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/><circle cx=\"5\" cy=\"12\" r=\"1\"/>",
    "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
    "eye-off": "<path d=\"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49\"/><path d=\"M14.084 14.158a3 3 0 0 1-4.242-4.242\"/><path d=\"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143\"/><path d=\"m2 2 20 20\"/>",
    "x": "<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>",
    "download": "<path d=\"M12 15V3\"/><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><path d=\"m7 10 5 5 5-5\"/>",
    "upload": "<path d=\"M12 3v12\"/><path d=\"m17 8-5-5-5 5\"/><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/>",
    "pencil": "<path d=\"M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z\"/><path d=\"m15 5 4 4\"/>",
    "palette": "<circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><path d=\"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z\"/>",
    "trash-2": "<path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\"/><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\"/>",
    "folder-input": "<path d=\"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1\"/><path d=\"M2 13h10\"/><path d=\"m9 10 3 3-3 3\"/>"
};
function icon(name) {
    const body = paths[name];
    if (!body)
        throw Error('Unknown Lucide icon: ' + name);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

},
"runtime":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderApplication = void 0;
const model_1 = require("./model");
const sync_1 = require("./sync");
const icons_1 = require("./icons");
const style = `
#cgfm-next-root .cgfm-head button{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;padding:5px;color:var(--cg-text)}#cgfm-next-root .cgfm-head button svg{width:17px;height:17px}#cgfm-next-root .cgfm-head button[data-act="pin"][aria-pressed="true"]{color:#2876db;background:rgba(59,130,246,.15)}#cgfm-next-root .cgfm-head button[data-act="sync"][aria-busy="true"] svg{animation:cgfm-spin 1s linear infinite}@keyframes cgfm-spin{to{transform:rotate(360deg)}}
#cgfm-next-root .cgfm-head button[data-sync-state="synced"]{color:#16856b}#cgfm-next-root .cgfm-head button[data-sync-state="pending"]{color:#c48b29}#cgfm-next-root .cgfm-head button[data-sync-state="syncing"]{color:#2876db}#cgfm-next-root .cgfm-head button[data-sync-state="error"]{color:#d14b4b}#cgfm-next-root .cgfm-head button[data-sync-state="unconfigured"]{color:var(--cg-muted)}#cgfm-next-root .cgfm-head .cgfm-head-title{font-size:12px;font-weight:600;opacity:.7;padding-left:3px;user-select:none;flex:1}#cgfm-next-root .cgfm-row button svg{width:16px;height:16px}
#cgfm-next-root .cgfm-pop.cgfm-settings{width:min(420px,calc(100vw - 24px));max-width:calc(100vw - 24px)!important;min-width:0!important;max-height:calc(100dvh - 24px);overflow-y:auto;overscroll-behavior:contain;padding:0;border-radius:12px;box-shadow:0 18px 42px var(--cg-shadow);border:1px solid var(--cg-border)}
#cgfm-next-root .cgfm-settings-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--cg-border);position:sticky;top:0;background:var(--cg-bg);z-index:1}
#cgfm-next-root .cgfm-settings-header strong{font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--cg-text)}
#cgfm-next-root .cgfm-settings-close{width:28px;height:28px;padding:0;margin:0;border:0;border-radius:6px;background:transparent;color:var(--cg-muted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s ease,color .15s ease}
#cgfm-next-root .cgfm-settings-close:hover{background:var(--cg-hover);color:var(--cg-text)}
#cgfm-next-root .cgfm-settings-close svg{width:16px;height:16px}
#cgfm-next-root .cgfm-settings-body{padding:16px;display:flex;flex-direction:column;gap:16px}
#cgfm-next-root .cgfm-settings-section{padding:0;margin:0}
#cgfm-next-root .cgfm-settings-section h3{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--cg-muted);margin:0 0 10px}
#cgfm-next-root .cgfm-settings label{display:flex;flex-direction:column;gap:5px;margin:0 0 11px;font-size:12px;color:var(--cg-muted)}
#cgfm-next-root .cgfm-settings input:not([type=checkbox]):not([type=range]){height:36px;padding:7px 10px;font-size:13px;color:var(--cg-text);min-width:0;border-radius:6px}
#cgfm-next-root .cgfm-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#cgfm-next-root .cgfm-settings-grid>*{min-width:0}
#cgfm-next-root .cgfm-settings-actions{display:flex;gap:8px;flex-wrap:wrap}
#cgfm-next-root .cgfm-settings-actions button{margin:0;padding:7px 14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--cg-border);border-radius:7px;background:var(--cg-hover);color:var(--cg-text);font-size:13px;font-weight:500;cursor:pointer;transition:all .15s ease}
#cgfm-next-root .cgfm-settings-actions button:hover{background:var(--cg-input);border-color:var(--cg-muted)}
#cgfm-next-root .cgfm-settings-actions button:disabled{opacity:.5;cursor:not-allowed}
#cgfm-next-root .cgfm-settings-actions button svg{width:15px;height:15px}
#cgfm-next-root .cgfm-settings-actions.cgfm-data-actions{display:flex;flex-wrap:nowrap;gap:8px}
#cgfm-next-root .cgfm-settings-actions.cgfm-data-actions button{padding:8px 10px;white-space:nowrap;font-size:13px;font-weight:500;flex:1;justify-content:center;border:1px solid var(--cg-border);border-radius:7px}
#cgfm-next-root .cgfm-settings-row-between{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
#cgfm-next-root .cgfm-width-val{font-size:13px;font-weight:600;color:var(--cg-text)}
#cgfm-next-root .cgfm-dav-status{padding:8px 12px;margin-top:10px;border-radius:8px;font-size:12px;border:1px solid var(--cg-border);background:var(--cg-hover);color:var(--cg-text);overflow-wrap:anywhere;display:flex;align-items:center;gap:6px}
#cgfm-next-root .cgfm-dav-status[data-type="success"]{border-color:#16856b;color:#16856b;background:rgba(22,133,107,.1)}
#cgfm-next-root .cgfm-dav-status[data-type="error"]{border-color:#d14b4b;color:#d14b4b;background:rgba(209,75,75,.1)}
#cgfm-next-root .cgfm-dav-status[data-type="loading"]{border-color:#2876db;color:#2876db;background:rgba(40,118,219,.1)}
#cgfm-next-root .cgfm-dav-status svg{width:15px;height:15px;animation:cgfm-spin 1s linear infinite}
#cgfm-next-root .cgfm-settings-footer{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:12px 16px;position:sticky;bottom:0;background:var(--cg-bg);z-index:1;border-top:1px solid var(--cg-border)}
#cgfm-next-root .cgfm-settings-footer .cgfm-btn-cancel{margin:0;padding:8px 15px;border:1px solid var(--cg-border);border-radius:7px;background:transparent;color:var(--cg-text);font-size:13px;font-weight:500;cursor:pointer;transition:background .15s ease}
#cgfm-next-root .cgfm-settings-footer .cgfm-btn-cancel:hover{background:var(--cg-hover)}
#cgfm-next-root .cgfm-settings-footer .cgfm-btn-save{margin:0;padding:8px 18px;border:1px solid #2876db;border-radius:7px;background:#2876db;color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .15s ease}
#cgfm-next-root .cgfm-settings-footer .cgfm-btn-save:hover{opacity:.9}
#cgfm-next-root .cgfm-settings .cgfm-danger{color:#b45309}
#cgfm-next-root .cgfm-settings-result{padding:9px 12px;margin:0 16px 10px;border:1px solid var(--cg-border);border-radius:8px;color:var(--cg-text);background:var(--cg-hover);font-size:12px;overflow-wrap:anywhere}
#cgfm-next-root .cgfm-password-wrap{position:relative;display:flex;align-items:center;min-width:0}
#cgfm-next-root .cgfm-password-wrap input{padding-right:42px!important;min-width:0}
#cgfm-next-root .cgfm-password-wrap button{position:absolute;right:4px;top:50%;transform:translateY(-50%);margin:0;width:30px;height:30px;display:grid;place-items:center;border:0;background:transparent}
#cgfm-next-root .cgfm-password-wrap button svg{width:17px;height:17px}
#cgfm-next-root .cgfm-settings input{min-width:0}
#cgfm-next-root .cgfm-settings input[type=range]{width:100%;height:18px;padding:0;accent-color:#2876db;cursor:pointer}
#cgfm-next-root .cgfm-settings .cgfm-slider-line{display:flex;justify-content:space-between;color:var(--cg-muted);font-size:11px}
#cgfm-next-root .cgfm-pop.cgfm-menu-box{min-width:160px;max-width:240px;padding:4px;border-radius:10px;box-shadow:0 12px 32px var(--cg-shadow);border:1px solid var(--cg-border);background:var(--cg-bg);display:flex;flex-direction:column;gap:1px}
#cgfm-next-root .cgfm-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0!important;border-radius:6px;background:transparent;color:var(--cg-text);font-size:13px;cursor:pointer;text-align:left;transition:background .12s ease,color .12s ease;user-select:none;margin:0!important}
#cgfm-next-root .cgfm-menu-item:hover{background:var(--cg-hover)}
#cgfm-next-root .cgfm-menu-item.cgfm-menu-danger{color:#ef4444}
#cgfm-next-root .cgfm-menu-item.cgfm-menu-danger:hover{background:rgba(239,68,68,.12);color:#dc2626}
#cgfm-next-root .cgfm-menu-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:inherit;opacity:.85}
#cgfm-next-root .cgfm-menu-icon svg{width:15px;height:15px}
#cgfm-next-root .cgfm-menu-divider{height:1px;margin:4px 0;background:var(--cg-border)}
#cgfm-next-root .cgfm-menu-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cgfm-next-root .cgfm-menu-arrow{display:inline-flex;align-items:center;opacity:.5;margin-left:auto}
#cgfm-next-root .cgfm-menu-arrow svg{width:14px;height:14px}
#cgfm-next-root .cgfm-pop.cgfm-submenu{position:fixed;z-index:2147483002;padding:6px;min-width:auto;border-radius:10px;box-shadow:0 12px 32px var(--cg-shadow);border:1px solid var(--cg-border);background:var(--cg-bg)}
#cgfm-next-root .cgfm-color-grid{display:grid;grid-template-columns:repeat(5,22px);gap:6px;padding:2px}
#cgfm-next-root .cgfm-color-dot{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;outline:none;transition:transform .12s ease,border-color .12s ease}
#cgfm-next-root .cgfm-color-dot:hover{transform:scale(1.18);border-color:var(--cg-text)}
#cgfm-next-root .cgfm-color-dot.cgfm-color-active{border-color:var(--cg-text);box-shadow:0 0 0 1.5px var(--cg-bg)}
#cgfm-next-root .cgfm-confirm-title{font-size:13px;font-weight:600;margin-bottom:6px;color:var(--cg-text)}
#cgfm-next-root .cgfm-confirm-desc{font-size:12px;color:var(--cg-muted);line-height:1.45;margin-bottom:12px}
#cgfm-next-root .cgfm-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
#cgfm-next-root .cgfm-confirm-actions button{margin:0;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;transition:opacity .15s}
#cgfm-next-root .cgfm-confirm-actions .cgfm-btn-danger{border:1px solid #ef4444;background:#ef4444;color:#fff}
#cgfm-next-root .cgfm-confirm-actions .cgfm-btn-danger:hover{opacity:.9}
#cgfm-next-root .cgfm-confirm-actions .cgfm-btn-save{border:1px solid #2876db;background:#2876db;color:#fff}
#cgfm-next-root .cgfm-confirm-actions .cgfm-btn-save:hover{opacity:.9}
#cgfm-next-root .cgfm-confirm-actions .cgfm-btn-cancel{border:1px solid var(--cg-border);background:transparent;color:var(--cg-text)}
#cgfm-next-root .cgfm-confirm-actions .cgfm-btn-cancel:hover{background:var(--cg-hover)}

#cgfm-next-root{position:fixed;z-index:2147483000;top:72px;left:64px;font:13px/1.45 system-ui;color:var(--cg-text);--cg-bg:#f4f4f2;--cg-text:#0d0d0d;--cg-muted:#656565;--cg-border:#d4d4d2;--cg-hover:#e8e8e6;--cg-input:#fff;--cg-shadow:#0002}
html[data-cgfm-theme="dark"] #cgfm-next-root{--cg-bg:#212121;--cg-text:#ececec;--cg-muted:#b4b4b4;--cg-border:#424242;--cg-hover:#343434;--cg-input:#2b2b2b;--cg-shadow:#0007}
#cgfm-next-root *{box-sizing:border-box}#cgfm-next-rail-entry{display:flex;align-items:center;justify-content:center;width:100%;flex:none}#cgfm-next-rail{display:flex;align-items:center;justify-content:center;width:36px;height:36px;padding:8px;border:0;border-radius:10px;background:transparent;color:var(--text-secondary,var(--token-text-tertiary,currentColor));cursor:pointer}#cgfm-next-rail:hover,#cgfm-next-rail[data-cgfm-open="true"]{background:var(--sidebar-surface-secondary,rgba(128,128,128,.14));color:var(--text-primary,currentColor)}#cgfm-next-rail svg{width:20px;height:20px;fill:none;stroke:#3A83F7;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}#cgfm-next-launch{background:var(--cg-bg);border:1px solid var(--cg-border);border-radius:12px;padding:10px;cursor:pointer}
#cgfm-next-panel{position:absolute;top:0;left:45px;width:330px;max-height:100dvh;display:none;flex-direction:column;background:var(--cg-bg);border:1px solid var(--cg-border);border-radius:14px;box-shadow:0 8px 36px var(--cg-shadow);overflow:hidden}
#cgfm-next-root[data-open="yes"] #cgfm-next-panel{display:flex}.cgfm-head{display:flex;align-items:center;gap:3px;padding:6px 9px 4px}
.cgfm-scroll{overflow:auto;flex:1;min-height:70px;padding:7px}.cgfm-row{min-height:32px;display:flex;align-items:center;gap:5px;border-radius:7px;padding:2px 5px;cursor:pointer;user-select:none}.cgfm-row:hover,.cgfm-row.cgfm-selected{background:var(--cg-hover)}.cgfm-row.cgfm-drop{outline:2px solid #70a6f0}
.cgfm-item-icon{display:flex;align-items:center;justify-content:center;width:20px;min-width:20px;height:20px}.cgfm-item-icon svg{width:20px;height:20px;stroke-width:2}.cgfm-row span.cgfm-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.cgfm-row button,.cgfm-head button{border:0;color:inherit;background:transparent;cursor:pointer;border-radius:6px;padding:4px 6px}.cgfm-row button:hover,.cgfm-head button:hover{background:#8884}
.cgfm-group{padding:9px 7px 4px;font-size:12px;opacity:.65}.cgfm-pop{background:var(--cg-bg);border:1px solid var(--cg-border);border-radius:10px;padding:12px;box-shadow:0 8px 30px var(--cg-shadow);color:var(--cg-text)}.cgfm-pop input,.cgfm-pop select{color:var(--cg-text);background:var(--cg-input);border:1px solid var(--cg-border);padding:6px;border-radius:6px;width:100%}.cgfm-pop input[type=checkbox]{width:auto}.cgfm-pop label{display:block;margin:7px 0}.cgfm-pop:not(.cgfm-menu-box):not(.cgfm-settings) button{margin:3px;border:1px solid var(--cg-border);border-radius:6px;padding:6px;background:transparent;color:inherit;cursor:pointer}.cgfm-muted{color:var(--cg-muted);font-size:11px}.cgfm-foot{padding:7px 11px;border-top:1px solid var(--cg-border);font-size:11px;cursor:pointer}
`;
class FolderApplication {
    account = '';
    profile = (0, model_1.defaultLocal)();
    device = '';
    railButton = null;
    railEntry = null;
    closeTimer = 0;
    root;
    panel;
    list;
    status;
    launch;
    readOnly = false;
    pinned = false;
    hovered = false;
    selected = null;
    editId = null;
    busy = false;
    dirty = false;
    recent = [];
    apiAt = 0;
    lastRefresh = 0;
    syncFailures = 0;
    syncRetryAt = 0;
    authFailure = false;
    timer = 0;
    observer = null;
    listener = 0;
    generation = 0;
    drag = null;
    popup = null;
    suppressClickUntil = 0;
    ghost = null;
    authHeaders = {};
    authInstalled = false;
    themeObserver = null;
    recoveryQueued = false;
    recovering = false;
    collapsedLocal = {};
    start() { this.device = GM_getValue('cgfm.next.device', '') || (0, model_1.uid)(); GM_setValue('cgfm.next.device', this.device); this.account = this.detectAccount(); this.load(); this.loadCollapsed(); this.loadTitleGuards(); this.restoreAuth(); this.build(); this.updateTheme(); this.installAuthCapture(); this.bindGlobal(); this.scanRecents(); this.render(); this.timer = window.setInterval(() => { this.checkAccount(); if (Date.now() - this.lastRefresh > 30000) {
        this.lastRefresh = Date.now();
        if (this.isOpen())
            this.scanRecents();
    } if (this.profile.dav.url && document.visibilityState === 'visible')
        void this.sync(false); }, 30000); window.setTimeout(() => { this.checkAccount(); this.mountRail(); }, 1500); }
    updateTheme() { const html = document.documentElement; const scheme = getComputedStyle(html).colorScheme; const dark = html.classList.contains('dark') || html.getAttribute('data-theme') === 'dark' || (scheme === 'dark' && !html.classList.contains('light')); html.dataset.cgfmTheme = dark ? 'dark' : 'light'; }
    key() { return `cgfm.next.account.${this.account}`; }
    detectAccount() {
        try {
            const boot = document.getElementById('client-bootstrap')?.textContent;
            if (boot) {
                const value = JSON.parse(boot);
                const user = value.session?.user || value.user, account = value.session?.account || value.account;
                const id = account?.id || user?.email || user?.id;
                if (id) {
                    const key = `acct:${id}`;
                    GM_setValue('cgfm.next.lastAccount', key);
                    return key;
                }
            }
        }
        catch { }
        const html = document.documentElement;
        const themed = html?.getAttribute('data-theme-account-id') || html?.getAttribute('data-theme-user-id');
        if (themed) {
            const key = `acct:${themed}`;
            GM_setValue('cgfm.next.lastAccount', key);
            return key;
        }
        const w = unsafeWindow;
        const id = w.__NEXT_DATA__?.props?.pageProps?.user?.id || document.querySelector('[data-account-id]')?.dataset.accountId;
        if (id) {
            const key = `acct:${id}`;
            GM_setValue('cgfm.next.lastAccount', key);
            return key;
        }
        return 'local';
    }
    checkAccount() { const next = this.detectAccount(); if (next === this.account)
        return; this.generation++; this.account = next; this.busy = false; this.recent = []; this.selected = null; this.dismissPopup(); this.load(); this.loadCollapsed(); this.loadTitleGuards(); this.restoreAuth(); this.render(); }
    load() {
        this.readOnly = false;
        if (this.listener)
            GM_removeValueChangeListener(this.listener);
        const raw = GM_getValue(this.key(), null);
        const fresh = (0, model_1.defaultLocal)();
        if (raw && typeof raw === 'object') {
            const v = raw;
            try {
                if (v.data)
                    (0, model_1.validate)(v.data);
                if (v.base)
                    (0, model_1.validate)(v.base);
                this.profile = { ...fresh, ...v, preferences: { ...fresh.preferences, ...v.preferences }, dav: { ...fresh.dav, ...v.dav } };
            }
            catch (e) {
                console.error('[CGFM] local validation failed', e);
                this.profile = fresh;
                this.notice('本地数据损坏：已暂停本地写入，请先备份并修复存储');
                this.readOnly = true;
            }
        }
        else
            this.profile = fresh;
        if (this.profile.dav.file === 'chatgpt-folders-ts-v1.json') {
            let h = 2166136261;
            for (const char of this.account) {
                h ^= char.charCodeAt(0);
                h = Math.imul(h, 16777619);
            }
            this.profile.dav.file = `chatgpt-folders-ts-${(h >>> 0).toString(16)}.json`;
        }
        this.dirty = this.profile.pending.length > 0;
        this.listener = GM_addValueChangeListener(this.key(), (_k, _a, value, remote) => { if (!remote || !value)
            return; try {
            const other = value;
            (0, model_1.validate)(other.data);
            const m = (0, sync_1.merge)(this.profile.base, this.profile.data, other.data);
            const pending = [...(other.pending || []), ...this.profile.pending].filter((x, i, a) => a.findIndex(y => y.id === x.id) === i);
            const differs = JSON.stringify(other.data) !== JSON.stringify(m.data);
            this.profile = { ...other, data: m.data, pending, conflicts: [...new Set([...(other.conflicts || []), ...m.conflicts])] };
            if (differs) {
                this.profile.pending.push(...(0, model_1.diff)(other.data, m.data, this.device, this.profile.pending.length));
                this.persist();
                this.scheduleSync();
            }
            this.render();
        }
        catch (e) {
            console.error('[CGFM] cross tab merge', e);
        } });
    }
    loadCollapsed() { const value = GM_getValue('cgfm.next.collapsed.' + this.account, {}); this.collapsedLocal = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    toggleCollapsed(id) { const folder = this.profile.data.folders[id]; if (!folder)
        return; this.collapsedLocal[id] = !(this.collapsedLocal[id] ?? folder.collapsed); GM_setValue('cgfm.next.collapsed.' + this.account, this.collapsedLocal); this.render(); }
    isCollapsed(folder) { return this.collapsedLocal[folder.id] ?? folder.collapsed; }
    persist() { if (this.readOnly)
        throw Error('本地数据损坏，写入被保护'); GM_setValue(this.key(), this.profile); this.dirty = this.profile.pending.length > 0; this.renderStatus(); }
    apply(c) { try {
        if (this.readOnly)
            throw Error('本地数据损坏，写入被保护');
        const before = this.profile.data;
        const next = (0, model_1.command)(before, c);
        this.profile.data = next;
        this.profile.pending.push(...(0, model_1.diff)(before, next, this.device, this.profile.pending.length));
        this.persist();
        this.render();
        this.scheduleSync();
    }
    catch (e) {
        this.notice(String(e));
    } }
    scheduleSync() { if (!this.profile.dav.url)
        return; window.clearTimeout(this.syncDelay); this.syncDelay = window.setTimeout(() => void this.sync(false), 12000); }
    syncDelay = 0;
    build() {
        const s = document.createElement('style');
        s.textContent = style;
        s.dataset.cgfmStyle = '1';
        (document.head || document.documentElement).append(s);
        this.root = document.createElement('div');
        this.root.id = 'cgfm-next-root';
        this.root.dataset.cgfmNextRoot = '1';
        this.root.innerHTML = `<button id="cgfm-next-launch" title="ChatGPT 文件夹">${(0, icons_1.icon)('folder')}</button><section id="cgfm-next-panel"><div class="cgfm-head"><span class="cgfm-head-title">文件夹</span><button data-act="create" title="新建文件夹" aria-label="新建文件夹">${(0, icons_1.icon)('folder-plus')}</button><button data-act="sync" title="立即同步" aria-label="立即同步">${(0, icons_1.icon)('refresh-cw')}</button><button data-act="settings" title="设置" aria-label="设置">${(0, icons_1.icon)('settings')}</button><button data-act="pin" title="固定面板" aria-label="固定面板" aria-pressed="false">${(0, icons_1.icon)('pin-off')}</button></div><div class="cgfm-scroll"></div><div class="cgfm-foot"></div></section>`;
        document.body.append(this.root);
        this.panel = this.root.querySelector('#cgfm-next-panel');
        this.list = this.root.querySelector('.cgfm-scroll');
        this.status = this.root.querySelector('.cgfm-foot');
        this.launch = this.root.querySelector('#cgfm-next-launch');
        this.panel.style.width = (this.profile.preferences.sidebarWidth || 330) + 'px';
        this.launch.addEventListener('click', () => { this.ensureMounted(); this.pinned = !this.pinned; this.updateOpen(); });
        this.launch.addEventListener('mouseenter', () => { this.hovered = true; this.updateOpen(); });
        this.launch.addEventListener('mouseleave', () => { this.hovered = false; window.setTimeout(() => this.updateOpen(), 280); });
        this.panel.addEventListener('pointerenter', () => { window.clearTimeout(this.closeTimer); this.hovered = true; this.updateOpen(); });
        this.panel.addEventListener('pointerleave', () => this.scheduleClose());
        this.panel.addEventListener('click', e => this.click(e));
        this.panel.addEventListener('contextmenu', e => this.context(e));
        this.panel.addEventListener('pointerdown', e => this.dragStart(e));
        this.panel.addEventListener('pointermove', e => this.dragMove(e));
        this.panel.addEventListener('pointerup', e => this.dragEnd(e));
        this.panel.addEventListener('pointercancel', () => this.cancelDrag());
        this.mountRail();
    }
    scheduleClose() { window.clearTimeout(this.closeTimer); this.closeTimer = window.setTimeout(() => { const buttonHover = !!this.railButton?.matches(':hover'); const panelHover = !!this.panel?.matches(':hover'); this.hovered = buttonHover || panelHover || !!this.launch?.matches(':hover'); this.updateOpen(); }, 230); }
    // Reattach existing elements instead of rebuilding them and losing listeners or editor state.
    ensureMounted() {
        if (this.recovering || !document.body)
            return;
        this.recovering = true;
        try {
            if (!this.root.isConnected) {
                document.body.append(this.root);
                console.info('[CGFM] Restored detached panel root');
            }
            if (this.panel.parentElement !== this.root)
                this.root.append(this.panel);
            if (this.launch.parentElement !== this.root)
                this.root.prepend(this.launch);
            if (this.list.parentElement !== this.panel)
                this.panel.append(this.list);
            if (this.status.parentElement !== this.panel)
                this.panel.append(this.status);
        }
        finally {
            this.recovering = false;
        }
    }
    queueRecovery() {
        if (this.recoveryQueued)
            return;
        this.recoveryQueued = true;
        queueMicrotask(() => {
            this.recoveryQueued = false;
            if (!document.body)
                return;
            const missing = !this.root.isConnected || !this.panel.isConnected || !this.launch.isConnected;
            if (missing)
                this.ensureMounted();
            if (!this.railEntry?.isConnected || missing)
                this.mountRail();
        });
    }
    mountRail() {
        this.ensureMounted();
        // Preserve the original rail mount: the plain navigation group below the three-dot item.
        // Never append to arbitrary <nav> elements (which may contain the account footer).
        const rail = document.querySelector('#app-shell-sidebar nav[data-app-navigation-rail="true"]');
        const host = rail?.querySelector('[data-appearance="plain"]');
        if (!host || !rail?.getBoundingClientRect().width) {
            this.railEntry?.remove();
            this.launch.style.display = '';
            this.root.style.left = '52px';
            this.root.style.top = '72px';
            this.panel.style.left = '0';
            return;
        }
        if (!this.railButton) {
            const entry = document.createElement('div');
            entry.id = 'cgfm-next-rail-entry';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'cgfm-next-rail';
            btn.title = '文件夹（悬停打开，点击固定）';
            btn.setAttribute('aria-label', '文件夹');
            btn.innerHTML = (0, icons_1.icon)('folder');
            btn.addEventListener('pointerenter', () => { this.ensureMounted(); window.clearTimeout(this.closeTimer); this.hovered = true; this.updateOpen(); });
            btn.addEventListener('pointerleave', () => this.scheduleClose());
            btn.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); this.ensureMounted(); window.clearTimeout(this.closeTimer); this.pinned = !this.pinned; this.updateOpen(); if (!this.pinned)
                this.scheduleClose(); });
            entry.append(btn);
            this.railButton = btn;
            this.railEntry = entry;
        }
        if (this.railEntry?.parentElement !== host)
            host.append(this.railEntry);
        this.launch.style.display = 'none';
        const r = rail.getBoundingClientRect();
        this.root.style.left = `${Math.max(0, Math.round(r.right))}px`;
        this.root.style.top = '0px';
        this.panel.style.top = '0px';
        this.panel.style.left = '0px';
        this.panel.style.height = '100dvh';
        this.panel.style.maxHeight = '100dvh';
        this.railButton.setAttribute('aria-expanded', this.isOpen() ? 'true' : 'false');
    }
    bindGlobal() { document.addEventListener('keydown', e => { if (e.key === 'Escape') {
        this.cancelDrag();
        this.dismissPopup();
        if (!this.editId) {
            this.pinned = false;
            this.updateOpen();
        }
    } }); document.addEventListener('click', e => { if (this.popup && !this.popup.contains(e.target) && !e.target.closest('#cgfm-next-panel'))
        this.dismissPopup(); }); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') {
        this.checkAccount();
        this.ensureMounted();
        this.mountRail();
        this.scanRecents();
    } }); window.addEventListener('popstate', () => { this.checkAccount(); this.scanRecents(); }); window.addEventListener('online', () => this.scheduleSync()); this.observer = new MutationObserver(() => this.queueRecovery()); this.observer.observe(document.documentElement, { childList: true, subtree: true }); this.themeObserver = new MutationObserver(() => this.updateTheme()); this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] }); window.setInterval(() => { this.ensureMounted(); this.mountRail(); this.width(); }, 10000); this.width(); }
    updateOpen() { this.ensureMounted(); const pinButton = this.panel.querySelector('[data-act="pin"]'); if (pinButton) {
        pinButton.innerHTML = (0, icons_1.icon)(this.pinned ? 'pin' : 'pin-off');
        pinButton.setAttribute('aria-pressed', String(this.pinned));
        pinButton.title = this.pinned ? '取消固定' : '固定面板';
        pinButton.setAttribute('aria-label', pinButton.title);
    } const syncButton = this.panel.querySelector('[data-act="sync"]'); if (syncButton)
        syncButton.setAttribute('aria-busy', String(this.busy)); this.root.dataset.open = this.pinned || this.hovered || !!this.editId || !!this.popup || !!this.drag ? 'yes' : 'no'; if (this.railButton) {
        this.railButton.dataset.cgfmOpen = String(this.isOpen());
        this.railButton.setAttribute('aria-expanded', String(this.isOpen()));
    } }
    isOpen() { return this.root.dataset.open === 'yes'; }
    renderStatus() { const state = !this.profile.dav.url ? 'unconfigured' : this.busy ? 'syncing' : (this.authFailure || (this.syncFailures > 0 && this.syncRetryAt > Date.now())) ? 'error' : this.profile.pending.length ? 'pending' : 'synced'; const btn = this.panel?.querySelector('[data-act="sync"]'); if (btn) {
        btn.dataset.syncState = state;
        btn.title = { unconfigured: '未配置 WebDAV', syncing: '同步中', error: '同步失败或存在冲突', pending: '有待同步的本地修改', synced: '已同步' }[state];
    } this.status.textContent = `${this.busy ? '正在同步' : this.dirty ? '待同步' : '已保存'} · ${this.profile.pending.length} 条待同步 · ${this.profile.conflicts.length} 条冲突`; this.status.title = this.profile.conflicts.slice(-8).join('\n'); }
    render() { if (!this.list || this.editId || this.drag?.started)
        return; this.list.replaceChildren(); const add = (text, cls = 'cgfm-group') => { const x = document.createElement('div'); x.className = cls; x.textContent = text; this.list.append(x); }; const folders = Object.values(this.profile.data.folders); const walk = (parent, depth) => { if (depth > 100)
        return; for (const f of folders.filter(x => x.parentId === parent).sort((a, b) => model_1.natural.compare(a.name, b.name))) {
        const row = this.row('folder', f.id, f.name, depth, f.color);
        const toggle = document.createElement('button');
        toggle.innerHTML = (0, icons_1.icon)(this.isCollapsed(f) ? 'chevron-right' : 'chevron-down');
        toggle.title = '折叠 / 展开';
        toggle.dataset.act = 'collapse';
        row.prepend(toggle);
        this.list.append(row);
        if (!this.isCollapsed(f)) {
            for (const c of Object.values(this.profile.data.conversations).filter(x => x.folderId === f.id).sort((a, b) => b.addedAt - a.addedAt))
                this.list.append(this.row('chat', c.id, c.title, depth + 1));
            walk(f.id, depth + 1);
        }
    } }; walk(null, 0); add('最近对话'); for (const c of this.recent.slice(0, 100))
        this.list.append(this.row('recent', c.id, c.title, 0)); this.renderStatus(); }
    row(type, id, name, depth, color) { const el = document.createElement('div'); el.className = 'cgfm-row' + (type === 'folder' && id === this.selected ? ' cgfm-selected' : ''); el.dataset.type = type; el.dataset.id = id; el.style.paddingLeft = `${Math.min(depth, 20) * 14 + 5}px`; const ico = document.createElement('span'); ico.className = 'cgfm-item-icon'; ico.innerHTML = (0, icons_1.icon)(type === 'folder' ? 'folder' : 'message-circle'); if (color)
        ico.style.color = color; const span = document.createElement('span'); span.className = 'cgfm-name'; span.textContent = name; el.append(ico, span); if (type === 'folder') {
        const btn = document.createElement('button');
        btn.dataset.act = 'menu';
        btn.innerHTML = (0, icons_1.icon)('ellipsis');
        btn.title = '文件夹菜单';
        el.append(btn);
    } return el; }
    click(e) {
        if (Date.now() < this.suppressClickUntil) {
            e.preventDefault();
            return;
        }
        const target = e.target;
        const row = target.closest('.cgfm-row');
        const act = target.closest('[data-act]')?.dataset.act;
        if (act) {
            if (act === 'create')
                this.editFolder(null);
            if (act === 'sync')
                void this.sync(true);
            if (act === 'settings')
                this.settings();
            if (act === 'pin') {
                this.pinned = !this.pinned;
                this.updateOpen();
            }
            if (act === 'collapse' && row)
                this.toggleCollapsed(row.dataset.id);
            if (act === 'menu' && row)
                this.folderMenu(row.dataset.id, target);
            return;
        }
        if (!row || this.drag?.started)
            return;
        const type = row.dataset.type, id = row.dataset.id;
        if (type === 'folder') {
            this.selected = this.selected === id ? null : id;
            this.render();
        }
        else
            this.navigate(id);
    }
    context(e) { const row = e.target.closest('.cgfm-row'); if (!row)
        return; e.preventDefault(); if (row.dataset.type === 'folder')
        this.folderMenu(row.dataset.id, e.target);
    else
        this.chatMenu(row.dataset.id, row.dataset.type === 'recent', e.target); }
    navigate(id) { location.assign('/c/' + encodeURIComponent(id)); }
    dismissPopup() { this.root.querySelectorAll('.cgfm-submenu').forEach(e => e.remove()); this.popup?.remove(); this.popup = null; this.width(); this.updateOpen(); }
    showPopup(el, anchor) {
        this.root.querySelectorAll('.cgfm-submenu').forEach(e => e.remove());
        const anchorRect = anchor?.getBoundingClientRect();
        this.popup?.remove();
        this.popup = el;
        el.classList.add('cgfm-pop');
        const isSettings = el.classList.contains('cgfm-settings');
        el.style.cssText = 'position:fixed;z-index:2147483001;' + (isSettings ? '' : 'min-width:160px;max-width:240px;');
        this.root.append(el);
        const r = anchorRect;
        const w = el.getBoundingClientRect().width;
        const h = el.getBoundingClientRect().height;
        if (isSettings) {
            el.style.left = Math.max(12, (innerWidth - w) / 2) + 'px';
            el.style.top = Math.max(12, (innerHeight - h) / 2) + 'px';
        }
        else if (r) {
            let left = r.right + 4;
            if (left + w > innerWidth - 8)
                left = Math.max(8, r.left - w - 4);
            let top = r.top;
            if (top + h > innerHeight - 8)
                top = Math.max(8, innerHeight - h - 8);
            el.style.left = left + 'px';
            el.style.top = top + 'px';
        }
        else {
            el.style.left = Math.max(12, (innerWidth - w) / 2) + 'px';
            el.style.top = Math.max(12, (innerHeight - h) / 2) + 'px';
        }
        this.updateOpen();
    }
    menuItem(box, label, iconName, fn, danger = false) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cgfm-menu-item' + (danger ? ' cgfm-menu-danger' : '');
        b.innerHTML = `<span class="cgfm-menu-icon">${(0, icons_1.icon)(iconName)}</span><span class="cgfm-menu-label">${label}</span>`;
        b.addEventListener('click', () => { this.dismissPopup(); fn(); });
        box.append(b);
    }
    menuDivider(box) {
        const d = document.createElement('div');
        d.className = 'cgfm-menu-divider';
        box.append(d);
    }
    menuButton(box, label, fn) { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', () => { this.dismissPopup(); fn(); }); box.append(b); }
    colorMenuItem(box, id) {
        const item = document.createElement('div');
        item.className = 'cgfm-menu-item cgfm-menu-has-sub';
        item.innerHTML = `<span class="cgfm-menu-icon">${(0, icons_1.icon)('palette')}</span><span class="cgfm-menu-label">设置颜色</span><span class="cgfm-menu-arrow">${(0, icons_1.icon)('chevron-right')}</span>`;
        let sub = null;
        const colors = ['#6b7280', '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'];
        const openSub = () => {
            if (sub)
                return;
            sub = document.createElement('div');
            sub.className = 'cgfm-pop cgfm-submenu';
            const grid = document.createElement('div');
            grid.className = 'cgfm-color-grid';
            const curColor = this.profile.data.folders[id]?.color || '#6b7280';
            for (const c of colors) {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = 'cgfm-color-dot' + (curColor === c ? ' cgfm-color-active' : '');
                dot.style.backgroundColor = c;
                dot.title = c;
                dot.addEventListener('click', e => {
                    e.stopPropagation();
                    this.dismissPopup();
                    this.apply({ type: 'folder.color', id, color: c });
                });
                grid.append(dot);
            }
            sub.append(grid);
            this.root.append(sub);
            const r = item.getBoundingClientRect();
            const sw = sub.getBoundingClientRect().width || 150;
            let left = r.right + 4;
            if (left + sw > innerWidth - 8)
                left = Math.max(8, r.left - sw - 4);
            let top = r.top - 4;
            const sh = sub.getBoundingClientRect().height || 70;
            if (top + sh > innerHeight - 8)
                top = Math.max(8, innerHeight - sh - 8);
            sub.style.left = left + 'px';
            sub.style.top = top + 'px';
        };
        const closeSub = () => { sub?.remove(); sub = null; };
        item.addEventListener('pointerenter', openSub);
        item.addEventListener('click', e => { e.stopPropagation(); if (sub)
            closeSub();
        else
            openSub(); });
        box.addEventListener('pointerleave', e => {
            const rel = e.relatedTarget;
            if (sub && (!rel || (!sub.contains(rel) && !box.contains(rel))))
                closeSub();
        });
        box.append(item);
    }
    folderMenu(id, anchor) {
        const f = this.profile.data.folders[id];
        if (!f)
            return;
        const box = document.createElement('div');
        box.className = 'cgfm-menu-box';
        this.menuItem(box, '创建子文件夹', 'folder-plus', () => this.editFolder(id));
        this.menuItem(box, '重命名', 'pencil', () => this.editFolder(f.parentId, id));
        this.colorMenuItem(box, id);
        this.menuDivider(box);
        this.menuItem(box, '删除文件夹', 'trash-2', () => { if (confirm(`删除「${f.name}」及其子文件夹和分类引用？不会删除 ChatGPT 对话。`))
            this.apply({ type: 'folder.delete', id }); }, true);
        this.showPopup(box, anchor);
    }
    chatMenu(id, recent, anchor) {
        const box = document.createElement('div');
        box.className = 'cgfm-menu-box';
        this.menuItem(box, recent ? '加入文件夹' : '移动至文件夹', 'folder-input', () => this.folderPicker('chat', id));
        this.menuItem(box, '重命名对话', 'pencil', () => this.renameChat(id));
        if (!recent) {
            this.menuDivider(box);
            this.menuItem(box, '从文件夹移除', 'trash-2', () => this.apply({ type: 'conversation.remove', id }), true);
        }
        this.showPopup(box, anchor);
    }
    promptInput(title, value, onSave) { const box = document.createElement('div'); const label = document.createElement('label'); label.textContent = title; const input = document.createElement('input'); input.value = value; label.append(input); box.append(label); const save = document.createElement('button'); save.textContent = '保存'; const close = () => { this.editId = null; this.dismissPopup(); this.render(); }; save.addEventListener('click', () => { const v = input.value.trim(); if (v) {
        close();
        onSave(v);
    } }); input.addEventListener('keydown', e => { if (e.key === 'Enter')
        save.click(); if (e.key === 'Escape')
        close(); }); this.menuButton(box, '取消', close); box.append(save); this.editId = 'editor'; this.showPopup(box); input.focus(); input.select(); }
    inlineEdit(row, initial, onSave) {
        if (this.editId)
            return;
        const span = row.querySelector('.cgfm-name');
        if (!span)
            return;
        const input = document.createElement('input');
        input.value = initial;
        input.style.cssText = 'flex:1;min-width:0;background:transparent;color:inherit;border:1px solid #888;border-radius:5px;padding:3px';
        span.replaceWith(input);
        this.editId = row.dataset.id || 'editor';
        input.focus();
        input.select();
        let done = false;
        const finish = (save) => { if (done)
            return; done = true; const v = input.value.trim(); input.replaceWith(span); this.editId = null; if (save && v && v !== initial)
            onSave(v); this.render(); this.updateOpen(); };
        input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter')
            finish(true); if (e.key === 'Escape')
            finish(false); });
        input.addEventListener('blur', () => finish(true));
    }
    editFolder(parent, id) {
        const f = id ? this.profile.data.folders[id] : null;
        if (f) {
            const row = [...this.list.querySelectorAll('.cgfm-row[data-type="folder"]')].find(x => x.dataset.id === id);
            if (row) {
                this.inlineEdit(row, f.name, name => this.apply({ type: 'folder.rename', id, name }));
                return;
            }
        }
        this.promptInput('新建文件夹', '', name => this.apply({ type: 'folder.create', parentId: parent, name }));
    }
    colorDialog(id) { const box = document.createElement('div'); const input = document.createElement('input'); input.type = 'color'; input.value = this.profile.data.folders[id]?.color || '#6b7280'; box.append(input); this.menuButton(box, '确定', () => this.apply({ type: 'folder.color', id, color: input.value })); this.showPopup(box); }
    folderPicker(type, id) { const box = document.createElement('div'); const title = document.createElement('div'); title.textContent = '选择目标文件夹'; box.append(title); const select = document.createElement('select'); if (type === 'folder') {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = '根目录';
        select.append(o);
    } for (const f of Object.values(this.profile.data.folders).sort((a, b) => model_1.natural.compare(a.name, b.name))) {
        const o = document.createElement('option');
        o.value = f.id;
        o.textContent = f.name;
        select.append(o);
    } box.append(select); this.menuButton(box, '确定', () => this.apply(type === 'folder' ? { type: 'folder.move', id, parentId: select.value || null } : { type: 'conversation.assign', id, folderId: select.value, title: this.title(id) })); this.showPopup(box); }
    title(id) { return this.recent.find(c => c.id === id)?.title || this.profile.data.conversations[id]?.title || '未命名对话'; }
    async renameChat(id) { const row = [...this.list.querySelectorAll('.cgfm-row')].find(x => x.dataset.id === id); if (row)
        this.inlineEdit(row, this.title(id), name => void this.saveChatTitle(id, name));
    else
        this.promptInput('修改 ChatGPT 对话标题', this.title(id), name => void this.saveChatTitle(id, name)); }
    async saveChatTitle(id, name) { const generation = this.generation; try {
        const headers = { ...this.authHeaders, 'Content-Type': 'application/json' };
        const r = await fetch(`/backend-api/conversation/id/${encodeURIComponent(id)}/rename`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ title: name }) });
        if (!r.ok)
            throw Error(`HTTP ${r.status}`);
        if (generation !== this.generation)
            return;
        const item = this.recent.find(c => c.id === id);
        if (item)
            item.title = name;
        this.apply({ type: 'conversation.title', id, title: name });
        this.titleGuards.set(id, { title: name, time: Date.now() });
        this.persistTitleGuards();
        this.render();
    }
    catch (e) {
        this.notice('重命名失败：' + String(e));
    } }
    titleGuards = new Map();
    loadTitleGuards() { const val = GM_getValue(`cgfm.next.titles.${this.account}`, {}); this.titleGuards = new Map(Object.entries(val).filter(([, v]) => v && Date.now() - v.time < 30 * 24 * 3600000)); }
    persistTitleGuards() { GM_setValue(`cgfm.next.titles.${this.account}`, Object.fromEntries(this.titleGuards)); }
    scanRecents() { const rows = new Map(); for (const a of document.querySelectorAll('[data-sidebar-chatgpt-conversation-key^="chatgpt:conversation:"],a[href^="/c/"]')) {
        const key = a.getAttribute('data-sidebar-chatgpt-conversation-key');
        const id = key?.replace('chatgpt:conversation:', '') || a.getAttribute('href')?.match(/\/c\/([^/?#]+)/)?.[1];
        const title = (a.innerText || a.getAttribute('title') || a.getAttribute('aria-label') || '').trim();
        if (id && title) {
            const guard = this.titleGuards.get(id);
            rows.set(id, { id, title: guard && Date.now() - guard.time < 60 * 60 * 1000 ? guard.title : title });
        }
    } if (rows.size)
        this.recent = [...rows.values()].slice(0, 100); if (this.isOpen())
        this.render(); if (this.isOpen() && Date.now() - this.apiAt > 30 * 60 * 1000)
        void this.refreshApi(); }
    async refreshApi() {
        this.apiAt = Date.now();
        const generation = this.generation;
        try {
            const r = await fetch('/backend-api/conversations?offset=0&limit=20', { credentials: 'include', headers: this.authHeaders });
            if (!r.ok)
                throw Error(`HTTP ${r.status}`);
            const json = await r.json();
            if (generation !== this.generation)
                return;
            const merged = new Map(this.recent.map(x => [x.id, x]));
            for (const x of json.items || [])
                if (x.id) {
                    const guard = this.titleGuards.get(x.id);
                    merged.set(x.id, { id: x.id, title: guard && Date.now() - guard.time < 3600000 ? guard.title : x.title || '未命名对话' });
                }
            this.recent = [...merged.values()].slice(0, 100);
            const before = this.profile.data;
            let latest = before;
            for (const item of this.recent) {
                const c = latest.conversations[item.id];
                const guard = this.titleGuards.get(item.id);
                if (c && item.title && c.title !== item.title && !(guard && Date.now() - guard.time < 3600000)) {
                    latest = (0, model_1.command)(latest, { type: 'conversation.title', id: item.id, title: item.title });
                }
            }
            if (latest !== before) {
                this.profile.data = latest;
                this.profile.pending.push(...(0, model_1.diff)(before, latest, this.device, this.profile.pending.length));
                this.persist();
                this.scheduleSync();
            }
            this.render();
        }
        catch {
            this.apiAt = Date.now() - 20 * 60 * 1000;
        }
    }
    restoreAuth() {
        this.authHeaders = {};
        const cached = GM_getValue(`cgfm.next.auth.${this.account}`, { headers: {}, savedAt: 0 });
        if (cached && Date.now() - cached.savedAt < 24 * 3600000 && cached.headers && typeof cached.headers === 'object') {
            for (const key of ['authorization', 'chatgpt-account-id'])
                if (typeof cached.headers[key] === 'string')
                    this.authHeaders[key] = cached.headers[key];
        }
    }
    saveAuth() { if (this.account === 'local')
        return; GM_setValue(`cgfm.next.auth.${this.account}`, { headers: this.authHeaders, savedAt: Date.now() }); }
    installAuthCapture() { if (this.authInstalled)
        return; this.authInstalled = true; const w = unsafeWindow; const original = w.fetch; const self = this; w.fetch = function (input, init) { try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/backend-api/')) {
            const h = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
            for (const key of ['authorization', 'chatgpt-account-id']) {
                const v = h.get(key);
                if (v && self.authHeaders[key] !== v) {
                    self.authHeaders[key] = v;
                    self.saveAuth();
                }
            }
        }
    }
    catch { } return original.call(this, input, init); }; }
    removeGhost() { this.ghost?.remove(); this.ghost = null; }
    cancelDrag() { this.drag = null; this.removeGhost(); this.panel.querySelectorAll('.cgfm-drop').forEach(x => x.classList.remove('cgfm-drop')); this.updateOpen(); }
    dragStart(e) { if (e.button !== 0 || e.target.closest('button,input,select'))
        return; const row = e.target.closest('.cgfm-row'); if (!row)
        return; this.drag = { type: row.dataset.type === 'folder' ? 'folder' : 'chat', id: row.dataset.id, startX: e.clientX, startY: e.clientY, started: false }; try {
        this.panel.setPointerCapture(e.pointerId);
    }
    catch { } }
    dragMove(e) { if (!this.drag)
        return; if (!this.drag.started && Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) < 5)
        return; this.drag.started = true; if (!this.ghost) {
        this.ghost = document.createElement('div');
        this.ghost.textContent = this.drag.type === 'folder' ? '📁 移动文件夹' : '▤ 移动对话';
        this.ghost.style.cssText = 'position:fixed;z-index:2147483003;pointer-events:none;background:var(--cg-bg);color:var(--cg-text);border:1px solid var(--cg-border);border-radius:8px;padding:7px 12px;box-shadow:0 5px 20px var(--cg-shadow)';
        this.root.append(this.ghost);
    } this.ghost.style.left = e.clientX + 12 + 'px'; this.ghost.style.top = e.clientY + 12 + 'px'; this.panel.querySelectorAll('.cgfm-drop').forEach(x => x.classList.remove('cgfm-drop')); const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cgfm-row[data-type="folder"]'); target?.classList.add('cgfm-drop'); }
    dragEnd(e) { const d = this.drag; this.drag = null; try {
        if (this.panel.hasPointerCapture(e.pointerId))
            this.panel.releasePointerCapture(e.pointerId);
    }
    catch { } this.removeGhost(); this.panel.querySelectorAll('.cgfm-drop').forEach(x => x.classList.remove('cgfm-drop')); if (!d?.started)
        return; this.suppressClickUntil = Date.now() + 300; const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cgfm-row[data-type="folder"]'); if (target?.dataset.id) {
        this.apply(d.type === 'folder' ? { type: 'folder.move', id: d.id, parentId: target.dataset.id } : { type: 'conversation.assign', id: d.id, folderId: target.dataset.id, title: this.title(d.id) });
    } this.updateOpen(); }
    settings() {
        const box = document.createElement('div');
        box.className = 'cgfm-settings';
        const header = document.createElement('div');
        header.className = 'cgfm-settings-header';
        header.innerHTML = `<strong>文件夹设置</strong>`;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'cgfm-settings-close';
        close.title = '关闭';
        close.setAttribute('aria-label', '关闭设置');
        close.innerHTML = (0, icons_1.icon)('x');
        close.addEventListener('click', () => this.dismissPopup());
        header.append(close);
        box.append(header);
        const body = document.createElement('div');
        body.className = 'cgfm-settings-body';
        box.append(body);
        const section = (title) => { const node = document.createElement('section'); node.className = 'cgfm-settings-section'; const h = document.createElement('h3'); h.textContent = title; node.append(h); body.append(node); return node; };
        const field = (parent, title, value, type = 'text') => { const label = document.createElement('label'); label.textContent = title; const input = document.createElement('input'); input.type = type; input.value = value; label.append(input); parent.append(label); return input; };
        const action = (parent, title, fn, svg) => { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = (svg ? (0, icons_1.icon)(svg) : '') + `<span></span>`; b.lastElementChild.textContent = title; b.addEventListener('click', fn); parent.append(b); return b; };
        const webdav = section('WebDAV 同步');
        const url = field(webdav, '服务器 HTTPS 目录', this.profile.dav.url, 'url');
        const credentials = document.createElement('div');
        credentials.className = 'cgfm-settings-grid';
        webdav.append(credentials);
        const username = field(credentials, '用户名', this.profile.dav.username);
        const password = field(credentials, '密码', '', 'password');
        password.placeholder = this.profile.dav.password ? '留空则保留原密码' : '输入 WebDAV 密码';
        const file = field(webdav, '远端文件名', this.profile.dav.file);
        const draft = () => ({ url: url.value.trim(), username: username.value.trim(), password: password.value || this.profile.dav.password, file: file.value.trim() || this.profile.dav.file });
        const commitSettings = () => { const d = draft(); if (d.url && !/^https:\/\//i.test(d.url)) {
            this.notice('WebDAV 地址必须是 HTTPS');
            url.focus();
            return false;
        } if (d.url && !d.username) {
            this.notice('请填写 WebDAV 用户名');
            username.focus();
            return false;
        } if (d.url && !d.password) {
            this.notice('请填写 WebDAV 密码');
            password.focus();
            return false;
        } if (!d.file || d.file.includes('/') || d.file.includes('\\')) {
            this.notice('远端文件名无效');
            file.focus();
            return false;
        } const targetChanged = d.url !== this.profile.dav.url || d.file !== this.profile.dav.file; const changed = targetChanged || d.username !== this.profile.dav.username || d.password !== this.profile.dav.password; this.profile.dav = { ...this.profile.dav, ...d }; if (changed) {
            this.authFailure = false;
            this.syncRetryAt = 0;
            this.profile.etag = '';
        } if (targetChanged) {
            this.profile.base = (0, model_1.blank)();
            this.profile.baseRevision = 0;
        } this.profile.preferences.sidebarWidth = Math.max(260, Math.min(500, Math.round((Number(width.value) || 330) / 5) * 5)); this.profile.preferences.customWidth = true; this.panel.style.width = this.profile.preferences.sidebarWidth + 'px'; this.persist(); this.width(); return true; };
        const syncActions = document.createElement('div');
        syncActions.className = 'cgfm-settings-actions';
        webdav.append(syncActions);
        const davResult = document.createElement('div');
        davResult.className = 'cgfm-dav-status';
        davResult.hidden = true;
        webdav.append(davResult);
        const setDavStatus = (msg, type) => { davResult.hidden = false; davResult.dataset.type = type; davResult.innerHTML = (type === 'loading' ? (0, icons_1.icon)('refresh-cw') : '') + `<span>${msg}</span>`; };
        const testBtn = action(syncActions, '测试连接', async () => {
            if (!commitSettings())
                return;
            testBtn.disabled = true;
            const span = testBtn.querySelector('span');
            const prev = span.textContent;
            span.textContent = '测试中...';
            setDavStatus('正在连接 WebDAV...', 'loading');
            try {
                const r = await (0, sync_1.davRequest)(this.profile.dav, 'GET');
                const ok = r.status === 404 ? '连接成功（远端文件尚不存在）' : r.status >= 200 && r.status < 300 ? '连接成功' : 'HTTP ' + r.status;
                setDavStatus(ok, r.status < 300 || r.status === 404 ? 'success' : 'error');
                if (commitSettings())
                    void this.testConnection();
            }
            catch (e) {
                setDavStatus('连接失败：' + String(e), 'error');
            }
            finally {
                testBtn.disabled = false;
                span.textContent = prev || '测试连接';
            }
        });
        const syncBtn = action(syncActions, '立即同步', async () => {
            if (!commitSettings())
                return;
            syncBtn.disabled = true;
            const span = syncBtn.querySelector('span');
            const prev = span.textContent;
            span.textContent = '同步中...';
            setDavStatus('正在执行同步...', 'loading');
            try {
                await this.sync(true);
                setDavStatus('同步完成', 'success');
                if (commitSettings())
                    void this.sync(true);
            }
            catch (e) {
                setDavStatus('同步失败：' + String(e), 'error');
            }
            finally {
                syncBtn.disabled = false;
                span.textContent = prev || '立即同步';
            }
        }, 'refresh-cw');
        const interfaceSection = section('界面设置');
        const widthHeader = document.createElement('div');
        widthHeader.className = 'cgfm-settings-row-between';
        const widthLabelText = document.createElement('span');
        widthLabelText.textContent = '文件夹面板宽度';
        const currentW = Math.max(260, Math.min(500, Math.round((this.profile.preferences.sidebarWidth || 330) / 5) * 5));
        const widthValue = document.createElement('span');
        widthValue.className = 'cgfm-width-val';
        widthValue.textContent = String(currentW) + ' px';
        widthHeader.append(widthLabelText, widthValue);
        interfaceSection.append(widthHeader);
        const width = document.createElement('input');
        width.type = 'range';
        width.min = '260';
        width.max = '500';
        width.step = '5';
        width.value = String(currentW);
        width.setAttribute('aria-label', '文件夹面板宽度');
        interfaceSection.append(width);
        const ticks = document.createElement('div');
        ticks.className = 'cgfm-slider-line';
        ticks.innerHTML = '<span>260 px</span><span>500 px</span>';
        interfaceSection.append(ticks);
        width.addEventListener('input', () => { widthValue.textContent = width.value + ' px'; this.panel.style.width = width.value + 'px'; this.width(Number(width.value), true); });
        const dataSection = section('数据管理');
        const dataActions = document.createElement('div');
        dataActions.className = 'cgfm-settings-actions cgfm-data-actions';
        dataSection.append(dataActions);
        action(dataActions, '导出 JSON', () => this.exportData(), 'download');
        action(dataActions, '导入 JSON', () => this.importData(), 'upload');
        const pullButton = action(dataActions, '强制拉取', () => { if (commitSettings())
            void this.pull(); });
        pullButton.classList.add('cgfm-danger');
        const result = document.createElement('div');
        result.className = 'cgfm-settings-result';
        result.setAttribute('role', 'status');
        result.setAttribute('aria-live', 'polite');
        result.hidden = true;
        result.style.display = 'none';
        box.append(result);
        const footer = document.createElement('footer');
        footer.className = 'cgfm-settings-footer';
        box.append(footer);
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'cgfm-btn-cancel';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => this.dismissPopup());
        footer.append(cancelBtn);
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'cgfm-btn-save';
        saveBtn.textContent = '保存设置';
        saveBtn.addEventListener('click', () => { if (commitSettings()) {
            this.dismissPopup();
            this.notice('设置已保存');
        } });
        footer.append(saveBtn);
        this.showPopup(box);
    }
    width(previewWidth, previewActive) {
        let el = document.getElementById('cgfm-next-width');
        if (!el) {
            el = document.createElement('style');
            el.id = 'cgfm-next-width';
            document.head.append(el);
        }
        const active = previewActive ?? this.profile.preferences.customWidth;
        const val = previewWidth ?? this.profile.preferences.sidebarWidth;
        const px = `${val}px`;
        const hasSidebar = !!document.querySelector('#app-shell-sidebar, [data-testid="sidebar"], #stage-slideover-sidebar, nav[data-app-navigation-rail="true"], aside');
        el.textContent = active && hasSidebar ? `html{--codex-sidebar-preferred-width:${px}!important}html body{--sidebar-width:${px}!important}#app-shell-sidebar{--sidebar-width:${px}!important}` : '';
    }
    exportData() { const content = JSON.stringify({ format: 'cgfm-ts-data', version: 1, account: this.account, data: this.profile.data }, null, 2); const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'chatgpt-folders-ts.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); }
    importData() { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.onchange = async () => { const file = input.files?.[0]; if (!file)
        return; const account = this.account, generation = this.generation; try {
        const parsed = JSON.parse(await file.text());
        if (parsed.format !== 'cgfm-ts-data' || parsed.version !== 1)
            throw Error('只接受新版数据格式');
        (0, model_1.validate)(parsed.data);
        if (generation !== this.generation || account !== this.account)
            throw Error('账号已切换，取消导入');
        if (parsed.account !== this.account && !confirm('导入数据账号与当前账号不匹配，仍然导入吗？'))
            return;
        if (!confirm('确认用导入数据替换当前分类？本地 WebDAV 配置会保留。'))
            return;
        const before = this.profile.data;
        this.readOnly = false;
        this.profile.data = (0, model_1.copy)(parsed.data);
        this.profile.pending.push(...(0, model_1.diff)(before, this.profile.data, this.device, this.profile.pending.length));
        this.persist();
        this.render();
        this.scheduleSync();
    }
    catch (e) {
        this.notice('导入失败：' + String(e));
    } }; input.click(); }
    async testConnection() { if (!this.profile.dav.url) {
        this.notice('请先配置 WebDAV HTTPS 目录');
        return;
    } try {
        const r = await (0, sync_1.davRequest)(this.profile.dav, 'GET');
        this.notice(r.status === 404 ? '连接成功，远端文件尚不存在' : r.status >= 200 && r.status < 300 ? '连接成功' : 'HTTP ' + r.status);
    }
    catch (e) {
        this.notice(String(e));
    } }
    async pull() { const generation = this.generation, account = this.account; if (!confirm('使用云端快照完全替换本地分类及未同步修改？'))
        return; try {
        const r = await (0, sync_1.davRequest)(this.profile.dav, 'GET');
        if (r.status !== 200)
            throw Error(`HTTP ${r.status}`);
        if (generation !== this.generation || account !== this.account)
            throw Error('账号已切换，忽略旧请求');
        const e = (0, sync_1.decodeRemote)(r.text, account);
        this.profile.data = (0, model_1.copy)(e.data);
        this.profile.base = (0, model_1.copy)(e.data);
        this.profile.baseRevision = e.revision;
        this.profile.etag = r.etag;
        this.profile.pending = [];
        this.profile.conflicts = [];
        this.persist();
        this.render();
        this.notice('云端拉取成功');
    }
    catch (e) {
        this.notice(String(e));
    } }
    async sync(manual) {
        if (this.busy) {
            if (manual)
                this.notice('同步正在进行');
            return;
        }
        if (!this.profile.dav.url) {
            if (manual)
                this.notice('请先配置 WebDAV HTTPS 目录');
            return;
        }
        if (!manual && (Date.now() < this.syncRetryAt || this.authFailure || !navigator.onLine))
            return;
        if (this.account === 'local') {
            if (manual)
                this.notice('尚未识别 ChatGPT 账号，不能同步');
            return;
        }
        this.busy = true;
        this.updateOpen();
        const generation = this.generation, account = this.account, dav = { ...this.profile.dav };
        this.renderStatus();
        try {
            let finished = false;
            for (let attempt = 0; attempt < 4; attempt++) {
                const read = await (0, sync_1.davRequest)(dav, 'GET');
                if (generation !== this.generation || dav.url !== this.profile.dav.url || dav.file !== this.profile.dav.file || dav.username !== this.profile.dav.username || dav.password !== this.profile.dav.password)
                    return;
                if (read.status !== 200 && read.status !== 404)
                    throw Error(`云端读取失败 HTTP ${read.status}`);
                const remote = read.status === 404 ? null : (0, sync_1.decodeRemote)(read.text, account);
                const baseline = this.profile.base;
                const before = (0, model_1.copy)(this.profile.data);
                const merged = remote ? (0, sync_1.merge)(baseline, before, remote.data) : { data: before, conflicts: [] };
                const mergedData = merged.data;
                const changed = JSON.stringify(mergedData) !== JSON.stringify(remote?.data ?? (0, model_1.blank)());
                if (!changed && remote) {
                    const after = this.profile.data;
                    const updated = (0, sync_1.merge)(before, after, mergedData);
                    this.profile.data = updated.data;
                    this.profile.base = (0, model_1.copy)(mergedData);
                    this.profile.baseRevision = remote.revision;
                    this.profile.etag = read.etag;
                    this.profile.pending = (0, model_1.diff)(mergedData, this.profile.data, this.device, 0);
                    this.profile.conflicts.push(...merged.conflicts, ...updated.conflicts);
                    this.persist();
                    this.render();
                    if (this.profile.pending.length)
                        this.scheduleSync();
                    finished = true;
                    break;
                }
                if (remote && !read.etag)
                    throw Error('服务器未提供 ETag，无法安全并发写入');
                const envelope = (0, sync_1.createRemote)(account, this.device, (remote?.revision ?? 0) + 1, mergedData);
                const ifHeaders = attempt >= 2 ? {} : (remote ? { 'If-Match': read.etag } : { 'If-None-Match': '*' });
                const result = await (0, sync_1.davRequest)(dav, 'PUT', ifHeaders, JSON.stringify(envelope));
                if (generation !== this.generation || dav.url !== this.profile.dav.url || dav.file !== this.profile.dav.file || dav.username !== this.profile.dav.username || dav.password !== this.profile.dav.password)
                    return;
                if (result.status === 412 || result.status === 409)
                    continue;
                if (result.status < 200 || result.status >= 300)
                    throw Error(`云端写入失败 HTTP ${result.status}`);
                // Never replace edits performed while the request was in flight.
                const after = this.profile.data;
                const newMerge = (0, sync_1.merge)(before, after, mergedData);
                this.profile.data = newMerge.data;
                this.profile.base = (0, model_1.copy)(mergedData);
                this.profile.baseRevision = envelope.revision;
                this.profile.etag = result.etag;
                this.profile.conflicts.push(...merged.conflicts, ...newMerge.conflicts);
                this.profile.pending = (0, model_1.diff)(mergedData, this.profile.data, this.device, 0);
                this.persist();
                this.render();
                if (this.profile.pending.length)
                    this.scheduleSync();
                finished = true;
                break;
            }
            if (!finished)
                throw Error('多次并发冲突，未能提交，请稍后重试');
            this.syncFailures = 0;
            this.syncRetryAt = 0;
            this.authFailure = false;
            this.profile.conflicts = [];
            if (manual)
                this.notice('同步请求完成');
        }
        catch (e) {
            this.syncFailures++;
            this.syncRetryAt = Date.now() + Math.min(4 * 3600000, 15000 * 2 ** Math.min(this.syncFailures, 8));
            this.authFailure = /HTTP 40[13]/.test(String(e));
            if (manual)
                this.notice('同步失败：' + String(e));
            console.warn('[CGFM] sync', e);
        }
        finally {
            this.busy = false;
            this.updateOpen();
            this.renderStatus();
        }
    }
    notice(message) { console.info('[CGFM]', message); const dav = this.popup?.querySelector('.cgfm-dav-status'); if (dav) {
        dav.hidden = false;
        dav.dataset.type = /失败|错误|损坏/.test(message) ? 'error' : 'success';
        dav.innerHTML = `<span>${message}</span>`;
    } const result = this.popup?.querySelector('.cgfm-settings-result'); if (result) {
        result.hidden = true;
        result.textContent = message;
    } if (this.status) {
        this.status.textContent = message;
        setTimeout(() => this.renderStatus(), 3500);
    }
    else
        alert(message); }
}
exports.FolderApplication = FolderApplication;

},
"main":function(require,module,exports){
"use strict";
// ==UserScript==
// @name         ChatGPT文件夹
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @version      2.0.9
// @description  ChatGPT 多级文件夹与 WebDAV 同步（TypeScript 重写）
// @author       ChatGPT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==
Object.defineProperty(exports, "__esModule", { value: true });
const runtime_1 = require("./runtime");
function run() {
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', run, { once: true });
        return;
    }
    if (document.querySelector('[data-cgfm-next-root]'))
        return;
    try {
        new runtime_1.FolderApplication().start();
    }
    catch (error) {
        console.error('[CGFM] Initialization failed', error);
    }
}
run();

}};const cache={};function get(name){const key=(name.startsWith('./')?name.slice(2):name);if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn(get,m,m.exports);return m.exports;}get('main');})();

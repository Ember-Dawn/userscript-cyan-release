// ==UserScript==
// @name         ChatGPT文件夹
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @version      2.0.1
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
                if (lv !== rv)
                    conflicts.push(`${kind}:${id}:delete-vs-edit`);
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
    for (const c of Object.values(result.conversations))
        if (!result.folders[c.folderId]) {
            conflicts.push(`conversation:${c.id}:orphan`);
            delete result.conversations[c.id];
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
                const etag = (r.responseHeaders || '').match(/^etag:\s*(.+)$/im)?.[1]?.trim() ?? null;
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
"runtime":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderApplication = void 0;
const model_1 = require("./model");
const sync_1 = require("./sync");
const style = `
#cgfm-next-root{position:fixed;z-index:2147483000;top:72px;left:64px;font:13px/1.45 system-ui;color:var(--text-primary,#dedede);--cg-bg:var(--main-surface-primary,#202123);--cg-border:var(--border-light,#555)}
#cgfm-next-root *{box-sizing:border-box}#cgfm-next-rail-entry{display:flex;align-items:center;justify-content:center;width:100%;flex:none}#cgfm-next-rail{display:flex;align-items:center;justify-content:center;width:36px;height:36px;padding:8px;border:0;border-radius:10px;background:transparent;color:var(--text-secondary,var(--token-text-tertiary,currentColor));cursor:pointer}#cgfm-next-rail:hover,#cgfm-next-rail[data-cgfm-open="true"]{background:var(--sidebar-surface-secondary,rgba(128,128,128,.14));color:var(--text-primary,currentColor)}#cgfm-next-rail svg{width:20px;height:20px;fill:rgba(58,131,247,.20);stroke:#3A83F7;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}#cgfm-next-launch{background:var(--cg-bg);border:1px solid var(--cg-border);border-radius:12px;padding:10px;cursor:pointer}
#cgfm-next-panel{position:absolute;top:0;left:45px;width:330px;max-height:78vh;display:none;flex-direction:column;background:var(--cg-bg);border:1px solid var(--cg-border);border-radius:14px;box-shadow:0 8px 36px #0005;overflow:hidden}
#cgfm-next-root[data-open="yes"] #cgfm-next-panel{display:flex}.cgfm-head{display:flex;align-items:center;gap:6px;padding:11px;border-bottom:1px solid var(--cg-border)}
.cgfm-scroll{overflow:auto;min-height:70px;padding:7px}.cgfm-row{min-height:32px;display:flex;align-items:center;gap:5px;border-radius:7px;padding:2px 5px;cursor:pointer;user-select:none}.cgfm-row:hover,.cgfm-row.cgfm-selected{background:var(--surface-hover,#6664)}.cgfm-row.cgfm-drop{outline:2px solid #70a6f0}
.cgfm-item-icon{display:flex;align-items:center;justify-content:center;width:20px;min-width:20px;height:20px}.cgfm-item-icon svg{width:20px;height:20px;stroke-width:2}.cgfm-row span.cgfm-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.cgfm-row button,.cgfm-head button{border:0;color:inherit;background:transparent;cursor:pointer;border-radius:6px;padding:4px 6px}.cgfm-row button:hover,.cgfm-head button:hover{background:#8884}
.cgfm-group{padding:9px 7px 4px;font-size:12px;opacity:.65}.cgfm-pop{background:var(--cg-bg);border:1px solid var(--cg-border);border-radius:10px;padding:12px;box-shadow:0 8px 30px #0005;color:inherit}.cgfm-pop input,.cgfm-pop select{color:inherit;background:var(--cg-bg);border:1px solid var(--cg-border);padding:6px;border-radius:6px;width:100%}.cgfm-pop label{display:block;margin:7px 0}.cgfm-pop button{margin:3px;border:1px solid var(--cg-border);border-radius:6px;padding:6px;background:transparent;color:inherit;cursor:pointer}.cgfm-muted{opacity:.7;font-size:11px}.cgfm-foot{padding:7px 11px;border-top:1px solid var(--cg-border);font-size:11px;cursor:pointer}
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
    start() { this.device = GM_getValue('cgfm.next.device', '') || (0, model_1.uid)(); GM_setValue('cgfm.next.device', this.device); this.account = this.detectAccount(); this.load(); this.loadTitleGuards(); this.restoreAuth(); this.build(); this.installAuthCapture(); this.bindGlobal(); this.scanRecents(); this.render(); this.timer = window.setInterval(() => { this.checkAccount(); if (Date.now() - this.lastRefresh > 30000) {
        this.lastRefresh = Date.now();
        if (this.isOpen())
            this.scanRecents();
    } if (this.profile.dav.url && document.visibilityState === 'visible')
        void this.sync(false); }, 30000); window.setTimeout(() => { this.checkAccount(); this.mountRail(); }, 1500); }
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
        return GM_getValue('cgfm.next.lastAccount', 'local');
    }
    checkAccount() { const next = this.detectAccount(); if (next === this.account)
        return; this.account = next; this.generation++; this.load(); this.loadTitleGuards(); this.restoreAuth(); this.render(); }
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
        document.head.append(s);
        this.root = document.createElement('div');
        this.root.id = 'cgfm-next-root';
        this.root.dataset.cgfmNextRoot = '1';
        this.root.innerHTML = '<button id="cgfm-next-launch" title="ChatGPT 文件夹">📁</button><section id="cgfm-next-panel"><div class="cgfm-head"><b style="flex:1">ChatGPT 文件夹</b><button data-act="create" title="新建文件夹">＋</button><button data-act="sync" title="立即同步">⟳</button><button data-act="settings" title="设置">⚙</button><button data-act="pin" title="固定">📌</button></div><div class="cgfm-scroll"></div><div class="cgfm-foot"></div></section>';
        document.body.append(this.root);
        this.panel = this.root.querySelector('#cgfm-next-panel');
        this.list = this.root.querySelector('.cgfm-scroll');
        this.status = this.root.querySelector('.cgfm-foot');
        this.launch = this.root.querySelector('#cgfm-next-launch');
        this.launch.addEventListener('click', () => { this.pinned = !this.pinned; this.updateOpen(); });
        this.launch.addEventListener('mouseenter', () => { this.hovered = true; this.updateOpen(); });
        this.launch.addEventListener('mouseleave', () => { this.hovered = false; window.setTimeout(() => this.updateOpen(), 280); });
        this.panel.addEventListener('pointerenter', () => { window.clearTimeout(this.closeTimer); this.hovered = true; this.updateOpen(); });
        this.panel.addEventListener('pointerleave', () => this.scheduleClose());
        this.panel.addEventListener('click', e => this.click(e));
        this.panel.addEventListener('contextmenu', e => this.context(e));
        this.panel.addEventListener('pointerdown', e => this.dragStart(e));
        this.panel.addEventListener('pointermove', e => this.dragMove(e));
        this.panel.addEventListener('pointerup', e => this.dragEnd(e));
        this.panel.addEventListener('pointercancel', () => { this.drag = null; this.removeGhost(); });
        this.mountRail();
    }
    scheduleClose() { window.clearTimeout(this.closeTimer); this.closeTimer = window.setTimeout(() => { const buttonHover = !!this.railButton?.matches(':hover'); const panelHover = !!this.panel?.matches(':hover'); this.hovered = buttonHover || panelHover || !!this.launch?.matches(':hover'); this.updateOpen(); }, 230); }
    mountRail() {
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
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            btn.addEventListener('pointerenter', () => { window.clearTimeout(this.closeTimer); this.hovered = true; this.updateOpen(); });
            btn.addEventListener('pointerleave', () => this.scheduleClose());
            btn.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); window.clearTimeout(this.closeTimer); this.pinned = !this.pinned; this.updateOpen(); if (!this.pinned)
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
        this.drag = null;
        this.removeGhost();
        this.dismissPopup();
        if (!this.editId) {
            this.pinned = false;
            this.updateOpen();
        }
    } }); document.addEventListener('click', e => { if (this.popup && !this.popup.contains(e.target) && !e.target.closest('#cgfm-next-panel'))
        this.dismissPopup(); }); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') {
        this.checkAccount();
        this.mountRail();
        this.scanRecents();
    } }); window.addEventListener('popstate', () => { this.checkAccount(); this.scanRecents(); }); window.addEventListener('online', () => this.scheduleSync()); this.observer = new MutationObserver(() => { if (!this.launch.isConnected)
        this.root.prepend(this.launch); this.mountRail(); }); this.observer.observe(document.body, { childList: true }); window.setInterval(() => { this.mountRail(); this.width(); }, 10000); this.width(); }
    updateOpen() { this.root.dataset.open = this.pinned || this.hovered || !!this.editId || !!this.popup || !!this.drag ? 'yes' : 'no'; if (this.railButton) {
        this.railButton.dataset.cgfmOpen = String(this.isOpen());
        this.railButton.setAttribute('aria-expanded', String(this.isOpen()));
    } if (this.isOpen())
        this.scanRecents(); }
    isOpen() { return this.root.dataset.open === 'yes'; }
    renderStatus() { this.status.textContent = `${this.busy ? '正在同步' : this.dirty ? '待同步' : '已保存'} · ${this.profile.pending.length} 条待同步 · ${this.profile.conflicts.length} 条冲突`; this.status.title = this.profile.conflicts.slice(-8).join('\n'); }
    render() { if (!this.list || this.editId || this.drag?.started)
        return; this.list.replaceChildren(); const add = (text, cls = 'cgfm-group') => { const x = document.createElement('div'); x.className = cls; x.textContent = text; this.list.append(x); }; add('文件夹'); const folders = Object.values(this.profile.data.folders); const walk = (parent, depth) => { if (depth > 100)
        return; for (const f of folders.filter(x => x.parentId === parent).sort((a, b) => model_1.natural.compare(a.name, b.name))) {
        const row = this.row('folder', f.id, f.name, depth, f.color);
        const toggle = document.createElement('button');
        toggle.textContent = f.collapsed ? '▸' : '▾';
        toggle.title = '折叠 / 展开';
        toggle.dataset.act = 'collapse';
        row.prepend(toggle);
        this.list.append(row);
        if (!f.collapsed) {
            for (const c of Object.values(this.profile.data.conversations).filter(x => x.folderId === f.id).sort((a, b) => b.addedAt - a.addedAt))
                this.list.append(this.row('chat', c.id, c.title, depth + 1));
            walk(f.id, depth + 1);
        }
    } }; walk(null, 0); add('最近对话'); for (const c of this.recent.slice(0, 100))
        this.list.append(this.row('recent', c.id, c.title, 0)); this.renderStatus(); }
    row(type, id, name, depth, color) { const el = document.createElement('div'); el.className = 'cgfm-row' + (type === 'folder' && id === this.selected ? ' cgfm-selected' : ''); el.dataset.type = type; el.dataset.id = id; el.style.paddingLeft = `${Math.min(depth, 20) * 14 + 5}px`; const ico = document.createElement('span'); ico.className = 'cgfm-item-icon'; ico.innerHTML = type === 'folder' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4.5 6.5A4.5 4.5 0 0 1 9 2h6a4.5 4.5 0 0 1 4.5 4.5v4A4.5 4.5 0 0 1 15 15H9l-4.5 4v-4.8A4.5 4.5 0 0 1 2 10.5v-4Z" stroke-linecap="round" stroke-linejoin="round"/></svg>'; if (color)
        ico.style.color = color; const span = document.createElement('span'); span.className = 'cgfm-name'; span.textContent = name; el.append(ico, span); if (type === 'folder') {
        const btn = document.createElement('button');
        btn.dataset.act = 'menu';
        btn.textContent = '⋯';
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
                this.apply({ type: 'folder.collapse', id: row.dataset.id });
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
    dismissPopup() { this.popup?.remove(); this.popup = null; this.updateOpen(); }
    showPopup(el, anchor) { this.dismissPopup(); this.popup = el; el.classList.add('cgfm-pop'); el.style.cssText = 'position:fixed;z-index:2147483001;max-width:300px;min-width:200px'; document.body.append(el); const r = anchor?.getBoundingClientRect(); el.style.left = Math.min(innerWidth - 310, Math.max(5, r?.left ?? innerWidth / 3)) + 'px'; el.style.top = Math.min(innerHeight - 350, Math.max(5, r?.bottom ?? 100)) + 'px'; this.updateOpen(); }
    menuButton(box, label, fn) { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', () => { this.dismissPopup(); fn(); }); box.append(b); }
    folderMenu(id, anchor) { const f = this.profile.data.folders[id]; if (!f)
        return; const box = document.createElement('div'); for (const [name, fn] of [['创建子文件夹', () => this.editFolder(id)], ['重命名', () => this.editFolder(f.parentId, id)], ['颜色', () => this.colorDialog(id)], ['刷新对话标题', () => { this.scanRecents(); this.apiAt = 0; void this.refreshApi(); }], ['移动至...', () => this.folderPicker('folder', id)], ['删除文件夹', () => { if (confirm(`删除「${f.name}」及其子文件夹和分类引用？不会删除 ChatGPT 对话。`))
                this.apply({ type: 'folder.delete', id }); }]])
        this.menuButton(box, name, fn); this.showPopup(box, anchor); }
    chatMenu(id, recent, anchor) { const box = document.createElement('div'); this.menuButton(box, '移动 / 加入文件夹', () => this.folderPicker('chat', id)); this.menuButton(box, '重命名对话', () => this.renameChat(id)); if (!recent)
        this.menuButton(box, '从文件夹移除', () => this.apply({ type: 'conversation.remove', id })); this.showPopup(box, anchor); }
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
    dragStart(e) { if (e.button !== 0 || e.target.closest('button,input,select'))
        return; const row = e.target.closest('.cgfm-row'); if (!row)
        return; this.drag = { type: row.dataset.type === 'folder' ? 'folder' : 'chat', id: row.dataset.id, startX: e.clientX, startY: e.clientY, started: false }; }
    dragMove(e) { if (!this.drag)
        return; if (!this.drag.started && Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) < 5)
        return; this.drag.started = true; if (!this.ghost) {
        this.ghost = document.createElement('div');
        this.ghost.textContent = this.drag.type === 'folder' ? '📁 移动文件夹' : '▤ 移动对话';
        this.ghost.style.cssText = 'position:fixed;z-index:2147483003;pointer-events:none;background:var(--cg-bg);border:1px solid var(--cg-border);border-radius:8px;padding:7px 12px;box-shadow:0 5px 20px #0005';
        document.body.append(this.ghost);
    } this.ghost.style.left = e.clientX + 12 + 'px'; this.ghost.style.top = e.clientY + 12 + 'px'; this.panel.querySelectorAll('.cgfm-drop').forEach(x => x.classList.remove('cgfm-drop')); const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cgfm-row[data-type="folder"]'); target?.classList.add('cgfm-drop'); }
    dragEnd(e) { const d = this.drag; this.drag = null; this.removeGhost(); this.panel.querySelectorAll('.cgfm-drop').forEach(x => x.classList.remove('cgfm-drop')); if (!d?.started)
        return; this.suppressClickUntil = Date.now() + 300; const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cgfm-row[data-type="folder"]'); if (target?.dataset.id) {
        this.apply(d.type === 'folder' ? { type: 'folder.move', id: d.id, parentId: target.dataset.id } : { type: 'conversation.assign', id: d.id, folderId: target.dataset.id, title: this.title(d.id) });
    } this.updateOpen(); }
    settings() { const box = document.createElement('div'); box.style.width = '290px'; const fields = [['WebDAV HTTPS 目录', 'url', this.profile.dav.url], ['用户名', 'username', this.profile.dav.username], ['密码', 'password', ''], ['远端文件名', 'file', this.profile.dav.file], ['侧栏宽度(px)', 'width', String(this.profile.preferences.sidebarWidth)]]; const inputs = {}; for (const [name, key, val] of fields) {
        const label = document.createElement('label');
        label.textContent = name;
        const input = document.createElement('input');
        input.value = val;
        input.type = key === 'password' ? 'password' : 'text';
        label.append(input);
        box.append(label);
        inputs[key] = input;
    } const toggle = document.createElement('label'); const widthCheckbox = document.createElement('input'); widthCheckbox.type = 'checkbox'; widthCheckbox.checked = this.profile.preferences.customWidth; toggle.append(widthCheckbox, document.createTextNode(' 自定义官方侧栏宽度')); box.append(toggle); this.menuButton(box, '保存设置', () => { this.profile.dav.url = inputs.url.value.trim(); this.profile.dav.username = inputs.username.value.trim(); if (inputs.password.value)
        this.profile.dav.password = inputs.password.value; this.profile.dav.file = inputs.file.value.trim() || this.profile.dav.file; this.authFailure = false; this.syncRetryAt = 0; this.profile.preferences.sidebarWidth = Math.max(240, Math.min(520, Number(inputs.width.value) || 312)); this.profile.preferences.customWidth = widthCheckbox.checked; this.persist(); this.width(); }); this.menuButton(box, '测试连接', () => void this.testConnection()); this.menuButton(box, '立即同步', () => void this.sync(true)); this.menuButton(box, '从云端强制拉取', () => void this.pull()); this.menuButton(box, '导出 JSON', () => this.exportData()); this.menuButton(box, '导入 JSON', () => this.importData()); this.showPopup(box); }
    width() {
        let el = document.getElementById('cgfm-next-width');
        if (!el) {
            el = document.createElement('style');
            el.id = 'cgfm-next-width';
            document.head.append(el);
        }
        const px = `${this.profile.preferences.sidebarWidth}px`;
        const pinned = !!document.querySelector('#stage-slideover-sidebar') && !!document.querySelector('[data-testid="sidebar"]');
        el.textContent = this.profile.preferences.customWidth && pinned ? `html{--codex-sidebar-preferred-width:${px}!important}html body{--sidebar-width:${px}!important}` : '';
    }
    exportData() { const content = JSON.stringify({ format: 'cgfm-ts-data', version: 1, account: this.account, data: this.profile.data }, null, 2); const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'chatgpt-folders-ts.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); }
    importData() { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.onchange = async () => { const file = input.files?.[0]; if (!file)
        return; try {
        const parsed = JSON.parse(await file.text());
        if (parsed.format !== 'cgfm-ts-data' || parsed.version !== 1)
            throw Error('只接受新版数据格式');
        (0, model_1.validate)(parsed.data);
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
    async testConnection() { try {
        const r = await (0, sync_1.davRequest)(this.profile.dav, 'GET');
        this.notice(r.status === 404 ? '连接成功，远端文件尚不存在' : r.status >= 200 && r.status < 300 ? '连接成功' : 'HTTP ' + r.status);
    }
    catch (e) {
        this.notice(String(e));
    } }
    async pull() { if (!confirm('使用云端快照完全替换本地分类及未同步修改？'))
        return; try {
        const r = await (0, sync_1.davRequest)(this.profile.dav, 'GET');
        if (r.status !== 200)
            throw Error(`HTTP ${r.status}`);
        const e = (0, sync_1.decodeRemote)(r.text, this.account);
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
        if (this.busy || !this.profile.dav.url)
            return;
        if (!manual && (Date.now() < this.syncRetryAt || this.authFailure || !navigator.onLine))
            return;
        if (this.account === 'local') {
            if (manual)
                this.notice('尚未识别 ChatGPT 账号，不能同步');
            return;
        }
        this.busy = true;
        const generation = this.generation, account = this.account;
        this.renderStatus();
        try {
            let finished = false;
            for (let attempt = 0; attempt < 4; attempt++) {
                const read = await (0, sync_1.davRequest)(this.profile.dav, 'GET');
                if (generation !== this.generation)
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
                const result = await (0, sync_1.davRequest)(this.profile.dav, 'PUT', remote ? { 'If-Match': read.etag } : { 'If-None-Match': '*' }, JSON.stringify(envelope));
                if (generation !== this.generation)
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
            this.renderStatus();
        }
    }
    notice(message) { console.info('[CGFM]', message); if (this.status) {
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
// @version      2.0.1
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
    new runtime_1.FolderApplication().start();
}
run();

}};const cache={};function get(name){const key=(name.startsWith('./')?name.slice(2):name);if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn(get,m,m.exports);return m.exports;}get('main');})();

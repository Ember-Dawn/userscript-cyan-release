// ==UserScript==
// @name         ChatGPT文件夹
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @version      2.0.2
// @description  ChatGPT 多级文件夹管理与 WebDAV 跨设备同步（TypeScript 全新重写版）
// @author       Euphoria
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

(function(){'use strict';const registry={"constants":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ICONS = exports.PALETTE_COLORS = exports.KEY_AUTH_PREFIX = exports.KEY_TITLES_PREFIX = exports.KEY_COLLAPSED_PREFIX = exports.KEY_LAST_ACCOUNT = exports.KEY_DEVICE = exports.KEY_PREFIX_ACCOUNT = void 0;
exports.KEY_PREFIX_ACCOUNT = 'cgfm.v2.account.';
exports.KEY_DEVICE = 'cgfm.v2.device';
exports.KEY_LAST_ACCOUNT = 'cgfm.v2.lastAccount';
exports.KEY_COLLAPSED_PREFIX = 'cgfm.v2.collapsed.';
exports.KEY_TITLES_PREFIX = 'cgfm.v2.titles.';
exports.KEY_AUTH_PREFIX = 'cgfm.v2.auth.';
exports.PALETTE_COLORS = [
    '#6b7280', // 默认灰
    '#ef4444', // 红
    '#f97316', // 橙
    '#f59e0b', // 琥珀/黄
    '#10b981', // 绿
    '#06b6d4', // 青
    '#3b82f6', // 蓝
    '#6366f1', // 靛蓝
    '#8b5cf6', // 紫
    '#ec4899', // 粉
];
exports.ICONS = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
    folderOpen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    rail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>'
};

},
"types":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

},
"model":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.naturalSort = exports.defaultProfile = exports.uid = exports.clone = exports.blankData = void 0;
exports.validateData = validateData;
exports.executeCommand = executeCommand;
exports.computeDiff = computeDiff;
const blankData = () => ({
    schema: 2,
    folders: {},
    conversations: {}
});
exports.blankData = blankData;
const clone = (val) => JSON.parse(JSON.stringify(val));
exports.clone = clone;
const uid = () => typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
exports.uid = uid;
const defaultProfile = () => ({
    data: (0, exports.blankData)(),
    base: (0, exports.blankData)(),
    preferences: { sidebarWidth: 312, customWidth: false },
    dav: { url: '', username: '', password: '', file: 'chatgpt-folders-v2.json' },
    pending: [],
    baseRevision: 0,
    etag: null,
    conflicts: []
});
exports.defaultProfile = defaultProfile;
exports.naturalSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function validateData(data) {
    if (data?.schema !== 2 || !data.folders || !data.conversations || Array.isArray(data.folders) || Array.isArray(data.conversations)) {
        throw new Error('不支持的数据格式或 schema 版本不匹配');
    }
    for (const [id, f] of Object.entries(data.folders)) {
        if (f.id !== id || typeof f.name !== 'string' || typeof f.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(f.color)) {
            throw new Error(`文件夹数据损坏: ${id}`);
        }
        if (f.parentId !== null && !data.folders[f.parentId]) {
            throw new Error(`文件夹的父级不存在: ${f.parentId}`);
        }
        const visited = new Set([id]);
        let parent = f.parentId;
        while (parent) {
            if (visited.has(parent))
                throw new Error(`检测到文件夹循环嵌套: ${id}`);
            visited.add(parent);
            parent = data.folders[parent]?.parentId ?? null;
        }
    }
    for (const [id, c] of Object.entries(data.conversations)) {
        if (c.id !== id || !data.folders[c.folderId] || typeof c.title !== 'string') {
            throw new Error(`对话归属无效或标题损坏: ${id}`);
        }
    }
}
function executeCommand(data, cmd) {
    const d = (0, exports.clone)(data);
    const now = Date.now();
    switch (cmd.type) {
        case 'folder.create': {
            if (cmd.parentId && !d.folders[cmd.parentId])
                throw new Error('父文件夹不存在');
            const id = (0, exports.uid)();
            d.folders[id] = {
                id,
                parentId: cmd.parentId ?? null,
                name: (cmd.name ?? '新建文件夹').trim() || '新建文件夹',
                color: cmd.color && /^#[a-f0-9]{6}$/i.test(cmd.color) ? cmd.color : '#6b7280',
                createdAt: now,
                updatedAt: now
            };
            break;
        }
        case 'folder.rename': {
            const f = d.folders[cmd.id];
            if (!f)
                throw new Error('文件夹不存在');
            f.name = cmd.name.trim() || f.name;
            f.updatedAt = now;
            break;
        }
        case 'folder.color': {
            const f = d.folders[cmd.id];
            if (!f || !/^#[a-f0-9]{6}$/i.test(cmd.color))
                throw new Error('无效颜色或文件夹不存在');
            f.color = cmd.color;
            f.updatedAt = now;
            break;
        }
        case 'folder.move': {
            const f = d.folders[cmd.id];
            if (!f)
                throw new Error('文件夹不存在');
            if (cmd.parentId === cmd.id)
                throw new Error('不能将文件夹移动到自身');
            if (cmd.parentId) {
                if (!d.folders[cmd.parentId])
                    throw new Error('目标父文件夹不存在');
                let p = cmd.parentId;
                while (p) {
                    if (p === cmd.id)
                        throw new Error('不能将文件夹移动到其子文件夹中（循环嵌套）');
                    p = d.folders[p]?.parentId ?? null;
                }
            }
            f.parentId = cmd.parentId ?? null;
            f.updatedAt = now;
            break;
        }
        case 'folder.delete': {
            const f = d.folders[cmd.id];
            if (!f)
                throw new Error('文件夹不存在');
            const idsToDelete = new Set([f.id]);
            let sizeBefore = 0;
            while (idsToDelete.size !== sizeBefore) {
                sizeBefore = idsToDelete.size;
                for (const item of Object.values(d.folders)) {
                    if (item.parentId && idsToDelete.has(item.parentId)) {
                        idsToDelete.add(item.id);
                    }
                }
            }
            for (const delId of idsToDelete) {
                delete d.folders[delId];
            }
            for (const [cId, conv] of Object.entries(d.conversations)) {
                if (idsToDelete.has(conv.folderId)) {
                    delete d.conversations[cId];
                }
            }
            break;
        }
        case 'conversation.assign': {
            const folder = d.folders[cmd.folderId];
            if (!folder)
                throw new Error('目标文件夹不存在');
            const prev = d.conversations[cmd.id];
            d.conversations[cmd.id] = {
                id: cmd.id,
                folderId: cmd.folderId,
                title: (cmd.title ?? prev?.title ?? '未命名对话').trim(),
                addedAt: prev?.addedAt || now,
                updatedAt: now
            };
            break;
        }
        case 'conversation.remove': {
            delete d.conversations[cmd.id];
            break;
        }
        case 'conversation.title': {
            const c = d.conversations[cmd.id];
            if (c) {
                c.title = (cmd.title ?? '').trim() || c.title;
                c.updatedAt = now;
            }
            break;
        }
        default:
            throw new Error('未知的业务命令');
    }
    validateData(d);
    return d;
}
function computeDiff(before, after, device, sequence) {
    const result = [];
    for (const kind of ['folder', 'conversation']) {
        const a = kind === 'folder' ? before.folders : before.conversations;
        const b = kind === 'folder' ? after.folders : after.conversations;
        const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const key of allKeys) {
            const valA = a[key];
            const valB = b[key];
            if (JSON.stringify(valA) !== JSON.stringify(valB)) {
                result.push({
                    id: (0, exports.uid)(),
                    device,
                    seq: ++sequence,
                    time: Date.now(),
                    type: `${kind}.${valB ? 'upsert' : 'delete'}`,
                    key,
                    ...(valB ? { value: (0, exports.clone)(valB) } : {})
                });
            }
        }
    }
    return result;
}

},
"storage":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageManager = void 0;
const constants_1 = require("./constants");
const model_1 = require("./model");
class StorageManager {
    currentAccount = 'local';
    deviceId;
    changeListenerId = null;
    onExternalChange;
    constructor(onExternalChange) {
        this.onExternalChange = onExternalChange;
        this.deviceId = this.getOrCreateDeviceId();
    }
    getDeviceId() {
        return this.deviceId;
    }
    getOrCreateDeviceId() {
        let dev = GM_getValue(constants_1.KEY_DEVICE, null);
        if (!dev) {
            dev = (0, model_1.uid)();
            GM_setValue(constants_1.KEY_DEVICE, dev);
        }
        return dev;
    }
    setAccount(account) {
        if (this.currentAccount === account && this.changeListenerId !== null)
            return;
        this.unbindListener();
        this.currentAccount = account;
        GM_setValue(constants_1.KEY_LAST_ACCOUNT, account);
        this.bindListener();
    }
    getAccount() {
        return this.currentAccount;
    }
    getLastAccount() {
        return GM_getValue(constants_1.KEY_LAST_ACCOUNT, 'local');
    }
    getStorageKey() {
        return `${constants_1.KEY_PREFIX_ACCOUNT}${this.currentAccount}`;
    }
    loadProfile() {
        const key = this.getStorageKey();
        const raw = GM_getValue(key, null);
        if (!raw || raw.data?.schema !== 2) {
            return (0, model_1.defaultProfile)();
        }
        try {
            (0, model_1.validateData)(raw.data);
            return raw;
        }
        catch (e) {
            console.warn('[CGFM] Storage validation failed, falling back to clean profile', e);
            return (0, model_1.defaultProfile)();
        }
    }
    saveProfile(profile) {
        const key = this.getStorageKey();
        (0, model_1.validateData)(profile.data);
        GM_setValue(key, profile);
    }
    loadCollapsedFolders() {
        const key = `${constants_1.KEY_COLLAPSED_PREFIX}${this.currentAccount}`;
        return GM_getValue(key, {});
    }
    saveCollapsedFolders(map) {
        const key = `${constants_1.KEY_COLLAPSED_PREFIX}${this.currentAccount}`;
        GM_setValue(key, map);
    }
    bindListener() {
        const key = this.getStorageKey();
        this.changeListenerId = GM_addValueChangeListener(key, (_k, _old, newVal, remote) => {
            if (remote && newVal && this.onExternalChange) {
                try {
                    const prof = newVal;
                    if (prof.data?.schema === 2) {
                        (0, model_1.validateData)(prof.data);
                        this.onExternalChange(prof);
                    }
                }
                catch {
                    // 忽略非法外部写入
                }
            }
        });
    }
    unbindListener() {
        if (this.changeListenerId !== null) {
            GM_removeValueChangeListener(this.changeListenerId);
            this.changeListenerId = null;
        }
    }
    exportJson(data) {
        const payload = {
            format: 'cgfm-v2-export',
            version: 2,
            account: this.currentAccount,
            exportedAt: Date.now(),
            data: (0, model_1.clone)(data)
        };
        return JSON.stringify(payload, null, 2);
    }
    importJson(jsonStr) {
        let payload;
        try {
            payload = JSON.parse(jsonStr);
        }
        catch {
            throw new Error('JSON 解析失败，请检查文件格式');
        }
        if (payload.format !== 'cgfm-v2-export' || payload.version !== 2) {
            throw new Error('不支持的文件格式或版本，请导入由本脚本导出的 v2 备份文件');
        }
        (0, model_1.validateData)(payload.data);
        return payload.data;
    }
}
exports.StorageManager = StorageManager;

},
"api":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatApiManager = void 0;
const constants_1 = require("./constants");
class ChatApiManager {
    accountId = 'local';
    constructor() {
        this.setupInterceptors();
    }
    setAccountId(acc) {
        this.accountId = acc;
    }
    setupInterceptors() {
        try {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const rawFetch = win.fetch;
            const self = this;
            win.fetch = async function (...args) {
                const input = args[0];
                const init = args[1];
                const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
                if (url.includes('/backend-api/')) {
                    let authHeader = null;
                    if (init?.headers) {
                        if (init.headers instanceof Headers) {
                            authHeader = init.headers.get('Authorization');
                        }
                        else if (Array.isArray(init.headers)) {
                            const found = init.headers.find(([k]) => k.toLowerCase() === 'authorization');
                            authHeader = found ? found[1] : null;
                        }
                        else if (typeof init.headers === 'object') {
                            authHeader = init.headers['Authorization'] || init.headers['authorization'] || null;
                        }
                    }
                    if (authHeader && authHeader.startsWith('Bearer ')) {
                        self.saveAuthToken(authHeader);
                    }
                }
                return rawFetch.apply(this, args);
            };
        }
        catch (e) {
            console.warn('[CGFM] Failed to wrap fetch', e);
        }
    }
    saveAuthToken(token) {
        if (!this.accountId || this.accountId === 'local')
            return;
        try {
            const key = `${constants_1.KEY_AUTH_PREFIX}${this.accountId}`;
            const payload = { token, time: Date.now() };
            GM_setValue(key, payload);
        }
        catch {
            // 忽略存储失败
        }
    }
    getAuthToken() {
        if (!this.accountId || this.accountId === 'local')
            return null;
        try {
            const key = `${constants_1.KEY_AUTH_PREFIX}${this.accountId}`;
            const cached = GM_getValue(key, null);
            if (cached && Date.now() - cached.time < 24 * 3600 * 1000) {
                return cached.token;
            }
        }
        catch {
            // 忽略
        }
        return null;
    }
    /**
     * 调用 ChatGPT 官方接口重命名对话
     */
    async renameConversation(chatId, newTitle) {
        const token = this.getAuthToken();
        const url = `https://chatgpt.com/backend-api/conversation/id/${chatId}/rename`;
        return new Promise((resolve) => {
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = token;
            }
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers,
                data: JSON.stringify({ title: newTitle }),
                timeout: 10000,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        this.guardTitle(chatId, newTitle);
                        resolve(true);
                    }
                    else {
                        console.warn('[CGFM] Rename failed with status', res.status);
                        resolve(false);
                    }
                },
                onerror: () => resolve(false),
                ontimeout: () => resolve(false)
            });
        });
    }
    guardTitle(chatId, title) {
        if (!this.accountId)
            return;
        try {
            const key = `${constants_1.KEY_TITLES_PREFIX}${this.accountId}`;
            const map = GM_getValue(key, {});
            map[chatId] = { title, time: Date.now() };
            GM_setValue(key, map);
        }
        catch {
            // 忽略
        }
    }
    getGuardedTitle(chatId) {
        if (!this.accountId)
            return null;
        try {
            const key = `${constants_1.KEY_TITLES_PREFIX}${this.accountId}`;
            const map = GM_getValue(key, {});
            const item = map[chatId];
            if (item && Date.now() - item.time < 7 * 24 * 3600 * 1000) {
                return item.title;
            }
        }
        catch {
            // 忽略
        }
        return null;
    }
}
exports.ChatApiManager = ChatApiManager;

},
"dnd":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PointerDragManager = void 0;
const constants_1 = require("./constants");
class PointerDragManager {
    opts;
    activeSession = null;
    constructor(opts) {
        this.opts = opts;
        this.init();
    }
    init() {
        const { container } = this.opts;
        container.addEventListener('pointerdown', (e) => {
            // 忽略右键、按钮、输入框、上下文菜单
            if (e.button !== 0)
                return;
            const target = e.target;
            if (target.closest('button, input, textarea, .cgfm-menu, .cgfm-confirm-card'))
                return;
            const row = target.closest('.cgfm-row');
            if (!row)
                return;
            const chatId = row.dataset.chatId;
            const folderId = row.dataset.folderId;
            if (!chatId && !folderId)
                return;
            const titleEl = row.querySelector('.cgfm-title');
            const title = titleEl?.textContent?.trim() || '拖拽项目';
            this.activeSession = {
                type: chatId ? 'chat' : 'folder',
                sourceId: chatId || folderId,
                title,
                startX: e.clientX,
                startY: e.clientY,
                isDragging: false,
                preview: null,
                currentTarget: null
            };
            const onPointerMove = (moveEv) => {
                if (!this.activeSession)
                    return;
                const dx = moveEv.clientX - this.activeSession.startX;
                const dy = moveEv.clientY - this.activeSession.startY;
                if (!this.activeSession.isDragging) {
                    if (Math.hypot(dx, dy) >= 5) {
                        this.activeSession.isDragging = true;
                        this.createPreview(moveEv.clientX, moveEv.clientY);
                        this.opts.onDragStart?.();
                        document.body.style.userSelect = 'none';
                    }
                    else {
                        return;
                    }
                }
                this.updatePreview(moveEv.clientX, moveEv.clientY);
                this.highlightDropTarget(moveEv.clientX, moveEv.clientY);
            };
            const cleanup = () => {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', cleanup);
                window.removeEventListener('keydown', onKeyDown);
                document.body.style.userSelect = '';
                if (this.activeSession) {
                    if (this.activeSession.preview) {
                        this.activeSession.preview.remove();
                    }
                    if (this.activeSession.currentTarget) {
                        this.activeSession.currentTarget.classList.remove('cgfm-drag-over');
                    }
                    if (this.activeSession.isDragging) {
                        this.opts.onDragEnd?.();
                    }
                    this.activeSession = null;
                }
            };
            const onPointerUp = (upEv) => {
                if (this.activeSession?.isDragging) {
                    const target = this.resolveDropTarget(upEv.clientX, upEv.clientY);
                    if (target !== undefined) {
                        this.opts.onDrop({
                            type: this.activeSession.type,
                            sourceId: this.activeSession.sourceId,
                            targetFolderId: target,
                            title: this.activeSession.title
                        });
                    }
                }
                cleanup();
            };
            const onKeyDown = (ke) => {
                if (ke.key === 'Escape')
                    cleanup();
            };
            window.addEventListener('pointermove', onPointerMove, { passive: true });
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', cleanup);
            window.addEventListener('keydown', onKeyDown);
        });
    }
    createPreview(x, y) {
        if (!this.activeSession)
            return;
        const preview = document.createElement('div');
        preview.className = 'cgfm-drag-preview';
        preview.innerHTML = `${this.activeSession.type === 'folder' ? constants_1.ICONS.folder : constants_1.ICONS.chat}<span>${this.activeSession.title}</span>`;
        document.body.appendChild(preview);
        this.activeSession.preview = preview;
        this.updatePreview(x, y);
    }
    updatePreview(x, y) {
        if (!this.activeSession?.preview)
            return;
        this.activeSession.preview.style.left = `${x + 12}px`;
        this.activeSession.preview.style.top = `${y + 12}px`;
    }
    resolveDropTarget(x, y) {
        if (!this.activeSession)
            return undefined;
        const el = document.elementFromPoint(x, y);
        if (!el)
            return undefined;
        // 检查是否落在面板标题区（投放到根目录）
        if (el.closest('.cgfm-header')) {
            return null;
        }
        const targetRow = el.closest('.cgfm-row[data-folder-id]');
        if (!targetRow)
            return undefined;
        const targetFolderId = targetRow.dataset.folderId;
        // 拖拽合法性检查
        if (this.activeSession.type === 'folder') {
            const sourceFolderId = this.activeSession.sourceId;
            if (targetFolderId === sourceFolderId)
                return undefined;
            // 检查循环嵌套：目标不能是源文件夹的子孙
            const data = this.opts.getData();
            let p = targetFolderId;
            while (p) {
                if (p === sourceFolderId)
                    return undefined;
                p = data.folders[p]?.parentId ?? null;
            }
        }
        return targetFolderId;
    }
    highlightDropTarget(x, y) {
        if (!this.activeSession)
            return;
        const el = document.elementFromPoint(x, y);
        const targetRow = el?.closest('.cgfm-row[data-folder-id]') ?? null;
        if (this.activeSession.currentTarget && this.activeSession.currentTarget !== targetRow) {
            this.activeSession.currentTarget.classList.remove('cgfm-drag-over');
            this.activeSession.currentTarget = null;
        }
        if (targetRow) {
            const valid = this.resolveDropTarget(x, y) !== undefined;
            if (valid) {
                targetRow.classList.add('cgfm-drag-over');
                this.activeSession.currentTarget = targetRow;
            }
        }
    }
}
exports.PointerDragManager = PointerDragManager;

},
"sync":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.merge = merge;
exports.davRequest = davRequest;
exports.decodeRemote = decodeRemote;
exports.createRemote = createRemote;
const model_1 = require("./model");
/**
 * 基于基准快照的三方字段级合并引擎
 * 删除优先，同属性并发冲突按规范化 JSON 字典序仲裁
 */
function merge(base, local, remote) {
    (0, model_1.validateData)(base);
    (0, model_1.validateData)(local);
    (0, model_1.validateData)(remote);
    const result = (0, model_1.blankData)();
    const conflicts = [];
    const mergeEntities = (kind, bMap, lMap, rMap) => {
        const out = {};
        const allIds = new Set([...Object.keys(bMap), ...Object.keys(lMap), ...Object.keys(rMap)]);
        for (const id of allIds) {
            const bv = bMap[id];
            const lv = lMap[id];
            const rv = rMap[id];
            // 新增情况
            if (!bv) {
                if (lv && rv) {
                    if (JSON.stringify(lv) !== JSON.stringify(rv)) {
                        conflicts.push(`${kind}:${id}:concurrent-create`);
                        out[id] = (0, model_1.clone)(JSON.stringify(lv) < JSON.stringify(rv) ? lv : rv);
                    }
                    else {
                        out[id] = (0, model_1.clone)(lv);
                    }
                }
                else if (lv || rv) {
                    out[id] = (0, model_1.clone)((lv || rv));
                }
                continue;
            }
            // 删除 vs 修改情况
            if (!lv || !rv) {
                if (lv !== rv) {
                    conflicts.push(`${kind}:${id}:delete-vs-edit`);
                    // 如果是对话，且另一方有实质更新，优先保留对话
                    if (kind === 'conversation') {
                        const surviving = lv || rv;
                        if (surviving && JSON.stringify(surviving) !== JSON.stringify(bv)) {
                            out[id] = (0, model_1.clone)(surviving);
                        }
                    }
                }
                continue;
            }
            // 双方都保留，进行字段级合并
            const obj = {};
            const allFields = new Set([
                ...Object.keys(bv),
                ...Object.keys(lv),
                ...Object.keys(rv)
            ]);
            for (const field of allFields) {
                const oldVal = bv[field];
                const localVal = lv[field];
                const remoteVal = rv[field];
                if (JSON.stringify(localVal) === JSON.stringify(remoteVal)) {
                    obj[field] = localVal;
                }
                else if (JSON.stringify(localVal) === JSON.stringify(oldVal)) {
                    obj[field] = remoteVal;
                }
                else if (JSON.stringify(remoteVal) === JSON.stringify(oldVal)) {
                    obj[field] = localVal;
                }
                else {
                    // 真正的并发冲突，选择字典序较小者，并记录冲突日志
                    obj[field] = JSON.stringify(localVal) < JSON.stringify(remoteVal) ? localVal : remoteVal;
                    conflicts.push(`${kind}:${id}:${field}`);
                }
            }
            out[id] = obj;
        }
        return out;
    };
    result.folders = mergeEntities('folder', base.folders, local.folders, remote.folders);
    result.conversations = mergeEntities('conversation', base.conversations, local.conversations, remote.conversations);
    // 修复因并发移动可能导致的循环依赖与失效父级
    for (const f of Object.values(result.folders)) {
        if (f.parentId && !result.folders[f.parentId]) {
            conflicts.push(`folder:${f.id}:missing-parent`);
            f.parentId = null;
        }
    }
    for (const id of Object.keys(result.folders).sort()) {
        const f = result.folders[id];
        const visited = new Set([id]);
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
    // 绝不静默丢失因文件夹删除而成为孤儿的对话，将其挂载到“冲突恢复”安全文件夹
    const orphans = Object.values(result.conversations).filter(c => !result.folders[c.folderId]);
    if (orphans.length > 0) {
        const recoveryId = 'cgfm-recovered-conversations';
        if (!result.folders[recoveryId]) {
            result.folders[recoveryId] = {
                id: recoveryId,
                parentId: null,
                name: '冲突恢复的对话',
                color: '#f59e0b',
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
        }
        for (const c of orphans) {
            conflicts.push(`conversation:${c.id}:orphan:${c.folderId}`);
            c.folderId = recoveryId;
        }
    }
    (0, model_1.validateData)(result);
    return { data: result, conflicts };
}
function davRequest(config, method, extraHeaders = {}, body) {
    const file = config.file || 'chatgpt-folders-v2.json';
    const path = config.url.replace(/\/+$/, '') + '/' + encodeURIComponent(file);
    if (!/^https:\/\//i.test(path)) {
        return Promise.reject(new Error('WebDAV 服务必须使用安全的 HTTPS 协议'));
    }
    return new Promise((resolve, reject) => {
        const headers = {
            Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${config.username}:${config.password}`))),
            ...extraHeaders
        };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json; charset=utf-8';
        }
        GM_xmlhttpRequest({
            method,
            url: path,
            headers,
            data: body,
            timeout: 20000,
            onload: (r) => {
                const rawEtag = (r.responseHeaders || '').match(/^etag:\s*(.+)$/im)?.[1]?.trim() ?? null;
                let etag = null;
                if (rawEtag) {
                    etag = rawEtag
                        .replace(/^W\//i, '')
                        .replace(/-gzip(?="?$)/i, '')
                        .replace(/-br(?="?$)/i, '')
                        .trim();
                    if (!etag.startsWith('"'))
                        etag = `"${etag}"`;
                }
                resolve({
                    status: r.status,
                    text: String(r.responseText || ''),
                    etag
                });
            },
            onerror: () => reject(new Error('WebDAV 网络请求失败，请检查网络或地址')),
            ontimeout: () => reject(new Error('WebDAV 请求超时'))
        });
    });
}
function decodeRemote(raw, account) {
    const env = JSON.parse(raw);
    if (env.protocol !== 'cgfm-v2' ||
        env.version !== 2 ||
        env.account !== account ||
        !Number.isSafeInteger(env.revision)) {
        throw new Error('云端文件版本、协议或绑定的账号不匹配');
    }
    (0, model_1.validateData)(env.data);
    return env;
}
function createRemote(account, device, revision, data) {
    return {
        protocol: 'cgfm-v2',
        version: 2,
        account,
        revision,
        writer: device,
        data: (0, model_1.clone)(data)
    };
}

},
"styles":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STYLES = void 0;
exports.STYLES = `
:root {
  --cg-bg: #ffffff;
  --cg-panel-bg: #ffffff;
  --cg-text: #0d0d0d;
  --cg-border: #e5e7eb;
  --cg-hover: #f3f4f6;
  --cg-input: #f9fafb;
  --cg-muted: #6b7280;
  --cg-shadow: rgba(0, 0, 0, 0.14);
  --cg-accent: #3b82f6;
  --cg-sidebar-width: 312px;
}

:root[class*="dark"], .dark, html[data-theme="dark"] {
  --cg-bg: #171717;
  --cg-panel-bg: #1e1e1e;
  --cg-text: #ececec;
  --cg-border: #303030;
  --cg-hover: #262626;
  --cg-input: #202020;
  --cg-muted: #8e8ea0;
  --cg-shadow: rgba(0, 0, 0, 0.5);
  --cg-accent: #3b82f6;
}

/* 官方导航 Rail 挂载项目容器与按钮 */
#cgfm-rail-entry {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100% !important;
  flex-shrink: 0 !important;
  margin: 4px 0 !important;
  box-sizing: border-box !important;
  pointer-events: auto !important;
  position: relative !important;
  z-index: 50 !important;
}

.cgfm-rail-btn {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 36px !important;
  height: 36px !important;
  border-radius: 8px !important;
  background: transparent !important;
  border: none !important;
  color: #3b82f6 !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  position: relative !important;
  padding: 0 !important;
  box-sizing: border-box !important;
  pointer-events: auto !important;
}
.cgfm-rail-btn:hover, .cgfm-rail-btn.active {
  background: rgba(59, 130, 246, 0.15) !important;
  color: #2563eb !important;
}
.cgfm-rail-btn svg {
  width: 20px !important;
  height: 20px !important;
  color: #3b82f6 !important;
  stroke: #3b82f6 !important;
  pointer-events: none !important;
}

/* 独立根面板（采用 display: none / flex 与最高 z-index 保障可靠显隐） */
#cgfm-root {
  position: fixed !important;
  top: 0 !important;
  bottom: 0 !important;
  height: 100dvh !important;
  width: var(--cg-sidebar-width) !important;
  background: var(--cg-panel-bg) !important;
  color: var(--cg-text) !important;
  border-right: 1px solid var(--cg-border) !important;
  box-shadow: 6px 0 32px var(--cg-shadow) !important;
  z-index: 100000 !important;
  display: none !important;
  flex-direction: column !important;
  font-family: inherit !important;
  font-size: 13px !important;
  user-select: none !important;
  box-sizing: border-box !important;
  pointer-events: auto !important;
}

#cgfm-root.cgfm-open {
  display: flex !important;
}

/* 头部操作栏 */
.cgfm-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--cg-border);
  flex-shrink: 0;
}
.cgfm-header-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--cg-text);
}
.cgfm-header-title svg {
  color: #3b82f6;
  stroke: #3b82f6;
}
.cgfm-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cgfm-tool-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--cg-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cgfm-tool-btn:hover {
  background: var(--cg-hover);
  color: var(--cg-text);
}
.cgfm-tool-btn.active {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}
.cgfm-tool-btn svg {
  width: 16px;
  height: 16px;
}

.cgfm-tool-btn[data-sync-state="synced"] { color: #10b981; }
.cgfm-tool-btn[data-sync-state="pending"] { color: #f59e0b; }
.cgfm-tool-btn[data-sync-state="syncing"] svg { animation: cgfm-spin 1s linear infinite; }
.cgfm-tool-btn[data-sync-state="error"] { color: #ef4444; }

@keyframes cgfm-spin {
  to { transform: rotate(360deg); }
}

/* 滚动区 */
.cgfm-scroll-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 6px;
  scrollbar-width: thin;
}

/* 区域小标题 */
.cgfm-section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--cg-muted);
  letter-spacing: 0.04em;
  padding: 8px 10px 4px;
  margin-top: 6px;
}

/* 文件夹与对话行 */
.cgfm-row {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
  margin: 1px 0;
  transition: background 0.12s ease;
  position: relative;
  gap: 6px;
  box-sizing: border-box;
}
.cgfm-row:hover {
  background: var(--cg-hover);
}
.cgfm-row.cgfm-drag-over {
  background: rgba(59, 130, 246, 0.2) !important;
  outline: 1px dashed var(--cg-accent);
}

.cgfm-chevron {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--cg-muted);
  flex-shrink: 0;
}
.cgfm-chevron svg {
  width: 14px;
  height: 14px;
}

.cgfm-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cgfm-icon {
  width: 16px;
  height: 16px;
  color: var(--cg-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cgfm-icon svg {
  width: 15px;
  height: 15px;
}

.cgfm-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--cg-text);
  line-height: 1.2;
}

.cgfm-row-actions {
  display: none;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.cgfm-row:hover .cgfm-row-actions,
.cgfm-row-actions.active {
  display: flex;
}

.cgfm-mini-btn {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: var(--cg-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.cgfm-mini-btn:hover {
  background: var(--cg-input);
  color: var(--cg-text);
}
.cgfm-mini-btn svg {
  width: 13px;
  height: 13px;
}

/* 行内编辑框 */
.cgfm-inline-edit {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 4px;
}
.cgfm-inline-input {
  flex: 1;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid var(--cg-accent);
  background: var(--cg-input);
  color: var(--cg-text);
  font-size: 12px;
  outline: none;
}

/* 上下文下拉菜单 Dropdown */
.cgfm-menu {
  position: fixed;
  background: var(--cg-panel-bg);
  border: 1px solid var(--cg-border);
  border-radius: 8px;
  box-shadow: 0 10px 25px var(--cg-shadow);
  padding: 4px;
  z-index: 100005;
  display: flex;
  flex-direction: column;
  min-width: 140px;
}
.cgfm-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 5px;
  background: transparent;
  border: none;
  color: var(--cg-text);
  font-size: 12px;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background 0.1s ease;
  position: relative;
}
.cgfm-menu-item:hover {
  background: var(--cg-hover);
}
.cgfm-menu-item.danger {
  color: #ef4444;
}
.cgfm-menu-item svg {
  width: 14px;
  height: 14px;
  color: var(--cg-muted);
}
.cgfm-menu-item.danger svg {
  color: #ef4444;
}

/* 调色板二级色块菜单 (Palette Grid) */
.cgfm-palette-wrap {
  position: relative;
}
.cgfm-palette-grid {
  position: absolute;
  left: 100%;
  top: -4px;
  padding: 6px;
  display: grid;
  grid-template-columns: repeat(5, 20px);
  gap: 6px;
  background: var(--cg-panel-bg);
  border: 1px solid var(--cg-border);
  border-radius: 8px;
  box-shadow: 0 10px 25px var(--cg-shadow);
  display: none;
  z-index: 100006;
}
.cgfm-palette-wrap:hover .cgfm-palette-grid,
.cgfm-palette-grid:hover {
  display: grid;
}
.cgfm-color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: transform 0.1s ease;
}
.cgfm-color-swatch:hover {
  transform: scale(1.18);
}

/* 自绘原位删除确认框 */
.cgfm-confirm-card {
  position: fixed;
  background: var(--cg-panel-bg);
  border: 1px solid var(--cg-border);
  border-radius: 8px;
  box-shadow: 0 12px 28px var(--cg-shadow);
  padding: 12px;
  z-index: 100007;
  width: 200px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cgfm-confirm-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--cg-text);
  line-height: 1.4;
}
.cgfm-confirm-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.cgfm-btn-cancel, .cgfm-btn-danger {
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--cg-border);
}
.cgfm-btn-cancel {
  background: transparent;
  color: var(--cg-text);
}
.cgfm-btn-cancel:hover {
  background: var(--cg-hover);
}
.cgfm-btn-danger {
  background: #ef4444;
  color: #ffffff;
  border-color: #ef4444;
}
.cgfm-btn-danger:hover {
  background: #dc2626;
}

/* 紧凑设置弹窗 */
.cgfm-settings-panel {
  position: fixed;
  top: 0;
  width: 360px;
  max-height: 100vh;
  overflow-y: auto;
  background: var(--cg-panel-bg);
  border-right: 1px solid var(--cg-border);
  box-shadow: 6px 0 24px var(--cg-shadow);
  z-index: 100004;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cgfm-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cgfm-settings-title {
  font-size: 15px;
  font-weight: 600;
}
.cgfm-settings-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cgfm-settings-field label {
  font-size: 12px;
  color: var(--cg-muted);
}
.cgfm-settings-field input[type="text"],
.cgfm-settings-field input[type="password"] {
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--cg-border);
  background: var(--cg-input);
  color: var(--cg-text);
  font-size: 13px;
  outline: none;
}
.cgfm-settings-field input[type="text"]:focus,
.cgfm-settings-field input[type="password"]:focus {
  border-color: var(--cg-accent);
}
.cgfm-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cgfm-action-group {
  display: flex;
  gap: 8px;
}
.cgfm-primary-btn {
  flex: 1;
  height: 32px;
  border-radius: 6px;
  background: #3b82f6;
  color: #ffffff;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.cgfm-primary-btn:hover {
  background: #2563eb;
}
.cgfm-secondary-btn {
  flex: 1;
  height: 32px;
  border-radius: 6px;
  background: var(--cg-hover);
  color: var(--cg-text);
  border: 1px solid var(--cg-border);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.cgfm-secondary-btn:hover {
  background: var(--cg-input);
}
.cgfm-status-box {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--cg-hover);
  border: 1px solid var(--cg-border);
  color: var(--cg-muted);
}
.cgfm-status-box.error {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}
.cgfm-status-box.success {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.3);
}

/* 拖拽浮动预览 */
.cgfm-drag-preview {
  position: fixed;
  pointer-events: none;
  z-index: 100010;
  background: var(--cg-panel-bg);
  border: 1px solid var(--cg-accent);
  box-shadow: 0 8px 20px var(--cg-shadow);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--cg-text);
  opacity: 0.95;
  display: flex;
  align-items: center;
  gap: 6px;
}
`;

},
"ui":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderUiController = void 0;
const constants_1 = require("./constants");
const model_1 = require("./model");
const storage_1 = require("./storage");
const api_1 = require("./api");
const dnd_1 = require("./dnd");
const sync_1 = require("./sync");
const styles_1 = require("./styles");
class FolderUiController {
    storage;
    api;
    dragManager;
    profile;
    collapsedFolders;
    rootEl;
    railEntry = null;
    railBtn = null;
    settingsEl = null;
    activeMenu = null;
    activeConfirmCard = null;
    isOpen = false;
    isPinned = false;
    isHovered = false;
    isEditing = false;
    isDragging = false;
    closeTimer = null;
    mountQueued = false;
    syncState = 'unconfigured';
    isSyncing = false;
    syncRetryTimer = null;
    syncFailures = 0;
    constructor() {
        this.storage = new storage_1.StorageManager((newProfile) => {
            this.profile = newProfile;
            this.render();
        });
        this.api = new api_1.ChatApiManager();
        this.profile = this.storage.loadProfile();
        this.collapsedFolders = this.storage.loadCollapsedFolders();
        this.isPinned = this.profile.preferences.customWidth;
    }
    init() {
        this.injectStyles();
        this.createRootPanel();
        this.setupRailWatcher();
        this.setupAccountWatcher();
        this.setupVisibilityWatcher();
        this.dragManager = new dnd_1.PointerDragManager({
            container: this.rootEl,
            getData: () => this.profile.data,
            onDragStart: () => {
                this.isDragging = true;
            },
            onDragEnd: () => {
                this.isDragging = false;
            },
            onDrop: (payload) => {
                this.handleDrop(payload);
            }
        });
        this.updateSyncState();
        this.render();
    }
    injectStyles() {
        if (document.getElementById('cgfm-styles'))
            return;
        const style = document.createElement('style');
        style.id = 'cgfm-styles';
        style.textContent = styles_1.STYLES;
        document.head.appendChild(style);
    }
    createRootPanel() {
        if (document.getElementById('cgfm-root'))
            return;
        this.rootEl = document.createElement('div');
        this.rootEl.id = 'cgfm-root';
        this.updatePanelWidth(this.profile.preferences.sidebarWidth || 312);
        const onEnter = () => {
            this.isHovered = true;
            this.clearCloseTimer();
        };
        const onLeave = () => {
            this.isHovered = false;
            this.scheduleClose();
        };
        this.rootEl.addEventListener('pointerenter', onEnter);
        this.rootEl.addEventListener('mouseenter', onEnter);
        this.rootEl.addEventListener('pointerleave', onLeave);
        this.rootEl.addEventListener('mouseleave', onLeave);
        document.body.appendChild(this.rootEl);
        // 全局点击关闭菜单
        window.addEventListener('click', (e) => {
            const target = e.target;
            if (this.activeMenu && !this.activeMenu.contains(target) && !target.closest('.cgfm-mini-btn')) {
                this.closeActiveMenu();
            }
            if (this.activeConfirmCard && !this.activeConfirmCard.contains(target)) {
                this.closeActiveConfirm();
            }
        }, { capture: true });
    }
    updatePanelWidth(width) {
        const val = Math.max(260, Math.min(500, width));
        this.profile.preferences.sidebarWidth = val;
        this.rootEl.style.setProperty('--cg-sidebar-width', `${val}px`);
    }
    updatePosition() {
        const rail = document.querySelector('nav[data-app-navigation-rail="true"], nav[aria-label="应用导航"], nav[aria-label="App navigation"], #app-shell-sidebar nav');
        if (rail && this.rootEl) {
            const rect = rail.getBoundingClientRect();
            const right = Math.max(0, Math.round(rect.right));
            this.rootEl.style.left = `${right}px`;
        }
        else if (this.rootEl) {
            this.rootEl.style.left = '52px';
        }
    }
    setupRailWatcher() {
        const queueMount = () => {
            if (this.mountQueued)
                return;
            this.mountQueued = true;
            window.requestAnimationFrame(() => {
                this.mountQueued = false;
                this.tryMount();
            });
        };
        this.tryMount();
        const obs = new MutationObserver(() => queueMount());
        obs.observe(document.documentElement, { childList: true, subtree: true });
        window.setInterval(() => queueMount(), 2000);
    }
    tryMount() {
        const rail = document.querySelector('nav[data-app-navigation-rail="true"], nav[aria-label="应用导航"], nav[aria-label="App navigation"], #app-shell-sidebar nav');
        if (!rail)
            return;
        // 定位实际项目列表容器
        const host = rail.querySelector('[data-appearance="plain"], .group\\/nav-list');
        if (!host)
            return;
        if (!this.railEntry || !this.railBtn) {
            const entry = document.createElement('div');
            entry.id = 'cgfm-rail-entry';
            const btn = document.createElement('button');
            btn.className = 'cgfm-rail-btn';
            btn.type = 'button';
            btn.title = 'ChatGPT 文件夹（悬停展开，点击固定）';
            btn.innerHTML = constants_1.ICONS.rail;
            const handleEnter = () => {
                this.isHovered = true;
                this.clearCloseTimer();
                this.openPanel();
            };
            const handleLeave = () => {
                this.isHovered = false;
                this.scheduleClose();
            };
            const handleActivate = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.clearCloseTimer();
                if (!this.isOpen) {
                    this.isPinned = true;
                    this.openPanel();
                }
                else {
                    this.isPinned = !this.isPinned;
                    if (!this.isPinned) {
                        this.closePanel();
                    }
                }
                this.render();
            };
            btn.addEventListener('pointerenter', handleEnter);
            btn.addEventListener('mouseenter', handleEnter);
            btn.addEventListener('pointerleave', handleLeave);
            btn.addEventListener('mouseleave', handleLeave);
            btn.addEventListener('click', handleActivate, { capture: true });
            btn.addEventListener('pointerdown', (e) => e.stopPropagation(), { capture: true });
            entry.appendChild(btn);
            this.railEntry = entry;
            this.railBtn = btn;
        }
        // 需求：放在「更多/探索」图标的下面
        const moreBtn = host.querySelector('[data-slot="popover-trigger"], button[aria-haspopup="dialog"], [data-slate-sidebar-peek-area="customize"]')?.closest('button, .flex.shrink-0');
        if (moreBtn && moreBtn.parentElement === host) {
            if (this.railEntry.previousElementSibling !== moreBtn) {
                moreBtn.after(this.railEntry);
            }
        }
        else {
            if (this.railEntry.parentElement !== host) {
                host.appendChild(this.railEntry);
            }
        }
    }
    setupAccountWatcher() {
        const checkAccount = () => {
            let detectedAccount = 'local';
            try {
                const boot = document.getElementById('client-bootstrap')?.textContent;
                if (boot) {
                    const val = JSON.parse(boot);
                    const user = val.session?.user || val.user;
                    const account = val.session?.account || val.account;
                    const id = account?.id || user?.email || user?.id;
                    if (id)
                        detectedAccount = id;
                }
                else {
                    const match = document.cookie.match(/_account=([^;]+)/);
                    if (match)
                        detectedAccount = match[1];
                }
            }
            catch {
                // 忽略
            }
            if (detectedAccount !== this.storage.getAccount()) {
                this.storage.setAccount(detectedAccount);
                this.api.setAccountId(detectedAccount);
                this.profile = this.storage.loadProfile();
                this.collapsedFolders = this.storage.loadCollapsedFolders();
                this.render();
            }
        };
        checkAccount();
        setInterval(checkAccount, 3000);
    }
    setupVisibilityWatcher() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                if (this.profile.pending.length > 0) {
                    this.sync(false);
                }
            }
        });
    }
    openPanel() {
        this.updatePosition();
        this.isOpen = true;
        this.rootEl.classList.add('cgfm-open');
        if (this.railBtn)
            this.railBtn.classList.add('active');
    }
    closePanel() {
        if (this.isPinned ||
            this.isHovered ||
            this.isEditing ||
            this.isDragging ||
            this.settingsEl ||
            this.activeMenu ||
            this.activeConfirmCard) {
            return;
        }
        this.isOpen = false;
        this.rootEl.classList.remove('cgfm-open');
        if (this.railBtn)
            this.railBtn.classList.remove('active');
        this.closeActiveMenu();
        this.closeActiveConfirm();
    }
    togglePin() {
        this.isPinned = !this.isPinned;
        this.profile.preferences.customWidth = this.isPinned;
        this.storage.saveProfile(this.profile);
        if (this.isPinned) {
            this.openPanel();
        }
        else {
            this.closePanel();
        }
        this.render();
    }
    scheduleClose() {
        this.clearCloseTimer();
        this.closeTimer = window.setTimeout(() => {
            this.closePanel();
        }, 350);
    }
    clearCloseTimer() {
        if (this.closeTimer !== null) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
    }
    render() {
        if (!this.rootEl)
            return;
        this.rootEl.innerHTML = `
      <div class="cgfm-header">
        <div class="cgfm-header-title">
          ${constants_1.ICONS.folder}
          <span>文件夹</span>
        </div>
        <div class="cgfm-header-actions">
          <button class="cgfm-tool-btn" data-act="create-root" title="新建文件夹">${constants_1.ICONS.plus}</button>
          <button class="cgfm-tool-btn" data-act="sync" data-sync-state="${this.syncState}" title="立即同步">${constants_1.ICONS.sync}</button>
          <button class="cgfm-tool-btn" data-act="settings" title="设置">${constants_1.ICONS.settings}</button>
          <button class="cgfm-tool-btn ${this.isPinned ? 'active' : ''}" data-act="pin" title="${this.isPinned ? '取消固定' : '固定面板'}">${constants_1.ICONS.pin}</button>
        </div>
      </div>
      <div class="cgfm-scroll-area">
        <div class="cgfm-folder-tree"></div>
        <div class="cgfm-section-label">最近对话</div>
        <div class="cgfm-recent-list"></div>
      </div>
    `;
        // 绑定头部操作事件
        const header = this.rootEl.querySelector('.cgfm-header');
        header.addEventListener('click', (e) => {
            const btn = e.target.closest('.cgfm-tool-btn');
            if (!btn)
                return;
            const act = btn.dataset.act;
            if (act === 'create-root') {
                this.handleCreateFolder(null);
            }
            else if (act === 'sync') {
                this.sync(true);
            }
            else if (act === 'settings') {
                this.toggleSettings();
            }
            else if (act === 'pin') {
                this.togglePin();
            }
        });
        // 渲染文件夹树
        const treeEl = this.rootEl.querySelector('.cgfm-folder-tree');
        this.renderFolderTree(treeEl);
        // 渲染最近对话
        const recentEl = this.rootEl.querySelector('.cgfm-recent-list');
        this.renderRecentChats(recentEl);
    }
    renderFolderTree(container) {
        const { folders, conversations } = this.profile.data;
        const childrenMap = {};
        for (const f of Object.values(folders)) {
            const p = f.parentId || '__root__';
            if (!childrenMap[p])
                childrenMap[p] = [];
            childrenMap[p].push(f);
        }
        for (const list of Object.values(childrenMap)) {
            list.sort((a, b) => model_1.naturalSort.compare(a.name, b.name));
        }
        const renderLevel = (parentId, depth) => {
            const list = childrenMap[parentId || '__root__'] || [];
            for (const f of list) {
                const isCollapsed = !!this.collapsedFolders[f.id];
                const row = document.createElement('div');
                row.className = 'cgfm-row';
                row.dataset.folderId = f.id;
                row.style.paddingLeft = `${depth * 14 + 8}px`;
                row.innerHTML = `
          <span class="cgfm-chevron" data-act="toggle">${isCollapsed ? constants_1.ICONS.chevronRight : constants_1.ICONS.chevronDown}</span>
          <span class="cgfm-dot" style="background-color: ${f.color || '#3b82f6'}"></span>
          <span class="cgfm-title">${f.name}</span>
          <div class="cgfm-row-actions">
            <button class="cgfm-mini-btn" data-act="menu" title="文件夹操作">${constants_1.ICONS.dots}</button>
          </div>
        `;
                row.addEventListener('click', (e) => {
                    const target = e.target;
                    const miniBtn = target.closest('.cgfm-mini-btn');
                    if (miniBtn?.dataset.act === 'menu') {
                        e.stopPropagation();
                        this.showFolderContextMenu(f, miniBtn);
                        return;
                    }
                    if (target.closest('.cgfm-chevron') || target === row || target.classList.contains('cgfm-title')) {
                        this.toggleFolderCollapse(f.id);
                    }
                });
                container.appendChild(row);
                if (!isCollapsed) {
                    const chats = Object.values(conversations).filter((c) => c.folderId === f.id);
                    chats.sort((a, b) => model_1.naturalSort.compare(a.title, b.title));
                    for (const c of chats) {
                        const chatRow = document.createElement('div');
                        chatRow.className = 'cgfm-row';
                        chatRow.dataset.chatId = c.id;
                        chatRow.style.paddingLeft = `${(depth + 1) * 14 + 8}px`;
                        chatRow.innerHTML = `
              <span class="cgfm-icon">${constants_1.ICONS.chat}</span>
              <span class="cgfm-title" title="${c.title}">${c.title}</span>
              <div class="cgfm-row-actions">
                <button class="cgfm-mini-btn" data-act="edit" title="重命名">${constants_1.ICONS.edit}</button>
                <button class="cgfm-mini-btn" data-act="remove" title="从文件夹移出">${constants_1.ICONS.trash}</button>
              </div>
            `;
                        chatRow.addEventListener('click', (e) => {
                            const target = e.target;
                            const btn = target.closest('.cgfm-mini-btn');
                            if (btn) {
                                e.stopPropagation();
                                if (btn.dataset.act === 'edit') {
                                    this.startInlineRename(chatRow, c.id, c.title);
                                }
                                else if (btn.dataset.act === 'remove') {
                                    this.handleRemoveChat(c.id);
                                }
                                return;
                            }
                            window.location.href = `https://chatgpt.com/c/${c.id}`;
                        });
                        container.appendChild(chatRow);
                    }
                    renderLevel(f.id, depth + 1);
                }
            }
        };
        renderLevel(null, 0);
    }
    renderRecentChats(container) {
        const nativeLinks = document.querySelectorAll('[data-sidebar-chatgpt-conversation-key^="chatgpt:conversation:"], nav a[href*="/c/"]');
        const seenIds = new Set();
        for (const el of nativeLinks) {
            const key = el.getAttribute('data-sidebar-chatgpt-conversation-key');
            const href = el.getAttribute('href') || (el.querySelector('a')?.getAttribute('href') ?? '');
            const match = key ? key.replace('chatgpt:conversation:', '') : href.match(/\/c\/([a-z0-9-]+)/i)?.[1];
            if (!match)
                continue;
            const id = match;
            if (seenIds.has(id))
                continue;
            seenIds.add(id);
            if (this.profile.data.conversations[id])
                continue;
            let title = el.textContent?.trim() || el.getAttribute('title') || '未命名对话';
            const guarded = this.api.getGuardedTitle(id);
            if (guarded)
                title = guarded;
            const row = document.createElement('div');
            row.className = 'cgfm-row';
            row.dataset.chatId = id;
            row.innerHTML = `
        <span class="cgfm-icon">${constants_1.ICONS.chat}</span>
        <span class="cgfm-title" title="${title}">${title}</span>
        <div class="cgfm-row-actions">
          <button class="cgfm-mini-btn" data-act="edit" title="重命名">${constants_1.ICONS.edit}</button>
        </div>
      `;
            row.addEventListener('click', (e) => {
                const target = e.target;
                const btn = target.closest('.cgfm-mini-btn');
                if (btn?.dataset.act === 'edit') {
                    e.stopPropagation();
                    this.startInlineRename(row, id, title);
                    return;
                }
                window.location.href = `https://chatgpt.com/c/${id}`;
            });
            container.appendChild(row);
        }
    }
    toggleFolderCollapse(folderId) {
        this.collapsedFolders[folderId] = !this.collapsedFolders[folderId];
        this.storage.saveCollapsedFolders(this.collapsedFolders);
        this.render();
    }
    startInlineRename(row, chatId, currentTitle) {
        this.isEditing = true;
        const titleEl = row.querySelector('.cgfm-title');
        const actionsEl = row.querySelector('.cgfm-row-actions');
        if (!titleEl || !actionsEl)
            return;
        titleEl.style.display = 'none';
        actionsEl.style.display = 'none';
        const editWrap = document.createElement('div');
        editWrap.className = 'cgfm-inline-edit';
        editWrap.innerHTML = `
      <input type="text" class="cgfm-inline-input" value="${currentTitle.replace(/"/g, '&quot;')}" />
      <button class="cgfm-mini-btn" data-act="save" title="保存">${constants_1.ICONS.check}</button>
      <button class="cgfm-mini-btn" data-act="cancel" title="取消">${constants_1.ICONS.close}</button>
    `;
        const input = editWrap.querySelector('input');
        let isComposing = false;
        input.addEventListener('compositionstart', () => (isComposing = true));
        input.addEventListener('compositionend', () => (isComposing = false));
        const finish = (saved) => {
            this.isEditing = false;
            editWrap.remove();
            titleEl.style.display = '';
            actionsEl.style.display = '';
            if (saved) {
                const newTitle = input.value.trim();
                if (newTitle && newTitle !== currentTitle) {
                    titleEl.textContent = newTitle;
                    titleEl.title = newTitle;
                    this.api.renameConversation(chatId, newTitle).then((ok) => {
                        if (ok) {
                            if (this.profile.data.conversations[chatId]) {
                                this.executeChange({ type: 'conversation.title', id: chatId, title: newTitle });
                            }
                        }
                    });
                }
            }
        };
        input.addEventListener('keydown', (e) => {
            if (isComposing)
                return;
            if (e.key === 'Enter')
                finish(true);
            if (e.key === 'Escape')
                finish(false);
        });
        editWrap.addEventListener('click', (e) => {
            const btn = e.target.closest('.cgfm-mini-btn');
            if (!btn)
                return;
            e.stopPropagation();
            if (btn.dataset.act === 'save')
                finish(true);
            if (btn.dataset.act === 'cancel')
                finish(false);
        });
        row.insertBefore(editWrap, actionsEl);
        input.focus();
        input.select();
    }
    showFolderContextMenu(folder, anchorBtn) {
        this.closeActiveMenu();
        this.closeActiveConfirm();
        const rect = anchorBtn.getBoundingClientRect();
        const menu = document.createElement('div');
        menu.className = 'cgfm-menu';
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${Math.min(rect.left, window.innerWidth - 160)}px`;
        const paletteHtml = constants_1.PALETTE_COLORS.map((c) => `<div class="cgfm-color-swatch" style="background-color: ${c}" data-color="${c}"></div>`).join('');
        menu.innerHTML = `
      <button class="cgfm-menu-item" data-act="add-sub">${constants_1.ICONS.plus}<span>创建子文件夹</span></button>
      <div class="cgfm-palette-wrap">
        <button class="cgfm-menu-item" data-act="color">${constants_1.ICONS.palette}<span>修改颜色</span></button>
        <div class="cgfm-palette-grid">${paletteHtml}</div>
      </div>
      <button class="cgfm-menu-item" data-act="rename">${constants_1.ICONS.edit}<span>重命名</span></button>
      <button class="cgfm-menu-item danger" data-act="delete">${constants_1.ICONS.trash}<span>删除文件夹</span></button>
    `;
        menu.addEventListener('click', (e) => {
            const target = e.target;
            const swatch = target.closest('.cgfm-color-swatch');
            if (swatch) {
                const color = swatch.dataset.color;
                this.executeChange({ type: 'folder.color', id: folder.id, color });
                this.closeActiveMenu();
                return;
            }
            const item = target.closest('.cgfm-menu-item');
            if (!item)
                return;
            const act = item.dataset.act;
            if (act === 'add-sub') {
                this.closeActiveMenu();
                this.handleCreateFolder(folder.id);
            }
            else if (act === 'rename') {
                this.closeActiveMenu();
                const newName = prompt('重命名文件夹', folder.name);
                if (newName && newName.trim()) {
                    this.executeChange({ type: 'folder.rename', id: folder.id, name: newName.trim() });
                }
            }
            else if (act === 'delete') {
                this.closeActiveMenu();
                this.showDeleteConfirm(folder, rect);
            }
        });
        document.body.appendChild(menu);
        this.activeMenu = menu;
    }
    closeActiveMenu() {
        if (this.activeMenu) {
            this.activeMenu.remove();
            this.activeMenu = null;
        }
    }
    showDeleteConfirm(folder, anchorRect) {
        this.closeActiveConfirm();
        const card = document.createElement('div');
        card.className = 'cgfm-confirm-card';
        card.style.top = `${anchorRect.top}px`;
        card.style.left = `${Math.min(anchorRect.left, window.innerWidth - 220)}px`;
        card.innerHTML = `
      <div class="cgfm-confirm-title">确认删除文件夹「${folder.name}」？其下对话将还原为未分类。</div>
      <div class="cgfm-confirm-actions">
        <button class="cgfm-btn-cancel">取消</button>
        <button class="cgfm-btn-danger">确认删除</button>
      </div>
    `;
        card.querySelector('.cgfm-btn-cancel').addEventListener('click', () => {
            this.closeActiveConfirm();
        });
        card.querySelector('.cgfm-btn-danger').addEventListener('click', () => {
            this.closeActiveConfirm();
            this.executeChange({ type: 'folder.delete', id: folder.id });
        });
        document.body.appendChild(card);
        this.activeConfirmCard = card;
    }
    closeActiveConfirm() {
        if (this.activeConfirmCard) {
            this.activeConfirmCard.remove();
            this.activeConfirmCard = null;
        }
    }
    handleCreateFolder(parentId) {
        const name = prompt('请输入新文件夹名称', '新建文件夹');
        if (!name || !name.trim())
            return;
        this.executeChange({ type: 'folder.create', parentId, name: name.trim() });
    }
    handleRemoveChat(chatId) {
        this.executeChange({ type: 'conversation.remove', id: chatId });
    }
    handleDrop(payload) {
        try {
            if (payload.type === 'folder') {
                this.executeChange({
                    type: 'folder.move',
                    id: payload.sourceId,
                    parentId: payload.targetFolderId
                });
            }
            else {
                if (!payload.targetFolderId)
                    return;
                this.executeChange({
                    type: 'conversation.assign',
                    id: payload.sourceId,
                    folderId: payload.targetFolderId,
                    title: payload.title
                });
            }
        }
        catch (e) {
            alert(String(e));
        }
    }
    executeChange(cmd) {
        try {
            const before = this.profile.data;
            const after = (0, model_1.executeCommand)(before, cmd);
            this.profile.data = after;
            this.profile.pending.push({
                id: (0, model_1.uid)(),
                device: this.storage.getDeviceId(),
                seq: Date.now(),
                time: Date.now(),
                type: 'folder.upsert',
                key: 'batch'
            });
            this.storage.saveProfile(this.profile);
            this.render();
            this.scheduleSync();
        }
        catch (e) {
            alert(String(e));
        }
    }
    scheduleSync() {
        this.updateSyncState();
        if (this.syncRetryTimer !== null)
            return;
        this.syncRetryTimer = window.setTimeout(() => {
            this.syncRetryTimer = null;
            this.sync(false);
        }, 1500);
    }
    updateSyncState() {
        if (!this.profile.dav.url) {
            this.syncState = 'unconfigured';
        }
        else if (this.isSyncing) {
            this.syncState = 'syncing';
        }
        else if (this.syncFailures > 0) {
            this.syncState = 'error';
        }
        else if (this.profile.pending.length > 0) {
            this.syncState = 'pending';
        }
        else {
            this.syncState = 'synced';
        }
    }
    async sync(manual) {
        if (this.isSyncing)
            return;
        if (!this.profile.dav.url) {
            if (manual)
                alert('请先在设置中配置 WebDAV HTTPS 地址与凭据');
            return;
        }
        this.isSyncing = true;
        this.updateSyncState();
        this.renderSyncButton();
        try {
            const readRes = await (0, sync_1.davRequest)(this.profile.dav, 'GET');
            let remoteData = null;
            let remoteRevision = 0;
            if (readRes.status === 200) {
                const env = (0, sync_1.decodeRemote)(readRes.text, this.storage.getAccount());
                remoteData = env.data;
                remoteRevision = env.revision;
            }
            else if (readRes.status !== 404) {
                throw new Error(`云端读取失败 (HTTP ${readRes.status})`);
            }
            const baseline = this.profile.base;
            const local = this.profile.data;
            const mergedRes = remoteData
                ? (0, sync_1.merge)(baseline, local, remoteData)
                : { data: local, conflicts: [] };
            const newEnvelope = (0, sync_1.createRemote)(this.storage.getAccount(), this.storage.getDeviceId(), remoteRevision + 1, mergedRes.data);
            const headers = remoteData && readRes.etag
                ? { 'If-Match': readRes.etag }
                : { 'If-None-Match': '*' };
            const putRes = await (0, sync_1.davRequest)(this.profile.dav, 'PUT', headers, JSON.stringify(newEnvelope));
            if (putRes.status < 200 || putRes.status >= 300) {
                throw new Error(`云端写入失败 (HTTP ${putRes.status})`);
            }
            this.profile.data = mergedRes.data;
            this.profile.base = mergedRes.data;
            this.profile.baseRevision = newEnvelope.revision;
            this.profile.etag = putRes.etag;
            this.profile.pending = [];
            this.profile.conflicts = [];
            this.syncFailures = 0;
            this.storage.saveProfile(this.profile);
            this.render();
            if (manual)
                alert('WebDAV 同步成功！');
        }
        catch (err) {
            this.syncFailures++;
            console.warn('[CGFM] Sync error', err);
            if (manual)
                alert(`同步失败: ${String(err)}`);
        }
        finally {
            this.isSyncing = false;
            this.updateSyncState();
            this.renderSyncButton();
        }
    }
    renderSyncButton() {
        const btn = this.rootEl?.querySelector('.cgfm-tool-btn[data-act="sync"]');
        if (btn) {
            btn.dataset.syncState = this.syncState;
        }
    }
    toggleSettings() {
        if (this.settingsEl) {
            this.settingsEl.remove();
            this.settingsEl = null;
            return;
        }
        const panel = document.createElement('div');
        panel.className = 'cgfm-settings-panel';
        panel.style.left = `calc(${this.rootEl.style.left || '52px'} + var(--cg-sidebar-width))`;
        const currentWidth = this.profile.preferences.sidebarWidth || 312;
        panel.innerHTML = `
      <div class="cgfm-settings-header">
        <span class="cgfm-settings-title">文件夹设置</span>
        <button class="cgfm-mini-btn" data-act="close">${constants_1.ICONS.close}</button>
      </div>

      <div class="cgfm-settings-field">
        <label>面板宽度 (<span class="cgfm-width-num">${currentWidth}</span>px)</label>
        <input type="range" class="cgfm-width-slider" min="260" max="500" step="5" value="${currentWidth}" />
      </div>

      <div class="cgfm-settings-field">
        <label>WebDAV HTTPS 目录</label>
        <input type="text" class="cgfm-dav-url" placeholder="https://dav.example.com/folders/" value="${this.profile.dav.url}" />
      </div>

      <div class="cgfm-settings-row">
        <div class="cgfm-settings-field" style="flex:1; margin-right:8px;">
          <label>WebDAV 用户名</label>
          <input type="text" class="cgfm-dav-user" value="${this.profile.dav.username}" />
        </div>
        <div class="cgfm-settings-field" style="flex:1;">
          <label>密码 / App Token</label>
          <input type="password" class="cgfm-dav-pass" value="${this.profile.dav.password}" />
        </div>
      </div>

      <div class="cgfm-settings-field">
        <label>云端文件名</label>
        <input type="text" class="cgfm-dav-file" value="${this.profile.dav.file || 'chatgpt-folders-v2.json'}" />
      </div>

      <div class="cgfm-action-group">
        <button class="cgfm-secondary-btn" data-act="test-dav">测试连接</button>
        <button class="cgfm-primary-btn" data-act="save-dav">保存配置</button>
      </div>

      <div class="cgfm-status-box" style="display:none;"></div>

      <div class="cgfm-action-group" style="margin-top:10px;">
        <button class="cgfm-secondary-btn" data-act="export">导出 JSON</button>
        <button class="cgfm-secondary-btn" data-act="import">导入 JSON</button>
      </div>
    `;
        const slider = panel.querySelector('.cgfm-width-slider');
        const widthNum = panel.querySelector('.cgfm-width-num');
        slider.addEventListener('input', () => {
            const val = parseInt(slider.value, 10);
            widthNum.textContent = String(val);
            this.updatePanelWidth(val);
        });
        panel.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn)
                return;
            const act = btn.dataset.act;
            const statusBox = panel.querySelector('.cgfm-status-box');
            if (act === 'close') {
                this.toggleSettings();
            }
            else if (act === 'save-dav') {
                this.profile.dav.url = panel.querySelector('.cgfm-dav-url').value.trim();
                this.profile.dav.username = panel.querySelector('.cgfm-dav-user').value.trim();
                this.profile.dav.password = panel.querySelector('.cgfm-dav-pass').value.trim();
                this.profile.dav.file = panel.querySelector('.cgfm-dav-file').value.trim() || 'chatgpt-folders-v2.json';
                this.storage.saveProfile(this.profile);
                this.updateSyncState();
                this.renderSyncButton();
                statusBox.style.display = 'block';
                statusBox.className = 'cgfm-status-box success';
                statusBox.textContent = '配置已保存';
            }
            else if (act === 'test-dav') {
                statusBox.style.display = 'block';
                statusBox.className = 'cgfm-status-box';
                statusBox.textContent = '正在测试连接...';
                try {
                    const cfg = {
                        url: panel.querySelector('.cgfm-dav-url').value.trim(),
                        username: panel.querySelector('.cgfm-dav-user').value.trim(),
                        password: panel.querySelector('.cgfm-dav-pass').value.trim(),
                        file: panel.querySelector('.cgfm-dav-file').value.trim() || 'chatgpt-folders-v2.json'
                    };
                    const res = await (0, sync_1.davRequest)(cfg, 'GET');
                    statusBox.className = 'cgfm-status-box success';
                    statusBox.textContent = res.status === 404 ? '连接成功（远端文件尚不存在）' : `连接成功 (HTTP ${res.status})`;
                }
                catch (err) {
                    statusBox.className = 'cgfm-status-box error';
                    statusBox.textContent = String(err);
                }
            }
            else if (act === 'export') {
                const json = this.storage.exportJson(this.profile.data);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `chatgpt-folders-v2-${this.storage.getAccount()}-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
            }
            else if (act === 'import') {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = '.json,application/json';
                fileInput.onchange = () => {
                    const file = fileInput.files?.[0];
                    if (!file)
                        return;
                    const reader = new FileReader();
                    reader.onload = () => {
                        try {
                            const data = this.storage.importJson(String(reader.result));
                            if (confirm('确认使用导入的数据替换当前文件夹结构吗？')) {
                                this.profile.data = data;
                                this.storage.saveProfile(this.profile);
                                this.render();
                                alert('导入成功！');
                            }
                        }
                        catch (err) {
                            alert(`导入失败: ${String(err)}`);
                        }
                    };
                    reader.readAsText(file);
                };
                fileInput.click();
            }
        });
        document.body.appendChild(panel);
        this.settingsEl = panel;
    }
}
exports.FolderUiController = FolderUiController;

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
// @version      2.0.2
// @description  ChatGPT 多级文件夹管理与 WebDAV 跨设备同步（TypeScript 全新重写版）
// @author       Euphoria
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
const ui_1 = require("./ui");
function bootstrap() {
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
        return;
    }
    if (document.getElementById('cgfm-root'))
        return;
    try {
        const app = new ui_1.FolderUiController();
        app.init();
    }
    catch (err) {
        console.error('[CGFM] Failed to initialize ChatGPT Folders:', err);
    }
}
bootstrap();

}};const cache={};function get(name){const key=(name.startsWith('./')?name.slice(2):name);if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn(get,m,m.exports);return m.exports;}get('main');})();

// ==UserScript==
// @name         ChatGPT文件夹
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @version      2.0.17
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
exports.ICONS = exports.PALETTE_COLORS = exports.KEY_AUTH_PREFIX = exports.KEY_TITLES_PREFIX = exports.KEY_RECENT_PREFIX = exports.KEY_COLLAPSED_PREFIX = exports.KEY_LAST_ACCOUNT = exports.KEY_DEVICE = exports.KEY_PREFIX_ACCOUNT = void 0;
// 存储键名常量
exports.KEY_PREFIX_ACCOUNT = 'cgfm.v2.account.';
exports.KEY_DEVICE = 'cgfm.v2.device';
exports.KEY_LAST_ACCOUNT = 'cgfm.v2.lastAccount';
exports.KEY_COLLAPSED_PREFIX = 'cgfm.v2.collapsed.';
exports.KEY_RECENT_PREFIX = 'cgfm.v2.recent.';
exports.KEY_TITLES_PREFIX = 'cgfm.v2.titles.';
exports.KEY_AUTH_PREFIX = 'cgfm.v2.auth.';
// 10 种现代高质感色块 + 默认蓝色/灰色
exports.PALETTE_COLORS = [
    '#3b82f6', // 经典蓝 (默认)
    '#10b981', // 翡翠绿
    '#06b6d4', // 青蓝
    '#8b5cf6', // 紫罗兰
    '#ec4899', // 玫红
    '#f59e0b', // 琥珀黄
    '#f97316', // 活力橙
    '#ef4444', // 珊瑚红
    '#6366f1', // 靛蓝
    '#6b7280' // 沉静灰
];
// 正统标准的 Lucide SVG 图标集 (基于 Lucide 官方 24x24 矢量规范)
exports.ICONS = {
    // 文件夹 (折叠状态)
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
    // 文件夹侧栏按钮加粗版
    folderBold: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
    // 文件夹 (展开状态)
    folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`,
    // 对话气泡 (MessageSquare)
    messageSquare: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    // 圆形对话气泡 (MessageCircle，用户指定标准圆形)
    messageCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`,
    // 新建 (Plus)
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
    // 同步刷新 (RotateCw)
    rotateCw: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,
    // 设置 (Settings)
    settings: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    // 固定 (Pin，未固定状态)
    pin: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`,
    // 取消固定 (PinOff，已固定状态)
    pinOff: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><line x1="12" x2="12" y1="17" y2="22"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12"/><path d="M15 9.34V6h1a2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/></svg>`,
    // 展开收起箭头
    chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
    chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    // 更多操作 (MoreHorizontal)
    moreHorizontal: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
    // 编辑铅笔 (Pencil)
    pencil: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
    // 删除垃圾桶 (Trash2)
    trash2: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
    // 调色板 (Palette)
    palette: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
    // 勾号保存 (Check)
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    // 关闭 / 取消 (X)
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    // 导出 JSON (Download)
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
    // 导入 JSON (Upload)
    upload: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`
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
    preferences: { sidebarWidth: 312, customWidth: false, rowGap: 2, indentSize: 14, chatSortMode: 'timeAsc' },
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
                addedAt: prev && prev.folderId === cmd.folderId ? (prev.addedAt || now) : now,
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
        this.currentAccount = this.getLastAccount();
        this.bindListener();
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
    loadRecentChats() {
        const key = `${constants_1.KEY_RECENT_PREFIX}${this.currentAccount}`;
        return GM_getValue(key, []);
    }
    saveRecentChats(chats) {
        const key = `${constants_1.KEY_RECENT_PREFIX}${this.currentAccount}`;
        GM_setValue(key, chats);
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
        let raw;
        try {
            raw = JSON.parse(jsonStr);
        }
        catch {
            throw new Error('JSON 解析失败，请检查文件格式');
        }
        // 1. 标准 v2 导出文件
        if (raw.format === 'cgfm-v2-export' && raw.version === 2 && raw.data) {
            (0, model_1.validateData)(raw.data);
            return raw.data;
        }
        // 2. 自动兼容旧版备份文件 (schema 3 / v1.5.x)
        if (raw.schema === 3 || raw.profile?.folders || raw.app === 'ChatGPT文件夹') {
            const v2Data = this.migrateLegacyData(raw);
            (0, model_1.validateData)(v2Data);
            return v2Data;
        }
        throw new Error('不支持的文件格式或版本，请导入本脚本导出的 JSON 备份文件');
    }
    migrateLegacyData(legacy) {
        const oldFolders = legacy.profile?.folders || legacy.folders || {};
        const oldConvs = legacy.profile?.conversations || legacy.conversations || {};
        const v2Folders = {};
        const v2Convs = {};
        for (const [id, f] of Object.entries(oldFolders)) {
            if (id === 'root')
                continue;
            let parentId = f.parentId;
            if (!parentId || parentId === 'root' || parentId === '')
                parentId = null;
            let color = f.color || '#3b82f6';
            if (!/^#[a-f0-9]{6}$/i.test(color))
                color = '#3b82f6';
            v2Folders[id] = {
                id,
                parentId,
                name: f.name || '未命名文件夹',
                color,
                createdAt: typeof f.createdAt === 'number' ? f.createdAt : (Date.parse(f.createdAt) || Date.now()),
                updatedAt: typeof f.updatedAt === 'number' ? f.updatedAt : (Date.parse(f.updatedAt) || Date.now())
            };
        }
        for (const f of Object.values(v2Folders)) {
            if (f.parentId && !v2Folders[f.parentId]) {
                f.parentId = null;
            }
        }
        for (const [id, c] of Object.entries(oldConvs)) {
            if (!v2Folders[c.folderId])
                continue;
            v2Convs[id] = {
                id,
                folderId: c.folderId,
                title: c.title || '未命名对话',
                addedAt: typeof c.addedAt === 'number' ? c.addedAt : (Date.parse(c.addedAt) || Date.now()),
                updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : (Date.parse(c.updatedAt) || Date.now())
            };
        }
        return {
            schema: 2,
            folders: v2Folders,
            conversations: v2Convs
        };
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
    async getOrFetchAuthToken() {
        const cached = this.getAuthToken();
        if (cached)
            return cached;
        try {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const res = await win.fetch('/api/auth/session', {
                headers: { Accept: 'application/json' },
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                if (data?.accessToken) {
                    const bearer = `Bearer ${data.accessToken}`;
                    this.saveAuthToken(bearer);
                    return bearer;
                }
            }
        }
        catch (e) {
            console.warn('[CGFM] Failed to fetch session token', e);
        }
        return null;
    }
    /**
     * 调用 ChatGPT 官方接口重命名对话 (PATCH /backend-api/conversation/{id})
     */
    async renameConversation(chatId, newTitle) {
        const token = await this.getOrFetchAuthToken();
        const url = `/backend-api/conversation/${chatId}`;
        try {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = token;
            }
            const res = await win.fetch(url, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ title: newTitle }),
                credentials: 'include'
            });
            if (res.ok) {
                this.guardTitle(chatId, newTitle);
                return true;
            }
            console.warn('[CGFM] Rename failed with status', res.status);
        }
        catch (err) {
            console.warn('[CGFM] Rename request error, attempting fallback...', err);
        }
        // Fallback via GM_xmlhttpRequest if window.fetch failed
        return new Promise((resolve) => {
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = token;
            }
            GM_xmlhttpRequest({
                method: 'PATCH',
                url: `https://chatgpt.com${url}`,
                headers,
                data: JSON.stringify({ title: newTitle }),
                timeout: 10000,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        this.guardTitle(chatId, newTitle);
                        resolve(true);
                    }
                    else {
                        console.warn('[CGFM] Fallback rename failed with status', res.status);
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
        preview.innerHTML = `${this.activeSession.type === 'folder' ? constants_1.ICONS.folder : constants_1.ICONS.messageSquare}<span>${this.activeSession.title}</span>`;
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
  --cg-panel-bg: #f4f4f2;
  --cg-card-bg: #f9fafb;
  --cg-text: #0d0d0d;
  --cg-border: #e5e7eb;
  --cg-hover: #f3f4f6;
  --cg-input: #ffffff;
  --cg-muted: #6b7280;
  --cg-shadow: rgba(0, 0, 0, 0.12);
  --cg-accent: #3b82f6;
  --cg-sidebar-width: 312px;
  --cg-row-gap: 2px;
  --cg-indent-size: 14px;
}

:root[class*="dark"], .dark, html[data-theme="dark"] {
  --cg-bg: #171717;
  --cg-panel-bg: #1e1e1e;
  --cg-card-bg: #262626;
  --cg-text: #ececec;
  --cg-border: #333333;
  --cg-hover: #2a2a2a;
  --cg-input: #1a1a1a;
  --cg-muted: #8e8ea0;
  --cg-shadow: rgba(0, 0, 0, 0.5);
  --cg-accent: #3b82f6;
}

/* 官方导航 Rail 挂载项目容器与蓝色按钮 */
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
  stroke-width: 2.3 !important;
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

/* 头部操作栏 (修复文字折行 bug，去除大图标，保持干净纯文字) */
.cgfm-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid var(--cg-border);
  flex-shrink: 0;
}
.cgfm-header-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--cg-text);
  white-space: nowrap;
  user-select: none;
}
.cgfm-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cgfm-tool-btn {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--cg-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
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
  width: 17px;
  height: 17px;
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
  padding: 10px 10px 4px;
  margin-top: 6px;
}

/* 文件夹与对话行 */
.cgfm-row {
  display: flex;
  align-items: center;
  height: calc(26px + var(--cg-row-gap, 2px) * 0.5) !important;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
  margin: 0 0 var(--cg-row-gap, 2px) 0 !important;
  transition: background 0.12s ease;
  position: relative;
  gap: 6px;
  box-sizing: border-box;
}
.cgfm-row:hover {
  background: var(--cg-hover);
  position: relative;
  z-index: 2;
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
.cgfm-chevron-spacer {
  width: 16px;
  height: 16px;
  display: inline-flex;
  flex-shrink: 0;
}

/* 文件夹专属图标 (纯正 Lucide，支持颜色着色，取消圆点) */
.cgfm-folder-icon {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #3b82f6;
}
.cgfm-folder-icon svg {
  width: 17px;
  height: 17px;
}

/* 对话专属图标 (Lucide MessageSquare 气泡) */
.cgfm-chat-icon {
  width: 18px;
  height: 18px;
  color: var(--cg-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cgfm-chat-icon svg {
  width: 16px;
  height: 16px;
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
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: var(--cg-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.cgfm-mini-btn:hover {
  background: var(--cg-input);
  color: var(--cg-text);
}
.cgfm-mini-btn svg {
  width: 13px;
  height: 13px;
}

/* 行内编辑框 (文件夹与对话通用) */
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
  min-width: 145px;
}
.cgfm-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
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
  width: 210px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cgfm-confirm-title {
  font-size: 12px;
  font-weight: 500;
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
  padding: 5px 10px;
  border-radius: 6px;
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

/* 现代化卡片风格设置面板 (Settings Panel) */
.cgfm-settings-panel {
  position: fixed;
  top: 0;
  width: 380px;
  max-height: 100vh;
  overflow-y: auto;
  background: var(--cg-panel-bg);
  border-right: 1px solid var(--cg-border);
  box-shadow: 6px 0 28px var(--cg-shadow);
  z-index: 100004;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
}

.cgfm-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--cg-border);
}
.cgfm-settings-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--cg-text);
}

/* 设置模块卡片 */
.cgfm-card {
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
  overflow: hidden;
}
.cgfm-card-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--cg-muted);
}

/* 修复横向拖动条 Track 与 Thumb 样式 */
.cgfm-slider-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cgfm-slider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--cg-text);
}
.cgfm-width-num,
.cgfm-gap-num,
.cgfm-indent-num {
  font-weight: 600;
  color: #3b82f6;
}

.cgfm-width-slider,
.cgfm-gap-slider,
.cgfm-indent-slider {
  -webkit-appearance: none !important;
  appearance: none !important;
  width: 100% !important;
  height: 6px !important;
  border-radius: 3px !important;
  background: var(--cg-border) !important;
  outline: none !important;
  margin: 6px 0 !important;
  cursor: pointer !important;
}
.cgfm-width-slider::-webkit-slider-runnable-track,
.cgfm-gap-slider::-webkit-slider-runnable-track,
.cgfm-indent-slider::-webkit-slider-runnable-track {
  width: 100% !important;
  height: 6px !important;
  border-radius: 3px !important;
  background: var(--cg-border) !important;
}
.cgfm-width-slider::-webkit-slider-thumb,
.cgfm-gap-slider::-webkit-slider-thumb,
.cgfm-indent-slider::-webkit-slider-thumb {
  -webkit-appearance: none !important;
  appearance: none !important;
  width: 18px !important;
  height: 18px !important;
  border-radius: 50% !important;
  background: #3b82f6 !important;
  border: 2px solid #ffffff !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3) !important;
  cursor: pointer !important;
  margin-top: -6px !important;
  transition: transform 0.1s ease !important;
}
.cgfm-width-slider::-webkit-slider-thumb:hover,
.cgfm-gap-slider::-webkit-slider-thumb:hover,
.cgfm-indent-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15) !important;
}

/* 表单字段 */
.cgfm-settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  box-sizing: border-box;
}
.cgfm-settings-field label {
  font-size: 12px;
  color: var(--cg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cgfm-settings-field input[type="text"],
.cgfm-settings-field input[type="password"],
.cgfm-settings-field select {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--cg-border);
  background: var(--cg-input);
  color: var(--cg-text);
  font-size: 13px;
  outline: none;
  box-sizing: border-box !important;
}
.cgfm-settings-field select {
  cursor: pointer;
}
.cgfm-settings-field input[type="text"]:focus,
.cgfm-settings-field input[type="password"]:focus,
.cgfm-settings-field select:focus {
  border-color: #3b82f6;
}
.cgfm-settings-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
}
.cgfm-settings-row > .cgfm-settings-field {
  flex: 1 1 0% !important;
  min-width: 0 !important;
}

/* 现代按钮组 */
.cgfm-action-group {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.cgfm-primary-btn {
  flex: 1;
  height: 34px;
  border-radius: 7px;
  background: #3b82f6;
  color: #ffffff;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.15s ease;
}
.cgfm-primary-btn:hover {
  background: #2563eb;
}
.cgfm-secondary-btn {
  flex: 1;
  height: 34px;
  border-radius: 7px;
  background: var(--cg-hover);
  color: var(--cg-text);
  border: 1px solid var(--cg-border);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s ease;
}
.cgfm-secondary-btn:hover {
  background: var(--cg-input);
  border-color: var(--cg-muted);
}
.cgfm-secondary-btn svg, .cgfm-primary-btn svg {
  width: 15px;
  height: 15px;
}

.cgfm-status-box {
  padding: 8px 12px;
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

/* 自绘轻量 Toast 胶囊通知 */
.cgfm-toast {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: #1f2937;
  color: #ffffff;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
  z-index: 200000;
  pointer-events: none;
  animation: cgfm-toast-in 0.2s ease;
}
@keyframes cgfm-toast-in {
  from { opacity: 0; transform: translate(-50%, -10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
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
    hasGlobalClickBound = false;
    lastRecentChatsHash = '';
    syncState = 'unconfigured';
    isSyncing = false;
    syncRetryTimer = null;
    syncFailures = 0;
    pendingSyncAgain = false;
    constructor() {
        this.storage = new storage_1.StorageManager((newProfile) => {
            this.profile = newProfile;
            this.renderFolderTree();
        });
        this.api = new api_1.ChatApiManager();
        this.api.setAccountId(this.storage.getAccount());
        this.profile = this.storage.loadProfile();
        this.collapsedFolders = this.storage.loadCollapsedFolders();
        this.isPinned = this.profile.preferences.customWidth;
    }
    init() {
        this.injectStyles();
        this.ensureRootMounted();
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
        this.renderSkeleton();
        this.renderFolderTree();
        this.renderRecentList();
        try {
            window.__cgfm = this;
            if (typeof unsafeWindow !== 'undefined') {
                unsafeWindow.__cgfm = this;
            }
        }
        catch {
            // 忽略
        }
    }
    injectStyles() {
        if (document.getElementById('cgfm-styles'))
            return;
        const style = document.createElement('style');
        style.id = 'cgfm-styles';
        style.textContent = styles_1.STYLES;
        document.head.appendChild(style);
    }
    showToast(message, duration = 2500) {
        const toast = document.createElement('div');
        toast.className = 'cgfm-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.2s ease';
            window.setTimeout(() => toast.remove(), 200);
        }, duration);
    }
    ensureRootMounted() {
        let existing = document.getElementById('cgfm-root');
        if (!existing) {
            if (!this.rootEl) {
                this.createRootPanel();
            }
            else {
                document.body.appendChild(this.rootEl);
            }
        }
        else {
            this.rootEl = existing;
        }
        if (this.rootEl && !document.body.contains(this.rootEl)) {
            document.body.appendChild(this.rootEl);
        }
        if (this.rootEl && !this.rootEl.querySelector('.cgfm-folder-tree')) {
            this.renderSkeleton();
            this.renderFolderTree();
            this.renderRecentList(true);
        }
    }
    createRootPanel() {
        const existing = document.getElementById('cgfm-root');
        if (existing) {
            this.rootEl = existing;
            return;
        }
        this.rootEl = document.createElement('div');
        this.rootEl.id = 'cgfm-root';
        this.updatePanelWidth(this.profile.preferences.sidebarWidth || 312);
        this.updateRowGap(this.profile.preferences.rowGap ?? 2);
        this.updateIndentSize(this.profile.preferences.indentSize ?? 14, false);
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
        // 全局点击关闭菜单与面板（仅绑定一次）
        if (!this.hasGlobalClickBound) {
            this.hasGlobalClickBound = true;
            window.addEventListener('click', (e) => {
                const target = e.target;
                const isInsideMenu = this.activeMenu?.contains(target);
                const isInsideConfirm = this.activeConfirmCard?.contains(target);
                const isInsideSettings = this.settingsEl?.contains(target);
                const isInsidePanel = this.rootEl?.contains(target);
                const isInsideRail = this.railBtn?.contains(target);
                const isInsideMiniBtn = target.closest('.cgfm-mini-btn') !== null;
                if (this.activeMenu && !isInsideMenu && !isInsideMiniBtn) {
                    this.closeActiveMenu();
                }
                if (this.activeConfirmCard && !isInsideConfirm) {
                    this.closeActiveConfirm();
                }
                // 如果处于编辑状态、删除确认或打开了设置面板，严禁关闭面板
                if (this.isEditing || this.activeConfirmCard || this.settingsEl) {
                    return;
                }
                // 未固定且非悬停状态下，仅当真正点击到所有相关容器外部时才关闭
                if (this.isOpen &&
                    !this.isPinned &&
                    !isInsidePanel &&
                    !isInsideRail &&
                    !isInsideMenu &&
                    !isInsideConfirm &&
                    !isInsideSettings &&
                    !isInsideMiniBtn) {
                    this.isHovered = false;
                    this.closePanel(true);
                }
            }, { capture: true });
        }
    }
    updatePanelWidth(width) {
        // 限制在 260 - 500 范围，并取 5px 整数倍
        const rounded = Math.round(width / 5) * 5;
        const val = Math.max(260, Math.min(500, rounded));
        this.profile.preferences.sidebarWidth = val;
        this.rootEl?.style.setProperty('--cg-sidebar-width', `${val}px`);
    }
    updateRowGap(gap) {
        const val = Math.max(-4, Math.min(16, Math.round(gap)));
        this.profile.preferences.rowGap = val;
        this.rootEl?.style.setProperty('--cg-row-gap', `${val}px`);
    }
    updateIndentSize(indent, shouldRerender = true) {
        const val = Math.max(8, Math.min(32, Math.round(indent)));
        this.profile.preferences.indentSize = val;
        this.rootEl?.style.setProperty('--cg-indent-size', `${val}px`);
        if (shouldRerender && this.rootEl?.querySelector('.cgfm-folder-tree')) {
            this.renderFolderTree();
        }
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
                // 仅在非编辑状态下尝试更新最近对话（内置差异比对，无变动不重绘 DOM）
                if (!this.isEditing) {
                    const hasNativeChats = document.querySelector('[data-sidebar-chatgpt-conversation-key^="chatgpt:conversation:"], nav a[href*="/c/"]');
                    if (hasNativeChats) {
                        this.renderRecentList();
                    }
                }
            });
        };
        // 避开 React 首次 Hydration 敏感期（彻底杜绝 React Error #418），等侧栏水合稳定后安全挂载
        window.setTimeout(() => {
            this.tryMount();
            const obs = new MutationObserver(() => queueMount());
            obs.observe(document.documentElement, { childList: true, subtree: true });
            window.setInterval(() => queueMount(), 2000);
        }, 1200);
    }
    tryMount() {
        // 确保根面板随时在 DOM 中，不受 React 重新挂载影响
        this.ensureRootMounted();
        const rail = document.querySelector('nav[data-app-navigation-rail="true"], nav[aria-label="应用导航"], nav[aria-label="App navigation"], #app-shell-sidebar nav');
        if (!rail)
            return;
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
            btn.innerHTML = constants_1.ICONS.folderBold;
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
                    // 已打开时再次点击侧栏图标：如果已固定则收起并取消固定，未固定则设为固定
                    if (this.isPinned) {
                        this.isPinned = false;
                        this.isHovered = false;
                        this.closePanel(true);
                    }
                    else {
                        this.isPinned = true;
                    }
                }
                this.updateHeaderPinButton();
            };
            btn.addEventListener('mouseenter', handleEnter);
            btn.addEventListener('mouseleave', handleLeave);
            btn.addEventListener('click', handleActivate);
            entry.appendChild(btn);
            this.railEntry = entry;
            this.railBtn = btn;
        }
        // 核心定位：必须放在「更多/三个点」图标的下方
        const moreBtn = host.querySelector('[data-slot="popover-trigger"], button[aria-haspopup="dialog"], button:has(use[href*="ellipsis"])');
        const targetItem = moreBtn ? (moreBtn.closest('.flex.shrink-0') || moreBtn) : null;
        if (targetItem && targetItem.parentElement === host) {
            if (this.railEntry.previousElementSibling !== targetItem) {
                targetItem.after(this.railEntry);
            }
        }
        else {
            if (this.railEntry.parentElement !== host || host.lastElementChild !== this.railEntry) {
                host.appendChild(this.railEntry);
            }
        }
    }
    setupAccountWatcher() {
        const checkAccount = () => {
            let detectedAccount = this.storage.getLastAccount();
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
                this.renderFolderTree();
                this.renderRecentList(true);
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
        this.ensureRootMounted();
        this.updatePosition();
        this.isOpen = true;
        this.rootEl.classList.add('cgfm-open');
        if (this.railBtn)
            this.railBtn.classList.add('active');
        this.renderRecentList();
    }
    closePanel(force = false) {
        if (!force) {
            if (this.isPinned ||
                this.isHovered ||
                this.isEditing ||
                this.isDragging ||
                this.settingsEl ||
                this.activeMenu ||
                this.activeConfirmCard) {
                return;
            }
        }
        else {
            // 即使是强制关闭，如果有正在进行的编辑、确认弹窗或设置面板，也严禁收起
            if (this.isEditing || this.activeConfirmCard || this.settingsEl) {
                return;
            }
        }
        this.isOpen = false;
        this.rootEl?.classList.remove('cgfm-open');
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
            this.updateHeaderPinButton();
        }
        this.updateHeaderPinButton();
    }
    updateHeaderPinButton() {
        const pinBtn = this.rootEl.querySelector('.cgfm-tool-btn[data-act="pin"]');
        if (pinBtn) {
            pinBtn.className = `cgfm-tool-btn ${this.isPinned ? 'active' : ''}`;
            pinBtn.title = this.isPinned ? '取消固定' : '固定面板';
            pinBtn.innerHTML = this.isPinned ? constants_1.ICONS.pinOff : constants_1.ICONS.pin;
        }
    }
    scheduleClose() {
        this.clearCloseTimer();
        this.closeTimer = window.setTimeout(() => {
            if (this.isPinned ||
                this.isHovered ||
                this.isEditing ||
                this.isDragging ||
                this.settingsEl ||
                this.activeMenu ||
                this.activeConfirmCard) {
                return;
            }
            this.closePanel();
        }, 350);
    }
    clearCloseTimer() {
        if (this.closeTimer !== null) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
    }
    renderSkeleton() {
        if (!this.rootEl)
            return;
        this.lastRecentChatsHash = '';
        this.rootEl.innerHTML = `
      <div class="cgfm-header">
        <div class="cgfm-header-title">文件夹</div>
        <div class="cgfm-header-actions">
          <button class="cgfm-tool-btn" data-act="create-root" title="新建文件夹">${constants_1.ICONS.plus}</button>
          <button class="cgfm-tool-btn" data-act="sync" data-sync-state="${this.syncState}" title="立即同步">${constants_1.ICONS.rotateCw}</button>
          <button class="cgfm-tool-btn" data-act="settings" title="设置">${constants_1.ICONS.settings}</button>
          <button class="cgfm-tool-btn ${this.isPinned ? 'active' : ''}" data-act="pin" title="${this.isPinned ? '取消固定' : '固定面板'}">${this.isPinned ? constants_1.ICONS.pinOff : constants_1.ICONS.pin}</button>
        </div>
      </div>
      <div class="cgfm-scroll-area">
        <div class="cgfm-folder-tree"></div>
        <div class="cgfm-section-label">最近对话</div>
        <div class="cgfm-recent-list"></div>
      </div>
    `;
        const header = this.rootEl.querySelector('.cgfm-header');
        header.addEventListener('click', (e) => {
            const btn = e.target.closest('.cgfm-tool-btn');
            if (!btn)
                return;
            const act = btn.dataset.act;
            if (act === 'create-root') {
                this.startInlineCreateFolder(null);
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
    }
    renderFolderTree() {
        const container = this.rootEl?.querySelector('.cgfm-folder-tree');
        if (!container)
            return;
        if (this.isEditing)
            return;
        container.innerHTML = '';
        const { folders, conversations } = this.profile.data;
        const indent = this.profile.preferences.indentSize ?? 14;
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
                row.style.paddingLeft = `${depth * indent + 8}px`;
                const folderColor = f.color || '#3b82f6';
                row.innerHTML = `
          <span class="cgfm-chevron" data-act="toggle">${isCollapsed ? constants_1.ICONS.chevronRight : constants_1.ICONS.chevronDown}</span>
          <span class="cgfm-folder-icon" style="color: ${folderColor}">${isCollapsed ? constants_1.ICONS.folder : constants_1.ICONS.folderOpen}</span>
          <span class="cgfm-title">${f.name}</span>
          <div class="cgfm-row-actions">
            <button class="cgfm-mini-btn" data-act="menu" title="文件夹操作">${constants_1.ICONS.moreHorizontal}</button>
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
                    // 1. 文件夹在前：优先递归渲染所有子文件夹
                    renderLevel(f.id, depth + 1);
                    // 2. 对话在后：渲染当前文件夹所属的对话
                    const chats = Object.values(conversations).filter((c) => c.folderId === f.id);
                    const sortMode = this.profile.preferences.chatSortMode || 'timeAsc';
                    if (sortMode === 'titleAsc') {
                        chats.sort((a, b) => model_1.naturalSort.compare(a.title, b.title));
                    }
                    else {
                        chats.sort((a, b) => {
                            const diff = (a.addedAt || a.updatedAt || 0) - (b.addedAt || b.updatedAt || 0);
                            return diff !== 0 ? diff : model_1.naturalSort.compare(a.title, b.title);
                        });
                    }
                    for (const c of chats) {
                        const chatRow = document.createElement('div');
                        chatRow.className = 'cgfm-row';
                        chatRow.dataset.chatId = c.id;
                        chatRow.style.paddingLeft = `${(depth + 1) * indent + 8}px`;
                        chatRow.innerHTML = `
              <span class="cgfm-chevron-spacer"></span>
              <span class="cgfm-chat-icon">${constants_1.ICONS.messageCircle}</span>
              <span class="cgfm-title" title="${c.title}">${c.title}</span>
              <div class="cgfm-row-actions">
                <button class="cgfm-mini-btn" data-act="edit" title="重命名">${constants_1.ICONS.pencil}</button>
                <button class="cgfm-mini-btn" data-act="remove" title="从文件夹移出">${constants_1.ICONS.x}</button>
              </div>
            `;
                        chatRow.addEventListener('click', (e) => {
                            const target = e.target;
                            if (target.closest('.cgfm-inline-edit, input'))
                                return;
                            const btn = target.closest('.cgfm-mini-btn');
                            if (btn) {
                                e.stopPropagation();
                                if (btn.dataset.act === 'edit') {
                                    const liveTitle = chatRow.querySelector('.cgfm-title')?.textContent?.trim() || c.title;
                                    this.startInlineRenameChat(chatRow, c.id, liveTitle);
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
                }
            }
        };
        renderLevel(null, 0);
    }
    renderRecentList(force = false) {
        const container = this.rootEl?.querySelector('.cgfm-recent-list');
        if (!container)
            return;
        if (this.isEditing && !force)
            return;
        // 1. 始终载入本地持久化缓存作为坚实兜底
        const cached = this.storage.loadRecentChats();
        // 2. 尝试从当前 DOM 抓取实时对话
        const nativeLinks = document.querySelectorAll('[data-sidebar-chatgpt-conversation-key^="chatgpt:conversation:"], nav a[href*="/c/"]');
        const liveChats = [];
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
            const textNode = el.querySelector('.whitespace-nowrap, .truncate, div') || el;
            let title = textNode.textContent?.trim() || el.getAttribute('title') || '未命名对话';
            title = title.split('\n')[0].trim() || '未命名对话';
            const guarded = this.api.getGuardedTitle(id);
            if (guarded)
                title = guarded;
            liveChats.push({ id, title });
        }
        let chats = [];
        if (liveChats.length >= 3) {
            // 官方侧栏完全展开：获取到充足实时对话，全面刷新并存入持久缓存
            chats = liveChats;
            this.storage.saveRecentChats(chats);
        }
        else if (liveChats.length > 0) {
            // 仅抓取到少量（例如仅当前页面所在单个会话），智能合并置顶，保留缓存中的全部历史条目
            const map = new Map();
            for (const item of liveChats)
                map.set(item.id, item);
            for (const item of cached) {
                if (!map.has(item.id))
                    map.set(item.id, item);
            }
            chats = Array.from(map.values());
            this.storage.saveRecentChats(chats);
        }
        else {
            // 官方侧栏处于折叠或未水合状态：100% 完整复用本地持久缓存，永不留白
            chats = cached;
        }
        const currentHash = JSON.stringify(chats);
        const isDomEmpty = container.children.length === 0;
        if (!force && !isDomEmpty && currentHash === this.lastRecentChatsHash) {
            return; // 内容无变动且 DOM 不为空，不重复触碰 DOM，保障 hover 与按钮状态稳定
        }
        this.lastRecentChatsHash = currentHash;
        container.innerHTML = '';
        if (chats.length === 0) {
            const emptyTip = document.createElement('div');
            emptyTip.style.cssText = 'padding: 10px 12px; color: var(--cg-muted); font-size: 12px; font-style: italic;';
            emptyTip.textContent = '暂无最近对话记录';
            container.appendChild(emptyTip);
            return;
        }
        for (const { id, title } of chats) {
            const row = document.createElement('div');
            row.className = 'cgfm-row';
            row.dataset.chatId = id;
            row.innerHTML = `
        <span class="cgfm-chat-icon">${constants_1.ICONS.messageCircle}</span>
        <span class="cgfm-title" title="${title}">${title}</span>
        <div class="cgfm-row-actions">
          <button class="cgfm-mini-btn" data-act="edit" title="重命名">${constants_1.ICONS.pencil}</button>
        </div>
      `;
            row.addEventListener('click', (e) => {
                const target = e.target;
                if (target.closest('.cgfm-inline-edit, input'))
                    return;
                const btn = target.closest('.cgfm-mini-btn');
                if (btn?.dataset.act === 'edit') {
                    e.stopPropagation();
                    const liveTitle = row.querySelector('.cgfm-title')?.textContent?.trim() || title;
                    this.startInlineRenameChat(row, id, liveTitle);
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
        this.renderFolderTree();
    }
    /**
     * 行内直接创建文件夹 (绝不弹 window.prompt，直接就地编辑，Esc 直接取消)
     */
    startInlineCreateFolder(parentId) {
        const container = this.rootEl.querySelector('.cgfm-folder-tree');
        if (!container)
            return;
        this.isEditing = true;
        // 如果是子文件夹，确保父文件夹先展开
        if (parentId && this.collapsedFolders[parentId]) {
            this.collapsedFolders[parentId] = false;
            this.storage.saveCollapsedFolders(this.collapsedFolders);
            this.renderFolderTree();
        }
        // 计算子文件夹真实层级深度
        let depth = 0;
        if (parentId) {
            let curr = this.profile.data.folders[parentId];
            while (curr) {
                depth++;
                curr = curr.parentId ? this.profile.data.folders[curr.parentId] : undefined;
            }
        }
        const indent = this.profile.preferences.indentSize ?? 14;
        const editRow = document.createElement('div');
        editRow.className = 'cgfm-row';
        editRow.style.paddingLeft = `${depth * indent + 8}px`;
        editRow.innerHTML = `
      <span class="cgfm-chevron-spacer"></span>
      <span class="cgfm-folder-icon" style="color: #3b82f6">${constants_1.ICONS.folder}</span>
      <div class="cgfm-inline-edit">
        <input type="text" class="cgfm-inline-input" value="新建文件夹" />
        <button class="cgfm-mini-btn" data-act="save" title="创建">${constants_1.ICONS.check}</button>
        <button class="cgfm-mini-btn" data-act="cancel" title="取消">${constants_1.ICONS.x}</button>
      </div>
    `;
        const input = editRow.querySelector('input');
        let finished = false;
        const finish = (save) => {
            if (finished)
                return;
            finished = true;
            this.isEditing = false;
            const name = input.value.trim();
            editRow.remove();
            if (save && name) {
                this.executeChange({ type: 'folder.create', parentId, name });
            }
            else {
                this.renderFolderTree();
            }
        };
        let isComposing = false;
        input.addEventListener('compositionstart', () => (isComposing = true));
        input.addEventListener('compositionend', () => (isComposing = false));
        input.addEventListener('keydown', (e) => {
            if (isComposing)
                return;
            if (e.key === 'Enter')
                finish(true);
            if (e.key === 'Escape')
                finish(false);
        });
        input.addEventListener('blur', () => {
            window.setTimeout(() => {
                if (!finished)
                    finish(true);
            }, 150);
        });
        editRow.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('.cgfm-mini-btn');
            if (btn)
                e.preventDefault();
        });
        editRow.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('.cgfm-mini-btn');
            if (!btn)
                return;
            if (btn.dataset.act === 'save')
                finish(true);
            if (btn.dataset.act === 'cancel')
                finish(false);
        });
        // 寻找挂载位置
        if (parentId) {
            const parentRow = container.querySelector(`.cgfm-row[data-folder-id="${parentId}"]`);
            if (parentRow) {
                parentRow.after(editRow);
            }
            else {
                container.prepend(editRow);
            }
        }
        else {
            container.prepend(editRow);
        }
        input.focus();
        input.select();
    }
    /**
     * 行内重命名文件夹 (绝不弹 window.prompt，直接就地编辑)
     */
    startInlineRenameFolder(row, folderId, defaultName) {
        this.isEditing = true;
        const titleEl = row.querySelector('.cgfm-title');
        const actionsEl = row.querySelector('.cgfm-row-actions');
        if (!titleEl || !actionsEl)
            return;
        // 动态优先从 DOM 中读取当前正在展示的实时名称，杜绝闭包陈旧变量
        const currentName = titleEl.textContent?.trim() || defaultName || '';
        titleEl.style.display = 'none';
        actionsEl.style.display = 'none';
        const editWrap = document.createElement('div');
        editWrap.className = 'cgfm-inline-edit';
        editWrap.innerHTML = `
      <input type="text" class="cgfm-inline-input" value="${currentName.replace(/"/g, '&quot;')}" />
      <button class="cgfm-mini-btn" data-act="save" title="保存">${constants_1.ICONS.check}</button>
      <button class="cgfm-mini-btn" data-act="cancel" title="取消">${constants_1.ICONS.x}</button>
    `;
        const input = editWrap.querySelector('input');
        let isComposing = false;
        input.addEventListener('compositionstart', () => (isComposing = true));
        input.addEventListener('compositionend', () => (isComposing = false));
        let finished = false;
        const finish = (save) => {
            if (finished)
                return;
            finished = true;
            this.isEditing = false;
            editWrap.remove();
            titleEl.style.display = '';
            actionsEl.style.display = '';
            if (save) {
                const newName = input.value.trim();
                if (newName && newName !== currentName) {
                    this.executeChange({ type: 'folder.rename', id: folderId, name: newName });
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
        input.addEventListener('blur', () => {
            window.setTimeout(() => {
                if (!finished)
                    finish(true);
            }, 150);
        });
        editWrap.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('.cgfm-mini-btn');
            if (btn)
                e.preventDefault();
        });
        editWrap.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('.cgfm-mini-btn');
            if (!btn)
                return;
            if (btn.dataset.act === 'save')
                finish(true);
            if (btn.dataset.act === 'cancel')
                finish(false);
        });
        row.insertBefore(editWrap, actionsEl);
        input.focus();
        input.select();
    }
    /**
     * 行内重命名对话
     */
    startInlineRenameChat(row, chatId, defaultTitle) {
        this.isEditing = true;
        const titleEl = row.querySelector('.cgfm-title');
        const actionsEl = row.querySelector('.cgfm-row-actions');
        if (!titleEl || !actionsEl)
            return;
        // 动态优先从 DOM 中读取当前正在展示的实时标题，杜绝闭包陈旧变量
        const currentTitle = titleEl.textContent?.trim() || defaultTitle || '';
        titleEl.style.display = 'none';
        actionsEl.style.display = 'none';
        const editWrap = document.createElement('div');
        editWrap.className = 'cgfm-inline-edit';
        editWrap.innerHTML = `
      <input type="text" class="cgfm-inline-input" value="${currentTitle.replace(/"/g, '&quot;')}" />
      <button class="cgfm-mini-btn" data-act="save" title="保存">${constants_1.ICONS.check}</button>
      <button class="cgfm-mini-btn" data-act="cancel" title="取消">${constants_1.ICONS.x}</button>
    `;
        const input = editWrap.querySelector('input');
        let isComposing = false;
        input.addEventListener('compositionstart', () => (isComposing = true));
        input.addEventListener('compositionend', () => (isComposing = false));
        let finished = false;
        const finish = (saved) => {
            if (finished)
                return;
            finished = true;
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
                            // 同步更新本地最近对话持久化缓存
                            const recents = this.storage.loadRecentChats();
                            const found = recents.find((r) => r.id === chatId);
                            if (found) {
                                found.title = newTitle;
                                this.storage.saveRecentChats(recents);
                                this.lastRecentChatsHash = JSON.stringify(recents);
                            }
                            // 原位同步修改原生侧栏对应条目文本，杜绝 React 扫描回跳
                            const nativeLinks = document.querySelectorAll(`[data-sidebar-chatgpt-conversation-key="chatgpt:conversation:${chatId}"], nav a[href*="/c/${chatId}"]`);
                            for (const el of nativeLinks) {
                                const targetText = el.querySelector('div, span') || el;
                                targetText.textContent = newTitle;
                            }
                            this.showToast('对话标题已同步更新');
                        }
                        else {
                            this.showToast('服务端标题重命名未成功');
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
        input.addEventListener('blur', () => {
            window.setTimeout(() => {
                if (!finished)
                    finish(true);
            }, 150);
        });
        editWrap.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('.cgfm-mini-btn');
            if (btn)
                e.preventDefault();
        });
        editWrap.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('.cgfm-mini-btn');
            if (!btn)
                return;
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
      <button class="cgfm-menu-item" data-act="rename">${constants_1.ICONS.pencil}<span>重命名</span></button>
      <button class="cgfm-menu-item danger" data-act="delete">${constants_1.ICONS.trash2}<span>删除文件夹</span></button>
    `;
        menu.addEventListener('mouseenter', () => {
            this.isHovered = true;
            this.clearCloseTimer();
        });
        menu.addEventListener('mouseleave', () => {
            this.isHovered = false;
            this.scheduleClose();
        });
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
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
                this.startInlineCreateFolder(folder.id);
            }
            else if (act === 'rename') {
                this.closeActiveMenu();
                const row = this.rootEl.querySelector(`.cgfm-row[data-folder-id="${folder.id}"]`);
                if (row) {
                    this.startInlineRenameFolder(row, folder.id, folder.name);
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
        card.style.left = `${Math.min(anchorRect.left, window.innerWidth - 225)}px`;
        card.innerHTML = `
      <div class="cgfm-confirm-title">确认删除文件夹「${folder.name}」？其下对话将还原为未分类。</div>
      <div class="cgfm-confirm-actions">
        <button class="cgfm-btn-cancel">取消</button>
        <button class="cgfm-btn-danger">确认删除</button>
      </div>
    `;
        card.addEventListener('mouseenter', () => {
            this.isHovered = true;
            this.clearCloseTimer();
        });
        card.addEventListener('mouseleave', () => {
            this.isHovered = false;
            this.scheduleClose();
        });
        card.addEventListener('click', (e) => {
            e.stopPropagation();
        });
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
    handleRemoveChat(chatId) {
        this.executeChange({ type: 'conversation.remove', id: chatId });
        this.showToast('已从文件夹移出');
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
                this.showToast('已加入文件夹');
            }
        }
        catch (e) {
            this.showToast(String(e));
        }
    }
    executeChange(cmd) {
        try {
            const before = this.profile.data;
            const after = (0, model_1.executeCommand)(before, cmd);
            this.profile.data = after;
            if (this.isSyncing) {
                this.pendingSyncAgain = true;
            }
            this.profile.pending.push({
                id: (0, model_1.uid)(),
                device: this.storage.getDeviceId(),
                seq: Date.now(),
                time: Date.now(),
                type: 'folder.upsert',
                key: 'batch'
            });
            this.storage.saveProfile(this.profile);
            this.renderFolderTree();
            this.scheduleSync();
        }
        catch (e) {
            this.showToast(String(e));
        }
    }
    scheduleSync() {
        this.updateSyncState();
        if (this.syncRetryTimer !== null) {
            window.clearTimeout(this.syncRetryTimer);
            this.syncRetryTimer = null;
        }
        this.syncRetryTimer = window.setTimeout(() => {
            this.syncRetryTimer = null;
            this.sync(false);
        }, 2500);
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
        if (this.isSyncing) {
            this.pendingSyncAgain = true;
            return;
        }
        if (!this.profile.dav.url) {
            if (manual)
                this.showToast('请先在设置中配置 WebDAV HTTPS 凭据');
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
            const local = (0, model_1.clone)(this.profile.data);
            const mergedRes = remoteData
                ? (0, sync_1.merge)(baseline, local, remoteData)
                : { data: local, conflicts: [] };
            const newEnvelope = (0, sync_1.createRemote)(this.storage.getAccount(), this.storage.getDeviceId(), remoteRevision + 1, mergedRes.data);
            // 构造 WebDAV 写入请求头：仅在云端有效存在且带 ETag 时携带 If-Match，绝不使用 If-None-Match 避免误触发 412
            const headers = {};
            if (remoteData && readRes.etag) {
                headers['If-Match'] = readRes.etag;
            }
            let putRes = await (0, sync_1.davRequest)(this.profile.dav, 'PUT', headers, JSON.stringify(newEnvelope));
            // 412 智能自愈：若因反代抹除/改动 ETag 导致 SabreDAV 报 412 前置条件失败，自动无条件写入重试一次
            if (putRes.status === 412) {
                console.warn('[CGFM] WebDAV 412 Precondition Failed, retrying with force overwrite...');
                putRes = await (0, sync_1.davRequest)(this.profile.dav, 'PUT', {}, JSON.stringify(newEnvelope));
            }
            if (putRes.status < 200 || putRes.status >= 300) {
                throw new Error(`云端写入失败 (HTTP ${putRes.status})`);
            }
            // 关键防竞态覆盖逻辑：检查网络请求飞行期间，用户是否在本地产生了新的编辑修改
            const currentLocal = this.profile.data;
            const hasLocalChangesDuringSync = this.pendingSyncAgain || JSON.stringify(currentLocal) !== JSON.stringify(local);
            if (hasLocalChangesDuringSync) {
                // 本地在网络同步期间产生了新动作：
                // 1. 云端已成功保存 mergedRes.data，更新基准快照为已写入云端的版本
                this.profile.base = mergedRes.data;
                this.profile.baseRevision = newEnvelope.revision;
                this.profile.etag = putRes.etag;
                // 2. 严禁覆盖 this.profile.data！保留本地最新修改！
                this.syncFailures = 0;
                this.pendingSyncAgain = false;
                this.storage.saveProfile(this.profile);
                // 3. 连环触发下一次防抖同步，把这批最新修改推上云
                this.scheduleSync();
            }
            else {
                // 网络期间无新修改，安全应用合并结果
                this.profile.data = mergedRes.data;
                this.profile.base = mergedRes.data;
                this.profile.baseRevision = newEnvelope.revision;
                this.profile.etag = putRes.etag;
                this.profile.pending = [];
                this.profile.conflicts = [];
                this.syncFailures = 0;
                this.pendingSyncAgain = false;
                this.storage.saveProfile(this.profile);
                this.renderFolderTree();
            }
            if (manual)
                this.showToast('WebDAV 同步成功！');
        }
        catch (err) {
            this.syncFailures++;
            console.warn('[CGFM] Sync error', err);
            if (manual)
                this.showToast(`同步失败: ${String(err)}`);
        }
        finally {
            this.isSyncing = false;
            this.updateSyncState();
            this.renderSyncButton();
            // 如果有连环请求需要补发且目前没有定时器在跑
            if (this.pendingSyncAgain && this.syncRetryTimer === null) {
                this.scheduleSync();
            }
        }
    }
    renderSyncButton() {
        const btn = this.rootEl?.querySelector('.cgfm-tool-btn[data-act="sync"]');
        if (btn) {
            btn.dataset.syncState = this.syncState;
        }
    }
    /**
     * 现代卡片风格设置面板
     */
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
        const currentGap = this.profile.preferences.rowGap ?? 2;
        const currentIndent = this.profile.preferences.indentSize ?? 14;
        const currentSortMode = this.profile.preferences.chatSortMode || 'timeAsc';
        panel.innerHTML = `
      <div class="cgfm-settings-header">
        <span class="cgfm-settings-title">文件夹设置</span>
        <button class="cgfm-mini-btn" data-act="close">${constants_1.ICONS.x}</button>
      </div>

      <!-- 面板外观卡片 -->
      <div class="cgfm-card">
        <div class="cgfm-card-title">面板外观与排序</div>
        <div class="cgfm-slider-wrap">
          <div class="cgfm-slider-header">
            <span>面板宽度</span>
            <span class="cgfm-width-num">${currentWidth}px</span>
          </div>
          <input type="range" class="cgfm-width-slider" min="260" max="500" step="5" value="${currentWidth}" />
        </div>

        <div class="cgfm-slider-wrap">
          <div class="cgfm-slider-header">
            <span>项目行间距</span>
            <span class="cgfm-gap-num">${currentGap}px</span>
          </div>
          <input type="range" class="cgfm-gap-slider" min="-4" max="8" step="1" value="${currentGap}" />
        </div>

        <div class="cgfm-slider-wrap">
          <div class="cgfm-slider-header">
            <span>层级缩进量</span>
            <span class="cgfm-indent-num">${currentIndent}px</span>
          </div>
          <input type="range" class="cgfm-indent-slider" min="8" max="24" step="1" value="${currentIndent}" />
        </div>

        <div class="cgfm-settings-field" style="margin-top: 10px;">
          <label>文件夹内对话排序</label>
          <select class="cgfm-chat-sort-select">
            <option value="timeAsc"${currentSortMode === 'timeAsc' ? ' selected' : ''}>新加入的对话放入最后面 (默认)</option>
            <option value="titleAsc"${currentSortMode === 'titleAsc' ? ' selected' : ''}>按照中英文升序排列</option>
          </select>
        </div>
      </div>

      <!-- WebDAV 同步卡片 -->
      <div class="cgfm-card">
        <div class="cgfm-card-title">WebDAV 同步配置</div>
        <div class="cgfm-settings-field">
          <label>WebDAV HTTPS 目录</label>
          <input type="text" class="cgfm-dav-url" placeholder="https://dav.example.com/folders/" value="${this.profile.dav.url}" />
        </div>

        <div class="cgfm-settings-row">
          <div class="cgfm-settings-field">
            <label>用户名</label>
            <input type="text" class="cgfm-dav-user" value="${this.profile.dav.username}" />
          </div>
          <div class="cgfm-settings-field">
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
      </div>

      <!-- 数据管理卡片 (带 Lucide 导出导入图标) -->
      <div class="cgfm-card">
        <div class="cgfm-card-title">数据管理</div>
        <div class="cgfm-action-group">
          <button class="cgfm-secondary-btn" data-act="export">
            ${constants_1.ICONS.download}
            <span>导出 JSON</span>
          </button>
          <button class="cgfm-secondary-btn" data-act="import">
            ${constants_1.ICONS.upload}
            <span>导入 JSON</span>
          </button>
        </div>
      </div>
    `;
        const slider = panel.querySelector('.cgfm-width-slider');
        const widthNum = panel.querySelector('.cgfm-width-num');
        slider.addEventListener('input', () => {
            const val = parseInt(slider.value, 10);
            widthNum.textContent = `${val}px`;
            this.updatePanelWidth(val);
            panel.style.left = `calc(${this.rootEl.style.left || '52px'} + var(--cg-sidebar-width))`;
        });
        slider.addEventListener('change', () => {
            this.storage.saveProfile(this.profile);
        });
        const gapSlider = panel.querySelector('.cgfm-gap-slider');
        const gapNum = panel.querySelector('.cgfm-gap-num');
        gapSlider.addEventListener('input', () => {
            const val = parseInt(gapSlider.value, 10);
            gapNum.textContent = `${val}px`;
            this.updateRowGap(val);
        });
        gapSlider.addEventListener('change', () => {
            this.storage.saveProfile(this.profile);
        });
        const indentSlider = panel.querySelector('.cgfm-indent-slider');
        const indentNum = panel.querySelector('.cgfm-indent-num');
        indentSlider.addEventListener('input', () => {
            const val = parseInt(indentSlider.value, 10);
            indentNum.textContent = `${val}px`;
            this.updateIndentSize(val);
        });
        indentSlider.addEventListener('change', () => {
            this.storage.saveProfile(this.profile);
        });
        const sortSelect = panel.querySelector('.cgfm-chat-sort-select');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                this.profile.preferences.chatSortMode = sortSelect.value;
                this.storage.saveProfile(this.profile);
                this.renderFolderTree();
            });
        }
        panel.addEventListener('mouseenter', () => {
            this.isHovered = true;
            this.clearCloseTimer();
        });
        panel.addEventListener('mouseleave', () => {
            this.isHovered = false;
            this.scheduleClose();
        });
        panel.addEventListener('click', async (e) => {
            e.stopPropagation();
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
                            this.profile.data = data;
                            this.storage.saveProfile(this.profile);
                            this.renderFolderTree();
                            this.showToast('导入成功！');
                        }
                        catch (err) {
                            this.showToast(`导入失败: ${String(err)}`);
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
// @version      2.0.17
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
    if (window.__cgfm_initialized)
        return;
    window.__cgfm_initialized = true;
    try {
        const app = new ui_1.FolderUiController();
        app.init();
    }
    catch (err) {
        console.error('[CGFM] Failed to initialize ChatGPT Folders:', err);
    }
}
bootstrap();

}};const cache={};function normalize(from,name){if(!name.startsWith('.'))throw Error('External module not bundled: '+name);const pathParts=(from.split('/').slice(0,-1).concat(name.split('/')));const result=[];for(const part of pathParts){if(part==='.'||!part)continue;if(part==='..')result.pop();else result.push(part);}return result.join('/');}function get(key){if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn((name)=>get(normalize(key,name)),m,m.exports);return m.exports;}get('main');})();

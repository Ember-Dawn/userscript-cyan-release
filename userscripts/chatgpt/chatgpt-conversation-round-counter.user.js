// ==UserScript==
// @name         ChatGPT 对话轮数统计
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
// @version      0.4.3
// @description  被动读取 ChatGPT 自身 conversation mapping，统计并缓存当前对话的累计用户消息节点数，并在 Composer 上沿显示当前对话名称。
// @author       Ember-Dawn
// @match        *://chat.openai.com/
// @match        *://chat.openai.com/*
// @match        *://chatgpt.com/
// @match        *://chatgpt.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function(){'use strict';const registry={"constants":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COUNTER_CSS = exports.CONVERSATION_TITLE_TEXT_ID = exports.CONVERSATION_TITLE_BOX_ID = exports.CONVERSATION_TITLE_ROOT_ID = exports.STATUS_BUTTON_ID = exports.ROOT_ELEMENT_ID = exports.STYLE_ELEMENT_ID = exports.UI_INTEGRITY_INTERVAL_MS = exports.DIAGNOSTIC_PREFIX = exports.USER_MESSAGE_SELECTOR = exports.USER_MESSAGE_BUBBLE_SELECTOR = exports.SEARCH_USER_MESSAGE_SELECTOR = exports.LEGACY_USER_MESSAGE_SELECTOR = exports.BATCH_PATH = exports.MAX_ROUND_COUNT_CACHE_ENTRIES = exports.HISTORY_PATCH_FLAG = exports.PATCH_FLAG = exports.ROUND_COUNT_CACHE_KEY = void 0;
exports.ROUND_COUNT_CACHE_KEY = 'cyan_chatgpt_conversation_round_counter_cache_v1';
exports.PATCH_FLAG = '__CYAN_ROUND_COUNTER_FETCH_PATCHED__';
exports.HISTORY_PATCH_FLAG = '__CYAN_ROUND_COUNTER_HISTORY_PATCHED__';
exports.MAX_ROUND_COUNT_CACHE_ENTRIES = 300;
exports.BATCH_PATH = '/backend-api/conversations/batch';
exports.LEGACY_USER_MESSAGE_SELECTOR = '[data-message-author-role="user"][data-message-id]';
exports.SEARCH_USER_MESSAGE_SELECTOR = '[data-chatgpt-search-unit-key$=":user"][data-chatgpt-search-message-ids]';
exports.USER_MESSAGE_BUBBLE_SELECTOR = '[data-user-message-bubble="true"]';
exports.USER_MESSAGE_SELECTOR = [
    exports.LEGACY_USER_MESSAGE_SELECTOR,
    exports.SEARCH_USER_MESSAGE_SELECTOR,
    exports.USER_MESSAGE_BUBBLE_SELECTOR,
].join(', ');
exports.DIAGNOSTIC_PREFIX = '[RoundCounter]';
exports.UI_INTEGRITY_INTERVAL_MS = 1000;
exports.STYLE_ELEMENT_ID = 'cyan-round-counter-style';
exports.ROOT_ELEMENT_ID = 'cyan-round-counter-root';
exports.STATUS_BUTTON_ID = 'cyan-round-counter-status';
exports.CONVERSATION_TITLE_ROOT_ID = 'cg-conversation-title-root';
exports.CONVERSATION_TITLE_BOX_ID = 'cg-conversation-title-box';
exports.CONVERSATION_TITLE_TEXT_ID = 'cg-conversation-title-text';
exports.COUNTER_CSS = `
#${exports.ROOT_ELEMENT_ID} {
    position: absolute;
    right: 14px;
    bottom: -1px;
    z-index: 20;
    pointer-events: none;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${exports.STATUS_BUTTON_ID} {
    appearance: none;
    box-sizing: border-box;
    width: 40px;
    height: 24px;
    border: 1px solid #000;
    border-radius: 6px;
    padding: 0 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
    overflow: hidden;
    background: transparent;
    color: #000;
    font-size: 14px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: center;
    pointer-events: auto;
    cursor: default;
    user-select: none;
}
#${exports.CONVERSATION_TITLE_ROOT_ID} {
    position: absolute;
    left: 14px;
    right: 166px;
    bottom: -1px;
    z-index: 20;
    min-width: 0;
    pointer-events: none;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${exports.CONVERSATION_TITLE_BOX_ID} {
    box-sizing: border-box;
    width: max-content;
    max-width: 100%;
    height: 24px;
    border: 1px solid currentColor;
    border-radius: 6px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    background: transparent;
    color: var(--text-primary, #000);
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    pointer-events: auto;
    cursor: default;
    user-select: none;
}
#${exports.CONVERSATION_TITLE_TEXT_ID} {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
`;

},
"id":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeConversationId = normalizeConversationId;
exports.isLocalConversationId = isLocalConversationId;
exports.isTemporaryConversationId = isTemporaryConversationId;
exports.isStableConversationId = isStableConversationId;
exports.extractConversationPageId = extractConversationPageId;
function normalizeConversationId(conversationId) {
    if (typeof conversationId !== 'string' || !conversationId) {
        return null;
    }
    try {
        return decodeURIComponent(conversationId);
    }
    catch {
        return conversationId;
    }
}
function isLocalConversationId(conversationId) {
    const normalized = normalizeConversationId(conversationId);
    return typeof normalized === 'string' && /^local-chatgpt:/i.test(normalized);
}
function isTemporaryConversationId(conversationId) {
    const normalized = normalizeConversationId(conversationId);
    return typeof normalized === 'string' && (/^WEB:/i.test(normalized) ||
        isLocalConversationId(normalized));
}
function isStableConversationId(conversationId) {
    return typeof conversationId === 'string' && Boolean(conversationId) && !isTemporaryConversationId(conversationId);
}
function extractConversationPageId(pathname) {
    const match = pathname.match(/(?:^|\/)c\/([^/]+)\/?$/);
    return match ? normalizeConversationId(match[1]) : null;
}

},
"types":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

},
"storage":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCacheEntry = normalizeCacheEntry;
exports.parseStoredEntries = parseStoredEntries;
exports.mergeEntries = mergeEntries;
exports.loadRoundCountCache = loadRoundCountCache;
exports.saveRoundCountCache = saveRoundCountCache;
exports.getCachedRoundCount = getCachedRoundCount;
exports.setCachedRoundCount = setCachedRoundCount;
const constants_1 = require("./constants");
const id_1 = require("./id");
function normalizeCacheEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const raw = entry;
    const totalRounds = typeof raw.totalRounds === 'number' && Number.isFinite(raw.totalRounds)
        ? Math.max(0, Math.trunc(raw.totalRounds))
        : null;
    if (totalRounds === null) {
        return null;
    }
    const maxRounds = typeof raw.maxRounds === 'number' && Number.isFinite(raw.maxRounds)
        ? Math.max(totalRounds, 0, Math.trunc(raw.maxRounds))
        : totalRounds;
    const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now();
    return {
        totalRounds: maxRounds,
        maxRounds,
        updatedAt,
    };
}
function parseStoredEntries(stored) {
    if (!stored || typeof stored !== 'object') {
        return {};
    }
    const container = stored;
    const sourceEntries = container.entries && typeof container.entries === 'object'
        ? container.entries
        : container;
    const entries = {};
    for (const [conversationId, rawEntry] of Object.entries(sourceEntries)) {
        if (typeof conversationId !== 'string' || !conversationId) {
            continue;
        }
        const entry = normalizeCacheEntry(rawEntry);
        if (entry) {
            entries[conversationId] = entry;
        }
    }
    return entries;
}
function mergeEntries(primary, secondary) {
    const merged = { ...primary };
    for (const [id, secEntry] of Object.entries(secondary)) {
        const primEntry = merged[id];
        if (!primEntry) {
            merged[id] = secEntry;
        }
        else {
            const maxRounds = Math.max(primEntry.maxRounds, secEntry.maxRounds);
            merged[id] = {
                totalRounds: maxRounds,
                maxRounds,
                updatedAt: Math.max(primEntry.updatedAt, secEntry.updatedAt),
            };
        }
    }
    return merged;
}
function loadRoundCountCache() {
    let gmEntries = {};
    let localEntries = {};
    // 1. 从 GM 扩展存储加载（跨标签页、跨会话长期持久化）
    try {
        if (typeof GM_getValue === 'function') {
            const stored = GM_getValue(constants_1.ROUND_COUNT_CACHE_KEY, { version: 2, entries: {} });
            gmEntries = parseStoredEntries(stored);
        }
    }
    catch {
        // GM 存储读取异常时保持静默降级
    }
    // 2. 从 localStorage 加载（F5 刷新在 document-start 时 0 延迟立即可用）
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(constants_1.ROUND_COUNT_CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                localEntries = parseStoredEntries(parsed);
            }
        }
    }
    catch {
        // localStorage 读取异常时保持静默降级
    }
    const mergedEntries = mergeEntries(gmEntries, localEntries);
    return { version: 2, entries: mergedEntries };
}
function saveRoundCountCache(cache) {
    const entries = Object.entries(cache.entries)
        .sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0))
        .slice(0, constants_1.MAX_ROUND_COUNT_CACHE_ENTRIES);
    cache.entries = Object.fromEntries(entries);
    // 1. 写入 GM 存储
    try {
        if (typeof GM_setValue === 'function') {
            GM_setValue(constants_1.ROUND_COUNT_CACHE_KEY, cache);
        }
    }
    catch {
        // Tampermonkey 存储不可用时仍允许当前页面继续计数
    }
    // 2. 双写到 localStorage，保证 F5 刷新在 document-start 的 0 毫秒同步可用
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(constants_1.ROUND_COUNT_CACHE_KEY, JSON.stringify(cache));
        }
    }
    catch {
        // localStorage 配额超出或不可用时保持静默
    }
}
function getCachedRoundCount(cache, conversationId) {
    if (!(0, id_1.isStableConversationId)(conversationId)) {
        return null;
    }
    return normalizeCacheEntry(cache.entries[conversationId]);
}
function setCachedRoundCount(cache, conversationId, totalRounds) {
    if (!(0, id_1.isStableConversationId)(conversationId) || !Number.isFinite(totalRounds)) {
        return false;
    }
    const previous = getCachedRoundCount(cache, conversationId);
    const maxRounds = Math.max(previous?.maxRounds ?? 0, Math.max(0, Math.trunc(totalRounds)));
    if (previous && previous.maxRounds === maxRounds) {
        return false;
    }
    cache.entries[conversationId] = {
        totalRounds: maxRounds,
        maxRounds,
        updatedAt: Date.now(),
    };
    saveRoundCountCache(cache);
    return true;
}

},
"state":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialState = createInitialState;
exports.resetConversationRuntimeState = resetConversationRuntimeState;
exports.isCurrentPageConversation = isCurrentPageConversation;
exports.restorePersistentRoundCountStats = restorePersistentRoundCountStats;
exports.applyMappingSnapshot = applyMappingSnapshot;
exports.applyMessagesFallback = applyMessagesFallback;
exports.renderTemporaryConversationStats = renderTemporaryConversationStats;
exports.bootstrapFreshConversation = bootstrapFreshConversation;
exports.processAddedUserMessageId = processAddedUserMessageId;
exports.getStatusText = getStatusText;
exports.getStatusTitle = getStatusTitle;
const id_1 = require("./id");
const storage_1 = require("./storage");
function createInitialState(initialConversationId = null) {
    return {
        totalRounds: null,
        currentConversationId: initialConversationId,
        source: 'idle',
        uiReady: false,
        domIncrementReady: false,
        seenDomUserMessageIds: new Set(),
        knownUserMessageIds: new Set(),
        liveUserMessageIds: new Map(),
        pendingNewConversationUserIds: new Map(),
        mappingBaselineReady: false,
        freshAwaitingBaseline: false,
    };
}
function resetConversationRuntimeState(state) {
    state.totalRounds = null;
    state.source = 'idle';
    state.domIncrementReady = false;
    state.seenDomUserMessageIds.clear();
    state.knownUserMessageIds.clear();
    state.liveUserMessageIds.clear();
    state.mappingBaselineReady = false;
    state.freshAwaitingBaseline = false;
}
function isCurrentPageConversation(state, conversationId, currentPageId) {
    return Boolean((0, id_1.isStableConversationId)(currentPageId) &&
        currentPageId === conversationId &&
        state.currentConversationId === conversationId);
}
function restorePersistentRoundCountStats(state, cache) {
    const entry = (0, storage_1.getCachedRoundCount)(cache, state.currentConversationId);
    if (!entry) {
        return false;
    }
    state.totalRounds = entry.totalRounds;
    state.source = 'cached';
    state.domIncrementReady = false;
    return true;
}
function applyMappingSnapshot(state, cache, conversationId, mappingUserIds, requestStartedAt, currentPageId, seedVisibleIds, onStateChange) {
    const mappingIds = new Set(mappingUserIds);
    if (!isCurrentPageConversation(state, conversationId, currentPageId)) {
        const cachedTotal = (0, storage_1.getCachedRoundCount)(cache, conversationId)?.totalRounds ?? null;
        const nextTotal = Math.max(cachedTotal ?? 0, mappingIds.size);
        if (cachedTotal === null || nextTotal > cachedTotal) {
            (0, storage_1.setCachedRoundCount)(cache, conversationId, nextTotal);
        }
        return;
    }
    const trailingLiveIds = new Map();
    for (const [id, observedAt] of state.liveUserMessageIds.entries()) {
        if (observedAt > requestStartedAt && !mappingIds.has(id)) {
            trailingLiveIds.set(id, observedAt);
        }
    }
    state.knownUserMessageIds = new Set(mappingIds);
    for (const id of trailingLiveIds.keys()) {
        state.knownUserMessageIds.add(id);
    }
    state.liveUserMessageIds = trailingLiveIds;
    if (state.freshAwaitingBaseline && mappingIds.size > 0) {
        // A newly created conversation must establish a server-backed count
        // before enabling the persistent historical-maximum rule.
        const cachedTotal = (0, storage_1.getCachedRoundCount)(cache, conversationId)?.totalRounds ?? null;
        const historicMaximum = Math.max(state.totalRounds ?? 0, cachedTotal ?? 0);
        state.totalRounds = Math.max(historicMaximum, state.knownUserMessageIds.size);
        state.source = state.totalRounds > state.knownUserMessageIds.size ? 'protected' : 'mapping';
        state.freshAwaitingBaseline = false;
        state.mappingBaselineReady = true;
        state.domIncrementReady = true;
        seedVisibleIds();
        (0, storage_1.setCachedRoundCount)(cache, conversationId, state.totalRounds);
        onStateChange();
        return;
    }
    // A natural batch can contain only a partial mapping after ChatGPT UI updates.
    // Never let that snapshot erase a higher cumulative count.
    const historicMaximum = (0, storage_1.getCachedRoundCount)(cache, conversationId)?.maxRounds ?? 0;
    const snapshotTotal = state.knownUserMessageIds.size;
    state.totalRounds = Math.max(state.totalRounds ?? 0, historicMaximum, snapshotTotal);
    state.source = state.totalRounds > snapshotTotal ? 'protected' : 'mapping';
    state.mappingBaselineReady = true;
    state.domIncrementReady = true;
    seedVisibleIds();
    (0, storage_1.setCachedRoundCount)(cache, conversationId, state.totalRounds);
    onStateChange();
}
function applyMessagesFallback(state, cache, conversationId, messageUserIds, currentPageId, getVisibleIds, seedVisibleIds, onStateChange) {
    const messageIds = new Set(messageUserIds);
    const cachedTotal = (0, storage_1.getCachedRoundCount)(cache, conversationId)?.totalRounds ?? null;
    if (!isCurrentPageConversation(state, conversationId, currentPageId)) {
        const nextTotal = Math.max(cachedTotal ?? 0, messageIds.size);
        if (cachedTotal === null || nextTotal > cachedTotal) {
            (0, storage_1.setCachedRoundCount)(cache, conversationId, nextTotal);
        }
        return;
    }
    if (state.freshAwaitingBaseline) {
        if (messageIds.size === 0) {
            return;
        }
        // Temporary/local DOM identities may differ from persisted IDs.
        // The first server messages response supplies the authoritative
        // initial count, while visible DOM IDs are seeded only for dedup.
        state.knownUserMessageIds = new Set(messageIds);
        for (const id of getVisibleIds()) {
            state.knownUserMessageIds.add(id);
        }
        const historicMaximum = Math.max(state.totalRounds ?? 0, cachedTotal ?? 0);
        state.totalRounds = Math.max(historicMaximum, messageIds.size);
        state.source = state.totalRounds > messageIds.size ? 'protected' : 'messages';
        state.freshAwaitingBaseline = false;
        state.domIncrementReady = true;
        seedVisibleIds();
        (0, storage_1.setCachedRoundCount)(cache, conversationId, state.totalRounds);
        onStateChange();
        return;
    }
    for (const id of messageIds) {
        state.knownUserMessageIds.add(id);
    }
    for (const id of getVisibleIds()) {
        state.knownUserMessageIds.add(id);
    }
    if (state.mappingBaselineReady) {
        seedVisibleIds();
        return;
    }
    const nextTotal = Math.max(state.totalRounds ?? 0, cachedTotal ?? 0, state.knownUserMessageIds.size);
    state.totalRounds = nextTotal;
    state.source = 'messages';
    state.domIncrementReady = true;
    seedVisibleIds();
    (0, storage_1.setCachedRoundCount)(cache, conversationId, state.totalRounds);
    onStateChange();
}
function renderTemporaryConversationStats(state, onStateChange) {
    // Before a server baseline, one pending user turn can expose multiple
    // transient DOM identities. Do not equate ID count with round count.
    state.totalRounds = state.pendingNewConversationUserIds.size > 0 ? 1 : 0;
    state.source = 'live';
    onStateChange();
}
function bootstrapFreshConversation(state, cache, conversationId, seedVisibleIds, onStateChange) {
    if (!(0, id_1.isStableConversationId)(conversationId) || state.pendingNewConversationUserIds.size === 0) {
        return false;
    }
    const cached = (0, storage_1.getCachedRoundCount)(cache, conversationId);
    if (cached && cached.totalRounds > 0) {
        return false;
    }
    state.knownUserMessageIds = new Set(state.pendingNewConversationUserIds.keys());
    state.liveUserMessageIds = new Map(state.pendingNewConversationUserIds);
    // 新会话确定首轮后立即确立基线并开启 DOM 实时递增与持久化，
    // 避免因现代 ChatGPT 全程走 SSE 通信而卡死在等待服务端 GET 消息基线的假死状态。
    state.totalRounds = 1;
    state.source = 'live';
    state.freshAwaitingBaseline = false;
    state.domIncrementReady = true;
    seedVisibleIds();
    (0, storage_1.setCachedRoundCount)(cache, conversationId, state.totalRounds);
    onStateChange();
    return true;
}
function processAddedUserMessageId(state, cache, id, now, seedVisibleIds, onStateChange) {
    if (state.seenDomUserMessageIds.has(id)) {
        return;
    }
    state.seenDomUserMessageIds.add(id);
    if (state.currentConversationId === null || (0, id_1.isTemporaryConversationId)(state.currentConversationId)) {
        if (!state.pendingNewConversationUserIds.has(id)) {
            state.pendingNewConversationUserIds.set(id, now);
            renderTemporaryConversationStats(state, onStateChange);
        }
        return;
    }
    if (!state.domIncrementReady || state.knownUserMessageIds.has(id)) {
        return;
    }
    state.knownUserMessageIds.add(id);
    state.liveUserMessageIds.set(id, now);
    if (state.totalRounds === null) {
        return;
    }
    state.totalRounds += 1;
    state.source = 'live';
    (0, storage_1.setCachedRoundCount)(cache, state.currentConversationId, state.totalRounds);
    onStateChange();
}
function getStatusText(state) {
    if (state.totalRounds !== null) {
        return String(state.totalRounds);
    }
    if (state.currentConversationId === null && state.pendingNewConversationUserIds.size === 0) {
        return '0';
    }
    return '–';
}
function getStatusTitle(state) {
    if (state.totalRounds !== null) {
        if (state.source === 'cached') {
            return `当前对话：${state.totalRounds} 轮（缓存，等待页面自然校准）`;
        }
        if (state.source === 'messages') {
            return `当前对话：${state.totalRounds} 轮（自然 messages 下限，等待 mapping 全量校准）`;
        }
        if (state.source === 'protected') {
            return `当前对话：${state.totalRounds} 轮（历史累计值保护；本次 mapping 较少）`;
        }
        return `当前对话：${state.totalRounds} 轮`;
    }
    if (state.currentConversationId === null || (0, id_1.isTemporaryConversationId)(state.currentConversationId)) {
        return '当前新对话尚无用户轮次';
    }
    return '等待 ChatGPT 页面自然加载当前对话 mapping';
}

},
"dom-scanner":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDomUserMessageIds = getDomUserMessageIds;
exports.getVisibleUserMessageIds = getVisibleUserMessageIds;
exports.extractCandidatesFromAddedNode = extractCandidatesFromAddedNode;
const constants_1 = require("./constants");
function getDomUserMessageIds(element) {
    if (typeof Element === 'undefined' || !(element instanceof Element)) {
        return [];
    }
    const ids = new Set();
    const addId = (id) => {
        if (typeof id === 'string' && id) {
            ids.add(id);
        }
    };
    if (element.matches(constants_1.LEGACY_USER_MESSAGE_SELECTOR)) {
        addId(element.getAttribute('data-message-id'));
    }
    if (element.matches(constants_1.SEARCH_USER_MESSAGE_SELECTOR)) {
        const rawIds = element.getAttribute('data-chatgpt-search-message-ids') || '';
        for (const id of rawIds.split(/\s+/)) {
            addId(id);
        }
    }
    if (element.matches(constants_1.USER_MESSAGE_BUBBLE_SELECTOR)) {
        addId(element.closest('[data-turn-key]')?.getAttribute('data-turn-key'));
    }
    return [...ids];
}
function getVisibleUserMessageIds() {
    if (typeof document === 'undefined' || !document.querySelectorAll) {
        return [];
    }
    const ids = [];
    const seen = new Set();
    const nodes = document.querySelectorAll(constants_1.USER_MESSAGE_SELECTOR);
    for (const node of nodes) {
        for (const id of getDomUserMessageIds(node)) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}
function extractCandidatesFromAddedNode(node) {
    if (typeof Element === 'undefined' || !(node instanceof Element)) {
        return [];
    }
    const candidates = [];
    if (node.matches(constants_1.USER_MESSAGE_SELECTOR)) {
        candidates.push(node);
    }
    if (node.querySelector(constants_1.USER_MESSAGE_SELECTOR)) {
        for (const child of node.querySelectorAll(constants_1.USER_MESSAGE_SELECTOR)) {
            candidates.push(child);
        }
    }
    return candidates;
}

},
"title":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
exports.cleanConversationTitle = cleanConversationTitle;
exports.cleanConversationAriaLabel = cleanConversationAriaLabel;
exports.cleanDocumentConversationTitle = cleanDocumentConversationTitle;
exports.isTemporaryChat = isTemporaryChat;
exports.extractConversationIdFromHref = extractConversationIdFromHref;
exports.isVisibleElement = isVisibleElement;
exports.extractTitleFromAnchor = extractTitleFromAnchor;
exports.findNativeConversationTitle = findNativeConversationTitle;
exports.getCurrentConversationTitle = getCurrentConversationTitle;
const id_1 = require("./id");
function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}
function cleanConversationTitle(title) {
    return normalizeText(title).slice(0, 200);
}
function cleanConversationAriaLabel(label) {
    const value = cleanConversationTitle(label);
    const chinese = value.match(/^打开[“"]?(.+?)[”"]?的对话选项(?:.*)?$/);
    if (chinese)
        return cleanConversationTitle(chinese[1]);
    const englishFor = value.match(/^Open\s+(?:(?:conversation|chat)\s+)?options\s+for\s+[“"]?(.+?)[”"]?(?:[.!])?$/i);
    if (englishFor)
        return cleanConversationTitle(englishFor[1]);
    const english = value.match(/^Open(?:\s+[“"]?|[“"])(.+?)[”"]?(?:['’]s)?\s+(?:(?:conversation|chat)\s+)?options(?:[.!])?$/i);
    return english ? cleanConversationTitle(english[1]) : cleanConversationTitle(value);
}
function cleanDocumentConversationTitle(title) {
    return cleanConversationTitle(title)
        .replace(/\s*(?:[|｜·•]|[-–—])\s*ChatGPT\s*$/i, '')
        .trim()
        .slice(0, 200);
}
function isTemporaryChat(urlHref) {
    try {
        return new URL(urlHref).searchParams.get('temporary-chat') === 'true';
    }
    catch {
        return false;
    }
}
function extractConversationIdFromHref(href, baseHref = 'https://chatgpt.com') {
    try {
        const url = new URL(href, baseHref);
        const match = url.pathname.match(/(?:^|\/)c\/([^/?#]+)(?:\/|$)/);
        if (!match?.[1])
            return null;
        return (0, id_1.normalizeConversationId)(match[1]);
    }
    catch {
        return null;
    }
}
function isVisibleElement(element, pageWindow) {
    if (typeof Element === 'undefined' || !(element instanceof Element) || !element.isConnected) {
        return false;
    }
    const win = pageWindow || (typeof window !== 'undefined' ? window : null);
    if (!win)
        return true;
    const style = win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden')
        return false;
    return element.getClientRects().length > 0;
}
function extractTitleFromAnchor(anchor) {
    if (!anchor)
        return '';
    const clone = anchor.cloneNode(true);
    clone.querySelectorAll('button, svg, [aria-hidden="true"]').forEach((node) => node.remove());
    const visibleText = cleanConversationTitle(clone.textContent || anchor.textContent || '');
    const ariaText = cleanConversationAriaLabel(anchor.getAttribute('aria-label') || '');
    return visibleText || ariaText;
}
function findNativeConversationTitle(conversationId, pageWindow) {
    if (!conversationId || typeof document === 'undefined')
        return '';
    const matches = [];
    const baseHref = pageWindow?.location.href || 'https://chatgpt.com';
    for (const anchor of document.querySelectorAll('a[href*="/c/"]')) {
        const hrefId = extractConversationIdFromHref(anchor.getAttribute('href') || anchor.href || '', baseHref);
        if (hrefId === conversationId) {
            matches.push(anchor);
        }
    }
    if (!matches.length)
        return '';
    const anchor = matches.find((el) => isVisibleElement(el, pageWindow)) || matches[0];
    return extractTitleFromAnchor(anchor);
}
function getCurrentConversationTitle(conversationId, documentTitleTrusted, docTitle, urlHref, pageWindow) {
    if (isTemporaryChat(urlHref)) {
        return '临时对话';
    }
    if (!conversationId || (0, id_1.isLocalConversationId)(conversationId)) {
        return '新对话';
    }
    if (documentTitleTrusted) {
        const pageTitle = cleanDocumentConversationTitle(docTitle || '');
        if (pageTitle && !/^ChatGPT$/i.test(pageTitle)) {
            return pageTitle;
        }
    }
    return findNativeConversationTitle(conversationId, pageWindow) || '加载中…';
}

},
"network":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequestMeta = getRequestMeta;
exports.isBatchRequest = isBatchRequest;
exports.getConversationMessagesRequestId = getConversationMessagesRequestId;
exports.isJsonResponse = isJsonResponse;
exports.getNodeRole = getNodeRole;
exports.getNodeMessageId = getNodeMessageId;
exports.getMappingUserMessageIds = getMappingUserMessageIds;
exports.getMessagesUserMessageIds = getMessagesUserMessageIds;
exports.handleConversationMessagesResponse = handleConversationMessagesResponse;
exports.handleBatchResponse = handleBatchResponse;
exports.patchFetch = patchFetch;
const constants_1 = require("./constants");
const id_1 = require("./id");
function getRequestMeta(pageWindow, input, init) {
    const PageReq = pageWindow.Request;
    const PageURL = pageWindow.URL;
    let urlString;
    let method;
    if (input instanceof PageReq) {
        urlString = input.url;
        method = (init?.method ?? input.method ?? 'GET').toUpperCase();
    }
    else if (input instanceof PageURL) {
        urlString = input.href;
        method = (init?.method ?? 'GET').toUpperCase();
    }
    else {
        urlString = String(input);
        method = (init?.method ?? 'GET').toUpperCase();
    }
    return {
        url: new PageURL(urlString, pageWindow.location.href),
        method,
    };
}
function isBatchRequest(method, url) {
    return method === 'POST' && url.pathname === constants_1.BATCH_PATH;
}
function getConversationMessagesRequestId(method, url) {
    if (method !== 'GET') {
        return null;
    }
    const match = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)$/);
    return match?.[1] ?? null;
}
function isJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    return contentType.toLowerCase().includes('application/json');
}
function getNodeRole(node) {
    return node?.message?.author?.role ?? node?.author?.role ?? null;
}
function getNodeMessageId(node, mappingKey) {
    const id = node?.message?.id ?? node?.id ?? mappingKey;
    return typeof id === 'string' && id ? id : null;
}
function getMappingUserMessageIds(mapping) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
        return [];
    }
    const ids = [];
    const seen = new Set();
    for (const [mappingKey, node] of Object.entries(mapping)) {
        if (getNodeRole(node) !== 'user') {
            continue;
        }
        const id = getNodeMessageId(node, mappingKey);
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        ids.push(id);
    }
    return ids;
}
function getMessagesUserMessageIds(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }
    const ids = [];
    const seen = new Set();
    for (const item of messages) {
        if (getNodeRole(item) !== 'user') {
            continue;
        }
        const id = getNodeMessageId(item, null);
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        ids.push(id);
    }
    return ids;
}
async function handleConversationMessagesResponse(response, conversationId, handlers) {
    if (!response.ok || !isJsonResponse(response) || !(0, id_1.isStableConversationId)(conversationId)) {
        return response;
    }
    try {
        const data = (await response.clone().json());
        if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) {
            return response;
        }
        handlers.onMessagesFallback(conversationId, getMessagesUserMessageIds(data.messages));
    }
    catch (error) {
        handlers.onError('conversation messages response handling failed', error);
    }
    return response;
}
async function handleBatchResponse(response, requestStartedAt, handlers) {
    if (!response.ok || !isJsonResponse(response)) {
        return response;
    }
    try {
        const data = (await response.clone().json());
        if (!Array.isArray(data)) {
            return response;
        }
        for (const conversation of data) {
            const conversationId = conversation?.id;
            if (!(0, id_1.isStableConversationId)(conversationId)) {
                continue;
            }
            const mapping = conversation?.mapping;
            if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
                continue;
            }
            handlers.onBatchSnapshot(conversationId, getMappingUserMessageIds(mapping), requestStartedAt);
        }
    }
    catch (error) {
        handlers.onError('batch response handling failed', error);
    }
    return response;
}
function patchFetch(pageWindow, handlers) {
    if (pageWindow[constants_1.PATCH_FLAG]) {
        return;
    }
    const nativeFetch = pageWindow.fetch.bind(pageWindow);
    pageWindow.fetch = async (...args) => {
        let meta;
        try {
            meta = getRequestMeta(pageWindow, args[0], args[1]);
        }
        catch {
            return nativeFetch(...args);
        }
        const batchRequest = isBatchRequest(meta.method, meta.url);
        const conversationMessagesId = getConversationMessagesRequestId(meta.method, meta.url);
        if (!batchRequest && !conversationMessagesId) {
            return nativeFetch(...args);
        }
        const requestStartedAt = Date.now();
        const response = await nativeFetch(...args);
        if (batchRequest) {
            return handleBatchResponse(response, requestStartedAt, handlers);
        }
        if (conversationMessagesId) {
            return handleConversationMessagesResponse(response, conversationMessagesId, handlers);
        }
        return response;
    };
    pageWindow[constants_1.PATCH_FLAG] = true;
}

},
"ui":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoundCounterUi = void 0;
exports.installStyles = installStyles;
exports.getPortalConversationId = getPortalConversationId;
exports.getComposerPortalPriority = getComposerPortalPriority;
exports.isComposerPortalForCurrentRoute = isComposerPortalForCurrentRoute;
exports.getComposerPortal = getComposerPortal;
const constants_1 = require("./constants");
const id_1 = require("./id");
const state_1 = require("./state");
function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(constants_1.STYLE_ELEMENT_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = constants_1.STYLE_ELEMENT_ID;
    style.textContent = constants_1.COUNTER_CSS;
    (document.head || document.documentElement).appendChild(style);
}
function getPortalConversationId(portal) {
    const raw = portal?.getAttribute?.('data-above-composer-conversation-id') || '';
    return raw.replace(/^chatgpt:/i, '') || null;
}
function getComposerPortalPriority(portal, routeConversationId) {
    if (typeof Element === 'undefined' || !(portal instanceof Element) || !portal.isConnected) {
        return -1;
    }
    const form = portal.closest('form[data-chatgpt-composer]');
    if (!form) {
        return -1;
    }
    const portalConversationId = getPortalConversationId(portal);
    const placement = form.getAttribute('data-composer-placement') || '';
    if (routeConversationId) {
        if (placement !== 'thread') {
            return -1;
        }
        if (portalConversationId === routeConversationId) {
            return 300;
        }
        // During / -> local-chatgpt:* -> final UUID binding, ChatGPT may
        // keep the active thread portal's local id after the URL becomes
        // the final UUID. Treat that as a valid transition state.
        if ((0, id_1.isTemporaryConversationId)(portalConversationId)) {
            return 200;
        }
        // A thread portal without an identity can still be the active
        // Composer while ChatGPT is finishing its internal transition.
        if (!portalConversationId) {
            return 100;
        }
        return -1;
    }
    if (placement !== 'home') {
        return -1;
    }
    if ((0, id_1.isTemporaryConversationId)(portalConversationId)) {
        return 300;
    }
    return portalConversationId ? -1 : 200;
}
function isComposerPortalForCurrentRoute(portal, routeConversationId) {
    return getComposerPortalPriority(portal, routeConversationId) >= 0;
}
function getComposerPortal(routeConversationId) {
    if (typeof document === 'undefined') {
        return null;
    }
    const portals = document.querySelectorAll('form[data-chatgpt-composer] > [data-above-composer-portal="true"]');
    let bestPortal = null;
    let bestPriority = -1;
    for (const portal of portals) {
        const priority = getComposerPortalPriority(portal, routeConversationId);
        if (priority > bestPriority) {
            bestPriority = priority;
            bestPortal = portal;
        }
    }
    return bestPortal;
}
class RoundCounterUi {
    pageWindow;
    state;
    getRouteConversationId;
    getTitle;
    statusButton = null;
    titleBox = null;
    titleText = null;
    uiPortalObserver = null;
    uiFormObserver = null;
    uiParentObserver = null;
    uiWaitObserver = null;
    uiMountToken = 0;
    uiLoadWaitArmed = false;
    uiIntegrityTimer = null;
    constructor(pageWindow, state, getRouteConversationId, getTitle) {
        this.pageWindow = pageWindow;
        this.state = state;
        this.getRouteConversationId = getRouteConversationId;
        this.getTitle = getTitle;
    }
    render() {
        this.renderBadge();
        this.renderTitle();
    }
    renderBadge() {
        if (!this.state.uiReady || !this.statusButton) {
            return;
        }
        const text = (0, state_1.getStatusText)(this.state);
        const title = (0, state_1.getStatusTitle)(this.state);
        const source = this.state.source;
        if (this.statusButton.textContent !== text) {
            this.statusButton.textContent = text;
        }
        if (this.statusButton.title !== title) {
            this.statusButton.title = title;
        }
        if (this.statusButton.dataset.source !== source) {
            this.statusButton.dataset.source = source;
        }
    }
    renderTitle() {
        if (!this.titleBox || !this.titleText) {
            this.titleBox = document.getElementById(constants_1.CONVERSATION_TITLE_BOX_ID);
            this.titleText = document.getElementById(constants_1.CONVERSATION_TITLE_TEXT_ID);
        }
        if (!this.titleBox || !this.titleText) {
            return;
        }
        const title = this.getTitle();
        if (this.titleText.textContent !== title) {
            this.titleText.textContent = title;
        }
        if (this.titleBox.title !== title) {
            this.titleBox.title = title;
        }
    }
    disconnectUiObservers() {
        this.uiPortalObserver?.disconnect();
        this.uiFormObserver?.disconnect();
        this.uiParentObserver?.disconnect();
        this.uiPortalObserver = null;
        this.uiFormObserver = null;
        this.uiParentObserver = null;
    }
    disconnectUiWaitObserver() {
        this.uiWaitObserver?.disconnect();
        this.uiWaitObserver = null;
    }
    startUiWaitObserver() {
        if (this.uiWaitObserver || !document.documentElement) {
            return;
        }
        this.uiWaitObserver = new MutationObserver(() => {
            if (document.readyState !== 'complete') {
                return;
            }
            const portal = getComposerPortal(this.getRouteConversationId());
            if (!portal) {
                return;
            }
            this.disconnectUiWaitObserver();
            this.scheduleStableUiMount(portal);
        });
        this.uiWaitObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-composer-placement', 'data-above-composer-conversation-id'],
        });
    }
    bindUiObservers(portal) {
        this.disconnectUiObservers();
        const form = portal.closest('form[data-chatgpt-composer]');
        if (!form) {
            return;
        }
        this.uiPortalObserver = new MutationObserver(() => {
            const root = document.getElementById(constants_1.ROOT_ELEMENT_ID);
            const titleRoot = document.getElementById(constants_1.CONVERSATION_TITLE_ROOT_ID);
            if (!root || root.parentElement !== portal || !titleRoot || titleRoot.parentElement !== portal) {
                this.scheduleStableUiMount(portal);
            }
        });
        this.uiPortalObserver.observe(portal, {
            childList: true,
            attributes: true,
            attributeFilter: ['data-above-composer-conversation-id'],
        });
        this.uiFormObserver = new MutationObserver(() => {
            if (!form.isConnected || getComposerPortal(this.getRouteConversationId()) !== portal) {
                this.startUiMountWait();
            }
        });
        this.uiFormObserver.observe(form, {
            childList: true,
            attributes: true,
            attributeFilter: ['data-composer-placement'],
        });
        const parent = form.parentElement;
        if (parent) {
            this.uiParentObserver = new MutationObserver(() => {
                if (!form.isConnected || getComposerPortal(this.getRouteConversationId()) !== portal) {
                    this.startUiMountWait();
                }
            });
            this.uiParentObserver.observe(parent, { childList: true, subtree: true });
        }
    }
    installUi(portal) {
        const routeId = this.getRouteConversationId();
        if (!portal || !isComposerPortalForCurrentRoute(portal, routeId) || getComposerPortal(routeId) !== portal) {
            return false;
        }
        let root = document.getElementById(constants_1.ROOT_ELEMENT_ID);
        let titleRoot = document.getElementById(constants_1.CONVERSATION_TITLE_ROOT_ID);
        let changed = false;
        if (!root) {
            root = document.createElement('div');
            root.id = constants_1.ROOT_ELEMENT_ID;
            this.statusButton = document.createElement('div');
            this.statusButton.id = constants_1.STATUS_BUTTON_ID;
            this.statusButton.setAttribute('role', 'status');
            this.statusButton.setAttribute('aria-live', 'polite');
            root.appendChild(this.statusButton);
            changed = true;
        }
        else {
            this.statusButton = root.querySelector(`#${constants_1.STATUS_BUTTON_ID}`);
        }
        if (!this.statusButton) {
            return false;
        }
        if (root.parentElement !== portal) {
            portal.appendChild(root);
            changed = true;
        }
        if (!titleRoot) {
            titleRoot = document.createElement('div');
            titleRoot.id = constants_1.CONVERSATION_TITLE_ROOT_ID;
            this.titleBox = document.createElement('div');
            this.titleBox.id = constants_1.CONVERSATION_TITLE_BOX_ID;
            this.titleBox.setAttribute('role', 'status');
            this.titleBox.setAttribute('aria-live', 'polite');
            this.titleText = document.createElement('span');
            this.titleText.id = constants_1.CONVERSATION_TITLE_TEXT_ID;
            this.titleBox.appendChild(this.titleText);
            titleRoot.appendChild(this.titleBox);
            changed = true;
        }
        else {
            this.titleBox = titleRoot.querySelector(`#${constants_1.CONVERSATION_TITLE_BOX_ID}`);
            this.titleText = titleRoot.querySelector(`#${constants_1.CONVERSATION_TITLE_TEXT_ID}`);
        }
        if (titleRoot.parentElement !== portal) {
            portal.appendChild(titleRoot);
            changed = true;
        }
        this.state.uiReady = true;
        if (changed) {
            this.render();
        }
        this.bindUiObservers(portal);
        this.disconnectUiWaitObserver();
        return true;
    }
    scheduleStableUiMount(expectedPortal) {
        if (!expectedPortal?.isConnected) {
            this.startUiMountWait();
            return;
        }
        const token = ++this.uiMountToken;
        this.pageWindow.requestAnimationFrame(() => {
            this.pageWindow.requestAnimationFrame(() => {
                if (token !== this.uiMountToken) {
                    return;
                }
                const routeId = this.getRouteConversationId();
                const currentPortal = getComposerPortal(routeId);
                if (currentPortal !== expectedPortal || !expectedPortal.isConnected) {
                    this.startUiMountWait();
                    return;
                }
                this.installUi(expectedPortal);
            });
        });
    }
    startUiMountWait() {
        installStyles();
        this.disconnectUiObservers();
        this.uiMountToken += 1;
        this.state.uiReady = false;
        this.statusButton = null;
        this.titleBox = null;
        this.titleText = null;
        if (document.readyState !== 'complete') {
            if (!this.uiLoadWaitArmed) {
                this.uiLoadWaitArmed = true;
                this.pageWindow.addEventListener('load', () => {
                    this.uiLoadWaitArmed = false;
                    this.startUiMountWait();
                }, { once: true });
            }
            return;
        }
        const portal = getComposerPortal(this.getRouteConversationId());
        if (!portal) {
            this.startUiWaitObserver();
            return;
        }
        this.disconnectUiWaitObserver();
        this.scheduleStableUiMount(portal);
    }
    verifyUiIntegrity() {
        if (document.readyState !== 'complete') {
            return;
        }
        const portal = getComposerPortal(this.getRouteConversationId());
        const root = document.getElementById(constants_1.ROOT_ELEMENT_ID);
        const titleRoot = document.getElementById(constants_1.CONVERSATION_TITLE_ROOT_ID);
        const titleBox = titleRoot?.querySelector(`#${constants_1.CONVERSATION_TITLE_BOX_ID}`);
        const titleText = titleRoot?.querySelector(`#${constants_1.CONVERSATION_TITLE_TEXT_ID}`);
        if (!portal) {
            this.state.uiReady = false;
            this.statusButton = null;
            this.titleBox = null;
            this.titleText = null;
            this.startUiWaitObserver();
            return;
        }
        if (titleRoot && (!titleBox || !titleText)) {
            titleRoot.remove();
        }
        if (!root ||
            root.parentElement !== portal ||
            !this.state.uiReady ||
            !titleRoot ||
            titleRoot.parentElement !== portal ||
            !titleBox ||
            !titleText) {
            this.scheduleStableUiMount(portal);
            return;
        }
    }
    startUiIntegrityWatch() {
        if (this.uiIntegrityTimer !== null) {
            return;
        }
        this.uiIntegrityTimer = this.pageWindow.setInterval(() => {
            this.verifyUiIntegrity();
        }, constants_1.UI_INTEGRITY_INTERVAL_MS);
    }
}
exports.RoundCounterUi = RoundCounterUi;

},
"router":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchHistoryForSpaNavigation = patchHistoryForSpaNavigation;
const constants_1 = require("./constants");
function patchHistoryForSpaNavigation(pageWindow, onNavigate) {
    if (pageWindow[constants_1.HISTORY_PATCH_FLAG]) {
        return;
    }
    pageWindow[constants_1.HISTORY_PATCH_FLAG] = true;
    let lastHref = pageWindow.location.href;
    const checkNavigation = () => {
        if (pageWindow.location.href === lastHref) {
            return;
        }
        lastHref = pageWindow.location.href;
        onNavigate();
    };
    const originalPushState = pageWindow.history.pushState.bind(pageWindow.history);
    const originalReplaceState = pageWindow.history.replaceState.bind(pageWindow.history);
    pageWindow.history.pushState = function (...args) {
        const result = originalPushState(...args);
        queueMicrotask(checkNavigation);
        return result;
    };
    pageWindow.history.replaceState = function (...args) {
        const result = originalReplaceState(...args);
        queueMicrotask(checkNavigation);
        return result;
    };
    pageWindow.addEventListener('popstate', () => queueMicrotask(checkNavigation));
}

},
"main":function(require,module,exports){
"use strict";
// ==UserScript==
// @name         ChatGPT 对话轮数统计
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
// @version      0.4.3
// @description  被动读取 ChatGPT 自身 conversation mapping，统计并缓存当前对话的累计用户消息节点数，并在 Composer 上沿显示当前对话名称。
// @author       Ember-Dawn
// @match        *://chat.openai.com/
// @match        *://chat.openai.com/*
// @match        *://chatgpt.com/
// @match        *://chatgpt.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("./constants");
const id_1 = require("./id");
const storage_1 = require("./storage");
const state_1 = require("./state");
const dom_scanner_1 = require("./dom-scanner");
const title_1 = require("./title");
const network_1 = require("./network");
const ui_1 = require("./ui");
const router_1 = require("./router");
const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
const roundCountCache = (0, storage_1.loadRoundCountCache)();
const state = (0, state_1.createInitialState)((0, id_1.extractConversationPageId)(pageWindow.location.pathname));
let documentTitleTrusted = true;
function resolveCurrentTitle() {
    return (0, title_1.getCurrentConversationTitle)(state.currentConversationId, documentTitleTrusted, document.title || '', pageWindow.location.href, pageWindow);
}
const ui = new ui_1.RoundCounterUi(pageWindow, state, () => (0, id_1.extractConversationPageId)(pageWindow.location.pathname), resolveCurrentTitle);
function seedVisibleUserMessageIds() {
    for (const id of (0, dom_scanner_1.getVisibleUserMessageIds)()) {
        state.seenDomUserMessageIds.add(id);
    }
}
function collectPendingVisibleUserMessages() {
    const now = Date.now();
    for (const id of (0, dom_scanner_1.getVisibleUserMessageIds)()) {
        if (!state.pendingNewConversationUserIds.has(id)) {
            state.pendingNewConversationUserIds.set(id, now);
        }
    }
}
function processAddedNodeForUserMessages(node) {
    const candidates = (0, dom_scanner_1.extractCandidatesFromAddedNode)(node);
    if (candidates.length === 0) {
        return;
    }
    const now = Date.now();
    for (const element of candidates) {
        for (const id of (0, dom_scanner_1.getDomUserMessageIds)(element)) {
            (0, state_1.processAddedUserMessageId)(state, roundCountCache, id, now, seedVisibleUserMessageIds, () => ui.render());
        }
    }
}
function isTitleMutation(mutation) {
    const target = mutation.target;
    if (target instanceof Element && target.tagName === 'TITLE')
        return true;
    if (target?.parentElement?.tagName === 'TITLE')
        return true;
    return Array.from(mutation.addedNodes || []).some((node) => node instanceof Element && (node.tagName === 'TITLE' || Boolean(node.querySelector?.('title'))));
}
function installLocalMessageObserver() {
    seedVisibleUserMessageIds();
    const observer = new MutationObserver((mutations) => {
        let titleChanged = false;
        for (const mutation of mutations) {
            if (isTitleMutation(mutation)) {
                titleChanged = true;
            }
            for (const node of mutation.addedNodes) {
                processAddedNodeForUserMessages(node);
            }
        }
        if (titleChanged) {
            documentTitleTrusted = true;
            ui.renderTitle();
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}
function handleNavigation() {
    const previousConversationId = state.currentConversationId;
    const nextConversationId = (0, id_1.extractConversationPageId)(pageWindow.location.pathname);
    const previousWasTemporary = previousConversationId === null || (0, id_1.isTemporaryConversationId)(previousConversationId);
    const nextIsTemporary = nextConversationId === null || (0, id_1.isTemporaryConversationId)(nextConversationId);
    if (nextConversationId !== previousConversationId) {
        documentTitleTrusted = false;
    }
    if (previousWasTemporary) {
        collectPendingVisibleUserMessages();
    }
    (0, state_1.resetConversationRuntimeState)(state);
    state.currentConversationId = nextConversationId;
    ui.startUiMountWait();
    if (nextIsTemporary) {
        seedVisibleUserMessageIds();
        (0, state_1.renderTemporaryConversationStats)(state, () => ui.render());
        return;
    }
    const cachedEntry = nextConversationId ? (0, storage_1.getCachedRoundCount)(roundCountCache, nextConversationId) : null;
    const cachedRounds = cachedEntry?.totalRounds ?? 0;
    const hasPendingBinding = previousWasTemporary && state.pendingNewConversationUserIds.size > 0 && cachedRounds === 0;
    if (hasPendingBinding && (0, state_1.bootstrapFreshConversation)(state, roundCountCache, nextConversationId, seedVisibleUserMessageIds, () => ui.render())) {
        state.pendingNewConversationUserIds.clear();
        return;
    }
    state.pendingNewConversationUserIds.clear();
    (0, state_1.restorePersistentRoundCountStats)(state, roundCountCache);
    ui.render();
    seedVisibleUserMessageIds();
}
function initializeDomFeatures() {
    if (state.currentConversationId === null || (0, id_1.isTemporaryConversationId)(state.currentConversationId)) {
        collectPendingVisibleUserMessages();
        (0, state_1.renderTemporaryConversationStats)(state, () => ui.render());
    }
    else if (!(0, state_1.restorePersistentRoundCountStats)(state, roundCountCache)) {
        ui.render();
    }
    ui.startUiMountWait();
    ui.startUiIntegrityWatch();
    installLocalMessageObserver();
    (0, router_1.patchHistoryForSpaNavigation)(pageWindow, handleNavigation);
    pageWindow.addEventListener('load', () => {
        documentTitleTrusted = true;
        ui.render();
    });
    pageWindow.addEventListener('focus', () => {
        ui.renderTitle();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            ui.renderTitle();
        }
    });
}
(0, network_1.patchFetch)(pageWindow, {
    onBatchSnapshot(conversationId, userIds, requestStartedAt) {
        (0, state_1.applyMappingSnapshot)(state, roundCountCache, conversationId, userIds, requestStartedAt, (0, id_1.extractConversationPageId)(pageWindow.location.pathname), seedVisibleUserMessageIds, () => ui.render());
    },
    onMessagesFallback(conversationId, userIds) {
        (0, state_1.applyMessagesFallback)(state, roundCountCache, conversationId, userIds, (0, id_1.extractConversationPageId)(pageWindow.location.pathname), dom_scanner_1.getVisibleUserMessageIds, seedVisibleUserMessageIds, () => ui.render());
    },
    onError(message, error) {
        console.error(`${constants_1.DIAGNOSTIC_PREFIX} ${message}`, error);
    },
});
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDomFeatures, { once: true });
}
else {
    initializeDomFeatures();
}

}};const cache={};function normalize(from,name){if(!name.startsWith('.'))throw Error('External module not bundled: '+name);const pathParts=(from.split('/').slice(0,-1).concat(name.split('/')));const result=[];for(const part of pathParts){if(part==='.'||!part)continue;if(part==='..')result.pop();else result.push(part);}return result.join('/');}function get(key){if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn((name)=>get(normalize(key,name)),m,m.exports);return m.exports;}get('main');})();

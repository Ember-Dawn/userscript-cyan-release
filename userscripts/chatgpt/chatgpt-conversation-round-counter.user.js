// ==UserScript==
// @name         ChatGPT 对话轮数统计
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
// @version      0.2.7
// @description  被动读取 ChatGPT 自身 conversation mapping，统计并缓存当前对话的累计用户消息节点数。
// @author       Ember-Dawn
// @match        *://chat.openai.com/
// @match        *://chat.openai.com/*
// @match        *://chatgpt.com/
// @match        *://chatgpt.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const PageRequest = PAGE_WINDOW.Request;
    const PageURL = PAGE_WINDOW.URL;

    const ROUND_COUNT_CACHE_KEY = 'cyan_chatgpt_conversation_round_counter_cache_v1';
    const PATCH_FLAG = '__CYAN_ROUND_COUNTER_FETCH_PATCHED__';
    const HISTORY_PATCH_FLAG = '__CYAN_ROUND_COUNTER_HISTORY_PATCHED__';
    const MAX_ROUND_COUNT_CACHE_ENTRIES = 300;
    const BATCH_PATH = '/backend-api/conversations/batch';
    const LEGACY_USER_MESSAGE_SELECTOR = '[data-message-author-role="user"][data-message-id]';
    const SEARCH_USER_MESSAGE_SELECTOR = '[data-chatgpt-search-unit-key$=":user"][data-chatgpt-search-message-ids]';
    const USER_MESSAGE_BUBBLE_SELECTOR = '[data-user-message-bubble="true"]';
    const USER_MESSAGE_SELECTOR = [
        LEGACY_USER_MESSAGE_SELECTOR,
        SEARCH_USER_MESSAGE_SELECTOR,
        USER_MESSAGE_BUBBLE_SELECTOR,
    ].join(', ');
    const DIAGNOSTIC_PREFIX = '[RoundCounter]';
    const UI_INTEGRITY_INTERVAL_MS = 1000;
    const roundCountCache = loadRoundCountCache();

    const state = {
        totalRounds: null,
        currentConversationId: extractConversationPageId(),
        source: 'idle',
        uiReady: false,
        domIncrementReady: false,
        seenDomUserMessageIds: new Set(),
        knownUserMessageIds: new Set(),
        liveUserMessageIds: new Map(),
        pendingNewConversationUserIds: new Map(),
        mappingBaselineReady: false,
    };

    let statusButton = null;
    let uiPortalObserver = null;
    let uiFormObserver = null;
    let uiParentObserver = null;
    let uiWaitObserver = null;
    let uiMountToken = 0;
    let uiLoadWaitArmed = false;
    let uiIntegrityTimer = null;

    function diagnosticError(message, error) {
        console.error(`${DIAGNOSTIC_PREFIX} ${message}`, error);
    }

    function normalizeCacheEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const totalRounds = Number.isFinite(entry.totalRounds)
            ? Math.max(0, Math.trunc(entry.totalRounds))
            : null;
        if (totalRounds === null) {
            return null;
        }
        const maxRounds = Number.isFinite(entry.maxRounds)
            ? Math.max(totalRounds, 0, Math.trunc(entry.maxRounds))
            : totalRounds;
        return {
            totalRounds: maxRounds,
            maxRounds,
            updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
        };
    }

    function loadRoundCountCache() {
        try {
            if (typeof GM_getValue !== 'function') {
                return { version: 2, entries: {} };
            }
            const stored = GM_getValue(ROUND_COUNT_CACHE_KEY, { version: 2, entries: {} });
            const sourceEntries = stored?.entries && typeof stored.entries === 'object'
                ? stored.entries
                : {};
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
            return { version: 2, entries };
        } catch {
            return { version: 2, entries: {} };
        }
    }

    function saveRoundCountCache() {
        try {
            if (typeof GM_setValue !== 'function') {
                return;
            }
            const entries = Object.entries(roundCountCache.entries)
                .sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0))
                .slice(0, MAX_ROUND_COUNT_CACHE_ENTRIES);
            roundCountCache.entries = Object.fromEntries(entries);
            GM_setValue(ROUND_COUNT_CACHE_KEY, roundCountCache);
        } catch {
            // Tampermonkey 存储不可用时仍允许当前页面继续计数。
        }
    }

    function isLocalConversationId(conversationId) {
        return typeof conversationId === 'string' && /^local-chatgpt:/i.test(conversationId);
    }

    function isTemporaryConversationId(conversationId) {
        return typeof conversationId === 'string' && (
            /^WEB:/i.test(conversationId) ||
            isLocalConversationId(conversationId)
        );
    }

    function isStableConversationId(conversationId) {
        return typeof conversationId === 'string' && Boolean(conversationId) && !isTemporaryConversationId(conversationId);
    }

    function getCachedRoundCount(conversationId) {
        if (!isStableConversationId(conversationId)) {
            return null;
        }
        return normalizeCacheEntry(roundCountCache.entries[conversationId]);
    }

    function setCachedRoundCount(conversationId, totalRounds) {
        if (!isStableConversationId(conversationId) || !Number.isFinite(totalRounds)) {
            return;
        }
        const previous = getCachedRoundCount(conversationId);
        const maxRounds = Math.max(previous?.maxRounds ?? 0, Math.max(0, Math.trunc(totalRounds)));
        if (previous && previous.maxRounds === maxRounds) {
            return;
        }
        roundCountCache.entries[conversationId] = {
            totalRounds: maxRounds,
            maxRounds,
            updatedAt: Date.now(),
        };
        saveRoundCountCache();
    }

    function restorePersistentRoundCountStats() {
        const entry = getCachedRoundCount(state.currentConversationId);
        if (!entry) {
            return false;
        }
        state.totalRounds = entry.totalRounds;
        state.source = 'cached';
        state.domIncrementReady = false;
        renderUiState();
        return true;
    }

    function getRequestMeta(input, init) {
        let urlString;
        let method;

        if (input instanceof PageRequest) {
            urlString = input.url;
            method = (init?.method ?? input.method ?? 'GET').toUpperCase();
        } else if (input instanceof PageURL) {
            urlString = input.href;
            method = (init?.method ?? 'GET').toUpperCase();
        } else {
            urlString = String(input);
            method = (init?.method ?? 'GET').toUpperCase();
        }

        return {
            url: new PageURL(urlString, PAGE_WINDOW.location.href),
            method,
        };
    }

    function isBatchRequest(method, url) {
        return method === 'POST' && url.pathname === BATCH_PATH;
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

    function isCurrentPageConversation(conversationId) {
        const currentId = extractConversationPageId();
        return Boolean(
            isStableConversationId(currentId) &&
            currentId === conversationId &&
            state.currentConversationId === conversationId
        );
    }

    function applyMappingSnapshot(conversationId, mappingUserIds, requestStartedAt) {
        const mappingIds = new Set(mappingUserIds);

        if (!isCurrentPageConversation(conversationId)) {
            setCachedRoundCount(conversationId, mappingIds.size);
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
        // A natural batch can contain only a partial mapping after ChatGPT UI updates.
        // Never let that snapshot erase a higher cumulative count.
        const historicMaximum = getCachedRoundCount(conversationId)?.maxRounds ?? 0;
        const snapshotTotal = state.knownUserMessageIds.size;
        state.totalRounds = Math.max(state.totalRounds ?? 0, historicMaximum, snapshotTotal);
        state.source = state.totalRounds > snapshotTotal ? 'protected' : 'mapping';
        state.mappingBaselineReady = true;
        state.domIncrementReady = true;

        seedVisibleUserMessageIds();
        setCachedRoundCount(conversationId, state.totalRounds);
        renderUiState();
    }

    function applyMessagesFallback(conversationId, messageUserIds) {
        const messageIds = new Set(messageUserIds);
        const cachedTotal = getCachedRoundCount(conversationId)?.totalRounds ?? null;

        if (!isCurrentPageConversation(conversationId)) {
            const nextTotal = Math.max(cachedTotal ?? 0, messageIds.size);
            if (cachedTotal === null || nextTotal > cachedTotal) {
                setCachedRoundCount(conversationId, nextTotal);
            }
            return;
        }

        for (const id of messageIds) {
            state.knownUserMessageIds.add(id);
        }

        for (const id of getVisibleUserMessageIds()) {
            state.knownUserMessageIds.add(id);
        }

        if (state.mappingBaselineReady) {
            seedVisibleUserMessageIds();
            return;
        }

        const nextTotal = Math.max(
            state.totalRounds ?? 0,
            cachedTotal ?? 0,
            state.knownUserMessageIds.size
        );

        state.totalRounds = nextTotal;
        state.source = 'messages';
        state.domIncrementReady = true;

        seedVisibleUserMessageIds();
        setCachedRoundCount(conversationId, state.totalRounds);
        renderUiState();
    }

    async function handleConversationMessagesResponse(response, conversationId) {
        if (!response.ok || !isJsonResponse(response) || !isStableConversationId(conversationId)) {
            return response;
        }
        try {
            const data = await response.clone().json();
            if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) {
                return response;
            }
            applyMessagesFallback(conversationId, getMessagesUserMessageIds(data.messages));
        } catch (error) {
            diagnosticError('conversation messages response handling failed', error);
        }
        return response;
    }

    async function handleBatchResponse(response, requestStartedAt) {
        if (!response.ok || !isJsonResponse(response)) {
            return response;
        }
        try {
            const data = await response.clone().json();
            if (!Array.isArray(data)) {
                return response;
            }
            for (const conversation of data) {
                const conversationId = conversation?.id;
                if (!isStableConversationId(conversationId)) {
                    continue;
                }
                const mapping = conversation?.mapping;
                if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
                    continue;
                }
                applyMappingSnapshot(
                    conversationId,
                    getMappingUserMessageIds(mapping),
                    requestStartedAt
                );
            }
        } catch (error) {
            diagnosticError('batch response handling failed', error);
        }
        return response;
    }

    function patchFetch() {
        if (PAGE_WINDOW[PATCH_FLAG]) {
            return;
        }

        const nativeFetch = PAGE_WINDOW.fetch.bind(PAGE_WINDOW);
        PAGE_WINDOW.fetch = async (...args) => {
            let meta;
            try {
                meta = getRequestMeta(args[0], args[1]);
            } catch {
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
                return handleBatchResponse(response, requestStartedAt);
            }
            return handleConversationMessagesResponse(response, conversationMessagesId);
        };
        PAGE_WINDOW[PATCH_FLAG] = true;
    }

    function getStatusText() {
        if (state.totalRounds !== null) {
            return String(state.totalRounds);
        }
        if (state.currentConversationId === null && state.pendingNewConversationUserIds.size === 0) {
            return '0';
        }
        return '–';
    }

    function getStatusTitle() {
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
        if (state.currentConversationId === null || isTemporaryConversationId(state.currentConversationId)) {
            return '当前新对话尚无用户轮次';
        }
        return '等待 ChatGPT 页面自然加载当前对话 mapping';
    }

    function renderUiState() {
        if (!state.uiReady || !statusButton) {
            return;
        }
        const text = getStatusText();
        const title = getStatusTitle();
        const source = state.source;
        if (statusButton.textContent !== text) {
            statusButton.textContent = text;
        }
        if (statusButton.title !== title) {
            statusButton.title = title;
        }
        if (statusButton.dataset.source !== source) {
            statusButton.dataset.source = source;
        }
    }

    function installStyles() {
        if (document.getElementById('cyan-round-counter-style')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'cyan-round-counter-style';
        style.textContent = `
#cyan-round-counter-root {
    position: absolute;
    right: 14px;
    bottom: -1px;
    z-index: 20;
    pointer-events: none;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#cyan-round-counter-status {
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
`;
        (document.head || document.documentElement).appendChild(style);
    }

    function getPortalConversationId(portal) {
        const raw = portal?.getAttribute?.('data-above-composer-conversation-id') || '';
        return raw.replace(/^chatgpt:/i, '') || null;
    }

    function getComposerPortalPriority(portal) {
        if (!(portal instanceof Element) || !portal.isConnected) {
            return -1;
        }

        const form = portal.closest('form[data-chatgpt-composer]');
        if (!form) {
            return -1;
        }

        const routeConversationId = extractConversationPageId();
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
            if (isTemporaryConversationId(portalConversationId)) {
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

        if (isTemporaryConversationId(portalConversationId)) {
            return 300;
        }

        return portalConversationId ? -1 : 200;
    }

    function isComposerPortalForCurrentRoute(portal) {
        return getComposerPortalPriority(portal) >= 0;
    }

    function getComposerPortal() {
        const portals = document.querySelectorAll(
            'form[data-chatgpt-composer] > [data-above-composer-portal="true"]'
        );
        let bestPortal = null;
        let bestPriority = -1;

        for (const portal of portals) {
            const priority = getComposerPortalPriority(portal);
            if (priority > bestPriority) {
                bestPriority = priority;
                bestPortal = portal;
            }
        }

        return bestPortal;
    }

    function disconnectUiObservers() {
        uiPortalObserver?.disconnect();
        uiFormObserver?.disconnect();
        uiParentObserver?.disconnect();
        uiPortalObserver = null;
        uiFormObserver = null;
        uiParentObserver = null;
    }

    function disconnectUiWaitObserver() {
        uiWaitObserver?.disconnect();
        uiWaitObserver = null;
    }

    function startUiWaitObserver() {
        if (uiWaitObserver || !document.documentElement) {
            return;
        }
        uiWaitObserver = new MutationObserver(() => {
            if (document.readyState !== 'complete') {
                return;
            }
            const portal = getComposerPortal();
            if (!portal) {
                return;
            }
            disconnectUiWaitObserver();
            scheduleStableUiMount(portal);
        });
        uiWaitObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-composer-placement', 'data-above-composer-conversation-id'],
        });
    }

    function bindUiObservers(portal) {
        disconnectUiObservers();
        const form = portal.closest('form[data-chatgpt-composer]');
        if (!form) {
            return;
        }

        uiPortalObserver = new MutationObserver(() => {
            const root = document.getElementById('cyan-round-counter-root');
            if (!root || root.parentElement !== portal) {
                scheduleStableUiMount(portal);
            }
        });
        uiPortalObserver.observe(portal, {
            childList: true,
            attributes: true,
            attributeFilter: ['data-above-composer-conversation-id'],
        });

        uiFormObserver = new MutationObserver(() => {
            if (!form.isConnected || getComposerPortal() !== portal) {
                startUiMountWait();
            }
        });
        uiFormObserver.observe(form, {
            childList: true,
            attributes: true,
            attributeFilter: ['data-composer-placement'],
        });

        const parent = form.parentElement;
        if (parent) {
            uiParentObserver = new MutationObserver(() => {
                if (!form.isConnected || getComposerPortal() !== portal) {
                    startUiMountWait();
                }
            });
            uiParentObserver.observe(parent, { childList: true, subtree: true });
        }
    }

    function installUi(portal) {
        if (!portal || !isComposerPortalForCurrentRoute(portal) || getComposerPortal() !== portal) {
            return false;
        }
        let root = document.getElementById('cyan-round-counter-root');
        let changed = false;
        if (!root) {
            root = document.createElement('div');
            root.id = 'cyan-round-counter-root';
            statusButton = document.createElement('div');
            statusButton.id = 'cyan-round-counter-status';
            statusButton.setAttribute('role', 'status');
            statusButton.setAttribute('aria-live', 'polite');
            root.appendChild(statusButton);
            changed = true;
        } else {
            statusButton = root.querySelector('#cyan-round-counter-status');
        }
        if (!statusButton) {
            return false;
        }
        if (root.parentElement !== portal) {
            portal.appendChild(root);
            changed = true;
        }
        state.uiReady = true;
        if (changed) {
            renderUiState();
        }
        bindUiObservers(portal);
        disconnectUiWaitObserver();
        return true;
    }

    function scheduleStableUiMount(expectedPortal) {
        if (!expectedPortal?.isConnected) {
            startUiMountWait();
            return;
        }
        const token = ++uiMountToken;
        PAGE_WINDOW.requestAnimationFrame(() => {
            PAGE_WINDOW.requestAnimationFrame(() => {
                if (token !== uiMountToken) {
                    return;
                }
                const currentPortal = getComposerPortal();
                if (currentPortal !== expectedPortal || !expectedPortal.isConnected) {
                    startUiMountWait();
                    return;
                }
                installUi(expectedPortal);
            });
        });
    }

    function startUiMountWait() {
        installStyles();
        disconnectUiObservers();
        uiMountToken += 1;
        state.uiReady = false;
        statusButton = null;

        if (document.readyState !== 'complete') {
            if (!uiLoadWaitArmed) {
                uiLoadWaitArmed = true;
                PAGE_WINDOW.addEventListener('load', () => {
                    uiLoadWaitArmed = false;
                    startUiMountWait();
                }, { once: true });
            }
            return;
        }

        const portal = getComposerPortal();
        if (!portal) {
            startUiWaitObserver();
            return;
        }
        disconnectUiWaitObserver();
        scheduleStableUiMount(portal);
    }


    function verifyUiIntegrity() {
        if (document.readyState !== 'complete') {
            return;
        }

        const portal = getComposerPortal();
        const root = document.getElementById('cyan-round-counter-root');

        if (!portal) {
            state.uiReady = false;
            statusButton = null;
            startUiWaitObserver();
            return;
        }

        if (!root || root.parentElement !== portal || !state.uiReady) {
            scheduleStableUiMount(portal);
        }
    }

    function startUiIntegrityWatch() {
        if (uiIntegrityTimer !== null) {
            return;
        }
        uiIntegrityTimer = PAGE_WINDOW.setInterval(verifyUiIntegrity, UI_INTEGRITY_INTERVAL_MS);
    }

    function getDomUserMessageIds(element) {
        if (!(element instanceof Element)) {
            return [];
        }

        const ids = new Set();
        const addId = (id) => {
            if (typeof id === 'string' && id) {
                ids.add(id);
            }
        };

        if (element.matches(LEGACY_USER_MESSAGE_SELECTOR)) {
            addId(element.getAttribute('data-message-id'));
        }

        if (element.matches(SEARCH_USER_MESSAGE_SELECTOR)) {
            const rawIds = element.getAttribute('data-chatgpt-search-message-ids') || '';
            for (const id of rawIds.split(/\s+/)) {
                addId(id);
            }
        }

        if (element.matches(USER_MESSAGE_BUBBLE_SELECTOR)) {
            addId(element.closest('[data-turn-key]')?.getAttribute('data-turn-key'));
        }

        return [...ids];
    }

    function getVisibleUserMessageIds() {
        if (!document.querySelectorAll) {
            return [];
        }
        const ids = [];
        const seen = new Set();
        const nodes = document.querySelectorAll(USER_MESSAGE_SELECTOR);
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

    function seedVisibleUserMessageIds() {
        for (const id of getVisibleUserMessageIds()) {
            state.seenDomUserMessageIds.add(id);
        }
    }

    function collectPendingVisibleUserMessages() {
        const now = Date.now();
        for (const id of getVisibleUserMessageIds()) {
            if (!state.pendingNewConversationUserIds.has(id)) {
                state.pendingNewConversationUserIds.set(id, now);
            }
        }
    }

    function renderTemporaryConversationStats() {
        state.totalRounds = state.pendingNewConversationUserIds.size;
        state.source = 'live';
        renderUiState();
    }

    function bootstrapFreshConversation(conversationId) {
        if (!isStableConversationId(conversationId) || state.pendingNewConversationUserIds.size === 0) {
            return false;
        }

        state.knownUserMessageIds = new Set(state.pendingNewConversationUserIds.keys());
        state.liveUserMessageIds = new Map(state.pendingNewConversationUserIds);
        state.totalRounds = state.knownUserMessageIds.size;
        state.source = 'live';
        state.domIncrementReady = true;
        seedVisibleUserMessageIds();
        setCachedRoundCount(conversationId, state.totalRounds);
        renderUiState();
        return true;
    }

    function processAddedNodeForUserMessages(node) {
        if (!(node instanceof Element)) {
            return;
        }

        const candidates = [];
        if (node.matches(USER_MESSAGE_SELECTOR)) {
            candidates.push(node);
        }
        if (node.querySelector(USER_MESSAGE_SELECTOR)) {
            for (const child of node.querySelectorAll(USER_MESSAGE_SELECTOR)) {
                candidates.push(child);
            }
        }

        const now = Date.now();
        for (const element of candidates) {
            for (const id of getDomUserMessageIds(element)) {
                if (state.seenDomUserMessageIds.has(id)) {
                    continue;
                }
                state.seenDomUserMessageIds.add(id);

                if (state.currentConversationId === null || isTemporaryConversationId(state.currentConversationId)) {
                    if (!state.pendingNewConversationUserIds.has(id)) {
                        state.pendingNewConversationUserIds.set(id, now);
                        renderTemporaryConversationStats();
                    }
                    continue;
                }

                if (!state.domIncrementReady || state.knownUserMessageIds.has(id)) {
                    continue;
                }

                state.knownUserMessageIds.add(id);
                state.liveUserMessageIds.set(id, now);
                if (state.totalRounds === null) {
                    continue;
                }
                state.totalRounds += 1;
                state.source = 'live';
                setCachedRoundCount(state.currentConversationId, state.totalRounds);
                renderUiState();
            }
        }
    }

    function installLocalMessageObserver() {
        seedVisibleUserMessageIds();
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    processAddedNodeForUserMessages(node);
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function extractConversationPageId() {
        const match = location.pathname.match(/(?:^|\/)c\/([^/]+)\/?$/);
        return match?.[1] ?? null;
    }

    function resetConversationRuntimeState() {
        state.totalRounds = null;
        state.source = 'idle';
        state.domIncrementReady = false;
        state.seenDomUserMessageIds.clear();
        state.knownUserMessageIds.clear();
        state.liveUserMessageIds.clear();
        state.mappingBaselineReady = false;
    }

    function handleNavigation() {
        const previousConversationId = state.currentConversationId;
        const nextConversationId = extractConversationPageId();
        const previousWasTemporary = previousConversationId === null || isTemporaryConversationId(previousConversationId);
        const nextIsTemporary = nextConversationId === null || isTemporaryConversationId(nextConversationId);

        if (previousWasTemporary) {
            collectPendingVisibleUserMessages();
        }

        resetConversationRuntimeState();
        state.currentConversationId = nextConversationId;
        startUiMountWait();

        if (nextIsTemporary) {
            seedVisibleUserMessageIds();
            renderTemporaryConversationStats();
            return;
        }

        const hasPendingBinding = previousWasTemporary && state.pendingNewConversationUserIds.size > 0;
        if (hasPendingBinding && bootstrapFreshConversation(nextConversationId)) {
            state.pendingNewConversationUserIds.clear();
            return;
        }

        state.pendingNewConversationUserIds.clear();
        if (!restorePersistentRoundCountStats()) {
            renderUiState();
        }
        seedVisibleUserMessageIds();
    }

    function patchHistoryForSpaNavigation() {
        if (PAGE_WINDOW[HISTORY_PATCH_FLAG]) {
            return;
        }
        PAGE_WINDOW[HISTORY_PATCH_FLAG] = true;

        let lastHref = PAGE_WINDOW.location.href;
        const checkNavigation = () => {
            if (PAGE_WINDOW.location.href === lastHref) {
                return;
            }
            lastHref = PAGE_WINDOW.location.href;
            handleNavigation();
        };

        const originalPushState = PAGE_WINDOW.history.pushState.bind(PAGE_WINDOW.history);
        const originalReplaceState = PAGE_WINDOW.history.replaceState.bind(PAGE_WINDOW.history);

        PAGE_WINDOW.history.pushState = function (...args) {
            const result = originalPushState(...args);
            queueMicrotask(checkNavigation);
            return result;
        };
        PAGE_WINDOW.history.replaceState = function (...args) {
            const result = originalReplaceState(...args);
            queueMicrotask(checkNavigation);
            return result;
        };
        PAGE_WINDOW.addEventListener('popstate', () => queueMicrotask(checkNavigation));
    }

    function initializeDomFeatures() {
        if (state.currentConversationId === null || isTemporaryConversationId(state.currentConversationId)) {
            collectPendingVisibleUserMessages();
            renderTemporaryConversationStats();
        } else if (!restorePersistentRoundCountStats()) {
            renderUiState();
        }
        startUiMountWait();
        startUiIntegrityWatch();
        installLocalMessageObserver();
        patchHistoryForSpaNavigation();
    }

    patchFetch();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeDomFeatures, { once: true });
    } else {
        initializeDomFeatures();
    }
})();

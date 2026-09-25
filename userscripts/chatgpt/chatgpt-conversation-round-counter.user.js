// ==UserScript==
// @name         ChatGPT 对话轮数统计
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
// @version      0.1.3
// @description  统计并缓存 ChatGPT 当前对话的完整用户轮数，支持分页补齐、断点续跑和新建对话实时计数。
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
    const PageHeaders = PAGE_WINDOW.Headers;

    const ROUND_COUNT_CACHE_KEY = 'cyan_chatgpt_conversation_round_counter_cache_v1';
    const PATCH_FLAG = '__CYAN_ROUND_COUNTER_FETCH_PATCHED__';
    const HISTORY_PATCH_FLAG = '__CYAN_ROUND_COUNTER_HISTORY_PATCHED__';
    const MAX_ROUND_COUNT_CACHE_ENTRIES = 300;
    const BACKGROUND_PAGE_TURNS = 25;
    const BACKGROUND_INITIAL_DELAY_MIN_MS = 1000;
    const BACKGROUND_INITIAL_DELAY_MAX_MS = 2000;
    const BACKGROUND_PAGE_DELAY_MIN_MS = 1000;
    const BACKGROUND_PAGE_DELAY_MAX_MS = 2000;
    const HIDDEN_ROLES = new Set(['system', 'tool', 'thinking']);
    const DIAGNOSTIC_PREFIX = '[RoundCounter]';
    const roundCountCache = loadRoundCountCache();

    const state = {
        totalRounds: null,
        currentConversationId: extractConversationPageId(),
        uiReady: false,
        seenUserMessageIds: new Set(),
        pendingNewConversationUserIds: new Set(),
        domIncrementReady: false,
        domBaselineToken: 0,
        loadedRounds: null,
        hasEarlierHistory: null,
        roundCountStatus: 'idle',
        roundCountRequestTemplate: null,
        roundCountTimer: null,
        roundCountAbortController: null,
        roundCountToken: 0,
    };

    let nativePageFetch = null;
    let statusButton = null;
    let uiPortalObserver = null;
    let uiFormObserver = null;
    let uiParentObserver = null;
    let uiRetryTimers = [];

    function diagnosticError(message, error) {
        console.error(`${DIAGNOSTIC_PREFIX} ${message}`, error);
    }

    function normalizeRoundCountEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const completed = entry.completed === true;
        const totalRounds = Number.isFinite(entry.totalRounds) ? Math.max(0, entry.totalRounds) : null;
        const countedRounds = Number.isFinite(entry.countedRounds) ? Math.max(0, entry.countedRounds) : 0;
        const nextBeforeCursor = typeof entry.nextBeforeCursor === 'string' && entry.nextBeforeCursor
            ? entry.nextBeforeCursor
            : null;
        const latestUserMessageId = typeof entry.latestUserMessageId === 'string' && entry.latestUserMessageId
            ? entry.latestUserMessageId
            : null;
        const seenUserMessageIds = Array.isArray(entry.seenUserMessageIds)
            ? [...new Set(entry.seenUserMessageIds.filter((id) => typeof id === 'string' && id))]
            : [];

        if (completed && totalRounds === null) {
            return null;
        }
        if (!completed && countedRounds === 0 && seenUserMessageIds.length === 0 && !nextBeforeCursor) {
            return null;
        }

        return {
            completed,
            totalRounds,
            countedRounds: completed ? (totalRounds ?? countedRounds) : Math.max(countedRounds, seenUserMessageIds.length),
            nextBeforeCursor: completed ? null : nextBeforeCursor,
            seenUserMessageIds: completed ? [] : seenUserMessageIds,
            latestUserMessageId,
            updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
        };
    }

    function loadRoundCountCache() {
        try {
            if (typeof GM_getValue !== 'function') {
                return { version: 1, entries: {} };
            }
            const stored = GM_getValue(ROUND_COUNT_CACHE_KEY, { version: 1, entries: {} });
            const sourceEntries = stored?.entries && typeof stored.entries === 'object' ? stored.entries : {};
            const entries = {};
            for (const [conversationId, rawEntry] of Object.entries(sourceEntries)) {
                if (typeof conversationId !== 'string' || !conversationId) {
                    continue;
                }
                const entry = normalizeRoundCountEntry(rawEntry);
                if (entry) {
                    entries[conversationId] = entry;
                }
            }
            return { version: 1, entries };
        } catch {
            return { version: 1, entries: {} };
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

    function getRoundCountEntry(conversationId) {
        if (!isStableConversationId(conversationId)) {
            return null;
        }
        return normalizeRoundCountEntry(roundCountCache.entries[conversationId]);
    }

    function setRoundCountEntry(conversationId, entry) {
        if (!isStableConversationId(conversationId)) {
            return;
        }
        const normalized = normalizeRoundCountEntry({ ...entry, updatedAt: Date.now() });
        if (!normalized) {
            delete roundCountCache.entries[conversationId];
        } else {
            roundCountCache.entries[conversationId] = normalized;
        }
        saveRoundCountCache();
    }

    function restorePersistentRoundCountStats() {
        const entry = getRoundCountEntry(state.currentConversationId);
        if (!entry?.completed || !Number.isFinite(entry.totalRounds)) {
            return false;
        }
        state.totalRounds = entry.totalRounds;
        state.roundCountStatus = 'complete';
        renderUiState();
        armDomIncrementBaseline();
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

    function isConversationGet(method, url) {
        return method === 'GET' && /^\/backend-api\/(conversation|conversations|shared_conversation)\/[^/]+\/?$/.test(url.pathname);
    }

    function isJsonResponse(response) {
        const contentType = response.headers.get('content-type') || '';
        return contentType.toLowerCase().includes('application/json');
    }

    function isVisibleMessage(node) {
        const role = node?.message?.author?.role;
        return Boolean(role) && !HIDDEN_ROLES.has(role);
    }

    function buildActivePath(mapping, currentNode) {
        if (!mapping || !currentNode || !mapping[currentNode]) {
            return null;
        }

        const reversed = [];
        const visited = new Set();
        let cursor = currentNode;
        while (cursor) {
            const node = mapping[cursor];
            if (!node || visited.has(cursor)) {
                break;
            }
            visited.add(cursor);
            reversed.push(cursor);
            cursor = node.parent ?? null;
        }

        if (reversed.length === 0) {
            return null;
        }
        reversed.reverse();
        return reversed;
    }

    function analyzeLegacyConversation(data) {
        const mapping = data?.mapping;
        const path = buildActivePath(mapping, data?.current_node);
        if (!mapping || !path) {
            return null;
        }

        let lastRole = null;
        let totalRounds = 0;
        for (const nodeId of path) {
            const node = mapping[nodeId];
            if (!isVisibleMessage(node)) {
                continue;
            }
            const role = node.message.author.role;
            if (role !== lastRole) {
                if (role === 'user') {
                    totalRounds += 1;
                }
                lastRole = role;
            }
        }
        return totalRounds;
    }

    function getConversationRequestInfo(url) {
        const match = url.pathname.match(/^\/backend-api\/(conversation|conversations|shared_conversation)\/([^/]+)\/?$/);
        if (!match) {
            return null;
        }
        return {
            kind: match[1],
            id: decodeURIComponent(match[2]),
        };
    }

    function isRequestForCurrentPage(requestInfo) {
        if (!requestInfo) {
            return false;
        }
        if (requestInfo.kind === 'conversation' || requestInfo.kind === 'conversations') {
            const currentId = extractConversationPageId();
            return Boolean(
                isStableConversationId(currentId) &&
                state.currentConversationId === currentId &&
                requestInfo.id === currentId
            );
        }
        return extractConversationPageId() === null;
    }

    function armDomIncrementBaseline() {
        state.domIncrementReady = false;
        const token = ++state.domBaselineToken;
        const conversationId = state.currentConversationId;
        window.setTimeout(() => {
            if (token !== state.domBaselineToken || conversationId !== state.currentConversationId) {
                return;
            }
            seedVisibleUserMessageIds();
            state.domIncrementReady = true;
        }, 1000);
    }

    function getMessageRole(item) {
        return item?.author?.role ?? item?.message?.author?.role ?? null;
    }

    function getMessageId(item) {
        return item?.id ?? item?.message?.id ?? null;
    }

    function getUniqueUserMessageIds(messages) {
        const ids = [];
        const seen = new Set();
        for (const item of messages) {
            if (getMessageRole(item) !== 'user') {
                continue;
            }
            const id = getMessageId(item);
            if (typeof id !== 'string' || !id || seen.has(id)) {
                continue;
            }
            seen.add(id);
            ids.push(id);
        }
        return ids;
    }

    function getHasEarlierHistory(pageInfo, continuation) {
        const booleanKeys = [
            'has_previous_page', 'has_previous', 'has_more', 'has_more_before',
            'has_prev_page', 'has_older', 'has_older_messages', 'has_previous_messages',
        ];
        if (pageInfo && typeof pageInfo === 'object') {
            for (const key of booleanKeys) {
                if (typeof pageInfo[key] === 'boolean') {
                    return pageInfo[key];
                }
            }
        }
        if (continuation != null) {
            return Boolean(continuation);
        }
        return null;
    }

    function analyzePagedConversation(data) {
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const userMessageIds = getUniqueUserMessageIds(messages);
        const pageInfo = data?.page_info;
        return {
            loadedRounds: userMessageIds.length,
            hasEarlierHistory: getHasEarlierHistory(pageInfo, data?.context_truncation_continuation),
            startCursor: typeof pageInfo?.start_cursor === 'string' && pageInfo.start_cursor ? pageInfo.start_cursor : null,
            userMessageIds,
        };
    }

    function createFreshRoundCountEntry(paged) {
        const ids = [...new Set(paged.userMessageIds)];
        const completed = paged.hasEarlierHistory === false;
        return {
            completed,
            totalRounds: completed ? ids.length : null,
            countedRounds: ids.length,
            nextBeforeCursor: completed ? null : paged.startCursor,
            seenUserMessageIds: completed ? [] : ids,
            latestUserMessageId: ids.at(-1) ?? null,
            updatedAt: Date.now(),
        };
    }

    function applyRoundCountEntryToState(entry, paged) {
        state.loadedRounds = paged.loadedRounds;
        state.hasEarlierHistory = paged.hasEarlierHistory;
        if (entry?.completed && Number.isFinite(entry.totalRounds)) {
            state.totalRounds = entry.totalRounds;
            state.roundCountStatus = 'complete';
            armDomIncrementBaseline();
        } else {
            state.totalRounds = null;
            state.roundCountStatus = paged.hasEarlierHistory === true ? 'counting' : 'idle';
        }
        renderUiState();
    }

    function prepareRoundCountFromInitialPage(conversationId, paged) {
        const currentIds = paged.userMessageIds;
        const currentLatestId = currentIds.at(-1) ?? null;
        let entry = getRoundCountEntry(conversationId);

        if (entry?.completed && Number.isFinite(entry.totalRounds)) {
            if (entry.latestUserMessageId && currentLatestId === entry.latestUserMessageId) {
                applyRoundCountEntryToState(entry, paged);
                return entry;
            }
            const anchorIndex = entry.latestUserMessageId ? currentIds.indexOf(entry.latestUserMessageId) : -1;
            if (anchorIndex >= 0) {
                const appendedIds = currentIds.slice(anchorIndex + 1);
                if (appendedIds.length > 0) {
                    entry.totalRounds += appendedIds.length;
                    entry.countedRounds = entry.totalRounds;
                    entry.latestUserMessageId = currentLatestId;
                    setRoundCountEntry(conversationId, entry);
                }
                applyRoundCountEntryToState(entry, paged);
                return entry;
            }
            entry = null;
        }

        if (entry && !entry.completed) {
            if (entry.latestUserMessageId && !currentIds.includes(entry.latestUserMessageId)) {
                entry = null;
            } else {
                const seen = new Set(entry.seenUserMessageIds);
                for (const id of currentIds) {
                    seen.add(id);
                }
                entry.seenUserMessageIds = [...seen];
                entry.countedRounds = seen.size;
                entry.latestUserMessageId = currentLatestId ?? entry.latestUserMessageId;
                if (!entry.nextBeforeCursor) {
                    entry.nextBeforeCursor = paged.startCursor;
                }
                if (paged.hasEarlierHistory === false) {
                    entry.completed = true;
                    entry.totalRounds = seen.size;
                    entry.countedRounds = seen.size;
                    entry.nextBeforeCursor = null;
                    entry.seenUserMessageIds = [];
                }
                setRoundCountEntry(conversationId, entry);
                applyRoundCountEntryToState(entry, paged);
                return entry;
            }
        }

        entry = createFreshRoundCountEntry(paged);
        setRoundCountEntry(conversationId, entry);
        applyRoundCountEntryToState(entry, paged);
        return entry;
    }

    function randomDelay(minimum, maximum) {
        return Math.floor(minimum + Math.random() * (maximum - minimum + 1));
    }

    function cancelBackgroundRoundCount(resetStatus = false) {
        state.roundCountToken += 1;
        if (state.roundCountTimer !== null) {
            window.clearTimeout(state.roundCountTimer);
            state.roundCountTimer = null;
        }
        if (state.roundCountAbortController) {
            state.roundCountAbortController.abort();
            state.roundCountAbortController = null;
        }
        if (resetStatus) {
            state.roundCountStatus = 'idle';
        }
    }

    function captureRoundCountRequestTemplate(args, conversationId) {
        try {
            const request = new PageRequest(args[0], args[1]);
            state.roundCountRequestTemplate = {
                conversationId,
                headers: [...request.headers.entries()],
                credentials: request.credentials || 'same-origin',
            };
        } catch {
            state.roundCountRequestTemplate = null;
        }
    }

    function buildBackgroundMessagesRequest(conversationId, beforeCursor, signal) {
        const template = state.roundCountRequestTemplate;
        if (!template || template.conversationId !== conversationId) {
            return null;
        }

        const path = `/backend-api/conversations/${encodeURIComponent(conversationId)}/messages`;
        const url = new PageURL(path, PAGE_WINDOW.location.origin);
        url.searchParams.set('before', beforeCursor);
        url.searchParams.set('include_has_versions', 'true');
        url.searchParams.set('num_turns', String(BACKGROUND_PAGE_TURNS));

        const headers = new PageHeaders(template.headers);
        if (headers.has('x-openai-target-path')) {
            headers.set('x-openai-target-path', path);
        }
        if (headers.has('x-openai-target-route')) {
            headers.set('x-openai-target-route', '/backend-api/conversations/{conversation_id}/messages');
        }
        headers.delete('content-length');

        return new PageRequest(url.href, {
            method: 'GET',
            headers,
            credentials: template.credentials,
            signal,
        });
    }

    function finishRoundCountEntry(conversationId, entry, totalRounds) {
        entry.completed = true;
        entry.totalRounds = totalRounds;
        entry.countedRounds = totalRounds;
        entry.nextBeforeCursor = null;
        entry.seenUserMessageIds = [];
        setRoundCountEntry(conversationId, entry);
        if (state.currentConversationId === conversationId) {
            state.totalRounds = totalRounds;
            state.roundCountStatus = 'complete';
            state.hasEarlierHistory = false;
            renderUiState();
            armDomIncrementBaseline();
        }
    }

    function ingestRoundCountPage(conversationId, requestedBeforeCursor, data) {
        const entry = getRoundCountEntry(conversationId);
        if (!entry || entry.completed || entry.nextBeforeCursor !== requestedBeforeCursor) {
            return false;
        }

        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const userIds = getUniqueUserMessageIds(messages);
        const seen = new Set(entry.seenUserMessageIds);
        for (const id of userIds) {
            seen.add(id);
        }
        entry.seenUserMessageIds = [...seen];
        entry.countedRounds = seen.size;

        const pageInfo = data?.page_info;
        const hasEarlierHistory = getHasEarlierHistory(pageInfo, null);
        const nextCursor = typeof pageInfo?.start_cursor === 'string' && pageInfo.start_cursor
            ? pageInfo.start_cursor
            : null;

        if (hasEarlierHistory === false) {
            finishRoundCountEntry(conversationId, entry, seen.size);
            return true;
        }
        if (!nextCursor || nextCursor === requestedBeforeCursor) {
            setRoundCountEntry(conversationId, entry);
            if (state.currentConversationId === conversationId) {
                state.roundCountStatus = 'paused';
                renderUiState();
            }
            return false;
        }

        entry.nextBeforeCursor = nextCursor;
        setRoundCountEntry(conversationId, entry);
        return true;
    }

    function scheduleBackgroundRoundCount(initial = false) {
        if (!nativePageFetch || document.hidden) {
            return;
        }
        const conversationId = state.currentConversationId;
        const entry = getRoundCountEntry(conversationId);
        const template = state.roundCountRequestTemplate;
        if (!conversationId || !entry || entry.completed || !entry.nextBeforeCursor ||
            !template || template.conversationId !== conversationId) {
            return;
        }

        if (state.roundCountTimer !== null) {
            window.clearTimeout(state.roundCountTimer);
        }
        const token = state.roundCountToken;
        state.roundCountStatus = 'counting';
        renderUiState();
        const delay = initial
            ? randomDelay(BACKGROUND_INITIAL_DELAY_MIN_MS, BACKGROUND_INITIAL_DELAY_MAX_MS)
            : randomDelay(BACKGROUND_PAGE_DELAY_MIN_MS, BACKGROUND_PAGE_DELAY_MAX_MS);
        state.roundCountTimer = window.setTimeout(() => {
            state.roundCountTimer = null;
            runBackgroundRoundCountPage(conversationId, token);
        }, delay);
    }

    async function runBackgroundRoundCountPage(conversationId, token) {
        if (token !== state.roundCountToken || state.currentConversationId !== conversationId || document.hidden) {
            return;
        }
        const entry = getRoundCountEntry(conversationId);
        if (!entry || entry.completed || !entry.nextBeforeCursor) {
            return;
        }

        const requestedBeforeCursor = entry.nextBeforeCursor;
        const controller = new AbortController();
        state.roundCountAbortController = controller;
        const request = buildBackgroundMessagesRequest(conversationId, requestedBeforeCursor, controller.signal);
        if (!request) {
            state.roundCountStatus = 'paused';
            renderUiState();
            return;
        }

        try {
            const response = await nativePageFetch(request);
            if (token !== state.roundCountToken || state.currentConversationId !== conversationId) {
                return;
            }
            if (!response.ok || !isJsonResponse(response)) {
                state.roundCountStatus = 'paused';
                renderUiState();
                return;
            }
            const json = await response.json();
            const advanced = ingestRoundCountPage(conversationId, requestedBeforeCursor, json);
            const currentEntry = getRoundCountEntry(conversationId);
            if (advanced && currentEntry && !currentEntry.completed) {
                scheduleBackgroundRoundCount(false);
            }
        } catch (error) {
            if (error?.name !== 'AbortError' && token === state.roundCountToken &&
                state.currentConversationId === conversationId) {
                state.roundCountStatus = 'paused';
                renderUiState();
            }
        } finally {
            if (state.roundCountAbortController === controller) {
                state.roundCountAbortController = null;
            }
        }
    }

    function recordLiveUserMessagesInPersistentCache(messageIds) {
        const entry = getRoundCountEntry(state.currentConversationId);
        if (!entry || messageIds.length === 0) {
            return;
        }
        if (entry.completed && Number.isFinite(entry.totalRounds)) {
            entry.totalRounds += messageIds.length;
            entry.countedRounds = entry.totalRounds;
            entry.latestUserMessageId = messageIds.at(-1) ?? entry.latestUserMessageId;
            setRoundCountEntry(state.currentConversationId, entry);
            return;
        }
        const seen = new Set(entry.seenUserMessageIds);
        for (const id of messageIds) {
            seen.add(id);
        }
        entry.seenUserMessageIds = [...seen];
        entry.countedRounds = seen.size;
        entry.latestUserMessageId = messageIds.at(-1) ?? entry.latestUserMessageId;
        setRoundCountEntry(state.currentConversationId, entry);
    }

    async function handleConversationResponse(response, requestInfo) {
        if (!isJsonResponse(response)) {
            return response;
        }
        try {
            const json = await response.clone().json();
            if (requestInfo?.kind === 'conversations') {
                const paged = analyzePagedConversation(json);
                const entry = prepareRoundCountFromInitialPage(requestInfo.id, paged);
                if (entry && !entry.completed && entry.nextBeforeCursor) {
                    scheduleBackgroundRoundCount(true);
                }
                return response;
            }

            const totalRounds = analyzeLegacyConversation(json);
            if (Number.isFinite(totalRounds)) {
                state.totalRounds = totalRounds;
                state.roundCountStatus = 'complete';
                renderUiState();
                armDomIncrementBaseline();
            }
            return response;
        } catch (error) {
            diagnosticError('conversation response handling failed', error);
            return response;
        }
    }

    function getConversationMessagesRequestInfo(method, url) {
        if (method !== 'GET') {
            return null;
        }
        const match = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)\/messages\/?$/);
        if (!match) {
            return null;
        }
        return {
            id: decodeURIComponent(match[1]),
            beforeCursor: url.searchParams.get('before'),
        };
    }

    async function handleObservedMessagesResponse(response, requestInfo) {
        if (!requestInfo?.beforeCursor || !isJsonResponse(response)) {
            return response;
        }
        try {
            const json = await response.clone().json();
            const entry = getRoundCountEntry(requestInfo.id);
            if (entry && !entry.completed && entry.nextBeforeCursor === requestInfo.beforeCursor) {
                const advanced = ingestRoundCountPage(requestInfo.id, requestInfo.beforeCursor, json);
                if (advanced) {
                    scheduleBackgroundRoundCount(false);
                }
            }
        } catch {
            // 页面自己的分页请求统计失败时保持原响应不变。
        }
        return response;
    }

    function patchFetch() {
        if (PAGE_WINDOW[PATCH_FLAG]) {
            return;
        }

        const nativeFetch = PAGE_WINDOW.fetch.bind(PAGE_WINDOW);
        nativePageFetch = nativeFetch;
        PAGE_WINDOW.fetch = async (...args) => {
            let meta;
            try {
                meta = getRequestMeta(args[0], args[1]);
            } catch {
                return nativeFetch(...args);
            }

            const messagesInfo = getConversationMessagesRequestInfo(meta.method, meta.url);
            if (messagesInfo) {
                const currentId = extractConversationPageId();
                const isCurrent = Boolean(
                    isStableConversationId(currentId) &&
                    state.currentConversationId === currentId &&
                    messagesInfo.id === currentId
                );
                const response = await nativeFetch(...args);
                return isCurrent ? handleObservedMessagesResponse(response, messagesInfo) : response;
            }

            if (!isConversationGet(meta.method, meta.url)) {
                return nativeFetch(...args);
            }

            const requestInfo = getConversationRequestInfo(meta.url);
            if (!isRequestForCurrentPage(requestInfo)) {
                return nativeFetch(...args);
            }

            if (requestInfo?.kind === 'conversations') {
                captureRoundCountRequestTemplate(args, requestInfo.id);
            }
            const response = await nativeFetch(...args);
            return handleConversationResponse(response, requestInfo);
        };
        PAGE_WINDOW[PATCH_FLAG] = true;
    }

    function getStatusText() {
        if (state.totalRounds !== null) {
            return String(state.totalRounds);
        }
        if (state.roundCountStatus === 'counting') {
            return '…';
        }
        if (state.roundCountStatus === 'paused') {
            return '!';
        }
        if (state.loadedRounds !== null && state.hasEarlierHistory === true) {
            return '+';
        }
        if (state.currentConversationId === null && state.pendingNewConversationUserIds.size === 0) {
            return '0';
        }
        return '–';
    }

    function getStatusTitle() {
        if (state.totalRounds !== null) {
            return `当前对话：${state.totalRounds} 轮`;
        }
        if (state.roundCountStatus === 'counting') {
            return '正在后台统计完整对话轮数…';
        }
        if (state.roundCountStatus === 'paused') {
            return '完整轮数统计已暂停；重新进入会话或恢复可用上下文后会继续';
        }
        if (state.loadedRounds !== null && state.hasEarlierHistory === true) {
            return '已确认存在更早历史，等待继续统计';
        }
        return '当前对话尚无用户轮次';
    }

    function renderUiState() {
        if (!state.uiReady || !statusButton) {
            return;
        }
        const text = getStatusText();
        const title = getStatusTitle();
        const status = state.roundCountStatus;
        if (statusButton.textContent !== text) {
            statusButton.textContent = text;
        }
        if (statusButton.title !== title) {
            statusButton.title = title;
        }
        if (statusButton.dataset.status !== status) {
            statusButton.dataset.status = status;
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

    function getComposerPortal() {
        return document.querySelector(
            'form[data-chatgpt-composer][data-composer-placement="thread"] > [data-above-composer-portal="true"]'
        ) ?? document.querySelector(
            'form[data-chatgpt-composer] > [data-above-composer-portal="true"]'
        );
    }

    function disconnectUiObservers() {
        uiPortalObserver?.disconnect();
        uiFormObserver?.disconnect();
        uiParentObserver?.disconnect();
        uiPortalObserver = null;
        uiFormObserver = null;
        uiParentObserver = null;
    }

    function clearUiRetryTimers() {
        for (const timer of uiRetryTimers) {
            window.clearTimeout(timer);
        }
        uiRetryTimers = [];
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
                ensureUi();
            }
        });
        uiPortalObserver.observe(portal, { childList: true });

        uiFormObserver = new MutationObserver(() => {
            if (!form.isConnected || getComposerPortal() !== portal) {
                scheduleUiMountRetries();
            }
        });
        uiFormObserver.observe(form, { childList: true });

        const parent = form.parentElement;
        if (parent) {
            uiParentObserver = new MutationObserver(() => {
                if (!form.isConnected) {
                    scheduleUiMountRetries();
                }
            });
            uiParentObserver.observe(parent, { childList: true });
        }
    }

    function installUi(portal) {
        if (!portal) {
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
        clearUiRetryTimers();
        return true;
    }

    function ensureUi() {
        installStyles();
        const portal = getComposerPortal();
        if (!portal) {
            state.uiReady = false;
            statusButton = null;
            disconnectUiObservers();
            return false;
        }

        const root = document.getElementById('cyan-round-counter-root');
        if (root?.parentElement === portal) {
            const currentStatusButton = root.querySelector('#cyan-round-counter-status');
            if (currentStatusButton) {
                statusButton = currentStatusButton;
                state.uiReady = true;
                bindUiObservers(portal);
                clearUiRetryTimers();
                return true;
            }
        }
        return installUi(portal);
    }

    function scheduleUiMountRetries() {
        clearUiRetryTimers();
        const delays = [0, 60, 180, 400, 800, 1500, 2500];
        uiRetryTimers = delays.map((delay) => window.setTimeout(() => {
            if (ensureUi()) {
                clearUiRetryTimers();
            }
        }, delay));
    }

    function getVisibleUserMessageIds() {
        if (!document.querySelectorAll) {
            return [];
        }
        const ids = [];
        const seen = new Set();
        const nodes = document.querySelectorAll('[data-message-author-role="user"][data-message-id]');
        for (const node of nodes) {
            const id = node.getAttribute('data-message-id');
            if (!id || seen.has(id)) {
                continue;
            }
            seen.add(id);
            ids.push(id);
        }
        return ids;
    }

    function seedVisibleUserMessageIds() {
        for (const id of getVisibleUserMessageIds()) {
            state.seenUserMessageIds.add(id);
        }
    }

    function renderTemporaryConversationStats() {
        if (!isTemporaryConversationId(state.currentConversationId) || state.pendingNewConversationUserIds.size === 0) {
            return;
        }
        state.totalRounds = state.pendingNewConversationUserIds.size;
        state.loadedRounds = state.totalRounds;
        state.hasEarlierHistory = false;
        state.roundCountStatus = 'complete';
        renderUiState();
    }

    function initializeFreshConversationStats(conversationId, messageIds) {
        const ids = [...new Set(messageIds.filter((id) => typeof id === 'string' && id))];
        if (!isStableConversationId(conversationId) || ids.length === 0) {
            return false;
        }

        const totalRounds = ids.length;
        setRoundCountEntry(conversationId, {
            completed: true,
            totalRounds,
            countedRounds: totalRounds,
            nextBeforeCursor: null,
            seenUserMessageIds: [],
            latestUserMessageId: ids.at(-1) ?? null,
            updatedAt: Date.now(),
        });
        state.totalRounds = totalRounds;
        state.loadedRounds = totalRounds;
        state.hasEarlierHistory = false;
        state.roundCountStatus = 'complete';
        for (const id of ids) {
            state.seenUserMessageIds.add(id);
        }
        state.domIncrementReady = true;
        state.domBaselineToken += 1;
        renderUiState();
        return true;
    }

    function processAddedNodeForUserMessages(node) {
        if (!(node instanceof Element)) {
            return;
        }

        const selector = '[data-message-author-role="user"][data-message-id]';
        const candidates = [];
        if (node.matches(selector)) {
            candidates.push(node);
        }
        if (node.querySelector(selector)) {
            for (const child of node.querySelectorAll(selector)) {
                candidates.push(child);
            }
        }

        const addedIds = [];
        for (const element of candidates) {
            const id = element.getAttribute('data-message-id');
            if (!id || state.seenUserMessageIds.has(id)) {
                continue;
            }
            state.seenUserMessageIds.add(id);
            addedIds.push(id);
        }

        if (addedIds.length > 0 && (state.currentConversationId === null || isTemporaryConversationId(state.currentConversationId))) {
            for (const id of addedIds) {
                state.pendingNewConversationUserIds.add(id);
            }
            renderTemporaryConversationStats();
            return;
        }

        if (addedIds.length === 0 || !state.domIncrementReady) {
            return;
        }

        recordLiveUserMessagesInPersistentCache(addedIds);
        if (state.totalRounds === null) {
            return;
        }
        state.totalRounds += addedIds.length;
        renderUiState();
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

    function handleNavigation() {
        const previousConversationId = state.currentConversationId;
        const nextConversationId = extractConversationPageId();
        const previousWasTemporary = isTemporaryConversationId(previousConversationId);
        const nextIsTemporary = isTemporaryConversationId(nextConversationId);
        const visibleUserIds = getVisibleUserMessageIds();

        if (previousConversationId === null || previousWasTemporary) {
            for (const id of visibleUserIds) {
                state.pendingNewConversationUserIds.add(id);
            }
        }

        const canBootstrapFreshConversation = isStableConversationId(nextConversationId) && (
            previousWasTemporary ||
            (previousConversationId === null && state.pendingNewConversationUserIds.size > 0)
        );
        const freshConversationUserIds = canBootstrapFreshConversation
            ? [...state.pendingNewConversationUserIds]
            : [];

        cancelBackgroundRoundCount(true);
        state.totalRounds = null;
        state.loadedRounds = null;
        state.hasEarlierHistory = null;
        state.roundCountRequestTemplate = null;
        state.currentConversationId = nextConversationId;
        state.seenUserMessageIds.clear();
        state.domIncrementReady = false;
        state.domBaselineToken += 1;
        scheduleUiMountRetries();

        if (nextIsTemporary) {
            for (const id of state.pendingNewConversationUserIds) {
                state.seenUserMessageIds.add(id);
            }
            renderTemporaryConversationStats();
            return;
        }

        state.pendingNewConversationUserIds.clear();
        if (initializeFreshConversationStats(nextConversationId, freshConversationUserIds)) {
            return;
        }
        if (!restorePersistentRoundCountStats()) {
            renderUiState();
            queueMicrotask(seedVisibleUserMessageIds);
        }
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
        restorePersistentRoundCountStats();
        scheduleUiMountRetries();
        installLocalMessageObserver();
        patchHistoryForSpaNavigation();
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                scheduleBackgroundRoundCount(false);
            }
        });
        PAGE_WINDOW.addEventListener('pagehide', () => cancelBackgroundRoundCount(false));
    }

    patchFetch();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeDomFeatures, { once: true });
    } else {
        initializeDomFeatures();
    }
})();

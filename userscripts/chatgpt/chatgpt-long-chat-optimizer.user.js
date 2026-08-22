// ==UserScript==
// @name         ChatGPT 长对话优化助手
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-long-chat-optimizer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-long-chat-optimizer.user.js
// @version      0.3.1
// @description  适配 ChatGPT 分页会话接口，限制初始历史窗口，并低速后台统计与持久缓存总轮数。
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

/*
 * Upstream baseline:
 * - Repository: https://github.com/11me/light-session
 * - Version: 1.7.4
 * - Commit: 300aade18bff188749d062ac2fad7216c7bc36ca
 * - Checked: 2026-08-09
 *
 * This userscript is a Tampermonkey adaptation. Its round counting, local settings,
 * floating UI, and DOM lifecycle handling intentionally differ from upstream.
 */

(function () {
    'use strict';

    const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const PageRequest = PAGE_WINDOW.Request;
    const PageURL = PAGE_WINDOW.URL;
    const PageHeaders = PAGE_WINDOW.Headers;
    const PageResponse = PAGE_WINDOW.Response;

    const STORAGE_KEY = 'cyan_chatgpt_long_chat_optimizer';
    const SESSION_STATS_KEY = 'cyan_chatgpt_long_chat_optimizer_stats';
    const ROUND_COUNT_CACHE_KEY = 'cyan_chatgpt_long_chat_optimizer_round_cache_v1';
    const PATCH_FLAG = '__CYAN_LS_FETCH_PATCHED__';
    const HISTORY_PATCH_FLAG = '__CYAN_LS_HISTORY_PATCHED__';
    const DEFAULT_CONFIG = Object.freeze({ enabled: true, keepRounds: 10 });
    const MIN_ROUNDS = 1;
    const MAX_ROUNDS = 100;
    const MAX_STATS_CACHE_ENTRIES = 100;
    const MAX_ROUND_COUNT_CACHE_ENTRIES = 300;
    const BACKGROUND_PAGE_TURNS = 10;
    const BACKGROUND_INITIAL_DELAY_MIN_MS = 2500;
    const BACKGROUND_INITIAL_DELAY_MAX_MS = 4500;
    const BACKGROUND_PAGE_DELAY_MIN_MS = 2500;
    const BACKGROUND_PAGE_DELAY_MAX_MS = 4500;
    const HIDDEN_ROLES = new Set(['system', 'tool', 'thinking']);
    const DIAGNOSTIC_PREFIX = '[LS]';
    const conversationStatsCache = loadConversationStatsCache();
    const roundCountCache = loadRoundCountCache();

    const state = {
        totalRounds: null,
        keptRounds: null,
        currentConversationId: extractConversationPageId(),
        uiReady: false,
        seenUserMessageIds: new Set(),
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
    let panel = null;
    let currentStatusLine = null;
    let limitValue = null;
    let applyButton = null;
    let enabledSwitch = null;
    let draftLimit = null;
    let documentClickInstalled = false;

    function diagnosticLog(message, details) {
        if (details === undefined) {
            console.info(`${DIAGNOSTIC_PREFIX} ${message}`);
            return;
        }
        console.info(`${DIAGNOSTIC_PREFIX} ${message}`, details);
    }

    function diagnosticError(message, error) {
        console.error(`${DIAGNOSTIC_PREFIX} ${message}`, error);
    }

    function clampRounds(value) {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) {
            return DEFAULT_CONFIG.keepRounds;
        }
        return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, parsed));
    }

    function loadConversationStatsCache() {
        try {
            const raw = sessionStorage.getItem(SESSION_STATS_KEY);
            if (!raw) {
                return new Map();
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return new Map();
            }

            const cache = new Map();
            for (const entry of parsed) {
                if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Number.isFinite(entry[1])) {
                    continue;
                }
                cache.set(entry[0], Math.max(0, entry[1]));
            }
            return cache;
        } catch {
            return new Map();
        }
    }

    function saveConversationStatsCache() {
        try {
            sessionStorage.setItem(SESSION_STATS_KEY, JSON.stringify([...conversationStatsCache.entries()]));
        } catch {
            // sessionStorage 不可用时退化为当前 document 生命周期内的内存缓存。
        }
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
            // Tampermonkey 存储不可用时不影响核心历史窗口功能。
        }
    }

    function getRoundCountEntry(conversationId) {
        if (!conversationId) {
            return null;
        }
        return normalizeRoundCountEntry(roundCountCache.entries[conversationId]);
    }

    function setRoundCountEntry(conversationId, entry) {
        if (!conversationId) {
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
        const conversationId = state.currentConversationId;
        const entry = getRoundCountEntry(conversationId);
        if (!entry?.completed || !Number.isFinite(entry.totalRounds)) {
            return false;
        }
        state.totalRounds = entry.totalRounds;
        state.keptRounds = config.enabled ? Math.min(config.keepRounds, entry.totalRounds) : entry.totalRounds;
        state.roundCountStatus = 'complete';
        renderUiState();
        armDomIncrementBaseline();
        return true;
    }

    function loadConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return { ...DEFAULT_CONFIG };
            }
            const parsed = JSON.parse(raw);
            return {
                enabled: parsed?.enabled !== false,
                keepRounds: clampRounds(parsed?.keepRounds ?? DEFAULT_CONFIG.keepRounds),
            };
        } catch {
            return { ...DEFAULT_CONFIG };
        }
    }

    function saveConfig(next) {
        const normalized = {
            enabled: next.enabled !== false,
            keepRounds: clampRounds(next.keepRounds),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    let config = loadConfig();

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
        if (method !== 'GET') {
            return false;
        }
        return /^\/backend-api\/(conversation|conversations|shared_conversation)\/[^/]+\/?$/.test(url.pathname);
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

    function collectVisibleSegments(mapping, path) {
        const segments = [];
        let lastRole = null;

        for (let index = 0; index < path.length; index += 1) {
            const nodeId = path[index];
            const node = mapping[nodeId];
            if (!isVisibleMessage(node)) {
                continue;
            }

            const role = node.message.author.role;
            if (role !== lastRole) {
                segments.push({ role, startIndex: index });
                lastRole = role;
            }
        }

        return segments;
    }

    function analyzeConversation(data) {
        const mapping = data?.mapping;
        const currentNode = data?.current_node;
        const path = buildActivePath(mapping, currentNode);
        if (!mapping || !path) {
            return null;
        }

        const segments = collectVisibleSegments(mapping, path);
        const userSegments = segments.filter((segment) => segment.role === 'user');

        return {
            mapping,
            currentNode,
            path,
            segments,
            userSegments,
            totalRounds: userSegments.length,
        };
    }

    function trimConversation(data, keepRounds) {
        const analysis = analyzeConversation(data);
        if (!analysis) {
            return null;
        }

        const { mapping, path, userSegments, totalRounds } = analysis;
        const effectiveLimit = clampRounds(keepRounds);

        if (totalRounds <= effectiveLimit) {
            return {
                changed: false,
                data,
                totalRounds,
                keptRounds: totalRounds,
            };
        }

        const firstKeptUserSegment = userSegments[totalRounds - effectiveLimit];
        if (!firstKeptUserSegment) {
            return null;
        }

        const keptPath = path.slice(firstKeptUserSegment.startIndex);
        if (keptPath.length === 0) {
            return null;
        }

        const rootId = path[0];
        const rootNode = rootId ? mapping[rootId] : null;
        const keepOriginalRoot = Boolean(rootId && rootNode && !isVisibleMessage(rootNode));
        const newMapping = {};

        if (keepOriginalRoot) {
            newMapping[rootId] = {
                ...rootNode,
                parent: null,
                children: keptPath[0] ? [keptPath[0]] : [],
            };
        }

        for (let index = 0; index < keptPath.length; index += 1) {
            const id = keptPath[index];
            const originalNode = mapping[id];
            if (!originalNode) {
                continue;
            }

            const previousId = index === 0
                ? (keepOriginalRoot ? rootId : null)
                : keptPath[index - 1];
            const nextId = keptPath[index + 1] ?? null;

            newMapping[id] = {
                ...originalNode,
                parent: previousId ?? null,
                children: nextId ? [nextId] : [],
            };
        }

        const newCurrentNode = keptPath[keptPath.length - 1];
        const newRoot = keepOriginalRoot ? rootId : keptPath[0];
        if (!newCurrentNode || !newRoot) {
            return null;
        }

        return {
            changed: true,
            totalRounds,
            keptRounds: effectiveLimit,
            data: {
                ...data,
                mapping: newMapping,
                current_node: newCurrentNode,
                root: newRoot,
            },
        };
    }

    function createModifiedResponse(originalResponse, modifiedData) {
        const headers = new PageHeaders(originalResponse.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        headers.set('content-type', 'application/json; charset=utf-8');

        const response = new PageResponse(JSON.stringify(modifiedData), {
            status: originalResponse.status,
            statusText: originalResponse.statusText,
            headers,
        });

        try {
            if (originalResponse.url) {
                Object.defineProperty(response, 'url', { value: originalResponse.url });
            }
            if (originalResponse.type) {
                Object.defineProperty(response, 'type', { value: originalResponse.type });
            }
        } catch {
            // 部分浏览器不允许重定义这些只读属性；不影响响应正文。
        }

        return response;
    }

    function cacheCurrentConversationStats() {
        if (!state.currentConversationId || state.totalRounds === null) {
            return;
        }
        conversationStatsCache.delete(state.currentConversationId);
        conversationStatsCache.set(state.currentConversationId, state.totalRounds);
        while (conversationStatsCache.size > MAX_STATS_CACHE_ENTRIES) {
            const oldestId = conversationStatsCache.keys().next().value;
            if (!oldestId) {
                break;
            }
            conversationStatsCache.delete(oldestId);
        }
        saveConversationStatsCache();
    }

    function restoreCachedConversationStats() {
        const conversationId = state.currentConversationId;
        const cachedTotal = conversationId ? conversationStatsCache.get(conversationId) : null;
        if (!Number.isFinite(cachedTotal)) {
            return false;
        }

        state.totalRounds = Math.max(0, cachedTotal);
        state.keptRounds = config.enabled
            ? Math.min(config.keepRounds, state.totalRounds)
            : state.totalRounds;
        renderUiState();
        armDomIncrementBaseline();
        return true;
    }

    function setConversationStats(totalRounds, keptRounds) {
        state.totalRounds = Number.isFinite(totalRounds) ? Math.max(0, totalRounds) : null;
        state.keptRounds = Number.isFinite(keptRounds) ? Math.max(0, keptRounds) : null;
        cacheCurrentConversationStats();
        renderUiState();
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
                currentId &&
                state.currentConversationId === currentId &&
                requestInfo.id === currentId
            );
        }

        // Shared conversation pages do not use /c/<id>; there is no normal-chat ID to compare.
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

    function analyzePagedConversation(data, requestUrl) {
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const userMessageIds = getUniqueUserMessageIds(messages);
        const pageInfo = data?.page_info;
        const continuation = data?.context_truncation_continuation;
        const hasEarlierHistory = getHasEarlierHistory(pageInfo, continuation);
        const startCursor = typeof pageInfo?.start_cursor === 'string' && pageInfo.start_cursor
            ? pageInfo.start_cursor
            : null;
        const requestedRounds = clampRounds(requestUrl.searchParams.get('num_turns') ?? config.keepRounds);
        return {
            loadedRounds: userMessageIds.length,
            requestedRounds,
            hasEarlierHistory,
            startCursor,
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
            state.keptRounds = config.enabled ? Math.min(config.keepRounds, entry.totalRounds) : entry.totalRounds;
            state.roundCountStatus = 'complete';
            armDomIncrementBaseline();
        } else {
            state.totalRounds = null;
            state.keptRounds = config.enabled ? paged.requestedRounds : null;
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
            const anchorIndex = entry.latestUserMessageId
                ? currentIds.indexOf(entry.latestUserMessageId)
                : -1;
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
            state.keptRounds = config.enabled ? Math.min(config.keepRounds, totalRounds) : totalRounds;
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
        if (!config.enabled || !nativePageFetch || document.hidden) {
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
        const conversationId = state.currentConversationId;
        if (!conversationId || messageIds.length === 0) {
            return;
        }
        const entry = getRoundCountEntry(conversationId);
        if (!entry) {
            return;
        }
        if (entry.completed && Number.isFinite(entry.totalRounds)) {
            entry.totalRounds += messageIds.length;
            entry.countedRounds = entry.totalRounds;
            entry.latestUserMessageId = messageIds.at(-1) ?? entry.latestUserMessageId;
            setRoundCountEntry(conversationId, entry);
            return;
        }
        const seen = new Set(entry.seenUserMessageIds);
        for (const id of messageIds) {
            seen.add(id);
        }
        entry.seenUserMessageIds = [...seen];
        entry.countedRounds = seen.size;
        entry.latestUserMessageId = messageIds.at(-1) ?? entry.latestUserMessageId;
        setRoundCountEntry(conversationId, entry);
    }

    async function handleConversationResponse(response, requestInfo, requestUrl) {
        if (!isJsonResponse(response)) {
            return response;
        }

        try {
            const json = await response.clone().json();

            if (requestInfo?.kind === 'conversations') {
                const paged = analyzePagedConversation(json, requestUrl);
                const entry = prepareRoundCountFromInitialPage(requestInfo.id, paged);
                if (config.enabled && entry && !entry.completed && entry.nextBeforeCursor) {
                    scheduleBackgroundRoundCount(true);
                }
                return response;
            }

            const analysis = analyzeConversation(json);
            if (!analysis) {
                return response;
            }

            if (!config.enabled) {
                setConversationStats(analysis.totalRounds, analysis.totalRounds);
                armDomIncrementBaseline();
                return response;
            }

            const trimmed = trimConversation(json, config.keepRounds);
            if (!trimmed) {
                return response;
            }

            setConversationStats(trimmed.totalRounds, trimmed.keptRounds);
            armDomIncrementBaseline();

            if (!trimmed.changed) {
                return response;
            }

            return createModifiedResponse(response, trimmed.data);
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

    function rewritePagedConversationFetchArgs(args, meta, requestInfo) {
        if (!config.enabled || requestInfo?.kind !== 'conversations') {
            return { args, url: meta.url };
        }

        const nextUrl = new PageURL(meta.url.href);
        nextUrl.searchParams.set('num_turns', String(config.keepRounds));
        if (nextUrl.href === meta.url.href) {
            return { args, url: meta.url };
        }

        const [input, init] = args;
        if (input instanceof PageRequest) {
            const rewritten = new PageRequest(nextUrl.href, {
                method: input.method,
                headers: input.headers,
                mode: input.mode,
                credentials: input.credentials,
                cache: input.cache,
                redirect: input.redirect,
                referrer: input.referrer,
                referrerPolicy: input.referrerPolicy,
                integrity: input.integrity,
                keepalive: input.keepalive,
                signal: input.signal,
            });
            return { args: init === undefined ? [rewritten] : [rewritten, init], url: nextUrl };
        }
        if (input instanceof PageURL) {
            return { args: [nextUrl, ...args.slice(1)], url: nextUrl };
        }
        return { args: [nextUrl.href, ...args.slice(1)], url: nextUrl };
    }

    function patchFetch() {
        if (PAGE_WINDOW[PATCH_FLAG]) {
            return;
        }

        const nativeFetch = PAGE_WINDOW.fetch.bind(PAGE_WINDOW);
        nativePageFetch = nativeFetch;
        const wrappedFetch = async (...args) => {
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
                    currentId &&
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

            const rewritten = rewritePagedConversationFetchArgs(args, meta, requestInfo);
            if (requestInfo?.kind === 'conversations') {
                captureRoundCountRequestTemplate(rewritten.args, requestInfo.id);
            }
            const response = await nativeFetch(...rewritten.args);
            return handleConversationResponse(response, requestInfo, rewritten.url);
        };

        PAGE_WINDOW.fetch = wrappedFetch;
        PAGE_WINDOW[PATCH_FLAG] = true;
    }

    function getStatusText() {
        const total = state.totalRounds;
        if (!config.enabled) {
            return total === null ? 'LS Off' : `LS Off / ${total}`;
        }
        if (total !== null) {
            const kept = state.keptRounds ?? Math.min(config.keepRounds, total);
            return `LS ${kept} / ${total}`;
        }
        if (state.roundCountStatus === 'counting') {
            return `LS ${config.keepRounds} / …`;
        }
        if (state.loadedRounds !== null && state.hasEarlierHistory === true) {
            return `LS ${config.keepRounds} / +`;
        }
        return `LS ${config.keepRounds}`;
    }

    function getCurrentLineText() {
        const total = state.totalRounds;
        if (!config.enabled) {
            return total === null
                ? '当前  Off（不覆盖 ChatGPT 原生历史窗口）'
                : `当前  Off / 已知总计 ${total} 轮`;
        }
        if (total !== null) {
            const kept = state.keptRounds ?? Math.min(config.keepRounds, total);
            return `当前  ${kept} / ${total} 轮`;
        }
        if (state.roundCountStatus === 'counting') {
            return `当前  最近 ${config.keepRounds} 轮 / 后台统计总轮数中…`;
        }
        if (state.roundCountStatus === 'paused') {
            return `当前  最近 ${config.keepRounds} 轮 / 总轮数统计已暂停`;
        }
        if (state.loadedRounds !== null && state.hasEarlierHistory === true) {
            return `当前  最近 ${config.keepRounds} 轮 / 仍有更早历史`;
        }
        return `当前  最近 ${config.keepRounds} 轮`;
    }

    function renderUiState() {
        if (!state.uiReady || !statusButton) {
            return;
        }

        statusButton.textContent = getStatusText();
        statusButton.dataset.enabled = config.enabled ? 'true' : 'false';
        statusButton.title = config.enabled
            ? `已启用：请求最近 ${config.keepRounds} 轮`
            : '已关闭覆盖；使用 ChatGPT 原生历史窗口';

        if (currentStatusLine) {
            currentStatusLine.textContent = getCurrentLineText();
        }
        if (enabledSwitch) {
            enabledSwitch.checked = config.enabled;
        }
        if (limitValue && draftLimit !== null && document.activeElement !== limitValue) {
            limitValue.value = String(draftLimit);
        }
        updateApplyButton();
    }

    function updateApplyButton() {
        if (!applyButton) {
            return;
        }
        applyButton.disabled = draftLimit === null || draftLimit === config.keepRounds;
    }

    function setDraftLimit(value) {
        draftLimit = clampRounds(value);
        if (limitValue) {
            limitValue.value = String(draftLimit);
        }
        updateApplyButton();
    }

    function handleLimitInput() {
        if (!limitValue) {
            return;
        }
        const raw = limitValue.value.trim();
        if (!raw) {
            draftLimit = null;
            updateApplyButton();
            return;
        }
        const parsed = Number.parseInt(raw, 10);
        draftLimit = Number.isFinite(parsed) ? clampRounds(parsed) : null;
        updateApplyButton();
    }

    function normalizeLimitInput() {
        if (!limitValue) {
            return;
        }
        if (draftLimit === null) {
            setDraftLimit(config.keepRounds);
            return;
        }
        setDraftLimit(draftLimit);
    }

    function reloadWithConfig(nextConfig) {
        config = saveConfig(nextConfig);
        location.reload();
    }

    function installStyles() {
        if (document.getElementById('cyan-ls-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'cyan-ls-style';
        style.textContent = `
#cyan-ls-root {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 2147483000;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #111827;
}
#cyan-ls-status {
    appearance: none;
    border: 0;
    border-radius: 6px;
    padding: 6px 8px;
    white-space: nowrap;
    background: #10a37f;
    color: #fff;
    font-size: 12px;
    font-weight: 650;
    line-height: 1;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .18);
    cursor: pointer;
    transition: background-color .15s ease, opacity .15s ease;
}
#cyan-ls-status[data-enabled="false"] {
    background: #6b7280;
}
#cyan-ls-status:hover {
    opacity: .92;
}
#cyan-ls-panel {
    position: absolute;
    right: 0;
    bottom: 38px;
    width: 236px;
    padding: 14px;
    border: 1px solid rgba(0, 0, 0, .12);
    border-radius: 14px;
    background: rgba(255, 255, 255, .98);
    box-shadow: 0 12px 32px rgba(0, 0, 0, .20);
    display: none;
}
#cyan-ls-panel[data-open="true"] {
    display: block;
}
.cyan-ls-title {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 700;
}
.cyan-ls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 9px 0;
    font-size: 12px;
}
.cyan-ls-current {
    margin: 2px 0 10px;
    font-size: 12px;
    color: #4b5563;
}
.cyan-ls-switch {
    position: relative;
    display: inline-flex;
    width: 38px;
    height: 22px;
    flex: 0 0 auto;
}
.cyan-ls-switch input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}
.cyan-ls-slider {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: #9ca3af;
    cursor: pointer;
    transition: background-color .15s ease;
}
.cyan-ls-slider::before {
    content: "";
    position: absolute;
    width: 16px;
    height: 16px;
    left: 3px;
    top: 3px;
    border-radius: 50%;
    background: #fff;
    transition: transform .15s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .25);
}
.cyan-ls-switch input:checked + .cyan-ls-slider {
    background: #10a37f;
}
.cyan-ls-switch input:checked + .cyan-ls-slider::before {
    transform: translateX(16px);
}
.cyan-ls-counter {
    display: grid;
    grid-template-columns: 30px 1fr 30px;
    gap: 6px;
    align-items: center;
    margin: 7px 0 9px;
}
.cyan-ls-counter button,
#cyan-ls-limit-value,
#cyan-ls-apply {
    border: 1px solid rgba(0, 0, 0, .14);
    border-radius: 8px;
    background: #f9fafb;
    color: #111827;
    font: inherit;
    cursor: pointer;
}
.cyan-ls-counter button {
    height: 30px;
    font-size: 16px;
}
#cyan-ls-limit-value {
    width: 100%;
    height: 30px;
    box-sizing: border-box;
    padding: 0 6px;
    text-align: center;
    font-size: 13px;
    font-weight: 700;
    appearance: textfield;
    cursor: text;
}
#cyan-ls-limit-value::-webkit-inner-spin-button,
#cyan-ls-limit-value::-webkit-outer-spin-button {
    margin: 0;
    appearance: none;
}
#cyan-ls-apply {
    width: 100%;
    padding: 7px 9px;
    font-size: 12px;
    font-weight: 650;
    background: #10a37f;
    color: #fff;
    border-color: transparent;
}
#cyan-ls-apply:disabled {
    background: #d1d5db;
    color: #6b7280;
    cursor: default;
}
.cyan-ls-note {
    margin: 8px 0 0;
    color: #6b7280;
    font-size: 10px;
    line-height: 1.35;
}
@media (prefers-color-scheme: dark) {
    #cyan-ls-panel {
        color: #f3f4f6;
        background: rgba(32, 33, 35, .98);
        border-color: rgba(255, 255, 255, .14);
    }
    .cyan-ls-current,
    .cyan-ls-note {
        color: #9ca3af;
    }
    .cyan-ls-counter button,
    #cyan-ls-limit-value {
        color: #f3f4f6;
        background: #343541;
        border-color: rgba(255, 255, 255, .14);
    }
}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    function installUi() {
        if (!document.body || document.getElementById('cyan-ls-root')) {
            return;
        }

        installStyles();
        draftLimit = config.keepRounds;

        const root = document.createElement('div');
        root.id = 'cyan-ls-root';

        panel = document.createElement('div');
        panel.id = 'cyan-ls-panel';
        panel.dataset.open = 'false';

        const title = document.createElement('div');
        title.className = 'cyan-ls-title';
        title.textContent = 'Light Session 长对话优化';

        currentStatusLine = document.createElement('div');
        currentStatusLine.className = 'cyan-ls-current';

        const switchRow = document.createElement('div');
        switchRow.className = 'cyan-ls-row';
        const switchLabelText = document.createElement('span');
        switchLabelText.textContent = '启用裁剪';
        const switchLabel = document.createElement('label');
        switchLabel.className = 'cyan-ls-switch';
        enabledSwitch = document.createElement('input');
        enabledSwitch.type = 'checkbox';
        enabledSwitch.checked = config.enabled;
        enabledSwitch.setAttribute('aria-label', '启用裁剪');
        const switchSlider = document.createElement('span');
        switchSlider.className = 'cyan-ls-slider';
        switchLabel.append(enabledSwitch, switchSlider);
        switchRow.append(switchLabelText, switchLabel);

        const keepLabel = document.createElement('div');
        keepLabel.className = 'cyan-ls-row';
        keepLabel.innerHTML = '<span>保留轮数</span>';

        const counter = document.createElement('div');
        counter.className = 'cyan-ls-counter';
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.textContent = '−';
        minus.setAttribute('aria-label', '减少保留轮数');
        limitValue = document.createElement('input');
        limitValue.id = 'cyan-ls-limit-value';
        limitValue.type = 'number';
        limitValue.min = String(MIN_ROUNDS);
        limitValue.max = String(MAX_ROUNDS);
        limitValue.step = '1';
        limitValue.inputMode = 'numeric';
        limitValue.setAttribute('aria-label', '保留轮数');
        limitValue.value = String(draftLimit);
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.textContent = '+';
        plus.setAttribute('aria-label', '增加保留轮数');
        counter.append(minus, limitValue, plus);

        applyButton = document.createElement('button');
        applyButton.id = 'cyan-ls-apply';
        applyButton.type = 'button';
        applyButton.textContent = '应用并刷新';

        const note = document.createElement('div');
        note.className = 'cyan-ls-note';
        note.textContent = '启用时覆盖 num_turns，并低速后台统计总轮数；统计进度保存在 Tampermonkey 中。';

        panel.append(title, currentStatusLine, switchRow, keepLabel, counter, applyButton, note);

        statusButton = document.createElement('button');
        statusButton.id = 'cyan-ls-status';
        statusButton.type = 'button';
        statusButton.setAttribute('aria-label', '打开长对话优化设置');

        statusButton.addEventListener('click', (event) => {
            event.stopPropagation();
            panel.dataset.open = panel.dataset.open === 'true' ? 'false' : 'true';
        });

        panel.addEventListener('click', (event) => event.stopPropagation());
        if (!documentClickInstalled) {
            document.addEventListener('click', () => {
                if (panel) {
                    panel.dataset.open = 'false';
                }
            });
            documentClickInstalled = true;
        }

        minus.addEventListener('click', () => setDraftLimit((draftLimit ?? config.keepRounds) - 1));
        plus.addEventListener('click', () => setDraftLimit((draftLimit ?? config.keepRounds) + 1));
        limitValue.addEventListener('input', handleLimitInput);
        limitValue.addEventListener('blur', normalizeLimitInput);
        limitValue.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                normalizeLimitInput();
                applyButton?.click();
            }
        });

        enabledSwitch.addEventListener('change', () => {
            reloadWithConfig({
                enabled: enabledSwitch.checked,
                keepRounds: draftLimit ?? config.keepRounds,
            });
        });

        applyButton.addEventListener('click', () => {
            if (draftLimit === null || draftLimit === config.keepRounds) {
                return;
            }
            reloadWithConfig({
                enabled: config.enabled,
                keepRounds: draftLimit,
            });
        });

        root.append(panel, statusButton);
        document.body.appendChild(root);
        state.uiReady = true;
        renderUiState();
    }

    function ensureUi() {
        installStyles();
        if (!document.body) {
            return;
        }
        if (!document.getElementById('cyan-ls-root')) {
            state.uiReady = false;
            installUi();
        }
    }

    function seedVisibleUserMessageIds() {
        if (!document.querySelectorAll) {
            return;
        }
        const nodes = document.querySelectorAll('[data-message-author-role="user"][data-message-id]');
        for (const node of nodes) {
            const id = node.getAttribute('data-message-id');
            if (id) {
                state.seenUserMessageIds.add(id);
            }
        }
    }

    function processAddedNodeForUserMessages(node) {
        if (!(node instanceof Element)) {
            return;
        }

        const candidates = [];
        if (node.matches('[data-message-author-role="user"][data-message-id]')) {
            candidates.push(node);
        }
        for (const child of node.querySelectorAll('[data-message-author-role="user"][data-message-id]')) {
            candidates.push(child);
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

        if (addedIds.length === 0 || !state.domIncrementReady) {
            return;
        }

        recordLiveUserMessagesInPersistentCache(addedIds);
        if (state.totalRounds === null) {
            return;
        }

        const previousTotal = state.totalRounds;
        state.totalRounds = previousTotal + addedIds.length;
        if (config.enabled) {
            state.keptRounds = Math.min(config.keepRounds, state.totalRounds);
        } else {
            state.keptRounds = state.totalRounds;
        }
        cacheCurrentConversationStats();
        renderUiState();
    }

    function installLocalMessageObserver() {
        seedVisibleUserMessageIds();
        const observer = new MutationObserver((mutations) => {
            ensureUi();
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
        cancelBackgroundRoundCount(true);
        state.totalRounds = null;
        state.keptRounds = null;
        state.loadedRounds = null;
        state.hasEarlierHistory = null;
        state.roundCountRequestTemplate = null;
        state.currentConversationId = extractConversationPageId();
        state.seenUserMessageIds.clear();
        state.domIncrementReady = false;
        state.domBaselineToken += 1;

        if (!restorePersistentRoundCountStats() && !restoreCachedConversationStats()) {
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
        ensureUi();
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

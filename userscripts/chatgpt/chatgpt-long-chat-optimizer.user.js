// ==UserScript==
// @name         ChatGPT 长对话优化助手
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-long-chat-optimizer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-long-chat-optimizer.user.js
// @version      0.1.5
// @description  在 ChatGPT 渲染长对话前裁剪历史，仅保留最近 N 轮，并通过轻量悬浮按钮显示“保留 / 总轮数”。
// @author       Ember-Dawn
// @match        *://chat.openai.com/
// @match        *://chat.openai.com/*
// @match        *://chatgpt.com/
// @match        *://chatgpt.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
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

    const STORAGE_KEY = 'cyan_chatgpt_long_chat_optimizer';
    const SESSION_STATS_KEY = 'cyan_chatgpt_long_chat_optimizer_stats';
    const PATCH_FLAG = '__CYAN_LS_FETCH_PATCHED__';
    const HISTORY_PATCH_FLAG = '__CYAN_LS_HISTORY_PATCHED__';
    const DEFAULT_CONFIG = Object.freeze({ enabled: true, keepRounds: 10 });
    const MIN_ROUNDS = 1;
    const MAX_ROUNDS = 100;
    const MAX_STATS_CACHE_ENTRIES = 100;
    const HIDDEN_ROLES = new Set(['system', 'tool', 'thinking']);
    const conversationStatsCache = loadConversationStatsCache();

    const state = {
        totalRounds: null,
        keptRounds: null,
        currentConversationId: extractConversationPageId(),
        uiReady: false,
        seenUserMessageIds: new Set(),
        domIncrementReady: false,
        domBaselineToken: 0,
    };

    let statusButton = null;
    let panel = null;
    let currentStatusLine = null;
    let limitValue = null;
    let applyButton = null;
    let enabledSwitch = null;
    let draftLimit = null;
    let documentClickInstalled = false;

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

        if (input instanceof Request) {
            urlString = input.url;
            method = (init?.method ?? input.method ?? 'GET').toUpperCase();
        } else if (input instanceof URL) {
            urlString = input.href;
            method = (init?.method ?? 'GET').toUpperCase();
        } else {
            urlString = String(input);
            method = (init?.method ?? 'GET').toUpperCase();
        }

        return {
            url: new URL(urlString, location.href),
            method,
        };
    }

    function isConversationGet(method, url) {
        if (method !== 'GET') {
            return false;
        }
        return /^\/backend-api\/(conversation|shared_conversation)\/[^/]+\/?$/.test(url.pathname);
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
        const headers = new Headers(originalResponse.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        headers.set('content-type', 'application/json; charset=utf-8');

        const response = new Response(JSON.stringify(modifiedData), {
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
        const match = url.pathname.match(/^\/backend-api\/(conversation|shared_conversation)\/([^/]+)\/?$/);
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

        if (requestInfo.kind === 'conversation') {
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

    async function handleConversationResponse(response) {
        if (!isJsonResponse(response)) {
            return response;
        }

        try {
            const json = await response.clone().json();
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
        } catch {
            return response;
        }
    }

    function patchFetch() {
        if (window[PATCH_FLAG]) {
            return;
        }

        const nativeFetch = window.fetch.bind(window);
        const wrappedFetch = async (...args) => {
            let meta;
            try {
                meta = getRequestMeta(args[0], args[1]);
            } catch {
                return nativeFetch(...args);
            }

            const response = await nativeFetch(...args);
            if (!isConversationGet(meta.method, meta.url)) {
                return response;
            }

            const requestInfo = getConversationRequestInfo(meta.url);
            if (!isRequestForCurrentPage(requestInfo)) {
                return response;
            }
            return handleConversationResponse(response);
        };

        window.fetch = wrappedFetch;
        window[PATCH_FLAG] = true;
    }

    function getStatusText() {
        const total = state.totalRounds;
        if (!config.enabled) {
            return `LS Off / ${total ?? '--'}`;
        }

        if (total === null) {
            return `LS ${config.keepRounds} / --`;
        }

        const kept = state.keptRounds ?? Math.min(config.keepRounds, total);
        return `LS ${kept} / ${total}`;
    }

    function getCurrentLineText() {
        const total = state.totalRounds;
        if (!config.enabled) {
            return `当前  Off / ${total ?? '--'} 轮`;
        }
        const kept = total === null
            ? config.keepRounds
            : (state.keptRounds ?? Math.min(config.keepRounds, total));
        return `当前  ${kept} / ${total ?? '--'} 轮`;
    }

    function renderUiState() {
        if (!state.uiReady || !statusButton) {
            return;
        }

        statusButton.textContent = getStatusText();
        statusButton.dataset.enabled = config.enabled ? 'true' : 'false';
        statusButton.title = config.enabled
            ? `已启用：保留最近 ${config.keepRounds} 轮`
            : '已关闭裁剪；点击可重新启用';

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
        note.textContent = '开关会立即刷新；保留轮数仅在“应用并刷新”后生效。';

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

        let added = 0;
        for (const element of candidates) {
            const id = element.getAttribute('data-message-id');
            if (!id || state.seenUserMessageIds.has(id)) {
                continue;
            }
            state.seenUserMessageIds.add(id);
            added += 1;
        }

        if (added === 0 || !state.domIncrementReady || state.totalRounds === null) {
            return;
        }

        const previousTotal = state.totalRounds;
        state.totalRounds = previousTotal + added;
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
        state.totalRounds = null;
        state.keptRounds = null;
        state.currentConversationId = extractConversationPageId();
        state.seenUserMessageIds.clear();
        state.domIncrementReady = false;
        state.domBaselineToken += 1;

        if (!restoreCachedConversationStats()) {
            renderUiState();
            queueMicrotask(seedVisibleUserMessageIds);
        }
    }

    function patchHistoryForSpaNavigation() {
        if (window[HISTORY_PATCH_FLAG]) {
            return;
        }
        window[HISTORY_PATCH_FLAG] = true;

        let lastHref = location.href;
        const checkNavigation = () => {
            if (location.href === lastHref) {
                return;
            }
            lastHref = location.href;
            handleNavigation();
        };

        const originalPushState = history.pushState.bind(history);
        const originalReplaceState = history.replaceState.bind(history);

        history.pushState = function (...args) {
            const result = originalPushState(...args);
            queueMicrotask(checkNavigation);
            return result;
        };

        history.replaceState = function (...args) {
            const result = originalReplaceState(...args);
            queueMicrotask(checkNavigation);
            return result;
        };

        window.addEventListener('popstate', () => queueMicrotask(checkNavigation));
    }

    function initializeDomFeatures() {
        ensureUi();
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

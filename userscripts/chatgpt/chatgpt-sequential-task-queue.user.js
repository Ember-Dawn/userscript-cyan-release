// ==UserScript==
// @name         ChatGPT 顺序任务助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js
// @downloadURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js
// @version      1.5.0
// @description  在 ChatGPT 中按会话保存并顺序执行任务队列；支持多行 Prompt、后台标签页推进及独立会话状态。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function(){'use strict';const registry={"types":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

},
"constants":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODE_LABELS = exports.STATUS_LABELS = exports.LAUNCHER_INTEGRITY_INTERVAL_MS = exports.INITIAL_BINDING_MAX_AGE_MS = exports.LOCK_HEARTBEAT_MS = exports.LOCK_STALE_MS = exports.DEFAULT_BETWEEN_TASK_DELAY_MS = exports.IDLE_STABLE_MS = exports.START_GRACE_MS = exports.EDITOR_WRITE_POLL_MS = exports.EDITOR_WRITE_TIMEOUT_MS = exports.SEND_BUTTON_TIMEOUT_MS = exports.START_TIMEOUT_MS = exports.MONITOR_INTERVAL_MS = exports.SUBMIT_BUTTON_SELECTOR = exports.STOP_BUTTON_SELECTOR = exports.EDITOR_SELECTOR = exports.COMPOSER_SELECTOR = exports.STYLE_ID = exports.LAUNCHER_ID = exports.PANEL_ID = exports.TAB_ID_KEY = exports.TEMP_INITIAL_BINDING_KEY = exports.TEMP_LOCK_KEY = exports.LOCK_KEY_PREFIX = exports.TEMP_STATE_KEY = exports.STATE_KEY_PREFIX = exports.LEGACY_STORAGE_KEY = exports.PREFIX = exports.VERSION = void 0;
exports.VERSION = '1.5.0';
exports.PREFIX = 'cg-stq';
exports.LEGACY_STORAGE_KEY = 'cyan.chatgptSequentialTaskQueue.v1';
exports.STATE_KEY_PREFIX = 'cyan.chatgptSequentialTaskQueue.state.v2.';
exports.TEMP_STATE_KEY = 'cyan.chatgptSequentialTaskQueue.temporaryState.v2';
exports.LOCK_KEY_PREFIX = 'cyan.chatgptSequentialTaskQueue.lock.v2.';
exports.TEMP_LOCK_KEY = 'cyan.chatgptSequentialTaskQueue.temporaryLock.v2';
exports.TEMP_INITIAL_BINDING_KEY = 'cyan.chatgptSequentialTaskQueue.initialBinding.v1';
exports.TAB_ID_KEY = 'cyan.chatgptSequentialTaskQueue.tabId.v1';
exports.PANEL_ID = `${exports.PREFIX}-panel`;
exports.LAUNCHER_ID = `${exports.PREFIX}-launcher-root`;
exports.STYLE_ID = `${exports.PREFIX}-style`;
exports.COMPOSER_SELECTOR = 'form[data-chatgpt-composer]';
exports.EDITOR_SELECTOR = '[data-composer-markdown][contenteditable="true"][role="textbox"]';
exports.STOP_BUTTON_SELECTOR = [
    'button[aria-label="停止"]',
    'button[data-testid="stop-button"]',
    'button[aria-label="停止回答"]',
    'button[aria-label="Stop generating"]',
].join(', ');
exports.SUBMIT_BUTTON_SELECTOR = [
    'button[type="submit"][aria-label="发送"]',
    'button#composer-submit-button:not([data-testid="stop-button"])',
].join(', ');
exports.MONITOR_INTERVAL_MS = 400;
exports.START_TIMEOUT_MS = 30000;
exports.SEND_BUTTON_TIMEOUT_MS = 8000;
exports.EDITOR_WRITE_TIMEOUT_MS = 5000;
exports.EDITOR_WRITE_POLL_MS = 50;
exports.START_GRACE_MS = 8000;
exports.IDLE_STABLE_MS = 3000;
exports.DEFAULT_BETWEEN_TASK_DELAY_MS = 3000;
exports.LOCK_STALE_MS = 15000;
exports.LOCK_HEARTBEAT_MS = 5000;
exports.INITIAL_BINDING_MAX_AGE_MS = 120000;
exports.LAUNCHER_INTEGRITY_INTERVAL_MS = 1000;
exports.STATUS_LABELS = {
    pending: '待执行',
    sending: '正在发送',
    submitted: '已发送，等待开始',
    running: '正在运行',
    completed: '已完成',
    uncertain: '状态待确认',
    failed: '失败',
    skipped: '已跳过',
};
exports.MODE_LABELS = {
    idle: '未开始',
    running: '运行中',
    pausing: '等待暂停',
    paused: '已暂停',
    completed: '已完成',
    error: '状态异常',
};

},
"parser":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
exports.clampInteger = clampInteger;
exports.truncate = truncate;
exports.parseTasks = parseTasks;
exports.getTaskSourceText = getTaskSourceText;
function normalizeText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function clampInteger(value, min, max, fallback = min) {
    const number = Number.parseInt(String(value), 10);
    if (!Number.isFinite(number))
        return fallback;
    return Math.min(max, Math.max(min, number));
}
function truncate(text, maxLength = 90) {
    const clean = normalizeText(text);
    return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
}
function parseTasks(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    const hasBlockSeparator = source
        .split('\n')
        .some((line) => line.trim() === '---');
    if (hasBlockSeparator) {
        return source
            .split(/^[\t ]*---[\t ]*$/m)
            .map((block) => block.trim())
            .filter(Boolean);
    }
    return source
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}
function getTaskSourceText(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    const tasks = parseTasks(source);
    const hasBlockSeparator = source
        .split('\n')
        .some((line) => line.trim() === '---');
    return hasBlockSeparator
        ? tasks.join('\n\n---\n\n')
        : tasks.join('\n');
}

},
"storage":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateTabId = getOrCreateTabId;
exports.getConversationId = getConversationId;
exports.getStateStorage = getStateStorage;
exports.getStateStorageKey = getStateStorageKey;
exports.getLockStorage = getLockStorage;
exports.getLockStorageKey = getLockStorageKey;
exports.isLocalConversationId = isLocalConversationId;
exports.createDefaultState = createDefaultState;
exports.sanitizeTask = sanitizeTask;
exports.normalizeState = normalizeState;
exports.hasStateContent = hasStateContent;
exports.writeInitialBindingPending = writeInitialBindingPending;
exports.markInitialBindingPending = markInitialBindingPending;
exports.clearInitialBindingPending = clearInitialBindingPending;
exports.readFreshInitialBindingPending = readFreshInitialBindingPending;
exports.rememberInitialBindingIntermediate = rememberInitialBindingIntermediate;
exports.normalizeInitialBindingRestoreState = normalizeInitialBindingRestoreState;
exports.removeConversationStateAndLock = removeConversationStateAndLock;
exports.tryLoadLegacyState = tryLoadLegacyState;
exports.loadStateForContext = loadStateForContext;
exports.writeStateForContext = writeStateForContext;
exports.loadInitialStateForContext = loadInitialStateForContext;
const constants_1 = require("./constants");
const parser_1 = require("./parser");
function getOrCreateTabId() {
    try {
        const existing = sessionStorage.getItem(constants_1.TAB_ID_KEY);
        if (existing)
            return existing;
        const generated = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(constants_1.TAB_ID_KEY, generated);
        return generated;
    }
    catch (_) {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
}
function getConversationId() {
    const match = location.pathname.match(/(?:^|\/)c\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
}
function getStateStorage(conversationId) {
    return conversationId ? localStorage : sessionStorage;
}
function getStateStorageKey(conversationId) {
    return conversationId
        ? `${constants_1.STATE_KEY_PREFIX}${encodeURIComponent(conversationId)}`
        : constants_1.TEMP_STATE_KEY;
}
function getLockStorage(conversationId) {
    return conversationId ? localStorage : sessionStorage;
}
function getLockStorageKey(conversationId) {
    return conversationId
        ? `${constants_1.LOCK_KEY_PREFIX}${encodeURIComponent(conversationId)}`
        : constants_1.TEMP_LOCK_KEY;
}
function isLocalConversationId(conversationId) {
    return typeof conversationId === 'string' && conversationId.startsWith('local-chatgpt:');
}
function createDefaultState(conversationId = null) {
    return {
        version: 2,
        sourceText: '',
        draftText: '',
        tasks: [],
        nextIndex: 0,
        activeIndex: null,
        mode: 'idle',
        conversationId: conversationId || null,
        delayMs: constants_1.DEFAULT_BETWEEN_TASK_DELAY_MS,
        notice: '请粘贴任务；多行 Prompt 可用单独一行 --- 分隔。',
        createdAt: 0,
        updatedAt: Date.now(),
    };
}
function sanitizeTask(task, index) {
    const validStatus = (task?.status && Object.prototype.hasOwnProperty.call(constants_1.STATUS_LABELS, task.status))
        ? task.status
        : 'pending';
    return {
        id: Number.isInteger(task?.id) ? Number(task.id) : index + 1,
        text: typeof task?.text === 'string' ? task.text : '',
        status: validStatus === 'skipped' ? 'completed' : validStatus,
        hasSeenStop: Boolean(task?.hasSeenStop),
        inputClearedAfterSubmit: Boolean(task?.inputClearedAfterSubmit),
        submittedAt: Number(task?.submittedAt) || 0,
        completedAt: Number(task?.completedAt) || 0,
    };
}
function normalizeState(raw, conversationId = null) {
    const fallback = createDefaultState(conversationId);
    if (!raw || typeof raw !== 'object')
        return fallback;
    const tasks = Array.isArray(raw.tasks)
        ? raw.tasks.map(sanitizeTask).filter((task) => task.text.trim())
        : [];
    const sourceText = typeof raw.sourceText === 'string'
        ? raw.sourceText
        : tasks.map((task) => task.text).join('\n');
    const nextIndex = (0, parser_1.clampInteger)(raw.nextIndex, 0, tasks.length);
    const activeIndex = Number.isInteger(raw.activeIndex) && raw.activeIndex >= 0 && raw.activeIndex < tasks.length
        ? Number(raw.activeIndex)
        : null;
    const validMode = (raw.mode && Object.prototype.hasOwnProperty.call(constants_1.MODE_LABELS, raw.mode))
        ? raw.mode
        : 'paused';
    return {
        version: 2,
        sourceText,
        draftText: typeof raw.draftText === 'string' ? raw.draftText : sourceText,
        tasks,
        nextIndex,
        activeIndex,
        mode: validMode,
        conversationId: conversationId || null,
        delayMs: (0, parser_1.clampInteger)(raw.delayMs, 1000, 30000, constants_1.DEFAULT_BETWEEN_TASK_DELAY_MS),
        notice: typeof raw.notice === 'string' ? raw.notice : fallback.notice,
        createdAt: Number(raw.createdAt) || 0,
        updatedAt: Number(raw.updatedAt) || Date.now(),
    };
}
function hasStateContent(targetState) {
    return Boolean(targetState.tasks.length ||
        (0, parser_1.normalizeText)(targetState.draftText) ||
        (0, parser_1.normalizeText)(targetState.sourceText));
}
function writeInitialBindingPending(pending) {
    try {
        sessionStorage.setItem(constants_1.TEMP_INITIAL_BINDING_KEY, JSON.stringify(pending));
        return true;
    }
    catch (_) {
        return false;
    }
}
function markInitialBindingPending(currentConversationId, tabId) {
    if (currentConversationId !== null)
        return;
    writeInitialBindingPending({
        tabId,
        createdAt: Date.now(),
        intermediateConversationId: null,
    });
}
function clearInitialBindingPending() {
    try {
        sessionStorage.removeItem(constants_1.TEMP_INITIAL_BINDING_KEY);
    }
    catch (_) {
        // 忽略临时绑定标记清理失败
    }
}
function readFreshInitialBindingPending(tabId) {
    try {
        const pending = JSON.parse(sessionStorage.getItem(constants_1.TEMP_INITIAL_BINDING_KEY) || 'null');
        if (!pending || pending.tabId !== tabId)
            return null;
        if (Date.now() - Number(pending.createdAt || 0) >= constants_1.INITIAL_BINDING_MAX_AGE_MS)
            return null;
        return pending;
    }
    catch (_) {
        return null;
    }
}
function rememberInitialBindingIntermediate(conversationId, tabId) {
    if (!isLocalConversationId(conversationId))
        return;
    const pending = readFreshInitialBindingPending(tabId);
    if (!pending)
        return;
    writeInitialBindingPending({
        ...pending,
        intermediateConversationId: conversationId,
    });
}
function normalizeInitialBindingRestoreState(rawState, conversationId, pending) {
    const restored = normalizeState(rawState, conversationId);
    const activeTask = restored.activeIndex !== null
        ? restored.tasks[restored.activeIndex]
        : null;
    if (activeTask?.status === 'sending' && !activeTask.submittedAt) {
        activeTask.status = 'submitted';
        activeTask.submittedAt = Number(pending?.createdAt || Date.now());
    }
    return restored;
}
function removeConversationStateAndLock(conversationId) {
    if (!conversationId)
        return;
    try {
        localStorage.removeItem(getStateStorageKey(conversationId));
        localStorage.removeItem(getLockStorageKey(conversationId));
    }
    catch (_) {
        // 清理失败不会影响正式会话继续运行
    }
}
function tryLoadLegacyState(conversationId) {
    try {
        const raw = JSON.parse(localStorage.getItem(constants_1.LEGACY_STORAGE_KEY) || 'null');
        if (!raw || typeof raw !== 'object')
            return null;
        const legacyId = typeof raw.conversationId === 'string' && raw.conversationId
            ? raw.conversationId
            : null;
        if (legacyId !== (conversationId || null))
            return null;
        return normalizeState(raw, conversationId);
    }
    catch (_) {
        return null;
    }
}
function loadStateForContext(conversationId) {
    try {
        const storage = getStateStorage(conversationId);
        const key = getStateStorageKey(conversationId);
        const parsed = JSON.parse(storage.getItem(key) || 'null');
        if (parsed)
            return normalizeState(parsed, conversationId);
        const legacy = tryLoadLegacyState(conversationId);
        if (legacy) {
            storage.setItem(key, JSON.stringify(legacy));
            return legacy;
        }
    }
    catch (error) {
        console.warn('[ChatGPT 顺序任务助手] 无法读取当前会话状态。', error);
    }
    return createDefaultState(conversationId);
}
function writeStateForContext(targetState, conversationId) {
    targetState.version = 2;
    targetState.conversationId = conversationId || null;
    targetState.updatedAt = Date.now();
    try {
        getStateStorage(conversationId).setItem(getStateStorageKey(conversationId), JSON.stringify(targetState));
    }
    catch (error) {
        console.warn('[ChatGPT 顺序任务助手] 无法保存当前会话状态。', error);
    }
}
function loadInitialStateForContext(conversationId, tabId) {
    const pending = conversationId ? readFreshInitialBindingPending(tabId) : null;
    if (!conversationId || !pending) {
        return {
            state: loadStateForContext(conversationId),
            restoredInitialBinding: false,
        };
    }
    try {
        const rawTemporaryState = JSON.parse(sessionStorage.getItem(constants_1.TEMP_STATE_KEY) || 'null');
        if (rawTemporaryState) {
            const temporaryState = normalizeInitialBindingRestoreState(rawTemporaryState, conversationId, pending);
            if (hasStateContent(temporaryState) || temporaryState.activeIndex !== null) {
                writeStateForContext(temporaryState, conversationId);
                sessionStorage.removeItem(constants_1.TEMP_STATE_KEY);
                sessionStorage.removeItem(constants_1.TEMP_LOCK_KEY);
                if (isLocalConversationId(conversationId)) {
                    rememberInitialBindingIntermediate(conversationId, tabId);
                }
                else {
                    clearInitialBindingPending();
                }
                return {
                    state: temporaryState,
                    restoredInitialBinding: true,
                };
            }
        }
        if (isLocalConversationId(conversationId)) {
            const localState = loadStateForContext(conversationId);
            if (hasStateContent(localState) || localState.activeIndex !== null) {
                rememberInitialBindingIntermediate(conversationId, tabId);
                return {
                    state: localState,
                    restoredInitialBinding: true,
                };
            }
            return {
                state: localState,
                restoredInitialBinding: false,
            };
        }
        const intermediateConversationId = typeof pending.intermediateConversationId === 'string'
            ? pending.intermediateConversationId
            : null;
        if (isLocalConversationId(intermediateConversationId)) {
            const intermediateState = loadStateForContext(intermediateConversationId);
            if (hasStateContent(intermediateState) || intermediateState.activeIndex !== null) {
                const restoredState = normalizeInitialBindingRestoreState(intermediateState, conversationId, pending);
                writeStateForContext(restoredState, conversationId);
                removeConversationStateAndLock(intermediateConversationId);
                clearInitialBindingPending();
                return {
                    state: restoredState,
                    restoredInitialBinding: true,
                };
            }
        }
    }
    catch (error) {
        console.warn('[ChatGPT 顺序任务助手] 新对话首次绑定状态迁移失败。', error);
    }
    clearInitialBindingPending();
    return {
        state: loadStateForContext(conversationId),
        restoredInitialBinding: false,
    };
}

},
"styles":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureStyle = ensureStyle;
const constants_1 = require("./constants");
function ensureStyle() {
    if (document.getElementById(constants_1.STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = constants_1.STYLE_ID;
    style.textContent = `
    #${constants_1.PANEL_ID} {
      --${constants_1.PREFIX}-accent: #10a37f;
      --${constants_1.PREFIX}-progress-complete: #10a37f;
      --${constants_1.PREFIX}-progress-active: #f5b700;
      --${constants_1.PREFIX}-progress-pending: #6b7280;
      --${constants_1.PREFIX}-progress-complete-percent: 0%;
      --${constants_1.PREFIX}-progress-active-end-percent: 0%;
      position: fixed;
      right: max(18px, env(safe-area-inset-right));
      bottom: max(50px, calc(env(safe-area-inset-bottom) + 16px));
      z-index: 2147483000;
      width: min(390px, calc(100vw - 32px));
      max-height: min(720px, calc(100vh - 66px));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 14px;
      background: var(--main-surface-primary, #ffffff);
      color: var(--text-primary, #111827);
      box-shadow: 0 14px 42px rgba(0, 0, 0, 0.22);
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #${constants_1.PANEL_ID}[data-collapsed="true"] {
      width: 0;
      height: 0;
      max-height: 0;
      overflow: visible;
      border: 0;
      background: transparent;
      box-shadow: none;
      pointer-events: none;
    }

    #${constants_1.PANEL_ID} * {
      box-sizing: border-box;
    }

    #${constants_1.LAUNCHER_ID} {
      --${constants_1.PREFIX}-accent: #10a37f;
      --${constants_1.PREFIX}-progress-complete: #10a37f;
      --${constants_1.PREFIX}-progress-active: #f5b700;
      --${constants_1.PREFIX}-progress-pending: #6b7280;
      --${constants_1.PREFIX}-progress-complete-percent: 0%;
      --${constants_1.PREFIX}-progress-active-end-percent: 0%;
      position: absolute;
      right: 60px;
      bottom: -1px;
      z-index: 21;
      display: grid;
      width: 92px;
      height: 24px;
      min-height: 24px;
      place-items: center;
      padding: 0 8px;
      overflow: hidden;
      border: 0;
      border-radius: 6px;
      background: linear-gradient(
        90deg,
        var(--${constants_1.PREFIX}-progress-complete) 0 var(--${constants_1.PREFIX}-progress-complete-percent),
        var(--${constants_1.PREFIX}-progress-active) var(--${constants_1.PREFIX}-progress-complete-percent) var(--${constants_1.PREFIX}-progress-active-end-percent),
        var(--${constants_1.PREFIX}-progress-pending) var(--${constants_1.PREFIX}-progress-active-end-percent) 100%
      );
      color: #ffffff;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      cursor: pointer;
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transition: opacity 150ms ease, box-shadow 150ms ease;
    }

    #${constants_1.LAUNCHER_ID}[hidden] {
      display: none !important;
    }

    #${constants_1.LAUNCHER_ID}:hover {
      opacity: 0.92;
    }

    #${constants_1.LAUNCHER_ID}[data-mode="running"],
    #${constants_1.LAUNCHER_ID}[data-mode="pausing"] {
      animation: ${constants_1.PREFIX}-pulse 1.8s ease-in-out infinite;
    }

    #${constants_1.PANEL_ID}[data-mode="error"],
    #${constants_1.LAUNCHER_ID}[data-mode="error"] {
      --${constants_1.PREFIX}-accent: #d92d20;
    }

    #${constants_1.LAUNCHER_ID}[data-mode="error"] {
      outline: 2px solid #d92d20;
      outline-offset: 2px;
    }

    #${constants_1.LAUNCHER_ID} .${constants_1.PREFIX}-launcher-text {
      position: relative;
      z-index: 1;
      max-width: 100%;
      overflow: hidden;
      color: #ffffff;
      font-size: 12px;
      font-weight: 650;
      line-height: 1;
      text-align: center;
      text-overflow: clip;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
      white-space: nowrap;
    }

    #${constants_1.PANEL_ID}[data-collapsed="true"] .${constants_1.PREFIX}-header,
    #${constants_1.PANEL_ID}[data-collapsed="true"] .${constants_1.PREFIX}-body {
      display: none;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
      user-select: none;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-title-group {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 8px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-title {
      overflow: hidden;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-mode-badge {
      flex: none;
      padding: 2px 7px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--${constants_1.PREFIX}-accent) 13%, transparent);
      color: var(--${constants_1.PREFIX}-accent);
      font-size: 11px;
      font-weight: 700;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      padding: 11px;
      overflow: auto;
    }

    #${constants_1.PANEL_ID} textarea,
    #${constants_1.PANEL_ID} input {
      width: 100%;
      border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--main-surface-primary, #ffffff) 96%, currentColor 4%);
      color: inherit;
      font: inherit;
      outline: none;
    }

    #${constants_1.PANEL_ID} textarea {
      min-height: 150px;
      resize: vertical;
      padding: 9px;
      line-height: 1.5;
    }

    #${constants_1.PANEL_ID} input {
      padding: 6px 8px;
    }

    #${constants_1.PANEL_ID} textarea:focus,
    #${constants_1.PANEL_ID} input:focus {
      border-color: var(--${constants_1.PREFIX}-accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--${constants_1.PREFIX}-accent) 16%, transparent);
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-hint,
    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-muted {
      color: var(--text-secondary, #6b7280);
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-row {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 8px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-unit-input {
      display: grid;
      grid-template-columns: 66px auto;
      align-items: center;
      gap: 6px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-buttons {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
    }

    #${constants_1.PANEL_ID} button {
      appearance: none;
      -webkit-appearance: none;
      min-height: 32px;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--main-surface-primary, #ffffff) 92%, currentColor 8%);
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    #${constants_1.PANEL_ID} button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--main-surface-primary, #ffffff) 84%, currentColor 16%);
    }

    #${constants_1.PANEL_ID}[data-collapsed="true"] .${constants_1.PREFIX}-launcher:hover:not(:disabled) {
      background: linear-gradient(
        90deg,
        var(--${constants_1.PREFIX}-progress-complete) 0 var(--${constants_1.PREFIX}-progress-complete-percent),
        var(--${constants_1.PREFIX}-progress-active) var(--${constants_1.PREFIX}-progress-complete-percent) var(--${constants_1.PREFIX}-progress-active-end-percent),
        var(--${constants_1.PREFIX}-progress-pending) var(--${constants_1.PREFIX}-progress-active-end-percent) 100%
      );
    }

    #${constants_1.PANEL_ID} button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    #${constants_1.PANEL_ID} button.${constants_1.PREFIX}-primary {
      border-color: #0d8f70 !important;
      background-color: #10a37f !important;
      color: #ffffff !important;
      filter: none !important;
    }

    #${constants_1.PANEL_ID} button.${constants_1.PREFIX}-primary:hover:not(:disabled),
    #${constants_1.PANEL_ID} button.${constants_1.PREFIX}-primary:focus-visible:not(:disabled) {
      border-color: #0b7c62 !important;
      background-color: #0d8f70 !important;
      color: #ffffff !important;
      filter: none !important;
    }

    #${constants_1.PANEL_ID} button.${constants_1.PREFIX}-primary:active:not(:disabled) {
      border-color: #096b56 !important;
      background-color: #0b7c62 !important;
      color: #ffffff !important;
    }

    #${constants_1.PANEL_ID} button.${constants_1.PREFIX}-primary:focus-visible {
      outline: 2px solid color-mix(in srgb, #10a37f 45%, transparent);
      outline-offset: 2px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-danger {
      color: #b42318;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-progress-section {
      display: grid;
      gap: 7px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-progress-track {
      position: relative;
      height: 24px;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, var(--main-surface-primary, #ffffff) 87%, currentColor 13%);
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-progress-completed,
    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-progress-active {
      position: absolute;
      inset-block: 0;
      width: 0;
      transition: left 220ms ease, width 220ms ease;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-progress-completed {
      left: 0;
      background: var(--${constants_1.PREFIX}-progress-complete);
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-progress-active {
      left: 0;
      background: var(--${constants_1.PREFIX}-progress-active);
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-progress-text {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 750;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-conversation {
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--text-secondary, #6b7280);
      font-size: 12px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-conversation-dot {
      width: 8px;
      height: 8px;
      flex: none;
      border-radius: 50%;
      background: #98a2b3;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-conversation[data-state="bound"] .${constants_1.PREFIX}-conversation-dot {
      background: #12b76a;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-conversation[data-state="mismatch"] .${constants_1.PREFIX}-conversation-dot {
      background: #d92d20;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-details {
      border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent);
      padding-top: 7px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-details summary {
      cursor: pointer;
      color: var(--text-secondary, #6b7280);
      font-weight: 650;
      user-select: none;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-details-content {
      display: grid;
      gap: 8px;
      padding-top: 8px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-detail-item {
      display: grid;
      gap: 2px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-detail-label {
      color: var(--text-secondary, #6b7280);
      font-size: 11px;
      font-weight: 700;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-notice {
      padding: 8px 9px;
      border-left: 3px solid var(--${constants_1.PREFIX}-accent);
      border-radius: 5px;
      background: color-mix(in srgb, var(--${constants_1.PREFIX}-accent) 8%, transparent);
      overflow-wrap: anywhere;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-layer {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: none;
      place-items: center;
      padding: 18px;
      background: rgba(0, 0, 0, 0.38);
      backdrop-filter: blur(1.5px);
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-layer[data-open="true"] {
      display: grid;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-card {
      width: min(300px, 100%);
      max-height: calc(100% - 8px);
      overflow: auto;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 12px;
      background: var(--main-surface-primary, #ffffff);
      color: inherit;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
      padding: 16px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-title {
      margin: 0 0 8px;
      font-size: 15px;
      font-weight: 750;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-message {
      margin: 0;
      color: var(--text-secondary, #4b5563);
      overflow-wrap: anywhere;
      white-space: pre-line;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-actions button {
      min-width: 72px;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-confirm[data-danger="true"] {
      border-color: #b42318 !important;
      background-color: #d92d20 !important;
      color: #ffffff !important;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-confirm[data-danger="true"]:hover,
    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-confirm[data-danger="true"]:focus-visible {
      background-color: #b42318 !important;
      color: #ffffff !important;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-task-text {
      overflow-wrap: anywhere;
    }

    #${constants_1.PANEL_ID} .${constants_1.PREFIX}-collapse {
      width: 30px;
      min-height: 28px;
      padding: 0;
      font-size: 16px;
    }

    @keyframes ${constants_1.PREFIX}-pulse {
      0%, 100% { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18); }
      50% { box-shadow: 0 4px 20px color-mix(in srgb, var(--${constants_1.PREFIX}-accent) 48%, transparent); }
    }

    @media (prefers-reduced-motion: reduce) {
      #${constants_1.PANEL_ID} *,
      #${constants_1.LAUNCHER_ID} {
        animation: none !important;
        transition: none !important;
      }
    }

    @media (prefers-color-scheme: dark) {
      #${constants_1.PANEL_ID} {
        background: var(--main-surface-primary, #212121);
        color: var(--text-primary, #f3f4f6);
      }

      #${constants_1.PANEL_ID} .${constants_1.PREFIX}-modal-card {
        background: var(--main-surface-primary, #212121);
      }

      #${constants_1.PANEL_ID} .${constants_1.PREFIX}-danger {
        color: #fda29b;
      }
    }
  `;
    document.head.appendChild(style);
}

},
"launcher":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPortalConversationId = getPortalConversationId;
exports.isTemporaryPortalConversationId = isTemporaryPortalConversationId;
exports.getComposerPortalPriority = getComposerPortalPriority;
exports.isComposerPortalForCurrentRoute = isComposerPortalForCurrentRoute;
exports.getComposerPortal = getComposerPortal;
exports.disconnectLauncherObservers = disconnectLauncherObservers;
exports.disconnectLauncherWaitObserver = disconnectLauncherWaitObserver;
exports.startLauncherWaitObserver = startLauncherWaitObserver;
exports.clearLauncherRetryTimers = clearLauncherRetryTimers;
exports.syncLauncherVisibility = syncLauncherVisibility;
exports.bindLauncherObservers = bindLauncherObservers;
exports.createLauncher = createLauncher;
exports.ensureLauncherMounted = ensureLauncherMounted;
exports.scheduleLauncherMountRetries = scheduleLauncherMountRetries;
exports.verifyLauncherIntegrity = verifyLauncherIntegrity;
exports.startLauncherIntegrityWatch = startLauncherIntegrityWatch;
const constants_1 = require("./constants");
const storage_1 = require("./storage");
const styles_1 = require("./styles");
let launcherPortalObserver = null;
let launcherFormObserver = null;
let launcherParentObserver = null;
let launcherRetryTimers = [];
let launcherWaitObserver = null;
let launcherIntegrityTimer = null;
function getPortalConversationId(portal) {
    const raw = portal?.getAttribute?.('data-above-composer-conversation-id') || '';
    return raw.replace(/^chatgpt:/i, '') || null;
}
function isTemporaryPortalConversationId(conversationId) {
    return typeof conversationId === 'string' && ((0, storage_1.isLocalConversationId)(conversationId) || /^WEB:/i.test(conversationId));
}
function getComposerPortalPriority(portal) {
    if (!(portal instanceof Element) || !portal.isConnected)
        return -1;
    const form = portal.closest('form[data-chatgpt-composer]');
    if (!form)
        return -1;
    const routeConversationId = (0, storage_1.getConversationId)();
    const portalConversationId = getPortalConversationId(portal);
    const placement = form.getAttribute('data-composer-placement') || '';
    if (routeConversationId) {
        if (placement !== 'thread')
            return -1;
        if (portalConversationId === routeConversationId)
            return 300;
        // During / -> local-chatgpt:* -> final UUID binding, ChatGPT may keep
        // the active thread portal's local id after the URL becomes the final UUID.
        if (isTemporaryPortalConversationId(portalConversationId))
            return 200;
        if (!portalConversationId)
            return 100;
        return -1;
    }
    if (placement !== 'home')
        return -1;
    if (isTemporaryPortalConversationId(portalConversationId))
        return 300;
    return portalConversationId ? -1 : 200;
}
function isComposerPortalForCurrentRoute(portal) {
    return getComposerPortalPriority(portal) >= 0;
}
function getComposerPortal() {
    const portals = document.querySelectorAll('form[data-chatgpt-composer] > [data-above-composer-portal="true"]');
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
function disconnectLauncherObservers() {
    launcherPortalObserver?.disconnect();
    launcherFormObserver?.disconnect();
    launcherParentObserver?.disconnect();
    launcherPortalObserver = null;
    launcherFormObserver = null;
    launcherParentObserver = null;
}
function disconnectLauncherWaitObserver() {
    launcherWaitObserver?.disconnect();
    launcherWaitObserver = null;
}
function startLauncherWaitObserver(onExpand) {
    if (launcherWaitObserver || !document.documentElement)
        return;
    launcherWaitObserver = new MutationObserver(() => {
        const portal = getComposerPortal();
        if (!portal)
            return;
        disconnectLauncherWaitObserver();
        scheduleLauncherMountRetries(onExpand);
    });
    launcherWaitObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-composer-placement', 'data-above-composer-conversation-id'],
    });
}
function clearLauncherRetryTimers() {
    for (const timer of launcherRetryTimers)
        window.clearTimeout(timer);
    launcherRetryTimers = [];
}
function syncLauncherVisibility() {
    const panel = document.getElementById(constants_1.PANEL_ID);
    const launcher = document.getElementById(constants_1.LAUNCHER_ID);
    if (!launcher)
        return;
    launcher.hidden = !panel || panel.dataset.collapsed !== 'true';
}
function bindLauncherObservers(portal, onExpand) {
    disconnectLauncherObservers();
    const form = portal.closest('form[data-chatgpt-composer]');
    if (!form)
        return;
    launcherPortalObserver = new MutationObserver(() => {
        const launcher = document.getElementById(constants_1.LAUNCHER_ID);
        if (!launcher || launcher.parentElement !== portal)
            scheduleLauncherMountRetries(onExpand);
    });
    launcherPortalObserver.observe(portal, {
        childList: true,
        attributes: true,
        attributeFilter: ['data-above-composer-conversation-id'],
    });
    launcherFormObserver = new MutationObserver(() => {
        if (!form.isConnected || getComposerPortal() !== portal)
            scheduleLauncherMountRetries(onExpand);
    });
    launcherFormObserver.observe(form, {
        childList: true,
        attributes: true,
        attributeFilter: ['data-composer-placement'],
    });
    const parent = form.parentElement;
    if (parent) {
        launcherParentObserver = new MutationObserver(() => {
            if (!form.isConnected || getComposerPortal() !== portal)
                scheduleLauncherMountRetries(onExpand);
        });
        launcherParentObserver.observe(parent, { childList: true, subtree: true });
    }
}
function createLauncher(onExpand) {
    let launcher = document.getElementById(constants_1.LAUNCHER_ID);
    if (launcher)
        return launcher;
    launcher = document.createElement('button');
    launcher.id = constants_1.LAUNCHER_ID;
    launcher.type = 'button';
    launcher.className = `${constants_1.PREFIX}-launcher`;
    launcher.setAttribute('aria-label', '展开 ChatGPT 顺序任务助手');
    launcher.title = 'ChatGPT 顺序任务助手';
    launcher.innerHTML = `<span class="${constants_1.PREFIX}-launcher-text" data-field="launcher-progress">顺序任务</span>`;
    launcher.addEventListener('click', () => {
        const panel = document.getElementById(constants_1.PANEL_ID);
        if (!panel)
            return;
        panel.dataset.collapsed = 'false';
        syncLauncherVisibility();
        onExpand?.();
    });
    launcher.hidden = true;
    return launcher;
}
function ensureLauncherMounted(onExpand) {
    (0, styles_1.ensureStyle)();
    const portal = getComposerPortal();
    if (!portal) {
        disconnectLauncherObservers();
        startLauncherWaitObserver(onExpand);
        return false;
    }
    disconnectLauncherWaitObserver();
    const launcher = createLauncher(onExpand);
    if (launcher.parentElement !== portal)
        portal.appendChild(launcher);
    syncLauncherVisibility();
    bindLauncherObservers(portal, onExpand);
    return true;
}
function scheduleLauncherMountRetries(onExpand) {
    clearLauncherRetryTimers();
    const delays = [0, 80, 200, 500, 1000, 2000];
    for (const delay of delays) {
        launcherRetryTimers.push(window.setTimeout(() => {
            if (ensureLauncherMounted(onExpand))
                clearLauncherRetryTimers();
        }, delay));
    }
}
function verifyLauncherIntegrity(onExpand) {
    const portal = getComposerPortal();
    const launcher = document.getElementById(constants_1.LAUNCHER_ID);
    if (!portal) {
        startLauncherWaitObserver(onExpand);
        return;
    }
    if (!launcher || launcher.parentElement !== portal) {
        scheduleLauncherMountRetries(onExpand);
        return;
    }
    syncLauncherVisibility();
}
function startLauncherIntegrityWatch(onExpand) {
    if (launcherIntegrityTimer !== null)
        return;
    launcherIntegrityTimer = window.setInterval(() => verifyLauncherIntegrity(onExpand), constants_1.LAUNCHER_INTEGRITY_INTERVAL_MS);
}

},
"panel":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProgressSnapshot = getProgressSnapshot;
exports.setPanelField = setPanelField;
exports.setButtonDisabled = setButtonDisabled;
exports.readPanelQueueDraft = readPanelQueueDraft;
exports.resetPanelForContext = resetPanelForContext;
exports.createPanel = createPanel;
exports.showPanelDialog = showPanelDialog;
exports.closePanelDialog = closePanelDialog;
exports.handleDialogKeydown = handleDialogKeydown;
exports.renderPanelUI = renderPanelUI;
const constants_1 = require("./constants");
const launcher_1 = require("./launcher");
const parser_1 = require("./parser");
const styles_1 = require("./styles");
let dialogResolver = null;
function getProgressSnapshot(state) {
    const totalCount = state.tasks.length;
    const completedCount = state.tasks.filter((task) => task.status === 'completed').length;
    const activeTask = state.activeIndex !== null ? state.tasks[state.activeIndex] : null;
    const activeVisible = Boolean(activeTask && ['sending', 'submitted', 'running'].includes(activeTask.status));
    const activePosition = activeVisible && state.activeIndex !== null
        ? state.activeIndex + 1
        : completedCount;
    const completedPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
    const activeStartPercent = totalCount > 0 && activeVisible && state.activeIndex !== null
        ? (state.activeIndex / totalCount) * 100
        : completedPercent;
    const activeWidthPercent = totalCount > 0 && activeVisible ? 100 / totalCount : 0;
    return {
        totalCount,
        completedCount,
        activeVisible,
        activePosition,
        completedPercent: Math.min(100, Math.max(0, completedPercent)),
        activeStartPercent: Math.min(100, Math.max(0, activeStartPercent)),
        activeWidthPercent: Math.min(100, Math.max(0, activeWidthPercent)),
    };
}
function setPanelField(panel, name, value) {
    const element = panel.querySelector(`[data-field="${name}"]`);
    if (element)
        element.textContent = value;
}
function setButtonDisabled(panel, action, disabled) {
    const button = panel.querySelector(`button[data-action="${action}"]`);
    if (button)
        button.disabled = Boolean(disabled);
}
function readPanelQueueDraft() {
    const textarea = document.getElementById(`${constants_1.PREFIX}-input`);
    const delayInput = document.getElementById(`${constants_1.PREFIX}-delay`);
    const inputText = textarea?.value || '';
    const lines = (0, parser_1.parseTasks)(inputText);
    return {
        textarea,
        lines,
        sourceText: (0, parser_1.getTaskSourceText)(inputText),
        draftText: inputText,
        delayMs: (0, parser_1.clampInteger)(Number(delayInput?.value) * 1000, 1000, 30000, constants_1.DEFAULT_BETWEEN_TASK_DELAY_MS),
    };
}
function resetPanelForContext() {
    const panel = document.getElementById(constants_1.PANEL_ID);
    const textarea = panel?.querySelector(`#${constants_1.PREFIX}-input`);
    const details = panel?.querySelector(`[data-field="details"]`);
    if (textarea) {
        textarea.dataset.initialized = 'false';
        textarea.dataset.dirty = 'false';
    }
    if (details)
        details.open = false;
    closePanelDialog(false);
}
function createPanel(handlers) {
    let existing = document.getElementById(constants_1.PANEL_ID);
    if (existing) {
        (0, launcher_1.scheduleLauncherMountRetries)(handlers.renderPanel);
        return existing;
    }
    (0, styles_1.ensureStyle)();
    const panel = document.createElement('section');
    panel.id = constants_1.PANEL_ID;
    panel.dataset.collapsed = 'true';
    panel.innerHTML = `
    <div class="${constants_1.PREFIX}-header">
      <div class="${constants_1.PREFIX}-title-group">
        <span class="${constants_1.PREFIX}-title">ChatGPT 顺序任务助手</span>
        <span class="${constants_1.PREFIX}-mode-badge" data-field="mode"></span>
      </div>
      <button type="button" class="${constants_1.PREFIX}-collapse" data-action="collapse" aria-label="收起面板">−</button>
    </div>
    <div class="${constants_1.PREFIX}-body">
      <div class="${constants_1.PREFIX}-hint">多行 Prompt 请用单独一行 --- 分隔；<br>无分隔符时，每个非空行作为一轮命令。</div>
      <textarea id="${constants_1.PREFIX}-input" spellcheck="false" placeholder="第一个 Prompt\\n可以有多行内容\\n\\n---\\n\\n第二个 Prompt\\n也可以有多行内容"></textarea>
      <div class="${constants_1.PREFIX}-row">
        <label for="${constants_1.PREFIX}-delay">回答结束后额外等待</label>
        <div class="${constants_1.PREFIX}-unit-input">
          <input id="${constants_1.PREFIX}-delay" type="number" min="1" max="30" step="1" value="3" aria-label="回答结束后额外等待秒数">
          <span class="${constants_1.PREFIX}-muted">秒</span>
        </div>
      </div>
      <div class="${constants_1.PREFIX}-buttons">
        <button type="button" data-action="start" class="${constants_1.PREFIX}-primary">开始/恢复</button>
        <button type="button" data-action="pause">暂停</button>
        <button type="button" data-action="refresh">刷新状态</button>
        <button type="button" data-action="clear" class="${constants_1.PREFIX}-danger">清空</button>
      </div>
      <div class="${constants_1.PREFIX}-progress-section">
        <div class="${constants_1.PREFIX}-progress-track" data-field="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
          <div class="${constants_1.PREFIX}-progress-completed" data-field="progress-completed"></div>
          <div class="${constants_1.PREFIX}-progress-active" data-field="progress-active"></div>
          <span class="${constants_1.PREFIX}-progress-text" data-field="progress"></span>
        </div>
        <div class="${constants_1.PREFIX}-conversation" data-field="conversation-wrap" data-state="unbound">
          <span class="${constants_1.PREFIX}-conversation-dot" aria-hidden="true"></span>
          <span data-field="conversation"></span>
        </div>
      </div>
      <details class="${constants_1.PREFIX}-details" data-field="details">
        <summary>任务详情</summary>
        <div class="${constants_1.PREFIX}-details-content">
          <div class="${constants_1.PREFIX}-detail-item">
            <span class="${constants_1.PREFIX}-detail-label">当前任务</span>
            <span data-field="current" class="${constants_1.PREFIX}-task-text"></span>
          </div>
          <div class="${constants_1.PREFIX}-detail-item">
            <span class="${constants_1.PREFIX}-detail-label">下一任务</span>
            <span data-field="next" class="${constants_1.PREFIX}-task-text"></span>
          </div>
        </div>
      </details>
      <div class="${constants_1.PREFIX}-notice" data-field="notice"></div>
    </div>
    <div class="${constants_1.PREFIX}-modal-layer" data-field="modal-layer" data-open="false" aria-hidden="true">
      <div class="${constants_1.PREFIX}-modal-card" role="dialog" aria-modal="true" aria-labelledby="${constants_1.PREFIX}-modal-title">
        <h2 id="${constants_1.PREFIX}-modal-title" class="${constants_1.PREFIX}-modal-title" data-field="modal-title"></h2>
        <p class="${constants_1.PREFIX}-modal-message" data-field="modal-message"></p>
        <div class="${constants_1.PREFIX}-modal-actions">
          <button type="button" data-action="dialog-cancel" data-field="modal-cancel">取消</button>
          <button type="button" data-action="dialog-confirm" data-field="modal-confirm" class="${constants_1.PREFIX}-modal-confirm">确认</button>
        </div>
      </div>
    </div>
  `;
    panel.addEventListener('click', (event) => {
        const target = event.target;
        const button = target?.closest('button[data-action]');
        if (!button)
            return;
        const action = button.dataset.action;
        if (action === 'start')
            handlers.onStart();
        if (action === 'pause')
            handlers.onPause();
        if (action === 'refresh')
            handlers.onRefresh();
        if (action === 'clear')
            handlers.onClear();
        if (action === 'collapse') {
            panel.dataset.collapsed = 'true';
            (0, launcher_1.scheduleLauncherMountRetries)(handlers.renderPanel);
        }
        if (action === 'dialog-cancel')
            closePanelDialog(false);
        if (action === 'dialog-confirm')
            closePanelDialog(true);
    });
    panel.addEventListener('input', (event) => {
        const target = event.target;
        if (target?.id === `${constants_1.PREFIX}-input`) {
            const textarea = target;
            textarea.dataset.dirty = 'true';
            handlers.onDraftChange(textarea.value);
        }
    });
    panel.addEventListener('change', (event) => {
        const target = event.target;
        if (target?.id !== `${constants_1.PREFIX}-delay`)
            return;
        const input = target;
        const clampedDelay = (0, parser_1.clampInteger)(Number(input.value) * 1000, 1000, 30000, constants_1.DEFAULT_BETWEEN_TASK_DELAY_MS);
        input.value = String(Math.round(clampedDelay / 1000));
        handlers.onDelayChange(clampedDelay);
    });
    document.body.appendChild(panel);
    (0, launcher_1.scheduleLauncherMountRetries)(handlers.renderPanel);
    return panel;
}
function showPanelDialog(options, handlers) {
    const panel = createPanel(handlers);
    if (!panel)
        return Promise.resolve(false);
    if (dialogResolver)
        closePanelDialog(false);
    panel.dataset.collapsed = 'false';
    const layer = panel.querySelector(`[data-field="modal-layer"]`);
    const cancelButton = panel.querySelector(`[data-field="modal-cancel"]`);
    const confirmButton = panel.querySelector(`[data-field="modal-confirm"]`);
    setPanelField(panel, 'modal-title', options.title || '提示');
    setPanelField(panel, 'modal-message', options.message || '');
    if (cancelButton) {
        cancelButton.textContent = options.cancelText || '取消';
        cancelButton.hidden = Boolean(options.alertOnly);
    }
    if (confirmButton) {
        confirmButton.textContent = options.alertOnly ? '知道了' : (options.confirmText || '确认');
        confirmButton.dataset.danger = options.danger ? 'true' : 'false';
    }
    if (layer) {
        layer.dataset.open = 'true';
        layer.setAttribute('aria-hidden', 'false');
    }
    return new Promise((resolve) => {
        dialogResolver = resolve;
        window.requestAnimationFrame(() => confirmButton?.focus());
    });
}
function closePanelDialog(result) {
    const panel = document.getElementById(constants_1.PANEL_ID);
    const layer = panel?.querySelector(`[data-field="modal-layer"]`);
    if (layer) {
        layer.dataset.open = 'false';
        layer.setAttribute('aria-hidden', 'true');
    }
    const resolver = dialogResolver;
    dialogResolver = null;
    if (resolver)
        resolver(Boolean(result));
}
function handleDialogKeydown(event) {
    if (!dialogResolver)
        return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closePanelDialog(false);
    }
    else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        closePanelDialog(true);
    }
}
function renderPanelUI(state, currentConversationId, conversationOk, isStopVisible) {
    const panel = document.getElementById(constants_1.PANEL_ID);
    if (!panel)
        return;
    const textarea = panel.querySelector(`#${constants_1.PREFIX}-input`);
    const delayInput = panel.querySelector(`#${constants_1.PREFIX}-delay`);
    if (textarea && !textarea.dataset.initialized) {
        textarea.value = state.draftText;
        textarea.dataset.initialized = 'true';
        textarea.dataset.dirty = 'false';
    }
    else if (textarea &&
        textarea.dataset.dirty !== 'true' &&
        document.activeElement !== textarea &&
        textarea.value !== state.draftText) {
        textarea.value = state.draftText;
    }
    if (delayInput && document.activeElement !== delayInput) {
        delayInput.value = String(Math.round(state.delayMs / 1000));
    }
    const activeTask = state.activeIndex !== null ? state.tasks[state.activeIndex] : null;
    const nextTask = state.tasks[state.nextIndex] || null;
    const progress = getProgressSnapshot(state);
    const { totalCount, completedCount } = progress;
    const draftInputText = textarea?.value ?? state.draftText;
    const draftLines = (0, parser_1.parseTasks)(draftInputText);
    const draftCount = draftLines.length;
    const draftSourceText = (0, parser_1.getTaskSourceText)(draftInputText);
    const draftChanged = totalCount > 0 && draftSourceText !== state.sourceText;
    const displayTotalCount = totalCount > 0 ? totalCount : draftCount;
    const progressText = totalCount > 0
        ? (draftChanged
            ? `${progress.activePosition} / ${totalCount} · 草稿 ${draftCount}`
            : `${progress.activePosition} / ${totalCount}`)
        : (draftCount > 0 ? `0 / ${draftCount}` : '尚未载入');
    const launcherText = state.mode === 'error'
        ? (totalCount > 0 ? `异常 ${progress.activePosition} / ${totalCount}` : '状态异常')
        : (totalCount > 0
            ? (state.mode === 'completed'
                ? `完成 ${totalCount} / ${totalCount}`
                : (state.mode === 'paused'
                    ? `暂停 ${progress.activePosition} / ${totalCount}`
                    : `任务 ${progress.activePosition} / ${totalCount}`))
            : (draftCount > 0 ? `任务 0 / ${draftCount}` : '顺序任务'));
    panel.dataset.mode = state.mode;
    const activeEndPercent = Math.min(100, progress.activeStartPercent + progress.activeWidthPercent);
    panel.style.setProperty(`--${constants_1.PREFIX}-progress-complete-percent`, `${progress.completedPercent}%`);
    panel.style.setProperty(`--${constants_1.PREFIX}-progress-active-end-percent`, `${activeEndPercent}%`);
    const launcher = document.getElementById(constants_1.LAUNCHER_ID);
    if (launcher) {
        launcher.dataset.mode = state.mode;
        launcher.style.setProperty(`--${constants_1.PREFIX}-progress-complete-percent`, `${progress.completedPercent}%`);
        launcher.style.setProperty(`--${constants_1.PREFIX}-progress-active-end-percent`, `${activeEndPercent}%`);
        (0, launcher_1.syncLauncherVisibility)();
    }
    setPanelField(panel, 'mode', constants_1.MODE_LABELS[state.mode] || state.mode);
    setPanelField(panel, 'launcher-progress', launcherText);
    setPanelField(panel, 'progress', progressText);
    setPanelField(panel, 'current', activeTask
        ? `第 ${state.activeIndex + 1} 轮 · ${constants_1.STATUS_LABELS[activeTask.status]} · ${(0, parser_1.truncate)(activeTask.text)}`
        : '无');
    setPanelField(panel, 'next', nextTask && state.nextIndex < totalCount
        ? `第 ${state.nextIndex + 1} 轮 · ${(0, parser_1.truncate)(nextTask.text)}`
        : '无');
    const conversationState = !currentConversationId
        ? 'unbound'
        : (conversationOk ? 'bound' : 'mismatch');
    const conversationText = conversationState === 'bound'
        ? '会话已绑定'
        : (conversationState === 'mismatch' ? '会话状态切换中' : '新对话待绑定');
    setPanelField(panel, 'conversation', conversationText);
    setPanelField(panel, 'notice', state.notice || '—');
    const conversationWrap = panel.querySelector(`[data-field="conversation-wrap"]`);
    if (conversationWrap)
        conversationWrap.dataset.state = conversationState;
    const progressTrack = panel.querySelector(`[data-field="progress-track"]`);
    if (progressTrack) {
        progressTrack.setAttribute('aria-valuemax', String(displayTotalCount));
        progressTrack.setAttribute('aria-valuenow', String(totalCount > 0 ? progress.activePosition : 0));
        progressTrack.setAttribute('aria-label', totalCount > 0
            ? (draftChanged
                ? `当前队列进度 ${progress.activePosition} / ${totalCount}，草稿已修改为 ${draftCount} 条任务`
                : (progress.activeVisible
                    ? `已完成 ${completedCount} 轮，正在执行第 ${progress.activePosition} / ${totalCount} 轮`
                    : `已完成 ${completedCount} / ${totalCount}`))
            : (draftCount > 0 ? `草稿共 ${draftCount} 条任务，尚未开始` : '尚未载入任务'));
    }
    const completedFill = panel.querySelector(`[data-field="progress-completed"]`);
    if (completedFill)
        completedFill.style.width = `${progress.completedPercent}%`;
    const activeFill = panel.querySelector(`[data-field="progress-active"]`);
    if (activeFill) {
        activeFill.style.left = `${progress.activeStartPercent}%`;
        activeFill.style.width = `${progress.activeWidthPercent}%`;
    }
    if (launcher) {
        const launcherTextElement = launcher.querySelector('[data-field="launcher-progress"]');
        if (launcherTextElement && launcherTextElement.textContent !== launcherText) {
            launcherTextElement.textContent = launcherText;
        }
        launcher.setAttribute('aria-label', totalCount > 0
            ? `展开 ChatGPT 顺序任务助手，进度 ${progress.activePosition} / ${totalCount}，已完成 ${completedCount} 轮，当前状态：${constants_1.MODE_LABELS[state.mode] || state.mode}`
            : (draftCount > 0
                ? `展开 ChatGPT 顺序任务助手，草稿共 ${draftCount} 条任务，尚未开始`
                : '展开 ChatGPT 顺序任务助手'));
    }
    const details = panel.querySelector(`[data-field="details"]`);
    if (details && (state.mode === 'error' || conversationState === 'mismatch')) {
        details.open = true;
    }
    const hasActive = state.activeIndex !== null;
    const startDisabled = state.mode === 'running' ||
        state.mode === 'pausing' ||
        (hasActive && isStopVisible);
    const pauseDisabled = state.tasks.length === 0 ||
        state.mode === 'paused' ||
        state.mode === 'pausing' ||
        state.mode === 'completed' ||
        state.mode === 'error' ||
        state.mode === 'idle';
    setButtonDisabled(panel, 'start', startDisabled);
    setButtonDisabled(panel, 'pause', pauseDisabled);
}

},
"composer":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.internalEditorState = void 0;
exports.isVisibleAndEnabled = isVisibleAndEnabled;
exports.findVisibleElement = findVisibleElement;
exports.findComposer = findComposer;
exports.findEditor = findEditor;
exports.findStopButton = findStopButton;
exports.findSubmitButton = findSubmitButton;
exports.safeClick = safeClick;
exports.selectEditorContents = selectEditorContents;
exports.setEditorText = setEditorText;
exports.clearEditorIfMatches = clearEditorIfMatches;
exports.waitFor = waitFor;
const constants_1 = require("./constants");
const parser_1 = require("./parser");
exports.internalEditorState = {
    active: false,
    expectedText: '',
};
function isVisibleAndEnabled(element) {
    if (!element ||
        !element.isConnected ||
        element.disabled ||
        element.getAttribute('aria-disabled') === 'true') {
        return false;
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' &&
        rect.width > 0 &&
        rect.height > 0);
}
function findVisibleElement(selector) {
    return Array.from(document.querySelectorAll(selector)).find(isVisibleAndEnabled) || null;
}
function findComposer() {
    const elements = Array.from(document.querySelectorAll(constants_1.COMPOSER_SELECTOR));
    return elements.find((element) => {
        const rect = element.getBoundingClientRect();
        return element.isConnected && rect.width > 0 && rect.height > 0;
    }) || null;
}
function findEditor() {
    const composer = findComposer();
    const editor = composer?.querySelector(constants_1.EDITOR_SELECTOR) || document.querySelector(constants_1.EDITOR_SELECTOR);
    return editor instanceof HTMLElement && editor.isContentEditable ? editor : null;
}
function findStopButton() {
    const composer = findComposer();
    const localButton = composer?.querySelector(constants_1.STOP_BUTTON_SELECTOR);
    if (isVisibleAndEnabled(localButton))
        return localButton || null;
    return findVisibleElement(constants_1.STOP_BUTTON_SELECTOR) || null;
}
function findSubmitButton() {
    const composer = findComposer();
    const localButton = composer?.querySelector(constants_1.SUBMIT_BUTTON_SELECTOR);
    if (isVisibleAndEnabled(localButton))
        return localButton || null;
    return findVisibleElement(constants_1.SUBMIT_BUTTON_SELECTOR) || null;
}
function safeClick(button) {
    for (const type of ['mouseover', 'mousedown', 'mouseup']) {
        button.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
        }));
    }
    button.click();
}
function selectEditorContents(editor) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
}
async function setEditorText(editor, text) {
    editor.focus();
    selectEditorContents(editor);
    exports.internalEditorState.active = true;
    exports.internalEditorState.expectedText = (0, parser_1.normalizeText)(text);
    try {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData,
        });
        editor.dispatchEvent(pasteEvent);
        const populated = await waitFor(() => editor.isConnected && (editor.textContent || '').length > 0, constants_1.EDITOR_WRITE_TIMEOUT_MS, constants_1.EDITOR_WRITE_POLL_MS);
        if (!populated)
            return false;
        return editor.isConnected && (editor.textContent || '').length > 0;
    }
    catch (_) {
        return false;
    }
    finally {
        exports.internalEditorState.active = false;
    }
}
function clearEditorIfMatches(text) {
    const editor = findEditor();
    if (!editor || (0, parser_1.normalizeText)(editor.innerText) !== (0, parser_1.normalizeText)(text))
        return;
    editor.focus();
    selectEditorContents(editor);
    exports.internalEditorState.active = true;
    exports.internalEditorState.expectedText = '';
    try {
        try {
            document.execCommand('delete', false);
        }
        catch (_) {
            editor.replaceChildren(document.createElement('p'));
            editor.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'deleteContentBackward',
                data: null,
            }));
        }
    }
    finally {
        exports.internalEditorState.active = false;
    }
}
function waitFor(check, timeoutMs, intervalMs = 100) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
        const run = () => {
            const result = check();
            if (result) {
                resolve(result);
                return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
                resolve(null);
                return;
            }
            window.setTimeout(run, intervalMs);
        };
        run();
    });
}

},
"lock":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockManager = void 0;
const constants_1 = require("./constants");
const storage_1 = require("./storage");
class LockManager {
    tabId;
    ownedLockKey = null;
    ownedLockConversationId = null;
    lockHeartbeatTimer = null;
    constructor(tabId) {
        this.tabId = tabId;
    }
    readLock(conversationId) {
        try {
            return JSON.parse((0, storage_1.getLockStorage)(conversationId).getItem((0, storage_1.getLockStorageKey)(conversationId)) || 'null');
        }
        catch (_) {
            return null;
        }
    }
    isLockFresh(lock) {
        return Boolean(lock && Date.now() - Number(lock.updatedAt || 0) < constants_1.LOCK_STALE_MS);
    }
    isForeignLockActive(conversationId) {
        const lock = this.readLock(conversationId);
        return Boolean(lock?.tabId && lock.tabId !== this.tabId && this.isLockFresh(lock));
    }
    ownsLock(conversationId) {
        const lock = this.readLock(conversationId);
        return Boolean(lock?.tabId === this.tabId && this.isLockFresh(lock));
    }
    acquireLock(conversationId) {
        if (this.isForeignLockActive(conversationId))
            return false;
        const key = (0, storage_1.getLockStorageKey)(conversationId);
        try {
            const storage = (0, storage_1.getLockStorage)(conversationId);
            storage.setItem(key, JSON.stringify({
                tabId: this.tabId,
                updatedAt: Date.now(),
            }));
            this.ownedLockConversationId = conversationId;
            this.ownedLockKey = key;
            this.startLockHeartbeat();
            return true;
        }
        catch (_) {
            return true;
        }
    }
    refreshLock() {
        if (!this.ownedLockKey)
            return;
        const storage = (0, storage_1.getLockStorage)(this.ownedLockConversationId);
        const lock = this.readLock(this.ownedLockConversationId);
        if (lock?.tabId !== this.tabId) {
            this.stopLockHeartbeat();
            this.ownedLockKey = null;
            this.ownedLockConversationId = null;
            return;
        }
        try {
            storage.setItem(this.ownedLockKey, JSON.stringify({
                tabId: this.tabId,
                updatedAt: Date.now(),
            }));
        }
        catch (_) {
            // 存储暂时不可用时不阻断当前页面运行
        }
    }
    releaseLock(conversationId = null) {
        this.stopLockHeartbeat();
        const targetConversationId = this.ownedLockKey ? this.ownedLockConversationId : conversationId;
        const key = this.ownedLockKey || (0, storage_1.getLockStorageKey)(targetConversationId);
        try {
            const storage = (0, storage_1.getLockStorage)(targetConversationId);
            const lock = JSON.parse(storage.getItem(key) || 'null');
            if (lock?.tabId === this.tabId)
                storage.removeItem(key);
        }
        catch (_) {
            // 旧锁会在超时后自动失效
        }
        this.ownedLockKey = null;
        this.ownedLockConversationId = null;
    }
    startLockHeartbeat() {
        if (this.lockHeartbeatTimer !== null)
            return;
        this.lockHeartbeatTimer = window.setInterval(() => this.refreshLock(), constants_1.LOCK_HEARTBEAT_MS);
    }
    stopLockHeartbeat() {
        if (this.lockHeartbeatTimer !== null) {
            window.clearInterval(this.lockHeartbeatTimer);
            this.lockHeartbeatTimer = null;
        }
    }
    shouldOwnLock(state) {
        return state.mode === 'running' || state.mode === 'pausing' || state.activeIndex !== null;
    }
    syncLockToState(state, conversationId) {
        if (this.shouldOwnLock(state))
            this.acquireLock(conversationId);
        else
            this.releaseLock(conversationId);
    }
}
exports.LockManager = LockManager;

},
"scheduler":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskScheduler = void 0;
const composer_1 = require("./composer");
const constants_1 = require("./constants");
const launcher_1 = require("./launcher");
const lock_1 = require("./lock");
const panel_1 = require("./panel");
const parser_1 = require("./parser");
const storage_1 = require("./storage");
class TaskScheduler {
    tabId;
    lockManager;
    currentConversationId;
    state;
    monitorTimer = null;
    dispatchTimer = null;
    dispatchDueAt = 0;
    idleSince = 0;
    sendingEpoch = 0;
    locationSnapshot;
    constructor(tabId) {
        this.tabId = tabId;
        this.lockManager = new lock_1.LockManager(tabId);
        this.locationSnapshot = location.href;
        this.currentConversationId = (0, storage_1.getConversationId)();
        const { state, restoredInitialBinding } = (0, storage_1.loadInitialStateForContext)(this.currentConversationId, this.tabId);
        this.state = state;
        if (!restoredInitialBinding) {
            this.reconcileLoadedState('页面已重新加载');
        }
    }
    saveState({ render = true } = {}) {
        (0, storage_1.writeStateForContext)(this.state, this.currentConversationId);
        if (render)
            this.render();
    }
    render() {
        const isStopVisible = Boolean((0, composer_1.findStopButton)());
        const convStatus = this.getConversationStatus({ allowBind: false });
        (0, panel_1.renderPanelUI)(this.state, this.currentConversationId, convStatus.ok, isStopVisible);
    }
    getConversationStatus({ allowBind = true } = {}) {
        const currentId = (0, storage_1.getConversationId)();
        if (allowBind && this.currentConversationId === null && currentId) {
            this.migrateTemporaryStateToConversation(currentId);
        }
        return {
            ok: currentId === this.currentConversationId,
            currentId,
            expectedId: this.currentConversationId,
        };
    }
    reconcileLoadedState(reason) {
        if (this.state.mode !== 'running' && this.state.mode !== 'pausing')
            return;
        if (this.lockManager.isForeignLockActive(this.currentConversationId))
            return;
        this.state.mode = 'paused';
        this.state.notice = `${reason}，当前会话队列已安全暂停。请刷新状态后再决定是否恢复。`;
        (0, storage_1.writeStateForContext)(this.state, this.currentConversationId);
        this.lockManager.releaseLock(this.currentConversationId);
    }
    resetDispatchTimer() {
        if (this.dispatchTimer !== null) {
            window.clearTimeout(this.dispatchTimer);
            this.dispatchTimer = null;
        }
        this.dispatchDueAt = 0;
    }
    armDispatchTimer() {
        if (!this.dispatchDueAt || this.dispatchTimer !== null)
            return;
        const remaining = Math.max(0, this.dispatchDueAt - Date.now());
        this.dispatchTimer = window.setTimeout(() => {
            this.dispatchTimer = null;
            if (!this.dispatchDueAt)
                return;
            if (Date.now() < this.dispatchDueAt) {
                this.armDispatchTimer();
                return;
            }
            this.dispatchDueAt = 0;
            void this.dispatchNextTask();
        }, remaining);
    }
    scheduleDispatch(delayMs = 300) {
        this.resetDispatchTimer();
        this.dispatchDueAt = Date.now() + Math.max(0, delayMs);
        this.armDispatchTimer();
    }
    catchUpScheduledDispatch() {
        if (this.state.mode !== 'running' ||
            this.state.activeIndex !== null ||
            this.state.nextIndex >= this.state.tasks.length) {
            return;
        }
        if (!this.dispatchDueAt) {
            this.scheduleDispatch(0);
            return;
        }
        if (Date.now() >= this.dispatchDueAt) {
            if (this.dispatchTimer !== null) {
                window.clearTimeout(this.dispatchTimer);
                this.dispatchTimer = null;
            }
            this.dispatchDueAt = 0;
            void this.dispatchNextTask();
            return;
        }
        this.armDispatchTimer();
    }
    getActiveTask() {
        if (this.state.activeIndex === null)
            return null;
        return this.state.tasks[this.state.activeIndex] || null;
    }
    markError(message, { taskStatus = 'failed' } = {}) {
        const task = this.getActiveTask();
        if (task && task.status !== 'completed' && task.status !== 'skipped') {
            task.status = taskStatus;
        }
        this.state.mode = 'error';
        this.state.notice = message;
        this.idleSince = 0;
        composer_1.internalEditorState.expectedText = '';
        this.stopMonitor();
        this.lockManager.releaseLock(this.currentConversationId);
        this.saveState();
    }
    async dispatchNextTask() {
        if (this.state.mode !== 'running' || this.state.activeIndex !== null)
            return;
        if (this.state.nextIndex >= this.state.tasks.length) {
            this.finishQueue();
            return;
        }
        if (!this.lockManager.acquireLock(this.currentConversationId)) {
            this.state.mode = 'paused';
            this.state.notice = '另一个 ChatGPT 标签页正在接管该队列，本页已暂停。';
            this.saveState();
            return;
        }
        const conversation = this.getConversationStatus({ allowBind: true });
        if (!conversation.ok) {
            this.state.mode = 'paused';
            this.state.notice = '检测到已切换到其他 ChatGPT 会话，队列已暂停。请返回原会话后刷新状态。';
            this.lockManager.releaseLock(this.currentConversationId);
            this.saveState();
            return;
        }
        if ((0, composer_1.findStopButton)()) {
            this.state.mode = 'paused';
            this.state.notice = '页面正在运行一条非队列回答。为避免误判，队列已暂停。';
            this.lockManager.releaseLock(this.currentConversationId);
            this.saveState();
            return;
        }
        const editor = (0, composer_1.findEditor)();
        if (!editor) {
            this.markError('未找到 ChatGPT 输入框，无法发送下一轮。请刷新页面后重试。');
            return;
        }
        if ((0, parser_1.normalizeText)(editor.innerText)) {
            this.state.mode = 'paused';
            this.state.notice = '输入框中已有文字，队列不会覆盖用户内容。请处理后再恢复。';
            this.lockManager.releaseLock(this.currentConversationId);
            this.saveState();
            return;
        }
        const index = this.state.nextIndex;
        const task = this.state.tasks[index];
        const epoch = ++this.sendingEpoch;
        this.state.activeIndex = index;
        this.idleSince = 0;
        task.status = 'sending';
        task.hasSeenStop = false;
        task.inputClearedAfterSubmit = false;
        task.submittedAt = 0;
        task.completedAt = 0;
        this.state.notice = `正在发送第 ${index + 1} / ${this.state.tasks.length} 轮。`;
        this.saveState();
        const inserted = await (0, composer_1.setEditorText)(editor, task.text);
        if (!inserted) {
            this.markError(`第 ${index + 1} 轮写入输入框失败。`, { taskStatus: 'failed' });
            return;
        }
        const submitButton = await (0, composer_1.waitFor)(composer_1.findSubmitButton, constants_1.SEND_BUTTON_TIMEOUT_MS, 100);
        if (epoch !== this.sendingEpoch || this.state.activeIndex !== index)
            return;
        if (!submitButton) {
            this.markError(`第 ${index + 1} 轮已写入输入框，但未找到可用的发送按钮。`, {
                taskStatus: 'failed',
            });
            return;
        }
        if (this.currentConversationId === null)
            (0, storage_1.markInitialBindingPending)(this.currentConversationId, this.tabId);
        (0, composer_1.safeClick)(submitButton);
        task.status = 'submitted';
        task.submittedAt = Date.now();
        this.state.notice = `第 ${index + 1} 轮已发送，正在等待 ChatGPT 开始运行。`;
        this.saveState();
        this.startMonitor();
    }
    startMonitor() {
        if (this.monitorTimer !== null)
            return;
        const tick = () => {
            this.monitorTimer = null;
            this.monitorActiveTask();
            if (this.state.activeIndex !== null) {
                this.monitorTimer = window.setTimeout(tick, constants_1.MONITOR_INTERVAL_MS);
            }
        };
        this.monitorTimer = window.setTimeout(tick, 0);
    }
    stopMonitor() {
        if (this.monitorTimer !== null) {
            window.clearTimeout(this.monitorTimer);
            this.monitorTimer = null;
        }
    }
    monitorActiveTask() {
        const task = this.getActiveTask();
        if (!task) {
            this.stopMonitor();
            return;
        }
        const conversation = this.getConversationStatus({ allowBind: true });
        if (!conversation.ok) {
            this.state.mode = 'paused';
            this.state.notice = '当前页面已离开队列绑定的会话。任务状态保持不变，请返回原会话后刷新状态。';
            this.saveState();
            this.stopMonitor();
            return;
        }
        const stopButton = (0, composer_1.findStopButton)();
        const editor = (0, composer_1.findEditor)();
        const editorEmpty = Boolean(editor && !(0, parser_1.normalizeText)(editor.innerText));
        if (!task.inputClearedAfterSubmit && task.submittedAt && editorEmpty) {
            task.inputClearedAfterSubmit = true;
            composer_1.internalEditorState.expectedText = '';
            this.saveState({ render: false });
        }
        if (stopButton) {
            this.idleSince = 0;
            if (!task.hasSeenStop || task.status !== 'running') {
                task.hasSeenStop = true;
                task.status = 'running';
                this.state.notice = `第 ${this.state.activeIndex + 1} / ${this.state.tasks.length} 轮正在运行。`;
                this.saveState();
            }
            return;
        }
        if (task.hasSeenStop) {
            if (!this.idleSince) {
                this.idleSince = Date.now();
                this.state.notice = `第 ${this.state.activeIndex + 1} 轮的停止按钮已消失，正在确认空闲状态。`;
                this.saveState();
                return;
            }
            if (Date.now() - this.idleSince >= constants_1.IDLE_STABLE_MS) {
                this.completeActiveTask();
            }
            return;
        }
        const elapsedSinceSubmit = task.submittedAt ? Date.now() - task.submittedAt : 0;
        const shortTaskFallbackReady = Boolean(task.inputClearedAfterSubmit &&
            elapsedSinceSubmit >= constants_1.START_GRACE_MS);
        if (shortTaskFallbackReady) {
            if (!editorEmpty) {
                this.idleSince = 0;
            }
            else if (!this.idleSince) {
                this.idleSince = Date.now();
                this.state.notice = `第 ${this.state.activeIndex + 1} 轮未捕获到停止按钮，输入框已清空；正在确认超短任务空闲状态。`;
                this.saveState();
                return;
            }
            else if (Date.now() - this.idleSince >= constants_1.IDLE_STABLE_MS) {
                this.completeActiveTask();
                return;
            }
        }
        if (task.submittedAt && elapsedSinceSubmit >= constants_1.START_TIMEOUT_MS) {
            this.markError(`第 ${this.state.activeIndex + 1} 轮发送后 ${Math.round(constants_1.START_TIMEOUT_MS / 1000)} 秒内既未检测到停止按钮，也未满足超短任务完成条件，无法确认任务状态。`, { taskStatus: 'uncertain' });
        }
    }
    completeActiveTask() {
        const index = this.state.activeIndex;
        const task = this.getActiveTask();
        if (index === null || !task)
            return;
        task.status = 'completed';
        task.completedAt = Date.now();
        this.state.activeIndex = null;
        this.state.nextIndex = Math.max(this.state.nextIndex, index + 1);
        this.idleSince = 0;
        this.stopMonitor();
        if (this.state.nextIndex >= this.state.tasks.length) {
            this.finishQueue();
            return;
        }
        if (this.state.mode === 'running') {
            this.state.notice = `第 ${index + 1} 轮已完成，将在 ${Math.round(this.state.delayMs / 1000)} 秒后发送第 ${this.state.nextIndex + 1} 轮。`;
            this.saveState();
            this.scheduleDispatch(this.state.delayMs);
            return;
        }
        this.state.mode = 'paused';
        this.state.notice = `第 ${index + 1} 轮已完成，队列保持暂停；恢复时将从第 ${this.state.nextIndex + 1} 轮开始。`;
        this.lockManager.releaseLock(this.currentConversationId);
        this.saveState();
    }
    finishQueue() {
        this.state.activeIndex = null;
        this.state.nextIndex = this.state.tasks.length;
        this.state.mode = 'completed';
        this.state.notice = `全部 ${this.state.tasks.length} 轮任务已完成。`;
        this.idleSince = 0;
        composer_1.internalEditorState.expectedText = '';
        this.stopMonitor();
        this.resetDispatchTimer();
        this.lockManager.releaseLock(this.currentConversationId);
        this.saveState();
    }
    replaceQueueFromPanel(draft) {
        this.sendingEpoch += 1;
        this.stopMonitor();
        this.resetDispatchTimer();
        this.lockManager.releaseLock(this.currentConversationId);
        const now = Date.now();
        this.state = {
            version: 2,
            sourceText: draft.sourceText,
            draftText: draft.draftText,
            tasks: draft.lines.map((text, index) => ({
                id: index + 1,
                text,
                status: 'pending',
                hasSeenStop: false,
                inputClearedAfterSubmit: false,
                submittedAt: 0,
                completedAt: 0,
            })),
            nextIndex: 0,
            activeIndex: null,
            mode: 'paused',
            conversationId: this.currentConversationId,
            delayMs: draft.delayMs,
            notice: `已载入 ${draft.lines.length} 条任务，准备从第 1 轮开始。`,
            createdAt: now,
            updatedAt: now,
        };
        if (draft.textarea) {
            draft.textarea.value = this.state.draftText;
            draft.textarea.dataset.dirty = 'false';
        }
        this.saveState();
    }
    async startOrResumeQueue() {
        const draft = (0, panel_1.readPanelQueueDraft)();
        const hasQueue = this.state.tasks.length > 0;
        const sourceChanged = draft.sourceText !== this.state.sourceText;
        const queueFinished = this.state.activeIndex === null && this.state.nextIndex >= this.state.tasks.length;
        const activeTask = this.getActiveTask();
        const stopButton = (0, composer_1.findStopButton)();
        if (this.state.mode === 'running' || this.state.mode === 'pausing' || (activeTask && stopButton)) {
            return;
        }
        const panelHandlers = this.getPanelHandlers();
        if (!hasQueue) {
            if (draft.lines.length === 0) {
                await (0, panel_1.showPanelDialog)({
                    title: '没有可执行的任务',
                    message: '请粘贴任务；多行 Prompt 可用单独一行 --- 分隔。',
                    alertOnly: true,
                }, panelHandlers);
                return;
            }
            this.replaceQueueFromPanel(draft);
            this.resumeQueue();
            return;
        }
        if (queueFinished) {
            if (draft.lines.length === 0) {
                await (0, panel_1.showPanelDialog)({
                    title: '任务输入为空',
                    message: '请粘贴新任务后再开始。',
                    alertOnly: true,
                }, panelHandlers);
                return;
            }
            const message = sourceChanged
                ? `将载入 ${draft.lines.length} 条新任务并从第 1 轮开始。`
                : `当前队列已经完成，将重新执行这 ${draft.lines.length} 条任务。`;
            const confirmed = await (0, panel_1.showPanelDialog)({
                title: sourceChanged ? '替换已完成队列' : '重新执行队列',
                message,
                confirmText: '继续',
            }, panelHandlers);
            if (!confirmed)
                return;
            this.replaceQueueFromPanel(draft);
            this.resumeQueue();
            return;
        }
        if (sourceChanged) {
            if (draft.lines.length === 0) {
                await (0, panel_1.showPanelDialog)({
                    title: '无法替换队列',
                    message: '修改后的任务输入为空。',
                    alertOnly: true,
                }, panelHandlers);
                return;
            }
            const confirmed = await (0, panel_1.showPanelDialog)({
                title: '替换当前队列',
                message: `任务文本已修改。将用 ${draft.lines.length} 条任务替换当前队列，并从第 1 轮开始。`,
                confirmText: '替换并开始',
                danger: true,
            }, panelHandlers);
            if (!confirmed)
                return;
            this.replaceQueueFromPanel(draft);
            this.resumeQueue();
            return;
        }
        if (activeTask && !stopButton && !activeTask.hasSeenStop) {
            const editor = (0, composer_1.findEditor)();
            const fallbackReady = Boolean(activeTask.inputClearedAfterSubmit &&
                activeTask.submittedAt &&
                Date.now() - activeTask.submittedAt >= constants_1.START_GRACE_MS &&
                editor &&
                !(0, parser_1.normalizeText)(editor.innerText));
            if (!fallbackReady) {
                const confirmed = await (0, panel_1.showPanelDialog)({
                    title: '重新发送当前轮',
                    message: `无法确认第 ${this.state.activeIndex + 1} 轮是否真正开始。是否重新发送这一轮？`,
                    confirmText: '重新发送',
                    danger: true,
                }, panelHandlers);
                if (!confirmed)
                    return;
                this.resetActiveTaskForRetry();
            }
        }
        this.resumeQueue();
    }
    pauseQueue() {
        this.resetDispatchTimer();
        if (this.state.tasks.length === 0) {
            this.state.notice = '当前没有已载入的队列。';
            this.state.mode = 'idle';
            this.saveState();
            return;
        }
        this.state.mode = this.state.activeIndex !== null ? 'pausing' : 'paused';
        if (this.state.activeIndex !== null) {
            this.state.notice = `已请求暂停；第 ${this.state.activeIndex + 1} 轮仍会继续运行，完成后停在下一轮。`;
            this.startMonitor();
            this.lockManager.syncLockToState(this.state, this.currentConversationId);
        }
        else if (this.state.nextIndex < this.state.tasks.length) {
            this.state.notice = `队列已暂停；恢复时将从第 ${this.state.nextIndex + 1} 轮开始。`;
            this.lockManager.releaseLock(this.currentConversationId);
        }
        else {
            this.state.notice = '队列已暂停。';
            this.lockManager.releaseLock(this.currentConversationId);
        }
        this.saveState();
    }
    resumeQueue() {
        if (this.state.tasks.length === 0) {
            this.state.notice = '请先在面板中粘贴任务，然后点击“开始/恢复”。';
            this.state.mode = 'idle';
            this.saveState();
            return;
        }
        if (this.state.nextIndex >= this.state.tasks.length && this.state.activeIndex === null) {
            this.finishQueue();
            return;
        }
        if (this.lockManager.isForeignLockActive(this.currentConversationId)) {
            this.state.mode = 'paused';
            this.state.notice = '另一个 ChatGPT 标签页正在接管该队列，本页无法恢复。';
            this.saveState();
            return;
        }
        const conversation = this.getConversationStatus({ allowBind: true });
        if (!conversation.ok) {
            this.state.mode = 'paused';
            this.state.notice = '当前不是队列绑定的会话。请返回原会话后刷新状态。';
            this.saveState();
            return;
        }
        const task = this.getActiveTask();
        const stopButton = (0, composer_1.findStopButton)();
        if (task) {
            if (stopButton) {
                this.idleSince = 0;
                task.hasSeenStop = true;
                task.status = 'running';
                this.state.mode = 'running';
                this.state.notice = `已恢复队列；当前仍在等待第 ${this.state.activeIndex + 1} 轮完成。`;
                this.lockManager.acquireLock(this.currentConversationId);
                this.saveState();
                this.startMonitor();
                return;
            }
            if (task.hasSeenStop) {
                this.state.mode = 'running';
                this.state.notice = `已恢复队列；正在重新确认第 ${this.state.activeIndex + 1} 轮是否已经结束。`;
                this.idleSince = Date.now();
                this.lockManager.acquireLock(this.currentConversationId);
                this.saveState();
                this.startMonitor();
                return;
            }
            const editor = (0, composer_1.findEditor)();
            const editorEmpty = Boolean(editor && !(0, parser_1.normalizeText)(editor.innerText));
            const fallbackReady = Boolean(task.inputClearedAfterSubmit &&
                task.submittedAt &&
                Date.now() - task.submittedAt >= constants_1.START_GRACE_MS &&
                editorEmpty);
            if (fallbackReady) {
                task.status = 'submitted';
                this.state.mode = 'running';
                this.state.notice = `已恢复队列；正在确认第 ${this.state.activeIndex + 1} 轮的超短任务空闲状态。`;
                this.idleSince = Date.now();
                this.lockManager.acquireLock(this.currentConversationId);
                this.saveState();
                this.startMonitor();
                return;
            }
            this.state.mode = 'error';
            task.status = 'uncertain';
            this.state.notice = `无法确认第 ${this.state.activeIndex + 1} 轮是否真正开始。点击“开始/恢复”可在确认后重新发送这一轮。`;
            this.saveState();
            return;
        }
        if (stopButton) {
            this.state.mode = 'paused';
            this.state.notice = '检测到页面正在运行非队列回答。请等待它结束后再恢复。';
            this.saveState();
            return;
        }
        this.state.mode = 'running';
        this.state.notice = `队列已恢复，将从第 ${this.state.nextIndex + 1} 轮开始。`;
        this.lockManager.acquireLock(this.currentConversationId);
        this.saveState();
        this.scheduleDispatch(300);
    }
    refreshRuntimeStatus() {
        this.resetDispatchTimer();
        const conversation = this.getConversationStatus({ allowBind: true });
        if (!conversation.ok) {
            this.state.mode = 'paused';
            this.state.notice = '检测到当前页面不是队列绑定的会话，已保持暂停。';
            this.lockManager.releaseLock(this.currentConversationId);
            this.saveState();
            return;
        }
        const task = this.getActiveTask();
        const stopButton = (0, composer_1.findStopButton)();
        if (!task) {
            if (stopButton) {
                this.state.mode = 'paused';
                this.state.notice = '页面正在运行一条非队列回答；队列保持暂停。';
            }
            else if (this.state.tasks.length === 0) {
                this.state.mode = 'idle';
                this.state.notice = 'ChatGPT 当前空闲，尚未载入队列。';
            }
            else if (this.state.nextIndex >= this.state.tasks.length) {
                this.state.mode = 'completed';
                this.state.notice = `ChatGPT 当前空闲，全部 ${this.state.tasks.length} 轮任务均已处理。`;
            }
            else {
                this.state.mode = 'paused';
                this.state.notice = `ChatGPT 当前空闲；下一轮是第 ${this.state.nextIndex + 1} 轮。点击“开始/恢复”后继续。`;
            }
            this.lockManager.releaseLock(this.currentConversationId);
            this.saveState();
            return;
        }
        this.state.mode = 'paused';
        if (stopButton) {
            this.idleSince = 0;
            task.hasSeenStop = true;
            task.status = 'running';
            this.state.notice = `检测到第 ${this.state.activeIndex + 1} 轮仍在运行；后续发送保持暂停。`;
            this.lockManager.acquireLock(this.currentConversationId);
            this.saveState();
            this.startMonitor();
            return;
        }
        if (task.hasSeenStop) {
            task.status = 'running';
            this.idleSince = Date.now();
            this.state.notice = `停止按钮已消失，正在重新确认第 ${this.state.activeIndex + 1} 轮的空闲状态；确认完成后仍保持暂停。`;
            this.lockManager.acquireLock(this.currentConversationId);
            this.saveState();
            this.startMonitor();
            return;
        }
        const editor = (0, composer_1.findEditor)();
        const editorEmpty = Boolean(editor && !(0, parser_1.normalizeText)(editor.innerText));
        const fallbackReady = Boolean(task.inputClearedAfterSubmit &&
            task.submittedAt &&
            Date.now() - task.submittedAt >= constants_1.START_GRACE_MS &&
            editorEmpty);
        if (fallbackReady) {
            task.status = 'submitted';
            this.idleSince = Date.now();
            this.state.notice = `未记录到停止按钮，但输入框已清空；正在确认第 ${this.state.activeIndex + 1} 轮的超短任务空闲状态，确认后仍保持暂停。`;
            this.lockManager.acquireLock(this.currentConversationId);
            this.saveState();
            this.startMonitor();
            return;
        }
        task.status = 'uncertain';
        this.state.mode = 'error';
        this.state.notice = `页面当前空闲，但没有记录到第 ${this.state.activeIndex + 1} 轮的停止按钮，无法自动判定完成。`;
        this.lockManager.releaseLock(this.currentConversationId);
        this.saveState();
    }
    resetActiveTaskForRetry() {
        const task = this.getActiveTask();
        if (!task || (0, composer_1.findStopButton)())
            return false;
        (0, composer_1.clearEditorIfMatches)(task.text);
        const index = this.state.activeIndex;
        task.status = 'pending';
        task.hasSeenStop = false;
        task.inputClearedAfterSubmit = false;
        task.submittedAt = 0;
        task.completedAt = 0;
        this.state.activeIndex = null;
        this.state.nextIndex = index;
        this.state.mode = 'paused';
        this.state.notice = `第 ${index + 1} 轮已重置，将重新发送。`;
        this.idleSince = 0;
        composer_1.internalEditorState.expectedText = '';
        this.sendingEpoch += 1;
        this.stopMonitor();
        this.lockManager.releaseLock(this.currentConversationId);
        this.saveState();
        return true;
    }
    async clearQueue() {
        const activeTask = this.getActiveTask();
        const answerRunning = Boolean(activeTask && (0, composer_1.findStopButton)());
        const inputElement = document.getElementById(`${TaskScheduler.PREFIX}-input`);
        const hasAnything = this.state.tasks.length > 0 || Boolean((0, parser_1.normalizeText)(inputElement?.value || ''));
        if (!hasAnything) {
            this.state.notice = '当前没有可清空的任务。';
            this.saveState();
            return;
        }
        const message = answerRunning
            ? '当前回答仍会继续生成，但脚本将清空本会话的队列并停止后续发送。'
            : '将清空本会话的任务文本、队列和进度。';
        const confirmed = await (0, panel_1.showPanelDialog)({
            title: '清空当前会话队列',
            message,
            confirmText: '清空',
            danger: true,
        }, this.getPanelHandlers());
        if (!confirmed)
            return;
        if (activeTask && !answerRunning)
            (0, composer_1.clearEditorIfMatches)(activeTask.text);
        this.sendingEpoch += 1;
        this.stopMonitor();
        this.resetDispatchTimer();
        this.lockManager.releaseLock(this.currentConversationId);
        this.state = (0, storage_1.createDefaultState)(this.currentConversationId);
        const textarea = document.getElementById(`${TaskScheduler.PREFIX}-input`);
        if (textarea) {
            textarea.value = '';
            textarea.dataset.dirty = 'false';
        }
        this.saveState();
    }
    static PREFIX = 'cg-stq';
    migrateTemporaryStateToConversation(newConversationId) {
        if (this.currentConversationId !== null || !newConversationId)
            return false;
        const temporaryState = this.state;
        const useTemporaryState = (0, storage_1.hasStateContent)(temporaryState) || temporaryState.activeIndex !== null;
        this.lockManager.releaseLock(this.currentConversationId);
        this.currentConversationId = newConversationId;
        if (useTemporaryState) {
            this.state = (0, storage_1.normalizeState)(temporaryState, newConversationId);
            this.state.notice = this.state.activeIndex !== null
                ? this.state.notice
                : '新对话已创建并自动绑定当前任务状态。';
            (0, storage_1.writeStateForContext)(this.state, newConversationId);
        }
        else {
            this.state = (0, storage_1.loadStateForContext)(newConversationId);
            this.reconcileLoadedState('已切换到正式会话');
        }
        try {
            sessionStorage.removeItem('cyan.chatgptSequentialTaskQueue.temporaryState.v2');
            sessionStorage.removeItem('cyan.chatgptSequentialTaskQueue.temporaryLock.v2');
        }
        catch (_) {
            // 忽略临时状态清理失败
        }
        if ((0, storage_1.isLocalConversationId)(newConversationId)) {
            (0, storage_1.rememberInitialBindingIntermediate)(newConversationId, this.tabId);
        }
        else {
            (0, storage_1.clearInitialBindingPending)();
        }
        if (this.lockManager.shouldOwnLock(this.state)) {
            this.lockManager.acquireLock(newConversationId);
        }
        this.locationSnapshot = location.href;
        (0, panel_1.resetPanelForContext)();
        this.render();
        return true;
    }
    migrateInitialBindingIntermediateToFinal(newConversationId) {
        if (!newConversationId || (0, storage_1.isLocalConversationId)(newConversationId))
            return false;
        if (!(0, storage_1.isLocalConversationId)(this.currentConversationId))
            return false;
        const pending = typeof sessionStorage !== 'undefined'
            ? JSON.parse(sessionStorage.getItem('cyan.chatgptSequentialTaskQueue.initialBinding.v1') || 'null')
            : null;
        if (!pending || pending.tabId !== this.tabId)
            return false;
        const intermediateConversationId = this.currentConversationId;
        const migratedState = (0, storage_1.normalizeState)(this.state, newConversationId);
        this.lockManager.releaseLock(this.currentConversationId);
        this.currentConversationId = newConversationId;
        this.state = migratedState;
        this.state.notice = this.state.activeIndex !== null
            ? this.state.notice
            : '新对话已完成正式会话绑定，任务状态已继续保留。';
        (0, storage_1.writeStateForContext)(this.state, newConversationId);
        (0, storage_1.removeConversationStateAndLock)(intermediateConversationId);
        (0, storage_1.clearInitialBindingPending)();
        if (this.lockManager.shouldOwnLock(this.state)) {
            this.lockManager.acquireLock(newConversationId);
        }
        this.locationSnapshot = location.href;
        (0, panel_1.resetPanelForContext)();
        this.render();
        return true;
    }
    pauseCurrentContextBeforeLeaving() {
        if (!this.lockManager.ownsLock(this.currentConversationId))
            return;
        this.resetDispatchTimer();
        this.stopMonitor();
        if (this.state.mode === 'running' || this.state.mode === 'pausing') {
            this.state.mode = 'paused';
            this.state.notice = this.state.activeIndex !== null
                ? '已离开此会话；当前轮状态保留，返回后请先刷新状态。'
                : '已离开此会话，队列已暂停。';
            (0, storage_1.writeStateForContext)(this.state, this.currentConversationId);
        }
    }
    switchToConversationContext(newConversationId) {
        if (newConversationId === this.currentConversationId)
            return;
        if (this.currentConversationId === null && newConversationId) {
            if (this.migrateTemporaryStateToConversation(newConversationId))
                return;
        }
        if (newConversationId && this.migrateInitialBindingIntermediateToFinal(newConversationId))
            return;
        this.pauseCurrentContextBeforeLeaving();
        this.sendingEpoch += 1;
        this.stopMonitor();
        this.resetDispatchTimer();
        this.lockManager.releaseLock(this.currentConversationId);
        this.currentConversationId = newConversationId;
        this.state = (0, storage_1.loadStateForContext)(newConversationId);
        this.reconcileLoadedState('已切换会话');
        (0, panel_1.resetPanelForContext)();
        this.render();
    }
    handleLocationChange() {
        const newHref = location.href;
        const newConversationId = (0, storage_1.getConversationId)();
        if (newHref === this.locationSnapshot && newConversationId === this.currentConversationId)
            return;
        this.locationSnapshot = newHref;
        this.switchToConversationContext(newConversationId);
        (0, launcher_1.startLauncherWaitObserver)(() => this.render());
        (0, launcher_1.scheduleLauncherMountRetries)(() => this.render());
    }
    handleTrustedEditorInput(event) {
        if (!event.isTrusted)
            return;
        const target = event.target;
        if (!target?.closest?.('[data-composer-markdown][contenteditable="true"][role="textbox"]'))
            return;
        if (this.state.mode !== 'running' && this.state.mode !== 'pausing')
            return;
        if (composer_1.internalEditorState.active)
            return;
        const editorText = (0, parser_1.normalizeText)(target.innerText || '');
        if (!editorText)
            return;
        if (composer_1.internalEditorState.expectedText && editorText === composer_1.internalEditorState.expectedText)
            return;
        this.resetDispatchTimer();
        this.state.mode = 'paused';
        this.state.notice = '检测到用户手动编辑输入框，队列已暂停以避免冲突。';
        if (this.state.activeIndex === null)
            this.lockManager.releaseLock(this.currentConversationId);
        this.saveState();
    }
    recoverRuntime() {
        (0, panel_1.createPanel)(this.getPanelHandlers());
        (0, launcher_1.scheduleLauncherMountRetries)(() => this.render());
        this.handleLocationChange();
        if (this.state.activeIndex !== null) {
            if (this.lockManager.acquireLock(this.currentConversationId))
                this.startMonitor();
        }
        else if (this.state.mode === 'running') {
            if (this.lockManager.acquireLock(this.currentConversationId))
                this.catchUpScheduledDispatch();
        }
        else if (!this.lockManager.shouldOwnLock(this.state)) {
            this.lockManager.releaseLock(this.currentConversationId);
        }
        this.render();
    }
    getPanelHandlers() {
        return {
            onStart: () => void this.startOrResumeQueue(),
            onPause: () => this.pauseQueue(),
            onRefresh: () => this.refreshRuntimeStatus(),
            onClear: () => void this.clearQueue(),
            onDraftChange: (draft) => {
                this.state.draftText = draft;
                this.saveState({ render: false });
                this.render();
            },
            onDelayChange: (delayMs) => {
                this.state.delayMs = delayMs;
                this.saveState();
            },
            renderPanel: () => this.render(),
        };
    }
}
exports.TaskScheduler = TaskScheduler;

},
"main":function(require,module,exports){
"use strict";
// ==UserScript==
// @name         ChatGPT 顺序任务助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js
// @downloadURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js
// @version      1.5.0
// @description  在 ChatGPT 中按会话保存并顺序执行任务队列；支持多行 Prompt、后台标签页推进及独立会话状态。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("./constants");
const launcher_1 = require("./launcher");
const panel_1 = require("./panel");
const scheduler_1 = require("./scheduler");
const storage_1 = require("./storage");
(() => {
    'use strict';
    const tabId = (0, storage_1.getOrCreateTabId)();
    const scheduler = new scheduler_1.TaskScheduler(tabId);
    function installHistoryHooks() {
        for (const methodName of ['pushState', 'replaceState']) {
            const original = history[methodName];
            if (typeof original !== 'function' || original.__cgStqWrapped)
                continue;
            const wrapped = function (...args) {
                const result = original.apply(this, args);
                window.queueMicrotask(() => scheduler.handleLocationChange());
                return result;
            };
            Object.defineProperty(wrapped, '__cgStqWrapped', {
                value: true,
            });
            try {
                history[methodName] = wrapped;
            }
            catch (error) {
                console.warn(`[ChatGPT 顺序任务助手] 无法包装 history.${methodName}。`, error);
            }
        }
    }
    const bodyObserver = new MutationObserver(() => {
        if (!document.getElementById(constants_1.PANEL_ID) && document.body) {
            (0, panel_1.createPanel)(scheduler.getPanelHandlers());
        }
    });
    if (document.body) {
        bodyObserver.observe(document.body, {
            childList: true,
        });
    }
    installHistoryHooks();
    (0, launcher_1.startLauncherIntegrityWatch)(() => scheduler.render());
    document.addEventListener('input', (event) => scheduler.handleTrustedEditorInput(event), true);
    document.addEventListener('keydown', panel_1.handleDialogKeydown, true);
    window.addEventListener('popstate', () => scheduler.handleLocationChange());
    window.addEventListener('focus', () => scheduler.recoverRuntime());
    window.addEventListener('pageshow', () => scheduler.recoverRuntime());
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden)
            scheduler.recoverRuntime();
    });
    window.addEventListener('storage', (event) => {
        if (!scheduler.currentConversationId)
            return;
        const currentStateKey = (0, storage_1.getStateStorageKey)(scheduler.currentConversationId);
        const currentLockKey = (0, storage_1.getLockStorageKey)(scheduler.currentConversationId);
        if (event.key === currentStateKey) {
            try {
                scheduler.state = event.newValue
                    ? (0, storage_1.normalizeState)(JSON.parse(event.newValue), scheduler.currentConversationId)
                    : (0, storage_1.createDefaultState)(scheduler.currentConversationId);
                if (scheduler.lockManager.ownsLock(scheduler.currentConversationId) &&
                    scheduler.state.activeIndex !== null) {
                    scheduler.startMonitor();
                }
                else if (!scheduler.lockManager.shouldOwnLock(scheduler.state)) {
                    scheduler.stopMonitor();
                    scheduler.resetDispatchTimer();
                    scheduler.lockManager.releaseLock(scheduler.currentConversationId);
                }
                scheduler.render();
            }
            catch (_) {
                // 忽略其他标签页写入的无效状态
            }
        }
        if (event.key === currentLockKey)
            scheduler.render();
    });
    window.__cgSequentialTaskQueue = {
        version: constants_1.VERSION,
        getState() {
            return {
                conversationId: scheduler.currentConversationId,
                lockOwnedByThisTab: scheduler.lockManager.ownsLock(scheduler.currentConversationId),
                state: JSON.parse(JSON.stringify(scheduler.state)),
            };
        },
        pause: () => scheduler.pauseQueue(),
        start: () => scheduler.startOrResumeQueue(),
        resume: () => scheduler.resumeQueue(),
        refresh: () => scheduler.refreshRuntimeStatus(),
    };
    scheduler.recoverRuntime();
})();

}};const cache={};function get(name){const key=(name.startsWith('./')?name.slice(2):name);if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn(get,m,m.exports);return m.exports;}get('main');})();

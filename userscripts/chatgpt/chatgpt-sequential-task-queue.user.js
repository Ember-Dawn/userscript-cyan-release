// ==UserScript==
// @name         ChatGPT 顺序任务助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js
// @version      1.3.8
// @description  在 ChatGPT 中按会话保存并顺序执行任务队列；支持多行 Prompt、统一稳定写入及独立会话状态。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
脚本说明：

1. 任务输入
 - 面板默认收起为右下角圆角矩形进度按钮；点击按钮展开。
 - 支持两种输入方式：有单独一行 --- 时按 Prompt 块分隔，每个块可包含多行；没有 --- 时仍按每个非空行作为一轮独立命令。
 - 已有队列时若修改任务文本，进度条保留当前执行进度，并额外显示草稿任务数；确认替换后才重置正式队列。
 - “开始/恢复”会自动载入新任务、恢复现有队列，或通过面板内确认框替换已修改的队列。

2. 顺序执行
 - 脚本通过 ProseMirror 的粘贴处理路径统一写入 Prompt，等待输入框出现内容并完成同步后再点击发送按钮。
 - 每轮优先观察 data-testid="stop-button"；看到停止按钮后，等待其消失并保持空闲 3 秒，再按设置的额外秒数等待后发送下一轮。
 - 若发送后输入框已确认清空，但前 8 秒始终未捕获停止按钮，则在输入框继续为空且停止按钮持续不存在 3 秒后，按超短任务已完成处理。
 - 脚本不读取、提取或判断回答正文，只观察输入框、停止按钮和当前会话地址。

3. 暂停与恢复
 - “暂停”只阻止发送下一轮，不会点击 ChatGPT 自带的停止按钮。
 - 若第 4 轮已经发出，点击暂停后仍等待第 4 轮完成；恢复时从第 5 轮开始。
 - 页面重新加载且没有其他标签页接管时，队列会安全恢复为暂停状态。

4. 会话隔离
 - 每个 /c/会话ID 拥有独立的任务文本、进度、等待时间和运行锁。
 - 同一标签页切换对话时，面板自动切换到对应对话的状态。
 - 新对话尚无 ID 时使用当前标签页的临时状态；首次消息创建 ID 后自动迁移并绑定。
 - 不同对话可以分别运行；同一对话在多个标签页中只允许一个标签页实际发送。

5. 界面
 - 所有确认和提示均显示在展开面板正中央，不使用浏览器原生弹窗。
 - 已完成进度为绿色，当前执行轮次为黄色，未执行部分为灰色；收起后的圆角矩形按钮以整块背景显示相同进度语义，文字直接覆盖在进度背景上。
 - 收起按钮与 ChatGPT 长对话优化助手右对齐并位于其上方，避免同时启用时重叠。
 - 展开后只保留“开始/恢复、暂停、刷新状态、清空”四个操作按钮。

6. 调试方法
 - 可在 Console 运行：window.__cgSequentialTaskQueue.getState()
*/

(() => {
  'use strict';

  const VERSION = '1.3.8';
  const PREFIX = 'cg-stq';
  const LEGACY_STORAGE_KEY = 'cyan.chatgptSequentialTaskQueue.v1';
  const STATE_KEY_PREFIX = 'cyan.chatgptSequentialTaskQueue.state.v2.';
  const TEMP_STATE_KEY = 'cyan.chatgptSequentialTaskQueue.temporaryState.v2';
  const LOCK_KEY_PREFIX = 'cyan.chatgptSequentialTaskQueue.lock.v2.';
  const TEMP_LOCK_KEY = 'cyan.chatgptSequentialTaskQueue.temporaryLock.v2';
  const TAB_ID_KEY = 'cyan.chatgptSequentialTaskQueue.tabId.v1';

  const PANEL_ID = `${PREFIX}-panel`;
  const STYLE_ID = `${PREFIX}-style`;
  const COMPOSER_SELECTOR = '[data-composer-surface="true"]';
  const EDITOR_SELECTOR = '#prompt-textarea[contenteditable="true"]';
  const STOP_BUTTON_SELECTOR = [
    'button[data-testid="stop-button"]',
    'button[aria-label="停止回答"]',
    'button[aria-label="Stop generating"]',
  ].join(', ');
  const SUBMIT_BUTTON_SELECTOR = 'button#composer-submit-button:not([data-testid="stop-button"])';

  const MONITOR_INTERVAL_MS = 400;
  const START_TIMEOUT_MS = 30000;
  const SEND_BUTTON_TIMEOUT_MS = 8000;
  const EDITOR_WRITE_TIMEOUT_MS = 5000;
  const EDITOR_WRITE_POLL_MS = 50;
  const START_GRACE_MS = 8000;
  const IDLE_STABLE_MS = 3000;
  const DEFAULT_BETWEEN_TASK_DELAY_MS = 3000;
  const LOCK_STALE_MS = 15000;
  const LOCK_HEARTBEAT_MS = 5000;

  const STATUS_LABELS = {
    pending: '待执行',
    sending: '正在发送',
    submitted: '已发送，等待开始',
    running: '正在运行',
    completed: '已完成',
    uncertain: '状态待确认',
    failed: '失败',
    skipped: '已跳过',
  };

  const MODE_LABELS = {
    idle: '未开始',
    running: '运行中',
    pausing: '等待暂停',
    paused: '已暂停',
    completed: '已完成',
    error: '状态异常',
  };

  let monitorTimer = null;
  let dispatchTimer = null;
  let lockHeartbeatTimer = null;
  let ownedLockConversationId = undefined;
  let ownedLockKey = null;
  let idleSince = 0;
  let sendingEpoch = 0;
  let internalEditorWriteActive = false;
  let internalEditorExpectedText = '';
  let locationSnapshot = location.href;
  let dialogResolver = null;

  const tabId = getOrCreateTabId();
  let currentConversationId = getConversationId();
  let state = loadStateForContext(currentConversationId);
  reconcileLoadedState('页面已重新加载');

  function createDefaultState(conversationId = currentConversationId) {
    return {
      version: 2,
      sourceText: '',
      draftText: '',
      tasks: [],
      nextIndex: 0,
      activeIndex: null,
      mode: 'idle',
      conversationId: conversationId || null,
      delayMs: DEFAULT_BETWEEN_TASK_DELAY_MS,
      notice: '请粘贴任务；多行 Prompt 可用单独一行 --- 分隔。',
      createdAt: 0,
      updatedAt: Date.now(),
    };
  }

  function sanitizeTask(task, index) {
    const validStatus = Object.prototype.hasOwnProperty.call(STATUS_LABELS, task?.status)
      ? task.status
      : 'pending';

    return {
      id: Number.isInteger(task?.id) ? task.id : index + 1,
      text: typeof task?.text === 'string' ? task.text : '',
      status: validStatus === 'skipped' ? 'completed' : validStatus,
      hasSeenStop: Boolean(task?.hasSeenStop),
      inputClearedAfterSubmit: Boolean(task?.inputClearedAfterSubmit),
      submittedAt: Number(task?.submittedAt) || 0,
      completedAt: Number(task?.completedAt) || 0,
    };
  }

  function normalizeState(raw, conversationId = currentConversationId) {
    const fallback = createDefaultState(conversationId);
    if (!raw || typeof raw !== 'object') return fallback;

    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks.map(sanitizeTask).filter((task) => task.text.trim())
      : [];
    const sourceText = typeof raw.sourceText === 'string'
      ? raw.sourceText
      : tasks.map((task) => task.text).join('\n');
    const nextIndex = clampInteger(raw.nextIndex, 0, tasks.length);
    const activeIndex = Number.isInteger(raw.activeIndex) && raw.activeIndex >= 0 && raw.activeIndex < tasks.length
      ? raw.activeIndex
      : null;
    const validMode = Object.prototype.hasOwnProperty.call(MODE_LABELS, raw.mode)
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
      delayMs: clampInteger(raw.delayMs, 1000, 30000, DEFAULT_BETWEEN_TASK_DELAY_MS),
      notice: typeof raw.notice === 'string' ? raw.notice : fallback.notice,
      createdAt: Number(raw.createdAt) || 0,
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
  }

  function clampInteger(value, min, max, fallback = min) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function getOrCreateTabId() {
    try {
      const existing = sessionStorage.getItem(TAB_ID_KEY);
      if (existing) return existing;

      const generated = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(TAB_ID_KEY, generated);
      return generated;
    } catch (_) {
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
      ? `${STATE_KEY_PREFIX}${encodeURIComponent(conversationId)}`
      : TEMP_STATE_KEY;
  }

  function getLockStorage(conversationId) {
    return conversationId ? localStorage : sessionStorage;
  }

  function getLockStorageKey(conversationId) {
    return conversationId
      ? `${LOCK_KEY_PREFIX}${encodeURIComponent(conversationId)}`
      : TEMP_LOCK_KEY;
  }

  function tryLoadLegacyState(conversationId) {
    try {
      const raw = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return null;

      const legacyId = typeof raw.conversationId === 'string' && raw.conversationId
        ? raw.conversationId
        : null;

      if (legacyId !== (conversationId || null)) return null;
      return normalizeState(raw, conversationId);
    } catch (_) {
      return null;
    }
  }

  function loadStateForContext(conversationId) {
    try {
      const storage = getStateStorage(conversationId);
      const key = getStateStorageKey(conversationId);
      const parsed = JSON.parse(storage.getItem(key) || 'null');
      if (parsed) return normalizeState(parsed, conversationId);

      const legacy = tryLoadLegacyState(conversationId);
      if (legacy) {
        storage.setItem(key, JSON.stringify(legacy));
        return legacy;
      }
    } catch (error) {
      console.warn('[ChatGPT 顺序任务助手] 无法读取当前会话状态。', error);
    }

    return createDefaultState(conversationId);
  }

  function writeStateForContext(targetState, conversationId, { render = false } = {}) {
    targetState.version = 2;
    targetState.conversationId = conversationId || null;
    targetState.updatedAt = Date.now();

    try {
      getStateStorage(conversationId).setItem(
        getStateStorageKey(conversationId),
        JSON.stringify(targetState)
      );
    } catch (error) {
      console.warn('[ChatGPT 顺序任务助手] 无法保存当前会话状态。', error);
    }

    if (render) renderPanel();
  }

  function saveState({ render = true } = {}) {
    writeStateForContext(state, currentConversationId, { render });
  }

  function hasStateContent(targetState) {
    return Boolean(
      targetState.tasks.length ||
      normalizeText(targetState.draftText) ||
      normalizeText(targetState.sourceText)
    );
  }

  function readLock(conversationId = currentConversationId) {
    try {
      return JSON.parse(
        getLockStorage(conversationId).getItem(getLockStorageKey(conversationId)) || 'null'
      );
    } catch (_) {
      return null;
    }
  }
  function isLockFresh(lock) {
    return Boolean(lock && Date.now() - Number(lock.updatedAt || 0) < LOCK_STALE_MS);
  }

  function isForeignLockActive(conversationId = currentConversationId) {
    const lock = readLock(conversationId);
    return Boolean(lock?.tabId && lock.tabId !== tabId && isLockFresh(lock));
  }

  function ownsLock(conversationId = currentConversationId) {
    const lock = readLock(conversationId);
    return Boolean(lock?.tabId === tabId && isLockFresh(lock));
  }

  function acquireLock() {
    if (isForeignLockActive()) return false;

    const key = getLockStorageKey(currentConversationId);

    try {
      const storage = getLockStorage(currentConversationId);
      storage.setItem(key, JSON.stringify({
        tabId,
        updatedAt: Date.now(),
      }));
      ownedLockConversationId = currentConversationId;
      ownedLockKey = key;
      startLockHeartbeat();
      return true;
    } catch (_) {
      return true;
    }
  }

  function refreshLock() {
    if (!ownedLockKey) return;

    const storage = getLockStorage(ownedLockConversationId);
    const lock = readLock(ownedLockConversationId);
    if (lock?.tabId !== tabId) {
      stopLockHeartbeat();
      ownedLockKey = null;
      ownedLockConversationId = undefined;
      return;
    }

    try {
      storage.setItem(ownedLockKey, JSON.stringify({
        tabId,
        updatedAt: Date.now(),
      }));
    } catch (_) {
      // 存储暂时不可用时不阻断当前页面运行。
    }
  }

  function releaseLock() {
    stopLockHeartbeat();

    const conversationId = ownedLockKey ? ownedLockConversationId : currentConversationId;
    const key = ownedLockKey || getLockStorageKey(conversationId);

    try {
      const storage = getLockStorage(conversationId);
      const lock = JSON.parse(storage.getItem(key) || 'null');
      if (lock?.tabId === tabId) storage.removeItem(key);
    } catch (_) {
      // 旧锁会在超时后自动失效。
    }

    ownedLockKey = null;
    ownedLockConversationId = undefined;
  }

  function startLockHeartbeat() {
    if (lockHeartbeatTimer !== null) return;
    lockHeartbeatTimer = window.setInterval(refreshLock, LOCK_HEARTBEAT_MS);
  }

  function stopLockHeartbeat() {
    if (lockHeartbeatTimer !== null) {
      window.clearInterval(lockHeartbeatTimer);
      lockHeartbeatTimer = null;
    }
  }

  function shouldOwnLock() {
    return state.mode === 'running' || state.mode === 'pausing' || state.activeIndex !== null;
  }

  function syncLockToState() {
    if (shouldOwnLock()) acquireLock();
    else releaseLock();
  }

  function reconcileLoadedState(reason) {
    if (state.mode !== 'running' && state.mode !== 'pausing') return;
    if (isForeignLockActive(currentConversationId)) return;

    state.mode = 'paused';
    state.notice = `${reason}，当前会话队列已安全暂停。请刷新状态后再决定是否恢复。`;
    writeStateForContext(state, currentConversationId);
    releaseLock();
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

  function normalizeText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getConversationStatus({ allowBind = true } = {}) {
    const currentId = getConversationId();

    if (allowBind && currentConversationId === null && currentId) {
      migrateTemporaryStateToConversation(currentId);
    }

    return {
      ok: currentId === currentConversationId,
      currentId,
      expectedId: currentConversationId,
    };
  }

  function resetPanelForContext() {
    const panel = document.getElementById(PANEL_ID);
    const textarea = panel?.querySelector(`#${PREFIX}-input`);
    const details = panel?.querySelector(`[data-field="details"]`);

    if (textarea) {
      textarea.dataset.initialized = 'false';
      textarea.dataset.dirty = 'false';
    }
    if (details) details.open = false;
    closePanelDialog(false);
  }

  function migrateTemporaryStateToConversation(newConversationId) {
    if (currentConversationId !== null || !newConversationId) return false;

    const temporaryState = state;
    const useTemporaryState = hasStateContent(temporaryState) || temporaryState.activeIndex !== null;

    releaseLock();
    currentConversationId = newConversationId;

    if (useTemporaryState) {
      state = normalizeState(temporaryState, newConversationId);
      state.notice = state.activeIndex !== null
        ? state.notice
        : '新对话已创建并自动绑定当前任务状态。';
      writeStateForContext(state, newConversationId);
    } else {
      state = loadStateForContext(newConversationId);
      reconcileLoadedState('已切换到正式会话');
    }

    try {
      sessionStorage.removeItem(TEMP_STATE_KEY);
      sessionStorage.removeItem(TEMP_LOCK_KEY);
    } catch (_) {
      // 忽略临时状态清理失败。
    }

    if (shouldOwnLock()) acquireLock();
    locationSnapshot = location.href;
    resetPanelForContext();
    renderPanel();
    return true;
  }

  function pauseCurrentContextBeforeLeaving() {
    if (!ownsLock(currentConversationId)) return;

    resetDispatchTimer();
    stopMonitor();

    if (state.mode === 'running' || state.mode === 'pausing') {
      state.mode = 'paused';
      state.notice = state.activeIndex !== null
        ? '已离开此会话；当前轮状态保留，返回后请先刷新状态。'
        : '已离开此会话，队列已暂停。';
      writeStateForContext(state, currentConversationId);
    }
  }

  function switchToConversationContext(newConversationId) {
    if (newConversationId === currentConversationId) return;

    if (currentConversationId === null && newConversationId) {
      if (migrateTemporaryStateToConversation(newConversationId)) return;
    }

    pauseCurrentContextBeforeLeaving();
    sendingEpoch += 1;
    stopMonitor();
    resetDispatchTimer();
    releaseLock();

    currentConversationId = newConversationId;
    state = loadStateForContext(newConversationId);
    reconcileLoadedState('已切换会话');
    resetPanelForContext();
    renderPanel();
  }

  function isVisibleAndEnabled(element) {
    if (
      !element ||
      !element.isConnected ||
      element.disabled ||
      element.getAttribute('aria-disabled') === 'true'
    ) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function findVisibleElement(selector) {
    return Array.from(document.querySelectorAll(selector)).find(isVisibleAndEnabled) || null;
  }

  function findComposer() {
    return Array.from(document.querySelectorAll(COMPOSER_SELECTOR)).find((element) => {
      const rect = element.getBoundingClientRect();
      return element.isConnected && rect.width > 0 && rect.height > 0;
    }) || null;
  }

  function findEditor() {
    const composer = findComposer();
    const editor = composer?.querySelector(EDITOR_SELECTOR) || document.querySelector(EDITOR_SELECTOR);
    return editor instanceof HTMLElement && editor.isContentEditable ? editor : null;
  }

  function findStopButton() {
    const composer = findComposer();
    const localButton = composer?.querySelector(STOP_BUTTON_SELECTOR);
    if (isVisibleAndEnabled(localButton)) return localButton;
    return findVisibleElement(STOP_BUTTON_SELECTOR);
  }

  function findSubmitButton() {
    const composer = findComposer();
    const localButton = composer?.querySelector(SUBMIT_BUTTON_SELECTOR);
    if (isVisibleAndEnabled(localButton)) return localButton;
    return findVisibleElement(SUBMIT_BUTTON_SELECTOR);
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

  function waitForEditorSettlement() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.setTimeout(resolve, 0);
        });
      });
    });
  }

  async function setEditorText(editor, text) {
    editor.focus();
    selectEditorContents(editor);
    internalEditorWriteActive = true;
    internalEditorExpectedText = normalizeText(text);

    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });

      editor.dispatchEvent(pasteEvent);

      const populated = await waitFor(
        () => editor.isConnected && (editor.textContent || '').length > 0,
        EDITOR_WRITE_TIMEOUT_MS,
        EDITOR_WRITE_POLL_MS
      );
      if (!populated) return false;

      await waitForEditorSettlement();
      return editor.isConnected && (editor.textContent || '').length > 0;
    } catch (_) {
      return false;
    } finally {
      internalEditorWriteActive = false;
    }
  }

  function clearEditorIfMatches(text) {
    const editor = findEditor();
    if (!editor || normalizeText(editor.innerText) !== normalizeText(text)) return;

    editor.focus();
    selectEditorContents(editor);
    internalEditorWriteActive = true;
    internalEditorExpectedText = '';

    try {
      try {
        document.execCommand('delete', false);
      } catch (_) {
        editor.replaceChildren(document.createElement('p'));
        editor.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward',
          data: null,
        }));
      }
    } finally {
      internalEditorWriteActive = false;
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

  function getActiveTask() {
    if (state.activeIndex === null) return null;
    return state.tasks[state.activeIndex] || null;
  }

  function markError(message, { taskStatus = 'failed' } = {}) {
    const task = getActiveTask();
    if (task && task.status !== 'completed' && task.status !== 'skipped') {
      task.status = taskStatus;
    }

    state.mode = 'error';
    state.notice = message;
    idleSince = 0;
    internalEditorExpectedText = '';
    stopMonitor();
    releaseLock();
    saveState();
  }

  function resetDispatchTimer() {
    if (dispatchTimer !== null) {
      window.clearTimeout(dispatchTimer);
      dispatchTimer = null;
    }
  }

  function scheduleDispatch(delayMs = 300) {
    resetDispatchTimer();

    dispatchTimer = window.setTimeout(() => {
      dispatchTimer = null;
      void dispatchNextTask();
    }, delayMs);
  }

  async function dispatchNextTask() {
    if (state.mode !== 'running' || state.activeIndex !== null) return;

    if (state.nextIndex >= state.tasks.length) {
      finishQueue();
      return;
    }

    if (!acquireLock()) {
      state.mode = 'paused';
      state.notice = '另一个 ChatGPT 标签页正在接管该队列，本页已暂停。';
      saveState();
      return;
    }

    const conversation = getConversationStatus({ allowBind: true });
    if (!conversation.ok) {
      state.mode = 'paused';
      state.notice = '检测到已切换到其他 ChatGPT 会话，队列已暂停。请返回原会话后刷新状态。';
      releaseLock();
      saveState();
      return;
    }

    if (findStopButton()) {
      state.mode = 'paused';
      state.notice = '页面正在运行一条非队列回答。为避免误判，队列已暂停。';
      releaseLock();
      saveState();
      return;
    }

    const editor = findEditor();
    if (!editor) {
      markError('未找到 ChatGPT 输入框，无法发送下一轮。请刷新页面后重试。');
      return;
    }

    if (normalizeText(editor.innerText)) {
      state.mode = 'paused';
      state.notice = '输入框中已有文字，队列不会覆盖用户内容。请处理后再恢复。';
      releaseLock();
      saveState();
      return;
    }

    const index = state.nextIndex;
    const task = state.tasks[index];
    const epoch = ++sendingEpoch;

    state.activeIndex = index;
    idleSince = 0;
    task.status = 'sending';
    task.hasSeenStop = false;
    task.inputClearedAfterSubmit = false;
    task.submittedAt = 0;
    task.completedAt = 0;
    state.notice = `正在发送第 ${index + 1} / ${state.tasks.length} 轮。`;
    saveState();

    const inserted = await setEditorText(editor, task.text);
    if (!inserted) {
      markError(`第 ${index + 1} 轮写入输入框失败。`, { taskStatus: 'failed' });
      return;
    }

    const submitButton = await waitFor(findSubmitButton, SEND_BUTTON_TIMEOUT_MS, 100);

    if (epoch !== sendingEpoch || state.activeIndex !== index) return;

    if (!submitButton) {
      markError(`第 ${index + 1} 轮已写入输入框，但未找到可用的发送按钮。`, {
        taskStatus: 'failed',
      });
      return;
    }

    safeClick(submitButton);
    task.status = 'submitted';
    task.submittedAt = Date.now();
    state.notice = `第 ${index + 1} 轮已发送，正在等待 ChatGPT 开始运行。`;
    saveState();
    startMonitor();
  }

  function startMonitor() {
    if (monitorTimer !== null) return;

    const tick = () => {
      monitorTimer = null;
      monitorActiveTask();

      if (state.activeIndex !== null) {
        monitorTimer = window.setTimeout(tick, MONITOR_INTERVAL_MS);
      }
    };

    monitorTimer = window.setTimeout(tick, 0);
  }

  function stopMonitor() {
    if (monitorTimer !== null) {
      window.clearTimeout(monitorTimer);
      monitorTimer = null;
    }
  }

  function monitorActiveTask() {
    const task = getActiveTask();
    if (!task) {
      stopMonitor();
      return;
    }

    const conversation = getConversationStatus({ allowBind: true });
    if (!conversation.ok) {
      state.mode = 'paused';
      state.notice = '当前页面已离开队列绑定的会话。任务状态保持不变，请返回原会话后刷新状态。';
      saveState();
      stopMonitor();
      return;
    }

    const stopButton = findStopButton();
    const editor = findEditor();
    const editorEmpty = Boolean(editor && !normalizeText(editor.innerText));

    if (!task.inputClearedAfterSubmit && task.submittedAt && editorEmpty) {
      task.inputClearedAfterSubmit = true;
      internalEditorExpectedText = '';
      saveState({ render: false });
    }

    if (stopButton) {
      idleSince = 0;

      if (!task.hasSeenStop || task.status !== 'running') {
        task.hasSeenStop = true;
        task.status = 'running';
        state.notice = `第 ${state.activeIndex + 1} / ${state.tasks.length} 轮正在运行。`;
        saveState();
      }

      return;
    }

    if (task.hasSeenStop) {
      if (!idleSince) {
        idleSince = Date.now();
        state.notice = `第 ${state.activeIndex + 1} 轮的停止按钮已消失，正在确认空闲状态。`;
        saveState();
        return;
      }

      if (Date.now() - idleSince >= IDLE_STABLE_MS) {
        completeActiveTask();
      }

      return;
    }

    const elapsedSinceSubmit = task.submittedAt ? Date.now() - task.submittedAt : 0;
    const shortTaskFallbackReady = Boolean(
      task.inputClearedAfterSubmit &&
      elapsedSinceSubmit >= START_GRACE_MS
    );

    if (shortTaskFallbackReady) {
      if (!editorEmpty) {
        idleSince = 0;
      } else if (!idleSince) {
        idleSince = Date.now();
        state.notice = `第 ${state.activeIndex + 1} 轮未捕获到停止按钮，输入框已清空；正在确认超短任务空闲状态。`;
        saveState();
        return;
      } else if (Date.now() - idleSince >= IDLE_STABLE_MS) {
        completeActiveTask();
        return;
      }
    }

    if (task.submittedAt && elapsedSinceSubmit >= START_TIMEOUT_MS) {
      markError(
        `第 ${state.activeIndex + 1} 轮发送后 ${Math.round(START_TIMEOUT_MS / 1000)} 秒内既未检测到停止按钮，也未满足超短任务完成条件，无法确认任务状态。`,
        { taskStatus: 'uncertain' }
      );
    }
  }

  function completeActiveTask() {
    const index = state.activeIndex;
    const task = getActiveTask();
    if (index === null || !task) return;

    task.status = 'completed';
    task.completedAt = Date.now();
    state.activeIndex = null;
    state.nextIndex = Math.max(state.nextIndex, index + 1);
    idleSince = 0;
    stopMonitor();

    if (state.nextIndex >= state.tasks.length) {
      finishQueue();
      return;
    }

    if (state.mode === 'running') {
      state.notice = `第 ${index + 1} 轮已完成，将在 ${Math.round(state.delayMs / 1000)} 秒后发送第 ${state.nextIndex + 1} 轮。`;
      saveState();
      scheduleDispatch(state.delayMs);
      return;
    }

    state.mode = 'paused';
    state.notice = `第 ${index + 1} 轮已完成，队列保持暂停；恢复时将从第 ${state.nextIndex + 1} 轮开始。`;
    releaseLock();
    saveState();
  }

  function finishQueue() {
    state.activeIndex = null;
    state.nextIndex = state.tasks.length;
    state.mode = 'completed';
    state.notice = `全部 ${state.tasks.length} 轮任务已完成。`;
    idleSince = 0;
    internalEditorExpectedText = '';
    stopMonitor();
    resetDispatchTimer();
    releaseLock();
    saveState();
  }

  function readPanelQueueDraft() {
    const textarea = document.getElementById(`${PREFIX}-input`);
    const delayInput = document.getElementById(`${PREFIX}-delay`);
    const inputText = textarea?.value || '';
    const lines = parseTasks(inputText);

    return {
      textarea,
      lines,
      sourceText: getTaskSourceText(inputText),
      draftText: inputText,
      delayMs: clampInteger(
        Number(delayInput?.value) * 1000,
        1000,
        30000,
        DEFAULT_BETWEEN_TASK_DELAY_MS
      ),
    };
  }

  function replaceQueueFromPanel(draft) {
    sendingEpoch += 1;
    stopMonitor();
    resetDispatchTimer();
    releaseLock();

    const now = Date.now();
    state = {
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
      conversationId: currentConversationId,
      delayMs: draft.delayMs,
      notice: `已载入 ${draft.lines.length} 条任务，准备从第 1 轮开始。`,
      createdAt: now,
      updatedAt: now,
    };

    if (draft.textarea) {
      draft.textarea.value = state.draftText;
      draft.textarea.dataset.dirty = 'false';
    }

    saveState();
  }

  async function startOrResumeQueue() {
    const draft = readPanelQueueDraft();
    const hasQueue = state.tasks.length > 0;
    const sourceChanged = draft.sourceText !== state.sourceText;
    const queueFinished = state.activeIndex === null && state.nextIndex >= state.tasks.length;
    const activeTask = getActiveTask();
    const stopButton = findStopButton();

    if (state.mode === 'running' || state.mode === 'pausing' || (activeTask && stopButton)) {
      return;
    }

    if (!hasQueue) {
      if (draft.lines.length === 0) {
        await showPanelDialog({
          title: '没有可执行的任务',
          message: '请粘贴任务；多行 Prompt 可用单独一行 --- 分隔。',
          alertOnly: true,
        });
        return;
      }

      replaceQueueFromPanel(draft);
      resumeQueue();
      return;
    }

    if (queueFinished) {
      if (draft.lines.length === 0) {
        await showPanelDialog({
          title: '任务输入为空',
          message: '请粘贴新任务后再开始。',
          alertOnly: true,
        });
        return;
      }

      const message = sourceChanged
        ? `将载入 ${draft.lines.length} 条新任务并从第 1 轮开始。`
        : `当前队列已经完成，将重新执行这 ${draft.lines.length} 条任务。`;

      const confirmed = await showPanelDialog({
        title: sourceChanged ? '替换已完成队列' : '重新执行队列',
        message,
        confirmText: '继续',
      });
      if (!confirmed) return;

      replaceQueueFromPanel(draft);
      resumeQueue();
      return;
    }

    if (sourceChanged) {
      if (draft.lines.length === 0) {
        await showPanelDialog({
          title: '无法替换队列',
          message: '修改后的任务输入为空。',
          alertOnly: true,
        });
        return;
      }

      const confirmed = await showPanelDialog({
        title: '替换当前队列',
        message: `任务文本已修改。将用 ${draft.lines.length} 条任务替换当前队列，并从第 1 轮开始。`,
        confirmText: '替换并开始',
        danger: true,
      });
      if (!confirmed) return;

      replaceQueueFromPanel(draft);
      resumeQueue();
      return;
    }

    if (activeTask && !stopButton && !activeTask.hasSeenStop) {
      const editor = findEditor();
      const fallbackReady = Boolean(
        activeTask.inputClearedAfterSubmit &&
        activeTask.submittedAt &&
        Date.now() - activeTask.submittedAt >= START_GRACE_MS &&
        editor &&
        !normalizeText(editor.innerText)
      );

      if (!fallbackReady) {
        const confirmed = await showPanelDialog({
          title: '重新发送当前轮',
          message: `无法确认第 ${state.activeIndex + 1} 轮是否真正开始。是否重新发送这一轮？`,
          confirmText: '重新发送',
          danger: true,
        });
        if (!confirmed) return;
        resetActiveTaskForRetry();
      }
    }

    resumeQueue();
  }

  function pauseQueue() {
    resetDispatchTimer();

    if (state.tasks.length === 0) {
      state.notice = '当前没有已载入的队列。';
      state.mode = 'idle';
      saveState();
      return;
    }

    state.mode = state.activeIndex !== null ? 'pausing' : 'paused';

    if (state.activeIndex !== null) {
      state.notice = `已请求暂停；第 ${state.activeIndex + 1} 轮仍会继续运行，完成后停在下一轮。`;
      startMonitor();
      syncLockToState();
    } else if (state.nextIndex < state.tasks.length) {
      state.notice = `队列已暂停；恢复时将从第 ${state.nextIndex + 1} 轮开始。`;
      releaseLock();
    } else {
      state.notice = '队列已暂停。';
      releaseLock();
    }

    saveState();
  }

  function resumeQueue() {
    if (state.tasks.length === 0) {
      state.notice = '请先在面板中粘贴任务，然后点击“开始/恢复”。';
      state.mode = 'idle';
      saveState();
      return;
    }

    if (state.nextIndex >= state.tasks.length && state.activeIndex === null) {
      finishQueue();
      return;
    }

    if (isForeignLockActive()) {
      state.mode = 'paused';
      state.notice = '另一个 ChatGPT 标签页正在接管该队列，本页无法恢复。';
      saveState();
      return;
    }

    const conversation = getConversationStatus({ allowBind: true });
    if (!conversation.ok) {
      state.mode = 'paused';
      state.notice = '当前不是队列绑定的会话。请返回原会话后刷新状态。';
      saveState();
      return;
    }

    const task = getActiveTask();
    const stopButton = findStopButton();

    if (task) {
      if (stopButton) {
        idleSince = 0;
        task.hasSeenStop = true;
        task.status = 'running';
        state.mode = 'running';
        state.notice = `已恢复队列；当前仍在等待第 ${state.activeIndex + 1} 轮完成。`;
        acquireLock();
        saveState();
        startMonitor();
        return;
      }

      if (task.hasSeenStop) {
        state.mode = 'running';
        state.notice = `已恢复队列；正在重新确认第 ${state.activeIndex + 1} 轮是否已经结束。`;
        idleSince = Date.now();
        acquireLock();
        saveState();
        startMonitor();
        return;
      }

      const editor = findEditor();
      const editorEmpty = Boolean(editor && !normalizeText(editor.innerText));
      const fallbackReady = Boolean(
        task.inputClearedAfterSubmit &&
        task.submittedAt &&
        Date.now() - task.submittedAt >= START_GRACE_MS &&
        editorEmpty
      );

      if (fallbackReady) {
        task.status = 'submitted';
        state.mode = 'running';
        state.notice = `已恢复队列；正在确认第 ${state.activeIndex + 1} 轮的超短任务空闲状态。`;
        idleSince = Date.now();
        acquireLock();
        saveState();
        startMonitor();
        return;
      }

      state.mode = 'error';
      task.status = 'uncertain';
      state.notice = `无法确认第 ${state.activeIndex + 1} 轮是否真正开始。点击“开始/恢复”可在确认后重新发送这一轮。`;
      saveState();
      return;
    }

    if (stopButton) {
      state.mode = 'paused';
      state.notice = '检测到页面正在运行非队列回答。请等待它结束后再恢复。';
      saveState();
      return;
    }

    state.mode = 'running';
    state.notice = `队列已恢复，将从第 ${state.nextIndex + 1} 轮开始。`;
    acquireLock();
    saveState();
    scheduleDispatch(300);
  }

  function refreshRuntimeStatus() {
    resetDispatchTimer();

    const conversation = getConversationStatus({ allowBind: true });
    if (!conversation.ok) {
      state.mode = 'paused';
      state.notice = '检测到当前页面不是队列绑定的会话，已保持暂停。';
      releaseLock();
      saveState();
      return;
    }

    const task = getActiveTask();
    const stopButton = findStopButton();

    if (!task) {
      if (stopButton) {
        state.mode = 'paused';
        state.notice = '页面正在运行一条非队列回答；队列保持暂停。';
      } else if (state.tasks.length === 0) {
        state.mode = 'idle';
        state.notice = 'ChatGPT 当前空闲，尚未载入队列。';
      } else if (state.nextIndex >= state.tasks.length) {
        state.mode = 'completed';
        state.notice = `ChatGPT 当前空闲，全部 ${state.tasks.length} 轮任务均已处理。`;
      } else {
        state.mode = 'paused';
        state.notice = `ChatGPT 当前空闲；下一轮是第 ${state.nextIndex + 1} 轮。点击“开始/恢复”后继续。`;
      }

      releaseLock();
      saveState();
      return;
    }

    state.mode = 'paused';

    if (stopButton) {
      idleSince = 0;
      task.hasSeenStop = true;
      task.status = 'running';
      state.notice = `检测到第 ${state.activeIndex + 1} 轮仍在运行；后续发送保持暂停。`;
      acquireLock();
      saveState();
      startMonitor();
      return;
    }

    if (task.hasSeenStop) {
      task.status = 'running';
      idleSince = Date.now();
      state.notice = `停止按钮已消失，正在重新确认第 ${state.activeIndex + 1} 轮的空闲状态；确认完成后仍保持暂停。`;
      acquireLock();
      saveState();
      startMonitor();
      return;
    }

    const editor = findEditor();
    const editorEmpty = Boolean(editor && !normalizeText(editor.innerText));
    const fallbackReady = Boolean(
      task.inputClearedAfterSubmit &&
      task.submittedAt &&
      Date.now() - task.submittedAt >= START_GRACE_MS &&
      editorEmpty
    );

    if (fallbackReady) {
      task.status = 'submitted';
      idleSince = Date.now();
      state.notice = `未记录到停止按钮，但输入框已清空；正在确认第 ${state.activeIndex + 1} 轮的超短任务空闲状态，确认后仍保持暂停。`;
      acquireLock();
      saveState();
      startMonitor();
      return;
    }

    task.status = 'uncertain';
    state.mode = 'error';
    state.notice = `页面当前空闲，但没有记录到第 ${state.activeIndex + 1} 轮的停止按钮，无法自动判定完成。`;
    releaseLock();
    saveState();
  }

  function resetActiveTaskForRetry() {
    const task = getActiveTask();
    if (!task || findStopButton()) return false;

    clearEditorIfMatches(task.text);
    const index = state.activeIndex;
    task.status = 'pending';
    task.hasSeenStop = false;
    task.inputClearedAfterSubmit = false;
    task.submittedAt = 0;
    task.completedAt = 0;
    state.activeIndex = null;
    state.nextIndex = index;
    state.mode = 'paused';
    state.notice = `第 ${index + 1} 轮已重置，将重新发送。`;
    idleSince = 0;
    internalEditorExpectedText = '';
    sendingEpoch += 1;
    stopMonitor();
    releaseLock();
    saveState();
    return true;
  }

  async function clearQueue() {
    const activeTask = getActiveTask();
    const answerRunning = Boolean(activeTask && findStopButton());
    const hasAnything = state.tasks.length > 0 || Boolean(normalizeText(
      document.getElementById(`${PREFIX}-input`)?.value || ''
    ));

    if (!hasAnything) {
      state.notice = '当前没有可清空的任务。';
      saveState();
      return;
    }

    const message = answerRunning
      ? '当前回答仍会继续生成，但脚本将清空本会话的队列并停止后续发送。'
      : '将清空本会话的任务文本、队列和进度。';

    const confirmed = await showPanelDialog({
      title: '清空当前会话队列',
      message,
      confirmText: '清空',
      danger: true,
    });
    if (!confirmed) return;

    if (activeTask && !answerRunning) clearEditorIfMatches(activeTask.text);

    sendingEpoch += 1;
    stopMonitor();
    resetDispatchTimer();
    releaseLock();
    state = createDefaultState(currentConversationId);

    const textarea = document.getElementById(`${PREFIX}-input`);
    if (textarea) {
      textarea.value = '';
      textarea.dataset.dirty = 'false';
    }

    saveState();
  }

  function getProgressSnapshot() {
    const totalCount = state.tasks.length;
    const completedCount = state.tasks.filter((task) => task.status === 'completed').length;
    const activeTask = getActiveTask();
    const activeVisible = Boolean(
      activeTask && ['sending', 'submitted', 'running'].includes(activeTask.status)
    );
    const activePosition = activeVisible && state.activeIndex !== null
      ? state.activeIndex + 1
      : completedCount;
    const completedPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
    const activeStartPercent = totalCount > 0 && activeVisible
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

  function getCompletedCount() {
    return state.tasks.filter((task) => task.status === 'completed').length;
  }

  function truncate(text, maxLength = 90) {
    const clean = normalizeText(text);
    return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        --${PREFIX}-accent: #10a37f;
        --${PREFIX}-progress-complete: #10a37f;
        --${PREFIX}-progress-active: #f5b700;
        --${PREFIX}-progress-pending: #6b7280;
        --${PREFIX}-progress-complete-percent: 0%;
        --${PREFIX}-progress-active-end-percent: 0%;
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

      #${PANEL_ID}[data-collapsed="true"] {
        width: 92px;
        height: 24px;
        max-height: none;
        overflow: visible;
        border: 0;
        border-radius: 6px;
        background: transparent;
        box-shadow: none;
      }

      #${PANEL_ID} * {
        box-sizing: border-box;
      }

      #${PANEL_ID} .${PREFIX}-launcher {
        display: none;
      }

      #${PANEL_ID}[data-collapsed="true"] .${PREFIX}-launcher {
        position: relative;
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
          var(--${PREFIX}-progress-complete) 0 var(--${PREFIX}-progress-complete-percent),
          var(--${PREFIX}-progress-active) var(--${PREFIX}-progress-complete-percent) var(--${PREFIX}-progress-active-end-percent),
          var(--${PREFIX}-progress-pending) var(--${PREFIX}-progress-active-end-percent) 100%
        );
        color: #ffffff;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
        cursor: pointer;
        transition: opacity 150ms ease, box-shadow 150ms ease;
      }

      #${PANEL_ID}[data-collapsed="true"] .${PREFIX}-launcher:hover {
        opacity: 0.92;
      }

      #${PANEL_ID}[data-mode="running"][data-collapsed="true"] .${PREFIX}-launcher,
      #${PANEL_ID}[data-mode="pausing"][data-collapsed="true"] .${PREFIX}-launcher {
        animation: ${PREFIX}-pulse 1.8s ease-in-out infinite;
      }

      #${PANEL_ID}[data-mode="error"] {
        --${PREFIX}-accent: #d92d20;
      }

      #${PANEL_ID}[data-mode="error"][data-collapsed="true"] .${PREFIX}-launcher {
        outline: 2px solid #d92d20;
        outline-offset: 2px;
      }

      #${PANEL_ID} .${PREFIX}-launcher-text {
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

      #${PANEL_ID}[data-collapsed="true"] .${PREFIX}-header,
      #${PANEL_ID}[data-collapsed="true"] .${PREFIX}-body {
        display: none;
      }

      #${PANEL_ID} .${PREFIX}-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        user-select: none;
      }

      #${PANEL_ID} .${PREFIX}-title-group {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
      }

      #${PANEL_ID} .${PREFIX}-title {
        overflow: hidden;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${PANEL_ID} .${PREFIX}-mode-badge {
        flex: none;
        padding: 2px 7px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--${PREFIX}-accent) 13%, transparent);
        color: var(--${PREFIX}-accent);
        font-size: 11px;
        font-weight: 700;
      }

      #${PANEL_ID} .${PREFIX}-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
        padding: 11px;
        overflow: auto;
      }

      #${PANEL_ID} textarea,
      #${PANEL_ID} input {
        width: 100%;
        border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
        border-radius: 8px;
        background: color-mix(in srgb, var(--main-surface-primary, #ffffff) 96%, currentColor 4%);
        color: inherit;
        font: inherit;
        outline: none;
      }

      #${PANEL_ID} textarea {
        min-height: 150px;
        resize: vertical;
        padding: 9px;
        line-height: 1.5;
      }

      #${PANEL_ID} input {
        padding: 6px 8px;
      }

      #${PANEL_ID} textarea:focus,
      #${PANEL_ID} input:focus {
        border-color: var(--${PREFIX}-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--${PREFIX}-accent) 16%, transparent);
      }

      #${PANEL_ID} .${PREFIX}-hint,
      #${PANEL_ID} .${PREFIX}-muted {
        color: var(--text-secondary, #6b7280);
      }

      #${PANEL_ID} .${PREFIX}-row {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }

      #${PANEL_ID} .${PREFIX}-unit-input {
        display: grid;
        grid-template-columns: 66px auto;
        align-items: center;
        gap: 6px;
      }

      #${PANEL_ID} .${PREFIX}-buttons {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
      }

      #${PANEL_ID} button {
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

      #${PANEL_ID} button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--main-surface-primary, #ffffff) 84%, currentColor 16%);
      }

      #${PANEL_ID}[data-collapsed="true"] .${PREFIX}-launcher:hover:not(:disabled) {
        background: linear-gradient(
          90deg,
          var(--${PREFIX}-progress-complete) 0 var(--${PREFIX}-progress-complete-percent),
          var(--${PREFIX}-progress-active) var(--${PREFIX}-progress-complete-percent) var(--${PREFIX}-progress-active-end-percent),
          var(--${PREFIX}-progress-pending) var(--${PREFIX}-progress-active-end-percent) 100%
        );
      }

      #${PANEL_ID} button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      #${PANEL_ID} button.${PREFIX}-primary {
        border-color: #0d8f70 !important;
        background-color: #10a37f !important;
        color: #ffffff !important;
        filter: none !important;
      }

      #${PANEL_ID} button.${PREFIX}-primary:hover:not(:disabled),
      #${PANEL_ID} button.${PREFIX}-primary:focus-visible:not(:disabled) {
        border-color: #0b7c62 !important;
        background-color: #0d8f70 !important;
        color: #ffffff !important;
        filter: none !important;
      }

      #${PANEL_ID} button.${PREFIX}-primary:active:not(:disabled) {
        border-color: #096b56 !important;
        background-color: #0b7c62 !important;
        color: #ffffff !important;
      }

      #${PANEL_ID} button.${PREFIX}-primary:focus-visible {
        outline: 2px solid color-mix(in srgb, #10a37f 45%, transparent);
        outline-offset: 2px;
      }

      #${PANEL_ID} .${PREFIX}-danger {
        color: #b42318;
      }

      #${PANEL_ID} .${PREFIX}-progress-section {
        display: grid;
        gap: 7px;
      }

      #${PANEL_ID} .${PREFIX}-progress-track {
        position: relative;
        height: 24px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--main-surface-primary, #ffffff) 87%, currentColor 13%);
      }

      #${PANEL_ID} .${PREFIX}-progress-completed,
      #${PANEL_ID} .${PREFIX}-progress-active {
        position: absolute;
        inset-block: 0;
        width: 0;
        transition: left 220ms ease, width 220ms ease;
      }

      #${PANEL_ID} .${PREFIX}-progress-completed {
        left: 0;
        background: var(--${PREFIX}-progress-complete);
      }

      #${PANEL_ID} .${PREFIX}-progress-active {
        left: 0;
        background: var(--${PREFIX}-progress-active);
      }

      #${PANEL_ID} .${PREFIX}-progress-text {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-size: 12px;
        font-weight: 750;
      }

      #${PANEL_ID} .${PREFIX}-conversation {
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--text-secondary, #6b7280);
        font-size: 12px;
      }

      #${PANEL_ID} .${PREFIX}-conversation-dot {
        width: 8px;
        height: 8px;
        flex: none;
        border-radius: 50%;
        background: #98a2b3;
      }

      #${PANEL_ID} .${PREFIX}-conversation[data-state="bound"] .${PREFIX}-conversation-dot {
        background: #12b76a;
      }

      #${PANEL_ID} .${PREFIX}-conversation[data-state="mismatch"] .${PREFIX}-conversation-dot {
        background: #d92d20;
      }

      #${PANEL_ID} .${PREFIX}-details {
        border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent);
        padding-top: 7px;
      }

      #${PANEL_ID} .${PREFIX}-details summary {
        cursor: pointer;
        color: var(--text-secondary, #6b7280);
        font-weight: 650;
        user-select: none;
      }

      #${PANEL_ID} .${PREFIX}-details-content {
        display: grid;
        gap: 8px;
        padding-top: 8px;
      }

      #${PANEL_ID} .${PREFIX}-detail-item {
        display: grid;
        gap: 2px;
      }

      #${PANEL_ID} .${PREFIX}-detail-label {
        color: var(--text-secondary, #6b7280);
        font-size: 11px;
        font-weight: 700;
      }

      #${PANEL_ID} .${PREFIX}-notice {
        padding: 8px 9px;
        border-left: 3px solid var(--${PREFIX}-accent);
        border-radius: 5px;
        background: color-mix(in srgb, var(--${PREFIX}-accent) 8%, transparent);
        overflow-wrap: anywhere;
      }


      #${PANEL_ID} .${PREFIX}-modal-layer {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: none;
        place-items: center;
        padding: 18px;
        background: rgba(0, 0, 0, 0.38);
        backdrop-filter: blur(1.5px);
      }

      #${PANEL_ID} .${PREFIX}-modal-layer[data-open="true"] {
        display: grid;
      }

      #${PANEL_ID} .${PREFIX}-modal-card {
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

      #${PANEL_ID} .${PREFIX}-modal-title {
        margin: 0 0 8px;
        font-size: 15px;
        font-weight: 750;
      }

      #${PANEL_ID} .${PREFIX}-modal-message {
        margin: 0;
        color: var(--text-secondary, #4b5563);
        overflow-wrap: anywhere;
        white-space: pre-line;
      }

      #${PANEL_ID} .${PREFIX}-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }

      #${PANEL_ID} .${PREFIX}-modal-actions button {
        min-width: 72px;
      }

      #${PANEL_ID} .${PREFIX}-modal-confirm[data-danger="true"] {
        border-color: #b42318 !important;
        background-color: #d92d20 !important;
        color: #ffffff !important;
      }

      #${PANEL_ID} .${PREFIX}-modal-confirm[data-danger="true"]:hover,
      #${PANEL_ID} .${PREFIX}-modal-confirm[data-danger="true"]:focus-visible {
        background-color: #b42318 !important;
        color: #ffffff !important;
      }

      #${PANEL_ID} .${PREFIX}-task-text {
        overflow-wrap: anywhere;
      }

      #${PANEL_ID} .${PREFIX}-collapse {
        width: 30px;
        min-height: 28px;
        padding: 0;
        font-size: 16px;
      }

      @keyframes ${PREFIX}-pulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18); }
        50% { box-shadow: 0 4px 20px color-mix(in srgb, var(--${PREFIX}-accent) 48%, transparent); }
      }

      @media (prefers-reduced-motion: reduce) {
        #${PANEL_ID} * {
          animation: none !important;
          transition: none !important;
        }
      }

      @media (prefers-color-scheme: dark) {
        #${PANEL_ID} {
          background: var(--main-surface-primary, #212121);
          color: var(--text-primary, #f3f4f6);
        }

        #${PANEL_ID} .${PREFIX}-modal-card {
          background: var(--main-surface-primary, #212121);
        }

        #${PANEL_ID} .${PREFIX}-danger {
          color: #fda29b;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    ensureStyle();

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.dataset.collapsed = 'true';
    panel.innerHTML = `
      <button type="button" class="${PREFIX}-launcher" data-action="expand" aria-label="展开 ChatGPT 顺序任务助手" title="ChatGPT 顺序任务助手">
        <span class="${PREFIX}-launcher-text" data-field="launcher-progress">顺序任务</span>
      </button>
      <div class="${PREFIX}-header">
        <div class="${PREFIX}-title-group">
          <span class="${PREFIX}-title">ChatGPT 顺序任务助手</span>
          <span class="${PREFIX}-mode-badge" data-field="mode"></span>
        </div>
        <button type="button" class="${PREFIX}-collapse" data-action="collapse" aria-label="收起面板">−</button>
      </div>
      <div class="${PREFIX}-body">
        <div class="${PREFIX}-hint">多行 Prompt 请用单独一行 --- 分隔；<br>无分隔符时，每个非空行作为一轮命令。</div>
        <textarea id="${PREFIX}-input" spellcheck="false" placeholder="第一个 Prompt\n可以有多行内容\n\n---\n\n第二个 Prompt\n也可以有多行内容"></textarea>
        <div class="${PREFIX}-row">
          <label for="${PREFIX}-delay">回答结束后额外等待</label>
          <div class="${PREFIX}-unit-input">
            <input id="${PREFIX}-delay" type="number" min="1" max="30" step="1" value="3" aria-label="回答结束后额外等待秒数">
            <span class="${PREFIX}-muted">秒</span>
          </div>
        </div>
        <div class="${PREFIX}-buttons">
          <button type="button" data-action="start" class="${PREFIX}-primary">开始/恢复</button>
          <button type="button" data-action="pause">暂停</button>
          <button type="button" data-action="refresh">刷新状态</button>
          <button type="button" data-action="clear" class="${PREFIX}-danger">清空</button>
        </div>
        <div class="${PREFIX}-progress-section">
          <div class="${PREFIX}-progress-track" data-field="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
            <div class="${PREFIX}-progress-completed" data-field="progress-completed"></div>
            <div class="${PREFIX}-progress-active" data-field="progress-active"></div>
            <span class="${PREFIX}-progress-text" data-field="progress"></span>
          </div>
          <div class="${PREFIX}-conversation" data-field="conversation-wrap" data-state="unbound">
            <span class="${PREFIX}-conversation-dot" aria-hidden="true"></span>
            <span data-field="conversation"></span>
          </div>
        </div>
        <details class="${PREFIX}-details" data-field="details">
          <summary>任务详情</summary>
          <div class="${PREFIX}-details-content">
            <div class="${PREFIX}-detail-item">
              <span class="${PREFIX}-detail-label">当前任务</span>
              <span data-field="current" class="${PREFIX}-task-text"></span>
            </div>
            <div class="${PREFIX}-detail-item">
              <span class="${PREFIX}-detail-label">下一任务</span>
              <span data-field="next" class="${PREFIX}-task-text"></span>
            </div>
          </div>
        </details>
        <div class="${PREFIX}-notice" data-field="notice"></div>
      </div>
      <div class="${PREFIX}-modal-layer" data-field="modal-layer" data-open="false" aria-hidden="true">
        <div class="${PREFIX}-modal-card" role="dialog" aria-modal="true" aria-labelledby="${PREFIX}-modal-title">
          <h2 id="${PREFIX}-modal-title" class="${PREFIX}-modal-title" data-field="modal-title"></h2>
          <p class="${PREFIX}-modal-message" data-field="modal-message"></p>
          <div class="${PREFIX}-modal-actions">
            <button type="button" data-action="dialog-cancel" data-field="modal-cancel">取消</button>
            <button type="button" data-action="dialog-confirm" data-field="modal-confirm" class="${PREFIX}-modal-confirm">确认</button>
          </div>
        </div>
      </div>
    `;

    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      if (action === 'start') void startOrResumeQueue();
      if (action === 'pause') pauseQueue();
      if (action === 'refresh') refreshRuntimeStatus();
      if (action === 'clear') void clearQueue();
      if (action === 'expand') panel.dataset.collapsed = 'false';
      if (action === 'collapse') panel.dataset.collapsed = 'true';
      if (action === 'dialog-cancel') closePanelDialog(false);
      if (action === 'dialog-confirm') closePanelDialog(true);
    });

    panel.addEventListener('input', (event) => {
      if (event.target.id === `${PREFIX}-input`) {
        event.target.dataset.dirty = 'true';
        state.draftText = event.target.value;
        saveState({ render: false });
        renderPanel();
      }
    });

    panel.addEventListener('change', (event) => {
      if (event.target.id !== `${PREFIX}-delay`) return;
      state.delayMs = clampInteger(
        Number(event.target.value) * 1000,
        1000,
        30000,
        DEFAULT_BETWEEN_TASK_DELAY_MS
      );
      event.target.value = String(Math.round(state.delayMs / 1000));
      saveState();
    });

    document.body.appendChild(panel);
    renderPanel();
  }

  function showPanelDialog({
    title,
    message,
    confirmText = '确认',
    cancelText = '取消',
    danger = false,
    alertOnly = false,
  }) {
    createPanel();
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return Promise.resolve(false);

    if (dialogResolver) closePanelDialog(false);
    panel.dataset.collapsed = 'false';

    const layer = panel.querySelector(`[data-field="modal-layer"]`);
    const cancelButton = panel.querySelector(`[data-field="modal-cancel"]`);
    const confirmButton = panel.querySelector(`[data-field="modal-confirm"]`);

    setPanelField(panel, 'modal-title', title || '提示');
    setPanelField(panel, 'modal-message', message || '');
    if (cancelButton) {
      cancelButton.textContent = cancelText;
      cancelButton.hidden = alertOnly;
    }
    if (confirmButton) {
      confirmButton.textContent = alertOnly ? '知道了' : confirmText;
      confirmButton.dataset.danger = danger ? 'true' : 'false';
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
    const panel = document.getElementById(PANEL_ID);
    const layer = panel?.querySelector(`[data-field="modal-layer"]`);
    if (layer) {
      layer.dataset.open = 'false';
      layer.setAttribute('aria-hidden', 'true');
    }

    const resolver = dialogResolver;
    dialogResolver = null;
    if (resolver) resolver(Boolean(result));
  }

  function handleDialogKeydown(event) {
    if (!dialogResolver) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanelDialog(false);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      closePanelDialog(true);
    }
  }

  function renderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const textarea = panel.querySelector(`#${PREFIX}-input`);
    const delayInput = panel.querySelector(`#${PREFIX}-delay`);

    if (textarea && !textarea.dataset.initialized) {
      textarea.value = state.draftText;
      textarea.dataset.initialized = 'true';
      textarea.dataset.dirty = 'false';
    } else if (
      textarea &&
      textarea.dataset.dirty !== 'true' &&
      document.activeElement !== textarea &&
      textarea.value !== state.draftText
    ) {
      textarea.value = state.draftText;
    }

    if (delayInput && document.activeElement !== delayInput) {
      delayInput.value = String(Math.round(state.delayMs / 1000));
    }

    const activeTask = getActiveTask();
    const nextTask = state.tasks[state.nextIndex] || null;
    const conversation = getConversationStatus({ allowBind: false });
    const progress = getProgressSnapshot();
    const { totalCount, completedCount } = progress;
    const draftInputText = textarea?.value ?? state.draftText;
    const draftLines = parseTasks(draftInputText);
    const draftCount = draftLines.length;
    const draftSourceText = getTaskSourceText(draftInputText);
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
    panel.style.setProperty(`--${PREFIX}-progress-complete-percent`, `${progress.completedPercent}%`);
    panel.style.setProperty(`--${PREFIX}-progress-active-end-percent`, `${activeEndPercent}%`);

    setPanelField(panel, 'mode', MODE_LABELS[state.mode] || state.mode);
    setPanelField(panel, 'launcher-progress', launcherText);
    setPanelField(panel, 'progress', progressText);
    setPanelField(
      panel,
      'current',
      activeTask
        ? `第 ${state.activeIndex + 1} 轮 · ${STATUS_LABELS[activeTask.status]} · ${truncate(activeTask.text)}`
        : '无'
    );
    setPanelField(
      panel,
      'next',
      nextTask && state.nextIndex < totalCount
        ? `第 ${state.nextIndex + 1} 轮 · ${truncate(nextTask.text)}`
        : '无'
    );

    const conversationState = !currentConversationId
      ? 'unbound'
      : (conversation.ok ? 'bound' : 'mismatch');
    const conversationText = conversationState === 'bound'
      ? '会话已绑定'
      : (conversationState === 'mismatch' ? '会话状态切换中' : '新对话待绑定');

    setPanelField(panel, 'conversation', conversationText);
    setPanelField(panel, 'notice', state.notice || '—');

    const conversationWrap = panel.querySelector(`[data-field="conversation-wrap"]`);
    if (conversationWrap) conversationWrap.dataset.state = conversationState;

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
    if (completedFill) completedFill.style.width = `${progress.completedPercent}%`;

    const activeFill = panel.querySelector(`[data-field="progress-active"]`);
    if (activeFill) {
      activeFill.style.left = `${progress.activeStartPercent}%`;
      activeFill.style.width = `${progress.activeWidthPercent}%`;
    }

    const launcher = panel.querySelector(`.${PREFIX}-launcher`);
    if (launcher) {
      launcher.setAttribute(
        'aria-label',
        totalCount > 0
          ? `展开 ChatGPT 顺序任务助手，进度 ${progress.activePosition} / ${totalCount}，已完成 ${completedCount} 轮，当前状态：${MODE_LABELS[state.mode] || state.mode}`
          : (draftCount > 0
            ? `展开 ChatGPT 顺序任务助手，草稿共 ${draftCount} 条任务，尚未开始`
            : '展开 ChatGPT 顺序任务助手')
      );
    }

    const details = panel.querySelector(`[data-field="details"]`);
    if (details && (state.mode === 'error' || conversationState === 'mismatch')) {
      details.open = true;
    }

    const stopVisible = Boolean(findStopButton());
    const hasActive = state.activeIndex !== null;
    const startDisabled =
      state.mode === 'running' ||
      state.mode === 'pausing' ||
      (hasActive && stopVisible);
    const pauseDisabled =
      state.tasks.length === 0 ||
      state.mode === 'paused' ||
      state.mode === 'pausing' ||
      state.mode === 'completed' ||
      state.mode === 'error' ||
      state.mode === 'idle';

    setButtonDisabled(panel, 'start', startDisabled);
    setButtonDisabled(panel, 'pause', pauseDisabled);
  }

  function setPanelField(panel, name, value) {
    const element = panel.querySelector(`[data-field="${name}"]`);
    if (element) element.textContent = value;
  }

  function setButtonDisabled(panel, action, disabled) {
    const button = panel.querySelector(`button[data-action="${action}"]`);
    if (button) button.disabled = Boolean(disabled);
  }

  function handleLocationChange() {
    const newHref = location.href;
    const newConversationId = getConversationId();
    if (newHref === locationSnapshot && newConversationId === currentConversationId) return;

    locationSnapshot = newHref;
    switchToConversationContext(newConversationId);
  }

  function handleTrustedEditorInput(event) {
    if (!event.isTrusted) return;
    if (!event.target.closest?.(EDITOR_SELECTOR)) return;
    if (state.mode !== 'running' && state.mode !== 'pausing') return;
    if (internalEditorWriteActive) return;

    const editorText = normalizeText(event.target.innerText || '');
    if (!editorText) return;
    if (internalEditorExpectedText && editorText === internalEditorExpectedText) return;

    resetDispatchTimer();
    state.mode = 'paused';
    state.notice = '检测到用户手动编辑输入框，队列已暂停以避免冲突。';
    if (state.activeIndex === null) releaseLock();
    saveState();
  }

  function recoverRuntime() {
    createPanel();
    handleLocationChange();

    if (state.activeIndex !== null && ownsLock(currentConversationId)) {
      startMonitor();
    } else if (!shouldOwnLock()) {
      releaseLock();
    }

    renderPanel();
  }

  function installHistoryHooks() {
    for (const methodName of ['pushState', 'replaceState']) {
      const original = history[methodName];
      if (typeof original !== 'function' || original.__cgStqWrapped) continue;

      const wrapped = function (...args) {
        const result = original.apply(this, args);
        window.queueMicrotask(handleLocationChange);
        return result;
      };

      Object.defineProperty(wrapped, '__cgStqWrapped', {
        value: true,
      });

      try {
        history[methodName] = wrapped;
      } catch (error) {
        console.warn(`[ChatGPT 顺序任务助手] 无法包装 history.${methodName}。`, error);
      }
    }
  }

  const bodyObserver = new MutationObserver(() => {
    if (!document.getElementById(PANEL_ID) && document.body) {
      createPanel();
    }
  });

  if (document.body) {
    bodyObserver.observe(document.body, {
      childList: true,
    });
  }

  installHistoryHooks();
  document.addEventListener('input', handleTrustedEditorInput, true);
  document.addEventListener('keydown', handleDialogKeydown, true);
  window.addEventListener('popstate', handleLocationChange);
  window.addEventListener('focus', recoverRuntime);
  window.addEventListener('pageshow', recoverRuntime);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) recoverRuntime();
  });

  window.addEventListener('storage', (event) => {
    if (!currentConversationId) return;

    const currentStateKey = getStateStorageKey(currentConversationId);
    const currentLockKey = getLockStorageKey(currentConversationId);

    if (event.key === currentStateKey) {
      try {
        state = event.newValue
          ? normalizeState(JSON.parse(event.newValue), currentConversationId)
          : createDefaultState(currentConversationId);

        if (ownsLock(currentConversationId) && state.activeIndex !== null) {
          startMonitor();
        } else if (!shouldOwnLock()) {
          stopMonitor();
          resetDispatchTimer();
          releaseLock();
        }

        renderPanel();
      } catch (_) {
        // 忽略其他标签页写入的无效状态。
      }
    }

    if (event.key === currentLockKey) renderPanel();
  });

  window.__cgSequentialTaskQueue = {
    version: VERSION,
    getState() {
      return {
        conversationId: currentConversationId,
        lockOwnedByThisTab: ownsLock(currentConversationId),
        state: JSON.parse(JSON.stringify(state)),
      };
    },
    pause: pauseQueue,
    start: startOrResumeQueue,
    resume: resumeQueue,
    refresh: refreshRuntimeStatus,
  };

  recoverRuntime();
})();

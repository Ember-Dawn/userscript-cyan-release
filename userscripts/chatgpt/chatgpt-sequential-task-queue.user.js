// ==UserScript==
// @name         ChatGPT 顺序任务助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js
// @version      1.0.0
// @description  在 ChatGPT 中按队列逐条发送任务；每行一条命令，等待当前回答停止后再继续，并支持暂停后续、恢复、刷新状态、重试和跳过。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
脚本说明：

1. 任务输入
 - 在浮动面板中粘贴多行文本，每个非空行作为一轮独立命令。
 - 点击“载入/替换队列”后生成任务队列，再点击“开始/恢复”执行。

2. 顺序执行
 - 脚本把命令写入 ChatGPT 的 ProseMirror 输入框并点击发送按钮。
 - 每轮必须先观察到 data-testid="stop-button"，再等待该按钮消失并保持空闲 3 秒，才把本轮标记为完成。
 - 脚本不读取、提取或判断回答正文，只观察输入框、停止按钮和当前会话地址。

3. 暂停与恢复
 - “暂停后续”只阻止发送下一轮，不会点击 ChatGPT 自带的停止按钮。
 - 若第 4 轮已经发出，点击暂停后仍等待第 4 轮完成；恢复时从第 5 轮开始。
 - 页面刷新后队列会安全恢复为暂停状态，避免自动误发；用户可先刷新状态，再手动恢复。

4. 安全限制
 - 切换到其他 ChatGPT 会话时自动暂停，避免把后续任务发送到错误对话。
 - 输入框已有用户文字、页面正在运行非队列回答、状态无法确认或发送失败时，均采用暂停而不是猜测。
 - 同一时刻只允许一个标签页接管队列；标签页锁会在失联后自动过期。

5. 调试方法
 - 可在 Console 运行：window.__cgSequentialTaskQueue.getState()
*/

(() => {
  'use strict';

  const VERSION = '1.0.0';
  const PREFIX = 'cg-stq';
  const STORAGE_KEY = 'cyan.chatgptSequentialTaskQueue.v1';
  const LOCK_KEY = 'cyan.chatgptSequentialTaskQueue.lock.v1';
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
    idle: '尚未开始',
    running: '队列运行中',
    paused: '已暂停',
    completed: '全部完成',
    error: '需要处理',
  };

  let state = loadState();
  let monitorTimer = null;
  let dispatchTimer = null;
  let lockHeartbeatTimer = null;
  let idleSince = 0;
  let sendingEpoch = 0;
  let internalInputUntil = 0;
  let locationSnapshot = location.href;

  const tabId = getOrCreateTabId();

  function createDefaultState() {
    return {
      version: 1,
      sourceText: '',
      tasks: [],
      nextIndex: 0,
      activeIndex: null,
      mode: 'idle',
      conversationId: null,
      delayMs: DEFAULT_BETWEEN_TASK_DELAY_MS,
      notice: '请粘贴任务，每个非空行作为一轮命令。',
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
      status: validStatus,
      hasSeenStop: Boolean(task?.hasSeenStop),
      submittedAt: Number(task?.submittedAt) || 0,
      completedAt: Number(task?.completedAt) || 0,
    };
  }

  function normalizeState(raw) {
    const fallback = createDefaultState();
    if (!raw || typeof raw !== 'object') return fallback;

    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks.map(sanitizeTask).filter((task) => task.text.trim())
      : [];

    const nextIndex = clampInteger(raw.nextIndex, 0, tasks.length);
    const activeIndex = Number.isInteger(raw.activeIndex) && raw.activeIndex >= 0 && raw.activeIndex < tasks.length
      ? raw.activeIndex
      : null;
    const validMode = Object.prototype.hasOwnProperty.call(MODE_LABELS, raw.mode)
      ? raw.mode
      : 'paused';

    return {
      version: 1,
      sourceText: typeof raw.sourceText === 'string'
        ? raw.sourceText
        : tasks.map((task) => task.text).join('\n'),
      tasks,
      nextIndex,
      activeIndex,
      mode: validMode,
      conversationId: typeof raw.conversationId === 'string' && raw.conversationId
        ? raw.conversationId
        : null,
      delayMs: clampInteger(raw.delayMs, 1000, 30000, DEFAULT_BETWEEN_TASK_DELAY_MS),
      notice: typeof raw.notice === 'string' ? raw.notice : fallback.notice,
      createdAt: Number(raw.createdAt) || 0,
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      const loaded = normalizeState(parsed);

      if (loaded.mode === 'running') {
        loaded.mode = 'paused';
        loaded.notice = '页面已重新加载，队列已安全暂停。请先刷新状态，再决定是否恢复。';
      }

      return loaded;
    } catch (error) {
      console.warn('[ChatGPT 顺序任务助手] 无法读取本地状态，将使用空队列。', error);
      return createDefaultState();
    }
  }

  function saveState({ render = true } = {}) {
    state.updatedAt = Date.now();

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('[ChatGPT 顺序任务助手] 无法保存本地状态。', error);
    }

    if (render) renderPanel();
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

  function readLock() {
    try {
      return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function isForeignLockActive() {
    const lock = readLock();
    return Boolean(
      lock &&
      lock.tabId &&
      lock.tabId !== tabId &&
      Date.now() - Number(lock.updatedAt || 0) < LOCK_STALE_MS
    );
  }

  function acquireLock() {
    if (isForeignLockActive()) return false;

    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify({
        tabId,
        updatedAt: Date.now(),
      }));
      startLockHeartbeat();
      return true;
    } catch (_) {
      return true;
    }
  }

  function refreshLock() {
    const lock = readLock();
    if (lock?.tabId !== tabId) return;

    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify({
        tabId,
        updatedAt: Date.now(),
      }));
    } catch (_) {
      // localStorage 不可用时不阻断当前页面运行。
    }
  }

  function releaseLock() {
    stopLockHeartbeat();

    try {
      const lock = readLock();
      if (lock?.tabId === tabId) {
        localStorage.removeItem(LOCK_KEY);
      }
    } catch (_) {
      // 忽略锁清理失败，旧锁会在超时后自动失效。
    }
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
    return state.mode === 'running' || state.activeIndex !== null;
  }

  function syncLockToState() {
    if (shouldOwnLock()) {
      acquireLock();
    } else {
      releaseLock();
    }
  }

  function parseTasks(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function normalizeText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getConversationId() {
    const match = location.pathname.match(/(?:^|\/)c\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getConversationStatus({ allowBind = true } = {}) {
    const currentId = getConversationId();

    if (state.conversationId) {
      return {
        ok: currentId === state.conversationId,
        currentId,
        expectedId: state.conversationId,
      };
    }

    if (allowBind && currentId) {
      state.conversationId = currentId;
      saveState({ render: false });
    }

    return {
      ok: true,
      currentId,
      expectedId: state.conversationId,
    };
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

  function setEditorText(editor, text) {
    editor.focus();
    selectEditorContents(editor);
    internalInputUntil = Date.now() + 1500;

    let inserted = false;

    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (_) {
      inserted = false;
    }

    if (!inserted || normalizeText(editor.innerText) !== normalizeText(text)) {
      editor.replaceChildren();
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      editor.appendChild(paragraph);
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        inputType: 'insertText',
        data: text,
      }));
    }

    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return normalizeText(editor.innerText) === normalizeText(text);
  }

  function clearEditorIfMatches(text) {
    const editor = findEditor();
    if (!editor || normalizeText(editor.innerText) !== normalizeText(text)) return;

    editor.focus();
    selectEditorContents(editor);
    internalInputUntil = Date.now() + 1000;

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
    task.status = 'sending';
    task.hasSeenStop = false;
    task.submittedAt = 0;
    task.completedAt = 0;
    state.notice = `正在发送第 ${index + 1} / ${state.tasks.length} 轮。`;
    saveState();

    const inserted = setEditorText(editor, task.text);
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

    if (task.submittedAt && Date.now() - task.submittedAt >= START_TIMEOUT_MS) {
      markError(
        `第 ${state.activeIndex + 1} 轮发送后 ${Math.round(START_TIMEOUT_MS / 1000)} 秒内未检测到停止按钮，无法确认任务已开始。`,
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
    stopMonitor();
    resetDispatchTimer();
    releaseLock();
    saveState();
  }

  function loadQueueFromPanel() {
    const textarea = document.getElementById(`${PREFIX}-input`);
    const delayInput = document.getElementById(`${PREFIX}-delay`);
    const sourceText = textarea?.value || '';
    const lines = parseTasks(sourceText);

    if (lines.length === 0) {
      window.alert('没有识别到任务。请确保每个非空行是一条命令。');
      return;
    }

    if (state.activeIndex !== null && findStopButton()) {
      window.alert('当前队列任务仍在运行，不能替换队列。请先等待它结束。');
      return;
    }

    if (state.tasks.length > 0 && !window.confirm(`将用 ${lines.length} 条新任务替换当前队列，是否继续？`)) {
      return;
    }

    sendingEpoch += 1;
    stopMonitor();
    resetDispatchTimer();
    releaseLock();

    const now = Date.now();
    state = {
      version: 1,
      sourceText: lines.join('\n'),
      tasks: lines.map((text, index) => ({
        id: index + 1,
        text,
        status: 'pending',
        hasSeenStop: false,
        submittedAt: 0,
        completedAt: 0,
      })),
      nextIndex: 0,
      activeIndex: null,
      mode: 'paused',
      conversationId: getConversationId(),
      delayMs: clampInteger(
        Number(delayInput?.value) * 1000,
        1000,
        30000,
        DEFAULT_BETWEEN_TASK_DELAY_MS
      ),
      notice: `已载入 ${lines.length} 条任务。检查无误后点击“开始/恢复”。`,
      createdAt: now,
      updatedAt: now,
    };

    if (textarea) {
      textarea.value = state.sourceText;
      textarea.dataset.dirty = 'false';
    }

    saveState();
  }

  function pauseQueue() {
    resetDispatchTimer();

    if (state.tasks.length === 0) {
      state.notice = '当前没有已载入的队列。';
      state.mode = 'idle';
      saveState();
      return;
    }

    state.mode = 'paused';

    if (state.activeIndex !== null) {
      state.notice = `已暂停后续发送；第 ${state.activeIndex + 1} 轮仍会继续运行，完成后停在下一轮。`;
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
      state.notice = '请先粘贴并载入任务队列。';
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
        state.notice = `已恢复队列；正在确认第 ${state.activeIndex + 1} 轮是否已经结束。`;
        idleSince = Date.now();
        acquireLock();
        saveState();
        startMonitor();
        return;
      }

      state.mode = 'error';
      task.status = 'uncertain';
      state.notice = `无法确认第 ${state.activeIndex + 1} 轮是否真正开始。请使用“重试当前”或“跳过当前”。`;
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
      state.notice = `停止按钮已消失，正在确认第 ${state.activeIndex + 1} 轮的空闲状态；确认后仍保持暂停。`;
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

  function retryCurrentTask() {
    const task = getActiveTask();
    if (!task) {
      state.notice = '当前没有需要重试的任务。';
      saveState();
      return;
    }

    if (findStopButton()) {
      window.alert('当前回答仍在运行，不能重试。请先等待它结束。');
      return;
    }

    clearEditorIfMatches(task.text);
    const index = state.activeIndex;
    task.status = 'pending';
    task.hasSeenStop = false;
    task.submittedAt = 0;
    task.completedAt = 0;
    state.activeIndex = null;
    state.nextIndex = index;
    state.mode = 'paused';
    state.notice = `第 ${index + 1} 轮已重置为待执行。点击“开始/恢复”后重新发送。`;
    idleSince = 0;
    sendingEpoch += 1;
    stopMonitor();
    releaseLock();
    saveState();
  }

  function skipCurrentTask() {
    const task = getActiveTask();
    if (!task) {
      state.notice = '当前没有可以跳过的任务。';
      saveState();
      return;
    }

    if (findStopButton()) {
      window.alert('当前回答仍在运行。为避免队列与页面状态冲突，请等待它结束后再跳过。');
      return;
    }

    const index = state.activeIndex;
    task.status = 'skipped';
    task.completedAt = Date.now();
    state.activeIndex = null;
    state.nextIndex = Math.max(state.nextIndex, index + 1);
    state.mode = state.nextIndex >= state.tasks.length ? 'completed' : 'paused';
    state.notice = state.mode === 'completed'
      ? '最后一轮已跳过，队列处理完毕。'
      : `第 ${index + 1} 轮已跳过；下一轮是第 ${state.nextIndex + 1} 轮。`;
    idleSince = 0;
    sendingEpoch += 1;
    stopMonitor();
    releaseLock();
    saveState();
  }

  function clearQueue() {
    if (state.activeIndex !== null && findStopButton()) {
      window.alert('当前队列任务仍在运行，不能清空队列。请先等待它结束。');
      return;
    }

    if (state.tasks.length > 0 && !window.confirm('确定清空当前任务队列和本地进度吗？')) {
      return;
    }

    sendingEpoch += 1;
    stopMonitor();
    resetDispatchTimer();
    releaseLock();
    state = createDefaultState();

    const textarea = document.getElementById(`${PREFIX}-input`);
    if (textarea) {
      textarea.value = '';
      textarea.dataset.dirty = 'false';
    }

    saveState();
  }

  function getCompletedCount() {
    return state.tasks.filter((task) => task.status === 'completed').length;
  }

  function getProcessedCount() {
    return state.tasks.filter((task) => task.status === 'completed' || task.status === 'skipped').length;
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
        position: fixed;
        right: 18px;
        bottom: 96px;
        z-index: 2147483000;
        width: min(390px, calc(100vw - 24px));
        max-height: min(720px, calc(100vh - 120px));
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
        width: auto;
        max-height: none;
      }

      #${PANEL_ID} * {
        box-sizing: border-box;
      }

      #${PANEL_ID} .${PREFIX}-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        font-weight: 700;
        user-select: none;
      }

      #${PANEL_ID}[data-collapsed="true"] .${PREFIX}-body {
        display: none;
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
        border-color: #10a37f;
        box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.16);
      }

      #${PANEL_ID} .${PREFIX}-hint,
      #${PANEL_ID} .${PREFIX}-muted {
        color: var(--text-secondary, #6b7280);
      }

      #${PANEL_ID} .${PREFIX}-row {
        display: grid;
        grid-template-columns: 1fr 92px;
        align-items: center;
        gap: 8px;
      }

      #${PANEL_ID} .${PREFIX}-buttons {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
      }

      #${PANEL_ID} button {
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

      #${PANEL_ID} button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      #${PANEL_ID} .${PREFIX}-primary {
        border-color: #10a37f;
        background: #10a37f;
        color: #ffffff;
      }

      #${PANEL_ID} .${PREFIX}-primary:hover:not(:disabled) {
        background: #0d8b6d;
      }

      #${PANEL_ID} .${PREFIX}-danger {
        color: #b42318;
      }

      #${PANEL_ID} .${PREFIX}-status {
        display: grid;
        gap: 5px;
        padding: 9px;
        border-radius: 9px;
        background: color-mix(in srgb, var(--main-surface-primary, #ffffff) 90%, currentColor 10%);
      }

      #${PANEL_ID} .${PREFIX}-notice {
        padding: 8px 9px;
        border-left: 3px solid #10a37f;
        border-radius: 5px;
        background: rgba(16, 163, 127, 0.08);
        overflow-wrap: anywhere;
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

      @media (prefers-color-scheme: dark) {
        #${PANEL_ID} {
          background: var(--main-surface-primary, #212121);
          color: var(--text-primary, #f3f4f6);
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
    panel.dataset.collapsed = 'false';
    panel.innerHTML = `
      <div class="${PREFIX}-header">
        <span>ChatGPT 顺序任务助手</span>
        <button type="button" class="${PREFIX}-collapse" data-action="collapse" aria-label="折叠面板">−</button>
      </div>
      <div class="${PREFIX}-body">
        <div class="${PREFIX}-hint">每个非空行作为一轮命令；脚本不读取回答正文。</div>
        <textarea id="${PREFIX}-input" spellcheck="false" placeholder="请按照 xxx 文件生成第 1 页的图\n请按照 xxx 文件生成第 2 页的图"></textarea>
        <div class="${PREFIX}-row">
          <label for="${PREFIX}-delay">两轮之间额外等待</label>
          <input id="${PREFIX}-delay" type="number" min="1" max="30" step="1" value="3" aria-label="两轮之间等待秒数">
        </div>
        <div class="${PREFIX}-buttons">
          <button type="button" data-action="load">载入/替换队列</button>
          <button type="button" data-action="resume" class="${PREFIX}-primary">开始/恢复</button>
          <button type="button" data-action="pause">暂停后续</button>
          <button type="button" data-action="refresh">刷新状态</button>
          <button type="button" data-action="retry">重试当前</button>
          <button type="button" data-action="skip">跳过当前</button>
          <button type="button" data-action="clear" class="${PREFIX}-danger">清空队列</button>
        </div>
        <div class="${PREFIX}-status">
          <div><strong>队列状态：</strong><span data-field="mode"></span></div>
          <div><strong>进度：</strong><span data-field="progress"></span></div>
          <div><strong>当前任务：</strong><span data-field="current" class="${PREFIX}-task-text"></span></div>
          <div><strong>下一任务：</strong><span data-field="next" class="${PREFIX}-task-text"></span></div>
          <div><strong>会话绑定：</strong><span data-field="conversation" class="${PREFIX}-muted"></span></div>
        </div>
        <div class="${PREFIX}-notice" data-field="notice"></div>
      </div>
    `;

    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      if (action === 'load') loadQueueFromPanel();
      if (action === 'resume') resumeQueue();
      if (action === 'pause') pauseQueue();
      if (action === 'refresh') refreshRuntimeStatus();
      if (action === 'retry') retryCurrentTask();
      if (action === 'skip') skipCurrentTask();
      if (action === 'clear') clearQueue();
      if (action === 'collapse') {
        const collapsed = panel.dataset.collapsed === 'true';
        panel.dataset.collapsed = String(!collapsed);
        button.textContent = collapsed ? '−' : '+';
        button.setAttribute('aria-label', collapsed ? '折叠面板' : '展开面板');
      }
    });

    panel.addEventListener('input', (event) => {
      if (event.target.id === `${PREFIX}-input`) {
        event.target.dataset.dirty = 'true';
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

  function renderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const textarea = panel.querySelector(`#${PREFIX}-input`);
    const delayInput = panel.querySelector(`#${PREFIX}-delay`);

    if (textarea && !textarea.dataset.initialized) {
      textarea.value = state.sourceText;
      textarea.dataset.initialized = 'true';
      textarea.dataset.dirty = 'false';
    } else if (
      textarea &&
      textarea.dataset.dirty !== 'true' &&
      document.activeElement !== textarea &&
      textarea.value !== state.sourceText
    ) {
      textarea.value = state.sourceText;
    }

    if (delayInput && document.activeElement !== delayInput) {
      delayInput.value = String(Math.round(state.delayMs / 1000));
    }

    const activeTask = getActiveTask();
    const nextTask = state.tasks[state.nextIndex] || null;
    const conversation = getConversationStatus({ allowBind: false });
    const completedCount = getCompletedCount();
    const processedCount = getProcessedCount();

    setPanelField(panel, 'mode', MODE_LABELS[state.mode] || state.mode);
    setPanelField(
      panel,
      'progress',
      `${processedCount} / ${state.tasks.length} 已处理（其中 ${completedCount} 条完成）`
    );
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
      nextTask && state.nextIndex < state.tasks.length
        ? `第 ${state.nextIndex + 1} 轮 · ${truncate(nextTask.text)}`
        : '无'
    );
    setPanelField(
      panel,
      'conversation',
      state.conversationId
        ? (conversation.ok ? `已绑定 ${state.conversationId}` : `会话不匹配，应返回 ${state.conversationId}`)
        : '尚未绑定；首次发送后自动绑定'
    );
    setPanelField(panel, 'notice', state.notice || '—');

    const hasActive = state.activeIndex !== null;
    const stopVisible = Boolean(findStopButton());
    setButtonDisabled(panel, 'pause', state.tasks.length === 0 || state.mode === 'paused');
    setButtonDisabled(panel, 'resume', state.tasks.length === 0 || state.mode === 'completed');
    setButtonDisabled(panel, 'retry', !hasActive || stopVisible);
    setButtonDisabled(panel, 'skip', !hasActive || stopVisible);
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
    if (location.href === locationSnapshot) return;
    locationSnapshot = location.href;

    if (state.tasks.length === 0) {
      renderPanel();
      return;
    }

    const conversation = getConversationStatus({ allowBind: state.activeIndex !== null });
    if (!conversation.ok) {
      resetDispatchTimer();
      state.mode = 'paused';
      state.notice = '检测到切换了 ChatGPT 会话，队列已暂停。返回原会话后点击“刷新状态”。';
      releaseLock();
      saveState();
      return;
    }

    renderPanel();
  }

  function handleTrustedEditorInput(event) {
    if (!event.isTrusted || Date.now() <= internalInputUntil) return;
    if (!event.target.closest?.(EDITOR_SELECTOR)) return;
    if (state.mode !== 'running') return;

    resetDispatchTimer();
    state.mode = 'paused';
    state.notice = '检测到用户手动编辑输入框，队列已暂停以避免冲突。';
    if (state.activeIndex === null) releaseLock();
    saveState();
  }

  function recoverRuntime() {
    createPanel();
    handleLocationChange();

    if (state.activeIndex !== null) {
      if (acquireLock()) startMonitor();
    } else {
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
  window.addEventListener('popstate', handleLocationChange);
  window.addEventListener('focus', recoverRuntime);
  window.addEventListener('pageshow', recoverRuntime);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) recoverRuntime();
  });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        state = normalizeState(JSON.parse(event.newValue));
        state.mode = 'paused';
        state.notice = '检测到其他标签页修改了队列，本页已暂停并重新载入状态。';
        stopMonitor();
        resetDispatchTimer();
        releaseLock();
        renderPanel();
      } catch (_) {
        // 忽略其他标签页写入的无效状态。
      }
    }

    if (event.key === LOCK_KEY) renderPanel();
  });

  window.__cgSequentialTaskQueue = {
    version: VERSION,
    getState() {
      return JSON.parse(JSON.stringify(state));
    },
    pause: pauseQueue,
    resume: resumeQueue,
    refresh: refreshRuntimeStatus,
  };

  recoverRuntime();
})();

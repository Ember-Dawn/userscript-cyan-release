// ==UserScript==
// @name         ChatGPT GitHub 自动允许助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-auto-allow-github.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-auto-allow-github.user.js
// @version      0.4.0
// @description  自动允许 ChatGPT 的 GitHub 授权请求；支持点击结果验证、有限退避重试和后台恢复，并保持低资源占用。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
脚本说明：

1. 作用
 - 自动监听 ChatGPT 网页中的 GitHub 权限卡片。
 - 首次发现卡片后等待 2 秒，再自动点击「允许」。
 - 点击后验证卡片是否已离开授权状态；未成功时进行有限重试。

2. 可靠性机制
 - 使用卡片状态机，防止同一张卡片被重复安排多个定时器。
 - 点击失败时按 1.5、3、6、10 秒逐步退避，单轮最多尝试 5 次。
 - Chrome 后台冻结或延迟定时器后，页面恢复时会检查并接管过期任务。
 - 仅在发现授权卡片后短暂启动 watchdog，最长运行 45 秒。

3. 性能控制
 - 平时不进行周期轮询。
 - MutationObserver 只检查发生变化的局部节点及其所属授权卡片。
 - 不因 ChatGPT 普通回答文字更新而反复扫描整个页面。
 - 全页面授权卡片扫描仅用于启动、页面恢复和短期 watchdog。

4. 安全限制
 - 只处理 ChatGPT 页面中的 tool approval card。
 - 只处理标题和内容明确指向 GitHub 的授权卡片。
 - 只点击文字严格等于「允许」或「Allow」的按钮。
 - 检查 disabled、aria-disabled、display、visibility 和 pointer-events。
 - 重试次数和 watchdog 持续时间均有限，不会无限点击或永久轮询。

5. 浏览器限制
 - Chrome 完全冻结或丢弃标签页时，网页脚本无法在冻结期间执行。
 - 标签页恢复执行 JavaScript 后，本脚本会重新扫描并继续处理。
*/

(() => {
  'use strict';

  const CARD_SELECTOR = '[data-testid="tool-approval-card"]';
  const ACTION_BOX_SELECTOR = '[data-testid="tool-action-buttons"]';

  const AUTO_CLICK_DELAY_MS = 2000;
  const VERIFY_DELAY_MS = 1200;
  const RETRY_DELAYS_MS = [1500, 3000, 6000, 10000];
  const MAX_ATTEMPT_COUNT = 5;

  const STATE_OVERDUE_GRACE_MS = 5000;
  const EXHAUSTED_COOLDOWN_MS = 15000;

  const WATCHDOG_INTERVAL_MS = 3000;
  const WATCHDOG_MAX_DURATION_MS = 45000;

  const cardStates = new WeakMap();

  let nextStateId = 1;
  let watchdogTimer = null;
  let watchdogDeadline = 0;

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function isVisibleAndEnabled(element) {
    if (
      !element ||
      element.disabled ||
      element.getAttribute('aria-disabled') === 'true' ||
      !element.isConnected
    ) {
      return false;
    }

    const style = window.getComputedStyle(element);

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none'
    );
  }

  function getCardTitle(card) {
    const heading = card.querySelector('h2');
    return normalizeText(heading?.innerText || '');
  }

  function isGitHubApprovalCard(card) {
    if (!(card instanceof Element) || !card.isConnected) {
      return false;
    }

    const text = normalizeText(card.innerText);
    const title = getCardTitle(card);

    const hasGitHub = text.includes('GitHub');
    const hasApprovalTitle =
      title === '允许 ChatGPT 使用 GitHub？' ||
      title === 'Allow ChatGPT to use GitHub?' ||
      text.includes('允许 ChatGPT 使用 GitHub') ||
      text.includes('Allow ChatGPT to use GitHub');
    const hasActionButtons = !!card.querySelector(ACTION_BOX_SELECTOR);

    return hasGitHub && hasApprovalTitle && hasActionButtons;
  }

  function findAllowButton(card) {
    const actionBox = card.querySelector(ACTION_BOX_SELECTOR);
    if (!actionBox) return null;

    return Array.from(actionBox.querySelectorAll('button')).find((button) => {
      const text = normalizeText(button.innerText);
      return text === '允许' || text === 'Allow';
    }) || null;
  }

  function dispatchMouseEvent(button, type) {
    button.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  }

  function safeClick(button) {
    dispatchMouseEvent(button, 'mouseover');
    dispatchMouseEvent(button, 'mousedown');
    dispatchMouseEvent(button, 'mouseup');
    button.click();
  }

  function isSameState(card, stateId) {
    return cardStates.get(card)?.id === stateId;
  }

  function clearStateTimer(state) {
    if (state?.timer !== null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function deleteCardState(card) {
    const state = cardStates.get(card);
    clearStateTimer(state);
    cardStates.delete(card);
  }

  function setCardTimer(card, state, phase, delay, callback) {
    clearStateTimer(state);

    state.phase = phase;
    state.dueAt = Date.now() + delay;
    state.timer = window.setTimeout(() => {
      state.timer = null;

      if (!isSameState(card, state.id)) {
        return;
      }

      callback(card, state.id);
    }, delay);
  }

  function isActiveStateOverdue(state) {
    if (!state || state.phase === 'exhausted') {
      return false;
    }

    return Date.now() > state.dueAt + STATE_OVERDUE_GRACE_MS;
  }

  function markSuccess(card) {
    deleteCardState(card);
    console.log('[ChatGPT GitHub 自动允许助手] GitHub 授权卡片已离开待允许状态。');
  }

  function scheduleRetry(card, state, reason) {
    if (state.attempts >= MAX_ATTEMPT_COUNT) {
      clearStateTimer(state);
      state.phase = 'exhausted';
      state.dueAt = Date.now() + EXHAUSTED_COOLDOWN_MS;

      console.warn(
        `[ChatGPT GitHub 自动允许助手] ${reason}，本轮已尝试 ${state.attempts} 次；` +
        '将等待页面恢复事件或冷却后再检查。'
      );
      return;
    }

    const delayIndex = Math.min(
      Math.max(state.attempts - 1, 0),
      RETRY_DELAYS_MS.length - 1
    );
    const delay = RETRY_DELAYS_MS[delayIndex];

    console.log(
      `[ChatGPT GitHub 自动允许助手] ${reason}，将在 ${delay} ms 后重试。`
    );

    setCardTimer(card, state, 'retrying', delay, performAttempt);
  }

  function verifyAttempt(card, stateId) {
    const state = cardStates.get(card);
    if (!state || state.id !== stateId) return;

    if (!card.isConnected || !isGitHubApprovalCard(card)) {
      markSuccess(card);
      return;
    }

    const allowButton = findAllowButton(card);

    if (!allowButton) {
      markSuccess(card);
      return;
    }

    scheduleRetry(card, state, '点击后授权卡片仍然存在');
  }

  function performAttempt(card, stateId) {
    const state = cardStates.get(card);
    if (!state || state.id !== stateId) return;

    if (!card.isConnected || !isGitHubApprovalCard(card)) {
      markSuccess(card);
      return;
    }

    state.attempts += 1;

    const allowButton = findAllowButton(card);

    if (!isVisibleAndEnabled(allowButton)) {
      scheduleRetry(card, state, '「允许」按钮暂时不可用');
      return;
    }

    console.log(
      `[ChatGPT GitHub 自动允许助手] 正在执行第 ${state.attempts} 次自动允许。`
    );

    safeClick(allowButton);
    setCardTimer(card, state, 'verifying', VERIFY_DELAY_MS, verifyAttempt);
  }

  function scheduleAutoAllow(card) {
    const state = {
      id: nextStateId++,
      phase: 'waiting',
      attempts: 0,
      timer: null,
      dueAt: 0,
    };

    cardStates.set(card, state);
    setCardTimer(card, state, 'waiting', AUTO_CLICK_DELAY_MS, performAttempt);

    console.log(
      `[ChatGPT GitHub 自动允许助手] 已检测到 GitHub 授权卡片，将在 ${AUTO_CLICK_DELAY_MS} ms 后自动点击「允许」。`
    );
  }

  function inspectCard(card, { recoverExhausted = false } = {}) {
    if (!isGitHubApprovalCard(card)) {
      return false;
    }

    const allowButton = findAllowButton(card);
    const state = cardStates.get(card);

    if (state) {
      const exhaustedCanRecover =
        state.phase === 'exhausted' &&
        (recoverExhausted || Date.now() >= state.dueAt);

      if (isActiveStateOverdue(state) || exhaustedCanRecover) {
        deleteCardState(card);
      } else {
        return true;
      }
    }

    if (allowButton) {
      scheduleAutoAllow(card);
    }

    return true;
  }

  function scanExistingCards(options = {}) {
    let approvalCardCount = 0;

    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      if (inspectCard(card, options)) {
        approvalCardCount += 1;
      }
    });

    if (approvalCardCount > 0 && options.startWatchdog !== false) {
      startWatchdog();
    }

    return approvalCardCount;
  }

  function scheduleWatchdogTick() {
    watchdogTimer = window.setTimeout(runWatchdogTick, WATCHDOG_INTERVAL_MS);
  }

  function stopWatchdog() {
    if (watchdogTimer !== null) {
      window.clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }

    watchdogDeadline = 0;
  }

  function runWatchdogTick() {
    watchdogTimer = null;

    if (Date.now() >= watchdogDeadline) {
      stopWatchdog();
      return;
    }

    const approvalCardCount = scanExistingCards({ startWatchdog: false });

    if (approvalCardCount === 0) {
      stopWatchdog();
      return;
    }

    scheduleWatchdogTick();
  }

  function startWatchdog() {
    if (watchdogTimer !== null || watchdogDeadline > Date.now()) {
      return;
    }

    watchdogDeadline = Date.now() + WATCHDOG_MAX_DURATION_MS;
    scheduleWatchdogTick();
  }

  function inspectNode(node) {
    const element = node instanceof Element ? node : node.parentElement;
    if (!element) return;

    const cards = new Set();

    if (element.matches(CARD_SELECTOR)) {
      cards.add(element);
    }

    const containingCard = element.closest(CARD_SELECTOR);
    if (containingCard) {
      cards.add(containingCard);
    }

    element.querySelectorAll(CARD_SELECTOR).forEach((card) => cards.add(card));

    let foundApprovalCard = false;

    cards.forEach((card) => {
      if (inspectCard(card)) {
        foundApprovalCard = true;
      }
    });

    if (foundApprovalCard) {
      startWatchdog();
    }
  }

  function recoverExistingCards() {
    scanExistingCards({ recoverExhausted: true });
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        inspectNode(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener('load', recoverExistingCards, { once: true });
  window.addEventListener('focus', recoverExistingCards);
  window.addEventListener('pageshow', recoverExistingCards);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      recoverExistingCards();
    }
  });

  document.addEventListener('resume', recoverExistingCards);

  recoverExistingCards();
})();

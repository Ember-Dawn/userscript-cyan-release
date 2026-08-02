// ==UserScript==
// @name         ChatGPT 朗读增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-read-aloud-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-read-aloud-enhancer.user.js
// @version      3.1.0
// @description  增强 ChatGPT 官方朗读：一级入口、紧凑播放器、消息切换、进度与倍速控制、MP3 下载和键盘快捷键。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js
// @grant        none
// ==/UserScript==

/*
脚本说明：

1. 一级朗读按钮
 - 在每条助手回答的一级操作栏末尾增加一个朗读按钮。
 - 单击后在后台打开“更多操作”，调用官方“朗读/重播”菜单项。
 - 原菜单中的官方朗读或重播入口保持不变。

2. 悬浮播放器
 - 仅在 ChatGPT 官方朗读真正开始播放后显示播放器，不因页面中残留 audio 元素自动弹出。
 - 提供上一条、快退、播放/暂停、快进、下一条、进度条、时间显示、倍速、MP3 下载、最小化和关闭。
 - 前进/后退步长可选 3、5、10 秒，默认 3 秒，并保存到 localStorage。

3. 键盘快捷键
 - 播放器打开时：上/下方向键切换上一条或下一条助手消息，左/右方向键后退或前进，空格播放或暂停，Esc 关闭并暂停。
 - 焦点位于输入框、文本域、可编辑区域或选择框时，不接管快捷键。

4. 性能与可靠性
 - 使用 MutationObserver 处理 ChatGPT 单页应用中的动态回答和重新渲染。
 - 通过捕获媒体 play 事件和轻量周期检查识别当前官方音频。
 - 临时监听器、菜单隐藏状态和操作超时均会及时清理。
 - 关闭后再次主动朗读会创建新的播放会话，旧关闭状态不会误伤新播放。
 - 内部菜单清理不再派发全局 Escape，避免误触播放器关闭快捷键。
 - 消息列表仅在切换时即时扫描；切换聊天、追加消息和重新回答时会重新解析当前可见消息。

5. MP3 下载
 - 下载时在浏览器本地将当前官方朗读音频转换为单声道 96 kbps MP3。
 - 使用通过 @require 单独加载的 lamejs 1.2.1，不上传音频到第三方服务器。
*/

(() => {
  'use strict';

  const SCRIPT_PREFIX = '[ChatGPT 朗读增强助手]';

  const ACTION_GROUP_SELECTOR = '[role="group"][aria-label="回复操作"]';
  const FALLBACK_ACTION_GROUP_SELECTOR = '[role="group"]';
  const MORE_BUTTON_SELECTOR = [
    'button[aria-label="更多操作"]',
    'button[aria-label="More actions"]',
  ].join(', ');
  const OFFICIAL_VOICE_ITEM_SELECTOR =
    '[data-testid="voice-play-turn-action-button"]';

  const CUSTOM_BUTTON_ATTRIBUTE = 'data-cyan-voice-button';
  const PROCESSED_GROUP_ATTRIBUTE = 'data-cyan-voice-group-ready';
  const HIDE_MENU_ATTRIBUTE = 'data-cyan-hide-voice-menu';
  const STYLE_ELEMENT_ID = 'cyan-chatgpt-voice-button-style';
  const PLAYER_ID = 'cyan-chatgpt-audio-player';
  const PLAYER_COLLAPSED_ATTRIBUTE = 'data-cyan-collapsed';

  const STORAGE_SEEK_STEP = 'cyanChatgptVoiceSeekStep';
  const STORAGE_PLAYBACK_RATE = 'cyanChatgptVoicePlaybackRate';
  const STORAGE_PLAYER_COLLAPSED = 'cyanChatgptVoicePlayerCollapsed';

  const SEEK_STEP_OPTIONS = [3, 5, 10];
  const PLAYBACK_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
  const MENU_WAIT_TIMEOUT_MS = 2000;
  const ITEM_ACTIVATION_DELAY_MS = 32;
  const MENU_CLOSE_DELAY_MS = 100;
  const AUDIO_SCAN_INTERVAL_MS = 500;
  const MESSAGE_SWITCH_TIMEOUT_MS = 12000;
  const STATUS_DISPLAY_MS = 1500;

  let activeOperation = null;
  let scanFrame = null;
  const pendingScanRoots = new Set();

  let currentAudio = null;
  let player = null;
  let playerBody = null;
  let playPauseButton = null;
  let backwardButton = null;
  let forwardButton = null;
  let seekRange = null;
  let currentTimeLabel = null;
  let durationLabel = null;
  let seekStepSelect = null;
  let speedSelect = null;
  let minimizeButton = null;
  let downloadButton = null;
  let downloadInProgress = false;
  let previousMessageButton = null;
  let nextMessageButton = null;
  let playerStatus = null;
  let statusTimer = null;
  let messageSwitchTimer = null;
  let navigationInProgress = false;
  let currentMessageContext = null;
  let pendingMessageContext = null;
  let lastKnownMessageIndex = -1;
  let currentRouteKey = getRouteKey();
  let audioScanTimer = null;
  let dismissedAudio = null;
  let playbackSessionId = 0;
  let playbackSessionState = 'idle';
  let openingRequestUntil = 0;

  let seekStep = readNumberSetting(STORAGE_SEEK_STEP, 3, SEEK_STEP_OPTIONS);
  let playbackRate = readNumberSetting(
    STORAGE_PLAYBACK_RATE,
    1,
    PLAYBACK_RATE_OPTIONS
  );
  let playerCollapsed = localStorage.getItem(STORAGE_PLAYER_COLLAPSED) === 'true';

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function getRouteKey() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  function isElementVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    if (element.getClientRects().length === 0) return false;
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getMessageContextFromGroup(group) {
    if (!(group instanceof Element)) return null;
    const turn = group.closest('article, [data-testid^="conversation-turn-"]') ||
      group.closest('[data-message-author-role="assistant"]') || group.parentElement;
    if (!(turn instanceof Element)) return null;

    const key =
      turn.getAttribute('data-testid') ||
      turn.getAttribute('data-message-id') ||
      turn.id ||
      null;

    return { group, turn, key };
  }

  function collectPlayableMessageContexts() {
    const contexts = [];
    const seenTurns = new Set();

    for (const group of collectActionGroups(document)) {
      if (!isAssistantActionGroup(group) || !isElementVisible(group)) continue;
      const moreButton = findMoreButton(group);
      if (!(moreButton instanceof HTMLButtonElement) || !moreButton.isConnected) continue;

      const context = getMessageContextFromGroup(group);
      if (!context || seenTurns.has(context.turn)) continue;
      seenTurns.add(context.turn);
      contexts.push(context);
    }

    return contexts;
  }

  function findContextIndex(contexts, context = currentMessageContext) {
    if (!contexts.length) return -1;
    if (context?.group?.isConnected) {
      const exactGroupIndex = contexts.findIndex((item) => item.group === context.group);
      if (exactGroupIndex >= 0) return exactGroupIndex;
    }
    if (context?.turn?.isConnected) {
      const exactTurnIndex = contexts.findIndex((item) => item.turn === context.turn);
      if (exactTurnIndex >= 0) return exactTurnIndex;
    }
    if (context?.key) {
      const keyIndex = contexts.findIndex((item) => item.key === context.key);
      if (keyIndex >= 0) return keyIndex;
    }
    if (lastKnownMessageIndex >= 0) {
      return Math.min(lastKnownMessageIndex, contexts.length - 1);
    }
    return contexts.length - 1;
  }

  function setPlayerStatus(message, duration = STATUS_DISPLAY_MS) {
    if (!playerStatus) return;
    window.clearTimeout(statusTimer);
    playerStatus.textContent = message || '';
    if (message && duration > 0) {
      statusTimer = window.setTimeout(() => {
        if (playerStatus) playerStatus.textContent = '';
      }, duration);
    }
  }

  function readNumberSetting(key, fallback, allowedValues) {
    const value = Number(localStorage.getItem(key));
    return allowedValues.includes(value) ? value : fallback;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ELEMENT_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
      html[${HIDE_MENU_ATTRIBUTE}] [role="menu"]:has(${OFFICIAL_VOICE_ITEM_SELECTOR}),
      html[${HIDE_MENU_ATTRIBUTE}] [data-radix-menu-content]:has(${OFFICIAL_VOICE_ITEM_SELECTOR}) {
        opacity: 0 !important;
        transition: none !important;
        animation: none !important;
      }

      button[${CUSTOM_BUTTON_ATTRIBUTE}="true"] { color: #607f91; }
      button[${CUSTOM_BUTTON_ATTRIBUTE}="true"]:hover { color: #4f7185; }
      html.dark button[${CUSTOM_BUTTON_ATTRIBUTE}="true"],
      html[data-theme="dark"] button[${CUSTOM_BUTTON_ATTRIBUTE}="true"] { color: #88a3b2; }
      html.dark button[${CUSTOM_BUTTON_ATTRIBUTE}="true"]:hover,
      html[data-theme="dark"] button[${CUSTOM_BUTTON_ATTRIBUTE}="true"]:hover { color: #9bb3c0; }
      button[${CUSTOM_BUTTON_ATTRIBUTE}="true"][aria-busy="true"] { opacity: 0.55; pointer-events: none; }

      #${PLAYER_ID} {
        position: fixed;
        right: 18px;
        bottom: 86px;
        z-index: 2147483000;
        width: min(344px, calc(100vw - 28px));
        color: #e7eef2;
        background: rgba(39, 53, 62, 0.97);
        border: 1px solid rgba(157, 183, 196, 0.28);
        border-radius: 12px;
        box-shadow: 0 12px 30px rgba(10, 18, 23, 0.34);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font: 12px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      #${PLAYER_ID}[hidden] { display: none !important; }

      #${PLAYER_ID} .cyan-player-header {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 5px 6px 5px 10px;
        background: rgba(24, 35, 42, 0.34);
        border-bottom: 1px solid rgba(178, 199, 209, 0.14);
      }
      #${PLAYER_ID} .cyan-player-header-settings {
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
        flex: 1;
      }
      #${PLAYER_ID} .cyan-player-setting {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        color: rgba(231, 238, 242, 0.78);
      }
      #${PLAYER_ID} .cyan-player-window-actions {
        display: inline-flex;
        align-items: center;
        gap: 1px;
      }
      #${PLAYER_ID} select {
        height: 26px;
        padding: 1px 22px 1px 7px;
        color: #eaf1f4;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(178, 199, 209, 0.22);
        border-radius: 7px;
        outline: none;
        font: inherit;
      }
      #${PLAYER_ID} select:hover { background: rgba(255, 255, 255, 0.11); }
      #${PLAYER_ID} select:disabled { opacity: 0.48; }

      #${PLAYER_ID} .cyan-player-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        padding: 0;
        color: #dce8ed;
        background: transparent;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
      }
      #${PLAYER_ID} .cyan-player-icon-button:hover { background: rgba(188, 211, 221, 0.12); }
      #${PLAYER_ID} .cyan-player-icon-button:disabled { opacity: 0.4; cursor: default; }
      #${PLAYER_ID} .cyan-player-icon-button svg { width: 23px; height: 23px; }

      #${PLAYER_ID} .cyan-player-body { padding: 8px 10px 9px; }
      #${PLAYER_ID}[${PLAYER_COLLAPSED_ATTRIBUTE}="true"] .cyan-player-body { display: none; }
      #${PLAYER_ID}[${PLAYER_COLLAPSED_ATTRIBUTE}="true"] .cyan-player-header { border-bottom: 0; }

      #${PLAYER_ID} .cyan-player-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-bottom: 7px;
      }
      #${PLAYER_ID} .cyan-player-control-button {
        position: relative;
        width: 36px;
        height: 36px;
        color: #d9e7ed;
        background: rgba(177, 205, 217, 0.08);
        border: 1px solid rgba(177, 205, 217, 0.13);
        border-radius: 10px;
      }
      #${PLAYER_ID} .cyan-player-main-button {
        width: 42px;
        height: 42px;
        color: #eef6f8;
        background: rgba(119, 157, 176, 0.26);
        border-color: rgba(169, 199, 212, 0.26);
        border-radius: 50%;
      }
      #${PLAYER_ID} .cyan-player-main-button:hover { background: rgba(119, 157, 176, 0.36); }
      #${PLAYER_ID} .cyan-player-message-button {
        width: 32px;
        height: 32px;
        background: transparent;
        border-color: transparent;
      }
      #${PLAYER_ID} .cyan-player-message-button svg { width: 21px; height: 21px; }
      #${PLAYER_ID} .cyan-player-status {
        flex: 0 1 auto;
        max-width: 66px;
        overflow: hidden;
        color: rgba(220, 234, 240, 0.82);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PLAYER_ID} .cyan-player-status:empty { display: none; }

      #${PLAYER_ID} .cyan-player-seek-row {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) 36px;
        align-items: center;
        gap: 6px;
      }
      #${PLAYER_ID} .cyan-player-time {
        color: rgba(231, 238, 242, 0.72);
        font-variant-numeric: tabular-nums;
        text-align: center;
      }
      #${PLAYER_ID} input[type="range"] {
        width: 100%;
        height: 18px;
        margin: 0;
        accent-color: #7f9faf;
        cursor: pointer;
      }
      #${PLAYER_ID} input[type="range"]:disabled { opacity: 0.4; cursor: default; }

      @media (max-width: 640px) {
        #${PLAYER_ID} { right: 10px; bottom: 74px; width: calc(100vw - 20px); }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function isAssistantActionGroup(group) {
    if (!(group instanceof Element) || !group.isConnected) return false;

    const turn = group.closest('article, [data-testid^="conversation-turn-"]');
    if (turn?.querySelector('[data-message-author-role="assistant"]')) return true;
    if (group.closest('[data-message-author-role="assistant"]')) return true;

    const moreButton = group.querySelector(MORE_BUTTON_SELECTOR);
    const label = normalizeText(group.getAttribute('aria-label'));
    return !!moreButton && (label === '回复操作' || label === 'Response actions');
  }

  function findMoreButton(group) {
    return group.querySelector(MORE_BUTTON_SELECTOR);
  }

  function createSvgIcon(pathData, viewBox = '0 0 24 24') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.15');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function createSpeakerIcon() {
    return createSvgIcon(
      'M11 5 6.8 8.5H4.5A1.5 1.5 0 0 0 3 10v4a1.5 1.5 0 0 0 1.5 1.5h2.3L11 19V5Zm4.2 3.2a5.4 5.4 0 0 1 0 7.6M17.9 5.5a9 9 0 0 1 0 13'
    );
  }

  function createVoiceButton(moreButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = moreButton.className;
    button.setAttribute(CUSTOM_BUTTON_ATTRIBUTE, 'true');
    button.setAttribute('aria-label', '朗读或重播');
    button.setAttribute('title', '朗读或重播');

    const officialInner = moreButton.querySelector(':scope > span');
    const span = document.createElement('span');
    span.className = officialInner?.className ||
      'flex items-center justify-center touch:w-10 h-8 w-8';
    span.appendChild(createSpeakerIcon());
    button.appendChild(span);
    button.addEventListener('click', handleVoiceButtonClick);
    return button;
  }

  function enhanceActionGroup(group) {
    if (!isAssistantActionGroup(group)) return;

    const existingButton = group.querySelector(
      `button[${CUSTOM_BUTTON_ATTRIBUTE}="true"]`
    );
    const moreButton = findMoreButton(group);

    if (!moreButton) {
      group.removeAttribute(PROCESSED_GROUP_ATTRIBUTE);
      return;
    }

    if (existingButton) {
      if (existingButton !== group.lastElementChild) group.appendChild(existingButton);
      group.setAttribute(PROCESSED_GROUP_ATTRIBUTE, 'true');
      return;
    }

    group.appendChild(createVoiceButton(moreButton));
    group.setAttribute(PROCESSED_GROUP_ATTRIBUTE, 'true');
  }

  function collectActionGroups(root) {
    const groups = [];

    if (root instanceof Element) {
      if (root.matches(ACTION_GROUP_SELECTOR)) groups.push(root);
      groups.push(...root.querySelectorAll(ACTION_GROUP_SELECTOR));
    } else if (root === document) {
      groups.push(...document.querySelectorAll(ACTION_GROUP_SELECTOR));
    }

    if (groups.length > 0) return groups;

    const fallbackGroups = [];
    if (root instanceof Element) {
      if (
        root.matches(FALLBACK_ACTION_GROUP_SELECTOR) &&
        root.querySelector(MORE_BUTTON_SELECTOR)
      ) {
        fallbackGroups.push(root);
      }
      for (const group of root.querySelectorAll(FALLBACK_ACTION_GROUP_SELECTOR)) {
        if (group.querySelector(MORE_BUTTON_SELECTOR)) fallbackGroups.push(group);
      }
    } else if (root === document) {
      for (const group of document.querySelectorAll(FALLBACK_ACTION_GROUP_SELECTOR)) {
        if (group.querySelector(MORE_BUTTON_SELECTOR)) fallbackGroups.push(group);
      }
    }

    return fallbackGroups;
  }

  function scanRoot(root) {
    for (const group of collectActionGroups(root)) enhanceActionGroup(group);
  }

  function scheduleScan(root) {
    pendingScanRoots.add(root instanceof Node ? root : document);
    if (scanFrame !== null) return;

    scanFrame = window.requestAnimationFrame(() => {
      scanFrame = null;
      const roots = Array.from(pendingScanRoots);
      pendingScanRoots.clear();
      for (const scanTarget of roots) {
        if (scanTarget === document || scanTarget.isConnected) scanRoot(scanTarget);
      }
    });
  }

  function isVisibleVoiceItem(item) {
    if (!(item instanceof HTMLElement) || !item.isConnected) return false;
    if (item.getClientRects().length === 0) return false;
    if (item.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(item);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getCandidateVoiceItems() {
    return Array.from(document.querySelectorAll(OFFICIAL_VOICE_ITEM_SELECTOR)).filter(
      isVisibleVoiceItem
    );
  }

  function dispatchPointerExit(element) {
    for (const type of ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']) {
      element.dispatchEvent(
        new MouseEvent(type, {
          bubbles: type === 'pointerout' || type === 'mouseout',
          cancelable: false,
          view: window,
        })
      );
    }
  }

  function closeOperationMenu(operation) {
    const moreButton = operation?.moreButton;
    if (!(moreButton instanceof HTMLButtonElement) || !moreButton.isConnected) return;

    const isOpen =
      moreButton.getAttribute('aria-expanded') === 'true' ||
      moreButton.getAttribute('data-state') === 'open';

    if (isOpen) moreButton.click();
  }

  function clearMoreButtonVisualState(operation) {
    dispatchPointerExit(operation.moreButton);
    operation.moreButton.blur();
    operation.button.focus({ preventScroll: true });
  }

  function finishOperation(operation, error = null) {
    if (activeOperation !== operation) return;

    activeOperation = null;
    operation.observer?.disconnect();
    window.clearTimeout(operation.timeoutId);
    window.clearTimeout(operation.activationTimerId);
    operation.button.removeAttribute('aria-busy');
    operation.button.disabled = false;
    document.documentElement.removeAttribute(HIDE_MENU_ATTRIBUTE);
    clearMoreButtonVisualState(operation);

    if (error) {
      closeOperationMenu(operation);
      if (navigationInProgress) {
        navigationInProgress = false;
        pendingMessageContext = null;
        window.clearTimeout(messageSwitchTimer);
        if (playbackSessionState === 'opening') playbackSessionState = 'idle';
        setPlayerStatus('切换失败');
        updatePlayerState();
      }
      console.warn(`${SCRIPT_PREFIX} ${error}`);
    }
  }

  function dispatchActivationSequence(element) {
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
    };

    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
      element.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
    }

    element.dispatchEvent(new MouseEvent('mousedown', eventInit));
    element.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
    element.click();
  }

  function activateOfficialVoiceItem(operation, item) {
    if (operation.completed || operation.activationTimerId !== null) return;
    if (activeOperation !== operation) return;

    operation.activationTimerId = window.setTimeout(() => {
      operation.activationTimerId = null;
      if (operation.completed || activeOperation !== operation) return;
      if (!isVisibleVoiceItem(item)) return;

      operation.completed = true;
      dispatchActivationSequence(item);

      window.setTimeout(() => {
        closeOperationMenu(operation);
        finishOperation(operation);
      }, MENU_CLOSE_DELAY_MS);
    }, ITEM_ACTIVATION_DELAY_MS);
  }

  function tryActivateVoiceItem(operation) {
    if (operation.completed || activeOperation !== operation) return false;

    const candidates = getCandidateVoiceItems();
    if (candidates.length === 0) return false;

    const newCandidate = candidates.find((item) => !operation.initialItems.has(item));
    const item = newCandidate || candidates[candidates.length - 1];
    activateOfficialVoiceItem(operation, item);
    return true;
  }

  function startOfficialVoiceAction(button, moreButton) {
    if (activeOperation) {
      console.warn(`${SCRIPT_PREFIX} 上一次朗读操作尚未完成。`);
      return;
    }

    const operation = {
      button,
      moreButton,
      initialItems: new Set(document.querySelectorAll(OFFICIAL_VOICE_ITEM_SELECTOR)),
      observer: null,
      timeoutId: null,
      activationTimerId: null,
      completed: false,
    };

    activeOperation = operation;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    document.documentElement.setAttribute(HIDE_MENU_ATTRIBUTE, 'true');

    operation.observer = new MutationObserver(() => tryActivateVoiceItem(operation));
    operation.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'aria-hidden', 'style'],
    });

    operation.timeoutId = window.setTimeout(() => {
      finishOperation(operation, '未找到官方朗读菜单项，本次操作已取消。');
    }, MENU_WAIT_TIMEOUT_MS);

    moreButton.click();
    window.requestAnimationFrame(() => tryActivateVoiceItem(operation));
  }

  function handleVoiceButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;

    const group = button.closest('[role="group"]');
    const moreButton = group ? findMoreButton(group) : null;

    if (!(moreButton instanceof HTMLButtonElement) || !moreButton.isConnected) {
      console.warn(`${SCRIPT_PREFIX} 未找到当前回答对应的“更多操作”按钮。`);
      return;
    }

    const messageContext = getMessageContextFromGroup(group);
    pendingMessageContext = messageContext;
    currentMessageContext = messageContext || currentMessageContext;
    const contexts = collectPlayableMessageContexts();
    const contextIndex = findContextIndex(contexts, messageContext);
    if (contextIndex >= 0) lastKnownMessageIndex = contextIndex;

    playbackSessionId += 1;
    playbackSessionState = 'opening';
    openingRequestUntil = Date.now() + 10000;
    dismissedAudio = null;
    navigationInProgress = false;
    window.clearTimeout(messageSwitchTimer);

    if (activeOperation) {
      finishOperation(activeOperation);
    }

    startOfficialVoiceAction(button, moreButton);
  }

  function createPlayerIconButton(label, pathData, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cyan-player-icon-button ${extraClass}`.trim();
    button.setAttribute('aria-label', label);
    button.title = label;
    button.appendChild(createSvgIcon(pathData));
    return button;
  }

  function replaceButtonIcon(button, label, pathData) {
    if (!button) return;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.replaceChildren(createSvgIcon(pathData));
  }

  function createOption(value, label) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = label;
    return option;
  }

  function createSeekControl(direction) {
    const isBackward = direction < 0;
    const button = createPlayerIconButton(
      `${isBackward ? '后退' : '前进'} ${seekStep} 秒`,
      isBackward
        ? 'M11 7 6 12l5 5M18 7l-5 5 5 5'
        : 'M6 7l5 5-5 5M13 7l5 5-5 5',
      'cyan-player-control-button'
    );
    button.addEventListener('click', () => seekBy(direction * seekStep));
    return button;
  }

  function updateSeekControlLabels() {
    for (const [button, prefix] of [
      [backwardButton, '后退'],
      [forwardButton, '前进'],
    ]) {
      if (!button) continue;
      button.setAttribute('aria-label', `${prefix} ${seekStep} 秒`);
      button.title = `${prefix} ${seekStep} 秒`;
    }
  }


  function createMessageNavigationButton(direction) {
    const isPrevious = direction < 0;
    const button = createPlayerIconButton(
      isPrevious ? '播放上一条消息' : '播放下一条消息',
      isPrevious
        ? 'M7 6v12M18 7l-8 5 8 5V7Z'
        : 'M17 6v12M6 7l8 5-8 5V7Z',
      'cyan-player-control-button cyan-player-message-button'
    );
    button.addEventListener('click', () => switchMessage(direction));
    return button;
  }

  function getCurrentAudioSource() {
    if (!currentAudio) return '';
    return `${currentAudio.currentSrc || currentAudio.src || ''}`.trim();
  }

  const MP3_BITRATE_KBPS = 96;
  const MP3_SAMPLE_BLOCK_SIZE = 1152;
  const MP3_YIELD_EVERY_BLOCKS = 32;

  function getLameJs() {
    const library = globalThis.lamejs || window.lamejs;
    if (!library?.Mp3Encoder) {
      throw new Error('lamejs is unavailable');
    }
    return library;
  }

  function buildDownloadFilename(extension) {
    const base = (document.title || 'ChatGPT-朗读')
      .replace(/\s*[|–—-]\s*ChatGPT.*$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'ChatGPT-朗读';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${base}-${stamp}.${extension}`;
  }

  function triggerMp3Download(blob) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = buildDownloadFilename('mp3');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }

  function floatToInt16(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    return clamped < 0
      ? Math.round(clamped * 0x8000)
      : Math.round(clamped * 0x7fff);
  }

  function downmixAudioBufferToMono(audioBuffer) {
    const channelCount = audioBuffer.numberOfChannels;
    const sampleCount = audioBuffer.length;
    const mono = new Int16Array(sampleCount);
    const channels = Array.from(
      { length: channelCount },
      (_, index) => audioBuffer.getChannelData(index)
    );

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      let mixedSample = 0;
      for (const channel of channels) {
        mixedSample += channel[sampleIndex] || 0;
      }
      mono[sampleIndex] = floatToInt16(mixedSample / channelCount);
    }

    return mono;
  }

  function yieldToBrowser() {
    return new Promise((resolve) => {
      if (document.hidden) {
        window.setTimeout(resolve, 0);
      } else {
        window.requestAnimationFrame(() => resolve());
      }
    });
  }

  async function encodeAudioBufferToMp3(audioBuffer) {
    const { Mp3Encoder } = getLameJs();
    const monoSamples = downmixAudioBufferToMono(audioBuffer);
    const encoder = new Mp3Encoder(1, audioBuffer.sampleRate, MP3_BITRATE_KBPS);
    const chunks = [];
    const totalBlocks = Math.ceil(monoSamples.length / MP3_SAMPLE_BLOCK_SIZE);

    for (let offset = 0, blockIndex = 0;
      offset < monoSamples.length;
      offset += MP3_SAMPLE_BLOCK_SIZE, blockIndex += 1) {
      const block = monoSamples.subarray(offset, offset + MP3_SAMPLE_BLOCK_SIZE);
      const encoded = encoder.encodeBuffer(block);
      if (encoded.length > 0) chunks.push(new Uint8Array(encoded));

      if (blockIndex % MP3_YIELD_EVERY_BLOCKS === 0) {
        const progress = Math.min(99, Math.round(((blockIndex + 1) / totalBlocks) * 100));
        setPlayerStatus(`正在转换 MP3… ${progress}%`, 0);
        await yieldToBrowser();
      }
    }

    const finalChunk = encoder.flush();
    if (finalChunk.length > 0) chunks.push(new Uint8Array(finalChunk));
    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  async function decodeAudioBlob(blob) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API is unavailable');

    const context = new AudioContextClass();
    try {
      return await context.decodeAudioData(await blob.arrayBuffer());
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function downloadCurrentAudio() {
    if (downloadInProgress || !currentAudio) return;
    const source = getCurrentAudioSource();
    if (!source || currentAudio.srcObject) {
      setPlayerStatus('当前音频不可下载');
      return;
    }

    downloadInProgress = true;
    setPlayerStatus('正在读取音频…', 0);
    updatePlayerState();

    try {
      const response = await fetch(source, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sourceBlob = await response.blob();
      if (!sourceBlob.size) throw new Error('empty audio blob');

      setPlayerStatus('正在解码音频…', 0);
      const audioBuffer = await decodeAudioBlob(sourceBlob);
      const mp3Blob = await encodeAudioBufferToMp3(audioBuffer);
      if (!mp3Blob.size) throw new Error('empty MP3 blob');

      triggerMp3Download(mp3Blob);
      setPlayerStatus('MP3 已开始下载');
    } catch (error) {
      console.warn(`${SCRIPT_PREFIX} MP3 下载失败。`, error);
      const message = /lamejs/i.test(String(error?.message || error))
        ? 'MP3 编码器加载失败'
        : 'MP3 下载失败';
      setPlayerStatus(message);
    } finally {
      downloadInProgress = false;
      updatePlayerState();
    }
  }

  function createPlayer() {
    if (player?.isConnected) return player;

    player = document.createElement('section');
    player.id = PLAYER_ID;
    player.hidden = true;
    player.setAttribute('role', 'region');
    player.setAttribute('aria-label', 'ChatGPT 朗读播放器');
    player.setAttribute(PLAYER_COLLAPSED_ATTRIBUTE, String(playerCollapsed));

    const header = document.createElement('div');
    header.className = 'cyan-player-header';

    const headerSettings = document.createElement('div');
    headerSettings.className = 'cyan-player-header-settings';

    const seekSetting = document.createElement('label');
    seekSetting.className = 'cyan-player-setting';
    seekSetting.append(document.createTextNode('跳转'));
    seekStepSelect = document.createElement('select');
    seekStepSelect.setAttribute('aria-label', '快进后退秒数');
    for (const seconds of SEEK_STEP_OPTIONS) {
      seekStepSelect.appendChild(createOption(seconds, `${seconds} 秒`));
    }
    seekStepSelect.value = String(seekStep);
    seekStepSelect.addEventListener('change', handleSeekStepChange);
    seekSetting.appendChild(seekStepSelect);

    const speedSetting = document.createElement('label');
    speedSetting.className = 'cyan-player-setting';
    speedSetting.append(document.createTextNode('速度'));
    speedSelect = document.createElement('select');
    speedSelect.setAttribute('aria-label', '播放速度');
    for (const rate of PLAYBACK_RATE_OPTIONS) {
      speedSelect.appendChild(createOption(rate, `${rate}×`));
    }
    speedSelect.value = String(playbackRate);
    speedSelect.addEventListener('change', handlePlaybackRateChange);
    speedSetting.appendChild(speedSelect);

    downloadButton = createPlayerIconButton(
      '下载当前音频为 MP3',
      'M12 3v12M8 11l4 4 4-4M5 20h14'
    );
    downloadButton.addEventListener('click', downloadCurrentAudio);

    headerSettings.append(seekSetting, speedSetting, downloadButton);

    playerStatus = document.createElement('span');
    playerStatus.className = 'cyan-player-status';
    playerStatus.setAttribute('role', 'status');
    playerStatus.setAttribute('aria-live', 'polite');

    const windowActions = document.createElement('div');
    windowActions.className = 'cyan-player-window-actions';

    minimizeButton = createPlayerIconButton(
      playerCollapsed ? '展开播放器' : '最小化播放器',
      playerCollapsed ? 'M7 12h10M12 7v10' : 'M7 12h10'
    );
    minimizeButton.addEventListener('click', togglePlayerCollapsed);

    const closeButton = createPlayerIconButton('关闭播放器', 'M6 6l12 12M18 6 6 18');
    closeButton.addEventListener('click', closePlayer);
    windowActions.append(minimizeButton, closeButton);
    header.append(headerSettings, playerStatus, windowActions);

    playerBody = document.createElement('div');
    playerBody.className = 'cyan-player-body';

    const controls = document.createElement('div');
    controls.className = 'cyan-player-controls';

    previousMessageButton = createMessageNavigationButton(-1);
    backwardButton = createSeekControl(-1);
    playPauseButton = createPlayerIconButton(
      '播放',
      'M9 7.5v9l7-4.5-7-4.5Z',
      'cyan-player-control-button cyan-player-main-button'
    );
    playPauseButton.addEventListener('click', togglePlayback);
    forwardButton = createSeekControl(1);
    nextMessageButton = createMessageNavigationButton(1);
    controls.append(
      previousMessageButton,
      backwardButton,
      playPauseButton,
      forwardButton,
      nextMessageButton
    );

    const seekRow = document.createElement('div');
    seekRow.className = 'cyan-player-seek-row';
    currentTimeLabel = document.createElement('span');
    currentTimeLabel.className = 'cyan-player-time';
    currentTimeLabel.textContent = '0:00';
    seekRange = document.createElement('input');
    seekRange.type = 'range';
    seekRange.min = '0';
    seekRange.max = '1000';
    seekRange.step = '1';
    seekRange.value = '0';
    seekRange.setAttribute('aria-label', '播放进度');
    seekRange.addEventListener('input', handleSeekInput);
    durationLabel = document.createElement('span');
    durationLabel.className = 'cyan-player-time';
    durationLabel.textContent = '--:--';
    seekRow.append(currentTimeLabel, seekRange, durationLabel);

    playerBody.append(controls, seekRow);
    player.append(header, playerBody);
    document.body.appendChild(player);
    updatePlayerState();
    return player;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
  }

  function hasUsableDuration(audio = currentAudio) {
    return !!audio && Number.isFinite(audio.duration) && audio.duration > 0;
  }

  function isUsableAudio(audio) {
    return audio instanceof HTMLAudioElement && audio.isConnected !== false;
  }

  function scoreAudio(audio, index) {
    if (!(audio instanceof HTMLAudioElement)) return -Infinity;
    let score = index;
    const source = `${audio.currentSrc || audio.src || ''}`;
    if (source) score += 100;
    if (/synthesi[sz]e|speech|audio/i.test(source)) score += 180;
    if (!audio.paused && !audio.ended) score += 1000;
    if (audio.currentTime > 0) score += 80;
    if (audio.readyState > 0) score += 20;
    if (audio === currentAudio) score += 40;
    if (audio.ended) score -= 120;
    return score;
  }

  function findBestAudio() {
    const audios = Array.from(document.querySelectorAll('audio'));
    if (currentAudio && !audios.includes(currentAudio)) audios.push(currentAudio);
    if (audios.length === 0) return null;

    return audios
      .map((audio, index) => ({ audio, score: scoreAudio(audio, index) }))
      .sort((a, b) => b.score - a.score)[0].audio;
  }

  function bindAudio(audio, shouldShow = false) {
    if (!(audio instanceof HTMLAudioElement)) return;

    if (currentAudio === audio) {
      if (shouldShow && dismissedAudio !== audio) showPlayer();
      updatePlayerState();
      return;
    }

    unbindCurrentAudio();
    currentAudio = audio;
    currentAudio.playbackRate = playbackRate;

    for (const eventName of [
      'play',
      'pause',
      'ended',
      'timeupdate',
      'durationchange',
      'loadedmetadata',
      'ratechange',
      'emptied',
    ]) {
      currentAudio.addEventListener(eventName, handleAudioStateEvent);
    }

    if (shouldShow && dismissedAudio !== audio) showPlayer();
    updatePlayerState();
  }

  function unbindCurrentAudio() {
    if (!currentAudio) return;
    for (const eventName of [
      'play',
      'pause',
      'ended',
      'timeupdate',
      'durationchange',
      'loadedmetadata',
      'ratechange',
      'emptied',
    ]) {
      currentAudio.removeEventListener(eventName, handleAudioStateEvent);
    }
    currentAudio = null;
  }

  function canShowAudio(audio) {
    if (!(audio instanceof HTMLAudioElement)) return false;

    if (playbackSessionState === 'dismissed') {
      return audio !== dismissedAudio;
    }

    return true;
  }

  function activatePlaybackSession(audio) {
    if (!(audio instanceof HTMLAudioElement)) return false;

    if (playbackSessionState === 'opening') {
      if (Date.now() > openingRequestUntil) {
        playbackSessionState = 'idle';
        openingRequestUntil = 0;
      } else {
        playbackSessionState = 'active';
        openingRequestUntil = 0;
        dismissedAudio = null;
        if (pendingMessageContext) {
          currentMessageContext = pendingMessageContext;
          pendingMessageContext = null;
        }
        navigationInProgress = false;
        window.clearTimeout(messageSwitchTimer);
        setPlayerStatus('');
        return true;
      }
    }

    if (playbackSessionState === 'dismissed' && audio === dismissedAudio) {
      return false;
    }

    playbackSessionState = 'active';
    dismissedAudio = null;
    if (pendingMessageContext) {
      currentMessageContext = pendingMessageContext;
      pendingMessageContext = null;
    }
    navigationInProgress = false;
    window.clearTimeout(messageSwitchTimer);
    setPlayerStatus('');
    return true;
  }

  function handleAudioStateEvent(event) {
    if (event.currentTarget !== currentAudio) return;

    if (event.type === 'play' && activatePlaybackSession(currentAudio)) {
      showPlayer();
    }

    if (event.type === 'ended' && playbackSessionState === 'active') {
      playbackSessionState = 'idle';
    }

    updatePlayerState();
  }

  function showPlayer() {
    if (!canShowAudio(currentAudio)) return;
    createPlayer();
    player.hidden = false;
  }

  function closePlayer() {
    playbackSessionId += 1;
    playbackSessionState = 'dismissed';
    openingRequestUntil = 0;
    navigationInProgress = false;
    pendingMessageContext = null;
    window.clearTimeout(messageSwitchTimer);

    if (activeOperation) {
      finishOperation(activeOperation);
    }

    if (currentAudio) {
      dismissedAudio = currentAudio;
      if (!currentAudio.paused) currentAudio.pause();
    }

    if (player) player.hidden = true;
  }

  function switchMessage(direction) {
    if (direction !== -1 && direction !== 1) return;
    if (navigationInProgress || activeOperation) {
      setPlayerStatus('正在切换…');
      return;
    }

    const contexts = collectPlayableMessageContexts();
    if (!contexts.length) {
      setPlayerStatus('没有可朗读消息');
      return;
    }

    const currentIndex = findContextIndex(contexts);
    if (currentIndex < 0) {
      setPlayerStatus('无法定位当前消息');
      return;
    }

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0) {
      setPlayerStatus('已经是第一条');
      updateMessageNavigationState(contexts, currentIndex);
      return;
    }
    if (targetIndex >= contexts.length) {
      setPlayerStatus('已经是最后一条');
      updateMessageNavigationState(contexts, currentIndex);
      return;
    }

    const target = contexts[targetIndex];
    const customButton = target.group.querySelector(
      `button[${CUSTOM_BUTTON_ATTRIBUTE}="true"]`
    );
    const moreButton = findMoreButton(target.group);
    if (!(customButton instanceof HTMLButtonElement) ||
        !(moreButton instanceof HTMLButtonElement)) {
      setPlayerStatus('目标消息尚未就绪');
      scheduleScan(target.group);
      return;
    }

    navigationInProgress = true;
    pendingMessageContext = target;
    lastKnownMessageIndex = targetIndex;
    playbackSessionId += 1;
    playbackSessionState = 'opening';
    openingRequestUntil = Date.now() + MESSAGE_SWITCH_TIMEOUT_MS;
    dismissedAudio = null;
    setPlayerStatus('正在切换…', 0);
    updatePlayerState();

    if (currentAudio && !currentAudio.paused) currentAudio.pause();
    target.turn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    startOfficialVoiceAction(customButton, moreButton);

    window.clearTimeout(messageSwitchTimer);
    messageSwitchTimer = window.setTimeout(() => {
      if (!navigationInProgress) return;
      navigationInProgress = false;
      pendingMessageContext = null;
      if (playbackSessionState === 'opening') playbackSessionState = 'idle';
      setPlayerStatus('切换超时');
      updatePlayerState();
    }, MESSAGE_SWITCH_TIMEOUT_MS);
  }

  function updateMessageNavigationState(contexts = null, currentIndex = null) {
    if (!previousMessageButton || !nextMessageButton) return;
    const list = contexts || collectPlayableMessageContexts();
    const index = currentIndex ?? findContextIndex(list);
    const disabled = navigationInProgress || !list.length || index < 0;
    previousMessageButton.disabled = disabled || index <= 0;
    nextMessageButton.disabled = disabled || index >= list.length - 1;
  }

  function resetPlaybackForRouteChange() {
    currentRouteKey = getRouteKey();
    playbackSessionId += 1;
    playbackSessionState = 'idle';
    openingRequestUntil = 0;
    navigationInProgress = false;
    currentMessageContext = null;
    pendingMessageContext = null;
    lastKnownMessageIndex = -1;
    dismissedAudio = null;
    window.clearTimeout(messageSwitchTimer);
    window.clearTimeout(statusTimer);
    if (activeOperation) finishOperation(activeOperation);
    if (currentAudio && !currentAudio.paused) currentAudio.pause();
    unbindCurrentAudio();
    if (player) player.hidden = true;
    setPlayerStatus('');
  }

  function checkRouteChange() {
    if (getRouteKey() !== currentRouteKey) resetPlaybackForRouteChange();
  }

  function togglePlayerCollapsed() {
    playerCollapsed = !playerCollapsed;
    localStorage.setItem(STORAGE_PLAYER_COLLAPSED, String(playerCollapsed));
    player?.setAttribute(PLAYER_COLLAPSED_ATTRIBUTE, String(playerCollapsed));
    replaceButtonIcon(
      minimizeButton,
      playerCollapsed ? '展开播放器' : '最小化播放器',
      playerCollapsed ? 'M7 12h10M12 7v10' : 'M7 12h10'
    );
  }

  function togglePlayback() {
    if (!currentAudio) return;
    if (currentAudio.paused || currentAudio.ended) {
      const playPromise = currentAudio.play();
      playPromise?.catch((error) => {
        console.warn(`${SCRIPT_PREFIX} 音频播放失败。`, error);
      });
    } else {
      currentAudio.pause();
    }
  }

  function seekBy(seconds) {
    if (!currentAudio) return;
    const duration = hasUsableDuration() ? currentAudio.duration : Infinity;
    const nextTime = Math.max(0, Math.min(currentAudio.currentTime + seconds, duration));
    if (Number.isFinite(nextTime)) currentAudio.currentTime = nextTime;
    updatePlayerState();
  }

  function handleSeekInput() {
    if (!currentAudio || !hasUsableDuration()) return;
    const ratio = Number(seekRange.value) / 1000;
    currentAudio.currentTime = currentAudio.duration * ratio;
    updatePlayerState();
  }

  function handleSeekStepChange() {
    const nextStep = Number(seekStepSelect.value);
    if (!SEEK_STEP_OPTIONS.includes(nextStep)) return;
    seekStep = nextStep;
    localStorage.setItem(STORAGE_SEEK_STEP, String(seekStep));
    updateSeekControlLabels();
  }

  function handlePlaybackRateChange() {
    const nextRate = Number(speedSelect.value);
    if (!PLAYBACK_RATE_OPTIONS.includes(nextRate)) return;
    playbackRate = nextRate;
    localStorage.setItem(STORAGE_PLAYBACK_RATE, String(playbackRate));
    if (currentAudio) currentAudio.playbackRate = playbackRate;
  }

  function updatePlayerState() {
    if (!player) return;

    const hasAudio = currentAudio instanceof HTMLAudioElement;
    const isPlaying = hasAudio && !currentAudio.paused && !currentAudio.ended;
    const canSeek = hasAudio && hasUsableDuration();

    backwardButton.disabled = !hasAudio || navigationInProgress;
    forwardButton.disabled = !hasAudio || navigationInProgress;
    playPauseButton.disabled = !hasAudio || navigationInProgress;
    seekRange.disabled = !canSeek;
    speedSelect.disabled = !hasAudio || navigationInProgress;
    seekStepSelect.disabled = navigationInProgress;
    if (downloadButton) {
      downloadButton.disabled =
        !hasAudio || navigationInProgress || downloadInProgress ||
        !getCurrentAudioSource() || !!currentAudio?.srcObject;
      downloadButton.setAttribute('aria-busy', String(downloadInProgress));
    }
    updateMessageNavigationState();

    replaceButtonIcon(
      playPauseButton,
      isPlaying ? '暂停' : '播放',
      isPlaying ? 'M9 7v10M15 7v10' : 'M9 7.5v9l7-4.5-7-4.5Z'
    );

    if (!hasAudio) {
      currentTimeLabel.textContent = '0:00';
      durationLabel.textContent = '--:--';
      seekRange.value = '0';
      return;
    }

    currentTimeLabel.textContent = formatTime(currentAudio.currentTime);
    durationLabel.textContent = formatTime(currentAudio.duration);
    seekRange.value = canSeek
      ? String(Math.round((currentAudio.currentTime / currentAudio.duration) * 1000))
      : '0';
    speedSelect.value = String(currentAudio.playbackRate || playbackRate);
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'
    );
  }

  function handleGlobalKeydown(event) {
    if (!event.isTrusted) return;
    if (!player || player.hidden || !currentAudio) return;
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    if (isEditableTarget(event.target)) return;

    let handled = true;
    switch (event.key) {
      case 'ArrowUp':
        switchMessage(-1);
        break;
      case 'ArrowDown':
        switchMessage(1);
        break;
      case 'ArrowLeft':
        seekBy(-seekStep);
        break;
      case 'ArrowRight':
        seekBy(seekStep);
        break;
      case ' ':
      case 'Spacebar':
        togglePlayback();
        break;
      case 'Escape':
        closePlayer();
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleDocumentPlay(event) {
    const audio = event.target;
    if (!(audio instanceof HTMLAudioElement)) return;

    const shouldShow = activatePlaybackSession(audio);
    bindAudio(audio, shouldShow);
  }

  function scanForAudio() {
    checkRouteChange();
    const audio = findBestAudio();
    if (!audio || audio.paused || audio.ended) return;

    if (playbackSessionState === 'opening' && Date.now() > openingRequestUntil) {
      playbackSessionState = 'idle';
      openingRequestUntil = 0;
    }

    const shouldShow = playbackSessionState !== 'dismissed' && canShowAudio(audio);
    bindAudio(audio, shouldShow);
  }

  function startAudioTracking() {
    document.addEventListener('play', handleDocumentPlay, true);
    document.addEventListener('keydown', handleGlobalKeydown, true);
    audioScanTimer = window.setInterval(scanForAudio, AUDIO_SCAN_INTERVAL_MS);
    scanForAudio();
  }

  function observePage() {
    const observer = new MutationObserver((mutations) => {
      checkRouteChange();
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            scheduleScan(node);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  installStyle();
  scanRoot(document);
  observePage();
  startAudioTracking();
})();

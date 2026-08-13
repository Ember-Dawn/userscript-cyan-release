// ==UserScript==
// @name         ChatGPT 朗读增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-read-aloud-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-read-aloud-enhancer.user.js
// @version      4.0.6
// @description  增强 ChatGPT 官方朗读：一级入口、紧凑播放器、消息切换、进度与倍速控制、MP3 下载和键盘快捷键。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/lamejs-fixed@1.2.2/lame.min.js
// @grant        none
// ==/UserScript==

/*
Current behavior contract:
- Adds a first-level read/replay button to each visible assistant response.
- Delegates speech generation to ChatGPT's official read-aloud action.
- Shows a compact floating player only after official audio starts.
- Captures both DOM-attached and detached HTML audio playback for script-requested read/replay sessions.
- Supports message navigation, seeking, persisted speed/seek settings, and shortcuts.
- Renders seek and speed menus as body-level fixed overlays so they are never
  clipped by the player's rounded overflow boundary.
- Converts HTTP, Blob, and captured MediaSource/AAC audio to mono 96 kbps MP3
  locally, preferring an inline Worker and retaining a main-thread fallback.
*/

(() => {
  'use strict';

  const SCRIPT_PREFIX = '[ChatGPT 朗读增强助手]';
  const SCRIPT_VERSION = '4.0.6';

  function isElementNode(value) {
    return !!value && value.nodeType === 1;
  }

  function isButtonElement(value) {
    return isElementNode(value) && value.tagName === 'BUTTON';
  }

  function isAudioElement(value) {
    return isElementNode(value) && value.tagName === 'AUDIO';
  }

  function isNodeValue(value) {
    return !!value && typeof value.nodeType === 'number';
  }

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
  const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const MENU_WAIT_TIMEOUT_MS = 2000;
  const ITEM_ACTIVATION_DELAY_MS = 32;
  const MENU_CLOSE_DELAY_MS = 100;
  const AUDIO_SCAN_INTERVAL_MS = 500;
  const MESSAGE_SWITCH_TIMEOUT_MS = 12000;
  const STATUS_DISPLAY_MS = 1500;
  const CAPTURED_BLOB_URL_LIMIT = 32;
  const CAPTURED_MEDIA_SOURCE_URL_LIMIT = 8;
  const REVOKED_OBJECT_URL_CLEANUP_DELAY_MS = 300000;

  // Runtime state is grouped by responsibility while the deliverable remains
  // one standalone userscript file.
  const state = {
    enhancement: {
      activeOperation: null,
      scanFrame: null,
      pendingScanRoots: new Set(),
    },
    playback: {
      audio: null,
      dismissedAudio: null,
      sessionState: 'idle',
      openingRequestUntil: 0,
      routeKey: getRouteKey(),
      scanTimer: null,
    },
    navigation: {
      inProgress: false,
      currentContext: null,
      pendingContext: null,
      lastKnownIndex: -1,
      switchTimer: null,
    },
    download: {
      inProgress: false,
      objectUrlBlobs: new Map(),
      audioBlobs: new WeakMap(),
      mediaSourceSessions: new WeakMap(),
      objectUrlMediaSessions: new Map(),
      sourceBufferSessions: new WeakMap(),
      audioMediaSessions: new WeakMap(),
    },
    overlay: { openSelect: null, nextSelectId: 0 },
    timers: { status: null },
  };

  const ui = {
    player: null,
    playerBody: null,
    playPauseButton: null,
    backwardButton: null,
    forwardButton: null,
    seekRange: null,
    currentTimeLabel: null,
    durationLabel: null,
    seekStepSelect: null,
    speedSelect: null,
    minimizeButton: null,
    downloadButton: null,
    diagnosticLogButton: null,
    previousMessageButton: null,
    nextMessageButton: null,
    playerStatus: null,
  };

  const settings = {
    seekStep: readNumberSetting(STORAGE_SEEK_STEP, 3, SEEK_STEP_OPTIONS),
    playbackRate: readNumberSetting(STORAGE_PLAYBACK_RATE, 1, PLAYBACK_RATE_OPTIONS),
    playerCollapsed: localStorage.getItem(STORAGE_PLAYER_COLLAPSED) === 'true',
  };

  // ---------------------------------------------------------------------------
  // Shared utilities and persisted settings
  // ---------------------------------------------------------------------------

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function getRouteKey() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  function isElementVisible(element) {
    if (!(isElementNode(element)) || !element.isConnected) return false;
    if (element.getClientRects().length === 0) return false;
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getMessageContextFromGroup(group) {
    if (!(isElementNode(group))) return null;
    const turn = group.closest('article, [data-testid^="conversation-turn-"]') ||
      group.closest('[data-message-author-role="assistant"]') || group.parentElement;
    if (!(isElementNode(turn))) return null;

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
      if (!(isButtonElement(moreButton)) || !moreButton.isConnected) continue;

      const context = getMessageContextFromGroup(group);
      if (!context || seenTurns.has(context.turn)) continue;
      seenTurns.add(context.turn);
      contexts.push(context);
    }

    return contexts;
  }

  function findContextIndex(contexts, context = state.navigation.currentContext) {
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
    if (state.navigation.lastKnownIndex >= 0) {
      return Math.min(state.navigation.lastKnownIndex, contexts.length - 1);
    }
    return contexts.length - 1;
  }

  function setPlayerStatus(message, duration = STATUS_DISPLAY_MS) {
    if (!ui.playerStatus) return;
    window.clearTimeout(state.timers.status);
    ui.playerStatus.textContent = message || '';
    if (message && duration > 0) {
      state.timers.status = window.setTimeout(() => {
        if (ui.playerStatus) ui.playerStatus.textContent = '';
      }, duration);
    }
  }

  function readNumberSetting(key, fallback, allowedValues) {
    const value = Number(localStorage.getItem(key));
    return allowedValues.includes(value) ? value : fallback;
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

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
      #${PLAYER_ID} .cyan-player-select {
        display: inline-flex;
      }
      #${PLAYER_ID} .cyan-player-select-button {
        height: 26px;
        min-width: 0;
        padding: 1px 7px;
        color: #eaf1f4;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(178, 199, 209, 0.22);
        border-radius: 7px;
        outline: none;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      #${PLAYER_ID} .cyan-player-select-button:hover,
      #${PLAYER_ID} .cyan-player-select-button[aria-expanded="true"] {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(178, 199, 209, 0.34);
      }
      #${PLAYER_ID} .cyan-player-select-button:disabled {
        opacity: 0.48;
        cursor: default;
      }
      #${PLAYER_ID} .cyan-player-select--seek .cyan-player-select-button { width: 58px; }
      #${PLAYER_ID} .cyan-player-select--speed .cyan-player-select-button { width: 56px; }

      .cyan-player-floating-menu {
        position: fixed;
        z-index: 2147483001;
        min-width: 56px;
        max-height: min(240px, calc(100vh - 16px));
        overflow-y: auto;
        padding: 4px;
        color: #eaf1f4;
        background: rgb(42, 57, 67);
        border: 1px solid rgba(178, 199, 209, 0.24);
        border-radius: 8px;
        box-shadow: 0 8px 22px rgba(8, 15, 20, 0.34);
        font: 12px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .cyan-player-floating-menu[hidden] { display: none !important; }
      .cyan-player-floating-option {
        display: block;
        width: 100%;
        padding: 5px 7px;
        color: inherit;
        background: transparent;
        border: 0;
        border-radius: 5px;
        font: inherit;
        text-align: left;
        white-space: nowrap;
        cursor: pointer;
      }
      .cyan-player-floating-option:hover,
      .cyan-player-floating-option:focus-visible {
        background: rgba(188, 211, 221, 0.13);
        outline: none;
      }
      .cyan-player-floating-option[aria-selected="true"] {
        background: rgba(119, 157, 176, 0.24);
      }

      #${PLAYER_ID} .cyan-player-icon-button {
        position: relative;
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
      #${PLAYER_ID} .cyan-download-visual {
        display: none;
        align-items: center;
        justify-content: center;
        width: 23px;
        height: 23px;
        pointer-events: none;
      }
      #${PLAYER_ID} .cyan-player-download-button[data-cyan-download-state="idle"] .cyan-download-idle,
      #${PLAYER_ID} .cyan-player-download-button[data-cyan-download-state="working"] .cyan-download-working,
      #${PLAYER_ID} .cyan-player-download-button[data-cyan-download-state="success"] .cyan-download-success,
      #${PLAYER_ID} .cyan-player-download-button[data-cyan-download-state="error"] .cyan-download-error {
        display: inline-flex;
      }
      #${PLAYER_ID} .cyan-download-spinner {
        display: block;
        width: 16px;
        height: 16px;
        box-sizing: border-box;
        border: 2px solid rgba(220, 232, 237, 0.28);
        border-top-color: currentColor;
        border-radius: 50%;
        animation: cyan-player-download-spin 0.72s linear infinite;
        transform-origin: 50% 50%;
        will-change: transform;
      }
      #${PLAYER_ID} .cyan-player-download-button[data-cyan-download-state="success"] {
        color: #9fc6ad;
      }
      #${PLAYER_ID} .cyan-player-download-button[data-cyan-download-state="error"] {
        color: #d6a5a5;
      }
      @keyframes cyan-player-download-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

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

  // ---------------------------------------------------------------------------
  // Official read-aloud action enhancement
  // ---------------------------------------------------------------------------

  function isAssistantActionGroup(group) {
    if (!(isElementNode(group)) || !group.isConnected) return false;

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

    if (isElementNode(root)) {
      if (root.matches(ACTION_GROUP_SELECTOR)) groups.push(root);
      groups.push(...root.querySelectorAll(ACTION_GROUP_SELECTOR));
    } else if (root === document) {
      groups.push(...document.querySelectorAll(ACTION_GROUP_SELECTOR));
    }

    if (groups.length > 0) return groups;

    const fallbackGroups = [];
    if (isElementNode(root)) {
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
    state.enhancement.pendingScanRoots.add(isNodeValue(root) ? root : document);
    if (state.enhancement.scanFrame !== null) return;

    state.enhancement.scanFrame = window.requestAnimationFrame(() => {
      state.enhancement.scanFrame = null;
      const roots = Array.from(state.enhancement.pendingScanRoots);
      state.enhancement.pendingScanRoots.clear();
      for (const scanTarget of roots) {
        if (scanTarget === document || scanTarget.isConnected) scanRoot(scanTarget);
      }
    });
  }

  function isVisibleVoiceItem(item) {
    if (!(isElementNode(item)) || !item.isConnected) return false;
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
    if (!(isButtonElement(moreButton)) || !moreButton.isConnected) return;

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
    if (state.enhancement.activeOperation !== operation) return;

    state.enhancement.activeOperation = null;
    operation.observer?.disconnect();
    window.clearTimeout(operation.timeoutId);
    window.clearTimeout(operation.activationTimerId);
    operation.button.removeAttribute('aria-busy');
    operation.button.disabled = false;
    document.documentElement.removeAttribute(HIDE_MENU_ATTRIBUTE);
    clearMoreButtonVisualState(operation);

    if (error) {
      closeOperationMenu(operation);
      if (state.navigation.inProgress) {
        state.navigation.inProgress = false;
        state.navigation.pendingContext = null;
        window.clearTimeout(state.navigation.switchTimer);
        if (state.playback.sessionState === 'opening') state.playback.sessionState = 'idle';
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
    if (state.enhancement.activeOperation !== operation) return;

    operation.activationTimerId = window.setTimeout(() => {
      operation.activationTimerId = null;
      if (operation.completed || state.enhancement.activeOperation !== operation) return;
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
    if (operation.completed || state.enhancement.activeOperation !== operation) return false;

    const candidates = getCandidateVoiceItems();
    if (candidates.length === 0) return false;

    const newCandidate = candidates.find((item) => !operation.initialItems.has(item));
    const item = newCandidate || candidates[candidates.length - 1];
    activateOfficialVoiceItem(operation, item);
    return true;
  }

  function startOfficialVoiceAction(button, moreButton) {
    if (state.enhancement.activeOperation) {
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

    state.enhancement.activeOperation = operation;
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
    if (!(isButtonElement(button))) return;

    const group = button.closest('[role="group"]');
    const moreButton = group ? findMoreButton(group) : null;

    if (!(isButtonElement(moreButton)) || !moreButton.isConnected) {
      console.warn(`${SCRIPT_PREFIX} 未找到当前回答对应的“更多操作”按钮。`);
      return;
    }

    const messageContext = getMessageContextFromGroup(group);
    state.navigation.pendingContext = messageContext;
    state.navigation.currentContext = messageContext || state.navigation.currentContext;
    const contexts = collectPlayableMessageContexts();
    const contextIndex = findContextIndex(contexts, messageContext);
    if (contextIndex >= 0) state.navigation.lastKnownIndex = contextIndex;
    state.playback.sessionState = 'opening';
    state.playback.openingRequestUntil = Date.now() + 10000;
    state.playback.dismissedAudio = null;
    state.navigation.inProgress = false;
    window.clearTimeout(state.navigation.switchTimer);

    if (state.enhancement.activeOperation) {
      finishOperation(state.enhancement.activeOperation);
    }

    startOfficialVoiceAction(button, moreButton);
  }

  // ---------------------------------------------------------------------------
  // Player controls and floating select overlays
  // ---------------------------------------------------------------------------

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

  function closeFloatingSelect(control = state.overlay.openSelect) {
    if (!control) return;
    control.menu.hidden = true;
    control.button.setAttribute('aria-expanded', 'false');
    if (state.overlay.openSelect === control) state.overlay.openSelect = null;
  }

  function positionFloatingSelect(control) {
    if (!control || control.menu.hidden || !control.button.isConnected) return;
    const rect = control.button.getBoundingClientRect();
    const menu = control.menu;
    const gap = 5;
    menu.style.minWidth = `${Math.max(56, Math.ceil(rect.width))}px`;
    menu.style.left = '0px';
    menu.style.top = '0px';

    const menuRect = menu.getBoundingClientRect();
    const viewportPadding = 8;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = menuRect.height > spaceBelow && spaceAbove > spaceBelow;
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - menuRect.height - gap)
      : Math.min(window.innerHeight - menuRect.height - viewportPadding, rect.bottom + gap);
    const left = Math.min(
      window.innerWidth - menuRect.width - viewportPadding,
      Math.max(viewportPadding, rect.left)
    );
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function createFloatingSelect(options, initialValue, ariaLabel, className, onChange) {
    const root = document.createElement('div');
    root.className = `cyan-player-select ${className}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cyan-player-select-button';
    button.setAttribute('aria-label', ariaLabel);
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.id = `cyan-player-floating-menu-${++state.overlay.nextSelectId}`;
    menu.className = 'cyan-player-floating-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    button.setAttribute('aria-controls', menu.id);

    let selectedValue = String(initialValue);
    const optionButtons = new Map();
    const control = { root, button, menu };

    function renderValue() {
      const selected = options.find((item) => String(item.value) === selectedValue) || options[0];
      button.textContent = selected.label;
      button.title = `${ariaLabel}：${selected.label}`;
      for (const [value, optionButton] of optionButtons) {
        optionButton.setAttribute('aria-selected', String(value === selectedValue));
      }
    }

    for (const option of options) {
      const optionButton = document.createElement('button');
      optionButton.type = 'button';
      optionButton.className = 'cyan-player-floating-option';
      optionButton.setAttribute('role', 'option');
      optionButton.textContent = option.label;
      const value = String(option.value);
      optionButtons.set(value, optionButton);
      optionButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectedValue = value;
        renderValue();
        closeFloatingSelect(control);
        onChange?.();
        button.focus({ preventScroll: true });
      });
      menu.appendChild(optionButton);
    }

    Object.defineProperty(button, 'value', {
      get: () => selectedValue,
      set: (value) => {
        const normalized = String(value);
        if (optionButtons.has(normalized)) {
          selectedValue = normalized;
          renderValue();
        }
      },
      configurable: true,
    });

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      const shouldOpen = menu.hidden;
      if (state.overlay.openSelect && state.overlay.openSelect !== control) {
        closeFloatingSelect(state.overlay.openSelect);
      }
      if (!shouldOpen) {
        closeFloatingSelect(control);
        return;
      }
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      state.overlay.openSelect = control;
      positionFloatingSelect(control);
      optionButtons.get(selectedValue)?.focus({ preventScroll: true });
    });

    root.appendChild(button);
    document.body.appendChild(menu);
    renderValue();
    return button;
  }

  function createSeekControl(direction) {
    const isBackward = direction < 0;
    const button = createPlayerIconButton(
      `${isBackward ? '后退' : '前进'} ${settings.seekStep} 秒`,
      isBackward
        ? 'M11 7 6 12l5 5M18 7l-5 5 5 5'
        : 'M6 7l5 5-5 5M13 7l5 5-5 5',
      'cyan-player-control-button'
    );
    button.addEventListener('click', () => seekBy(direction * settings.seekStep));
    return button;
  }

  function updateSeekControlLabels() {
    for (const [button, prefix] of [
      [ui.backwardButton, '后退'],
      [ui.forwardButton, '前进'],
    ]) {
      if (!button) continue;
      button.setAttribute('aria-label', `${prefix} ${settings.seekStep} 秒`);
      button.title = `${prefix} ${settings.seekStep} 秒`;
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

  // ---------------------------------------------------------------------------
  // MP3 download and diagnostics
  // ---------------------------------------------------------------------------

  function getCurrentAudioSource() {
    if (!state.playback.audio) return '';
    return `${state.playback.audio.currentSrc || state.playback.audio.src || ''}`.trim();
  }

  function getCurrentCapturedBlob() {
    if (!state.playback.audio) return null;
    const directBlob = state.download.audioBlobs.get(state.playback.audio);
    if (directBlob instanceof Blob) return directBlob;

    const source = getCurrentAudioSource();
    const capturedBlob = state.download.objectUrlBlobs.get(source);
    return capturedBlob instanceof Blob ? capturedBlob : null;
  }

  function getOrCreateMediaSourceSession(mediaSource) {
    if (!mediaSource) return null;
    let session = state.download.mediaSourceSessions.get(mediaSource);
    if (session) return session;

    session = {
      mediaSource,
      objectUrl: '',
      mimeType: '',
      segments: [],
      totalBytes: 0,
      sourceBuffers: new Set(),
    };
    state.download.mediaSourceSessions.set(mediaSource, session);
    return session;
  }

  function rememberMediaSourceObjectUrl(objectUrl, mediaSource) {
    const session = getOrCreateMediaSourceSession(mediaSource);
    if (!session || typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) return;
    session.objectUrl = objectUrl;
    state.download.objectUrlMediaSessions.set(objectUrl, session);
    while (state.download.objectUrlMediaSessions.size > CAPTURED_MEDIA_SOURCE_URL_LIMIT) {
      const oldestUrl = state.download.objectUrlMediaSessions.keys().next().value;
      state.download.objectUrlMediaSessions.delete(oldestUrl);
    }
  }

  function getCurrentCapturedMediaSourceSession() {
    if (!state.playback.audio) return null;
    const directSession = state.download.audioMediaSessions.get(state.playback.audio);
    if (directSession) return directSession;
    return state.download.objectUrlMediaSessions.get(getCurrentAudioSource()) || null;
  }

  function scheduleCapturedObjectUrlCleanup(objectUrl) {
    if (typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) return;
    window.setTimeout(() => {
      if (getCurrentAudioSource() === objectUrl) return;
      state.download.objectUrlBlobs.delete(objectUrl);
      state.download.objectUrlMediaSessions.delete(objectUrl);
    }, REVOKED_OBJECT_URL_CLEANUP_DELAY_MS);
  }

  function clearCapturedAudioSourceCaches() {
    for (const session of new Set(state.download.objectUrlMediaSessions.values())) {
      for (const sourceBuffer of session.sourceBuffers) {
        state.download.sourceBufferSessions.delete(sourceBuffer);
      }
      session.segments.length = 0;
      session.totalBytes = 0;
      session.sourceBuffers.clear();
    }

    state.download.objectUrlBlobs.clear();
    state.download.objectUrlMediaSessions.clear();
    state.download.audioBlobs = new WeakMap();
    state.download.mediaSourceSessions = new WeakMap();
    state.download.sourceBufferSessions = new WeakMap();
    state.download.audioMediaSessions = new WeakMap();
  }

  function copyBufferSourceBytes(buffer) {
    if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice();
    }
    if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer).slice();
    return null;
  }

  function getMediaSourceBufferedEnd(session) {
    let bufferedEnd = 0;
    for (const sourceBuffer of session?.sourceBuffers || []) {
      try {
        const ranges = sourceBuffer.buffered;
        if (ranges.length > 0) bufferedEnd = Math.max(bufferedEnd, ranges.end(ranges.length - 1));
      } catch (_) {
        // SourceBuffer 状态切换时读取 buffered 可能失败，稍后重试即可。
      }
    }
    return bufferedEnd;
  }

  async function buildCapturedMediaSourceBlob(session, log) {
    if (!session) throw new Error('MediaSource audio session was not captured');

    const targetDuration = hasUsableDuration() ? state.playback.audio.duration : 0;
    const waitDeadline = Date.now() + 5000;
    while (Date.now() < waitDeadline) {
      const isUpdating = Array.from(session.sourceBuffers).some((buffer) => buffer.updating);
      const bufferedEnd = getMediaSourceBufferedEnd(session);
      const bufferedComplete = targetDuration > 0 && bufferedEnd >= targetDuration - 0.1;
      const streamEnded = session.mediaSource?.readyState === 'ended';
      if (!isUpdating && (bufferedComplete || streamEnded)) break;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    if (!session.segments.length || session.totalBytes <= 0) {
      throw new Error('MediaSource audio contained no captured segments');
    }

    const mimeType = session.mimeType || 'audio/aac';
    const sourceBlob = new Blob(session.segments, { type: mimeType });
    addDiagnosticStage(log, 'mse-source-captured', {
      bytes: sourceBlob.size,
      type: sourceBlob.type,
      segments: session.segments.length,
      bufferedEnd: getMediaSourceBufferedEnd(session),
      targetDuration,
      mediaSourceState: session.mediaSource?.readyState || 'unknown',
    });
    return sourceBlob;
  }

  const MP3_BITRATE_KBPS = 96;
  const MP3_SAMPLE_BLOCK_SIZE = 1152;
  const MP3_LOG_STORAGE_KEY = 'cyanChatgptMp3LastErrorLog';
  const MP3_ENCODER_BUILD = 'lamejs-fixed@1.2.2';
  let mp3EncoderSelfTestPassed = false;
  const DOWNLOAD_ICON_PATH = 'M12 3v12M8 11l4 4 4-4M5 20h14';
  const DOWNLOAD_SUCCESS_ICON_PATH = 'M5 12l4 4L19 6';
  const DOWNLOAD_ERROR_ICON_PATH = 'M12 7v6M12 17h.01';
  const DIAGNOSTIC_LOG_ICON_PATH = 'M7 3h7l4 4v14H7V3Zm7 0v5h5M10 12h5M10 16h5';

  function getLameJs() {
    let library = null;

    // Tampermonkey 的 @require 与主脚本共享词法作用域，但其顶层变量
    // 不一定会成为 globalThis/window 的属性，因此必须优先直接读取 lamejs。
    try {
      if (typeof lamejs !== 'undefined') library = lamejs;
    } catch (_) {
      library = null;
    }

    library ||= globalThis.lamejs || window.lamejs || null;
    if (!library?.Mp3Encoder && typeof library === 'function') {
      try {
        const exports = {};
        library.call(exports);
        if (exports.Mp3Encoder) library = exports;
      } catch (_) {
        // 保留原对象，交由下面的统一错误处理。
      }
    }

    if (!library?.Mp3Encoder) {
      throw new Error('MP3 encoder is unavailable: @require did not expose Mp3Encoder');
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

  function createDownloadButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cyan-player-icon-button cyan-player-download-button';
    button.dataset.cyanDownloadState = 'idle';

    const createVisual = (className, pathData = null) => {
      const visual = document.createElement('span');
      visual.className = `cyan-download-visual ${className}`;
      visual.setAttribute('aria-hidden', 'true');
      if (pathData) visual.appendChild(createSvgIcon(pathData));
      return visual;
    };

    const idleVisual = createVisual('cyan-download-idle', DOWNLOAD_ICON_PATH);
    const workingVisual = createVisual('cyan-download-working');
    const spinner = document.createElement('span');
    spinner.className = 'cyan-download-spinner';
    workingVisual.appendChild(spinner);
    const successVisual = createVisual('cyan-download-success', DOWNLOAD_SUCCESS_ICON_PATH);
    const errorVisual = createVisual('cyan-download-error', DOWNLOAD_ERROR_ICON_PATH);

    button.append(idleVisual, workingVisual, successVisual, errorVisual);
    button.addEventListener('click', downloadCurrentAudio);
    return button;
  }

  function setDownloadButtonState(state, detail = '') {
    if (!ui.downloadButton) return;
    const label = {
      idle: '下载当前音频为 MP3',
      working: detail || '正在生成 MP3',
      success: 'MP3 下载已开始',
      error: detail || 'MP3 下载失败',
    }[state] || '下载当前音频为 MP3';

    ui.downloadButton.dataset.cyanDownloadState = state;
    ui.downloadButton.setAttribute('aria-label', label);
    ui.downloadButton.title = label;
  }

  function sanitizeAudioSource(source) {
    try {
      const url = new URL(source, location.href);
      return { protocol: url.protocol, host: url.host || '', pathname: url.pathname.slice(-120) };
    } catch {
      return { protocol: String(source || '').split(':')[0] || 'unknown' };
    }
  }

  function createDiagnosticLog(source) {
    return {
      timestamp: new Date().toISOString(),
      scriptVersion: SCRIPT_VERSION,
      encoderBuild: MP3_ENCODER_BUILD,
      browser: navigator.userAgent,
      source: sanitizeAudioSource(source),
      stages: [],
    };
  }

  function addDiagnosticStage(log, stage, detail = {}) {
    log.stages.push({ at: new Date().toISOString(), stage, ...detail });
  }

  function serializeError(error) {
    return {
      name: error?.name || 'Error',
      message: String(error?.message || error || 'Unknown error'),
      stack: String(error?.stack || '').slice(0, 6000),
    };
  }

  function saveDiagnosticLog(log, error) {
    const payload = { ...log, error: serializeError(error) };
    try {
      localStorage.setItem(MP3_LOG_STORAGE_KEY, JSON.stringify(payload));
    } catch (storageError) {
      console.warn(`${SCRIPT_PREFIX} 无法保存 MP3 诊断日志。`, storageError);
    }
    console.groupCollapsed(`${SCRIPT_PREFIX} MP3 下载失败诊断`);
    console.error(payload);
    console.groupEnd();
  }

  function updateDiagnosticLogButtonVisibility() {
    if (!ui.diagnosticLogButton) return;
    ui.diagnosticLogButton.hidden = !localStorage.getItem(MP3_LOG_STORAGE_KEY);
  }

  function clearDiagnosticLog() {
    try {
      localStorage.removeItem(MP3_LOG_STORAGE_KEY);
    } catch (_) {
      // localStorage 不可用时忽略，不影响下载和播放。
    }
    updateDiagnosticLogButtonVisibility();
  }

  function triggerBrowserDownload(blob, filename) {
    if (!blob || typeof blob.size !== 'number' || blob.size <= 0) {
      throw new Error('empty download blob');
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);

    try {
      link.click();
    } finally {
      window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(objectUrl);
      }, 60000);
    }

    return Promise.resolve();
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
      for (const channel of channels) mixedSample += channel[sampleIndex] || 0;
      mono[sampleIndex] = floatToInt16(mixedSample / channelCount);
    }
    return mono;
  }

  function yieldToBrowser() {
    if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  function runMp3EncoderSelfTest() {
    if (mp3EncoderSelfTestPassed) return;
    const { Mp3Encoder } = getLameJs();
    const encoder = new Mp3Encoder(1, 44100, MP3_BITRATE_KBPS);
    const testPcm = new Int16Array(MP3_SAMPLE_BLOCK_SIZE);
    for (let i = 0; i < testPcm.length; i += 1) {
      testPcm[i] = Math.round(Math.sin((i / 44100) * Math.PI * 2 * 440) * 4000);
    }
    const first = encoder.encodeBuffer(testPcm);
    const last = encoder.flush();
    if ((first?.length || 0) + (last?.length || 0) <= 0) {
      throw new Error('MP3 encoder self-test produced no output');
    }
    mp3EncoderSelfTestPassed = true;
  }

  function createMp3Worker() {
    const workerSource = `
      self.onmessage = async (event) => {
        const { channels, sampleRate, bitrate, blockSize, encoderUrl } = event.data;
        try {
          importScripts(encoderUrl);
          let library = self.lamejs || null;
          if (!library?.Mp3Encoder && typeof library === 'function') {
            const exports = {};
            library.call(exports);
            library = exports;
          }
          if (!library?.Mp3Encoder) throw new Error('MP3 encoder is unavailable in worker');

          const channelViews = channels.map((buffer) => new Float32Array(buffer));
          const sampleCount = channelViews[0]?.length || 0;
          const mono = new Int16Array(sampleCount);
          for (let i = 0; i < sampleCount; i += 1) {
            let mixed = 0;
            for (const channel of channelViews) mixed += channel[i] || 0;
            const sample = Math.max(-1, Math.min(1, mixed / channelViews.length));
            mono[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
          }

          const encoder = new library.Mp3Encoder(1, sampleRate, bitrate);
          const chunks = [];
          for (let offset = 0, index = 0; offset < mono.length; offset += blockSize, index += 1) {
            const encoded = encoder.encodeBuffer(mono.subarray(offset, offset + blockSize));
            if (encoded?.length) chunks.push(new Uint8Array(encoded));
          }
          const finalChunk = encoder.flush();
          if (finalChunk?.length) chunks.push(new Uint8Array(finalChunk));
          const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
          if (totalBytes < 128) throw new Error('invalid MP3 output');
          const output = new Uint8Array(totalBytes);
          let cursor = 0;
          for (const chunk of chunks) {
            output.set(chunk, cursor);
            cursor += chunk.byteLength;
          }
          self.postMessage({ type: 'done', buffer: output.buffer, chunks: chunks.length }, [output.buffer]);
        } catch (error) {
          self.postMessage({ type: 'error', name: error?.name || 'Error', message: String(error?.message || error), stack: String(error?.stack || '') });
        }
      };
    `;
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  }

  function encodeAudioBufferToMp3InWorker(audioBuffer, log) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = createMp3Worker();
      } catch (error) {
        reject(error);
        return;
      }

      const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => {
        const copy = new Float32Array(audioBuffer.getChannelData(index));
        return copy.buffer;
      });
      const cleanup = () => worker.terminate();

      worker.onmessage = (event) => {
        const data = event.data || {};
        cleanup();
        if (data.type === 'done') {
          const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
          addDiagnosticStage(log, 'mp3-ready', { bytes: blob.size, chunks: data.chunks, worker: true });
          resolve(blob);
        } else {
          const error = new Error(data.message || 'MP3 worker failed');
          error.name = data.name || 'Error';
          error.stack = data.stack || error.stack;
          reject(error);
        }
      };
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || 'MP3 worker crashed'));
      };

      worker.postMessage({
        channels,
        sampleRate: audioBuffer.sampleRate,
        bitrate: MP3_BITRATE_KBPS,
        blockSize: MP3_SAMPLE_BLOCK_SIZE,
        encoderUrl: 'https://cdn.jsdelivr.net/npm/lamejs-fixed@1.2.2/lame.min.js',
      }, channels);
    });
  }

  async function encodeAudioBufferToMp3OnMainThread(audioBuffer, log) {
    const { Mp3Encoder } = getLameJs();
    const monoSamples = downmixAudioBufferToMono(audioBuffer);
    const encoder = new Mp3Encoder(1, audioBuffer.sampleRate, MP3_BITRATE_KBPS);
    const chunks = [];
    for (let offset = 0, blockIndex = 0;
      offset < monoSamples.length;
      offset += MP3_SAMPLE_BLOCK_SIZE, blockIndex += 1) {
      const encoded = encoder.encodeBuffer(
        monoSamples.subarray(offset, offset + MP3_SAMPLE_BLOCK_SIZE)
      );
      if (encoded?.length) chunks.push(new Uint8Array(encoded));
      if (blockIndex % 512 === 0) {
        await yieldToBrowser();
      }
    }
    const finalChunk = encoder.flush();
    if (finalChunk?.length) chunks.push(new Uint8Array(finalChunk));
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    if (blob.size < 128) throw new Error(`invalid MP3 output size: ${blob.size}`);
    addDiagnosticStage(log, 'mp3-ready', { bytes: blob.size, chunks: chunks.length, worker: false });
    return blob;
  }

  async function encodeAudioBufferToMp3(audioBuffer, log) {
    runMp3EncoderSelfTest();
    addDiagnosticStage(log, 'encoder-self-test-ok');
    addDiagnosticStage(log, 'pcm-ready', {
      samples: audioBuffer.length,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      duration: audioBuffer.duration,
    });
    try {
      return await encodeAudioBufferToMp3InWorker(audioBuffer, log);
    } catch (workerError) {
      addDiagnosticStage(log, 'worker-fallback', {
        message: String(workerError?.message || workerError),
      });
      return encodeAudioBufferToMp3OnMainThread(audioBuffer, log);
    }
  }

  async function decodeAudioBlob(blob, log) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API is unavailable');
    const context = new AudioContextClass();
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      addDiagnosticStage(log, 'decoded', {
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        frames: buffer.length,
      });
      return buffer;
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function downloadCurrentAudio() {
    if (state.download.inProgress || !state.playback.audio) return;
    const source = getCurrentAudioSource();
    if (!source || state.playback.audio.srcObject) {
      setPlayerStatus('当前音频不可下载');
      return;
    }

    const log = createDiagnosticLog(source);
    state.download.inProgress = true;
    setDownloadButtonState('working', '正在读取音频');
    setPlayerStatus('');
    updatePlayerState();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    try {
      addDiagnosticStage(log, 'start');
      let sourceBlob;
      if (source.startsWith('blob:')) {
        sourceBlob = getCurrentCapturedBlob();
        if (sourceBlob) {
          addDiagnosticStage(log, 'source-kind', { kind: 'blob' });
          addDiagnosticStage(log, 'source-blob-captured', {
            bytes: sourceBlob.size,
            type: sourceBlob.type,
          });
        } else {
          const mediaSession = getCurrentCapturedMediaSourceSession();
          addDiagnosticStage(log, 'source-kind', {
            kind: 'mse',
            type: mediaSession?.mimeType || 'audio/aac',
          });
          sourceBlob = await buildCapturedMediaSourceBlob(mediaSession, log);
        }
      } else {
        addDiagnosticStage(log, 'source-kind', { kind: 'http' });
        const response = await fetch(source, { credentials: 'include' });
        addDiagnosticStage(log, 'fetched', { status: response.status, ok: response.ok });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        sourceBlob = await response.blob();
        addDiagnosticStage(log, 'source-blob', { bytes: sourceBlob.size, type: sourceBlob.type });
      }
      if (!sourceBlob.size) throw new Error('empty audio blob');

      const audioBuffer = await decodeAudioBlob(sourceBlob, log);
      const mp3Blob = await encodeAudioBufferToMp3(audioBuffer, log);

      const filename = buildDownloadFilename('mp3');
      addDiagnosticStage(log, 'download-requested', { filename, bytes: mp3Blob.size });
      await triggerBrowserDownload(mp3Blob, filename);
      addDiagnosticStage(log, 'download-complete');
      setDownloadButtonState('success');
      clearDiagnosticLog();
    } catch (error) {
      saveDiagnosticLog(log, error);
      setDownloadButtonState('error', 'MP3 下载失败');
      setPlayerStatus('MP3 下载失败');
      updateDiagnosticLogButtonVisibility();
    } finally {
      state.download.inProgress = false;
      updatePlayerState();
      window.setTimeout(() => {
        if (!state.download.inProgress) setDownloadButtonState('idle');
      }, 1800);
    }
  }

  function exportLatestMp3DiagnosticLog() {
    const raw = localStorage.getItem(MP3_LOG_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
    const filename = `chatgpt-mp3-diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    triggerBrowserDownload(blob, filename).catch((error) => {
      console.error(`${SCRIPT_PREFIX} 导出诊断日志失败。`, error);
      window.alert('诊断日志导出失败，请查看浏览器控制台。');
    });
  }

  // ---------------------------------------------------------------------------
  // Player UI construction
  // ---------------------------------------------------------------------------

  function createPlayer() {
    if (ui.player?.isConnected) return ui.player;

    ui.player = document.createElement('section');
    ui.player.id = PLAYER_ID;
    ui.player.hidden = true;
    ui.player.setAttribute('role', 'region');
    ui.player.setAttribute('aria-label', 'ChatGPT 朗读播放器');
    ui.player.setAttribute(PLAYER_COLLAPSED_ATTRIBUTE, String(settings.playerCollapsed));

    const header = document.createElement('div');
    header.className = 'cyan-player-header';

    const headerSettings = document.createElement('div');
    headerSettings.className = 'cyan-player-header-settings';

    const seekSetting = document.createElement('label');
    seekSetting.className = 'cyan-player-setting';
    seekSetting.append(document.createTextNode('跳转'));
    ui.seekStepSelect = createFloatingSelect(
      SEEK_STEP_OPTIONS.map((seconds) => ({ value: seconds, label: `${seconds} 秒` })),
      settings.seekStep,
      '快进后退秒数',
      'cyan-player-select--seek',
      handleSeekStepChange
    );
    seekSetting.appendChild(ui.seekStepSelect.parentElement);

    const speedSetting = document.createElement('label');
    speedSetting.className = 'cyan-player-setting';
    speedSetting.append(document.createTextNode('速度'));
    ui.speedSelect = createFloatingSelect(
      PLAYBACK_RATE_OPTIONS.map((rate) => ({ value: rate, label: `${rate}×` })),
      settings.playbackRate,
      '播放速度',
      'cyan-player-select--speed',
      handlePlaybackRateChange
    );
    speedSetting.appendChild(ui.speedSelect.parentElement);

    ui.downloadButton = createDownloadButton();
    setDownloadButtonState('idle');

    ui.diagnosticLogButton = createPlayerIconButton(
      '导出 MP3 诊断日志',
      DIAGNOSTIC_LOG_ICON_PATH,
      'cyan-player-diagnostic-button'
    );
    ui.diagnosticLogButton.addEventListener('click', exportLatestMp3DiagnosticLog);
    ui.diagnosticLogButton.hidden = !localStorage.getItem(MP3_LOG_STORAGE_KEY);

    headerSettings.append(
      seekSetting,
      speedSetting,
      ui.downloadButton,
      ui.diagnosticLogButton
    );

    ui.playerStatus = document.createElement('span');
    ui.playerStatus.className = 'cyan-player-status';
    ui.playerStatus.setAttribute('role', 'status');
    ui.playerStatus.setAttribute('aria-live', 'polite');

    const windowActions = document.createElement('div');
    windowActions.className = 'cyan-player-window-actions';

    ui.minimizeButton = createPlayerIconButton(
      settings.playerCollapsed ? '展开播放器' : '最小化播放器',
      settings.playerCollapsed ? 'M7 12h10M12 7v10' : 'M7 12h10'
    );
    ui.minimizeButton.addEventListener('click', togglePlayerCollapsed);

    const closeButton = createPlayerIconButton('关闭播放器', 'M6 6l12 12M18 6 6 18');
    closeButton.addEventListener('click', closePlayer);
    windowActions.append(ui.minimizeButton, closeButton);
    header.append(headerSettings, ui.playerStatus, windowActions);

    ui.playerBody = document.createElement('div');
    ui.playerBody.className = 'cyan-player-body';

    const controls = document.createElement('div');
    controls.className = 'cyan-player-controls';

    ui.previousMessageButton = createMessageNavigationButton(-1);
    ui.backwardButton = createSeekControl(-1);
    ui.playPauseButton = createPlayerIconButton(
      '播放',
      'M9 7.5v9l7-4.5-7-4.5Z',
      'cyan-player-control-button cyan-player-main-button'
    );
    ui.playPauseButton.addEventListener('click', togglePlayback);
    ui.forwardButton = createSeekControl(1);
    ui.nextMessageButton = createMessageNavigationButton(1);
    controls.append(
      ui.previousMessageButton,
      ui.backwardButton,
      ui.playPauseButton,
      ui.forwardButton,
      ui.nextMessageButton
    );

    const seekRow = document.createElement('div');
    seekRow.className = 'cyan-player-seek-row';
    ui.currentTimeLabel = document.createElement('span');
    ui.currentTimeLabel.className = 'cyan-player-time';
    ui.currentTimeLabel.textContent = '0:00';
    ui.seekRange = document.createElement('input');
    ui.seekRange.type = 'range';
    ui.seekRange.min = '0';
    ui.seekRange.max = '1000';
    ui.seekRange.step = '1';
    ui.seekRange.value = '0';
    ui.seekRange.setAttribute('aria-label', '播放进度');
    ui.seekRange.addEventListener('input', handleSeekInput);
    ui.durationLabel = document.createElement('span');
    ui.durationLabel.className = 'cyan-player-time';
    ui.durationLabel.textContent = '--:--';
    seekRow.append(ui.currentTimeLabel, ui.seekRange, ui.durationLabel);

    ui.playerBody.append(controls, seekRow);
    ui.player.append(header, ui.playerBody);
    document.body.appendChild(ui.player);
    updatePlayerState();
    return ui.player;
  }

  // ---------------------------------------------------------------------------
  // Audio session, navigation, and player state
  // ---------------------------------------------------------------------------

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
  }

  function hasUsableDuration(audio = state.playback.audio) {
    return !!audio && Number.isFinite(audio.duration) && audio.duration > 0;
  }

  function isUsableAudio(audio) {
    return isAudioElement(audio) && audio.isConnected !== false;
  }

  function scoreAudio(audio, index) {
    if (!(isAudioElement(audio))) return -Infinity;
    let score = index;
    const source = `${audio.currentSrc || audio.src || ''}`;
    if (source) score += 100;
    if (/synthesi[sz]e|speech|audio/i.test(source)) score += 180;
    if (!audio.paused && !audio.ended) score += 1000;
    if (audio.currentTime > 0) score += 80;
    if (audio.readyState > 0) score += 20;
    if (audio === state.playback.audio) score += 40;
    if (audio.ended) score -= 120;
    return score;
  }

  function findBestAudio() {
    const audios = Array.from(document.querySelectorAll('audio'));
    if (state.playback.audio && !audios.includes(state.playback.audio)) audios.push(state.playback.audio);
    if (audios.length === 0) return null;

    return audios
      .map((audio, index) => ({ audio, score: scoreAudio(audio, index) }))
      .sort((a, b) => b.score - a.score)[0].audio;
  }

  function bindAudio(audio, shouldShow = false) {
    if (!(isAudioElement(audio))) return;

    if (state.playback.audio === audio) {
      if (shouldShow && state.playback.dismissedAudio !== audio) showPlayer();
      updatePlayerState();
      return;
    }

    unbindCurrentAudio();
    state.playback.audio = audio;
    state.playback.audio.playbackRate = settings.playbackRate;

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
      state.playback.audio.addEventListener(eventName, handleAudioStateEvent);
    }

    if (shouldShow && state.playback.dismissedAudio !== audio) showPlayer();
    updatePlayerState();
  }

  function unbindCurrentAudio() {
    if (!state.playback.audio) return;
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
      state.playback.audio.removeEventListener(eventName, handleAudioStateEvent);
    }
    state.playback.audio = null;
  }

  function canShowAudio(audio) {
    if (!(isAudioElement(audio))) return false;

    if (state.playback.sessionState === 'dismissed') {
      return audio !== state.playback.dismissedAudio;
    }

    return true;
  }

  function isExpectedPlaybackAudio(audio) {
    if (!(isAudioElement(audio))) return false;

    if (state.playback.sessionState === 'opening') {
      if (Date.now() > state.playback.openingRequestUntil) {
        state.playback.sessionState = 'idle';
        state.playback.openingRequestUntil = 0;
        return false;
      }
      return true;
    }

    if (audio !== state.playback.audio) return false;
    return state.playback.sessionState === 'active' ||
      state.playback.sessionState === 'idle';
  }

  function activatePlaybackSession(audio) {
    if (!isExpectedPlaybackAudio(audio)) return false;

    state.playback.sessionState = 'active';
    state.playback.openingRequestUntil = 0;
    state.playback.dismissedAudio = null;
    if (state.navigation.pendingContext) {
      state.navigation.currentContext = state.navigation.pendingContext;
      state.navigation.pendingContext = null;
    }
    state.navigation.inProgress = false;
    window.clearTimeout(state.navigation.switchTimer);
    setPlayerStatus('');
    return true;
  }

  function handleAudioStateEvent(event) {
    if (event.currentTarget !== state.playback.audio) return;

    if (event.type === 'play' && activatePlaybackSession(state.playback.audio)) {
      showPlayer();
    }

    if (event.type === 'ended' && state.playback.sessionState === 'active') {
      state.playback.sessionState = 'idle';
    }

    updatePlayerState();
  }

  function showPlayer() {
    if (!canShowAudio(state.playback.audio)) return;
    createPlayer();
    ui.player.hidden = false;
  }

  function closePlayer() {
    state.playback.sessionState = 'dismissed';
    state.playback.openingRequestUntil = 0;
    state.navigation.inProgress = false;
    state.navigation.pendingContext = null;
    window.clearTimeout(state.navigation.switchTimer);

    if (state.enhancement.activeOperation) {
      finishOperation(state.enhancement.activeOperation);
    }

    if (state.playback.audio) {
      state.playback.dismissedAudio = state.playback.audio;
      if (!state.playback.audio.paused) state.playback.audio.pause();
    }

    closeFloatingSelect();
    if (ui.player) ui.player.hidden = true;
  }

  function switchMessage(direction) {
    if (direction !== -1 && direction !== 1) return;
    if (state.navigation.inProgress || state.enhancement.activeOperation) {
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
    if (!(isButtonElement(customButton)) ||
        !(isButtonElement(moreButton))) {
      setPlayerStatus('目标消息尚未就绪');
      scheduleScan(target.group);
      return;
    }

    state.navigation.inProgress = true;
    state.navigation.pendingContext = target;
    state.navigation.lastKnownIndex = targetIndex;
    state.playback.sessionState = 'opening';
    state.playback.openingRequestUntil = Date.now() + MESSAGE_SWITCH_TIMEOUT_MS;
    state.playback.dismissedAudio = null;
    setPlayerStatus('正在切换…', 0);
    updatePlayerState();

    if (state.playback.audio && !state.playback.audio.paused) state.playback.audio.pause();
    target.turn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    startOfficialVoiceAction(customButton, moreButton);

    window.clearTimeout(state.navigation.switchTimer);
    state.navigation.switchTimer = window.setTimeout(() => {
      if (!state.navigation.inProgress) return;
      state.navigation.inProgress = false;
      state.navigation.pendingContext = null;
      if (state.playback.sessionState === 'opening') state.playback.sessionState = 'idle';
      setPlayerStatus('切换超时');
      updatePlayerState();
    }, MESSAGE_SWITCH_TIMEOUT_MS);
  }

  function updateMessageNavigationState(contexts = null, currentIndex = null) {
    if (!ui.previousMessageButton || !ui.nextMessageButton) return;
    const list = contexts || collectPlayableMessageContexts();
    const index = currentIndex ?? findContextIndex(list);
    const disabled = state.navigation.inProgress || !list.length || index < 0;
    ui.previousMessageButton.disabled = disabled || index <= 0;
    ui.nextMessageButton.disabled = disabled || index >= list.length - 1;
  }

  function resetPlaybackForRouteChange() {
    state.playback.routeKey = getRouteKey();
    state.playback.sessionState = 'idle';
    state.playback.openingRequestUntil = 0;
    state.navigation.inProgress = false;
    state.navigation.currentContext = null;
    state.navigation.pendingContext = null;
    state.navigation.lastKnownIndex = -1;
    state.playback.dismissedAudio = null;
    window.clearTimeout(state.navigation.switchTimer);
    window.clearTimeout(state.timers.status);
    if (state.enhancement.activeOperation) finishOperation(state.enhancement.activeOperation);
    if (state.playback.audio && !state.playback.audio.paused) state.playback.audio.pause();
    unbindCurrentAudio();
    clearCapturedAudioSourceCaches();
    closeFloatingSelect();
    if (ui.player) ui.player.hidden = true;
    setPlayerStatus('');
  }

  function checkRouteChange() {
    if (getRouteKey() !== state.playback.routeKey) resetPlaybackForRouteChange();
  }

  function togglePlayerCollapsed() {
    closeFloatingSelect();
    settings.playerCollapsed = !settings.playerCollapsed;
    localStorage.setItem(STORAGE_PLAYER_COLLAPSED, String(settings.playerCollapsed));
    ui.player?.setAttribute(PLAYER_COLLAPSED_ATTRIBUTE, String(settings.playerCollapsed));
    replaceButtonIcon(
      ui.minimizeButton,
      settings.playerCollapsed ? '展开播放器' : '最小化播放器',
      settings.playerCollapsed ? 'M7 12h10M12 7v10' : 'M7 12h10'
    );
  }

  function togglePlayback() {
    if (!state.playback.audio) return;
    if (state.playback.audio.paused || state.playback.audio.ended) {
      const playPromise = state.playback.audio.play();
      playPromise?.catch((error) => {
        console.warn(`${SCRIPT_PREFIX} 音频播放失败。`, error);
      });
    } else {
      state.playback.audio.pause();
    }
  }

  function seekBy(seconds) {
    if (!state.playback.audio) return;
    const duration = hasUsableDuration() ? state.playback.audio.duration : Infinity;
    const nextTime = Math.max(0, Math.min(state.playback.audio.currentTime + seconds, duration));
    if (Number.isFinite(nextTime)) state.playback.audio.currentTime = nextTime;
    updatePlayerState();
  }

  function handleSeekInput() {
    if (!state.playback.audio || !hasUsableDuration()) return;
    const ratio = Number(ui.seekRange.value) / 1000;
    state.playback.audio.currentTime = state.playback.audio.duration * ratio;
    updatePlayerState();
  }

  function handleSeekStepChange() {
    const nextStep = Number(ui.seekStepSelect.value);
    if (!SEEK_STEP_OPTIONS.includes(nextStep)) return;
    settings.seekStep = nextStep;
    localStorage.setItem(STORAGE_SEEK_STEP, String(settings.seekStep));
    updateSeekControlLabels();
  }

  function handlePlaybackRateChange() {
    const nextRate = Number(ui.speedSelect.value);
    if (!PLAYBACK_RATE_OPTIONS.includes(nextRate)) return;
    settings.playbackRate = nextRate;
    localStorage.setItem(STORAGE_PLAYBACK_RATE, String(settings.playbackRate));
    if (state.playback.audio) state.playback.audio.playbackRate = settings.playbackRate;
  }

  function updatePlayerState() {
    if (!ui.player) return;

    const hasAudio = isAudioElement(state.playback.audio);
    const isPlaying = hasAudio && !state.playback.audio.paused && !state.playback.audio.ended;
    const canSeek = hasAudio && hasUsableDuration();

    ui.backwardButton.disabled = !hasAudio || state.navigation.inProgress;
    ui.forwardButton.disabled = !hasAudio || state.navigation.inProgress;
    ui.playPauseButton.disabled = !hasAudio || state.navigation.inProgress;
    ui.seekRange.disabled = !canSeek;
    ui.speedSelect.disabled = !hasAudio || state.navigation.inProgress;
    ui.seekStepSelect.disabled = state.navigation.inProgress;
    if (ui.downloadButton) {
      ui.downloadButton.disabled =
        !hasAudio || state.navigation.inProgress || state.download.inProgress ||
        !getCurrentAudioSource() || !!state.playback.audio?.srcObject;
      ui.downloadButton.setAttribute('aria-busy', String(state.download.inProgress));
    }
    updateMessageNavigationState();

    replaceButtonIcon(
      ui.playPauseButton,
      isPlaying ? '暂停' : '播放',
      isPlaying ? 'M9 7v10M15 7v10' : 'M9 7.5v9l7-4.5-7-4.5Z'
    );

    if (!hasAudio) {
      ui.currentTimeLabel.textContent = '0:00';
      ui.durationLabel.textContent = '--:--';
      ui.seekRange.value = '0';
      return;
    }

    ui.currentTimeLabel.textContent = formatTime(state.playback.audio.currentTime);
    ui.durationLabel.textContent = formatTime(state.playback.audio.duration);
    ui.seekRange.value = canSeek
      ? String(Math.round((state.playback.audio.currentTime / state.playback.audio.duration) * 1000))
      : '0';
    ui.speedSelect.value = String(state.playback.audio.playbackRate || settings.playbackRate);
  }

  function isEditableTarget(target) {
    if (!(isElementNode(target))) return false;
    return !!target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'
    );
  }

  function handleGlobalKeydown(event) {
    if (!event.isTrusted) return;
    if (state.overlay.openSelect && event.key === 'Escape') {
      closeFloatingSelect();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!ui.player || ui.player.hidden || !state.playback.audio) return;
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
        seekBy(-settings.seekStep);
        break;
      case 'ArrowRight':
        seekBy(settings.seekStep);
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

  function installObjectUrlCaptureHook() {
    const urlApi = window.URL;
    if (!urlApi || typeof urlApi.createObjectURL !== 'function') return;

    const currentCreateObjectURL = urlApi.createObjectURL;
    if (currentCreateObjectURL.__cyanReadAloudHook === true) return;

    function cyanReadAloudCreateObjectURL(object) {
      const objectUrl = currentCreateObjectURL.apply(this, arguments);
      if (object instanceof Blob && typeof objectUrl === 'string' && objectUrl.startsWith('blob:')) {
        state.download.objectUrlBlobs.set(objectUrl, object);
        while (state.download.objectUrlBlobs.size > CAPTURED_BLOB_URL_LIMIT) {
          const oldestUrl = state.download.objectUrlBlobs.keys().next().value;
          state.download.objectUrlBlobs.delete(oldestUrl);
        }
      } else if (window.MediaSource && object instanceof window.MediaSource) {
        rememberMediaSourceObjectUrl(objectUrl, object);
      }
      return objectUrl;
    }

    Object.defineProperty(cyanReadAloudCreateObjectURL, '__cyanReadAloudHook', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    try {
      urlApi.createObjectURL = cyanReadAloudCreateObjectURL;
    } catch (error) {
      console.warn(`${SCRIPT_PREFIX} 无法安装 Blob / MediaSource 捕获钩子。`, error);
    }

    const currentRevokeObjectURL = urlApi.revokeObjectURL;
    if (typeof currentRevokeObjectURL === 'function' &&
        currentRevokeObjectURL.__cyanReadAloudHook !== true) {
      function cyanReadAloudRevokeObjectURL(objectUrl) {
        scheduleCapturedObjectUrlCleanup(String(objectUrl || ''));
        return currentRevokeObjectURL.apply(this, arguments);
      }

      Object.defineProperty(cyanReadAloudRevokeObjectURL, '__cyanReadAloudHook', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      });

      try {
        urlApi.revokeObjectURL = cyanReadAloudRevokeObjectURL;
      } catch (error) {
        console.warn(`${SCRIPT_PREFIX} 无法安装 Object URL 清理钩子。`, error);
      }
    }
  }

  function installMediaSourceCaptureHooks() {
    const mediaSourcePrototype = window.MediaSource?.prototype;
    const sourceBufferPrototype = window.SourceBuffer?.prototype;
    if (!mediaSourcePrototype || !sourceBufferPrototype) return;

    const currentAddSourceBuffer = mediaSourcePrototype.addSourceBuffer;
    if (typeof currentAddSourceBuffer === 'function' &&
        currentAddSourceBuffer.__cyanReadAloudHook !== true) {
      function cyanReadAloudAddSourceBuffer(mimeType) {
        const sourceBuffer = currentAddSourceBuffer.apply(this, arguments);
        const session = getOrCreateMediaSourceSession(this);
        if (session && sourceBuffer) {
          session.mimeType ||= String(mimeType || '');
          session.sourceBuffers.add(sourceBuffer);
          state.download.sourceBufferSessions.set(sourceBuffer, session);
        }
        return sourceBuffer;
      }

      Object.defineProperty(cyanReadAloudAddSourceBuffer, '__cyanReadAloudHook', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      });

      try {
        mediaSourcePrototype.addSourceBuffer = cyanReadAloudAddSourceBuffer;
      } catch (error) {
        console.warn(`${SCRIPT_PREFIX} 无法安装 MediaSource SourceBuffer 捕获钩子。`, error);
      }
    }

    const currentAppendBuffer = sourceBufferPrototype.appendBuffer;
    if (typeof currentAppendBuffer === 'function' &&
        currentAppendBuffer.__cyanReadAloudHook !== true) {
      function cyanReadAloudAppendBuffer(buffer) {
        const session = state.download.sourceBufferSessions.get(this);
        const bytes = session ? copyBufferSourceBytes(buffer) : null;
        const result = currentAppendBuffer.apply(this, arguments);
        if (session && bytes?.byteLength) {
          session.segments.push(bytes);
          session.totalBytes += bytes.byteLength;
        }
        return result;
      }

      Object.defineProperty(cyanReadAloudAppendBuffer, '__cyanReadAloudHook', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      });

      try {
        sourceBufferPrototype.appendBuffer = cyanReadAloudAppendBuffer;
      } catch (error) {
        console.warn(`${SCRIPT_PREFIX} 无法安装 SourceBuffer 音频片段捕获钩子。`, error);
      }
    }
  }

  function installMediaPlayHook() {
    const mediaPrototype = window.HTMLMediaElement?.prototype;
    if (!mediaPrototype || typeof mediaPrototype.play !== 'function') return;

    const currentPlay = mediaPrototype.play;
    if (currentPlay.__cyanReadAloudHook === true) return;

    function cyanReadAloudPlay(...args) {
      // ChatGPT may play a detached <audio> that never enters document, so bind
      // it before play() fires. Direct listeners on the element still receive
      // its media events even when document-level capture cannot.
      if (isAudioElement(this)) {
        const source = `${this.currentSrc || this.src || ''}`.trim();
        const capturedBlob = state.download.objectUrlBlobs.get(source);
        if (capturedBlob instanceof Blob) {
          state.download.audioBlobs.set(this, capturedBlob);
        }
        const mediaSession = state.download.objectUrlMediaSessions.get(source);
        if (mediaSession) {
          state.download.audioMediaSessions.set(this, mediaSession);
        }
        if (isExpectedPlaybackAudio(this)) bindAudio(this, false);
      }
      return currentPlay.apply(this, args);
    }

    Object.defineProperty(cyanReadAloudPlay, '__cyanReadAloudHook', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    try {
      mediaPrototype.play = cyanReadAloudPlay;
    } catch (error) {
      console.warn(`${SCRIPT_PREFIX} 无法安装音频播放捕获钩子。`, error);
    }
  }

  function handleDocumentPlay(event) {
    const audio = event.target;
    if (!isExpectedPlaybackAudio(audio)) return;

    const shouldShow = activatePlaybackSession(audio);
    bindAudio(audio, shouldShow);
  }

  function scanForAudio() {
    checkRouteChange();
    const audio = findBestAudio();
    if (!audio || audio.paused || audio.ended || !isExpectedPlaybackAudio(audio)) return;

    const shouldShow = activatePlaybackSession(audio);
    bindAudio(audio, shouldShow);
  }

  // ---------------------------------------------------------------------------
  // Application lifecycle
  // ---------------------------------------------------------------------------

  function startAudioTracking() {
    installObjectUrlCaptureHook();
    installMediaSourceCaptureHooks();
    installMediaPlayHook();
    document.addEventListener('play', handleDocumentPlay, true);
    document.addEventListener('keydown', handleGlobalKeydown, true);
    document.addEventListener('pointerdown', (event) => {
      if (!state.overlay.openSelect) return;
      if (state.overlay.openSelect.button.contains(event.target) ||
          state.overlay.openSelect.menu.contains(event.target)) return;
      closeFloatingSelect();
    }, true);
    window.addEventListener('resize', () => closeFloatingSelect(), { passive: true });
    window.addEventListener('scroll', () => closeFloatingSelect(), { passive: true, capture: true });
    state.playback.scanTimer = window.setInterval(scanForAudio, AUDIO_SCAN_INTERVAL_MS);
    scanForAudio();
  }

  function observePage() {
    const observer = new MutationObserver((mutations) => {
      checkRouteChange();
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (isElementNode(node)) {
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

  // 播放器核心初始化与 MP3 模块隔离，下载模块异常不会阻止朗读按钮和播放器启动。
  installStyle();
  scanRoot(document);
  observePage();
  startAudioTracking();
})();

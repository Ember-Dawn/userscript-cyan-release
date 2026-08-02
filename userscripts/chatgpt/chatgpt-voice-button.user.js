// ==UserScript==
// @name         ChatGPT 一级朗读按钮
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-voice-button.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-voice-button.user.js
// @version      1.1.0
// @description  在 ChatGPT 助手回答的一级操作栏末尾增加朗读按钮，并在后台调用官方“朗读/重播”菜单项。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
脚本说明：

1. 作用
 - 在每条助手回答的一级操作栏末尾增加一个朗读按钮。
 - 用户只需点击一次，脚本会在后台打开“更多操作”，调用官方“朗读/重播”菜单项。
 - 原“更多操作”菜单中的朗读或重播入口保持不变。

2. 实现方式
 - 通过当前回答操作栏中明确标记为“更多操作”的按钮打开对应菜单。
 - 使用官方稳定标识 data-testid="voice-play-turn-action-button" 定位朗读菜单项。
 - 自动操作期间临时隐藏包含该菜单项的弹出菜单，避免视觉闪烁。
 - 不读取回答正文，不调用未公开接口，也不自行实现语音合成。

3. 性能与可靠性
 - 使用 MutationObserver 处理 ChatGPT 单页应用中的动态回答和重新渲染。
 - 只扫描新增节点附近的回复操作栏，并使用标记避免重复插入。
 - 每次点击都设置超时并及时清理临时监听器、样式状态、菜单和焦点状态。
 - 同一时间只执行一次后台菜单操作，避免多个回答之间相互干扰。
*/

(() => {
  'use strict';

  const SCRIPT_PREFIX = '[ChatGPT 一级朗读按钮]';

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

  const MENU_WAIT_TIMEOUT_MS = 2000;
  const ITEM_ACTIVATION_DELAY_MS = 32;
  const MENU_CLOSE_DELAY_MS = 100;

  let activeOperation = null;
  let scanFrame = null;
  const pendingScanRoots = new Set();

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function installStyle() {
    if (document.getElementById(STYLE_ELEMENT_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
      html[${HIDE_MENU_ATTRIBUTE}] [role="menu"]:has(${OFFICIAL_VOICE_ITEM_SELECTOR}),
      html[${HIDE_MENU_ATTRIBUTE}] [data-radix-menu-content]:has(${OFFICIAL_VOICE_ITEM_SELECTOR}) {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transition: none !important;
        animation: none !important;
      }

      button[${CUSTOM_BUTTON_ATTRIBUTE}="true"] {
        color: color-mix(in srgb, currentColor 76%, #4f7f91 24%);
      }

      button[${CUSTOM_BUTTON_ATTRIBUTE}="true"]:hover {
        color: color-mix(in srgb, currentColor 68%, #3f778b 32%);
      }

      button[${CUSTOM_BUTTON_ATTRIBUTE}="true"][aria-busy="true"] {
        opacity: 0.55;
        pointer-events: none;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function isAssistantActionGroup(group) {
    if (!(group instanceof Element) || !group.isConnected) return false;

    const turn = group.closest('article, [data-testid^="conversation-turn-"]');
    if (turn?.querySelector('[data-message-author-role="assistant"]')) {
      return true;
    }

    if (group.closest('[data-message-author-role="assistant"]')) {
      return true;
    }

    const moreButton = group.querySelector(MORE_BUTTON_SELECTOR);
    const label = normalizeText(group.getAttribute('aria-label'));

    return !!moreButton && (label === '回复操作' || label === 'Response actions');
  }

  function findMoreButton(group) {
    return group.querySelector(MORE_BUTTON_SELECTOR);
  }

  function createSpeakerIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M11 5 6.8 8.5H4.5A1.5 1.5 0 0 0 3 10v4a1.5 1.5 0 0 0 1.5 1.5h2.3L11 19V5Zm4.2 3.2a5.4 5.4 0 0 1 0 7.6M17.9 5.5a9 9 0 0 1 0 13'
    );
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(path);
    return svg;
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
      if (existingButton !== group.lastElementChild) {
        group.appendChild(existingButton);
      }
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
    for (const group of collectActionGroups(root)) {
      enhanceActionGroup(group);
    }
  }

  function scheduleScan(root) {
    pendingScanRoots.add(root instanceof Node ? root : document);
    if (scanFrame !== null) return;

    scanFrame = window.requestAnimationFrame(() => {
      scanFrame = null;
      const roots = Array.from(pendingScanRoots);
      pendingScanRoots.clear();

      for (const scanTarget of roots) {
        if (scanTarget === document || scanTarget.isConnected) {
          scanRoot(scanTarget);
        }
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

  function closeOpenMenu() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
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
      closeOpenMenu();
      console.warn(`${SCRIPT_PREFIX} ${error}`);
    }
  }

  function activateOfficialVoiceItem(operation, item) {
    if (operation.completed || operation.activationTimerId !== null) return;
    if (activeOperation !== operation) return;

    operation.activationTimerId = window.setTimeout(() => {
      operation.activationTimerId = null;
      if (operation.completed || activeOperation !== operation) return;
      if (!isVisibleVoiceItem(item)) return;

      operation.completed = true;
      item.click();

      window.setTimeout(() => {
        closeOpenMenu();
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

    operation.observer = new MutationObserver(() => {
      tryActivateVoiceItem(operation);
    });

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

    startOfficialVoiceAction(button, moreButton);
  }

  function observePage() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scheduleScan(node);
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
})();

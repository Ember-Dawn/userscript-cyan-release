// ==UserScript==
// @name         Flaticon 快捷下载助手
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @version      0.1.0
// @description  为 Flaticon 图标卡片增加可选 HEX 颜色、一键复制 PNG 和一键下载 PNG，并收起原生 Copy/Download 二级菜单入口。
// @author       Ember-Dawn
// @match        https://www.flaticon.com/*
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/flaticon/flaticon-quick-download.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/flaticon/flaticon-quick-download.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const STYLE_ID = 'cyan-fi-quick-download-style';
  const CARD_CLASS = 'cyan-fi-card';
  const ACTIONS_CLASS = 'cyan-fi-quick-actions';
  const AUTO_DOWNLOAD_CLASS = 'cyan-fi-auto-download';
  const AUTO_MODAL_ATTRIBUTE = 'data-cyan-fi-auto-modal';
  const TOAST_ID = 'cyan-fi-quick-toast';
  const COPY_ITEM_SELECTOR = '.copy-png-svg-list';
  const DOWNLOAD_ITEM_SELECTOR = '.download-png-svg-list';
  const COPY_PNG_SELECTOR = '.copypng--button[data-copy-format="png"], .copypng--button';
  const DOWNLOAD_PNG_SELECTOR = '.GA_CM_download-png button, button[onclick*="direct_download_icon_post"][onclick*="png"]';

  let scanTimer = null;
  let pendingDownload = null;
  const nativeFormSubmit = HTMLFormElement.prototype.submit;

  HTMLFormElement.prototype.submit = function (...args) {
    if (pendingDownload && this.id === `download-form-${pendingDownload.iconId}`) {
      const colorInput = this.querySelector('input[name="color"]');
      if (colorInput && pendingDownload.color) {
        colorInput.value = pendingDownload.color;
        colorInput.setAttribute('value', pendingDownload.color);
      }
    }
    return nativeFormSubmit.apply(this, args);
  };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CARD_CLASS} {
        position: relative !important;
      }

      .${CARD_CLASS} > .${ACTIONS_CLASS} {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 20;
        display: flex;
        flex-direction: column;
        gap: 6px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease;
      }

      .${CARD_CLASS}:hover > .${ACTIONS_CLASS},
      .${CARD_CLASS} > .${ACTIONS_CLASS}:focus-within {
        opacity: 1;
        pointer-events: auto;
      }

      .${CARD_CLASS} ${COPY_ITEM_SELECTOR},
      .${CARD_CLASS} ${DOWNLOAD_ITEM_SELECTOR} {
        display: none !important;
      }

      .${ACTIONS_CLASS} .cyan-fi-color {
        box-sizing: border-box;
        width: 58px;
        height: 30px;
        padding: 0 7px;
        border: 1px solid rgba(0, 0, 0, 0.14);
        border-radius: 7px;
        outline: none;
        background: #fff;
        color: #222;
        font: 600 12px/30px Arial, sans-serif;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .${ACTIONS_CLASS} .cyan-fi-color::placeholder {
        color: #8b8b8b;
        font-weight: 500;
      }

      .${ACTIONS_CLASS} .cyan-fi-color:focus {
        border-color: #2e90fa;
        box-shadow: 0 0 0 2px rgba(46, 144, 250, 0.15);
      }

      .${ACTIONS_CLASS} .cyan-fi-color.cyan-fi-invalid {
        border-color: #d92d20;
        box-shadow: 0 0 0 2px rgba(217, 45, 32, 0.12);
      }

      .${ACTIONS_CLASS} .cyan-fi-action {
        box-sizing: border-box;
        width: 34px;
        height: 34px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(0, 0, 0, 0.10);
        border-radius: 8px;
        background: #fff;
        color: #424242;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .${ACTIONS_CLASS} .cyan-fi-action:hover {
        background: #f7f7f7;
      }

      .${ACTIONS_CLASS} .cyan-fi-action.cyan-fi-download {
        border-color: #52b788;
        background: #5bc18e;
        color: #fff;
      }

      .${ACTIONS_CLASS} .cyan-fi-action.cyan-fi-download:hover {
        background: #4eb681;
      }

      .${ACTIONS_CLASS} .cyan-fi-action svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      [${AUTO_MODAL_ATTRIBUTE}="true"] {
        visibility: hidden !important;
        pointer-events: none !important;
      }

      #${TOAST_ID} {
        position: fixed;
        left: 50%;
        bottom: 28px;
        z-index: 2147483647;
        transform: translateX(-50%);
        max-width: min(520px, calc(100vw - 32px));
        padding: 9px 12px;
        border-radius: 8px;
        background: rgba(33, 33, 33, 0.92);
        color: #fff;
        font: 13px/1.35 Arial, sans-serif;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
        pointer-events: none;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function showToast(message, duration = 1800) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.remove(), duration);
  }

  function normalizeHex(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const body = raw.replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(body)) {
      return `#${body.split('').map((char) => char + char).join('').toUpperCase()}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(body)) return `#${body.toUpperCase()}`;
    return null;
  }

  function getIconId(...elements) {
    for (const element of elements) {
      if (!(element instanceof Element)) continue;

      const tracking = element.getAttribute('data-track-arguments') || element.getAttribute('data-ga_params') || '';
      const trailingNumber = tracking.match(/(?:,|\s)(\d{3,})\s*$/)?.[1];
      if (trailingNumber) return trailingNumber;

      const form = element.querySelector?.('form[id^="download-form-"]');
      const formId = form?.id?.match(/^download-form-(\d+)$/)?.[1];
      if (formId) return formId;
    }
    return '';
  }

  function lowestCommonAncestor(a, b) {
    if (!(a instanceof Node) || !(b instanceof Node)) return null;
    const ancestors = new Set();
    for (let node = a; node; node = node.parentNode) ancestors.add(node);
    for (let node = b; node; node = node.parentNode) {
      if (ancestors.has(node)) return node instanceof Element ? node : null;
    }
    return null;
  }

  function findCard(copyItem, downloadItem) {
    let node = lowestCommonAncestor(copyItem, downloadItem) || downloadItem.parentElement;

    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      const rect = node.getBoundingClientRect();
      const hasImage = Boolean(node.querySelector('img, picture, svg'));
      if (hasImage && rect.width >= 120 && rect.height >= 120) return node;
    }

    return lowestCommonAncestor(copyItem, downloadItem)?.parentElement || downloadItem.parentElement;
  }

  function applyColorHints(card, color, iconId = '') {
    if (!color || !(card instanceof Element)) return;

    card.querySelectorAll('input[name="color"]').forEach((input) => {
      input.value = color;
      input.setAttribute('value', color);
    });

    card.querySelectorAll('[data-color]').forEach((element) => {
      const current = element.getAttribute('data-color') || '';
      if (!current || /^#?[0-9a-fA-F]{3,8}$/.test(current)) {
        element.setAttribute('data-color', color);
      }
    });

    if (iconId) {
      const form = document.getElementById(`download-form-${iconId}`);
      const input = form?.querySelector('input[name="color"]');
      if (input) {
        input.value = color;
        input.setAttribute('value', color);
      }
    }
  }

  function getValidatedColor(input) {
    const color = normalizeHex(input.value);
    input.classList.toggle('cyan-fi-invalid', color === null);

    if (color === null) {
      showToast('请输入 3 位或 6 位 HEX 颜色，例如 #2563EB');
      input.focus();
      return null;
    }

    if (color) input.value = color;
    return color;
  }

  function triggerCopy(card, input, copyItem, downloadItem) {
    const color = getValidatedColor(input);
    if (color === null) return;

    const iconId = getIconId(copyItem, downloadItem, card);
    if (color) applyColorHints(card, color, iconId);

    const nativeButton = copyItem.querySelector(COPY_PNG_SELECTOR);
    if (!(nativeButton instanceof HTMLElement)) {
      showToast('未找到 Flaticon 原生 PNG 复制按钮');
      return;
    }

    nativeButton.click();
  }

  function findDownloadModal(button) {
    if (!(button instanceof Element)) return null;
    return button.closest('[role="dialog"], .modal, [class*="modal-"]') || button.parentElement?.parentElement;
  }

  function finishAutoDownload() {
    document.documentElement.classList.remove(AUTO_DOWNLOAD_CLASS);
    document.querySelectorAll(`[${AUTO_MODAL_ATTRIBUTE}="true"]`).forEach((element) => {
      element.removeAttribute(AUTO_MODAL_ATTRIBUTE);
    });
    pendingDownload = null;
  }

  function continueAutoDownload() {
    if (!pendingDownload) return;

    const { iconId, color, card, startedAt } = pendingDownload;
    if (performance.now() - startedAt > 5000) {
      finishAutoDownload();
      showToast('自动下载等待超时，请重试');
      return;
    }

    if (color) applyColorHints(card, color, iconId);

    const form = iconId ? document.getElementById(`download-form-${iconId}`) : null;
    if (form && color) {
      const colorInput = form.querySelector('input[name="color"]');
      if (colorInput) {
        colorInput.value = color;
        colorInput.setAttribute('value', color);
      }
    }

    const freeButton = document.getElementById('download-free');
    if (!(freeButton instanceof HTMLButtonElement)) return;

    const modal = findDownloadModal(freeButton);
    if (modal) modal.setAttribute(AUTO_MODAL_ATTRIBUTE, 'true');

    if (pendingDownload.freeClicked) return;
    pendingDownload.freeClicked = true;

    queueMicrotask(() => {
      if (!pendingDownload) return;
      if (color) applyColorHints(card, color, iconId);
      freeButton.click();

      window.setTimeout(() => {
        const confirmationClose = document.querySelector('.detail__download-confirmation__close');
        if (confirmationClose instanceof HTMLElement) confirmationClose.click();
        finishAutoDownload();
        showToast('PNG 下载已触发；免费图标仍需遵守 Flaticon 的署名要求。', 2400);
      }, 220);
    });
  }

  function triggerDownload(card, input, copyItem, downloadItem) {
    const color = getValidatedColor(input);
    if (color === null) return;

    const iconId = getIconId(downloadItem, copyItem, card);
    if (color) applyColorHints(card, color, iconId);

    const nativeButton = downloadItem.querySelector(DOWNLOAD_PNG_SELECTOR);
    if (!(nativeButton instanceof HTMLElement)) {
      showToast('未找到 Flaticon 原生 PNG 下载按钮');
      return;
    }

    pendingDownload = {
      iconId,
      color,
      card,
      freeClicked: false,
      startedAt: performance.now(),
    };

    document.documentElement.classList.add(AUTO_DOWNLOAD_CLASS);
    nativeButton.click();
    continueAutoDownload();
  }

  function createIconButton(className, title, svg) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cyan-fi-action ${className}`;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = svg;
    return button;
  }

  function enhanceCard(copyItem, downloadItem) {
    if (!(copyItem instanceof HTMLElement) || !(downloadItem instanceof HTMLElement)) return;

    const card = findCard(copyItem, downloadItem);
    if (!(card instanceof HTMLElement) || card.querySelector(`:scope > .${ACTIONS_CLASS}`)) return;

    card.classList.add(CARD_CLASS);

    const actions = document.createElement('div');
    actions.className = ACTIONS_CLASS;

    const colorInput = document.createElement('input');
    colorInput.type = 'text';
    colorInput.className = 'cyan-fi-color';
    colorInput.placeholder = 'HEX';
    colorInput.maxLength = 7;
    colorInput.spellcheck = false;
    colorInput.autocomplete = 'off';
    colorInput.setAttribute('aria-label', 'PNG HEX 颜色；留空使用默认颜色');
    colorInput.title = 'PNG HEX 颜色；留空使用默认颜色';
    colorInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const color = getValidatedColor(colorInput);
      if (color !== null) colorInput.blur();
    });
    colorInput.addEventListener('input', () => colorInput.classList.remove('cyan-fi-invalid'));

    const copyButton = createIconButton(
      'cyan-fi-copy',
      'Copy PNG',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>'
    );

    const downloadButton = createIconButton(
      'cyan-fi-download',
      'Download PNG',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"></path><path d="m8 11 4 4 4-4"></path><path d="M5 20h14"></path></svg>'
    );

    copyButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      triggerCopy(card, colorInput, copyItem, downloadItem);
    });

    downloadButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      triggerDownload(card, colorInput, copyItem, downloadItem);
    });

    actions.append(colorInput, copyButton, downloadButton);
    card.appendChild(actions);
  }

  function scan() {
    document.querySelectorAll(DOWNLOAD_ITEM_SELECTOR).forEach((downloadItem) => {
      const parent = downloadItem.parentElement;
      if (!parent) return;

      const copyItem = parent.querySelector(COPY_ITEM_SELECTOR)
        || downloadItem.previousElementSibling?.matches?.(COPY_ITEM_SELECTOR) && downloadItem.previousElementSibling;
      if (!(copyItem instanceof HTMLElement)) return;

      enhanceCard(copyItem, downloadItem);
    });
  }

  function scheduleScan(delay = 80) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, delay);
  }

  function startObserver() {
    const observer = new MutationObserver(() => {
      scheduleScan();
      if (pendingDownload) continueAutoDownload();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  injectStyle();
  scan();
  startObserver();
})();

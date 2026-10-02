// ==UserScript==
// @name         Flaticon 快捷下载助手
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @version      0.1.1
// @description  为 Flaticon 图标卡片增加每次悬停清空的可选 HEX 颜色、一键复制 PNG 和一键下载 PNG，同时保留全部原生按钮。
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
  let pendingCopy = null;
  let pendingCopyTimer = null;

  const nativeFormSubmit = HTMLFormElement.prototype.submit;
  const nativeFormRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  const clipboardPrototype = window.Clipboard?.prototype;
  const nativeClipboardWrite = clipboardPrototype?.write;

  function writePendingDownloadColor(form) {
    if (!pendingDownload || !(form instanceof HTMLFormElement)) return;
    if (form.id !== `download-form-${pendingDownload.iconId}`) return;
    if (!pendingDownload.color) return;

    const colorInput = form.querySelector('input[name="color"]');
    if (!colorInput) return;

    colorInput.value = pendingDownload.color;
    colorInput.setAttribute('value', pendingDownload.color);
  }

  HTMLFormElement.prototype.submit = function (...args) {
    writePendingDownloadColor(this);
    return nativeFormSubmit.apply(this, args);
  };

  if (nativeFormRequestSubmit) {
    HTMLFormElement.prototype.requestSubmit = function (...args) {
      writePendingDownloadColor(this);
      return nativeFormRequestSubmit.apply(this, args);
    };
  }

  document.addEventListener(
    'submit',
    (event) => {
      if (event.target instanceof HTMLFormElement) writePendingDownloadColor(event.target);
    },
    true
  );

  async function recolorPngBlob(blob, color) {
    if (!(blob instanceof Blob) || !color) return blob;

    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const context = canvas.getContext('2d');
      if (!context) return blob;

      context.drawImage(bitmap, 0, 0);
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);

      return await new Promise((resolve) => {
        canvas.toBlob((result) => resolve(result || blob), 'image/png');
      });
    } finally {
      bitmap.close?.();
    }
  }

  function installClipboardProxy() {
    if (!clipboardPrototype || typeof nativeClipboardWrite !== 'function') return;
    if (clipboardPrototype.write.__cyanFiWrapped) return;

    const wrappedWrite = async function (items) {
      const copyState = pendingCopy;
      if (!copyState?.color || !Array.isArray(items)) {
        return nativeClipboardWrite.call(this, items);
      }

      try {
        const transformed = items.map((item) => {
          if (!(item instanceof ClipboardItem) || !item.types.includes('image/png')) return item;

          const entries = {};
          for (const type of item.types) {
            entries[type] = type === 'image/png'
              ? item.getType(type).then((blob) => recolorPngBlob(blob, copyState.color))
              : item.getType(type);
          }
          return new ClipboardItem(entries);
        });

        return await nativeClipboardWrite.call(this, transformed);
      } finally {
        pendingCopy = null;
        window.clearTimeout(pendingCopyTimer);
        pendingCopyTimer = null;
      }
    };

    Object.defineProperty(wrappedWrite, '__cyanFiWrapped', { value: true });
    clipboardPrototype.write = wrappedWrite;
  }

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

      .${ACTIONS_CLASS} .cyan-fi-icon {
        position: relative;
        display: block;
        width: 18px;
        height: 18px;
        box-sizing: border-box;
        color: currentColor;
      }

      .${ACTIONS_CLASS} .cyan-fi-icon-copy::before,
      .${ACTIONS_CLASS} .cyan-fi-icon-copy::after {
        content: '';
        position: absolute;
        box-sizing: border-box;
        width: 11px;
        height: 11px;
        border: 1.7px solid currentColor;
        border-radius: 2px;
      }

      .${ACTIONS_CLASS} .cyan-fi-icon-copy::before {
        left: 2px;
        top: 2px;
      }

      .${ACTIONS_CLASS} .cyan-fi-icon-copy::after {
        right: 2px;
        bottom: 2px;
        background: inherit;
      }

      .${ACTIONS_CLASS} .cyan-fi-icon-download::before {
        content: '';
        position: absolute;
        left: 8px;
        top: 2px;
        width: 2px;
        height: 10px;
        border-radius: 1px;
        background: currentColor;
        box-shadow: -3px 5px 0 -1px currentColor, 3px 5px 0 -1px currentColor;
        transform: rotate(0.01deg);
      }

      .${ACTIONS_CLASS} .cyan-fi-icon-download::after {
        content: '';
        position: absolute;
        left: 3px;
        bottom: 1px;
        width: 12px;
        height: 5px;
        border: 1.7px solid currentColor;
        border-top: 0;
        border-radius: 0 0 2px 2px;
      }

      html.${AUTO_DOWNLOAD_CLASS} [role="dialog"]:has(#download-free),
      html.${AUTO_DOWNLOAD_CLASS} .modal:has(#download-free),
      html.${AUTO_DOWNLOAD_CLASS} [class*="modal"]:has(#download-free),
      html.${AUTO_DOWNLOAD_CLASS} [role="dialog"]:has(.detail__download-confirmation__close),
      html.${AUTO_DOWNLOAD_CLASS} .modal:has(.detail__download-confirmation__close),
      html.${AUTO_DOWNLOAD_CLASS} [class*="modal"]:has(.detail__download-confirmation__close),
      [${AUTO_MODAL_ATTRIBUTE}="true"] {
        visibility: hidden !important;
        opacity: 0 !important;
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

    const nativeButton = copyItem.querySelector(COPY_PNG_SELECTOR);
    if (!(nativeButton instanceof HTMLElement)) {
      showToast('未找到 Flaticon 原生 PNG 复制按钮');
      return;
    }

    const iconId = getIconId(copyItem, downloadItem, card);
    if (color) applyColorHints(card, color, iconId);

    pendingCopy = color ? { color, startedAt: performance.now() } : null;
    window.clearTimeout(pendingCopyTimer);
    if (pendingCopy) {
      pendingCopyTimer = window.setTimeout(() => {
        if (pendingCopy && performance.now() - pendingCopy.startedAt >= 1800) pendingCopy = null;
      }, 2000);
    }

    nativeButton.click();
  }

  function markAutoModal(marker) {
    if (!(marker instanceof Element)) return null;

    let node = marker.parentElement;
    let best = null;
    for (let depth = 0; node && depth < 10 && node !== document.body; depth += 1, node = node.parentElement) {
      const className = typeof node.className === 'string' ? node.className : '';
      if (node.getAttribute('role') === 'dialog' || /(^|\s|_|-)modal(?:\s|_|-|$)/i.test(className)) {
        best = node;
      }
    }

    const modal = best || marker.closest('.modal-body, [role="dialog"], .modal');
    if (modal) modal.setAttribute(AUTO_MODAL_ATTRIBUTE, 'true');
    return modal;
  }

  function finishAutoDownload() {
    const marked = Array.from(document.querySelectorAll(`[${AUTO_MODAL_ATTRIBUTE}="true"]`));
    document.documentElement.classList.remove(AUTO_DOWNLOAD_CLASS);
    pendingDownload = null;

    window.setTimeout(() => {
      marked.forEach((element) => element.removeAttribute(AUTO_MODAL_ATTRIBUTE));
    }, 300);
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
    if (form) writePendingDownloadColor(form);

    const freeButton = document.getElementById('download-free');
    if (freeButton instanceof HTMLButtonElement) {
      markAutoModal(freeButton);

      if (!pendingDownload.freeClicked) {
        pendingDownload.freeClicked = true;
        queueMicrotask(() => {
          if (!pendingDownload) return;
          if (color) applyColorHints(card, color, iconId);
          if (form) writePendingDownloadColor(form);
          freeButton.click();
        });
      }
    }

    const confirmationClose = document.querySelector('.detail__download-confirmation__close');
    if (confirmationClose instanceof HTMLElement) {
      markAutoModal(confirmationClose);
      if (!pendingDownload.confirmationClosed) {
        pendingDownload.confirmationClosed = true;
        queueMicrotask(() => {
          confirmationClose.click();
          window.setTimeout(() => {
            finishAutoDownload();
            showToast('PNG 下载已触发');
          }, 80);
        });
      }
    }
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
      confirmationClosed: false,
      startedAt: performance.now(),
    };

    document.documentElement.classList.add(AUTO_DOWNLOAD_CLASS);
    nativeButton.click();
    continueAutoDownload();
  }

  function createIconButton(className, title, iconClassName) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cyan-fi-action ${className}`;
    button.title = title;
    button.setAttribute('aria-label', title);

    const icon = document.createElement('span');
    icon.className = `cyan-fi-icon ${iconClassName}`;
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
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

    const copyButton = createIconButton('cyan-fi-copy', 'Copy PNG', 'cyan-fi-icon-copy');
    const downloadButton = createIconButton('cyan-fi-download', 'Download PNG', 'cyan-fi-icon-download');

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

    card.addEventListener('mouseenter', () => {
      colorInput.value = '';
      colorInput.classList.remove('cyan-fi-invalid');
    });

    actions.append(colorInput, copyButton, downloadButton);
    card.appendChild(actions);
  }

  function scan() {
    document.querySelectorAll(DOWNLOAD_ITEM_SELECTOR).forEach((downloadItem) => {
      const parent = downloadItem.parentElement;
      if (!parent) return;

      const previousCopyItem = downloadItem.previousElementSibling;
      const copyItem = parent.querySelector(COPY_ITEM_SELECTOR)
        || (previousCopyItem?.matches?.(COPY_ITEM_SELECTOR) ? previousCopyItem : null);
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

  installClipboardProxy();
  injectStyle();
  scan();
  startObserver();
})();

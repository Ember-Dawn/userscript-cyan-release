// ==UserScript==
// @name         NocoDB 代码块工具
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-code-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-code-tools.user.js
// @version      5.0.1
// @description  为 NocoDB longtext rich-text 中的代码块提供悬浮复制与带确认的安全清空工具
// @match        https://nocodb.380782744.xyz/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

/*
 * NocoDB 代码块工具
 *
 * 维护原则：
 * - 不往 ProseMirror 管理的 pre/code 内插入按钮或确认弹窗。
 * - 工具栏与确认弹窗只挂在 .nc-rich-text-content 的外部 overlay 中。
 * - 不给 .nc-rich-text 根节点增加定位，避免影响 NocoDB 顶部 bubble toolbar。
 * - 所有工具控件都必须阻断 pointer/mouse/click 事件，避免被识别为点击编辑弹窗外部。
 * - 清空时保留 codeBlock，只删除其中的文本内容；不要用 innerHTML/textContent 直接改写编辑器 DOM。
 *
 * 更完整的架构、交互与维护说明见同目录 nocodb-code-tools.md。
 */

(function () {
  'use strict';

  const STYLE_ID = 'tm-nocodb-code-tools-style-v5';
  const CONTENT_ROOT_CLASS = 'tm-nocodb-code-tools-content-root';
  const HOST_CLASS = 'tm-nocodb-code-tools-overlay-host';
  const TOOLBAR_CLASS = 'tm-nocodb-code-tools-toolbar';
  const TOOL_BUTTON_CLASS = 'tm-nocodb-code-tools-button';
  const CLEAR_BUTTON_CLASS = 'tm-nocodb-code-tools-clear';
  const COPY_BUTTON_CLASS = 'tm-nocodb-code-tools-copy';
  const CONFIRM_CLASS = 'tm-nocodb-code-tools-confirm';

  let activePre = null;
  let activeContentRoot = null;
  let toolbarBoundPre = null;
  let toolbar = null;
  let clearButton = null;
  let copyButton = null;
  let confirmPanel = null;
  let confirmTargetPre = null;
  let hideTimer = null;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CONTENT_ROOT_CLASS} {
        position: relative !important;
      }

      .${HOST_CLASS} {
        position: absolute;
        inset: 0;
        z-index: 30;
        pointer-events: none;
      }

      .${TOOLBAR_CLASS} {
        position: absolute;
        display: none;
        align-items: center;
        gap: 4px;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
      }

      .${TOOL_BUTTON_CLASS} {
        width: 32px;
        height: 32px;
        padding: 0;
        margin: 0;
        border: 1px solid rgba(0, 0, 0, 0.10);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        color: #333;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
        pointer-events: auto;
      }

      .${TOOL_BUTTON_CLASS}:hover {
        background: #f5f5f5;
      }

      .${TOOL_BUTTON_CLASS} svg {
        width: 16px;
        height: 16px;
        display: block;
        margin: auto;
        pointer-events: none;
      }

      .${CLEAR_BUTTON_CLASS} {
        color: #b91c1c;
      }

      .${CLEAR_BUTTON_CLASS} svg {
        width: 18px;
        height: 18px;
        overflow: visible;
      }

      .${COPY_BUTTON_CLASS}.tm-copy-success {
        color: #16a34a;
      }

      .${COPY_BUTTON_CLASS}.tm-copy-failed {
        color: #dc2626;
      }

      .${CONFIRM_CLASS} {
        position: absolute;
        display: none;
        width: 190px;
        padding: 12px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.99);
        color: #222;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
      }

      .${CONFIRM_CLASS} .tm-nocodb-code-tools-confirm-title {
        margin: 0 0 10px;
        font-size: 13px;
        line-height: 1.45;
        font-weight: 600;
      }

      .${CONFIRM_CLASS} .tm-nocodb-code-tools-confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .${CONFIRM_CLASS} button {
        min-width: 58px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 7px;
        background: #fff;
        color: #333;
        cursor: pointer;
      }

      .${CONFIRM_CLASS} button:hover {
        background: #f5f5f5;
      }

      .${CONFIRM_CLASS} .tm-nocodb-code-tools-confirm-clear {
        border-color: #dc2626;
        background: #dc2626;
        color: #fff;
      }

      .${CONFIRM_CLASS} .tm-nocodb-code-tools-confirm-clear:hover {
        background: #b91c1c;
      }
    `;
    document.head.appendChild(style);
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function addProtectedControlEvents(element) {
    if (!element) return;
    element.addEventListener('pointerdown', stopEvent, true);
    element.addEventListener('mousedown', stopEvent, true);
    element.addEventListener('mouseup', stopEvent, true);
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getContentRoot(pre) {
    return pre ? pre.closest('.nc-rich-text-content') : null;
  }

  function isEditorCodeBlock(pre) {
    if (!(pre instanceof HTMLElement)) return false;

    const editor = pre.closest('.nc-rich-text-content .tiptap.ProseMirror');
    const contentRoot = getContentRoot(pre);
    const code = pre.querySelector(':scope > code');

    if (!editor || !contentRoot || !code) return false;
    if (pre.closest('[data-nocodb-markdown-table-id]')) return false;
    if (!isElementVisible(editor) || !isElementVisible(contentRoot) || !isElementVisible(pre)) return false;

    return true;
  }

  function getPreFromTarget(target) {
    let node = target;

    if (node && node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }

    if (!(node instanceof HTMLElement)) return null;

    const pre = node.closest('pre');
    if (!pre || !isEditorCodeBlock(pre)) return null;
    return pre;
  }

  function getCodeText(pre) {
    const code = pre && pre.querySelector(':scope > code');
    if (!code) return '';
    return (code.textContent || '').replace(/\u200B/g, '');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
        return true;
      }
    } catch (_) {}

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch (error) {
      console.error('[NocoDB 代码块工具] copy failed:', error);
      return false;
    }
  }

  function placeCaretInCodeBlock(pre) {
    if (!pre || !document.contains(pre) || !isEditorCodeBlock(pre)) return false;

    const code = pre.querySelector(':scope > code');
    const editor = pre.closest('.tiptap.ProseMirror');
    if (!code || !editor) return false;

    try {
      editor.focus({ preventScroll: true });

      const selection = window.getSelection();
      if (!selection) return false;

      const range = document.createRange();
      range.selectNodeContents(code);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (error) {
      console.error('[NocoDB 代码块工具] restore caret failed:', error);
      return false;
    }
  }

  function scheduleCaretRestore(pre) {
    const restore = () => placeCaretInCodeBlock(pre);

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(restore);
      });
      return;
    }

    window.setTimeout(restore, 0);
  }

  function clearCodeBlock(pre) {
    if (!pre || !isEditorCodeBlock(pre)) return false;

    const code = pre.querySelector(':scope > code');
    const editor = pre.closest('.tiptap.ProseMirror');
    if (!code || !editor) return false;

    const text = getCodeText(pre);
    if (!text) {
      scheduleCaretRestore(pre);
      return true;
    }

    try {
      editor.focus({ preventScroll: true });

      const selection = window.getSelection();
      if (!selection) return false;

      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);

      const deleted = document.execCommand('delete');
      if (!deleted) return false;

      // 删除完成后不要主动清掉 Selection；等待 ProseMirror 完成 DOM 同步后，
      // 再把折叠光标明确放回当前空 codeBlock 的第一行。
      scheduleCaretRestore(pre);
      return true;
    } catch (error) {
      console.error('[NocoDB 代码块工具] clear failed:', error);
      return false;
    }
  }

  function setCopyButtonState(ok) {
    if (!copyButton) return;

    copyButton.classList.remove('tm-copy-success', 'tm-copy-failed');
    copyButton.classList.add(ok ? 'tm-copy-success' : 'tm-copy-failed');
    copyButton.setAttribute('title', ok ? '已复制' : '复制失败');

    window.setTimeout(() => {
      if (!copyButton) return;
      copyButton.classList.remove('tm-copy-success', 'tm-copy-failed');
      copyButton.setAttribute('title', '复制代码');
    }, 1200);
  }

  function createToolbar() {
    if (toolbar && document.body.contains(toolbar)) return toolbar;

    toolbar = document.createElement('div');
    toolbar.className = TOOLBAR_CLASS;

    clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = `${TOOL_BUTTON_CLASS} ${CLEAR_BUTTON_CLASS}`;
    clearButton.setAttribute('aria-label', '清空代码');
    clearButton.setAttribute('title', '清空代码');
    clearButton.innerHTML = `
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.058l-.5-8.5a.5.5 0 1 0-.998.058m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"></path>
      </svg>
    `;

    copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = `${TOOL_BUTTON_CLASS} ${COPY_BUTTON_CLASS}`;
    copyButton.setAttribute('aria-label', '复制代码');
    copyButton.setAttribute('title', '复制代码');
    copyButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H10V7h9z"></path>
      </svg>
    `;

    addProtectedControlEvents(toolbar);
    addProtectedControlEvents(clearButton);
    addProtectedControlEvents(copyButton);

    clearButton.addEventListener('click', (event) => {
      stopEvent(event);

      const targetPre = getBoundTargetPre();
      if (!targetPre) return;

      showConfirmPanel(targetPre);
    }, true);

    copyButton.addEventListener('click', async (event) => {
      stopEvent(event);

      const targetPre = getBoundTargetPre();
      if (!targetPre) {
        setCopyButtonState(false);
        return;
      }

      const text = getCodeText(targetPre);
      if (!text) {
        setCopyButtonState(false);
        return;
      }

      const ok = await copyText(text);
      setCopyButtonState(ok);
      positionControls();
    }, true);

    toolbar.addEventListener('mouseenter', cancelHide);
    toolbar.addEventListener('mouseleave', () => {
      if (!isConfirmOpen()) scheduleHide(150);
    });

    toolbar.appendChild(clearButton);
    toolbar.appendChild(copyButton);
    return toolbar;
  }

  function createConfirmPanel() {
    if (confirmPanel && document.body.contains(confirmPanel)) return confirmPanel;

    confirmPanel = document.createElement('div');
    confirmPanel.className = CONFIRM_CLASS;
    confirmPanel.setAttribute('role', 'dialog');
    confirmPanel.setAttribute('aria-label', '确认清空代码');
    confirmPanel.innerHTML = `
      <div class="tm-nocodb-code-tools-confirm-title">确认清空这个代码块？</div>
      <div class="tm-nocodb-code-tools-confirm-actions">
        <button type="button" class="tm-nocodb-code-tools-confirm-cancel">取消</button>
        <button type="button" class="tm-nocodb-code-tools-confirm-clear">确认清空</button>
      </div>
    `;

    addProtectedControlEvents(confirmPanel);

    const cancelButton = confirmPanel.querySelector('.tm-nocodb-code-tools-confirm-cancel');
    const confirmClearButton = confirmPanel.querySelector('.tm-nocodb-code-tools-confirm-clear');
    addProtectedControlEvents(cancelButton);
    addProtectedControlEvents(confirmClearButton);

    cancelButton.addEventListener('click', (event) => {
      stopEvent(event);
      hideConfirmPanel();
      cancelHide();
    }, true);

    confirmClearButton.addEventListener('click', (event) => {
      stopEvent(event);

      const targetPre =
        confirmTargetPre && document.contains(confirmTargetPre) && isEditorCodeBlock(confirmTargetPre)
          ? confirmTargetPre
          : null;

      hideConfirmPanel();

      if (!targetPre) {
        hideToolbar(true);
        return;
      }

      const ok = clearCodeBlock(targetPre);
      if (!ok) {
        console.warn('[NocoDB 代码块工具] 无法通过编辑器删除动作清空代码块。');
      }

      if (document.contains(targetPre) && isEditorCodeBlock(targetPre)) {
        activateForPre(targetPre);
      } else {
        hideToolbar(true);
      }
    }, true);

    confirmPanel.addEventListener('mouseenter', cancelHide);
    confirmPanel.addEventListener('mouseleave', cancelHide);

    return confirmPanel;
  }

  function getBoundTargetPre() {
    const targetPre =
      toolbarBoundPre && document.contains(toolbarBoundPre)
        ? toolbarBoundPre
        : activePre && document.contains(activePre)
          ? activePre
          : null;

    if (!targetPre || !isEditorCodeBlock(targetPre)) return null;
    return targetPre;
  }

  function ensureOverlayHost(contentRoot) {
    if (!contentRoot) return null;

    contentRoot.classList.add(CONTENT_ROOT_CLASS);

    let host = contentRoot.querySelector(`:scope > .${HOST_CLASS}`);
    if (!host) {
      host = document.createElement('div');
      host.className = HOST_CLASS;
      contentRoot.appendChild(host);
    }

    const currentToolbar = createToolbar();
    const currentConfirmPanel = createConfirmPanel();

    if (currentToolbar.parentElement !== host) host.appendChild(currentToolbar);
    if (currentConfirmPanel.parentElement !== host) host.appendChild(currentConfirmPanel);

    return host;
  }

  function isConfirmOpen() {
    return Boolean(confirmPanel && confirmPanel.style.display !== 'none');
  }

  function showConfirmPanel(targetPre) {
    if (!targetPre || !activeContentRoot) return;

    ensureOverlayHost(activeContentRoot);
    confirmTargetPre = targetPre;
    confirmPanel.style.display = 'block';
    cancelHide();
    positionControls();
  }

  function hideConfirmPanel() {
    if (confirmPanel) confirmPanel.style.display = 'none';
    confirmTargetPre = null;
  }

  function showToolbar() {
    if (!activeContentRoot) return;
    ensureOverlayHost(activeContentRoot);
    if (toolbar) toolbar.style.display = 'flex';
  }

  function hideToolbar(clearActive = false) {
    cancelHide();
    hideConfirmPanel();

    if (toolbar) {
      toolbar.style.display = 'none';
    }

    if (copyButton) {
      copyButton.classList.remove('tm-copy-success', 'tm-copy-failed');
      copyButton.setAttribute('title', '复制代码');
    }

    if (clearActive) {
      activePre = null;
      activeContentRoot = null;
      toolbarBoundPre = null;
    }
  }

  function cancelHide() {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide(delay = 150) {
    if (isConfirmOpen()) return;
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideToolbar(true);
    }, delay);
  }

  function positionControls() {
    if (!toolbar || !activePre || !activeContentRoot) {
      hideToolbar(true);
      return;
    }

    if (
      !document.contains(activePre) ||
      !document.contains(activeContentRoot) ||
      !isEditorCodeBlock(activePre)
    ) {
      hideToolbar(true);
      return;
    }

    const preRect = activePre.getBoundingClientRect();
    const contentRect = activeContentRoot.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth || 68;
    const toolbarHeight = toolbar.offsetHeight || 32;
    const margin = 8;

    let left = preRect.right - contentRect.left - toolbarWidth - margin;
    let top = preRect.top - contentRect.top + margin;

    const maxLeft = Math.max(8, contentRect.width - toolbarWidth - 8);
    const maxTop = Math.max(8, contentRect.height - toolbarHeight - 8);

    left = Math.max(8, Math.min(left, maxLeft));
    top = Math.max(8, Math.min(top, maxTop));

    toolbar.style.left = `${Math.round(left)}px`;
    toolbar.style.top = `${Math.round(top)}px`;

    if (isConfirmOpen() && clearButton && confirmPanel) {
      const clearLeft = left;
      const clearBottom = top + toolbarHeight;
      const panelWidth = confirmPanel.offsetWidth || 190;
      const panelHeight = confirmPanel.offsetHeight || 86;

      // 设计约定：确认弹窗右上角与“清空”按钮左下角重合。
      let panelLeft = clearLeft - panelWidth;
      let panelTop = clearBottom;

      panelLeft = Math.max(8, Math.min(panelLeft, contentRect.width - panelWidth - 8));
      panelTop = Math.max(8, Math.min(panelTop, contentRect.height - panelHeight - 8));

      confirmPanel.style.left = `${Math.round(panelLeft)}px`;
      confirmPanel.style.top = `${Math.round(panelTop)}px`;
    }
  }

  function activateForPre(pre) {
    if (!pre || !isEditorCodeBlock(pre)) {
      hideToolbar(true);
      return;
    }

    const contentRoot = getContentRoot(pre);
    if (!contentRoot) {
      hideToolbar(true);
      return;
    }

    if (confirmTargetPre && confirmTargetPre !== pre) {
      hideConfirmPanel();
    }

    activePre = pre;
    activeContentRoot = contentRoot;
    toolbarBoundPre = pre;

    showToolbar();
    positionControls();
  }

  function isControlTarget(target) {
    if (!(target instanceof Node)) return false;
    return Boolean(
      (toolbar && (target === toolbar || toolbar.contains(target))) ||
      (confirmPanel && (target === confirmPanel || confirmPanel.contains(target)))
    );
  }

  function handleMouseMove(event) {
    if (isControlTarget(event.target)) {
      cancelHide();
      return;
    }

    if (isConfirmOpen()) {
      cancelHide();
      return;
    }

    const pre = getPreFromTarget(event.target);
    if (pre) {
      cancelHide();
      activateForPre(pre);
      return;
    }

    scheduleHide(150);
  }

  function handleDocumentPointerDown(event) {
    if (!isConfirmOpen()) return;
    if (isControlTarget(event.target)) return;

    hideConfirmPanel();
  }

  function handleScrollOrResize() {
    if (!activePre || !activeContentRoot) return;

    if (
      !document.contains(activePre) ||
      !document.contains(activeContentRoot) ||
      !isEditorCodeBlock(activePre)
    ) {
      hideToolbar(true);
      return;
    }

    if (toolbar && toolbar.style.display !== 'none') {
      positionControls();
    }
  }

  function observeDom() {
    const observer = new MutationObserver(() => {
      if (!activePre || !activeContentRoot) return;

      if (
        !document.contains(activePre) ||
        !document.contains(activeContentRoot) ||
        !isEditorCodeBlock(activePre)
      ) {
        hideToolbar(true);
        return;
      }

      if (toolbar && toolbar.style.display !== 'none') {
        positionControls();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  function init() {
    injectStyle();
    createToolbar();
    createConfirmPanel();
    hideToolbar(true);

    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    document.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize, true);

    observeDom();

    console.log('[NocoDB 代码块工具] ready');
  }

  init();
})();

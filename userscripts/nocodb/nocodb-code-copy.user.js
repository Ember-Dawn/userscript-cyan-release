// ==UserScript==
// @name         NocoDB 代码块复制
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-code-copy.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-code-copy.user.js
// @version      4.0.2
// @description  为 NocoDB longtext rich-text 中的代码块提供悬浮复制按钮（不影响顶部工具栏）
// @match        https://nocodb.380782744.xyz/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

/*
 * ============================================================
 * NocoDB 代码块复制
 * ============================================================
 *
 * 一、脚本目标
 * ------------------------------------------------------------
 * 给 NocoDB 自部署版本中的 longtext rich-text 代码块增加“复制代码”按钮。
 *
 * 当前页面特点：
 * 1) 未展开前，表格区域是 canvas 渲染，不是常规 DOM 单元格。
 * 2) 展开 longtext 后，真正的代码块位于 rich-text 编辑器内部：
 *    .nc-rich-text-content .tiptap.ProseMirror pre > code
 * 3) 顶部工具栏（加粗、斜体、列表、引用等）本身就是 absolute 浮动定位。
 *
 * 二、实现方案
 * ------------------------------------------------------------
 * 这个脚本采用“外部悬浮层 overlay”方案，而不是把按钮插进 <pre><code> 内部。
 *
 * 具体做法：
 * 1) 监听鼠标移动，检测当前鼠标是否位于代码块 <pre> 上；
 * 2) 若命中代码块，则在 .nc-rich-text-content 内创建一个 overlay 容器；
 * 3) 把复制按钮放到 overlay 里，并通过绝对定位移动到对应代码块右上角；
 * 4) 点击按钮时，读取当前绑定代码块的文本并复制到剪贴板。
 *
 * 三、为什么不能直接修改 pre/code 内部 DOM
 * ------------------------------------------------------------
 * NocoDB rich-text 使用的是 ProseMirror 编辑器。
 * ProseMirror 会维护自己的内部文档模型和 DOM 映射。
 *
 * 如果直接往 pre/code 里 append 一个 button，容易导致：
 * - 编辑器状态与 DOM 不一致
 * - 焦点、选区、点击行为异常
 * - 点击按钮后触发关闭弹窗 / 无法展开 / 工具栏异常等副作用
 *
 * 因此本脚本明确遵循：
 * - 不改 .tiptap.ProseMirror 内部 DOM 结构
 * - 不往 pre/code 内插入按钮节点
 * - 只在编辑器外层内容区挂一个 overlay
 *
 * 四、为什么不能给 .nc-rich-text 根节点加 position: relative
 * ------------------------------------------------------------
 * 之前的尝试里，一旦给 .nc-rich-text 加 position: relative，
 * 会改变顶部 bubble toolbar 的定位参照系，导致工具栏布局异常。
 *
 * 所以本脚本只给：
 *   .nc-rich-text-content
 * 加相对定位，不碰 .nc-rich-text 根节点。
 *
 * 五、复制逻辑
 * ------------------------------------------------------------
 * 复制优先级如下：
 * 1) navigator.clipboard.writeText（安全上下文下优先）
 * 2) Tampermonkey 的 GM_setClipboard
 * 3) textarea + document.execCommand('copy') 兜底
 *
 * 六、关闭弹窗问题是如何规避的
 * ------------------------------------------------------------
 * 按钮点击可能被 NocoDB 识别成“点击弹窗外部”，从而关闭编辑弹层。
 * 为避免这一点：
 * 1) 按钮挂在 .nc-rich-text-content 内部，而不是 document.body 上；
 * 2) 对 pointerdown / mousedown / mouseup / click 全部做阻断：
 *    preventDefault + stopPropagation + stopImmediatePropagation
 *
 * 七、适配边界 / 注意事项
 * ------------------------------------------------------------
 * 1) 本脚本依赖当前 NocoDB 页面结构，核心选择器包括：
 *    - .nc-rich-text-content
 *    - .tiptap.ProseMirror
 *    - pre > code
 *
 * 2) 如果 NocoDB 后续升级导致类名、层级或编辑器实现变更，
 *    需要重新调整选择器和定位逻辑。
 *
 * 3) 本脚本当前只对“展开后的 rich-text 编辑区代码块”生效，
 *    不处理表格未展开态，因为未展开态是 canvas，不存在可挂按钮的代码块 DOM。
 *
 * 4) 当前版本已验证目标：
 *    - 不影响 longtext 单元格展开
 *    - 不影响顶部工具栏
 *    - 不影响弹窗留存
 *    - 可以正常复制代码块内容
 *
 * 八、给其他 AI / 后续维护者的快速提示
 * ------------------------------------------------------------
 * 如果以后要改这个脚本，优先遵守以下原则：
 * - 不要修改 ProseMirror 内部 DOM
 * - 不要把按钮 append 到 pre/code 里
 * - 不要给 .nc-rich-text 根节点加定位
 * - 只在 .nc-rich-text-content 上挂 overlay
 * - 按钮点击必须阻断所有指针/鼠标事件冒泡
 *
 * ============================================================
 */

(function () {
  'use strict';

  const STYLE_ID = 'tm-nocodb-code-copy-style-v4';
  const BTN_ID = 'tm-nocodb-code-copy-btn-v4';
  const CONTENT_ROOT_CLASS = 'tm-nocodb-copy-content-root';
  const HOST_CLASS = 'tm-nocodb-copy-overlay-host';

  // 当前激活的代码块 <pre>
  let activePre = null;
  // 当前激活代码块所在的内容区域 .nc-rich-text-content
  let activeContentRoot = null;
  // 全局复用的复制按钮
  let button = null;
  // 按钮当前绑定的代码块，避免 hover 状态丢失后找不到复制目标
  let buttonBoundPre = null;
  // 隐藏按钮的延时定时器
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

      #${BTN_ID} {
        position: absolute;
        display: none;
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
        user-select: none;
        -webkit-user-select: none;
      }

      #${BTN_ID}:hover {
        background: #f5f5f5;
      }

      #${BTN_ID}.tm-copy-success {
        color: #16a34a;
      }

      #${BTN_ID}.tm-copy-failed {
        color: #dc2626;
      }

      #${BTN_ID} svg {
        width: 16px;
        height: 16px;
        display: block;
        margin: auto;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function isElementVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getContentRoot(pre) {
    return pre ? pre.closest('.nc-rich-text-content') : null;
  }

  // 判断某个 pre 是否属于当前 rich-text 编辑器里的真实代码块
  function isEditorCodeBlock(pre) {
    if (!(pre instanceof HTMLElement)) return false;

    const editor = pre.closest('.nc-rich-text-content .tiptap.ProseMirror');
    const contentRoot = getContentRoot(pre);
    const code = pre.querySelector(':scope > code');

    if (!editor || !contentRoot || !code) return false;
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
    if (!pre) return null;
    if (!isEditorCodeBlock(pre)) return null;

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
    } catch (err) {
      console.error('[NocoDB 代码块复制] copy failed:', err);
      return false;
    }
  }

  function createButton() {
    if (button && document.body.contains(button)) return button;

    button = document.createElement('button');
    button.id = BTN_ID;
    button.type = 'button';
    button.setAttribute('aria-label', '复制代码');
    button.setAttribute('title', '复制代码');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H10V7h9z"></path>
      </svg>
    `;

    // 必须强拦截，避免 NocoDB 把点击按钮识别成“点击外部区域”
    const stopEvent = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    };

    button.addEventListener('pointerdown', stopEvent, true);
    button.addEventListener('mousedown', stopEvent, true);
    button.addEventListener('mouseup', stopEvent, true);

    button.addEventListener('click', async (e) => {
      stopEvent(e);

      const targetPre =
        buttonBoundPre && document.contains(buttonBoundPre)
          ? buttonBoundPre
          : activePre && document.contains(activePre)
            ? activePre
            : null;

      if (!targetPre || !isEditorCodeBlock(targetPre)) {
        setButtonState(false);
        return;
      }

      const text = getCodeText(targetPre);
      if (!text) {
        setButtonState(false);
        return;
      }

      const ok = await copyText(text);
      setButtonState(ok);
      positionButton();
    }, true);

    button.addEventListener('mouseenter', () => {
      cancelHide();
    });

    button.addEventListener('mouseleave', () => {
      scheduleHide(150);
    });

    return button;
  }

  // 确保 overlay host 存在于 .nc-rich-text-content 内部
  function ensureOverlayHost(contentRoot) {
    if (!contentRoot) return null;

    contentRoot.classList.add(CONTENT_ROOT_CLASS);

    let host = contentRoot.querySelector(`:scope > .${HOST_CLASS}`);
    if (!host) {
      host = document.createElement('div');
      host.className = HOST_CLASS;
      contentRoot.appendChild(host);
    }

    const btn = createButton();
    if (btn.parentElement !== host) {
      host.appendChild(btn);
    }

    return host;
  }

  function setButtonState(ok) {
    if (!button) return;

    button.classList.remove('tm-copy-success', 'tm-copy-failed');
    button.classList.add(ok ? 'tm-copy-success' : 'tm-copy-failed');
    button.setAttribute('title', ok ? '已复制' : '复制失败');

    window.setTimeout(() => {
      if (!button) return;
      button.classList.remove('tm-copy-success', 'tm-copy-failed');
      button.setAttribute('title', '复制代码');
    }, 1200);
  }

  function showButton() {
    if (!activeContentRoot) return;
    ensureOverlayHost(activeContentRoot);
    if (button) {
      button.style.display = 'block';
    }
  }

  function hideButton(clearActive = false) {
    cancelHide();

    if (button) {
      button.style.display = 'none';
      button.classList.remove('tm-copy-success', 'tm-copy-failed');
      button.setAttribute('title', '复制代码');
    }

    if (clearActive) {
      activePre = null;
      activeContentRoot = null;
      buttonBoundPre = null;
    }
  }

  function cancelHide() {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide(delay = 150) {
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideButton(true);
    }, delay);
  }

  // 将按钮定位到当前代码块右上角
  function positionButton() {
    if (!button || !activePre || !activeContentRoot) {
      hideButton(true);
      return;
    }

    if (
      !document.contains(activePre) ||
      !document.contains(activeContentRoot) ||
      !isEditorCodeBlock(activePre)
    ) {
      hideButton(true);
      return;
    }

    const preRect = activePre.getBoundingClientRect();
    const contentRect = activeContentRoot.getBoundingClientRect();

    const btnWidth = button.offsetWidth || 32;
    const btnHeight = button.offsetHeight || 32;
    const margin = 8;

    let left = preRect.right - contentRect.left - btnWidth - margin;
    let top = preRect.top - contentRect.top + margin;

    const maxLeft = Math.max(8, contentRect.width - btnWidth - 8);
    const maxTop = Math.max(8, contentRect.height - btnHeight - 8);

    left = Math.max(8, Math.min(left, maxLeft));
    top = Math.max(8, Math.min(top, maxTop));

    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
  }

  function activateForPre(pre) {
    if (!pre || !isEditorCodeBlock(pre)) {
      hideButton(true);
      return;
    }

    const contentRoot = getContentRoot(pre);
    if (!contentRoot) {
      hideButton(true);
      return;
    }

    activePre = pre;
    activeContentRoot = contentRoot;
    buttonBoundPre = pre;

    showButton();
    positionButton();
  }

  function handleMouseMove(event) {
    if (button && (event.target === button || button.contains(event.target))) {
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

  function handleScrollOrResize() {
    if (!activePre || !activeContentRoot) return;

    if (
      !document.contains(activePre) ||
      !document.contains(activeContentRoot) ||
      !isEditorCodeBlock(activePre)
    ) {
      hideButton(true);
      return;
    }

    if (button && button.style.display !== 'none') {
      positionButton();
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
        hideButton(true);
        return;
      }

      if (button && button.style.display !== 'none') {
        positionButton();
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
    createButton();
    hideButton(true);

    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize, true);

    observeDom();

    console.log('[NocoDB 代码块复制] ready');
  }

  init();
})();

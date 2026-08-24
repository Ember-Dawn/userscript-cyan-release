// ==UserScript==
// @name         NocoDB Rich Text 大纲
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js
// @version      0.1.3
// @description  为 NocoDB Rich Text 弹窗提供纯 DOM、低侵入的可滚动 TOC 大纲与标题定位
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// ==/UserScript==

/*
 * =============================================================================
 * NocoDB Rich Text 大纲 v0.1：纯 DOM 旁路实现
 * =============================================================================
 *
 * 核心边界：
 * - 不读取 editor.editor / EditorState / ProseMirror view；
 * - 不注册 ProseMirror plugin；
 * - 不 dispatch transaction，不读写 ProseMirror selection；仅在用户明确导航时同步原生 DOM caret；
 * - 不向 .ProseMirror 正文节点写入 data-*、class、child DOM；
 * - TOC 只读取最终 DOM 中的 h1~h6，并只写自己的面板、按钮与 scrollTop；
 * - MutationObserver / scroll 热路径只做轻量判定与调度，真正扫描和测量延后执行。
 *
 * 保留的主要交互：
 * - 默认打开的左侧 TOC；H1~H6 分层缩进；标题数量；当前标题高亮；
 * - 点击目录跳转；刷新；跳到顶部 / 底部；
 * - TOC 宽度拖拽，双击恢复默认宽度；
 * - 正文滚动停止后更新 active；TOC 安全区纠偏；手动浏览保护；
 * - 中文输入法 composition 期间暂停目录刷新。
 *
 * 详细技术路线见同目录 nocodb-richtext-outline.md。
 * =============================================================================
 */

(function () {
  'use strict';

  const CONFIG = {
    primaryRootSelector: '.nc-long-text-expanded-modal .expanded-cell-input',
    fallbackRootSelector: '.ant-modal-content .expanded-cell-input',
    contentWrapSelector: '.nc-rich-text-content',
    editorSelector: '.nc-rich-text-content .tiptap.ProseMirror',
    titleTextContainerSelector: '.flex.max-w-38, .max-w-38',
    headingSelector: 'h1, h2, h3, h4, h5, h6',
    panelWidth: 200,
    panelMinWidth: 132,
    panelMaxWidth: 360,
    panelResizeHandleWidth: 8,
    panelLeftInset: 13,
    contentInsetExtra: -6,
    panelInsetY: 1,
    panelBottomGap: 2,
    buttonGap: 8,
    anchorTop: 9,
    defaultOpen: true,
    initialBuildDelayMs: 120,
    headingCheckDelayMs: 360,
    compositionRefreshDelayMs: 420,
    geometryRefreshDelayMs: 650,
    scrollQuietStage1Ms: 420,
    scrollQuietStage2Ms: 180,
    scrollAnchorTop: 18,
    ensureVisibleSafePadding: 24,
    ensureVisibleDelayMs: 120,
    tocManualBrowseIdleMs: 5000,
  };

  const CLASS = {
    rootReady: 'tm-rtoc-root-v1',
    rootOpen: 'tm-rtoc-open-v1',
    resizing: 'tm-rtoc-resizing-v1',
    button: 'tm-rtoc-button-v1',
    buttonReady: 'is-ready',
    buttonActive: 'is-active',
    panel: 'tm-rtoc-panel-v1',
    panelVisible: 'is-visible',
    resizer: 'tm-rtoc-resizer-v1',
    list: 'tm-rtoc-list-v1',
    item: 'tm-rtoc-item-v1',
    itemActive: 'is-active',
    status: 'tm-rtoc-status-v1',
  };

  const STYLE_ID = 'tm-rtoc-style-v1';
  const states = new Map();
  let activeState = null;
  let globalObserver = null;
  let discoveryFrame = 0;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CLASS.rootReady} {
        position: relative !important;
        overflow: visible !important;
        --tm-rtoc-panel-width: ${CONFIG.panelWidth}px;
        --tm-rtoc-left-inset: ${getContentInsetForPanelWidth(CONFIG.panelWidth)}px;
      }

      .${CLASS.rootOpen} .nc-rich-text-content .tiptap.ProseMirror {
        padding-left: var(--tm-rtoc-left-inset) !important;
        box-sizing: border-box !important;
      }

      .${CLASS.button} {
        position: absolute;
        z-index: 30;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 42px;
        height: 30px;
        padding: 0 10px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: .2px;
        pointer-events: auto;
        visibility: hidden;
        opacity: 0;
        transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
      }

      .${CLASS.button}.${CLASS.buttonReady} {
        visibility: visible;
        opacity: 1;
      }

      .${CLASS.button}.${CLASS.buttonActive} {
        background: rgba(59, 130, 246, 0.12);
        color: #1d4ed8;
      }

      .${CLASS.panel} {
        position: absolute;
        z-index: 25;
        left: ${CONFIG.panelLeftInset}px;
        display: none;
        width: calc(var(--tm-rtoc-panel-width) - ${CONFIG.panelLeftInset}px);
        min-width: calc(var(--tm-rtoc-panel-width) - ${CONFIG.panelLeftInset}px);
        max-width: calc(var(--tm-rtoc-panel-width) - ${CONFIG.panelLeftInset}px);
        box-sizing: border-box;
        border: 0;
        border-right: 1px solid rgba(15, 23, 42, 0.10);
        border-radius: 8px 0 0 8px;
        background: var(--nc-bg-default, #fff);
        box-shadow: none;
        overflow: hidden;
      }

      .${CLASS.panel}.${CLASS.panelVisible} {
        display: block;
      }

      .tm-rtoc-panel-inner-v1 {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .tm-rtoc-title-v1 {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 42px;
        padding: 7px 8px 7px 10px;
        color: #374151;
        background: transparent;
        border-bottom: 1px solid rgba(15, 23, 42, 0.055);
      }

      .tm-rtoc-title-count-v1 {
        display: inline-flex;
        align-items: baseline;
        gap: 5px;
        min-width: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #4b5563;
        font-size: 12px;
        font-weight: 650;
        line-height: 1;
        white-space: nowrap;
      }

      .tm-rtoc-title-label-v1 {
        color: #374151;
        letter-spacing: .15px;
      }

      .tm-rtoc-title-number-v1 {
        color: #6b7280;
        font-variant-numeric: tabular-nums;
      }

      .tm-rtoc-title-actions-v1 {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .tm-rtoc-icon-btn-v1 {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 1px solid rgba(15, 23, 42, 0.10);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.72);
        color: #4b5563;
        box-shadow: 0 1px 1px rgba(15, 23, 42, 0.025);
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
      }

      .tm-rtoc-icon-btn-v1:hover {
        background: rgba(59, 130, 246, 0.075);
        border-color: rgba(59, 130, 246, 0.24);
        color: #3158a8;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      }

      .tm-rtoc-icon-btn-v1:active {
        background: rgba(59, 130, 246, 0.12);
        transform: translateY(1px);
      }

      .tm-rtoc-icon-btn-v1 svg {
        width: 15px;
        height: 15px;
        display: block;
        pointer-events: none;
      }

      .${CLASS.status} {
        display: none;
        flex: 0 0 auto;
        padding: 7px 8px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
        background: rgba(245, 158, 11, 0.10);
        color: #8b5e00;
        font-size: 12px;
        line-height: 1.45;
      }

      .${CLASS.list} {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding: 6px;
      }

      .tm-rtoc-empty-v1 {
        padding: 6px;
        color: #666;
        font-size: 12px;
        line-height: 1.5;
      }

      .${CLASS.item} {
        display: block;
        width: 100%;
        margin: 0 0 2px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #222;
        cursor: pointer;
        font-size: 13px;
        line-height: 1.35;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .${CLASS.item}:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      .${CLASS.item}.${CLASS.itemActive} {
        background: rgba(59, 130, 246, 0.16);
        color: #1d4ed8;
      }

      .tm-rtoc-l1-v1 { padding: 6px 8px;  font-weight: 700; }
      .tm-rtoc-l2-v1 { padding: 6px 8px 6px 16px; font-weight: 600; }
      .tm-rtoc-l3-v1 { padding: 6px 8px 6px 24px; }
      .tm-rtoc-l4-v1 { padding: 6px 8px 6px 32px; }
      .tm-rtoc-l5-v1 { padding: 6px 8px 6px 40px; }
      .tm-rtoc-l6-v1 { padding: 6px 8px 6px 48px; }

      .${CLASS.resizer} {
        position: absolute;
        z-index: 4;
        top: 0;
        right: 0;
        bottom: 0;
        width: ${CONFIG.panelResizeHandleWidth}px;
        cursor: ew-resize;
        touch-action: none;
        background: transparent;
      }

      .${CLASS.resizer}::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 1px;
        background: transparent;
        transition: width 120ms ease, background 120ms ease;
      }

      .${CLASS.resizer}:hover::after,
      .${CLASS.rootReady}.${CLASS.resizing} .${CLASS.resizer}::after {
        width: 2px;
        background: rgba(59, 130, 246, 0.42);
      }

      .${CLASS.rootReady}.${CLASS.resizing},
      .${CLASS.rootReady}.${CLASS.resizing} * {
        cursor: ew-resize !important;
        user-select: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function stopAll(event) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  }

  function stopBubbleOnly(event) {
    if (event) event.stopPropagation();
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    let current = element;
    while (current instanceof HTMLElement && current !== document.body) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (current.getAttribute('aria-hidden') === 'true') return false;
      current = current.parentElement;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getTitleBar(root) {
    if (!(root instanceof HTMLElement)) return null;
    return root.querySelector(':scope > .cursor-move') || root.firstElementChild;
  }

  function getTitleTextBox(titleBar) {
    if (!(titleBar instanceof HTMLElement)) return null;
    const direct = titleBar.querySelector(CONFIG.titleTextContainerSelector);
    if (direct instanceof HTMLElement) return direct;
    const truncate = titleBar.querySelector('.truncate');
    return truncate instanceof HTMLElement && truncate.parentElement instanceof HTMLElement ? truncate.parentElement : null;
  }

  function isScrollableElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const overflowY = style.overflowY || style.overflow;
    if (!/(auto|scroll|overlay)/.test(overflowY)) return false;
    return element.scrollHeight - element.clientHeight > 2;
  }

  function detectScrollContainer(editor, contentWrap, root) {
    const candidates = [];
    const seen = new Set();
    if (editor instanceof HTMLElement) candidates.push(editor);
    if (contentWrap instanceof HTMLElement) candidates.push(contentWrap);

    let current = editor instanceof HTMLElement ? editor.parentElement : null;
    while (current instanceof HTMLElement && current !== root) {
      candidates.push(current);
      current = current.parentElement;
    }
    if (root instanceof HTMLElement) candidates.push(root);

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement) || seen.has(candidate)) continue;
      seen.add(candidate);
      if (isScrollableElement(candidate)) return candidate;
    }
    return contentWrap instanceof HTMLElement ? contentWrap : editor;
  }

  function collectRefs(root) {
    if (!(root instanceof HTMLElement) || !root.isConnected) return null;
    const titleBar = getTitleBar(root);
    const titleTextBox = getTitleTextBox(titleBar);
    const contentWrap = root.querySelector(CONFIG.contentWrapSelector);
    const editor = root.querySelector(CONFIG.editorSelector);
    if (!(titleBar instanceof HTMLElement) || !(titleTextBox instanceof HTMLElement)) return null;
    if (!(contentWrap instanceof HTMLElement) || !(editor instanceof HTMLElement)) return null;
    const scrollContainer = detectScrollContainer(editor, contentWrap, root);
    if (!(scrollContainer instanceof HTMLElement)) return null;
    return { root, titleBar, titleTextBox, contentWrap, editor, scrollContainer };
  }

  function getRootCandidates() {
    const unique = new Set();
    const result = [];
    const appendMatches = (selector) => {
      document.querySelectorAll(selector).forEach((root) => {
        if (!(root instanceof HTMLElement) || unique.has(root)) return;
        unique.add(root);
        result.push(root);
      });
    };
    appendMatches(CONFIG.primaryRootSelector);
    if (!result.length) appendMatches(CONFIG.fallbackRootSelector);
    return result;
  }

  function findActiveRoot() {
    const roots = getRootCandidates().filter((root) => isVisible(root) && collectRefs(root));
    return roots.length ? roots[roots.length - 1] : null;
  }

  function normalizeHeadingText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function getHeadingLevel(element) {
    const tag = element instanceof HTMLElement ? element.tagName.toUpperCase() : 'H1';
    const level = Number.parseInt(tag.slice(1), 10);
    return Number.isFinite(level) ? Math.max(1, Math.min(6, level)) : 1;
  }

  function getLiveHeadingElements(editor) {
    if (!(editor instanceof HTMLElement)) return [];
    return Array.from(editor.querySelectorAll(CONFIG.headingSelector)).filter((element) => {
      return element instanceof HTMLElement && normalizeHeadingText(element.textContent).length > 0;
    });
  }

  function buildHeadingSignature(elements) {
    return elements.map((element) => {
      const level = getHeadingLevel(element);
      const text = normalizeHeadingText(element.textContent);
      return `${level}:${text.length}:${text}`;
    }).join('\n');
  }

  function getOffsetTopWithinAncestor(element, ancestor) {
    let top = 0;
    let current = element;
    while (current instanceof HTMLElement && current !== ancestor) {
      top += current.offsetTop;
      current = current.offsetParent;
    }
    return current === ancestor ? top : null;
  }

  function getHeadingTopWithinScroller(element, scroller) {
    if (!(element instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return 0;
    let top = getOffsetTopWithinAncestor(element, scroller);
    if (top == null) {
      const headingRect = element.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      top = scroller.scrollTop + (headingRect.top - scrollerRect.top);
    }
    return Math.max(0, Math.round(Number(top) || 0));
  }

  function buildSnapshot(state) {
    if (!state || state.destroyed || !(state.editor instanceof HTMLElement)) return false;
    if (!state.editor.isConnected) return false;
    const elements = getLiveHeadingElements(state.editor);
    state.headings = elements.map((element) => ({
      element,
      level: getHeadingLevel(element),
      text: normalizeHeadingText(element.textContent),
      top: getHeadingTopWithinScroller(element, state.scrollContainer),
    }));
    state.headingSignature = buildHeadingSignature(elements);
    if (state.activeIndex >= state.headings.length) state.activeIndex = -1;
    renderToc(state);
    clearStatus(state);
    return true;
  }

  function refreshHeadingGeometry(state) {
    if (!state || state.destroyed || !Array.isArray(state.headings)) return;
    if (!(state.editor instanceof HTMLElement) || !(state.scrollContainer instanceof HTMLElement)) return;
    let invalid = false;
    for (const heading of state.headings) {
      if (!(heading.element instanceof HTMLElement) || !heading.element.isConnected || !state.editor.contains(heading.element)) {
        invalid = true;
        break;
      }
      heading.top = getHeadingTopWithinScroller(heading.element, state.scrollContainer);
    }
    if (invalid) {
      buildSnapshot(state);
      return;
    }
    commitActiveFromScroll(state, false);
  }

  function renderToc(state) {
    if (!(state && state.list instanceof HTMLElement)) return;
    state.list.textContent = '';
    if (!state.headings.length) {
      const empty = document.createElement('div');
      empty.className = 'tm-rtoc-empty-v1';
      empty.textContent = 'No headings';
      state.list.appendChild(empty);
      updateCount(state);
      return;
    }

    state.headings.forEach((heading, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${CLASS.item} tm-rtoc-l${heading.level}-v1`;
      button.textContent = heading.text;
      button.title = heading.text;
      button.dataset.index = String(index);
      if (index === state.activeIndex) button.classList.add(CLASS.itemActive);
      attachActionButton(button, () => jumpToHeading(state, index, heading.text, heading.level));
      state.list.appendChild(button);
    });
    updateCount(state);
  }

  function updateCount(state) {
    if (state && state.count instanceof HTMLElement) {
      const number = state.count.querySelector('.tm-rtoc-title-number-v1');
      if (number instanceof HTMLElement) number.textContent = String(state.headings.length || 0);
    }
  }

  function setStatus(state, text) {
    if (!(state && state.status instanceof HTMLElement)) return;
    state.status.textContent = text || '';
    state.status.style.display = text ? 'block' : 'none';
  }

  function clearStatus(state) {
    setStatus(state, '');
  }

  function attachActionButton(button, handler) {
    if (!(button instanceof HTMLElement)) return;
    button.addEventListener('pointerdown', stopAll, true);
    button.addEventListener('mousedown', stopAll, true);
    button.addEventListener('mouseup', stopAll, true);
    button.addEventListener('click', (event) => {
      stopAll(event);
      handler();
    }, true);
  }

  function makeIconButton(action, title, svg) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tm-rtoc-icon-btn-v1';
    button.dataset.action = action;
    button.setAttribute('aria-label', title);
    button.setAttribute('title', title);
    button.innerHTML = svg;
    return button;
  }

  function mountButton(state) {
    if (!state || state.destroyed || !(state.root instanceof HTMLElement)) return;
    if (state.button instanceof HTMLElement && state.button.isConnected) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ant-btn ant-btn-text small theme-default bordered nc-btn-shadow nc-button ${CLASS.button}`;
    button.textContent = 'TOC';
    button.setAttribute('aria-label', '切换 TOC');
    button.setAttribute('title', '切换 TOC');
    attachActionButton(button, () => togglePanel(state, !state.open));
    state.root.appendChild(button);
    state.button = button;
  }

  function mountPanel(state) {
    if (!state || state.destroyed || !(state.root instanceof HTMLElement)) return;
    if (state.panel instanceof HTMLElement && state.panel.isConnected) return;

    const panel = document.createElement('div');
    panel.className = CLASS.panel;
    panel.innerHTML = `
      <div class="tm-rtoc-panel-inner-v1">
        <div class="tm-rtoc-title-v1">
          <span class="tm-rtoc-title-count-v1"><span class="tm-rtoc-title-label-v1">TOC</span><span class="tm-rtoc-title-number-v1">0</span></span>
          <div class="tm-rtoc-title-actions-v1"></div>
        </div>
        <div class="${CLASS.status}"></div>
        <div class="${CLASS.list}"></div>
      </div>
      <div class="${CLASS.resizer}" title="拖动调整目录宽度；双击恢复默认宽度" aria-hidden="true"></div>
    `;
    panel.addEventListener('click', stopBubbleOnly, false);
    panel.addEventListener('pointerdown', stopBubbleOnly, false);
    panel.addEventListener('mousedown', stopBubbleOnly, false);
    panel.addEventListener('mouseup', stopBubbleOnly, false);

    state.root.appendChild(panel);
    state.panel = panel;
    state.count = panel.querySelector('.tm-rtoc-title-count-v1');
    state.status = panel.querySelector(`.${CLASS.status}`);
    state.list = panel.querySelector(`.${CLASS.list}`);
    state.resizer = panel.querySelector(`.${CLASS.resizer}`);

    const actions = panel.querySelector('.tm-rtoc-title-actions-v1');
    const topButton = makeIconButton('top', '跳到顶部', `
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M4 3.25h10" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
        <path d="M9 14V6.1" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
        <path d="m5.9 9.15 3.1-3.1 3.1 3.1" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>`);
    const bottomButton = makeIconButton('bottom', '跳到底部', `
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M4 14.75h10" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
        <path d="M9 4v7.9" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
        <path d="m5.9 8.85 3.1 3.1 3.1-3.1" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>`);
    const refreshButton = makeIconButton('refresh', '刷新目录', `
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M14.55 6.6A6 6 0 1 0 14.6 11" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
        <path d="M14.55 3.8v2.95H11.6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>`);

    attachActionButton(topButton, () => scrollContainerTo(state, 'top'));
    attachActionButton(bottomButton, () => scrollContainerTo(state, 'bottom'));
    attachActionButton(refreshButton, () => {
      buildSnapshot(state);
      commitActiveFromScroll(state, true);
      positionPanel(state);
    });
    actions.append(refreshButton, bottomButton, topButton);

    if (state.resizer instanceof HTMLElement) {
      state.resizer.addEventListener('pointerdown', (event) => startPanelResize(state, event), true);
      state.resizer.addEventListener('dblclick', (event) => {
        stopAll(event);
        stopPanelResize(state, false);
        applyPanelWidth(state, CONFIG.panelWidth);
        positionUI(state);
        scheduleGeometryRefresh(state, 60);
      }, true);
    }

    if (state.list instanceof HTMLElement) {
      state.list.addEventListener('wheel', () => enterManualTocBrowsing(state), { passive: true });
      state.list.addEventListener('scroll', () => {
        if (Date.now() <= state.listProgrammaticScrollUntil) return;
        enterManualTocBrowsing(state);
      }, { passive: true });
    }
  }

  function positionButton(state) {
    if (!(state && state.button instanceof HTMLElement) || !(state.titleTextBox instanceof HTMLElement)) return;
    const buttonWidth = state.button.offsetWidth || 42;
    const buttonHeight = state.button.offsetHeight || 30;
    if (state.titleBar.offsetHeight <= 0 || state.titleTextBox.offsetWidth <= 0) {
      state.button.classList.remove(CLASS.buttonReady);
      return;
    }
    const rawLeft = Math.round(state.titleTextBox.offsetLeft + state.titleTextBox.offsetWidth + CONFIG.buttonGap);
    const rawTop = Math.round(state.titleBar.offsetTop + (state.titleBar.offsetHeight - buttonHeight) / 2);
    const maxLeft = Math.max(8, state.root.clientWidth - buttonWidth - 8);
    state.button.style.left = `${Math.max(8, Math.min(rawLeft, maxLeft))}px`;
    state.button.style.top = `${Math.max(8, rawTop)}px`;
    state.button.classList.add(CLASS.buttonReady);
  }

  function positionPanel(state) {
    if (!(state && state.panel instanceof HTMLElement) || !(state.contentWrap instanceof HTMLElement)) return;
    const top = Math.round(state.contentWrap.offsetTop + CONFIG.panelInsetY);
    const height = Math.max(220, Math.round(state.contentWrap.offsetHeight - CONFIG.panelInsetY - CONFIG.panelBottomGap));
    state.panel.style.top = `${top}px`;
    state.panel.style.height = `${height}px`;
  }

  function positionUI(state) {
    if (!state || state.destroyed) return;
    positionButton(state);
    if (state.open) positionPanel(state);
  }

  function getContentInsetForPanelWidth(width) {
    return Math.max(0, Math.round((Number(width) || CONFIG.panelWidth) + CONFIG.contentInsetExtra));
  }

  function getPanelWidthBounds(state) {
    const min = Math.max(96, CONFIG.panelMinWidth);
    let max = Math.max(min, CONFIG.panelMaxWidth);
    if (state && state.root instanceof HTMLElement) {
      max = Math.min(max, Math.max(min, Math.round(state.root.clientWidth - 120)));
    }
    return { min, max };
  }

  function clampPanelWidth(state, width) {
    const bounds = getPanelWidthBounds(state);
    const value = Number.isFinite(Number(width)) ? Number(width) : CONFIG.panelWidth;
    return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)));
  }

  function applyPanelWidth(state, width) {
    if (!state || !(state.root instanceof HTMLElement)) return;
    state.panelWidth = clampPanelWidth(state, width);
    state.root.style.setProperty('--tm-rtoc-panel-width', `${state.panelWidth}px`);
    state.root.style.setProperty('--tm-rtoc-left-inset', `${getContentInsetForPanelWidth(state.panelWidth)}px`);
  }

  function startPanelResize(state, event) {
    if (!state || state.destroyed || !state.open || !(state.resizer instanceof HTMLElement)) return;
    const startX = Number(event.clientX);
    if (!Number.isFinite(startX)) return;
    stopAll(event);
    stopPanelResize(state, false);
    state.resizeDragging = true;
    state.resizeStartX = startX;
    state.resizeStartWidth = state.panelWidth;
    state.root.classList.add(CLASS.resizing);

    state.onResizeMove = (moveEvent) => {
      if (!state.resizeDragging) return;
      const x = Number(moveEvent.clientX);
      if (!Number.isFinite(x)) return;
      moveEvent.preventDefault();
      const nextWidth = state.resizeStartWidth + (x - state.resizeStartX);
      state.pendingPanelWidth = nextWidth;
      if (state.resizeFrame) return;
      state.resizeFrame = requestAnimationFrame(() => {
        state.resizeFrame = 0;
        applyPanelWidth(state, state.pendingPanelWidth);
        positionPanel(state);
      });
    };

    state.onResizeEnd = (endEvent) => {
      if (endEvent) endEvent.preventDefault();
      stopPanelResize(state, true);
    };

    document.addEventListener('pointermove', state.onResizeMove, true);
    document.addEventListener('pointerup', state.onResizeEnd, true);
    document.addEventListener('pointercancel', state.onResizeEnd, true);
  }

  function stopPanelResize(state, finalize) {
    if (!state) return;
    if (state.onResizeMove) document.removeEventListener('pointermove', state.onResizeMove, true);
    if (state.onResizeEnd) {
      document.removeEventListener('pointerup', state.onResizeEnd, true);
      document.removeEventListener('pointercancel', state.onResizeEnd, true);
    }
    state.onResizeMove = null;
    state.onResizeEnd = null;
    state.resizeDragging = false;
    state.root?.classList.remove(CLASS.resizing);
    if (state.resizeFrame) {
      cancelAnimationFrame(state.resizeFrame);
      state.resizeFrame = 0;
    }
    if (finalize) {
      applyPanelWidth(state, state.pendingPanelWidth || state.panelWidth);
      positionUI(state);
      scheduleGeometryRefresh(state, 80);
    }
  }

  function setActiveItem(state, index) {
    if (!state || state.destroyed) return;
    state.activeIndex = Number.isInteger(index) ? index : -1;
    if (!(state.list instanceof HTMLElement)) return;
    state.list.querySelectorAll(`.${CLASS.item}`).forEach((item, itemIndex) => {
      if (item instanceof HTMLElement) item.classList.toggle(CLASS.itemActive, itemIndex === state.activeIndex);
    });
  }

  function findActiveIndexByScrollTop(state) {
    if (!state || !state.headings.length) return -1;
    const anchor = Math.max(0, state.scrollContainer.scrollTop) + CONFIG.scrollAnchorTop;
    let low = 0;
    let high = state.headings.length - 1;
    let answer = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (state.headings[middle].top <= anchor) {
        answer = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return answer;
  }

  function commitActiveFromScroll(state, ensureVisible) {
    if (!state || state.destroyed || !state.open || !state.headings.length) return;
    if (!(state.scrollContainer instanceof HTMLElement) || !state.scrollContainer.isConnected) return;
    const index = findActiveIndexByScrollTop(state);
    if (index < 0) return;
    setActiveItem(state, index);
    if (ensureVisible) scheduleEnsureActiveItemVisible(state, true);
  }

  function scheduleScrollStopCheck(state) {
    if (!state || state.destroyed || !state.open) return;
    clearScrollTimers(state);
    state.pendingScrollTop = state.scrollContainer.scrollTop;
    state.scrollTimer1 = window.setTimeout(() => {
      state.scrollTimer1 = 0;
      if (!state || state.destroyed || !state.open) return;
      const firstTop = state.scrollContainer.scrollTop;
      if (Math.abs(firstTop - state.pendingScrollTop) > 1) {
        scheduleScrollStopCheck(state);
        return;
      }
      state.pendingScrollTop = firstTop;
      state.scrollTimer2 = window.setTimeout(() => {
        state.scrollTimer2 = 0;
        if (!state || state.destroyed || !state.open) return;
        const secondTop = state.scrollContainer.scrollTop;
        if (Math.abs(secondTop - state.pendingScrollTop) > 1) {
          scheduleScrollStopCheck(state);
          return;
        }
        if (state.manualTocBrowsing) exitManualTocBrowsing(state, false);
        commitActiveFromScroll(state, true);
      }, CONFIG.scrollQuietStage2Ms);
    }, CONFIG.scrollQuietStage1Ms);
  }

  function clearScrollTimers(state) {
    if (!state) return;
    if (state.scrollTimer1) window.clearTimeout(state.scrollTimer1);
    if (state.scrollTimer2) window.clearTimeout(state.scrollTimer2);
    state.scrollTimer1 = 0;
    state.scrollTimer2 = 0;
  }

  function scheduleEnsureActiveItemVisible(state, force, delay = CONFIG.ensureVisibleDelayMs) {
    if (!state || state.destroyed || !state.open || state.manualTocBrowsing) return;
    if (state.ensureVisibleTimer) window.clearTimeout(state.ensureVisibleTimer);
    state.ensureVisibleTimer = window.setTimeout(() => {
      state.ensureVisibleTimer = 0;
      if (!state || state.destroyed || !state.open || state.manualTocBrowsing) return;
      ensureActiveItemVisible(state, force);
    }, delay);
  }

  function ensureActiveItemVisible(state, force) {
    if (!(state.list instanceof HTMLElement) || state.activeIndex < 0) return;
    const item = state.list.querySelector(`.${CLASS.item}[data-index="${state.activeIndex}"]`);
    if (!(item instanceof HTMLElement)) return;
    const pad = CONFIG.ensureVisibleSafePadding;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    const viewTop = state.list.scrollTop;
    const viewBottom = viewTop + state.list.clientHeight;
    const safeTop = viewTop + pad;
    const safeBottom = viewBottom - pad;
    if (!force && itemTop >= safeTop && itemBottom <= safeBottom) return;

    let target = viewTop;
    if (itemTop < safeTop) target = itemTop - pad;
    else if (itemBottom > safeBottom) target = itemBottom - state.list.clientHeight + pad;
    const maxScrollTop = Math.max(0, state.list.scrollHeight - state.list.clientHeight);
    if (state.activeIndex === 0) target = 0;
    else if (state.activeIndex === state.headings.length - 1) target = maxScrollTop;
    target = Math.max(0, Math.min(maxScrollTop, Math.round(target)));
    if (Math.abs(target - state.list.scrollTop) > 1) {
      state.listProgrammaticScrollUntil = Date.now() + 260;
      state.list.scrollTop = target;
    }
  }

  function enterManualTocBrowsing(state) {
    if (!state || state.destroyed || !state.open) return;
    state.manualTocBrowsing = true;
    if (state.ensureVisibleTimer) window.clearTimeout(state.ensureVisibleTimer);
    if (state.manualBrowseTimer) window.clearTimeout(state.manualBrowseTimer);
    state.manualBrowseTimer = window.setTimeout(() => exitManualTocBrowsing(state, true), CONFIG.tocManualBrowseIdleMs);
  }

  function exitManualTocBrowsing(state, ensureVisible) {
    if (!state) return;
    if (state.manualBrowseTimer) window.clearTimeout(state.manualBrowseTimer);
    state.manualBrowseTimer = 0;
    state.manualTocBrowsing = false;
    if (ensureVisible) scheduleEnsureActiveItemVisible(state, true, 140);
  }

  function resolveHeadingForJump(state, index, text, level) {
    let heading = state.headings[index];
    if (heading && heading.element.isConnected && state.editor.contains(heading.element)) return { heading, index };
    if (!buildSnapshot(state)) return { heading: null, index: -1 };
    heading = state.headings[index];
    if (heading && heading.text === text && heading.level === level) return { heading, index };
    const matches = [];
    state.headings.forEach((candidate, candidateIndex) => {
      if (candidate.text === text && candidate.level === level) matches.push({ heading: candidate, index: candidateIndex });
    });
    if (matches.length) {
      matches.sort((a, b) => Math.abs(a.index - index) - Math.abs(b.index - index));
      return matches[0];
    }
    return { heading: state.headings[index] || null, index: state.headings[index] ? index : -1 };
  }

  function focusEditorWithoutScrolling(state) {
    if (!state || !(state.editor instanceof HTMLElement) || !state.editor.isConnected) return false;
    if (document.activeElement === state.editor) return true;
    try {
      state.editor.focus({ preventScroll: true });
    } catch (_) {
      state.editor.focus();
    }
    return document.activeElement === state.editor;
  }

  function setNativeCaret(state, target, atEnd = false) {
    if (!state || state.destroyed || !(state.editor instanceof HTMLElement)) return false;
    if (!(target instanceof HTMLElement) || !target.isConnected || !state.editor.contains(target)) return false;
    if (target.closest('[contenteditable="false"]')) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    try {
      focusEditorWithoutScrolling(state);
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(!atEnd);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (_) {
      return false;
    }
  }

  function findBoundaryCaretTarget(editor, where) {
    if (!(editor instanceof HTMLElement)) return null;
    const children = Array.from(editor.children).filter((element) => {
      return element instanceof HTMLElement && !element.closest('[contenteditable="false"]');
    });
    if (!children.length) return editor;
    return where === 'bottom' ? children[children.length - 1] : children[0];
  }

  function jumpToHeading(state, index, text, level) {
    if (!state || state.destroyed) return;
    exitManualTocBrowsing(state, false);
    const resolved = resolveHeadingForJump(state, index, text, level);
    if (!resolved.heading || !(resolved.heading.element instanceof HTMLElement)) {
      setStatus(state, '目录已变化，请刷新后重试。');
      return;
    }
    const top = getHeadingTopWithinScroller(resolved.heading.element, state.scrollContainer);
    state.scrollContainer.scrollTop = Math.max(0, Math.round(top - CONFIG.anchorTop));
    setNativeCaret(state, resolved.heading.element, false);
    setActiveItem(state, resolved.index);
    scheduleEnsureActiveItemVisible(state, true, 80);
    clearStatus(state);
    clearScrollTimers(state);
  }

  function scrollContainerTo(state, where) {
    if (!state || state.destroyed || !(state.scrollContainer instanceof HTMLElement)) return;
    exitManualTocBrowsing(state, false);
    const normalizedWhere = where === 'bottom' ? 'bottom' : 'top';
    if (normalizedWhere === 'top') state.scrollContainer.scrollTop = 0;
    else state.scrollContainer.scrollTop = Math.max(0, state.scrollContainer.scrollHeight - state.scrollContainer.clientHeight);
    const target = findBoundaryCaretTarget(state.editor, normalizedWhere);
    if (target instanceof HTMLElement) setNativeCaret(state, target, normalizedWhere === 'bottom');
    scheduleScrollStopCheck(state);
  }

  function nodeOrAncestorHeading(node, editor) {
    let current = node instanceof Node ? node : null;
    while (current) {
      if (current instanceof HTMLElement && current.matches(CONFIG.headingSelector)) return current;
      if (current === editor) break;
      current = current.parentNode;
    }
    return null;
  }

  function nodeTouchesHeading(node, editor) {
    if (!(node instanceof Node)) return false;
    if (nodeOrAncestorHeading(node, editor)) return true;
    if (node instanceof Element) {
      if (node.matches(CONFIG.headingSelector)) return true;
      return Boolean(node.querySelector(CONFIG.headingSelector));
    }
    return false;
  }

  function mutationMayAffectHeadingContent(mutation, editor) {
    if (mutation.type === 'characterData') return Boolean(nodeOrAncestorHeading(mutation.target, editor));
    if (mutation.type !== 'childList') return false;
    if (nodeTouchesHeading(mutation.target, editor)) return true;
    for (const node of mutation.addedNodes) if (nodeTouchesHeading(node, editor)) return true;
    for (const node of mutation.removedNodes) if (nodeTouchesHeading(node, editor)) return true;
    return false;
  }

  function scheduleHeadingCheck(state, delay = CONFIG.headingCheckDelayMs) {
    if (!state || state.destroyed || !state.open) return;
    if (state.isComposing) {
      state.pendingHeadingCheck = true;
      return;
    }
    if (state.headingCheckTimer) window.clearTimeout(state.headingCheckTimer);
    state.headingCheckTimer = window.setTimeout(() => {
      state.headingCheckTimer = 0;
      if (!state || state.destroyed || !state.open || state.isComposing) return;
      const elements = getLiveHeadingElements(state.editor);
      const signature = buildHeadingSignature(elements);
      if (signature !== state.headingSignature) {
        buildSnapshot(state);
        commitActiveFromScroll(state, false);
        scheduleEnsureActiveItemVisible(state, false);
      } else {
        refreshHeadingGeometry(state);
      }
    }, delay);
  }

  function scheduleGeometryRefresh(state, delay = CONFIG.geometryRefreshDelayMs) {
    if (!state || state.destroyed || !state.open) return;
    if (state.isComposing) {
      state.pendingGeometryRefresh = true;
      return;
    }
    if (state.geometryTimer) window.clearTimeout(state.geometryTimer);
    state.geometryTimer = window.setTimeout(() => {
      state.geometryTimer = 0;
      if (!state || state.destroyed || !state.open || state.isComposing) return;
      refreshHeadingGeometry(state);
    }, delay);
  }

  function bindEditorRuntime(state) {
    if (!state || state.destroyed || state.runtimeBound) return;
    state.onScroll = () => scheduleScrollStopCheck(state);
    state.onCompositionStart = () => {
      state.isComposing = true;
      if (state.headingCheckTimer) window.clearTimeout(state.headingCheckTimer);
      if (state.geometryTimer) window.clearTimeout(state.geometryTimer);
      state.headingCheckTimer = 0;
      state.geometryTimer = 0;
    };
    state.onCompositionEnd = () => {
      state.isComposing = false;
      if (state.pendingHeadingCheck) {
        state.pendingHeadingCheck = false;
        scheduleHeadingCheck(state, CONFIG.compositionRefreshDelayMs);
      }
      if (state.pendingGeometryRefresh) {
        state.pendingGeometryRefresh = false;
        scheduleGeometryRefresh(state, CONFIG.compositionRefreshDelayMs);
      }
    };

    state.scrollContainer.addEventListener('scroll', state.onScroll, { passive: true });
    state.editor.addEventListener('compositionstart', state.onCompositionStart, false);
    state.editor.addEventListener('compositionend', state.onCompositionEnd, false);

    state.editorObserver = new MutationObserver((mutations) => {
      if (!state || state.destroyed || !state.open) return;
      let headingRelevant = false;
      for (const mutation of mutations) {
        if (mutationMayAffectHeadingContent(mutation, state.editor)) {
          headingRelevant = true;
          break;
        }
      }
      if (state.isComposing) {
        if (headingRelevant) state.pendingHeadingCheck = true;
        state.pendingGeometryRefresh = true;
        return;
      }
      if (headingRelevant) scheduleHeadingCheck(state);
      else scheduleGeometryRefresh(state);
    });
    state.editorObserver.observe(state.editor, { childList: true, characterData: true, subtree: true });

    if (typeof ResizeObserver === 'function') {
      state.layoutObserver = new ResizeObserver(() => {
        if (!state || state.destroyed) return;
        positionUI(state);
        scheduleGeometryRefresh(state, 100);
      });
      state.layoutObserver.observe(state.root);
      state.layoutObserver.observe(state.contentWrap);
    }
    state.runtimeBound = true;
  }

  function unbindEditorRuntime(state) {
    if (!state || !state.runtimeBound) return;
    try { state.scrollContainer.removeEventListener('scroll', state.onScroll, false); } catch (_) {}
    try { state.editor.removeEventListener('compositionstart', state.onCompositionStart, false); } catch (_) {}
    try { state.editor.removeEventListener('compositionend', state.onCompositionEnd, false); } catch (_) {}
    try { state.editorObserver?.disconnect(); } catch (_) {}
    try { state.layoutObserver?.disconnect(); } catch (_) {}
    state.editorObserver = null;
    state.layoutObserver = null;
    state.runtimeBound = false;
  }

  function togglePanel(state, open) {
    if (!state || state.destroyed) return;
    state.open = Boolean(open);
    state.root.classList.toggle(CLASS.rootOpen, state.open);
    state.button?.classList.toggle(CLASS.buttonActive, state.open);
    if (state.open) {
      mountPanel(state);
      state.panel?.classList.add(CLASS.panelVisible);
      bindEditorRuntime(state);
      positionPanel(state);
      if (!state.snapshotReady) {
        window.setTimeout(() => {
          if (!state.destroyed && state.open) {
            state.snapshotReady = buildSnapshot(state);
            commitActiveFromScroll(state, false);
          }
        }, CONFIG.initialBuildDelayMs);
      } else {
        scheduleHeadingCheck(state, 80);
        scheduleGeometryRefresh(state, 80);
      }
    } else {
      state.panel?.classList.remove(CLASS.panelVisible);
      exitManualTocBrowsing(state, false);
      clearScrollTimers(state);
      unbindEditorRuntime(state);
    }
  }

  function createState(root) {
    const refs = collectRefs(root);
    if (!refs) return null;
    const state = {
      ...refs,
      destroyed: false,
      open: false,
      snapshotReady: false,
      headings: [],
      headingSignature: '',
      activeIndex: -1,
      panelWidth: CONFIG.panelWidth,
      pendingPanelWidth: CONFIG.panelWidth,
      button: null,
      panel: null,
      count: null,
      status: null,
      list: null,
      resizer: null,
      runtimeBound: false,
      editorObserver: null,
      layoutObserver: null,
      onScroll: null,
      onCompositionStart: null,
      onCompositionEnd: null,
      headingCheckTimer: 0,
      geometryTimer: 0,
      scrollTimer1: 0,
      scrollTimer2: 0,
      ensureVisibleTimer: 0,
      manualBrowseTimer: 0,
      pendingScrollTop: 0,
      manualTocBrowsing: false,
      listProgrammaticScrollUntil: 0,
      isComposing: false,
      pendingHeadingCheck: false,
      pendingGeometryRefresh: false,
      resizeDragging: false,
      resizeStartX: 0,
      resizeStartWidth: CONFIG.panelWidth,
      resizeFrame: 0,
      onResizeMove: null,
      onResizeEnd: null,
    };
    root.classList.add(CLASS.rootReady);
    applyPanelWidth(state, CONFIG.panelWidth);
    mountButton(state);
    mountPanel(state);
    positionUI(state);
    if (CONFIG.defaultOpen) togglePanel(state, true);
    states.set(root, state);
    return state;
  }

  function destroyState(state) {
    if (!state || state.destroyed) return;
    state.destroyed = true;
    unbindEditorRuntime(state);
    stopPanelResize(state, false);
    clearScrollTimers(state);
    for (const timerName of ['headingCheckTimer', 'geometryTimer', 'ensureVisibleTimer', 'manualBrowseTimer']) {
      if (state[timerName]) window.clearTimeout(state[timerName]);
      state[timerName] = 0;
    }
    state.button?.remove();
    state.panel?.remove();
    state.root?.classList.remove(CLASS.rootReady, CLASS.rootOpen, CLASS.resizing);
    state.root?.style.removeProperty('--tm-rtoc-panel-width');
    state.root?.style.removeProperty('--tm-rtoc-left-inset');
    states.delete(state.root);
    if (activeState === state) activeState = null;
  }

  function syncActiveRoot() {
    const root = findActiveRoot();
    if (!(root instanceof HTMLElement)) {
      if (activeState) destroyState(activeState);
      return;
    }

    const refs = collectRefs(root);
    if (!refs) {
      if (activeState) destroyState(activeState);
      return;
    }

    if (
      activeState &&
      !activeState.destroyed &&
      activeState.root === root &&
      activeState.editor === refs.editor &&
      activeState.scrollContainer === refs.scrollContainer
    ) {
      activeState.titleBar = refs.titleBar;
      activeState.titleTextBox = refs.titleTextBox;
      activeState.contentWrap = refs.contentWrap;
      positionUI(activeState);
      return;
    }

    if (activeState) destroyState(activeState);
    activeState = createState(root);
  }

  function scheduleDiscovery() {
    if (discoveryFrame) return;
    discoveryFrame = requestAnimationFrame(() => {
      discoveryFrame = 0;
      syncActiveRoot();
    });
  }

  function elementContainsLifecycleTarget(element) {
    if (!(element instanceof Element)) return false;
    if (element.matches(CONFIG.primaryRootSelector) || element.matches(CONFIG.fallbackRootSelector)) return true;
    if (element.querySelector(CONFIG.primaryRootSelector) || element.querySelector(CONFIG.fallbackRootSelector)) return true;
    if (activeState) {
      if (element === activeState.root || element.contains(activeState.root)) return true;
      if (element === activeState.editor || element.contains(activeState.editor)) return true;
    }
    return false;
  }

  function startGlobalObserver() {
    if (!document.body || globalObserver) return;
    globalObserver = new MutationObserver((mutations) => {
      let relevant = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (elementContainsLifecycleTarget(node)) { relevant = true; break; }
        }
        if (relevant) break;
        for (const node of mutation.removedNodes) {
          if (elementContainsLifecycleTarget(node)) { relevant = true; break; }
        }
        if (relevant) break;
      }
      if (relevant) scheduleDiscovery();
    });
    globalObserver.observe(document.body, { childList: true, subtree: true });
  }

  function bootstrap() {
    injectStyle();
    startGlobalObserver();
    scheduleDiscovery();
    window.addEventListener('resize', () => {
      if (!activeState || activeState.destroyed) return;
      positionUI(activeState);
      scheduleGeometryRefresh(activeState, 120);
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleDiscovery();
    }, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

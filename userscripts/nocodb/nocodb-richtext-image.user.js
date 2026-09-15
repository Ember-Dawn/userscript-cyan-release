// ==UserScript==
// @name         NocoDB Rich Text 图片查看器
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-image.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-image.user.js
// @version      0.1.0
// @description  调整 NocoDB Rich Text 正文图片宽度并居中；双击图片可在独立查看器中缩放、拖拽和查看原始尺寸。
// @match        https://nocodb.380782744.xyz/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /**
   * NocoDB Rich Text 图片查看器
   *
   * 设计原则：
   * 1. 正文图片仅通过 CSS 改变显示尺寸，不修改 ProseMirror 文档内容。
   * 2. 图片查看器挂载到 document.body，不向 ProseMirror 正文插入任何 DOM。
   * 3. 使用事件委托处理动态打开的 Rich Text 编辑器，不需要 MutationObserver。
   * 4. 双击只接管 NocoDB Rich Text 正文中的普通图片，不接管 Markdown 表格 NodeView。
   */

  const STYLE_ID = 'tm-nocodb-richtext-image-style-v01';
  const VIEWER_ID = 'tm-nocodb-richtext-image-viewer-v01';
  const IMAGE_SELECTOR = '.nc-rich-text-content .ProseMirror img[contenteditable="false"][draggable="true"]';
  const MARKDOWN_TABLE_SELECTOR = '[data-nocodb-markdown-table-id]';

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 5;
  const ZOOM_STEP = 1.2;

  let viewer = null;
  let previousBodyOverflow = '';

  const state = {
    open: false,
    naturalWidth: 0,
    naturalHeight: 0,
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    dragPointerId: null,
    dragLastX: 0,
    dragLastY: 0,
  };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${IMAGE_SELECTOR} {
        display: block !important;
        width: auto !important;
        max-width: 70% !important;
        height: auto !important;
        margin: 12px auto !important;
        cursor: zoom-in !important;
      }

      #${VIEWER_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        background: rgba(0, 0, 0, 0.82);
        color: #fff;
        user-select: none;
        -webkit-user-select: none;
      }

      #${VIEWER_ID}.is-open {
        display: block;
      }

      #${VIEWER_ID} .tm-nri-toolbar {
        position: absolute;
        top: 16px;
        left: 50%;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        transform: translateX(-50%);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        background: rgba(24, 24, 27, 0.92);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(8px);
      }

      #${VIEWER_ID} .tm-nri-toolbar button {
        min-width: 36px;
        height: 34px;
        padding: 0 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font: inherit;
        line-height: 1;
        cursor: pointer;
      }

      #${VIEWER_ID} .tm-nri-toolbar button:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      #${VIEWER_ID} .tm-nri-scale {
        min-width: 58px;
        text-align: center;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
      }

      #${VIEWER_ID} .tm-nri-viewport {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }

      #${VIEWER_ID} .tm-nri-image {
        position: absolute;
        left: 50%;
        top: 50%;
        display: block;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        transform-origin: center center;
        cursor: grab;
        will-change: transform;
        transition: opacity 120ms ease;
        -webkit-user-drag: none;
      }

      #${VIEWER_ID} .tm-nri-image.is-dragging {
        cursor: grabbing;
      }

      #${VIEWER_ID} .tm-nri-hint {
        position: absolute;
        left: 50%;
        bottom: 18px;
        z-index: 2;
        transform: translateX(-50%);
        padding: 6px 10px;
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.5);
        color: rgba(255, 255, 255, 0.8);
        font-size: 12px;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function updateTransform() {
    if (!viewer) return;
    viewer.image.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    viewer.scale.textContent = `${Math.round(state.scale * 100)}%`;
  }

  function getFitScale() {
    if (!state.naturalWidth || !state.naturalHeight) return 1;

    const availableWidth = Math.max(120, window.innerWidth - 80);
    const availableHeight = Math.max(120, window.innerHeight - 120);
    return Math.min(
      availableWidth / state.naturalWidth,
      availableHeight / state.naturalHeight,
      1
    );
  }

  function fitImage() {
    state.scale = clamp(getFitScale(), MIN_SCALE, MAX_SCALE);
    state.x = 0;
    state.y = 0;
    updateTransform();
  }

  function showOriginalSize() {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    updateTransform();
  }

  function zoomTo(nextScale, clientX = null, clientY = null) {
    const oldScale = state.scale;
    const newScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (Math.abs(newScale - oldScale) < 0.0001) return;

    if (clientX !== null && clientY !== null) {
      const px = clientX - window.innerWidth / 2;
      const py = clientY - window.innerHeight / 2;
      const ratio = newScale / oldScale;
      state.x = px - (px - state.x) * ratio;
      state.y = py - (py - state.y) * ratio;
    }

    state.scale = newScale;
    updateTransform();
  }

  function createViewer() {
    if (viewer) return viewer;

    const root = document.createElement('div');
    root.id = VIEWER_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '图片查看器');

    root.innerHTML = `
      <div class="tm-nri-toolbar" role="toolbar" aria-label="图片查看工具栏">
        <button type="button" data-action="zoom-out" title="缩小">−</button>
        <span class="tm-nri-scale" aria-live="polite">100%</span>
        <button type="button" data-action="zoom-in" title="放大">＋</button>
        <button type="button" data-action="fit" title="适应窗口">适应</button>
        <button type="button" data-action="original" title="100% 原始尺寸">100%</button>
        <button type="button" data-action="close" title="关闭（Esc）">关闭</button>
      </div>
      <div class="tm-nri-viewport">
        <img class="tm-nri-image" alt="" draggable="false">
      </div>
      <div class="tm-nri-hint">滚轮缩放 · 拖拽平移 · Esc 关闭</div>
    `;

    document.body.appendChild(root);

    viewer = {
      root,
      viewport: root.querySelector('.tm-nri-viewport'),
      image: root.querySelector('.tm-nri-image'),
      scale: root.querySelector('.tm-nri-scale'),
      toolbar: root.querySelector('.tm-nri-toolbar'),
    };

    viewer.toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      switch (button.dataset.action) {
        case 'zoom-out':
          zoomTo(state.scale / ZOOM_STEP);
          break;
        case 'zoom-in':
          zoomTo(state.scale * ZOOM_STEP);
          break;
        case 'fit':
          fitImage();
          break;
        case 'original':
          showOriginalSize();
          break;
        case 'close':
          closeViewer();
          break;
        default:
          break;
      }
    });

    viewer.viewport.addEventListener('wheel', (event) => {
      if (!state.open) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomTo(state.scale * factor, event.clientX, event.clientY);
    }, { passive: false });

    viewer.image.addEventListener('pointerdown', (event) => {
      if (!state.open || event.button !== 0) return;
      event.preventDefault();
      state.dragging = true;
      state.dragPointerId = event.pointerId;
      state.dragLastX = event.clientX;
      state.dragLastY = event.clientY;
      viewer.image.classList.add('is-dragging');
      viewer.image.setPointerCapture(event.pointerId);
    });

    viewer.image.addEventListener('pointermove', (event) => {
      if (!state.dragging || event.pointerId !== state.dragPointerId) return;
      state.x += event.clientX - state.dragLastX;
      state.y += event.clientY - state.dragLastY;
      state.dragLastX = event.clientX;
      state.dragLastY = event.clientY;
      updateTransform();
    });

    function stopDragging(event) {
      if (!state.dragging || event.pointerId !== state.dragPointerId) return;
      state.dragging = false;
      state.dragPointerId = null;
      viewer.image.classList.remove('is-dragging');
    }

    viewer.image.addEventListener('pointerup', stopDragging);
    viewer.image.addEventListener('pointercancel', stopDragging);

    viewer.viewport.addEventListener('click', (event) => {
      if (event.target === viewer.viewport) closeViewer();
    });

    viewer.image.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      fitImage();
    });

    return viewer;
  }

  function openViewer(sourceImage) {
    const source = sourceImage.currentSrc || sourceImage.src;
    if (!source) return;

    const currentViewer = createViewer();

    state.open = true;
    state.naturalWidth = 0;
    state.naturalHeight = 0;
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    state.dragging = false;
    state.dragPointerId = null;

    currentViewer.image.style.opacity = '0';
    currentViewer.image.alt = sourceImage.alt || 'Rich Text 图片';
    currentViewer.root.classList.add('is-open');

    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onLoad = () => {
      currentViewer.image.removeEventListener('load', onLoad);
      state.naturalWidth = currentViewer.image.naturalWidth || sourceImage.naturalWidth || 1;
      state.naturalHeight = currentViewer.image.naturalHeight || sourceImage.naturalHeight || 1;
      currentViewer.image.style.width = `${state.naturalWidth}px`;
      currentViewer.image.style.height = `${state.naturalHeight}px`;
      fitImage();
      currentViewer.image.style.opacity = '1';
    };

    currentViewer.image.addEventListener('load', onLoad);
    currentViewer.image.src = source;

    if (currentViewer.image.complete && currentViewer.image.naturalWidth) {
      onLoad();
    }
  }

  function closeViewer() {
    if (!viewer || !state.open) return;

    state.open = false;
    state.dragging = false;
    state.dragPointerId = null;
    viewer.image.classList.remove('is-dragging');
    viewer.root.classList.remove('is-open');
    viewer.image.removeAttribute('src');
    document.body.style.overflow = previousBodyOverflow;
  }

  function isSupportedRichTextImage(target) {
    if (!(target instanceof Element)) return false;
    const image = target.closest(IMAGE_SELECTOR);
    if (!image) return false;
    if (image.closest(MARKDOWN_TABLE_SELECTOR)) return false;
    return image;
  }

  document.addEventListener('dblclick', (event) => {
    const image = isSupportedRichTextImage(event.target);
    if (!image) return;

    event.preventDefault();
    event.stopPropagation();
    openViewer(image);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!state.open) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeViewer();
      return;
    }

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomTo(state.scale * ZOOM_STEP);
      return;
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomTo(state.scale / ZOOM_STEP);
      return;
    }

    if (event.key === '0') {
      event.preventDefault();
      fitImage();
    }
  }, true);

  window.addEventListener('resize', () => {
    if (state.open) fitImage();
  });

  injectStyle();
})();

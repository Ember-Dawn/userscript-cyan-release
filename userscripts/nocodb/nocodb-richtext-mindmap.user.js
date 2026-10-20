// ==UserScript==
// @name         NocoDB Rich Text 思维导图
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-mindmap.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-mindmap.user.js
// @version      0.1.2
// @description  在 NocoDB LongText Rich Text 工具栏关联独立 Mind-map 文件，在新建的 Modal iframe 中编辑；富文本只保存永久 URL。
// @match        https://nocodb.380782744.xyz/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const ORIGIN = 'https://mindmap.380782744.xyz';
  const MODAL_SELECTOR = '.nc-long-text-expanded-modal[role="dialog"]';
  const EDITOR_SELECTOR = '.tiptap.ProseMirror';
  const ANCHOR_SELECTOR = '.tm-rmd-export-download-v1';
  const BUTTON_CLASS = 'tm-rmm-button-v1';
  const OVERLAY_ID = 'tm-rmm-overlay-v1';
  const STYLE_ID = 'tm-rmm-style-v1';
  const PREFIX = '【mindmap】';
  const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const VALID_URL = new RegExp(`^https:\\/\\/mindmap\\.380782744\\.xyz\\/m\\/(${UUID_PATTERN})\\/?$`, 'i');
  const MARKER = new RegExp(`^${PREFIX}\\s*(https:\\/\\/\\S+)\\s*$`);
  const buttonStates = new Map();
  let scheduled = false;
  let activeOverlay = null;
  let busy = false;
  let overlayKeydownCleanup = null;

  function addPreconnect() {
    if (document.querySelector('link[data-tm-rmm-preconnect]')) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = ORIGIN;
    link.dataset.tmRmmPreconnect = '';
    document.head?.appendChild(link);
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${BUTTON_CLASS} { position:absolute;z-index:31;width:30px;min-width:30px;height:30px;padding:0;display:inline-flex!important;align-items:center;justify-content:center;visibility:hidden;opacity:0;transition:opacity 120ms ease; }
      .${BUTTON_CLASS}.is-visible { visibility:visible;opacity:1; }
      .${BUTTON_CLASS} svg { width:15px;height:15px;flex:none; }
      #${OVERLAY_ID} { position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(12,16,25,.67); }
      #${OVERLAY_ID} .tm-rmm-dialog { display:flex;flex-direction:column;width:92vw;height:90vh;min-width:0;min-height:0;background:#171b22;color:#e5e7eb;border:1px solid #3b4553;border-radius:11px;overflow:hidden;box-shadow:0 24px 75px rgba(0,0,0,.4);font:13px/1.5 system-ui,sans-serif; }
      #${OVERLAY_ID} .tm-rmm-header { display:flex;align-items:center;gap:12px;padding:0 12px;min-height:41px;border-bottom:1px solid #343c49; }
      #${OVERLAY_ID} .tm-rmm-title { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600; }
      #${OVERLAY_ID} .tm-rmm-close { flex:none;cursor:pointer;border:0;background:transparent;color:inherit;font-size:23px;line-height:1;padding:4px 8px;border-radius:5px; }
      #${OVERLAY_ID} .tm-rmm-close:hover { background:#303845; }
      #${OVERLAY_ID} .tm-rmm-body { flex:1;position:relative;min-height:0;background:#fff; }
      #${OVERLAY_ID} iframe { width:100%;height:100%;border:0;display:block;background:#fff; }
      #${OVERLAY_ID} .tm-rmm-loading { position:absolute;inset:0;display:flex;justify-content:center;align-items:center;flex-direction:column;gap:13px;background:#171b22;color:#c9d2dd;z-index:1;padding:24px;text-align:center; }
      #${OVERLAY_ID} .tm-rmm-loading[hidden] { display:none!important; }
      #${OVERLAY_ID} .tm-rmm-actions { display:flex;gap:10px; }
      #${OVERLAY_ID} .tm-rmm-retry { cursor:pointer;padding:6px 15px;border-radius:6px;border:1px solid #687587;background:#293344;color:#fff; }
      @media(max-width:700px) { #${OVERLAY_ID} { padding:5px; } #${OVERLAY_ID} .tm-rmm-dialog { width:100%;height:96vh; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getEditor(modal) {
    const dom = modal?.querySelector(EDITOR_SELECTOR);
    const editor = dom?.editor;
    if (!dom || dom.getAttribute('contenteditable') !== 'true' || !editor || editor.isDestroyed ||
        editor.view?.dom !== dom || !editor.state?.doc ||
        typeof editor.commands?.insertContentAt !== 'function') return null;
    return editor;
  }

  // Read ProseMirror's actual document, not rendered HTML, so autolink nodes still work.
  function inspectMarkers(editor) {
    const entries = [];
    editor.state.doc.descendants((node) => {
      if (!node.isTextblock) return true;
      const text = node.textContent.trim();
      if (!text.includes(PREFIX)) return false;
      const marker = node.type.name === 'paragraph' ? MARKER.exec(text) : null;
      const url = marker?.[1] || '';
      const id = url && VALID_URL.exec(url)?.[1];
      entries.push({ text, id: id || null, valid: Boolean(id && marker) });
      return false;
    });
    return entries;
  }

  function buildUrl(id) { return `${ORIGIN}/m/${id}`; }

  function insertMarker(editor, url) {
    const { state, view } = editor;
    const { doc, schema } = state;
    const paragraphType = schema.nodes.paragraph;
    if (!paragraphType || !view || view.dom !== editor.view.dom) return false;

    const marker = paragraphType.create(null, schema.text(`${PREFIX}${url}`));
    const trailing = paragraphType.create(); // Renders as <p><br class="ProseMirror-trailingBreak"></p>.
    const last = doc.lastChild;
    const lastIsEmpty = last?.type === paragraphType && last.content.size === 0;
    const isEmptyDocument = doc.childCount === 1 && lastIsEmpty;
    const tr = state.tr;

    if (isEmptyDocument) {
      // Replace the editor's placeholder, rather than leaving a blank line above the marker.
      tr.replaceWith(0, doc.content.size, [marker, trailing]);
    } else if (lastIsEmpty) {
      // Reuse the final empty paragraph as the marker, and create one trailing blank.
      tr.replaceWith(doc.content.size - last.nodeSize, doc.content.size, [marker, trailing]);
    } else {
      tr.insert(doc.content.size, [marker, trailing]);
    }
    view.dispatch(tr);
    return true;
  }

  function buttonIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="9" width="7" height="6" rx="1.5"/><rect x="15" y="3" width="7" height="6" rx="1.5"/><rect x="15" y="15" width="7" height="6" rx="1.5"/><path d="M9 12h3m0 0V6h3m-3 6v6h3"/></svg>';
  }

  function destroyButtonState(state) {
    if (!state || state.destroyed) return;
    state.destroyed = true;
    state.resizeObserver?.disconnect();
    state.anchorObserver?.disconnect();
    state.button.remove();
    buttonStates.delete(state.dialog);
  }

  function positionButton(state) {
    if (!state || state.destroyed) return;
    const { dialog, anchor, host, button } = state;
    if (!dialog.isConnected || !anchor.isConnected || anchor.parentElement !== host ||
        !getEditor(dialog) || anchor.getClientRects().length === 0) {
      button.classList.remove('is-visible');
      return;
    }
    // The Markdown export buttons are absolutely positioned in this same host.
    // DOM sibling order alone does not position our button beside them.
    button.style.top = `${anchor.offsetTop}px`;
    button.style.left = `${anchor.offsetLeft + anchor.offsetWidth + 6}px`;
    button.classList.add('is-visible');
  }

  function syncButtons() {
    for (const state of [...buttonStates.values()]) {
      if (!state.dialog.isConnected || !state.anchor.isConnected ||
          state.anchor.parentElement !== state.host ||
          !state.dialog.contains(state.editorDom) || !getEditor(state.dialog)) {
        destroyButtonState(state);
      } else {
        positionButton(state);
      }
    }

    const dialogs = [...document.querySelectorAll(MODAL_SELECTOR)];
    for (const dialog of dialogs) {
      const editor = getEditor(dialog);
      const anchor = dialog.querySelector(ANCHOR_SELECTOR);
      if (!editor || !anchor || !anchor.isConnected) continue;
      const host = anchor.parentElement;
      if (!host) continue;
      if (buttonStates.has(dialog)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ant-btn ant-btn-text small theme-default bordered nc-btn-shadow nc-button ${BUTTON_CLASS}`;
      button.title = '打开关联的思维导图';
      button.setAttribute('aria-label', '思维导图');
      button.innerHTML = buttonIcon();
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => openFromDialog(dialog));
      anchor.insertAdjacentElement('afterend', button);
      const state = {
        dialog, anchor, host, editorDom: editor.view.dom, button,
        resizeObserver: null, anchorObserver: null, destroyed: false,
      };
      buttonStates.set(dialog, state);
      if (typeof ResizeObserver === 'function') {
        state.resizeObserver = new ResizeObserver(() => positionButton(state));
        state.resizeObserver.observe(anchor);
      }
      state.anchorObserver = new MutationObserver(() => positionButton(state));
      state.anchorObserver.observe(anchor, { attributes: true, attributeFilter: ['class', 'style'] });
      positionButton(state);
    }
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; syncButtons(); });
  }

  function closeOverlay() {
    if (!activeOverlay) return;
    overlayKeydownCleanup?.();
    overlayKeydownCleanup = null;
    activeOverlay.remove();
    activeOverlay = null;
  }

  function openIframe(url) {
    addStyle();
    closeOverlay();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <section class="tm-rmm-dialog" role="dialog" aria-modal="true" aria-label="思维导图">
        <header class="tm-rmm-header"><div class="tm-rmm-title">思维导图</div><button type="button" class="tm-rmm-close" aria-label="关闭思维导图" title="关闭">×</button></header>
        <div class="tm-rmm-body"><iframe title="Mind-map 编辑器" allow="clipboard-read; clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          <div class="tm-rmm-loading"><span class="tm-rmm-message">正在加载 Mind-map…</span><div class="tm-rmm-actions"><button type="button" class="tm-rmm-retry" hidden>重新加载</button><button type="button" class="tm-rmm-retry tm-rmm-login" hidden>在新标签页打开</button></div></div>
        </div>
      </section>`;
    const iframe = overlay.querySelector('iframe');
    const loading = overlay.querySelector('.tm-rmm-loading');
    const message = overlay.querySelector('.tm-rmm-message');
    const retry = overlay.querySelector('.tm-rmm-retry');
    const login = overlay.querySelector('.tm-rmm-login');
    const launch = () => {
      loading.hidden = false;
      retry.hidden = true;
      login.hidden = true;
      message.textContent = '正在加载 Mind-map…';
      // Create a new iframe on each Modal open; never reuse a previous editor instance.
      iframe.src = url;
    };
    iframe.addEventListener('load', () => { loading.hidden = true; });
    iframe.addEventListener('error', () => {
      message.textContent = '导图页面加载失败，请重新加载，或在新标签页打开。';
      loading.hidden = false;
      retry.hidden = false;
      login.hidden = false;
    });
    retry.addEventListener('click', () => {
      iframe.src = 'about:blank';
      launch();
    });
    login.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));
    overlay.querySelector('.tm-rmm-close').addEventListener('click', closeOverlay);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeOverlay(); });
    const onKeydown = (event) => { if (event.key === 'Escape' && activeOverlay === overlay) { event.stopPropagation(); closeOverlay(); } };
    document.addEventListener('keydown', onKeydown, true);
    overlayKeydownCleanup = () => document.removeEventListener('keydown', onKeydown, true);
    document.body.appendChild(overlay);
    activeOverlay = overlay;
    launch();
  }

  function openFromDialog(dialog) {
    if (busy || activeOverlay) return;
    const editor = getEditor(dialog);
    if (editor?.view?.composing) { window.alert('请先完成当前输入法输入，再打开思维导图。'); return; }
    if (!editor || !dialog.isConnected) { window.alert('当前 Rich Text 编辑器已关闭，请重新打开后再试。'); return; }
    busy = true;
    try {
      const entries = inspectMarkers(editor);
      let id;
      if (entries.length > 1) throw new Error('找到多条思维导图标志。请先手动整理为一条有效的独立段落。');
      if (entries.length === 1) {
        if (!entries[0].valid) throw new Error('找到格式不合法的【mindmap】标志。请先修正它，脚本不会另建导图。');
        id = entries[0].id;
      } else {
        id = crypto.randomUUID();
        const url = buildUrl(id);
        if (!insertMarker(editor, url)) throw new Error('无法向 Rich Text 插入关联标志；未创建导图。');
        const after = inspectMarkers(editor);
        if (after.length !== 1 || !after[0].valid || after[0].id.toLowerCase() !== id.toLowerCase()) {
          throw new Error('插入后未能验证独立关联段落。请检查编辑器内容；未打开导图。');
        }
      }
      openIframe(buildUrl(id));
    } catch (error) {
      console.warn('[RichText MindMap]', error);
      window.alert(error?.message || '无法打开思维导图。');
    } finally { busy = false; }
  }

  addPreconnect();
  addStyle();
  scheduleSync();
  new MutationObserver(scheduleSync).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleSync, { passive: true });
})();

// ==UserScript==
// @name         NocoDB Rich Text 思维导图
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-mindmap.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-mindmap.user.js
// @version      0.2.5
// @description  在 NocoDB LongText Rich Text 工具栏关联独立 Mind-map 文件，在复用的 Modal iframe 中编辑；富文本只保存永久 URL。
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
  const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const VALID_URL = new RegExp(`^https:\\/\\/mindmap\\.380782744\\.xyz\\/m\\/(${UUID_PATTERN})\\/?$`, 'i');
  const MARKER = new RegExp(`^${PREFIX}\\s*(https:\\/\\/\\S+)\\s*$`);
  const buttonStates = new Map();
  let scheduled = false;
  let activeOverlay = null;
  let busy = false;
  let overlayKeydownCleanup = null;
  let session = null;
  const PROTOCOL = 'mindmap-embed';

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
      #${OVERLAY_ID}[hidden] { display:none!important; }
      #${OVERLAY_ID} { position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(12,16,25,.67); }
      #${OVERLAY_ID} .tm-rmm-dialog { position:relative;display:flex;flex-direction:column;width:92vw;height:90vh;min-width:0;min-height:0;background:#171b22;color:#e5e7eb;border:1px solid #3b4553;border-radius:11px;overflow:hidden;box-shadow:0 24px 75px rgba(0,0,0,.4);font:13px/1.5 system-ui,sans-serif; }
      #${OVERLAY_ID} .tm-rmm-close { position:absolute;top:8px;right:8px;z-index:3;display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;cursor:pointer;border:0;background:rgba(23,27,34,.82);color:#e5e7eb;font-size:23px;line-height:1;border-radius:7px; }
      #${OVERLAY_ID} .tm-rmm-close:hover { background:#303845; }
      #${OVERLAY_ID} .tm-rmm-body { flex:1;position:relative;min-height:0;background:#fff; }
      #${OVERLAY_ID} iframe { width:100%;height:100%;border:0;display:block;background:#fff; }
      #${OVERLAY_ID} .tm-rmm-loading { position:absolute;inset:0;display:flex;justify-content:center;align-items:center;flex-direction:column;gap:13px;background:#171b22;color:#c9d2dd;z-index:1;padding:24px;text-align:center; }
      #${OVERLAY_ID} .tm-rmm-loading[hidden] { display:none!important; }
      #${OVERLAY_ID} .tm-rmm-actions { display:flex;gap:10px; }
      #${OVERLAY_ID} .tm-rmm-retry { cursor:pointer;padding:6px 15px;border-radius:6px;border:1px solid #687587;background:#293344;color:#fff; }
      /* Parent modal follows the OS/browser theme; iframe theme remains independent. */
      @media (prefers-color-scheme: light) {
        #${OVERLAY_ID} .tm-rmm-dialog { background:#f7f8fa;color:#243247;border-color:#d6dee8;box-shadow:0 24px 75px rgba(28,42,62,.18); }
        #${OVERLAY_ID} .tm-rmm-close { background:rgba(255,255,255,.9);color:#243247; }
        #${OVERLAY_ID} .tm-rmm-close:hover { background:#e9edf4; }
        #${OVERLAY_ID} .tm-rmm-loading { background:#f7f8fa;color:#516176; }
        #${OVERLAY_ID} .tm-rmm-retry { border-color:#c7d2e1;background:#fff;color:#243247; }
        #${OVERLAY_ID} .tm-rmm-retry:hover { background:#edf2f8; }
      }
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
    // NocoDB strips one trailing empty paragraph on initial persistence.
    // Two real empty paragraphs preserve one visible blank paragraph on reopen.
    // Keep the marker and both blanks in a single undoable transaction.
    const trailing = [paragraphType.create(), paragraphType.create()];
    const last = doc.lastChild;
    const lastIsEmpty = last?.type === paragraphType && last.content.size === 0;
    const isEmptyDocument = doc.childCount === 1 && lastIsEmpty;
    const tr = state.tr;

    if (isEmptyDocument) {
      // Replace the editor's placeholder, rather than leaving a blank line above the marker.
      tr.replaceWith(0, doc.content.size, [marker, ...trailing]);
    } else if (lastIsEmpty) {
      // Reuse the final empty paragraph as the marker, and create one trailing blank.
      tr.replaceWith(doc.content.size - last.nodeSize, doc.content.size, [marker, ...trailing]);
    } else {
      tr.insert(doc.content.size, [marker, ...trailing]);
    }
    view.dispatch(tr);
    const updated = editor.state.doc;
    if (updated.childCount < 3) return false;
    const markerNode = updated.child(updated.childCount - 3);
    const blankA = updated.child(updated.childCount - 2);
    const blankB = updated.child(updated.childCount - 1);
    return markerNode.type === paragraphType && markerNode.textContent === `${PREFIX}${url}` &&
      blankA.type === paragraphType && blankA.content.size === 0 &&
      blankB.type === paragraphType && blankB.content.size === 0;
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

  // Keep exactly one iframe for the lifetime of the NocoDB page. Closing
  // unmounts the active map in MindMap before hiding the iframe.
  function pendingRequest(type, uuid) {
    if (!session || !session.ready || session.pending) return Promise.reject(new Error('编辑器尚未准备好或正在处理其他操作'));
    const current = session;
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (current.pending?.requestId !== requestId) return;
        // Do not free this slot: the child may still complete the operation.
        // A late RESULT will reconcile the session before another command.
        current.pending.timedOut = true;
        reject(new Error('MindMap 响应超时；操作结果尚不确定，请等待完成或刷新 NocoDB 页面'));
      }, type === 'OPEN' ? 70000 : 25000);
      current.pending = { requestId, resolve, reject, timer, type, uuid, timedOut: false };
      current.iframe.contentWindow.postMessage({ protocol: PROTOCOL, version: 1,
        type, requestId, ...(uuid ? { uuid } : {}) }, ORIGIN);
    });
  }

  function showFailure(text) {
    if (!session) return;
    const {loading, message, retry, login} = session;
    message.textContent = text;
    loading.hidden = false;
    retry.hidden = false;
    login.hidden = false;
  }

  async function closeOverlay() {
    if (!session || !activeOverlay || session.pending || session.closing) return;
    const current = session;
    current.closing = true;
    current.message.textContent = '正在保存并关闭导图…';
    current.loading.hidden = false;
    try {
      await pendingRequest('CLOSE');
      current.overlay.hidden = true;
      current.loading.hidden = true;
      activeOverlay = null;
      current.uuid = null;
    } catch (error) {
      // Never reload a possibly dirty editor after a failed/unknown save.
      current.loading.hidden = true;
      window.alert('未能安全关闭导图：' + error.message + '。请在 MindMap 内确认保存状态后重试。');
    } finally { current.closing = false; }
  }

  async function openIframe(url) {
    addStyle();
    const uuid = VALID_URL.exec(url)?.[1]?.toLowerCase();
    if (!uuid) return;
    if (session) {
      const current = session;
      current.desiredUuid = uuid;
      current.overlay.hidden = false;
      activeOverlay = current.overlay;
      current.loading.hidden = false;
      current.message.textContent = '正在打开思维导图…';
      current.retry.hidden = true;
      current.login.hidden = true;
      try {
        if (current.uuid !== uuid) await pendingRequest('OPEN', uuid);
        current.uuid = uuid;
        current.loading.hidden = true;
      } catch (error) {
        showFailure('无法切换导图：' + error.message);
      }
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <section class="tm-rmm-dialog" role="dialog" aria-modal="true" aria-label="思维导图">
        <button type="button" class="tm-rmm-close" aria-label="关闭思维导图" title="关闭">×</button>
        <div class="tm-rmm-body"><iframe title="Mind-map 编辑器" allow="clipboard-read; clipboard-write; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          <div class="tm-rmm-loading"><span class="tm-rmm-message">正在加载 Mind-map…</span><div class="tm-rmm-actions"><button type="button" class="tm-rmm-retry" hidden>重试</button><button type="button" class="tm-rmm-retry tm-rmm-login" hidden>在新标签页打开</button></div></div>
        </div>
      </section>`;
    const iframe = overlay.querySelector('iframe');
    const loading = overlay.querySelector('.tm-rmm-loading');
    const message = overlay.querySelector('.tm-rmm-message');
    const retry = overlay.querySelector('.tm-rmm-retry');
    const login = overlay.querySelector('.tm-rmm-login');
    session = { overlay, iframe, loading, message, retry, login, uuid, desiredUuid: uuid,
      ready: false, pending: null, closing: false };
    activeOverlay = overlay;
    const current = session;
    // load only means that the iframe document loaded. Show the embedded page
    // regardless of READY so login, error and create-confirmation screens remain visible.
    // READY is still required before issuing OPEN/CLOSE bridge commands.
    iframe.addEventListener('load', () => {
      if (session !== current || activeOverlay !== overlay || current.pending || current.closing) return;
      current.loading.hidden = true;
      current.retry.hidden = true;
      current.login.hidden = true;
    });
    iframe.addEventListener('error', () => {
      if (session !== current) return;
      showFailure('导图页面加载失败，请在新标签页打开检查。');
    });
    retry.addEventListener('click', async () => {
      if (session.pending || session.closing) return;
      loading.hidden = false;
      retry.hidden = true;
      login.hidden = true;
      message.textContent = '正在重新连接 MindMap…';
      if (!session.ready) {
        // No READY does not mean the iframe is empty. Its contents may already
        // be editable, so require confirmation before reloading.
        if (!window.confirm('MindMap 尚未确认通信就绪。重新加载 iframe 可能丢失未保存内容，确定重试吗？')) {
          showFailure('尚未重新加载。请在新标签页检查 MindMap 状态。');
          return;
        }
        iframe.src = buildUrl(session.desiredUuid);
        return;
      }
      try {
        await pendingRequest('OPEN', session.desiredUuid);
        session.uuid = session.desiredUuid;
        loading.hidden = true;
      } catch (error) { showFailure('无法切换导图：' + error.message); }
    });
    login.addEventListener('click', () => window.open(buildUrl(session.desiredUuid), '_blank', 'noopener,noreferrer'));
    overlay.querySelector('.tm-rmm-close').addEventListener('click', closeOverlay);
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) closeOverlay(); });
    const onKeydown = event => {
      if (event.key === 'Escape' && activeOverlay === overlay) { event.stopPropagation(); closeOverlay(); }
    };
    document.addEventListener('keydown', onKeydown, true);
    overlayKeydownCleanup = () => document.removeEventListener('keydown', onKeydown, true);
    document.body.appendChild(overlay);
    iframe.src = url;
  }

  window.addEventListener('message', event => {
    if (!session || event.origin !== ORIGIN || event.source !== session.iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.protocol !== PROTOCOL || data.version !== 1) return;
    if (data.type === 'READY') {
      session.ready = true;
      // READY confirms only the embedded message bridge. The iframe itself
      // remains responsible for showing login, missing-map and canvas states.
      if (activeOverlay === session.overlay && !session.pending && !session.closing) {
        session.loading.hidden = true;
        session.retry.hidden = true;
        session.login.hidden = true;
      }
      return;
    }
    if (data.type !== 'RESULT' || !session.pending || data.requestId !== session.pending.requestId) return;
    const pending = session.pending;
    session.pending = null;
    clearTimeout(pending.timer);
    if (pending.timedOut) {
      // The parent already reported uncertainty; reconcile safely instead of
      // pretending the old UUID is still active.
      if (data.ok === true) {
        session.uuid = pending.type === 'CLOSE' ? null : pending.uuid;
        if (pending.type === 'CLOSE') {
          session.overlay.hidden = true;
          activeOverlay = null;
        } else if (session.desiredUuid === pending.uuid) session.loading.hidden = true;
      }
      return;
    }
    if (data.ok === true) pending.resolve();
    else pending.reject(new Error(typeof data.message === 'string' && data.message ? data.message : '操作未完成'));
  });

  function openFromDialog(dialog) {
    if (busy || activeOverlay || session?.pending || session?.closing) return;
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

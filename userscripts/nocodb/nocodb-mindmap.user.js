// ==UserScript==
// @name         NocoDB 思维导图
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-mindmap.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-mindmap.user.js
// @version      0.2.0
// @description  拦截 NocoDB MindMap Button，在当前页面的大弹窗中嵌入自部署 MindMap WebUI，并通过 NocoDB v3 API 手动保存 MindMapData JSON。
// @match        https://nocodb.380782744.xyz/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const MINDMAP_PATH = '/__mindmap__';
  const MINDMAP_WEB_URL = 'https://mindmap.380782744.xyz/';
  const MINDMAP_WEB_ORIGIN = new URL(MINDMAP_WEB_URL).origin;
  const DATA_FIELD = 'MindMapData';
  const ENGINE_NAME = 'simple-mind-map';
  const ENGINE_VERSION = '0.14.0-fix.3';
  const SCHEMA_VERSION = 1;
  const TOKEN_STORAGE_KEY = 'tm-nocodb-mindmap-api-token-v1';
  const STYLE_ID = 'tm-nocodb-mindmap-style';
  const MODAL_ID = 'tm-nocodb-mindmap-modal';
  const TOKEN_MODAL_ID = 'tm-nocodb-mindmap-token-modal';
  const SAVE_REQUEST_TIMEOUT_MS = 30000;

  const nativeOpen = unsafeWindow.open.bind(unsafeWindow);

  let modalState = null;
  let tokenDialogState = null;

  function isTokenInputTarget(target) {
    return target instanceof Element && target.matches(`#${TOKEN_MODAL_ID} input`);
  }

  function protectTokenInputKeyboard(event) {
    if (!isTokenInputTarget(event.target)) return;
    const key = String(event.key || '').toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'v', 'x'].includes(key)) {
      // Keep the browser's native edit action, but prevent NocoDB/global shortcuts from handling it.
      event.stopImmediatePropagation();
    }
  }

  document.addEventListener('keydown', protectTokenInputKeyboard, true);

  class ApiError extends Error {
    constructor(message, status = 0, body = '') {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID},
      #${TOKEN_MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 24px;
        background: rgba(15, 23, 42, 0.42);
        backdrop-filter: blur(2px);
      }

      #${MODAL_ID}[hidden],
      #${TOKEN_MODAL_ID}[hidden] {
        display: none !important;
      }

      #${MODAL_ID} .tm-nmm-dialog {
        display: flex;
        flex-direction: column;
        width: min(90vw, 1680px);
        height: min(85vh, 1040px);
        min-width: 720px;
        min-height: 520px;
        overflow: visible;
        border: 1px solid rgba(15, 23, 42, 0.15);
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
        color: #1f2937;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${MODAL_ID} .tm-nmm-header {
        position: relative;
        z-index: 3;
        display: flex;
        align-items: center;
        min-height: 48px;
        gap: 10px;
        padding: 0 14px 0 16px;
        border-bottom: 1px solid #e5e7eb;
        border-radius: 14px 14px 0 0;
        background: #fff;
      }

      #${MODAL_ID} .tm-nmm-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        font-size: 15px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${MODAL_ID} .tm-nmm-status {
        flex: 0 0 auto;
        color: #6b7280;
        font-size: 12px;
      }

      #${MODAL_ID} .tm-nmm-status[data-state="saved"] {
        color: #15803d;
      }

      #${MODAL_ID} .tm-nmm-status[data-state="dirty"],
      #${MODAL_ID} .tm-nmm-status[data-state="saving"] {
        color: #a16207;
      }

      #${MODAL_ID} .tm-nmm-status[data-state="error"] {
        color: #b91c1c;
      }

      #${MODAL_ID} .tm-nmm-save,
      #${MODAL_ID} .tm-nmm-close,
      #${MODAL_ID} .tm-nmm-close-popover button,
      #${TOKEN_MODAL_ID} button {
        border: 1px solid #d1d5db;
        border-radius: 7px;
        background: #fff;
        color: #374151;
        cursor: pointer;
        font: inherit;
      }

      #${MODAL_ID} .tm-nmm-save:hover,
      #${MODAL_ID} .tm-nmm-close:hover,
      #${MODAL_ID} .tm-nmm-close-popover button:hover,
      #${TOKEN_MODAL_ID} button:hover {
        background: #f3f4f6;
      }

      #${MODAL_ID} .tm-nmm-save {
        min-height: 32px;
        padding: 5px 12px;
      }

      #${MODAL_ID} .tm-nmm-save:disabled {
        cursor: default;
        opacity: 0.55;
      }

      #${MODAL_ID} .tm-nmm-close-wrap {
        position: relative;
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
      }

      #${MODAL_ID} .tm-nmm-close {
        width: 32px;
        height: 32px;
        padding: 0;
        font-size: 20px;
        line-height: 28px;
      }

      #${MODAL_ID} .tm-nmm-close-popover {
        position: absolute;
        top: 32px;
        right: 32px;
        z-index: 20;
        width: 220px;
        box-sizing: border-box;
        padding: 12px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 12px 34px rgba(15, 23, 42, 0.2);
      }

      #${MODAL_ID} .tm-nmm-close-popover[hidden] {
        display: none !important;
      }

      #${MODAL_ID} .tm-nmm-close-popover-text {
        margin-bottom: 10px;
        color: #374151;
        font-size: 13px;
      }

      #${MODAL_ID} .tm-nmm-close-popover-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      #${MODAL_ID} .tm-nmm-close-popover button {
        min-height: 30px;
        padding: 4px 10px;
      }

      #${MODAL_ID} .tm-nmm-close-popover .tm-nmm-close-save {
        border-color: #4f46e5;
        background: #4f46e5;
        color: #fff;
      }

      #${MODAL_ID} .tm-nmm-close-popover .tm-nmm-close-save:hover {
        background: #4338ca;
      }

      #${MODAL_ID} .tm-nmm-frame-wrap {
        position: relative;
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        border-radius: 0 0 14px 14px;
        background: #fff;
      }

      #${MODAL_ID} .tm-nmm-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #fff;
      }

      #${MODAL_ID} .tm-nmm-loading,
      #${MODAL_ID} .tm-nmm-error {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
        background: #fff;
        color: #6b7280;
        text-align: center;
      }

      #${MODAL_ID} .tm-nmm-error {
        color: #b91c1c;
      }

      #${TOKEN_MODAL_ID} .tm-nmm-token-dialog {
        width: min(460px, calc(100vw - 40px));
        padding: 20px;
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
        color: #1f2937;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${TOKEN_MODAL_ID} .tm-nmm-token-title {
        margin-bottom: 8px;
        font-size: 16px;
        font-weight: 650;
      }

      #${TOKEN_MODAL_ID} .tm-nmm-token-help {
        margin-bottom: 12px;
        color: #6b7280;
      }

      #${TOKEN_MODAL_ID} input {
        width: 100%;
        height: 36px;
        box-sizing: border-box;
        padding: 6px 9px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        outline: none;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      #${TOKEN_MODAL_ID} input:focus {
        border-color: #6366f1;
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.14);
      }

      #${TOKEN_MODAL_ID} .tm-nmm-token-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
      }

      #${TOKEN_MODAL_ID} button {
        min-height: 32px;
        padding: 5px 12px;
      }

      #${TOKEN_MODAL_ID} .tm-nmm-token-save {
        border-color: #4f46e5;
        background: #4f46e5;
        color: #fff;
      }

      #${TOKEN_MODAL_ID} .tm-nmm-token-save:hover {
        background: #4338ca;
      }

      @media (max-width: 820px), (max-height: 620px) {
        #${MODAL_ID},
        #${TOKEN_MODAL_ID} {
          padding: 10px;
        }

        #${MODAL_ID} .tm-nmm-dialog {
          width: calc(100vw - 20px);
          height: calc(100vh - 20px);
          min-width: 0;
          min-height: 0;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function isMindMapUrl(value) {
    if (!value) return false;

    try {
      const url = new URL(String(value), unsafeWindow.location.href);
      return url.origin === unsafeWindow.location.origin && url.pathname === MINDMAP_PATH && Boolean(url.searchParams.get('recordId'));
    } catch {
      return false;
    }
  }

  function getRecordIdFromUrl(value) {
    const url = new URL(String(value), unsafeWindow.location.href);
    return url.searchParams.get('recordId') || '';
  }

  function getNocoDbContext() {
    const segments = unsafeWindow.location.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });

    const baseId = segments.find((part) => /^p[a-z0-9]+$/i.test(part)) || '';
    const tableId = segments.find((part) => /^m[a-z0-9]+$/i.test(part)) || '';
    const viewId = segments.find((part) => /^v[a-z0-9]+$/i.test(part)) || '';
    const baseIndex = baseId ? segments.indexOf(baseId) : -1;
    const workspaceId = baseIndex > 0 ? segments[baseIndex - 1] : '';

    if (!baseId || !tableId) {
      throw new Error('无法从当前 NocoDB URL 解析 Base ID / Table ID。请在目标表格 Grid 页面点击 MindMap Button。');
    }

    return { workspaceId, baseId, tableId, viewId };
  }

  function getApiToken() {
    return String(GM_getValue(TOKEN_STORAGE_KEY, '') || '').trim();
  }

  function setApiToken(token) {
    const normalized = String(token || '').trim();
    if (normalized) GM_setValue(TOKEN_STORAGE_KEY, normalized);
    return normalized;
  }

  function ensureDocumentReady() {
    if (document.documentElement) return Promise.resolve();
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.documentElement) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
  }

  async function promptForToken({ force = false, authFailed = false } = {}) {
    const current = getApiToken();
    if (current && !force) return current;

    await ensureDocumentReady();
    injectStyle();

    if (tokenDialogState) return tokenDialogState.promise;

    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const overlay = document.createElement('div');
    overlay.id = TOKEN_MODAL_ID;
    overlay.innerHTML = `
      <div class="tm-nmm-token-dialog" role="dialog" aria-modal="true" aria-label="设置 NocoDB API Token">
        <div class="tm-nmm-token-title">${authFailed ? 'NocoDB API Token 无效或权限不足' : '设置 NocoDB API Token'}</div>
        <div class="tm-nmm-token-help">
          ${authFailed ? '请重新输入可用的 API Token。保存后脚本会自动重试刚才的请求。' : '首次使用需要 API Token。'}
          Token 仅保存在 Tampermonkey 当前脚本的本地存储中，不会写入 GitHub。
        </div>
        <input type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 NocoDB API Token">
        <div class="tm-nmm-token-actions">
          <button type="button" class="tm-nmm-token-cancel">取消</button>
          <button type="button" class="tm-nmm-token-save">保存并继续</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);
    const input = overlay.querySelector('input');
    const saveButton = overlay.querySelector('.tm-nmm-token-save');
    const cancelButton = overlay.querySelector('.tm-nmm-token-cancel');

    if (force && current) input.value = current;

    const finish = (value) => {
      if (!tokenDialogState) return;
      tokenDialogState = null;
      overlay.remove();
      resolvePromise(value);
    };

    const save = () => {
      const token = setApiToken(input.value);
      if (!token) {
        input.focus();
        return;
      }
      finish(token);
    };

    saveButton.addEventListener('click', save);
    cancelButton.addEventListener('click', () => finish(''));
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finish('');
    });
    input.addEventListener('keydown', (event) => {
      const key = String(event.key || '').toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'v', 'x'].includes(key)) {
        event.stopPropagation();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish('');
      }
    });

    for (const type of ['paste', 'copy', 'cut']) {
      input.addEventListener(type, (event) => {
        event.stopPropagation();
      });
    }

    tokenDialogState = { overlay, promise };
    requestAnimationFrame(() => input.focus());
    return promise;
  }

  async function apiRequest(path, options = {}, allowTokenRetry = true) {
    let token = getApiToken();
    if (!token) token = await promptForToken();
    if (!token) throw new Error('未设置 NocoDB API Token。');

    let response;
    try {
      response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'xc-token': token,
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      throw new ApiError(error?.message || 'NocoDB API 网络请求失败。');
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const apiError = new ApiError(`NocoDB API 请求失败（HTTP ${response.status}）。`, response.status, body);

      if (allowTokenRetry && [401, 403].includes(response.status)) {
        const replacement = await promptForToken({ force: true, authFailed: true });
        if (replacement) return apiRequest(path, options, false);
      }

      throw apiError;
    }

    if (response.status === 204) return null;
    return response.json();
  }

  function buildRecordApiPath(baseId, tableId, recordId = '') {
    const basePath = `/api/v3/data/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/records`;
    return recordId ? `${basePath}/${encodeURIComponent(recordId)}` : basePath;
  }

  async function readRecord(context, recordId) {
    return apiRequest(buildRecordApiPath(context.baseId, context.tableId, recordId));
  }

  async function updateMindMapData(context, recordId, payload) {
    return apiRequest(buildRecordApiPath(context.baseId, context.tableId), {
      method: 'PATCH',
      body: JSON.stringify([
        {
          id: recordId,
          fields: {
            [DATA_FIELD]: payload,
          },
        },
      ]),
    });
  }

  function unwrapMindMapData(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      if (!trimmed) return null;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error(`${DATA_FIELD} 中存在无法解析的 JSON。`);
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    if (parsed.engine === ENGINE_NAME && parsed.data && typeof parsed.data === 'object') {
      return parsed.data;
    }

    // 兼容早期直接保存 SimpleMindMap 完整数据的情况。
    if (parsed.root && typeof parsed.root === 'object') return parsed;

    return null;
  }

  function makeInitialFullData(record) {
    const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
    const preferredKeys = ['Title', 'Name', '标题', '名称'];
    let text = '';

    for (const key of preferredKeys) {
      if (typeof fields[key] === 'string' && fields[key].trim()) {
        text = fields[key].trim();
        break;
      }
    }

    if (!text) {
      const firstText = Object.entries(fields).find(([key, value]) => (
        key !== DATA_FIELD && typeof value === 'string' && value.trim()
      ));
      if (firstText) text = firstText[1].trim();
    }

    if (!text) text = `Record ${record?.id ?? ''}`.trim();
    if (!text) text = '中心主题';

    return {
      layout: 'mindMap',
      root: {
        data: {
          text,
        },
        children: [],
      },
      theme: {
        template: 'default',
        config: {},
      },
      view: null,
    };
  }

  function wrapMindMapData(fullData) {
    return {
      schemaVersion: SCHEMA_VERSION,
      engine: ENGINE_NAME,
      engineVersion: ENGINE_VERSION,
      data: fullData,
    };
  }

  function buildMindMapIframeUrl() {
    const url = new URL(MINDMAP_WEB_URL);
    url.searchParams.set('embed', '1');
    url.searchParams.set('parentOrigin', unsafeWindow.location.origin);
    return url.toString();
  }

  function createModalShell(recordId) {
    injectStyle();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.innerHTML = `
      <div class="tm-nmm-dialog" role="dialog" aria-modal="true" aria-label="NocoDB 思维导图">
        <div class="tm-nmm-header">
          <div class="tm-nmm-title">思维导图 · Record ${escapeHtml(recordId)}</div>
          <div class="tm-nmm-status" data-state="loading">读取中…</div>
          <button type="button" class="tm-nmm-save" title="保存到 NocoDB">保存</button>
          <div class="tm-nmm-close-wrap">
            <button type="button" class="tm-nmm-close" title="关闭" aria-label="关闭">×</button>
            <div class="tm-nmm-close-popover" hidden>
              <div class="tm-nmm-close-popover-text">有未保存修改</div>
              <div class="tm-nmm-close-popover-actions">
                <button type="button" class="tm-nmm-close-discard">放弃</button>
                <button type="button" class="tm-nmm-close-save">保存</button>
              </div>
            </div>
          </div>
        </div>
        <div class="tm-nmm-frame-wrap">
          <iframe class="tm-nmm-frame" title="MindMap WebUI" src="${escapeHtml(buildMindMapIframeUrl())}"></iframe>
          <div class="tm-nmm-loading">正在读取 NocoDB 记录并加载 MindMap WebUI…</div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function setModalStatus(state, text) {
    const status = modalState?.overlay?.querySelector('.tm-nmm-status');
    if (!status) return;
    status.dataset.state = state;
    status.textContent = text;
  }

  function setModalTitle(text) {
    const title = modalState?.overlay?.querySelector('.tm-nmm-title');
    if (title) title.textContent = text;
  }

  function setFrameMessage(type, text) {
    const frameWrap = modalState?.overlay?.querySelector('.tm-nmm-frame-wrap');
    if (!frameWrap) return;
    frameWrap.querySelector('.tm-nmm-loading, .tm-nmm-error')?.remove();
    const message = document.createElement('div');
    message.className = type === 'error' ? 'tm-nmm-error' : 'tm-nmm-loading';
    message.textContent = text;
    frameWrap.appendChild(message);
  }

  function clearFrameMessage() {
    modalState?.overlay?.querySelector('.tm-nmm-loading, .tm-nmm-error')?.remove();
  }

  function inferRecordTitle(record, recordId) {
    const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
    for (const key of ['Title', 'Name', '标题', '名称']) {
      if (typeof fields[key] === 'string' && fields[key].trim()) return fields[key].trim();
    }

    const firstText = Object.entries(fields).find(([key, value]) => (
      key !== DATA_FIELD && typeof value === 'string' && value.trim()
    ));
    return firstText ? firstText[1].trim() : `Record ${recordId}`;
  }

  function postToMindMap(state, type, payload = {}) {
    const target = state?.iframe?.contentWindow;
    if (!target) return false;
    target.postMessage({
      source: 'nocodb-mindmap',
      type,
      ...payload,
    }, MINDMAP_WEB_ORIGIN);
    return true;
  }

  function sendInitIfReady(state) {
    if (!state || state !== modalState || state.initSent || !state.iframeReady || !state.initialData) return;
    state.initSent = true;
    postToMindMap(state, 'mindmap:init', { data: state.initialData });
    setModalStatus('loading', '初始化编辑器…');
  }

  function showClosePopover(state) {
    if (!state || state !== modalState) return;
    state.overlay.querySelector('.tm-nmm-close-popover')?.removeAttribute('hidden');
  }

  function hideClosePopover(state) {
    if (!state || state !== modalState) return;
    state.overlay.querySelector('.tm-nmm-close-popover')?.setAttribute('hidden', '');
  }

  function destroyMindMapModal(state) {
    if (!state || state !== modalState) return;
    if (state.saveRequestTimer) window.clearTimeout(state.saveRequestTimer);
    state.overlay.remove();
    modalState = null;
  }

  async function saveMindMapPayload(state, data, requestId = null) {
    if (!state || state !== modalState || !data || typeof data !== 'object') return false;

    if (state.savePromise) {
      await state.savePromise;
      if (state !== modalState) return false;
    }

    state.saving = true;
    setModalStatus('saving', '保存中…');
    const payload = wrapMindMapData(data);

    state.savePromise = (async () => {
      try {
        await updateMindMapData(state.context, state.recordId, payload);
        state.lastSavedPayload = payload;
        if (requestId !== null) {
          postToMindMap(state, 'mindmap:save-result', { requestId, ok: true });
        }
        setModalStatus('saved', '✓ 已保存');
        return true;
      } catch (error) {
        console.error('[NocoDB 思维导图] 保存失败:', error);
        const message = error instanceof ApiError && [401, 403].includes(error.status)
          ? 'API Token 无效或权限不足'
          : (error?.message || '保存失败');
        if (requestId !== null) {
          postToMindMap(state, 'mindmap:save-result', { requestId, ok: false, error: message });
        }
        setModalStatus('error', `保存失败：${message}`);
        return false;
      } finally {
        state.saving = false;
        state.savePromise = null;
      }
    })();

    return state.savePromise;
  }

  function finishSaveRequest(state, ok) {
    if (!state || !state.saveRequestResolve) return;
    const resolve = state.saveRequestResolve;
    state.saveRequestResolve = null;
    if (state.saveRequestTimer) {
      window.clearTimeout(state.saveRequestTimer);
      state.saveRequestTimer = 0;
    }
    resolve(Boolean(ok));
  }

  async function requestIframeSave(state) {
    if (!state || state !== modalState) return false;
    if (!state.appReady) {
      setModalStatus('error', '编辑器尚未就绪');
      return false;
    }

    if (state.savePromise) {
      const previousOk = await state.savePromise;
      if (!previousOk || state !== modalState) return false;
      if (!state.dirty) return true;
    }

    if (!state.dirty) {
      setModalStatus('saved', '✓ 无需保存');
      return true;
    }

    if (state.saveRequestPromise) return state.saveRequestPromise;

    state.saveRequestPromise = new Promise((resolve) => {
      state.saveRequestResolve = resolve;
      state.saveRequestTimer = window.setTimeout(() => {
        state.saveRequestTimer = 0;
        state.saveRequestResolve = null;
        state.saveRequestPromise = null;
        setModalStatus('error', '保存请求超时');
        resolve(false);
      }, SAVE_REQUEST_TIMEOUT_MS);
    });

    setModalStatus('saving', '请求保存…');
    postToMindMap(state, 'mindmap:request-save');

    const result = await state.saveRequestPromise;
    if (state === modalState) state.saveRequestPromise = null;
    return result;
  }

  async function requestCloseMindMapModal({ discard = false } = {}) {
    const state = modalState;
    if (!state) return;

    hideClosePopover(state);

    if (discard || !state.dirty) {
      destroyMindMapModal(state);
      return;
    }

    showClosePopover(state);
  }

  async function saveAndCloseMindMapModal() {
    const state = modalState;
    if (!state) return;

    hideClosePopover(state);
    const ok = await requestIframeSave(state);
    if (!ok || state !== modalState) return;

    if (state.dirty) {
      showClosePopover(state);
      return;
    }

    destroyMindMapModal(state);
  }

  async function initializeMindMap(state) {
    try {
      const record = await readRecord(state.context, state.recordId);
      if (state !== modalState) return;

      if (!record?.fields || !Object.prototype.hasOwnProperty.call(record.fields, DATA_FIELD)) {
        throw new Error(`当前表中没有 ${DATA_FIELD} 字段，请先新增 JSON 类型字段。`);
      }

      const storedData = unwrapMindMapData(record.fields[DATA_FIELD]);
      state.initialData = storedData || makeInitialFullData(record);
      state.hadStoredData = Boolean(storedData);
      setModalTitle(`思维导图 · ${inferRecordTitle(record, state.recordId)}`);
      setModalStatus('loading', '等待编辑器…');
      sendInitIfReady(state);
    } catch (error) {
      console.error('[NocoDB 思维导图] 初始化失败:', error);
      const suffix = error instanceof ApiError && [401, 403].includes(error.status)
        ? ' 请重新点击 MindMap Button 并设置可用的 API Token。'
        : '';
      setFrameMessage('error', `${error.message || '初始化失败。'}${suffix}`);
      setModalStatus('error', '打开失败');
    }
  }

  function handleMindMapMessage(event) {
    const state = modalState;
    if (!state) return;
    if (event.origin !== MINDMAP_WEB_ORIGIN) return;
    if (event.source !== state.iframe?.contentWindow) return;

    const message = event.data;
    if (!message || message.source !== 'mind-map-web') return;

    switch (message.type) {
      case 'mindmap:ready':
        state.iframeReady = true;
        sendInitIfReady(state);
        break;
      case 'mindmap:app-ready':
        state.appReady = true;
        clearFrameMessage();
        setModalStatus('saved', state.hadStoredData ? '✓ 已加载' : '新建脑图，尚未保存');
        break;
      case 'mindmap:dirty':
        state.dirty = Boolean(message.dirty);
        if (state.dirty) {
          setModalStatus('dirty', '有未保存修改');
        } else if (!state.saving) {
          setModalStatus('saved', '✓ 已保存');
        }
        break;
      case 'mindmap:save':
        if (!message.data || typeof message.data !== 'object') {
          if (message.requestId) {
            postToMindMap(state, 'mindmap:save-result', {
              requestId: message.requestId,
              ok: false,
              error: 'MindMap WebUI 未提供可保存的数据。',
            });
          }
          finishSaveRequest(state, false);
          break;
        }
        void (async () => {
          const ok = await saveMindMapPayload(state, message.data, message.requestId ?? null);
          if (state === modalState) finishSaveRequest(state, ok);
        })();
        break;
      case 'mindmap:save-status':
        if (!message.ok && message.error) {
          setModalStatus('error', `保存失败：${message.error}`);
        }
        break;
      default:
        break;
    }
  }

  window.addEventListener('message', handleMindMapMessage);

  async function openMindMap(recordId) {
    await ensureDocumentReady();

    if (modalState) {
      if (modalState.recordId === recordId) return;
      if (modalState.dirty) {
        showClosePopover(modalState);
        return;
      }
      destroyMindMapModal(modalState);
    }

    let context;
    try {
      context = getNocoDbContext();
    } catch (error) {
      unsafeWindow.alert(error.message || String(error));
      return;
    }

    const overlay = createModalShell(recordId);
    const iframe = overlay.querySelector('.tm-nmm-frame');
    modalState = {
      overlay,
      iframe,
      recordId,
      context,
      initialData: null,
      hadStoredData: false,
      iframeReady: false,
      appReady: false,
      initSent: false,
      dirty: false,
      saving: false,
      savePromise: null,
      saveRequestPromise: null,
      saveRequestResolve: null,
      saveRequestTimer: 0,
      lastSavedPayload: null,
    };

    overlay.querySelector('.tm-nmm-save').addEventListener('click', () => {
      void requestIframeSave(modalState);
    });

    overlay.querySelector('.tm-nmm-close').addEventListener('click', () => {
      void requestCloseMindMapModal();
    });

    overlay.querySelector('.tm-nmm-close-discard').addEventListener('click', () => {
      void requestCloseMindMapModal({ discard: true });
    });

    overlay.querySelector('.tm-nmm-close-save').addEventListener('click', () => {
      void saveAndCloseMindMapModal();
    });

    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) void requestCloseMindMapModal();
    });

    iframe.addEventListener('error', () => {
      if (modalState?.iframe !== iframe) return;
      setFrameMessage('error', `MindMap WebUI 加载失败：${MINDMAP_WEB_URL}`);
      setModalStatus('error', 'WebUI 加载失败');
    });

    await initializeMindMap(modalState);
  }

  document.addEventListener('keydown', (event) => {
    if (!modalState || event.key !== 'Escape') return;
    if (document.activeElement === modalState.iframe) return;

    const active = document.activeElement;
    const textEditing = active?.matches?.('input, textarea, [contenteditable="true"]');
    if (textEditing) return;

    event.preventDefault();
    event.stopPropagation();
    void requestCloseMindMapModal();
  }, true);

  document.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || !isMindMapUrl(anchor.href)) return;
    event.preventDefault();
    event.stopPropagation();
    void openMindMap(getRecordIdFromUrl(anchor.href));
  }, true);

  unsafeWindow.open = function (url, target, features) {
    if (isMindMapUrl(url)) {
      void openMindMap(getRecordIdFromUrl(url));
      return null;
    }

    return nativeOpen(url, target, features);
  };
})();

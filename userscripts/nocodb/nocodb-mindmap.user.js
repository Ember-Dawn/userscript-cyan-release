// ==UserScript==
// @name         NocoDB 思维导图
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-mindmap.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-mindmap.user.js
// @version      0.1.0
// @description  拦截 NocoDB MindMap Button，在当前页面的大弹窗中使用 SimpleMindMap 编辑 MindMapData JSON，并通过 NocoDB v3 API 自动保存。
// @match        https://nocodb.380782744.xyz/*
// @require      https://unpkg.com/simple-mind-map@0.14.0-fix.3/dist/simpleMindMap.umd.min.js
// @resource     simpleMindMapCss https://unpkg.com/simple-mind-map@0.14.0-fix.3/dist/simpleMindMap.esm.min.css
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const MINDMAP_PATH = '/__mindmap__';
  const DATA_FIELD = 'MindMapData';
  const ENGINE_NAME = 'simple-mind-map';
  const ENGINE_VERSION = '0.14.0-fix.3';
  const SCHEMA_VERSION = 1;
  const SAVE_DELAY_MS = 1500;
  const TOKEN_STORAGE_KEY = 'tm-nocodb-mindmap-api-token-v1';
  const STYLE_ID = 'tm-nocodb-mindmap-style';
  const MODAL_ID = 'tm-nocodb-mindmap-modal';
  const TOKEN_MODAL_ID = 'tm-nocodb-mindmap-token-modal';

  const nativeOpen = unsafeWindow.open.bind(unsafeWindow);

  let modalState = null;
  let tokenDialogState = null;
  let libraryCssInjected = false;

  class ApiError extends Error {
    constructor(message, status = 0, body = '') {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }

  function getMindMapNamespace() {
    const namespace = globalThis.simpleMindMap || unsafeWindow.simpleMindMap;
    return namespace || null;
  }

  function getMindMapConstructor() {
    const namespace = getMindMapNamespace();
    const ctor = namespace?.default || namespace;
    return typeof ctor === 'function' ? ctor : null;
  }

  function injectLibraryCss() {
    if (libraryCssInjected) return;
    const css = GM_getResourceText('simpleMindMapCss');
    if (css) GM_addStyle(css);
    libraryCssInjected = true;
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
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, 0.15);
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
        color: #1f2937;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${MODAL_ID} .tm-nmm-header {
        display: flex;
        align-items: center;
        min-height: 48px;
        gap: 12px;
        padding: 0 14px 0 16px;
        border-bottom: 1px solid #e5e7eb;
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

      #${MODAL_ID} .tm-nmm-status[data-state="saving"] {
        color: #a16207;
      }

      #${MODAL_ID} .tm-nmm-status[data-state="error"] {
        color: #b91c1c;
      }

      #${MODAL_ID} .tm-nmm-close,
      #${MODAL_ID} .tm-nmm-tool,
      #${TOKEN_MODAL_ID} button {
        border: 1px solid #d1d5db;
        border-radius: 7px;
        background: #fff;
        color: #374151;
        cursor: pointer;
        font: inherit;
      }

      #${MODAL_ID} .tm-nmm-close:hover,
      #${MODAL_ID} .tm-nmm-tool:hover,
      #${TOKEN_MODAL_ID} button:hover {
        background: #f3f4f6;
      }

      #${MODAL_ID} .tm-nmm-close {
        width: 32px;
        height: 32px;
        padding: 0;
        font-size: 20px;
        line-height: 28px;
      }

      #${MODAL_ID} .tm-nmm-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        min-height: 42px;
        padding: 5px 10px;
        border-bottom: 1px solid #e5e7eb;
        background: #f8fafc;
      }

      #${MODAL_ID} .tm-nmm-tool {
        min-height: 30px;
        padding: 4px 9px;
        white-space: nowrap;
      }

      #${MODAL_ID} .tm-nmm-tool.tm-nmm-primary {
        border-color: #4f46e5;
        background: #4f46e5;
        color: #fff;
      }

      #${MODAL_ID} .tm-nmm-tool.tm-nmm-primary:hover {
        background: #4338ca;
      }

      #${MODAL_ID} .tm-nmm-separator {
        width: 1px;
        height: 22px;
        margin: 0 2px;
        background: #d1d5db;
      }

      #${MODAL_ID} .tm-nmm-canvas {
        position: relative;
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: #fff;
      }

      #${MODAL_ID} .tm-nmm-canvas * {
        box-sizing: border-box;
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
    else GM_deleteValue(TOKEN_STORAGE_KEY);
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

  async function promptForToken({ force = false } = {}) {
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
        <div class="tm-nmm-token-title">设置 NocoDB API Token</div>
        <div class="tm-nmm-token-help">
          Token 仅保存在 Tampermonkey 当前脚本的本地存储中，不会写入 GitHub。脚本使用它访问当前 NocoDB 的 v3 Data API。
        </div>
        <input type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 NocoDB API Token">
        <div class="tm-nmm-token-actions">
          <button type="button" class="tm-nmm-token-cancel">取消</button>
          <button type="button" class="tm-nmm-token-save">保存</button>
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
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish('');
      }
    });

    tokenDialogState = { overlay, promise };
    requestAnimationFrame(() => input.focus());
    return promise;
  }

  async function apiRequest(path, options = {}) {
    let token = getApiToken();
    if (!token) token = await promptForToken();
    if (!token) throw new Error('未设置 NocoDB API Token。');

    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'xc-token': token,
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ApiError(`NocoDB API 请求失败（HTTP ${response.status}）。`, response.status, body);
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

  function createModalShell(recordId) {
    injectLibraryCss();
    injectStyle();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.innerHTML = `
      <div class="tm-nmm-dialog" role="dialog" aria-modal="true" aria-label="NocoDB 思维导图">
        <div class="tm-nmm-header">
          <div class="tm-nmm-title">思维导图 · Record ${escapeHtml(recordId)}</div>
          <div class="tm-nmm-status" data-state="loading">读取中…</div>
          <button type="button" class="tm-nmm-close" title="关闭" aria-label="关闭">×</button>
        </div>
        <div class="tm-nmm-toolbar">
          <button type="button" class="tm-nmm-tool tm-nmm-primary" data-action="child">+ 子节点</button>
          <button type="button" class="tm-nmm-tool" data-action="sibling">+ 同级节点</button>
          <button type="button" class="tm-nmm-tool" data-action="delete">删除节点</button>
          <span class="tm-nmm-separator" aria-hidden="true"></span>
          <button type="button" class="tm-nmm-tool" data-action="undo">撤销</button>
          <button type="button" class="tm-nmm-tool" data-action="redo">重做</button>
          <button type="button" class="tm-nmm-tool" data-action="tidy">整理布局</button>
          <span class="tm-nmm-separator" aria-hidden="true"></span>
          <button type="button" class="tm-nmm-tool" data-action="zoom-out">−</button>
          <button type="button" class="tm-nmm-tool" data-action="fit">适应画布</button>
          <button type="button" class="tm-nmm-tool" data-action="zoom-in">+</button>
          <span class="tm-nmm-separator" aria-hidden="true"></span>
          <button type="button" class="tm-nmm-tool" data-action="save">立即保存</button>
          <button type="button" class="tm-nmm-tool" data-action="token">API Token</button>
        </div>
        <div class="tm-nmm-canvas">
          <div class="tm-nmm-loading">正在读取 NocoDB 记录…</div>
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

  function setCanvasMessage(type, text) {
    const canvas = modalState?.overlay?.querySelector('.tm-nmm-canvas');
    if (!canvas) return;
    canvas.querySelector('.tm-nmm-loading, .tm-nmm-error')?.remove();
    const message = document.createElement('div');
    message.className = type === 'error' ? 'tm-nmm-error' : 'tm-nmm-loading';
    message.textContent = text;
    canvas.appendChild(message);
  }

  function clearCanvasMessage() {
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

  function scheduleSave() {
    if (!modalState || modalState.closing) return;
    modalState.dirty = true;
    setModalStatus('saving', '有未保存修改');
    window.clearTimeout(modalState.saveTimer);
    modalState.saveTimer = window.setTimeout(() => {
      void saveCurrentMindMap();
    }, SAVE_DELAY_MS);
  }

  async function saveCurrentMindMap({ force = false } = {}) {
    const state = modalState;
    if (!state || !state.mindMap) return true;

    if (!force && !state.dirty) return true;
    if (state.savePromise) {
      state.saveAgain = state.saveAgain || state.dirty || force;
      return state.savePromise;
    }

    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    state.dirty = false;
    setModalStatus('saving', '保存中…');

    const fullData = state.mindMap.getData(true);
    const payload = wrapMindMapData(fullData);

    state.savePromise = (async () => {
      try {
        await updateMindMapData(state.context, state.recordId, payload);
        state.lastSavedPayload = payload;
        setModalStatus('saved', '✓ 已保存');
        return true;
      } catch (error) {
        state.dirty = true;
        console.error('[NocoDB 思维导图] 保存失败:', error);
        const message = error instanceof ApiError && [401, 403].includes(error.status)
          ? '保存失败：API Token 无效或权限不足'
          : '保存失败';
        setModalStatus('error', message);
        return false;
      } finally {
        state.savePromise = null;
      }
    })();

    const ok = await state.savePromise;

    if (state === modalState && state.saveAgain) {
      state.saveAgain = false;
      return saveCurrentMindMap({ force: true });
    }

    return ok;
  }

  function bindMindMapEvents(mindMap) {
    const markDirty = () => scheduleSave();
    mindMap.on('data_change', markDirty);
    mindMap.on('view_data_change', markDirty);
    mindMap.on('layout_change', markDirty);
  }

  function bindToolbar() {
    const toolbar = modalState?.overlay?.querySelector('.tm-nmm-toolbar');
    if (!toolbar) return;

    toolbar.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !modalState?.mindMap) return;

      const mindMap = modalState.mindMap;
      switch (button.dataset.action) {
        case 'child':
          mindMap.execCommand('INSERT_CHILD_NODE');
          break;
        case 'sibling':
          mindMap.execCommand('INSERT_NODE');
          break;
        case 'delete':
          mindMap.execCommand('REMOVE_NODE');
          break;
        case 'undo':
          mindMap.execCommand('BACK');
          break;
        case 'redo':
          mindMap.execCommand('FORWARD');
          break;
        case 'tidy':
          mindMap.execCommand('RESET_LAYOUT');
          break;
        case 'zoom-out':
          mindMap.view.narrow();
          break;
        case 'fit':
          mindMap.view.fit();
          break;
        case 'zoom-in':
          mindMap.view.enlarge();
          break;
        case 'save':
          modalState.dirty = true;
          await saveCurrentMindMap({ force: true });
          break;
        case 'token': {
          const token = await promptForToken({ force: true });
          if (token) setModalStatus('saved', 'API Token 已更新');
          break;
        }
        default:
          break;
      }
    });
  }

  async function closeMindMapModal() {
    const state = modalState;
    if (!state || state.closing) return;
    state.closing = true;

    window.clearTimeout(state.saveTimer);
    const needsSave = state.dirty || Boolean(state.savePromise);
    let saved = true;

    if (needsSave) {
      if (state.savePromise) await state.savePromise;
      if (state.dirty) saved = await saveCurrentMindMap({ force: true });
    }

    if (!saved) {
      const closeAnyway = unsafeWindow.confirm('思维导图尚未成功保存。仍然关闭弹窗吗？');
      if (!closeAnyway) {
        state.closing = false;
        return;
      }
    }

    try {
      state.mindMap?.destroy?.();
    } catch (error) {
      console.warn('[NocoDB 思维导图] destroy failed:', error);
    }

    state.overlay.remove();
    if (modalState === state) modalState = null;
  }

  async function initializeMindMap(state) {
    try {
      const MindMap = getMindMapConstructor();
      if (!MindMap) throw new Error('SimpleMindMap 未成功加载。');

      const record = await readRecord(state.context, state.recordId);
      if (state !== modalState) return;

      if (!record?.fields || !Object.prototype.hasOwnProperty.call(record.fields, DATA_FIELD)) {
        throw new Error(`当前表中没有 ${DATA_FIELD} 字段，请先新增 JSON 类型字段。`);
      }

      const storedData = unwrapMindMapData(record.fields[DATA_FIELD]);
      const fullData = storedData || makeInitialFullData(record);
      const title = inferRecordTitle(record, state.recordId);
      setModalTitle(`思维导图 · ${title}`);

      const canvas = state.overlay.querySelector('.tm-nmm-canvas');
      clearCanvasMessage();

      const mindMap = new MindMap({
        el: canvas,
        data: fullData.root,
        layout: fullData.layout || 'mindMap',
        theme: fullData.theme?.template || 'default',
        themeConfig: fullData.theme?.config || {},
        viewData: fullData.view || null,
        fit: !fullData.view,
        customInnerElsAppendTo: state.overlay.querySelector('.tm-nmm-dialog'),
      });

      state.mindMap = mindMap;
      state.dirty = !storedData;
      bindMindMapEvents(mindMap);
      bindToolbar();

      mindMap.on('node_tree_render_end', () => {
        if (!storedData && state === modalState) mindMap.view.fit();
      });

      setModalStatus(storedData ? 'saved' : 'saving', storedData ? '✓ 已加载' : '新建脑图，待保存');
      if (!storedData) scheduleSave();
    } catch (error) {
      console.error('[NocoDB 思维导图] 初始化失败:', error);
      const suffix = error instanceof ApiError && [401, 403].includes(error.status)
        ? ' 请通过脚本菜单或弹窗工具栏重新设置 API Token。'
        : '';
      const text = `${error.message || '初始化失败。'}${suffix}`;
      setCanvasMessage('error', text);
      setModalStatus('error', '打开失败');
    }
  }

  async function openMindMap(recordId) {
    await ensureDocumentReady();

    if (modalState) {
      if (modalState.recordId === recordId) return;
      await closeMindMapModal();
      if (modalState) return;
    }

    let context;
    try {
      context = getNocoDbContext();
    } catch (error) {
      unsafeWindow.alert(error.message || String(error));
      return;
    }

    const overlay = createModalShell(recordId);
    modalState = {
      overlay,
      recordId,
      context,
      mindMap: null,
      dirty: false,
      saveTimer: 0,
      savePromise: null,
      saveAgain: false,
      closing: false,
      lastSavedPayload: null,
    };

    overlay.querySelector('.tm-nmm-close').addEventListener('click', () => {
      void closeMindMapModal();
    });

    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) void closeMindMapModal();
    });

    await initializeMindMap(modalState);
  }

  document.addEventListener('keydown', (event) => {
    if (!modalState) return;
    if (event.key !== 'Escape') return;

    const active = document.activeElement;
    const textEditing = active?.matches?.('input, textarea, [contenteditable="true"], .ProseMirror');
    if (textEditing) return;

    event.preventDefault();
    event.stopPropagation();
    void closeMindMapModal();
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

  GM_registerMenuCommand('设置 NocoDB MindMap API Token', () => {
    void promptForToken({ force: true });
  });

  GM_registerMenuCommand('清除 NocoDB MindMap API Token', () => {
    GM_deleteValue(TOKEN_STORAGE_KEY);
    unsafeWindow.alert('已清除 NocoDB MindMap API Token。');
  });
})();

// ==UserScript==
// @name         NocoDB Markdown 表格
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @version      0.3.4
// @description  在 NocoDB Rich Text 中内嵌显示 Markdown 表格并直接编辑单元格
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

/*
 * =============================================================================
 * NocoDB Markdown 表格：当前实现说明
 * =============================================================================
 *
 * 一、持久化格式
 * -----------------------------------------------------------------------------
 * NocoDB CE 的 LongText Rich Text 目前没有原生 table/tableRow/tableCell 节点。
 * 为避免裸 Markdown 表格在 Markdown -> Tiptap -> Markdown 往返过程中被压平，
 * 本脚本把表格源码保存在 NocoDB 原生支持的代码块中：
 *
 *   ```nocodb-table
 *   [[NOCODB_MARKDOWN_TABLE:v1:7f3a91c4b2de]]
 *   | 姓名 | 年龄 | 城市 |
 *   | --- | --- | --- |
 *   | 小明 | 25 | 北京 |
 *   ```
 *
 * - nocodb-table：专用代码块语言，用于与普通代码块区分；
 * - NOCODB_MARKDOWN_TABLE：完整、可读的内部类型名称；
 * - v1：持久化格式版本，不等于脚本版本；
 * - 最后一段：当前表格的唯一 ID，用于区分同一笔记中的多张表格。
 *
 * 旧格式 [[NOCODB_MARKDOWN_TABLE_V1]] 仍然可以读取；旧表格在第一次保存时
 * 自动升级为新标记与 nocodb-table 语言。
 *
 * 二、界面原则
 * -----------------------------------------------------------------------------
 * - 浏览状态只显示表格本身；
 * - 鼠标移入时，右上角显示复制、编辑与删除按钮；
 * - 删除按钮使用贴近按钮的小型二次确认浮层，确认后才删除整个表格代码块；
 * - 双击任意单元格也可以进入编辑状态；
 * - 编辑状态顶部仅保留“新增行 / 新增列 / 取消 / 保存”；
 * - 列操作收进对应表头的三点菜单；
 * - 行操作收进对应数据行的三点菜单；
 * - 所有内容统一左对齐，不再保存或编辑对齐信息；
 * - 保存成功使用短暂 Toast，不常驻状态栏；
 * - 编辑时点击当前表格以外的位置会自动保存；未修改时直接退出编辑。
 *
 * 三、渲染架构与性能
 * -----------------------------------------------------------------------------
 * - 油猴外壳只负责把主体注入网页主环境；
 * - 页面只注册一个 paste 事件；
 * - 全局 MutationObserver 只发现新增或移除的 Rich Text 编辑器；
 * - 不扫描正文代码块，不轮询，不监听滚动，不做坐标测量；
 * - 使用 ProseMirror codeBlock NodeView，在正文排版流中显示表格；
 * - 浏览状态渲染普通 table，编辑状态优先创建独立 Tiptap table 文档；
 * - 宿主未暴露 Tiptap Node 工厂时回退为 input 编辑，不尝试替换宿主 editor；
 * - 表格更新仅替换对应的一个 codeBlock 节点。
 *
 * 四、格式边界
 * -----------------------------------------------------------------------------
 * - 支持标准矩形 Markdown 表格；
 * - 识别阶段兼容 1 个及以上连字符的分隔行；
 * - 原有 :---、:---:、---: 对齐标记可以读取，但保存时统一输出 ---；
 * - 支持首尾竖线可有可无；
 * - 支持 \| 转义和简单行内代码中的竖线；
 * - 不支持跨行/跨列合并；
 * - 不支持单元格内真实换行或多段落；
 * - 单次自动转换最多 200 行、40 列、4000 个单元格、100000 个字符。
 *
 * =============================================================================
 */

function nocodbMarkdownTablePageMain() {
  'use strict';

  const EDITOR_SELECTOR = '.nc-rich-text-content .tiptap.ProseMirror';
  const CODE_BLOCK_LANGUAGE = 'nocodb-table';
  const MARKER_TYPE = 'NOCODB_MARKDOWN_TABLE';
  const MARKER_VERSION = 'v1';
  const LEGACY_MARKER = '[[NOCODB_MARKDOWN_TABLE_V1]]';
  const NEW_MARKER_PATTERN = /^\[\[NOCODB_MARKDOWN_TABLE:v1:([A-Za-z0-9_-]{6,64})\]\]$/;

  const STYLE_ID = 'tm-nocodb-markdown-table-style-v31';
  const NODEVIEW_CLASS = 'tm-nocodb-markdown-table-v31';

  const MAX_SOURCE_CHARS = 100000;
  const MAX_MIXED_SOURCE_CHARS = 300000;
  const MAX_MIXED_TABLES = 24;
  const MAX_COLUMNS = 40;
  const MAX_BODY_ROWS = 200;
  const MAX_CELLS = 4000;
  const DISCOVERY_RETRY_LIMIT = 30;
  const DISCOVERY_RETRY_DELAY = 100;
  const PASTE_RETRY_LIMIT = 30;
  const PASTE_RETRY_DELAY = 50;
  const READY_ATTR = 'data-tm-nmt-ready';
  const STATE_ATTR = 'data-tm-nmt-state';
  const PAGE_GUARD = '__NOCODB_MARKDOWN_TABLE_PAGE_V31__';

  const TEST_MODE = globalThis.__NOCODB_MARKDOWN_TABLE_TEST_MODE__ === true;
  if (!TEST_MODE) {
    if (globalThis[PAGE_GUARD] === 'ready') return;
    globalThis[PAGE_GUARD] = 'loading';
  }

  /** @type {Map<HTMLElement, EditorSession>} */
  const sessions = new Map();
  /** @type {WeakMap<HTMLElement, {attempts: number, timer: number}>} */
  const discoveryStates = new WeakMap();

  /**
   * @typedef {{ headers: string[], rows: string[][] }} TableModel
   * @typedef {{ id: string|null, legacy: boolean, markerLine: string, model: TableModel, sourceHash: string }} StoredTable
   * @typedef {{
   *   editorDom: HTMLElement,
   *   tiptap: any,
   *   view: any,
   *   originalNodeViews: Record<string, Function>,
   *   originalCodeBlockNodeView: Function|null,
   *   nodeViewFactory: Function,
   *   tableNodeViewCount: number,
   *   destroyed: boolean
   * }} EditorSession
   */

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${NODEVIEW_CLASS} {
        position: relative;
        width: 100%;
        max-width: 100%;
        margin: 10px 0;
        box-sizing: border-box;
        color: var(--nc-content-gray, #1f2937);
      }

      .${NODEVIEW_CLASS},
      .${NODEVIEW_CLASS} * {
        box-sizing: border-box;
      }

      .${NODEVIEW_CLASS}.ProseMirror-selectednode {
        outline: 2px solid color-mix(in srgb, var(--nc-primary, #6c5ce7) 42%, transparent);
        outline-offset: 3px;
        border-radius: 9px;
      }

      .tm-nmt-scroll-v31 {
        width: 100%;
        max-width: 100%;
        overflow: auto;
        max-height: min(66vh, 680px);
        border-radius: 8px;
      }

      .tm-nmt-table-v31 {
        width: 100%;
        min-width: 360px;
        border-collapse: separate;
        border-spacing: 0;
        table-layout: auto;
        border: 1px solid color-mix(in srgb, var(--nc-border-gray-medium, #d1d5db) 68%, var(--nc-content-gray, #1f2937) 32%);
        border-radius: 8px;
        overflow: hidden;
        background: var(--nc-bg-default, #fff);
      }

      .tm-nmt-table-v31 th,
      .tm-nmt-table-v31 td {
        min-width: 96px;
        padding: 8px 10px;
        border-right: 1px solid color-mix(in srgb, var(--nc-border-gray-light, #e5e7eb) 72%, var(--nc-content-gray, #1f2937) 28%);
        border-bottom: 1px solid color-mix(in srgb, var(--nc-border-gray-light, #e5e7eb) 72%, var(--nc-content-gray, #1f2937) 28%);
        vertical-align: top;
        text-align: left;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .tm-nmt-table-v31 tr > :last-child {
        border-right: 0;
      }

      .tm-nmt-table-v31 tbody tr:last-child > * {
        border-bottom: 0;
      }

      .tm-nmt-table-v31 thead th {
        font-weight: 650;
        background: var(--nc-bg-gray-light, #f5f5f6);
        border-bottom-color: color-mix(in srgb, var(--nc-border-gray-medium, #d1d5db) 62%, var(--nc-content-gray, #1f2937) 38%);
      }

      .tm-nmt-table-v31 tbody tr:hover > td {
        background: color-mix(in srgb, var(--nc-bg-gray-light, #f5f5f6) 58%, transparent);
      }

      .tm-nmt-empty-v31 {
        padding: 18px !important;
        text-align: center !important;
        color: var(--nc-content-gray-subtle, #777);
      }

      .tm-nmt-delete-trigger-v31,
      .tm-nmt-copy-trigger-v31 {
        position: absolute;
        top: 7px;
        z-index: 4;
        width: 30px;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 1px solid rgba(31, 41, 55, 0.20);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.96);
        color: #374151;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10);
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-2px);
        transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
      }

      .tm-nmt-delete-trigger-v31 {
        right: 7px;
        color: #b91c1c;
      }

      .tm-nmt-copy-trigger-v31 {
        right: 43px;
      }

      .${NODEVIEW_CLASS}:hover .tm-nmt-delete-trigger-v31,
      .${NODEVIEW_CLASS}:hover .tm-nmt-copy-trigger-v31,
      .${NODEVIEW_CLASS}:focus-within .tm-nmt-delete-trigger-v31,
      .${NODEVIEW_CLASS}:focus-within .tm-nmt-copy-trigger-v31 {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .tm-nmt-delete-trigger-v31:hover {
        background: #f3f4f6;
      }

      .tm-nmt-copy-trigger-v31:hover {
        background: #f3f4f6;
      }

      .tm-nmt-delete-trigger-v31:hover {
        background: #fef2f2;
      }

      .tm-nmt-delete-trigger-v31 svg,
      .tm-nmt-copy-trigger-v31 svg {
        width: 15px;
        height: 15px;
        pointer-events: none;
      }

      .tm-nmt-delete-confirm-v31 {
        position: absolute;
        top: 37px;
        right: 7px;
        z-index: 6;
        width: 190px;
        max-width: calc(100% - 16px);
        padding: 12px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.99);
        color: #222;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        user-select: none;
      }

      .tm-nmt-delete-confirm-title-v31 {
        margin: 0 0 10px;
        font-size: 13px;
        line-height: 1.45;
        font-weight: 600;
      }

      .tm-nmt-delete-confirm-actions-v31 {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .tm-nmt-delete-confirm-v31 button {
        min-width: 58px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 7px;
        background: #fff;
        color: #333;
        font: inherit;
        cursor: pointer;
      }

      .tm-nmt-delete-confirm-v31 button:hover {
        background: #f5f5f5;
      }

      .tm-nmt-delete-confirm-v31 .tm-nmt-delete-confirm-submit-v31 {
        border-color: #dc2626;
        background: #dc2626;
        color: #fff;
      }

      .tm-nmt-delete-confirm-v31 .tm-nmt-delete-confirm-submit-v31:hover {
        background: #b91c1c;
      }

      .tm-nmt-menu-v31 {
        position: absolute;
        z-index: 30;
        min-width: 142px;
        padding: 5px;
        border: 1px solid rgba(31, 41, 55, 0.18);
        border-radius: 7px;
        background: var(--nc-bg-default, #fff);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
      }

      .tm-nmt-menu-item-v31 {
        width: 100%;
        min-height: 31px;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 5px 9px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }

      .tm-nmt-menu-item-v31 svg {
        flex: 0 0 16px;
        width: 16px;
        height: 16px;
        pointer-events: none;
      }

      .tm-nmt-menu-item-v31:hover {
        background: var(--nc-bg-gray-medium, #ececee);
      }

      .tm-nmt-menu-item-v31.is-danger {
        color: #b42318;
      }

      .tm-nmt-menu-item-v31:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .tm-nmt-inline-table .tm-nmt-inline-cell { position: relative; padding: 0 !important; }
      .tm-nmt-inline-content { display: block; min-height: 28px; padding: 7px 10px; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; outline: none; cursor: text; }
      .tm-nmt-inline-content:focus { box-shadow: inset 0 0 0 2px var(--nc-primary-color, #3883e2); border-radius: 2px; }
      .tm-nmt-inline-context { z-index: 2147483646; min-width: 172px; }
      .tm-nmt-inline-cell.tm-nmt-range-selected { background: color-mix(in srgb, var(--nc-primary-color, #3883e2) 18%, var(--nc-bg-default, #fff)) !important; }
      .tm-nmt-inline-cell.tm-nmt-range-selected .tm-nmt-inline-content { box-shadow: inset 0 0 0 1px var(--nc-primary-color, #3883e2); }
      .tm-nmt-inline-table.tm-nmt-drag-selecting { user-select: none; -webkit-user-select: none; }
      .tm-nmt-toast-v31 {
        position: fixed;
        right: 22px;
        bottom: 22px;
        z-index: 100000;
        max-width: min(420px, calc(100vw - 44px));
        padding: 9px 12px;
        border: 1px solid rgba(0, 0, 0, 0.14);
        border-radius: 8px;
        background: rgba(31, 41, 55, 0.96);
        color: #fff;
        font-size: 13px;
        line-height: 1.45;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
        pointer-events: none;
      }

      .tm-nmt-toast-v31.is-error {
        background: rgba(180, 35, 24, 0.97);
      }
    `;
    document.head.appendChild(style);
  }

  function cloneModel(model) {
    return {
      headers: [...model.headers],
      rows: model.rows.map((row) => [...row]),
    };
  }

  function modelHash(model) {
    return JSON.stringify(model);
  }

  function isEscapedAt(text, index) {
    let slashCount = 0;
    for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) slashCount += 1;
    return slashCount % 2 === 1;
  }

  function trimOuterPipe(line) {
    let value = line.trim();
    if (value.startsWith('|')) value = value.slice(1);
    const last = value.length - 1;
    if (last >= 0 && value[last] === '|' && !isEscapedAt(value, last)) value = value.slice(0, -1);
    return value;
  }

  function unescapeCell(value) {
    let result = '';
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      const next = value[i + 1];
      if (char === '\\' && (next === '|' || next === '\\')) {
        result += next;
        i += 1;
      } else {
        result += char;
      }
    }
    return result.trim();
  }

  function splitMarkdownRow(line) {
    const value = trimOuterPipe(line);
    const cells = [];
    let buffer = '';
    let escaped = false;
    let activeBacktickRun = 0;

    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];

      if (escaped) {
        buffer += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        buffer += char;
        escaped = true;
        continue;
      }

      if (char === '`') {
        let run = 1;
        while (value[i + run] === '`') run += 1;
        buffer += '`'.repeat(run);
        if (activeBacktickRun === 0) activeBacktickRun = run;
        else if (activeBacktickRun === run) activeBacktickRun = 0;
        i += run - 1;
        continue;
      }

      if (char === '|' && activeBacktickRun === 0) {
        cells.push(unescapeCell(buffer));
        buffer = '';
        continue;
      }

      buffer += char;
    }

    cells.push(unescapeCell(buffer));
    return cells;
  }

  function isValidSeparatorCell(cell) {
    return /^:?-{1,}:?$/.test(cell.trim());
  }

  function normalizeSourceLines(source) {
    return source
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[\t ]+$/g, ''));
  }

  /** @returns {TableModel|null} */
  function parseMarkdownTable(source) {
    if (typeof source !== 'string' || source.length === 0 || source.length > MAX_SOURCE_CHARS) return null;

    const lines = normalizeSourceLines(source);
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    if (lines.length < 2 || lines.length > MAX_BODY_ROWS + 2) return null;
    if (!lines[0].includes('|') || !lines[1].includes('|')) return null;
    if (lines.some((line) => !line.trim() || !line.includes('|'))) return null;

    const headers = splitMarkdownRow(lines[0]);
    const separator = splitMarkdownRow(lines[1]);
    if (headers.length < 2 || headers.length > MAX_COLUMNS || separator.length !== headers.length) return null;
    if (separator.some((cell) => !isValidSeparatorCell(cell))) return null;

    const rows = [];
    for (const line of lines.slice(2)) {
      const row = splitMarkdownRow(line);
      if (row.length !== headers.length) return null;
      rows.push(row);
    }

    const cellCount = headers.length * (rows.length + 1);
    if (rows.length > MAX_BODY_ROWS || cellCount > MAX_CELLS) return null;

    return { headers, rows };
  }

  function escapeCell(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .trim();
  }

  function serializeMarkdownTable(model) {
    const header = `| ${model.headers.map(escapeCell).join(' | ')} |`;
    const separator = `| ${model.headers.map(() => '---').join(' | ')} |`;
    const rows = model.rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`);
    return [header, separator, ...rows].join('\n');
  }

  function createTableId() {
    try {
      if (globalThis.crypto?.getRandomValues) {
        const bytes = new Uint8Array(6);
        globalThis.crypto.getRandomValues(bytes);
        return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) {}

    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 16);
  }

  function buildMarkerLine(id) {
    return `[[${MARKER_TYPE}:${MARKER_VERSION}:${id}]]`;
  }

  function parseMarkerLine(line) {
    const value = String(line || '').trim();
    const current = value.match(NEW_MARKER_PATTERN);
    if (current) return { id: current[1], legacy: false, markerLine: value };
    if (value === LEGACY_MARKER) return { id: null, legacy: true, markerLine: value };
    return null;
  }

  function buildStoredText(model, id = createTableId()) {
    return `${buildMarkerLine(id)}\n${serializeMarkdownTable(model)}`;
  }

  /** @returns {StoredTable|null} */
  function parseStoredText(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SOURCE_CHARS + 256) return null;

    const lines = raw.replace(/\u200B/g, '').replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length) return null;

    const marker = parseMarkerLine(lines[0]);
    if (!marker) return null;

    const source = lines.slice(1).join('\n');
    const model = parseMarkdownTable(source);
    if (!model) return null;

    return {
      ...marker,
      model,
      sourceHash: modelHash(model),
    };
  }

  function unwrapEditorCandidate(value) {
    let candidate = value;
    const seen = new Set();

    for (let depth = 0; depth < 8 && candidate && !seen.has(candidate); depth += 1) {
      seen.add(candidate);

      if (
        candidate?.view?.state?.schema &&
        candidate?.state?.schema &&
        candidate?.commands &&
        typeof candidate?.chain === 'function'
      ) {
        return candidate;
      }

      let next = null;
      try {
        if (candidate && typeof candidate === 'object' && 'value' in candidate) next = candidate.value;
      } catch (_) {}
      if (!next) {
        try {
          if (candidate && typeof candidate === 'object' && '_value' in candidate) next = candidate._value;
        } catch (_) {}
      }
      if (!next) {
        try {
          if (candidate && typeof candidate === 'object' && candidate.editor) next = candidate.editor;
        } catch (_) {}
      }

      if (!next || next === candidate) break;
      candidate = next;
    }

    return null;
  }

  function findEditorInComponent(startComponent) {
    let component = startComponent;
    const seen = new Set();

    while (component && !seen.has(component)) {
      seen.add(component);

      const sources = [
        component,
        component.setupState,
        component.devtoolsRawSetupState,
        component.ctx,
        component.exposed,
        component.proxy,
        component.proxy?.$,
        component.proxy?.$?.setupState,
      ];

      for (const source of sources) {
        if (!source) continue;
        for (const key of ['editor', 'editorRef', 'tiptap', 'tiptapEditor']) {
          let value = null;
          try {
            value = source[key];
          } catch (_) {}
          const editor = unwrapEditorCandidate(value);
          if (editor) return editor;
        }
      }

      component = component.parent;
    }

    return null;
  }

  function findTiptapEditor(editorDom) {
    if (!(editorDom instanceof HTMLElement)) return null;

    let element = editorDom;
    const seenComponents = new Set();

    for (let depth = 0; element && depth < 18; depth += 1, element = element.parentElement) {
      const directCandidates = [
        element.editor,
        element.tiptap,
        element.__editor,
        element.__tiptapEditor,
      ];

      for (const value of directCandidates) {
        const editor = unwrapEditorCandidate(value);
        if (editor) return editor;
      }

      const componentCandidates = [
        element.__vueParentComponent,
        element.__vue_app__?._instance,
      ];

      for (const component of componentCandidates) {
        if (!component || seenComponents.has(component)) continue;
        seenComponents.add(component);
        const editor = findEditorInComponent(component);
        if (editor) return editor;
      }
    }

    return null;
  }

  function setEditorConnectionState(editorDom, state) {
    if (!(editorDom instanceof HTMLElement)) return;
    editorDom.setAttribute(STATE_ATTR, state);
    if (state === 'ready') editorDom.setAttribute(READY_ATTR, '1');
    else editorDom.removeAttribute(READY_ATTR);
  }

  function showToast(message, kind = 'success', duration = 1800) {
    if (!message || !document.body) return;

    const old = document.querySelector('.tm-nmt-toast-v31');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.className = `tm-nmt-toast-v31${kind === 'error' ? ' is-error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), duration);
  }

  function languageAttrsForNodeType(nodeType, baseAttrs = {}) {
    const attrs = { ...baseAttrs };
    const declared = nodeType?.spec?.attrs || {};

    if (Object.prototype.hasOwnProperty.call(declared, 'language')) attrs.language = CODE_BLOCK_LANGUAGE;
    else if (Object.prototype.hasOwnProperty.call(declared, 'lang')) attrs.lang = CODE_BLOCK_LANGUAGE;
    else if (Object.prototype.hasOwnProperty.call(declared, 'params')) attrs.params = CODE_BLOCK_LANGUAGE;

    return attrs;
  }

  function createFallbackCodeBlockNodeView(node) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const language = node?.attrs?.language || node?.attrs?.lang || node?.attrs?.params || '';

    if (language) code.className = `language-${language}`;
    pre.appendChild(code);

    return {
      dom: pre,
      contentDOM: code,
    };
  }

  function stopPointerEvent(event, preventDefault = true) {
    if (preventDefault) event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function makeCopyTrigger(onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tm-nmt-copy-trigger-v31';
    button.title = '复制 Markdown 表格';
    button.setAttribute('aria-label', '复制 Markdown 表格');
    button.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
        <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" stroke-width="1.3"/>
      </svg>`;
    button.addEventListener('pointerdown', (event) => stopPointerEvent(event));
    button.addEventListener('click', (event) => {
      stopPointerEvent(event);
      onClick();
    });
    return button;
  }

  async function copyMarkdownTable(model) {
    const markdown = serializeMarkdownTable(model);
    try {
      await navigator.clipboard.writeText(markdown);
      showToast('已复制 Markdown 表格', 'success', 1600);
    } catch (_) {
      showToast('复制失败：请检查剪贴板权限。', 'error', 3600);
    }
  }

  function makeDeleteTrigger(onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tm-nmt-delete-trigger-v31';
    button.title = '删除表格';
    button.setAttribute('aria-label', '删除表格');
    button.innerHTML = `
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.058l-.5-8.5a.5.5 0 1 0-.998.058m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"></path>
      </svg>`;

    button.addEventListener('pointerdown', (event) => stopPointerEvent(event));
    button.addEventListener('click', (event) => {
      stopPointerEvent(event);
      onClick();
    });
    return button;
  }

  function makeMenuItem(label, onClick, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-nmt-menu-item-v31${options.danger ? ' is-danger' : ''}`;
    const icons = {
      '在上方插入行': '<path d="M4 11h16M4 17h16M12 3v6m-3-3h6"/>',
      '在下方插入行': '<path d="M4 7h16M4 13h16M12 15v6m-3-3h6"/>',
      '在左侧插入列': '<path d="M13 4v16M19 4v16M3 12h7m-3-3 3 3-3 3"/>',
      '在右侧插入列': '<path d="M5 4v16M11 4v16m3-8h7m-3-3 3 3-3 3"/>',
      '删除当前行': '<path d="M4 8h16M4 16h16m-9-6 4 4m0-4-4 4"/>',
      '删除当前列': '<path d="M7 4v16m10-16v16m-7-9 4 4m0-4-4 4"/>',
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    // Icon geometry is a fixed local whitelist, never interpolated from page text.
    svg.innerHTML = icons[label] || '<path d="M12 5v14M5 12h14"/>';
    const textLabel = document.createElement('span');
    textLabel.textContent = label;
    button.append(svg, textLabel);
    button.disabled = Boolean(options.disabled);
    button.addEventListener('pointerdown', (event) => stopPointerEvent(event));
    button.addEventListener('click', (event) => {
      stopPointerEvent(event);
      if (!button.disabled) onClick();
    });
    return button;
  }

  function canInsertRow(model) {
    return model.rows.length < MAX_BODY_ROWS && model.headers.length * (model.rows.length + 2) <= MAX_CELLS;
  }

  function canInsertColumn(model) {
    return model.headers.length < MAX_COLUMNS && (model.headers.length + 1) * (model.rows.length + 1) <= MAX_CELLS;
  }

  function insertRow(model, index) {
    if (!canInsertRow(model)) return false;
    const safeIndex = Math.max(0, Math.min(index, model.rows.length));
    model.rows.splice(safeIndex, 0, Array(model.headers.length).fill(''));
    return true;
  }

  function deleteRow(model, index) {
    if (index < 0 || index >= model.rows.length) return false;
    model.rows.splice(index, 1);
    return true;
  }

  function insertColumn(model, index) {
    if (!canInsertColumn(model)) return false;
    const safeIndex = Math.max(0, Math.min(index, model.headers.length));
    model.headers.splice(safeIndex, 0, '');
    model.rows.forEach((row) => row.splice(safeIndex, 0, ''));
    return true;
  }

  function deleteColumn(model, index) {
    if (model.headers.length <= 1 || index < 0 || index >= model.headers.length) return false;
    model.headers.splice(index, 1);
    model.rows.forEach((row) => row.splice(index, 1));
    return true;
  }

  function createTableNodeView(session, initialNode, editorView, getPos, initialStored) {
    session.tableNodeViewCount += 1;

    let currentNode = initialNode;
    let stored = initialStored;
    let editing = false;
    let draft = null;
    let confirmingDelete = false;
    let outsidePointerDownHandler = null;
    let outsideDeleteConfirmHandler = null;
    let destroyed = false;
    let contextMenu = null;
    let selectionRange = null;
    let dragAnchor = null;
    let dragPointerId = null;
    let dragMoved = false;
    const undoStack = [];
    const redoStack = [];
    let lastTextEdit = { row: null, col: null, time: 0 };
    let activeCell = null;
    let composing = false;

    const dom = document.createElement('div');
    dom.className = NODEVIEW_CLASS;
    dom.contentEditable = 'false';
    dom.dataset.nocodbMarkdownTableId = stored.id || 'legacy';

    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) => {
      dom.addEventListener(type, (event) => event.stopPropagation());
    });

    function isEditable() {
      return session.tiptap.isEditable !== false && session.editorDom.getAttribute('contenteditable') !== 'false';
    }

    function stopOutsideAutoSave() {
      if (!outsidePointerDownHandler) return;
      document.removeEventListener('pointerdown', outsidePointerDownHandler, true);
      outsidePointerDownHandler = null;
    }

    function startOutsideAutoSave() {
      if (outsidePointerDownHandler || destroyed) return;

      outsidePointerDownHandler = (event) => {
        if (!editing || destroyed) return;
        const target = event.target;
        if (target instanceof Node && (dom.contains(target) || contextMenu?.contains(target))) return;

        const saved = saveEditing();
        if (saved) return;

        // 保存失败时保留编辑状态，并阻止关闭弹窗、切换记录等外部操作。
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      };

      document.addEventListener('pointerdown', outsidePointerDownHandler, true);
    }

    function stopOutsideDeleteConfirm() {
      if (!outsideDeleteConfirmHandler) return;
      document.removeEventListener('pointerdown', outsideDeleteConfirmHandler, true);
      outsideDeleteConfirmHandler = null;
    }

    function hideDeleteConfirm() {
      stopOutsideDeleteConfirm();
      if (!confirmingDelete) return;
      confirmingDelete = false;
      rerender();
    }

    function startOutsideDeleteConfirm() {
      if (outsideDeleteConfirmHandler || destroyed) return;

      outsideDeleteConfirmHandler = (event) => {
        if (!confirmingDelete || destroyed) return;
        const target = event.target;
        if (target instanceof Node && dom.contains(target)) return;
        hideDeleteConfirm();
      };

      document.addEventListener('pointerdown', outsideDeleteConfirmHandler, true);
    }

    function showDeleteConfirm() {
      if (!isEditable() || destroyed) return;
      closeContextMenu();
      clearSelectionRange();
      confirmingDelete = true;
      rerender();
      startOutsideDeleteConfirm();
    }

    function deleteTable() {
      let position;
      try {
        position = getPos();
      } catch (_) {
        position = null;
      }

      if (!Number.isInteger(position)) {
        hideDeleteConfirm();
        showToast('删除失败：无法定位原表格代码块。', 'error', 3600);
        return false;
      }

      const state = editorView.state;
      const liveNode = state.doc.nodeAt(position);
      const liveStored = liveNode ? parseStoredText(liveNode.textContent || '') : null;
      const sameTable =
        liveNode &&
        liveNode.type === currentNode.type &&
        liveStored &&
        liveStored.id === stored.id &&
        liveStored.sourceHash === stored.sourceHash;

      if (!sameTable) {
        hideDeleteConfirm();
        showToast('删除失败：原表格代码块已发生变化。', 'error', 3600);
        return false;
      }

      stopOutsideDeleteConfirm();
      confirmingDelete = false;

      try {
        editorView.dispatch(
          state.tr.delete(position, position + liveNode.nodeSize).scrollIntoView(),
        );
        showToast('已删除表格', 'success', 1600);
        return true;
      } catch (_) {
        confirmingDelete = true;
        rerender();
        startOutsideDeleteConfirm();
        showToast('删除失败：NocoDB 拒绝了本次表格删除。', 'error', 3600);
        return false;
      }
    }

    function renderDeleteConfirm() {
      const panel = document.createElement('div');
      panel.className = 'tm-nmt-delete-confirm-v31';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', '确认删除表格');

      const title = document.createElement('div');
      title.className = 'tm-nmt-delete-confirm-title-v31';
      title.textContent = '确认删除这个 Markdown 表格？';

      const actions = document.createElement('div');
      actions.className = 'tm-nmt-delete-confirm-actions-v31';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = '取消';
      cancelButton.addEventListener('pointerdown', (event) => stopPointerEvent(event));
      cancelButton.addEventListener('click', (event) => {
        stopPointerEvent(event);
        hideDeleteConfirm();
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'tm-nmt-delete-confirm-submit-v31';
      deleteButton.textContent = '确认删除';
      deleteButton.addEventListener('pointerdown', (event) => stopPointerEvent(event));
      deleteButton.addEventListener('click', (event) => {
        stopPointerEvent(event);
        deleteTable();
      });

      actions.append(cancelButton, deleteButton);
      panel.append(title, actions);
      dom.appendChild(panel);
    }

    function closeContextMenu() {
      if (!contextMenu) return;
      contextMenu.remove();
      contextMenu = null;
    }

    function clearSelectionRange() {
      selectionRange = null;
      dragAnchor = null;
      dragPointerId = null;
      dragMoved = false;
      dom.querySelectorAll('.tm-nmt-range-selected').forEach(el => el.classList.remove('tm-nmt-range-selected'));
      dom.querySelector('.tm-nmt-inline-table')?.classList.remove('tm-nmt-drag-selecting');
    }

    function normalizedSelection() {
      if (!selectionRange) return null;
      const { start, end } = selectionRange;
      return {
        r1: Math.min(start.row, end.row),
        r2: Math.max(start.row, end.row),
        c1: Math.min(start.col, end.col),
        c2: Math.max(start.col, end.col),
      };
    }

    function paintSelection() {
      const range = normalizedSelection();
      dom.querySelectorAll('.tm-nmt-inline-cell').forEach(cell => {
        const value = cell.querySelector('.tm-nmt-inline-content');
        const row = Number(value?.dataset.row);
        const col = Number(value?.dataset.col);
        cell.classList.toggle('tm-nmt-range-selected', !!range &&
          row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2);
      });
    }

    // Selection remains independent of the browser's text selection. A drag that
    // never leaves its first cell retains normal text-selection behaviour.
    function extendCellRange(row, col) {
      if (!dragAnchor) return;
      if (row === dragAnchor.row && col === dragAnchor.col && !dragMoved) return;
      dragMoved = true;
      selectionRange = { start: { ...dragAnchor }, end: { row, col } };
      dom.querySelector('.tm-nmt-inline-table')?.classList.add('tm-nmt-drag-selecting');
      window.getSelection()?.removeAllRanges();
      paintSelection();
    }

    function finishCellDrag() {
      dragAnchor = null;
      dragPointerId = null;
      dom.querySelector('.tm-nmt-inline-table')?.classList.remove('tm-nmt-drag-selecting');
    }

    function captureCaret() {
      const cell = document.activeElement?.closest?.('.tm-nmt-inline-content');
      if (!cell || !dom.contains(cell)) return activeCell ? { ...activeCell } : null;
      const location = { row: Number(cell.dataset.row), col: Number(cell.dataset.col), anchor: 0, focus: 0 };
      const selection = window.getSelection();
      if (selection?.rangeCount && cell.contains(selection.anchorNode) && cell.contains(selection.focusNode)) {
        const offset = (node, value) => {
          const r = document.createRange();
          r.selectNodeContents(cell);
          r.setEnd(node, value);
          return r.toString().length;
        };
        try {
          location.anchor = offset(selection.anchorNode, selection.anchorOffset);
          location.focus = offset(selection.focusNode, selection.focusOffset);
        } catch (_) {}
      } else if (activeCell?.row === location.row && activeCell?.col === location.col) {
        location.anchor = activeCell.anchor;
        location.focus = activeCell.focus;
      }
      return location;
    }

    function setCaret(place) {
      if (!place) return;
      const cell = dom.querySelector(`.tm-nmt-inline-content[data-row="${place.row}"][data-col="${place.col}"]`);
      if (!cell) return;
      cell.focus({ preventScroll: true });
      // Cells are plaintext-only; use a DOM Range so redo/undo does not reset to column zero.
      const nodes = [];
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
      if (!nodes.length) cell.appendChild(document.createTextNode(''));
      const textNodes = nodes.length ? nodes : [cell.firstChild];
      const point = value => {
        let remaining = Math.max(0, value ?? 0);
        for (const node of textNodes) {
          if (remaining <= node.textContent.length) return { node, offset: remaining };
          remaining -= node.textContent.length;
        }
        const node = textNodes[textNodes.length - 1];
        return { node, offset: node.textContent.length };
      };
      try {
        const a = point(place.anchor), f = point(place.focus);
        const sel = window.getSelection();
        sel.removeAllRanges();
        if (typeof sel.setBaseAndExtent === 'function') sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
        else { const r = document.createRange(); r.setStart(f.node, f.offset); r.collapse(true); sel.addRange(r); }
      } catch (_) {}
      activeCell = { ...place };
    }

    function recordUndo(before, caret = captureCaret()) {
      if (!before) return;
      if (undoStack.length >= 80) undoStack.shift();
      undoStack.push({ model: cloneModel(before), caret: caret && { ...caret } });
      redoStack.length = 0;
    }

    function restoreHistory(source, target) {
      if (!editing || !draft || !source.length) return false;
      const currentCaret = captureCaret();
      target.push({ model: cloneModel(draft), caret: currentCaret });
      const item = source.pop();
      draft = cloneModel(item.model);
      lastTextEdit.time = 0;
      clearSelectionRange();
      rerender();
      setCaret(item.caret || currentCaret);
      return true;
    }

    function historyCommand(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || composing) return null;
      const key = event.key?.toLowerCase();
      if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
      if (key === 'y' && !event.shiftKey) return 'redo';
      return null;
    }

    function handleTableHistory(event) {
      const command = historyCommand(event);
      if (!command || !isEditable()) return false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (editing && draft) restoreHistory(command === 'undo' ? undoStack : redoStack, command === 'undo' ? redoStack : undoStack);
      return true; // no draft history must NEVER fall through to NocoDB undo
    }

    function selectionIsWholeTable(range, model) {
      return !!range && range.r1 === -1 && range.r2 === model.rows.length - 1 &&
        range.c1 === 0 && range.c2 === model.headers.length - 1;
    }

    function selectedMarkdown(range, model) {
      const cells = [];
      for (let r = range.r1; r <= range.r2; r++) {
        cells.push((r === -1 ? model.headers : model.rows[r]).slice(range.c1, range.c2 + 1));
      }
      return serializeMarkdownTable({ headers: cells[0], rows: cells.slice(1) });
    }

    function selectedHtml(range, model) {
      const table = document.createElement('table');
      for (let r = range.r1; r <= range.r2; r++) {
        const tr = document.createElement('tr');
        (r === -1 ? model.headers : model.rows[r]).slice(range.c1, range.c2 + 1).forEach(text => {
          const td = document.createElement(r === range.r1 ? 'th' : 'td');
          td.textContent = text;
          tr.appendChild(td);
        });
        table.appendChild(tr);
      }
      return table.outerHTML;
    }

    function cutSelectedRange(range) {
      const model = draft || stored.model;
      if (selectionIsWholeTable(range, model)) return deleteTable();
      if (!editing) enterEditing();
      const previous = cloneModel(draft);
      for (let r = range.r1; r <= range.r2; r++) {
        for (let c = range.c1; c <= range.c2; c++) {
          if (r === -1) draft.headers[c] = '';
          else draft.rows[r][c] = '';
        }
      }
      if (modelHash(previous) !== modelHash(draft)) recordUndo(previous);
      lastTextEdit.time = 0;
      clearSelectionRange();
      rerender();
      return true;
    }

    function handleSelectedClipboard(event) {
      const range = normalizedSelection();
      if (!range || !isEditable() || !event.clipboardData) return false;
      const model = draft || stored.model;
      const data = selectedMarkdown(range, model);
      const html = selectedHtml(range, model);
      try {
        event.clipboardData.setData('text/plain', data);
        event.clipboardData.setData('text/html', html);
      } catch (_) { return false; }
      if (event.clipboardData.getData('text/plain') !== data) return false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.type === 'cut') cutSelectedRange(range);
      return true;
    }

    function mutateDraft(operation) {
      if (!editing) enterEditing();
      if (!draft) return false;
      const before = cloneModel(draft);
      const result = operation(draft);
      if (result && modelHash(before) !== modelHash(draft)) recordUndo(before);
      lastTextEdit.time = 0;
      return result;
    }

    function deleteSelectedCells() {
      const range = normalizedSelection();
      if (!range || !isEditable()) return false;
      if (!editing) enterEditing();
      if (!draft) return false;
      const beforeSelectionDelete = cloneModel(draft);
      const entireRows = range.c1 === 0 && range.c2 === draft.headers.length - 1 && range.r1 >= 0;
      const entireColumns = range.r1 === -1 && range.r2 === draft.rows.length - 1;
      if (entireRows) {
        for (let r = range.r2; r >= range.r1; r--) deleteRow(draft, r);
      } else if (entireColumns && range.c2 - range.c1 + 1 < draft.headers.length) {
        for (let c = range.c2; c >= range.c1; c--) deleteColumn(draft, c);
      } else {
        for (let r = range.r1; r <= range.r2; r++) {
          for (let c = range.c1; c <= range.c2; c++) {
            if (r === -1) draft.headers[c] = '';
            else draft.rows[r][c] = '';
          }
        }
      }
      if (modelHash(beforeSelectionDelete) !== modelHash(draft)) recordUndo(beforeSelectionDelete);
      lastTextEdit.time = 0;
      clearSelectionRange();
      rerender();
      return true;
    }

    function enterEditing() {
      if (!isEditable()) return;
      stopOutsideDeleteConfirm();
      confirmingDelete = false;
      editing = true;
      draft = cloneModel(stored.model);
      undoStack.length = 0;
      redoStack.length = 0;
      lastTextEdit.time = 0;
      dom.classList.add('is-editing');
      startOutsideAutoSave();
    }

    function alertLimit(message) {
      showToast(message, 'error', 3000);
    }

    function saveEditing() {
      if (!draft) return true;

      // 没有实际修改时只退出编辑，不产生无意义的 ProseMirror transaction。
      if (modelHash(draft) === modelHash(stored.model)) {
        stopOutsideAutoSave();
        editing = false;
        draft = null;
        rerender();
        return true;
      }

      let position;
      try {
        position = getPos();
      } catch (_) {
        position = null;
      }

      if (!Number.isInteger(position)) {
        showToast('保存失败：无法定位原表格代码块。', 'error', 3600);
        return false;
      }

      const state = editorView.state;
      const liveNode = state.doc.nodeAt(position);
      if (!liveNode || liveNode.type !== currentNode.type) {
        showToast('保存失败：原表格代码块已发生变化。', 'error', 3600);
        return false;
      }

      const nextModel = cloneModel(draft);
      const nextId = stored.id || createTableId();
      const nextText = buildStoredText(nextModel, nextId);
      const nextAttrs = languageAttrsForNodeType(liveNode.type, liveNode.attrs || {});

      let nextNode;
      try {
        nextNode = liveNode.type.create(
          nextAttrs,
          nextText ? state.schema.text(nextText) : null,
          liveNode.marks,
        );
      } catch (_) {
        showToast('保存失败：无法创建新的代码块节点。', 'error', 3600);
        return false;
      }


      stopOutsideAutoSave();
      editing = false;
      draft = null;

      try {
        editorView.dispatch(
          state.tr.replaceWith(position, position + liveNode.nodeSize, nextNode).scrollIntoView(),
        );
        showToast('已保存', 'success', 1600);
        return true;
      } catch (_) {
        editing = true;
        draft = nextModel;
        startOutsideAutoSave();
        showToast('保存失败：NocoDB 拒绝了本次表格更新。', 'error', 3600);
        rerender();
        return false;
      }
    }

    // Single in-place NodeView: the same table DOM is used for reading and editing.
    // NocoDB's parent schema does not have table nodes, so cell drafts are
    // serialized back to the established Markdown-in-codeBlock carrier atomically.
    function rerender() {
      if (destroyed) return;
      closeContextMenu();
      dom.replaceChildren();
      dom.dataset.nocodbMarkdownTableId = stored.id || 'new';
      dom.classList.toggle('is-editing', editing);
      const current = draft || stored.model;
      if (isEditable()) {
        dom.appendChild(makeCopyTrigger(() => copyMarkdownTable(draft || stored.model)));
        dom.appendChild(makeDeleteTrigger(showDeleteConfirm));
        if (confirmingDelete) renderDeleteConfirm();
      }
      const scroll = document.createElement('div');
      scroll.className = 'tm-nmt-scroll-v31';
      const table = document.createElement('table');
      table.className = 'tm-nmt-table-v31 tm-nmt-inline-table';
      const head = document.createElement('thead');
      const header = document.createElement('tr');
      const body = document.createElement('tbody');
      const targets = [];
      const focusCell = (row, col) => {
        const next = dom.querySelector(`.tm-nmt-inline-content[data-row="${row}"][data-col="${col}"]`);
        if (next) { next.focus(); return true; }
        return false;
      };
      const openContextMenu = (event, row, col) => {
        if (!isEditable()) return;
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu();
        const menu = document.createElement('div');
        menu.className = 'tm-nmt-menu-v31 tm-nmt-inline-context';
        menu.style.position = 'fixed';
        menu.style.left = '0px';
        menu.style.top = '0px';
        const action = (label, operation, options = {}) => {
          menu.append(makeMenuItem(label, () => {
            closeContextMenu();
            if (!mutateDraft(operation)) { alertLimit('无法完成操作：已达到行列限制。'); return; }
            clearSelectionRange();
            rerender();
          }, options));
        };
        action('在上方插入行', m => insertRow(m, Math.max(0, row)));
        action('在下方插入行', m => insertRow(m, Math.max(0, row + 1)));
        action('在左侧插入列', m => insertColumn(m, col));
        action('在右侧插入列', m => insertColumn(m, col + 1));
        if (row >= 0) action('删除当前行', m => deleteRow(m, row), { danger: true });
        if (current.headers.length > 1) action('删除当前列', m => deleteColumn(m, col), { danger: true });
        document.body.appendChild(menu);
        contextMenu = menu;
        const rect = menu.getBoundingClientRect();
        const margin = 8;
        menu.style.left = `${Math.max(margin, Math.min(event.clientX, innerWidth - rect.width - margin))}px`;
        menu.style.top = `${Math.max(margin, Math.min(event.clientY, innerHeight - rect.height - margin))}px`;
      };
      const makeCell = (value, row, col, isHeader) => {
        const td = document.createElement(isHeader ? 'th' : 'td');
        td.className = 'tm-nmt-inline-cell';
        const span = document.createElement('span');
        span.className = 'tm-nmt-inline-content';
        span.dataset.row = String(row);
        span.dataset.col = String(col);
        span.textContent = value;
        span.contentEditable = isEditable() ? 'plaintext-only' : 'false';
        // Browsers without plaintext-only support are normalized on input.
        span.spellcheck = false;
        span.setAttribute('role', 'textbox');
        span.setAttribute('aria-label', `第 ${row + 2} 行，第 ${col + 1} 列`);
        span.addEventListener('focus', () => {
          if (!editing) enterEditing();
          activeCell = { row, col, anchor: 0, focus: 0 };
          lastTextEdit.time = 0;
        });
        span.addEventListener('compositionstart', () => { composing = true; });
        span.addEventListener('compositionend', () => { composing = false; lastTextEdit.time = 0; });
        span.addEventListener('keyup', () => { activeCell = captureCaret(); });
        span.addEventListener('mouseup', () => { activeCell = captureCaret(); });
        span.addEventListener('pointerdown', e => {
          if (e.button !== 0 || !isEditable()) return;
          clearSelectionRange();
          dragAnchor = { row, col };
          dragPointerId = e.pointerId;
        });
        span.addEventListener('pointerenter', e => {
          if (dragAnchor && e.buttons === 1 && dragPointerId === e.pointerId) extendCellRange(row, col);
        });
        span.addEventListener('input', () => {
          if (!editing) enterEditing();
          const clean = span.innerText.replace(/\r?\n/g, ' ');
          if (span.textContent !== clean) span.textContent = clean;
          const previous = row === -1 ? draft.headers[col] : draft.rows[row][col];
          if (previous === clean) return;
          const now = Date.now();
          if (lastTextEdit.row !== row || lastTextEdit.col !== col || now - lastTextEdit.time > 850) {
            const caret = captureCaret();
            const beforeCaret = caret ? { ...caret, anchor: Math.min(caret.anchor, String(previous).length), focus: Math.min(caret.focus, String(previous).length) } : null;
            recordUndo(draft, beforeCaret);
          }
          lastTextEdit = { row, col, time: now };
          if (row === -1) draft.headers[col] = clean;
          else draft.rows[row][col] = clean;
        });
        span.addEventListener('paste', e => {
          e.stopPropagation();
          e.preventDefault();
          const plain = (e.clipboardData?.getData('text/plain') || '').replace(/\r?\n/g, ' ');
          if (!document.execCommand('insertText', false, plain)) {
            const selection = window.getSelection();
            if (selection?.rangeCount) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              range.insertNode(document.createTextNode(plain));
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
              span.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        });
        span.addEventListener('keydown', e => {
          if (handleTableHistory(e)) return;
          e.stopPropagation();
          if (e.key === 'Escape') {
            if (selectionRange) { e.preventDefault(); clearSelectionRange(); return; }
            e.preventDefault(); span.blur(); return;
          }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            if (selectionRange) {
              e.preventDefault();
              deleteSelectedCells();
              return;
            }
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.isComposing || e.repeat) return;
            if (!editing) enterEditing();
            if (!draft) return;
            if (row === -1) { focusCell(0, col); return; }
            if (row < draft.rows.length - 1) { focusCell(row + 1, col); return; }
            if (mutateDraft(m => insertRow(m, m.rows.length))) {
              const nextRow = draft.rows.length - 1;
              rerender();
              focusCell(nextRow, col);
            } else alertLimit('无法新增行：已达到表格大小限制。');
            return;
          }
          if (e.key !== 'Tab') return;
          e.preventDefault();
          const index = targets.findIndex(x => x.row === row && x.col === col);
          const next = targets[index + (e.shiftKey ? -1 : 1)];
          if (next) { next.element.focus(); return; }
          if (!e.shiftKey && editing && draft && mutateDraft(m => insertRow(m, m.rows.length))) {
            const nextRow = draft.rows.length - 1;
            rerender();
            focusCell(nextRow, 0);
          }
        });
        span.addEventListener('contextmenu', e => openContextMenu(e, row, col));
        td.appendChild(span);
        targets.push({ element: span, row, col });
        return td;
      };
      current.headers.forEach((value, col) => header.appendChild(makeCell(value, -1, col, true)));
      head.appendChild(header);
      table.appendChild(head);
      current.rows.forEach((r, row) => {
        const tr = document.createElement('tr');
        r.forEach((value, col) => tr.appendChild(makeCell(value, row, col, false)));
        body.appendChild(tr);
      });
      table.appendChild(body);
      scroll.appendChild(table);
      dom.appendChild(scroll);
    }

    const onDragPointerMove = event => {
      if (!dragAnchor || event.pointerId !== dragPointerId || event.buttons !== 1) return;
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tm-nmt-inline-content');
      if (!cell || !dom.contains(cell)) return;
      extendCellRange(Number(cell.dataset.row), Number(cell.dataset.col));
      if (dragMoved) event.preventDefault();
    };
    const onDragPointerEnd = event => {
      if (event.pointerId === dragPointerId) finishCellDrag();
    };
    const onSelectionKeydown = event => {
      if (!dom.isConnected) return;
      const inside = dom.contains(event.target);
      // Capture precedes NocoDB's bubbling keymap. The selection also needs
      // a dedicated scope because a dragged range may no longer own DOM focus.
      if ((inside || selectionRange) && handleTableHistory(event)) return;
      if (!selectionRange) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSelectionRange();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') &&
        !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        deleteSelectedCells();
      }
    };
    const onContextDismiss = event => {
      if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
      if (selectionRange && !dom.contains(event.target) && !contextMenu?.contains(event.target)) clearSelectionRange();
    };
    document.addEventListener('pointermove', onDragPointerMove, true);
    document.addEventListener('pointerup', onDragPointerEnd, true);
    document.addEventListener('pointercancel', onDragPointerEnd, true);
    const onHistoryBeforeInput = event => {
      if (!dom.contains(event.target) || !['historyUndo', 'historyRedo'].includes(event.inputType)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (editing && draft && !composing) restoreHistory(event.inputType === 'historyUndo' ? undoStack : redoStack,
        event.inputType === 'historyUndo' ? redoStack : undoStack);
    };
    const onTableClipboard = event => {
      if (!selectionRange || !dom.isConnected || !['copy','cut'].includes(event.type)) return;
      handleSelectedClipboard(event);
    };
    document.addEventListener('keydown', onSelectionKeydown, true);
    document.addEventListener('beforeinput', onHistoryBeforeInput, true);
    document.addEventListener('copy', onTableClipboard, true);
    document.addEventListener('cut', onTableClipboard, true);
    document.addEventListener('pointerdown', onContextDismiss, true);
    rerender();

    return {
      dom,
      update(nextNode) {
        if (destroyed || nextNode.type !== currentNode.type) return false;
        const nextStored = parseStoredText(nextNode.textContent || '');
        if (!nextStored) return false;

        const changed =
          nextStored.sourceHash !== stored.sourceHash ||
          nextStored.id !== stored.id ||
          nextStored.legacy !== stored.legacy;

        currentNode = nextNode;
        stored = nextStored;

        if (changed && editing) {
          stopOutsideAutoSave();
          editing = false;
          draft = null;
          showToast('表格已在其他位置更新，未保存的编辑已取消。', 'error', 3600);
        }
        if (changed && confirmingDelete) {
          stopOutsideDeleteConfirm();
          confirmingDelete = false;
        }

        if (changed) rerender();
        return true;
      },
      stopEvent(event) {
        return dom.contains(event.target);
      },
      ignoreMutation(mutation) {
        return dom.contains(mutation.target);
      },
      selectNode() {
        dom.classList.add('ProseMirror-selectednode');
      },
      deselectNode() {
        dom.classList.remove('ProseMirror-selectednode');
      },
      destroy() {
        if (destroyed) return;
        closeContextMenu();
        document.removeEventListener('pointermove', onDragPointerMove, true);
        document.removeEventListener('pointerup', onDragPointerEnd, true);
        document.removeEventListener('pointercancel', onDragPointerEnd, true);
        document.removeEventListener('keydown', onSelectionKeydown, true);
        document.removeEventListener('beforeinput', onHistoryBeforeInput, true);
        document.removeEventListener('copy', onTableClipboard, true);
        document.removeEventListener('cut', onTableClipboard, true);
        document.removeEventListener('pointerdown', onContextDismiss, true);
        stopOutsideAutoSave();
        stopOutsideDeleteConfirm();
        destroyed = true;
        session.tableNodeViewCount = Math.max(0, session.tableNodeViewCount - 1);
      },
    };
  }

  // Parse a clipboard document into prose segments and complete Markdown table segments.
  // Fenced code blocks are opaque: examples inside them must not become tables.
  function splitMixedMarkdown(source) {
    if (typeof source !== 'string' || source.length > MAX_MIXED_SOURCE_CHARS) return null;
    // Do not trim trailing whitespace in fenced code. It is executable content.
    const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const parts = [];
    let prose = [];
    let tableCount = 0;
    const flush = () => {
      if (prose.length) parts.push({ type: 'markdown', text: prose.join('\n') });
      prose = [];
    };
    const fenceMatch = (line) => line.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      const open = fenceMatch(line);
      if (open) {
        let close = i + 1;
        while (close < lines.length) {
          const match = lines[close].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
          if (match && match[1][0] === open[1][0] && match[1].length >= open[1].length) break;
          close += 1;
        }
        if (close < lines.length) {
          flush();
          parts.push({
            type: 'fence',
            language: open[2].trim().split(/\s+/)[0] || '',
            // Preserve original line breaks and indentation literally.
            text: lines.slice(i + 1, close).join('\n'),
          });
          i = close + 1;
          continue;
        }
      }
      if (i + 1 < lines.length && line.includes('|') && lines[i + 1].includes('|')) {
        let end = i + 2;
        while (end < lines.length && lines[end].trim() && lines[end].includes('|')) end += 1;
        const model = parseMarkdownTable(lines.slice(i, end).join('\n'));
        if (model) {
          tableCount += 1;
          if (tableCount > MAX_MIXED_TABLES) return null;
          flush();
          parts.push({ type: 'table', model });
          i = end;
          continue;
        }
      }
      prose.push(line);
      i += 1;
    }
    flush();
    return tableCount ? parts : null;
  }

  function insertMixedMarkdown(session, parts) {
    const { tiptap } = session;
    const view = tiptap.view;
    const state = view?.state;
    const schema = state?.schema;
    const codeType = schema?.nodes?.codeBlock;
    if (!codeType) throw new Error('codeblock-schema-unavailable');

    // Reuse NocoDB's own markdown clipboard parser for prose, but never route
    // fenced code or table payloads through the HTML parser. The clipboard
    // parser returns a ProseMirror Slice, including nested list structure.
    const parseClipboard = view.someProp?.('clipboardTextParser');
    if (typeof parseClipboard !== 'function') throw new Error('markdown-clipboard-parser-unavailable');
    const nodes = [];
    const expected = [];
    let tableCount = 0;
    for (const part of parts) {
      if (part.type === 'markdown') {
        if (!part.text.trim()) continue;
        let slice;
        try {
          slice = parseClipboard(part.text, state.selection.$from, false, view);
        } catch (error) {
          throw new Error('prose-clipboard-parser-failed', { cause: error });
        }
        if (!slice?.content || !slice.content.childCount) {
          throw new Error('prose-clipboard-parser-empty');
        }
        // Reject open slices rather than silently deforming list boundaries.
        // A standalone markdown fragment is expected to be block-complete.
        slice.content.forEach(node => nodes.push(node));
      } else if (part.type === 'fence') {
        const attrs = languageAttrsForNodeType(codeType, { language: part.language });
        const node = codeType.create(attrs, part.text ? schema.text(part.text) : null);
        nodes.push(node);
        expected.push({ text: part.text, tableId: null });
      } else if (part.type === 'table') {
        const id = createTableId();
        const text = buildStoredText(part.model, id);
        const attrs = languageAttrsForNodeType(codeType, { language: CODE_BLOCK_LANGUAGE });
        nodes.push(codeType.create(attrs, schema.text(text)));
        expected.push({ text, tableId: id });
        tableCount++;
      }
    }
    if (!nodes.length || !tableCount) throw new Error('mixed-fragment-empty');
    // Compose the entire replacement before dispatching. If parsing/validation
    // fails, the original editor document remains unchanged.
    let fragment;
    try {
      fragment = schema.nodes.doc.create(null, nodes).content;
    } catch (error) {
      throw new Error('mixed-fragment-invalid', { cause: error });
    }
    let transaction;
    try {
      const tr = state.tr.replaceSelection(
        new (state.selection.content().constructor)(fragment, 0, 0),
      );
      transaction = tr;
    } catch (error) {
      throw new Error('mixed-transaction-build-failed', { cause: error });
    }
    // Verify the resulting document before applying it, including every
    // backslash, hash, indentation and newline in fenced code blocks.
    const seen = expected.map(() => false);
    transaction.doc.descendants(node => {
      if (node.type !== codeType) return;
      for (let i = 0; i < expected.length; i++) {
        if (seen[i] || node.textContent !== expected[i].text) continue;
        if (expected[i].tableId && parseStoredText(node.textContent)?.id !== expected[i].tableId) continue;
        seen[i] = true;
        break;
      }
    });
    if (seen.some(ok => !ok)) throw new Error('codeblock-content-integrity-failed');
    try {
      view.dispatch(transaction.scrollIntoView());
    } catch (error) {
      throw new Error('mixed-transaction-dispatch-failed', { cause: error });
    }
    return true;
  }

  function documentContainsTableId(doc, id) {
    let found = false;
    doc.descendants((node) => {
      if (found || node.type?.name !== 'codeBlock') return !found;
      const stored = parseStoredText(node.textContent || '');
      if (stored?.id === id) found = true;
      return !found;
    });
    return found;
  }

  function insertTableCodeBlock(session, model) {
    const { tiptap } = session;
    const codeBlockType = tiptap.state?.schema?.nodes?.codeBlock;
    if (!codeBlockType) return false;

    const id = createTableId();
    const text = buildStoredText(model, id);
    const attrs = languageAttrsForNodeType(codeBlockType, {});
    const json = {
      type: 'codeBlock',
      ...(Object.keys(attrs).length ? { attrs } : {}),
      content: [{ type: 'text', text }],
    };

    try {
      const inserted = tiptap.chain().focus().insertContent(json).run();
      if (inserted && documentContainsTableId(tiptap.state.doc, id)) return true;
    } catch (_) {}

    try {
      const state = tiptap.state;
      const node = codeBlockType.create(attrs, state.schema.text(text));
      tiptap.view.dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
      return documentContainsTableId(tiptap.state.doc, id);
    } catch (_) {
      return false;
    }
  }

  function createNodeViewFactory(session) {
    return function codeBlockNodeView(node, view, getPos, decorations, innerDecorations) {
      const stored = parseStoredText(node.textContent || '');
      if (stored) return createTableNodeView(session, node, view, getPos, stored);

      if (typeof session.originalCodeBlockNodeView === 'function') {
        try {
          return session.originalCodeBlockNodeView(node, view, getPos, decorations, innerDecorations);
        } catch (_) {}
      }

      // 普通 codeBlock 交回 ProseMirror 默认渲染，不再创建自定义 fallback NodeView。
      // 这能避免脚本安装时重建所有普通代码块 DOM，从而降低 Selection 映射被扰动的风险。
      return null;
    };
  }

  function restoreSelectionAfterNodeViewInstall(view, editorDom, selection, hadFocus) {
    if (!hadFocus || !view || !editorDom?.isConnected || !selection) return;

    window.requestAnimationFrame(() => {
      if (!editorDom.isConnected || !view.state) return;

      try {
        const currentSelection = view.state.selection;
        if (!currentSelection?.eq?.(selection)) {
          view.dispatch(view.state.tr.setSelection(selection));
        }
        view.focus();
      } catch (_) {}
    });
  }

  function installSession(editorDom, tiptap) {
    const existing = sessions.get(editorDom);
    if (existing && existing.tiptap === tiptap && !existing.destroyed) return existing;
    if (existing) destroySession(existing);

    const view = tiptap.view;
    const originalNodeViews = { ...(view.props.nodeViews || {}) };
    const selectionBeforeInstall = view.state?.selection || null;
    const hadFocusBeforeInstall = typeof view.hasFocus === 'function' ? view.hasFocus() : editorDom.contains(document.activeElement);
    const session = {
      editorDom,
      tiptap,
      view,
      originalNodeViews,
      originalCodeBlockNodeView: originalNodeViews.codeBlock || null,
      nodeViewFactory: null,
      tableNodeViewCount: 0,
      destroyed: false,
    };

    session.nodeViewFactory = createNodeViewFactory(session);

    try {
      view.setProps({
        nodeViews: {
          ...originalNodeViews,
          codeBlock: session.nodeViewFactory,
        },
      });
      restoreSelectionAfterNodeViewInstall(view, editorDom, selectionBeforeInstall, hadFocusBeforeInstall);
    } catch (_) {
      return null;
    }

    sessions.set(editorDom, session);
    const discovery = discoveryStates.get(editorDom);
    if (discovery?.timer) window.clearTimeout(discovery.timer);
    discoveryStates.delete(editorDom);
    setEditorConnectionState(editorDom, 'ready');
    return session;
  }

  function clearDiscovery(editorDom) {
    const state = discoveryStates.get(editorDom);
    if (state?.timer) window.clearTimeout(state.timer);
    discoveryStates.delete(editorDom);
  }

  function scheduleSessionDiscovery(editorDom, reset = false) {
    if (!(editorDom instanceof HTMLElement) || !editorDom.isConnected) return;

    const current = discoveryStates.get(editorDom);
    if (reset && current?.timer) window.clearTimeout(current.timer);
    if (!reset && current?.timer) return;

    const attempts = reset ? 0 : (current?.attempts || 0);
    if (attempts >= DISCOVERY_RETRY_LIMIT) {
      clearDiscovery(editorDom);
      setEditorConnectionState(editorDom, 'unavailable');
      return;
    }

    setEditorConnectionState(editorDom, 'connecting');
    const timer = window.setTimeout(() => {
      discoveryStates.set(editorDom, { attempts: attempts + 1, timer: 0 });
      const session = ensureSession(editorDom, false);
      if (!session) scheduleSessionDiscovery(editorDom, false);
    }, DISCOVERY_RETRY_DELAY);

    discoveryStates.set(editorDom, { attempts, timer });
  }

  function ensureSession(editorDom, scheduleRetry = true) {
    if (!(editorDom instanceof HTMLElement) || !editorDom.isConnected) return null;

    const current = sessions.get(editorDom);
    if (current && !current.destroyed) {
      setEditorConnectionState(editorDom, 'ready');
      return current;
    }

    const tiptap = findTiptapEditor(editorDom);
    if (tiptap) return installSession(editorDom, tiptap);

    if (scheduleRetry) scheduleSessionDiscovery(editorDom, false);
    return null;
  }

  function destroySession(session) {
    if (!session || session.destroyed) return;
    session.destroyed = true;

    try {
      if (session.view?.props?.nodeViews?.codeBlock === session.nodeViewFactory && session.editorDom.isConnected) {
        session.view.setProps({ nodeViews: session.originalNodeViews });
      }
    } catch (_) {}

    sessions.delete(session.editorDom);
    clearDiscovery(session.editorDom);
    session.editorDom.removeAttribute(READY_ATTR);
    session.editorDom.removeAttribute(STATE_ATTR);
  }

  function getEventEditor(event) {
    let target = event.target;
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!(target instanceof HTMLElement)) return null;
    return target.closest(EDITOR_SELECTOR);
  }

  function queueTableInsert(editorDom, model, mixedParts = null) {
    let attempts = 0;

    const tryInsert = () => {
      if (!editorDom.isConnected) {
        showToast('Markdown 表格转换失败：Rich Text 编辑器已经关闭。', 'error', 3600);
        return;
      }

      const session = ensureSession(editorDom, false);
      if (session) {
        editorDom.focus({ preventScroll: true });
        let inserted = false;
        try {
          inserted = mixedParts ? insertMixedMarkdown(session, mixedParts) : insertTableCodeBlock(session, model);
        } catch (error) {
          console.warn('[NocoDB Markdown Table] 混合内容处理失败，阶段：', error?.message || 'unknown', error);
        }
        if (!inserted) {
          setEditorConnectionState(editorDom, 'insert-failed');
          console.warn('[NocoDB Markdown Table] 已连接 Tiptap，但代码块插入失败。');
          showToast(mixedParts ? '混合 Markdown 粘贴失败：请查看 Console 中的阶段错误；原文可重新粘贴。' : 'Markdown 表格插入失败：请重试。', 'error', 4600);
        }
        return;
      }

      attempts += 1;
      if (attempts >= PASTE_RETRY_LIMIT) {
        setEditorConnectionState(editorDom, 'unavailable');
        console.warn('[NocoDB Markdown Table] 无法取得当前 Rich Text 的 Tiptap 实例。');
        showToast('Markdown 表格未插入：脚本无法连接当前 NocoDB Rich Text，请刷新页面后重试。', 'error', 4200);
        return;
      }

      scheduleSessionDiscovery(editorDom, attempts === 1);
      window.setTimeout(tryInsert, PASTE_RETRY_DELAY);
    };

    tryInsert();
  }

  function onPaste(event) {
    if (!event.isTrusted) return;

    const editorDom = getEventEditor(event);
    if (!editorDom) return;

    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(`pre, code, input, textarea, select, .${NODEVIEW_CLASS}`)) return;

    const text = event.clipboardData?.getData('text/plain') || '';
    const model = parseMarkdownTable(text);
    const mixedParts = model ? null : splitMixedMarkdown(text);
    if (!model && !mixedParts) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    queueTableInsert(editorDom, model, mixedParts);
  }

  function discoverEditorsWithin(node) {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(EDITOR_SELECTOR) && !ensureSession(node)) scheduleSessionDiscovery(node, true);
    node.querySelectorAll?.(EDITOR_SELECTOR).forEach((editor) => {
      if (!ensureSession(editor)) scheduleSessionDiscovery(editor, true);
    });
  }

  function cleanupDisconnectedSessions() {
    sessions.forEach((session) => {
      if (!session.editorDom.isConnected || session.tiptap?.isDestroyed) destroySession(session);
    });
  }

  function startDiscoveryObserver() {
    if (!document.body) return;

    document.querySelectorAll(EDITOR_SELECTOR).forEach((editor) => {
      if (!ensureSession(editor)) scheduleSessionDiscovery(editor, true);
    });

    const observer = new MutationObserver((mutations) => {
      let shouldCleanup = false;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => discoverEditorsWithin(node));
        if (mutation.removedNodes.length) shouldCleanup = true;
      }
      if (shouldCleanup) cleanupDisconnectedSessions();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  const TEST_API = {
    parseMarkdownTable,
    serializeMarkdownTable,
    parseStoredText,
    buildStoredText,
    parseMarkerLine,
    buildMarkerLine,
    splitMarkdownRow,
    splitMixedMarkdown,
  };

  if (TEST_MODE) {
    globalThis.__NOCODB_MARKDOWN_TABLE_TEST_API__ = TEST_API;
    return;
  }

  injectStyle();
  document.addEventListener('paste', onPaste, true);
  document.addEventListener('focusin', (event) => {
    const editor = getEventEditor(event);
    if (editor && !ensureSession(editor)) scheduleSessionDiscovery(editor, true);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDiscoveryObserver, { once: true });
  } else {
    startDiscoveryObserver();
  }

  globalThis[PAGE_GUARD] = 'ready';
}

function launchNocodbMarkdownTableInPageContext() {
  const source = `;(${nocodbMarkdownTablePageMain.toString()})();`;
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  try {
    if (pageWindow?.['__NOCODB_MARKDOWN_TABLE_PAGE_V31__'] === 'ready') return;
  } catch (_) {}

  try {
    if (pageWindow && typeof pageWindow.eval === 'function') {
      pageWindow.eval(source);
      if (pageWindow['__NOCODB_MARKDOWN_TABLE_PAGE_V31__'] === 'ready') return;
    }
  } catch (error) {
    console.warn('[NocoDB Markdown Table] page eval 注入失败，尝试 Function 注入。', error);
  }

  try {
    if (pageWindow && typeof pageWindow.Function === 'function') {
      pageWindow.Function(source)();
      if (pageWindow['__NOCODB_MARKDOWN_TABLE_PAGE_V31__'] === 'ready') return;
    }
  } catch (error) {
    console.warn('[NocoDB Markdown Table] page Function 注入失败，尝试 script 注入。', error);
  }

  try {
    const script = document.createElement('script');
    script.textContent = source;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
    window.setTimeout(() => {
      try {
        if (pageWindow?.['__NOCODB_MARKDOWN_TABLE_PAGE_V31__'] !== 'ready') {
          console.error('[NocoDB Markdown Table] 页面主环境注入未完成，可能被 CSP 阻止。');
        }
      } catch (_) {}
    }, 500);
  } catch (error) {
    console.error('[NocoDB Markdown Table] 无法进入网页主环境。', error);
  }
}

if (globalThis.__NOCODB_MARKDOWN_TABLE_TEST_MODE__ === true) {
  nocodbMarkdownTablePageMain();
} else {
  launchNocodbMarkdownTableInPageContext();
}

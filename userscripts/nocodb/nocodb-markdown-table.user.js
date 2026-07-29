// ==UserScript==
// @name         NocoDB Markdown 表格
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @version      3.1.1
// @description  在 NocoDB Rich Text 中自动转换、内嵌显示并轻量编辑 Markdown 表格
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
 * - 鼠标移入时，右上角才显示铅笔编辑按钮；
 * - 双击任意单元格也可以进入编辑状态；
 * - 编辑状态顶部仅保留“新增行 / 新增列 / 取消 / 保存”；
 * - 列操作收进对应表头的三点菜单；
 * - 行操作收进对应数据行的三点菜单；
 * - 所有内容统一左对齐，不再保存或编辑对齐信息；
 * - 保存成功使用短暂 Toast，不常驻状态栏。
 *
 * 三、渲染架构与性能
 * -----------------------------------------------------------------------------
 * - 油猴外壳只负责把主体注入网页主环境；
 * - 页面只注册一个 paste 事件；
 * - 全局 MutationObserver 只发现新增或移除的 Rich Text 编辑器；
 * - 不扫描正文代码块，不轮询，不监听滚动，不做坐标测量；
 * - 使用 ProseMirror codeBlock NodeView，在正文排版流中显示表格；
 * - 浏览状态只渲染普通 table，编辑状态才创建 input 和菜单；
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

      .${NODEVIEW_CLASS}.is-editing {
        overflow: visible;
        border: 1px solid var(--nc-border-gray-medium, rgba(31, 41, 55, 0.24));
        border-radius: 9px;
        background: var(--nc-bg-default, #fff);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      }

      .tm-nmt-scroll-v31 {
        width: 100%;
        max-width: 100%;
        overflow: auto;
        max-height: min(66vh, 680px);
        border-radius: 8px;
      }

      .${NODEVIEW_CLASS}.is-editing .tm-nmt-scroll-v31 {
        border-radius: 0 0 8px 8px;
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

      .${NODEVIEW_CLASS}.is-editing .tm-nmt-table-v31 {
        border: 0;
        border-radius: 0;
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

      .tm-nmt-edit-trigger-v31 {
        position: absolute;
        top: 7px;
        right: 7px;
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

      .${NODEVIEW_CLASS}:hover .tm-nmt-edit-trigger-v31,
      .${NODEVIEW_CLASS}:focus-within .tm-nmt-edit-trigger-v31 {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .tm-nmt-edit-trigger-v31:hover {
        background: #f3f4f6;
      }

      .tm-nmt-edit-trigger-v31 svg {
        width: 15px;
        height: 15px;
        pointer-events: none;
      }

      .tm-nmt-toolbar-v31 {
        min-height: 43px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding: 7px 8px;
        border-bottom: 1px solid var(--nc-border-gray-medium, rgba(31, 41, 55, 0.18));
        background: var(--nc-bg-gray-light, #f7f7f8);
        border-radius: 8px 8px 0 0;
      }

      .tm-nmt-toolbar-group-v31 {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }

      .tm-nmt-button-v31,
      .tm-nmt-menu-button-v31 {
        border: 1px solid var(--nc-border-gray-medium, rgba(31, 41, 55, 0.20));
        border-radius: 6px;
        background: var(--nc-bg-default, #fff);
        color: inherit;
        font: inherit;
        cursor: pointer;
        user-select: none;
      }

      .tm-nmt-button-v31 {
        min-height: 29px;
        padding: 4px 10px;
        font-size: 12px;
        line-height: 1.2;
      }

      .tm-nmt-button-v31:hover,
      .tm-nmt-menu-button-v31:hover {
        background: var(--nc-bg-gray-medium, #ececee);
      }

      .tm-nmt-button-v31:disabled,
      .tm-nmt-menu-button-v31:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .tm-nmt-button-primary-v31 {
        border-color: var(--nc-primary, #6c5ce7);
        background: var(--nc-primary, #6c5ce7);
        color: #fff;
      }

      .tm-nmt-button-primary-v31:hover {
        filter: brightness(0.96);
      }

      .tm-nmt-cell-input-v31 {
        width: 100%;
        min-width: 72px;
        min-height: 32px;
        padding: 5px 7px;
        border: 1px solid var(--nc-border-gray-medium, rgba(31, 41, 55, 0.22));
        border-radius: 5px;
        outline: none;
        background: var(--nc-bg-default, #fff);
        color: inherit;
        font: inherit;
        line-height: 1.35;
        text-align: left;
      }

      .tm-nmt-cell-input-v31:focus {
        border-color: var(--nc-primary, #6c5ce7);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--nc-primary, #6c5ce7) 18%, transparent);
      }

      .tm-nmt-header-cell-v31 {
        position: relative;
        padding-right: 43px !important;
      }

      .tm-nmt-header-cell-v31 .tm-nmt-cell-input-v31 {
        font-weight: 650;
      }

      .tm-nmt-menu-button-v31 {
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        font-size: 17px;
        line-height: 1;
      }

      .tm-nmt-header-menu-button-v31 {
        position: absolute;
        top: 50%;
        right: 8px;
        transform: translateY(-50%);
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

      .tm-nmt-column-menu-v31 {
        top: calc(50% + 19px);
        right: 7px;
      }

      .tm-nmt-row-menu-v31 {
        top: calc(50% + 18px);
        right: 5px;
      }

      .tm-nmt-menu-item-v31 {
        width: 100%;
        min-height: 31px;
        display: flex;
        align-items: center;
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

      .tm-nmt-row-action-cell-v31 {
        position: relative;
        width: 42px;
        min-width: 42px !important;
        padding: 6px !important;
        text-align: center !important;
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-row-action-cell-v31 .tm-nmt-menu-button-v31 {
        opacity: 0.35;
        transition: opacity 100ms ease;
      }

      .tm-nmt-table-v31 tr:hover .tm-nmt-row-action-cell-v31 .tm-nmt-menu-button-v31,
      .tm-nmt-row-action-cell-v31:focus-within .tm-nmt-menu-button-v31 {
        opacity: 1;
      }

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

  function makeButton(label, title, onClick, extraClass = '', disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-nmt-button-v31 ${extraClass}`.trim();
    button.textContent = label;
    button.title = title || label;
    button.disabled = disabled;

    button.addEventListener('pointerdown', (event) => stopPointerEvent(event));
    button.addEventListener('click', (event) => {
      stopPointerEvent(event);
      if (!button.disabled) onClick();
    });

    return button;
  }

  function makeEditTrigger(onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tm-nmt-edit-trigger-v31';
    button.title = '编辑表格';
    button.setAttribute('aria-label', '编辑表格');
    button.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10.9 2.1a1.4 1.4 0 0 1 2 2L5.2 11.8l-2.7.7.7-2.7 7.7-7.7Z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="m9.9 3.1 2 2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
      </svg>`;

    button.addEventListener('pointerdown', (event) => stopPointerEvent(event));
    button.addEventListener('click', (event) => {
      stopPointerEvent(event);
      onClick();
    });
    return button;
  }

  function makeMenuButton(title, onClick, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-nmt-menu-button-v31 ${extraClass}`.trim();
    button.textContent = '⋮';
    button.title = title;
    button.setAttribute('aria-label', title);
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
    button.textContent = label;
    button.disabled = Boolean(options.disabled);
    button.addEventListener('pointerdown', (event) => stopPointerEvent(event));
    button.addEventListener('click', (event) => {
      stopPointerEvent(event);
      if (!button.disabled) onClick();
    });
    return button;
  }

  function makeCellInput(value, onInput) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tm-nmt-cell-input-v31';
    input.value = value;

    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('input', () => onInput(input.value));
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') event.preventDefault();
    });
    return input;
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

  function renderReadOnlyTable(model, container, onEdit, editable) {
    const table = document.createElement('table');
    table.className = 'tm-nmt-table-v31';

    if (editable) {
      table.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onEdit();
      });
    }

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    model.headers.forEach((header) => {
      const th = document.createElement('th');
      th.textContent = header;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (!model.rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'tm-nmt-empty-v31';
      td.colSpan = model.headers.length;
      td.textContent = '暂无数据行';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      model.rows.forEach((row) => {
        const tr = document.createElement('tr');
        row.forEach((cell) => {
          const td = document.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function createTableNodeView(session, initialNode, editorView, getPos, initialStored) {
    session.tableNodeViewCount += 1;

    let currentNode = initialNode;
    let stored = initialStored;
    let editing = false;
    let draft = null;
    let openColumnMenu = null;
    let openRowMenu = null;
    let destroyed = false;

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

    function enterEditing() {
      if (!isEditable()) return;
      editing = true;
      draft = cloneModel(stored.model);
      openColumnMenu = null;
      openRowMenu = null;
      rerender();
    }

    function cancelEditing() {
      editing = false;
      draft = null;
      openColumnMenu = null;
      openRowMenu = null;
      rerender();
    }

    function alertLimit(message) {
      showToast(message, 'error', 3000);
    }

    function saveEditing() {
      if (!draft) return;

      let position;
      try {
        position = getPos();
      } catch (_) {
        position = null;
      }

      if (!Number.isInteger(position)) {
        showToast('保存失败：无法定位原表格代码块。', 'error', 3600);
        return;
      }

      const state = editorView.state;
      const liveNode = state.doc.nodeAt(position);
      if (!liveNode || liveNode.type !== currentNode.type) {
        showToast('保存失败：原表格代码块已发生变化。', 'error', 3600);
        return;
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
        return;
      }

      editing = false;
      draft = null;
      openColumnMenu = null;
      openRowMenu = null;

      try {
        editorView.dispatch(
          state.tr.replaceWith(position, position + liveNode.nodeSize, nextNode).scrollIntoView(),
        );
        showToast('已保存', 'success', 1600);
      } catch (_) {
        editing = true;
        draft = nextModel;
        showToast('保存失败：NocoDB 拒绝了本次表格更新。', 'error', 3600);
        rerender();
      }
    }

    function renderColumnMenu(th, columnIndex) {
      const menu = document.createElement('div');
      menu.className = 'tm-nmt-menu-v31 tm-nmt-column-menu-v31';
      menu.append(
        makeMenuItem('左侧插入列', () => {
          if (!draft || !insertColumn(draft, columnIndex)) alertLimit('已达到列数或单元格数量上限。');
          openColumnMenu = null;
          rerender();
        }, { disabled: !draft || !canInsertColumn(draft) }),
        makeMenuItem('右侧插入列', () => {
          if (!draft || !insertColumn(draft, columnIndex + 1)) alertLimit('已达到列数或单元格数量上限。');
          openColumnMenu = null;
          rerender();
        }, { disabled: !draft || !canInsertColumn(draft) }),
        makeMenuItem('删除此列', () => {
          if (draft) deleteColumn(draft, columnIndex);
          openColumnMenu = null;
          rerender();
        }, { danger: true, disabled: !draft || draft.headers.length <= 1 }),
      );
      th.appendChild(menu);
    }

    function renderRowMenu(cell, rowIndex) {
      const menu = document.createElement('div');
      menu.className = 'tm-nmt-menu-v31 tm-nmt-row-menu-v31';
      menu.append(
        makeMenuItem('上方插入行', () => {
          if (!draft || !insertRow(draft, rowIndex)) alertLimit('已达到行数或单元格数量上限。');
          openRowMenu = null;
          rerender();
        }, { disabled: !draft || !canInsertRow(draft) }),
        makeMenuItem('下方插入行', () => {
          if (!draft || !insertRow(draft, rowIndex + 1)) alertLimit('已达到行数或单元格数量上限。');
          openRowMenu = null;
          rerender();
        }, { disabled: !draft || !canInsertRow(draft) }),
        makeMenuItem('删除此行', () => {
          if (draft) deleteRow(draft, rowIndex);
          openRowMenu = null;
          rerender();
        }, { danger: true, disabled: !draft }),
      );
      cell.appendChild(menu);
    }

    function renderEditingTable(container) {
      if (!draft) return;

      const table = document.createElement('table');
      table.className = 'tm-nmt-table-v31';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');

      draft.headers.forEach((header, columnIndex) => {
        const th = document.createElement('th');
        th.className = 'tm-nmt-header-cell-v31';
        th.appendChild(makeCellInput(header, (value) => {
          draft.headers[columnIndex] = value;
        }));

        th.appendChild(makeMenuButton('列操作', () => {
          openColumnMenu = openColumnMenu === columnIndex ? null : columnIndex;
          openRowMenu = null;
          rerender();
        }, 'tm-nmt-header-menu-button-v31'));

        if (openColumnMenu === columnIndex) renderColumnMenu(th, columnIndex);
        headerRow.appendChild(th);
      });

      const rowActionHeader = document.createElement('th');
      rowActionHeader.className = 'tm-nmt-row-action-cell-v31';
      rowActionHeader.setAttribute('aria-hidden', 'true');
      headerRow.appendChild(rowActionHeader);
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      if (!draft.rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.className = 'tm-nmt-empty-v31';
        td.colSpan = draft.headers.length + 1;
        td.textContent = '暂无数据行，可点击“新增行”。';
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        draft.rows.forEach((row, rowIndex) => {
          const tr = document.createElement('tr');
          row.forEach((cell, columnIndex) => {
            const td = document.createElement('td');
            td.appendChild(makeCellInput(cell, (value) => {
              draft.rows[rowIndex][columnIndex] = value;
            }));
            tr.appendChild(td);
          });

          const actionCell = document.createElement('td');
          actionCell.className = 'tm-nmt-row-action-cell-v31';
          actionCell.appendChild(makeMenuButton('行操作', () => {
            openRowMenu = openRowMenu === rowIndex ? null : rowIndex;
            openColumnMenu = null;
            rerender();
          }));
          if (openRowMenu === rowIndex) renderRowMenu(actionCell, rowIndex);
          tr.appendChild(actionCell);
          tbody.appendChild(tr);
        });
      }

      table.appendChild(tbody);
      container.appendChild(table);
    }

    function rerender() {
      if (destroyed) return;
      dom.replaceChildren();
      dom.dataset.nocodbMarkdownTableId = stored.id || 'legacy';
      dom.classList.toggle('is-editing', editing);

      if (!editing) {
        if (isEditable()) dom.appendChild(makeEditTrigger(enterEditing));
        const scroll = document.createElement('div');
        scroll.className = 'tm-nmt-scroll-v31';
        renderReadOnlyTable(stored.model, scroll, enterEditing, isEditable());
        dom.appendChild(scroll);
        return;
      }

      const toolbar = document.createElement('div');
      toolbar.className = 'tm-nmt-toolbar-v31';

      const toolbarLeft = document.createElement('div');
      toolbarLeft.className = 'tm-nmt-toolbar-group-v31';
      toolbarLeft.append(
        makeButton('新增行', '在表格底部新增一行', () => {
          if (!draft || !insertRow(draft, draft.rows.length)) alertLimit('已达到行数或单元格数量上限。');
          openColumnMenu = null;
          openRowMenu = null;
          rerender();
        }, '', !draft || !canInsertRow(draft)),
        makeButton('新增列', '在表格右侧新增一列', () => {
          if (!draft || !insertColumn(draft, draft.headers.length)) alertLimit('已达到列数或单元格数量上限。');
          openColumnMenu = null;
          openRowMenu = null;
          rerender();
        }, '', !draft || !canInsertColumn(draft)),
      );

      const toolbarRight = document.createElement('div');
      toolbarRight.className = 'tm-nmt-toolbar-group-v31';
      toolbarRight.append(
        makeButton('取消', '放弃本次修改', cancelEditing),
        makeButton('保存', '保存并写回 NocoDB LongText', saveEditing, 'tm-nmt-button-primary-v31'),
      );

      toolbar.append(toolbarLeft, toolbarRight);
      dom.appendChild(toolbar);

      const scroll = document.createElement('div');
      scroll.className = 'tm-nmt-scroll-v31';
      renderEditingTable(scroll);
      dom.appendChild(scroll);
    }

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
          editing = false;
          draft = null;
          openColumnMenu = null;
          openRowMenu = null;
          showToast('表格已在其他位置更新，未保存的编辑已取消。', 'error', 3600);
        }

        rerender();
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
        destroyed = true;
        session.tableNodeViewCount = Math.max(0, session.tableNodeViewCount - 1);
      },
    };
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

      return createFallbackCodeBlockNodeView(node);
    };
  }

  function installSession(editorDom, tiptap) {
    const existing = sessions.get(editorDom);
    if (existing && existing.tiptap === tiptap && !existing.destroyed) return existing;
    if (existing) destroySession(existing);

    const view = tiptap.view;
    const originalNodeViews = { ...(view.props.nodeViews || {}) };
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

  function queueTableInsert(editorDom, model) {
    let attempts = 0;

    const tryInsert = () => {
      if (!editorDom.isConnected) {
        showToast('Markdown 表格转换失败：Rich Text 编辑器已经关闭。', 'error', 3600);
        return;
      }

      const session = ensureSession(editorDom, false);
      if (session) {
        editorDom.focus({ preventScroll: true });
        const inserted = insertTableCodeBlock(session, model);
        if (!inserted) {
          setEditorConnectionState(editorDom, 'insert-failed');
          console.warn('[NocoDB Markdown Table] 已连接 Tiptap，但代码块插入失败。');
          showToast('Markdown 表格转换失败：NocoDB 拒绝插入表格代码块。', 'error', 4000);
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
    if (!model) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    queueTableInsert(editorDom, model);
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

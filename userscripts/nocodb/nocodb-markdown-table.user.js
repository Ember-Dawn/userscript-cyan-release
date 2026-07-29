// ==UserScript==
// @name         NocoDB Markdown 表格
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @version      2.0.0
// @description  自动识别粘贴到 NocoDB Rich Text 的 Markdown 表格，并以内嵌方式提供单元格编辑及行列增删
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// @grant        none
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
 *   | --- | ---: | --- |
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
 * 二、渲染架构
 * -----------------------------------------------------------------------------
 * 旧版使用编辑器外部的 absolute overlay，容易与 TOC 的左侧占位、滚动坐标、
 * ProseMirror DOM 重建和鼠标事件发生冲突。
 *
 * 当前版本改为自定义 ProseMirror codeBlock NodeView：
 *
 * - 文档模型里仍然是可持久化的 codeBlock；
 * - 只有带内部标记的 codeBlock 被替换为可视化表格；
 * - 表格 DOM 直接位于 ProseMirror 正文排版流中；
 * - 普通代码块继续使用 NocoDB 原有 NodeView；
 * - 不再创建浮层，不再计算 top/left，不监听滚动或 resize；
 * - 表格编辑通过 transaction 替换原 codeBlock 内容，继续触发 NocoDB 自身保存。
 *
 * 三、性能原则
 * -----------------------------------------------------------------------------
 * - 页面只注册一个 paste 事件；
 * - 全局 MutationObserver 只发现新增或移除的 Rich Text 编辑器；
 * - 不扫描正文寻找代码块，不轮询，不监听滚动，不做坐标测量；
 * - 浏览状态只渲染普通 table；点击“编辑表格”后才创建 input/select；
 * - 表格更新仅替换对应的一个 codeBlock 节点。
 *
 * 四、格式边界
 * -----------------------------------------------------------------------------
 * - 支持标准矩形 Markdown 表格；
 * - 识别阶段兼容 1 个及以上连字符的分隔行，保存时统一为 ---；
 * - 支持首尾竖线可有可无；
 * - 支持 \\| 转义和简单行内代码中的竖线；
 * - 不支持跨行/跨列合并；
 * - 不支持单元格内真实换行或多段落；
 * - 单次自动转换最多 200 行、40 列、4000 个单元格、100000 个字符。
 *
 * =============================================================================
 */

(function () {
  'use strict';

  const EDITOR_SELECTOR = '.nc-rich-text-content .tiptap.ProseMirror';
  const CODE_BLOCK_LANGUAGE = 'nocodb-table';
  const MARKER_TYPE = 'NOCODB_MARKDOWN_TABLE';
  const MARKER_VERSION = 'v1';
  const LEGACY_MARKER = '[[NOCODB_MARKDOWN_TABLE_V1]]';
  const NEW_MARKER_PATTERN = /^\[\[NOCODB_MARKDOWN_TABLE:v1:([A-Za-z0-9_-]{6,64})\]\]$/;

  const STYLE_ID = 'tm-nocodb-markdown-table-style-v2';
  const NODEVIEW_CLASS = 'tm-nocodb-markdown-table-v2';

  const MAX_SOURCE_CHARS = 100000;
  const MAX_COLUMNS = 40;
  const MAX_BODY_ROWS = 200;
  const MAX_CELLS = 4000;
  const DISCOVERY_RETRY_LIMIT = 8;
  const DISCOVERY_RETRY_DELAY = 80;

  /** @type {Map<HTMLElement, EditorSession>} */
  const sessions = new Map();
  /** @type {WeakMap<HTMLElement, number>} */
  const retryCounts = new WeakMap();

  /**
   * @typedef {'left'|'center'|'right'} Alignment
   * @typedef {{ headers: string[], rows: string[][], alignments: Alignment[] }} TableModel
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
        width: 100%;
        max-width: 100%;
        margin: 10px 0;
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid var(--nc-border-gray-medium, rgba(0, 0, 0, 0.16));
        border-radius: 9px;
        background: var(--nc-bg-default, #fff);
        color: var(--nc-content-gray, #1f2937);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.07);
      }

      .${NODEVIEW_CLASS},
      .${NODEVIEW_CLASS} * {
        box-sizing: border-box;
      }

      .${NODEVIEW_CLASS}.ProseMirror-selectednode {
        outline: 2px solid color-mix(in srgb, var(--nc-primary, #6c5ce7) 45%, transparent);
        outline-offset: 2px;
      }

      .tm-nmt-toolbar-v2 {
        min-height: 38px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--nc-border-gray-light, rgba(0, 0, 0, 0.10));
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-toolbar-left-v2,
      .tm-nmt-toolbar-right-v2 {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
      }

      .tm-nmt-title-v2 {
        font-size: 12px;
        font-weight: 650;
        color: var(--nc-content-gray-subtle, #525866);
        user-select: none;
      }

      .tm-nmt-status-v2 {
        min-height: 18px;
        padding: 3px 8px;
        border-bottom: 1px solid var(--nc-border-gray-light, rgba(0, 0, 0, 0.08));
        background: var(--nc-bg-default, #fff);
        color: var(--nc-content-gray-subtle, #666);
        font-size: 12px;
      }

      .tm-nmt-status-v2:empty {
        display: none;
      }

      .tm-nmt-button-v2,
      .tm-nmt-mini-button-v2,
      .tm-nmt-align-select-v2 {
        border: 1px solid var(--nc-border-gray-medium, rgba(0, 0, 0, 0.16));
        border-radius: 6px;
        background: var(--nc-bg-default, #fff);
        color: inherit;
        font: inherit;
      }

      .tm-nmt-button-v2 {
        min-height: 27px;
        padding: 4px 9px;
        font-size: 12px;
        line-height: 1.2;
        cursor: pointer;
        user-select: none;
      }

      .tm-nmt-button-v2:hover,
      .tm-nmt-mini-button-v2:hover,
      .tm-nmt-align-select-v2:hover {
        background: var(--nc-bg-gray-medium, #efeff1);
      }

      .tm-nmt-button-v2:disabled,
      .tm-nmt-mini-button-v2:disabled,
      .tm-nmt-align-select-v2:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .tm-nmt-button-primary-v2 {
        border-color: var(--nc-primary, #6c5ce7);
        background: var(--nc-primary, #6c5ce7);
        color: #fff;
      }

      .tm-nmt-button-danger-v2,
      .tm-nmt-mini-danger-v2 {
        color: #b42318;
      }

      .tm-nmt-scroll-v2 {
        width: 100%;
        max-width: 100%;
        overflow: auto;
        max-height: min(62vh, 620px);
      }

      .tm-nmt-table-v2 {
        width: 100%;
        min-width: 360px;
        border-collapse: collapse;
        table-layout: auto;
        background: var(--nc-bg-default, #fff);
      }

      .tm-nmt-table-v2 th,
      .tm-nmt-table-v2 td {
        min-width: 96px;
        padding: 8px 10px;
        border-right: 1px solid var(--nc-border-gray-light, rgba(0, 0, 0, 0.10));
        border-bottom: 1px solid var(--nc-border-gray-light, rgba(0, 0, 0, 0.10));
        vertical-align: top;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .tm-nmt-table-v2 tr > :last-child {
        border-right: 0;
      }

      .tm-nmt-table-v2 tbody tr:last-child > * {
        border-bottom: 0;
      }

      .tm-nmt-table-v2 thead th {
        font-weight: 650;
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-empty-v2 {
        padding: 18px !important;
        text-align: center;
        color: var(--nc-content-gray-subtle, #777);
      }

      .tm-nmt-cell-input-v2 {
        width: 100%;
        min-width: 84px;
        min-height: 31px;
        padding: 5px 7px;
        border: 1px solid var(--nc-border-gray-medium, rgba(0, 0, 0, 0.18));
        border-radius: 5px;
        outline: none;
        background: var(--nc-bg-default, #fff);
        color: inherit;
        font: inherit;
        line-height: 1.35;
      }

      .tm-nmt-cell-input-v2:focus,
      .tm-nmt-align-select-v2:focus {
        border-color: var(--nc-primary, #6c5ce7);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--nc-primary, #6c5ce7) 18%, transparent);
      }

      .tm-nmt-column-actions-v2,
      .tm-nmt-row-actions-v2 {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 3px;
      }

      .tm-nmt-column-actions-v2 {
        padding: 5px !important;
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-mini-button-v2 {
        min-width: 25px;
        height: 25px;
        padding: 0 6px;
        font-size: 11px;
        line-height: 23px;
        cursor: pointer;
      }

      .tm-nmt-align-select-v2 {
        height: 25px;
        padding: 0 4px;
        font-size: 11px;
        cursor: pointer;
      }

      .tm-nmt-actions-cell-v2 {
        width: 120px;
        min-width: 120px !important;
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-align-left-v2 { text-align: left; }
      .tm-nmt-align-center-v2 { text-align: center; }
      .tm-nmt-align-right-v2 { text-align: right; }
    `;
    document.head.appendChild(style);
  }

  function cloneModel(model) {
    return {
      headers: [...model.headers],
      rows: model.rows.map((row) => [...row]),
      alignments: [...model.alignments],
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

  function parseAlignment(cell) {
    const value = cell.trim();
    if (!/^:?-{1,}:?$/.test(value)) return null;
    if (value.startsWith(':') && value.endsWith(':')) return 'center';
    if (value.endsWith(':')) return 'right';
    return 'left';
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

    const alignments = separator.map(parseAlignment);
    if (alignments.some((alignment) => alignment === null)) return null;

    const rows = [];
    for (const line of lines.slice(2)) {
      const row = splitMarkdownRow(line);
      if (row.length !== headers.length) return null;
      rows.push(row);
    }

    const cellCount = headers.length * (rows.length + 1);
    if (rows.length > MAX_BODY_ROWS || cellCount > MAX_CELLS) return null;

    return {
      headers,
      rows,
      alignments: /** @type {Alignment[]} */ (alignments),
    };
  }

  function escapeCell(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .trim();
  }

  function alignmentMarker(alignment) {
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
  }

  function serializeMarkdownTable(model) {
    const header = `| ${model.headers.map(escapeCell).join(' | ')} |`;
    const separator = `| ${model.alignments.map(alignmentMarker).join(' | ')} |`;
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

  function findTiptapEditor(editorDom) {
    let component = editorDom && editorDom.__vueParentComponent;
    const seen = new Set();

    while (component && !seen.has(component)) {
      seen.add(component);
      const sources = [component.setupState, component.ctx, component.exposed, component.proxy];

      for (const source of sources) {
        if (!source) continue;
        let candidate = null;
        try {
          candidate = source.editor;
        } catch (_) {}

        if (candidate && typeof candidate === 'object' && 'value' in candidate && candidate.value) {
          candidate = candidate.value;
        }

        if (candidate?.view && candidate?.state && candidate?.schema && candidate?.commands) return candidate;
      }

      component = component.parent;
    }

    return null;
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

  function makeButton(label, title, onClick, extraClass = '', disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-nmt-button-v2 ${extraClass}`.trim();
    button.textContent = label;
    button.title = title || label;
    button.disabled = disabled;

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!button.disabled) onClick();
    });

    return button;
  }

  function makeMiniButton(label, title, onClick, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-nmt-mini-button-v2${options.danger ? ' tm-nmt-mini-danger-v2' : ''}`;
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.disabled = Boolean(options.disabled);

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!button.disabled) onClick();
    });

    return button;
  }

  function makeAlignmentSelect(value, onChange) {
    const select = document.createElement('select');
    select.className = 'tm-nmt-align-select-v2';
    select.title = '列对齐方式';

    [
      ['left', '左对齐'],
      ['center', '居中'],
      ['right', '右对齐'],
    ].forEach(([optionValue, label]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      select.appendChild(option);
    });

    select.value = value;
    select.addEventListener('pointerdown', (event) => event.stopPropagation());
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', (event) => {
      event.stopPropagation();
      onChange(/** @type {Alignment} */ (select.value));
    });
    return select;
  }

  function makeCellInput(value, onInput) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tm-nmt-cell-input-v2';
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

  function alignmentClass(alignment) {
    if (alignment === 'center') return 'tm-nmt-align-center-v2';
    if (alignment === 'right') return 'tm-nmt-align-right-v2';
    return 'tm-nmt-align-left-v2';
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
    model.alignments.splice(safeIndex, 0, 'left');
    model.rows.forEach((row) => row.splice(safeIndex, 0, ''));
    return true;
  }

  function deleteColumn(model, index) {
    if (model.headers.length <= 1 || index < 0 || index >= model.headers.length) return false;
    model.headers.splice(index, 1);
    model.alignments.splice(index, 1);
    model.rows.forEach((row) => row.splice(index, 1));
    return true;
  }

  function renderReadOnlyTable(model, container) {
    const table = document.createElement('table');
    table.className = 'tm-nmt-table-v2';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    model.headers.forEach((header, columnIndex) => {
      const th = document.createElement('th');
      th.className = alignmentClass(model.alignments[columnIndex]);
      th.textContent = header;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (!model.rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'tm-nmt-empty-v2';
      td.colSpan = model.headers.length;
      td.textContent = '暂无数据行';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      model.rows.forEach((row) => {
        const tr = document.createElement('tr');
        row.forEach((cell, columnIndex) => {
          const td = document.createElement('td');
          td.className = alignmentClass(model.alignments[columnIndex]);
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
    let statusMessage = '';
    let destroyed = false;

    const dom = document.createElement('div');
    dom.className = NODEVIEW_CLASS;
    dom.contentEditable = 'false';
    dom.dataset.nocodbMarkdownTableId = stored.id || 'legacy';

    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) => {
      dom.addEventListener(type, (event) => event.stopPropagation());
    });

    function setStatus(message) {
      statusMessage = message;
    }

    function rerender() {
      if (destroyed) return;
      dom.replaceChildren();
      dom.dataset.nocodbMarkdownTableId = stored.id || 'legacy';

      const toolbar = document.createElement('div');
      toolbar.className = 'tm-nmt-toolbar-v2';

      const toolbarLeft = document.createElement('div');
      toolbarLeft.className = 'tm-nmt-toolbar-left-v2';
      const title = document.createElement('span');
      title.className = 'tm-nmt-title-v2';
      title.textContent = 'Markdown 表格';
      toolbarLeft.appendChild(title);

      const toolbarRight = document.createElement('div');
      toolbarRight.className = 'tm-nmt-toolbar-right-v2';
      const editable = session.tiptap.isEditable !== false && session.editorDom.getAttribute('contenteditable') !== 'false';

      if (!editing) {
        if (editable) {
          toolbarRight.appendChild(makeButton('编辑表格', '编辑单元格、行和列', () => {
            editing = true;
            draft = cloneModel(stored.model);
            setStatus('');
            rerender();
          }));
        }
      } else {
        const model = draft;
        toolbarRight.append(
          makeButton('新增行', '在表格底部新增一行', () => {
            if (!model || !insertRow(model, model.rows.length)) {
              setStatus('已达到行数或单元格数量上限。');
            } else {
              setStatus('');
            }
            rerender();
          }, '', !model || !canInsertRow(model)),
          makeButton('新增列', '在表格右侧新增一列', () => {
            if (!model || !insertColumn(model, model.headers.length)) {
              setStatus('已达到列数或单元格数量上限。');
            } else {
              setStatus('');
            }
            rerender();
          }, '', !model || !canInsertColumn(model)),
          makeButton('取消', '放弃本次修改', () => {
            editing = false;
            draft = null;
            setStatus('');
            rerender();
          }),
          makeButton('保存', '保存并写回 NocoDB LongText', () => {
            if (!draft) return;

            let position;
            try {
              position = getPos();
            } catch (_) {
              position = null;
            }

            if (!Number.isInteger(position)) {
              setStatus('保存失败：无法定位原表格代码块。');
              rerender();
              return;
            }

            const state = editorView.state;
            const liveNode = state.doc.nodeAt(position);
            if (!liveNode || liveNode.type !== currentNode.type) {
              setStatus('保存失败：原表格代码块已发生变化。');
              rerender();
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
              setStatus('保存失败：无法创建新的代码块节点。');
              rerender();
              return;
            }

            editing = false;
            draft = null;
            statusMessage = '已写回 NocoDB。';

            try {
              editorView.dispatch(
                state.tr.replaceWith(position, position + liveNode.nodeSize, nextNode).scrollIntoView(),
              );
            } catch (_) {
              editing = true;
              draft = nextModel;
              setStatus('保存失败：NocoDB 拒绝了本次表格更新。');
              rerender();
            }
          }, 'tm-nmt-button-primary-v2'),
        );
      }

      toolbar.append(toolbarLeft, toolbarRight);
      dom.appendChild(toolbar);

      const status = document.createElement('div');
      status.className = 'tm-nmt-status-v2';
      status.textContent = statusMessage;
      dom.appendChild(status);

      const scroll = document.createElement('div');
      scroll.className = 'tm-nmt-scroll-v2';

      if (!editing || !draft) {
        renderReadOnlyTable(stored.model, scroll);
      } else {
        const table = document.createElement('table');
        table.className = 'tm-nmt-table-v2';

        const thead = document.createElement('thead');
        const actionRow = document.createElement('tr');

        draft.headers.forEach((_, columnIndex) => {
          const th = document.createElement('th');
          th.className = 'tm-nmt-column-actions-v2';
          th.append(
            makeMiniButton('←+', '在左侧插入列', () => {
              if (!insertColumn(draft, columnIndex)) setStatus('已达到列数或单元格数量上限。');
              else setStatus('');
              rerender();
            }, { disabled: !canInsertColumn(draft) }),
            makeMiniButton('+→', '在右侧插入列', () => {
              if (!insertColumn(draft, columnIndex + 1)) setStatus('已达到列数或单元格数量上限。');
              else setStatus('');
              rerender();
            }, { disabled: !canInsertColumn(draft) }),
            makeMiniButton('×', '删除当前列', () => {
              deleteColumn(draft, columnIndex);
              setStatus('');
              rerender();
            }, { danger: true, disabled: draft.headers.length <= 1 }),
            makeAlignmentSelect(draft.alignments[columnIndex], (alignment) => {
              draft.alignments[columnIndex] = alignment;
              setStatus('');
              rerender();
            }),
          );
          actionRow.appendChild(th);
        });

        const actionHeader = document.createElement('th');
        actionHeader.className = 'tm-nmt-actions-cell-v2';
        actionHeader.textContent = '行操作';
        actionRow.appendChild(actionHeader);
        thead.appendChild(actionRow);

        const headerRow = document.createElement('tr');
        draft.headers.forEach((header, columnIndex) => {
          const th = document.createElement('th');
          th.className = alignmentClass(draft.alignments[columnIndex]);
          th.appendChild(makeCellInput(header, (value) => {
            draft.headers[columnIndex] = value;
          }));
          headerRow.appendChild(th);
        });
        const headerAction = document.createElement('th');
        headerAction.className = 'tm-nmt-actions-cell-v2';
        headerAction.textContent = '表头';
        headerRow.appendChild(headerAction);
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        if (!draft.rows.length) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.className = 'tm-nmt-empty-v2';
          td.colSpan = draft.headers.length;
          td.textContent = '暂无数据行，可点击“新增行”。';
          tr.appendChild(td);
          const actions = document.createElement('td');
          actions.className = 'tm-nmt-actions-cell-v2';
          tr.appendChild(actions);
          tbody.appendChild(tr);
        } else {
          draft.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            row.forEach((cell, columnIndex) => {
              const td = document.createElement('td');
              td.className = alignmentClass(draft.alignments[columnIndex]);
              td.appendChild(makeCellInput(cell, (value) => {
                draft.rows[rowIndex][columnIndex] = value;
              }));
              tr.appendChild(td);
            });

            const actions = document.createElement('td');
            actions.className = 'tm-nmt-actions-cell-v2';
            const actionGroup = document.createElement('div');
            actionGroup.className = 'tm-nmt-row-actions-v2';
            actionGroup.append(
              makeMiniButton('↑+', '在上方插入行', () => {
                if (!insertRow(draft, rowIndex)) setStatus('已达到行数或单元格数量上限。');
                else setStatus('');
                rerender();
              }, { disabled: !canInsertRow(draft) }),
              makeMiniButton('+↓', '在下方插入行', () => {
                if (!insertRow(draft, rowIndex + 1)) setStatus('已达到行数或单元格数量上限。');
                else setStatus('');
                rerender();
              }, { disabled: !canInsertRow(draft) }),
              makeMiniButton('×', '删除当前行', () => {
                deleteRow(draft, rowIndex);
                setStatus('');
                rerender();
              }, { danger: true }),
            );
            actions.appendChild(actionGroup);
            tr.appendChild(actions);
            tbody.appendChild(tr);
          });
        }

        table.appendChild(tbody);
        scroll.appendChild(table);
      }

      dom.appendChild(scroll);
    }

    rerender();

    return {
      dom,
      update(nextNode) {
        if (destroyed || nextNode.type !== currentNode.type) return false;
        const nextStored = parseStoredText(nextNode.textContent || '');
        if (!nextStored) return false;

        const changed = nextStored.sourceHash !== stored.sourceHash || nextStored.id !== stored.id || nextStored.legacy !== stored.legacy;
        currentNode = nextNode;
        stored = nextStored;

        if (changed && editing) {
          editing = false;
          draft = null;
          statusMessage = '表格内容已在外部更新，本次未保存的编辑已取消。';
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
    retryCounts.delete(editorDom);
    return session;
  }

  function ensureSession(editorDom) {
    if (!(editorDom instanceof HTMLElement) || !editorDom.isConnected) return null;

    const current = sessions.get(editorDom);
    if (current && !current.destroyed) return current;

    const tiptap = findTiptapEditor(editorDom);
    if (tiptap) return installSession(editorDom, tiptap);

    const retryCount = retryCounts.get(editorDom) || 0;
    if (retryCount < DISCOVERY_RETRY_LIMIT) {
      retryCounts.set(editorDom, retryCount + 1);
      window.setTimeout(() => ensureSession(editorDom), DISCOVERY_RETRY_DELAY);
    }
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
    retryCounts.delete(session.editorDom);
  }

  function getEventEditor(event) {
    let target = event.target;
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!(target instanceof HTMLElement)) return null;
    return target.closest(EDITOR_SELECTOR);
  }

  function onPaste(event) {
    if (!event.isTrusted) return;

    const editorDom = getEventEditor(event);
    if (!editorDom) return;

    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('pre, code, input, textarea, select, .' + NODEVIEW_CLASS)) return;

    const text = event.clipboardData?.getData('text/plain') || '';
    const model = parseMarkdownTable(text);
    if (!model) return;

    const session = ensureSession(editorDom);
    if (!session) return;

    const inserted = insertTableCodeBlock(session, model);
    if (!inserted) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function discoverEditorsWithin(node) {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(EDITOR_SELECTOR)) ensureSession(node);
    node.querySelectorAll?.(EDITOR_SELECTOR).forEach(ensureSession);
  }

  function cleanupDisconnectedSessions() {
    sessions.forEach((session) => {
      if (!session.editorDom.isConnected || session.tiptap?.isDestroyed) destroySession(session);
    });
  }

  function startDiscoveryObserver() {
    if (!document.body) return;

    document.querySelectorAll(EDITOR_SELECTOR).forEach(ensureSession);

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

  if (globalThis.__NOCODB_MARKDOWN_TABLE_TEST_MODE__ === true) {
    globalThis.__NOCODB_MARKDOWN_TABLE_TEST_API__ = TEST_API;
    return;
  }

  injectStyle();
  document.addEventListener('paste', onPaste, true);
  document.addEventListener('focusin', (event) => {
    const editor = getEventEditor(event);
    if (editor) ensureSession(editor);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDiscoveryObserver, { once: true });
  } else {
    startDiscoveryObserver();
  }
})();

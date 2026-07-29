// ==UserScript==
// @name         NocoDB Markdown 表格
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @version      1.0.0
// @description  自动识别粘贴到 NocoDB Rich Text 的 Markdown 表格，并提供低开销渲染、单元格编辑及行列增删
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * =============================================================================
 * NocoDB Markdown 表格：实现说明
 * =============================================================================
 *
 * 一、为什么使用“兼容表格块”
 * -----------------------------------------------------------------------------
 * NocoDB CE 的 LongText Rich Text 使用 Tiptap/ProseMirror，但当前编辑器 schema
 * 没有原生 table/tableRow/tableCell 节点。直接向 ProseMirror DOM 插入 <table>
 * 可能只在当前页面临时显示，无法保证保存、撤销和重新打开后的稳定性。
 *
 * 因此，本脚本采用以下持久化格式：
 *
 *   ```text
 *   [[NOCODB_MARKDOWN_TABLE_V1]]
 *   | A | B |
 *   |---|---|
 *   | 1 | 2 |
 *   ```
 *
 * 数据仍然保存在 LongText 的 Markdown 字符串中；代码块用于让 NocoDB CE
 * 稳定保存表格源码。脚本打开编辑器后识别标记，隐藏代码块的视觉内容，
 * 并在编辑器外层渲染可视化表格。
 *
 * 二、第一版能力
 * -----------------------------------------------------------------------------
 * 1) 粘贴内容整体为标准 Markdown 表格时自动识别；
 * 2) 自动包装为兼容表格块并交给 NocoDB/Tiptap 插入；
 * 3) 重新打开或刷新页面后自动渲染；
 * 4) 编辑表头、普通单元格；
 * 5) 在指定位置插入或删除行、列；
 * 6) 保留 Markdown 左对齐、居中、右对齐标记；
 * 7) 不修改 NocoDB 的 Tiptap schema，不直接往 ProseMirror 内部追加表格 DOM。
 *
 * 三、性能原则
 * -----------------------------------------------------------------------------
 * 1) 页面只注册一个 paste 事件；
 * 2) 全局 MutationObserver 只检查新增节点中是否出现 Rich Text 编辑器；
 * 3) 只对已经发现的编辑器做局部、合并后的扫描；
 * 4) 不监听每次键盘事件，不定时扫描整个页面；
 * 5) 只有存在兼容表格块时才进行定位计算；
 * 6) 表格编辑状态退出后销毁输入框。
 *
 * 四、格式边界
 * -----------------------------------------------------------------------------
 * - 支持标准矩形 Markdown 表格；
 * - 支持首尾竖线可有可无；
 * - 支持 \| 转义和简单行内代码中的竖线；
 * - 不支持跨行/跨列合并；
 * - 不支持单元格内多段落或真实换行；
 * - 单次自动转换最多 200 行、40 列、4000 个单元格、100000 个字符。
 *
 * =============================================================================
 */

(function () {
  'use strict';

  const EDITOR_SELECTOR = '.nc-rich-text-content .tiptap.ProseMirror';
  const CONTENT_ROOT_SELECTOR = '.nc-rich-text-content';
  const TABLE_MARKER = '[[NOCODB_MARKDOWN_TABLE_V1]]';
  const STYLE_ID = 'tm-nocodb-markdown-table-style-v1';
  const ROOT_CLASS = 'tm-nmt-content-root-v1';
  const LAYER_CLASS = 'tm-nmt-layer-v1';
  const CARD_CLASS = 'tm-nmt-card-v1';
  const SOURCE_ATTR = 'data-tm-nmt-source-v1';

  const MAX_SOURCE_CHARS = 100000;
  const MAX_COLUMNS = 40;
  const MAX_BODY_ROWS = 200;
  const MAX_CELLS = 4000;

  /** @type {Map<HTMLElement, EditorSession>} */
  const sessions = new Map();
  let globalPositionFrame = 0;

  /**
   * @typedef {'left'|'center'|'right'} Alignment
   * @typedef {{ headers: string[], rows: string[][], alignments: Alignment[] }} TableModel
   * @typedef {{
   *   pre: HTMLElement,
   *   code: HTMLElement,
   *   card: HTMLDivElement,
   *   model: TableModel,
   *   sourceHash: string,
   *   editing: boolean,
   *   draft: TableModel|null
   * }} TableView
   * @typedef {{
   *   editor: HTMLElement,
   *   root: HTMLElement,
   *   layer: HTMLDivElement,
   *   observer: MutationObserver,
   *   resizeObserver: ResizeObserver|null,
   *   views: Map<HTMLElement, TableView>,
   *   scanTimer: number,
   *   positionFrame: number,
   *   destroyed: boolean
   * }} EditorSession
   */

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${ROOT_CLASS} {
        position: relative !important;
      }

      .${LAYER_CLASS} {
        position: absolute;
        inset: 0;
        z-index: 24;
        pointer-events: none;
      }

      .${CARD_CLASS} {
        position: absolute;
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid var(--nc-border-gray-medium, rgba(0, 0, 0, 0.16));
        border-radius: 8px;
        background: var(--nc-bg-default, #fff);
        color: var(--nc-content-gray, #222);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        pointer-events: auto;
      }

      .${CARD_CLASS} * {
        box-sizing: border-box;
      }

      .tm-nmt-toolbar-v1 {
        min-height: 36px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 5px 7px;
        border-bottom: 1px solid var(--nc-border-gray-light, rgba(0, 0, 0, 0.10));
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-toolbar-left-v1,
      .tm-nmt-toolbar-right-v1 {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
      }

      .tm-nmt-title-v1 {
        font-size: 12px;
        font-weight: 600;
        color: var(--nc-content-gray-subtle, #555);
        user-select: none;
      }

      .tm-nmt-button-v1 {
        min-height: 26px;
        padding: 3px 8px;
        border: 1px solid var(--nc-border-gray-medium, rgba(0, 0, 0, 0.16));
        border-radius: 6px;
        background: var(--nc-bg-default, #fff);
        color: inherit;
        font: inherit;
        font-size: 12px;
        line-height: 1.2;
        cursor: pointer;
        user-select: none;
      }

      .tm-nmt-button-v1:hover {
        background: var(--nc-bg-gray-medium, #efeff1);
      }

      .tm-nmt-button-v1:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .tm-nmt-button-primary-v1 {
        border-color: var(--nc-primary, #6c5ce7);
        background: var(--nc-primary, #6c5ce7);
        color: #fff;
      }

      .tm-nmt-button-danger-v1 {
        color: #b42318;
      }

      .tm-nmt-scroll-v1 {
        width: 100%;
        overflow: auto;
        max-height: min(62vh, 620px);
      }

      .tm-nmt-table-v1 {
        width: 100%;
        min-width: 360px;
        border-collapse: collapse;
        table-layout: auto;
        background: var(--nc-bg-default, #fff);
      }

      .tm-nmt-table-v1 th,
      .tm-nmt-table-v1 td {
        min-width: 96px;
        padding: 7px 9px;
        border-right: 1px solid var(--nc-border-gray-light, rgba(0, 0, 0, 0.10));
        border-bottom: 1px solid var(--nc-border-gray-light, rgba(0, 0, 0, 0.10));
        vertical-align: top;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .tm-nmt-table-v1 tr > :last-child {
        border-right: 0;
      }

      .tm-nmt-table-v1 tbody tr:last-child > * {
        border-bottom: 0;
      }

      .tm-nmt-table-v1 th {
        font-weight: 600;
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-cell-input-v1 {
        width: 100%;
        min-width: 84px;
        min-height: 30px;
        padding: 5px 7px;
        border: 1px solid var(--nc-border-gray-medium, rgba(0, 0, 0, 0.18));
        border-radius: 5px;
        outline: none;
        background: var(--nc-bg-default, #fff);
        color: inherit;
        font: inherit;
        line-height: 1.35;
      }

      .tm-nmt-cell-input-v1:focus {
        border-color: var(--nc-primary, #6c5ce7);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--nc-primary, #6c5ce7) 18%, transparent);
      }

      .tm-nmt-column-actions-v1,
      .tm-nmt-row-actions-v1 {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 3px;
      }

      .tm-nmt-column-actions-v1 {
        padding: 4px;
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-mini-button-v1 {
        min-width: 24px;
        height: 24px;
        padding: 0 5px;
        border: 1px solid var(--nc-border-gray-medium, rgba(0, 0, 0, 0.16));
        border-radius: 5px;
        background: var(--nc-bg-default, #fff);
        color: inherit;
        font-size: 11px;
        line-height: 22px;
        cursor: pointer;
      }

      .tm-nmt-mini-button-v1:hover {
        background: var(--nc-bg-gray-medium, #efeff1);
      }

      .tm-nmt-actions-cell-v1 {
        width: 116px;
        min-width: 116px !important;
        background: var(--nc-bg-gray-light, #f7f7f8);
      }

      .tm-nmt-align-left-v1 { text-align: left; }
      .tm-nmt-align-center-v1 { text-align: center; }
      .tm-nmt-align-right-v1 { text-align: right; }

      pre[${SOURCE_ATTR}="1"] {
        opacity: 0 !important;
        pointer-events: none !important;
        min-height: var(--tm-nmt-source-height-v1, 120px) !important;
      }
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
    if (last >= 0 && value[last] === '|' && !isEscapedAt(value, last)) {
      value = value.slice(0, -1);
    }
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
    if (!/^:?-{3,}:?$/.test(value)) return null;
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

  function buildStoredBlock(model) {
    return `\`\`\`text\n${TABLE_MARKER}\n${serializeMarkdownTable(model)}\n\`\`\``;
  }

  function parseStoredCode(code) {
    if (!(code instanceof HTMLElement)) return null;
    const raw = (code.textContent || '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n');
    const trimmedStart = raw.replace(/^\s+/, '');
    if (!trimmedStart.startsWith(TABLE_MARKER)) return null;

    const source = trimmedStart.slice(TABLE_MARKER.length).replace(/^\s*\n/, '');
    return parseMarkdownTable(source);
  }

  function findTiptapEditor(editorDom) {
    let component = editorDom && editorDom.__vueParentComponent;
    const seen = new Set();

    while (component && !seen.has(component)) {
      seen.add(component);
      const sources = [component.setupState, component.ctx, component.exposed, component.proxy];

      for (const source of sources) {
        if (!source) continue;
        let candidate;
        try {
          candidate = source.editor;
        } catch (_) {
          candidate = null;
        }

        if (candidate && typeof candidate === 'object' && 'value' in candidate && candidate.value) {
          candidate = candidate.value;
        }

        if (
          candidate &&
          typeof candidate === 'object' &&
          candidate.view &&
          candidate.commands &&
          candidate.storage
        ) {
          return candidate;
        }
      }

      component = component.parent;
    }

    return null;
  }

  function dispatchSyntheticPaste(editor, text) {
    try {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      editor.dispatchEvent(event);
      return event.defaultPrevented;
    } catch (_) {
      return false;
    }
  }

  function insertStoredBlock(editor, model) {
    const storedBlock = buildStoredBlock(model);
    const tiptap = findTiptapEditor(editor);

    try {
      if (tiptap?.chain) {
        const chain = tiptap.chain().focus().insertContent(storedBlock);
        if (chain.run()) return true;
      }
    } catch (_) {}

    if (dispatchSyntheticPaste(editor, storedBlock)) return true;

    try {
      editor.focus();
      return document.execCommand('insertText', false, storedBlock);
    } catch (_) {
      return false;
    }
  }

  function getEventEditor(event) {
    let target = event.target;
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!(target instanceof HTMLElement)) return null;
    return target.closest(EDITOR_SELECTOR);
  }

  function onPaste(event) {
    if (!event.isTrusted) return;
    const editor = getEventEditor(event);
    if (!editor) return;

    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('pre, code, input, textarea')) return;

    const text = event.clipboardData?.getData('text/plain') || '';
    const model = parseMarkdownTable(text);
    if (!model) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    ensureSession(editor);
    const inserted = insertStoredBlock(editor, model);
    if (inserted) {
      const session = sessions.get(editor);
      if (session) scheduleScan(session, 40);
    }
  }

  function makeButton(label, onClick, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-nmt-button-v1 ${extraClass}`.trim();
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function makeMiniButton(label, title, onClick, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-nmt-mini-button-v1${danger ? ' tm-nmt-button-danger-v1' : ''}`;
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function alignmentClass(alignment) {
    if (alignment === 'center') return 'tm-nmt-align-center-v1';
    if (alignment === 'right') return 'tm-nmt-align-right-v1';
    return 'tm-nmt-align-left-v1';
  }

  function createInput(value, onInput) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tm-nmt-cell-input-v1';
    input.value = value;
    input.addEventListener('input', () => onInput(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault();
      event.stopPropagation();
    });
    return input;
  }

  function renderReadOnlyTable(view, container) {
    const table = document.createElement('table');
    table.className = 'tm-nmt-table-v1';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    view.model.headers.forEach((header, columnIndex) => {
      const th = document.createElement('th');
      th.className = alignmentClass(view.model.alignments[columnIndex]);
      th.textContent = header;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    view.model.rows.forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((cell, columnIndex) => {
        const td = document.createElement('td');
        td.className = alignmentClass(view.model.alignments[columnIndex]);
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function insertColumn(model, index) {
    const safeIndex = Math.max(0, Math.min(index, model.headers.length));
    model.headers.splice(safeIndex, 0, '');
    model.alignments.splice(safeIndex, 0, 'left');
    model.rows.forEach((row) => row.splice(safeIndex, 0, ''));
  }

  function deleteColumn(model, index) {
    if (model.headers.length <= 1) return;
    model.headers.splice(index, 1);
    model.alignments.splice(index, 1);
    model.rows.forEach((row) => row.splice(index, 1));
  }

  function insertRow(model, index) {
    const safeIndex = Math.max(0, Math.min(index, model.rows.length));
    model.rows.splice(safeIndex, 0, Array(model.headers.length).fill(''));
  }

  function renderEditableTable(session, view, container) {
    const model = view.draft;
    if (!model) return;

    const table = document.createElement('table');
    table.className = 'tm-nmt-table-v1';

    const thead = document.createElement('thead');
    const actionRow = document.createElement('tr');

    model.headers.forEach((_, columnIndex) => {
      const th = document.createElement('th');
      th.className = 'tm-nmt-column-actions-v1';
      th.append(
        makeMiniButton('←+', '在左侧插入列', () => {
          insertColumn(model, columnIndex);
          renderView(session, view);
        }),
        makeMiniButton('+→', '在右侧插入列', () => {
          insertColumn(model, columnIndex + 1);
          renderView(session, view);
        }),
        makeMiniButton('×', '删除此列', () => {
          deleteColumn(model, columnIndex);
          renderView(session, view);
        }, true),
      );
      actionRow.appendChild(th);
    });

    const actionsHead = document.createElement('th');
    actionsHead.className = 'tm-nmt-actions-cell-v1';
    actionsHead.textContent = '行操作';
    actionRow.appendChild(actionsHead);
    thead.appendChild(actionRow);

    const headerRow = document.createElement('tr');
    model.headers.forEach((header, columnIndex) => {
      const th = document.createElement('th');
      th.className = alignmentClass(model.alignments[columnIndex]);
      th.appendChild(createInput(header, (value) => {
        model.headers[columnIndex] = value;
      }));
      headerRow.appendChild(th);
    });

    const alignmentCell = document.createElement('th');
    alignmentCell.className = 'tm-nmt-actions-cell-v1';
    const alignmentWrap = document.createElement('div');
    alignmentWrap.className = 'tm-nmt-row-actions-v1';
    alignmentWrap.textContent = '列对齐可在保存前保留原设置';
    alignmentCell.appendChild(alignmentWrap);
    headerRow.appendChild(alignmentCell);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    model.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.forEach((cell, columnIndex) => {
        const td = document.createElement('td');
        td.className = alignmentClass(model.alignments[columnIndex]);
        td.appendChild(createInput(cell, (value) => {
          model.rows[rowIndex][columnIndex] = value;
        }));
        tr.appendChild(td);
      });

      const actionCell = document.createElement('td');
      actionCell.className = 'tm-nmt-actions-cell-v1';
      const actions = document.createElement('div');
      actions.className = 'tm-nmt-row-actions-v1';
      actions.append(
        makeMiniButton('↑+', '在上方插入行', () => {
          insertRow(model, rowIndex);
          renderView(session, view);
        }),
        makeMiniButton('+↓', '在下方插入行', () => {
          insertRow(model, rowIndex + 1);
          renderView(session, view);
        }),
        makeMiniButton('×', '删除此行', () => {
          model.rows.splice(rowIndex, 1);
          renderView(session, view);
        }, true),
      );
      actionCell.appendChild(actions);
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function updateCodeBlock(session, view, model) {
    const newCodeText = `${TABLE_MARKER}\n${serializeMarkdownTable(model)}`;
    const code = view.pre.querySelector(':scope > code');
    if (!(code instanceof HTMLElement)) return false;

    const tiptap = findTiptapEditor(session.editor);
    const editorView = tiptap?.view;

    if (editorView?.state && typeof editorView.dispatch === 'function' && typeof editorView.posAtDOM === 'function') {
      try {
        const from = editorView.posAtDOM(code, 0);
        const to = editorView.posAtDOM(code, code.childNodes.length);
        const transaction = editorView.state.tr.insertText(newCodeText, from, to).scrollIntoView();
        editorView.dispatch(transaction);
        editorView.focus();
        return true;
      } catch (_) {}
    }

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(range);
      session.editor.focus();
      const ok = document.execCommand('insertText', false, newCodeText);
      selection?.removeAllRanges();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function renderView(session, view) {
    view.card.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'tm-nmt-toolbar-v1';
    const left = document.createElement('div');
    left.className = 'tm-nmt-toolbar-left-v1';
    const title = document.createElement('span');
    title.className = 'tm-nmt-title-v1';
    title.textContent = 'Markdown 表格';
    left.appendChild(title);

    const right = document.createElement('div');
    right.className = 'tm-nmt-toolbar-right-v1';
    const editable = session.editor.getAttribute('contenteditable') !== 'false';

    if (!view.editing) {
      if (editable) {
        right.appendChild(makeButton('编辑表格', () => {
          view.editing = true;
          view.draft = cloneModel(view.model);
          renderView(session, view);
        }));
      }
    } else {
      right.append(
        makeButton('新增行', () => {
          if (!view.draft) return;
          insertRow(view.draft, view.draft.rows.length);
          renderView(session, view);
        }),
        makeButton('新增列', () => {
          if (!view.draft) return;
          insertColumn(view.draft, view.draft.headers.length);
          renderView(session, view);
        }),
        makeButton('取消', () => {
          view.editing = false;
          view.draft = null;
          renderView(session, view);
        }),
        makeButton('保存', () => {
          if (!view.draft) return;
          const nextModel = cloneModel(view.draft);
          if (!updateCodeBlock(session, view, nextModel)) return;
          view.model = nextModel;
          view.sourceHash = modelHash(nextModel);
          view.editing = false;
          view.draft = null;
          renderView(session, view);
          scheduleScan(session, 80);
        }, 'tm-nmt-button-primary-v1'),
      );
    }

    toolbar.append(left, right);
    view.card.appendChild(toolbar);

    const scroll = document.createElement('div');
    scroll.className = 'tm-nmt-scroll-v1';
    if (view.editing) renderEditableTable(session, view, scroll);
    else renderReadOnlyTable(view, scroll);
    view.card.appendChild(scroll);

    schedulePosition(session);
  }

  function createTableView(session, pre, code, model) {
    const card = document.createElement('div');
    card.className = CARD_CLASS;
    card.addEventListener('pointerdown', (event) => event.stopPropagation());
    card.addEventListener('mousedown', (event) => event.stopPropagation());
    card.addEventListener('mouseup', (event) => event.stopPropagation());
    card.addEventListener('click', (event) => event.stopPropagation());
    session.layer.appendChild(card);

    const view = {
      pre,
      code,
      card,
      model,
      sourceHash: modelHash(model),
      editing: false,
      draft: null,
    };

    pre.setAttribute(SOURCE_ATTR, '1');
    renderView(session, view);
    return view;
  }

  function destroyTableView(view) {
    view.pre.removeAttribute(SOURCE_ATTR);
    view.pre.style.removeProperty('--tm-nmt-source-height-v1');
    view.card.remove();
  }

  function scanSession(session) {
    if (session.destroyed) return;
    if (!session.editor.isConnected || !session.root.isConnected) {
      destroySession(session);
      return;
    }

    const livePres = new Set();
    const codeBlocks = session.editor.querySelectorAll('pre > code');

    codeBlocks.forEach((code) => {
      if (!(code instanceof HTMLElement)) return;
      const pre = code.parentElement;
      if (!(pre instanceof HTMLElement)) return;

      const model = parseStoredCode(code);
      if (!model) return;
      livePres.add(pre);

      const existing = session.views.get(pre);
      if (!existing) {
        session.views.set(pre, createTableView(session, pre, code, model));
        return;
      }

      const nextHash = modelHash(model);
      existing.code = code;
      if (!existing.editing && existing.sourceHash !== nextHash) {
        existing.model = model;
        existing.sourceHash = nextHash;
        renderView(session, existing);
      }
    });

    for (const [pre, view] of session.views) {
      if (!livePres.has(pre) || !pre.isConnected) {
        destroyTableView(view);
        session.views.delete(pre);
      }
    }

    schedulePosition(session);
  }

  function scheduleScan(session, delay = 120) {
    if (session.destroyed) return;
    window.clearTimeout(session.scanTimer);
    session.scanTimer = window.setTimeout(() => scanSession(session), delay);
  }

  function positionSession(session) {
    if (session.destroyed || !session.root.isConnected) return;
    const rootRect = session.root.getBoundingClientRect();

    for (const view of session.views.values()) {
      if (!view.pre.isConnected || !view.card.isConnected) continue;

      const preRect = view.pre.getBoundingClientRect();
      const top = preRect.top - rootRect.top + session.root.scrollTop;
      const left = preRect.left - rootRect.left + session.root.scrollLeft;
      const availableWidth = Math.max(320, session.root.clientWidth - left - 4);
      const width = Math.max(320, Math.min(preRect.width || availableWidth, availableWidth));

      view.card.style.top = `${Math.max(0, top)}px`;
      view.card.style.left = `${Math.max(0, left)}px`;
      view.card.style.width = `${width}px`;

      const height = Math.max(92, Math.ceil(view.card.getBoundingClientRect().height));
      view.pre.style.setProperty('--tm-nmt-source-height-v1', `${height}px`);
    }
  }

  function schedulePosition(session) {
    if (session.destroyed || session.positionFrame) return;
    session.positionFrame = requestAnimationFrame(() => {
      session.positionFrame = 0;
      positionSession(session);
    });
  }

  function scheduleAllPositions() {
    if (globalPositionFrame) return;
    globalPositionFrame = requestAnimationFrame(() => {
      globalPositionFrame = 0;
      sessions.forEach((session) => {
        if (session.views.size) schedulePosition(session);
      });
    });
  }

  function ensureSession(editor) {
    if (!(editor instanceof HTMLElement)) return null;
    const existing = sessions.get(editor);
    if (existing) return existing;

    const root = editor.closest(CONTENT_ROOT_SELECTOR);
    if (!(root instanceof HTMLElement)) return null;

    root.classList.add(ROOT_CLASS);
    const layer = document.createElement('div');
    layer.className = LAYER_CLASS;
    root.appendChild(layer);

    const session = {
      editor,
      root,
      layer,
      observer: null,
      resizeObserver: null,
      views: new Map(),
      scanTimer: 0,
      positionFrame: 0,
      destroyed: false,
    };

    session.observer = new MutationObserver((mutations) => {
      const touchesCodeBlock = mutations.some((mutation) => {
        if (mutation.type === 'characterData') {
          return mutation.target.parentElement?.closest('pre') != null;
        }

        if (mutation.target instanceof HTMLElement && mutation.target.closest('pre')) return true;

        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return nodes.some((node) => {
          if (!(node instanceof HTMLElement)) return false;
          return node.matches('pre, code') || node.querySelector('pre, code') != null;
        });
      });

      if (touchesCodeBlock) scheduleScan(session);
    });
    session.observer.observe(editor, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    if (typeof ResizeObserver === 'function') {
      session.resizeObserver = new ResizeObserver(() => schedulePosition(session));
      session.resizeObserver.observe(root);
      session.resizeObserver.observe(editor);
    }

    sessions.set(editor, session);
    scheduleScan(session, 20);
    return session;
  }

  function destroySession(session) {
    if (session.destroyed) return;
    session.destroyed = true;
    window.clearTimeout(session.scanTimer);
    if (session.positionFrame) cancelAnimationFrame(session.positionFrame);
    session.observer?.disconnect();
    session.resizeObserver?.disconnect();
    session.views.forEach(destroyTableView);
    session.views.clear();
    session.layer.remove();
    session.root.classList.remove(ROOT_CLASS);
    sessions.delete(session.editor);
  }

  function discoverEditorsWithin(node) {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(EDITOR_SELECTOR)) ensureSession(node);
    node.querySelectorAll?.(EDITOR_SELECTOR).forEach(ensureSession);
  }

  function cleanupDisconnectedSessions() {
    sessions.forEach((session) => {
      if (!session.editor.isConnected || !session.root.isConnected) destroySession(session);
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

  injectStyle();
  document.addEventListener('paste', onPaste, true);
  document.addEventListener('focusin', (event) => {
    const editor = getEventEditor(event);
    if (editor) ensureSession(editor);
  }, true);
  document.addEventListener('scroll', scheduleAllPositions, true);
  window.addEventListener('resize', scheduleAllPositions, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDiscoveryObserver, { once: true });
  } else {
    startDiscoveryObserver();
  }
})();

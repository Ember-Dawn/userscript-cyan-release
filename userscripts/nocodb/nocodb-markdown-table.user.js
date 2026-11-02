// ==UserScript==
// @name         NocoDB Markdown 表格
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @version      0.4.0
// @description  在 NocoDB Rich Text 中内嵌显示 Markdown 表格并直接编辑单元格（TypeScript 重写）
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function(){'use strict';const registry={"constants":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENU_ICONS = exports.PAGE_GUARD = exports.STATE_ATTR = exports.READY_ATTR = exports.PASTE_RETRY_DELAY = exports.PASTE_RETRY_LIMIT = exports.DISCOVERY_RETRY_DELAY = exports.DISCOVERY_RETRY_LIMIT = exports.MAX_CELLS = exports.MAX_BODY_ROWS = exports.MAX_COLUMNS = exports.MAX_MIXED_TABLES = exports.MAX_MIXED_SOURCE_CHARS = exports.MAX_SOURCE_CHARS = exports.NODEVIEW_CLASS = exports.STYLE_ID = exports.NEW_MARKER_PATTERN = exports.LEGACY_MARKER = exports.MARKER_VERSION = exports.MARKER_TYPE = exports.CODE_BLOCK_LANGUAGE = exports.EDITOR_SELECTOR = void 0;
exports.EDITOR_SELECTOR = '.nc-rich-text-content .tiptap.ProseMirror';
exports.CODE_BLOCK_LANGUAGE = 'nocodb-table';
exports.MARKER_TYPE = 'NOCODB_MARKDOWN_TABLE';
exports.MARKER_VERSION = 'v1';
exports.LEGACY_MARKER = '[[NOCODB_MARKDOWN_TABLE_V1]]';
exports.NEW_MARKER_PATTERN = /^\[\[NOCODB_MARKDOWN_TABLE:v1:([A-Za-z0-9_-]{6,64})\]\]$/;
exports.STYLE_ID = 'tm-nocodb-markdown-table-style-v31';
exports.NODEVIEW_CLASS = 'tm-nocodb-markdown-table-v31';
exports.MAX_SOURCE_CHARS = 100000;
exports.MAX_MIXED_SOURCE_CHARS = 300000;
exports.MAX_MIXED_TABLES = 24;
exports.MAX_COLUMNS = 40;
exports.MAX_BODY_ROWS = 200;
exports.MAX_CELLS = 4000;
exports.DISCOVERY_RETRY_LIMIT = 30;
exports.DISCOVERY_RETRY_DELAY = 100;
exports.PASTE_RETRY_LIMIT = 30;
exports.PASTE_RETRY_DELAY = 50;
exports.READY_ATTR = 'data-tm-nmt-ready';
exports.STATE_ATTR = 'data-tm-nmt-state';
exports.PAGE_GUARD = '__NOCODB_MARKDOWN_TABLE_PAGE_V31__';
exports.MENU_ICONS = {
    '在上方插入行': '<path d="M4 11h16M4 17h16M12 3v6m-3-3h6"/>',
    '在下方插入行': '<path d="M4 7h16M4 13h16M12 15v6m-3-3h6"/>',
    '在左侧插入列': '<path d="M13 4v16M19 4v16M3 12h7m-3-3 3 3-3 3"/>',
    '在右侧插入列': '<path d="M5 4v16M11 4v16m3-8h7m-3-3 3 3-3 3"/>',
    '删除当前行': '<path d="M4 8h16M4 16h16m-9-6 4 4m0-4-4 4"/>',
    '删除当前列': '<path d="M7 4v16m10-16v16m-7-9 4 4m0-4-4 4"/>',
};

},
"types":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

},
"model":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloneModel = cloneModel;
exports.modelHash = modelHash;
exports.isEscapedAt = isEscapedAt;
exports.trimOuterPipe = trimOuterPipe;
exports.unescapeCell = unescapeCell;
exports.splitMarkdownRow = splitMarkdownRow;
exports.isValidSeparatorCell = isValidSeparatorCell;
exports.normalizeSourceLines = normalizeSourceLines;
exports.parseMarkdownTable = parseMarkdownTable;
exports.escapeCell = escapeCell;
exports.serializeMarkdownTable = serializeMarkdownTable;
exports.canInsertRow = canInsertRow;
exports.canInsertColumn = canInsertColumn;
exports.insertRow = insertRow;
exports.deleteRow = deleteRow;
exports.insertColumn = insertColumn;
exports.deleteColumn = deleteColumn;
const constants_1 = require("./constants");
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
    for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1)
        slashCount += 1;
    return slashCount % 2 === 1;
}
function trimOuterPipe(line) {
    let value = line.trim();
    if (value.startsWith('|'))
        value = value.slice(1);
    const last = value.length - 1;
    if (last >= 0 && value[last] === '|' && !isEscapedAt(value, last))
        value = value.slice(0, -1);
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
        }
        else {
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
            while (value[i + run] === '`')
                run += 1;
            buffer += '`'.repeat(run);
            if (activeBacktickRun === 0)
                activeBacktickRun = run;
            else if (activeBacktickRun === run)
                activeBacktickRun = 0;
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
function parseMarkdownTable(source) {
    if (typeof source !== 'string' || source.length === 0 || source.length > constants_1.MAX_SOURCE_CHARS)
        return null;
    const lines = normalizeSourceLines(source);
    while (lines.length && !lines[0].trim())
        lines.shift();
    while (lines.length && !lines[lines.length - 1].trim())
        lines.pop();
    if (lines.length < 2 || lines.length > constants_1.MAX_BODY_ROWS + 2)
        return null;
    if (!lines[0].includes('|') || !lines[1].includes('|'))
        return null;
    if (lines.some((line) => !line.trim() || !line.includes('|')))
        return null;
    const headers = splitMarkdownRow(lines[0]);
    const separator = splitMarkdownRow(lines[1]);
    if (headers.length < 2 || headers.length > constants_1.MAX_COLUMNS || separator.length !== headers.length)
        return null;
    if (separator.some((cell) => !isValidSeparatorCell(cell)))
        return null;
    const rows = [];
    for (const line of lines.slice(2)) {
        const row = splitMarkdownRow(line);
        if (row.length !== headers.length)
            return null;
        rows.push(row);
    }
    const cellCount = headers.length * (rows.length + 1);
    if (rows.length > constants_1.MAX_BODY_ROWS || cellCount > constants_1.MAX_CELLS)
        return null;
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
function canInsertRow(model) {
    return model.rows.length < constants_1.MAX_BODY_ROWS && model.headers.length * (model.rows.length + 2) <= constants_1.MAX_CELLS;
}
function canInsertColumn(model) {
    return model.headers.length < constants_1.MAX_COLUMNS && (model.headers.length + 1) * (model.rows.length + 1) <= constants_1.MAX_CELLS;
}
function insertRow(model, index) {
    if (!canInsertRow(model))
        return false;
    const safeIndex = Math.max(0, Math.min(index, model.rows.length));
    model.rows.splice(safeIndex, 0, Array(model.headers.length).fill(''));
    return true;
}
function deleteRow(model, index) {
    if (index < 0 || index >= model.rows.length)
        return false;
    model.rows.splice(index, 1);
    return true;
}
function insertColumn(model, index) {
    if (!canInsertColumn(model))
        return false;
    const safeIndex = Math.max(0, Math.min(index, model.headers.length));
    model.headers.splice(safeIndex, 0, '');
    model.rows.forEach((row) => row.splice(safeIndex, 0, ''));
    return true;
}
function deleteColumn(model, index) {
    if (model.headers.length <= 1 || index < 0 || index >= model.headers.length)
        return false;
    model.headers.splice(index, 1);
    model.rows.forEach((row) => row.splice(index, 1));
    return true;
}

},
"context-menu":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPointerEvent = stopPointerEvent;
exports.makeMenuItem = makeMenuItem;
const constants_1 = require("./constants");
function stopPointerEvent(event, preventDefault = true) {
    if (preventDefault)
        event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}
function makeMenuItem(label, onClick, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-nmt-menu-item-v31${options.danger ? ' is-danger' : ''}`;
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
    svg.innerHTML = constants_1.MENU_ICONS[label] || '<path d="M12 5v14M5 12h14"/>';
    const textLabel = document.createElement('span');
    textLabel.textContent = label;
    button.append(svg, textLabel);
    button.disabled = Boolean(options.disabled);
    button.addEventListener('pointerdown', (event) => stopPointerEvent(event));
    button.addEventListener('click', (event) => {
        stopPointerEvent(event);
        if (!button.disabled)
            onClick();
    });
    return button;
}

},
"history":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureCaret = captureCaret;
exports.setCaret = setCaret;
exports.recordUndo = recordUndo;
exports.historyCommand = historyCommand;
const model_1 = require("./model");
function captureCaret(dom, activeCell) {
    const activeEl = document.activeElement;
    const cell = activeEl?.closest?.('.tm-nmt-inline-content');
    if (!cell || !dom.contains(cell))
        return activeCell ? { ...activeCell } : null;
    const location = {
        row: Number(cell.dataset.row),
        col: Number(cell.dataset.col),
        anchor: 0,
        focus: 0,
    };
    const selection = window.getSelection();
    if (selection?.rangeCount && cell.contains(selection.anchorNode) && cell.contains(selection.focusNode)) {
        const offset = (node, value) => {
            const r = document.createRange();
            r.selectNodeContents(cell);
            r.setEnd(node, value);
            return r.toString().length;
        };
        try {
            if (selection.anchorNode && selection.focusNode) {
                location.anchor = offset(selection.anchorNode, selection.anchorOffset);
                location.focus = offset(selection.focusNode, selection.focusOffset);
            }
        }
        catch (_) { }
    }
    else if (activeCell?.row === location.row && activeCell?.col === location.col) {
        location.anchor = activeCell.anchor;
        location.focus = activeCell.focus;
    }
    return location;
}
function setCaret(dom, place) {
    if (!place)
        return null;
    const cell = dom.querySelector(`.tm-nmt-inline-content[data-row="${place.row}"][data-col="${place.col}"]`);
    if (!cell)
        return null;
    cell.focus({ preventScroll: true });
    const nodes = [];
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node);
    }
    if (!nodes.length) {
        const emptyText = document.createTextNode('');
        cell.appendChild(emptyText);
        nodes.push(emptyText);
    }
    const point = (value) => {
        let remaining = Math.max(0, value ?? 0);
        for (const node of nodes) {
            if (remaining <= (node.textContent?.length || 0)) {
                return { node, offset: remaining };
            }
            remaining -= node.textContent?.length || 0;
        }
        const node = nodes[nodes.length - 1];
        return { node, offset: node.textContent?.length || 0 };
    };
    try {
        const a = point(place.anchor);
        const f = point(place.focus);
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            if (typeof sel.setBaseAndExtent === 'function') {
                sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
            }
            else {
                const r = document.createRange();
                r.setStart(f.node, f.offset);
                r.collapse(true);
                sel.addRange(r);
            }
        }
    }
    catch (_) { }
    return { ...place };
}
function recordUndo(undoStack, redoStack, before, caret = null, range = null) {
    if (!before)
        return;
    if (undoStack.length >= 80)
        undoStack.shift();
    undoStack.push({
        model: (0, model_1.cloneModel)(before),
        caret: caret ? { ...caret } : null,
        range: range ? { start: { ...range.start }, end: { ...range.end } } : null,
    });
    redoStack.length = 0;
}
function historyCommand(event, composing) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || composing) {
        return null;
    }
    const key = event.key?.toLowerCase();
    if (key === 'z')
        return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !event.shiftKey)
        return 'redo';
    return null;
}

},
"selection":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloneRange = cloneRange;
exports.normalizeSelection = normalizeSelection;
exports.selectionIsWholeTable = selectionIsWholeTable;
exports.selectedMarkdown = selectedMarkdown;
exports.selectedHtml = selectedHtml;
exports.paintSelection = paintSelection;
const model_1 = require("./model");
function cloneRange(range) {
    return range ? { start: { ...range.start }, end: { ...range.end } } : null;
}
function normalizeSelection(range) {
    if (!range)
        return null;
    const { start, end } = range;
    return {
        r1: Math.min(start.row, end.row),
        r2: Math.max(start.row, end.row),
        c1: Math.min(start.col, end.col),
        c2: Math.max(start.col, end.col),
    };
}
function selectionIsWholeTable(range, model) {
    return (!!range &&
        range.r1 === -1 &&
        range.r2 === model.rows.length - 1 &&
        range.c1 === 0 &&
        range.c2 === model.headers.length - 1);
}
function selectedMarkdown(range, model) {
    const cells = [];
    for (let r = range.r1; r <= range.r2; r += 1) {
        cells.push((r === -1 ? model.headers : model.rows[r]).slice(range.c1, range.c2 + 1));
    }
    return (0, model_1.serializeMarkdownTable)({ headers: cells[0], rows: cells.slice(1) });
}
function selectedHtml(range, model) {
    const table = document.createElement('table');
    for (let r = range.r1; r <= range.r2; r += 1) {
        const tr = document.createElement('tr');
        (r === -1 ? model.headers : model.rows[r]).slice(range.c1, range.c2 + 1).forEach((text) => {
            const cell = document.createElement(r === range.r1 ? 'th' : 'td');
            cell.textContent = text;
            tr.appendChild(cell);
        });
        table.appendChild(tr);
    }
    return table.outerHTML;
}
function paintSelection(dom, range) {
    dom.querySelectorAll('.tm-nmt-inline-cell').forEach((cell) => {
        const value = cell.querySelector('.tm-nmt-inline-content');
        const row = Number(value?.dataset.row);
        const col = Number(value?.dataset.col);
        cell.classList.toggle('tm-nmt-range-selected', !!range && row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2);
    });
}

},
"storage":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTableId = createTableId;
exports.buildMarkerLine = buildMarkerLine;
exports.parseMarkerLine = parseMarkerLine;
exports.buildStoredText = buildStoredText;
exports.parseStoredText = parseStoredText;
const constants_1 = require("./constants");
const model_1 = require("./model");
function createTableId() {
    try {
        if (globalThis.crypto?.getRandomValues) {
            const bytes = new Uint8Array(6);
            globalThis.crypto.getRandomValues(bytes);
            return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
        }
    }
    catch (_) { }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 16);
}
function buildMarkerLine(id) {
    return `[[${constants_1.MARKER_TYPE}:${constants_1.MARKER_VERSION}:${id}]]`;
}
function parseMarkerLine(line) {
    const value = String(line || '').trim();
    const current = value.match(constants_1.NEW_MARKER_PATTERN);
    if (current)
        return { id: current[1], legacy: false, markerLine: value };
    if (value === constants_1.LEGACY_MARKER)
        return { id: null, legacy: true, markerLine: value };
    return null;
}
function buildStoredText(model, id = createTableId()) {
    return `${buildMarkerLine(id)}\n${(0, model_1.serializeMarkdownTable)(model)}`;
}
function parseStoredText(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > constants_1.MAX_SOURCE_CHARS + 256)
        return null;
    const lines = raw.replace(/\u200B/g, '').replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && !lines[0].trim())
        lines.shift();
    if (!lines.length)
        return null;
    const marker = parseMarkerLine(lines[0]);
    if (!marker)
        return null;
    const source = lines.slice(1).join('\n');
    const model = (0, model_1.parseMarkdownTable)(source);
    if (!model)
        return null;
    return {
        ...marker,
        model,
        sourceHash: (0, model_1.modelHash)(model),
    };
}

},
"nodeview":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.languageAttrsForNodeType = languageAttrsForNodeType;
exports.showToast = showToast;
exports.copyMarkdownTable = copyMarkdownTable;
exports.createTableNodeView = createTableNodeView;
const constants_1 = require("./constants");
const context_menu_1 = require("./context-menu");
const history_1 = require("./history");
const model_1 = require("./model");
const selection_1 = require("./selection");
const storage_1 = require("./storage");
function languageAttrsForNodeType(nodeType, baseAttrs = {}) {
    const attrs = { ...baseAttrs };
    const declared = nodeType?.spec?.attrs || {};
    if (Object.prototype.hasOwnProperty.call(declared, 'language'))
        attrs.language = constants_1.CODE_BLOCK_LANGUAGE;
    else if (Object.prototype.hasOwnProperty.call(declared, 'lang'))
        attrs.lang = constants_1.CODE_BLOCK_LANGUAGE;
    else if (Object.prototype.hasOwnProperty.call(declared, 'params'))
        attrs.params = constants_1.CODE_BLOCK_LANGUAGE;
    return attrs;
}
function showToast(message, kind = 'success', duration = 1800) {
    if (!message || !document.body)
        return;
    const old = document.querySelector('.tm-nmt-toast-v31');
    if (old)
        old.remove();
    const toast = document.createElement('div');
    toast.className = `tm-nmt-toast-v31${kind === 'error' ? ' is-error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), duration);
}
async function copyMarkdownTable(model) {
    const markdown = (0, model_1.serializeMarkdownTable)(model);
    try {
        await navigator.clipboard.writeText(markdown);
        showToast('已复制 Markdown 表格', 'success', 1600);
    }
    catch (_) {
        showToast('复制失败：请检查剪贴板权限。', 'error', 3600);
    }
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
    button.addEventListener('pointerdown', (event) => (0, context_menu_1.stopPointerEvent)(event));
    button.addEventListener('click', (event) => {
        (0, context_menu_1.stopPointerEvent)(event);
        onClick();
    });
    return button;
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
    button.addEventListener('pointerdown', (event) => (0, context_menu_1.stopPointerEvent)(event));
    button.addEventListener('click', (event) => {
        (0, context_menu_1.stopPointerEvent)(event);
        onClick();
    });
    return button;
}
function createTableNodeView(session, initialNode, editorView, getPos, initialStored) {
    session.tableNodeViewCount += 1;
    let currentNode = initialNode;
    let stored = initialStored;
    let editing = false;
    let draft = null;
    let outsidePointerDownHandler = null;
    let destroyed = false;
    let contextMenu = null;
    let contextMenuHost = null;
    let contextMenuHostPosition = null;
    let selectionRange = null;
    let dragAnchor = null;
    let dragPointerId = null;
    let dragMoved = false;
    const undoStack = [];
    const redoStack = [];
    let lastTextEdit = { row: null, col: null, time: 0 };
    let activeCell = null;
    let composing = false;
    let pendingTextInput = null;
    let editBaseHash = null;
    let tableKeyboardOwner = false;
    const dom = document.createElement('div');
    dom.className = constants_1.NODEVIEW_CLASS;
    dom.contentEditable = 'false';
    dom.dataset.nocodbMarkdownTableId = stored.id || 'legacy';
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) => {
        dom.addEventListener(type, (event) => event.stopPropagation());
    });
    function isEditable() {
        return session.tiptap.isEditable !== false && session.editorDom.getAttribute('contenteditable') !== 'false';
    }
    function stopOutsideAutoSave() {
        if (!outsidePointerDownHandler)
            return;
        document.removeEventListener('pointerdown', outsidePointerDownHandler, true);
        outsidePointerDownHandler = null;
    }
    function startOutsideAutoSave() {
        if (outsidePointerDownHandler || destroyed)
            return;
        outsidePointerDownHandler = (event) => {
            if (!editing || destroyed)
                return;
            const target = event.target;
            if (target instanceof Node && (dom.contains(target) || contextMenu?.contains(target)))
                return;
            const saved = saveEditing();
            if (saved) {
                tableKeyboardOwner = false;
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };
        document.addEventListener('pointerdown', outsidePointerDownHandler, true);
    }
    function deleteTable() {
        if (!isEditable() || destroyed)
            return false;
        closeContextMenu();
        let position;
        try {
            position = getPos();
        }
        catch (_) {
            position = undefined;
        }
        if (!Number.isInteger(position)) {
            showToast('删除失败：无法定位原表格代码块。', 'error', 3600);
            return false;
        }
        const state = editorView.state;
        const liveNode = state.doc.nodeAt(position);
        const liveStored = liveNode ? (0, storage_1.parseStoredText)(liveNode.textContent || '') : null;
        if (!liveNode ||
            liveNode.type !== currentNode.type ||
            !liveStored ||
            liveStored.id !== stored.id ||
            liveStored.sourceHash !== stored.sourceHash ||
            (editing && editBaseHash !== stored.sourceHash)) {
            showToast('删除失败：表格底层内容已变化，当前草稿已保留。', 'error', 4200);
            return false;
        }
        let nodeToDelete = liveNode;
        if (editing && draft && (0, model_1.modelHash)(draft) !== (0, model_1.modelHash)(stored.model)) {
            try {
                const text = (0, storage_1.buildStoredText)((0, model_1.cloneModel)(draft), stored.id || (0, storage_1.createTableId)());
                nodeToDelete = liveNode.type.create(languageAttrsForNodeType(liveNode.type, liveNode.attrs || {}), state.schema.text(text), liveNode.marks);
            }
            catch (_) {
                showToast('删除失败：无法保留未提交的单元格修改。', 'error', 3600);
                return false;
            }
        }
        try {
            stopOutsideAutoSave();
            editing = false;
            draft = null;
            pendingTextInput = null;
            editBaseHash = null;
            tableKeyboardOwner = false;
            if (nodeToDelete !== liveNode) {
                editorView.dispatch(editorView.state.tr
                    .replaceWith(position, position + liveNode.nodeSize, nodeToDelete)
                    .setMeta('addToHistory', false));
            }
            const deleteState = editorView.state;
            const actualNode = deleteState.doc.nodeAt(position);
            if (!actualNode ||
                actualNode.type !== nodeToDelete.type ||
                actualNode.textContent !== nodeToDelete.textContent) {
                showToast('删除已中止：提交后表格节点发生变化。', 'error', 4200);
                return false;
            }
            editorView.dispatch(deleteState.tr.delete(position, position + actualNode.nodeSize).setMeta('closeHistory', true).scrollIntoView());
            editorView.focus();
            showToast('已删除表格，可使用 Ctrl+Z 撤销', 'success', 1900);
            return true;
        }
        catch (error) {
            showToast('删除未完成：请检查当前表格是否仍存在。', 'error', 4200);
            console.warn('[NocoDB Markdown Table] 删除表格事务失败', error);
            return false;
        }
    }
    function closeContextMenu() {
        if (!contextMenu)
            return;
        contextMenu.remove();
        contextMenu = null;
        if (contextMenuHost && contextMenuHostPosition !== null) {
            contextMenuHost.style.position = contextMenuHostPosition;
        }
        contextMenuHost = null;
        contextMenuHostPosition = null;
    }
    function clearSelectionRange() {
        selectionRange = null;
        dragAnchor = null;
        dragPointerId = null;
        dragMoved = false;
        dom.querySelectorAll('.tm-nmt-range-selected').forEach((el) => el.classList.remove('tm-nmt-range-selected'));
        dom.querySelector('.tm-nmt-inline-table')?.classList.remove('tm-nmt-drag-selecting');
    }
    function extendCellRange(row, col) {
        if (!dragAnchor)
            return;
        if (row === dragAnchor.row && col === dragAnchor.col && !dragMoved)
            return;
        dragMoved = true;
        selectionRange = { start: { ...dragAnchor }, end: { row, col } };
        dom.querySelector('.tm-nmt-inline-table')?.classList.add('tm-nmt-drag-selecting');
        window.getSelection()?.removeAllRanges();
        (0, selection_1.paintSelection)(dom, (0, selection_1.normalizeSelection)(selectionRange));
    }
    function finishCellDrag() {
        dragAnchor = null;
        dragPointerId = null;
        dom.querySelector('.tm-nmt-inline-table')?.classList.remove('tm-nmt-drag-selecting');
    }
    function restoreHistory(source, target) {
        if (!editing || !draft || !source.length)
            return false;
        const currentCaret = (0, history_1.captureCaret)(dom, activeCell);
        target.push({
            model: (0, model_1.cloneModel)(draft),
            caret: currentCaret,
            range: (0, selection_1.cloneRange)(selectionRange),
        });
        const item = source.pop();
        draft = (0, model_1.cloneModel)(item.model);
        lastTextEdit.time = 0;
        pendingTextInput = null;
        clearSelectionRange();
        rerender();
        if (item.range) {
            selectionRange = (0, selection_1.cloneRange)(item.range);
            (0, selection_1.paintSelection)(dom, (0, selection_1.normalizeSelection)(selectionRange));
        }
        const fallback = item.range?.start || item.caret || currentCaret || { row: -1, col: 0 };
        const cell = closestExistingCell(fallback.row, fallback.col);
        if (cell) {
            activeCell = (0, history_1.setCaret)(dom, {
                row: cell.row,
                col: cell.col,
                anchor: item.range ? 0 : item.caret?.anchor ?? 0,
                focus: item.range ? 0 : item.caret?.focus ?? 0,
            });
        }
        tableKeyboardOwner = true;
        return true;
    }
    function closestExistingCell(row, col) {
        const model = draft || stored.model;
        const safeRow = Math.max(-1, Math.min(row, model.rows.length - 1));
        const safeCol = Math.max(0, Math.min(col, model.headers.length - 1));
        const candidate = dom.querySelector(`.tm-nmt-inline-content[data-row="${safeRow}"][data-col="${safeCol}"]`);
        return candidate ? { row: safeRow, col: safeCol } : null;
    }
    function restoreFocusAfterStructuralEdit(preferred) {
        const position = closestExistingCell(preferred?.row ?? -1, preferred?.col ?? 0);
        if (!position)
            return;
        activeCell = (0, history_1.setCaret)(dom, { ...position, anchor: 0, focus: 0 });
        tableKeyboardOwner = true;
    }
    function handleTableHistory(event) {
        const command = (0, history_1.historyCommand)(event, composing);
        if (!command || !isEditable())
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (editing && draft) {
            restoreHistory(command === 'undo' ? undoStack : redoStack, command === 'undo' ? redoStack : undoStack);
        }
        return true;
    }
    function cutSelectedRange(range) {
        const model = draft || stored.model;
        if ((0, selection_1.selectionIsWholeTable)(range, model))
            return deleteTable();
        if (!editing)
            enterEditing();
        const previous = (0, model_1.cloneModel)(draft);
        for (let r = range.r1; r <= range.r2; r += 1) {
            for (let c = range.c1; c <= range.c2; c += 1) {
                if (r === -1)
                    draft.headers[c] = '';
                else
                    draft.rows[r][c] = '';
            }
        }
        if ((0, model_1.modelHash)(previous) !== (0, model_1.modelHash)(draft)) {
            (0, history_1.recordUndo)(undoStack, redoStack, previous, (0, history_1.captureCaret)(dom, activeCell), (0, selection_1.cloneRange)(selectionRange));
        }
        lastTextEdit.time = 0;
        const preferred = { row: range.r1, col: range.c1 };
        clearSelectionRange();
        rerender();
        restoreFocusAfterStructuralEdit(preferred);
        return true;
    }
    function handleSelectedClipboard(event) {
        const range = (0, selection_1.normalizeSelection)(selectionRange);
        if (!range || !isEditable() || !event.clipboardData)
            return false;
        const model = draft || stored.model;
        const data = (0, selection_1.selectedMarkdown)(range, model);
        const html = (0, selection_1.selectedHtml)(range, model);
        try {
            event.clipboardData.setData('text/plain', data);
            event.clipboardData.setData('text/html', html);
        }
        catch (_) {
            return false;
        }
        if (event.clipboardData.getData('text/plain') !== data)
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.type === 'cut')
            cutSelectedRange(range);
        return true;
    }
    function mutateDraft(operation) {
        if (!editing)
            enterEditing();
        if (!draft)
            return false;
        const before = (0, model_1.cloneModel)(draft);
        const result = operation(draft);
        if (result && (0, model_1.modelHash)(before) !== (0, model_1.modelHash)(draft)) {
            (0, history_1.recordUndo)(undoStack, redoStack, before);
        }
        lastTextEdit.time = 0;
        return result;
    }
    function deleteSelectedCells() {
        const range = (0, selection_1.normalizeSelection)(selectionRange);
        if (!range || !isEditable())
            return false;
        if (!editing)
            enterEditing();
        if (!draft)
            return false;
        const beforeSelectionDelete = (0, model_1.cloneModel)(draft);
        const entireRows = range.c1 === 0 && range.c2 === draft.headers.length - 1 && range.r1 >= 0;
        const entireColumns = range.r1 === -1 && range.r2 === draft.rows.length - 1;
        if (entireRows) {
            for (let r = range.r2; r >= range.r1; r -= 1)
                (0, model_1.deleteRow)(draft, r);
        }
        else if (entireColumns && range.c2 - range.c1 + 1 < draft.headers.length) {
            for (let c = range.c2; c >= range.c1; c -= 1)
                (0, model_1.deleteColumn)(draft, c);
        }
        else {
            for (let r = range.r1; r <= range.r2; r += 1) {
                for (let c = range.c1; c <= range.c2; c += 1) {
                    if (r === -1)
                        draft.headers[c] = '';
                    else
                        draft.rows[r][c] = '';
                }
            }
        }
        if ((0, model_1.modelHash)(beforeSelectionDelete) !== (0, model_1.modelHash)(draft)) {
            (0, history_1.recordUndo)(undoStack, redoStack, beforeSelectionDelete, (0, history_1.captureCaret)(dom, activeCell), (0, selection_1.cloneRange)(selectionRange));
        }
        lastTextEdit.time = 0;
        const preferred = { row: range.r1, col: range.c1 };
        clearSelectionRange();
        rerender();
        restoreFocusAfterStructuralEdit(preferred);
        return true;
    }
    function enterEditing() {
        if (!isEditable())
            return;
        editing = true;
        tableKeyboardOwner = true;
        draft = (0, model_1.cloneModel)(stored.model);
        editBaseHash = stored.sourceHash;
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
        if (!draft)
            return true;
        if (editBaseHash !== null && stored.sourceHash !== editBaseHash) {
            showToast('保存已阻止：底层表格发生变化，编辑草稿仍保留。', 'error', 4200);
            return false;
        }
        if ((0, model_1.modelHash)(draft) === (0, model_1.modelHash)(stored.model)) {
            stopOutsideAutoSave();
            editing = false;
            draft = null;
            pendingTextInput = null;
            editBaseHash = null;
            tableKeyboardOwner = false;
            rerender();
            return true;
        }
        let position;
        try {
            position = getPos();
        }
        catch (_) {
            position = undefined;
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
        const nextModel = (0, model_1.cloneModel)(draft);
        const nextId = stored.id || (0, storage_1.createTableId)();
        const nextText = (0, storage_1.buildStoredText)(nextModel, nextId);
        const nextAttrs = languageAttrsForNodeType(liveNode.type, liveNode.attrs || {});
        let nextNode;
        try {
            nextNode = liveNode.type.create(nextAttrs, nextText ? state.schema.text(nextText) : null, liveNode.marks);
        }
        catch (_) {
            showToast('保存失败：无法创建新的代码块节点。', 'error', 3600);
            return false;
        }
        stopOutsideAutoSave();
        editing = false;
        draft = null;
        pendingTextInput = null;
        editBaseHash = null;
        tableKeyboardOwner = false;
        try {
            editorView.dispatch(state.tr.replaceWith(position, position + liveNode.nodeSize, nextNode).scrollIntoView());
            showToast('已保存', 'success', 1600);
            return true;
        }
        catch (_) {
            editing = true;
            draft = nextModel;
            editBaseHash = stored.sourceHash;
            startOutsideAutoSave();
            showToast('保存失败：NocoDB 拒绝了本次表格更新。', 'error', 3600);
            rerender();
            return false;
        }
    }
    function rerender() {
        if (destroyed)
            return;
        closeContextMenu();
        dom.replaceChildren();
        dom.dataset.nocodbMarkdownTableId = stored.id || 'new';
        dom.classList.toggle('is-editing', editing);
        const current = draft || stored.model;
        if (isEditable()) {
            dom.appendChild(makeCopyTrigger(() => copyMarkdownTable(draft || stored.model)));
            dom.appendChild(makeDeleteTrigger(deleteTable));
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
            if (next) {
                next.focus();
                return true;
            }
            return false;
        };
        const openContextMenu = (event, row, col) => {
            if (!isEditable())
                return;
            event.preventDefault();
            event.stopPropagation();
            closeContextMenu();
            const menu = document.createElement('div');
            menu.className = 'tm-nmt-menu-v31 tm-nmt-inline-context';
            menu.style.position = 'absolute';
            menu.style.left = '0px';
            menu.style.top = '0px';
            const action = (label, operation, options = {}) => {
                menu.append((0, context_menu_1.makeMenuItem)(label, () => {
                    if (!mutateDraft(operation)) {
                        closeContextMenu();
                        alertLimit('无法完成操作：已达到行列限制。');
                        return;
                    }
                    const preferred = {
                        row: Math.max(0, Math.min(row, (draft?.rows.length || 1) - 1)),
                        col: Math.max(0, Math.min(col, (draft?.headers.length || 1) - 1)),
                    };
                    clearSelectionRange();
                    rerender();
                    restoreFocusAfterStructuralEdit(preferred);
                }, options));
            };
            action('在上方插入行', (m) => (0, model_1.insertRow)(m, Math.max(0, row)));
            action('在下方插入行', (m) => (0, model_1.insertRow)(m, Math.max(0, row + 1)));
            action('在左侧插入列', (m) => (0, model_1.insertColumn)(m, col));
            action('在右侧插入列', (m) => (0, model_1.insertColumn)(m, col + 1));
            if (row >= 0)
                action('删除当前行', (m) => (0, model_1.deleteRow)(m, row), { danger: true });
            if (current.headers.length > 1)
                action('删除当前列', (m) => (0, model_1.deleteColumn)(m, col), { danger: true });
            const host = (session.editorDom.closest('.nc-rich-text-content') || session.editorDom.parentElement);
            if (!host)
                return;
            contextMenuHost = host;
            contextMenuHostPosition = host.style.position;
            if (getComputedStyle(host).position === 'static')
                host.style.position = 'relative';
            host.appendChild(menu);
            contextMenu = menu;
            const hostRect = host.getBoundingClientRect();
            const rect = menu.getBoundingClientRect();
            const margin = 8;
            const x = Math.max(hostRect.left + margin, Math.min(event.clientX, Math.min(hostRect.right, window.innerWidth) - rect.width - margin));
            const y = Math.max(hostRect.top + margin, Math.min(event.clientY, Math.min(hostRect.bottom, window.innerHeight) - rect.height - margin));
            menu.style.left = `${(x - hostRect.left) / (hostRect.width / host.clientWidth || 1) + host.scrollLeft}px`;
            menu.style.top = `${(y - hostRect.top) / (hostRect.height / host.clientHeight || 1) + host.scrollTop}px`;
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
            span.spellcheck = false;
            span.setAttribute('role', 'textbox');
            span.setAttribute('aria-label', `第 ${row + 2} 行，第 ${col + 1} 列`);
            span.addEventListener('focus', () => {
                if (!editing)
                    enterEditing();
                tableKeyboardOwner = true;
                activeCell = (0, history_1.captureCaret)(dom, activeCell) || { row, col, anchor: 0, focus: 0 };
                lastTextEdit.time = 0;
            });
            span.addEventListener('beforeinput', (e) => {
                if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo')
                    return;
                if (!editing)
                    enterEditing();
                if (e.isComposing || composing)
                    return;
                pendingTextInput = {
                    row,
                    col,
                    caret: (0, history_1.captureCaret)(dom, activeCell),
                    before: draft ? (0, model_1.cloneModel)(draft) : null,
                };
            });
            span.addEventListener('compositionstart', () => {
                composing = true;
                pendingTextInput = null;
            });
            span.addEventListener('compositionend', () => {
                composing = false;
                lastTextEdit.time = 0;
                pendingTextInput = null;
            });
            span.addEventListener('keyup', () => {
                activeCell = (0, history_1.captureCaret)(dom, activeCell);
            });
            span.addEventListener('mouseup', () => {
                activeCell = (0, history_1.captureCaret)(dom, activeCell);
            });
            span.addEventListener('pointerdown', (e) => {
                if (e.button !== 0 || !isEditable())
                    return;
                clearSelectionRange();
                dragAnchor = { row, col };
                dragPointerId = e.pointerId;
            });
            span.addEventListener('pointerenter', (e) => {
                if (dragAnchor && e.buttons === 1 && dragPointerId === e.pointerId) {
                    extendCellRange(row, col);
                }
            });
            span.addEventListener('input', () => {
                if (!editing)
                    enterEditing();
                const clean = span.innerText.replace(/\r?\n/g, ' ');
                if (span.textContent !== clean)
                    span.textContent = clean;
                const previous = row === -1 ? draft.headers[col] : draft.rows[row][col];
                if (previous === clean)
                    return;
                const now = Date.now();
                const pending = pendingTextInput?.row === row && pendingTextInput?.col === col ? pendingTextInput : null;
                if (lastTextEdit.row !== row || lastTextEdit.col !== col || now - lastTextEdit.time > 850) {
                    const caret = pending?.caret || activeCell || (0, history_1.captureCaret)(dom, activeCell);
                    (0, history_1.recordUndo)(undoStack, redoStack, pending?.before || draft, caret);
                }
                pendingTextInput = null;
                lastTextEdit = { row, col, time: now };
                if (row === -1)
                    draft.headers[col] = clean;
                else
                    draft.rows[row][col] = clean;
            });
            span.addEventListener('paste', (e) => {
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
            span.addEventListener('keydown', (e) => {
                if (handleTableHistory(e))
                    return;
                e.stopPropagation();
                if (e.key === 'Escape') {
                    if (selectionRange) {
                        e.preventDefault();
                        clearSelectionRange();
                        return;
                    }
                    e.preventDefault();
                    span.blur();
                    return;
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
                    if (e.isComposing || e.repeat)
                        return;
                    if (!editing)
                        enterEditing();
                    if (!draft)
                        return;
                    if (row === -1) {
                        focusCell(0, col);
                        return;
                    }
                    if (row < draft.rows.length - 1) {
                        focusCell(row + 1, col);
                        return;
                    }
                    if (mutateDraft((m) => (0, model_1.insertRow)(m, m.rows.length))) {
                        const nextRow = draft.rows.length - 1;
                        rerender();
                        focusCell(nextRow, col);
                    }
                    else
                        alertLimit('无法新增行：已达到表格大小限制。');
                    return;
                }
                if (e.key !== 'Tab')
                    return;
                e.preventDefault();
                const index = targets.findIndex((x) => x.row === row && x.col === col);
                const next = targets[index + (e.shiftKey ? -1 : 1)];
                if (next) {
                    next.element.focus();
                    return;
                }
                if (!e.shiftKey && editing && draft && mutateDraft((m) => (0, model_1.insertRow)(m, m.rows.length))) {
                    const nextRow = draft.rows.length - 1;
                    rerender();
                    focusCell(nextRow, 0);
                }
            });
            span.addEventListener('contextmenu', (e) => openContextMenu(e, row, col));
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
    const onDragPointerMove = (event) => {
        if (!dragAnchor || event.pointerId !== dragPointerId || event.buttons !== 1)
            return;
        const targetEl = document.elementFromPoint(event.clientX, event.clientY);
        const cell = targetEl?.closest('.tm-nmt-inline-content');
        if (!cell || !dom.contains(cell))
            return;
        extendCellRange(Number(cell.dataset.row), Number(cell.dataset.col));
        if (dragMoved)
            event.preventDefault();
    };
    const onDragPointerEnd = (event) => {
        if (event.pointerId === dragPointerId)
            finishCellDrag();
    };
    const onSelectionKeydown = (event) => {
        if (!dom.isConnected)
            return;
        const inside = dom.contains(event.target);
        if ((inside ||
            selectionRange ||
            (tableKeyboardOwner && editing && document.activeElement === document.body)) &&
            handleTableHistory(event)) {
            return;
        }
        if (!selectionRange)
            return;
        if (event.key === 'Escape') {
            event.preventDefault();
            clearSelectionRange();
        }
        else if ((event.key === 'Delete' || event.key === 'Backspace') &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            deleteSelectedCells();
        }
    };
    const onContextDismiss = (event) => {
        if (contextMenu && !contextMenu.contains(event.target))
            closeContextMenu();
        if (selectionRange && !dom.contains(event.target) && !contextMenu?.contains(event.target)) {
            clearSelectionRange();
        }
        if (!dom.contains(event.target) && !contextMenu?.contains(event.target)) {
            tableKeyboardOwner = false;
        }
    };
    document.addEventListener('pointermove', onDragPointerMove, true);
    document.addEventListener('pointerup', onDragPointerEnd, true);
    document.addEventListener('pointercancel', onDragPointerEnd, true);
    const onHistoryBeforeInput = (event) => {
        if (!dom.contains(event.target) || !['historyUndo', 'historyRedo'].includes(event.inputType))
            return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (editing && draft && !composing) {
            restoreHistory(event.inputType === 'historyUndo' ? undoStack : redoStack, event.inputType === 'historyUndo' ? redoStack : undoStack);
        }
    };
    const onTableClipboard = (event) => {
        if (!selectionRange || !dom.isConnected || !['copy', 'cut'].includes(event.type))
            return;
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
            if (destroyed || nextNode.type !== currentNode.type)
                return false;
            const nextStored = (0, storage_1.parseStoredText)(nextNode.textContent || '');
            if (!nextStored)
                return false;
            const changed = nextStored.sourceHash !== stored.sourceHash ||
                nextStored.id !== stored.id ||
                nextStored.legacy !== stored.legacy;
            currentNode = nextNode;
            stored = nextStored;
            if (changed && editing) {
                showToast('表格底层内容已变化，当前草稿已保留；请先复制草稿再处理冲突。', 'error', 4200);
            }
            if (changed)
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
            if (destroyed)
                return;
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
            destroyed = true;
            session.tableNodeViewCount = Math.max(0, session.tableNodeViewCount - 1);
        },
    };
}

},
"paste":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitMixedMarkdown = splitMixedMarkdown;
exports.documentContainsTableId = documentContainsTableId;
exports.insertMixedMarkdown = insertMixedMarkdown;
exports.insertTableCodeBlock = insertTableCodeBlock;
const constants_1 = require("./constants");
const model_1 = require("./model");
const nodeview_1 = require("./nodeview");
const storage_1 = require("./storage");
function splitMixedMarkdown(source) {
    if (typeof source !== 'string' || source.length > constants_1.MAX_MIXED_SOURCE_CHARS)
        return null;
    const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const parts = [];
    let prose = [];
    let tableCount = 0;
    const flush = () => {
        if (prose.length)
            parts.push({ type: 'markdown', text: prose.join('\n') });
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
                if (match && match[1][0] === open[1][0] && match[1].length >= open[1].length)
                    break;
                close += 1;
            }
            if (close < lines.length) {
                flush();
                parts.push({
                    type: 'fence',
                    language: open[2].trim().split(/\s+/)[0] || '',
                    text: lines.slice(i + 1, close).join('\n'),
                });
                i = close + 1;
                continue;
            }
        }
        if (i + 1 < lines.length && line.includes('|') && lines[i + 1].includes('|')) {
            let end = i + 2;
            while (end < lines.length && lines[end].trim() && lines[end].includes('|'))
                end += 1;
            const model = (0, model_1.parseMarkdownTable)(lines.slice(i, end).join('\n'));
            if (model) {
                tableCount += 1;
                if (tableCount > constants_1.MAX_MIXED_TABLES)
                    return null;
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
function documentContainsTableId(doc, id) {
    let found = false;
    doc.descendants((node) => {
        if (found || node.type?.name !== 'codeBlock')
            return !found;
        const stored = (0, storage_1.parseStoredText)(node.textContent || '');
        if (stored?.id === id)
            found = true;
        return !found;
    });
    return found;
}
function insertMixedMarkdown(session, parts) {
    const { tiptap } = session;
    const view = tiptap.view;
    const state = view?.state;
    const schema = state?.schema;
    const codeType = schema?.nodes?.codeBlock;
    if (!codeType)
        throw new Error('codeblock-schema-unavailable');
    const parseClipboard = view.someProp?.('clipboardTextParser');
    if (typeof parseClipboard !== 'function')
        throw new Error('markdown-clipboard-parser-unavailable');
    const nodes = [];
    const expected = [];
    let tableCount = 0;
    for (const part of parts) {
        if (part.type === 'markdown') {
            if (!part.text.trim())
                continue;
            let slice;
            try {
                slice = parseClipboard(part.text, state.selection.$from, false, view);
            }
            catch (error) {
                throw new Error('prose-clipboard-parser-failed', { cause: error });
            }
            if (!slice?.content || !slice.content.childCount) {
                throw new Error('prose-clipboard-parser-empty');
            }
            slice.content.forEach((node) => nodes.push(node));
        }
        else if (part.type === 'fence') {
            const attrs = (0, nodeview_1.languageAttrsForNodeType)(codeType, { language: part.language });
            const node = codeType.create(attrs, part.text ? schema.text(part.text) : null);
            nodes.push(node);
            expected.push({ text: part.text, tableId: null });
        }
        else if (part.type === 'table') {
            const id = (0, storage_1.createTableId)();
            const text = (0, storage_1.buildStoredText)(part.model, id);
            const attrs = (0, nodeview_1.languageAttrsForNodeType)(codeType, { language: constants_1.CODE_BLOCK_LANGUAGE });
            nodes.push(codeType.create(attrs, schema.text(text)));
            expected.push({ text, tableId: id });
            tableCount += 1;
        }
    }
    if (!nodes.length || !tableCount)
        throw new Error('mixed-fragment-empty');
    let fragment;
    try {
        fragment = schema.nodes.doc.create(null, nodes).content;
    }
    catch (error) {
        throw new Error('mixed-fragment-invalid', { cause: error });
    }
    let transaction;
    try {
        const tr = state.tr.replaceSelection(new (state.selection.content().constructor)(fragment, 0, 0));
        transaction = tr;
    }
    catch (error) {
        throw new Error('mixed-transaction-build-failed', { cause: error });
    }
    const seen = expected.map(() => false);
    transaction.doc.descendants((node) => {
        if (node.type !== codeType)
            return;
        for (let i = 0; i < expected.length; i += 1) {
            if (seen[i] || node.textContent !== expected[i].text)
                continue;
            if (expected[i].tableId && (0, storage_1.parseStoredText)(node.textContent)?.id !== expected[i].tableId)
                continue;
            seen[i] = true;
            break;
        }
    });
    if (seen.some((ok) => !ok))
        throw new Error('codeblock-content-integrity-failed');
    try {
        view.dispatch(transaction.scrollIntoView());
    }
    catch (error) {
        throw new Error('mixed-transaction-dispatch-failed', { cause: error });
    }
    return true;
}
function insertTableCodeBlock(session, model) {
    const { tiptap } = session;
    const codeBlockType = tiptap.state?.schema?.nodes?.codeBlock;
    if (!codeBlockType)
        return false;
    const id = (0, storage_1.createTableId)();
    const text = (0, storage_1.buildStoredText)(model, id);
    const attrs = (0, nodeview_1.languageAttrsForNodeType)(codeBlockType, {});
    const json = {
        type: 'codeBlock',
        ...(Object.keys(attrs).length ? { attrs } : {}),
        content: [{ type: 'text', text }],
    };
    try {
        const inserted = tiptap.chain().focus().insertContent(json).run();
        if (inserted && documentContainsTableId(tiptap.state.doc, id))
            return true;
    }
    catch (_) { }
    try {
        const state = tiptap.state;
        const node = codeBlockType.create(attrs, state.schema.text(text));
        tiptap.view.dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
        return documentContainsTableId(tiptap.state.doc, id);
    }
    catch (_) {
        return false;
    }
}

},
"session":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unwrapEditorCandidate = unwrapEditorCandidate;
exports.findEditorInComponent = findEditorInComponent;
exports.findTiptapEditor = findTiptapEditor;
exports.setEditorConnectionState = setEditorConnectionState;
exports.createNodeViewFactory = createNodeViewFactory;
exports.restoreSelectionAfterNodeViewInstall = restoreSelectionAfterNodeViewInstall;
exports.installSession = installSession;
exports.clearDiscovery = clearDiscovery;
exports.scheduleSessionDiscovery = scheduleSessionDiscovery;
exports.ensureSession = ensureSession;
exports.destroySession = destroySession;
exports.getEventEditor = getEventEditor;
exports.queueTableInsert = queueTableInsert;
exports.onPaste = onPaste;
exports.discoverEditorsWithin = discoverEditorsWithin;
exports.cleanupDisconnectedSessions = cleanupDisconnectedSessions;
exports.startDiscoveryObserver = startDiscoveryObserver;
const constants_1 = require("./constants");
const model_1 = require("./model");
const nodeview_1 = require("./nodeview");
const paste_1 = require("./paste");
const storage_1 = require("./storage");
const sessions = new Map();
const discoveryStates = new WeakMap();
function unwrapEditorCandidate(value) {
    let candidate = value;
    const seen = new Set();
    for (let depth = 0; depth < 8 && candidate && !seen.has(candidate); depth += 1) {
        seen.add(candidate);
        if (candidate?.view?.state?.schema &&
            candidate?.state?.schema &&
            candidate?.commands &&
            typeof candidate?.chain === 'function') {
            return candidate;
        }
        let next = null;
        try {
            if (candidate && typeof candidate === 'object' && 'value' in candidate)
                next = candidate.value;
        }
        catch (_) { }
        if (!next) {
            try {
                if (candidate && typeof candidate === 'object' && '_value' in candidate)
                    next = candidate._value;
            }
            catch (_) { }
        }
        if (!next) {
            try {
                if (candidate && typeof candidate === 'object' && candidate.editor)
                    next = candidate.editor;
            }
            catch (_) { }
        }
        if (!next || next === candidate)
            break;
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
            if (!source)
                continue;
            for (const key of ['editor', 'editorRef', 'tiptap', 'tiptapEditor']) {
                let value = null;
                try {
                    value = source[key];
                }
                catch (_) { }
                const editor = unwrapEditorCandidate(value);
                if (editor)
                    return editor;
            }
        }
        component = component.parent;
    }
    return null;
}
function findTiptapEditor(editorDom) {
    if (!(editorDom instanceof HTMLElement))
        return null;
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
            if (editor)
                return editor;
        }
        const componentCandidates = [
            element.__vueParentComponent,
            element.__vue_app__?._instance,
        ];
        for (const component of componentCandidates) {
            if (!component || seenComponents.has(component))
                continue;
            seenComponents.add(component);
            const editor = findEditorInComponent(component);
            if (editor)
                return editor;
        }
    }
    return null;
}
function setEditorConnectionState(editorDom, state) {
    if (!(editorDom instanceof HTMLElement))
        return;
    editorDom.setAttribute(constants_1.STATE_ATTR, state);
    if (state === 'ready')
        editorDom.setAttribute(constants_1.READY_ATTR, '1');
    else
        editorDom.removeAttribute(constants_1.READY_ATTR);
}
function createNodeViewFactory(session) {
    return function codeBlockNodeView(node, view, getPos, decorations, innerDecorations) {
        const stored = (0, storage_1.parseStoredText)(node.textContent || '');
        if (stored)
            return (0, nodeview_1.createTableNodeView)(session, node, view, getPos, stored);
        if (typeof session.originalCodeBlockNodeView === 'function') {
            try {
                return session.originalCodeBlockNodeView(node, view, getPos, decorations, innerDecorations);
            }
            catch (_) { }
        }
        return null;
    };
}
function restoreSelectionAfterNodeViewInstall(view, editorDom, selection, hadFocus) {
    if (!hadFocus || !view || !editorDom?.isConnected || !selection)
        return;
    window.requestAnimationFrame(() => {
        if (!editorDom.isConnected || !view.state)
            return;
        try {
            const currentSelection = view.state.selection;
            if (!currentSelection?.eq?.(selection)) {
                view.dispatch(view.state.tr.setSelection(selection));
            }
            view.focus();
        }
        catch (_) { }
    });
}
function installSession(editorDom, tiptap) {
    const existing = sessions.get(editorDom);
    if (existing && existing.tiptap === tiptap && !existing.destroyed)
        return existing;
    if (existing)
        destroySession(existing);
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
    }
    catch (_) {
        return null;
    }
    sessions.set(editorDom, session);
    const discovery = discoveryStates.get(editorDom);
    if (discovery?.timer)
        window.clearTimeout(discovery.timer);
    discoveryStates.delete(editorDom);
    setEditorConnectionState(editorDom, 'ready');
    return session;
}
function clearDiscovery(editorDom) {
    const state = discoveryStates.get(editorDom);
    if (state?.timer)
        window.clearTimeout(state.timer);
    discoveryStates.delete(editorDom);
}
function scheduleSessionDiscovery(editorDom, reset = false) {
    if (!(editorDom instanceof HTMLElement) || !editorDom.isConnected)
        return;
    const current = discoveryStates.get(editorDom);
    if (reset && current?.timer)
        window.clearTimeout(current.timer);
    if (!reset && current?.timer)
        return;
    const attempts = reset ? 0 : current?.attempts || 0;
    if (attempts >= constants_1.DISCOVERY_RETRY_LIMIT) {
        clearDiscovery(editorDom);
        setEditorConnectionState(editorDom, 'unavailable');
        return;
    }
    setEditorConnectionState(editorDom, 'connecting');
    const timer = window.setTimeout(() => {
        discoveryStates.set(editorDom, { attempts: attempts + 1, timer: 0 });
        const session = ensureSession(editorDom, false);
        if (!session)
            scheduleSessionDiscovery(editorDom, false);
    }, constants_1.DISCOVERY_RETRY_DELAY);
    discoveryStates.set(editorDom, { attempts, timer });
}
function ensureSession(editorDom, scheduleRetry = true) {
    if (!(editorDom instanceof HTMLElement) || !editorDom.isConnected)
        return null;
    const current = sessions.get(editorDom);
    if (current && !current.destroyed) {
        setEditorConnectionState(editorDom, 'ready');
        return current;
    }
    const tiptap = findTiptapEditor(editorDom);
    if (tiptap)
        return installSession(editorDom, tiptap);
    if (scheduleRetry)
        scheduleSessionDiscovery(editorDom, false);
    return null;
}
function destroySession(session) {
    if (!session || session.destroyed)
        return;
    session.destroyed = true;
    try {
        if (session.view?.props?.nodeViews?.codeBlock === session.nodeViewFactory && session.editorDom.isConnected) {
            session.view.setProps({ nodeViews: session.originalNodeViews });
        }
    }
    catch (_) { }
    sessions.delete(session.editorDom);
    clearDiscovery(session.editorDom);
    session.editorDom.removeAttribute(constants_1.READY_ATTR);
    session.editorDom.removeAttribute(constants_1.STATE_ATTR);
}
function getEventEditor(event) {
    let target = event.target;
    if (target && target.nodeType === Node.TEXT_NODE)
        target = target.parentElement;
    if (!(target instanceof HTMLElement))
        return null;
    return target.closest(constants_1.EDITOR_SELECTOR);
}
function queueTableInsert(editorDom, model, mixedParts = null) {
    let attempts = 0;
    const tryInsert = () => {
        if (!editorDom.isConnected) {
            (0, nodeview_1.showToast)('Markdown 表格转换失败：Rich Text 编辑器已经关闭。', 'error', 3600);
            return;
        }
        const session = ensureSession(editorDom, false);
        if (session) {
            editorDom.focus({ preventScroll: true });
            let inserted = false;
            try {
                inserted = mixedParts
                    ? (0, paste_1.insertMixedMarkdown)(session, mixedParts)
                    : model
                        ? (0, paste_1.insertTableCodeBlock)(session, model)
                        : false;
            }
            catch (error) {
                console.warn('[NocoDB Markdown Table] 混合内容处理失败，阶段：', error?.message || 'unknown', error);
            }
            if (!inserted) {
                setEditorConnectionState(editorDom, 'insert-failed');
                console.warn('[NocoDB Markdown Table] 已连接 Tiptap，但代码块插入失败。');
                (0, nodeview_1.showToast)(mixedParts
                    ? '混合 Markdown 粘贴失败：请查看 Console 中的阶段错误；原文可重新粘贴。'
                    : 'Markdown 表格插入失败：请重试。', 'error', 4600);
            }
            return;
        }
        attempts += 1;
        if (attempts >= constants_1.PASTE_RETRY_LIMIT) {
            setEditorConnectionState(editorDom, 'unavailable');
            console.warn('[NocoDB Markdown Table] 无法取得当前 Rich Text 的 Tiptap 实例。');
            (0, nodeview_1.showToast)('Markdown 表格未插入：脚本无法连接当前 NocoDB Rich Text，请刷新页面后重试。', 'error', 4200);
            return;
        }
        scheduleSessionDiscovery(editorDom, attempts === 1);
        window.setTimeout(tryInsert, constants_1.PASTE_RETRY_DELAY);
    };
    tryInsert();
}
function onPaste(event) {
    if (!event.isTrusted)
        return;
    const editorDom = getEventEditor(event);
    if (!editorDom)
        return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(`pre, code, input, textarea, select, .${constants_1.NODEVIEW_CLASS}`))
        return;
    const text = event.clipboardData?.getData('text/plain') || '';
    const model = (0, model_1.parseMarkdownTable)(text);
    const mixedParts = model ? null : (0, paste_1.splitMixedMarkdown)(text);
    if (!model && !mixedParts)
        return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    queueTableInsert(editorDom, model, mixedParts);
}
function discoverEditorsWithin(node) {
    if (!(node instanceof HTMLElement))
        return;
    if (node.matches(constants_1.EDITOR_SELECTOR) && !ensureSession(node))
        scheduleSessionDiscovery(node, true);
    node.querySelectorAll?.(constants_1.EDITOR_SELECTOR).forEach((editor) => {
        if (editor instanceof HTMLElement && !ensureSession(editor))
            scheduleSessionDiscovery(editor, true);
    });
}
function cleanupDisconnectedSessions() {
    sessions.forEach((session) => {
        if (!session.editorDom.isConnected || session.tiptap?.isDestroyed)
            destroySession(session);
    });
}
function startDiscoveryObserver() {
    if (!document.body)
        return;
    document.querySelectorAll(constants_1.EDITOR_SELECTOR).forEach((editor) => {
        if (editor instanceof HTMLElement && !ensureSession(editor))
            scheduleSessionDiscovery(editor, true);
    });
    const observer = new MutationObserver((mutations) => {
        let shouldCleanup = false;
        for (const mutation of mutations) {
            mutation.addedNodes.forEach((node) => discoverEditorsWithin(node));
            if (mutation.removedNodes.length)
                shouldCleanup = true;
        }
        if (shouldCleanup)
            cleanupDisconnectedSessions();
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

},
"styles":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.injectStyle = injectStyle;
const constants_1 = require("./constants");
function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(constants_1.STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = constants_1.STYLE_ID;
    style.textContent = `
    .${constants_1.NODEVIEW_CLASS} {
      position: relative;
      width: 100%;
      max-width: 100%;
      margin: 10px 0;
      box-sizing: border-box;
      color: var(--nc-content-gray, #1f2937);
    }

    .${constants_1.NODEVIEW_CLASS},
    .${constants_1.NODEVIEW_CLASS} * {
      box-sizing: border-box;
    }

    .${constants_1.NODEVIEW_CLASS}.ProseMirror-selectednode {
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

    .${constants_1.NODEVIEW_CLASS}:hover .tm-nmt-delete-trigger-v31,
    .${constants_1.NODEVIEW_CLASS}:hover .tm-nmt-copy-trigger-v31,
    .${constants_1.NODEVIEW_CLASS}:focus-within .tm-nmt-delete-trigger-v31,
    .${constants_1.NODEVIEW_CLASS}:focus-within .tm-nmt-copy-trigger-v31 {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .tm-nmt-delete-trigger-v31:hover {
      background: #fef2f2;
    }

    .tm-nmt-copy-trigger-v31:hover {
      background: #f3f4f6;
    }

    .tm-nmt-delete-trigger-v31 svg,
    .tm-nmt-copy-trigger-v31 svg {
      width: 15px;
      height: 15px;
      pointer-events: none;
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

},
"main":function(require,module,exports){
"use strict";
// ==UserScript==
// @name         NocoDB Markdown 表格
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js
// @version      0.4.0
// @description  在 NocoDB Rich Text 中内嵌显示 Markdown 表格并直接编辑单元格（TypeScript 重写）
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("./constants");
const session_1 = require("./session");
const styles_1 = require("./styles");
function init() {
    const win = globalThis;
    if (win[constants_1.PAGE_GUARD] === 'ready')
        return;
    win[constants_1.PAGE_GUARD] = 'loading';
    (0, styles_1.injectStyle)();
    document.addEventListener('paste', session_1.onPaste, true);
    document.addEventListener('focusin', (event) => {
        const editor = (0, session_1.getEventEditor)(event);
        if (editor && !(0, session_1.ensureSession)(editor))
            (0, session_1.scheduleSessionDiscovery)(editor, true);
    }, true);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', session_1.startDiscoveryObserver, { once: true });
    }
    else {
        (0, session_1.startDiscoveryObserver)();
    }
    win[constants_1.PAGE_GUARD] = 'ready';
}
init();

}};const cache={};function get(name){const key=(name.startsWith('./')?name.slice(2):name);if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn(get,m,m.exports);return m.exports;}get('main');})();

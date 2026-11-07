// ==UserScript==
// @name         NocoDB Rich Text 增强
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-enhancer.user.js
// @version      0.1.1
// @description  NocoDB Rich Text 样式、代码块操作、图片预览和嵌套列表折叠
// @match        https://nocodb.380782744.xyz/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function(){'use strict';const registry={"features/visual-style":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initVisualStyle = initVisualStyle;
// @ts-nocheck
// Preserved behavior from the original userscript. Typed refactoring is incremental.
function initVisualStyle() {
    'use strict';
    /**
     * NocoDB Rich Text 视觉样式增强
     *
     * 合并自：
     * 1. NocoDB 彩虹标题 v1.0.2
     * 2. NocoDB LongText 字体改色 v2.2.0
     *
     * 作用：
     * 1. 为 LongText Rich Text 弹窗编辑器正文中的 H1-H6 添加彩虹标题颜色。
     * 2. 将 Rich Text 编辑器里的加粗文本 strong 改成 #cc6566。
     * 3. 将形如 【xxx】 的文本显示为 #3366ff。
     * 4. 将形如 「xxx」 的文本显示为 #c88445。
     * 5. 将弹窗编辑器普通顶层段落的下间距设为 4px、顶层有序/无序列表设为 0px，与当前 NocoDB 默认值一致。
     * 6. 仅为二级及更深层级的有序/无序列表绘制浅色层级引导线，不改变列表内容和缩进。
     *
     * 技术路线：
     * 1. 标题、加粗文字和段落间距使用普通 CSS，只改变显示层。
     * 2. 块间距只作用于 ProseMirror 的直接子级 p / ol / ul；列表内部 li > p 和引用块等嵌套段落不受影响；
     *    纯空段落（仅含 ProseMirror-trailingBreak）不增加额外 margin。
     * 3. 【xxx】/「xxx」使用 Chromium 的 CSS Custom Highlight API：
     *    - 只创建 Range 并注册到 CSS.highlights；
     *    - 不向 ProseMirror 正文插入 span；
     *    - 不修改 editor state、selection、保存内容或撤销栈。
     * 4. MutationObserver 只负责防抖后的 Custom Highlight 重算，不改写正文 DOM。
     *
     * 性能策略：
     * 1. 只扫描当前 LongText Rich Text 编辑器中的 Text 节点。
     * 2. 先用 indexOf 快速跳过没有目标起始符号的文本节点。
     * 3. 匹配规则限定为不跨行、非贪婪、最大 500 字符。
     * 4. 最大高亮数量限制为 3000。
     * 5. 多次 DOM 变化合并到一次 requestAnimationFrame / 短延迟重算。
     */
    const STYLE_ID = 'tm-nocodb-richtext-visual-style-v1';
    const COLOR_BOLD = '#cc6566';
    const COLOR_BRACKET_BLUE = '#3366ff';
    const COLOR_QUOTE_BROWN = '#c88445';
    const HIGHLIGHT_BRACKET = 'tm-nc-richtext-bracket-blue-v1';
    const HIGHLIGHT_QUOTE = 'tm-nc-richtext-quote-brown-v1';
    const EDITOR_SELECTOR = '.nc-rich-text-content .ProseMirror';
    const MAX_PAIR_CHARS = 500;
    const MAX_HIGHLIGHTS = 3000;
    let scanTimer = 0;
    let scanRaf = 0;
    function injectStyle() {
        if (document.getElementById(STYLE_ID))
            return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
      :root {
        --tm-rainbow-h1: #d65d0d;
        --tm-rainbow-h2: #d79920;
        --tm-rainbow-h3: #989719;
        --tm-rainbow-h4: #689d6a;
        --tm-rainbow-h5: #458488;
        --tm-rainbow-h6: #b16286;
      }

      /* 仅作用于弹窗编辑器正文，不作用于 TOC，不作用于普通页面正文 */
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h1,
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h1 * {
        color: var(--tm-rainbow-h1) !important;
      }

      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h2,
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h2 * {
        color: var(--tm-rainbow-h2) !important;
      }

      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h3,
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h3 * {
        color: var(--tm-rainbow-h3) !important;
      }

      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h4,
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h4 * {
        color: var(--tm-rainbow-h4) !important;
      }

      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h5,
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h5 * {
        color: var(--tm-rainbow-h5) !important;
      }

      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h6,
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h6 * {
        color: var(--tm-rainbow-h6) !important;
      }

      .nc-rich-text-content .ProseMirror strong {
        color: ${COLOR_BOLD} !important;
      }

      /* 使用当前 NocoDB 实测默认值；保留独立覆盖规则，避免影响列表内部 li > p。 */
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror > p {
        margin-top: 0 !important;
        margin-bottom: 4px !important;
      }

      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror > ol,
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror > ul {
        margin-top: 0 !important;
        margin-bottom: 0 !important;
      }

      /* 手动空行仍按原本高度显示，避免连续空行被额外放大。 */
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror > p:has(> br.ProseMirror-trailingBreak:only-child) {
        margin-top: 0 !important;
        margin-bottom: 0 !important;
      }

      /* 仅在二级及更深层列表绘制引导线，顶层列表不显示。
         将线放在嵌套列表的左边界外侧，避开列表符号和有序列表编号。 */
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror :is(ul, ol) > li > :is(ul, ol) {
        position: relative;
      }

      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror :is(ul, ol) > li > :is(ul, ol)::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: -1em;
        width: 1px;
        background-color: currentColor;
        opacity: 0.22;
        pointer-events: none;
      }

      ::highlight(${HIGHLIGHT_BRACKET}) {
        color: ${COLOR_BRACKET_BLUE};
      }

      ::highlight(${HIGHLIGHT_QUOTE}) {
        color: ${COLOR_QUOTE_BROWN};
      }
    `;
        document.head.appendChild(style);
    }
    function escapeRegExp(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function makePairRegexp(open, close) {
        return new RegExp(escapeRegExp(open) + '[^' + escapeRegExp(close) + '\\r\\n]{1,' + MAX_PAIR_CHARS + '}' + escapeRegExp(close), 'g');
    }
    const MATCH_RULES = [
        {
            regexp: makePairRegexp('【', '】'),
            highlightName: HIGHLIGHT_BRACKET,
            startChar: '【',
        },
        {
            regexp: makePairRegexp('「', '」'),
            highlightName: HIGHLIGHT_QUOTE,
            startChar: '「',
        },
    ];
    function isHighlightApiAvailable() {
        return Boolean(globalThis.CSS?.highlights && typeof globalThis.Highlight === 'function');
    }
    function shouldSkipTextNode(node) {
        const parent = node?.parentElement;
        if (!parent)
            return true;
        if (parent.closest('[data-nocodb-markdown-table-id]'))
            return true;
        if (parent.closest('[contenteditable="false"]'))
            return true;
        return false;
    }
    function collectRanges() {
        const rangesByName = new Map(MATCH_RULES.map((rule) => [rule.highlightName, []]));
        let count = 0;
        let stopped = false;
        const editors = document.querySelectorAll(EDITOR_SELECTOR);
        for (const editor of editors) {
            if (stopped)
                break;
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
            let node;
            while (!stopped && (node = walker.nextNode())) {
                if (shouldSkipTextNode(node))
                    continue;
                const text = node.nodeValue || '';
                if (!text || (text.indexOf('【') === -1 && text.indexOf('「') === -1))
                    continue;
                for (const rule of MATCH_RULES) {
                    if (text.indexOf(rule.startChar) === -1)
                        continue;
                    rule.regexp.lastIndex = 0;
                    let match;
                    while ((match = rule.regexp.exec(text))) {
                        const from = match.index;
                        const to = from + match[0].length;
                        if (to <= from)
                            continue;
                        const range = document.createRange();
                        range.setStart(node, from);
                        range.setEnd(node, to);
                        rangesByName.get(rule.highlightName).push(range);
                        count += 1;
                        if (count >= MAX_HIGHLIGHTS) {
                            stopped = true;
                            break;
                        }
                    }
                    if (stopped)
                        break;
                }
            }
        }
        return rangesByName;
    }
    function refreshHighlights() {
        scanTimer = 0;
        scanRaf = 0;
        injectStyle();
        if (!isHighlightApiAvailable())
            return;
        const rangesByName = collectRanges();
        for (const rule of MATCH_RULES) {
            const ranges = rangesByName.get(rule.highlightName) || [];
            CSS.highlights.delete(rule.highlightName);
            if (ranges.length)
                CSS.highlights.set(rule.highlightName, new Highlight(...ranges));
        }
    }
    function scheduleScan(delay = 80) {
        if (scanTimer)
            window.clearTimeout(scanTimer);
        if (scanRaf)
            window.cancelAnimationFrame(scanRaf);
        scanTimer = window.setTimeout(() => {
            scanTimer = 0;
            scanRaf = window.requestAnimationFrame(refreshHighlights);
        }, delay);
    }
    injectStyle();
    scheduleScan(0);
    const observer = new MutationObserver(() => {
        scheduleScan(80);
    });
    observer.observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
    });
}

},
"features/code-tools":function(require,module,exports){
"use strict";
// @ts-nocheck
// Preserved behavior from the original userscript. Typed refactoring is incremental.
/*
 * NocoDB 代码块工具
 *
 * 维护原则：
 * - 不往 ProseMirror 管理的 pre/code 内插入按钮或确认弹窗。
 * - 工具栏与确认弹窗只挂在 .nc-rich-text-content 的外部 overlay 中。
 * - 不给 .nc-rich-text 根节点增加定位，避免影响 NocoDB 顶部 bubble toolbar。
 * - 所有工具控件都必须阻断 pointer/mouse/click 事件，避免被识别为点击编辑弹窗外部。
 * - 清空时保留 codeBlock，只删除其中的文本内容；不要用 innerHTML/textContent 直接改写编辑器 DOM。
 *
 * 更完整的架构、交互与维护说明见同目录 nocodb-code-tools.md。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCodeTools = initCodeTools;
function initCodeTools() {
    'use strict';
    const STYLE_ID = 'tm-nocodb-code-tools-style-v5';
    const CONTENT_ROOT_CLASS = 'tm-nocodb-code-tools-content-root';
    const HOST_CLASS = 'tm-nocodb-code-tools-overlay-host';
    const TOOLBAR_CLASS = 'tm-nocodb-code-tools-toolbar';
    const TOOL_BUTTON_CLASS = 'tm-nocodb-code-tools-button';
    const CLEAR_BUTTON_CLASS = 'tm-nocodb-code-tools-clear';
    const COPY_BUTTON_CLASS = 'tm-nocodb-code-tools-copy';
    const CONFIRM_CLASS = 'tm-nocodb-code-tools-confirm';
    let activePre = null;
    let activeContentRoot = null;
    let toolbarBoundPre = null;
    let toolbar = null;
    let clearButton = null;
    let copyButton = null;
    let confirmPanel = null;
    let confirmTargetPre = null;
    let hideTimer = null;
    function injectStyle() {
        if (document.getElementById(STYLE_ID))
            return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
      .${CONTENT_ROOT_CLASS} {
        position: relative !important;
      }

      .${HOST_CLASS} {
        position: absolute;
        inset: 0;
        z-index: 30;
        pointer-events: none;
      }

      .${TOOLBAR_CLASS} {
        position: absolute;
        display: none;
        align-items: center;
        gap: 4px;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
      }

      .${TOOL_BUTTON_CLASS} {
        width: 32px;
        height: 32px;
        padding: 0;
        margin: 0;
        border: 1px solid rgba(0, 0, 0, 0.10);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        color: #333;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
        pointer-events: auto;
      }

      .${TOOL_BUTTON_CLASS}:hover {
        background: #f5f5f5;
      }

      .${TOOL_BUTTON_CLASS} svg {
        width: 16px;
        height: 16px;
        display: block;
        margin: auto;
        pointer-events: none;
      }

      .${CLEAR_BUTTON_CLASS} {
        color: #b91c1c;
      }

      .${CLEAR_BUTTON_CLASS} svg {
        width: 18px;
        height: 18px;
        overflow: visible;
      }

      .${COPY_BUTTON_CLASS}.tm-copy-success {
        color: #16a34a;
      }

      .${COPY_BUTTON_CLASS}.tm-copy-failed {
        color: #dc2626;
      }

      .${CONFIRM_CLASS} {
        position: absolute;
        display: none;
        width: 190px;
        padding: 12px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.99);
        color: #222;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
      }

      .${CONFIRM_CLASS} .tm-nocodb-code-tools-confirm-title {
        margin: 0 0 10px;
        font-size: 13px;
        line-height: 1.45;
        font-weight: 600;
      }

      .${CONFIRM_CLASS} .tm-nocodb-code-tools-confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .${CONFIRM_CLASS} button {
        min-width: 58px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 7px;
        background: #fff;
        color: #333;
        cursor: pointer;
      }

      .${CONFIRM_CLASS} button:hover {
        background: #f5f5f5;
      }

      .${CONFIRM_CLASS} .tm-nocodb-code-tools-confirm-clear {
        border-color: #dc2626;
        background: #dc2626;
        color: #fff;
      }

      .${CONFIRM_CLASS} .tm-nocodb-code-tools-confirm-clear:hover {
        background: #b91c1c;
      }
    `;
        document.head.appendChild(style);
    }
    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
    }
    function addProtectedControlEvents(element) {
        if (!element)
            return;
        element.addEventListener('pointerdown', stopEvent, true);
        element.addEventListener('mousedown', stopEvent, true);
        element.addEventListener('mouseup', stopEvent, true);
    }
    function isElementVisible(element) {
        if (!(element instanceof HTMLElement))
            return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden')
            return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }
    function getContentRoot(pre) {
        return pre ? pre.closest('.nc-rich-text-content') : null;
    }
    function isEditorCodeBlock(pre) {
        if (!(pre instanceof HTMLElement))
            return false;
        const editor = pre.closest('.nc-rich-text-content .tiptap.ProseMirror');
        const contentRoot = getContentRoot(pre);
        const code = pre.querySelector(':scope > code');
        if (!editor || !contentRoot || !code)
            return false;
        if (pre.closest('[data-nocodb-markdown-table-id]'))
            return false;
        if (!isElementVisible(editor) || !isElementVisible(contentRoot) || !isElementVisible(pre))
            return false;
        return true;
    }
    function getPreFromTarget(target) {
        let node = target;
        if (node && node.nodeType === Node.TEXT_NODE) {
            node = node.parentElement;
        }
        if (!(node instanceof HTMLElement))
            return null;
        const pre = node.closest('pre');
        if (!pre || !isEditorCodeBlock(pre))
            return null;
        return pre;
    }
    function getCodeText(pre) {
        const code = pre && pre.querySelector(':scope > code');
        if (!code)
            return '';
        return (code.textContent || '').replace(/\u200B/g, '');
    }
    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        }
        catch (_) { }
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text);
                return true;
            }
        }
        catch (_) { }
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', 'readonly');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            const ok = document.execCommand('copy');
            textarea.remove();
            return ok;
        }
        catch (error) {
            console.error('[NocoDB 代码块工具] copy failed:', error);
            return false;
        }
    }
    function placeCaretInCodeBlock(pre) {
        if (!pre || !document.contains(pre) || !isEditorCodeBlock(pre))
            return false;
        const code = pre.querySelector(':scope > code');
        const editor = pre.closest('.tiptap.ProseMirror');
        if (!code || !editor)
            return false;
        try {
            editor.focus({ preventScroll: true });
            const selection = window.getSelection();
            if (!selection)
                return false;
            const range = document.createRange();
            range.selectNodeContents(code);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return true;
        }
        catch (error) {
            console.error('[NocoDB 代码块工具] restore caret failed:', error);
            return false;
        }
    }
    function scheduleCaretRestore(pre) {
        const restore = () => placeCaretInCodeBlock(pre);
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(restore);
            });
            return;
        }
        window.setTimeout(restore, 0);
    }
    function clearCodeBlock(pre) {
        if (!pre || !isEditorCodeBlock(pre))
            return false;
        const code = pre.querySelector(':scope > code');
        const editor = pre.closest('.tiptap.ProseMirror');
        if (!code || !editor)
            return false;
        const text = getCodeText(pre);
        if (!text) {
            scheduleCaretRestore(pre);
            return true;
        }
        try {
            editor.focus({ preventScroll: true });
            const selection = window.getSelection();
            if (!selection)
                return false;
            const range = document.createRange();
            range.selectNodeContents(code);
            selection.removeAllRanges();
            selection.addRange(range);
            const deleted = document.execCommand('delete');
            if (!deleted)
                return false;
            // 删除完成后不要主动清掉 Selection；等待 ProseMirror 完成 DOM 同步后，
            // 再把折叠光标明确放回当前空 codeBlock 的第一行。
            scheduleCaretRestore(pre);
            return true;
        }
        catch (error) {
            console.error('[NocoDB 代码块工具] clear failed:', error);
            return false;
        }
    }
    function setCopyButtonState(ok) {
        if (!copyButton)
            return;
        copyButton.classList.remove('tm-copy-success', 'tm-copy-failed');
        copyButton.classList.add(ok ? 'tm-copy-success' : 'tm-copy-failed');
        copyButton.setAttribute('title', ok ? '已复制' : '复制失败');
        window.setTimeout(() => {
            if (!copyButton)
                return;
            copyButton.classList.remove('tm-copy-success', 'tm-copy-failed');
            copyButton.setAttribute('title', '复制代码');
        }, 1200);
    }
    function createToolbar() {
        if (toolbar && document.body.contains(toolbar))
            return toolbar;
        toolbar = document.createElement('div');
        toolbar.className = TOOLBAR_CLASS;
        clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = `${TOOL_BUTTON_CLASS} ${CLEAR_BUTTON_CLASS}`;
        clearButton.setAttribute('aria-label', '清空代码');
        clearButton.setAttribute('title', '清空代码');
        clearButton.innerHTML = `
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.058l-.5-8.5a.5.5 0 1 0-.998.058m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"></path>
      </svg>
    `;
        copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = `${TOOL_BUTTON_CLASS} ${COPY_BUTTON_CLASS}`;
        copyButton.setAttribute('aria-label', '复制代码');
        copyButton.setAttribute('title', '复制代码');
        copyButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H10V7h9z"></path>
      </svg>
    `;
        addProtectedControlEvents(toolbar);
        addProtectedControlEvents(clearButton);
        addProtectedControlEvents(copyButton);
        clearButton.addEventListener('click', (event) => {
            stopEvent(event);
            const targetPre = getBoundTargetPre();
            if (!targetPre)
                return;
            showConfirmPanel(targetPre);
        }, true);
        copyButton.addEventListener('click', async (event) => {
            stopEvent(event);
            const targetPre = getBoundTargetPre();
            if (!targetPre) {
                setCopyButtonState(false);
                return;
            }
            const text = getCodeText(targetPre);
            if (!text) {
                setCopyButtonState(false);
                return;
            }
            const ok = await copyText(text);
            setCopyButtonState(ok);
            positionControls();
        }, true);
        toolbar.addEventListener('mouseenter', cancelHide);
        toolbar.addEventListener('mouseleave', () => {
            if (!isConfirmOpen())
                scheduleHide(150);
        });
        toolbar.appendChild(clearButton);
        toolbar.appendChild(copyButton);
        return toolbar;
    }
    function createConfirmPanel() {
        if (confirmPanel && document.body.contains(confirmPanel))
            return confirmPanel;
        confirmPanel = document.createElement('div');
        confirmPanel.className = CONFIRM_CLASS;
        confirmPanel.setAttribute('role', 'dialog');
        confirmPanel.setAttribute('aria-label', '确认清空代码');
        confirmPanel.innerHTML = `
      <div class="tm-nocodb-code-tools-confirm-title">确认清空这个代码块？</div>
      <div class="tm-nocodb-code-tools-confirm-actions">
        <button type="button" class="tm-nocodb-code-tools-confirm-cancel">取消</button>
        <button type="button" class="tm-nocodb-code-tools-confirm-clear">确认清空</button>
      </div>
    `;
        addProtectedControlEvents(confirmPanel);
        const cancelButton = confirmPanel.querySelector('.tm-nocodb-code-tools-confirm-cancel');
        const confirmClearButton = confirmPanel.querySelector('.tm-nocodb-code-tools-confirm-clear');
        addProtectedControlEvents(cancelButton);
        addProtectedControlEvents(confirmClearButton);
        cancelButton.addEventListener('click', (event) => {
            stopEvent(event);
            hideConfirmPanel();
            cancelHide();
        }, true);
        confirmClearButton.addEventListener('click', (event) => {
            stopEvent(event);
            const targetPre = confirmTargetPre && document.contains(confirmTargetPre) && isEditorCodeBlock(confirmTargetPre)
                ? confirmTargetPre
                : null;
            hideConfirmPanel();
            if (!targetPre) {
                hideToolbar(true);
                return;
            }
            const ok = clearCodeBlock(targetPre);
            if (!ok) {
                console.warn('[NocoDB 代码块工具] 无法通过编辑器删除动作清空代码块。');
            }
            if (document.contains(targetPre) && isEditorCodeBlock(targetPre)) {
                activateForPre(targetPre);
            }
            else {
                hideToolbar(true);
            }
        }, true);
        confirmPanel.addEventListener('mouseenter', cancelHide);
        confirmPanel.addEventListener('mouseleave', cancelHide);
        return confirmPanel;
    }
    function getBoundTargetPre() {
        const targetPre = toolbarBoundPre && document.contains(toolbarBoundPre)
            ? toolbarBoundPre
            : activePre && document.contains(activePre)
                ? activePre
                : null;
        if (!targetPre || !isEditorCodeBlock(targetPre))
            return null;
        return targetPre;
    }
    function ensureOverlayHost(contentRoot) {
        if (!contentRoot)
            return null;
        contentRoot.classList.add(CONTENT_ROOT_CLASS);
        let host = contentRoot.querySelector(`:scope > .${HOST_CLASS}`);
        if (!host) {
            host = document.createElement('div');
            host.className = HOST_CLASS;
            contentRoot.appendChild(host);
        }
        const currentToolbar = createToolbar();
        const currentConfirmPanel = createConfirmPanel();
        if (currentToolbar.parentElement !== host)
            host.appendChild(currentToolbar);
        if (currentConfirmPanel.parentElement !== host)
            host.appendChild(currentConfirmPanel);
        return host;
    }
    function isConfirmOpen() {
        return Boolean(confirmPanel && confirmPanel.style.display !== 'none');
    }
    function showConfirmPanel(targetPre) {
        if (!targetPre || !activeContentRoot)
            return;
        ensureOverlayHost(activeContentRoot);
        confirmTargetPre = targetPre;
        confirmPanel.style.display = 'block';
        cancelHide();
        positionControls();
    }
    function hideConfirmPanel() {
        if (confirmPanel)
            confirmPanel.style.display = 'none';
        confirmTargetPre = null;
    }
    function showToolbar() {
        if (!activeContentRoot)
            return;
        ensureOverlayHost(activeContentRoot);
        if (toolbar)
            toolbar.style.display = 'flex';
    }
    function hideToolbar(clearActive = false) {
        cancelHide();
        hideConfirmPanel();
        if (toolbar) {
            toolbar.style.display = 'none';
        }
        if (copyButton) {
            copyButton.classList.remove('tm-copy-success', 'tm-copy-failed');
            copyButton.setAttribute('title', '复制代码');
        }
        if (clearActive) {
            activePre = null;
            activeContentRoot = null;
            toolbarBoundPre = null;
        }
    }
    function cancelHide() {
        if (hideTimer) {
            window.clearTimeout(hideTimer);
            hideTimer = null;
        }
    }
    function scheduleHide(delay = 150) {
        if (isConfirmOpen())
            return;
        cancelHide();
        hideTimer = window.setTimeout(() => {
            hideToolbar(true);
        }, delay);
    }
    function positionControls() {
        if (!toolbar || !activePre || !activeContentRoot) {
            hideToolbar(true);
            return;
        }
        if (!document.contains(activePre) ||
            !document.contains(activeContentRoot) ||
            !isEditorCodeBlock(activePre)) {
            hideToolbar(true);
            return;
        }
        const preRect = activePre.getBoundingClientRect();
        const contentRect = activeContentRoot.getBoundingClientRect();
        const toolbarWidth = toolbar.offsetWidth || 68;
        const toolbarHeight = toolbar.offsetHeight || 32;
        const margin = 8;
        let left = preRect.right - contentRect.left - toolbarWidth - margin;
        let top = preRect.top - contentRect.top + margin;
        const maxLeft = Math.max(8, contentRect.width - toolbarWidth - 8);
        const maxTop = Math.max(8, contentRect.height - toolbarHeight - 8);
        left = Math.max(8, Math.min(left, maxLeft));
        top = Math.max(8, Math.min(top, maxTop));
        toolbar.style.left = `${Math.round(left)}px`;
        toolbar.style.top = `${Math.round(top)}px`;
        if (isConfirmOpen() && clearButton && confirmPanel) {
            const clearLeft = left;
            const clearBottom = top + toolbarHeight;
            const panelWidth = confirmPanel.offsetWidth || 190;
            const panelHeight = confirmPanel.offsetHeight || 86;
            // 设计约定：确认弹窗右上角与“清空”按钮左下角重合。
            let panelLeft = clearLeft - panelWidth;
            let panelTop = clearBottom;
            panelLeft = Math.max(8, Math.min(panelLeft, contentRect.width - panelWidth - 8));
            panelTop = Math.max(8, Math.min(panelTop, contentRect.height - panelHeight - 8));
            confirmPanel.style.left = `${Math.round(panelLeft)}px`;
            confirmPanel.style.top = `${Math.round(panelTop)}px`;
        }
    }
    function activateForPre(pre) {
        if (!pre || !isEditorCodeBlock(pre)) {
            hideToolbar(true);
            return;
        }
        const contentRoot = getContentRoot(pre);
        if (!contentRoot) {
            hideToolbar(true);
            return;
        }
        if (confirmTargetPre && confirmTargetPre !== pre) {
            hideConfirmPanel();
        }
        activePre = pre;
        activeContentRoot = contentRoot;
        toolbarBoundPre = pre;
        showToolbar();
        positionControls();
    }
    function isControlTarget(target) {
        if (!(target instanceof Node))
            return false;
        return Boolean((toolbar && (target === toolbar || toolbar.contains(target))) ||
            (confirmPanel && (target === confirmPanel || confirmPanel.contains(target))));
    }
    function handleMouseMove(event) {
        if (isControlTarget(event.target)) {
            cancelHide();
            return;
        }
        if (isConfirmOpen()) {
            cancelHide();
            return;
        }
        const pre = getPreFromTarget(event.target);
        if (pre) {
            cancelHide();
            activateForPre(pre);
            return;
        }
        scheduleHide(150);
    }
    function handleDocumentPointerDown(event) {
        if (!isConfirmOpen())
            return;
        if (isControlTarget(event.target))
            return;
        hideConfirmPanel();
    }
    function handleScrollOrResize() {
        if (!activePre || !activeContentRoot)
            return;
        if (!document.contains(activePre) ||
            !document.contains(activeContentRoot) ||
            !isEditorCodeBlock(activePre)) {
            hideToolbar(true);
            return;
        }
        if (toolbar && toolbar.style.display !== 'none') {
            positionControls();
        }
    }
    function observeDom() {
        const observer = new MutationObserver(() => {
            if (!activePre || !activeContentRoot)
                return;
            if (!document.contains(activePre) ||
                !document.contains(activeContentRoot) ||
                !isEditorCodeBlock(activePre)) {
                hideToolbar(true);
                return;
            }
            if (toolbar && toolbar.style.display !== 'none') {
                positionControls();
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });
    }
    function init() {
        injectStyle();
        createToolbar();
        createConfirmPanel();
        hideToolbar(true);
        document.addEventListener('mousemove', handleMouseMove, true);
        document.addEventListener('pointerdown', handleDocumentPointerDown, true);
        document.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize, true);
        observeDom();
    }
    init();
}

},
"features/image-viewer":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initImageViewer = initImageViewer;
// @ts-nocheck
// Preserved behavior from the original userscript. Typed refactoring is incremental.
function initImageViewer() {
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
        if (document.getElementById(STYLE_ID))
            return;
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
        if (!viewer)
            return;
        viewer.image.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        viewer.scale.textContent = `${Math.round(state.scale * 100)}%`;
    }
    function getFitScale() {
        if (!state.naturalWidth || !state.naturalHeight)
            return 1;
        const availableWidth = Math.max(120, window.innerWidth - 80);
        const availableHeight = Math.max(120, window.innerHeight - 120);
        return Math.min(availableWidth / state.naturalWidth, availableHeight / state.naturalHeight, 1);
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
        if (Math.abs(newScale - oldScale) < 0.0001)
            return;
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
        if (viewer)
            return viewer;
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
            if (!button)
                return;
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
            if (!state.open)
                return;
            event.preventDefault();
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            zoomTo(state.scale * factor, event.clientX, event.clientY);
        }, { passive: false });
        viewer.image.addEventListener('pointerdown', (event) => {
            if (!state.open || event.button !== 0)
                return;
            event.preventDefault();
            state.dragging = true;
            state.dragPointerId = event.pointerId;
            state.dragLastX = event.clientX;
            state.dragLastY = event.clientY;
            viewer.image.classList.add('is-dragging');
            viewer.image.setPointerCapture(event.pointerId);
        });
        viewer.image.addEventListener('pointermove', (event) => {
            if (!state.dragging || event.pointerId !== state.dragPointerId)
                return;
            state.x += event.clientX - state.dragLastX;
            state.y += event.clientY - state.dragLastY;
            state.dragLastX = event.clientX;
            state.dragLastY = event.clientY;
            updateTransform();
        });
        function stopDragging(event) {
            if (!state.dragging || event.pointerId !== state.dragPointerId)
                return;
            state.dragging = false;
            state.dragPointerId = null;
            viewer.image.classList.remove('is-dragging');
        }
        viewer.image.addEventListener('pointerup', stopDragging);
        viewer.image.addEventListener('pointercancel', stopDragging);
        viewer.viewport.addEventListener('click', (event) => {
            if (event.target === viewer.viewport)
                closeViewer();
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
        if (!source)
            return;
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
        if (!viewer || !state.open)
            return;
        state.open = false;
        state.dragging = false;
        state.dragPointerId = null;
        viewer.image.classList.remove('is-dragging');
        viewer.root.classList.remove('is-open');
        viewer.image.removeAttribute('src');
        document.body.style.overflow = previousBodyOverflow;
    }
    function isSupportedRichTextImage(target) {
        if (!(target instanceof Element))
            return false;
        const image = target.closest(IMAGE_SELECTOR);
        if (!image)
            return false;
        if (image.closest(MARKDOWN_TABLE_SELECTOR))
            return false;
        return image;
    }
    document.addEventListener('dblclick', (event) => {
        const image = isSupportedRichTextImage(event.target);
        if (!image)
            return;
        event.preventDefault();
        event.stopPropagation();
        openViewer(image);
    }, true);
    document.addEventListener('keydown', (event) => {
        if (!state.open)
            return;
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
        if (state.open)
            fitImage();
    });
    injectStyle();
}

},
"features/list-fold":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initListFold = initListFold;
/** View-only folding of nested Tiptap lists. No nodes are inserted into the editor. */
const EDITOR = '.nc-rich-text-content .tiptap.ProseMirror';
const FOLDED = 'tm-nrl-collapsed';
const HOST_ID = 'tm-nrl-overlay';
const STYLE_ID = 'tm-nrl-styles';
function directSublist(item) {
    return Array.from(item.children).find((child) => child instanceof HTMLOListElement || child instanceof HTMLUListElement) ?? null;
}
function isRendered(item) {
    return item.isConnected && item.getClientRects().length > 0 &&
        !item.closest(`li.${FOLDED} > ol, li.${FOLDED} > ul`);
}
/** Includes ranges spanning the subtree even when both endpoints are outside it. */
function selectionIn(element) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount)
        return false;
    if ((selection.anchorNode && element.contains(selection.anchorNode)) ||
        (selection.focusNode && element.contains(selection.focusNode)))
        return true;
    for (let index = 0; index < selection.rangeCount; index++) {
        try {
            if (selection.getRangeAt(index).intersectsNode(element))
                return true;
        }
        catch { /* The editor may have replaced the node during a selection change. */ }
    }
    return false;
}
/** Put the caret in the visible parent paragraph before hiding its nested list. */
function moveSelectionOutOfSublist(item, sublist) {
    if (!selectionIn(sublist))
        return true;
    const editor = item.closest('.tiptap.ProseMirror');
    const paragraph = Array.from(item.children).find(child => child instanceof HTMLParagraphElement || child instanceof HTMLDivElement);
    if (!editor || !(paragraph instanceof HTMLElement))
        return false;
    const selection = window.getSelection();
    if (!selection)
        return false;
    try {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(false);
        // Focusing ProseMirror can restore its previous selection; focus first.
        editor.focus({ preventScroll: true });
        selection.removeAllRanges();
        selection.addRange(range);
        return !selectionIn(sublist);
    }
    catch {
        return false;
    }
}
function initListFold() {
    if (document.getElementById(HOST_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
    ${EDITOR} li.${FOLDED} > ol,
    ${EDITOR} li.${FOLDED} > ul { display: none !important; }
    #${HOST_ID} { position: fixed; inset: 0; pointer-events: none; z-index: 100000; }
    #${HOST_ID} .tm-nrl-toggle { position: absolute; width: 18px; height: 18px; padding: 0;
      display: flex; align-items: center; justify-content: center; color: #888;
      border: 0; background: transparent; border-radius: 3px; pointer-events: auto;
      cursor: pointer; }
    #${HOST_ID} .tm-nrl-toggle:hover { color: currentColor; background: rgba(127,127,127,.1); }
    #${HOST_ID} .tm-nrl-toggle svg { width: 14px; height: 14px; fill: none;
      stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  `;
    document.head.append(style);
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('aria-label', '列表折叠工具');
    document.body.append(host);
    const buttons = new Map();
    let frame = 0;
    const refresh = () => {
        frame = 0;
        const targets = new Set();
        document.querySelectorAll(EDITOR).forEach(editor => {
            if (!(editor instanceof HTMLElement) || !isRendered(editor))
                return;
            editor.querySelectorAll('li').forEach(item => {
                const child = directSublist(item);
                if (!child || !isRendered(item))
                    return;
                targets.add(item);
                let button = buttons.get(item);
                if (!button) {
                    button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'tm-nrl-toggle';
                    button.setAttribute('aria-label', '折叠子列表');
                    button.setAttribute('title', '折叠子列表');
                    // Do not focus the overlay: preserve the ProseMirror selection.
                    button.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
                    button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
                    button.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();
                        const sublist = directSublist(item);
                        if (!sublist)
                            return;
                        const collapsing = !item.classList.contains(FOLDED);
                        if (collapsing && !moveSelectionOutOfSublist(item, sublist))
                            return;
                        item.classList.toggle(FOLDED, collapsing);
                        schedule();
                    });
                    host.append(button);
                    buttons.set(item, button);
                }
                const collapsed = item.classList.contains(FOLDED);
                button.setAttribute('aria-expanded', String(!collapsed));
                button.setAttribute('aria-label', collapsed ? '展开子列表' : '折叠子列表');
                button.title = collapsed ? '展开子列表' : '折叠子列表';
                button.innerHTML = collapsed
                    ? '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>'
                    : '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
                const rect = item.getBoundingClientRect();
                // Overlay is outside ProseMirror and does not change native list marker alignment.
                const first = item.firstElementChild?.getBoundingClientRect();
                const top = first && first.height > 0 ? first.top : rect.top;
                const lineHeight = Number.parseFloat(getComputedStyle(item).lineHeight);
                const y = top + (Number.isFinite(lineHeight) ? Math.min(lineHeight, 30) : 22) / 2 - 9;
                const x = rect.left - 37;
                const visible = rect.width > 0 && y >= -18 && y < window.innerHeight && x >= 0 && x < window.innerWidth;
                button.style.display = visible ? 'flex' : 'none';
                button.style.left = `${x}px`;
                button.style.top = `${y}px`;
            });
        });
        for (const [item, button] of buttons) {
            if (!targets.has(item)) {
                button.remove();
                buttons.delete(item);
            }
        }
    };
    const schedule = () => {
        if (frame)
            return;
        frame = requestAnimationFrame(refresh);
    };
    const observer = new MutationObserver(mutations => {
        if (mutations.some(mutation => !host.contains(mutation.target) &&
            (mutation.type === 'childList' || mutation.type === 'characterData' ||
                (mutation.type === 'attributes' && mutation.attributeName !== 'class'))))
            schedule();
    });
    // Watch layout-affecting attributes, but exclude class changes caused by our own folding.
    observer.observe(document.body, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['style', 'hidden', 'aria-hidden'] });
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    document.addEventListener('selectionchange', () => {
        let expanded = false;
        for (const item of buttons.keys()) {
            if (!item.classList.contains(FOLDED))
                continue;
            const list = directSublist(item);
            if (list && selectionIn(list)) {
                item.classList.remove(FOLDED);
                expanded = true;
            }
        }
        if (expanded)
            schedule();
    });
    schedule();
}

},
"main":function(require,module,exports){
"use strict";
// ==UserScript==
// @name         NocoDB Rich Text 增强
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-enhancer.user.js
// @version      0.1.1
// @description  NocoDB Rich Text 样式、代码块操作、图片预览和嵌套列表折叠
// @match        https://nocodb.380782744.xyz/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==
Object.defineProperty(exports, "__esModule", { value: true });
const visual_style_1 = require("./features/visual-style");
const code_tools_1 = require("./features/code-tools");
const image_viewer_1 = require("./features/image-viewer");
const list_fold_1 = require("./features/list-fold");
(0, visual_style_1.initVisualStyle)();
(0, code_tools_1.initCodeTools)();
(0, image_viewer_1.initImageViewer)();
(0, list_fold_1.initListFold)();

}};const cache={};function normalize(from,name){if(!name.startsWith('.'))throw Error('External module not bundled: '+name);const pathParts=(from.split('/').slice(0,-1).concat(name.split('/')));const result=[];for(const part of pathParts){if(part==='.'||!part)continue;if(part==='..')result.pop();else result.push(part);}return result.join('/');}function get(key){if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn((name)=>get(normalize(key,name)),m,m.exports);return m.exports;}get('main');})();

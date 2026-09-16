// ==UserScript==
// @name         NocoDB Rich Text 视觉样式增强
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-style.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-style.user.js
// @version      1.1.0
// @description  NocoDB Rich Text 视觉样式增强：H1-H6 彩虹标题、加粗与特定符号文本改色，并增大普通顶层段落间距；不修改原文内容。
// @match        https://nocodb.380782744.xyz/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
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
   * 5. 增大弹窗编辑器普通顶层段落之间的间距，同时不额外放大纯空段落。
   *
   * 技术路线：
   * 1. 标题、加粗文字和段落间距使用普通 CSS，只改变显示层。
   * 2. 段落间距只作用于 ProseMirror 的直接子级 p，不影响列表、引用块等嵌套段落；
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
    if (document.getElementById(STYLE_ID)) return;

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

      /* 只放宽弹窗编辑器的普通顶层段落，不影响列表、引用块等嵌套段落。 */
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror > p {
        margin-top: 0.45em !important;
        margin-bottom: 0.45em !important;
      }

      /* 手动空行仍按原本高度显示，避免连续空行被额外放大。 */
      .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror > p:has(> br.ProseMirror-trailingBreak:only-child) {
        margin-top: 0 !important;
        margin-bottom: 0 !important;
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
    return new RegExp(
      escapeRegExp(open) + '[^' + escapeRegExp(close) + '\\r\\n]{1,' + MAX_PAIR_CHARS + '}' + escapeRegExp(close),
      'g'
    );
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
    if (!parent) return true;
    if (parent.closest('[data-nocodb-markdown-table-id]')) return true;
    if (parent.closest('[contenteditable="false"]')) return true;
    return false;
  }

  function collectRanges() {
    const rangesByName = new Map(MATCH_RULES.map((rule) => [rule.highlightName, []]));
    let count = 0;
    let stopped = false;

    const editors = document.querySelectorAll(EDITOR_SELECTOR);
    for (const editor of editors) {
      if (stopped) break;

      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let node;
      while (!stopped && (node = walker.nextNode())) {
        if (shouldSkipTextNode(node)) continue;

        const text = node.nodeValue || '';
        if (!text || (text.indexOf('【') === -1 && text.indexOf('「') === -1)) continue;

        for (const rule of MATCH_RULES) {
          if (text.indexOf(rule.startChar) === -1) continue;
          rule.regexp.lastIndex = 0;
          let match;

          while ((match = rule.regexp.exec(text))) {
            const from = match.index;
            const to = from + match[0].length;
            if (to <= from) continue;

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

          if (stopped) break;
        }
      }
    }

    return rangesByName;
  }

  function refreshHighlights() {
    scanTimer = 0;
    scanRaf = 0;
    injectStyle();

    if (!isHighlightApiAvailable()) return;

    const rangesByName = collectRanges();
    for (const rule of MATCH_RULES) {
      const ranges = rangesByName.get(rule.highlightName) || [];
      CSS.highlights.delete(rule.highlightName);
      if (ranges.length) CSS.highlights.set(rule.highlightName, new Highlight(...ranges));
    }
  }

  function scheduleScan(delay = 80) {
    if (scanTimer) window.clearTimeout(scanTimer);
    if (scanRaf) window.cancelAnimationFrame(scanRaf);

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
})();

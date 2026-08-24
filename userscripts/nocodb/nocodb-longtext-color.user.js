// ==UserScript==
// @name         NocoDB LongText 字体改色
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-longtext-color.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-longtext-color.user.js
// @version      2.2.0
// @description  NocoDB LongText 富文本字体改色：加粗文字 CSS 改色；【xxx】和「xxx」使用 CSS Custom Highlight 改色，不修改原文内容。
// @match        https://nocodb.380782744.xyz/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /**
   * NocoDB LongText 字体改色
   *
   * 作用：
   * 1. 将 NocoDB LongText 富文本编辑器里的加粗文本 strong 改成 #cc6566。
   * 2. 将形如 【xxx】 的文本显示为 #3366ff。
   * 3. 将形如 「xxx」 的文本显示为 #c88445。
   *
   * 技术路线：
   * 1. 加粗文本改色：
   *    - 使用普通 CSS 选择器 `.nc-rich-text-content .ProseMirror strong`。
   *    - 这是纯样式层处理，性能风险最低。
   *
   * 2. 【xxx】/「xxx」改色：
   *    - 使用 Chromium 已支持的 CSS Custom Highlight API。
   *    - 脚本只为匹配文本创建 Range，并注册到 CSS.highlights；不向 ProseMirror 正文插入 span，
   *      也不再动态 registerPlugin / reconfigure 编辑器。
   *    - 这样可以避免依赖 NocoDB 打包后的 ProseMirror Decoration 构造器，同时不会改变
   *      编辑器 state、selection、保存内容或撤销栈。
   *
   * 稳定性与安全性：
   * 1. 不使用 innerHTML 替换编辑器内容。
   * 2. 不手动拆文本节点，不向正文 DOM 真实包裹 span。
   * 3. 不修改 ProseMirror 文档内容模型，因此颜色不会写入 NocoDB 原文。
   * 4. 不注册 ProseMirror 插件，不触发编辑器重配置。
   * 5. MutationObserver 只做防抖后的显示层重算；不会改写正文 DOM。
   *
   * 性能策略：
   * 1. 只扫描当前 LongText Rich Text 编辑器中的 Text 节点。
   * 2. 先用 indexOf 快速跳过没有目标起始符号的文本节点。
   * 3. 匹配规则限定为不跨行、非贪婪、最大 500 字符。
   * 4. 最大高亮数量限制为 3000。
   * 5. 多次 DOM 变化合并到一次 requestAnimationFrame / 短延迟重算。
   */

  const STYLE_ID = 'tm-nocodb-longtext-font-color-style-v22';

  const COLOR_BOLD = '#cc6566';
  const COLOR_BRACKET_BLUE = '#3366ff';
  const COLOR_QUOTE_BROWN = '#c88445';

  const HIGHLIGHT_BRACKET = 'tm-nc-bracket-blue-v22';
  const HIGHLIGHT_QUOTE = 'tm-nc-quote-brown-v22';
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
      .nc-rich-text-content .ProseMirror strong {
        color: ${COLOR_BOLD} !important;
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

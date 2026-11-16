// ==UserScript==
// @name         NocoDB Rich Text Markdown 序列化修复
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-markdown-fix.user.js
// @downloadURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-markdown-fix.user.js
// @version      0.2.1
// @description  修复 NocoDB LongText Rich Text 块级图片拼接、空行后列表项前导空格导致嵌套丢失，以及代码块前导空格导致内部缩进被逐次削减的问题。
// @match        https://nocodb.380782744.xyz/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

/*
 * 分层治理 NocoDB Rich Text 的 Markdown 序列化缺陷：
 * 1. 结构层（AST 节点）：修复块级 image 序列化后闭合当前块，避免紧随其后的标题、代码块被错误拼接；
 * 2. 格式层（产物过滤）：清洗空行/<br>后泄漏给代码围栏和块标记的前导空格，根除代码块吃缩进与嵌套列表平铺。
 * 不改动编辑器文档、DOM 正文、selection、网络请求或数据库结构。
 * 每个 Tiptap 实例分别安装；关闭面板后不持有旧实例的强引用。
 * 详细原理、兼容性边界与回归测试见同名 .md 文件。
 */

function nocodbRichtextMarkdownFixPageMain() {
  'use strict';

  const GUARD = '__NOCODB_RICHTEXT_MARKDOWN_FIX_V1__';
  if (globalThis[GUARD]) return;

  const SELECTOR = '.nc-rich-text-content .tiptap.ProseMirror';
  const RETRY_LIMIT = 16;
  const RETRY_DELAY_MS = 80;
  const patched = new WeakSet();
  const pending = new WeakSet();
  let installedCount = 0;
  let skippedCount = 0;

  // 规范化序列化产物：清洗文首或换行（\n\n）后泄漏给代码围栏和块标记的前导空格
  // 1. 修复代码围栏前意外泄漏的前导空格，确保 N = 0，避免 CommonMark 规则每次剥除代码内部缩进；
  // 2. 修复列表项前意外泄漏的前导空格，确保列表首项顶格，保护嵌套子列表不被 CommonMark 误判平铺。
  function normalizeMarkdownWhitespace(markdown) {
    if (typeof markdown !== 'string' || !markdown) return markdown;

    // 1. 修复开头的代码围栏前意外泄漏的前导空格（例如 "\n\n ```bash" -> "\n\n```bash"）
    let normalized = markdown.replace(/(^|\n\n)[ \t]+(?=(?:```|~~~))/g, '$1');

    // 2. 将代码块整体保护起来，避免后续清洗过程触及代码块内部的排版缩进或注释
    const codeBlocks = [];
    const protectedMarkdown = normalized.replace(/(^|\n)(?:```|~~~)[\s\S]*?(?:\n(?:```|~~~)|$)/g, (match) => {
      const token = `\u0000TM_CODE_BLOCK_${codeBlocks.length}\u0000`;
      codeBlocks.push(match);
      return token;
    });

    // 3. 在代码块外部，清洗所有其它块标记（标题、列表项、引用、表格、<br>）前由空行泄漏的前导空格
    let cleaned = protectedMarkdown.replace(/(^|\n\n)[ \t]+(?=(?:#{1,6}\s|\d+\.\s|[-*+]\s|>|\||<br>))/g, '$1');

    // 4. 还原代码块
    if (codeBlocks.length > 0) {
      cleaned = cleaned.replace(/\u0000TM_CODE_BLOCK_(\d+)\u0000/g, (_, index) => codeBlocks[Number(index)] || '');
    }

    return cleaned;
  }

  // 返回 done / retry；所有不兼容状态均停止修改，不尝试文本替换。
  function install(root) {
    if (!root.isConnected) return 'done';

    const editor = root.editor;
    const serializer = editor?.storage?.markdown?.serializer;
    if (!serializer) return 'retry';
    if (patched.has(serializer)) return 'done';

    // 尊重其他插件已经设置的实例级 nodes 属性，避免互相覆盖或重复 closeBlock。
    if (Object.getOwnPropertyDescriptor(serializer, 'nodes')) {
      skippedCount += 1;
      return 'done';
    }

    const image = editor.schema?.nodes?.image;
    if (image?.spec?.group !== 'block' || image.spec.inline === true || typeof serializer.serialize !== 'function') {
      skippedCount += 1;
      return 'done';
    }

    let proto = Object.getPrototypeOf(serializer);
    let descriptor = null;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, 'nodes');
      proto = Object.getPrototypeOf(proto);
    }

    if (typeof descriptor?.get !== 'function') {
      skippedCount += 1;
      return 'done';
    }

    let initialNodes;
    try {
      initialNodes = descriptor.get.call(serializer);
    } catch (_) {
      skippedCount += 1;
      return 'done';
    }
    if (typeof initialNodes?.image !== 'function') {
      skippedCount += 1;
      return 'done';
    }

    try {
      Object.defineProperty(serializer, 'nodes', {
        configurable: true,
        get() {
          // 每次保留 NocoDB 实时生成的其他节点规则，避免覆盖后续扩展。
          const nodes = descriptor.get.call(this);
          const originalImage = nodes?.image;
          if (typeof originalImage !== 'function') return nodes;

          return {
            ...nodes,
            image(state, node, parent, index) {
              originalImage(state, node, parent, index);
              if (node.isBlock && typeof state.closeBlock === 'function') {
                state.closeBlock(node);
              }
            },
          };
        },
      });

      const originalSerialize = serializer.serialize;
      if (typeof originalSerialize === 'function') {
        serializer.serialize = function (content, options) {
          const result = originalSerialize.call(this, content, options);
          return normalizeMarkdownWhitespace(result);
        };
      }
    } catch (_) {
      skippedCount += 1;
      return 'done';
    }

    patched.add(serializer);
    installedCount += 1;
    return 'done';
  }

  // 编辑器 DOM 常先于 root.editor 绑定：仅对新根节点做有限次数重试。
  function discover(root) {
    if (!(root instanceof HTMLElement) || pending.has(root)) return;
    if (install(root) === 'done') return;

    pending.add(root);
    let attempts = 0;
    const retry = () => {
      if (!root.isConnected || install(root) === 'done' || ++attempts >= RETRY_LIMIT) {
        pending.delete(root);
        return;
      }
      setTimeout(retry, RETRY_DELAY_MS);
    };
    setTimeout(retry, RETRY_DELAY_MS);
  }

  function discoverWithin(node) {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(SELECTOR)) discover(node);
    // 只有新插入的容器才遍历其子树；正文更新不会全页扫描。
    node.querySelectorAll(SELECTOR).forEach(discover);
  }

  function ensureFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const root = target.closest(SELECTOR);
    if (root) discover(root);
  }

  function start() {
    if (!document.body) return;

    document.querySelectorAll(SELECTOR).forEach(discover);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) discoverWithin(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 捕获阶段兜底，保证用户首次聚焦或粘贴时先安装；不改写事件。
    document.addEventListener('focusin', ensureFromEvent, true);
    document.addEventListener('paste', ensureFromEvent, true);
  }

  globalThis[GUARD] = {
    status() {
      const roots = document.querySelectorAll(SELECTOR);
      let currentPatched = 0;
      for (const root of roots) {
        if (patched.has(root.editor?.storage?.markdown?.serializer)) currentPatched += 1;
      }
      return { currentEditors: roots.length, currentPatched, totalPatched: installedCount, skipped: skippedCount };
    },
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

// 与同仓库 Markdown 表格脚本相同：在网页主环境获取 NocoDB 的 Tiptap 实例。
(function launchInPageContext() {
  'use strict';

  const source = `;(${nocodbRichtextMarkdownFixPageMain.toString()})();`;
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const GUARD = '__NOCODB_RICHTEXT_MARKDOWN_FIX_V1__';

  try {
    if (pageWindow[GUARD]) return;
    if (typeof pageWindow.eval === 'function') {
      pageWindow.eval(source);
      if (pageWindow[GUARD]) return;
    }
  } catch (_) {}

  try {
    if (typeof pageWindow.Function === 'function') {
      pageWindow.Function(source)();
      if (pageWindow[GUARD]) return;
    }
  } catch (_) {}

  function injectScript() {
    try {
      if (pageWindow[GUARD]) return;
      const host = document.documentElement || document.head || document.body;
      if (!host) return;
      const script = document.createElement('script');
      script.textContent = source;
      host.appendChild(script);
      script.remove();
      if (!pageWindow[GUARD]) {
        console.warn('[NocoDB Markdown Fix] 无法进入页面主环境；本次未启用修复。');
      }
    } catch (_) {
      console.warn('[NocoDB Markdown Fix] 页面主环境注入失败；本次未启用修复。');
    }
  }

  if (document.documentElement) injectScript();
  else document.addEventListener('DOMContentLoaded', injectScript, { once: true });
})();

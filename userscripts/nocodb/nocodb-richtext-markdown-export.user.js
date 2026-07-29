// ==UserScript==
// @name         NocoDB Rich Text Markdown 导出
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-markdown-export.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-markdown-export.user.js
// @version      1.0.3
// @description  在 NocoDB LongText Rich Text 弹窗中复制或下载当前编辑器内容为 Markdown
// @match        https://nocodb.380782744.xyz/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

/*
 * =============================================================================
 * NocoDB Rich Text Markdown 导出：当前实现说明
 * =============================================================================
 *
 * 一、脚本目标
 * -----------------------------------------------------------------------------
 * - 只处理 NocoDB CE 自部署版本中 LongText 字段的 Rich Text 展开编辑器；
 * - 在现有 TOC 按钮右侧增加“复制 Markdown”和“下载 Markdown”两个图标按钮；
 * - 点击时才遍历当前编辑器，平时不监听输入、不持续扫描正文；
 * - 复制和下载得到的是普通 Markdown，不包含编辑器按钮、TOC 面板等界面节点。
 *
 * 二、与 NocoDB Markdown 表格脚本的协作
 * -----------------------------------------------------------------------------
 * `nocodb-markdown-table.user.js` 为兼容 NocoDB 的持久化格式，会把表格源码保存为
 * 特殊 codeBlock；但编辑器中的可见结果是一个带有
 * `data-nocodb-markdown-table-id` 的 NodeView，内部包含标准 HTML <table>。
 *
 * 本脚本导出时直接读取该 NodeView 中的 thead/tbody/th/td，并恢复为普通 Markdown
 * 表格。因此导出结果不会包含：
 *
 * - [[NOCODB_MARKDOWN_TABLE:...]] 内部标记；
 * - ```nocodb-table 特殊代码块；
 * - 表格编辑铅笔、行列菜单或其他操作控件。
 *
 * 如果任意 Markdown 表格正处于编辑状态，本脚本会阻止导出，要求先保存或取消，
 * 避免把未保存草稿或行列操作控件混入导出结果。
 *
 * 三、按钮位置
 * -----------------------------------------------------------------------------
 * - 通过 aria-label/title 查找现有“切换 TOC”按钮，不依赖 TOC 脚本的版本类名；
 * - 两个导出按钮挂到 TOC 按钮的同级容器中，并采用相同的绝对定位参照；
 * - 脚本只设置按钮自身的位置，不修改 expanded-cell-input 等编辑器容器的布局样式；
 * - 如果 TOC 按钮尚未挂载，脚本会等待后续 DOM 变化，不会把按钮放到关闭按钮附近；
 * - 下载用的临时链接挂在当前 Rich Text 弹窗内部，避免程序化点击触发弹窗关闭。
 *
 * 四、支持的主要格式
 * -----------------------------------------------------------------------------
 * - H1-H6、普通段落、粗体、斜体、删除线、下划线、行内代码；
 * - 引用、无序列表、有序列表、任务列表、代码块、分隔线；
 * - 链接、图片、普通 HTML 表格、NocoDB Markdown 表格 NodeView；
 * - 普通正文中的手动换行导出为 Markdown 标准硬换行（行尾两个空格）；表格单元格中的换行保留为 <br>。
 *
 * 五、性能原则
 * -----------------------------------------------------------------------------
 * - 全局 MutationObserver 只用于发现或移除 Rich Text 弹窗和 TOC 按钮；
 * - DOM 变化会合并后再同步按钮，不在 observer 回调中遍历正文；
 * - Markdown 转换只在用户点击复制或下载时执行；
 * - 不监听 input、scroll、selectionchange，不做正文坐标测量。
 *
 * =============================================================================
 */

(function () {
  'use strict';

  const CONFIG = {
    rootSelector: '.nc-long-text-expanded-modal .expanded-cell-input',
    editorSelector: '.nc-rich-text-content .tiptap.ProseMirror',
    tocButtonSelector: 'button[aria-label="切换 TOC"], button[title="切换 TOC"]',
    titleSelector: '.flex.max-w-38 .truncate, .max-w-38 .truncate',
    buttonGap: 6,
    buttonSize: 30,
    syncDelay: 80,
  };

  const CLASS = {
    button: 'tm-rmd-export-button-v1',
    copyButton: 'tm-rmd-export-copy-v1',
    downloadButton: 'tm-rmd-export-download-v1',
    visible: 'is-visible',
    success: 'is-success',
    error: 'is-error',
    toast: 'tm-rmd-export-toast-v1',
    toastError: 'is-error',
  };

  const STYLE_ID = 'tm-rmd-export-style-v1';
  const TABLE_NODE_SELECTOR = '[data-nocodb-markdown-table-id]';
  const HARD_BREAK_TOKEN = '\uE000TM_RMD_HARD_BREAK\uE001';
  const TABLE_EDITING_SELECTOR = `${TABLE_NODE_SELECTOR}.is-editing`;
  const NOCODB_TABLE_MARKER_PATTERN = /^\[\[(?:NOCODB_MARKDOWN_TABLE:v1:[A-Za-z0-9_-]{6,64}|NOCODB_MARKDOWN_TABLE_V1)\]\]\s*(?:\n|$)/;
  const states = new Map();

  let syncTimer = null;
  let globalObserver = null;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CLASS.button} {
        position: absolute;
        z-index: 31;
        width: ${CONFIG.buttonSize}px;
        min-width: ${CONFIG.buttonSize}px;
        height: ${CONFIG.buttonSize}px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        visibility: hidden;
        opacity: 0;
        pointer-events: auto;
        transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
      }

      .${CLASS.button}.${CLASS.visible} {
        visibility: visible;
        opacity: 1;
      }

      .${CLASS.button} svg {
        width: 16px;
        height: 16px;
        display: block;
        pointer-events: none;
      }

      .${CLASS.button}.${CLASS.success} {
        color: #15803d !important;
        background: rgba(34, 197, 94, 0.12) !important;
      }

      .${CLASS.button}.${CLASS.error} {
        color: #b91c1c !important;
        background: rgba(239, 68, 68, 0.12) !important;
      }

      .${CLASS.toast} {
        position: fixed;
        right: 22px;
        bottom: 22px;
        z-index: 100000;
        max-width: min(460px, calc(100vw - 44px));
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

      .${CLASS.toast}.${CLASS.toastError} {
        background: rgba(180, 35, 24, 0.97);
      }
    `;
    document.head.appendChild(style);
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function stopAll(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function showToast(message, kind = 'success', duration = 2200) {
    if (!message || !document.body) return;
    document.querySelectorAll(`.${CLASS.toast}`).forEach((item) => item.remove());

    const toast = document.createElement('div');
    toast.className = `${CLASS.toast}${kind === 'error' ? ` ${CLASS.toastError}` : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), duration);
  }

  function flashButton(button, kind) {
    if (!(button instanceof HTMLElement)) return;
    button.classList.remove(CLASS.success, CLASS.error);
    void button.offsetWidth;
    button.classList.add(kind === 'error' ? CLASS.error : CLASS.success);
    window.setTimeout(() => button.classList.remove(CLASS.success, CLASS.error), 1100);
  }

  function makeActionButton(type, title, svg, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'ant-btn',
      'ant-btn-text',
      'small',
      'theme-default',
      'bordered',
      'nc-btn-shadow',
      'nc-button',
      CLASS.button,
      type === 'copy' ? CLASS.copyButton : CLASS.downloadButton,
    ].join(' ');
    button.setAttribute('aria-label', title);
    button.setAttribute('title', title);
    button.innerHTML = svg;

    button.addEventListener('pointerdown', stopAll, true);
    button.addEventListener('mousedown', stopAll, true);
    button.addEventListener('mouseup', stopAll, true);
    button.addEventListener('click', (event) => {
      stopAll(event);
      onClick(button);
    }, true);

    return button;
  }

  function copyIcon() {
    return `
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="5.25" y="4.25" width="7.5" height="9" rx="1.5" stroke="currentColor" stroke-width="1.25"/>
        <path d="M3.25 10.75h-.5A1.5 1.5 0 0 1 1.25 9.25v-6.5a1.5 1.5 0 0 1 1.5-1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
      </svg>`;
  }

  function downloadIcon() {
    return `
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1.75v8.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
        <path d="m4.9 6.9 3.1 3.1 3.1-3.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2.25 12.1v1.15c0 .55.45 1 1 1h9.5c.55 0 1-.45 1-1V12.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
      </svg>`;
  }

  function findTocButton(root) {
    if (!(root instanceof HTMLElement)) return null;
    const candidates = Array.from(root.querySelectorAll(CONFIG.tocButtonSelector));
    return candidates.find((button) => button instanceof HTMLButtonElement && isElementVisible(button)) || null;
  }

  function positionButtons(state) {
    if (!state || state.destroyed) return false;
    const { root, host, tocButton, copyButton, downloadButton } = state;
    if (!(root instanceof HTMLElement) || !(host instanceof HTMLElement) || !(tocButton instanceof HTMLElement)) return false;
    if (!root.contains(tocButton) || tocButton.parentElement !== host || !isElementVisible(tocButton)) return false;

    // 三个按钮位于同一个父容器中，并共享相同的绝对定位参照。
    // 只读取 TOC 按钮自身的 offset，不改写宿主容器的 position、overflow 或宽度。
    const top = tocButton.offsetTop;
    const copyLeft = tocButton.offsetLeft + tocButton.offsetWidth + CONFIG.buttonGap;
    const downloadLeft = copyLeft + CONFIG.buttonSize + CONFIG.buttonGap;

    copyButton.style.top = `${top}px`;
    copyButton.style.left = `${copyLeft}px`;
    downloadButton.style.top = `${top}px`;
    downloadButton.style.left = `${downloadLeft}px`;
    copyButton.classList.add(CLASS.visible);
    downloadButton.classList.add(CLASS.visible);
    return true;
  }

  function destroyState(state) {
    if (!state || state.destroyed) return;
    state.destroyed = true;
    try { state.resizeObserver?.disconnect(); } catch (_) {}
    try { state.tocMutationObserver?.disconnect(); } catch (_) {}
    try { state.copyButton?.remove(); } catch (_) {}
    try { state.downloadButton?.remove(); } catch (_) {}
    states.delete(state.root);
  }

  function mountRoot(root) {
    if (!(root instanceof HTMLElement) || !root.isConnected) return null;
    const editor = root.querySelector(CONFIG.editorSelector);
    const tocButton = findTocButton(root);
    if (!(editor instanceof HTMLElement) || !(tocButton instanceof HTMLElement)) return null;

    const existing = states.get(root);
    if (existing && !existing.destroyed) {
      if (
        existing.editor !== editor ||
        existing.tocButton !== tocButton ||
        existing.host !== tocButton.parentElement
      ) {
        destroyState(existing);
      } else {
        positionButtons(existing);
        return existing;
      }
    }

    const host = tocButton.parentElement;
    if (!(host instanceof HTMLElement) || !root.contains(host)) return null;

    const state = {
      root,
      host,
      editor,
      tocButton,
      copyButton: null,
      downloadButton: null,
      resizeObserver: null,
      tocMutationObserver: null,
      destroyed: false,
    };

    state.copyButton = makeActionButton('copy', '复制本编辑器内容为 Markdown', copyIcon(), async (button) => {
      await handleCopy(state, button);
    });
    state.downloadButton = makeActionButton('download', '下载本编辑器内容为 Markdown', downloadIcon(), (button) => {
      handleDownload(state, button);
    });

    host.append(state.copyButton, state.downloadButton);
    states.set(root, state);

    if (typeof ResizeObserver === 'function') {
      state.resizeObserver = new ResizeObserver(() => positionButtons(state));
      state.resizeObserver.observe(tocButton);
    }

    state.tocMutationObserver = new MutationObserver(() => positionButtons(state));
    state.tocMutationObserver.observe(tocButton, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    positionButtons(state);
    return state;
  }

  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      syncRoots();
    }, CONFIG.syncDelay);
  }

  function syncRoots() {
    states.forEach((state) => {
      if (!state.root.isConnected || !state.editor.isConnected || !state.tocButton.isConnected) {
        destroyState(state);
      }
    });

    document.querySelectorAll(CONFIG.rootSelector).forEach((root) => {
      if (root instanceof HTMLElement && isElementVisible(root)) mountRoot(root);
    });
  }


  function mutationMayAffectMounts(mutation) {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.some((node) => {
      if (!(node instanceof Element)) return false;
      if (node.matches(CONFIG.rootSelector) || node.querySelector(CONFIG.rootSelector)) return true;
      if (node.matches(CONFIG.tocButtonSelector) || node.querySelector(CONFIG.tocButtonSelector)) return true;
      return false;
    });
  }

  function startDiscovery() {
    if (!document.body || globalObserver) return;
    syncRoots();

    globalObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationMayAffectMounts)) scheduleSync();
    });
    globalObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleSync, { passive: true });
  }

  function getExportMarkdown(state) {
    if (!state || state.destroyed || !state.root.isConnected || !state.editor.isConnected) {
      throw new Error('当前 Rich Text 编辑器已经关闭。');
    }

    if (state.editor.querySelector(TABLE_EDITING_SELECTOR)) {
      throw new Error('请先保存或取消正在编辑的表格，然后再导出 Markdown。');
    }

    const markdown = serializeEditor(state.editor);
    if (!markdown.trim()) throw new Error('当前编辑器没有可导出的内容。');
    return markdown;
  }

  async function handleCopy(state, button) {
    try {
      const markdown = getExportMarkdown(state);
      const copied = await copyText(markdown);
      if (!copied) throw new Error('浏览器拒绝了剪贴板写入。');
      flashButton(button, 'success');
      showToast('已复制当前编辑器的 Markdown 内容。');
    } catch (error) {
      flashButton(button, 'error');
      showToast(error instanceof Error ? error.message : '复制 Markdown 失败。', 'error', 3600);
    }
  }

  function handleDownload(state, button) {
    try {
      const markdown = getExportMarkdown(state);
      const filename = buildDownloadFilename(state);
      downloadText(markdown, filename, state.root);
      flashButton(button, 'success');
      showToast(`已下载：${filename}`);
    } catch (error) {
      flashButton(button, 'error');
      showToast(error instanceof Error ? error.message : '下载 Markdown 失败。', 'error', 3600);
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return true;
      }
    } catch (_) {}

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
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch (_) {
      return false;
    }
  }

  function downloadText(text, filename, host) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    if (!(host instanceof HTMLElement) || !host.isConnected) {
      URL.revokeObjectURL(url);
      throw new Error('当前 Rich Text 编辑器已经关闭。');
    }
    const downloadHost = host;

    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';

    // 下载链接必须位于当前 Rich Text 弹窗内部，避免 NocoDB 将程序化点击
    // 识别为“点击弹窗外部”并关闭编辑器。这里只阻止冒泡，不阻止默认下载行为。
    const stopDownloadClick = (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    anchor.addEventListener('click', stopDownloadClick, true);

    downloadHost.appendChild(anchor);
    anchor.click();
    anchor.removeEventListener('click', stopDownloadClick, true);
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function buildDownloadFilename(state) {
    const firstH1 = state.editor.querySelector('h1');
    const heading = firstH1 instanceof HTMLElement ? cleanFilenamePart(firstH1.textContent || '') : '';
    if (heading) return `${heading}.md`;

    const titleNode = state.root.querySelector(CONFIG.titleSelector);
    const fieldTitle = titleNode instanceof HTMLElement ? cleanFilenamePart(titleNode.textContent || '') : '';
    const base = fieldTitle || 'NocoDB-RichText';
    return `${base}-${formatLocalTimestamp(new Date())}.md`;
  }

  function cleanFilenamePart(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80);
  }

  function formatLocalTimestamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      '-',
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('');
  }

  function serializeEditor(editor) {
    const blocks = [];
    editor.childNodes.forEach((node) => {
      const value = serializeBlock(node, { listDepth: 0 });
      if (value !== null && value !== undefined) blocks.push(value);
    });
    return normalizeMarkdown(blocks.join('\n\n'));
  }

  function serializeBlock(node, context) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(node.nodeValue || '').trim();
      return text ? escapeInlineText(text) : '';
    }
    if (!(node instanceof HTMLElement)) return '';
    if (shouldIgnoreElement(node)) return '';

    if (node.matches(TABLE_NODE_SELECTOR)) return serializeNocodbTableNode(node);

    const tag = node.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const content = serializeInlineChildren(node, { tableCell: false }).trim();
      return content ? `${'#'.repeat(level)} ${content}` : '#'.repeat(level);
    }

    if (tag === 'p') {
      return escapeParagraphLineStart(serializeInlineChildren(node, { tableCell: false }).trim());
    }

    if (tag === 'pre') return serializeCodeBlock(node);
    if (tag === 'blockquote') return serializeBlockquote(node, context);
    if (tag === 'ul' || tag === 'ol') return serializeList(node, context.listDepth || 0);
    if (tag === 'table') return serializeTable(node);
    if (tag === 'hr') return '---';
    if (tag === 'figure') return serializeFigure(node);

    if (tag === 'div' || tag === 'section' || tag === 'article') {
      const childBlocks = [];
      node.childNodes.forEach((child) => {
        const value = serializeBlock(child, context);
        if (value !== null && value !== undefined && value !== '') childBlocks.push(value);
      });
      if (childBlocks.length) return childBlocks.join('\n\n');
      return serializeInlineChildren(node, { tableCell: false }).trim();
    }

    if (tag === 'img') return serializeImage(node);
    return serializeInline(node, { tableCell: false }).trim();
  }

  function shouldIgnoreElement(element) {
    if (element.matches('button, script, style, noscript')) return true;
    if (element.getAttribute('aria-hidden') === 'true' && !element.matches('img')) return true;
    const className = typeof element.className === 'string' ? element.className : '';
    return /(?:^|\s)(?:tm-nmt-edit-trigger|tm-nmt-toolbar|tm-nmt-menu|tm-rtoc-|tm-rmd-export-)/.test(className);
  }

  function serializeInlineChildren(element, options) {
    return Array.from(element.childNodes).map((child) => serializeInline(child, options)).join('');
  }

  function serializeInline(node, options = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeInlineText(normalizeText(node.nodeValue || ''));
    }
    if (!(node instanceof HTMLElement) || shouldIgnoreElement(node)) return '';

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return options.tableCell ? '<br>' : `${HARD_BREAK_TOKEN}\n`;
    if (tag === 'img') return serializeImage(node);

    const content = serializeInlineChildren(node, options);
    if (!content && tag !== 'a') return '';

    if (tag === 'strong' || tag === 'b') return wrapInline(content, '**');
    if (tag === 'em' || tag === 'i') return wrapInline(content, '*');
    if (tag === 's' || tag === 'strike' || tag === 'del') return wrapInline(content, '~~');
    if (tag === 'u') return `<u>${content}</u>`;
    if (tag === 'mark') return `<mark>${content}</mark>`;
    if (tag === 'sub') return `<sub>${content}</sub>`;
    if (tag === 'sup') return `<sup>${content}</sup>`;
    if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
      return serializeInlineCode(node.textContent || '');
    }
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const title = node.getAttribute('title') || '';
      if (!href) return content;
      const label = content || escapeInlineText(href);
      const suffix = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
      return `[${label}](${escapeLinkDestination(href)}${suffix})`;
    }

    return content;
  }

  function wrapInline(content, marker) {
    if (!content) return '';
    return `${marker}${content}${marker}`;
  }

  function serializeInlineCode(value) {
    const text = normalizeText(value).replace(/\n+/g, ' ');
    const runs = text.match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(1, ...runs.map((run) => run.length + 1)));
    const padded = /^`|`$|^\s|\s$/.test(text) ? ` ${text} ` : text;
    return `${fence}${padded}${fence}`;
  }

  function serializeCodeBlock(pre) {
    const code = pre.querySelector(':scope > code') || pre;
    const text = normalizeText(code.textContent || '').replace(/\n$/, '');
    const language = detectCodeLanguage(pre, code);

    const tableSource = unwrapStoredNocodbTable(text, language);
    if (tableSource !== null) return tableSource;

    const runs = text.match(/`{3,}/g) || [];
    const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
    return `${fence}${language}\n${text}\n${fence}`;
  }

  function unwrapStoredNocodbTable(text, language) {
    const normalized = normalizeText(text).trim();
    const hasMarker = NOCODB_TABLE_MARKER_PATTERN.test(normalized);
    if (language !== 'nocodb-table' && !hasMarker) return null;

    const source = normalized.replace(NOCODB_TABLE_MARKER_PATTERN, '').trim();
    const lines = source.split('\n').filter((line) => line.trim());
    if (lines.length < 2 || !lines[0].includes('|') || !lines[1].includes('|')) return null;
    return source;
  }

  function detectCodeLanguage(pre, code) {
    const candidates = [
      code.getAttribute('data-language'),
      pre.getAttribute('data-language'),
      code.className,
      pre.className,
    ].filter(Boolean);

    for (const value of candidates) {
      const match = String(value).match(/(?:^|\s)language-([A-Za-z0-9_+.-]+)/);
      if (match) return match[1];
    }
    return '';
  }

  function serializeBlockquote(blockquote, context) {
    const parts = [];
    blockquote.childNodes.forEach((child) => {
      const value = serializeBlock(child, context);
      if (value !== null && value !== undefined && value !== '') parts.push(value);
    });
    const content = parts.join('\n\n').trim();
    if (!content) return '>';
    return content.split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
  }

  function serializeList(list, depth) {
    const ordered = list.tagName.toLowerCase() === 'ol';
    const start = ordered ? Number(list.getAttribute('start') || 1) : 1;
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const indent = '    '.repeat(depth);

    return items.map((item, index) => {
      const marker = ordered ? `${start + index}.` : '-';
      const taskPrefix = getTaskPrefix(item, list);
      const leadParts = [];
      const nestedLists = [];

      item.childNodes.forEach((child) => {
        if (child instanceof HTMLElement && /^(ul|ol)$/i.test(child.tagName)) {
          nestedLists.push(child);
          return;
        }

        let value = '';
        if (child instanceof HTMLElement && child.tagName.toLowerCase() === 'p') {
          value = serializeInlineChildren(child, { tableCell: false }).trim();
        } else if (child instanceof HTMLElement && isBlockElement(child)) {
          value = serializeBlock(child, { listDepth: depth + 1 }).trim();
        } else {
          value = serializeInline(child, { tableCell: false }).trim();
        }
        if (value) leadParts.push(value);
      });

      const lead = leadParts.join(' ').trim();
      const firstLine = `${indent}${marker} ${taskPrefix}${lead}`.trimEnd();
      const continuationIndent = `${indent}${' '.repeat(marker.length + 1)}`;
      const normalizedLead = firstLine.split('\n').map((line, lineIndex) => (
        lineIndex === 0 ? line : `${continuationIndent}${line}`
      )).join('\n');

      const nested = nestedLists
        .map((nestedList) => serializeList(nestedList, depth + 1))
        .filter(Boolean)
        .join('\n');

      return nested ? `${normalizedLead}\n${nested}` : normalizedLead;
    }).join('\n');
  }

  function getTaskPrefix(item, list) {
    const isTask = list.getAttribute('data-type') === 'taskList' || item.getAttribute('data-type') === 'taskItem';
    const checkbox = item.querySelector(':scope > label input[type="checkbox"], :scope > input[type="checkbox"]');
    if (!isTask && !(checkbox instanceof HTMLInputElement)) return '';
    const checked = item.getAttribute('data-checked') === 'true' || (checkbox instanceof HTMLInputElement && checkbox.checked);
    return checked ? '[x] ' : '[ ] ';
  }

  function isBlockElement(element) {
    return /^(address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|ul)$/i.test(element.tagName);
  }

  function serializeFigure(figure) {
    const image = figure.querySelector('img');
    const caption = figure.querySelector('figcaption');
    const imageMarkdown = image instanceof HTMLImageElement ? serializeImage(image) : '';
    const captionMarkdown = caption instanceof HTMLElement
      ? serializeInlineChildren(caption, { tableCell: false }).trim()
      : '';
    if (imageMarkdown && captionMarkdown) return `${imageMarkdown}\n\n${captionMarkdown}`;
    return imageMarkdown || captionMarkdown;
  }

  function serializeImage(image) {
    if (!(image instanceof HTMLImageElement)) return '';
    const src = image.getAttribute('src') || '';
    if (!src) return '';
    const alt = escapeInlineText(image.getAttribute('alt') || '');
    const title = image.getAttribute('title') || '';
    const suffix = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
    return `![${alt}](${escapeLinkDestination(src)}${suffix})`;
  }


  function escapeLinkDestination(value) {
    return String(value || '')
      .replace(/\s/g, '%20')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
  }

  function serializeNocodbTableNode(node) {
    const table = node.querySelector('table');
    if (!(table instanceof HTMLTableElement)) return '';
    return serializeTable(table, { nocodbNode: true });
  }

  function serializeTable(table, options = {}) {
    if (!(table instanceof HTMLTableElement)) return '';

    let headerCells = [];
    const explicitHeader = table.querySelector('thead tr');
    if (explicitHeader) {
      headerCells = Array.from(explicitHeader.children).filter((cell) => /^(th|td)$/i.test(cell.tagName));
    }

    const allRows = Array.from(table.querySelectorAll('tr'));
    if (!headerCells.length && allRows.length) {
      headerCells = Array.from(allRows[0].children).filter((cell) => /^(th|td)$/i.test(cell.tagName));
    }
    if (!headerCells.length) return '';

    const headers = headerCells.map(serializeTableCell);
    const bodyRows = [];
    let bodyCandidates = table.tBodies.length
      ? Array.from(table.tBodies).flatMap((tbody) => Array.from(tbody.rows))
      : allRows.slice(1);
    if (!explicitHeader && bodyCandidates[0] === allRows[0]) bodyCandidates = bodyCandidates.slice(1);

    bodyCandidates.forEach((row) => {
      const cells = Array.from(row.children).filter((cell) => /^(th|td)$/i.test(cell.tagName));
      if (!cells.length) return;
      if (options.nocodbNode && cells.some((cell) => {
        if (cell.classList.contains('tm-nmt-empty-v31')) return true;
        const colSpan = Number(cell.getAttribute('colspan') || 1);
        return cells.length === 1 && colSpan > 1 && /暂无数据行/.test(cell.textContent || '');
      })) return;
      bodyRows.push(cells.map(serializeTableCell));
    });

    const columnCount = Math.max(headers.length, ...bodyRows.map((row) => row.length), 1);
    const normalizedHeaders = padRow(headers, columnCount);
    const normalizedRows = bodyRows.map((row) => padRow(row, columnCount));

    const lines = [
      `| ${normalizedHeaders.join(' | ')} |`,
      `| ${normalizedHeaders.map(() => '---').join(' | ')} |`,
      ...normalizedRows.map((row) => `| ${row.join(' | ')} |`),
    ];
    return lines.join('\n');
  }

  function serializeTableCell(cell) {
    const clone = cell.cloneNode(true);
    if (clone instanceof HTMLElement) {
      clone.querySelectorAll('button, input, textarea, select, [aria-hidden="true"], .tm-nmt-menu-v31').forEach((node) => node.remove());
    }
    const value = clone instanceof HTMLElement
      ? serializeInlineChildren(clone, { tableCell: true })
      : normalizeText(cell.textContent || '');
    return value
      .replace(/\r\n?/g, '\n')
      .replace(/\n+/g, '<br>')
      .replace(/\|/g, '\\|')
      .trim();
  }

  function padRow(row, length) {
    const result = row.slice(0, length);
    while (result.length < length) result.push('');
    return result;
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u200B/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n?/g, '\n');
  }

  function escapeInlineText(value) {
    return normalizeText(value)
      .replace(/\\/g, '\\\\')
      .replace(/([`*_\[\]~])/g, '\\$1');
  }

  function escapeParagraphLineStart(value) {
    if (!value) return '';
    return value
      .split('\n')
      .map((line) => line.replace(/^(\s*)(#{1,6}\s|[-+*]\s|\d+[.)]\s|>\s|={3,}\s*$|-{3,}\s*$)/, '$1\\$2'))
      .join('\n');
  }

  function normalizeMarkdown(value) {
    // 先用不可见占位符保护正文硬换行，避免清理行尾空格时把 Markdown 的两个空格删除。
    const lines = normalizeText(value).split('\n').map((line) => line.replace(/[\t ]+$/g, ''));
    const normalized = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const restored = normalized.split(HARD_BREAK_TOKEN).join('  ');
    return restored ? `${restored}\n` : '';
  }

  injectStyle();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDiscovery, { once: true });
  } else {
    startDiscovery();
  }
})();

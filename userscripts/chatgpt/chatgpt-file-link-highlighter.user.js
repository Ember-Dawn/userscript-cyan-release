// ==UserScript==
// @name         ChatGPT 文件链接高亮助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-file-link-highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-file-link-highlighter.user.js
// @version      1.0.0
// @description  高亮 ChatGPT 回答中的文件链接和官方文件下载入口，使文件相关操作更易识别。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
脚本说明：

1. 当前作用
   - 高亮 ChatGPT 助手回答中的文件链接或文件按钮。
   - 高亮 ChatGPT 官方提供的“下载”或“Download”入口。
   - 不创建额外下载按钮，不调用 ChatGPT 内部下载接口，也不改变原有点击行为。

2. 版本说明
   - v1.0.0 将脚本正式更名为“ChatGPT 文件链接高亮助手”。
   - 现行文件改为 chatgpt-file-link-highlighter.user.js。
   - v0.5.0 的原始直链下载实现保存在：
     archive/userscripts/chatgpt-direct-download-v0.5.0.user.js

3. 扫描范围
   - 只处理助手消息中的 .markdown 内容。
   - 排除输入框、附件编辑区、侧边浮层和其他可编辑区域。

4. 调试方法
   - 可在 Console 运行：
     window.__cgFileLinkHighlighter.scan()
*/

(() => {
  'use strict';

  const VERSION = '1.0.0';
  const STYLE_ID = 'cg-file-link-highlight-style';
  const HIGHLIGHT_CLASS = 'cg-file-link-highlight';
  const ASSISTANT_CONTENT_SELECTOR =
    '[data-message-author-role="assistant"] .markdown';
  const CANDIDATE_SELECTOR = 'button, a[href]';
  const FILE_EXT_RE =
    /\.(md|txt|pdf|docx?|xlsx?|xls|pptx?|csv|zip|json|py|js|ts|tsx|jsx|html?|css|png|jpe?g|webp|gif|svg|yaml|yml|xml)$/i;

  const pendingRoots = new Set();
  let scanScheduled = false;

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function safeDecodeURIComponent(value) {
    let text = normalizeText(value);
    if (!text) return '';

    for (let i = 0; i < 3; i += 1) {
      if (!/%[0-9A-Fa-f]{2}/.test(text)) break;

      try {
        const decoded = decodeURIComponent(text);
        if (decoded === text) break;
        text = decoded;
      } catch (_) {
        break;
      }
    }

    return text;
  }

  function getVisibleLabel(element) {
    return normalizeText(
      element?.getAttribute?.('aria-label') ||
      element?.getAttribute?.('title') ||
      element?.innerText ||
      element?.textContent ||
      ''
    );
  }

  function isInsideAssistantContent(element) {
    return Boolean(element?.closest?.(ASSISTANT_CONTENT_SELECTOR));
  }

  function isInsideForbiddenArea(element) {
    if (!element) return true;

    return Boolean(
      element.closest('#thread-bottom-container') ||
      element.closest('form[data-type="unified-composer"]') ||
      element.closest('[data-composer-surface="true"]') ||
      element.closest('[data-prompt-textarea-header]') ||
      element.closest('[data-stage-thread-flyout="true"]') ||
      element.closest('[contenteditable="true"]') ||
      element.closest('#prompt-textarea')
    );
  }

  function isLikelyFileName(text) {
    const decoded = safeDecodeURIComponent(text);
    if (!decoded || decoded.length > 300) return false;

    return FILE_EXT_RE.test(decoded);
  }

  function isRemoveFileControl(element) {
    const label = normalizeText(element?.getAttribute?.('aria-label') || '');
    const lowerLabel = label.toLowerCase();

    return label.startsWith('移除文件') || lowerLabel.startsWith('remove file');
  }

  function isFileLink(element) {
    if (!element?.matches?.(CANDIDATE_SELECTOR)) return false;
    if (isRemoveFileControl(element)) return false;

    return isLikelyFileName(getVisibleLabel(element));
  }

  function isOfficialDownloadControl(element) {
    if (!element?.matches?.(CANDIDATE_SELECTOR)) return false;

    const label = getVisibleLabel(element);
    const lowerLabel = label.toLowerCase();

    return label.startsWith('下载') || lowerLabel.startsWith('download');
  }

  function shouldHighlight(element) {
    if (!isInsideAssistantContent(element)) return false;
    if (isInsideForbiddenArea(element)) return false;

    return isFileLink(element) || isOfficialDownloadControl(element);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${HIGHLIGHT_CLASS},
      .${HIGHLIGHT_CLASS} * {
        color: rgb(37, 99, 235) !important;
        font-weight: 600 !important;
      }

      @media (prefers-color-scheme: dark) {
        .${HIGHLIGHT_CLASS},
        .${HIGHLIGHT_CLASS} * {
          color: rgb(147, 197, 253) !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function collectCandidates(root) {
    const candidates = new Set();
    const scope =
      root?.nodeType === Node.TEXT_NODE
        ? root.parentElement
        : root;

    if (!scope) return candidates;

    if (scope instanceof Element && scope.matches(CANDIDATE_SELECTOR)) {
      candidates.add(scope);
    }

    if (typeof scope.querySelectorAll === 'function') {
      for (const element of scope.querySelectorAll(CANDIDATE_SELECTOR)) {
        candidates.add(element);
      }
    }

    return candidates;
  }

  function scan(root = document) {
    ensureStyle();

    for (const element of collectCandidates(root)) {
      element.classList.toggle(HIGHLIGHT_CLASS, shouldHighlight(element));
    }
  }

  function scheduleScan(root = document) {
    pendingRoots.add(root || document);
    if (scanScheduled) return;

    scanScheduled = true;

    window.requestAnimationFrame(() => {
      scanScheduled = false;

      const roots = Array.from(pendingRoots);
      pendingRoots.clear();

      for (const pendingRoot of roots) {
        scan(pendingRoot);
      }
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const targetElement = mutation.target.parentElement;
        scheduleScan(targetElement?.closest?.(CANDIDATE_SELECTOR) || targetElement);
        continue;
      }

      for (const node of mutation.addedNodes) {
        scheduleScan(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener('load', () => scheduleScan(document));
  window.addEventListener('focus', () => scheduleScan(document));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleScan(document);
  });

  window.__cgFileLinkHighlighter = {
    version: VERSION,
    scan() {
      scan(document);
    },
  };

  scheduleScan(document);
})();

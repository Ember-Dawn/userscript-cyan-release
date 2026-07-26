// ==UserScript==
// @name         ChatGPT 文件直链下载按钮助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-direct-download.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-direct-download.user.js
// @version      0.4.2
// @description  只在 ChatGPT 聊天记录中的生成文件链接旁边添加“下载”按钮，点击后不打开右侧预览栏，直接调用下载接口并下载文件。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
脚本说明：

1. 作用
   - ChatGPT 新版网页端中，点击生成文件链接会先打开右侧文件预览栏。
   - 本脚本会在聊天记录里的文件链接旁边添加一个美观的“下载”文字按钮。
   - 点击“下载”后，脚本不点击原文件链接，因此不会主动打开右侧预览栏。
   - 脚本会直接调用 ChatGPT 网页端内部下载接口，拿到 signed download_url，然后触发浏览器下载。

2. 技术路线
   - ChatGPT 正文中的文件链接通常是 button，而不是 a[href]。
   - 文件按钮本身不直接包含 download URL。
   - 但该按钮的 React 内部 props 中通常包含：
     - fileName
     - filepath
     - messageId
     - conversation.id 或 sandboxDownloadContext.serverThreadId
   - 点击正文文件按钮时，ChatGPT 前端会请求：
     /backend-api/conversation/{conversation_id}/interpreter/download
       ?message_id={message_id}
       &sandbox_path={sandbox_path}
   - 该接口返回 JSON，其中关键字段是：
     download_url
   - download_url 指向：
     /backend-api/estuary/content?id=file_xxx&fn=xxx&cd=attachment&ts=...&sig=...&v=0
   - 这个 URL 带临时签名 sig，不应缓存、不应硬编码。
   - 本脚本每次点击“下载”时实时调用 interpreter/download，拿到最新 download_url 后下载。

3. 经验记录，供未来 AI 继续维护
   - 不要试图从 outerHTML 里找真实下载链接。正文文件按钮和侧边栏下载按钮都只是 button。
   - 真正下载链接是在 interpreter/download 返回体里的 download_url 字段。
   - 正文按钮的 React props 里通常能找到 messageId、filepath、fileName。
   - filepath 需要是 /mnt/data/xxx，不要误写成 https://chatgpt.com/mnt/data/xxx。
   - sig 是临时签名，每次下载时重新请求即可。
   - 文件名有时会被 URL 编码，例如：
     06%20%E5%AE%BF%E4%B8%BB%E6%9C%BA.md
     此时必须先 decodeURIComponent，再拼 /mnt/data/xxx。
   - 如果 ChatGPT 后续改版导致 React props 路径变化，应优先排查 extractFileInfoFromButton()。

4. 本版关键修复 v0.4.0
   - 修复 URL 编码文件名导致下载失败的问题。
   - sanitizeFileName() 会强制尝试 decodeURIComponent。
   - sanitizeSandboxPath() 会生成解码后的 /mnt/data/xxx。
   - 下载失败时会尝试多个 sandbox_path 候选：
     1. React props 中提取到的路径；
     2. decode 后文件名拼出的 /mnt/data/xxx；
     3. 原始文件名拼出的 /mnt/data/xxx；
     4. 对含 % 的路径再次 decode 后的路径。
   - extractFileInfoFromButton() 永远返回对象，方便 Console 调试。
   - 失败时会在 Console 打印完整 info 和尝试过的路径。

5. 范围限制
   - 只扫描：
     [data-message-author-role="assistant"] .markdown
   - 显式排除：
     #thread-bottom-container
     form[data-type="unified-composer"]
     [data-composer-surface="true"]
     [data-stage-thread-flyout="true"]
     button[aria-label^="移除文件"]
   - 因此不会给底部输入框附件区添加下载按钮。

6. 调试方法
   - 任意时候可在 Console 运行：
     window.__cgDirectDownloadHelper.scan()
   - 选择一个原始文件按钮后可运行：
     window.__cgDirectDownloadHelper.extractInfoFromButton(button)
   - 清理误插入按钮：
     window.__cgDirectDownloadHelper.cleanup()
*/

(() => {
  'use strict';

  const SCRIPT_NAME = 'ChatGPT 文件直链下载按钮助手';
  const VERSION = '0.4.0';

  const FILE_EXT_RE =
    /\.(md|txt|pdf|docx?|xlsx?|xls|pptx?|csv|zip|json|py|js|ts|tsx|jsx|html?|css|png|jpe?g|webp|gif|svg|yaml|yml|xml)$/i;

  const processedFileButtons = new WeakSet();
  const busyDownloadButtons = new WeakSet();

  let cachedAccessToken = null;
  let cachedAccessTokenAt = 0;
  let scanScheduled = false;

  function log(...args) {
    console.log(`[${SCRIPT_NAME}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${SCRIPT_NAME}]`, ...args);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function safeDecodeURIComponent(value) {
    let s = normalizeText(value);
    if (!s) return '';

    for (let i = 0; i < 3; i += 1) {
      if (!/%[0-9A-Fa-f]{2}/.test(s)) break;

      try {
        const decoded = decodeURIComponent(s);
        if (decoded === s) break;
        s = decoded;
      } catch (_) {
        break;
      }
    }

    return s;
  }

  function stripChatGptOriginIfAccidentallyAdded(value) {
    let s = normalizeText(value);
    if (!s) return '';

    try {
      if (/^https?:\/\//i.test(s)) {
        const u = new URL(s);
        if (u.hostname === 'chatgpt.com' || u.hostname === 'chat.openai.com') {
          s = u.pathname;
        }
      }
    } catch (_) {
      // ignore
    }

    return s;
  }

  function isLikelyFileName(text) {
    const raw = normalizeText(text);
    const decoded = safeDecodeURIComponent(raw);

    if (!decoded) return false;
    if (decoded.length > 300) return false;

    return FILE_EXT_RE.test(decoded);
  }

  function getVisibleLabel(el) {
    return normalizeText(
      el?.getAttribute?.('aria-label') ||
      el?.getAttribute?.('title') ||
      el?.innerText ||
      el?.textContent ||
      ''
    );
  }

  function sanitizeFileName(value) {
    let s = normalizeText(value);
    if (!s) return '';

    s = stripChatGptOriginIfAccidentallyAdded(s);

    if (s.includes('/mnt/data/')) {
      s = s.slice(s.lastIndexOf('/mnt/data/') + '/mnt/data/'.length);
    } else if (s.includes('/')) {
      s = s.split('/').pop() || s;
    }

    s = safeDecodeURIComponent(s);
    s = s.replace(/^\/+/, '');

    return s;
  }

  function sanitizeRawFileName(value) {
    let s = normalizeText(value);
    if (!s) return '';

    s = stripChatGptOriginIfAccidentallyAdded(s);

    if (s.includes('/mnt/data/')) {
      s = s.slice(s.lastIndexOf('/mnt/data/') + '/mnt/data/'.length);
    } else if (s.includes('/')) {
      s = s.split('/').pop() || s;
    }

    return s.replace(/^\/+/, '');
  }

  function getBaseName(path) {
    const s = normalizeText(path);
    if (!s) return '';

    try {
      return safeDecodeURIComponent(s).split('/').pop() || '';
    } catch (_) {
      return s.split('/').pop() || '';
    }
  }

  function sanitizeSandboxPath(value, fallbackFileName) {
    let s = normalizeText(value);

    if (s) {
      s = stripChatGptOriginIfAccidentallyAdded(s);
      s = safeDecodeURIComponent(s);

      const idx = s.indexOf('/mnt/data/');
      if (idx >= 0) {
        s = s.slice(idx);
      }

      if (!s.startsWith('/mnt/data/') && s.includes('mnt/data/')) {
        s = '/' + s.slice(s.indexOf('mnt/data/'));
      }
    }

    if (!s || !s.startsWith('/mnt/data/')) {
      const cleanName = sanitizeFileName(fallbackFileName);
      if (cleanName) {
        s = `/mnt/data/${cleanName}`;
      }
    }

    return s;
  }

  function uniqueArray(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function buildSandboxPathCandidates(info) {
    const candidates = [];

    const rawLabel = info.rawLabel || '';
    const decodedFileName = sanitizeFileName(info.fileName || rawLabel);
    const rawFileName = sanitizeRawFileName(rawLabel);
    const rawInfoFileName = sanitizeRawFileName(info.fileName || '');

    if (info.sandboxPath) {
      candidates.push(sanitizeSandboxPath(info.sandboxPath, decodedFileName || rawLabel));
    }

    if (decodedFileName) {
      candidates.push(`/mnt/data/${decodedFileName}`);
    }

    if (rawFileName) {
      candidates.push(`/mnt/data/${rawFileName}`);
    }

    if (rawInfoFileName) {
      candidates.push(`/mnt/data/${rawInfoFileName}`);
    }

    for (const item of [...candidates]) {
      if (/%[0-9A-Fa-f]{2}/.test(item)) {
        candidates.push(safeDecodeURIComponent(item));
      }
    }

    return uniqueArray(
      candidates
        .map((p) => sanitizeSandboxPath(p, decodedFileName || rawLabel))
        .filter((p) => p.startsWith('/mnt/data/'))
    );
  }

  function getConversationIdFromUrl() {
    const match = location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : '';
  }

  function getReactKeys(el) {
    if (!el) return [];

    return Object.keys(el).filter((key) =>
      key.startsWith('__reactProps$') ||
      key.startsWith('__reactFiber$') ||
      key.startsWith('__reactInternalInstance$')
    );
  }

  function getReactRootsAroundElement(el) {
    const roots = [];
    const seen = new WeakSet();

    let cur = el;
    let depth = 0;

    while (cur && depth < 10) {
      for (const key of getReactKeys(cur)) {
        try {
          const value = cur[key];
          if (value && typeof value === 'object' && !seen.has(value)) {
            roots.push(value);
            seen.add(value);
          }
        } catch (_) {
          // ignore
        }
      }

      cur = cur.parentElement;
      depth += 1;
    }

    return roots;
  }

  function isInsideAssistantMarkdown(el) {
    const message = el.closest('[data-message-author-role="assistant"]');
    if (!message) return false;

    const markdown = el.closest('.markdown');
    if (!markdown) return false;

    return message.contains(markdown);
  }

  function isInsideForbiddenArea(el) {
    if (!el) return true;

    if (el.closest('#thread-bottom-container')) return true;
    if (el.closest('form[data-type="unified-composer"]')) return true;
    if (el.closest('[data-composer-surface="true"]')) return true;
    if (el.closest('[data-prompt-textarea-header]')) return true;
    if (el.closest('[data-stage-thread-flyout="true"]')) return true;
    if (el.closest('[contenteditable="true"]')) return true;
    if (el.closest('#prompt-textarea')) return true;

    return false;
  }

  function extractFileInfoFromButton(fileButton) {
    const rawLabel = getVisibleLabel(fileButton);
    const fallbackFileName = sanitizeFileName(rawLabel);
    const urlConversationId = getConversationIdFromUrl();

    const info = {
      rawLabel,
      fileName: fallbackFileName,
      rawFileName: sanitizeRawFileName(rawLabel),
      sandboxPath: '',
      sandboxPathCandidates: [],
      messageId: '',
      conversationId: urlConversationId,
      source: {
        rawLabel: rawLabel ? 'button label' : '',
        fileName: fallbackFileName ? 'decoded button label' : '',
        sandboxPath: '',
        messageId: '',
        conversationId: urlConversationId ? 'url' : '',
      },
      debug: {
        reactRootsCount: 0,
        visitedCount: 0,
        note: '',
      },
    };

    if (!fileButton) {
      info.debug.note = 'fileButton is null or undefined';
      info.sandboxPathCandidates = buildSandboxPathCandidates(info);
      return info;
    }

    const roots = getReactRootsAroundElement(fileButton);
    info.debug.reactRootsCount = roots.length;

    const seen = new WeakSet();
    let visitCount = 0;

    const MAX_VISITS = 8000;
    const MAX_DEPTH = 14;

    function maybeSetFileName(value, sourcePath) {
      const s = sanitizeFileName(value);

      if (s && isLikelyFileName(s)) {
        if (!info.fileName || info.fileName === fallbackFileName) {
          info.fileName = s;
          info.rawFileName = sanitizeRawFileName(value);
          info.source.fileName = sourcePath;
        }
      }
    }

    function maybeSetSandboxPath(value, sourcePath) {
      const s = sanitizeSandboxPath(value, info.fileName || fallbackFileName);
      if (!s || !s.startsWith('/mnt/data/')) return;

      const base = getBaseName(s);
      const fileName = info.fileName || fallbackFileName;

      if (!fileName || base === fileName || !info.sandboxPath) {
        info.sandboxPath = s;
        info.source.sandboxPath = sourcePath;
      }
    }

    function maybeSetMessageId(value, sourcePath) {
      const s = normalizeText(value);
      if (!s) return;

      if (
        !info.messageId &&
        !s.startsWith('file_') &&
        !s.startsWith('libfile_') &&
        /^[a-zA-Z0-9_-]{16,120}$/.test(s)
      ) {
        info.messageId = s;
        info.source.messageId = sourcePath;
      }
    }

    function maybeSetConversationId(value, sourcePath) {
      const s = normalizeText(value);
      if (!s) return;

      if (
        !s.startsWith('file_') &&
        !s.startsWith('libfile_') &&
        /^[a-zA-Z0-9_-]{16,140}$/.test(s)
      ) {
        info.conversationId = s;
        info.source.conversationId = sourcePath;
      }
    }

    function walk(node, path, depth) {
      if (!node) return;
      if (visitCount > MAX_VISITS) return;

      const type = typeof node;
      if (type !== 'object' && type !== 'function') return;

      if (seen.has(node)) return;
      seen.add(node);
      visitCount += 1;

      if (depth > MAX_DEPTH) return;

      let keys;

      try {
        keys = Object.keys(node);
      } catch (_) {
        return;
      }

      for (const key of keys) {
        let child;

        try {
          child = node[key];
        } catch (_) {
          continue;
        }

        const childPath = path ? `${path}.${key}` : key;
        const lowerPath = childPath.toLowerCase();

        if (typeof child === 'string') {
          if (
            key === 'fileName' ||
            key === 'filename' ||
            key === 'file_name' ||
            lowerPath.endsWith('.filename') ||
            lowerPath.endsWith('.file_name')
          ) {
            maybeSetFileName(child, childPath);
          }

          if (
            key === 'filepath' ||
            key === 'filePath' ||
            key === 'sandbox_path' ||
            key === 'sandboxPath' ||
            lowerPath.includes('filepath') ||
            lowerPath.includes('sandboxpath') ||
            lowerPath.includes('sandbox_path')
          ) {
            maybeSetSandboxPath(child, childPath);
          }

          if (key === 'messageId' || key === 'message_id') {
            maybeSetMessageId(child, childPath);
          }

          if (
            key === 'serverThreadId' ||
            key === 'conversationId' ||
            key === 'conversation_id' ||
            lowerPath.endsWith('conversation.id')
          ) {
            maybeSetConversationId(child, childPath);
          }
        }

        if (key === 'conversation' && child && typeof child === 'object') {
          try {
            if (typeof child.id === 'string') {
              maybeSetConversationId(child.id, `${childPath}.id`);
            }
          } catch (_) {
            // ignore
          }
        }

        if (key === 'sandboxDownloadContext' && child && typeof child === 'object') {
          try {
            if (typeof child.serverThreadId === 'string') {
              maybeSetConversationId(
                child.serverThreadId,
                `${childPath}.serverThreadId`
              );
            }
          } catch (_) {
            // ignore
          }
        }

        walk(child, childPath, depth + 1);
      }
    }

    for (const root of roots) {
      walk(root, '', 0);
    }

    info.debug.visitedCount = visitCount;

    if (!info.messageId) {
      const messageBox = fileButton.closest('[data-message-id]');
      const domMessageId = messageBox?.getAttribute('data-message-id') || '';

      if (domMessageId) {
        maybeSetMessageId(domMessageId, 'closest([data-message-id])');
      }
    }

    if (!info.conversationId) {
      info.conversationId = getConversationIdFromUrl();

      if (info.conversationId) {
        info.source.conversationId = 'url fallback';
      }
    }

    if (!info.sandboxPath) {
      info.sandboxPath = sanitizeSandboxPath('', info.fileName || rawLabel);

      if (info.sandboxPath) {
        info.source.sandboxPath = 'fallback /mnt/data/{decodedFileName}';
      }
    }

    info.sandboxPathCandidates = buildSandboxPathCandidates(info);

    return info;
  }

  async function getAccessTokenIfAvailable() {
    const now = Date.now();

    if (cachedAccessToken && now - cachedAccessTokenAt < 5 * 60 * 1000) {
      return cachedAccessToken;
    }

    try {
      const res = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      if (!res.ok) return '';

      const data = await res.json();

      const token =
        data?.accessToken ||
        data?.access_token ||
        data?.user?.accessToken ||
        data?.user?.access_token ||
        '';

      if (token) {
        cachedAccessToken = token;
        cachedAccessTokenAt = Date.now();
        return token;
      }
    } catch (_) {
      // 有些版本无法从 /api/auth/session 取 token，忽略即可。
    }

    return '';
  }

  async function fetchDownloadInfo(info, sandboxPath, useAuthToken) {
    const conversationId = info.conversationId;
    const messageId = info.messageId;

    const url =
      `/backend-api/conversation/${encodeURIComponent(conversationId)}` +
      `/interpreter/download` +
      `?message_id=${encodeURIComponent(messageId)}` +
      `&sandbox_path=${encodeURIComponent(sandboxPath)}`;

    const headers = {
      accept: 'application/json',
    };

    if (useAuthToken) {
      const token = await getAccessTokenIfAvailable();

      if (token) {
        headers.authorization = `Bearer ${token}`;
      }
    }

    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers,
    });

    let text = '';

    try {
      text = await res.text();
    } catch (_) {
      text = '';
    }

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url,
      sandboxPath,
      data,
      text,
    };
  }

  async function getDownloadUrl(info) {
    const attempts = [];
    const candidates = buildSandboxPathCandidates(info);

    if (!info.conversationId) {
      throw new Error(`无法识别 conversationId。\ninfo=${JSON.stringify(info, null, 2)}`);
    }

    if (!info.messageId) {
      throw new Error(`无法识别 messageId。\ninfo=${JSON.stringify(info, null, 2)}`);
    }

    if (!candidates.length) {
      throw new Error(`无法生成 sandbox_path 候选。\ninfo=${JSON.stringify(info, null, 2)}`);
    }

    for (const sandboxPath of candidates) {
      let result = await fetchDownloadInfo(info, sandboxPath, false);
      attempts.push({
        sandboxPath,
        status: result.status,
        ok: result.ok,
        responsePreview: String(result.text || '').slice(0, 300),
      });

      if (!result.ok && (result.status === 401 || result.status === 403)) {
        result = await fetchDownloadInfo(info, sandboxPath, true);
        attempts.push({
          sandboxPath,
          status: result.status,
          ok: result.ok,
          withAuthToken: true,
          responsePreview: String(result.text || '').slice(0, 300),
        });
      }

      if (result.ok && result.data?.download_url) {
        return {
          downloadUrl: result.data.download_url,
          usedSandboxPath: sandboxPath,
          attempts,
        };
      }
    }

    throw new Error(
      `下载接口没有返回 download_url。\n` +
      `info=${JSON.stringify(info, null, 2)}\n` +
      `attempts=${JSON.stringify(attempts, null, 2)}`
    );
  }

  function triggerBrowserDownload(downloadUrl, fileName) {
    const a = document.createElement('a');

    a.href = downloadUrl;
    a.rel = 'noopener';
    a.style.display = 'none';

    if (fileName) {
      a.download = fileName;
    }

    document.body.appendChild(a);
    a.click();

    window.setTimeout(() => {
      a.remove();
    }, 1000);
  }

  function iconSvg(type) {
    if (type === 'download') {
      return `
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" class="cg-dd-icon">
          <path fill="currentColor" d="M10 2.5a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V3.25A.75.75 0 0 1 10 2.5Zm-5.25 11a.75.75 0 0 1 .75.75v1.25h9v-1.25a.75.75 0 0 1 1.5 0v2A.75.75 0 0 1 15.25 17H4.75A.75.75 0 0 1 4 16.25v-2a.75.75 0 0 1 .75-.75Z"></path>
        </svg>
      `;
    }

    if (type === 'success') {
      return `
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" class="cg-dd-icon">
          <path fill="currentColor" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"></path>
        </svg>
      `;
    }

    if (type === 'error') {
      return `
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" class="cg-dd-icon">
          <path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4a.75.75 0 0 1 .75.75v4.25a.75.75 0 0 1-1.5 0V6.75A.75.75 0 0 1 10 6Zm0 8.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
        </svg>
      `;
    }

    return '';
  }

  function setDownloadButtonStatus(btn, status, title) {
    if (!btn) return;

    btn.dataset.status = status;

    if (status === 'idle') {
      btn.innerHTML = `${iconSvg('download')}<span>下载</span>`;
      btn.style.cursor = 'pointer';
    } else if (status === 'loading') {
      btn.innerHTML = `<span class="cg-dd-loading-dot">…</span><span>获取中</span>`;
      btn.style.cursor = 'wait';
    } else if (status === 'success') {
      btn.innerHTML = `${iconSvg('success')}<span>已下载</span>`;
      btn.style.cursor = 'default';
    } else if (status === 'error') {
      btn.innerHTML = `${iconSvg('error')}<span>失败</span>`;
      btn.style.cursor = 'pointer';
    }

    if (title) {
      btn.title = title;
      btn.setAttribute('aria-label', title);
    }
  }

  function ensureStyle() {
    if (document.getElementById('cg-direct-download-style')) return;

    const style = document.createElement('style');
    style.id = 'cg-direct-download-style';
    style.textContent = `
      .cg-direct-download-wrapper {
        display: inline-flex;
        align-items: center;
        margin-left: 8px;
        vertical-align: baseline;
      }

      .cg-direct-download-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 24px;
        min-height: 24px;
        padding: 0 9px;
        border: 1px solid rgba(59, 130, 246, 0.35);
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.10);
        color: rgb(37, 99, 235);
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        white-space: nowrap;
        vertical-align: middle;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        transition:
          background 120ms ease,
          border-color 120ms ease,
          color 120ms ease,
          transform 80ms ease,
          opacity 120ms ease,
          box-shadow 120ms ease;
        opacity: 0.94;
      }

      .cg-direct-download-button:hover {
        background: rgba(59, 130, 246, 0.16);
        border-color: rgba(59, 130, 246, 0.55);
        box-shadow: 0 1px 4px rgba(59, 130, 246, 0.18);
        opacity: 1;
      }

      .cg-direct-download-button:active {
        transform: translateY(1px);
      }

      .cg-direct-download-button[data-status="loading"] {
        background: rgba(99, 102, 241, 0.12);
        border-color: rgba(99, 102, 241, 0.45);
        color: rgb(79, 70, 229);
      }

      .cg-direct-download-button[data-status="success"] {
        background: rgba(34, 197, 94, 0.12);
        border-color: rgba(34, 197, 94, 0.45);
        color: rgb(22, 163, 74);
      }

      .cg-direct-download-button[data-status="error"] {
        background: rgba(239, 68, 68, 0.12);
        border-color: rgba(239, 68, 68, 0.45);
        color: rgb(220, 38, 38);
      }

      .cg-dd-icon {
        display: block;
        flex: 0 0 auto;
      }

      .cg-dd-loading-dot {
        display: inline-block;
        width: 13px;
        text-align: center;
        font-size: 13px;
        line-height: 1;
        transform: translateY(-1px);
      }

      @media (prefers-color-scheme: dark) {
        .cg-direct-download-button {
          border-color: rgba(96, 165, 250, 0.40);
          background: rgba(96, 165, 250, 0.13);
          color: rgb(147, 197, 253);
          box-shadow: none;
        }

        .cg-direct-download-button:hover {
          background: rgba(96, 165, 250, 0.20);
          border-color: rgba(147, 197, 253, 0.60);
          box-shadow: none;
        }

        .cg-direct-download-button[data-status="loading"] {
          background: rgba(129, 140, 248, 0.16);
          border-color: rgba(129, 140, 248, 0.55);
          color: rgb(165, 180, 252);
        }

        .cg-direct-download-button[data-status="success"] {
          background: rgba(74, 222, 128, 0.16);
          border-color: rgba(74, 222, 128, 0.50);
          color: rgb(134, 239, 172);
        }

        .cg-direct-download-button[data-status="error"] {
          background: rgba(248, 113, 113, 0.16);
          border-color: rgba(248, 113, 113, 0.55);
          color: rgb(252, 165, 165);
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createDirectDownloadButton(fileButton) {
    const wrapper = document.createElement('span');
    wrapper.className = 'cg-direct-download-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cg-direct-download-button';
    btn.title = '直接下载，不打开预览栏';
    btn.setAttribute('aria-label', '直接下载，不打开预览栏');

    setDownloadButtonStatus(btn, 'idle', '直接下载，不打开预览栏');

    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    btn.addEventListener('mousedown', stop, true);
    btn.addEventListener('mouseup', stop, true);

    btn.addEventListener('click', async (event) => {
      stop(event);

      if (busyDownloadButtons.has(btn)) return;

      busyDownloadButtons.add(btn);
      setDownloadButtonStatus(btn, 'loading', '正在获取下载链接...');

      try {
        // 第一次提取。
        let info = extractFileInfoFromButton(fileButton);

        // 如果刚生成完，React props 可能还没稳定，短暂等待后再提取一次。
        if (!info.messageId || !info.conversationId || !info.sandboxPathCandidates.length) {
          await sleep(500);
          info = extractFileInfoFromButton(fileButton);
        }

        if (!info.fileName || !isLikelyFileName(info.fileName)) {
          throw new Error(`无法识别文件名。\ninfo=${JSON.stringify(info, null, 2)}`);
        }

        log('准备直链下载：', {
          fileName: info.fileName,
          rawLabel: info.rawLabel,
          sandboxPath: info.sandboxPath,
          sandboxPathCandidates: info.sandboxPathCandidates,
          messageId: info.messageId,
          conversationId: info.conversationId,
          source: info.source,
          debug: info.debug,
        });

        const result = await getDownloadUrl(info);

        log('已获取 download_url：', {
          fileName: info.fileName,
          usedSandboxPath: result.usedSandboxPath,
          attempts: result.attempts,
        });

        triggerBrowserDownload(result.downloadUrl, info.fileName);

        setDownloadButtonStatus(btn, 'success', '已触发下载');

        window.setTimeout(() => {
          setDownloadButtonStatus(btn, 'idle', '直接下载，不打开预览栏');
          busyDownloadButtons.delete(btn);
        }, 1800);
      } catch (err) {
        busyDownloadButtons.delete(btn);

        const msg = err?.stack || err?.message || String(err);
        warn('直链下载失败：', msg);

        setDownloadButtonStatus(btn, 'error', '直链下载失败，点击 Console 查看原因');

        window.setTimeout(() => {
          setDownloadButtonStatus(btn, 'idle', '直接下载，不打开预览栏');
        }, 3000);
      }
    }, true);

    wrapper.appendChild(btn);
    return wrapper;
  }

  function isValidChatFileButton(button) {
    if (!button || button.tagName !== 'BUTTON') return false;
    if (button.closest('.cg-direct-download-wrapper')) return false;
    if (isInsideForbiddenArea(button)) return false;
    if (!isInsideAssistantMarkdown(button)) return false;

    const ariaLabel = normalizeText(button.getAttribute('aria-label') || '');
    if (ariaLabel.startsWith('移除文件') || ariaLabel.startsWith('Remove file')) {
      return false;
    }

    const label = getVisibleLabel(button);
    if (!isLikelyFileName(label)) return false;

    return true;
  }

  function enhanceFileButton(button) {
    if (processedFileButtons.has(button)) return;
    if (!isValidChatFileButton(button)) return;

    processedFileButtons.add(button);

    const next = button.nextElementSibling;
    if (next?.classList?.contains('cg-direct-download-wrapper')) return;

    const directDownloadButton = createDirectDownloadButton(button);
    button.insertAdjacentElement('afterend', directDownloadButton);

    log('已添加直链下载按钮：', getVisibleLabel(button));
  }

  function cleanupWrongInsertedButtons() {
    const wrappers = Array.from(document.querySelectorAll('.cg-direct-download-wrapper'));

    for (const wrapper of wrappers) {
      const prev = wrapper.previousElementSibling;

      if (!prev || !isValidChatFileButton(prev)) {
        wrapper.remove();
      }
    }
  }

  function scanFileButtons() {
    ensureStyle();

    cleanupWrongInsertedButtons();

    const markdownAreas = Array.from(
      document.querySelectorAll('[data-message-author-role="assistant"] .markdown')
    );

    for (const markdown of markdownAreas) {
      if (isInsideForbiddenArea(markdown)) continue;

      const buttons = Array.from(markdown.querySelectorAll('button[aria-label], button'));

      for (const button of buttons) {
        if (!isValidChatFileButton(button)) continue;
        enhanceFileButton(button);
      }
    }
  }

  function scheduleScan() {
    if (scanScheduled) return;

    scanScheduled = true;

    window.requestAnimationFrame(() => {
      scanScheduled = false;
      scanFileButtons();
    });
  }

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener('load', scheduleScan);
  window.addEventListener('focus', scheduleScan);
  document.addEventListener('visibilitychange', scheduleScan);

  scheduleScan();

  window.__cgDirectDownloadHelper = {
    version: VERSION,
    scan: scanFileButtons,
    cleanup: cleanupWrongInsertedButtons,
    safeDecodeURIComponent,
    sanitizeFileName,
    sanitizeSandboxPath,
    buildSandboxPathCandidates,
    extractInfoFromButton(button) {
      return extractFileInfoFromButton(button);
    },
  };

  log(`已启动 v${VERSION}`);
})();

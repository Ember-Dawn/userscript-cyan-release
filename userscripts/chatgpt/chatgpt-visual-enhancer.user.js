// ==UserScript==
// @name         ChatGPT 界面视觉增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-visual-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-visual-enhancer.user.js
// @version      0.2.2
// @description  柔化 ChatGPT 白天模式，放宽对话正文，高亮文件下载入口，并为临时对话输入框提供青色视觉提示。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '0.2.2';
    const STYLE_ID = 'cg-visual-enhancer-style';
    const TEMPORARY_CHAT_ATTRIBUTE = 'data-cg-temporary-chat';
    const LOCATION_CHANGE_EVENT = 'cg-visual-enhancer-location-change';
    const FILE_HIGHLIGHT_CLASS = 'cg-file-link-highlight';
    const ASSISTANT_CONTENT_SELECTOR = [
        '[data-markdown-text-style="assistant-message"]',
        '[data-message-author-role="assistant"] .markdown',
    ].join(', ');
    const FILE_CANDIDATE_SELECTOR = 'button, a[href], [data-file-reference="true"]';
    const FILE_EXT_RE =
        /\.(md|txt|pdf|docx?|xlsx?|xls|pptx?|csv|zip|json|py|js|ts|tsx|jsx|html?|css|png|jpe?g|webp|gif|svg|yaml|yml|xml)$/i;

    const pendingRoots = new Set();
    let scanScheduled = false;

    const css = `
/* 白天模式：主界面与侧边栏统一为中性浅灰，输入框稍亮以保留层次。 */
html:not(.dark) {
    --main-surface-primary: #f4f4f2 !important;
    --sidebar-surface-primary: #f4f4f2 !important;
    --composer-surface-primary: #fafaf9 !important;
}

html:not(.dark) body {
    background-color: #f4f4f2 !important;
}

/* 桌面端仅放宽对话正文；底部 Composer 保持 ChatGPT 原生宽度与响应式行为。 */
@media (min-width: 1024px) {
    [data-thread-user-message-navigation-content="true"] {
        --thread-content-max-width: min(90rem, calc(100vw - 8rem)) !important;
        --thread-body-max-width: min(90rem, calc(100vw - 8rem)) !important;
        width: 100% !important;
        max-width: min(90rem, calc(100vw - 8rem)) !important;
    }
}

/* 临时对话：直接标记当前 Composer，并混入 10% #0891B2 背景。 */
[data-composer-body][${TEMPORARY_CHAT_ATTRIBUTE}="true"] {
    background-color: color-mix(in srgb, var(--composer-surface-primary) 90%, #0891B2 10%) !important;
}

.${FILE_HIGHLIGHT_CLASS},
.${FILE_HIGHLIGHT_CLASS} * {
    color: rgb(37, 99, 235) !important;
    font-weight: 600 !important;
}

@media (prefers-color-scheme: dark) {
    .${FILE_HIGHLIGHT_CLASS},
    .${FILE_HIGHLIGHT_CLASS} * {
        color: rgb(147, 197, 253) !important;
    }
}
`;

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    function isTemporaryChat() {
        try {
            return new URL(window.location.href).searchParams.get('temporary-chat') === 'true';
        } catch {
            return false;
        }
    }

    function collectComposerBodies(root = document) {
        const bodies = new Set();
        const scope = root?.nodeType === Node.TEXT_NODE ? root.parentElement : root;
        if (!scope) return bodies;

        if (scope instanceof Element && scope.matches('[data-composer-body]')) {
            bodies.add(scope);
        }

        if (typeof scope.querySelectorAll === 'function') {
            for (const body of scope.querySelectorAll('[data-composer-body]')) {
                bodies.add(body);
            }
        }

        return bodies;
    }

    function syncTemporaryChatState(root = document) {
        const temporary = isTemporaryChat();
        for (const body of collectComposerBodies(root)) {
            if (temporary) {
                body.setAttribute(TEMPORARY_CHAT_ATTRIBUTE, 'true');
            } else {
                body.removeAttribute(TEMPORARY_CHAT_ATTRIBUTE);
            }
        }
    }

    function patchHistoryMethod(methodName) {
        const original = history[methodName];
        if (typeof original !== 'function') {
            return;
        }

        history[methodName] = function (...args) {
            const result = original.apply(this, args);
            window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
            return result;
        };
    }

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
            element?.getAttribute?.('data-markdown-copy-text') ||
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
            element.closest('form[data-chatgpt-composer]') ||
            element.closest('[data-composer-body]') ||
            element.closest('[data-composer-markdown]') ||
            element.closest('[data-stage-thread-flyout="true"]') ||
            element.closest('[contenteditable="true"]')
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

    function isFileReference(element) {
        return element?.matches?.('[data-file-reference="true"]') === true;
    }

    function isFileLink(element) {
        if (!element?.matches?.(FILE_CANDIDATE_SELECTOR)) return false;
        if (isRemoveFileControl(element)) return false;
        if (isFileReference(element)) return true;
        return isLikelyFileName(getVisibleLabel(element));
    }

    function isOfficialDownloadControl(element) {
        if (!element?.matches?.(FILE_CANDIDATE_SELECTOR)) return false;

        const label = getVisibleLabel(element);
        const lowerLabel = label.toLowerCase();
        return label.startsWith('下载') || lowerLabel.startsWith('download');
    }

    function shouldHighlightFileControl(element) {
        if (!isInsideAssistantContent(element)) return false;
        if (isInsideForbiddenArea(element)) return false;
        return isFileLink(element) || isOfficialDownloadControl(element);
    }

    function collectFileCandidates(root) {
        const candidates = new Set();
        const scope = root?.nodeType === Node.TEXT_NODE ? root.parentElement : root;
        if (!scope) return candidates;

        if (scope instanceof Element && scope.matches(FILE_CANDIDATE_SELECTOR)) {
            candidates.add(scope);
        }

        if (typeof scope.querySelectorAll === 'function') {
            for (const element of scope.querySelectorAll(FILE_CANDIDATE_SELECTOR)) {
                candidates.add(element);
            }
        }

        return candidates;
    }

    function scanFileControls(root = document) {
        for (const element of collectFileCandidates(root)) {
            element.classList.toggle(FILE_HIGHLIGHT_CLASS, shouldHighlightFileControl(element));
        }
    }

    function scheduleFileScan(root = document) {
        pendingRoots.add(root || document);
        if (scanScheduled) return;

        scanScheduled = true;
        window.requestAnimationFrame(() => {
            scanScheduled = false;
            const roots = Array.from(pendingRoots);
            pendingRoots.clear();
            for (const pendingRoot of roots) {
                scanFileControls(pendingRoot);
            }
        });
    }

    function observePageChanges() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'characterData') {
                    scheduleFileScan(mutation.target.parentElement);
                    continue;
                }

                for (const node of mutation.addedNodes) {
                    syncTemporaryChatState(node);
                    scheduleFileScan(node);
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    injectStyle();
    syncTemporaryChatState(document);

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');

    window.addEventListener('popstate', () => syncTemporaryChatState(document));
    window.addEventListener(LOCATION_CHANGE_EVENT, () => syncTemporaryChatState(document));
    window.addEventListener('load', () => scheduleFileScan(document));
    window.addEventListener('focus', () => scheduleFileScan(document));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleFileScan(document);
    });

    observePageChanges();
    scheduleFileScan(document);

    window.__cgVisualEnhancer = {
        version: VERSION,
        scanFileControls() {
            scanFileControls(document);
        },
    };
})();

// ==UserScript==
// @name         ChatGPT 界面视觉增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-visual-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-visual-enhancer.user.js
// @version      0.3.1
// @description  柔化 ChatGPT 白天模式，放宽对话正文，高亮文件下载入口，显示当前对话名称，并为临时对话输入框提供青色视觉提示。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '0.3.1';
    const STYLE_ID = 'cg-visual-enhancer-style';
    const TEMPORARY_CHAT_ATTRIBUTE = 'data-cg-temporary-chat';
    const LOCATION_CHANGE_EVENT = 'cg-visual-enhancer-location-change';
    const FILE_HIGHLIGHT_CLASS = 'cg-file-link-highlight';
    const CONVERSATION_TITLE_ROOT_ID = 'cg-conversation-title-root';
    const CONVERSATION_TITLE_BOX_ID = 'cg-conversation-title-box';
    const CONVERSATION_TITLE_TEXT_ID = 'cg-conversation-title-text';
    const ASSISTANT_CONTENT_SELECTOR = [
        '[data-markdown-text-style="assistant-message"]',
        '[data-message-author-role="assistant"] .markdown',
    ].join(', ');
    const FILE_CANDIDATE_SELECTOR = 'button, a[href], [data-file-reference="true"]';
    const FILE_EXT_RE =
        /\.(md|txt|pdf|docx?|xlsx?|xls|pptx?|csv|zip|json|py|js|ts|tsx|jsx|html?|css|png|jpe?g|webp|gif|svg|yaml|yml|xml)$/i;

    const pendingRoots = new Set();
    let scanScheduled = false;
    let conversationTitleSyncScheduled = false;
    let conversationTitleMountToken = 0;
    let currentConversationId = extractConversationPageId();
    let documentTitleTrusted = true;

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

/* 当前对话名称：占用 Composer 左上沿，并为右侧顺序任务与轮数控件预留空间。 */
#${CONVERSATION_TITLE_ROOT_ID} {
    position: absolute;
    left: 14px;
    right: 166px;
    bottom: -1px;
    z-index: 20;
    min-width: 0;
    pointer-events: none;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

#${CONVERSATION_TITLE_BOX_ID} {
    box-sizing: border-box;
    width: max-content;
    max-width: 100%;
    height: 24px;
    border: 1px solid currentColor;
    border-radius: 6px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    background: transparent;
    color: var(--text-primary, #000);
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    pointer-events: auto;
    cursor: default;
    user-select: none;
}

#${CONVERSATION_TITLE_TEXT_ID} {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

    function extractConversationPageId() {
        const match = location.pathname.match(/(?:^|\/)c\/([^/?#]+)(?:\/|$)/);
        if (!match?.[1]) return null;
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1];
        }
    }

    function isLocalConversationId(conversationId) {
        return typeof conversationId === 'string' && /^local-chatgpt:/i.test(conversationId);
    }

    function cleanConversationTitle(title) {
        return normalizeText(title).slice(0, 200);
    }

    function cleanConversationAriaLabel(label) {
        const value = cleanConversationTitle(label);
        const chinese = value.match(/^打开[“"]?(.+?)[”"]?的对话选项(?:.*)?$/);
        if (chinese) return cleanConversationTitle(chinese[1]);

        const englishFor = value.match(/^Open\s+(?:(?:conversation|chat)\s+)?options\s+for\s+[“"]?(.+?)[”"]?(?:[.!])?$/i);
        if (englishFor) return cleanConversationTitle(englishFor[1]);

        const english = value.match(/^Open(?:\s+[“"]?|[“"])(.+?)[”"]?(?:['’]s)?\s+(?:(?:conversation|chat)\s+)?options(?:[.!])?$/i);
        return english ? cleanConversationTitle(english[1]) : cleanConversationTitle(value);
    }

    function cleanDocumentConversationTitle(title) {
        return cleanConversationTitle(title)
            .replace(/\s*(?:[|｜·•]|[-–—])\s*ChatGPT\s*$/i, '')
            .trim()
            .slice(0, 200);
    }

    function extractConversationIdFromHref(href) {
        try {
            const url = new URL(href, location.href);
            const match = url.pathname.match(/(?:^|\/)c\/([^/?#]+)(?:\/|$)/);
            if (!match?.[1]) return null;
            try {
                return decodeURIComponent(match[1]);
            } catch {
                return match[1];
            }
        } catch {
            return null;
        }
    }

    function isVisibleElement(element) {
        if (!(element instanceof Element) || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return element.getClientRects().length > 0;
    }

    function extractTitleFromAnchor(anchor) {
        if (!anchor) return '';
        const clone = anchor.cloneNode(true);
        clone.querySelectorAll('button, svg, [aria-hidden="true"]').forEach((node) => node.remove());
        const visibleText = cleanConversationTitle(clone.textContent || anchor.textContent || '');
        const ariaText = cleanConversationAriaLabel(anchor.getAttribute('aria-label') || '');
        return visibleText || ariaText;
    }

    function findNativeConversationTitle(conversationId) {
        if (!conversationId) return '';
        const matches = [];
        for (const anchor of document.querySelectorAll('a[href*="/c/"]')) {
            if (extractConversationIdFromHref(anchor.getAttribute('href') || anchor.href || '') === conversationId) {
                matches.push(anchor);
            }
        }
        if (!matches.length) return '';
        const anchor = matches.find(isVisibleElement) || matches[0];
        return extractTitleFromAnchor(anchor);
    }

    function getCurrentConversationTitle() {
        if (isTemporaryChat()) {
            return '临时对话';
        }

        if (!currentConversationId || isLocalConversationId(currentConversationId)) {
            return '新对话';
        }

        if (documentTitleTrusted) {
            const pageTitle = cleanDocumentConversationTitle(document.title || '');
            if (pageTitle && !/^ChatGPT$/i.test(pageTitle)) {
                return pageTitle;
            }
        }

        return findNativeConversationTitle(currentConversationId) || '加载中…';
    }

    function getPortalConversationId(portal) {
        const raw = portal?.getAttribute?.('data-above-composer-conversation-id') || '';
        return raw.replace(/^chatgpt:/i, '') || null;
    }

    function isCurrentComposerPortal(portal) {
        if (!(portal instanceof Element) || !portal.isConnected) return false;
        const form = portal.closest('form[data-chatgpt-composer]');
        if (!form) return false;

        const routeConversationId = extractConversationPageId();
        const portalConversationId = getPortalConversationId(portal);
        const placement = form.getAttribute('data-composer-placement') || '';

        if (routeConversationId) {
            if (portalConversationId) return portalConversationId === routeConversationId;
            return placement === 'thread';
        }

        // 新版 ChatGPT 从已有会话切到“新建”时会短暂保留旧 thread Composer。
        // 只有真正的 home Composer 或 local-chatgpt 临时 portal 才属于当前新对话。
        return placement === 'home' || isLocalConversationId(portalConversationId);
    }

    function getComposerPortal() {
        const portals = document.querySelectorAll(
            'form[data-chatgpt-composer] > [data-above-composer-portal="true"]'
        );
        for (const portal of portals) {
            if (isCurrentComposerPortal(portal)) return portal;
        }
        return null;
    }

    function renderConversationTitle() {
        const box = document.getElementById(CONVERSATION_TITLE_BOX_ID);
        const text = document.getElementById(CONVERSATION_TITLE_TEXT_ID);
        if (!box || !text) return;

        const title = getCurrentConversationTitle();
        if (text.textContent !== title) {
            text.textContent = title;
        }
        if (box.title !== title) {
            box.title = title;
        }
    }

    function installConversationTitle(portal) {
        if (!portal?.isConnected || getComposerPortal() !== portal) {
            return false;
        }

        let root = document.getElementById(CONVERSATION_TITLE_ROOT_ID);
        if (!root) {
            root = document.createElement('div');
            root.id = CONVERSATION_TITLE_ROOT_ID;

            const box = document.createElement('div');
            box.id = CONVERSATION_TITLE_BOX_ID;
            box.setAttribute('role', 'status');
            box.setAttribute('aria-live', 'polite');

            const text = document.createElement('span');
            text.id = CONVERSATION_TITLE_TEXT_ID;
            box.appendChild(text);
            root.appendChild(box);
        }

        if (root.parentElement !== portal) {
            portal.appendChild(root);
        }

        renderConversationTitle();
        return true;
    }

    function scheduleConversationTitleMount() {
        if (document.readyState !== 'complete') return;

        const portal = getComposerPortal();
        if (!portal) return;

        const root = document.getElementById(CONVERSATION_TITLE_ROOT_ID);
        if (root?.parentElement === portal) {
            renderConversationTitle();
            return;
        }

        const token = ++conversationTitleMountToken;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (token !== conversationTitleMountToken) return;
                if (portal !== getComposerPortal() || !portal.isConnected) return;
                installConversationTitle(portal);
            });
        });
    }

    function scheduleConversationTitleSync() {
        if (conversationTitleSyncScheduled) return;
        conversationTitleSyncScheduled = true;
        window.requestAnimationFrame(() => {
            conversationTitleSyncScheduled = false;
            scheduleConversationTitleMount();
            renderConversationTitle();
        });
    }

    function handleLocationChange() {
        const nextConversationId = extractConversationPageId();
        if (nextConversationId !== currentConversationId) {
            currentConversationId = nextConversationId;
            documentTitleTrusted = false;
        }
        syncTemporaryChatState(document);
        scheduleConversationTitleSync();
    }

    function markDocumentTitleFresh() {
        documentTitleTrusted = true;
        scheduleConversationTitleSync();
    }

    function isTitleMutation(mutation) {
        const target = mutation.target;
        if (target instanceof Element && target.tagName === 'TITLE') return true;
        if (target?.parentElement?.tagName === 'TITLE') return true;
        return Array.from(mutation.addedNodes || []).some(
            (node) => node instanceof Element && (node.tagName === 'TITLE' || node.querySelector?.('title'))
        );
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
            let titleChanged = false;
            let titleMountMayBeNeeded = false;

            for (const mutation of mutations) {
                if (isTitleMutation(mutation)) {
                    titleChanged = true;
                }

                if (mutation.type === 'characterData') {
                    scheduleFileScan(mutation.target.parentElement);
                    continue;
                }

                if (mutation.type === 'attributes') {
                    if (
                        mutation.attributeName === 'data-composer-placement' ||
                        mutation.attributeName === 'data-above-composer-conversation-id'
                    ) {
                        titleMountMayBeNeeded = true;
                    }
                    continue;
                }

                for (const node of mutation.addedNodes) {
                    syncTemporaryChatState(node);
                    scheduleFileScan(node);
                    if (node instanceof Element && (
                        node.matches?.('form[data-chatgpt-composer], [data-above-composer-portal="true"]') ||
                        node.querySelector?.('form[data-chatgpt-composer], [data-above-composer-portal="true"]')
                    )) {
                        titleMountMayBeNeeded = true;
                    }
                }
            }

            if (titleChanged) {
                markDocumentTitleFresh();
            } else if (titleMountMayBeNeeded || !document.getElementById(CONVERSATION_TITLE_ROOT_ID)?.isConnected) {
                scheduleConversationTitleSync();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['data-composer-placement', 'data-above-composer-conversation-id'],
        });
    }

    injectStyle();
    syncTemporaryChatState(document);

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener(LOCATION_CHANGE_EVENT, handleLocationChange);
    window.addEventListener('load', () => {
        documentTitleTrusted = true;
        scheduleFileScan(document);
        scheduleConversationTitleSync();
    });
    window.addEventListener('focus', () => {
        scheduleFileScan(document);
        scheduleConversationTitleSync();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            scheduleFileScan(document);
            scheduleConversationTitleSync();
        }
    });

    observePageChanges();
    scheduleFileScan(document);
    scheduleConversationTitleSync();

    window.__cgVisualEnhancer = {
        version: VERSION,
        scanFileControls() {
            scanFileControls(document);
        },
        syncConversationTitle() {
            documentTitleTrusted = true;
            scheduleConversationTitleSync();
        },
    };
})();

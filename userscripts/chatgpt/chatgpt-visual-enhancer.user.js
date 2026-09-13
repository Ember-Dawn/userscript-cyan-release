// ==UserScript==
// @name         ChatGPT 界面视觉增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-visual-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-visual-enhancer.user.js
// @version      0.1.1
// @description  柔化 ChatGPT 白天模式的主界面与侧边栏背景，并为临时对话输入框增加琥珀色视觉提示。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const STYLE_ID = 'cg-visual-enhancer-style';
    const TEMPORARY_CHAT_ATTRIBUTE = 'data-cg-temporary-chat';
    const LOCATION_CHANGE_EVENT = 'cg-visual-enhancer-location-change';

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

/* 临时对话：沿用原脚本的琥珀色输入框提示，深浅模式均生效。 */
html[${TEMPORARY_CHAT_ATTRIBUTE}="true"] [data-composer-surface="true"] {
    border: 2px solid rgba(245, 158, 11, 0.75) !important;
    background-color: var(--composer-surface-primary) !important;
    background-color: color-mix(in srgb, var(--composer-surface-primary) 94%, #f59e0b 6%) !important;
    box-shadow:
        0 0 0 1px rgba(245, 158, 11, 0.12),
        0 3px 14px rgba(245, 158, 11, 0.10) !important;
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

    function syncTemporaryChatState() {
        const root = document.documentElement;
        if (!root) {
            return;
        }

        if (isTemporaryChat()) {
            root.setAttribute(TEMPORARY_CHAT_ATTRIBUTE, 'true');
        } else {
            root.removeAttribute(TEMPORARY_CHAT_ATTRIBUTE);
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

    injectStyle();
    syncTemporaryChatState();

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');

    window.addEventListener('popstate', syncTemporaryChatState);
    window.addEventListener(LOCATION_CHANGE_EVENT, syncTemporaryChatState);
})();

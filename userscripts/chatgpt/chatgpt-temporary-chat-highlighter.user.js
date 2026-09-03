// ==UserScript==
// @name         ChatGPT 临时对话高亮助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-temporary-chat-highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-temporary-chat-highlighter.user.js
// @version      0.1.0
// @description  为 ChatGPT 临时对话的输入框增加琥珀色描边、淡色背景和轻微阴影，便于与普通对话区分。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const STYLE_ID = 'cg-temporary-chat-highlighter-style';
    const ACTIVE_ATTRIBUTE = 'data-cg-temporary-chat';
    const LOCATION_CHANGE_EVENT = 'cg-temporary-chat-location-change';

    const css = `
html[${ACTIVE_ATTRIBUTE}="true"] [data-composer-surface="true"] {
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
            root.setAttribute(ACTIVE_ATTRIBUTE, 'true');
        } else {
            root.removeAttribute(ACTIVE_ATTRIBUTE);
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

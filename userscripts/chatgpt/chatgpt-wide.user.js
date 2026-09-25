// ==UserScript==
// @name         ChatGPT宽屏
// @namespace    https://example.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-wide.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-wide.user.js
// @version      1.0.3
// @description  仅保留 KeepChatGPT 的“展开大屏”功能：自动放宽 ChatGPT 对话区和输入区宽度。
// @author       OpenAI
// @match        *://chat.openai.com/
// @match        *://chat.openai.com/*
// @match        *://chatgpt.com/
// @match        *://chatgpt.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STYLE_ID = 'kcg-large-screen-only-style';

    const css = `
@media (min-width: 1024px) {
    /* ChatGPT 2026-09 布局：正文和底部输入区共享 thread content 宽度变量。 */
    [data-app-shell-main-content-layout="thread-edge-scroll"] {
        --thread-content-expanded-max-width: min(90rem, calc(100vw - 8rem)) !important;
        --thread-content-compact-max-width: min(90rem, calc(100vw - 8rem)) !important;
    }

    [data-thread-user-message-navigation-content="true"],
    [data-thread-scroll-footer="true"] > [data-pip-obstacle="thread-footer"] {
        width: 100% !important;
        max-width: min(90rem, calc(100vw - 8rem)) !important;
    }

    form[data-chatgpt-composer] {
        width: 100% !important;
        max-width: 100% !important;
        margin-inline: auto !important;
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

    function boot() {
        injectStyle();
    }

    boot();

    const observer = new MutationObserver(() => {
        injectStyle();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
})();

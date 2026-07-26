// ==UserScript==
// @name         ChatGPT宽屏
// @namespace    https://example.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-wide.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-wide.user.js
// @version      1.0.2
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
    /* 来自 KeepChatGPT“展示大屏”功能的核心逻辑 */
    section.text-token-text-primary > div > div,
    #thread-bottom > div > div > div {
        width: 100% !important;
        max-width: min(90rem, calc(100vw - 8rem)) !important;
    }

    form.w-full {
        max-width: 100% !important;
        margin: auto !important;
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

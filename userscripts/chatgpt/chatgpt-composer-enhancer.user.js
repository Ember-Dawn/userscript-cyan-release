// ==UserScript==
// @name         ChatGPT 输入框增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @version      1.0.4
// @description  增强 ChatGPT 输入框；当前提供 Raw Paste Mode，使不超过 1,500 字符的纯文本粘贴保持原始 Markdown，并保留较长文本及图片/文件粘贴的原生行为。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const COMPOSER_SELECTOR = 'form[data-type="unified-composer"] #prompt-textarea[contenteditable="true"][role="textbox"]';
    const RAW_PASTE_MAX_LENGTH = 1500;

    function getComposer(target) {
        if (!(target instanceof Element)) {
            return null;
        }

        const composer = target.matches(COMPOSER_SELECTOR)
            ? target
            : target.closest(COMPOSER_SELECTOR);

        return composer instanceof HTMLElement ? composer : null;
    }

    function clipboardContainsFiles(clipboardData) {
        if (!clipboardData) {
            return false;
        }

        if (clipboardData.files && clipboardData.files.length > 0) {
            return true;
        }

        return Array.from(clipboardData.items || []).some((item) => item.kind === 'file');
    }

    function insertRawText(text) {
        return document.execCommand('insertText', false, text);
    }

    function handlePaste(event) {
        if (!getComposer(event.target)) {
            return;
        }

        const clipboardData = event.clipboardData;
        if (!clipboardData || clipboardContainsFiles(clipboardData)) {
            return;
        }

        const text = clipboardData.getData('text/plain');
        if (!text || text.length > RAW_PASTE_MAX_LENGTH) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        insertRawText(text);
    }

    document.addEventListener('paste', handlePaste, true);
})();

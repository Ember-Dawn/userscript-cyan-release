// ==UserScript==
// @name         ChatGPT 输入框增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @version      1.0.3
// @description  增强 ChatGPT 输入框；当前提供 Raw Paste Mode，使短文本粘贴的 Markdown 保持原始文本，同时保留原生长文本附件与文件粘贴行为。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const COMPOSER_SELECTOR = 'form[data-type="unified-composer"] #prompt-textarea[contenteditable="true"][role="textbox"]';
    const LARGE_PASTE_ATTACHMENT_THRESHOLD = 10000;

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
        if (!text) {
            return;
        }

        // ChatGPT currently converts pastes longer than 10,000 characters into
        // attachments. Preserve that native path instead of forcing a huge text
        // node into ProseMirror.
        if (text.length > LARGE_PASTE_ATTACHMENT_THRESHOLD) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        insertRawText(text);
    }

    document.addEventListener('paste', handlePaste, true);
})();

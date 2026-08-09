// ==UserScript==
// @name         ChatGPT 输入框增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @version      1.0.0
// @description  增强 ChatGPT 输入框；当前提供 Raw Text Mode，使输入和粘贴的 Markdown 保持原始文本，不自动转换为富文本。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const COMPOSER_SELECTOR = 'form[data-type="unified-composer"] #prompt-textarea[contenteditable="true"][role="textbox"]';
    const RAW_TEXT_TRIGGER_CHARACTERS = new Set([
        ' ', '#', '*', '_', '`', '~', '-', '>', '+', '.', '!', '[', ']', '(', ')', '=',
    ]);

    let syntheticTextInsertionDepth = 0;

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
        syntheticTextInsertionDepth += 1;
        try {
            return document.execCommand('insertText', false, text);
        } finally {
            syntheticTextInsertionDepth -= 1;
        }
    }

    function handleBeforeInput(event) {
        if (!getComposer(event.target)) {
            return;
        }

        if (event.isComposing || event.inputType !== 'insertText' || typeof event.data !== 'string') {
            return;
        }

        if (syntheticTextInsertionDepth > 0) {
            event.stopImmediatePropagation();
            return;
        }

        if (!RAW_TEXT_TRIGGER_CHARACTERS.has(event.data)) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        insertRawText(event.data);
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

        event.preventDefault();
        event.stopImmediatePropagation();
        insertRawText(text);
    }

    document.addEventListener('beforeinput', handleBeforeInput, true);
    document.addEventListener('paste', handlePaste, true);
})();

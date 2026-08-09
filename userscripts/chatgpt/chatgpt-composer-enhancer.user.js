// ==UserScript==
// @name         ChatGPT 输入框增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @version      1.0.1
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

    function containsRawTextTrigger(text) {
        return Array.from(text).some((character) => RAW_TEXT_TRIGGER_CHARACTERS.has(character));
    }

    function handleKeyPress(event) {
        if (!getComposer(event.target) || event.isComposing) {
            return;
        }

        if (typeof event.key !== 'string' || event.key.length !== 1 || !containsRawTextTrigger(event.key)) {
            return;
        }

        // ProseMirror may call handleTextInput from keypress before the browser
        // applies the character. Stop that editor-level path, but deliberately
        // keep the browser default action so the raw character is inserted.
        event.stopImmediatePropagation();
    }

    function handleBeforeInput(event) {
        if (!getComposer(event.target)) {
            return;
        }

        if (event.isComposing || event.inputType !== 'insertText' || typeof event.data !== 'string') {
            return;
        }

        if (!containsRawTextTrigger(event.data)) {
            return;
        }

        // Do not preventDefault here. The browser should perform the native
        // insertion, while ProseMirror's text-input hooks do not see this event.
        event.stopImmediatePropagation();
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

    document.addEventListener('keypress', handleKeyPress, true);
    document.addEventListener('beforeinput', handleBeforeInput, true);
    document.addEventListener('paste', handlePaste, true);
})();

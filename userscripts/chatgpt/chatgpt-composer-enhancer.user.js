// ==UserScript==
// @name         ChatGPT 输入框增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @version      1.0.2
// @description  增强 ChatGPT 输入框；当前提供 Raw Text Mode，使短文本输入和粘贴的 Markdown 保持原始文本，同时保留原生长文本附件与文件粘贴行为。
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

    function isPlainCharacterInput(event) {
        return typeof event.key === 'string'
            && event.key.length === 1
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey;
    }

    function shouldIsolateKeyEvent(event) {
        return getComposer(event.target)
            && !event.isComposing
            && isPlainCharacterInput(event)
            && containsRawTextTrigger(event.key);
    }

    function handleKeyDown(event) {
        if (!shouldIsolateKeyEvent(event)) {
            return;
        }

        // Current ChatGPT composer can run Markdown transformations directly
        // from keydown (notably when Space completes a Markdown pattern).
        // Stop editor-level handlers from seeing the event, but deliberately
        // keep the browser default action so the literal character is inserted.
        event.stopImmediatePropagation();
    }

    function handleKeyPress(event) {
        if (!shouldIsolateKeyEvent(event)) {
            return;
        }

        // Keep this as a compatibility layer for ProseMirror/browser paths that
        // still route direct text input through keypress.
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

        // ChatGPT currently converts pastes longer than 10,000 characters into
        // attachments. Preserve that native path instead of forcing a huge text
        // node into ProseMirror, which can make the composer unresponsive.
        if (text.length > LARGE_PASTE_ATTACHMENT_THRESHOLD) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        insertRawText(text);
    }

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keypress', handleKeyPress, true);
    document.addEventListener('beforeinput', handleBeforeInput, true);
    document.addEventListener('paste', handlePaste, true);
})();

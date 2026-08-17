// ==UserScript==
// @name         ChatGPT 输入框增强助手
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-composer-enhancer.user.js
// @version      2.0.0
// @description  修复 ChatGPT 输入框在原生粘贴文本后立即按 Enter 时，发送操作可能因粘贴处理尚未稳定而被忽略的问题。
// @author       Penghao
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const COMPOSER_SELECTOR = 'form[data-type="unified-composer"] #prompt-textarea[contenteditable="true"][role="textbox"]';
    const FORM_SELECTOR = 'form[data-type="unified-composer"]';
    const SEND_BUTTON_SELECTOR = '#composer-submit-button, [data-testid="send-button"]';

    const ENTER_CAPTURE_WINDOW_MS = 1000;
    const SETTLE_QUIET_MS = 250;
    const MIN_DEFER_AFTER_ENTER_MS = 120;
    const MAX_PENDING_SEND_MS = 10000;

    let pasteSession = null;

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

    function isPlainSendEnter(event) {
        return event.key === 'Enter'
            && !event.shiftKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && !event.isComposing;
    }

    function clearPasteSession() {
        if (!pasteSession) {
            return;
        }

        pasteSession.observer.disconnect();
        window.clearTimeout(pasteSession.captureTimer);
        window.clearTimeout(pasteSession.settleTimer);
        window.clearTimeout(pasteSession.pendingTimer);
        pasteSession = null;
    }

    function getSendButton(session) {
        const button = session.form.querySelector(SEND_BUTTON_SELECTOR);
        if (!(button instanceof HTMLButtonElement)) {
            return null;
        }

        if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
            return null;
        }

        return button;
    }

    function flushPendingSend(session) {
        if (pasteSession !== session || !session.pendingSend) {
            return;
        }

        const now = performance.now();
        const quietFor = now - session.lastMutationAt;
        const deferredFor = now - session.enteredAt;

        if (quietFor < SETTLE_QUIET_MS || deferredFor < MIN_DEFER_AFTER_ENTER_MS) {
            schedulePendingSend(session);
            return;
        }

        const button = getSendButton(session);
        if (!button) {
            return;
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (pasteSession !== session || !session.pendingSend) {
                    return;
                }

                const settledFor = performance.now() - session.lastMutationAt;
                const currentButton = getSendButton(session);
                if (settledFor < SETTLE_QUIET_MS || !currentButton) {
                    schedulePendingSend(session);
                    return;
                }

                clearPasteSession();
                currentButton.click();
            });
        });
    }

    function schedulePendingSend(session) {
        if (pasteSession !== session || !session.pendingSend) {
            return;
        }

        window.clearTimeout(session.settleTimer);

        const now = performance.now();
        const quietRemaining = Math.max(0, SETTLE_QUIET_MS - (now - session.lastMutationAt));
        const deferRemaining = Math.max(0, MIN_DEFER_AFTER_ENTER_MS - (now - session.enteredAt));
        const delay = Math.max(quietRemaining, deferRemaining);

        session.settleTimer = window.setTimeout(() => flushPendingSend(session), delay);
    }

    function startPasteSession(composer) {
        clearPasteSession();

        const form = composer.closest(FORM_SELECTOR);
        if (!(form instanceof HTMLFormElement)) {
            return;
        }

        const startedAt = performance.now();
        const session = {
            composer,
            form,
            startedAt,
            enteredAt: 0,
            lastMutationAt: startedAt,
            pendingSend: false,
            observer: null,
            captureTimer: 0,
            settleTimer: 0,
            pendingTimer: 0,
        };

        session.observer = new MutationObserver(() => {
            if (pasteSession !== session) {
                return;
            }

            session.lastMutationAt = performance.now();
            if (session.pendingSend) {
                schedulePendingSend(session);
            }
        });

        session.observer.observe(form, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['disabled', 'aria-disabled'],
        });

        session.captureTimer = window.setTimeout(() => {
            if (pasteSession === session && !session.pendingSend) {
                clearPasteSession();
            }
        }, ENTER_CAPTURE_WINDOW_MS);

        pasteSession = session;
    }

    function handlePaste(event) {
        const composer = getComposer(event.target);
        if (!composer) {
            return;
        }

        const clipboardData = event.clipboardData;
        if (!clipboardData || clipboardContainsFiles(clipboardData)) {
            clearPasteSession();
            return;
        }

        const text = clipboardData.getData('text/plain');
        if (!text) {
            clearPasteSession();
            return;
        }

        startPasteSession(composer);
    }

    function handleKeyDown(event) {
        const session = pasteSession;
        if (!session) {
            return;
        }

        if (event.key === 'Escape') {
            clearPasteSession();
            return;
        }

        const composer = getComposer(event.target);
        if (composer !== session.composer) {
            return;
        }

        if (event.key !== 'Enter') {
            if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
                clearPasteSession();
            }
            return;
        }

        if (!isPlainSendEnter(event)) {
            clearPasteSession();
            return;
        }

        if (!session.pendingSend && performance.now() - session.startedAt > ENTER_CAPTURE_WINDOW_MS) {
            clearPasteSession();
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        if (session.pendingSend || event.repeat) {
            return;
        }

        session.pendingSend = true;
        session.enteredAt = performance.now();
        window.clearTimeout(session.captureTimer);

        session.pendingTimer = window.setTimeout(() => {
            if (pasteSession === session) {
                clearPasteSession();
            }
        }, MAX_PENDING_SEND_MS);

        schedulePendingSend(session);
    }

    function handlePointerDown(event) {
        const session = pasteSession;
        if (!session || !session.pendingSend) {
            return;
        }

        if (!(event.target instanceof Node) || !session.form.contains(event.target)) {
            clearPasteSession();
        }
    }

    document.addEventListener('paste', handlePaste, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pagehide', clearPasteSession);
})();

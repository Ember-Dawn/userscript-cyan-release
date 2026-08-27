// ==UserScript==
// @name         solidtime 计时器焦点修正
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @version      0.2.0
// @description  阻止 solidtime 点击 Start 后自动聚焦 Description，避免弹出历史记录；PC 和手机通用，手动点击 Description 仍保持原有行为。
// @author       Ember-Dawn
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/solidtime/solidtime-focus-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/solidtime/solidtime-focus-fix.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const TIMER_BUTTON_SELECTOR = '[data-testid="timer_button"]';
    const DESCRIPTION_SELECTOR = '[data-testid="time_entry_description"]';
    const FOCUS_GUARD_MS = 500;

    let timerButtonPressedAt = 0;

    function blurDescriptionIfAutoFocused() {
        const descriptionInput = document.querySelector(DESCRIPTION_SELECTOR);
        if (descriptionInput instanceof HTMLElement && document.activeElement === descriptionInput) {
            descriptionInput.blur();
        }
    }

    document.addEventListener(
        'click',
        (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const timerButton = target.closest(TIMER_BUTTON_SELECTOR);
            if (!timerButton) return;

            timerButtonPressedAt = performance.now();

            // solidtime 当前会在 Start 的点击处理过程中主动 focus Description。
            // 分别在微任务、下一帧和短延时后检查，可覆盖同步及轻微延迟的自动聚焦。
            queueMicrotask(blurDescriptionIfAutoFocused);
            requestAnimationFrame(blurDescriptionIfAutoFocused);
            setTimeout(blurDescriptionIfAutoFocused, 50);
            setTimeout(blurDescriptionIfAutoFocused, 150);
        },
        true
    );

    document.addEventListener(
        'focusin',
        (event) => {
            if (performance.now() - timerButtonPressedAt > FOCUS_GUARD_MS) return;

            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (!target.matches(DESCRIPTION_SELECTOR)) return;

            target.blur();
        },
        true
    );
})();

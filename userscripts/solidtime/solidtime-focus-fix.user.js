// ==UserScript==
// @name         solidtime 计时器焦点修正
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @version      0.3.0
// @description  修正 solidtime 的自动聚焦行为：点击 Start 后不自动聚焦 Description，打开 Project 后不自动聚焦搜索框；PC 和手机通用，手动点击输入框仍保持原有行为。
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
    const PROJECT_SEARCH_SELECTOR = '[data-testid="client_dropdown_search"]';
    const FOCUS_GUARD_MS = 500;
    const MANUAL_PROJECT_SEARCH_GUARD_MS = 800;

    let timerButtonPressedAt = 0;
    let projectSearchManualInteractionAt = 0;

    function blurDescriptionIfAutoFocused() {
        const descriptionInput = document.querySelector(DESCRIPTION_SELECTOR);
        if (descriptionInput instanceof HTMLElement && document.activeElement === descriptionInput) {
            descriptionInput.blur();
        }
    }

    function markManualProjectSearchInteraction(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.matches(PROJECT_SEARCH_SELECTOR)) return;

        projectSearchManualInteractionAt = performance.now();
    }

    // 真实点击/触摸搜索框会先触发这些事件，再触发 focus。
    // 记录该交互后，后续 focusin 会被视为用户主动聚焦而放行。
    document.addEventListener('pointerdown', markManualProjectSearchInteraction, true);
    document.addEventListener('mousedown', markManualProjectSearchInteraction, true);
    document.addEventListener('touchstart', markManualProjectSearchInteraction, true);

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
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (
                target.matches(DESCRIPTION_SELECTOR) &&
                performance.now() - timerButtonPressedAt <= FOCUS_GUARD_MS
            ) {
                target.blur();
                return;
            }

            if (!target.matches(PROJECT_SEARCH_SELECTOR)) return;

            const isManualProjectSearchFocus =
                performance.now() - projectSearchManualInteractionAt <=
                MANUAL_PROJECT_SEARCH_GUARD_MS;

            if (!isManualProjectSearchFocus) {
                target.blur();
            }
        },
        true
    );
})();

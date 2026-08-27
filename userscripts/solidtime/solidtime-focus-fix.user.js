// ==UserScript==
// @name         solidtime 计时器焦点修正
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @version      0.4.0
// @description  优化 solidtime 的计时器与 Project 交互：阻止自动聚焦输入框，并将 Project 按中英混合名称自然升序排列；PC 和手机通用。
// @author       Ember-Dawn
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/solidtime/solidtime-focus-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/solidtime/solidtime-focus-fix.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const TIMER_BUTTON_SELECTOR = '[data-testid="timer_button"]';
    const DESCRIPTION_SELECTOR = '[data-testid="time_entry_description"]';
    const PROJECT_SEARCH_SELECTOR = '[data-testid="client_dropdown_search"]';
    const PROJECT_INDEX_PATH_RE = /\/api\/v1\/organizations\/[^/]+\/projects\/?$/;
    const FOCUS_GUARD_MS = 500;
    const MANUAL_PROJECT_SEARCH_GUARD_MS = 800;

    const projectNameCollator = new Intl.Collator(['zh-CN-u-co-pinyin', 'en'], {
        usage: 'sort',
        sensitivity: 'base',
        numeric: true,
    });

    let timerButtonPressedAt = 0;
    let projectSearchManualInteractionAt = 0;

    function getRequestUrl(input) {
        if (typeof input === 'string') return new URL(input, location.href);
        if (input instanceof URL) return new URL(input.href);
        if (input instanceof Request) return new URL(input.url);
        return null;
    }

    function getRequestMethod(input, init) {
        if (init?.method) return String(init.method).toUpperCase();
        if (input instanceof Request) return input.method.toUpperCase();
        return 'GET';
    }

    function isProjectIndexRequest(input, init) {
        if (getRequestMethod(input, init) !== 'GET') return false;

        const url = getRequestUrl(input);
        if (!url || url.origin !== location.origin) return false;
        if (!PROJECT_INDEX_PATH_RE.test(url.pathname)) return false;

        return url.searchParams.get('archived') === 'all';
    }

    function compareProjectsByName(a, b) {
        const nameA = typeof a?.name === 'string' ? a.name : '';
        const nameB = typeof b?.name === 'string' ? b.name : '';
        const nameResult = projectNameCollator.compare(nameA, nameB);
        if (nameResult !== 0) return nameResult;

        return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
    }

    function buildPageRequest(input, init, page) {
        const url = getRequestUrl(input);
        if (!url) return null;
        url.searchParams.set('page', String(page));

        if (input instanceof Request) {
            return new Request(url.href, {
                method: input.method,
                headers: input.headers,
                credentials: input.credentials,
                cache: input.cache,
                redirect: input.redirect,
                referrer: input.referrer,
                referrerPolicy: input.referrerPolicy,
                integrity: input.integrity,
                keepalive: input.keepalive,
                mode: input.mode,
                signal: input.signal,
            });
        }

        return [url.href, init];
    }

    function createJsonResponse(originalResponse, payload) {
        const headers = new Headers(originalResponse.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        headers.delete('transfer-encoding');
        if (!headers.has('content-type')) {
            headers.set('content-type', 'application/json');
        }

        return new Response(JSON.stringify(payload), {
            status: originalResponse.status,
            statusText: originalResponse.statusText,
            headers,
        });
    }

    function installProjectSortFetchProxy() {
        if (typeof window.fetch !== 'function') return;

        const nativeFetch = window.fetch.bind(window);

        window.fetch = async function (input, init) {
            if (!isProjectIndexRequest(input, init)) {
                return nativeFetch(input, init);
            }

            const requestUrl = getRequestUrl(input);
            if (!requestUrl || Number(requestUrl.searchParams.get('page') || '1') !== 1) {
                return nativeFetch(input, init);
            }

            const firstResponse = await nativeFetch(input, init);
            if (!firstResponse.ok) return firstResponse;

            let firstPayload;
            try {
                firstPayload = await firstResponse.clone().json();
            } catch {
                return firstResponse;
            }

            if (!Array.isArray(firstPayload?.data) || !firstPayload?.meta) {
                return firstResponse;
            }

            const lastPage = Number(firstPayload.meta.last_page) || 1;
            const allProjects = [...firstPayload.data];

            try {
                for (let page = 2; page <= lastPage; page += 1) {
                    const pageRequest = buildPageRequest(input, init, page);
                    if (!pageRequest) return firstResponse;

                    const pageResponse = Array.isArray(pageRequest)
                        ? await nativeFetch(pageRequest[0], pageRequest[1])
                        : await nativeFetch(pageRequest);

                    if (!pageResponse.ok) return firstResponse;

                    const pagePayload = await pageResponse.json();
                    if (!Array.isArray(pagePayload?.data)) return firstResponse;
                    allProjects.push(...pagePayload.data);
                }
            } catch {
                return firstResponse;
            }

            allProjects.sort(compareProjectsByName);

            const payload = {
                ...firstPayload,
                data: allProjects,
                meta: {
                    ...firstPayload.meta,
                    current_page: 1,
                    from: allProjects.length > 0 ? 1 : null,
                    last_page: 1,
                    per_page: allProjects.length,
                    to: allProjects.length > 0 ? allProjects.length : null,
                    total: allProjects.length,
                },
                links: firstPayload.links
                    ? {
                          ...firstPayload.links,
                          first: null,
                          last: null,
                          prev: null,
                          next: null,
                      }
                    : firstPayload.links,
            };

            return createJsonResponse(firstResponse, payload);
        };
    }

    installProjectSortFetchProxy();

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

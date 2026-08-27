// ==UserScript==
// @name         solidtime 计时器焦点修正
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @version      0.5.0
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

    const xhrState = new WeakMap();
    const nativeXhrOpen = XMLHttpRequest.prototype.open;
    const nativeXhrSend = XMLHttpRequest.prototype.send;
    const nativeXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    let timerButtonPressedAt = 0;
    let projectSearchManualInteractionAt = 0;

    function getUrl(url) {
        try {
            return new URL(String(url), location.href);
        } catch {
            return null;
        }
    }

    function isProjectIndexUrl(url, method = 'GET') {
        if (String(method).toUpperCase() !== 'GET') return false;
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

    function buildSortedProjectPayload(firstPayload, allProjects) {
        const sortedProjects = [...allProjects].sort(compareProjectsByName);

        return {
            ...firstPayload,
            data: sortedProjects,
            meta: {
                ...firstPayload.meta,
                current_page: 1,
                from: sortedProjects.length > 0 ? 1 : null,
                last_page: 1,
                per_page: sortedProjects.length,
                to: sortedProjects.length > 0 ? sortedProjects.length : null,
                total: sortedProjects.length,
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
    }

    function fetchProjectPageWithNativeXhr(baseUrl, page, state, sourceXhr) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const pageUrl = new URL(baseUrl.href);
            pageUrl.searchParams.set('page', String(page));

            nativeXhrOpen.call(xhr, 'GET', pageUrl.href, true);

            for (const [name, value] of state.headers) {
                try {
                    nativeXhrSetRequestHeader.call(xhr, name, value);
                } catch {
                    // 某些由浏览器管理的请求头不能手动设置，忽略即可。
                }
            }

            xhr.withCredentials = sourceXhr.withCredentials;
            xhr.timeout = sourceXhr.timeout;

            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new Error(`Project page ${page} returned ${xhr.status}`));
                    return;
                }

                try {
                    const payload = JSON.parse(xhr.responseText);
                    if (!Array.isArray(payload?.data)) {
                        reject(new Error(`Project page ${page} has invalid data`));
                        return;
                    }
                    resolve(payload);
                } catch (error) {
                    reject(error);
                }
            };
            xhr.onerror = () => reject(new Error(`Project page ${page} failed`));
            xhr.ontimeout = () => reject(new Error(`Project page ${page} timed out`));
            xhr.onabort = () => reject(new Error(`Project page ${page} was aborted`));

            nativeXhrSend.call(xhr, null);
        });
    }

    function overrideXhrJsonResponse(xhr, payload) {
        const text = JSON.stringify(payload);

        try {
            Object.defineProperty(xhr, 'responseText', {
                configurable: true,
                get: () => text,
            });
        } catch {
            return false;
        }

        if (!xhr.responseType || xhr.responseType === 'text') {
            try {
                Object.defineProperty(xhr, 'response', {
                    configurable: true,
                    get: () => text,
                });
            } catch {
                // Axios 默认读取 responseText；response 无法覆盖时不影响主路径。
            }
        } else if (xhr.responseType === 'json') {
            try {
                Object.defineProperty(xhr, 'response', {
                    configurable: true,
                    get: () => payload,
                });
            } catch {
                // responseText 已成功覆盖，保留兼容降级。
            }
        }

        return true;
    }

    function installProjectSortXhrProxy() {
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            const parsedUrl = getUrl(url);
            xhrState.set(this, {
                method: String(method).toUpperCase(),
                url: parsedUrl,
                headers: [],
            });
            return nativeXhrOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            const state = xhrState.get(this);
            if (state) state.headers.push([name, value]);
            return nativeXhrSetRequestHeader.call(this, name, value);
        };

        XMLHttpRequest.prototype.send = function (...args) {
            const state = xhrState.get(this);
            const requestUrl = state?.url;
            const page = Number(requestUrl?.searchParams.get('page') || '1');

            if (!state || !isProjectIndexUrl(requestUrl, state.method) || page !== 1) {
                return nativeXhrSend.apply(this, args);
            }

            const xhr = this;
            const originalOnloadend = xhr.onloadend;

            xhr.onloadend = async function (event) {
                xhr.onloadend = originalOnloadend;

                if (xhr.status < 200 || xhr.status >= 300) {
                    originalOnloadend?.call(xhr, event);
                    return;
                }

                let firstPayload;
                try {
                    firstPayload = JSON.parse(xhr.responseText);
                } catch {
                    originalOnloadend?.call(xhr, event);
                    return;
                }

                if (!Array.isArray(firstPayload?.data) || !firstPayload?.meta) {
                    originalOnloadend?.call(xhr, event);
                    return;
                }

                const lastPage = Number(firstPayload.meta.last_page) || 1;
                const allProjects = [...firstPayload.data];

                try {
                    for (let nextPage = 2; nextPage <= lastPage; nextPage += 1) {
                        const pagePayload = await fetchProjectPageWithNativeXhr(
                            requestUrl,
                            nextPage,
                            state,
                            xhr
                        );
                        allProjects.push(...pagePayload.data);
                    }

                    const sortedPayload = buildSortedProjectPayload(firstPayload, allProjects);
                    overrideXhrJsonResponse(xhr, sortedPayload);
                } catch {
                    // 任何额外分页或响应覆盖失败时，保持 solidtime 原始响应，不阻断正常使用。
                }

                originalOnloadend?.call(xhr, event);
            };

            return nativeXhrSend.apply(xhr, args);
        };
    }

    installProjectSortXhrProxy();

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

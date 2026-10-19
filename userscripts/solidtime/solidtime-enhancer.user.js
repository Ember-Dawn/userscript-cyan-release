// ==UserScript==
// @name         solidtime 交互增强助手
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @version      0.8.4
// @description  优化 solidtime 的计时器与 Project/Task 交互：阻止非必要自动聚焦，并将 Project 和 Task 按中英混合名称自然升序排列；PC 和手机通用。
// @author       Ember-Dawn
// @match        https://solidtime.380782744.xyz/*
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/solidtime/solidtime-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/solidtime/solidtime-enhancer.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // 只调整窄屏下 Time Tracker 的布局，不移动 Vue 节点或改动数据交互。
    function installMobileTrackerLayout() {
        const style = document.createElement('style');
        style.id = 'solidtime-enhancer-mobile-tracker-layout';
        style.textContent = `
            @media (max-width: 640px) {
                /* 仅在普通 Project 模式下应用，不影响 break/simple 模式。 */
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2):has(> div:first-child[class*="w-[130px]"]) {
                    display: grid !important;
                    grid-template-columns: minmax(0, 1fr) auto;
                    align-items: center;
                    column-gap: 0;
                    row-gap: 4px;
                    padding: 4px 8px 6px;
                }
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2):has(> div:first-child[class*="w-[130px]"]) > div:first-child {
                    grid-column: 1 / -1;
                    grid-row: 2;
                    width: 100% !important;
                    min-width: 0;
                    max-width: 100%;
                }
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2):has(> div:first-child[class*="w-[130px]"]) > div:nth-child(2) {
                    grid-column: 1;
                    grid-row: 1;
                    min-width: 0;
                    padding-left: 0;
                }
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2):has(> div:first-child[class*="w-[130px]"]) > div:nth-child(3) {
                    grid-column: 2;
                    grid-row: 1;
                    justify-self: end;
                    min-width: 0;
                }
                /* 原生 trigger 仍保留点击与下拉行为，文字按自然流换行，最多两行高度。 */
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2) > div:first-child button {
                    width: 100%;
                    min-height: 32px;
                    height: auto !important;
                    max-height: 56px;
                    display: block !important;
                    text-align: left;
                    white-space: normal !important;
                    overflow: hidden;
                    line-height: 20px;
                }
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2) > div:first-child button > span.truncate {
                    display: inline !important;
                    white-space: normal !important;
                    overflow: visible !important;
                    text-overflow: clip !important;
                    overflow-wrap: anywhere;
                }
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2) > div:first-child button > div,
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2) > div:first-child button > svg {
                    display: inline-block !important;
                    vertical-align: middle;
                }
                /* 仅高亮目标 Project 下的目标 Task；不影响弹层或 PC。 */
                [data-testid="dashboard_timer"] button > span.solidtime-enhancer-cooking-task {
                    color: #FACC15 !important;
                }
                /* 仅对已确认所属 Project 的下拉 Task 名称着色。 */
                [data-task-id] > span.solidtime-enhancer-cooking-dropdown-task {
                    color: #FACC15 !important;
                }
                /* 给圆点、Project、分隔箭头、Task 留出清晰但紧凑的间距。 */
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2) > div:first-child button > div:first-child {
                    margin-right: 6px !important;
                }
                [data-testid="dashboard_timer"] > div:first-child > div:nth-child(2) > div:first-child button > svg {
                    margin-left: 4px !important;
                    margin-right: 4px !important;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    if (document.documentElement) {
        installMobileTrackerLayout();
    } else {
        document.addEventListener('DOMContentLoaded', installMobileTrackerLayout, { once: true });
    }

    // 只识别顶部计时器已选中的 Project / Task，不改动其他同名任务。
    // 原生 trigger 的直接子元素顺序：颜色圆点、Project span、箭头、Task span、可选 Client。
    function updateMobileCookingTaskHighlight() {
        const root = document.querySelector('[data-testid="dashboard_timer"]');
        if (!root) return;

        const buttons = root.querySelectorAll('button');
        for (const button of buttons) {
            const children = Array.from(button.children);
            const projectText = children[1];
            const separator = children[2];
            const taskText = children[3];
            if (
                children[0]?.tagName !== 'DIV' ||
                projectText?.tagName !== 'SPAN' ||
                separator?.tagName?.toLowerCase() !== 'svg' ||
                taskText?.tagName !== 'SPAN'
            ) continue;

            const shouldHighlight =
                projectText.textContent.trim() === '01生活' &&
                taskText.textContent.trim() === '06做饭';
            taskText.classList.toggle('solidtime-enhancer-cooking-task', shouldHighlight);
        }
    }

    // 下拉菜单是虚拟列表，只根据当前可见的 Project 分组识别 Task。
    // 如果对应 Project 标题不在已挂载的窗口中，宁可不着色，避免错误标记同名任务。
    function updateMobileCookingDropdownHighlight() {
        const searchInputs = document.querySelectorAll('[data-testid="client_dropdown_search"]');
        for (const searchInput of searchInputs) {
            const panel = searchInput.parentElement;
            if (!panel) continue;
            const rows = panel.querySelectorAll('[data-project-id], [data-task-id]');
            let activeProject = null;
            for (const row of rows) {
                if (row.hasAttribute('data-project-id')) {
                    activeProject = row.querySelector('span.truncate')?.textContent?.trim() ?? null;
                    continue;
                }
                const taskText = row.querySelector(':scope > span.truncate');
                if (!taskText) continue;
                taskText.classList.toggle(
                    'solidtime-enhancer-cooking-dropdown-task',
                    activeProject === '01生活' && taskText.textContent.trim() === '06做饭'
                );
            }
        }
    }

    // Vue 更新选中项、打开菜单及虚拟行变动时，复用现有观察者。
    // 仅监听节点/文本变化，
    // 不监听属性，从而不会因自身添加 CSS class 触发循环。
    let cookingHighlightScheduled = false;
    function scheduleMobileCookingTaskHighlight() {
        if (cookingHighlightScheduled) return;
        cookingHighlightScheduled = true;
        requestAnimationFrame(() => {
            cookingHighlightScheduled = false;
            updateMobileCookingTaskHighlight();
            updateMobileCookingDropdownHighlight();
        });
    }

    function installMobileCookingTaskHighlight() {
        if (!document.body) return;
        const observer = new MutationObserver(scheduleMobileCookingTaskHighlight);
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
        scheduleMobileCookingTaskHighlight();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installMobileCookingTaskHighlight, { once: true });
    } else {
        installMobileCookingTaskHighlight();
    }

    const TIMER_BUTTON_SELECTOR = '[data-testid="timer_button"]';
    const DESCRIPTION_SELECTOR = '[data-testid="time_entry_description"]';
    const PROJECT_SEARCH_SELECTOR = '[data-testid="client_dropdown_search"]';
    const FOCUS_GUARD_MS = 500;
    const MANUAL_PROJECT_SEARCH_GUARD_MS = 800;

    const SORTABLE_INDEX_CONFIGS = [
        {
            pathPattern: /\/api\/v1\/organizations\/[^/]+\/projects\/?$/,
            requiredParam: ['archived', 'all'],
            label: 'Project',
        },
        {
            pathPattern: /\/api\/v1\/organizations\/[^/]+\/tasks\/?$/,
            requiredParam: ['done', 'all'],
            label: 'Task',
        },
    ];

    const itemNameCollator = new Intl.Collator(['zh-CN-u-co-pinyin', 'en'], {
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

    function getSortableIndexConfig(url, method = 'GET') {
        if (String(method).toUpperCase() !== 'GET') return null;
        if (!url || url.origin !== location.origin) return null;

        return (
            SORTABLE_INDEX_CONFIGS.find((config) => {
                if (!config.pathPattern.test(url.pathname)) return false;
                const [paramName, paramValue] = config.requiredParam;
                return url.searchParams.get(paramName) === paramValue;
            }) ?? null
        );
    }

    function compareItemsByName(a, b) {
        const nameA = typeof a?.name === 'string' ? a.name : '';
        const nameB = typeof b?.name === 'string' ? b.name : '';
        const nameResult = itemNameCollator.compare(nameA, nameB);
        if (nameResult !== 0) return nameResult;

        return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
    }

    function buildSortedPayload(firstPayload, allItems) {
        const sortedItems = [...allItems].sort(compareItemsByName);

        return {
            ...firstPayload,
            data: sortedItems,
            meta: {
                ...firstPayload.meta,
                current_page: 1,
                from: sortedItems.length > 0 ? 1 : null,
                last_page: 1,
                per_page: sortedItems.length,
                to: sortedItems.length > 0 ? sortedItems.length : null,
                total: sortedItems.length,
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

    function fetchPageWithNativeXhr(baseUrl, page, state, sourceXhr, label) {
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
                    reject(new Error(`${label} page ${page} returned ${xhr.status}`));
                    return;
                }

                try {
                    const payload = JSON.parse(xhr.responseText);
                    if (!Array.isArray(payload?.data)) {
                        reject(new Error(`${label} page ${page} has invalid data`));
                        return;
                    }
                    resolve(payload);
                } catch (error) {
                    reject(error);
                }
            };
            xhr.onerror = () => reject(new Error(`${label} page ${page} failed`));
            xhr.ontimeout = () => reject(new Error(`${label} page ${page} timed out`));
            xhr.onabort = () => reject(new Error(`${label} page ${page} was aborted`));

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

    function installNaturalSortXhrProxy() {
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
            const sortConfig = state ? getSortableIndexConfig(requestUrl, state.method) : null;

            if (!state || !sortConfig || page !== 1) {
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
                const allItems = [...firstPayload.data];

                try {
                    for (let nextPage = 2; nextPage <= lastPage; nextPage += 1) {
                        const pagePayload = await fetchPageWithNativeXhr(
                            requestUrl,
                            nextPage,
                            state,
                            xhr,
                            sortConfig.label
                        );
                        allItems.push(...pagePayload.data);
                    }

                    const sortedPayload = buildSortedPayload(firstPayload, allItems);
                    overrideXhrJsonResponse(xhr, sortedPayload);
                } catch {
                    // 任何额外分页或响应覆盖失败时，保持 solidtime 原始响应，不阻断正常使用。
                }

                originalOnloadend?.call(xhr, event);
            };

            return nativeXhrSend.apply(xhr, args);
        };
    }

    installNaturalSortXhrProxy();

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

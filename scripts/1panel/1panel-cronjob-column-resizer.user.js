// ==UserScript==
// @name         1Panel 计划任务名称列宽调整
// @namespace    https://github.com/Ember-Dawn/userscript-cyan
// @version      1.0.1
// @description  为 1Panel 计划任务表格增加名称列拖动调整，并通过压缩其他列保持表格总宽度基本不变。
// @author       Ember-Dawn
// @match        https://1panel.380782744.xyz/*
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/1panel/1panel-cronjob-column-resizer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/1panel/1panel-cronjob-column-resizer.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 修改存储键版本，使升级到 1.0.1 后自动采用新的默认列宽。
    const STORAGE_KEY = 'userscript-cyan:1panel-cronjob-column-widths:v2';
    const DEFAULT_NAME_WIDTH = 280;
    const MIN_NAME_WIDTH = 120;
    const MAX_NAME_WIDTH = 460;

    const DEFAULT_COMPACT_WIDTHS = {
        保留份数: 70,
        备份账号: 70,
    };

    const COLUMN_MIN_WIDTHS = {
        分组: 60,
        状态: 80,
        执行周期: 90,
        保留份数: 56,
        上次执行情况: 100,
        备份账号: 56,
        操作: 150,
    };

    let scheduledTimer = 0;

    function isTargetPage() {
        return location.pathname.includes('/cronjobs/cronjob');
    }

    function getTableRoots() {
        return [...document.querySelectorAll('.complex-table .el-table')];
    }

    function getHeaders(tableRoot) {
        return [...tableRoot.querySelectorAll('.el-table__header-wrapper thead th')];
    }

    function getHeaderText(header) {
        return header?.querySelector('.cell')?.textContent?.trim() || '';
    }

    function findColumnIndex(tableRoot, label) {
        return getHeaders(tableRoot).findIndex((header) => getHeaderText(header).startsWith(label));
    }

    function getColumnElements(tableRoot, columnIndex) {
        const selector = `colgroup col:nth-child(${columnIndex + 1})`;
        return [
            ...tableRoot.querySelectorAll(
                `.el-table__header-wrapper ${selector}, .el-table__body-wrapper ${selector}`
            ),
        ];
    }

    function readColumnWidth(tableRoot, columnIndex, fallback = 120) {
        const col = getColumnElements(tableRoot, columnIndex)[0];
        if (!col) return fallback;

        const width = Number.parseFloat(col.getAttribute('width'));
        if (Number.isFinite(width) && width > 0) return width;

        const rectWidth = col.getBoundingClientRect().width;
        return rectWidth > 0 ? rectWidth : fallback;
    }

    function setColumnWidth(tableRoot, columnIndex, width) {
        const roundedWidth = Math.max(1, Math.round(width));

        for (const col of getColumnElements(tableRoot, columnIndex)) {
            col.setAttribute('width', String(roundedWidth));
            col.style.width = `${roundedWidth}px`;
            col.style.minWidth = `${roundedWidth}px`;
            col.style.maxWidth = `${roundedWidth}px`;
        }

        const cells = tableRoot.querySelectorAll(`tr > *:nth-child(${columnIndex + 1}) .cell`);
        for (const cell of cells) {
            cell.style.width = `${Math.max(20, roundedWidth - 2)}px`;
            cell.style.maxWidth = `${Math.max(20, roundedWidth - 2)}px`;
        }
    }

    function getColumnState(tableRoot) {
        const state = {};
        for (const header of getHeaders(tableRoot)) {
            const label = getHeaderText(header);
            const index = findColumnIndex(tableRoot, label);
            if (label && index >= 0) state[label] = readColumnWidth(tableRoot, index);
        }
        return state;
    }

    function applyColumnState(tableRoot, state) {
        for (const [label, width] of Object.entries(state)) {
            const index = findColumnIndex(tableRoot, label);
            if (index >= 0 && Number.isFinite(width)) setColumnWidth(tableRoot, index, width);
        }
    }

    function loadSavedState() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            console.warn('[1Panel 列宽调整] 读取保存设置失败：', error);
            return null;
        }
    }

    function saveState(tableRoot) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getColumnState(tableRoot)));
    }

    function redistributeWidth(state, nameDelta) {
        const result = { ...state };
        let remaining = nameDelta;

        const donorLabels = ['备份账号', '保留份数', '分组', '执行周期', '上次执行情况', '操作', '状态'];

        if (remaining > 0) {
            for (const label of donorLabels) {
                if (remaining <= 0) break;
                if (!Number.isFinite(result[label])) continue;

                const minimum = COLUMN_MIN_WIDTHS[label] ?? 60;
                const available = Math.max(0, result[label] - minimum);
                const taken = Math.min(available, remaining);
                result[label] -= taken;
                remaining -= taken;
            }
        } else if (remaining < 0) {
            const released = -remaining;
            const primaryReceiver = donorLabels.find((label) => Number.isFinite(result[label]));
            if (primaryReceiver) result[primaryReceiver] += released;
            remaining = 0;
        }

        const appliedDelta = nameDelta - remaining;
        result['任务名称'] = state['任务名称'] + appliedDelta;
        return result;
    }

    function buildDefaultState(current) {
        const compacted = { ...current };
        let releasedWidth = 0;

        for (const [label, targetWidth] of Object.entries(DEFAULT_COMPACT_WIDTHS)) {
            if (!Number.isFinite(compacted[label])) continue;

            const newWidth = Math.min(compacted[label], targetWidth);
            releasedWidth += compacted[label] - newWidth;
            compacted[label] = newWidth;
        }

        const targetNameWidth = Math.max(MIN_NAME_WIDTH, Math.min(MAX_NAME_WIDTH, DEFAULT_NAME_WIDTH));
        const requestedIncrease = Math.max(0, targetNameWidth - compacted['任务名称']);
        const increaseFromCompactColumns = Math.min(releasedWidth, requestedIncrease);
        compacted['任务名称'] += increaseFromCompactColumns;

        const remainingIncrease = targetNameWidth - compacted['任务名称'];
        return remainingIncrease > 0
            ? redistributeWidth(compacted, remainingIncrease)
            : compacted;
    }

    function applyDefaultState(tableRoot) {
        const current = getColumnState(tableRoot);
        if (!Number.isFinite(current['任务名称'])) return;

        applyColumnState(tableRoot, buildDefaultState(current));
    }

    function addResizeHandle(tableRoot) {
        const nameIndex = findColumnIndex(tableRoot, '任务名称');
        const nameHeader = getHeaders(tableRoot)[nameIndex];
        if (!nameHeader || nameHeader.querySelector('.uc-name-column-resizer')) return;

        nameHeader.style.position = 'relative';

        const handle = document.createElement('div');
        handle.className = 'uc-name-column-resizer';
        handle.title = '拖动调整名称列宽；双击恢复默认宽度';
        nameHeader.appendChild(handle);

        handle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();

            const startX = event.clientX;
            const startState = getColumnState(tableRoot);
            const startNameWidth = startState['任务名称'];
            if (!Number.isFinite(startNameWidth)) return;

            handle.setPointerCapture(event.pointerId);
            document.body.classList.add('uc-column-resizing');

            const onPointerMove = (moveEvent) => {
                const requestedWidth = Math.max(
                    MIN_NAME_WIDTH,
                    Math.min(MAX_NAME_WIDTH, startNameWidth + moveEvent.clientX - startX)
                );
                const adjusted = redistributeWidth(startState, requestedWidth - startNameWidth);
                applyColumnState(tableRoot, adjusted);
            };

            const onPointerUp = (upEvent) => {
                if (handle.hasPointerCapture(upEvent.pointerId)) {
                    handle.releasePointerCapture(upEvent.pointerId);
                }
                document.body.classList.remove('uc-column-resizing');
                handle.removeEventListener('pointermove', onPointerMove);
                handle.removeEventListener('pointerup', onPointerUp);
                handle.removeEventListener('pointercancel', onPointerUp);
                saveState(tableRoot);
            };

            handle.addEventListener('pointermove', onPointerMove);
            handle.addEventListener('pointerup', onPointerUp);
            handle.addEventListener('pointercancel', onPointerUp);
        });

        handle.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            localStorage.removeItem(STORAGE_KEY);
            applyDefaultState(tableRoot);
            saveState(tableRoot);
        });
    }

    function initializeTable(tableRoot) {
        if (findColumnIndex(tableRoot, '任务名称') < 0) return;

        const savedState = loadSavedState();
        if (savedState) {
            applyColumnState(tableRoot, savedState);
        } else {
            applyDefaultState(tableRoot);
            saveState(tableRoot);
        }

        addResizeHandle(tableRoot);
    }

    function initialize() {
        if (!isTargetPage()) return;
        for (const tableRoot of getTableRoots()) initializeTable(tableRoot);
    }

    function scheduleInitialize() {
        window.clearTimeout(scheduledTimer);
        scheduledTimer = window.setTimeout(initialize, 120);
    }

    function addStyles() {
        if (document.getElementById('uc-1panel-column-resizer-style')) return;

        const style = document.createElement('style');
        style.id = 'uc-1panel-column-resizer-style';
        style.textContent = `
            .uc-name-column-resizer {
                position: absolute;
                top: 0;
                right: -5px;
                z-index: 20;
                width: 10px;
                height: 100%;
                cursor: col-resize;
                touch-action: none;
                user-select: none;
            }

            .uc-name-column-resizer::after {
                content: '';
                position: absolute;
                top: 18%;
                bottom: 18%;
                left: 4px;
                width: 2px;
                border-radius: 2px;
                background: transparent;
                transition: background 0.15s ease;
            }

            .uc-name-column-resizer:hover::after {
                background: var(--el-color-primary, #409eff);
            }

            body.uc-column-resizing,
            body.uc-column-resizing * {
                cursor: col-resize !important;
                user-select: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    addStyles();
    initialize();

    const observer = new MutationObserver(scheduleInitialize);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    window.addEventListener('popstate', scheduleInitialize);
})();

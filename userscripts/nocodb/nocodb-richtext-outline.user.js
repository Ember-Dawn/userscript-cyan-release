// ==UserScript==
// @name         NocoDB Rich Text 大纲
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js
// @version      0.3.0
// @description  为 NocoDB Rich Text 弹窗提供纯 DOM、低侵入的可滚动 TOC 大纲与标题定位
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// ==/UserScript==

(function(){'use strict';const registry={"types":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

},
"constants":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ICONS = exports.STYLE_ID = exports.CLASS = exports.CONFIG = void 0;
exports.CONFIG = {
    primaryRootSelector: '.nc-long-text-expanded-modal .expanded-cell-input',
    fallbackRootSelector: '.ant-modal-content .expanded-cell-input',
    contentWrapSelector: '.nc-rich-text-content',
    editorSelector: '.nc-rich-text-content .tiptap.ProseMirror',
    titleTextContainerSelector: '.flex.max-w-38, .max-w-38',
    headingSelector: 'h1, h2, h3, h4, h5, h6',
    panelWidth: 200,
    panelMinWidth: 132,
    panelMaxWidth: 360,
    panelResizeHandleWidth: 8,
    panelLeftInset: 13,
    contentInsetExtra: -3,
    panelInsetY: 1,
    panelBottomGap: 2,
    buttonGap: 8,
    anchorTop: 9,
    defaultOpen: true,
    // Set false to restore NocoDB's original initial focus/scroll behavior.
    preventInitialEditorFocus: true,
    initialFocusGuardMs: 2200,
    initialBuildDelayMs: 120,
    headingCheckDelayMs: 360,
    compositionRefreshDelayMs: 420,
    geometryRefreshDelayMs: 650,
    scrollQuietStage1Ms: 420,
    scrollQuietStage2Ms: 180,
    scrollAnchorTop: 18,
    ensureVisibleSafePadding: 24,
    ensureVisibleDelayMs: 120,
    tocManualBrowseIdleMs: 5000,
};
exports.CLASS = {
    rootReady: 'tm-rtoc-root-v1',
    rootOpen: 'tm-rtoc-open-v1',
    resizing: 'tm-rtoc-resizing-v1',
    button: 'tm-rtoc-button-v1',
    buttonReady: 'is-ready',
    buttonActive: 'is-active',
    panel: 'tm-rtoc-panel-v1',
    panelVisible: 'is-visible',
    resizer: 'tm-rtoc-resizer-v1',
    list: 'tm-rtoc-list-v1',
    item: 'tm-rtoc-item-v1',
    itemActive: 'is-active',
    status: 'tm-rtoc-status-v1',
};
exports.STYLE_ID = 'tm-rtoc-style-v1';
exports.ICONS = {
    top: `
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 3.25h10" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
      <path d="M9 14V6.1" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
      <path d="m5.9 9.15 3.1-3.1 3.1 3.1" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
    bottom: `
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 14.75h10" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
      <path d="M9 4v7.9" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
      <path d="m5.9 8.85 3.1 3.1 3.1-3.1" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
    refresh: `
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M14.55 6.6A6 6 0 1 0 14.6 11" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"></path>
      <path d="M14.55 3.8v2.95H11.6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`,
};

},
"dom":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopAll = stopAll;
exports.stopBubbleOnly = stopBubbleOnly;
exports.isVisible = isVisible;
exports.getTitleBar = getTitleBar;
exports.getTitleTextBox = getTitleTextBox;
exports.isScrollableElement = isScrollableElement;
exports.detectScrollContainer = detectScrollContainer;
exports.clearScrollTimers = clearScrollTimers;
exports.syncScrollContainer = syncScrollContainer;
exports.collectRefs = collectRefs;
exports.getRootCandidates = getRootCandidates;
exports.findActiveRoot = findActiveRoot;
exports.elementContainsLifecycleTarget = elementContainsLifecycleTarget;
const constants_1 = require("./constants");
function stopAll(event) {
    if (!event)
        return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
    }
}
function stopBubbleOnly(event) {
    if (event)
        event.stopPropagation();
}
function isVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected)
        return false;
    let current = element;
    while (current instanceof HTMLElement && current !== document.body) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')
            return false;
        if (current.getAttribute('aria-hidden') === 'true')
            return false;
        current = current.parentElement;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}
function getTitleBar(root) {
    const match = root.querySelector(':scope > .cursor-move') || root.firstElementChild;
    return match instanceof HTMLElement ? match : null;
}
function getTitleTextBox(titleBar) {
    if (!(titleBar instanceof HTMLElement))
        return null;
    const direct = titleBar.querySelector(constants_1.CONFIG.titleTextContainerSelector);
    if (direct instanceof HTMLElement)
        return direct;
    const truncate = titleBar.querySelector('.truncate');
    return truncate instanceof HTMLElement && truncate.parentElement instanceof HTMLElement
        ? truncate.parentElement
        : null;
}
function isScrollableElement(element) {
    if (!(element instanceof HTMLElement))
        return false;
    const style = getComputedStyle(element);
    const overflowY = style.overflowY || style.overflow;
    if (!/(auto|scroll|overlay)/.test(overflowY))
        return false;
    return element.scrollHeight - element.clientHeight > 2;
}
function detectScrollContainer(editor, contentWrap, root) {
    const candidates = [];
    const seen = new Set();
    if (editor instanceof HTMLElement)
        candidates.push(editor);
    if (contentWrap instanceof HTMLElement)
        candidates.push(contentWrap);
    let current = editor instanceof HTMLElement ? editor.parentElement : null;
    while (current instanceof HTMLElement && current !== root) {
        candidates.push(current);
        current = current.parentElement;
    }
    if (root instanceof HTMLElement)
        candidates.push(root);
    for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement) || seen.has(candidate))
            continue;
        seen.add(candidate);
        if (isScrollableElement(candidate))
            return candidate;
    }
    return contentWrap instanceof HTMLElement ? contentWrap : editor;
}
function clearScrollTimers(state) {
    if (!state)
        return;
    if (state.scrollTimer1)
        window.clearTimeout(state.scrollTimer1);
    if (state.scrollTimer2)
        window.clearTimeout(state.scrollTimer2);
    state.scrollTimer1 = 0;
    state.scrollTimer2 = 0;
}
function syncScrollContainer(state) {
    if (!state || state.destroyed)
        return false;
    if (!(state.editor instanceof HTMLElement) || !(state.contentWrap instanceof HTMLElement) || !(state.root instanceof HTMLElement)) {
        return false;
    }
    const next = detectScrollContainer(state.editor, state.contentWrap, state.root);
    if (!(next instanceof HTMLElement) || next === state.scrollContainer)
        return false;
    const previous = state.scrollContainer;
    clearScrollTimers(state);
    if (state.runtimeBound && previous instanceof HTMLElement && typeof state.onScroll === 'function') {
        try {
            previous.removeEventListener('scroll', state.onScroll, false);
        }
        catch (_) { }
    }
    state.scrollContainer = next;
    state.pendingScrollTop = next.scrollTop;
    if (state.runtimeBound && typeof state.onScroll === 'function') {
        next.addEventListener('scroll', state.onScroll, { passive: true });
    }
    return true;
}
function collectRefs(root) {
    if (!(root instanceof HTMLElement) || !root.isConnected)
        return null;
    const titleBar = getTitleBar(root);
    const titleTextBox = getTitleTextBox(titleBar);
    const contentWrap = root.querySelector(constants_1.CONFIG.contentWrapSelector);
    const editor = root.querySelector(constants_1.CONFIG.editorSelector);
    if (!(titleBar instanceof HTMLElement) || !(titleTextBox instanceof HTMLElement))
        return null;
    if (!(contentWrap instanceof HTMLElement) || !(editor instanceof HTMLElement))
        return null;
    const scrollContainer = detectScrollContainer(editor, contentWrap, root);
    if (!(scrollContainer instanceof HTMLElement))
        return null;
    return { root, titleBar, titleTextBox, contentWrap, editor, scrollContainer };
}
function getRootCandidates() {
    const unique = new Set();
    const result = [];
    const appendMatches = (selector) => {
        document.querySelectorAll(selector).forEach((root) => {
            if (!(root instanceof HTMLElement) || unique.has(root))
                return;
            unique.add(root);
            result.push(root);
        });
    };
    appendMatches(constants_1.CONFIG.primaryRootSelector);
    if (!result.length)
        appendMatches(constants_1.CONFIG.fallbackRootSelector);
    return result;
}
function findActiveRoot() {
    const roots = getRootCandidates().filter((root) => isVisible(root) && collectRefs(root));
    return roots.length ? roots[roots.length - 1] : null;
}
function elementContainsLifecycleTarget(element, activeState) {
    if (!(element instanceof Element))
        return false;
    if (element.matches(constants_1.CONFIG.primaryRootSelector) || element.matches(constants_1.CONFIG.fallbackRootSelector))
        return true;
    if (element.querySelector(constants_1.CONFIG.primaryRootSelector) || element.querySelector(constants_1.CONFIG.fallbackRootSelector))
        return true;
    if (activeState) {
        if (element === activeState.root || element.contains(activeState.root))
            return true;
        if (element === activeState.editor || element.contains(activeState.editor))
            return true;
    }
    return false;
}

},
"focus-guard":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopInitialFocusGuard = stopInitialFocusGuard;
exports.startInitialFocusGuard = startInitialFocusGuard;
const constants_1 = require("./constants");
const dom_1 = require("./dom");
function stopInitialFocusGuard(state) {
    if (!state)
        return;
    state.initialFocusGuardActive = false;
    if (state.initialFocusTimer)
        window.clearTimeout(state.initialFocusTimer);
    state.initialFocusTimer = 0;
    if (state.onInitialFocusIn)
        state.root.removeEventListener('focusin', state.onInitialFocusIn, true);
    if (state.onInitialUserPointer)
        state.root.removeEventListener('pointerdown', state.onInitialUserPointer, true);
    if (state.onInitialUserWheel)
        state.root.removeEventListener('wheel', state.onInitialUserWheel, true);
    if (state.onInitialUserKey)
        document.removeEventListener('keydown', state.onInitialUserKey, true);
    state.onInitialFocusIn = null;
    state.onInitialUserPointer = null;
    state.onInitialUserWheel = null;
    state.onInitialUserKey = null;
}
function startInitialFocusGuard(state) {
    if (!constants_1.CONFIG.preventInitialEditorFocus || !state || state.destroyed)
        return;
    state.initialFocusGuardActive = true;
    const resetToTop = () => {
        if (!state.initialFocusGuardActive || state.destroyed)
            return;
        (0, dom_1.syncScrollContainer)(state);
        if (state.scrollContainer instanceof HTMLElement)
            state.scrollContainer.scrollTop = 0;
    };
    const dismissAutoFocus = () => {
        if (!state.initialFocusGuardActive || !state.editor.contains(document.activeElement))
            return;
        // Blur the automatically focused editor only; leave its caret/selection untouched.
        if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
        resetToTop();
        // The host may scroll after dispatching focusin; limit correction to two frames.
        requestAnimationFrame(() => {
            resetToTop();
            requestAnimationFrame(resetToTop);
        });
    };
    state.onInitialFocusIn = (event) => {
        const target = event.target;
        if (target instanceof Node && (target === state.editor || state.editor.contains(target))) {
            dismissAutoFocus();
        }
    };
    state.onInitialUserPointer = () => stopInitialFocusGuard(state);
    state.onInitialUserWheel = () => stopInitialFocusGuard(state);
    state.onInitialUserKey = () => stopInitialFocusGuard(state);
    state.root.addEventListener('focusin', state.onInitialFocusIn, true);
    state.root.addEventListener('pointerdown', state.onInitialUserPointer, true);
    state.root.addEventListener('wheel', state.onInitialUserWheel, { capture: true, passive: true });
    document.addEventListener('keydown', state.onInitialUserKey, true);
    state.initialFocusTimer = window.setTimeout(() => stopInitialFocusGuard(state), constants_1.CONFIG.initialFocusGuardMs);
    // Handle the case where NocoDB focused the editor before we mounted the guard.
    dismissAutoFocus();
}

},
"heading":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeHeadingText = normalizeHeadingText;
exports.getHeadingLevel = getHeadingLevel;
exports.getLiveHeadingElements = getLiveHeadingElements;
exports.buildHeadingSignature = buildHeadingSignature;
exports.getOffsetTopWithinAncestor = getOffsetTopWithinAncestor;
exports.getHeadingTopWithinScroller = getHeadingTopWithinScroller;
exports.extractHeadings = extractHeadings;
exports.findActiveIndexByScrollTop = findActiveIndexByScrollTop;
exports.resolveHeadingMatch = resolveHeadingMatch;
exports.nodeOrAncestorHeading = nodeOrAncestorHeading;
exports.nodeTouchesHeading = nodeTouchesHeading;
exports.mutationMayAffectHeadingContent = mutationMayAffectHeadingContent;
const constants_1 = require("./constants");
function normalizeHeadingText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}
function getHeadingLevel(element) {
    const tag = element instanceof HTMLElement ? element.tagName.toUpperCase() : 'H1';
    const level = Number.parseInt(tag.slice(1), 10);
    return Number.isFinite(level) ? Math.max(1, Math.min(6, level)) : 1;
}
function getLiveHeadingElements(editor) {
    if (!(editor instanceof HTMLElement))
        return [];
    return Array.from(editor.querySelectorAll(constants_1.CONFIG.headingSelector)).filter((element) => {
        return element instanceof HTMLElement && normalizeHeadingText(element.textContent).length > 0;
    });
}
function buildHeadingSignature(elements) {
    return elements.map((element) => {
        const level = getHeadingLevel(element);
        const text = normalizeHeadingText(element.textContent);
        return `${level}:${text.length}:${text}`;
    }).join('\n');
}
function getOffsetTopWithinAncestor(element, ancestor) {
    let top = 0;
    let current = element;
    while (current instanceof HTMLElement && current !== ancestor) {
        top += current.offsetTop;
        current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
    }
    return current === ancestor ? top : null;
}
function getHeadingTopWithinScroller(element, scroller) {
    if (!(element instanceof HTMLElement) || !(scroller instanceof HTMLElement))
        return 0;
    let top = getOffsetTopWithinAncestor(element, scroller);
    if (top == null) {
        const headingRect = element.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        top = scroller.scrollTop + (headingRect.top - scrollerRect.top);
    }
    return Math.max(0, Math.round(Number(top) || 0));
}
function extractHeadings(editor, scroller) {
    const elements = getLiveHeadingElements(editor);
    return elements.map((element) => ({
        element,
        level: getHeadingLevel(element),
        text: normalizeHeadingText(element.textContent),
        top: getHeadingTopWithinScroller(element, scroller),
    }));
}
function findActiveIndexByScrollTop(headings, scrollTop, anchorTop = constants_1.CONFIG.scrollAnchorTop) {
    if (!headings.length)
        return -1;
    const anchor = Math.max(0, scrollTop) + anchorTop;
    let low = 0;
    let high = headings.length - 1;
    let answer = 0;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (headings[middle].top <= anchor) {
            answer = middle;
            low = middle + 1;
        }
        else {
            high = middle - 1;
        }
    }
    return answer;
}
function resolveHeadingMatch(headings, index, text, level) {
    let heading = headings[index];
    if (heading && heading.text === text && heading.level === level) {
        return { heading, index };
    }
    const matches = [];
    headings.forEach((candidate, candidateIndex) => {
        if (candidate.text === text && candidate.level === level) {
            matches.push({ heading: candidate, index: candidateIndex });
        }
    });
    if (matches.length) {
        matches.sort((a, b) => Math.abs(a.index - index) - Math.abs(b.index - index));
        return matches[0];
    }
    return { heading: headings[index] || null, index: headings[index] ? index : -1 };
}
function nodeOrAncestorHeading(node, editor) {
    let current = node instanceof Node ? node : null;
    while (current) {
        if (current instanceof HTMLElement && current.matches(constants_1.CONFIG.headingSelector))
            return current;
        if (current === editor)
            break;
        current = current.parentNode;
    }
    return null;
}
function nodeTouchesHeading(node, editor) {
    if (!(node instanceof Node))
        return false;
    if (nodeOrAncestorHeading(node, editor))
        return true;
    if (node instanceof Element) {
        if (node.matches(constants_1.CONFIG.headingSelector))
            return true;
        return Boolean(node.querySelector(constants_1.CONFIG.headingSelector));
    }
    return false;
}
function mutationMayAffectHeadingContent(mutation, editor) {
    if (mutation.type === 'characterData')
        return Boolean(nodeOrAncestorHeading(mutation.target, editor));
    if (mutation.type !== 'childList')
        return false;
    if (nodeTouchesHeading(mutation.target, editor))
        return true;
    for (const node of Array.from(mutation.addedNodes)) {
        if (nodeTouchesHeading(node, editor))
            return true;
    }
    for (const node of Array.from(mutation.removedNodes)) {
        if (nodeTouchesHeading(node, editor))
            return true;
    }
    return false;
}

},
"styles":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContentInsetForPanelWidth = getContentInsetForPanelWidth;
exports.injectStyle = injectStyle;
const constants_1 = require("./constants");
function getContentInsetForPanelWidth(width) {
    return Math.max(0, Math.round((Number(width) || constants_1.CONFIG.panelWidth) + constants_1.CONFIG.contentInsetExtra));
}
function injectStyle() {
    if (document.getElementById(constants_1.STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = constants_1.STYLE_ID;
    style.textContent = `
    .${constants_1.CLASS.rootReady} {
      position: relative !important;
      overflow: visible !important;
      --tm-rtoc-panel-width: ${constants_1.CONFIG.panelWidth}px;
      --tm-rtoc-left-inset: ${getContentInsetForPanelWidth(constants_1.CONFIG.panelWidth)}px;
    }

    .${constants_1.CLASS.rootOpen} .nc-rich-text-content .tiptap.ProseMirror {
      padding-left: var(--tm-rtoc-left-inset) !important;
      box-sizing: border-box !important;
    }

    .${constants_1.CLASS.button} {
      position: absolute;
      z-index: 30;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 42px;
      height: 30px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .2px;
      pointer-events: auto;
      visibility: hidden;
      opacity: 0;
      transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
    }

    .${constants_1.CLASS.button}.${constants_1.CLASS.buttonReady} {
      visibility: visible;
      opacity: 1;
    }

    .${constants_1.CLASS.button}.${constants_1.CLASS.buttonActive} {
      background: rgba(59, 130, 246, 0.12);
      color: #1d4ed8;
    }

    .${constants_1.CLASS.panel} {
      position: absolute;
      z-index: 25;
      left: ${constants_1.CONFIG.panelLeftInset}px;
      display: none;
      width: calc(var(--tm-rtoc-panel-width) - ${constants_1.CONFIG.panelLeftInset}px);
      min-width: calc(var(--tm-rtoc-panel-width) - ${constants_1.CONFIG.panelLeftInset}px);
      max-width: calc(var(--tm-rtoc-panel-width) - ${constants_1.CONFIG.panelLeftInset}px);
      box-sizing: border-box;
      border: 0;
      border-right: 1px solid rgba(15, 23, 42, 0.10);
      border-radius: 8px 0 0 8px;
      background: var(--nc-bg-default, #fff);
      box-shadow: none;
      overflow: hidden;
    }

    .${constants_1.CLASS.panel}.${constants_1.CLASS.panelVisible} {
      display: block;
    }

    .tm-rtoc-panel-inner-v1 {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .tm-rtoc-title-v1 {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 42px;
      padding: 7px 8px 7px 10px;
      color: #374151;
      background: transparent;
      border-bottom: 1px solid rgba(15, 23, 42, 0.055);
    }

    .tm-rtoc-title-count-v1 {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      min-width: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: #4b5563;
      font-size: 12px;
      font-weight: 650;
      line-height: 1;
      white-space: nowrap;
    }

    .tm-rtoc-title-label-v1 {
      color: #374151;
      letter-spacing: .15px;
    }

    .tm-rtoc-title-number-v1 {
      color: #6b7280;
      font-variant-numeric: tabular-nums;
    }

    .tm-rtoc-title-actions-v1 {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .tm-rtoc-icon-btn-v1 {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 1px solid rgba(15, 23, 42, 0.10);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.72);
      color: #4b5563;
      box-shadow: 0 1px 1px rgba(15, 23, 42, 0.025);
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
    }

    .tm-rtoc-icon-btn-v1:hover {
      background: rgba(59, 130, 246, 0.075);
      border-color: rgba(59, 130, 246, 0.24);
      color: #3158a8;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    }

    .tm-rtoc-icon-btn-v1:active {
      background: rgba(59, 130, 246, 0.12);
      transform: translateY(1px);
    }

    .tm-rtoc-icon-btn-v1 svg {
      width: 15px;
      height: 15px;
      display: block;
      pointer-events: none;
    }

    .${constants_1.CLASS.status} {
      display: none;
      flex: 0 0 auto;
      padding: 7px 8px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(245, 158, 11, 0.10);
      color: #8b5e00;
      font-size: 12px;
      line-height: 1.45;
    }

    .${constants_1.CLASS.list} {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 6px;
    }

    .tm-rtoc-empty-v1 {
      padding: 6px;
      color: #666;
      font-size: 12px;
      line-height: 1.5;
    }

    .${constants_1.CLASS.item} {
      position: relative;
      display: block;
      width: 100%;
      margin: 0 0 2px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #222;
      cursor: pointer;
      font-size: 13px;
      line-height: 1.35;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Indentation guides are decorative and do not change the title hit area. */
    .${constants_1.CLASS.item}::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 3px;
      width: calc(var(--tm-rtoc-guide-depth, 0) * 10px);
      background: repeating-linear-gradient(
        to right,
        transparent 0 9px,
        rgba(100, 116, 139, 0.25) 9px 10px
      );
      pointer-events: none;
    }

    .${constants_1.CLASS.item}:hover {
      background: rgba(0, 0, 0, 0.05);
    }

    .${constants_1.CLASS.item}.${constants_1.CLASS.itemActive} {
      background: rgba(59, 130, 246, 0.16);
      color: #1d4ed8;
    }

    .tm-rtoc-l1-v1 { padding: 6px 8px;  font-weight: 700; --tm-rtoc-guide-depth: 0; }
    .tm-rtoc-l2-v1 { padding: 6px 8px 6px 18px; font-weight: 600; --tm-rtoc-guide-depth: 1; }
    .tm-rtoc-l3-v1 { padding: 6px 8px 6px 28px; --tm-rtoc-guide-depth: 2; }
    .tm-rtoc-l4-v1 { padding: 6px 8px 6px 38px; --tm-rtoc-guide-depth: 3; }
    .tm-rtoc-l5-v1 { padding: 6px 8px 6px 48px; --tm-rtoc-guide-depth: 4; }
    .tm-rtoc-l6-v1 { padding: 6px 8px 6px 58px; --tm-rtoc-guide-depth: 5; }

    .${constants_1.CLASS.resizer} {
      position: absolute;
      z-index: 4;
      top: 0;
      right: 0;
      bottom: 0;
      width: ${constants_1.CONFIG.panelResizeHandleWidth}px;
      cursor: ew-resize;
      touch-action: none;
      background: transparent;
    }

    .${constants_1.CLASS.resizer}::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 1px;
      background: transparent;
      transition: width 120ms ease, background 120ms ease;
    }

    .${constants_1.CLASS.resizer}:hover::after,
    .${constants_1.CLASS.rootReady}.${constants_1.CLASS.resizing} .${constants_1.CLASS.resizer}::after {
      width: 2px;
      background: rgba(59, 130, 246, 0.42);
    }

    .${constants_1.CLASS.rootReady}.${constants_1.CLASS.resizing},
    .${constants_1.CLASS.rootReady}.${constants_1.CLASS.resizing} * {
      cursor: ew-resize !important;
      user-select: none !important;
    }
  `;
    document.head.appendChild(style);
}

},
"ui":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachActionButton = attachActionButton;
exports.makeIconButton = makeIconButton;
exports.updateCount = updateCount;
exports.setStatus = setStatus;
exports.clearStatus = clearStatus;
exports.renderToc = renderToc;
exports.positionButton = positionButton;
exports.positionPanel = positionPanel;
exports.positionUI = positionUI;
exports.getPanelWidthBounds = getPanelWidthBounds;
exports.clampPanelWidth = clampPanelWidth;
exports.applyPanelWidth = applyPanelWidth;
exports.stopPanelResize = stopPanelResize;
exports.startPanelResize = startPanelResize;
exports.setActiveItem = setActiveItem;
exports.mountButton = mountButton;
exports.mountPanel = mountPanel;
const constants_1 = require("./constants");
const dom_1 = require("./dom");
const styles_1 = require("./styles");
function attachActionButton(button, handler) {
    button.addEventListener('click', (event) => {
        (0, dom_1.stopBubbleOnly)(event);
        handler();
    }, true);
}
function makeIconButton(action, title, svg) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tm-rtoc-icon-btn-v1';
    button.dataset.action = action;
    button.setAttribute('aria-label', title);
    button.setAttribute('title', title);
    button.innerHTML = svg;
    return button;
}
function updateCount(state) {
    if (state && state.count instanceof HTMLElement) {
        const number = state.count.querySelector('.tm-rtoc-title-number-v1');
        if (number instanceof HTMLElement) {
            number.textContent = String(state.headings.length || 0);
        }
    }
}
function setStatus(state, text) {
    if (!(state && state.status instanceof HTMLElement))
        return;
    state.status.textContent = text || '';
    state.status.style.display = text ? 'block' : 'none';
}
function clearStatus(state) {
    setStatus(state, '');
}
function renderToc(state, onJump) {
    if (!(state && state.list instanceof HTMLElement))
        return;
    state.list.textContent = '';
    if (!state.headings.length) {
        const empty = document.createElement('div');
        empty.className = 'tm-rtoc-empty-v1';
        empty.textContent = 'No headings';
        state.list.appendChild(empty);
        updateCount(state);
        return;
    }
    state.headings.forEach((heading, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${constants_1.CLASS.item} tm-rtoc-l${heading.level}-v1`;
        button.textContent = heading.text;
        button.title = heading.text;
        button.dataset.index = String(index);
        if (index === state.activeIndex)
            button.classList.add(constants_1.CLASS.itemActive);
        attachActionButton(button, () => onJump(index, heading.text, heading.level));
        state.list.appendChild(button);
    });
    updateCount(state);
}
function positionButton(state) {
    if (!(state && state.button instanceof HTMLElement) || !(state.titleTextBox instanceof HTMLElement))
        return;
    const buttonWidth = state.button.offsetWidth || 42;
    const buttonHeight = state.button.offsetHeight || 30;
    if (state.titleBar.offsetHeight <= 0 || state.titleTextBox.offsetWidth <= 0) {
        state.button.classList.remove(constants_1.CLASS.buttonReady);
        return;
    }
    const rawLeft = Math.round(state.titleTextBox.offsetLeft + state.titleTextBox.offsetWidth + constants_1.CONFIG.buttonGap);
    const rawTop = Math.round(state.titleBar.offsetTop + (state.titleBar.offsetHeight - buttonHeight) / 2);
    const maxLeft = Math.max(8, state.root.clientWidth - buttonWidth - 8);
    state.button.style.left = `${Math.max(8, Math.min(rawLeft, maxLeft))}px`;
    state.button.style.top = `${Math.max(8, rawTop)}px`;
    state.button.classList.add(constants_1.CLASS.buttonReady);
}
function positionPanel(state) {
    if (!(state && state.panel instanceof HTMLElement) || !(state.contentWrap instanceof HTMLElement))
        return;
    const top = Math.round(state.contentWrap.offsetTop + constants_1.CONFIG.panelInsetY);
    const height = Math.max(220, Math.round(state.contentWrap.offsetHeight - constants_1.CONFIG.panelInsetY - constants_1.CONFIG.panelBottomGap));
    state.panel.style.top = `${top}px`;
    state.panel.style.height = `${height}px`;
}
function positionUI(state) {
    if (!state || state.destroyed)
        return;
    positionButton(state);
    if (state.open)
        positionPanel(state);
}
function getPanelWidthBounds(state) {
    const min = Math.max(96, constants_1.CONFIG.panelMinWidth);
    let max = Math.max(min, constants_1.CONFIG.panelMaxWidth);
    if (state && state.root instanceof HTMLElement) {
        max = Math.min(max, Math.max(min, Math.round(state.root.clientWidth - 120)));
    }
    return { min, max };
}
function clampPanelWidth(state, width) {
    const bounds = getPanelWidthBounds(state);
    const value = Number.isFinite(Number(width)) ? Number(width) : constants_1.CONFIG.panelWidth;
    return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)));
}
function applyPanelWidth(state, width) {
    if (!state || !(state.root instanceof HTMLElement))
        return;
    state.panelWidth = clampPanelWidth(state, width);
    state.root.style.setProperty('--tm-rtoc-panel-width', `${state.panelWidth}px`);
    state.root.style.setProperty('--tm-rtoc-left-inset', `${(0, styles_1.getContentInsetForPanelWidth)(state.panelWidth)}px`);
}
function stopPanelResize(state, finalize, onFinalized) {
    if (!state)
        return;
    if (state.onResizeMove)
        document.removeEventListener('pointermove', state.onResizeMove, true);
    if (state.onResizeEnd) {
        document.removeEventListener('pointerup', state.onResizeEnd, true);
        document.removeEventListener('pointercancel', state.onResizeEnd, true);
    }
    state.onResizeMove = null;
    state.onResizeEnd = null;
    state.resizeDragging = false;
    state.root?.classList.remove(constants_1.CLASS.resizing);
    if (state.resizeFrame) {
        cancelAnimationFrame(state.resizeFrame);
        state.resizeFrame = 0;
    }
    if (finalize) {
        applyPanelWidth(state, state.pendingPanelWidth || state.panelWidth);
        positionUI(state);
        if (onFinalized)
            onFinalized();
    }
}
function startPanelResize(state, event, onFinalized) {
    if (!state || state.destroyed || !state.open || !(state.resizer instanceof HTMLElement))
        return;
    const startX = Number(event.clientX);
    if (!Number.isFinite(startX))
        return;
    (0, dom_1.stopAll)(event);
    stopPanelResize(state, false);
    state.resizeDragging = true;
    state.resizeStartX = startX;
    state.resizeStartWidth = state.panelWidth;
    state.root.classList.add(constants_1.CLASS.resizing);
    state.onResizeMove = (moveEvent) => {
        if (!state.resizeDragging)
            return;
        const x = Number(moveEvent.clientX);
        if (!Number.isFinite(x))
            return;
        moveEvent.preventDefault();
        const nextWidth = state.resizeStartWidth + (x - state.resizeStartX);
        state.pendingPanelWidth = nextWidth;
        if (state.resizeFrame)
            return;
        state.resizeFrame = requestAnimationFrame(() => {
            state.resizeFrame = 0;
            applyPanelWidth(state, state.pendingPanelWidth);
            positionPanel(state);
        });
    };
    state.onResizeEnd = (endEvent) => {
        if (endEvent)
            endEvent.preventDefault();
        stopPanelResize(state, true, onFinalized);
    };
    document.addEventListener('pointermove', state.onResizeMove, true);
    document.addEventListener('pointerup', state.onResizeEnd, true);
    document.addEventListener('pointercancel', state.onResizeEnd, true);
}
function setActiveItem(state, index) {
    if (!state || state.destroyed)
        return;
    state.activeIndex = Number.isInteger(index) ? index : -1;
    if (!(state.list instanceof HTMLElement))
        return;
    state.list.querySelectorAll(`.${constants_1.CLASS.item}`).forEach((item, itemIndex) => {
        item.classList.toggle(constants_1.CLASS.itemActive, itemIndex === state.activeIndex);
    });
}
function mountButton(state, onToggle) {
    if (!state || state.destroyed || !(state.root instanceof HTMLElement))
        return;
    if (state.button instanceof HTMLElement && state.button.isConnected)
        return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ant-btn ant-btn-text small theme-default bordered nc-btn-shadow nc-button ${constants_1.CLASS.button}`;
    button.textContent = 'TOC';
    button.setAttribute('aria-label', '切换 TOC');
    button.setAttribute('title', '切换 TOC');
    attachActionButton(button, () => onToggle(!state.open));
    state.root.appendChild(button);
    state.button = button;
}
function mountPanel(state, callbacks) {
    if (!state || state.destroyed || !(state.root instanceof HTMLElement))
        return;
    if (state.panel instanceof HTMLElement && state.panel.isConnected)
        return;
    const panel = document.createElement('div');
    panel.className = constants_1.CLASS.panel;
    panel.innerHTML = `
    <div class="tm-rtoc-panel-inner-v1">
      <div class="tm-rtoc-title-v1">
        <span class="tm-rtoc-title-count-v1"><span class="tm-rtoc-title-label-v1">TOC</span><span class="tm-rtoc-title-number-v1">0</span></span>
        <div class="tm-rtoc-title-actions-v1"></div>
      </div>
      <div class="${constants_1.CLASS.status}"></div>
      <div class="${constants_1.CLASS.list}"></div>
    </div>
    <div class="${constants_1.CLASS.resizer}" title="拖动调整目录宽度；双击恢复默认宽度" aria-hidden="true"></div>
  `;
    panel.addEventListener('click', dom_1.stopBubbleOnly, false);
    panel.addEventListener('pointerdown', dom_1.stopBubbleOnly, false);
    panel.addEventListener('mousedown', dom_1.stopBubbleOnly, false);
    panel.addEventListener('mouseup', dom_1.stopBubbleOnly, false);
    state.root.appendChild(panel);
    state.panel = panel;
    state.count = panel.querySelector('.tm-rtoc-title-count-v1');
    state.status = panel.querySelector(`.${constants_1.CLASS.status}`);
    state.list = panel.querySelector(`.${constants_1.CLASS.list}`);
    state.resizer = panel.querySelector(`.${constants_1.CLASS.resizer}`);
    const actions = panel.querySelector('.tm-rtoc-title-actions-v1');
    if (actions instanceof HTMLElement) {
        const topButton = makeIconButton('top', '跳到顶部', constants_1.ICONS.top);
        const bottomButton = makeIconButton('bottom', '跳到底部', constants_1.ICONS.bottom);
        const refreshButton = makeIconButton('refresh', '刷新目录', constants_1.ICONS.refresh);
        attachActionButton(topButton, callbacks.onTop);
        attachActionButton(bottomButton, callbacks.onBottom);
        attachActionButton(refreshButton, callbacks.onRefresh);
        actions.append(refreshButton, bottomButton, topButton);
    }
    if (state.resizer instanceof HTMLElement) {
        state.resizer.addEventListener('pointerdown', (event) => startPanelResize(state, event, callbacks.onResizeDone), true);
        state.resizer.addEventListener('dblclick', (event) => {
            (0, dom_1.stopAll)(event);
            stopPanelResize(state, false);
            callbacks.onResizeReset();
        }, true);
    }
    if (state.list instanceof HTMLElement) {
        state.list.addEventListener('wheel', callbacks.onManualBrowse, { passive: true });
        state.list.addEventListener('scroll', () => {
            if (Date.now() <= state.listProgrammaticScrollUntil)
                return;
            callbacks.onManualBrowse();
        }, { passive: true });
    }
}

},
"session":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSnapshot = buildSnapshot;
exports.refreshHeadingGeometry = refreshHeadingGeometry;
exports.commitActiveFromScroll = commitActiveFromScroll;
exports.scheduleScrollStopCheck = scheduleScrollStopCheck;
exports.ensureActiveItemVisible = ensureActiveItemVisible;
exports.scheduleEnsureActiveItemVisible = scheduleEnsureActiveItemVisible;
exports.enterManualTocBrowsing = enterManualTocBrowsing;
exports.exitManualTocBrowsing = exitManualTocBrowsing;
exports.jumpToHeading = jumpToHeading;
exports.scrollContainerTo = scrollContainerTo;
exports.scheduleHeadingCheck = scheduleHeadingCheck;
exports.scheduleGeometryRefresh = scheduleGeometryRefresh;
exports.bindEditorRuntime = bindEditorRuntime;
exports.unbindEditorRuntime = unbindEditorRuntime;
exports.togglePanel = togglePanel;
exports.createState = createState;
exports.destroyState = destroyState;
const constants_1 = require("./constants");
const dom_1 = require("./dom");
const focus_guard_1 = require("./focus-guard");
const heading_1 = require("./heading");
const ui_1 = require("./ui");
function buildSnapshot(state) {
    if (!state || state.destroyed || !(state.editor instanceof HTMLElement))
        return false;
    if (!state.editor.isConnected)
        return false;
    const elements = (0, heading_1.getLiveHeadingElements)(state.editor);
    state.headings = (0, heading_1.extractHeadings)(state.editor, state.scrollContainer);
    state.headingSignature = (0, heading_1.buildHeadingSignature)(elements);
    if (state.activeIndex >= state.headings.length)
        state.activeIndex = -1;
    (0, ui_1.renderToc)(state, (index, text, level) => jumpToHeading(state, index, text, level));
    (0, ui_1.clearStatus)(state);
    return true;
}
function refreshHeadingGeometry(state) {
    if (!state || state.destroyed || !Array.isArray(state.headings))
        return;
    if (!(state.editor instanceof HTMLElement) || !(state.scrollContainer instanceof HTMLElement))
        return;
    let invalid = false;
    for (const heading of state.headings) {
        if (!(heading.element instanceof HTMLElement) ||
            !heading.element.isConnected ||
            !state.editor.contains(heading.element)) {
            invalid = true;
            break;
        }
        heading.top = (0, heading_1.getHeadingTopWithinScroller)(heading.element, state.scrollContainer);
    }
    if (invalid) {
        buildSnapshot(state);
        return;
    }
    commitActiveFromScroll(state, false);
}
function commitActiveFromScroll(state, ensureVisible) {
    if (!state || state.destroyed || !state.open || !state.headings.length)
        return;
    if (!(state.scrollContainer instanceof HTMLElement) || !state.scrollContainer.isConnected)
        return;
    const index = (0, heading_1.findActiveIndexByScrollTop)(state.headings, state.scrollContainer.scrollTop);
    if (index < 0)
        return;
    (0, ui_1.setActiveItem)(state, index);
    if (ensureVisible)
        scheduleEnsureActiveItemVisible(state, true);
}
function scheduleScrollStopCheck(state) {
    if (!state || state.destroyed || !state.open)
        return;
    (0, dom_1.clearScrollTimers)(state);
    state.pendingScrollTop = state.scrollContainer.scrollTop;
    state.scrollTimer1 = window.setTimeout(() => {
        state.scrollTimer1 = 0;
        if (!state || state.destroyed || !state.open)
            return;
        const firstTop = state.scrollContainer.scrollTop;
        if (Math.abs(firstTop - state.pendingScrollTop) > 1) {
            scheduleScrollStopCheck(state);
            return;
        }
        state.pendingScrollTop = firstTop;
        state.scrollTimer2 = window.setTimeout(() => {
            state.scrollTimer2 = 0;
            if (!state || state.destroyed || !state.open)
                return;
            const secondTop = state.scrollContainer.scrollTop;
            if (Math.abs(secondTop - state.pendingScrollTop) > 1) {
                scheduleScrollStopCheck(state);
                return;
            }
            if (state.manualTocBrowsing)
                exitManualTocBrowsing(state, false);
            (0, dom_1.syncScrollContainer)(state);
            refreshHeadingGeometry(state);
            commitActiveFromScroll(state, true);
        }, constants_1.CONFIG.scrollQuietStage2Ms);
    }, constants_1.CONFIG.scrollQuietStage1Ms);
}
function ensureActiveItemVisible(state, force) {
    if (!(state.list instanceof HTMLElement) || state.activeIndex < 0)
        return;
    const item = state.list.querySelector(`.${constants_1.CLASS.item}[data-index="${state.activeIndex}"]`);
    if (!(item instanceof HTMLElement))
        return;
    const pad = constants_1.CONFIG.ensureVisibleSafePadding;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    const viewTop = state.list.scrollTop;
    const viewBottom = viewTop + state.list.clientHeight;
    const safeTop = viewTop + pad;
    const safeBottom = viewBottom - pad;
    if (!force && itemTop >= safeTop && itemBottom <= safeBottom)
        return;
    let target = viewTop;
    if (itemTop < safeTop)
        target = itemTop - pad;
    else if (itemBottom > safeBottom)
        target = itemBottom - state.list.clientHeight + pad;
    const maxScrollTop = Math.max(0, state.list.scrollHeight - state.list.clientHeight);
    if (state.activeIndex === 0)
        target = 0;
    else if (state.activeIndex === state.headings.length - 1)
        target = maxScrollTop;
    target = Math.max(0, Math.min(maxScrollTop, Math.round(target)));
    if (Math.abs(target - state.list.scrollTop) > 1) {
        state.listProgrammaticScrollUntil = Date.now() + 260;
        state.list.scrollTop = target;
    }
}
function scheduleEnsureActiveItemVisible(state, force, delay = constants_1.CONFIG.ensureVisibleDelayMs) {
    if (!state || state.destroyed || !state.open || state.manualTocBrowsing)
        return;
    if (state.ensureVisibleTimer)
        window.clearTimeout(state.ensureVisibleTimer);
    state.ensureVisibleTimer = window.setTimeout(() => {
        state.ensureVisibleTimer = 0;
        if (!state || state.destroyed || !state.open || state.manualTocBrowsing)
            return;
        ensureActiveItemVisible(state, force);
    }, delay);
}
function enterManualTocBrowsing(state) {
    if (!state || state.destroyed || !state.open)
        return;
    state.manualTocBrowsing = true;
    if (state.ensureVisibleTimer)
        window.clearTimeout(state.ensureVisibleTimer);
    if (state.manualBrowseTimer)
        window.clearTimeout(state.manualBrowseTimer);
    state.manualBrowseTimer = window.setTimeout(() => exitManualTocBrowsing(state, true), constants_1.CONFIG.tocManualBrowseIdleMs);
}
function exitManualTocBrowsing(state, ensureVisible) {
    if (!state)
        return;
    if (state.manualBrowseTimer)
        window.clearTimeout(state.manualBrowseTimer);
    state.manualBrowseTimer = 0;
    state.manualTocBrowsing = false;
    if (ensureVisible)
        scheduleEnsureActiveItemVisible(state, true, 140);
}
function resolveHeadingForJump(state, index, text, level) {
    let heading = state.headings[index];
    if (heading && heading.element.isConnected && state.editor.contains(heading.element)) {
        return { heading, index };
    }
    if (!buildSnapshot(state))
        return { heading: null, index: -1 };
    if (text == null || level == null) {
        return { heading: state.headings[index] || null, index: state.headings[index] ? index : -1 };
    }
    return (0, heading_1.resolveHeadingMatch)(state.headings, index, text, level);
}
function jumpToHeading(state, index, text, level) {
    if (!state || state.destroyed)
        return;
    exitManualTocBrowsing(state, false);
    if ((0, dom_1.syncScrollContainer)(state))
        refreshHeadingGeometry(state);
    const resolved = resolveHeadingForJump(state, index, text, level);
    if (!resolved.heading || !(resolved.heading.element instanceof HTMLElement)) {
        (0, ui_1.setStatus)(state, '目录已变化，请刷新后重试。');
        return;
    }
    const top = (0, heading_1.getHeadingTopWithinScroller)(resolved.heading.element, state.scrollContainer);
    state.scrollContainer.scrollTop = Math.max(0, Math.round(top - constants_1.CONFIG.anchorTop));
    (0, ui_1.setActiveItem)(state, resolved.index);
    scheduleEnsureActiveItemVisible(state, true, 80);
    (0, ui_1.clearStatus)(state);
    (0, dom_1.clearScrollTimers)(state);
    scheduleScrollStopCheck(state);
}
function scrollContainerTo(state, where) {
    if (!state || state.destroyed)
        return;
    exitManualTocBrowsing(state, false);
    if ((0, dom_1.syncScrollContainer)(state))
        refreshHeadingGeometry(state);
    if (!(state.scrollContainer instanceof HTMLElement))
        return;
    if (where === 'bottom') {
        state.scrollContainer.scrollTop = Math.max(0, state.scrollContainer.scrollHeight - state.scrollContainer.clientHeight);
    }
    else {
        state.scrollContainer.scrollTop = 0;
    }
    (0, dom_1.clearScrollTimers)(state);
    scheduleScrollStopCheck(state);
}
function scheduleHeadingCheck(state, delay = constants_1.CONFIG.headingCheckDelayMs) {
    if (!state || state.destroyed || !state.open)
        return;
    if (state.isComposing) {
        state.pendingHeadingCheck = true;
        return;
    }
    if (state.headingCheckTimer)
        window.clearTimeout(state.headingCheckTimer);
    state.headingCheckTimer = window.setTimeout(() => {
        state.headingCheckTimer = 0;
        if (!state || state.destroyed || !state.open || state.isComposing)
            return;
        const elements = (0, heading_1.getLiveHeadingElements)(state.editor);
        const signature = (0, heading_1.buildHeadingSignature)(elements);
        if (signature !== state.headingSignature) {
            buildSnapshot(state);
            commitActiveFromScroll(state, false);
            scheduleEnsureActiveItemVisible(state, false);
        }
        else {
            refreshHeadingGeometry(state);
        }
    }, delay);
}
function scheduleGeometryRefresh(state, delay = constants_1.CONFIG.geometryRefreshDelayMs) {
    if (!state || state.destroyed || !state.open)
        return;
    if (state.isComposing) {
        state.pendingGeometryRefresh = true;
        return;
    }
    if (state.geometryTimer)
        window.clearTimeout(state.geometryTimer);
    state.geometryTimer = window.setTimeout(() => {
        state.geometryTimer = 0;
        if (!state || state.destroyed || !state.open || state.isComposing)
            return;
        (0, dom_1.syncScrollContainer)(state);
        refreshHeadingGeometry(state);
    }, delay);
}
function bindEditorRuntime(state) {
    if (!state || state.destroyed || state.runtimeBound)
        return;
    state.onScroll = () => scheduleScrollStopCheck(state);
    state.onCompositionStart = () => {
        state.isComposing = true;
        if (state.headingCheckTimer)
            window.clearTimeout(state.headingCheckTimer);
        if (state.geometryTimer)
            window.clearTimeout(state.geometryTimer);
        state.headingCheckTimer = 0;
        state.geometryTimer = 0;
    };
    state.onCompositionEnd = () => {
        state.isComposing = false;
        if (state.pendingHeadingCheck) {
            state.pendingHeadingCheck = false;
            scheduleHeadingCheck(state, constants_1.CONFIG.compositionRefreshDelayMs);
        }
        if (state.pendingGeometryRefresh) {
            state.pendingGeometryRefresh = false;
            scheduleGeometryRefresh(state, constants_1.CONFIG.compositionRefreshDelayMs);
        }
    };
    state.scrollContainer.addEventListener('scroll', state.onScroll, { passive: true });
    state.editor.addEventListener('compositionstart', state.onCompositionStart, false);
    state.editor.addEventListener('compositionend', state.onCompositionEnd, false);
    state.onMediaLoad = (event) => {
        if (event.target instanceof HTMLImageElement)
            scheduleGeometryRefresh(state, 100);
    };
    state.editor.addEventListener('load', state.onMediaLoad, true);
    state.editorObserver = new MutationObserver((mutations) => {
        if (!state || state.destroyed || !state.open)
            return;
        let headingRelevant = false;
        for (const mutation of mutations) {
            if ((0, heading_1.mutationMayAffectHeadingContent)(mutation, state.editor)) {
                headingRelevant = true;
                break;
            }
        }
        if (state.isComposing) {
            if (headingRelevant)
                state.pendingHeadingCheck = true;
            state.pendingGeometryRefresh = true;
            return;
        }
        if (headingRelevant)
            scheduleHeadingCheck(state);
        else
            scheduleGeometryRefresh(state);
    });
    state.editorObserver.observe(state.editor, { childList: true, characterData: true, subtree: true });
    if (typeof ResizeObserver === 'function') {
        state.layoutObserver = new ResizeObserver(() => {
            if (!state || state.destroyed)
                return;
            (0, ui_1.positionUI)(state);
            scheduleGeometryRefresh(state, 100);
        });
        state.layoutObserver.observe(state.root);
        state.layoutObserver.observe(state.contentWrap);
        state.layoutObserver.observe(state.editor);
    }
    state.runtimeBound = true;
}
function unbindEditorRuntime(state) {
    if (!state || !state.runtimeBound)
        return;
    try {
        if (state.onScroll)
            state.scrollContainer.removeEventListener('scroll', state.onScroll, false);
    }
    catch (_) { }
    try {
        if (state.onCompositionStart)
            state.editor.removeEventListener('compositionstart', state.onCompositionStart, false);
    }
    catch (_) { }
    try {
        if (state.onCompositionEnd)
            state.editor.removeEventListener('compositionend', state.onCompositionEnd, false);
    }
    catch (_) { }
    try {
        if (state.onMediaLoad)
            state.editor.removeEventListener('load', state.onMediaLoad, true);
    }
    catch (_) { }
    state.onMediaLoad = null;
    try {
        state.editorObserver?.disconnect();
    }
    catch (_) { }
    try {
        state.layoutObserver?.disconnect();
    }
    catch (_) { }
    state.editorObserver = null;
    state.layoutObserver = null;
    state.runtimeBound = false;
}
function togglePanel(state, open) {
    if (!state || state.destroyed)
        return;
    state.open = Boolean(open);
    state.root.classList.toggle(constants_1.CLASS.rootOpen, state.open);
    state.button?.classList.toggle(constants_1.CLASS.buttonActive, state.open);
    if (state.open) {
        state.panel?.classList.add(constants_1.CLASS.panelVisible);
        bindEditorRuntime(state);
        (0, ui_1.positionPanel)(state);
        if (!state.snapshotReady) {
            window.setTimeout(() => {
                if (!state.destroyed && state.open) {
                    state.snapshotReady = buildSnapshot(state);
                    commitActiveFromScroll(state, false);
                }
            }, constants_1.CONFIG.initialBuildDelayMs);
        }
        else {
            scheduleHeadingCheck(state, 80);
            scheduleGeometryRefresh(state, 80);
        }
    }
    else {
        state.panel?.classList.remove(constants_1.CLASS.panelVisible);
        exitManualTocBrowsing(state, false);
        (0, dom_1.clearScrollTimers)(state);
        unbindEditorRuntime(state);
    }
}
function createState(root) {
    const refs = (0, dom_1.collectRefs)(root);
    if (!refs)
        return null;
    const state = {
        ...refs,
        destroyed: false,
        open: false,
        snapshotReady: false,
        headings: [],
        headingSignature: '',
        activeIndex: -1,
        panelWidth: constants_1.CONFIG.panelWidth,
        pendingPanelWidth: constants_1.CONFIG.panelWidth,
        button: null,
        panel: null,
        count: null,
        status: null,
        list: null,
        resizer: null,
        runtimeBound: false,
        editorObserver: null,
        layoutObserver: null,
        onScroll: null,
        onCompositionStart: null,
        onCompositionEnd: null,
        onMediaLoad: null,
        headingCheckTimer: 0,
        geometryTimer: 0,
        scrollTimer1: 0,
        scrollTimer2: 0,
        ensureVisibleTimer: 0,
        manualBrowseTimer: 0,
        pendingScrollTop: 0,
        manualTocBrowsing: false,
        listProgrammaticScrollUntil: 0,
        isComposing: false,
        pendingHeadingCheck: false,
        pendingGeometryRefresh: false,
        resizeDragging: false,
        resizeStartX: 0,
        resizeStartWidth: constants_1.CONFIG.panelWidth,
        resizeFrame: 0,
        onResizeMove: null,
        onResizeEnd: null,
        initialFocusGuardActive: false,
        initialFocusTimer: 0,
        onInitialFocusIn: null,
        onInitialUserPointer: null,
        onInitialUserWheel: null,
        onInitialUserKey: null,
    };
    root.classList.add(constants_1.CLASS.rootReady);
    (0, ui_1.applyPanelWidth)(state, constants_1.CONFIG.panelWidth);
    (0, ui_1.mountButton)(state, (open) => togglePanel(state, open));
    (0, ui_1.mountPanel)(state, {
        onTop: () => scrollContainerTo(state, 'top'),
        onBottom: () => scrollContainerTo(state, 'bottom'),
        onRefresh: () => {
            buildSnapshot(state);
            commitActiveFromScroll(state, true);
            (0, ui_1.positionPanel)(state);
        },
        onResizeReset: () => {
            (0, ui_1.applyPanelWidth)(state, constants_1.CONFIG.panelWidth);
            (0, ui_1.positionUI)(state);
            scheduleGeometryRefresh(state, 60);
        },
        onResizeDone: () => {
            scheduleGeometryRefresh(state, 80);
        },
        onManualBrowse: () => enterManualTocBrowsing(state),
    });
    (0, ui_1.positionUI)(state);
    if (constants_1.CONFIG.defaultOpen)
        togglePanel(state, true);
    (0, focus_guard_1.startInitialFocusGuard)(state);
    return state;
}
function destroyState(state) {
    if (!state || state.destroyed)
        return;
    state.destroyed = true;
    (0, focus_guard_1.stopInitialFocusGuard)(state);
    unbindEditorRuntime(state);
    (0, ui_1.stopPanelResize)(state, false);
    (0, dom_1.clearScrollTimers)(state);
    const timers = [
        'headingCheckTimer',
        'geometryTimer',
        'ensureVisibleTimer',
        'manualBrowseTimer',
    ];
    for (const timerName of timers) {
        if (state[timerName])
            window.clearTimeout(state[timerName]);
        state[timerName] = 0;
    }
    state.button?.remove();
    state.panel?.remove();
    state.root?.classList.remove(constants_1.CLASS.rootReady, constants_1.CLASS.rootOpen, constants_1.CLASS.resizing);
    state.root?.style.removeProperty('--tm-rtoc-panel-width');
    state.root?.style.removeProperty('--tm-rtoc-left-inset');
}

},
"main":function(require,module,exports){
"use strict";
// ==UserScript==
// @name         NocoDB Rich Text 大纲
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js
// @version      0.3.0
// @description  为 NocoDB Rich Text 弹窗提供纯 DOM、低侵入的可滚动 TOC 大纲与标题定位
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// ==/UserScript==
Object.defineProperty(exports, "__esModule", { value: true });
const dom_1 = require("./dom");
const session_1 = require("./session");
const styles_1 = require("./styles");
const ui_1 = require("./ui");
const states = new Map();
let activeState = null;
let globalObserver = null;
let discoveryFrame = 0;
function syncActiveRoot() {
    const root = (0, dom_1.findActiveRoot)();
    if (!(root instanceof HTMLElement)) {
        if (activeState) {
            states.delete(activeState.root);
            (0, session_1.destroyState)(activeState);
            activeState = null;
        }
        return;
    }
    const refs = (0, dom_1.collectRefs)(root);
    if (!refs) {
        if (activeState) {
            states.delete(activeState.root);
            (0, session_1.destroyState)(activeState);
            activeState = null;
        }
        return;
    }
    if (activeState &&
        !activeState.destroyed &&
        activeState.root === root &&
        activeState.editor === refs.editor &&
        activeState.scrollContainer === refs.scrollContainer) {
        activeState.titleBar = refs.titleBar;
        activeState.titleTextBox = refs.titleTextBox;
        activeState.contentWrap = refs.contentWrap;
        (0, ui_1.positionUI)(activeState);
        return;
    }
    if (activeState) {
        states.delete(activeState.root);
        (0, session_1.destroyState)(activeState);
        activeState = null;
    }
    activeState = (0, session_1.createState)(root);
    if (activeState) {
        states.set(root, activeState);
    }
}
function scheduleDiscovery() {
    if (discoveryFrame)
        return;
    discoveryFrame = requestAnimationFrame(() => {
        discoveryFrame = 0;
        syncActiveRoot();
    });
}
function startGlobalObserver() {
    if (!document.body || globalObserver)
        return;
    globalObserver = new MutationObserver((mutations) => {
        let relevant = false;
        for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
                if ((0, dom_1.elementContainsLifecycleTarget)(node, activeState)) {
                    relevant = true;
                    break;
                }
            }
            if (relevant)
                break;
            for (const node of Array.from(mutation.removedNodes)) {
                if ((0, dom_1.elementContainsLifecycleTarget)(node, activeState)) {
                    relevant = true;
                    break;
                }
            }
            if (relevant)
                break;
        }
        if (relevant)
            scheduleDiscovery();
    });
    globalObserver.observe(document.body, { childList: true, subtree: true });
}
function bootstrap() {
    (0, styles_1.injectStyle)();
    startGlobalObserver();
    scheduleDiscovery();
    window.addEventListener('resize', () => {
        if (!activeState || activeState.destroyed)
            return;
        (0, ui_1.positionUI)(activeState);
        (0, session_1.scheduleGeometryRefresh)(activeState, 120);
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden)
            scheduleDiscovery();
    }, false);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
}
else {
    bootstrap();
}

}};const cache={};function normalize(from,name){if(!name.startsWith('.'))throw Error('External module not bundled: '+name);const pathParts=(from.split('/').slice(0,-1).concat(name.split('/')));const result=[];for(const part of pathParts){if(part==='.'||!part)continue;if(part==='..')result.pop();else result.push(part);}return result.join('/');}function get(key){if(cache[key])return cache[key].exports;const fn=registry[key];if(!fn)throw Error('Missing bundled module '+key);const m={exports:{}};cache[key]=m;fn((name)=>get(normalize(key,name)),m,m.exports);return m.exports;}get('main');})();

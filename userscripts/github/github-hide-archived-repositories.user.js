// ==UserScript==
// @name         GitHub 已归档仓库隐藏助手
// @namespace    https://github.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js
// @version      1.4.1
// @description  在 GitHub 个人仓库列表中合并全部分页并隐藏归档仓库；使用官方筛选时自动暂停。
// @author       Penghao
// @match        https://github.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
脚本说明：

1. 仅在 GitHub 个人主页的 Repositories 列表中生效。
2. 页面加载时先隐藏整个仓库列表，避免“全部仓库先出现、归档仓库随后消失”的闪烁。
3. 未使用 GitHub 官方筛选时，自动请求并合并全部分页，完成后一次性显示最终列表。
4. 默认隐藏已归档仓库，并在 Type、Language、Sort 旁显示归档数量和切换按钮。
5. 启用搜索、Type、Language 或 Sort 后，自动暂停分页合并和归档隐藏，并恢复 GitHub 原生结果与分页。
6. 筛选期间按钮显示“归档已暂停”并不可用；清除筛选后自动恢复之前保存的归档状态。
7. 保留第一页原始仓库节点；后续分页只追加静态仓库条目，并移除可能撑高布局的趋势图异步组件。
8. 归档显示切换只更新当前列表，不会误触发页面预隐藏或重新合并。
9. 同时监听 URL 与仓库区域的局部更新，确保 GitHub 局部筛选后按钮状态及时同步。
10. 若 GitHub 页面结构变化或分页加载失败，会恢复原始列表和分页，不会清空页面。
*/

(() => {
  'use strict';

  const STORAGE_KEY = 'cyan-github-hide-archived-enabled';
  const BUTTON_ID = 'cyan-github-archived-toggle';
  const STYLE_ID = 'cyan-github-archived-style';
  const STATUS_ID = 'cyan-github-repository-loading-status';
  const HIDDEN_CLASS = 'cyan-github-hide-archived';
  const PREPARING_CLASS = 'cyan-github-repositories-preparing';
  const MERGED_ATTRIBUTE = 'data-cyan-all-pages-merged';
  const APPENDED_ATTRIBUTE = 'data-cyan-appended-repository';
  const REPOSITORY_ROOT_SELECTOR = '#user-repositories-list';
  const REPOSITORY_ITEMS_SELECTOR = ':scope > li[itemprop="owns"], :scope > li';
  const FILTER_FORM_SELECTOR = 'form[aria-label="Repositories"]';
  const NEW_REPOSITORY_LINK_SELECTOR = 'a[href="/new"].btn-primary, a[href="/new"].btn';
  const PAGINATION_SELECTOR = '.paginate-container, nav[aria-label="Pagination"], [data-testid="pagination"]';
  const FILTER_PARAMETER_NAMES = ['q', 'type', 'language', 'sort'];
  const LOCATION_CHANGE_EVENT = 'cyan:github-location-change';

  let hideArchived = GM_getValue(STORAGE_KEY, true);
  let activeRunId = 0;
  let activeAbortController = null;
  let scheduledTimer = null;
  let preparingRecoveryTimer = null;
  let filterSyncTimer = null;
  let repositoryObserver = null;
  let isProcessingPage = false;
  let filterPaused = false;
  let lastProcessedUrl = '';
  let lastSyncedUrl = location.href;

  function isRepositoriesPage(url = location.href) {
    try {
      const parsed = new URL(url, location.origin);
      return parsed.hostname === 'github.com' && parsed.searchParams.get('tab') === 'repositories';
    } catch (_) {
      return false;
    }
  }

  function isOfficialFilterActive(url = location.href, root = document) {
    try {
      const parsed = new URL(url, location.origin);
      if (parsed.hostname !== 'github.com' || parsed.searchParams.get('tab') !== 'repositories') return false;

      if (FILTER_PARAMETER_NAMES.some((name) => (parsed.searchParams.get(name) || '').trim() !== '')) {
        return true;
      }
    } catch (_) {
      return false;
    }

    const form = root?.querySelector?.(FILTER_FORM_SELECTOR);
    if (!form) return false;

    const query = form.querySelector('input[name="q"]');
    if ((query?.value || '').trim() !== '') return true;

    return ['type', 'language', 'sort'].some((name) => {
      const selected = form.querySelector(`input[name="${name}"]:checked`);
      return (selected?.value || '').trim() !== '';
    });
  }

  function getRepositoryRoot(root = document) {
    return root.querySelector(REPOSITORY_ROOT_SELECTOR);
  }

  function getRepositoryItemsContainer(root = document) {
    const repositoryRoot = getRepositoryRoot(root);
    if (!repositoryRoot) return null;

    const directList = Array.from(repositoryRoot.children).find((child) =>
      child instanceof HTMLElement && /^(UL|OL)$/.test(child.tagName)
    );
    if (directList) return directList;

    const nestedList = repositoryRoot.querySelector('ul, ol');
    if (nestedList) return nestedList;

    const firstRepoItem = repositoryRoot.querySelector('li[itemprop="owns"], li');
    return firstRepoItem?.parentElement || null;
  }

  function collectRepositoryItems(root = document) {
    const container = getRepositoryItemsContainer(root);
    if (!container) return [];
    return Array.from(container.querySelectorAll(REPOSITORY_ITEMS_SELECTOR));
  }

  function getRepositoryKey(item) {
    if (!(item instanceof Element)) return '';
    const anchor = item.querySelector('a[itemprop="name codeRepository"], h3 a[href]');
    const href = anchor?.getAttribute('href') || '';
    return href.replace(/\/$/, '').toLowerCase();
  }

  function getArchivedCount(root = document) {
    return collectRepositoryItems(root).filter((item) => item.classList.contains('archived')).length;
  }

  function getRepositoryCount(root = document) {
    return collectRepositoryItems(root).length;
  }

  function applyHiddenState() {
    const shouldHide = hideArchived && !filterPaused && !isOfficialFilterActive();
    document.documentElement.classList.toggle(HIDDEN_CLASS, shouldHide);
  }

  function clearPreparingRecoveryTimer() {
    window.clearTimeout(preparingRecoveryTimer);
    preparingRecoveryTimer = null;
  }

  function setPreparingState(preparing, autoRecover = false) {
    document.documentElement.classList.toggle(PREPARING_CLASS, preparing);

    clearPreparingRecoveryTimer();
    if (preparing && autoRecover) {
      preparingRecoveryTimer = window.setTimeout(() => {
        if (!isProcessingPage) setPreparingState(false);
      }, 2500);
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.${HIDDEN_CLASS} ${REPOSITORY_ROOT_SELECTOR} li.archived {
        display: none !important;
      }

      html.${PREPARING_CLASS} ${REPOSITORY_ROOT_SELECTOR} {
        visibility: hidden !important;
      }

      #${STATUS_ID} {
        display: none;
        min-height: 96px;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        color: var(--fgColor-muted, var(--color-fg-muted, #656d76));
        font-size: 14px;
        text-align: center;
      }

      html.${PREPARING_CLASS} #${STATUS_ID} {
        display: flex;
      }

      #${STATUS_ID}[data-state="error"] {
        color: var(--fgColor-danger, var(--color-danger-fg, #d1242f));
      }

      ${REPOSITORY_ROOT_SELECTOR} poll-include-fragment[src*="/graphs/participation"].is-error,
      ${REPOSITORY_ROOT_SELECTOR} include-fragment[src*="/graphs/participation"].is-error {
        display: none !important;
      }

      #${BUTTON_ID}[data-cyan-active="true"]:not(:disabled) {
        color: var(--fgColor-onEmphasis, #ffffff) !important;
        background-color: var(--bgColor-accent-emphasis, var(--color-accent-emphasis, #0969da)) !important;
        border-color: var(--borderColor-accent-emphasis, var(--color-accent-emphasis, #0969da)) !important;
      }

      #${BUTTON_ID}[data-cyan-active="true"]:not(:disabled):hover {
        background-color: var(--bgColor-accent-emphasis, var(--color-accent-emphasis, #0969da)) !important;
        filter: brightness(0.94);
      }

      #${BUTTON_ID}:disabled {
        cursor: not-allowed;
        opacity: 0.65;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function updateButton(button = document.getElementById(BUTTON_ID)) {
    if (!button) return;

    const paused = filterPaused || isOfficialFilterActive();
    const archivedCount = getArchivedCount();
    const totalCount = getRepositoryCount();
    const text = paused
      ? '归档已暂停'
      : hideArchived
        ? `归档已隐藏 (${archivedCount})`
        : `归档已显示 (${archivedCount})`;
    const title = paused
      ? 'GitHub 官方筛选生效时，归档隐藏与自动分页合并已暂停。清除筛选后会自动恢复。'
      : hideArchived
        ? `共加载 ${totalCount} 个仓库，已隐藏 ${archivedCount} 个归档仓库；点击后显示`
        : `共加载 ${totalCount} 个仓库，当前显示 ${archivedCount} 个归档仓库；点击后隐藏`;

    if (button.textContent !== text) button.textContent = text;
    if (button.title !== title) button.title = title;

    button.disabled = paused;
    button.setAttribute('aria-disabled', String(paused));
    button.setAttribute('aria-pressed', String(!paused && hideArchived));
    button.dataset.cyanActive = String(!paused && hideArchived);
  }

  function createToggleButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'btn';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (button.disabled || filterPaused || isOfficialFilterActive()) return;

      window.clearTimeout(scheduledTimer);
      scheduledTimer = null;
      setPreparingState(false);
      clearStatus();

      hideArchived = !hideArchived;
      GM_setValue(STORAGE_KEY, hideArchived);
      applyHiddenState();
      updateButton(button);
    });
    updateButton(button);
    return button;
  }

  function getExternalButtonPlacement() {
    const filterForm = document.querySelector(FILTER_FORM_SELECTOR);
    if (!filterForm?.parentElement) return null;

    const newRepositoryLink = filterForm.parentElement.querySelector(NEW_REPOSITORY_LINK_SELECTOR);
    const host = newRepositoryLink?.parentElement;
    if (host && !filterForm.contains(host)) {
      return { host, before: newRepositoryLink };
    }

    const sibling = filterForm.nextElementSibling;
    if (sibling && !filterForm.contains(sibling)) {
      return { host: sibling, before: sibling.firstElementChild };
    }

    return null;
  }

  function ensureToggleButton() {
    const placement = getExternalButtonPlacement();
    if (!placement) return null;

    let button = document.getElementById(BUTTON_ID);
    if (!button) button = createToggleButton();

    if (button.parentElement !== placement.host) {
      placement.host.insertBefore(button, placement.before || null);
    }

    button.className = 'btn';
    updateButton(button);
    return button;
  }

  function ensureStatusElement() {
    let status = document.getElementById(STATUS_ID);
    if (status) return status;
    const repositoryRoot = getRepositoryRoot();
    if (!repositoryRoot?.parentElement) return null;
    status = document.createElement('div');
    status.id = STATUS_ID;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    repositoryRoot.insertAdjacentElement('beforebegin', status);
    return status;
  }

  function setStatus(message, state = 'loading') {
    const status = ensureStatusElement();
    if (!status) return;
    status.dataset.state = state;
    status.textContent = message;
  }

  function clearStatus() {
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.dataset.state = 'idle';
    status.textContent = '';
  }

  function getPaginationContainers(root = document) {
    return Array.from(root.querySelectorAll(PAGINATION_SELECTOR));
  }

  function showPagination() {
    getPaginationContainers().forEach((container) => {
      container.hidden = false;
      container.removeAttribute('data-cyan-pagination-hidden');
    });
  }

  function hidePagination() {
    getPaginationContainers().forEach((container) => {
      container.hidden = true;
      container.setAttribute('data-cyan-pagination-hidden', 'true');
    });
  }

  function findNextPageUrl(root, baseUrl) {
    const link = root.querySelector(
      'a[rel~="next"][href], a.next_page[href], a[aria-label="Next page"][href], a[aria-label="Next Page"][href]'
    );
    const href = link?.getAttribute('href');
    return href ? new URL(href, baseUrl).href : '';
  }

  async function waitForRepositoryRoot(runId, timeoutMs = 15000) {
    const immediate = getRepositoryRoot();
    if (immediate) return immediate;

    return new Promise((resolve, reject) => {
      let finished = false;
      const timeout = window.setTimeout(() => finish(null, new Error('等待 GitHub 仓库列表超时。')), timeoutMs);
      const observer = new MutationObserver(() => {
        if (runId !== activeRunId) return finish(null, new DOMException('任务已取消。', 'AbortError'));
        const root = getRepositoryRoot();
        if (root) finish(root);
      });

      function finish(value, error) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        observer.disconnect();
        if (error) reject(error);
        else resolve(value);
      }

      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  async function fetchPageDocument(url, signal) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal,
    });
    if (!response.ok) throw new Error(`加载分页失败：HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  function removeFailedParticipationWidgets(root = document) {
    root.querySelectorAll(
      'poll-include-fragment[src*="/graphs/participation"].is-error, ' +
      'include-fragment[src*="/graphs/participation"].is-error'
    ).forEach((node) => node.remove());
  }

  function cloneRepositoryItemForMerge(item) {
    if (!(item instanceof Element)) return null;
    const clone = item.cloneNode(true);
    clone.setAttribute(APPENDED_ATTRIBUTE, 'true');

    clone.querySelectorAll(
      'poll-include-fragment[src*="/graphs/participation"], ' +
      'include-fragment[src*="/graphs/participation"]'
    ).forEach((node) => node.remove());

    return clone;
  }

  function collectUniqueClones(items, seenKeys, targetFragment) {
    let added = 0;
    for (const item of items) {
      const key = getRepositoryKey(item);
      if (!key || seenKeys.has(key)) continue;
      const clone = cloneRepositoryItemForMerge(item);
      if (!clone) continue;
      seenKeys.add(key);
      targetFragment.appendChild(clone);
      added += 1;
    }
    return added;
  }

  function removeAppendedRepositoryItems() {
    document.querySelectorAll(`[${APPENDED_ATTRIBUTE}]`).forEach((item) => item.remove());
    getRepositoryRoot()?.removeAttribute(MERGED_ATTRIBUTE);
  }

  function cancelActiveProcessing() {
    activeRunId += 1;
    if (activeAbortController) activeAbortController.abort();
    activeAbortController = null;

    window.clearTimeout(scheduledTimer);
    scheduledTimer = null;
    isProcessingPage = false;
    clearPreparingRecoveryTimer();
  }

  function enterFilterPausedMode() {
    const wasPaused = filterPaused;
    filterPaused = true;

    if (!wasPaused || isProcessingPage || document.querySelector(`[${APPENDED_ATTRIBUTE}]`)) {
      cancelActiveProcessing();
      removeAppendedRepositoryItems();
    }

    setPreparingState(false);
    clearStatus();
    document.documentElement.classList.remove(HIDDEN_CLASS);
    showPagination();
    ensureToggleButton();
    updateButton();
  }

  function leaveFilterPausedMode() {
    const wasPaused = filterPaused;
    filterPaused = false;
    if (wasPaused) lastProcessedUrl = '';
    applyHiddenState();
    ensureToggleButton();
    updateButton();
  }

  async function loadAndMergeAllPages(runId, signal) {
    const repositoryRoot = await waitForRepositoryRoot(runId);
    const liveContainer = getRepositoryItemsContainer();
    const firstPageItems = collectRepositoryItems();

    if (!liveContainer || firstPageItems.length === 0) {
      throw new Error('未识别到 GitHub 仓库条目，已保留原始页面。');
    }

    const seenKeys = new Set();
    for (const item of firstPageItems) {
      const key = getRepositoryKey(item);
      if (key) seenKeys.add(key);
    }
    if (seenKeys.size === 0) {
      throw new Error('第一页仓库解析结果为空，已保留原始页面。');
    }

    const pendingFragment = document.createDocumentFragment();
    let pendingCount = 0;
    let nextUrl = findNextPageUrl(document, location.href);
    let loadedPage = 1;
    const visitedUrls = new Set([new URL(location.href).href]);

    while (nextUrl) {
      if (signal.aborted || runId !== activeRunId) {
        throw new DOMException('任务已取消。', 'AbortError');
      }
      if (visitedUrls.has(nextUrl)) break;
      visitedUrls.add(nextUrl);

      loadedPage += 1;
      setStatus(`正在整理仓库列表… 正在加载第 ${loadedPage} 页`);
      const pageDocument = await fetchPageDocument(nextUrl, signal);
      const pageItems = collectRepositoryItems(pageDocument);
      if (pageItems.length === 0) {
        throw new Error(`第 ${loadedPage} 页未识别到仓库条目。`);
      }
      pendingCount += collectUniqueClones(pageItems, seenKeys, pendingFragment);
      nextUrl = findNextPageUrl(pageDocument, nextUrl);
    }

    if (signal.aborted || runId !== activeRunId) {
      throw new DOMException('任务已取消。', 'AbortError');
    }
    if (!document.contains(liveContainer) || getRepositoryItemsContainer() !== liveContainer) {
      throw new Error('仓库列表在加载期间已变化，已取消本次合并。');
    }

    if (pendingCount > 0) liveContainer.appendChild(pendingFragment);
    removeFailedParticipationWidgets(repositoryRoot);
    repositoryRoot.setAttribute(MERGED_ATTRIBUTE, 'true');
    hidePagination();
    ensureToggleButton();
    updateButton();
    clearStatus();
  }

  function revealFinalList() {
    setPreparingState(false);
  }

  function prepareCurrentPage(autoRecover = false) {
    if (!isRepositoriesPage()) return false;
    if (isOfficialFilterActive()) {
      enterFilterPausedMode();
      return false;
    }

    filterPaused = false;
    applyHiddenState();
    injectStyle();
    setPreparingState(true, autoRecover);
    return true;
  }

  async function processRepositoriesPage(force = false) {
    if (!isRepositoriesPage()) {
      filterPaused = false;
      setPreparingState(false);
      document.documentElement.classList.remove(HIDDEN_CLASS);
      return;
    }

    if (isOfficialFilterActive()) {
      enterFilterPausedMode();
      return;
    }

    leaveFilterPausedMode();
    const pageUrl = new URL(location.href).href;
    const repositoryRoot = getRepositoryRoot();
    if (!force && pageUrl === lastProcessedUrl && repositoryRoot?.getAttribute(MERGED_ATTRIBUTE) === 'true') {
      ensureToggleButton();
      updateButton();
      revealFinalList();
      return;
    }

    if (pageUrl === lastProcessedUrl && repositoryRoot?.getAttribute(MERGED_ATTRIBUTE) === 'true') {
      ensureToggleButton();
      updateButton();
      revealFinalList();
      return;
    }

    const runId = ++activeRunId;
    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();
    isProcessingPage = true;
    prepareCurrentPage();

    try {
      await waitForRepositoryRoot(runId);
      setStatus('正在整理仓库列表…');
      showPagination();
      await loadAndMergeAllPages(runId, activeAbortController.signal);
      lastProcessedUrl = pageUrl;
      revealFinalList();
    } catch (error) {
      if (error?.name === 'AbortError' || runId !== activeRunId) return;
      console.warn('[GitHub 已归档仓库隐藏助手] 自动合并分页失败：', error);
      showPagination();
      ensureToggleButton();
      updateButton();
      setStatus('自动合并失败，已恢复 GitHub 原始分页。', 'error');
      revealFinalList();
      window.setTimeout(clearStatus, 3500);
    } finally {
      if (runId === activeRunId) {
        isProcessingPage = false;
        revealFinalList();
        clearPreparingRecoveryTimer();
      }
    }
  }

  function scheduleProcess(force = false, delay = 40) {
    window.clearTimeout(scheduledTimer);
    scheduledTimer = window.setTimeout(() => processRepositoriesPage(force), delay);
  }

  function syncFilterMode() {
    window.clearTimeout(filterSyncTimer);
    filterSyncTimer = null;

    const currentUrl = location.href;
    const urlChanged = currentUrl !== lastSyncedUrl;
    lastSyncedUrl = currentUrl;

    if (!isRepositoriesPage()) {
      filterPaused = false;
      setPreparingState(false);
      document.documentElement.classList.remove(HIDDEN_CLASS);
      return;
    }

    if (isOfficialFilterActive()) {
      enterFilterPausedMode();
      return;
    }

    const wasPaused = filterPaused;
    leaveFilterPausedMode();

    if (wasPaused || urlChanged) {
      scheduleProcess(true, 20);
    } else {
      ensureToggleButton();
      updateButton();
    }
  }

  function scheduleFilterSync(delay = 30) {
    window.clearTimeout(filterSyncTimer);
    filterSyncTimer = window.setTimeout(syncFilterMode, delay);
  }

  function nodeTouchesRepositoryUi(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(REPOSITORY_ROOT_SELECTOR) ||
      node.matches(FILTER_FORM_SELECTOR) ||
      Boolean(node.querySelector(REPOSITORY_ROOT_SELECTOR)) ||
      Boolean(node.querySelector(FILTER_FORM_SELECTOR));
  }

  function startRepositoryObserver() {
    if (repositoryObserver || !document.body) return;

    repositoryObserver = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        const target = mutation.target;
        if (target instanceof Element &&
            (target.matches(REPOSITORY_ROOT_SELECTOR) || target.closest(REPOSITORY_ROOT_SELECTOR) ||
             target.matches(FILTER_FORM_SELECTOR) || target.closest(FILTER_FORM_SELECTOR))) {
          return true;
        }

        return [...mutation.addedNodes, ...mutation.removedNodes].some(nodeTouchesRepositoryUi);
      });

      if (relevant) scheduleFilterSync(20);
    });

    repositoryObserver.observe(document.body, { childList: true, subtree: true });
  }

  function installHistoryHooks() {
    for (const methodName of ['pushState', 'replaceState']) {
      const original = history[methodName];
      if (typeof original !== 'function' || original.__cyanWrapped) continue;

      const wrapped = function (...args) {
        const previousUrl = location.href;
        const result = original.apply(this, args);
        if (location.href !== previousUrl) {
          window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
        }
        return result;
      };
      Object.defineProperty(wrapped, '__cyanWrapped', { value: true });
      history[methodName] = wrapped;
    }
  }

  function getIncomingNavigationRoot(event) {
    return event?.detail?.newBody || event?.detail?.newFrame || null;
  }

  function handleNavigationStart(event) {
    if (!isRepositoriesPage()) return;

    const incomingRoot = getIncomingNavigationRoot(event);
    if (isOfficialFilterActive(location.href, incomingRoot || document)) {
      enterFilterPausedMode();
      return;
    }

    prepareCurrentPage(true);
  }

  function handleNavigationEnd() {
    scheduleFilterSync(0);
    scheduleProcess(true);
  }

  installHistoryHooks();
  injectStyle();

  if (isRepositoriesPage()) {
    if (isOfficialFilterActive()) {
      filterPaused = true;
      document.documentElement.classList.remove(HIDDEN_CLASS);
      setPreparingState(false);
    } else {
      applyHiddenState();
      setPreparingState(true, true);
    }
  }

  window.addEventListener(LOCATION_CHANGE_EVENT, () => scheduleFilterSync(0));
  document.addEventListener('turbo:before-render', handleNavigationStart);
  document.addEventListener('turbo:before-frame-render', handleNavigationStart);
  document.addEventListener('turbo:load', handleNavigationEnd);
  document.addEventListener('turbo:frame-load', handleNavigationEnd);
  document.addEventListener('pjax:start', handleNavigationStart);
  document.addEventListener('pjax:end', handleNavigationEnd);
  window.addEventListener('popstate', () => {
    scheduleFilterSync(0);
    prepareCurrentPage(true);
    scheduleProcess(true, 80);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startRepositoryObserver();
      scheduleFilterSync(0);
      scheduleProcess(true, 0);
    }, { once: true });
  } else {
    startRepositoryObserver();
    scheduleFilterSync(0);
    scheduleProcess(true, 0);
  }
})();

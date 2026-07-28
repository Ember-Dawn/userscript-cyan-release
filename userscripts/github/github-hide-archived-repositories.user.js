// ==UserScript==
// @name         GitHub 已归档仓库隐藏助手
// @namespace    https://github.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js
// @version      1.3.0
// @description  在 GitHub 个人仓库列表中自动合并全部分页，并在最终显示前隐藏已归档仓库，避免列表闪烁。
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
3. 自动请求并合并当前筛选条件下的全部分页，完成后一次性显示最终列表。
4. 默认隐藏已归档仓库，并在 Type、Language、Sort 旁显示归档数量和切换按钮。
5. 搜索、筛选、排序、前进后退及 GitHub SPA 导航后会重新整理列表。
6. 如果后续分页加载失败，会恢复当前页和原分页控件，不会让列表一直隐藏。
*/

(() => {
  'use strict';

  const STORAGE_KEY = 'cyan-github-hide-archived-enabled';
  const BUTTON_ID = 'cyan-github-archived-toggle';
  const STYLE_ID = 'cyan-github-archived-style';
  const STATUS_ID = 'cyan-github-repository-loading-status';
  const HIDDEN_CLASS = 'cyan-github-hide-archived';
  const PREPARING_CLASS = 'cyan-github-repositories-preparing';
  const READY_CLASS = 'cyan-github-repositories-ready';
  const MERGED_ATTRIBUTE = 'data-cyan-all-pages-merged';
  const REPOSITORY_LIST_SELECTOR = '#user-repositories-list';
  const FILTER_FORM_SELECTOR = 'form[aria-label="Repositories"]';
  const FILTER_ACTIONS_SELECTOR = `${FILTER_FORM_SELECTOR} .d-flex.flex-wrap.gap-2`;
  const PAGINATION_SELECTORS = [
    '.paginate-container',
    'nav[aria-label="Pagination"]',
    '[data-testid="pagination"]',
  ];

  let hideArchived = GM_getValue(STORAGE_KEY, true);
  let activeRunId = 0;
  let activeAbortController = null;
  let scheduledTimer = null;
  let lastProcessedUrl = '';

  function isRepositoriesPage(url = location.href) {
    try {
      const parsed = new URL(url, location.origin);
      return parsed.hostname === 'github.com' && parsed.searchParams.get('tab') === 'repositories';
    } catch (_) {
      return false;
    }
  }

  function applyHiddenState() {
    document.documentElement.classList.toggle(HIDDEN_CLASS, hideArchived);
  }

  function setPreparingState(preparing) {
    const html = document.documentElement;
    html.classList.toggle(PREPARING_CLASS, preparing);
    html.classList.toggle(READY_CLASS, !preparing);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.${HIDDEN_CLASS} ${REPOSITORY_LIST_SELECTOR} li.archived {
        display: none !important;
      }

      html.${PREPARING_CLASS} ${REPOSITORY_LIST_SELECTOR} {
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
    `;

    document.documentElement.appendChild(style);
  }

  function getRepositoryList(root = document) {
    return root.querySelector(REPOSITORY_LIST_SELECTOR);
  }

  function getRepositoryKey(item) {
    if (!(item instanceof Element)) return '';
    const anchor = item.querySelector('h3 a[itemprop="name codeRepository"], h3 a[href], a[itemprop="name codeRepository"]');
    const href = anchor?.getAttribute('href') || '';
    return href.replace(/\/$/, '').toLowerCase();
  }

  function getArchivedCount(root = document) {
    const repositoryList = getRepositoryList(root);
    return repositoryList?.querySelectorAll(':scope > li.archived').length || 0;
  }

  function getRepositoryCount(root = document) {
    const repositoryList = getRepositoryList(root);
    return repositoryList?.querySelectorAll(':scope > li').length || 0;
  }

  function updateButton(button = document.getElementById(BUTTON_ID)) {
    if (!button) return;

    const archivedCount = getArchivedCount();
    const totalCount = getRepositoryCount();
    const text = hideArchived
      ? `归档：已隐藏 (${archivedCount})`
      : `归档：已显示 (${archivedCount})`;
    const title = hideArchived
      ? `共加载 ${totalCount} 个仓库，已隐藏 ${archivedCount} 个归档仓库；点击后显示`
      : `共加载 ${totalCount} 个仓库，当前显示 ${archivedCount} 个归档仓库；点击后隐藏`;

    if (button.textContent !== text) button.textContent = text;
    if (button.title !== title) button.title = title;
    button.setAttribute('aria-pressed', String(hideArchived));
  }

  function createToggleButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'btn mt-1 mt-lg-0';

    button.addEventListener('click', () => {
      hideArchived = !hideArchived;
      GM_setValue(STORAGE_KEY, hideArchived);
      applyHiddenState();
      updateButton(button);
    });

    updateButton(button);
    return button;
  }

  function ensureToggleButton() {
    const filterActions = document.querySelector(FILTER_ACTIONS_SELECTOR);
    if (!filterActions) return null;

    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = createToggleButton();
      filterActions.appendChild(button);
    } else {
      updateButton(button);
    }

    return button;
  }

  function ensureStatusElement() {
    let status = document.getElementById(STATUS_ID);
    if (status) return status;

    const repositoryList = getRepositoryList();
    if (!repositoryList?.parentElement) return null;

    status = document.createElement('div');
    status.id = STATUS_ID;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    repositoryList.insertAdjacentElement('beforebegin', status);
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
    const containers = new Set();
    for (const selector of PAGINATION_SELECTORS) {
      root.querySelectorAll(selector).forEach((node) => containers.add(node));
    }

    root.querySelectorAll('a[rel="next"], a.next_page, a[aria-label="Next Page"]').forEach((link) => {
      const container = link.closest('.paginate-container, nav, [data-testid="pagination"]');
      if (container) containers.add(container);
    });

    return Array.from(containers);
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
    const selectors = [
      'a[rel="next"]',
      'a.next_page',
      'a[aria-label="Next Page"]',
      '.paginate-container a[href]:last-of-type',
    ];

    for (const selector of selectors) {
      const candidates = Array.from(root.querySelectorAll(selector));
      for (const link of candidates) {
        const text = (link.textContent || '').trim().toLowerCase();
        const rel = (link.getAttribute('rel') || '').toLowerCase();
        const aria = (link.getAttribute('aria-label') || '').toLowerCase();
        const isNext = rel.includes('next') || aria.includes('next') || text === 'next' || link.classList.contains('next_page');
        const href = link.getAttribute('href');
        if (isNext && href) return new URL(href, baseUrl).href;
      }
    }

    return '';
  }

  function collectRepositoryItems(root) {
    const list = getRepositoryList(root);
    if (!list) return [];
    return Array.from(list.querySelectorAll(':scope > li'));
  }

  async function waitForRepositoryList(runId, timeoutMs = 15000) {
    const immediate = getRepositoryList();
    if (immediate) return immediate;

    return new Promise((resolve, reject) => {
      let finished = false;
      const timeout = window.setTimeout(() => finish(null, new Error('等待 GitHub 仓库列表超时。')), timeoutMs);
      const observer = new MutationObserver(() => {
        if (runId !== activeRunId) return finish(null, new DOMException('任务已取消。', 'AbortError'));
        const list = getRepositoryList();
        if (list) finish(list);
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
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`加载分页失败：HTTP ${response.status}`);
    }

    const html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function appendUniqueItems(targetList, items, seenKeys) {
    const fragment = document.createDocumentFragment();
    let added = 0;

    for (const item of items) {
      const key = getRepositoryKey(item);
      if (key && seenKeys.has(key)) continue;
      if (key) seenKeys.add(key);
      fragment.appendChild(item.cloneNode(true));
      added += 1;
    }

    targetList.appendChild(fragment);
    return added;
  }

  async function loadAndMergeAllPages(runId, signal) {
    const currentList = await waitForRepositoryList(runId);
    if (runId !== activeRunId) throw new DOMException('任务已取消。', 'AbortError');

    const workingList = currentList.cloneNode(false);
    const seenKeys = new Set();
    appendUniqueItems(workingList, collectRepositoryItems(document), seenKeys);

    let nextUrl = findNextPageUrl(document, location.href);
    let loadedPage = 1;
    let totalKnownPages = null;
    const visitedUrls = new Set([new URL(location.href).href]);

    while (nextUrl) {
      if (signal.aborted || runId !== activeRunId) {
        throw new DOMException('任务已取消。', 'AbortError');
      }
      if (visitedUrls.has(nextUrl)) break;
      visitedUrls.add(nextUrl);

      loadedPage += 1;
      setStatus(totalKnownPages
        ? `正在整理仓库列表… 正在加载第 ${loadedPage}/${totalKnownPages} 页`
        : `正在整理仓库列表… 正在加载第 ${loadedPage} 页`);

      const pageDocument = await fetchPageDocument(nextUrl, signal);
      const pageItems = collectRepositoryItems(pageDocument);
      appendUniqueItems(workingList, pageItems, seenKeys);

      const nextFromPage = findNextPageUrl(pageDocument, nextUrl);
      if (!nextFromPage) totalKnownPages = loadedPage;
      nextUrl = nextFromPage;
    }

    if (runId !== activeRunId) throw new DOMException('任务已取消。', 'AbortError');

    currentList.replaceChildren(...Array.from(workingList.children));
    currentList.setAttribute(MERGED_ATTRIBUTE, 'true');
    hidePagination();
    ensureToggleButton();
    updateButton();
    clearStatus();
  }

  function revealFinalList() {
    setPreparingState(false);
  }

  function prepareCurrentPage() {
    if (!isRepositoriesPage()) return;
    applyHiddenState();
    injectStyle();
    setPreparingState(true);
  }

  async function processRepositoriesPage(force = false) {
    if (!isRepositoriesPage()) {
      setPreparingState(false);
      return;
    }

    const pageUrl = new URL(location.href).href;
    const existingList = getRepositoryList();
    if (!force && pageUrl === lastProcessedUrl && existingList?.getAttribute(MERGED_ATTRIBUTE) === 'true') {
      ensureToggleButton();
      updateButton();
      revealFinalList();
      return;
    }

    const runId = ++activeRunId;
    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    prepareCurrentPage();

    try {
      await waitForRepositoryList(runId);
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
      setStatus('部分分页加载失败，已恢复 GitHub 原始分页。', 'error');
      revealFinalList();
      window.setTimeout(clearStatus, 3500);
    }
  }

  function scheduleProcess(force = false, delay = 40) {
    window.clearTimeout(scheduledTimer);
    scheduledTimer = window.setTimeout(() => processRepositoriesPage(force), delay);
  }

  function markNavigationStart(event) {
    if (!isRepositoriesPage()) return;

    const target = event?.target;
    if (target instanceof Element) {
      const relevant = target.closest(
        `${FILTER_FORM_SELECTOR}, ${FILTER_FORM_SELECTOR} button, ${FILTER_FORM_SELECTOR} a, ${FILTER_FORM_SELECTOR} input, ${FILTER_FORM_SELECTOR} select`
      );
      if (!relevant) return;
    }

    prepareCurrentPage();
  }

  applyHiddenState();
  injectStyle();
  if (isRepositoriesPage()) setPreparingState(true);

  document.addEventListener('submit', markNavigationStart, true);
  document.addEventListener('click', markNavigationStart, true);
  document.addEventListener('turbo:before-render', prepareCurrentPage);
  document.addEventListener('turbo:load', () => scheduleProcess(true));
  document.addEventListener('pjax:start', prepareCurrentPage);
  document.addEventListener('pjax:end', () => scheduleProcess(true));
  window.addEventListener('popstate', () => {
    prepareCurrentPage();
    scheduleProcess(true, 80);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleProcess(true, 0), { once: true });
  } else {
    scheduleProcess(true, 0);
  }
})();

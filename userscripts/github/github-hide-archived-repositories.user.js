// ==UserScript==
// @name         GitHub 已归档仓库隐藏助手
// @namespace    https://github.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js
// @version      1.2.0
// @description  在 GitHub 个人仓库列表中隐藏已归档仓库，并提供带数量提示的状态按钮随时切换显示状态。
// @author       Penghao
// @match        https://github.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
脚本说明：

1. 仅在 GitHub 个人主页的 Repositories 列表中生效。
2. 默认隐藏带有 archived 类名的仓库条目。
3. 在 Type、Language、Sort 旁显示当前状态和归档仓库数量。
4. 开关状态保存在 Tampermonkey 本地存储中。
5. 在页面内容渲染前应用隐藏样式，减少首次加载和翻页时的闪烁。
*/

(() => {
  'use strict';

  const STORAGE_KEY = 'cyan-github-hide-archived-enabled';
  const BUTTON_ID = 'cyan-github-archived-toggle';
  const HIDDEN_CLASS = 'cyan-github-hide-archived';
  const REPOSITORY_LIST_SELECTOR = '#user-repositories-list';
  const FILTER_ACTIONS_SELECTOR =
    'form[aria-label="Repositories"] .d-flex.flex-wrap.gap-2';

  let hideArchived = GM_getValue(STORAGE_KEY, true);
  let refreshTimer = null;
  let observer = null;

  function applyHiddenState() {
    document.documentElement.classList.toggle(HIDDEN_CLASS, hideArchived);
  }

  function injectStyle() {
    if (document.getElementById('cyan-github-archived-style')) return;

    const style = document.createElement('style');
    style.id = 'cyan-github-archived-style';
    style.textContent = `
      html.${HIDDEN_CLASS} #user-repositories-list li.archived {
        display: none !important;
      }
    `;

    document.documentElement.appendChild(style);
  }

  function getArchivedCount() {
    const repositoryList = document.querySelector(REPOSITORY_LIST_SELECTOR);
    return repositoryList?.querySelectorAll('li.archived').length || 0;
  }

  function updateButton(button) {
    const archivedCount = getArchivedCount();
    const text = hideArchived
      ? `归档：已隐藏 (${archivedCount})`
      : `归档：已显示 (${archivedCount})`;
    const title = hideArchived
      ? `当前已隐藏 ${archivedCount} 个归档仓库，点击后显示`
      : `当前已显示 ${archivedCount} 个归档仓库，点击后隐藏`;

    if (button.textContent !== text) {
      button.textContent = text;
    }
    if (button.title !== title) {
      button.title = title;
    }
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
    if (!filterActions) return;

    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = createToggleButton();
      filterActions.appendChild(button);
      return;
    }

    updateButton(button);
  }

  function refreshInterface() {
    ensureToggleButton();
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshInterface, 50);
  }

  function startObserver() {
    if (observer || !document.body) return;

    observer = new MutationObserver((mutations) => {
      const hasRelevantAddition = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some((node) => {
          if (!(node instanceof Element)) return false;
          if (node.id === BUTTON_ID || node.closest(`#${BUTTON_ID}`)) return false;

          return (
            node.matches(REPOSITORY_LIST_SELECTOR) ||
            node.matches(FILTER_ACTIONS_SELECTOR) ||
            node.querySelector(REPOSITORY_LIST_SELECTOR) ||
            node.querySelector(FILTER_ACTIONS_SELECTOR) ||
            node.matches('li.archived') ||
            node.querySelector('li.archived')
          );
        })
      );

      if (hasRelevantAddition) {
        scheduleRefresh();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function initializeInterface() {
    refreshInterface();
    startObserver();
  }

  applyHiddenState();
  injectStyle();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeInterface, { once: true });
  } else {
    initializeInterface();
  }

  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
})();

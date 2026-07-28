// ==UserScript==
// @name         GitHub 已归档仓库隐藏助手
// @namespace    https://github.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/github/github-hide-archived-repositories.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/github/github-hide-archived-repositories.user.js
// @version      1.0.0
// @description  在 GitHub 个人仓库列表中隐藏已归档仓库，并提供按钮随时切换显示状态。
// @author       Penghao
// @match        https://github.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
脚本说明：

1. 仅在 GitHub 个人主页的 Repositories 列表中生效。
2. 默认隐藏带有 archived 类名的仓库条目。
3. 在 Type、Language、Sort 旁添加“显示归档 / 隐藏归档”按钮。
4. 开关状态保存在 Tampermonkey 本地存储中。
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

  function updateRepositoryList() {
    const repositoryList = document.querySelector(REPOSITORY_LIST_SELECTOR);
    if (!repositoryList) return false;

    repositoryList.classList.toggle(HIDDEN_CLASS, hideArchived);
    return true;
  }

  function updateButton(button) {
    button.textContent = hideArchived ? '显示归档' : '隐藏归档';
    button.setAttribute('aria-pressed', String(hideArchived));
    button.title = hideArchived
      ? '当前已隐藏归档仓库，点击后显示'
      : '当前显示归档仓库，点击后隐藏';
  }

  function createToggleButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'btn mt-1 mt-lg-0';

    button.addEventListener('click', () => {
      hideArchived = !hideArchived;
      GM_setValue(STORAGE_KEY, hideArchived);
      updateRepositoryList();
      updateButton(button);
    });

    updateButton(button);
    return button;
  }

  function ensureToggleButton() {
    const filterActions = document.querySelector(FILTER_ACTIONS_SELECTOR);
    if (!filterActions) return false;

    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = createToggleButton();
      filterActions.appendChild(button);
    } else {
      updateButton(button);
    }

    return true;
  }

  function refresh() {
    updateRepositoryList();
    ensureToggleButton();
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 100);
  }

  const style = document.createElement('style');
  style.textContent = `
    #user-repositories-list.${HIDDEN_CLASS} li.archived {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  refresh();

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
})();

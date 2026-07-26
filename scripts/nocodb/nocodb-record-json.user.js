// ==UserScript==
// @name         NocoDB 复制record为json
// @namespace    https://chat.openai.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-record-json.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-record-json.user.js
// @version      0.2.3
// @description  在 NocoDB 的 record 完整信息浏览弹层中添加“复制 JSON”按钮，并复制当前 record 为 JSON。
// @author       OpenAI
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  /*
   * 脚本名称：NocoDB 复制record为json
   *
   * 适用场景：
   * - NocoDB 中点击某条记录后，右侧或弹层出现的“record 完整信息浏览”界面
   * - 顶部工具栏存在 Save record 按钮的展开页
   *
   * 脚本目标：
   * - 在 Save record 左侧插入一个“复制 JSON”按钮
   * - 点击后读取当前展开页中的所有字段，并复制为格式化 JSON
   * - JSON 中额外附带 URL 里的 rowId
   *
   * 当前实现思路：
   * 1. 定位当前展开页头部与 Save 按钮，把自定义按钮插入到 Save 左边
   * 2. 遍历每个 .nc-expanded-form-row，把“字段名 + 字段值”收集起来
   * 3. 根据页面中实际渲染出来的控件类型，分层提取值
   *    - 富文本：读取只读渲染区的 innerText
   *    - 长文本：读取 textarea.value
   *    - 单行文本：读取 textarea.value
   *    - 复选框/开关：读取 checked / aria-checked
   *    - 链接：优先读取 href
   *    - 标签/徽标/选择器：读取可见文本
   *    - 其他未知字段：退回到通用文本提取逻辑兜底
   * 4. 对少数特殊值做轻量归一化
   *    - 例如把 [日期, 时间] 合并成“日期 时间”的单行字符串
   * 5. 使用剪贴板 API / GM_setClipboard 复制 JSON
   *
   * 设计原则：
   * - 尽量依赖 NocoDB 展开页中的稳定结构，而不是视觉样式
   * - 先精确处理已知常见字段，再对未知字段做保底兼容
   * - 保留空字段，避免因为字段为空而在 JSON 中丢键
   * - 按钮文案固定不变；复制成功后按钮短暂变灰，再恢复
   *
   * 已知限制：
   * - 这是前端 DOM 读取方案，依赖当前页面已经把该字段渲染出来
   * - 对附件、关联记录、Lookup、Rollup 等复杂字段，会尽量给出合理值，
   *   但若未来 NocoDB DOM 结构明显变化，可能需要补充适配
   */

  // 页面中的关键选择器。尽量只依赖展开页中的结构性节点。
  const SELECTORS = {
    header: '.nc-expanded-form-header',
    saveButton: '[data-testid="nc-expanded-form-save"]',
    row: '.nc-expanded-form-row',
    richText: '.nc-rich-text-content',
    singleTextarea: 'textarea.nc-auto-size-textarea',
    longTextarea: 'textarea.nc-inline-textarea',
  };

  const BUTTON_ID = 'tm-nocodb-copy-record-json-btn';
  const BUTTON_TEXT = '复制 JSON';
  const COPY_FLASH_MS = 900;
  const FLASH_OPACITY = '0.55';

  // 统一处理文本中的空格、换行和首尾空白。
  function normalizeText(value, opts = {}) {
    const {
      trim = true,
      normalizeNewlines = true,
      preserveMultipleBlankLines = true,
    } = opts;

    if (value == null) return '';

    let text = String(value).replace(/\u00a0/g, ' ');

    if (normalizeNewlines) {
      text = text.replace(/\r\n?/g, '\n');
    }

    text = text.replace(/[\t ]+\n/g, '\n');

    if (!preserveMultipleBlankLines) {
      text = text.replace(/\n{3,}/g, '\n\n');
    }

    return trim ? text.trim() : text;
  }

  function uniq(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const key = typeof item === 'string' ? item : JSON.stringify(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function getExpandedHeader() {
    return document.querySelector(SELECTORS.saveButton)?.closest(SELECTORS.header)
      || document.querySelector(SELECTORS.header);
  }

  function getExpandedRoot() {
    const header = getExpandedHeader();
    if (!header) return null;

    return (
      header.closest('.ant-modal-content') ||
      header.closest('.ant-modal') ||
      header.closest('[role="dialog"]') ||
      header.parentElement ||
      document
    );
  }

  function getSaveButton(root) {
    return (root || document).querySelector(SELECTORS.saveButton);
  }

  function getRows(root) {
    return [...(root || document).querySelectorAll(SELECTORS.row)];
  }

  function getFieldName(row) {
    const explicit = row.querySelector('[data-test-id]');
    if (explicit) {
      return normalizeText(explicit.textContent);
    }

    const fallback = [...row.querySelectorAll('.select-none')]
      .map((el) => normalizeText(el.textContent))
      .find(Boolean);

    return fallback || '';
  }

  function getValueRoot(row) {
    const expandedCell = row.querySelector('.nc-expanded-cell');
    if (expandedCell && expandedCell.children.length >= 2) {
      return expandedCell.children[1];
    }

    return (
      row.querySelector('.nc-data-cell') ||
      row.querySelector('.nc-cell:not(.nc-cell-expanded-form-header)') ||
      row
    );
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return true;
  }

  function getCheckedBoolean(root) {
    const input = root.querySelector('input[type="checkbox"]');
    if (input) return !!input.checked;

    const aria = root.querySelector('[role="checkbox"], [role="switch"], [aria-checked]');
    if (aria) {
      const checked = aria.getAttribute('aria-checked');
      if (checked === 'true') return true;
      if (checked === 'false') return false;
    }

    const maybeChecked = root.querySelector('.ant-switch-checked, .is-checked, .checked');
    if (maybeChecked) return true;

    return null;
  }

  function getInputValues(root) {
    const controls = [...root.querySelectorAll('input, textarea, select')]
      .filter((el) => isVisible(el))
      .filter((el) => el.type !== 'hidden')
      .filter((el) => !el.closest('.nc-cell-expanded-form-header'));

    const values = controls
      .map((el) => {
        if (el.tagName === 'SELECT') {
          return normalizeText(el.value);
        }
        if (el.type === 'checkbox') {
          return el.checked;
        }
        return normalizeText(el.value, { trim: false });
      })
      .filter((v) => v !== '' && v != null);

    return values;
  }

  function getContentAnchors(root) {
    return [...root.querySelectorAll('a[href]')]
      .filter((a) => isVisible(a))
      .filter((a) => !a.closest('.nc-cell-expanded-form-header'))
      .filter((a) => {
        const href = a.getAttribute('href') || '';
        return href && href !== '#' && !href.startsWith('javascript:');
      });
  }

  function isAbsoluteHttpUrl(href) {
    return /^https?:\/\//i.test(href || '');
  }

  function getChipTexts(root) {
    const selectors = [
      '.ant-tag',
      '[class*="tag"]',
      '[class*="badge"]',
      '[class*="chip"]',
      '[class*="pill"]',
      '.ant-select-selection-item',
      '[role="option"][aria-selected="true"]',
      '[class*="select"] [class*="item"]',
      '[class*="select"] [class*="value"]',
    ];

    const texts = [...root.querySelectorAll(selectors.join(','))]
      .filter((el) => isVisible(el))
      .map((el) => normalizeText(el.innerText || el.textContent || ''))
      .filter(Boolean);

    return uniq(texts);
  }

  function getLeafTexts(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node || !node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.nc-cell-expanded-form-header')) return NodeFilter.FILTER_REJECT;
        if (parent.closest('button, svg, style, script, noscript')) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const texts = [];
    let current;
    while ((current = walker.nextNode())) {
      const text = normalizeText(current.nodeValue, { preserveMultipleBlankLines: true });
      if (text) texts.push(text);
    }

    return uniq(texts);
  }

  function collapseValue(values) {
    const filtered = values.filter((v) => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== '' && v != null;
    });

    if (filtered.length === 0) return '';
    if (filtered.length === 1) return filtered[0];
    return filtered;
  }

  function looksLikeDateString(value) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    return (
      /^\d{4}-\d{1,2}-\d{1,2}$/.test(text) ||
      /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text) ||
      /^\d{1,2}-\d{1,2}-\d{1,2}(\d{2})?$/.test(text) ||
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)
    );
  }

  function looksLikeTimeString(value) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    return /^\d{1,2}:\d{2}(:\d{2})?(\s?[APMapm]{2})?$/.test(text);
  }

  function normalizeSpecialArrayValue(value) {
    if (!Array.isArray(value)) return value;
    if (value.length === 2 && value.every((item) => typeof item === 'string')) {
      const [first, second] = value.map((item) => normalizeText(item));
      if (looksLikeDateString(first) && looksLikeTimeString(second)) {
        return `${first} ${second}`;
      }
    }
    return value;
  }

  // 按“已知类型优先、未知类型兜底”的顺序提取字段值。
  function extractValueFromRoot(root) {
    if (!root) return '';

    const richText = root.querySelector(SELECTORS.richText);
    if (richText) {
      return normalizeText(richText.innerText || richText.textContent || '', {
        preserveMultipleBlankLines: false,
      });
    }

    const longTextarea = root.querySelector(SELECTORS.longTextarea);
    if (longTextarea) {
      return normalizeText(longTextarea.value, {
        preserveMultipleBlankLines: true,
      });
    }

    const singleTextarea = root.querySelector(SELECTORS.singleTextarea);
    if (singleTextarea) {
      return normalizeText(singleTextarea.value, { trim: false });
    }

    const checked = getCheckedBoolean(root);
    if (typeof checked === 'boolean') {
      return checked;
    }

    const inputValues = getInputValues(root);
    if (inputValues.length === 1) return inputValues[0];
    if (inputValues.length > 1) return uniq(inputValues);

    const anchors = getContentAnchors(root);
    if (anchors.length === 1) {
      const anchor = anchors[0];
      const href = anchor.href || anchor.getAttribute('href') || '';
      const text = normalizeText(anchor.innerText || anchor.textContent || '');
      return isAbsoluteHttpUrl(href) ? href : (text || href || '');
    }
    if (anchors.length > 1) {
      const values = anchors.map((anchor) => {
        const href = anchor.href || anchor.getAttribute('href') || '';
        const text = normalizeText(anchor.innerText || anchor.textContent || '');
        return isAbsoluteHttpUrl(href) ? (text && text !== href ? { text, url: href } : href) : (text || href);
      });
      return collapseValue(uniq(values));
    }

    const chipTexts = getChipTexts(root);
    if (chipTexts.length === 1) return chipTexts[0];
    if (chipTexts.length > 1) return chipTexts;

    const attachmentNodes = [...root.querySelectorAll('img, [class*="attachment"], [data-testid*="attachment"]')];
    if (attachmentNodes.length > 0) {
      const links = getContentAnchors(root).map((a) => {
        const title = normalizeText(a.innerText || a.textContent || '');
        const url = a.href || a.getAttribute('href') || '';
        return title || url ? { title: title || url, url } : null;
      }).filter(Boolean);
      return collapseValue(uniq(links));
    }

    const leafTexts = getLeafTexts(root);
    if (leafTexts.length === 1) return leafTexts[0];
    if (leafTexts.length > 1) {
      const joined = normalizeText((root.innerText || root.textContent || ''), {
        preserveMultipleBlankLines: true,
      });
      if (joined) return joined;
      return leafTexts;
    }

    const raw = normalizeText(root.innerText || root.textContent || '', {
      preserveMultipleBlankLines: true,
    });
    return raw || '';
  }

  // 汇总当前展开页中的所有字段，最终形成可复制的 record JSON。
  function collectRecordAsObject() {
    const root = getExpandedRoot();
    const rows = getRows(root);
    const rowId = new URL(window.location.href).searchParams.get('rowId') || '';

    const result = { rowId };

    for (const row of rows) {
      const fieldName = getFieldName(row);
      if (!fieldName) continue;

      const valueRoot = getValueRoot(row);
      let value = extractValueFromRoot(valueRoot);
      value = normalizeSpecialArrayValue(value);

      if (value == null) value = '';
      result[fieldName] = value;
    }

    return result;
  }

  // 复制到剪贴板：优先使用油猴 API，其次使用浏览器原生剪贴板。
  async function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function setButtonText(button, text) {
    if (!button) return;
    const textNode = button.querySelector('.xs\\:px-1')
      || button.querySelector('.font-medium div')
      || button.querySelector('.nc-btn-inner');

    if (textNode) {
      textNode.textContent = text;
    } else {
      button.textContent = text;
    }
  }

  function flashCopiedState(button) {
    if (!button) return;
    const oldOpacity = button.style.opacity;
    const oldFilter = button.style.filter;

    button.style.opacity = FLASH_OPACITY;
    button.style.filter = 'grayscale(1)';

    window.setTimeout(() => {
      if (!document.contains(button)) return;
      button.style.opacity = oldOpacity;
      button.style.filter = oldFilter;
    }, COPY_FLASH_MS);
  }

  async function onCopyClick(button) {
    if (!button || button.dataset.tmCopying === '1') return;
    button.dataset.tmCopying = '1';

    try {
      const record = collectRecordAsObject();
      const json = JSON.stringify(record, null, 2);
      await copyText(json);
      console.log('[NocoDB 复制record为json] copied:', record);
      flashCopiedState(button);
    } catch (error) {
      console.error('[NocoDB 复制record为json] failed:', error);
    } finally {
      window.setTimeout(() => {
        if (document.contains(button)) {
          button.dataset.tmCopying = '0';
        }
      }, 100);
    }
  }

  // 直接克隆 Save 按钮，复用 NocoDB 现有按钮样式，减少样式维护成本。
  function buildButtonFrom(saveButton) {
    const btn = saveButton.cloneNode(true);
    btn.id = BUTTON_ID;
    btn.removeAttribute('data-testid');
    btn.removeAttribute('disabled');
    btn.disabled = false;

    btn.classList.remove('nc-expand-form-save-btn');
    btn.style.marginRight = '8px';
    btn.style.transition = 'opacity 0.18s ease, filter 0.18s ease';

    setButtonText(btn, BUTTON_TEXT);

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCopyClick(btn);
    }, { passive: false });

    return btn;
  }

  // 在当前展开页中确保按钮只插入一次。
  function ensureButton() {
    const root = getExpandedRoot();
    if (!root) return;

    const saveButton = getSaveButton(root);
    if (!saveButton) return;

    const existing = root.querySelector(`#${BUTTON_ID}`);
    if (existing) return;

    const btn = buildButtonFrom(saveButton);
    saveButton.parentElement?.insertBefore(btn, saveButton);
  }

  let scheduled = false;
  function scheduleEnsureButton() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      ensureButton();
    });
  }

  const observer = new MutationObserver(() => {
    scheduleEnsureButton();
  });

  // 兼容 NocoDB 单页应用路由切换。
  function hookHistory() {
    const rawPush = history.pushState;
    const rawReplace = history.replaceState;

    history.pushState = function (...args) {
      const result = rawPush.apply(this, args);
      window.setTimeout(scheduleEnsureButton, 50);
      return result;
    };

    history.replaceState = function (...args) {
      const result = rawReplace.apply(this, args);
      window.setTimeout(scheduleEnsureButton, 50);
      return result;
    };

    window.addEventListener('popstate', () => {
      window.setTimeout(scheduleEnsureButton, 50);
    });
  }

  // 初始化：监听 DOM 变化与路由变化，保证切换记录后按钮还能自动出现。
  function init() {
    hookHistory();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    scheduleEnsureButton();
    window.setTimeout(scheduleEnsureButton, 300);
    window.setTimeout(scheduleEnsureButton, 1000);
  }

  init();
})();

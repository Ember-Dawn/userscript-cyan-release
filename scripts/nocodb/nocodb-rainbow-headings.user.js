// ==UserScript==
// @name         NocoDB 彩虹标题
// @namespace    https://openai.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-rainbow-headings.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-rainbow-headings.user.js
// @version      1.0.2
// @description  仅为 NocoDB Longtext RichText 的弹窗编辑器正文中的 H1-H6 添加彩虹标题颜色
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'tm-nocodb-rainbow-headings-popup-only';

  const CSS = `
    :root {
      --tm-rainbow-h1: #d65d0d;
      --tm-rainbow-h2: #d79920;
      --tm-rainbow-h3: #989719;
      --tm-rainbow-h4: #689d6a;
      --tm-rainbow-h5: #458488;
      --tm-rainbow-h6: #b16286;
    }

    /* 仅作用于弹窗编辑器正文，不作用于 TOC，不作用于普通页面正文 */
    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h1,
    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h1 * {
      color: var(--tm-rainbow-h1) !important;
    }

    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h2,
    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h2 * {
      color: var(--tm-rainbow-h2) !important;
    }

    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h3,
    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h3 * {
      color: var(--tm-rainbow-h3) !important;
    }

    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h4,
    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h4 * {
      color: var(--tm-rainbow-h4) !important;
    }

    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h5,
    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h5 * {
      color: var(--tm-rainbow-h5) !important;
    }

    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h6,
    .ant-modal-content .expanded-cell-input .nc-rich-text-content .tiptap.ProseMirror h6 * {
      color: var(--tm-rainbow-h6) !important;
    }
  `;

  function installStyle() {
    if (!document.head) {
      return;
    }

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    if (style.textContent !== CSS) {
      style.textContent = CSS;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installStyle, { once: true });
  } else {
    installStyle();
  }
})();

// ==UserScript==
// @name         NocoDB LongText 字体改色
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-longtext-color.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-longtext-color.user.js
// @version      2.1.2
// @description  NocoDB LongText 富文本字体改色：加粗文字 CSS 改色；【xxx】和「xxx」使用 ProseMirror Decoration 改色，不修改原文内容。
// @match        https://nocodb.380782744.xyz/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /**
   * NocoDB LongText 字体改色
   *
   * 作用：
   * 1. 将 NocoDB LongText 富文本编辑器里的加粗文本 strong 改成 #cc6566。
   * 2. 将形如 【xxx】 的文本显示为 #3366ff。
   * 3. 将形如 「xxx」 的文本显示为 #c88445。
   *
   * 技术路线：
   * 1. 加粗文本改色：
   *    - 使用普通 CSS 选择器 `.nc-rich-text-content .ProseMirror strong`。
   *    - 这是纯样式层处理，性能风险最低。
   *
   * 2. 【xxx】/「xxx」改色：
   *    - 使用 NocoDB LongText 编辑器内部暴露的 Tiptap / ProseMirror editor 实例。
   *    - 当前页面中 `.ProseMirror` DOM 节点上存在 `editor` 属性，可通过 `pm.editor` 取得编辑器实例。
   *    - 脚本动态反推当前页面打包后的 ProseMirror 构造器：
   *      a. Plugin：从 `editor.state.plugins[*].constructor` 获取。
   *      b. DecorationSet：从已有 decorations 插件返回值的 constructor 获取。
   *      c. Decoration：从已有 DecorationSet.find() 返回的 decoration 对象 constructor 获取。
   *    - 然后注册一个 ProseMirror Plugin，在 `props.decorations(state)` 中返回 inline decorations。
   *
   * 稳定性与安全性：
   * 1. 不使用 innerHTML 替换编辑器内容。
   * 2. 不手动拆文本节点，不向正文 DOM 真实包裹 span。
   * 3. 不修改 ProseMirror 文档内容模型，因此理论上不会把颜色、class、style 写入 NocoDB 原文。
   * 4. 插件只负责“显示层装饰”，保存、撤销、复制、输入法等仍由 ProseMirror/Tiptap 自己处理。
   * 5. 使用 WeakMap/编辑器标记避免重复注册。
   * 6. MutationObserver 只负责发现新打开的编辑器和补注入 CSS，不做正文扫描，避免页面卡顿。
   *
   * 性能策略：
   * 1. 正文匹配基于 ProseMirror state.doc，而不是扫描真实 DOM。
   * 2. 插件内部缓存 doc 引用：doc 未变化时直接复用上一次 DecorationSet。
   * 3. 匹配规则限定为不跨行、非贪婪、最大 500 字符，防止极端长括号造成压力。
   * 4. 最大 decoration 数量限制为 3000，防止异常内容造成渲染压力。
   * 5. 如果未来需要支持超长文本，可继续升级为“只重算变化范围”的增量策略。
   *
   * 注意：
   * - 不要硬编码控制台中看到的压缩类名，如 Qa / Na / dl；这些名称会随 NocoDB 打包变化。
   * - 本脚本使用动态探测方式获取构造器，因此比写死压缩名更稳定。
   */

  /**************************************************************************
   * 1. 加粗字体改色：纯 CSS，放在脚本前部，低风险、低开销
   **************************************************************************/

  const STYLE_ID = 'tm-nocodb-longtext-font-color-style-v21';

  const COLOR_BOLD = '#cc6566';
  const COLOR_BRACKET_BLUE = '#3366ff';
  const COLOR_QUOTE_BROWN = '#c88445';

  const CLASS_BRACKET_BLUE = 'tm-nc-pm-bracket-blue-v21';
  const CLASS_QUOTE_BROWN = 'tm-nc-pm-quote-brown-v21';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nc-rich-text-content .ProseMirror strong {
        color: ${COLOR_BOLD} !important;
      }

      .nc-rich-text-content .ProseMirror .${CLASS_BRACKET_BLUE} {
        color: ${COLOR_BRACKET_BLUE} !important;
      }

      .nc-rich-text-content .ProseMirror .${CLASS_QUOTE_BROWN} {
        color: ${COLOR_QUOTE_BROWN} !important;
      }
    `;
    document.head.appendChild(style);
  }

  injectStyle();

  /**************************************************************************
   * 2. ProseMirror Decoration：给 【xxx】/「xxx」做显示层改色
   **************************************************************************/

  const SCRIPT_VERSION = '2.1.0';
  const EDITOR_SELECTOR = '.nc-rich-text-content .ProseMirror, .ProseMirror';
  const EDITOR_MARK = '__tmNocodbLongTextFontColorInstalledV21__';

  // 安全上限：避免缺失闭合符或异常大文本造成大量 decoration。
  const MAX_PAIR_CHARS = 500;
  const MAX_DECORATIONS = 3000;

  // 如果编辑器刚打开时内部构造器尚未准备好，则有限次数重试。
  const MAX_RETRY = 30;
  const RETRY_DELAY_MS = 500;

  const DEBUG = false;

  const retryCount = new WeakMap();
  let scanTimer = 0;

  function log(...args) {
    if (DEBUG) console.log('[NocoDB LongText 字体改色]', ...args);
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function makePairRegexp(open, close) {
    // 规则说明：
    // - 不跨行。
    // - 从左括号匹配到最近的右括号。
    // - 中间至少 1 个字符，最多 MAX_PAIR_CHARS 个字符。
    // - 例如：【abc】、「abc」。
    return new RegExp(
      escapeRegExp(open) + '[^' + escapeRegExp(close) + '\\r\\n]{1,' + MAX_PAIR_CHARS + '}' + escapeRegExp(close),
      'g'
    );
  }

  const MATCH_RULES = [
    {
      name: 'fullwidth-square-bracket',
      regexp: makePairRegexp('【', '】'),
      className: CLASS_BRACKET_BLUE,
    },
    {
      name: 'cjk-corner-quote',
      regexp: makePairRegexp('「', '」'),
      className: CLASS_QUOTE_BROWN,
    },
  ];

  function getEditorState(editor) {
    return (editor && editor.state) || (editor && editor.view && editor.view.state) || null;
  }

  function getPlugins(state) {
    if (!state) return [];
    if (Array.isArray(state.plugins)) return state.plugins;
    if (state.config && Array.isArray(state.config.plugins)) return state.config.plugins;
    return [];
  }

  function getPluginCtor(plugins) {
    for (const plugin of plugins) {
      const Ctor = plugin && plugin.constructor;
      if (typeof Ctor !== 'function') continue;

      try {
        const probe = new Ctor({ props: {} });
        if (probe && probe.spec) return Ctor;
      } catch (e) {
        // 尝试下一个插件。
      }
    }

    return null;
  }

  function findDecorationConstructors(state) {
    const plugins = getPlugins(state);
    let DecorationSetCtor = null;
    let DecorationCtor = null;

    for (const plugin of plugins) {
      const decorationsFn = plugin && plugin.spec && plugin.spec.props && plugin.spec.props.decorations;
      if (typeof decorationsFn !== 'function') continue;

      let set = null;
      try {
        set = decorationsFn(state);
      } catch (e) {
        continue;
      }

      if (set && set.constructor && typeof set.constructor.create === 'function') {
        DecorationSetCtor = DecorationSetCtor || set.constructor;
      }

      if (set && typeof set.find === 'function') {
        try {
          const found = set.find();
          if (Array.isArray(found)) {
            for (const deco of found) {
              const Ctor = deco && deco.constructor;
              if (Ctor && typeof Ctor.inline === 'function') {
                DecorationCtor = Ctor;
                break;
              }
            }
          }
        } catch (e) {
          // 继续尝试其他 decorations 插件。
        }
      }

      if (DecorationSetCtor && DecorationCtor) break;
    }

    return { DecorationSetCtor, DecorationCtor };
  }

  function getConstructors(editor) {
    const state = getEditorState(editor);
    const plugins = getPlugins(state);

    const PluginCtor = getPluginCtor(plugins);
    const { DecorationSetCtor, DecorationCtor } = findDecorationConstructors(state);

    if (!PluginCtor || !DecorationSetCtor || !DecorationCtor) {
      return null;
    }

    return { PluginCtor, DecorationSetCtor, DecorationCtor };
  }

  function createEmptyDecorationSet(doc, DecorationSetCtor) {
    if (DecorationSetCtor && DecorationSetCtor.empty) return DecorationSetCtor.empty;
    return DecorationSetCtor.create(doc, []);
  }

  function buildDecorationSet(doc, DecorationCtor, DecorationSetCtor) {
    if (!doc) return createEmptyDecorationSet(doc, DecorationSetCtor);

    const decorations = [];
    let stopped = false;

    doc.descendants((node, pos) => {
      if (stopped) return false;
      if (!node || !node.isText) return true;

      const text = node.text || '';

      // 快速跳过：没有目标起始符号的文本节点不跑正则。
      if (!text || (text.indexOf('【') === -1 && text.indexOf('「') === -1)) {
        return false;
      }

      for (const rule of MATCH_RULES) {
        rule.regexp.lastIndex = 0;
        let match;

        while ((match = rule.regexp.exec(text))) {
          const from = pos + match.index;
          const to = from + match[0].length;

          if (to > from) {
            decorations.push(
              DecorationCtor.inline(
                from,
                to,
                { class: rule.className },
                { tmNocodbFontColor: true, rule: rule.name }
              )
            );
          }

          if (decorations.length >= MAX_DECORATIONS) {
            stopped = true;
            break;
          }
        }

        if (stopped) break;
      }

      // 文本节点没有子节点。
      return false;
    });

    if (!decorations.length) return createEmptyDecorationSet(doc, DecorationSetCtor);
    return DecorationSetCtor.create(doc, decorations);
  }

  function makeFontColorPlugin(ctors) {
    const { PluginCtor, DecorationSetCtor, DecorationCtor } = ctors;

    let cachedDoc = null;
    let cachedSet = null;

    return new PluginCtor({
      props: {
        decorations(state) {
          const doc = state && state.doc;
          if (!doc) return cachedSet || createEmptyDecorationSet(doc, DecorationSetCtor);

          // ProseMirror 文档对象未变化时复用上一次 DecorationSet。
          if (doc === cachedDoc && cachedSet) return cachedSet;

          cachedDoc = doc;

          try {
            cachedSet = buildDecorationSet(doc, DecorationCtor, DecorationSetCtor);
          } catch (e) {
            log('build decorations failed:', e);
            cachedSet = createEmptyDecorationSet(doc, DecorationSetCtor);
          }

          return cachedSet;
        },
      },
    });
  }

  function scheduleRetry(pm) {
    const count = retryCount.get(pm) || 0;
    if (count >= MAX_RETRY) return;

    retryCount.set(pm, count + 1);

    window.setTimeout(() => {
      if (document.contains(pm)) installForProseMirror(pm);
    }, RETRY_DELAY_MS);
  }

  function installForProseMirror(pm) {
    if (!pm || pm.nodeType !== 1) return false;

    const editor = pm.editor;
    if (!editor || !editor.view || typeof editor.registerPlugin !== 'function') {
      return false;
    }

    const installed = editor[EDITOR_MARK];
    if (installed && installed.version === SCRIPT_VERSION) return true;

    const ctors = getConstructors(editor);
    if (!ctors) {
      scheduleRetry(pm);
      return false;
    }

    const plugin = makeFontColorPlugin(ctors);

    try {
      editor.registerPlugin(plugin);

      Object.defineProperty(editor, EDITOR_MARK, {
        value: {
          version: SCRIPT_VERSION,
          plugin,
          pluginKey: plugin.key ? String(plugin.key) : null,
          installedAt: Date.now(),
        },
        configurable: true,
      });

      log('installed', pm, editor);
      return true;
    } catch (e) {
      log('registerPlugin failed:', e);
      scheduleRetry(pm);
      return false;
    }
  }

  function scanEditors() {
    scanTimer = 0;
    injectStyle();

    const editors = document.querySelectorAll(EDITOR_SELECTOR);
    for (const pm of editors) {
      installForProseMirror(pm);
    }
  }

  function scheduleScan(delay) {
    if (scanTimer) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanEditors, delay || 100);
  }

  // 首次执行：注入样式，并尽快尝试安装插件。
  injectStyle();
  scheduleScan(0);

  const observer = new MutationObserver(() => {
    // 这里只负责发现新打开的 LongText 编辑器和补 CSS。
    // 不在 MutationObserver 中扫描正文，不做正则匹配，不改 DOM。
    scheduleScan(150);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();

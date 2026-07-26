// ==UserScript==
// @name         NocoDB Rich Text 大纲
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-richtext-outline.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-richtext-outline.user.js
// @version      46.0.2
// @description  为 NocoDB Rich Text 弹窗提供低频 TOC：ProseMirror 标题快照/变更检测 + DOM UI/滚动保守方案 + TOC 宽度拖拽
// @match        https://nocodb.380782744.xyz/*
// @run-at       document-idle
// ==/UserScript==


/*
* =============================================================================
* NocoDB Rich Text TOC：当前稳定版总览说明（给后续接手 AI / 维护者）
* =============================================================================
*
* 一、脚本定位
* -----------------------------------------------------------------------------
* 这个脚本服务于 NocoDB LongText 的 Rich Text 弹窗编辑器。
* 它不是“普通网页上的静态目录插件”，而是一个运行在动态富文本弹窗里的
* TOC（目录）增强脚本。
*
* 当前版本的最高优先级不是“功能最全”，而是：
*
* 1) 不制造卡顿
* 2) 在大量标题文档中仍然可用
* 3) 保留最核心的 TOC 体验
* 4) 所有自动行为都尽量低频、合并、延后
*
*
* 二、当前版本的核心设计思想
* -----------------------------------------------------------------------------
* 当前版本已经从早期“重状态机 / 强同步 / 自愈优先”的路线，收敛到：
*
*   “低频自动更新 + 滚动停止后的伪高亮 + TOC 列表低频纠偏 + 用户手动浏览保护”
*
* 也就是说：
*
* - 目录不是实时强同步
* - 不在滚动热路径里做重活
* - 不在输入热路径里直接 rebuild
* - 不做全局高频 observer 驱动刷新
* - 不追求每一帧都正确，只追求“低频时机下足够正确”
*
* 当前版本的口号可以概括为：
*
*   目录只在必要时工作，其余时间尽量沉默。
*
*
* 三、当前版本保留的核心能力
* -----------------------------------------------------------------------------
* 1. 弹窗内部左侧 TOC 面板
*    - TOC 不放在弹窗外侧
*    - 不改弹窗总宽
*    - 正文通过 left inset 向右让位
*
* 2. 标题栏上的 TOC 按钮
*    - 当前版本默认打开 TOC
*    - 目录数量直接显示为数字（不再显示 “TOC” 文案）
*
* 3. 标题层级缩进
*    - h1 ~ h6 用稳定的层级类控制缩进
*    - 层级类不应频繁改名
*
* 4. 点击目录跳转
*    - 点击目录项后跳转到正文对应标题
*    - 若快照或引用失效，允许做一次“轻量恢复”后重试
*
* 5. 自动目录更新（低频版）
*    - 新建标题 / 删除标题 / 修改标题时，目录会自动变化
*    - 但不是实时变化，而是“标脏 + 延迟合并刷新”
*
* 6. 滚动停止后的伪高亮
*    - 正文滚动过程中不实时同步 TOC
*    - 只有正文真正停下来后，才更新一次 active
*
* 7. TOC 列表低频纠偏
*    - active 更新后，TOC 列表会低频地把高亮项纠偏回安全区
*    - 不是实时跟随，也不是每次都居中
*
* 8. TOC 手动浏览保护
*    - 用户自己滚动 TOC 列表时，脚本暂停自动拉回
*    - 避免用户想翻到标题 80，却总被强行拉回标题 1 附近
*
* 9. 中文输入法保护
*    - composition 期间只记账，不做重活
*    - compositionend 后再走延迟刷新
*
*
* 四、当前版本明确放弃或降级的能力
* -----------------------------------------------------------------------------
* 下面这些不是当前版本的目标，后续如果要恢复，必须非常谨慎：
*
* 1) 实时滚动高亮
* 2) 每次 scroll 都测量 heading 位置
* 3) TOC 列表实时自动跟随
* 4) 全局 body 高频 MutationObserver
* 5) 输入过程中即时 rebuild
* 6) 点击目录前的重型自愈链
* 7) smooth jump + jumpLock + finalize 多段收尾
* 8) 为了“绝对正确”而在热路径里做 refs / session / visibility 自检
*
* 原因很简单：
* 这些东西都曾经是卡顿来源。
*
*
* 五、为什么当前版本采用“低频自动更新”
* -----------------------------------------------------------------------------
* 目录更新必须自动，但不能让自动更新重新变成性能瓶颈。
*
* 所以当前版本采用“三层设计”：
*
* 【第 1 层：只标脏，不重建】
* - 只监听当前 editor 的局部变化
* - 只在可能影响标题时设置 dirty 标记
* - 不在 observer / input 回调里直接 rebuild
*
* 【第 2 层：只在安静时机刷新一次】
* - 用户停止编辑一段时间后再刷新
* - editor blur 时可以触发
* - compositionend 后可以触发
* - 多次变化合并成一次 refresh
*
* 【第 3 层：刷新时只做必要工作】
* - 优先做低频 refresh
* - 必要时才整表重建
* - 不把普通正文变化误当成 TOC 必刷事件
*
* 这个设计的核心不是“实时”，而是：
*
*   准自动、低频、合并、延后。
*
*
* 六、为什么当前版本采用“滚动停止后的伪高亮”
* -----------------------------------------------------------------------------
* 在大文档里，真正容易卡的不是“高亮这个结果”，而是：
*
* - 每次 scroll 都测量
* - 每次 scroll 都同步 TOC
* - 每次 scroll 都滚列表
*
* 所以当前版本的滚动高亮故意做成伪实现：
*
* 1) 正文滚动中：不更新 TOC
* 2) 滚动真正停止后：只算一次当前 active
* 3) 只提交一次 active 样式
* 4) 再延迟一点点，必要时只做一次列表纠偏
*
* 这样做的目的不是“最丝滑”，而是“尽量不制造卡顿”。
*
*
* 七、“双阶段静默判停”的设计原因
* -----------------------------------------------------------------------------
* 用户真实滚动正文时，存在很多非理想情况：
*
* - 鼠标滚轮会连续滚两下，中间有短停顿
* - 拖动滚动条时会时快时慢
* - 中间可能会出现很短的静止片段
*
* 如果判停太灵敏，就会出现：
* - active 过早更新
* - TOC 列表过早纠偏
* - 视觉上忽左忽右，显得不稳
*
* 所以当前版本使用“双阶段静默判停”：
*
* 【阶段 1】
* - scroll 结束后先等待较长静默窗口
*
* 【阶段 2】
* - 再确认一次 scrollTop 是否稳定
* - 确认仍稳定，才视为真正停止
*
* 后续如果还要调优，优先调整静默判停时间，不要先恢复实时同步。
*
*
* 八、TOC 列表为什么使用“安全区纠偏”
* -----------------------------------------------------------------------------
* 仅仅保证 active “可见”还不够。
* 如果高亮项永远贴在可视区顶部/底部边缘，视觉上仍然像“没跟上”。
*
* 所以当前版本不再使用“只要可见就算了”的规则，
* 而是使用“安全区”：
*
* - 列表顶部预留固定安全区
* - 列表底部预留相同安全区
* - 只有当 active item 落在安全区外时，才做纠偏
*
* 当前版本使用：
*
*   SAFEZONE_PX = 24
*
* 并且上下使用相同值，便于后续统一调整。
*
* 这不是“必须显示成第几条”，而是：
*
*   高亮项不要贴边。
*
* 如果后续要调这个值：
* - 变小：更保守，滚动更少，但可能更贴边
* - 变大：更舒适，但列表更容易发生一次小纠偏
*
*
* 九、为什么 TOC 列表不能一味自动拉回
* -----------------------------------------------------------------------------
* 当标题很多（例如 80 个）时，用户有时会手动滚 TOC 列表去浏览后面的标题。
* 如果脚本还在后台坚持：
*
*   “当前 active 是标题 1，所以必须把列表拉回标题 1 附近”
*
* 那用户就永远无法自由翻到标题 80。
*
* 因此当前版本加入：
*
*   手动浏览 TOC 模式（manual TOC browsing mode）
*
* 它的原则是：
*
* - 只要用户正在手动滚 TOC 列表
* - 自动纠偏就暂停
* - active 仍然可以更新
* - 但列表位置不再被脚本强制改写
*
*
* 十、TOC 手动浏览保护的“三层退出条件”
* -----------------------------------------------------------------------------
* 当前版本采用 A + B + C 组合：
*
* A. 用户停止手动滚 TOC 5000ms 后退出手动浏览模式
* B. 用户点击某个 TOC 项时立即退出
* C. 正文发生新一轮滚动，并且真正停止后，也允许退出
*
* 这个设计的目的是：
*
* - 让用户有足够时间浏览长目录
* - 又不会让 TOC 永久失去自动纠偏能力
*
*
* 十一、目录点击跳转的设计原则
* -----------------------------------------------------------------------------
* 当前版本的点击目录跳转是“轻量版”：
*
* 1. 优先使用当前 snapshot 直接跳
* 2. 如果发现 heading / editor / scrollContainer 引用已失效
*    - 只做一次轻量恢复
*    - 然后再重试一次
* 3. 如果轻量恢复后仍失败，再提示用户刷新目录
*
* 这里的“轻量恢复”强调：
* - 只做一次
* - 不走重型自愈链
* - 不在热路径里反复尝试
*
* 当前版本不再使用早期那种：
* - smooth scroll
* - jumpLock
* - finalize 多段收尾
* - 跳转期间冻结/解冻 active 的复杂链路
*
* 因为那条路线虽然更“聪明”，但历史上更容易引入卡顿。
*
*
* 十二、为什么仍然要保留 snapshot
* -----------------------------------------------------------------------------
* 当前版本虽然更轻，但目录本身仍然依赖一份标题快照。
*
* 快照里通常至少要有：
* - heading 节点引用
* - heading 文本
* - heading level
* - TOC item 映射关系
*
* 对于滚动停止后的伪高亮，还可以配合缓存过的 heading top 做低频判断，
* 但不要在每次 scroll 中重新测量全部 heading。
*
* 核心原则是：
*
*   snapshot 是为了减少高频扫描，不是为了追求绝对实时。
*
*
* 十三、为什么必须继续保护中文输入法（IME）
* -----------------------------------------------------------------------------
* 富文本编辑器里，中文输入法是高风险区：
*
* - 新建空标题
* - 立刻输入拼音
* - 如果脚本此时 rebuild / remeasure / ensureVisible / 改焦点
* - 很容易导致首字母异常、输入打断、组词异常
*
* 所以当前版本仍然坚持：
*
* - compositionstart 期间只记账
* - composition 期间不做重活
* - compositionend 后再走延迟刷新
*
* 如果未来出现中文输入异常，优先检查：
* - composition 期间是否仍然触发了目录刷新
* - compositionend 后的刷新是否过早
*
*
* 十四、当前版本最重要的性能原则
* -----------------------------------------------------------------------------
* 后续维护时，必须始终记住这几条：
*
* 1. 不把高频事件直接升级为重活
*    - scroll 不直接 rebuild
*    - input 不直接 rebuild
*    - observer 不直接 rebuild
*
* 2. 任何自动更新，都优先走：
*    - 标脏
*    - 合并
*    - 延后
*    - 只执行一次
*
* 3. 不在热路径里做这些事：
*    - 反复 collectRefs
*    - 反复 detectScrollContainer
*    - 反复 getBoundingClientRect 扫全表
*    - 反复 querySelectorAll 全文档
*    - 反复全量 renderToc
*
* 4. TOC 列表纠偏只处理当前 active item
*    - 不扫整表
*    - 不实时跟随
*    - 不做动画狂刷
*
* 5. 用户主动操作的优先级高于脚本自动纠偏
*    - 用户手动滚 TOC 时，脚本必须让路
*
*
* 十五、当前版本的大致工作流
* -----------------------------------------------------------------------------
* 1. 发现并初始化当前富文本弹窗 root
* 2. 注入样式
* 3. 挂载 TOC 按钮与 TOC 面板
* 4. 默认打开 TOC
* 5. 初次构建 headings snapshot
* 6. 渲染 TOC 列表
* 7. 绑定低频自动更新逻辑（仅 editor 局部）
* 8. 绑定滚动停止后的伪高亮逻辑
* 9. active 变化后，延迟做一次安全区纠偏
* 10. 用户手动浏览 TOC 时，暂停自动纠偏
* 11. 点击 TOC 项时执行跳转；若失效则轻量恢复后重试
* 12. 关闭弹窗或 root 失效时做 cleanup
*
*
* 十六、后续维护建议（非常重要）
* -----------------------------------------------------------------------------
* 如果以后还要继续修改，建议优先按下面顺序排查：
*
* A. 先确认当前 root / editor / scrollContainer 是否拿对
* B. 再确认 snapshot 是否仍与真实 DOM 对齐
* C. 再确认自动目录更新是否被过度触发
* D. 再确认伪高亮是否只在“滚动真正停止后”执行
* E. 再确认安全区纠偏是否只处理当前 active item
* F. 再确认 manual TOC browsing 是否正确让脚本暂停拉回
* G. 再确认 composition 期间是否仍然被正确保护
* H. 最后才去调 UI 细节（边距、阴影、圆角、字号等）
*
*
* 十七、哪些改动最危险
* -----------------------------------------------------------------------------
* 后续如果有人想“顺手增强体验”，下面这些改动最容易重新引入卡顿：
*
* 1) 恢复全局 body subtree MutationObserver
* 2) 恢复实时滚动高亮
* 3) 恢复 TOC 列表实时跟随
* 4) 在点击目录前先自动全量 rebuild
* 5) 在 input / mutation / scroll 中直接测量全部 headings
* 6) 把 safety-zone ensureVisible 做成高频实时逻辑
* 7) 去掉 manual TOC browsing 保护
*
* 一句话：
*
*   任何“为了更聪明”而新增的逻辑，都必须先问自己：
*   它会不会重新进入高频热路径？
*
*
* 十八、结论
* -----------------------------------------------------------------------------
* 当前版本不是最炫的 TOC，也不是功能最满的 TOC。
* 它是一版在 NocoDB 动态富文本弹窗里，经多轮排错后收敛出来的：
*
*   “性能优先、低频同步、显式纠偏、允许适度延迟、重视用户手动浏览权”的 TOC。
*
* 它的设计不是追求“每一瞬间都绝对正确”，而是追求：
*
*   在大量标题、长文档、真实编辑与滚动场景下，尽量稳定、尽量不卡。
*
* 后续如果继续演进，必须始终把“不卡顿”放在第一位。
* =============================================================================
*/

(function () {
 'use strict';

 /*
  * v44 部分 ProseMirror 重构说明：
  * - 标题数据优先来自 editor.state.doc，而不是 DOM querySelectorAll。
  * - 标题变更优先由 ProseMirror plugin 的 docChanged 通知触发，再做低频签名比对。
  * - TOC 面板、按钮定位、滚动容器、点击跳转、安全区纠偏仍保留 DOM 方案。
  * - 如果 ProseMirror bridge 或 heading 映射失败，会自动回退到原 DOM 标题扫描 + 局部 MutationObserver。
  * - v45 补回 TOC 宽度拖拽调节：拖动面板右边缘调整宽度，双击恢复默认宽度。
  * - v46 删除宽度持久化记忆；默认 TOC 宽度加宽。
  */

 const CONFIG = {
   rootSelector: '.nc-long-text-expanded-modal .expanded-cell-input',
   titleTextContainerSelector: '.max-w-38',
   contentWrapSelector: '.nc-rich-text-content',
   editorSelector: '.nc-rich-text-content .tiptap.ProseMirror',
   panelWidth: 200,
   panelMinWidth: 132,
   panelMaxWidth: 360,
   panelResizeHandleWidth: 8,
   panelGap: 8,
   contentInsetExtra: -2,
   panelInsetY: 1,
   panelBottomGap: 2,
   buttonGap: 8,
   anchorTop: 9,
   initialBuildDelay: 260,
   defaultOpen: true,
   autoRefreshDelay: 1100,
   compositionRefreshDelay: 700,
   scrollQuietStage1Ms: 460,
   scrollQuietStage2Ms: 220,
   scrollAnchorTop: 18,
   ensureVisibleSafePadding: 24,
   ensureVisibleDelayMs: 140,
   tocManualBrowseIdleMs: 5000,
   pmHeadingCheckDelay: 220,
 };

 const CLASS = {
   rootReady: 'tm-rtoc-ready-v38',
   rootOpen: 'tm-rtoc-open-v38',
   button: 'tm-rtoc-button-v38',
   buttonReady: 'tm-rtoc-button-ready-v38',
   panel: 'tm-rtoc-panel-v38',
   resizer: 'tm-rtoc-resizer-v45',
   resizing: 'tm-rtoc-resizing-v45',
   visible: 'tm-rtoc-visible-v38',
   list: 'tm-rtoc-list-v38',
   item: 'tm-rtoc-item-v38',
   active: 'is-active',
   status: 'tm-rtoc-status-v38',
   statusHint: 'is-hint',
   statusWarn: 'is-warn',
 };

 const STYLE_ID = 'tm-rtoc-style-v38';
 const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
 const HEADING_DATA_KEY = 'tmRtocStaticId';
 const PM_BRIDGE_INSTALLED_KEY = '__tmRtocPmBridgeInstalledV44';
 const PM_BRIDGE_CALLBACK_KEY = '__tmRtocPmBridgeCallbackV44';
 const STATUS_TEXT = {
   hint: '',
   stale: '目录已过期，请点刷新。',
   building: '正在构建目录...',
 };

 let uidSeed = 1;
 let currentState = null;
 let discoverQueued = false;
 let resizeQueued = false;

 function injectStyle() {
   if (document.getElementById(STYLE_ID)) return;

   const css = `
     .${CLASS.rootReady} {
       position: relative !important;
       overflow: visible !important;
       --tm-rtoc-panel-width: ${CONFIG.panelWidth}px;
       --tm-rtoc-panel-gap: ${CONFIG.panelGap}px;
       --tm-rtoc-left-inset: ${getContentInsetForPanelWidth(CONFIG.panelWidth)}px;
     }

     .${CLASS.button} {
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
       transition: opacity .16s ease;
     }

     .${CLASS.button}.${CLASS.buttonReady} {
       visibility: visible;
       opacity: 1;
     }

     .${CLASS.button}.${CLASS.active} {
       background: rgba(59, 130, 246, 0.12);
       color: #1d4ed8;
     }

     .${CLASS.panel} {
       position: absolute;
       z-index: 25;
       display: none;
       left: 0;
       box-sizing: border-box;
       width: var(--tm-rtoc-panel-width);
       min-width: var(--tm-rtoc-panel-width);
       max-width: var(--tm-rtoc-panel-width);
       border: 1px solid rgba(15, 23, 42, 0.10);
       border-radius: 10px;
       background: var(--nc-bg-default, #fff);
       box-shadow:
         inset 0 0 0 1px rgba(255, 255, 255, 0.28),
         0 1px 2px rgba(15, 23, 42, 0.04),
         0 6px 18px rgba(15, 23, 42, 0.06);
       overflow: hidden;
     }

     .${CLASS.resizer} {
       position: absolute;
       z-index: 4;
       top: 0;
       right: 0;
       bottom: 0;
       width: ${CONFIG.panelResizeHandleWidth}px;
       cursor: ew-resize;
       touch-action: none;
       background: transparent;
     }

     .${CLASS.resizer}:hover,
     .${CLASS.rootReady}.${CLASS.resizing} .${CLASS.resizer} {
       background: rgba(59, 130, 246, 0.12);
     }

     .${CLASS.rootReady}.${CLASS.resizing},
     .${CLASS.rootReady}.${CLASS.resizing} * {
       cursor: ew-resize !important;
       user-select: none !important;
     }

     .${CLASS.panel}.${CLASS.visible} {
       display: block;
     }

     .${CLASS.rootOpen} .nc-rich-text-content .tiptap.ProseMirror {
       padding-left: var(--tm-rtoc-left-inset) !important;
       box-sizing: border-box !important;
     }

     .tm-rtoc-panel-inner-v38 {
       display: flex;
       flex-direction: column;
       height: 100%;
       min-height: 0;
     }

     .tm-rtoc-title-v38 {
       flex: 0 0 auto;
       display: flex;
       align-items: center;
       justify-content: space-between;
       gap: 8px;
       padding: 10px 10px 9px 10px;
       color: #222;
       background: rgba(15, 23, 42, 0.04);
       border-bottom: 1px solid rgba(15, 23, 42, 0.12);
       box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.3);
     }

     .tm-rtoc-title-main-v38 {
       min-width: 0;
       display: flex;
       align-items: center;
       gap: 6px;
       white-space: nowrap;
     }

     .tm-rtoc-title-label-v38 {
       font-size: 12px;
       font-weight: 700;
       color: #4b5563;
     }

     .tm-rtoc-title-count-v38 {
       display: inline-flex;
       align-items: center;
       justify-content: center;
       min-width: 28px;
       height: 20px;
       padding: 0 7px;
       border-radius: 999px;
       background: rgba(59, 130, 246, 0.12);
       color: #3559b5;
       font-size: 12px;
       font-weight: 700;
       line-height: 1;
     }

     .tm-rtoc-title-actions-v38 {
       flex: 0 0 auto;
       display: inline-flex;
       align-items: center;
       gap: 4px;
     }

     .tm-rtoc-icon-btn-v38 {
       display: inline-flex;
       align-items: center;
       justify-content: center;
       width: 24px;
       height: 24px;
       border: 0;
       border-radius: 7px;
       background: transparent;
       color: #4b5563;
       cursor: pointer;
       flex: 0 0 auto;
     }

     .tm-rtoc-icon-btn-v38 svg {
       width: 14px;
       height: 14px;
       display: block;
     }

     .tm-rtoc-icon-btn-v38:hover {
       background: rgba(0, 0, 0, 0.05);
       color: #111827;
     }

     .${CLASS.status} {
       flex: 0 0 auto;
       font-size: 12px;
       line-height: 1.45;
       padding: 7px 8px;
       border-bottom: 1px solid rgba(15, 23, 42, 0.08);
     }

     .${CLASS.status}.${CLASS.statusHint} {
       color: #6b7280;
       background: rgba(15, 23, 42, 0.03);
     }

     .${CLASS.status}.${CLASS.statusWarn} {
       color: #8b5e00;
       background: rgba(245, 158, 11, 0.10);
     }

     .${CLASS.list} {
       position: relative;
       flex: 1 1 auto;
       min-height: 0;
       overflow: auto;
       padding: 6px;
     }

     .tm-rtoc-empty-v38 {
       font-size: 12px;
       color: #666;
       line-height: 1.5;
       padding: 6px;
     }

     .${CLASS.item} {
       display: block;
       width: 100%;
       border: 0;
       background: transparent;
       text-align: left;
       padding: 6px 8px;
       margin: 0 0 2px 0;
       border-radius: 8px;
       cursor: pointer;
       color: #222;
       font-size: 13px;
       line-height: 1.35;
       white-space: nowrap;
       overflow: hidden;
       text-overflow: ellipsis;
     }

     .${CLASS.item}:hover {
       background: rgba(0, 0, 0, 0.05);
     }

     .${CLASS.item}.${CLASS.active} {
       background: rgba(59, 130, 246, 0.16);
       color: #1d4ed8;
     }

     .tm-rtoc-l1 { padding-left: 8px;  font-weight: 700; }
     .tm-rtoc-l2 { padding-left: 16px; font-weight: 600; }
     .tm-rtoc-l3 { padding-left: 24px; }
     .tm-rtoc-l4 { padding-left: 32px; }
     .tm-rtoc-l5 { padding-left: 40px; }
     .tm-rtoc-l6 { padding-left: 48px; }
   `;

   const style = document.createElement('style');
   style.id = STYLE_ID;
   style.textContent = css;
   document.head.appendChild(style);
 }

 function stopAll(e) {
   if (!e) return;
   e.preventDefault();
   e.stopPropagation();
   if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
 }

 function stopBubbleOnly(e) {
   if (!e) return;
   e.stopPropagation();
 }

 function isElementHiddenByStyle(el) {
   if (!(el instanceof HTMLElement)) return true;
   const style = getComputedStyle(el);
   if (style.display === 'none') return true;
   if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
   if (el.getAttribute('aria-hidden') === 'true') return true;
   return false;
 }

 function isElementActuallyVisible(el) {
   if (!(el instanceof HTMLElement) || !document.contains(el)) return false;
   let cur = el;
   while (cur instanceof HTMLElement && cur !== document.body) {
     if (isElementHiddenByStyle(cur)) return false;
     cur = cur.parentElement;
   }
   const rect = el.getBoundingClientRect();
   return rect.width > 0 && rect.height > 0;
 }

 function getTitleBar(root) {
   if (!(root instanceof HTMLElement)) return null;
   return root.querySelector(':scope > .cursor-move') || root.firstElementChild;
 }

 function getTitleTextBox(titleBar) {
   if (!(titleBar instanceof HTMLElement)) return null;
   const direct = titleBar.querySelector(CONFIG.titleTextContainerSelector);
   if (direct instanceof HTMLElement) return direct;
   const truncate = titleBar.querySelector('.truncate');
   return truncate instanceof HTMLElement && truncate.parentElement instanceof HTMLElement
     ? truncate.parentElement
     : null;
 }

 function isScrollableElement(el) {
   if (!(el instanceof HTMLElement)) return false;
   const style = getComputedStyle(el);
   const overflowY = style.overflowY || style.overflow;
   if (!/(auto|scroll|overlay)/.test(overflowY)) return false;
   return el.scrollHeight - el.clientHeight > 2;
 }

 function detectScrollContainer(editor, contentWrap, root) {
   const visited = new Set();
   const candidates = [];

   if (editor instanceof HTMLElement) candidates.push(editor);
   if (contentWrap instanceof HTMLElement) candidates.push(contentWrap);

   let cur = editor instanceof HTMLElement ? editor.parentElement : null;
   while (cur && cur instanceof HTMLElement && cur !== root) {
     if (!visited.has(cur)) candidates.push(cur);
     cur = cur.parentElement;
   }
   if (root instanceof HTMLElement) candidates.push(root);

   for (const el of candidates) {
     if (!(el instanceof HTMLElement) || visited.has(el)) continue;
     visited.add(el);
     if (isScrollableElement(el)) return el;
   }

   return contentWrap instanceof HTMLElement ? contentWrap : editor;
 }

 function collectRefs(root) {
   if (!(root instanceof HTMLElement)) return null;
   const titleBar = getTitleBar(root);
   const titleTextBox = getTitleTextBox(titleBar);
   const contentWrap = root.querySelector(CONFIG.contentWrapSelector);
   const editor = root.querySelector(CONFIG.editorSelector);

   if (!(titleBar instanceof HTMLElement) || !(titleTextBox instanceof HTMLElement) || !(contentWrap instanceof HTMLElement) || !(editor instanceof HTMLElement)) {
     return null;
   }

   const scrollContainer = detectScrollContainer(editor, contentWrap, root);
   if (!(scrollContainer instanceof HTMLElement)) return null;

   return { root, titleBar, titleTextBox, contentWrap, editor, scrollContainer };
 }

 function getOffsetTopWithinAncestor(el, ancestor) {
   let top = 0;
   let node = el;
   while (node && node instanceof HTMLElement && node !== ancestor) {
     top += node.offsetTop;
     node = node.offsetParent;
   }
   return node === ancestor ? top : null;
 }


 function getPanelWidthBounds(state) {
   const min = Math.max(96, Number(CONFIG.panelMinWidth) || CONFIG.panelWidth);
   let max = Math.max(min, Number(CONFIG.panelMaxWidth) || CONFIG.panelWidth);
   if (state && state.root instanceof HTMLElement) {
     const rootMax = Math.max(min, Math.round(state.root.clientWidth - 120));
     max = Math.min(max, rootMax);
   }
   return { min, max };
 }

 function clampPanelWidth(state, width) {
   const bounds = getPanelWidthBounds(state);
   const raw = Number(width);
   const safe = Number.isFinite(raw) ? raw : CONFIG.panelWidth;
   return Math.max(bounds.min, Math.min(bounds.max, Math.round(safe)));
 }

 function getContentInsetForPanelWidth(width) {
   const extra = Number(CONFIG.contentInsetExtra) || 0;
   return Math.max(0, Math.round((Number(width) || CONFIG.panelWidth) + extra));
 }

 function applyPanelWidth(state, width) {
   if (!state || !(state.root instanceof HTMLElement)) return CONFIG.panelWidth;
   const safeWidth = clampPanelWidth(state, width);
   state.panelWidth = safeWidth;
   state.root.style.setProperty('--tm-rtoc-panel-width', `${safeWidth}px`);
   state.root.style.setProperty('--tm-rtoc-left-inset', `${getContentInsetForPanelWidth(safeWidth)}px`);
   return safeWidth;
 }

 function getPointerClientX(e) {
   const x = e && Number(e.clientX);
   return Number.isFinite(x) ? x : null;
 }

 function clearPanelResizeFrame(state) {
   if (!state) return;
   if (state.panelResizeRaf) {
     cancelAnimationFrame(state.panelResizeRaf);
     state.panelResizeRaf = null;
   }
 }

 function schedulePanelWidthApply(state, width) {
   if (!state || state.destroyed) return;
   state.pendingPanelWidth = width;
   if (state.panelResizeRaf) return;
   state.panelResizeRaf = requestAnimationFrame(() => {
     state.panelResizeRaf = null;
     if (!state || state.destroyed) return;
     applyPanelWidth(state, state.pendingPanelWidth);
     positionPanel(state);
   });
 }

 function stopPanelWidthResize(state, applyFinalWidth = false) {
   if (!state) return;
   if (state.onPanelResizeMove) {
     document.removeEventListener('pointermove', state.onPanelResizeMove, true);
   }
   if (state.onPanelResizeEnd) {
     document.removeEventListener('pointerup', state.onPanelResizeEnd, true);
     document.removeEventListener('pointercancel', state.onPanelResizeEnd, true);
   }
   state.onPanelResizeMove = null;
   state.onPanelResizeEnd = null;
   state.panelResizeDragging = false;
   if (state.root instanceof HTMLElement) state.root.classList.remove(CLASS.resizing);
   clearPanelResizeFrame(state);
   if (applyFinalWidth) {
     applyPanelWidth(state, state.pendingPanelWidth || state.panelWidth || CONFIG.panelWidth);
     positionUI(state);
   }
 }

 function startPanelWidthResize(state, e) {
   if (!(state && state.open && state.panel instanceof HTMLElement)) return;
   const startX = getPointerClientX(e);
   if (startX == null) return;

   stopAll(e);
   stopPanelWidthResize(state, false);

   state.panelResizeDragging = true;
   state.panelResizeStartX = startX;
   state.panelResizeStartWidth = clampPanelWidth(state, state.panelWidth || CONFIG.panelWidth);
   state.pendingPanelWidth = state.panelResizeStartWidth;
   if (state.root instanceof HTMLElement) state.root.classList.add(CLASS.resizing);

   if (e && e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function' && e.pointerId != null) {
     try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
   }

   state.onPanelResizeMove = (moveEvent) => {
     if (!state || state.destroyed || !state.panelResizeDragging) return;
     const clientX = getPointerClientX(moveEvent);
     if (clientX == null) return;
     if (moveEvent && typeof moveEvent.preventDefault === 'function') moveEvent.preventDefault();
     const nextWidth = state.panelResizeStartWidth + (clientX - state.panelResizeStartX);
     schedulePanelWidthApply(state, nextWidth);
   };

   state.onPanelResizeEnd = (endEvent) => {
     if (endEvent && typeof endEvent.preventDefault === 'function') endEvent.preventDefault();
     stopPanelWidthResize(state, true);
   };

   document.addEventListener('pointermove', state.onPanelResizeMove, true);
   document.addEventListener('pointerup', state.onPanelResizeEnd, true);
   document.addEventListener('pointercancel', state.onPanelResizeEnd, true);
 }

 function resetPanelWidth(state) {
   if (!state || state.destroyed) return;
   stopPanelWidthResize(state, false);
   applyPanelWidth(state, CONFIG.panelWidth);
   positionUI(state);
 }

 function ensureHeadingId(el) {
   if (!(el instanceof HTMLElement)) return '';
   if (!el.dataset[HEADING_DATA_KEY]) {
     el.dataset[HEADING_DATA_KEY] = `tm-rtoc-static-${uidSeed++}`;
   }
   return el.dataset[HEADING_DATA_KEY] || '';
 }

 function normalizeHeadingText(text) {
   return String(text || '').replace(/\s+/g, ' ').trim();
 }

 function getHeadingLevelFromElement(el) {
   if (!(el instanceof HTMLElement)) return 1;
   const tag = (el.tagName || 'H1').toUpperCase();
   return Math.max(1, Math.min(6, Number.parseInt(tag.replace('H', ''), 10) || 1));
 }

 function getLiveHeadingNodes(editor) {
   if (!(editor instanceof HTMLElement)) return [];
   return Array.from(editor.querySelectorAll(HEADING_SELECTOR)).filter((node) => {
     if (!(node instanceof HTMLElement)) return false;
     return normalizeHeadingText(node.textContent).length > 0;
   });
 }

 function getTiptapEditorFromDom(editorDom) {
   if (!(editorDom instanceof HTMLElement)) return null;
   const tiptap = editorDom.editor;
   if (!tiptap || typeof tiptap !== 'object') return null;
   if (!tiptap.view || !tiptap.state) return null;
   if (!tiptap.view.dom || tiptap.view.dom !== editorDom) return null;
   return tiptap;
 }

 function getPmViewFromState(state) {
   if (!state || state.destroyed) return null;
   const tiptap = getTiptapEditorFromDom(state.editor);
   if (!tiptap || !tiptap.view || !tiptap.state) return null;
   return tiptap.view;
 }

 function getPmPluginCtor(tiptap) {
   const plugins = tiptap && tiptap.state && (tiptap.state.plugins || (tiptap.state.config && tiptap.state.config.plugins));
   if (!Array.isArray(plugins) || !plugins.length) return null;
   const ctor = plugins[0] && plugins[0].constructor;
   return typeof ctor === 'function' ? ctor : null;
 }

 function getPmHeadingInfo(node) {
   if (!node || !node.type) return null;
   const typeName = String(node.type.name || '').toLowerCase();
   let level = null;

   if (typeName === 'heading') {
     level = node.attrs && Number(node.attrs.level);
   } else if (/^h[1-6]$/.test(typeName)) {
     level = Number(typeName.slice(1));
   }

   if (!Number.isFinite(level)) return null;
   return { level: Math.max(1, Math.min(6, level || 1)) };
 }

 function getPmNodeText(node) {
   if (!node) return '';
   if (typeof node.textContent === 'string') return normalizeHeadingText(node.textContent);
   if (typeof node.textBetween === 'function') {
     const size = node.content && Number.isFinite(node.content.size) ? node.content.size : 0;
     return normalizeHeadingText(node.textBetween(0, size, ' ', ' '));
   }
   return '';
 }

 function collectPmHeadingEntries(pmState) {
   const entries = [];
   const doc = pmState && pmState.doc;
   if (!doc || typeof doc.descendants !== 'function') return entries;

   doc.descendants((node, pos) => {
     const info = getPmHeadingInfo(node);
     if (!info) return true;

     const text = getPmNodeText(node);
     if (text) {
       entries.push({
         pos: Number(pos) || 0,
         level: info.level,
         text,
       });
     }
     return false;
   });

   return entries;
 }

 function buildHeadingSignatureFromEntries(entries) {
   if (!Array.isArray(entries) || !entries.length) return '';
   return entries.map((heading) => {
     const level = Number.isFinite(heading && heading.level) ? heading.level : 1;
     const text = heading && typeof heading.text === 'string' ? heading.text : '';
     return `${level}:${text.length}:${text}`;
   }).join('\n');
 }

 function domNodeToHeadingElement(dom, editorDom) {
   let cur = null;
   if (dom instanceof HTMLElement) cur = dom;
   else if (dom instanceof Text && dom.parentElement instanceof HTMLElement) cur = dom.parentElement;
   else if (dom instanceof Node && dom.parentElement instanceof HTMLElement) cur = dom.parentElement;

   while (cur instanceof HTMLElement) {
     if (cur.matches && cur.matches(HEADING_SELECTOR)) return cur;
     if (editorDom instanceof HTMLElement && cur === editorDom) break;
     cur = cur.parentElement;
   }

   if (dom instanceof HTMLElement) {
     const nested = dom.querySelector && dom.querySelector(HEADING_SELECTOR);
     if (nested instanceof HTMLElement) return nested;
   }

   return null;
 }

 function resolveHeadingElementByCoords(view, pos) {
   if (!view || typeof view.coordsAtPos !== 'function') return null;
   const docSize = view.state && view.state.doc && Number.isFinite(view.state.doc.content && view.state.doc.content.size)
     ? view.state.doc.content.size
     : null;
   const candidates = [pos + 1, pos];

   for (const candidatePos of candidates) {
     if (!Number.isFinite(candidatePos) || candidatePos < 0) continue;
     if (Number.isFinite(docSize) && candidatePos > docSize) continue;
     try {
       const rect = view.coordsAtPos(candidatePos);
       if (!rect) continue;
       const x = Math.max(0, Math.min(window.innerWidth - 1, Math.round((rect.left + rect.right) / 2)));
       const y = Math.max(0, Math.min(window.innerHeight - 1, Math.round((rect.top + rect.bottom) / 2)));
       const hit = document.elementFromPoint(x, y);
       const heading = domNodeToHeadingElement(hit, view.dom);
       if (heading) return heading;
     } catch (_) {}
   }

   return null;
 }

 function resolveHeadingElementFromPm(view, entry, fallbackEl) {
   if (!view || !entry) return fallbackEl instanceof HTMLElement ? fallbackEl : null;

   try {
     const dom = typeof view.nodeDOM === 'function' ? view.nodeDOM(entry.pos) : null;
     const heading = domNodeToHeadingElement(dom, view.dom);
     if (heading) return heading;
   } catch (_) {}

   const fromCoords = resolveHeadingElementByCoords(view, entry.pos);
   if (fromCoords) return fromCoords;

   if (fallbackEl instanceof HTMLElement) return fallbackEl;
   return null;
 }

 function getHeadingTopWithinScroller(el, scrollContainer) {
   if (!(el instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return 0;
   let top = getOffsetTopWithinAncestor(el, scrollContainer);
   if (top == null) {
     const headingRect = el.getBoundingClientRect();
     const scrollerRect = scrollContainer.getBoundingClientRect();
     top = scrollContainer.scrollTop + (headingRect.top - scrollerRect.top);
   }
   return Math.max(0, Math.round(Number(top) || 0));
 }

 function buildDomHeadingSnapshot(state) {
   if (!(state && state.editor instanceof HTMLElement)) return null;
   const nodes = getLiveHeadingNodes(state.editor);
   const headings = nodes.map((el) => {
     return {
       id: ensureHeadingId(el),
       el,
       level: getHeadingLevelFromElement(el),
       text: normalizeHeadingText(el.textContent),
       top: getHeadingTopWithinScroller(el, state.scrollContainer),
       pos: null,
       source: 'dom',
     };
   });
   return {
     headings,
     signature: buildHeadingSignatureFromEntries(headings),
     source: 'dom',
   };
 }

 function buildPmHeadingSnapshot(state) {
   const view = getPmViewFromState(state);
   if (!view || !view.state || !view.state.doc) return null;

   const entries = collectPmHeadingEntries(view.state);
   const fallbackDomHeadings = getLiveHeadingNodes(state.editor);

   if (!entries.length) {
     if (fallbackDomHeadings.length) return null;
     return { headings: [], signature: '', source: 'pm' };
   }

   const headings = [];
   for (let index = 0; index < entries.length; index += 1) {
     const entry = entries[index];
     const el = resolveHeadingElementFromPm(view, entry, fallbackDomHeadings[index]);
     if (!(el instanceof HTMLElement)) return null;
     headings.push({
       id: ensureHeadingId(el),
       el,
       level: entry.level,
       text: entry.text,
       top: getHeadingTopWithinScroller(el, state.scrollContainer),
       pos: entry.pos,
       source: 'pm',
     });
   }

   return {
     headings,
     signature: buildHeadingSignatureFromEntries(entries),
     source: 'pm',
   };
 }

 function clearPmHeadingCheckTimer(state) {
   if (!state) return;
   if (state.pmHeadingCheckTimer) {
     clearTimeout(state.pmHeadingCheckTimer);
     state.pmHeadingCheckTimer = null;
   }
 }

 function flushPmHeadingCheck(state) {
   if (!state || state.destroyed || !state.open || state.tocDirty) return false;
   if (state.headingSource !== 'pm') return false;

   const view = getPmViewFromState(state);
   if (!view || !view.state) return false;

   const entries = collectPmHeadingEntries(view.state);
   const nextSignature = buildHeadingSignatureFromEntries(entries);
   if (nextSignature !== state.headingSignature) {
     markTocDirty(state, 'pm-heading-change');
     return true;
   }
   return false;
 }

 function schedulePmHeadingCheck(state, delay = CONFIG.pmHeadingCheckDelay) {
   if (!state || state.destroyed || !state.open || !state.pmBridgeReady || state.tocDirty) return;
   if (state.isComposing) {
     state.pmDocChangedDuringComposition = true;
     return;
   }

   clearPmHeadingCheckTimer(state);
   const wait = Math.max(0, Number(delay) || 0);
   state.pmHeadingCheckTimer = setTimeout(() => {
     state.pmHeadingCheckTimer = null;
     flushPmHeadingCheck(state);
   }, wait);
 }

 function handlePmDocChanged(state) {
   if (!state || state.destroyed || !state.open) return;
   schedulePmHeadingCheck(state);
 }

 function detachPmBridge(state) {
   if (!state) return;
   clearPmHeadingCheckTimer(state);
   if (state.pmEditor && state.pmBridgeToken && state.pmEditor[PM_BRIDGE_CALLBACK_KEY]) {
     const current = state.pmEditor[PM_BRIDGE_CALLBACK_KEY];
     if (current && current.token === state.pmBridgeToken) {
       state.pmEditor[PM_BRIDGE_CALLBACK_KEY] = null;
     }
   }
   state.pmEditor = null;
   state.pmBridgeToken = null;
   state.pmBridgeReady = false;
   state.pmDocChangedDuringComposition = false;
 }

 function ensurePmBridge(state) {
   if (!state || state.destroyed || !(state.editor instanceof HTMLElement)) return false;
   const tiptap = getTiptapEditorFromDom(state.editor);
   if (!tiptap || typeof tiptap.registerPlugin !== 'function') {
     detachPmBridge(state);
     return false;
   }

   if (state.pmEditor && state.pmEditor !== tiptap) detachPmBridge(state);

   const token = state.pmBridgeToken || {};
   state.pmBridgeToken = token;
   state.pmEditor = tiptap;
   tiptap[PM_BRIDGE_CALLBACK_KEY] = {
     token,
     onDocChanged: () => handlePmDocChanged(state),
   };

   if (!tiptap[PM_BRIDGE_INSTALLED_KEY]) {
     const PluginCtor = getPmPluginCtor(tiptap);
     if (!PluginCtor) {
       detachPmBridge(state);
       return false;
     }

     try {
       const plugin = new PluginCtor({
         view() {
           return {
             update(view, prevState) {
               if (!prevState || !view || !view.state || view.state.doc === prevState.doc) return;
               const callback = tiptap[PM_BRIDGE_CALLBACK_KEY];
               if (callback && typeof callback.onDocChanged === 'function') {
                 callback.onDocChanged(view, prevState);
               }
             },
           };
         },
       });
       tiptap.registerPlugin(plugin);
       tiptap[PM_BRIDGE_INSTALLED_KEY] = true;
     } catch (_) {
       detachPmBridge(state);
       return false;
     }
   }

   state.pmBridgeReady = true;
   return true;
 }

 function shouldUseFallbackMutationObserver(state) {
   return !(state && state.pmBridgeReady && state.headingSource === 'pm');
 }

 function syncFallbackMutationObserver(state) {
   if (!state || state.destroyed || !state.open) return;
   if (!shouldUseFallbackMutationObserver(state)) {
     if (state.mutationObserver) {
       try { state.mutationObserver.disconnect(); } catch (_) {}
       state.mutationObserver = null;
     }
     return;
   }

   if (!(state.editor instanceof HTMLElement)) return;
   if (state.mutationObserver) return;

   state.mutationObserver = new MutationObserver((mutations) => {
     if (!state || state.destroyed || !state.open || !(state.editor instanceof HTMLElement)) return;
     if (mutationMayAffectHeadings(mutations, state.editor)) markTocDirty(state, 'heading-mutation-fallback');
   });
   state.mutationObserver.observe(state.editor, {
     childList: true,
     subtree: true,
     characterData: true,
   });
 }

 function findActiveRoot() {
   const roots = Array.from(document.querySelectorAll(CONFIG.rootSelector)).filter((root) => {
     return root instanceof HTMLElement && isElementActuallyVisible(root);
   });
   return roots.length ? roots[roots.length - 1] : null;
 }

 function attachActionButton(btn, handler) {
   if (!(btn instanceof HTMLElement)) return;
   btn.addEventListener('pointerdown', stopAll, true);
   btn.addEventListener('mousedown', stopAll, true);
   btn.addEventListener('mouseup', stopAll, true);
   btn.addEventListener('click', (e) => {
     stopAll(e);
     handler();
   }, true);
 }

 function refsStillBelongToRoot(state) {
   if (!state || state.destroyed || !(state.root instanceof HTMLElement)) return false;
   return (
     state.titleBar instanceof HTMLElement && state.root.contains(state.titleBar) &&
     state.titleTextBox instanceof HTMLElement && state.root.contains(state.titleTextBox) &&
     state.contentWrap instanceof HTMLElement && state.root.contains(state.contentWrap) &&
     state.editor instanceof HTMLElement && state.root.contains(state.editor) &&
     state.scrollContainer instanceof HTMLElement && state.root.contains(state.scrollContainer)
   );
 }

 function refreshCachedRefs(state) {
   if (!state || state.destroyed) return false;
   const prevEditor = state.editor;
   const prevScroller = state.scrollContainer;
   const refs = collectRefs(state.root);
   if (!refs) return false;
   const changed = prevEditor !== refs.editor || prevScroller !== refs.scrollContainer;
   if (state.open && changed) {
     unbindOpenRuntime(state);
   }
   Object.assign(state, refs);
   if (state.open && changed) {
     bindOpenRuntime(state);
   }
   return true;
 }

 function setStatus(state, kind, text) {
   if (!(state && state.status instanceof HTMLElement)) return;
   state.status.className = CLASS.status;
   if (kind === 'warn') state.status.classList.add(CLASS.statusWarn);
   else state.status.classList.add(CLASS.statusHint);
   state.status.textContent = text || '';
   state.status.style.display = text ? '' : 'none';
 }

 function updateCount(state) {
   if (state.titleCount instanceof HTMLElement) {
     state.titleCount.textContent = String(state.headings.length || 0);
   }
 }

 function setActiveItem(state, index) {
   state.lastClickedIndex = Number.isInteger(index) ? index : -1;
   if (!(state.list instanceof HTMLElement)) return false;
   let changed = false;
   const items = state.list.querySelectorAll(`.${CLASS.item}`);
   items.forEach((item, itemIndex) => {
     if (!(item instanceof HTMLElement)) return;
     const shouldActive = itemIndex === state.lastClickedIndex;
     if (item.classList.contains(CLASS.active) !== shouldActive) changed = true;
     item.classList.toggle(CLASS.active, shouldActive);
   });
   return changed;
 }

 function getItemByIndex(state, index) {
   if (!(state && state.list instanceof HTMLElement) || !Number.isInteger(index) || index < 0) return null;
   const item = state.list.querySelector(`.${CLASS.item}[data-index="${index}"]`);
   return item instanceof HTMLElement ? item : null;
 }

 function clearEnsureVisibleTimer(state) {
   if (!state) return;
   if (state.ensureVisibleTimer) {
     clearTimeout(state.ensureVisibleTimer);
     state.ensureVisibleTimer = null;
   }
 }


 function clearManualTocBrowseTimer(state) {
   if (!state) return;
   if (state.manualTocBrowseTimer) {
     clearTimeout(state.manualTocBrowseTimer);
     state.manualTocBrowseTimer = null;
   }
 }

 function exitManualTocBrowsing(state, scheduleEnsure = false, delay = CONFIG.ensureVisibleDelayMs) {
   if (!state) return;
   clearManualTocBrowseTimer(state);
   state.manualTocBrowsing = false;
   if (scheduleEnsure && state.open) {
     scheduleEnsureActiveItemVisible(state, true, delay);
   }
 }

 function enterManualTocBrowsing(state) {
   if (!(state && state.open && state.list instanceof HTMLElement)) return;
   state.manualTocBrowsing = true;
   clearEnsureVisibleTimer(state);
   clearManualTocBrowseTimer(state);
   state.manualTocBrowseTimer = setTimeout(() => {
     state.manualTocBrowseTimer = null;
     if (!state || state.destroyed || !state.open) return;
     exitManualTocBrowsing(state, true, 140);
   }, CONFIG.tocManualBrowseIdleMs);
 }

 function ensureActiveItemVisibleSafe(state, force = false) {
   if (!(state && state.list instanceof HTMLElement)) return;
   const item = getItemByIndex(state, state.lastClickedIndex);
   if (!(item instanceof HTMLElement)) return;

   const list = state.list;
   const pad = Math.max(0, Number(CONFIG.ensureVisibleSafePadding) || 0);
   const itemTop = item.offsetTop;
   const itemBottom = itemTop + item.offsetHeight;
   const viewTop = list.scrollTop;
   const viewBottom = viewTop + list.clientHeight;
   const safeTop = viewTop + pad;
   const safeBottom = viewBottom - pad;

   if (!force && itemTop >= safeTop && itemBottom <= safeBottom) return;

   let target = viewTop;
   if (itemTop < safeTop) {
     target = itemTop - pad;
   } else if (itemBottom > safeBottom) {
     target = itemBottom - list.clientHeight + pad;
   }

   const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
   if (state.lastClickedIndex === 0) target = 0;
   else if (state.lastClickedIndex === state.headings.length - 1) target = maxScrollTop;

   target = Math.max(0, Math.min(maxScrollTop, Math.round(target)));
   if (Math.abs(target - list.scrollTop) > 1) {
     state.listProgrammaticScrollUntil = Date.now() + 260;
     list.scrollTop = target;
   }
 }

 function scheduleEnsureActiveItemVisible(state, force = false, delay = CONFIG.ensureVisibleDelayMs) {
   if (!(state && state.open)) return;
   if (state.manualTocBrowsing) return;
   clearEnsureVisibleTimer(state);
   const wait = Math.max(0, Number(delay) || 0);
   state.ensureVisibleTimer = setTimeout(() => {
     state.ensureVisibleTimer = null;
     if (!state || state.destroyed || !state.open || state.manualTocBrowsing) return;
     ensureActiveItemVisibleSafe(state, force);
   }, wait);
 }

 function nodeOrAncestorHeading(node, editor) {
   let cur = node instanceof Node ? node : null;
   while (cur) {
     if (cur instanceof HTMLElement) {
       if (cur.matches && cur.matches(HEADING_SELECTOR)) return cur;
       if (editor instanceof HTMLElement && cur === editor) break;
     }
     cur = cur.parentNode;
   }
   return null;
 }

 function nodeTouchesHeading(node, editor) {
   if (!(node instanceof Node) || !(editor instanceof HTMLElement)) return false;
   if (nodeOrAncestorHeading(node, editor)) return true;
   if (node instanceof Element) {
     if (node.matches(HEADING_SELECTOR)) return true;
     return !!node.querySelector(HEADING_SELECTOR);
   }
   return false;
 }

 function selectionIsInHeading(editor) {
   if (!(editor instanceof HTMLElement)) return false;
   const sel = document.getSelection && document.getSelection();
   if (!sel || !sel.anchorNode) return false;
   if (!editor.contains(sel.anchorNode)) return false;
   return !!nodeOrAncestorHeading(sel.anchorNode, editor);
 }

 function mutationMayAffectHeadings(mutations, editor) {
   if (!Array.isArray(mutations) || !(editor instanceof HTMLElement)) return false;
   for (const mutation of mutations) {
     if (!mutation) continue;
     if (mutation.type === 'characterData') {
       if (nodeOrAncestorHeading(mutation.target, editor)) return true;
       continue;
     }
     if (mutation.type === 'childList') {
       if (nodeTouchesHeading(mutation.target, editor)) return true;
       for (const node of mutation.addedNodes || []) {
         if (nodeTouchesHeading(node, editor)) return true;
       }
       for (const node of mutation.removedNodes || []) {
         if (nodeTouchesHeading(node, editor)) return true;
       }
     }
   }
   return false;
 }

 function clearAutoRefreshTimer(state) {
   if (!state) return;
   if (state.autoRefreshTimer) {
     clearTimeout(state.autoRefreshTimer);
     state.autoRefreshTimer = null;
   }
 }

 function flushDirtyRefresh(state, forceRefetch) {
   if (!state || state.destroyed || !state.open || !state.tocDirty) return false;
   clearAutoRefreshTimer(state);
   clearEnsureVisibleTimer(state);
   if (state.isComposing) return false;
   const ok = rebuildSnapshot(state, !!forceRefetch);
   if (ok) {
     state.tocDirty = false;
     state.dirtyReason = '';
     if (state.open) {
       commitPseudoActiveFromScroll(state, false);
       scheduleEnsureActiveItemVisible(state, true);
     }
   }
   return ok;
 }

 function scheduleAutoRefresh(state, delay, forceRefetch) {
   if (!state || state.destroyed || !state.open) return;
   clearAutoRefreshTimer(state);
   if (state.isComposing) return;
   const wait = Math.max(0, Number(delay) || 0);
   state.autoRefreshTimer = setTimeout(() => {
     state.autoRefreshTimer = null;
     if (!state || state.destroyed || !state.open) return;
     if (!state.tocDirty) return;
     flushDirtyRefresh(state, !!forceRefetch);
   }, wait);
 }

 function markTocDirty(state, reason) {
   if (!state || state.destroyed || !state.open) return;
   clearPmHeadingCheckTimer(state);
   state.tocDirty = true;
   state.dirtyReason = reason || state.dirtyReason || 'heading';
   scheduleAutoRefresh(state, CONFIG.autoRefreshDelay, true);
 }

 function clearScrollStopTimers(state) {
   if (!state) return;
   if (state.scrollStopTimer1) {
     clearTimeout(state.scrollStopTimer1);
     state.scrollStopTimer1 = null;
   }
   if (state.scrollStopTimer2) {
     clearTimeout(state.scrollStopTimer2);
     state.scrollStopTimer2 = null;
   }
 }

 function findActiveIndexByScrollTop(state, scrollTop) {
   if (!state || !Array.isArray(state.headings) || !state.headings.length) return -1;
   const anchor = Math.max(0, Number(scrollTop) || 0) + CONFIG.scrollAnchorTop;
   let lo = 0;
   let hi = state.headings.length - 1;
   let ans = 0;
   while (lo <= hi) {
     const mid = (lo + hi) >> 1;
     const top = Number(state.headings[mid] && state.headings[mid].top);
     if (Number.isFinite(top) && top <= anchor) {
       ans = mid;
       lo = mid + 1;
     } else {
       hi = mid - 1;
     }
   }
   return ans;
 }

 function commitPseudoActiveFromScroll(state, ensureVisible = true) {
   if (!state || state.destroyed || !state.open) return;
   if (!(state.scrollContainer instanceof HTMLElement) || !document.contains(state.scrollContainer)) return;
   if (!Array.isArray(state.headings) || !state.headings.length) return;
   const nextIndex = findActiveIndexByScrollTop(state, state.scrollContainer.scrollTop);
   if (nextIndex < 0) return;
   setActiveItem(state, nextIndex);
   if (ensureVisible) scheduleEnsureActiveItemVisible(state, true);
 }

 function schedulePseudoActiveCheck(state) {
   if (!state || state.destroyed || !state.open) return;
   clearScrollStopTimers(state);
   if (!(state.scrollContainer instanceof HTMLElement)) return;
   state.pendingScrollTop = state.scrollContainer.scrollTop;
   state.scrollStopTimer1 = setTimeout(() => {
     state.scrollStopTimer1 = null;
     if (!state || state.destroyed || !state.open) return;
     if (!(state.scrollContainer instanceof HTMLElement) || !document.contains(state.scrollContainer)) return;
     const firstTop = state.scrollContainer.scrollTop;
     if (Math.abs(firstTop - state.pendingScrollTop) > 1) {
       schedulePseudoActiveCheck(state);
       return;
     }
     state.pendingScrollTop = firstTop;
     state.scrollStopTimer2 = setTimeout(() => {
       state.scrollStopTimer2 = null;
       if (!state || state.destroyed || !state.open) return;
       if (!(state.scrollContainer instanceof HTMLElement) || !document.contains(state.scrollContainer)) return;
       const secondTop = state.scrollContainer.scrollTop;
       if (Math.abs(secondTop - state.pendingScrollTop) > 1) {
         schedulePseudoActiveCheck(state);
         return;
       }
       if (state.manualTocBrowsing) exitManualTocBrowsing(state, false);
       commitPseudoActiveFromScroll(state, true);
     }, CONFIG.scrollQuietStage2Ms);
   }, CONFIG.scrollQuietStage1Ms);
 }

 function bindOpenRuntime(state) {
   if (!state || state.destroyed || !state.open) return;
   if (!(state.editor instanceof HTMLElement) || !(state.scrollContainer instanceof HTMLElement)) return;

   ensurePmBridge(state);

   if (!state.onEditorInput) {
     state.onEditorInput = () => {
       if (!state.pmBridgeReady && selectionIsInHeading(state.editor)) markTocDirty(state, 'heading-input-fallback');
     };
   }
   if (!state.onCompositionStart) {
     state.onCompositionStart = () => {
       state.isComposing = true;
       state.pmDocChangedDuringComposition = false;
       clearAutoRefreshTimer(state);
       clearPmHeadingCheckTimer(state);
     };
   }
   if (!state.onCompositionEnd) {
     state.onCompositionEnd = () => {
       state.isComposing = false;
       if (state.pmBridgeReady && state.pmDocChangedDuringComposition) {
         state.pmDocChangedDuringComposition = false;
         schedulePmHeadingCheck(state, CONFIG.compositionRefreshDelay);
       }
       if (state.tocDirty) scheduleAutoRefresh(state, CONFIG.compositionRefreshDelay, true);
     };
   }
   if (!state.onScroll) {
     state.onScroll = () => {
       schedulePseudoActiveCheck(state);
     };
   }
   if (!state.onListWheel) {
     state.onListWheel = () => {
       enterManualTocBrowsing(state);
     };
   }
   if (!state.onListScroll) {
     state.onListScroll = () => {
       if (!state || state.destroyed || !state.open) return;
       if (Date.now() <= (state.listProgrammaticScrollUntil || 0)) return;
       enterManualTocBrowsing(state);
     };
   }

   if (!state.runtimeBound) {
     state.editor.addEventListener('input', state.onEditorInput, false);
     state.editor.addEventListener('compositionstart', state.onCompositionStart, false);
     state.editor.addEventListener('compositionend', state.onCompositionEnd, false);
     state.scrollContainer.addEventListener('scroll', state.onScroll, { passive: true });
     if (state.list instanceof HTMLElement) {
       state.list.addEventListener('wheel', state.onListWheel, { passive: true });
       state.list.addEventListener('scroll', state.onListScroll, { passive: true });
     }
     state.runtimeBound = true;
   }

   syncFallbackMutationObserver(state);
 }

 function unbindOpenRuntime(state) {
   if (!state) return;
   clearAutoRefreshTimer(state);
   clearPmHeadingCheckTimer(state);
   clearEnsureVisibleTimer(state);
   clearScrollStopTimers(state);
   detachPmBridge(state);
   if (state.mutationObserver) {
     try { state.mutationObserver.disconnect(); } catch (_) {}
     state.mutationObserver = null;
   }
   if (state.runtimeBound) {
     try { state.editor && state.editor.removeEventListener('input', state.onEditorInput, false); } catch (_) {}
     try { state.editor && state.editor.removeEventListener('compositionstart', state.onCompositionStart, false); } catch (_) {}
     try { state.editor && state.editor.removeEventListener('compositionend', state.onCompositionEnd, false); } catch (_) {}
     try { state.scrollContainer && state.scrollContainer.removeEventListener('scroll', state.onScroll, false); } catch (_) {}
     try { state.list && state.list.removeEventListener('wheel', state.onListWheel, false); } catch (_) {}
     try { state.list && state.list.removeEventListener('scroll', state.onListScroll, false); } catch (_) {}
     state.runtimeBound = false;
   }
 }

 function focusEditor(state) {
   if (!(state && state.editor instanceof HTMLElement) || !document.contains(state.editor)) return;
   try {
     state.editor.focus({ preventScroll: true });
   } catch (_) {
     try { state.editor.focus(); } catch (_) {}
   }
 }

 function clearBuildTimer(state) {
   if (!state) return;
   if (state.buildTimer) {
     clearTimeout(state.buildTimer);
     state.buildTimer = null;
   }
 }

 function scheduleSnapshotBuild(state, delay, forceRefetch) {
   if (!state || state.destroyed) return;
   clearBuildTimer(state);
   const wait = Math.max(0, Number(delay) || 0);
   if (state.open) setStatus(state, 'hint', STATUS_TEXT.building);
   state.buildTimer = setTimeout(() => {
     state.buildTimer = null;
     if (!state || state.destroyed || !state.open) return;
     rebuildSnapshot(state, !!forceRefetch);
     if (state.open) {
       commitPseudoActiveFromScroll(state, false);
       scheduleEnsureActiveItemVisible(state, true);
     }
     positionPanel(state);
   }, wait);
 }

 function updateOpenClasses(state) {
   if (!(state && state.root instanceof HTMLElement)) return;
   state.root.classList.toggle(CLASS.rootOpen, !!state.open);
   if (state.button instanceof HTMLElement) state.button.classList.toggle(CLASS.active, !!state.open);
   if (state.panel instanceof HTMLElement) state.panel.classList.toggle(CLASS.visible, !!state.open);
 }

 function mountButton(state) {
   if (!(state && state.root instanceof HTMLElement)) return;
   if (state.button instanceof HTMLElement && document.contains(state.button)) return;

   const btn = document.createElement('button');
   btn.type = 'button';
   btn.className = `ant-btn ant-btn-text small theme-default bordered nc-btn-shadow nc-button ${CLASS.button}`;
   btn.textContent = 'TOC';
   btn.setAttribute('aria-label', '切换 TOC');
   btn.setAttribute('title', '切换 TOC');

   attachActionButton(btn, () => {
     togglePanel(state, !state.open);
     setTimeout(() => focusEditor(state), 0);
   });

   state.root.appendChild(btn);
   state.button = btn;
 }

 function mountPanel(state) {
   if (!(state && state.root instanceof HTMLElement)) return;
   if (state.panel instanceof HTMLElement && document.contains(state.panel)) return;

   const panel = document.createElement('div');
   panel.className = CLASS.panel;
   panel.innerHTML = `
     <div class="tm-rtoc-panel-inner-v38">
       <div class="tm-rtoc-title-v38">
         <div class="tm-rtoc-title-main-v38">
           <span class="tm-rtoc-title-count-v38"></span>
         </div>
         <div class="tm-rtoc-title-actions-v38">
           <button type="button" class="tm-rtoc-icon-btn-v38" data-action="refresh" aria-label="刷新目录" title="刷新目录">
             <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
               <path d="M13.333 8A5.333 5.333 0 1 1 11.77 4.23" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
               <path d="M13.333 2.667V5.333H10.667" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
             </svg>
           </button>
           <button type="button" class="tm-rtoc-icon-btn-v38" data-action="top" aria-label="跳到顶部" title="跳到顶部">
             <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
               <path d="M3 3H13" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
               <path d="M8 12V4" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
               <path d="M5.5 6.5L8 4L10.5 6.5" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
             </svg>
           </button>
           <button type="button" class="tm-rtoc-icon-btn-v38" data-action="bottom" aria-label="跳到底部" title="跳到底部">
             <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
               <path d="M3 13H13" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
               <path d="M8 4V12" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
               <path d="M5.5 9.5L8 12L10.5 9.5" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
             </svg>
           </button>
         </div>
       </div>
       <div class="${CLASS.status} ${CLASS.statusHint}"></div>
       <div class="${CLASS.list}"></div>
     </div>
     <div class="${CLASS.resizer}" title="拖动调整目录宽度；双击恢复默认宽度" aria-hidden="true"></div>
   `;

   panel.addEventListener('click', stopBubbleOnly, false);
   panel.addEventListener('pointerdown', stopBubbleOnly, false);
   panel.addEventListener('mousedown', stopBubbleOnly, false);
   panel.addEventListener('mouseup', stopBubbleOnly, false);

   state.root.appendChild(panel);
   state.panel = panel;
   state.titleCount = panel.querySelector('.tm-rtoc-title-count-v38');
   state.status = panel.querySelector(`.${CLASS.status}`);
   state.list = panel.querySelector(`.${CLASS.list}`);
   state.resizer = panel.querySelector(`.${CLASS.resizer}`);

   if (state.resizer instanceof HTMLElement) {
     state.resizer.addEventListener('pointerdown', (e) => startPanelWidthResize(state, e), true);
     state.resizer.addEventListener('dblclick', (e) => {
       stopAll(e);
       resetPanelWidth(state);
       setTimeout(() => focusEditor(state), 0);
     }, true);
   }

   const refreshBtn = panel.querySelector('[data-action="refresh"]');
   const topBtn = panel.querySelector('[data-action="top"]');
   const bottomBtn = panel.querySelector('[data-action="bottom"]');

   attachActionButton(refreshBtn, () => {
     state.tocDirty = false;
     state.dirtyReason = '';
     rebuildSnapshot(state, true);
     if (state.open) {
       commitPseudoActiveFromScroll(state, false);
       scheduleEnsureActiveItemVisible(state, true);
     }
     positionPanel(state);
     setTimeout(() => focusEditor(state), 0);
   });
   attachActionButton(topBtn, () => scrollContainerTo(state, 'top'));
   attachActionButton(bottomBtn, () => scrollContainerTo(state, 'bottom'));

   setStatus(state, 'hint', STATUS_TEXT.hint);
   updateCount(state);
 }

 function createHeadingDescriptor(index, heading) {
   return {
     index: Number.isInteger(index) ? index : -1,
     id: heading && typeof heading.id === 'string' ? heading.id : '',
     level: heading && Number.isFinite(heading.level) ? heading.level : 1,
     text: heading && typeof heading.text === 'string' ? heading.text : '',
     pos: heading && Number.isFinite(heading.pos) ? heading.pos : null,
     source: heading && typeof heading.source === 'string' ? heading.source : '',
   };
 }

 function resolveHeadingFromDescriptor(state, descriptor) {
   if (!state || !Array.isArray(state.headings) || !state.headings.length) return { heading: null, index: -1 };
   const idx = Number.isInteger(descriptor && descriptor.index) ? descriptor.index : -1;
   if (idx >= 0 && idx < state.headings.length) {
     const candidate = state.headings[idx];
     if (candidate && (!descriptor || !descriptor.text || (candidate.text === descriptor.text && candidate.level === descriptor.level))) {
       return { heading: candidate, index: idx };
     }
   }

   const text = descriptor && typeof descriptor.text === 'string' ? descriptor.text : '';
   const level = descriptor && Number.isFinite(descriptor.level) ? descriptor.level : null;
   if (text) {
     const matches = [];
     state.headings.forEach((heading, headingIndex) => {
       if (!heading) return;
       if (heading.text === text && (level == null || heading.level === level)) {
         matches.push({ heading, index: headingIndex });
       }
     });
     if (matches.length) {
       if (idx >= 0) {
         matches.sort((a, b) => Math.abs(a.index - idx) - Math.abs(b.index - idx));
       }
       return matches[0];
     }
   }

   if (idx >= 0 && idx < state.headings.length) return { heading: state.headings[idx], index: idx };
   return { heading: null, index: -1 };
 }

 function renderSnapshot(state) {
   if (!(state && state.list instanceof HTMLElement)) return;
   state.list.innerHTML = '';

   if (!state.headings.length) {
     const empty = document.createElement('div');
     empty.className = 'tm-rtoc-empty-v38';
     empty.textContent = 'No headings';
     state.list.appendChild(empty);
     updateCount(state);
     return;
   }

   state.headings.forEach((heading, index) => {
     const btn = document.createElement('button');
     btn.type = 'button';
     btn.className = `${CLASS.item} tm-rtoc-l${heading.level}`;
     btn.textContent = heading.text;
     btn.title = heading.text;
     btn.dataset.index = String(index);
     if (index === state.lastClickedIndex) btn.classList.add(CLASS.active);
     const descriptor = createHeadingDescriptor(index, heading);
     attachActionButton(btn, () => jumpToHeading(state, descriptor));
     state.list.appendChild(btn);
   });

   updateCount(state);
 }

 function rebuildSnapshot(state, forceRefetch) {
   if (!state || state.destroyed) return false;
   if (forceRefetch || !refsStillBelongToRoot(state)) {
     if (!refreshCachedRefs(state)) {
       markSnapshotStale(state);
       return false;
     }
   }

   if (!(state.editor instanceof HTMLElement) || !document.contains(state.editor)) {
     markSnapshotStale(state);
     return false;
   }

   ensurePmBridge(state);

   const snapshot = buildPmHeadingSnapshot(state) || buildDomHeadingSnapshot(state);
   if (!snapshot) {
     markSnapshotStale(state);
     return false;
   }

   state.headings = snapshot.headings;
   state.headingSignature = snapshot.signature;
   state.headingSource = snapshot.source;

   if (state.lastClickedIndex >= state.headings.length) state.lastClickedIndex = -1;
   renderSnapshot(state);
   setStatus(state, 'hint', STATUS_TEXT.hint);
   state.snapshotReady = true;
   state.tocDirty = false;
   state.dirtyReason = '';
   syncFallbackMutationObserver(state);
   return true;
 }

 function markSnapshotStale(state) {
   if (!state || state.destroyed) return;
   setStatus(state, 'warn', STATUS_TEXT.stale);
 }

 function positionButton(state) {
   if (!(state && state.button instanceof HTMLElement)) return;
   if (!refsStillBelongToRoot(state) && !refreshCachedRefs(state)) {
     state.button.classList.remove(CLASS.buttonReady);
     return;
   }

   const btnWidth = state.button.offsetWidth || 42;
   const btnHeight = state.button.offsetHeight || 30;
   const titleRect = state.titleTextBox.getBoundingClientRect();
   if (titleRect.width <= 0 || state.titleBar.offsetHeight <= 0) {
     state.button.classList.remove(CLASS.buttonReady);
     return;
   }

   const rawLeft = Math.round(state.titleTextBox.offsetLeft + state.titleTextBox.offsetWidth + CONFIG.buttonGap);
   const rawTop = Math.round(state.titleBar.offsetTop + (state.titleBar.offsetHeight - btnHeight) / 2);
   const maxLeft = Math.max(8, state.root.clientWidth - btnWidth - 8);
   const left = Math.min(Math.max(8, rawLeft), maxLeft);
   const top = Math.max(8, rawTop);

   state.button.style.left = `${left}px`;
   state.button.style.top = `${top}px`;
   state.button.classList.add(CLASS.buttonReady);
 }

 function positionPanel(state) {
   if (!(state && state.panel instanceof HTMLElement)) return;
   if (!refsStillBelongToRoot(state) && !refreshCachedRefs(state)) return;
   const top = Math.round(state.contentWrap.offsetTop + CONFIG.panelInsetY);
   const height = Math.max(220, Math.round(state.contentWrap.offsetHeight - CONFIG.panelInsetY - CONFIG.panelBottomGap));
   state.panel.style.top = `${top}px`;
   state.panel.style.height = `${height}px`;
 }

 function positionUI(state) {
   if (state && state.root instanceof HTMLElement) applyPanelWidth(state, state.panelWidth || CONFIG.panelWidth);
   positionButton(state);
   if (state.open) positionPanel(state);
 }

 function togglePanel(state, open) {
   if (!state || state.destroyed) return;
   state.open = !!open;
   if (state.open) {
     state.manualTocBrowsing = false;
     mountPanel(state);
     positionPanel(state);
     if (!state.snapshotReady || !state.headings.length) {
       scheduleSnapshotBuild(state, CONFIG.initialBuildDelay, true);
     } else if (state.tocDirty) {
       scheduleAutoRefresh(state, 120, true);
     }
     scheduleEnsureActiveItemVisible(state, true, 180);
     bindOpenRuntime(state);
   } else {
     clearBuildTimer(state);
     exitManualTocBrowsing(state, false);
     unbindOpenRuntime(state);
   }
   updateOpenClasses(state);
 }

 function ensureMountedState(state) {
   if (!state || state.destroyed) return false;
   if (!(state.root instanceof HTMLElement) || !document.contains(state.root) || !isElementActuallyVisible(state.root)) return false;

   const prevEditor = state.editor;
   const prevScroller = state.scrollContainer;
   if (!refsStillBelongToRoot(state) && !refreshCachedRefs(state)) return false;
   state.root.classList.add(CLASS.rootReady);
   applyPanelWidth(state, state.panelWidth || CONFIG.panelWidth);
   mountButton(state);
   if (state.open) mountPanel(state);
   positionUI(state);
   updateOpenClasses(state);
   if (state.open && (prevEditor !== state.editor || prevScroller !== state.scrollContainer)) {
     unbindOpenRuntime(state);
     bindOpenRuntime(state);
   }
   return true;
 }

 function cleanupState(state) {
   if (!state || state.destroyed) return;
   state.destroyed = true;
   clearBuildTimer(state);
   clearPmHeadingCheckTimer(state);
   clearEnsureVisibleTimer(state);
   clearManualTocBrowseTimer(state);
   stopPanelWidthResize(state, false);
   unbindOpenRuntime(state);
   if (state.button instanceof HTMLElement && state.button.parentElement) state.button.remove();
   if (state.panel instanceof HTMLElement && state.panel.parentElement) state.panel.remove();
   if (state.root instanceof HTMLElement) {
     state.root.classList.remove(CLASS.rootReady, CLASS.rootOpen);
   }
   if (currentState === state) currentState = null;
 }

 function initStateForRoot(root) {
   const refs = collectRefs(root);
   if (!refs) return null;
   const state = {
     root,
     titleBar: refs.titleBar,
     titleTextBox: refs.titleTextBox,
     contentWrap: refs.contentWrap,
     editor: refs.editor,
     scrollContainer: refs.scrollContainer,
     button: null,
     panel: null,
     titleCount: null,
     status: null,
     list: null,
     resizer: null,
     panelWidth: CONFIG.panelWidth,
     pendingPanelWidth: CONFIG.panelWidth,
     panelResizeDragging: false,
     panelResizeStartX: 0,
     panelResizeStartWidth: CONFIG.panelWidth,
     panelResizeRaf: null,
     onPanelResizeMove: null,
     onPanelResizeEnd: null,
     headings: [],
     headingSignature: '',
     headingSource: '',
     open: false,
     lastClickedIndex: -1,
     snapshotReady: false,
     buildTimer: null,
     autoRefreshTimer: null,
     pmHeadingCheckTimer: null,
     pmEditor: null,
     pmBridgeToken: null,
     pmBridgeReady: false,
     pmDocChangedDuringComposition: false,
     scrollStopTimer1: null,
     scrollStopTimer2: null,
     pendingScrollTop: 0,
     manualTocBrowsing: false,
     manualTocBrowseTimer: null,
     listProgrammaticScrollUntil: 0,
     tocDirty: false,
     dirtyReason: '',
     isComposing: false,
     mutationObserver: null,
     runtimeBound: false,
     onEditorInput: null,
     onCompositionStart: null,
     onCompositionEnd: null,
     onScroll: null,
     onListWheel: null,
     onListScroll: null,
     destroyed: false,
   };

   state.panelWidth = clampPanelWidth(state, CONFIG.panelWidth);
   state.pendingPanelWidth = state.panelWidth;
   root.classList.add(CLASS.rootReady);
   applyPanelWidth(state, state.panelWidth);
   mountButton(state);
   positionButton(state);
   if (CONFIG.defaultOpen) togglePanel(state, true);
   return state;
 }

 function jumpToHeading(state, descriptor, allowRecover = true) {
   if (!state || state.destroyed) return;

   exitManualTocBrowsing(state, false);

   flushPmHeadingCheck(state);
   if (state.tocDirty) {
     flushDirtyRefresh(state, true);
   }

   const resolved = resolveHeadingFromDescriptor(state, descriptor);
   const heading = resolved.heading;
   const activeIndex = resolved.index;
   const scrollerOk = state.scrollContainer instanceof HTMLElement && document.contains(state.scrollContainer);
   const editorOk = state.editor instanceof HTMLElement && document.contains(state.editor);
   const headingOk = heading && heading.el instanceof HTMLElement && editorOk && state.editor.contains(heading.el);

   if (!headingOk || !scrollerOk) {
     if (allowRecover) {
       const recovered = refreshCachedRefs(state) && rebuildSnapshot(state, true);
       if (recovered) {
         jumpToHeading(state, descriptor, false);
         return;
       }
     }
     markSnapshotStale(state);
     return;
   }

   let top = getOffsetTopWithinAncestor(heading.el, state.scrollContainer);
   if (top == null) {
     const headingRect = heading.el.getBoundingClientRect();
     const scrollerRect = state.scrollContainer.getBoundingClientRect();
     top = state.scrollContainer.scrollTop + (headingRect.top - scrollerRect.top);
   }

   const targetTop = Math.max(0, Math.round(top - CONFIG.anchorTop));
   state.scrollContainer.scrollTop = targetTop;
   setActiveItem(state, activeIndex);
   scheduleEnsureActiveItemVisible(state, true, 100);
   setStatus(state, 'hint', STATUS_TEXT.hint);
   clearScrollStopTimers(state);
   setTimeout(() => focusEditor(state), 0);
 }

 function scrollContainerTo(state, where) {
   if (!state || state.destroyed) return;
   exitManualTocBrowsing(state, false);

   const refreshed = refreshCachedRefs(state);
   if (!refreshed || !(state.scrollContainer instanceof HTMLElement) || !document.contains(state.scrollContainer)) {
     markSnapshotStale(state);
     return;
   }

   if (where === 'top') {
     state.scrollContainer.scrollTop = 0;
   } else if (where === 'bottom') {
     state.scrollContainer.scrollTop = Math.max(0, state.scrollContainer.scrollHeight - state.scrollContainer.clientHeight);
   }
   schedulePseudoActiveCheck(state);
   setTimeout(() => focusEditor(state), 0);
 }

 function syncCurrentRoot(reason) {
   const root = findActiveRoot();

   if (!(root instanceof HTMLElement)) {
     if (currentState) cleanupState(currentState);
     return;
   }

   if (!currentState || currentState.destroyed || currentState.root !== root) {
     if (currentState) cleanupState(currentState);
     currentState = initStateForRoot(root);
     return;
   }

   if (!ensureMountedState(currentState)) {
     cleanupState(currentState);
     currentState = initStateForRoot(root);
     return;
   }

   if (reason === 'resize' && currentState.open) {
     positionUI(currentState);
   }
 }

 function queueDiscover(reason) {
   if (discoverQueued) return;
   discoverQueued = true;
   requestAnimationFrame(() => {
     discoverQueued = false;
     syncCurrentRoot(reason || 'discover');
   });
 }

 function queueResize() {
   if (resizeQueued) return;
   resizeQueued = true;
   requestAnimationFrame(() => {
     resizeQueued = false;
     syncCurrentRoot('resize');
   });
 }

 function bindGlobalListeners() {
   document.addEventListener('click', () => {
     queueDiscover('click');
   }, false);

   document.addEventListener('focusin', () => {
     queueDiscover('focusin');
   }, false);

   document.addEventListener('visibilitychange', () => {
     if (!document.hidden) queueDiscover('visibility');
   }, false);

   window.addEventListener('resize', queueResize, { passive: true });
 }

 function bootstrap() {
   injectStyle();
   bindGlobalListeners();
   queueDiscover('bootstrap');
   setTimeout(() => queueDiscover('bootstrap-delayed'), 400);
 }

 bootstrap();
})();

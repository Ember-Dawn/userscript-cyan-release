# NocoDB Rich Text 大纲：v0.1 纯 DOM 实现说明

## 1. 文档目的

本文件说明 `nocodb-richtext-outline.user.js` v0.1.x 的技术路线、交互边界、性能策略、视觉规范和维护约定。

v0.1 系列沿用此前从零重写的纯 DOM 架构，不是在归档版 v46.0.2 上继续打补丁。旧版完整代码和历史技术说明继续保存在：

```text
archive/userscripts/nocodb-richtext-outline-v46.0.2.user.js
archive/userscripts/nocodb-richtext-outline-v46.0.2.md
```

旧版的主要问题不是 TOC 产品设计，而是 v44 以后为了追踪标题变化，深入接入了 Tiptap / ProseMirror 内部状态，并通过 `registerPlugin()` 动态注册 bridge。实际排查确认：开启旧 TOC 时，Rich Text 第一次输入可能把浏览器 DOM Selection 和 ProseMirror selection 一起跳到文档后部；关闭 TOC 后问题消失。因此 v0.1 系列的首要目标是保留成熟交互，同时彻底取消这类内部耦合。

## 2. v0.1 系列的核心原则

v0.1 系列把 TOC 定义成一个“旁路 DOM UI 增强脚本”。

脚本可以：

- 查找 NocoDB Rich Text 弹窗；
- 读取 `.tiptap.ProseMirror` 最终渲染出的 `h1` ~ `h6`；
- 读取标题文字和几何位置；
- 在 ProseMirror 外部创建 TOC 按钮和面板；
- 修改正文滚动容器的 `scrollTop`；
- 通过外部 CSS 给正文留出 TOC 空间。

脚本明确不做：

- 不读取 `editor.editor`、`EditorState`、`EditorView` 或 `.pmViewDesc.view`；
- 不调用 `registerPlugin()`，不创建 ProseMirror Plugin，不建立任何 PM bridge；
- 不读取或修改 ProseMirror selection，不调用 `posAtDOM()` / `setSelection()` / `dispatch()`；
- 不使用浏览器原生 `Selection + Range` 去替用户移动 caret；
- 不主动 `focus()` 编辑器；
- “点击标题 / 跳到顶部 / 跳到底部”只修改正文滚动容器的 `scrollTop`，只负责 viewport，不负责 caret；
- 不向 `.ProseMirror` 内的标题、段落、代码块写入 `data-*`、class 或额外 child DOM；
- 不在 `input`、`scroll`、MutationObserver 回调中直接做全量重建。

## 3. 目标 DOM 结构

当前 NocoDB Rich Text 展开编辑器的关键结构可概括为：

```text
expanded-cell-input
├─ 标题栏
└─ .nc-rich-text
   ├─ 原生 bubble menu
   └─ .nc-rich-text-content
      └─ .tiptap.ProseMirror[contenteditable=true]
         ├─ p
         ├─ h1
         ├─ h2
         ├─ pre / codeBlock
         └─ ...
```

主选择器优先使用：

```css
.nc-long-text-expanded-modal .expanded-cell-input
```

如果页面结构只保留 Ant Modal 容器，则允许回退到：

```css
.ant-modal-content .expanded-cell-input
```

但最终必须同时找到：

```css
.nc-rich-text-content
.nc-rich-text-content .tiptap.ProseMirror
```

因此不会把普通 `expanded-cell-input` 错当成 Rich Text 编辑器。

## 4. 保留的旧版功能

v0.1 系列保留旧版已经证明有价值的交互：

1. Rich Text 左侧 TOC 面板；
2. 默认打开；
3. 顶部 `TOC` 开关按钮；
4. 面板显示标题数量；
5. H1 ~ H6 分层缩进；
6. 点击目录跳转到对应标题；
7. 手动刷新目录；
8. 跳到正文顶部 / 底部；
9. 正文滚动停止后更新当前标题高亮；
10. active 项只在超出安全区后才纠偏 TOC 列表；
11. 用户手动滚动 TOC 时暂停自动拉回；
12. TOC 宽度拖拽；
13. 双击拖拽边缘恢复默认宽度；
14. 中文输入法 composition 期间暂停目录刷新；
15. 弹窗关闭、编辑器替换后自动 cleanup / 重建状态。

## 5. 标题数据模型

v0.1 系列唯一标题来源是 DOM：

```js
editor.querySelectorAll('h1, h2, h3, h4, h5, h6')
```

每个标题只保存：

```text
element  真实 heading HTMLElement 引用
level    1 ~ 6
text     规范化后的标题文本
top      相对正文滚动容器的纵向位置
```

不再保存：

```text
ProseMirror pos
PM source
PM node
写入正文 DOM 的静态 ID
```

这样 TOC 的数据模型与编辑器内部 schema、extension、transaction 完全解耦。

## 6. 标题 signature

为了避免 MutationObserver 一有变化就重渲染 TOC，v0.1 系列保留轻量 signature：

```text
level:textLength:text
```

所有标题拼接成一份 signature。MutationObserver 只负责提示“可能变化”，真正执行时重新读取一次标题列表并比较 signature：

```text
signature 相同
→ 不重渲染 TOC
→ 只刷新标题位置

signature 不同
→ 重建 snapshot
→ 重渲染 TOC
```

## 7. 为什么把“标题内容”和“标题位置”分开

这是纯 DOM 新架构相比旧版的重要改进。

普通正文编辑虽然不会改变标题文字，但会改变后面标题的纵向位置。例如在第一个 H1 前增加十行段落，后面所有 heading 的 `top` 都会移动。如果只在标题文字变化时重建 snapshot，滚动 active 判断会逐渐使用过期位置。

因此脚本有两条低频路径：

### 7.1 标题内容刷新

触发条件：

- H1 ~ H6 文本变化；
- 标题新增 / 删除；
- P 与 H1 ~ H6 之间发生结构转换。

处理：

```text
MutationObserver
→ scheduleHeadingCheck()
→ 安静后计算 signature
→ 必要时 buildSnapshot()
```

### 7.2 几何位置刷新

普通正文变化不会重渲染 TOC，只会：

```text
MutationObserver
→ scheduleGeometryRefresh()
→ 输入安静后重新测量现有 heading.top
```

因此长文普通输入不会持续扫描、渲染目录，同时又不会让 active 坐标长期失准。

## 8. MutationObserver 设计

脚本使用两个职责完全不同的 observer。

### 8.1 全局生命周期 Observer

范围：

```text
document.body
```

配置：

```text
childList: true
subtree: true
```

用途只包括：

- Rich Text 弹窗出现；
- Rich Text 弹窗移除；
- 当前 editor DOM 被宿主替换。

它不会遍历正文，不监听 `characterData`，也不会因为普通按键直接重建 TOC。

### 8.2 当前 Editor Observer

只观察当前：

```css
.tiptap.ProseMirror
```

配置：

```text
childList: true
characterData: true
subtree: true
```

回调只做分类和 debounce：

- 涉及 heading → 调度标题检查；
- 其他正文变化 → 调度几何刷新；
- composition 期间只记录 pending 标志。

Observer 回调中禁止直接全量 rebuild。

## 9. IME / 中文输入保护

监听：

```text
compositionstart
compositionend
```

`compositionstart` 后：

- 设置 `isComposing = true`；
- 取消等待中的标题 / 几何刷新 timer；
- MutationObserver 只记录 pending。

`compositionend` 后：

- 清除 composition 状态；
- 把 pending 工作以延迟方式统一恢复。

这样避免用户刚创建标题并输入拼音时，TOC 同时重建 UI。

## 10. 正文滚动与 active 高亮

脚本不在每个 `scroll` 事件里计算 active。

仍采用旧版成熟的“双阶段静默判停”：

```text
scroll
→ 等待 stage 1
→ 确认 scrollTop 稳定
→ 再等待 stage 2
→ 再确认一次
→ 才更新 active
```

标题位置已经按 DOM 顺序缓存，因此 active 查找使用二分搜索：

```text
最后一个 heading.top <= scrollTop + anchor
```

即使标题很多，滚动停止后的定位成本也很低。

## 11. TOC 列表安全区纠偏

active item 改变后，不会无条件滚动 TOC 列表。

目录顶部和底部各保留安全区。只有 active item 已经贴近或越过安全区边缘，才修改 TOC 自己的 `scrollTop`。

这样既能让当前标题保持可见，也避免目录列表每次 active 变化都发生明显抖动。

## 12. 手动浏览保护

用户可能在正文停留在标题 3，但主动滚 TOC 去寻找标题 80。

因此只要检测到用户手动滚动 / 滚轮操作 TOC：

```text
manualTocBrowsing = true
```

此时暂停自动安全区拉回。

退出条件：

- 用户停止浏览一段时间；
- 用户点击某个 TOC 项；
- 正文发生新一轮滚动并真正停止。

## 13. 显式导航：只滚动 viewport，不同步 caret

v0.1.5 起，TOC 的导航语义固定为：**只改变用户正在看的位置，不改变用户正在编辑的位置。**

最终规则非常简单：

```text
点击某个 TOC heading
→ 计算 heading.top
→ 修改正文滚动容器 scrollTop

跳到顶部
→ scrollTop = 0

跳到底部
→ scrollTop = scrollHeight - clientHeight
```

导航过程中明确禁止：

- 浏览器原生 `Selection + Range`；
- `focus()` / `view.focus()`；
- `.pmViewDesc.view` / EditorView；
- `posAtDOM()`；
- `TextSelection` / `NodeSelection` / `Selection.near()`；
- `transaction.setSelection()` / `dispatch()`；
- 为了压制 selection 回滚而设置 RAF / timer 连续重写 `scrollTop`。

这意味着 TOC 是“视口导航器”，不是“编辑光标导航器”。用户通过 TOC 看到了目标位置后，如果要在那里编辑，应再由用户点击正文目标位置，让 NocoDB / Tiptap 自己建立 caret。若用户不点击正文而直接输入，键盘仍可能作用于此前已有的 caret；这是宿主编辑器的正常语义，TOC 不再替用户猜测或修改 caret。

### 13.1 v0.1.3 的坑：原生 DOM Selection 不能代替 PM selection

v0.1.3 曾尝试在显式导航时调用 `focus({ preventScroll: true })`，再用浏览器原生 `Selection + Range` 把 caret 放到目标 DOM。实测证明这条路线不可靠：真实点击“跳到顶部”后，正文 `scrollTop` 可以短暂到达 `0`，但约 20ms 后又会被 NocoDB / ProseMirror 拉回文档后部。

原因是 DOM Selection 与 ProseMirror 内部 selection 不是同一层状态。仅移动浏览器 caret，并不能保证宿主下一轮 selection / view 同步接受这个位置。

结论：**不要再用原生 Range 去“补同步” ProseMirror caret。**

### 13.2 v0.1.4 的坑：一次性 PM transaction 仍会污染宿主编辑状态

v0.1.4 又尝试缩小范围，只在导航瞬间执行一次：

```text
.pmViewDesc.view
→ posAtDOM()
→ Selection.near()
→ transaction.setSelection()
→ dispatch(addToHistory=false)
```

同时对 `scrollTop` 做立即 / 下一帧 / 约 40ms 的有限校正。虽然它不注册 plugin、不建立长期 bridge，但实机结果仍然失败：

- 刚打开长文档后点击“跳到顶部”，随后编辑仍会跳到底部；
- 更关键的是，一旦执行过 TOC 导航，之后即使用户用滚轮上翻再编辑，仍可能继续跳到底部；
- 与此同时，若打开编辑器后完全不点 TOC，只用滚轮上翻再编辑，则没有问题。

这说明问题不只是“selection 有没有同步成功”，而是 TOC 主动插手宿主 PM selection 可能改变了 NocoDB / Tiptap 自己维护的编辑状态。一次性 transaction 仍然不是安全边界。

### 13.3 决定性的 A/B 测试

最终又做了一个更干净的对照：绕过 TOC handler，直接在 Console 执行：

```js
const pm = document.querySelector('.nc-rich-text-content .tiptap.ProseMirror');
pm.scrollTop = 0;
```

然后用户点击顶部普通正文再编辑，行为完全正常。

这个结果把问题边界明确下来：

```text
纯 scrollTop
→ 安全

TOC 主动同步 DOM / PM caret 或 selection
→ 有污染宿主编辑状态的风险
```

因此 v0.1.5 不再试图“修复”宿主初始 caret，也不再用延迟滚动去和宿主 selection 竞争，而是回到最小、可验证的纯滚动模型。

如果 heading element 已被 Tiptap 替换，脚本仍允许做一次 DOM 层的轻量恢复：

```text
重新 buildSnapshot()
→ 按原 index / text / level 匹配 heading
→ 重新计算 top
→ 只修改 scrollTop
```

## 14. 扁平化视觉规范

v0.1 系列将 TOC 从“悬浮卡片”改成与正文同一编辑器中的扁平侧栏：

- 面板不再使用外围圆角、阴影或四周边框；
- TOC 与正文共享相同背景，仅在面板右侧保留一条细竖向分隔线；
- resizer 覆盖在这条竖线上，平时不可见，hover / 拖拽时显示细蓝色提示；
- 顶部标题显示为 `TOC N`，不再使用单独数字胶囊；
- 顶部仅使用一条非常浅的横向分隔线；
- “刷新目录 / 跳到底部 / 跳到顶部”使用独立的 26px 圆角按钮，采用统一线性图标和轻量 hover 状态；
- v0.1.1 起三个按钮顺序固定为“刷新 → 底部 → 顶部”；
- v0.1.2 起 TOC panel 从宿主左边缘向右缩进 13px，同时等量缩减 panel 可见宽度；该值来自实际页面测试，用于完整露出 NocoDB 原生编辑框左侧细蓝线，而不是由脚本伪造蓝色边框；
- panel 仅保留左上 / 左下 8px 圆角（`8px 0 0 8px`），用于避让宿主原生蓝色圆角轮廓，右侧仍保持直角和扁平分隔；
- 13px 缩进不增加 TOC 总占位宽度，因此 TOC / 正文分隔线仍保持在原有 panelWidth 边界；
- v0.1.2 将 `contentInsetExtra` 从 `-2` 调整为 `-6`，使正文相对 TOC 右侧分隔线再向左收紧 4px；
- TOC item 的 active 状态继续保持蓝色圆角背景，不改成左侧 indicator；
- H1 ~ H6 的层级缩进与字体权重保持原逻辑。

该视觉方案的目标是让 TOC 看起来像 NocoDB 编辑器原生的左侧 pane，而不是覆盖在正文旁边的第三方卡片，并尽可能保留宿主自身的焦点轮廓。

## 15. TOC 宽度拖拽

面板默认：

```text
200px
```

允许范围：

```text
132px ~ 360px
```

拖动 panel 右侧 resizer 时：

- 使用 `requestAnimationFrame` 合并宽度更新；
- 只更新 root 上的 CSS 变量；
- 不写入本地存储；
- 拖动完成后低频刷新 heading 几何位置；
- 双击 resizer 恢复默认宽度。

## 16. TOC 与正文布局

TOC panel 挂在 `expanded-cell-input` 外层 root，不插入 ProseMirror 正文。

为了给左侧 TOC 留空间，样式通过外部 CSS 规则作用于 `.ProseMirror` 的 `padding-left`。这不会向正文节点插入元素、attribute 或 class，也不会调用任何 ProseMirror API。

如果未来发现宿主对 `.ProseMirror` padding 行为发生变化，应优先改成调整 `.nc-rich-text-content` 外层布局，而不是向 ProseMirror child DOM 写入结构。

## 17. 与 Markdown 导出脚本的接口

`nocodb-richtext-markdown-export.user.js` 当前通过：

```css
button[aria-label="切换 TOC"],
button[title="切换 TOC"]
```

查找 TOC 按钮，并把“复制 Markdown / 下载 Markdown”按钮定位在右侧。

v0.1 明确保留：

```html
aria-label="切换 TOC"
title="切换 TOC"
```

因此现有 Markdown 导出脚本不需要为 v0.1.x 改动。

## 18. 与 Markdown 表格 / 代码块工具的边界

v0.1 TOC：

- 不识别普通代码块内部文本为 heading；
- Markdown 表格 NodeView 不是 H1 ~ H6，因此自然被忽略；
- 不修改 `[data-nocodb-markdown-table-id]`；
- 不操作代码块 selection；
- 不依赖 Markdown 表格的 NodeView class。

因此 TOC 与这些脚本只共享同一个 Rich Text 页面，不共享内部状态。

## 19. 生命周期

初始化：

```text
bootstrap
→ 注入 CSS
→ 启动全局 lifecycle observer
→ 查找当前可见 Rich Text
→ collectRefs
→ 创建 state
→ 挂载 TOC button / panel
→ 默认打开
→ 延迟首次 snapshot
```

销毁：

```text
弹窗关闭 / root 更换 / editor 被替换
→ disconnect editor observer / ResizeObserver
→ 移除 scroll / composition listeners
→ 清 timer
→ 停止 resize drag
→ 移除 TOC button / panel
→ 清理 root class / CSS variables
```

## 20. 性能约定

后续维护必须继续遵守：

- `scroll` 回调只调度判停；
- MutationObserver 回调只分类并 schedule；
- 不在普通输入每一键后 `querySelectorAll` + render；
- 不在滚动每一帧 `getBoundingClientRect` 扫全部 heading；
- 不使用 document 级 `characterData` observer；
- 标题列表真正变化时才重建 TOC DOM；
- 普通正文变化只在安静后更新 heading 几何位置。

## 21. 禁止重新引入的机制

v0.1.5 已通过实机 A/B 测试确认，导航必须保持“纯 scrollTop”。后续维护不要重新引入：

```text
editor.editor
EditorView / EditorState
.pmViewDesc.view
registerPlugin()
ProseMirror Plugin
posAtDOM()
coordsAtPos()
nodeDOM()
TextSelection / NodeSelection / Selection.near()
transaction.setSelection() / dispatch()
浏览器 Selection + Range 主动移动 caret
主动 focus() / view.focus()
为压制 selection 回滚而持续或延迟重复写 scrollTop
给 heading 写 data-* ID
```

旧 v46.0.2、v0.1.3、v0.1.4 的经验都说明：TOC 一旦承担“替宿主管理 selection/caret”的职责，就很容易重新进入与 Tiptap / ProseMirror 状态机耦合的风险区。当前稳定边界是：**读 DOM、算几何、写 TOC 自己的 UI、写正文滚动容器的 `scrollTop`，除此之外不碰编辑状态。**

## 22. 维护测试清单

每次修改后至少手工验证：

1. 打开含 H1 ~ H6 的长 Rich Text，TOC 正常出现；
2. 在普通段落中第一次输入字符，光标不能因为 TOC 自身初始化而跳到文档末尾或代码块；
3. 连续普通输入，TOC 不应每键重建；
4. 修改 heading 文本，停顿后目录更新；
5. 新建 / 删除 / 改变 heading level，目录更新；
6. 中文输入标题时 composition 不被打断；
7. 正文滚动停止后 active 更新；
8. 手动滚动 TOC 时不会被强制拉回；
9. 点击目录项只改变 viewport；不得改变 DOM / PM selection，不得 focus editor，不得 dispatch transaction；
10. “跳到顶部 / 底部”只写正文滚动容器 `scrollTop`；
11. 刚打开长记录后直接点击“跳到顶部”，页面应到顶部；随后点击顶部正文再输入，不能跳回底部；
12. 点击 TOC 导航后，再用滚轮移动正文并点击新位置编辑，不能因为此前导航留下 selection 污染而跳回底部；
13. 作为 A/B 基准，直接执行 `pm.scrollTop = 0` 后点击正文编辑应与 TOC 纯滚动导航表现一致；
14. 若点击 TOC 后不点击正文而直接输入，允许宿主继续在原 caret 输入；TOC 不负责移动 caret；
15. 拖动 TOC 宽度后布局和 active 位置仍正确；
16. 双击 resizer 恢复默认宽度；
17. Markdown 导出按钮仍显示在 TOC 右侧；
18. Markdown 表格、普通代码块、彩虹标题、LongText 改色均不受影响；
19. 关闭 Rich Text 再打开另一条记录，不残留旧面板或旧 observer。

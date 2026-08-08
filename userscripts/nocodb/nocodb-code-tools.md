# NocoDB 代码块工具

`nocodb-code-tools.user.js` 用于增强 NocoDB CE LongText Rich Text 编辑器中的普通代码块，为代码块右上角提供悬浮操作栏。

## 功能

当鼠标悬停在展开后的 Rich Text 普通代码块上时，右上角显示：

```text
清空 → 复制
```

- **清空**：位于左侧。点击后显示脚本自己渲染的确认弹窗，确认后只删除代码块内容，保留代码块本身。
- **复制**：位于右侧，是主要高频操作。复制当前代码块文本到剪贴板。

脚本只处理展开后的 Rich Text 编辑区。表格未展开态由 canvas 渲染，不存在可挂载操作栏的普通代码块 DOM，因此不在处理范围内。

## 清空确认弹窗

清空属于破坏性操作，因此不会直接执行，也不会使用浏览器原生 `confirm()`。

点击“清空”后，脚本在同一个 overlay 中显示自定义确认弹窗，提供：

```text
取消 | 确认清空
```

默认定位约定为：

> 确认弹窗的右上角与“清空”按钮的左下角重合。

这样从“清空”按钮移动到确认操作的鼠标距离较短，同时不会遮挡右侧更常用的“复制”按钮。空间不足时允许为避免弹窗越出 Rich Text 内容区而做边界收敛。

点击“取消”或点击工具控件以外的位置会关闭确认弹窗。没有自动倒计时或延时恢复状态。

## Overlay 架构

NocoDB Rich Text 使用 ProseMirror/Tiptap。脚本不把按钮或弹窗插入 `<pre>` / `<code>` 内部，而是在 `.nc-rich-text-content` 下维护独立 overlay。

核心结构约定：

```text
.nc-rich-text-content
├─ .tiptap.ProseMirror
│  └─ pre > code
└─ 脚本 overlay
   ├─ [清空] [复制]
   └─ 清空确认弹窗
```

这样做是为了避免破坏 ProseMirror 的文档模型与 DOM 映射。

同时不要给 `.nc-rich-text` 根节点增加 `position: relative`。该节点会影响 NocoDB 原生 bubble toolbar 的定位参照系。脚本只给 `.nc-rich-text-content` 增加定位上下文。

## 复制机制

复制按以下顺序尝试：

1. `navigator.clipboard.writeText`；
2. Tampermonkey `GM_setClipboard`；
3. 临时 `textarea` + `document.execCommand('copy')` 兜底。

读取代码时会移除零宽空格 `U+200B`。

## 清空机制

清空操作必须遵守以下原则：

- 不执行 `code.textContent = ''`；
- 不执行 `pre.innerHTML = ''`；
- 不删除 `<pre>` / codeBlock 节点；
- 先聚焦当前 ProseMirror 编辑器；
- 使用 DOM Selection 选择当前 `<code>` 的内容；
- 通过浏览器编辑命令执行删除，让 ProseMirror 的编辑/DOM 观察机制接管变化；
- 最终保留空代码块。

如果浏览器或后续 NocoDB/Tiptap 版本不再接受这种编辑删除路径，应优先调整为宿主认可的 ProseMirror transaction，而不是退回直接改写编辑器 DOM。

## 与 Markdown 表格脚本的边界

`nocodb-markdown-table.user.js` 会使用特殊 `codeBlock` 作为 Markdown 表格的持久化载体，并通过 NodeView 显示成 HTML 表格。

代码块工具只针对普通可见代码块，并明确跳过带 `[data-nocodb-markdown-table-id]` 标识的表格 NodeView，避免把表格内部持久化内容当作普通代码清空。

## 事件与弹窗留存

NocoDB 可能把脚本控件点击识别成“点击 Rich Text 弹窗外部”。因此工具栏和确认弹窗中的交互控件都必须阻断：

- `pointerdown`；
- `mousedown`；
- `mouseup`；
- `click`。

阻断方式包括 `preventDefault()`、`stopPropagation()`，并在可用时调用 `stopImmediatePropagation()`。

修改这部分逻辑时应实际验证：

- LongText 弹窗不会因为点击工具按钮而关闭；
- 顶部原生工具栏布局不受影响；
- 滚动或调整弹窗尺寸后工具栏仍能重新定位；
- 清空确认弹窗打开时不会因为鼠标离开代码块自动消失。

## 核心选择器

当前实现依赖：

```css
.nc-rich-text-content
.nc-rich-text-content .tiptap.ProseMirror
pre > code
[data-nocodb-markdown-table-id]
```

NocoDB 或 Tiptap 升级后，如果类名、层级或 NodeView 结构发生变化，应优先检查这些接口。

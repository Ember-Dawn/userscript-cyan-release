# NocoDB 用户脚本说明

本目录保存用于自部署 NocoDB CE 的 Tampermonkey 用户脚本。当前脚本主要增强 LongText 字段、Rich Text 展开编辑器和表格导航体验。

## 脚本索引

| 中文名称 | 文件 | 用途 |
|---|---|---|
| NocoDB 代码块工具 | `nocodb-code-tools.user.js` | 为 Rich Text 代码块提供悬浮复制和带确认的安全清空功能。参见[详细说明](./nocodb-code-tools.md)。 |
| NocoDB 彩虹标题 | `nocodb-rainbow-headings.user.js` | 为 H1-H6 标题应用不同颜色。 |
| NocoDB LongText 字体改色 | `nocodb-longtext-color.user.js` | 为特定富文本内容应用颜色。 |
| NocoDB Markdown 表格 | `nocodb-markdown-table.user.js` | 将粘贴的 Markdown 表格转换为可显示、可编辑的表格。 |
| NocoDB Rich Text Markdown 导出 | `nocodb-richtext-markdown-export.user.js` | 复制或下载当前 Rich Text 编辑器的全部内容为普通 Markdown。 |
| NocoDB Rich Text 大纲 | `nocodb-richtext-outline.user.js` | 以纯 DOM 旁路方式显示可滚动、可调整宽度的 H1-H6 TOC。参见[详细说明](./nocodb-richtext-outline.md)。 |

`nocodb-folders.user.js` 已归档并停止公开发布。该脚本曾长期配合 NocoDB v2026.05.1 使用；NocoDB v2026.08.1 原生加入 Data 侧边栏文件夹（Base Sections）后，不再作为现役脚本维护。

旧版 `nocodb-richtext-outline.user.js` v46.0.2 已归档。归档版本采用 ProseMirror bridge + 标题快照 + DOM TOC 的混合路线，并已确认会触发“第一次按键后 selection 跳到文档后部”的编辑器异常。现役脚本已从零重写为纯 DOM 旁路方案，并从 v0.1.x 重新编号；不注册 ProseMirror plugin、不读写 selection；归档脚本仍保留在 `archive/userscripts/nocodb-richtext-outline-v46.0.2.user.js`，新架构详见 [`nocodb-richtext-outline.md`](./nocodb-richtext-outline.md)。

## Markdown 表格的实际保存与渲染结果

NocoDB CE 当前使用的 LongText Rich Text 编辑器没有原生 `table`、`tableRow`、`tableCell` 文档节点。`nocodb-markdown-table.user.js` 因此采用“保存格式”和“显示格式”分离的方案。

### NocoDB 中的持久化格式

表格源码保存在专用代码块中，大致形式如下：

````text
```nocodb-table
[[NOCODB_MARKDOWN_TABLE:v1:7f3a91c4b2de]]
| 姓名 | 年龄 | 城市 |
| --- | --- | --- |
| 小明 | 25 | 北京 |
```
````

这里的内部标记用于识别表格类型、格式版本和表格 ID。它不是面向用户的最终 Markdown 输出。

### 编辑器中的实际 DOM 结果

表格脚本通过 ProseMirror `codeBlock` NodeView，把上述代码块显示为标准 HTML 表格。只读状态下的核心结构如下：

```html
<div
  contenteditable="false"
  data-nocodb-markdown-table-id="7cb7b7cfb473"
>
  <button type="button" title="编辑表格">...</button>
  <div>
    <table>
      <thead>...</thead>
      <tbody>...</tbody>
    </table>
  </div>
</div>
```

跨脚本识别时应优先使用：

```css
[data-nocodb-markdown-table-id]
```

不要把带脚本版本号的 `tm-nmt-*-v31` 类名作为唯一识别接口，因为这些类名可能在表格脚本升级时变化。

## Markdown 导出脚本如何处理表格

`nocodb-richtext-markdown-export.user.js` 导出当前 Rich Text 编辑器时：

1. 查找带 `data-nocodb-markdown-table-id` 的表格 NodeView；
2. 读取其中真实的 `table`、`thead`、`tbody`、`th` 和 `td`；
3. 将其重新序列化为普通 Markdown 表格；
4. 忽略铅笔按钮、行列菜单、输入框和其他操作控件。

导出结果类似：

```markdown
| 姓名 | 年龄 | 城市 |
| --- | --- | --- |
| 小明 | 25 | 北京 |
```

导出结果不会包含：

- `[[NOCODB_MARKDOWN_TABLE:...]]`；
- ```` ```nocodb-table ```` 特殊代码块；
- 特殊编号或表格 ID；
- 表格编辑按钮和行列操作菜单。

如果表格处于编辑状态，导出脚本会要求先保存或取消。这样可以避免把尚未写回 NocoDB 的临时内容导出为正式 Markdown。

普通正文中的手动换行会导出为 Markdown 标准硬换行，也就是在行尾写入两个不可见空格后换行；导出源码中不会再出现可见的反斜杠，也不会输出 HTML `<br>`。表格单元格内部没有通用的纯 Markdown 多行语法，因此其中的换行仍使用 `<br>`，以免破坏整张 Markdown 表格。

## 导出按钮位置

Markdown 导出脚本依赖“切换 TOC”按钮作为定位锚点，通过按钮的 `aria-label` 或 `title` 查找 TOC，不依赖具体版本类名。现役 v0.1.x 继续保留 `aria-label="切换 TOC"` / `title="切换 TOC"`，因此现有导出脚本可以保持兼容。

按钮顺序为：

```text
TOC → 复制 Markdown → 下载 Markdown
```

两个按钮都位于 TOC 按钮右侧，不插入 NocoDB 原生右侧关闭按钮区域。

## Rich Text 弹窗尺寸与布局排查

NocoDB LongText Rich Text 弹窗的右下角带有原生尺寸调整手柄，可以手动拖动改变弹窗宽度和高度。弹窗被缩得较窄时，TOC 仍会占用左侧空间，因此正文区和顶部工具栏可能显得异常狭窄。

遇到编辑器突然变窄时，优先检查并拖动弹窗右下角恢复尺寸，再排查油猴脚本的 CSS。关闭脚本或强制刷新网页不一定让尺寸自动恢复，因为这种现象可能只是弹窗自身的可调整尺寸状态，并非脚本样式残留。

## 维护原则

- 不要直接向 ProseMirror 管理的普通正文节点中插入无关 DOM。
- `nocodb-code-tools.user.js` 的悬浮工具栏和确认弹窗必须继续放在 `.nc-rich-text-content` 外部 overlay 中；普通代码清空不得直接改写 `pre/code` 的 `textContent` 或 `innerHTML`。详细规则见 [`nocodb-code-tools.md`](./nocodb-code-tools.md)。
- 表格显示应继续通过 NodeView 完成，持久化仍由专用代码块承载。
- 导出只在用户点击按钮时遍历正文，不要在 `input`、`scroll` 或 MutationObserver 热路径中持续转换 Markdown。
- 修改跨脚本接口时，应同时检查表格脚本、导出脚本和本说明。
- `nocodb-richtext-outline.user.js` 不得重新注册 ProseMirror plugin、读写 selection 或向正文 heading 写入脚本 DOM 标记；详细边界见 [`nocodb-richtext-outline.md`](./nocodb-richtext-outline.md)。
- NocoDB 或 Tiptap 升级后，优先检查展开弹窗、编辑器、TOC 按钮和表格 NodeView 的选择器是否仍然有效。

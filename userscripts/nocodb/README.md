# NocoDB 用户脚本说明

本目录保存用于自部署 NocoDB CE 的 Tampermonkey 用户脚本。当前脚本主要增强 LongText 字段、Rich Text 展开编辑器和表格导航体验。

## 脚本索引

| 中文名称 | 文件 | 用途 |
|---|---|---|
| NocoDB 代码块复制 | `nocodb-code-copy.user.js` | 为 Rich Text 代码块增加悬浮复制按钮。 |
| NocoDB 彩虹标题 | `nocodb-rainbow-headings.user.js` | 为 H1-H6 标题应用不同颜色。 |
| NocoDB 文件夹 | `nocodb-folders.user.js` | 为 NocoDB 表格提供文件夹式组织、排序和低开销 WebDAV 自动同步。参见[详细说明](./nocodb-folders.md)。 |
| NocoDB LongText 字体改色 | `nocodb-longtext-color.user.js` | 为特定富文本内容应用颜色。 |
| NocoDB Markdown 表格 | `nocodb-markdown-table.user.js` | 将粘贴的 Markdown 表格转换为可显示、可编辑的表格。 |
| NocoDB Rich Text Markdown 导出 | `nocodb-richtext-markdown-export.user.js` | 复制或下载当前 Rich Text 编辑器的全部内容为普通 Markdown。 |
| NocoDB Rich Text 大纲 | `nocodb-richtext-outline.user.js` | 在 Rich Text 弹窗中显示可滚动、可调整宽度的 TOC。 |

## NocoDB 文件夹同步

`nocodb-folders.user.js` V11.1.1 使用紧凑的“加号 + Folder”文件夹按钮、首次同步四分支决策、设置面板实时状态反馈、页面聚焦触发、仅前台低频检查、ETag 条件写入、冲突安全副本和每日快照实现自动多端同步。WebDAV 主文件仍采用完整 JSON 快照，但连续操作会被防抖合并，相同内容不会重复上传。展开状态和外观设置只保存在当前设备。

配置方式、冲突处理、性能策略和备份目录结构见 [`nocodb-folders.md`](./nocodb-folders.md)。

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

Markdown 导出脚本依赖当前 Rich Text 大纲脚本提供的“切换 TOC”按钮。它通过按钮的 `aria-label` 或 `title` 查找 TOC，不依赖具体版本类名。

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
- 表格显示应继续通过 NodeView 完成，持久化仍由专用代码块承载。
- 导出只在用户点击按钮时遍历正文，不要在 `input`、`scroll` 或 MutationObserver 热路径中持续转换 Markdown。
- 修改跨脚本接口时，应同时检查表格脚本、导出脚本和本说明。
- NocoDB 或 Tiptap 升级后，优先检查展开弹窗、编辑器、TOC 按钮和表格 NodeView 的选择器是否仍然有效。
- 修改文件夹同步逻辑时，应同时检查 `nocodb-folders.user.js` 和 `nocodb-folders.md`，并保留原存储键的兼容性。

# NocoDB Markdown 表格：开发与维护说明

## 适用范围

脚本：`userscripts/nocodb/nocodb-markdown-table.user.js`，当前版本 **3.3.0**。适用于 NocoDB CE LongText 的 Rich Text / Tiptap 编辑器。脚本在网页主 JavaScript 环境连接 Tiptap，使用 ProseMirror `codeBlock` NodeView 显示、编辑表格。与 Markdown 导出、大纲和视觉增强脚本共存时，遵循根目录 `AGENTS.md` 以及 `userscripts/nocodb/README.md` 的跨脚本约定。

## 表格持久化结构

NocoDB CE 当前所用的 Rich Text schema 没有原生表格节点，因此将表格存于代码块中；代码围栏语言为 `nocodb-table`，文本以唯一标识开头：

````markdown
```nocodb-table
[[NOCODB_MARKDOWN_TABLE:v1:7f3a91c4b2de]]
| 姓名 | 年龄 | 城市 |
| --- | --- | --- |
| 小明 | 25 | 北京 |
```
````

旧标记 `[[NOCODB_MARKDOWN_TABLE_V1]]` 继续支持读取。不要在复制功能或 Markdown 正常导出中暴露该内部标记。每张新增表格生成独立 ID；保存通过 ProseMirror transaction 替换原代码块，沿用 NocoDB 的持久化流程。

## UI 与交互

- 浏览时只显示表格；悬停右上角依次显示 **复制、编辑、删除**。
- 复制只写入规范化的 Markdown 表格源码（无内部标记和代码围栏），优先使用 `navigator.clipboard.writeText`；成功或失败显示 Toast。编辑模式不提供复制入口，以免复制未保存内容。
- 双击单元格或点击编辑按钮进入编辑态；顶部提供新增行、新增列、取消、保存；行列细项在对应三点菜单。
- 点击编辑中的表格外部自动保存；未修改时直接退出；保存失败保留编辑态并尽量阻止外部切换。删除需要二次确认。
- 所有列均左对齐；输入对齐分隔符 `:---`、`:---:`、`---:` 时可以读取，但重新保存统一使用 `---`。

## Markdown 粘贴处理

- `onPaste` 仅处理 NocoDB Rich Text 编辑区域的用户粘贴；输入框、代码块和表格 NodeView 内部保留宿主默认行为。
- 单张纯 Markdown 表格继续走原有 `parseMarkdownTable` / `insertTableCodeBlock` 路径，降低回归风险。
- 混合粘贴走 `splitMixedMarkdown`：按行扫描，将普通 Markdown 与完整表格分段；支持多张表格，保持先后顺序；代码围栏（反引号或波浪号）里的示例不识别为表格。
- 普通段落/标题/列表由当前 Tiptap 的 `storage.markdown.parser.parse` 解析成 ProseMirror 节点；每个表格生成带标记的 codeBlock。所有节点先构建、校验，再用**单次 ProseMirror transaction** 插入，避免多次插入引起 selection 偏移和中间保存。
- 本功能读取剪贴板的 `text/plain`；不尝试从任意 HTML 表格推断 Markdown 结构。没有可识别 Markdown 表格时交回 NocoDB 原生粘贴。
- 如果宿主 Markdown parser 接口缺失、schema 不兼容或事务失败，不应插入部分内容；显示失败提示，原始剪贴板内容仍可重新粘贴。不要未经验证地用 HTML table 作为兜底，因为 NocoDB CE 会丢失表格结构。

## 性能和边界

全局仅有一个 paste 事件；编辑器发现依赖 MutationObserver 的增删节点，不在滚动或每次键入时扫描正文。表格单张最大 200 数据行、40 列、4,000 单元格、100,000 字符；混合粘贴总输入最多 300,000 字符、最多 24 张表格；超过限制时不接管原生粘贴（可能失去表格结构）。暂不支持合并单元格或单元格内真实换行。

## 测试与维护清单

1. `node --check userscripts/nocodb/nocodb-markdown-table.user.js`。
2. 纯表格粘贴、编辑、点击外部自动保存、重新打开记录校验持久化。
3. 混合粘贴：标题 + 段落 + 列表 + 2 张表格 + 后续段落；检查顺序与文本格式；检查一次撤销的范围。
4. 代码围栏中的表格样例必须保持代码；没有表格的普通 Markdown 使用原生粘贴。
5. 多表唯一 ID、旧 marker、分隔符短横线和对齐语法、转义竖线等兼容性。
6. 悬停复制按钮：复制的内容是标准 Markdown，不包含内部 marker；再次粘贴可生成另一张表。
7. 剪贴板含 `text/html` 的来源、无宿主 Markdown parser 的异常路径、中文输入、空行及撤销/重做，需要在真实 NocoDB CE 环境验证。
8. 与其他 NocoDB Rich Text 脚本同时开启时，检查 focus/selection、TOC、Markdown 导出是否正常。

当前的本地语法和分段测试不等同于实际 NocoDB 页面上的端到端验证；如发现 parser API 与预期不符，应优先适配已安装版本的接口，不要更改持久化格式。

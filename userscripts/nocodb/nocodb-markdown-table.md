# NocoDB Markdown 表格：开发与维护说明

## 适用范围

脚本：`userscripts/nocodb/nocodb-markdown-table.user.js`，当前版本 **0.3.1（原位单元格编辑实验版）**。适用于 NocoDB CE LongText 的 Rich Text / Tiptap 编辑器。脚本在网页主 JavaScript 环境连接 Tiptap，使用 ProseMirror `codeBlock` NodeView 显示、编辑表格。与 Markdown 导出、大纲和视觉增强脚本共存时，遵循根目录 `AGENTS.md` 以及 `userscripts/nocodb/README.md` 的跨脚本约定。

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

## UI 与交互（v0.3.1）

- **只有一套表格 DOM**：阅读与编辑不再切换界面，单击表头或单元格即在原位获得光标（`contenteditable=plaintext-only`）；不再创建隔离的 Tiptap 实例、弹出编辑框、切换旧版 `<input>` 界面或尝试回退。
- 仅保留表格悬停的复制与删除按钮；删除需二次确认。取消表格整体「编辑」按钮、双击进入编辑态、顶部行列工具栏。
- `Tab` / `Shift+Tab` 在表头及普通单元格间跳转；最后一个单元格按 `Tab` 可新增一行。`Enter` 阻止产生多段落，`Esc` 离开当前单元格焦点；右键单元格弹出插入/删除行列菜单。
- 修改保存在 NodeView 的本地草稿；点击表格外部时与之前一样检测变化并用单个 ProseMirror transaction 更新代码块。未修改不产生事务；保存失败保留草稿并阻止当前外部点击。
- 单元格只支持**单行纯文本内容**；文字中的 Markdown 标记以源码形式保留，不在单元格嵌套新的富文本编辑器。复杂单元格、合并单元格、拖动列宽均不在 GFM 功能范围。
- 内部依旧通过 `nocodb-table` `codeBlock` 承载。由于 NocoDB 原生 LongText Schema 不支持 `table`，本版本**不是裸 GFM 文本直接保存在底层 LongText 字段**；复制及配合导出脚本的最终输出是标准 Markdown 表格。

## Markdown 粘贴处理

- `onPaste` 仅处理 NocoDB Rich Text 编辑区域的用户粘贴；输入框、代码块和表格 NodeView 内部保留宿主默认行为。
- 单张纯 Markdown 表格继续走原有 `parseMarkdownTable` / `insertTableCodeBlock` 路径，降低回归风险。
- 混合粘贴走 `splitMixedMarkdown`：按行扫描，将普通 Markdown 与完整表格分段；支持多张表格，保持先后顺序；代码围栏（反引号或波浪号）里的示例不识别为表格。
- 普通段落/标题/列表由 NocoDB `storage.markdown.parser.parse` 转成 HTML 字符串；表格由 `tableToHtml` 生成 `<pre><code class="language-nocodb-table">` 形式，并将 marker 与 Markdown 表格源码作为代码块纯文本。将全部 HTML 片段按原顺序组合，交由 **Tiptap `commands.insertContent(html)`** 使用宿主自己的 HTML 解析规则完成单次插入；不依赖 `view.someProp('domParser')` / `view.someProp('clipboardParser')`，也不使用不可靠的 `can().chain()` 临时事务提取节点方案。
- 插入前先完成 Markdown→HTML 转换和表格 HTML 构造；插入后用每张表的新 ID 检查代码块是否保留。若运行时无法识别 `<pre>` 为 `codeBlock`，会给出 `table-codeblock-not-preserved` 的阶段错误。注意该后验检查不是事务性回滚；需在实际 NocoDB 环境验证一次粘贴和撤销行为。
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

## v0.2.1 修复记录

- 修复 v3.3.0 将 NocoDB `storage.markdown.parser.parse()` 输出的 HTML 字符串错误传入 `schema.nodeFromJSON()`、导致 `Unknown node type: undefined` 的问题。
- 已通过实际 Console 确认 NocoDB 的 Markdown parser 返回 HTML，如 `<h1>标题</h1><p>正文</p>`。使用 Tiptap 的无 dispatch 命令链解析 HTML 并提取节点；再与表格 codeBlock 一次提交。
- `@version` 从 3.3.0 调整为 0.2.1；Tampermonkey 不一定自动降级，需手动安装。持久化标记仍为 `v1`，不迁移数据。
- 需在真实 NocoDB CE 回归测试含四张表格、标题、列表、代码围栏的服务器维护 Markdown 文档；特别验证混合粘贴后的撤销和保存。

## v0.2.2 修复记录

- 不再使用 `view.someProp('clipboardParser'/'domParser')`：用户的 NocoDB 环境未暴露这两项接口。
- 不再依赖 `can().chain()` 的无 dispatch 模拟事务提取节点；统一用 Tiptap 自身 `insertContent(HTML)` 转换并一次插入。
- 混合内容经 Markdown→HTML 后与表格的 `<pre><code>` 拼接，再交由当前编辑器 HTML parser 处理。
- Console 报错带有阶段码：`markdown-parser-unavailable`、`markdown-to-html-failed`、`tiptap-html-insert-failed`、`tiptap-html-insert-rejected`、`table-codeblock-not-preserved` 等，方便定位实际环境中的进一步兼容性问题。
- 仍需在真实 NocoDB 进行端到端验证：特别检查表格作为 `codeBlock` 的保留、四张表的顺序、混合正文格式和撤销。

## v0.3.1 原位编辑重构

- 废弃 v0.3.0 独立 Tiptap 实验引擎以及失败回退，不再加载第二个编辑器实例。取消旧版输入框模式，不在阅读与编辑时重建不同的表格视图。
- 直接复用 NodeView 内部显示的 `table`，可编辑单元格不经独立弹窗；失焦或单击外部仍沿用已有草稿保存路径。
- 本次只重构表格交互。混合 Markdown 粘贴中列表类型、代码围栏、CSS 间距等之前发现的实际页面差异**尚未全部完成端到端修复**，不可宣称已全部解决。
- 本地完成 JavaScript 语法及静态结构检查；需要在真实 NocoDB 页面用测试记录验证焦点、中文输入法、Tab、右键菜单、自动保存及刷新后恢复。
- NocoDB 原生编辑器不支持表格节点，本脚本仍使用特殊代码块格式来确保数据在 NocoDB LongText 中可持久化；关闭脚本后应能恢复表格 Markdown 源码，但不会出现原生 HTML 表格。

### 浏览器验收建议

1. 在测试记录粘贴简单 GFM 表格，**单击**任意单元格，应立即出现原位光标，没有工具栏或第二编辑区域。
2. 编辑表头与数据行，测试 Tab/Shift+Tab、末尾 Tab 新增行、右键增删行列。
3. 点击外部自动保存，重新打开记录核对内容；无改动点击外部不应产生事务。
4. 测试复制 GFM、删除确认、两个以上表格、中文输入法、粘贴文字以及保存失败时草稿保留。
5. 使用原始包含 4 张表格及 Bash 围栏代码的文档检查混合粘贴，特别检查换行和列表层级；这些场景不因本次表格 UI 重构而自动视为通过。

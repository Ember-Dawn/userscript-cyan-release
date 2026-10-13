# NocoDB Markdown 表格：开发与维护说明

## 适用范围

脚本：`userscripts/nocodb/nocodb-markdown-table.user.js`，当前版本 **0.3.4（原位编辑撤销隔离与 Markdown 剪贴板实验版）**。适用于 NocoDB CE LongText 的 Rich Text / Tiptap 编辑器。脚本在网页主 JavaScript 环境连接 Tiptap，使用 ProseMirror `codeBlock` NodeView 显示、编辑表格。与 Markdown 导出、大纲和视觉增强脚本共存时，遵循根目录 `AGENTS.md` 以及 `userscripts/nocodb/README.md` 的跨脚本约定。

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

## UI 与交互（v0.3.2）

- **只有一套表格 DOM**：阅读与编辑不再切换界面，单击表头或单元格即在原位获得光标（`contenteditable=plaintext-only`）；不再创建隔离的 Tiptap 实例、弹出编辑框、切换旧版 `<input>` 界面或尝试回退。
- 仅保留表格悬停的复制与删除按钮；删除需二次确认，编辑中也允许删除（取消不丢草稿）。取消表格整体「编辑」按钮、双击进入编辑态、顶部行列工具栏。
- `Tab` / `Shift+Tab` 在表头及普通单元格间跳转；最后一个单元格按 `Tab` 可新增一行。`Enter` 移动至下一行同列；最后一行按 `Enter` 新增行并聚焦同列。`Esc` 离开单元格或清除选区；右键菜单通过 `document.body` Portal 按鼠标视口坐标定位。
- 从一个单元格按住左键拖到另一个单元格形成矩形选区，同一单元格内拖动仍选择文字。完整覆盖数据行时 Delete/Backspace 删除相应行；覆盖表头及所有数据行的部分列时删除列；其他矩形区域仅清空内容。整表选择只清空数据、不删除全部列。单击或 Esc 清除选区。此为实验性操作，需验证原位焦点与输入法。
- 修改保存在 NodeView 的本地草稿；点击表格外部时与之前一样检测变化并用单个 ProseMirror transaction 更新代码块。未修改不产生事务；保存失败保留草稿并阻止当前外部点击。
- 单元格只支持**单行纯文本内容**；文字中的 Markdown 标记以源码形式保留，不在单元格嵌套新的富文本编辑器。复杂单元格、合并单元格、拖动列宽均不在 GFM 功能范围。
- 内部依旧通过 `nocodb-table` `codeBlock` 承载。由于 NocoDB 原生 LongText Schema 不支持 `table`，本版本**不是裸 GFM 文本直接保存在底层 LongText 字段**；复制及配合导出脚本的最终输出是标准 Markdown 表格。

## Markdown 粘贴处理（v0.3.3）

- 只有包含可识别 GFM 表格的粘贴才被脚本接管；没有表格时交还给 NocoDB 原生粘贴。
- 通过 `splitMixedMarkdown()` 分段识别正文、独立 fenced code block、GFM 表格；fence 内的 `|` 不会被当成表格。
- **不再拼接 HTML 来插入代码块**：正文使用 NocoDB `view.someProp('clipboardTextParser')` 返回的 ProseMirror Slice；代码围栏和表格直接用当前 Schema 构造 `codeBlock` 节点。合并为一份 Fragment，构造一次 transaction。
- 在提交前检查事务最终文档中每个预期代码块的 `textContent`，包括 `#`、`\`、空行、缩进、换行与内部表格标记。若解析器缺失、节点构造失败或校验失败，则放弃提交，并通过 Console 输出具体阶段错误。已提交后仍应验证 NocoDB 后续 Markdown 持久化是否保真。
- 这一机制依赖当前 NocoDB 的 `clipboardTextParser` 插件；该 API 是否对所有 CE 构建可用仍须在真实页面验证，**没有静默退回旧版 HTML 拼接路径**。
- 纯表格粘贴沿用单表代码块插入方式；混合粘贴限定 300,000 字符与 24 张表格。未支持的复杂嵌套情形需要用户实际验收。

## 表格撤销/重做与菜单（v0.3.3）

- 在表格原位单元格内按 `Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 或 `Ctrl+Y` 重做；记录尚未保存的表格草稿快照，连续同一单元格输入按约 850ms 时间窗口合并。
- 行列增删、Enter/Tab 插入行、拖拽范围 Delete 进入同一草稿历史。退出表格并提交后，整次代码块替换由 NocoDB ProseMirror 自身历史管理，表格草稿历史不跨保存保留。
- 右键菜单使用本地白名单 SVG 路径绘制 16px 自绘图标，不加载远程图标字体。
- 不存在完整实时协同编辑的合并保障；保存时依旧应保护草稿，不因外部事件静默丢弃。

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

## v0.3.2 已知限制

- 本版只重构表格拖拽、快捷键、删除按钮与右键菜单。**混合 Markdown 粘贴仍采用 HTML 合并插入机制**，包含代码围栏时可能发生字符、换行或列表结构变化；不能声称已实现逐字符无损。涉及命令的完整文档须在测试记录中粘贴并核对后再正式使用。
- 鼠标拖拽区域选择不等于原生 ProseMirror 多单元格选择；选区属于表格 NodeView 本地状态。按 Delete 后修改进入本地草稿，点击表格外才提交。
- 不实现合并单元格、任意列宽或非 GFM 结构。

## v0.3.3 变更与现场验收

- 用包含 `#####` 注释、空行、反斜杠引号的 Bash 围栏与多张表格的文档进行混合粘贴；检查 Console 是否报告 `markdown-clipboard-parser-unavailable`、`codeblock-content-integrity-failed` 等错误。
- 粘贴成功后保存并重新打开，逐字符核对 Bash 代码。事务内保真检查不等于数据库往返保真。
- 在单元格内编辑连续文字后 Ctrl+Z/Ctrl+Y；分别测试行列删除、拖拽清空、Enter 新增行的撤销/重做；再点击表格外保存，检查 NocoDB 自身撤销整张表格修改。
- 验证菜单 SVG、鼠标附近定位、焦点、中文输入法、删除确认及外部保存。

## v0.3.4 Undo/Redo 与 Markdown 剪贴板

- 在表格焦点或拖拽单元格选区中，通过捕获阶段拦截 Ctrl/Cmd+Z、Ctrl/Cmd+Y、Ctrl/Cmd+Shift+Z；同时拦截单元格内 `beforeinput` 的 `historyUndo/historyRedo`，即使草稿历史为空也不让快捷键落入 NocoDB 原生文档历史。正文外的原生历史不接管。
- 草稿历史保存表格快照与当前单元格光标偏移，撤销/重做后恢复对应光标。切换单元格立即中断连续输入合并；中文输入法期间不执行撤销命令。真实浏览器的输入法、鼠标选区需要现场验收。
- 只在当前表格有矩形拖拽选区时拦截 Ctrl/Cmd+C、Ctrl/Cmd+X 对应的原生 `copy`/`cut` 事件；`text/plain` 输出标准 GFM Markdown，附带 `text/html` 表格，不包含内部 `nocodb-table` 标记。单元格纯文字选择、普通正文或正文与表格混合选区保持原生行为；本版**不支持**混合正文 + 表格的统一 Markdown 复制。
- 选中全表（含表头及全部数据）剪切时，成功写入剪贴板后删除整张 NodeView 对应的 ProseMirror 节点；其余矩形选区剪切仅清空所选单元格，并作为一个草稿撤销步骤。全表删除后的撤销交给 NocoDB 原生文档历史。
- v0.3.3 已通过用户验证的节点级混合 Markdown 粘贴引擎不作修改。
- 回归测试：依次编辑两格、连续撤销两次、第三次不应影响 NocoDB 历史；检查光标；整表/部分单元格拖选后 Ctrl+C、Ctrl+X，检查 Clipboard `text/plain` 的 GFM 格式、完整性，以及失败剪切是否保留内容。

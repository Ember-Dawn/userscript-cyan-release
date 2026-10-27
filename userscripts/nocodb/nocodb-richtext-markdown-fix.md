# NocoDB Rich Text Markdown 序列化修复

## 1. 功能、范围与限制

`nocodb-richtext-markdown-fix.user.js` 是面向自部署 NocoDB CE 的独立 Tampermonkey 用户脚本，用来修复 LongText Rich Text 展开编辑器中，块级图片后接标题、代码块、连续图片时，保存后 Markdown 块被拼在一起的问题。

- 只匹配 `https://nocodb.380782744.xyz/*`，只处理 `.nc-rich-text-content .tiptap.ProseMirror`。
- 只包装当前 Tiptap Markdown Serializer 的块级图片规则，其他节点规则由 NocoDB 原生处理。
- 不处理历史损坏文本；不会猜测段落中的 `###` 是否应恢复成标题。
- 不更改 NocoDB 服务器、数据库、Docker 配置、网络请求和浏览器存储。
- 依赖当前 NocoDB 内部接口，版本升级后仍需回归验证；不能保证所有 Markdown 语法或未来版本零风险。

## 2. 已确认的原始问题

禁用所有 NocoDB 油猴脚本并刷新，在新的空白测试记录中粘贴统一 Markdown。粘贴后的六个标题均为真实的 ProseMirror heading 节点，但不安装修复直接保存并重新打开后：

| 测试 | 粘贴后 | 保存后重新打开 |
|---|---|---|
| 普通三级标题 | H3 | H3 |
| 单张图片后三级标题 | H3 | paragraph，包含字面 `###` |
| 连续两张图片后三级标题 | H3 | paragraph，包含字面 `###` |
| 图片后二级标题 | H2 | paragraph，包含字面 `##` |
| 普通代码块后三级标题 | H3 | H3 |
| 图片与代码块后的三级标题 | H3 | 被吸收到 codeBlock |

结果从 **6/6 正常**变成 **2/6 正常**。先前抓到的 NocoDB PATCH 请求已包含错误拼接的 Markdown，说明问题不只是重新显示时的 CSS，也没有证据支持数据库是初始拼接来源。

故障输出示例：

````markdown
![](https://example.com/image.png)### 图片后的三级标题
````

重新解析后也可能被转义成 `![](image.png)\### 标题`。正确结构应有空行：

````markdown
![](https://example.com/image.png)

### 图片后的三级标题
````

连续图片之间以及图片后代码围栏同样应有块分隔。

## 3. 根因与精确修复

在目标浏览器实例中已验证：

- 图片 Schema：`editor.schema.nodes.image.spec.group === 'block'`、`inline === false`。
- `editor.storage.markdown.serializer` 提供 `nodes` getter 与 `serialize()`；`getMarkdown()` 使用该序列化机制。
- 宿主图片节点是块级节点，当前图片 Markdown 规则却未正确结束图片块，从而造成相邻 Markdown 结构拼接。

脚本为**每个 Tiptap 编辑器实例**包装 `serializer.nodes` getter。读取原始 getter 动态生成的节点映射，仅在 `image` 回调中：

1. 按原样运行 NocoDB 图片序列化回调；
2. 当 `node.isBlock` 为真，调用 ProseMirror 原生的 `state.closeBlock(node)`；
3. 返回其他节点的原生序列化规则，不改写图片 URL、标题、属性或正文。

这不是全局正则替换 Markdown。它不在保存前寻找 `##`、`###` 或 `````` 字符，也不重建编辑器文档。图片后面无论是另一个图片、标题、段落或代码块，均由原生块分隔逻辑处理。

**重要：** 补丁无法把已经错误解析成 paragraph 或 codeBlock 的历史内容恢复成标题。应使用原始 Markdown / 数据库备份重新粘贴正确内容，避免覆盖唯一原稿。

## 4. 自动安装与性能设计

### 每次打开都需要重新安装

NocoDB 关闭 Rich Text 面板后可能销毁旧 Tiptap 实例，重新打开会创建新的编辑器。测试中一次性 Console 补丁的首次保存正常，但新实例未安装补丁时，第二次编辑后又出现损坏。自动安装版 Console 补丁在页面未刷新的情况下多次重新打开、再次编辑和保存均正常。

正式脚本做法：

- 页面启动扫描一次已存在的 Rich Text 编辑器。
- `MutationObserver` 只观察新增 DOM 节点（`childList`），仅在新增节点或其子树寻找指定编辑器根，不在热路径遍历整个 Markdown 文本。
- 发现编辑器 DOM 早于 `root.editor` 时，只针对该根节点最多重试 16 次、间隔 80 ms；成功或节点脱离页面就结束。
- `focusin` 和 `paste` 捕获监听只作为初始化兜底，不阻止或更改事件；不增加每个按键的输入处理。
- `WeakSet` 记录已经安装的序列化器，不强引用已销毁实例；没有永久 `setInterval`、没有按秒全文扫描。
- 正常输入、滚动和选区变化时不会附加全文转换、DOM 正文修改或坐标计算。

相比先前 Console 验证版，这一方案取消每秒轮询和长期持有旧序列化器的 `Map`，预计日常开销较低；实际耗时仍需在宿主浏览器验证。

### 页面主 JavaScript 环境

脚本与仓库已有 `nocodb-markdown-table.user.js` 使用相同的主环境注入思路，通过 `unsafeWindow` 获取网页环境中的 Tiptap 实例。如果 CSP 或沙箱限制导致无法进入主环境，脚本提示警告并保持原始行为，不改用 DOM 文本替换。

## 5. 正常文本与数据安全保护

- 不使用 `editor.commands`、`setContent` 或 `dispatchTransaction`。
- 不更改 DOM 正文、selection、焦点、键盘事件或撤销栈。
- 不拦截 `fetch` / XMLHttpRequest，不修改 PATCH Payload，不访问 NocoDB API。
- 不把 Markdown、图片链接、Cookie、Token、数据库值或认证头写入日志、浏览器存储或外部服务器。
- 只有 Schema 声明图片是块级且原始 `nodes` getter、`image` 规则及 `serialize()` 可用时才安装。
- 如果序列化器已有其他脚本定义的实例级 `nodes` 属性，安全跳过，避免覆盖或重复包装。
- 不重写非图片节点规则，按 NocoDB 原始 getter 实时生成其余规则。
- 同一序列化器只安装一次。刷新页面后由 Tampermonkey 在新页面重新执行。

由于修复直接依赖内部接口，NocoDB 更新或其他脚本改变序列化器时可能需要适配；务必备份重要笔记，不能视为绝对无风险。

## 6. 安装、升级和诊断

脚本位于：

```text
userscripts/nocodb/nocodb-richtext-markdown-fix.user.js
```

私有开发仓库 `userscript-cyan/main` 保存源文件，GitHub Actions 自动发布到 `userscript-cyan-release/main`；不要直接编辑公开仓库。脚本 metadata 使用稳定 Raw 地址，不能写入 commit SHA 或缓存穿透参数。首次安装或更新后刷新整个 NocoDB 页面，确保新页面中自动启动。

默认无 UI、安静运行。可在 Console 查看只含计数的状态：

```javascript
window.__NOCODB_RICHTEXT_MARKDOWN_FIX_V1__?.status()
```

示例：`{ currentEditors: 1, currentPatched: 1, totalPatched: 3, skipped: 0 }`。

- `currentEditors`：当前符合选择器的 DOM 数量。
- `currentPatched`：当前 DOM 上已经安装补丁的序列化器数量。
- `totalPatched`：本次页面加载以来累计安装的实例数量；多次重开可增长。
- `skipped`：因接口不兼容或存在实例级 `nodes` 冲突而跳过的尝试次数，不代表损坏数据数。

禁用方式：在 Tampermonkey 中关闭脚本并**刷新网页**，恢复 NocoDB 原生行为。只禁用而不刷新，当前页面已经安装的运行时补丁仍可能存在。禁用不回滚已经保存的内容。

## 7. 完整回归验收

请使用**全新临时记录**，禁用旧 Console 实验补丁；不要在重要笔记上试验。

### A. 核心流程

1. 启用正式脚本，按 `Ctrl + Shift + R` 强制刷新 NocoDB。
2. 新建空白 Rich Text 测试记录，打开面板；状态检查 `currentPatched >= 1`。
3. 粘贴统一六项测试文本：普通 H3、图片后 H3、连续两图后 H3、图片后 H2、普通代码块后 H3、图片后代码块再接 H3；确认粘贴后 6/6。
4. 关闭保存再打开，确认 6/6；检查新编辑器同样 `currentPatched >= 1`。
5. 在文末真正新增一行，关闭保存、重开，确认仍 6/6。
6. 再次强制刷新网页，打开确认 6/6。
7. **刷新后再修改文末、保存、重开**，仍需 6/6。Console 临时补丁刷新后不会自动重启，正式脚本必须覆盖这一步。

### B. 正常内容保护

保存前后比较：纯文本段落、H1–H6、粗斜体、删除线、列表和嵌套列表、引用、行内代码、超链接、代码围栏中原样出现的 `###`、连续图片、图片与列表或引用相邻、特殊字符图片 URL，以及较大的 Markdown。重点观察是否只在块级图片附近补了必要的分隔、其他文档结构不变。

### C. 与其他 NocoDB 脚本协作

逐步启用现有 Markdown 表格、代码块工具、视觉样式增强、图片查看器、Markdown 导出、大纲和思维导图脚本。检查：

- `nocodb-table` 特殊代码块的 NodeView 仍可编辑保存；导出脚本仍把它还原为普通 Markdown 表格。
- 标题 TOC、图片交互、光标与键盘输入无异常；不影响其他脚本的 DOM 约定。
- 连续开关编辑面板约 20 次，实例自动安装正常，正常打字不出现明显延迟。
- 空闲期间没有永久定时轮询或多余网络请求。

### D. 升级回归

NocoDB 升级后，优先**在临时记录**测试原生行为：若官方已经修复，应考虑停用本脚本。不要直接在生产笔记中试验兼容性。

上面的完整宿主验收需要在实际 NocoDB 浏览器内完成。开发阶段的静态、模拟和语法检查，不能代替真实保存、重开和刷新测试。

## 8. 故障排查

| 表现 | 排查方向 |
|---|---|
| 状态对象不存在 | 确认 Tampermonkey 脚本启用、域名匹配、刷新后没有主环境注入警告。 |
| `currentPatched: 0` | 先确认富文本面板已打开并聚焦正文；再检查根节点、实例初始化与 `skipped`。 |
| `skipped` 增长 | NocoDB Schema / getter 不兼容，或其他脚本抢先设置了 `serializer.nodes`。 |
| 刚粘贴正确，保存后坏 | 追查是否首次粘贴前安装、是否重建了新实例，并检查真实 PATCH；单独 `getMarkdown()` 正常不代表保存正确。 |
| 第一次保存正常，第二次坏 | 检查关闭重开后是否自动对新的实例安装。 |
| 刷新后能读取，修改后坏 | 确认正在使用**正式油猴脚本**，不是刷新后消失的 Console 补丁。 |
| 旧内容已经损坏 | 使用可信原始 Markdown 或数据库备份恢复，不从字面 `###` 猜测结构。 |

## 9. 维护约定

优先保留最小修复：原生图片规则执行后仅对块级图片调用 `closeBlock()`。不顺带修改 Markdown 导出、表格存储格式、服务器保存链路或其他脚本。每次代码改变要提升 `@version`，检查 `@match`、`@updateURL`、`@downloadURL` 和发布流程；按 `AGENTS.md` 更新文档索引。

语法检查命令：

```bash
node --check userscripts/nocodb/nocodb-richtext-markdown-fix.user.js
```

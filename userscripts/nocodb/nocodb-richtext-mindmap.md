# NocoDB Rich Text × Mind-map 联动（v0.1.0）

## 目标与职责

新脚本 `nocodb-richtext-mindmap.user.js` 专为 NocoDB 原生 LongText → Rich Text 展开编辑器设计。它在已有 TOC、复制 Markdown、下载 Markdown 之后增加“思维导图”按钮，不使用 Grid Button、NocoDB v3 Data API、`MindMapData`、API Token、SimpleMindMap bundle 或旧 iframe bridge。

油猴只负责标志解析、首次插入 UUID、Modal 和 iframe 生命周期。Mind-map Docker 负责登录、文件存在性检查、创建确认、权限、绘图、自动保存、图床与导出。正式 JSON 仅存于服务器 bind mount；Rich Text 只存可见永久 URL。

## 关联协议

正文独立段落示例：

```text
【mindmap】https://mindmap.380782744.xyz/m/550e8400-e29b-41d4-a716-446655440000
```

- 接受预期域名、HTTPS、`/m/{uuid}`（末尾斜杠可选）和规范 UUID 格式，读取已有关联；新建 UUID 使用 `crypto.randomUUID()`。
- 每个 Rich Text 只允许一个标志。多条、畸形、或写在段落以外的可疑标志必须阻止操作并提示手动处理。
- URL 可由 Tiptap 自动生成链接节点；检查时读取 ProseMirror 文档文本而非解析 `innerHTML`。
- 在没有标志时，使用当前 DOM 的 `editor.editor.commands.insertContentAt(doc.content.size, paragraph, { updateSelection: false })` 插入独立段落，并立即检查写入结果。不会直接修改 ProseMirror DOM，也不会直接发送 NocoDB API 请求。
- 成功插入后乐观地立即打开 Modal；NocoDB 的保存是否已持久化是另一回事。若用户撤销标志或 NocoDB 保存失败，Mind-map 可能留下未关联文件，此风险按照设计备忘接受。

## 打开流程

1. 查找 `.nc-long-text-expanded-modal[role="dialog"]` 内的 `.tiptap.ProseMirror`；验证 `el.editor` 可用且 `editor.view.dom === el`。
2. 在当前 Modal 中查找 `.tm-rmd-export-download-v1`，于其右侧插入自有按钮，不干预其他工具。
3. 点击时检查当前 ProseMirror 文档中的标志：没有则插入，有且有效则直接打开；重复或畸形则停止。
4. 在 NocoDB 页面创建约 `92vw × 90vh` 的 Modal，创建新的 iframe，打开 `https://mindmap.380782744.xyz/m/{uuid}`。
5. Mind-map 自行判断：未登录则登录并回到原 UUID；文件缺失则显示确认创建；已有文件则进入编辑。GET 页面本身不会创建 JSON。
6. 关闭 Modal 时移除 iframe，下次打开重新创建。打开过程中提供加载界面；iframe `error` 可重试或新标签页打开。跨域页面内的登录/HTTP 状态无法由油猴直接读取。

## UI 与兼容性

- 标准入口位于“下载 Markdown”右边，不占用 NocoDB 原生右侧关闭按钮区域。
- 尽量不抢走编辑器焦点，工具栏按下鼠标时使用 `preventDefault()`，不要在文档正文增加 UI 节点。
- 弹窗 UI 采用深色外框；iframe 内的 UI 由 Mind-map 自己控制。
- 使用预连接提升首次启动网络准备，但不创建隐藏 iframe、不复用常驻实例、不建立 Service Worker/持久缓存。
- 编辑器内容由 Tiptap 正常事务修改，以配合撤销/重做、NocoDB 自动保存和其他 Rich Text 脚本。
- 不向 Mind-map iframe 发送 NocoDB 正文、API 凭据或 `postMessage` 旧版数据协议。

## 安全限制与注意事项

- 不在用户脚本中保存或处理 Mind-map 登录凭据。
- 用户必须确保 Mind-map 的 CSP `frame-ancestors` 允许指定 NocoDB 域名嵌入，后端的会话 Cookie、CSRF 与权限校验仍然生效。
- 新脚本不会读取 iframe 内的 dirty 状态；**关闭 iframe 前必须等待 Mind-map 自己显示保存完成**。如需可靠的关闭前确认，需要未来在 Mind-map Docker 中实现仅限来源的状态通信，不能假定本版已有该协议。
- `iframe` 的 `load` 事件不证明页面认证、API 或画布已经就绪；慢网络、内部错误及登录故障需由 Mind-map 页面自己呈现。
- 识别只接受普通段落标志。如果标志位于代码块、标题、表格特殊节点或与正文混合，需要用户手动整理，不会自动删除、搬迁或覆盖。

## 回归检查

1. 无标志：插入独立段落，检查 Tiptap 撤销/重做与 NocoDB 保存。
2. 已有合法标志：复用 UUID，不重复插入；自动链接格式仍能识别。
3. 畸形、多条或代码块中的标志：停止并提示。
4. 未登录、缺失 JSON、已有 JSON、回收站、无权限：Mind-map 页面分别按自身规则处理。
5. 关闭并重新打开：每次是新的 iframe；多个 Rich Text 不串 UUID。
6. 其他工具栏脚本：TOC、复制/下载 Markdown、Markdown 表格、图片查看器与输入法不受影响。
7. NocoDB 工具栏被 SPA 卸载后重建：按钮不累积、不操作旧编辑器实例。
8. 通过 HTTPS 实际地址测试 iframe 的 CSP、登录 Cookie、跨域及 Cloudflare 路径。
9. 确认图片粘贴、节点快捷键、后台自动保存和 HTML 导出均由 Mind-map 控制。

## 旧版归档与安装

旧版 v0.3.2 归档到 `archive/userscripts/nocodb-mindmap-v0.3.2.user.js` 和 `.md`。**必须在 Tampermonkey 中停用/卸载旧版“NocoDB 思维导图”脚本**，并移除旧 NocoDB Grid Button 的使用习惯。旧 `MindMapData` 不会自动迁移到 Docker 文件。

新脚本私有开发 Raw 地址：

正式安装和自动更新使用公开发布仓库 `userscript-cyan-release` 中的 `userscripts/nocodb/nocodb-richtext-mindmap.user.js`。源脚本 metadata 中的私有开发 Raw 地址由发布工作流在公开脚本副本中自动替换；本说明不嵌入私有 Raw 下载链接。

发布后由 `userscript-cyan-release` 提供公开安装和更新。

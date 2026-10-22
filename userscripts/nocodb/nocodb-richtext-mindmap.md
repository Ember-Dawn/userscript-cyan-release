# NocoDB Rich Text × Mind-map 联动（v0.1.4）

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
- 在没有标志时，使用当前 `editor.editor` 的 ProseMirror `state.tr` + `view.dispatch()` 一次性写入两个顶层段落：关联标志段落与一个末尾空段落。若整个编辑器只有一个默认空段落，就替换它而不在标志前留下空行；若末尾已有空段落则复用其位置；否则追加。末尾空段落由 ProseMirror 自然渲染为带 `ProseMirror-trailingBreak` 的 `<br>`。此操作参与原生撤销/重做，不修改 `innerHTML`、不发送 NocoDB API。
- 成功插入后乐观地立即打开 Modal；NocoDB 的保存是否已持久化是另一回事。若用户撤销标志或 NocoDB 保存失败，Mind-map 可能留下未关联文件，此风险按照设计备忘接受。

## 打开流程

1. 查找 `.nc-long-text-expanded-modal[role="dialog"]` 内的 `.tiptap.ProseMirror`；验证 `el.editor` 可用且 `editor.view.dom === el`。
2. 在当前 Modal 中查找 `.tm-rmd-export-download-v1`，以相同的绝对定位容器作为参照，在下载按钮右侧 6px 放置 30×30px 纯图标按钮。仅插入 DOM 相邻位置不足以决定视觉位置；不干预其他工具。
3. 点击时检查当前 ProseMirror 文档中的标志：没有则插入，有且有效则直接打开；重复或畸形则停止。
4. 在 NocoDB 页面创建约 `92vw × 90vh` 的 Modal，创建新的 iframe，打开 `https://mindmap.380782744.xyz/m/{uuid}`。
5. Mind-map 自行判断：未登录则登录并回到原 UUID；文件缺失则显示确认创建；已有文件则进入编辑。GET 页面本身不会创建 JSON。
6. v0.1.4 关闭 Modal 时移除 iframe；v0.2.0 关闭时保存并隐藏单个常驻 iframe。打开过程中提供加载界面；iframe `error` 可重试或新标签页打开。跨域页面内的登录/HTTP 状态无法由油猴直接读取。

## UI 与兼容性

- 标准入口位于“下载 Markdown”右边，不占用 NocoDB 原生右侧关闭按钮区域。按钮只显示 30×30px 图标，悬停显示「打开关联的思维导图」提示；与 TOC/导出按钮共享绝对定位参照，根据下载按钮的 offsetTop、offsetLeft、offsetWidth 更新坐标。
- 通过 ResizeObserver 监听下载按钮尺寸变化、MutationObserver 监听其 class/style，窗口 resize 时同步位置；富文本弹窗或锚点被卸载、替换时销毁旧按钮及观察器，避免重复挂载。
- 尽量不抢走编辑器焦点，工具栏按下鼠标时使用 `preventDefault()`，不要在文档正文增加 UI 节点。
- 弹窗 UI 采用深色外框；iframe 内的 UI 由 Mind-map 自己控制。
- 使用预连接提升首次启动网络准备，但首次点击前不创建 iframe；v0.2.0 在 NocoDB 页面生命周期内复用单个 iframe，不建立 Service Worker/持久缓存。
- 编辑器内容由 Tiptap 正常事务修改，以配合撤销/重做、NocoDB 自动保存和其他 Rich Text 脚本。
- 不向 Mind-map iframe 发送 NocoDB 正文、API 凭据或 `postMessage` 旧版数据协议。

## 安全限制与注意事项

- 不在用户脚本中保存或处理 Mind-map 登录凭据。
- 用户必须确保 Mind-map 的 CSP `frame-ancestors` 允许指定 NocoDB 域名嵌入，后端的会话 Cookie、CSRF 与权限校验仍然生效。
- 新脚本不会读取 iframe 内的 dirty 状态；**关闭 iframe 前必须等待 Mind-map 自己显示保存完成**。如需可靠的关闭前确认，需要未来在 Mind-map Docker 中实现仅限来源的状态通信，不能假定本版已有该协议。
- `iframe` 的 `load` 事件不证明页面认证、API 或画布已经就绪；慢网络、内部错误及登录故障需由 Mind-map 页面自己呈现。
- 识别只接受普通段落标志。如果标志位于代码块、标题、表格特殊节点或与正文混合，需要用户手动整理，不会自动删除、搬迁或覆盖。

## 回归检查

1. 无标志：空文档不产生前置空段落；非空文档保留已有正文；关联标志后始终恰好追加或保留一个空段落（由 ProseMirror 显示末尾 `<br>`）；检查撤销/重做和 NocoDB 保存。
2. 已有合法标志：复用 UUID，不重复插入；自动链接格式仍能识别。
3. 畸形、多条或代码块中的标志：停止并提示。
4. 未登录、缺失 JSON、已有 JSON、回收站、无权限：Mind-map 页面分别按自身规则处理。
5. 关闭并重新打开：v0.2.0 复用同一个 iframe，但必须安全卸载旧 UUID 对应画布；多个 Rich Text 不串 UUID。
6. 其他工具栏脚本：TOC、复制/下载 Markdown、Markdown 表格、图片查看器与输入法不受影响。
7. NocoDB 工具栏被 SPA 卸载后重建：按钮不累积、不操作旧编辑器实例；调整弹窗大小、TOC 显隐与页面窗口尺寸时按钮保持在下载按钮右侧，不掉到正文底部。
8. 通过 HTTPS 实际地址测试 iframe 的 CSP、登录 Cookie、跨域及 Cloudflare 路径。
9. 确认图片粘贴、节点快捷键、后台自动保存和 HTML 导出均由 Mind-map 控制。

## 旧版归档与安装

旧版 v0.3.2 归档到 `archive/userscripts/nocodb-mindmap-v0.3.2.user.js` 和 `.md`。**必须在 Tampermonkey 中停用/卸载旧版“NocoDB 思维导图”脚本**，并移除旧 NocoDB Grid Button 的使用习惯。旧 `MindMapData` 不会自动迁移到 Docker 文件。

新脚本私有开发 Raw 地址：

正式安装和自动更新使用公开发布仓库 `userscript-cyan-release` 中的 `userscripts/nocodb/nocodb-richtext-mindmap.user.js`。源脚本 metadata 中的私有开发 Raw 地址由发布工作流在公开脚本副本中自动替换；本说明不嵌入私有 Raw 下载链接。

发布后由 `userscript-cyan-release` 提供公开安装和更新。


### v0.1.3 可见尾部空行

- 新插入一条关联标志时，单个 ProseMirror transaction 同时写入标志段落和一个尾部空段落。
- 尾部优先使用 `hardBreak` 节点，使末尾的空行明确可见；若 Schema 不支持 hardBreak，则保留普通空段落。
- 空白编辑器不保留标志前的占位空段落，已有合法标志再次打开时不改动内容。
- 实测时重点检查保存后重新打开以及一次撤销是否可以整体恢复插入前的文档。

## v0.1.4：系统主题及尾部空段落兼容

- NocoDB 油猴外层 Modal 的标题栏、边框、加载提示和重试按钮通过 CSS `prefers-color-scheme: light` 覆盖深色默认样式，随系统/浏览器偏好实时变化；不读取 Mind-map iframe 的主题选项，也不对 iframe 发主题消息。
- 新插入关联标志时，以**一次 ProseMirror transaction**插入“标志段落 + 两个真实空段落”。空正文会替换原占位段落；如果末尾原有空段落，则复用其位置。
- 两个空段落是基于当前 NocoDB 的实测兼容方案：初次插入两个，关闭并重新打开后保留一个。此行为取决于宿主的持久化/规范化，未来升级 NocoDB 必须回归验证。
- 不使用 `hardBreak` 伪造尾部空段落；插入后检查末尾三个节点的内容和顺序。已有合法标志时不修改正文。
- 回归测试应覆盖：空正文/非空正文插入、一次撤销、关闭再打开后是否保留一个空段落、系统浅色/深色切换时 Modal 外框和加载状态是否随之变化。

## v0.2.0：单 iframe + SPA 内部切换

- 首次点击时仍以 `/m/{uuid}` 创建 iframe。关闭不再直接移除：发送 `CLOSE`，等待 MindMap 现有保存守卫通过并内部返回主页后才隐藏 Modal。保存失败时保留画布，不强制重载。
- 再次打开不同 UUID 时，发送 `OPEN`，复用 Vue SPA / JS 模块；不复用旧导图 JSON、撤销历史或画布实例。整个 NocoDB 页面只保留一个 iframe，关闭/刷新 NocoDB 页面时由浏览器自然销毁。
- 协议 `mindmap-embed` v1，消息 `READY`、`OPEN`、`CLOSE`、`RESULT`，含 requestId；严格校验消息来源、窗口对象和 UUID。无需 NocoDB API 或后端接口。
- 部署必须先更新 MindMap 再更新本油猴脚本。若超时/未收到协议回应，Modal 保留，并提示检查或重试，避免误认为已经安全保存。
- 回归测试：打开 A → 修改立即关闭 → 打开 B → 打开 C；断网、revision 冲突、登录失效；富文本标志验证和主题兼容继续保持。

### v0.2.1: Embedded navigation safety

- Wait for actual iframe OPEN completion (including canvas readiness) before removing the parent overlay; allow a longer bounded timeout for opening a map.
- A timed-out operation is considered *indeterminate*, not canceled: keep the pending request slot until the matching RESULT arrives, so a second UUID switch cannot overtake it. A lost reply requires a parent-page reload; never reload an iframe that might contain unsaved edits.
- Preserve single-iframe lifetime and the existing NocoDB marker/ProseMirror behavior.

## v0.2.3：无标题栏嵌入弹窗

- 移除 NocoDB 侧 MindMap 弹窗的顶部“思维导图”标题栏；iframe 画布直接占满弹窗高度，保留原有尺寸。
- 关闭按钮改为弹窗右上角 32×32px 悬浮叉号，使用随浅色/深色系统主题调整的半透明背景；不修改 MindMap iframe 内的 UI。
- 关闭按钮仍调用既有 `closeOverlay()`，保留 CLOSE 保存守卫、单 iframe 复用、失败提示和按 Esc 关闭逻辑；原有 `fullscreen` iframe 权限继续保留。
- 回归：浅/深色主题下关闭按钮可见且不遮挡主要编辑控件；CLOSE 成功才隐藏，保存失败不隐藏；全屏/退出全屏、再次打开不同 UUID 仍正常。

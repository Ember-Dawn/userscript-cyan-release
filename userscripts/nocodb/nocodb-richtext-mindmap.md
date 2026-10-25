# NocoDB Rich Text × MindMap 联动（v0.2.5）

## 职责与数据边界

`nocodb-richtext-mindmap.user.js` 在 NocoDB 原生 LongText → Rich Text 展开编辑器的 TOC、复制 Markdown、下载 Markdown 后增加「思维导图」入口。脚本只负责读取/插入关联标志、管理 NocoDB 侧弹窗及 iframe，不接管导图编辑与保存。

- NocoDB Rich Text **仅保存一个独立段落形式的永久链接**，示例：

  ```text
  【mindmap】https://mindmap.380782744.xyz/m/550e8400-e29b-41d4-a716-446655440000
  ```

- 只接受 `https://mindmap.380782744.xyz/m/{UUID v4}`（允许末尾 `/`），与 MindMap 的 `UUID_V4` 校验一致。新增关联使用 `crypto.randomUUID()`；已有合法关联沿用原 UUID。
- 检测 NocoDB 当前 ProseMirror 文档的**实际文本**，可识别 Tiptap 自动链接；多条标志、畸形标志、写在其他块类型中的标志均停止操作，避免覆盖正文。
- 首次关联以**一次 ProseMirror transaction**插入标志段落及两个真实空段落。空文档替换原占位段落；末尾已有空段落时在原位置替换。该方式参与 NocoDB 原生撤销/重做，不直接修改 `innerHTML`，也不请求 NocoDB API。
- 原先的宿主兼容观察是：首次插入两个空段落，保存后重新打开常会只保留一个。升级 NocoDB 后需要重新验证，不把该现象视为跨版本保证。
- 真正的 JSON、权限、登录、创建确认、保存队列、图片、导出都由 MindMap Docker 服务处理。脚本不处理 API Token、NocoDB v3 Data API、`MindMapData`、SimpleMindMap bundle 或旧 iframe bridge。
- 脚本插入关联标志后会立即尝试打开；这**不等于 NocoDB 已持久化标志**。撤销或保存失败可能留下未关联的 MindMap 文件。

## 弹窗与单 iframe 生命周期

1. 在 `.nc-long-text-expanded-modal[role="dialog"]` 中找到 `.tiptap.ProseMirror` 和可用的 `editor`，并验证 `editor.view.dom` 与当前 DOM 一致。
2. 以 `.tm-rmd-export-download-v1` 为定位锚点，把 30×30px 图标按钮放在「下载 Markdown」右侧 6px；使用 ResizeObserver、MutationObserver 及窗口 resize 同步位置，旧弹窗卸载时清理按钮和观察器。工具按钮的 `mousedown` 使用 `preventDefault()` 避免抢走富文本编辑焦点。
3. 点击时检查关联。无标志才插入；有且合法则打开；重复或畸形则提示人工处理。
4. 首次打开时创建约 `92vw × 90vh`、无标题栏的 NocoDB 侧 Modal，并创建一个 `iframe` 指向 `/m/{uuid}`。右上角 32×32px 悬浮关闭按钮；外层颜色随系统 `prefers-color-scheme` 变化，iframe 内主题由 MindMap 自己决定。
5. 后续在同一个 NocoDB 页面**复用唯一 iframe**。重新打开其他导图使用 `OPEN` 内部切换，避免重建 Vue SPA；关闭使用 `CLOSE`，等待 MindMap 保存保护和返回主页成功后才隐藏弹窗、清空当前 UUID，不销毁 iframe。
6. 保存冲突、断网、权限失败或请求结果不确定时，不强行关闭、重载或切换含有潜在未保存内容的 iframe；保留用户查看/处理错误的机会。用户主动刷新整个 NocoDB 页面才销毁 iframe。

## 嵌入通信与加载状态

- 协议为 `mindmap-embed` **v1**：MindMap 发 `READY`，油猴发 `OPEN`/`CLOSE`（含 `requestId`、可选 UUID），MindMap 回 `RESULT`。双方校验 `postMessage` 的 origin、source、协议及版本；不传递富文本正文和凭据。
- `READY` **只代表 MindMap 通信桥已启动**，不代表登录成功、文件存在或画布已经就绪。MindMap 自己负责显示登录、缺失文件的创建确认、画布加载和错误；`OPEN` 的成功 `RESULT` 则由 MindMap 在切换完成后发送。
- **v0.2.5 首次加载行为**：iframe 触发 `load` 时隐藏 NocoDB 外层加载层，让用户直接看到 MindMap 的登录、缺失文件、画布或错误页面。`load` 不代表通信桥、认证或画布就绪；`READY` 仍独立标记通信可用，只有收到它才能发送 `OPEN/CLOSE`。
- 不再因首次 15 秒未收到 `READY` 而显示阻挡 iframe 的失败遮罩。若确实触发 `error`，才提供重试与新标签页入口；没有 `READY` 时，重载 iframe 前仍需要用户确认，防止覆盖可能存在的编辑状态。
- 关闭时依赖 MindMap 的 `flushActiveEditor()` 和路由保存守卫，而不是油猴读取 iframe 内的 dirty 状态；`CLOSE` 成功才隐藏。若 MindMap 尚未准备好或请求失败，弹窗不应伪装成安全关闭。

## 部署与兼容性

- MindMap 必须配置 `MINDMAP_EMBED_ALLOWED_ORIGINS=https://nocodb.380782744.xyz`，其后端 CSP `frame-ancestors` 必须允许 NocoDB 嵌入；保留 Cookie、CSRF、权限及 origin 校验，不为方便 iframe 放宽鉴权。
- 必须通过实际 HTTPS 站点验证跨域 iframe、登录跳转、Cookie、反向代理及 Cloudflare 行为。iframe 的 `load` 和 `error` 事件不能可靠反映内部 HTTP 状态。
- 与 TOC、Markdown 导出、表格、图片查看器共存。不要向 ProseMirror 正文插入工具 UI，也不要修改其 selection 或注册多余插件。
- 首次引入 MindMap 协议或以后修改联动协议时，先部署 MindMap，确认生效，再安装新版油猴；此次 v0.2.5 不改变 v1 消息结构，MindMap 核心无需因本次更新重新部署。
- 开发源脚本 metadata 的 Raw 链接指向私有 `userscript-cyan/main`；公开发布由工作流同步至 `userscript-cyan-release`，正式安装和更新通过公开 Raw 地址完成。

## 回归检查

1. 标志：空/非空正文插入、已有有效 URL 复用、自动链接、多条/畸形/非段落标志拒绝；测试 UUID v4 正例，以及 v1/v7/版本位异常与非法 variant 的拒绝。
2. ProseMirror：一次事务、撤销/重做、保存后重开、尾部空段落；中文输入法组词期间应先完成输入再打开。
3. 工具栏：按钮始终位于下载 Markdown 右侧；调整弹窗大小、TOC 显隐、SPA 卸载/重建后不重挂、不错位、不抢编辑焦点。
4. 首次打开：iframe `load` 后可直接看到 MindMap 页面；即使尚未收到 `READY` 也不被遮罩阻挡；收到 `READY` 后允许安全发送 `OPEN/CLOSE`，并验证出错时的新标签页入口。
5. 登录、缺失文件、回收站、权限异常、画布正在加载时，由 MindMap 内部展示正确页面，不把通信 `READY` 误写成“画布已准备好”。
6. 复用与保存：打开 A → 改动并 CLOSE → 打开 B → 打开 C；冲突/断网/请求超时/迟到 RESULT 时不丢数据或串 UUID；重复操作不会覆盖已有 pending 请求。
7. 全屏、Esc、关闭按钮、浅色/深色主题；关闭失败时保留弹窗，检查图片、节点快捷键、自动保存与 HTML 导出仍由 MindMap 控制。

## 版本记录与历史

- **v0.2.5**：恢复 iframe `load` 后显示嵌入页面，避免等待 READY 遮挡登录或画布；READY 仍作为通信能力标记，保留安全重载确认。
- **v0.2.4**：URL 关联校验与 MindMap UUID v4 一致；首次加载由可信 `READY` 而非 iframe `load` 控制外层加载状态；增加未收到 READY 的提示和谨慎重试。
- **v0.2.3**：去掉外层 Modal 标题栏；右上角使用悬浮关闭按钮，保留全屏权限与保存守卫。
- **v0.2.1**：打开其他 UUID 时等待 `OPEN RESULT`；请求超时后保留不确定状态，防止后续切换竞态。
- **v0.2.0**：单 iframe 复用与 SPA 内部切换，建立 `mindmap-embed` v1 的 `READY/OPEN/CLOSE/RESULT`。
- **v0.1.4**：外层弹窗根据系统主题变色；首次插入改为一个事务创建标志及两个真实空段落。

旧版 NocoDB Grid Button + `MindMapData` 脚本 v0.3.2 已归档为 `archive/userscripts/nocodb-mindmap-v0.3.2.user.js` 与 `.md`。使用此新版联动时应在 Tampermonkey 停用/卸载旧版脚本。旧数据不会自动迁移到 MindMap Docker 文件。

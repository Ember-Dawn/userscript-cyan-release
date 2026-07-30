# ChatGPT 文件夹油猴脚本：设计与维护说明

> 对应脚本：`userscripts/chatgpt/chatgpt-folders.user.js`  
> 当前说明版本：v0.5.1  
> 面向对象：后续维护者、代码审查者，以及需要快速接手该脚本的 AI

## 1. 脚本定位

该脚本在 ChatGPT 网页版左侧侧边栏中增加一个“文件夹”区域，用于整理普通聊天链接。

它只管理本地引用，不修改 ChatGPT 后端：

- 保存聊天标题、conversation id、相对链接和所在文件夹；
- 保存文件夹树、颜色、折叠状态及少量界面设置；
- 可通过 WebDAV 在设备间同步上述数据；
- 不保存完整聊天正文；
- 不归档、移动或删除 ChatGPT 官方聊天；
- 不读取或保存 ChatGPT access token、session token、cookie。

## 2. 当前版本的关键设计结论

维护时优先保留以下结论，不要轻易退回旧方案：

1. 本地 profile 按 ChatGPT 账号隔离。
2. 不再自动迁移 v1/v2 的单 profile 存储。
3. 新设备没有本地 profile 时，由账号对应的 WebDAV JSON 初始化。
4. WebDAV ETag 只在单次 `GET → PUT` 事务内使用，不作为跨会话长期上传凭据。
5. 远程 `sync.revision` 是持久化同步基线，ETag 是瞬时并发保护。
6. 每次 PUT 后再次 GET，校验 revision 和写入设备。
7. 同一浏览器多标签页通过小型 revision key 同步，不轮询大型 profile。
8. 文件夹树使用自然高度，不创建内部滚动容器；与 ChatGPT 原生侧边栏共用外层滚动条。
9. 不长期监听整个页面的 MutationObserver。
10. 不给 ChatGPT “最近聊天”每一项常驻注入按钮或 wrapper。

## 3. 仓库文件

```text
userscripts/chatgpt/
├── chatgpt-folders.user.js
└── chatgpt-folders.design.md
```

- `chatgpt-folders.user.js`：可直接安装的完整 Tampermonkey 用户脚本。
- `chatgpt-folders.design.md`：当前架构、约束、同步模型和维护检查清单。

修改同步或存储架构时，应同步更新两份文件。

## 4. 运行环境与权限

脚本匹配：

```text
https://chatgpt.com/*
https://chat.openai.com/*
```

主要 Tampermonkey 权限：

- `GM_getValue`
- `GM_setValue`
- `GM_addValueChangeListener`
- `GM_xmlhttpRequest`
- `@connect *`

WebDAV 请求优先使用 `GM_xmlhttpRequest`，并兼容部分脚本管理器的 `GM.xmlHttpRequest`。

## 5. 数据模型

### 5.1 Profile

内存中的 `state` 是当前账号的单一数据源。主要结构：

```json
{
  "id": "<account-key>",
  "label": "account@example.com",
  "createdAt": "ISO time",
  "updatedAt": "ISO time",
  "folders": {},
  "conversations": {},
  "settings": {
    "ui": {},
    "webdav": {}
  },
  "__cgfm": {
    "storageRevision": "...",
    "writerTabId": "...",
    "writtenAt": "..."
  }
}
```

### 5.2 Folder

根节点固定为 `root`。普通文件夹包含：

```json
{
  "id": "fld_xxx",
  "name": "文件夹名称",
  "parentId": "root",
  "childFolderIds": [],
  "chatIds": [],
  "color": "#6b7280",
  "collapsed": false,
  "createdAt": "ISO time",
  "updatedAt": "ISO time"
}
```

约束：

- 除根节点外，每个文件夹必须有合法父节点；
- 同一聊天只能属于一个文件夹；
- 不允许把文件夹移动到自身或其子孙节点；
- 同级文件夹用 `Intl.Collator` 排序；
- 文件夹内聊天保持加入顺序，不自动排序。

### 5.3 Conversation

```json
{
  "id": "conversation-id",
  "title": "聊天标题",
  "url": "/c/conversation-id",
  "folderId": "fld_xxx",
  "addedAt": "ISO time",
  "updatedAt": "ISO time"
}
```

只保存链接引用，不保存消息内容。

## 6. 本地存储

### 6.1 当前使用的键

```text
cgfm.v3.profile.<account-key>
cgfm.v3.revision.<account-key>
cgfm.v3.remoteFileMap
cgfm.v3.deviceId
cgfm.v1.lastAccount
```

说明：

- `profile`：当前账号的完整本地数据；
- `revision`：小型多标签页事件键；
- `remoteFileMap`：账号到远程 JSON 文件名的稳定映射；
- `deviceId`：当前脚本管理器安装环境的设备标识；
- `lastAccount`：账号识别暂时不可用时的有限回退信息。

### 6.2 不再自动迁移的旧键

v0.5.0 起，不再自动读取或复制旧单 profile 存储，例如：

```text
cgfm.v1.state
cgfm.v2.currentProfile
cgfm.v2.revision
```

原因：旧数据无法可靠判断属于哪个 ChatGPT 账号，自动迁移曾造成跨账号重复复制和同步分支复杂化。

如需恢复旧数据，应通过显式 JSON 导入完成，而不是重新加入隐式迁移。

## 7. ChatGPT 账号识别

优先从 `script#client-bootstrap` 获取：

- `session.user.email` / `user.email`
- `session.user.name` / `user.name`
- `session.account.id` / `account.id`

优先使用 `accountId`，其次 email，再其次脚本生成的稳定 hash。

账号稳定键用于：

- 本地 profile 键；
- 多标签页 revision 键；
- WebDAV 文件名映射；
- WebDAV 请求上下文校验。

当强账号信息发生变化时，需要连续检测两次才切换 profile，以避免 ChatGPT 页面 hydration 期间的瞬时错误身份。

## 8. WebDAV 远程文件

### 8.1 文件名

典型规则：

```text
安全化邮箱-accountId前8位.json
```

例如：

```text
pd25520_at_uga_edu-5a54db9a.json
```

用户可在设置中覆盖当前账号的远程文件名；映射保存在 `cgfm.v3.remoteFileMap`。

### 8.2 远程 payload

顶层应包含：

```json
{
  "app": "ChatGPT文件夹",
  "version": "0.5.x",
  "schema": 2,
  "exportedAt": "ISO time",
  "account": {
    "id": "acct_xxx",
    "accountId": "...",
    "email": "...",
    "label": "...",
    "key": "..."
  },
  "sync": {
    "revision": 1,
    "updatedAt": "ISO time",
    "deviceId": "dev_xxx"
  },
  "profile": {}
}
```

远程文件不得包含：

- WebDAV password；
- WebDAV username；
- ChatGPT token；
- cookie；
- 完整聊天正文。

`exportPayload()` 会清空 profile 内 WebDAV 用户名和密码。

## 9. WebDAV 同步模型

### 9.1 为什么不用持久化 ETag 直接上传

Nextcloud、反向代理和不同 userscript 管理器可能使 ETag 在跨页面、跨会话或 HEAD/GET 之间表现不一致。旧设计长期保存 ETag 后再次用于 `If-Match`，容易产生持续的 HTTP 412。

当前原则：

> ETag 仅用于同一次网络事务中的条件写入。

### 9.2 正常推送流程

```text
保存本地待上传状态
→ GET 当前远程 JSON
→ 校验远程账号
→ 读取远程 revision 和本次 GET 的 ETag
→ 比较本地 base revision
→ 构造 revision + 1 的 payload
→ PUT，并使用刚取得的 If-Match
→ 再次 GET
→ 校验 revision 和 deviceId
→ 清除 pendingPush
```

如远程文件不存在：

```text
GET 404
→ 使用 If-None-Match: * 创建
→ 再 GET 验证
```

### 9.3 412 兼容处理

PUT 返回 412 时：

1. 再次 GET 远程文件；
2. 比较内容和 `sync.revision`；
3. 若远端确实变化，判定真实冲突，禁止覆盖；
4. 若远端内容和 revision 均未变化，视为服务器/代理 ETag 兼容问题，允许一次无条件兼容重试；
5. 重试后仍必须 GET 验证写入结果。

不要把“无条件重试”移到第一次 PUT，也不要在无法证明远端未变化时强制覆盖。

### 9.4 拉取与自动检查

- 手动拉取会在替换本地数据前请求确认；
- 自动检查使用 GET，因为需要同时获取内容、账号和 revision；
- 本地干净且远程 revision 较新时，可自动应用远端；
- 本地存在 `pendingPush`、未保存修改或本地 dirty 时，不得自动覆盖；
- 没有同步基线时：
  - 本地为空，可用远端初始化；
  - 本地已有用户数据，应停止并要求用户明确拉取或处理冲突。

### 9.5 请求上下文

每个 WebDAV 操作都绑定发起时的：

- `accountGeneration`
- `accountKey`
- 账号 id
- 远程目标 URL / 文件名

响应返回时必须再次校验。账号切换后，旧账号未完成的网络响应不得应用到新账号 state。

## 10. 同步状态

状态圆点：

- 灰色：未启用或未配置；
- 绿色：已同步；
- 橙色：有本地修改，等待推送；
- 蓝色旋转：同步中；
- 红色：同步失败或冲突。

重要字段：

```text
pendingPush
remoteInitialized
remoteRevision
syncTarget
lastPushAt
lastPullAt
lastRemoteCheckAt
lastStatus
lastError
conflict
```

`pendingPush` 必须持久化，不能只依赖页面内存的 `dirtySincePush`。

## 11. 多标签页同步

同一浏览器多个 ChatGPT 标签页不通过 WebDAV 互相同步，而使用 Tampermonkey value change listener：

```text
cgfm.v3.revision.<account-key>
```

写入 profile 时：

1. 为 profile 生成 storage revision；
2. 写入大型 profile；
3. 再写入小型 revision metadata；
4. 其他标签页只监听小键；
5. 确认有更新后才读取大型 profile。

账号切换时必须删除旧 listener，再注册当前账号 listener，避免监听器累积。

如果当前标签正在编辑、设置弹窗打开或有本地未保存修改，不应立即用其他标签页数据覆盖。

## 12. 侧边栏挂载

目标位置是 ChatGPT 原生历史侧边栏内部，通常在“最近”区域之前。

不要直接挂载到太外层的 `#stage-slideover-sidebar`，否则官方侧边栏收起后可能仍占宽度或显示残留。

挂载策略：

- 初始化后进行稀疏、有限的延迟检查；
- focus、pageshow、visibilitychange 时进行短窗口自愈；
- 不使用长期 MutationObserver 监听整个 sidebar；
- React 重绘移除根节点时重新挂载；
- 根节点固定为 `#cgfm-root`。

脚本使用 document-level runtime lock，避免 Safari 或某些脚本管理器重复注入同一运行实例。

## 13. 文件夹树与滚动设计

### 13.1 v0.5.1 当前行为

文件夹树 CSS 使用自然高度：

```css
#cgfm-root .cgfm-tree {
  height: auto;
  max-height: none;
  overflow: visible;
}
```

结果：

- 文件夹展开多少，组件就增长多少；
- 文件夹树不产生内部滚动条；
- 文件夹、GPT、Projects、最近聊天等区域共用 ChatGPT 侧边栏外层滚动条；
- 文件夹很多时，下方原生内容会被推到更下面，这是预期行为。

### 13.2 不应一起取消滚动的浮层

以下元素仍应保留自己的最大高度和滚动：

- 设置弹窗；
- 原生菜单旁的文件夹选择浮层；
- 其他 position: fixed 的临时菜单。

它们不属于侧边栏文档流，改成无限高度会超出视口。

## 14. 侧边栏宽度

只通过 CSS 变量 `--sidebar-width` 调整官方侧边栏宽度。

不要直接修改：

- `#stage-slideover-sidebar.style.width`
- `minWidth`
- `maxWidth`
- `flexBasis`
- 外层 nav / aside / flex 容器宽度

官方侧边栏收起时必须撤销自定义变量覆盖，让 ChatGPT tiny bar 接管布局。

## 15. 拖拽模型

### 15.1 聊天拖入文件夹

不向“最近聊天”常驻注入按钮。

识别路径包括：

- pointerdown / mousedown 预缓存；
- dragstart 从 `event.composedPath()` 查找 `/c/` 链接；
- 保留 ChatGPT 原始 `dataTransfer`；
- 添加自定义 MIME payload；
- drop 时优先使用缓存，再解析 `text/uri-list`、`text/plain`、`text/html`；
- dragend 只作为有限兜底。

不在全局 dragover 阻止默认行为，避免破坏 ChatGPT 官方 Project 拖拽。

### 15.2 文件夹移动

- 文件夹可拖到另一个文件夹，成为其子文件夹；
- 可拖到顶部标题行，返回根目录；
- 不允许移动根节点；
- 不允许移动到自身或自己的子孙节点；
- 移动后只排序源父级和目标父级。

## 16. 最近聊天三点菜单

脚本在用户点击最近聊天三点按钮后，短暂启动 MutationObserver 捕捉 Radix 菜单。

成功后注入“移至文件夹”，并使用脚本自己的多级浮层选择目标文件夹。

约束：

- observer 只在用户点击后短暂运行；
- 捕捉成功或超时后立即 disconnect；
- 不依赖 React/Radix 内部 collection 状态；
- 不让脚本菜单项点击冒泡到官方菜单；
- 不给每条聊天常驻注入菜单项。

## 17. UI 更新与性能

单一数据源是内存 `state`。

全量 render 适合：

- 初始化；
- 导入；
- 远程拉取；
- 账号切换；
- 文件夹移动等重大结构变化。

局部 DOM 更新适合：

- 文件夹折叠/展开；
- 重命名；
- 改颜色；
- 删除单个节点；
- 状态圆点变化。

必须避免：

- 长期 MutationObserver 观察 document.body；
- mousemove 监听；
- 高频轮询账号或侧边栏；
- hover 最近聊天时执行扫描；
- 每次 render 都重新排序；
- 文件夹折叠时触发 WebDAV dirty；
- 拖入聊天后立即网络上传；
- 在日志中输出凭据或 token。

## 18. 设置弹窗

设置弹窗复用单一 DOM。

打开：

- 只填充本地配置；
- 不自动测试或拉取；
- 不触发全树重绘。

保存：

- 更新 URL、账号文件名、凭据和延迟；
- 如果同步目标改变，清除旧远程基线；
- 根据本地是否有用户数据决定是否设置 `pendingPush`；
- 保存本地后再进行必要的远端检查。

取消/点击遮罩：

- 恢复宽度预览；
- 不保存；
- 不标记 dirty。

## 19. 导入与导出

导出：

- 包含文件夹、聊天引用和非敏感设置；
- 清空 WebDAV 用户名和密码；
- 不包含 token、cookie、完整聊天正文。

导入：

- 校验 `folders` 和 `conversations`；
- 规范化父子关系；
- 保留当前本地 WebDAV 凭据与目标；
- 标记本地待推送；
- 不立即上传，等待延迟备份或手动推送。

## 20. 常见故障排查

### 20.1 HTTP 412

检查顺序：

1. 确认只有一个脚本实例和一个活跃标签页；
2. 确认正在运行的版本；
3. 确认远程文件名与当前账号一致；
4. 检查脚本是否完成同一次 GET 后才 PUT；
5. 检查 412 后重新 GET 得到的内容/revision 是否变化；
6. 远端未变化时才允许一次兼容性无条件重试。

### 20.2 远程账号不匹配

不要绕过校验。核对：

- 当前 ChatGPT accountId；
- 远程 `account.accountId`；
- 远程 `account.key`；
- 账号到文件名映射。

### 20.3 文件夹区域消失

检查：

- `#cgfm-root` 是否存在；
- 是否被 React 重绘移除；
- 是否挂载到了错误的 sidebar 父节点；
- 官方侧边栏是否被判断为收起；
- runtime lock 是否阻挡了新的实例，而旧实例已失效。

### 20.4 出现两个滚动条

文件夹树不应包含：

```css
max-height: ...;
overflow: auto;
```

同时确认脚本根节点仍在 ChatGPT 原生侧边栏滚动容器内，而不是挂到外层固定容器。

## 21. 修改前后的最低检查

每次发布至少检查：

1. `node --check chatgpt-folders.user.js`；
2. metadata 与 `const VERSION` 一致；
3. 只存在一个 `#cgfm-root`；
4. 创建、重命名、删除、改色、折叠文件夹正常；
5. 聊天拖入文件夹正常；
6. 文件夹移动不会形成循环；
7. 最近聊天菜单注入不会破坏官方菜单；
8. 文件夹树没有内部滚动条；
9. ChatGPT 外层侧边栏可以滚动到全部文件夹和最近聊天；
10. 本地保存和多标签页 revision 正常；
11. WebDAV 拉取、推送、412 分支、账号切换至少各测试一次；
12. 导出文件不包含 WebDAV 密码。

## 22. 未来维护建议

适合后续优化：

- 为同步流程增加可开关的无敏感信息诊断日志；
- 把远程 payload 校验拆成独立纯函数；
- 为 profile normalization、revision 比较和循环移动检测增加单元测试；
- 对 ChatGPT DOM 选择器集中管理，降低页面改版后的修复成本；
- 允许用户选择“自然高度”或“内部滚动”作为可选 UI 设置，但默认继续使用自然高度。

不建议：

- 恢复自动旧数据迁移；
- 将 ETag 重新作为长期持久化写入凭据；
- 取消账号上下文校验；
- 通过无条件 PUT 简化所有冲突处理；
- 长期观察整个 DOM；
- 为每条最近聊天增加常驻 UI。

## 23. v0.5.1 变更摘要

- 文件夹树取消 `max-height:min(48vh, 420px)`；
- 文件夹树取消 `overflow:auto`；
- 改为自然高度 `height:auto; max-height:none; overflow:visible`；
- 文件夹区域与 ChatGPT 侧边栏共用外层滚动条；
- 设置弹窗与固定浮层菜单仍保留各自滚动；
- 新增本设计与维护说明文档。

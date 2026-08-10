# ChatGPT 文件夹油猴脚本：设计与维护说明

> 对应脚本：`userscripts/chatgpt/chatgpt-folders.user.js`  
> 当前说明版本：v0.6.2  
> 面向对象：未来维护者、代码审查者，以及需要快速接手该脚本的 AI

## 1. 脚本定位

该脚本在 ChatGPT 网页版左侧侧边栏中增加一个“文件夹”区域，用于整理普通聊天链接。

它只管理聊天引用，不修改 ChatGPT 后端：

- 保存聊天标题、conversation id、相对链接和所在文件夹；
- 保存文件夹树、颜色及少量界面设置；
- 通过 WebDAV 在 Chrome、Safari、Firefox 等不同浏览器之间同步；
- 不保存完整聊天正文；
- 不归档、移动或删除 ChatGPT 官方聊天；
- 不读取或保存 ChatGPT access token、session token、cookie。

脚本当前同时支持：

1. 单设备本地使用；
2. 同一浏览器多个标签页之间同步；
3. 不同浏览器和不同设备之间通过 WebDAV 双向同步。

## 2. v0.6.x 的核心设计结论

维护时应优先保留以下结论，不要轻易退回旧方案：

1. 本地 profile 按 ChatGPT 账号隔离。
2. 不再自动迁移 v1/v2 的单 profile 存储。
3. 新设备没有本地 profile 时，由账号对应的 WebDAV JSON 初始化。
4. WebDAV ETag 只在一次 `GET → PUT` 事务内使用，不作为跨会话长期凭据。
5. 远程 `sync.revision` 是持久化版本号；本地保存与该 revision 对应的基准快照。
6. 每个本地业务修改会转化为对象级操作记录。
7. 远端和本地同时变化时，基于基准快照、远端操作和本地操作进行自动合并。
8. 删除通过墓碑和 delete operation 传播，避免旧设备把已删除对象重新带回来。
9. PUT 返回 412 时重新 GET、重新合并并有限重试；只有确认远端内容未变化时，才允许兼容性无条件 PUT。
10. 状态圆圈是实际的“立即同步”按钮，不再只是显示缓存状态。
11. 页面可见时默认约每 30 秒检查一次远端；页面隐藏时暂停周期检查。
12. 文件夹折叠状态和整个区域折叠状态保留在各设备本地，不参与跨设备冲突。
13. 文件夹树使用自然高度，与 ChatGPT 原生侧边栏共用外层滚动条。
14. 不长期监听整个页面的 MutationObserver。
15. 不给 ChatGPT “最近聊天”中的每一项常驻注入按钮或 wrapper。
16. 同浏览器跨标签 revision 必须先用 `syncProjection` 判断业务投影是否变化；仅 WebDAV 状态、ETag、检查时间等运行元数据变化时静默接收，不显示“文件夹更新”提示。
17. 元数据-only revision 不得抢先覆盖或取消另一个标签页尚未持久化的文件夹业务修改。

## 3. 仓库文件

```text
userscripts/chatgpt/
├── chatgpt-folders.user.js
└── chatgpt-folders.design.md
```

- `chatgpt-folders.user.js`：可直接安装的完整 Tampermonkey 用户脚本。
- `chatgpt-folders.design.md`：当前架构、数据结构、同步算法、性能约束和故障排查说明。

修改同步、存储、账号识别或 UI 架构时，应同步更新这两份文件。

## 4. 运行环境与权限

脚本匹配：

```text
https://chatgpt.com/*
https://chat.openai.com/*
```

Tampermonkey 权限：

- `GM_getValue`
- `GM_setValue`
- `GM_addValueChangeListener`
- `GM_removeValueChangeListener`
- `GM_xmlhttpRequest`
- `@connect *`

WebDAV 请求优先使用 `GM_xmlhttpRequest`，并兼容部分脚本管理器的 `GM.xmlHttpRequest`。

## 5. 主要运行时状态

内存中的 `state` 是当前 ChatGPT 账号的单一数据源。

重要全局变量：

```text
state
currentAccount
lockedAccountKey
accountGeneration
selectedFolderId
mutationBaseline
localUnsavedChanges
dirtySincePush
webdavOperation
lastRemoteCheckAt
```

说明：

- `state`：当前账号完整 profile；
- `accountGeneration`：账号每次切换时递增，用于拒绝旧账号延迟返回的网络响应；
- `mutationBaseline`：最近一次已经生成操作日志的同步投影；
- `localUnsavedChanges`：尚未写入 Tampermonkey storage；
- `dirtySincePush`：存在尚未同步到 WebDAV 的业务修改；
- `webdavOperation`：防止 GET、PUT、拉取和检查并发执行。

## 6. Profile 数据模型

### 6.1 Profile

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
  "__cgfm": {},
  "__cgfmSync": {}
}
```

`__cgfm` 和 `__cgfmSync` 都是本地元数据，不应直接写入远程 profile。

### 6.2 Folder

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

- 根节点固定为 `root`；
- 除根节点外，每个文件夹必须有合法父节点；
- 不允许把文件夹移动到自身或其子孙节点；
- 同级文件夹使用 `Intl.Collator` 排序；
- 文件夹中的聊天保持加入顺序。

### 6.3 Conversation

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

同一聊天只属于一个脚本文件夹。

## 7. 本地同步元数据 `__cgfmSync`

v0.6.0 增加本地同步元数据：

```json
{
  "baseRevision": 12,
  "baseProfile": {},
  "operations": [],
  "tombstones": {
    "folders": {},
    "conversations": {}
  },
  "lastCompactedAt": ""
}
```

字段含义：

- `baseRevision`：本地当前基准快照对应的远程 revision；
- `baseProfile`：上次成功同步后得到的同步投影；
- `operations`：基准之后的本地未同步操作；
- `tombstones`：本地已知的删除记录；
- `lastCompactedAt`：为未来日志压缩预留。

`baseProfile` 是实现三方合并的关键。不要只保存一个 revision，而丢弃与它对应的快照。

## 8. 同步投影

`syncProjection(profile)` 生成跨设备合并使用的稳定投影。

投影包含：

- 文件夹结构；
- 文件夹名称、父节点、颜色；
- 聊天引用；
- 侧边栏宽度偏好。

投影不包含：

- WebDAV URL、用户名和密码；
- WebDAV 运行状态；
- 文件夹 `collapsed`；
- 整个文件夹区域的 `sectionCollapsed`；
- 本地 storage revision；
- 本地同步基准和待同步操作。

折叠状态不参与跨端同步，原因是：

- Chrome 和 Safari 可能希望保持不同展开状态；
- 展开和折叠不属于业务数据；
- 同步折叠状态会产生大量无意义冲突和页面跳动。

## 9. 操作日志

### 9.1 操作结构

```json
{
  "id": "op_xxx",
  "kind": "folder-upsert",
  "entityId": "fld_xxx",
  "value": {},
  "reason": "rename-folder",
  "at": "ISO time",
  "deviceId": "dev_xxx",
  "baseRevision": 12,
  "revision": 0
}
```

本地新操作的 `revision` 为 `0`。成功写入远端时，会被赋予新的远程 revision。

### 9.2 操作类型

当前类型：

```text
folder-upsert
folder-delete
conversation-upsert
conversation-delete
settings-update
```

创建、重命名、移动、改色和父子数组变化统一表示为 `folder-upsert`。

添加聊天、移动聊天、刷新标题统一表示为 `conversation-upsert`。

### 9.3 操作生成方式

业务动作完成后调用 `schedulePersist(..., { webdav: true })`。

脚本比较：

```text
mutationBaseline
当前 syncProjection(state)
```

并自动生成对象级操作。

这种做法的优点：

- 不要求每个 UI 函数手工维护一套日志；
- 一次动作修改多个父子对象时，可完整生成相关操作；
- 后续新增业务动作，只要最终调用 WebDAV-relevant 的 `schedulePersist`，就能进入同步日志。

文件夹折叠等本地 UI 动作调用 `{ webdav: false }`，不会生成远端操作。

## 10. 删除墓碑

删除操作同时更新墓碑：

```json
{
  "folders": {
    "fld_xxx": {
      "deletedAt": "ISO time",
      "deviceId": "dev_xxx",
      "operationId": "op_xxx"
    }
  },
  "conversations": {}
}
```

墓碑的作用：

- 明确对象被删除，而不是暂时缺失；
- 防止长时间离线的旧设备重新上传已删除对象；
- 在操作日志压缩或快照差异回退时提供删除语义。

如果同一个 ID 后续出现时间更晚的 upsert，较新的操作可以清除旧墓碑。文件夹 ID 通常不会重用，因此这种情况很少。

## 11. WebDAV 远程文件

### 11.1 文件名

典型规则：

```text
安全化邮箱-accountId前8位.json
```

例如：

```text
pd25520_at_uga_edu-5a54db9a.json
```

用户可以在设置中覆盖当前账号的远程文件名。映射保存在：

```text
cgfm.v3.remoteFileMap
```

### 11.2 schema 3 payload

```json
{
  "app": "ChatGPT文件夹",
  "version": "0.6.2",
  "schema": 3,
  "exportedAt": "ISO time",
  "account": {
    "id": "acct_xxx",
    "accountId": "...",
    "email": "...",
    "key": "...",
    "label": "..."
  },
  "sync": {
    "model": "operation-log-v1",
    "revision": 13,
    "updatedAt": "ISO time",
    "deviceId": "dev_xxx",
    "operations": [],
    "tombstones": {
      "folders": {},
      "conversations": {}
    }
  },
  "profile": {}
}
```

远程 profile 不包含：

- WebDAV username；
- WebDAV password；
- WebDAV URL；
- 本地同步运行状态；
- `__cgfm`；
- `__cgfmSync`；
- ChatGPT token、cookie 或完整聊天正文。

## 12. 多端同步决策表

每次同步先 GET 远端，然后判断本地和远端状态。

### 12.1 本地干净，远端未变化

```text
远端 revision == baseRevision
远端快照 == baseProfile
本地无操作
```

结果：

- 只更新 `lastRemoteCheckAt`；
- 显示“已与云端核对”；
- 不执行 PUT。

### 12.2 本地干净，远端已变化

结果：

- 自动应用远端 profile；
- 保留当前设备的折叠状态；
- 保留当前设备的 WebDAV 配置和凭据；
- 更新本地基准快照与 revision。

### 12.3 本地变化，远端未变化

结果：

- 应用本地操作；
- 生成 `revision + 1`；
- 条件 PUT；
- 写后 GET 校验；
- 清空本地待同步操作。

### 12.4 本地与远端同时变化

结果：

1. 读取本地 `baseProfile`；
2. 选取远端 `revision > baseRevision` 的操作；
3. 将远端操作应用到基准；
4. 如果操作日志不足以重建当前远端快照，通过快照 diff 补齐远端操作；
5. 同样校验本地操作是否能重建当前本地快照；
6. 合并远端操作和本地操作；
7. 按操作时间和操作 ID 排序；
8. 应用到基准快照；
9. normalize 文件夹父子关系和聊天归属；
10. 条件 PUT 合并结果；
11. GET 验证并建立新的本地基准。

因此下面这种情况会自动保留双方修改：

```text
Chrome：重命名文件夹 A
Safari：向文件夹 B 添加聊天
```

## 13. 同一对象冲突规则

当两个设备同时修改同一对象时，采用稳定的 last-operation-wins：

1. 比较操作 `at`；
2. 时间相同时比较操作 `id`；
3. 较后的操作覆盖较早操作。

示例：

```text
Chrome 20:00:01 将 A 改名为 Alpha
Safari 20:00:02 将 A 改名为 Beta
```

最终名称为 Beta。

删除和修改同一对象也使用相同规则：

- 删除操作更晚：对象保持删除；
- upsert 更晚：对象恢复或继续存在。

局限：不同设备系统时钟偏差较大时，最后操作判断可能不完全符合真实操作顺序。未来可升级为 Lamport clock 或 Hybrid Logical Clock，但当前时间戳加稳定 ID 已能满足个人多端使用。

## 14. ETag 与 HTTP 412

### 14.1 正常事务

```text
GET 当前远端 JSON
→ 读取该次 GET 的 ETag
→ 合并本地与远端
→ PUT，并携带 If-Match: <刚取得的 ETag>
→ GET 验证
```

ETag 不作为长期持久化写入凭据。

### 14.2 412 重试

PUT 返回 412：

1. 重新 GET；
2. 重新读取远端 revision 和操作日志；
3. 重新合并；
4. 再次条件 PUT；
5. 最多进行三轮。

这样可以处理：

```text
Chrome 和 Safari 同时读取 revision 10
Chrome 先写入 revision 11
Safari 的 PUT 得到 412
Safari 重新 GET revision 11
Safari 合并自己的操作并写入 revision 12
```

### 14.3 Nextcloud ETag 兼容回退

部分 Nextcloud 或反向代理可能拒绝刚刚 GET 得到的 ETag。

只有在第三次尝试时，并且额外 GET 证明远端文件与上传前完全相同，脚本才允许一次无条件 PUT。

不要改成第一次就无条件 PUT，否则会重新引入覆盖其他设备修改的风险。

## 15. 状态圆圈

v0.6.0 起，点击状态圆圈会执行真实同步：

```text
保存本地待写数据
→ GET 远端
→ 比较 revision 和快照
→ 自动拉取、推送或合并
→ PUT（如需要）
→ GET 校验
```

状态：

- 灰色：WebDAV 未启用或未配置；
- 绿色：最近一次已真正与云端核对；
- 橙色：本地有待同步修改；
- 蓝色旋转：正在读取、合并或写入；
- 红色：网络、账号、格式或重试失败。

绿色状态不应仅依赖旧缓存。成功检查后必须更新 `lastRemoteCheckAt`。

## 16. 自动检查和自动同步

默认前台检查间隔：约 30 秒。

用户可在设置中调整为 15～300 秒。

行为：

- 页面可见：周期 GET；
- 页面隐藏：暂停周期 GET；
- 页面恢复可见：立即安排检查；
- window focus：安排检查；
- pageshow：安排检查；
- 本地业务修改：经过 debounce 后自动同步；
- 账号切换：停止旧账号定时器，重新绑定新账号。

不要把检查间隔降到几秒钟。WebDAV JSON 可能较大，高频 GET 会增加 Nextcloud、浏览器和网络负担。

## 17. 强制拉取

设置页的“强制拉取”是恢复工具，不是日常同步按钮。

如果本地存在尚未同步修改，会确认：

```text
强制拉取会放弃当前设备尚未同步的修改
```

正常多端使用应点击状态圆圈或“立即同步”，让脚本自动合并，而不是先强制拉取。

## 18. 新设备初始化

本地没有 account-scoped profile 时：

```text
用户配置 WebDAV
→ GET 当前账号远程 JSON
→ 本地为空
→ 自动应用远端数据
→ 保存 baseRevision 和 baseProfile
```

如果本地已有用户数据但没有当前远端基准，脚本不会猜测两份数据的关系，会提示：

- 先导出本地备份；
- 再强制拉取；
- 或重新初始化。

## 19. 旧数据迁移策略

当前不自动读取：

```text
cgfm.v1.state
cgfm.v2.currentProfile
cgfm.v2.revision
```

原因：旧单 profile 数据无法可靠判断属于哪个 ChatGPT 账号，自动迁移会产生跨账号复制和大量分支。

恢复旧数据应使用显式 JSON 导入。

v0.5.x 的 account-scoped 本地 profile 会继续被 v0.6.0 读取，不属于旧单 profile 迁移。

## 20. 本地存储键

```text
cgfm.v3.profile.<account-key>
cgfm.v3.revision.<account-key>
cgfm.v3.remoteFileMap
cgfm.v3.deviceId
cgfm.v1.lastAccount
```

- `profile`：当前账号完整本地数据和本地同步元数据；
- `revision`：同浏览器多标签页事件键；
- `remoteFileMap`：账号到远程文件名的稳定映射；
- `deviceId`：当前脚本管理器环境的设备 ID；
- `lastAccount`：账号识别暂时不可用时的有限回退。

## 21. 同浏览器多标签页同步

同一个浏览器的多个标签页优先使用 Tampermonkey value change listener，而不是等待 WebDAV。

流程：

1. 写入完整 profile；
2. 写入小型 revision metadata；
3. 其他标签页监听小键；
4. 发现更新后才读取大型 profile；
5. 用 `syncProjection` 将新 profile 与该标签页最近已接受的业务投影比较；
6. 业务投影变化：应用新 profile、按需重绘，并提示“已同步另一个标签页的文件夹更新”；
7. 业务投影未变化：视为 WebDAV 运行状态、检查时间、ETag 或其他非业务元数据更新，静默接收，不重绘文件夹树、不显示文件夹更新提示；
8. 应用后重新设置 `mutationBaseline`。

为避免刷新标签页触发 WebDAV 核对时干扰另一个正在编辑的标签页，运行时还保存 `lastSeenStorageProjection`。若外部 revision 的业务投影与该基线完全一致，即使当前标签页存在待保存修改，也只确认该外部 revision，不用它覆盖当前内存中的业务数据；随后当前标签页可以正常持久化自己的修改。

文件夹 `collapsed` 和整个区域 `sectionCollapsed` 不属于 WebDAV 业务投影；在当前标签页空闲时，如果它们确实由另一个标签页变化，允许静默重绘以保持同浏览器 UI 一致，但不会显示“文件夹更新”提示。

账号切换时必须：

- 删除旧 listener；
- 注册新账号 listener；
- 停止旧 WebDAV 定时器。

当前标签正在编辑、设置弹窗打开或有未保存修改时，不应立即被另一个标签页覆盖。

## 22. 账号识别和请求上下文

优先从 `script#client-bootstrap` 读取：

- email；
- name；
- account.id。

账号稳定键优先使用 accountId，其次 email。

每个 WebDAV 请求绑定：

```text
accountGeneration
accountKey
account id
目标 URL
文件名
```

响应返回时再次校验。账号切换后，旧账号的延迟响应必须丢弃。

## 23. 远程账号校验

远端 payload 的以下字段用于防止串账号：

```text
account.key
account.accountId
account.id
```

只要明确不匹配，就停止同步。

不要为了“方便”删除账号校验，否则错误的文件名映射可能把一个 ChatGPT 账号的数据加载到另一个账号。

## 24. 侧边栏挂载

目标位置是 ChatGPT 原生历史侧边栏内部，通常在“最近”区域之前。

挂载策略：

- 初始化后稀疏有限重试；
- focus、pageshow、visibilitychange 时进行短窗口自愈；
- 不使用长期 MutationObserver 观察整个 sidebar；
- React 重绘移除根节点时重新挂载；
- 根节点固定为 `#cgfm-root`；
- document-level runtime lock 防止重复注入。

## 25. 文件夹树和侧边栏滚动

文件夹树使用自然高度：

```css
#cgfm-root .cgfm-tree {
  height: auto;
  max-height: none;
  overflow: visible;
}
```

结果：

- 文件夹区域没有独立滚动条；
- 文件夹、GPT、Projects、最近聊天共用 ChatGPT 外层侧边栏滚动条；
- 文件夹很多时，原生内容会被推到更下面，这是预期行为。

设置弹窗和 position: fixed 浮层仍应保留自己的最大高度和滚动。

## 26. 侧边栏宽度

只通过 `--sidebar-width` 调整官方侧边栏宽度。

不要直接修改：

- `#stage-slideover-sidebar.style.width`；
- `minWidth`；
- `maxWidth`；
- `flexBasis`；
- nav、aside 或外层 flex 容器宽度。

官方侧边栏收起时必须撤销脚本覆盖。

## 27. 聊天拖拽

不向 ChatGPT “最近聊天”常驻注入按钮。

识别路径：

- pointerdown / mousedown 预缓存；
- dragstart 从 `event.composedPath()` 查找 `/c/` 链接；
- 保留 ChatGPT 原始 `dataTransfer`；
- 添加脚本自定义 MIME；
- drop 时解析缓存、URI、文本或 HTML；
- dragend 仅作为有限兜底。

不在全局 dragover 阻止默认行为，避免破坏官方 Project 拖拽。

## 28. 文件夹移动

- 文件夹可拖到另一个文件夹成为子文件夹；
- 可拖到顶部标题行返回根目录；
- 不允许移动根节点；
- 不允许移动到自身或子孙节点；
- normalize 会修复父子数组；
- 操作日志会记录被移动文件夹及受影响父节点的 upsert。

## 29. 最近聊天三点菜单

用户点击最近聊天三点按钮后，脚本短暂启动 MutationObserver 捕捉 Radix 菜单。

成功后注入“移至文件夹”，使用脚本自己的多级浮层选择目标文件夹。

约束：

- observer 只短暂运行；
- 捕捉成功或超时立即 disconnect；
- 不依赖 React/Radix collection 内部状态；
- 不让脚本菜单项点击冒泡到官方菜单；
- 不给每条聊天常驻注入 UI。

## 30. 导入与导出

### 导出

- 使用 schema 3 payload；
- 包含当前快照、同步 operation 和墓碑；
- 不包含 WebDAV 凭据；
- 不包含 token、cookie 或聊天正文。

### 导入

- 校验 folders 和 conversations；
- 保留当前 WebDAV 配置；
- 保留当前本地同步基准；
- 将导入结果作为本地业务变化生成操作；
- 经过 debounce 自动同步，或由用户点击立即同步。

## 31. 性能约束

必须避免：

1. 长期 MutationObserver 观察 document.body；
2. mousemove 监听；
3. 为最近聊天每一项注入常驻 UI；
4. hover 时扫描历史聊天；
5. 每次 render 重新排序；
6. 文件夹折叠触发 WebDAV dirty；
7. 页面隐藏时持续 30 秒轮询；
8. 多个 WebDAV 操作同时执行；
9. 在日志或错误信息中输出密码、Authorization、token 或 cookie。

当前操作日志限制：

```text
本地待同步操作最多约 500 条
远端保留操作最多约 1500 条
```

即使旧设备落后超过远端日志窗口，脚本仍可通过基准快照和远端当前快照生成 diff 进行回退合并。

## 32. 常见故障排查

### 32.1 Chrome 修改后 Safari 不变化

检查：

- Safari 页面是否可见；
- 是否超过设置的前台检查间隔；
- WebDAV 是否启用；
- 两端是否使用同一个远程文件名；
- Safari 状态圆圈点击后是否执行真实同步；
- 远端 revision 是否实际增加。

### 32.2 显示绿色但内容过期

v0.6.0 绿色应基于最近一次 GET。检查 `lastRemoteCheckAt` 是否更新。

圆圈点击必须调用 `webdavSync()`，不能恢复为只 toast 本地状态。

### 32.3 HTTP 412

正常情况下 412 会自动触发重新 GET 和重试。

如果最终仍失败，检查：

- 是否有另一个旧版本脚本持续写入；
- Nextcloud 是否返回 ETag；
- 远端内容是否在三次尝试中持续变化；
- 代理是否修改 ETag；
- 强制兼容 PUT 前是否完成 byte-for-byte 再确认。

### 32.4 本地修改被强制拉取覆盖

“强制拉取”本来就是放弃本地待同步修改的恢复操作。

日常同步应点击圆圈或“立即同步”，让操作级合并保留双方变化。

### 32.5 删除对象重新出现

检查：

- delete operation 是否进入远端 `sync.operations`；
- `sync.tombstones` 是否包含对象 ID；
- 旧设备是否仍运行 v0.5.x 或更早版本；
- 操作日志被截断后快照 diff 是否正确生成 delete operation。

### 32.6 出现两个侧边栏滚动条

文件夹树不应恢复：

```css
max-height: ...;
overflow: auto;
```

同时确认根节点位于 ChatGPT 原生侧边栏滚动容器内。

### 32.7 刷新一个标签页后另一个标签页提示“已同步文件夹更新”

v0.6.1 及以前可能出现：刷新标签页触发 WebDAV 核对，虽然文件夹业务数据没有变化，但 `lastRemoteCheckAt`、ETag、状态等字段保存后仍会产生新的 storage revision，另一个标签页因此误报文件夹更新。

v0.6.2 起检查：

- 新 revision 的 `syncProjection` 是否真的与最近已接受业务投影不同；
- 若仅运行元数据变化，应静默接收，不 `queueRender()` 文件夹树，也不显示文件夹更新 toast；
- 若当前标签页恰有待保存业务修改，metadata-only revision 只更新 revision 认知，不能导致本地业务修改被丢弃。

## 33. 最低发布检查

每次发布至少执行：

1. `node --check chatgpt-folders.user.js`；
2. metadata 版本与 `const VERSION` 一致；
3. 只存在一个 `#cgfm-root`；
4. 创建、重命名、删除、改色、折叠文件夹正常；
5. 聊天拖入和菜单移入正常；
6. 文件夹移动不会形成循环；
7. 文件夹树没有内部滚动条；
8. 同浏览器多标签页更新正常；
9. 单设备本地修改能自动上传；
10. 另一设备本地干净时能自动拉取；
11. 两设备同时修改不同对象时能自动合并；
12. 两设备同时修改同一对象时结果稳定；
13. 删除能传播到另一设备；
14. PUT 412 后能重新 GET 和重试；
15. 状态圆圈执行真实同步；
16. 页面隐藏时不进行周期轮询；
17. 导出和远端 JSON 不包含 WebDAV 密码。
18. 刷新标签页或仅完成一次 WebDAV 内容一致核对时，其他标签页不出现“已同步另一个标签页的文件夹更新”提示。
19. 一个标签页有待保存文件夹修改时，另一个标签页产生 metadata-only revision 不会取消该修改。

## 34. 建议的双端测试流程

### 测试 A：单向更新

1. Chrome 和 Safari 都打开；
2. Chrome 创建文件夹 A；
3. 等待 Chrome 上传；
4. Safari 保持前台；
5. 最迟一个检查周期后应出现 A。

### 测试 B：不同对象并发

1. Chrome 重命名文件夹 A；
2. Safari 在文件夹 B 添加聊天；
3. 两端分别点击圆圈；
4. 最终两端都应保留两个修改。

### 测试 C：同一对象并发

1. Chrome 将 A 改为 Alpha；
2. Safari 稍后将 A 改为 Beta；
3. 同步；
4. 两端最终名称应一致，通常为 Beta。

### 测试 D：删除传播

1. Chrome 删除文件夹 C；
2. 等待上传；
3. Safari 同步；
4. C 不应重新出现；
5. 远端 tombstone 应保留 C 的 ID。

### 测试 E：412 重试

1. 两端尽可能同时修改并同步；
2. 其中一端可能首次 PUT 得到 412；
3. 脚本应自动重新 GET、合并和重试；
4. 用户不应再被要求“先拉取并覆盖本地”。

## 35. 已知限制

1. 使用 WebDAV 轮询，不是 WebSocket 推送，因此不是毫秒级实时同步。
2. 同一对象冲突依赖设备时间；系统时钟严重不准时可能影响 last-operation-wins。
3. 操作日志会增加远端 JSON 大小；当前通过条数限制控制增长。
4. 极端复杂的跨设备父子移动冲突由 normalize 和最后操作规则处理，结果稳定，但不保证符合每位用户的主观意图。
5. 运行旧版本脚本的设备不理解 operation log，仍可能用旧快照覆盖远端；升级多端同步时应确保所有活跃设备使用 v0.6.0 或更高版本。

## 36. 未来可考虑的改进

- Hybrid Logical Clock，减少设备时间偏差影响；
- 远端 operation log 分段或压缩；
- 显示最近合并摘要和设备名；
- 可选的同步诊断面板，只显示非敏感信息；
- 为纯函数增加自动化单元测试；
- 将 WebDAV URL、账号文件名和连接测试拆成独立模块；
- 支持用户选择 15、30、60、120 秒检查间隔的预设。

## 37. 不建议重新引入的方案

- 自动迁移 v1/v2 单 profile；
- 长期保存 ETag 并直接用于下一次会话的 PUT；
- 远端变化时要求用户先拉取覆盖本地；
- 本地和远端同时变化时整份 JSON 最后写入者覆盖；
- 点击状态圆圈只显示缓存状态；
- 首次遇到 412 就无条件 PUT；
- 同步文件夹折叠状态；
- 页面隐藏时持续频繁 GET；
- 长期观察整个 DOM；
- 为每条最近聊天增加常驻按钮。

## 38. v0.6.0 变更摘要

- 状态圆圈改为真实的一键同步；
- 设置页“立即推送”改为“立即同步”；
- “立即拉取”改为恢复用途的“强制拉取”；
- 页面可见时默认每 30 秒检查远端；
- 增加稳定同步投影；
- 增加本地 `__cgfmSync` 基准快照；
- 增加对象级 operation log；
- 增加删除 tombstone；
- 远程 payload 升级为 schema 3；
- 本地和远端同时修改时自动合并；
- 412 后重新 GET、重新合并并最多重试三轮；
- 保留 Nextcloud ETag 兼容性回退；
- 折叠状态改为明确的设备本地状态；
- 同步说明文档更新为多端同步架构。


## 39. v0.6.2 变更摘要

- 跨标签页同步新增最近已接受业务投影基线 `lastSeenStorageProjection`；
- 收到其他标签页 revision 时先比较 `syncProjection`，区分真实文件夹业务变化与 WebDAV 运行元数据变化；
- 仅 WebDAV 核对时间、ETag、状态等变化时静默更新，不重绘文件夹树、不显示“已同步另一个标签页的文件夹更新”；
- 文件夹折叠等本地 UI 状态变化仍可在空闲标签页静默刷新，但不冒充业务更新提示；
- 当前标签页存在待保存业务修改时，metadata-only revision 只被确认，不再导致待保存业务数据被较新的元数据写入抢先覆盖。

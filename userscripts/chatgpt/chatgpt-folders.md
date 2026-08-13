# ChatGPT 文件夹：架构与维护说明

> 对应脚本：`userscripts/chatgpt/chatgpt-folders.user.js`  
> 当前说明版本：v0.6.4  
> 面向对象：未来维护者、代码审查者，以及需要快速接手该脚本的 AI  
> 定位：本文件是 ChatGPT 文件夹脚本的**完整架构与维护说明源**；脚本头部只保留必要摘要。

## 1. 30 秒快速理解

`chatgpt-folders.user.js` 是一个 Tampermonkey 用户脚本，在 ChatGPT 网页版原生左侧侧边栏中增加“文件夹”区域，用来整理普通聊天链接。

它管理的是**聊天引用**，不是聊天本身：

- 保存聊天标题、conversation id、相对链接和所在文件夹；
- 保存文件夹树、颜色和少量 UI 设置；
- 同一浏览器多标签页之间做本地事件同步；
- 不同浏览器/设备之间可通过 WebDAV 双向同步；
- 不归档、不移动、不删除 ChatGPT 官方聊天；
- 不保存完整聊天正文；
- 不读取或保存 ChatGPT access token、session token、cookie。

当前最重要的架构结论：

1. `state` 是当前 ChatGPT 账号的内存单一数据源。
2. 本地 profile 按 ChatGPT 账号隔离，不再自动迁移旧 v1/v2 单 profile。
3. `#cgfm-root` 是脚本唯一主 UI 根节点，必须挂在 ChatGPT 原生历史侧边栏内部。
4. 首次挂载必须避开 React hydration；`document-idle` 不代表 hydration 已完成。
5. 原生宿主探测必须排除脚本自己的 DOM，且永远不能把根节点挂到自身或其后代。
6. 性能优先：不长期观察整个 sidebar/document，不给最近聊天逐项注入常驻 UI。
7. 最近聊天拖入文件夹继续使用浏览器原生 drag/drop，并尽量不干扰 ChatGPT Projects。
8. 最近聊天三点菜单只在用户实际点击后短暂观察 Radix 菜单。
9. 同浏览器多标签使用小 revision key 事件驱动同步；metadata-only revision 不得覆盖本标签未保存业务修改。
10. WebDAV 使用 schema 3、基准快照、对象级 operation log、墓碑和有限 412 重试实现多端合并。
11. WebDAV 凭据仅保存在本地；远端/导出数据不得包含密码、token、cookie。
12. 修改行为、DOM 生命周期、同步或数据模型时，应同步更新本文件。

### 1.1 系统数据流

```text
ChatGPT 原生 sidebar / Recent / menu
          │
          ├─ 原生 drag/drop / 三点菜单入口
          │
          ▼
      #cgfm-root UI
          │
          ▼
       内存 state
       ├─ folders
       ├─ conversations
       └─ settings
          │
          ├─ debounce → Tampermonkey account-scoped profile
          │                │
          │                └─ 小 revision key → 同浏览器其他标签页
          │
          └─ operation log → WebDAV schema 3 JSON → 其他设备
```

## 2. 文件与职责

```text
userscripts/chatgpt/
├── chatgpt-folders.user.js
└── chatgpt-folders.md
```

- `chatgpt-folders.user.js`：可直接安装的完整 Tampermonkey 脚本；文件头只保留维护摘要。
- `chatgpt-folders.md`：当前架构、数据结构、DOM 生命周期、同步算法、性能约束、故障排查、测试和历史决策的完整说明。

旧文件名 `chatgpt-folders.design.md` 已废弃。后续不要同时维护两份同类设计文档。

## 3. 运行环境与权限

匹配页面：

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

WebDAV 请求优先使用 `GM_xmlhttpRequest`，并兼容部分脚本管理器提供的 `GM.xmlHttpRequest`。

## 4. 模块地图

脚本虽为单文件，但逻辑应按以下子系统理解：

1. 常量、工具函数和 Tampermonkey storage wrapper；
2. account-scoped state、profile normalize 与本地持久化；
3. ChatGPT 账号识别、账号切换与 WebDAV 文件名；
4. UI 样式与 icon；
5. sidebar host 探测、首次 mount、remount 与文件夹树 render；
6. 文件夹创建、重命名、颜色、删除与折叠；
7. 原生聊天 drag/drop；
8. 文件夹拖拽移动；
9. ChatGPT 最近聊天三点菜单“移至文件夹”；
10. 聊天标题提取、清洗与刷新；
11. 导入、导出与远程 payload；
12. sidebar width、设置弹窗和同步状态 UI；
13. WebDAV merge、GET/PUT/412 和远端检查；
14. 同浏览器多标签同步；
15. 稀疏 remount、休眠恢复与 boot。

维护时应先判断改动属于哪个子系统，再检查它与 DOM 生命周期、存储或同步边界的交叉影响。

## 5. 主要运行时状态

重要变量：

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
rootEl
sidebarEl
mounted
initialMountCandidate
initialMountCandidateSince
```

含义：

- `state`：当前账号完整 profile，是业务内存单一数据源；
- `currentAccount`：当前识别到的 ChatGPT 账号信息；
- `lockedAccountKey`：当前已激活 profile 的稳定账号键；
- `accountGeneration`：账号切换时递增，用于拒绝旧账号延迟返回的 WebDAV 响应；
- `selectedFolderId`：仅当前页面内存使用的选中高亮，不持久化、不跨标签同步；
- `mutationBaseline`：最近一次已经转换为 operation 的 `syncProjection` 基线；
- `localUnsavedChanges`：内存业务/本地状态尚未持久化到 Tampermonkey；
- `dirtySincePush`：存在尚未同步到 WebDAV 的业务变化；
- `webdavOperation`：串行化 WebDAV 操作，避免 GET/PUT/pull/check 并发；
- `rootEl`：`#cgfm-root`；
- `mounted`：是否至少成功完成过一次主 UI 挂载；
- `initialMountCandidate` / `initialMountCandidateSince`：首次 hydration-safe mount 的宿主稳定性门槛状态。

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

`__cgfm` 与 `__cgfmSync` 是本地元数据，不应作为远端 profile 内容直接同步。

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
- 除根节点外必须有合法父节点；
- 不允许把文件夹移动到自身或其任意子孙；
- 同级文件夹使用 `Intl.Collator` 排序；
- 文件夹中的聊天保持加入顺序，不自动排序；
- `collapsed` 是设备/浏览器 UI 状态，不参与 WebDAV 业务冲突。

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

## 7. DOM 与生命周期：最敏感的架构边界

### 7.1 目标挂载位置

目标是 ChatGPT 原生展开历史侧边栏内部，通常在“最近”区域之前：

```text
#stage-slideover-sidebar
  ├─ #stage-sidebar-tiny-bar
  └─ 展开历史区域
      └─ nav[aria-label="历史聊天记录"]
          ├─ GPT section
          ├─ Projects section
          ├─ #cgfm-root        ← 脚本
          ├─ Recent section
          └─ account footer
```

不要把根节点挂到 `#stage-slideover-sidebar` 过外层的位置，否则官方 sidebar 收起时脚本可能残留或继续占宽度。

### 7.2 原生宿主探测

`findHistorySection()` / `findSidebarParent()` 的语义是：**只寻找 ChatGPT 原生宿主**。

关键不变量：

- 脚本自身生成的 `.cgfm-chat-title` `/c/` 链接不能作为 Recent/history fallback；
- `findNativeChatLink()` 必须排除 `rootEl` 内链接；
- fallback 应尽量限制在 `#stage-slideover-sidebar` / 原生 nav 语义范围；
- 若找不到可信宿主，宁可本轮不挂载，也不要猜一个脚本内部容器。

### 7.3 防止自引用挂载

`isSafeMountParent(parent)` 必须保证：

```text
parent 是 Element
parent !== rootEl
!rootEl.contains(parent)
```

这不是普通 defensive check，而是 v0.6.3 后的结构不变量。

历史故障：React 重建 sidebar 时 `#history` 暂时消失，旧 fallback 会在全局 `/c/` 链接中命中脚本自己的聊天链接，再向上找到 `#cgfm-root` 内部容器。随后 `mount()` 尝试把根节点插入自己的后代，浏览器抛出：

```text
HierarchyRequestError: Failed to execute 'insertBefore' on 'Node':
The new child element contains the parent.
```

v0.6.3 的修复包括：

- 原生聊天探测排除 `.cgfm-chat-title` / `rootEl`；
- `mount()` 拒绝 root 自身或 descendant 作为 parent；
- `ensureMountedLight()` 只有在 `expectedParent` 安全时才认为 parent changed。

### 7.4 首次挂载与 React hydration

`@run-at document-idle` **不等于 React hydration 已完成**。

ChatGPT 可以在 document 已 idle 后继续 streaming / hydration / sidebar replacement。若脚本看到 nav 后立即插入 `#cgfm-root`，React 可能发现服务器 HTML 与客户端 hydration 时 DOM 不一致，报：

```text
RecoverableError: Minified React error #418
```

实际 A/B 验证曾明确显示：

```text
关闭 ChatGPT 文件夹脚本 → #418 消失
开启脚本             → #418 出现
```

因此 v0.6.4 把首次 mount 与后续 remount 分开处理。

首次 mount：

1. `document.readyState` 必须为 `complete`；
2. 找到安全、connected 的原生 parent；
3. 记录 `initialMountCandidate`；
4. 同一个 DOM Element 必须持续存在至少 `INITIAL_MOUNT_STABLE_MS`（当前 1200ms）；
5. 稳定窗口内若宿主被 React 替换，则重新计时；
6. 稳定确认前不调用 `injectStyle()`、`applySidebarWidth()`，也不插入 `#cgfm-root`；
7. 稳定后才进行首次 DOM 注入。

后续 remount：

- `mounted === true` 后不再重复等待 1200ms；
- React 重绘、sidebar 重建、休眠恢复时继续使用快速 `ensureMountedLight()`；
- 这样既避开 hydration，又不牺牲恢复速度。

### 7.5 稀疏挂载检查

boot 使用有限延迟检查：

```text
0.7s, 1.5s, 2.8s, 4.8s, 8s, 13s, 21s, 34s, 55s, 90s
```

另外在以下事件后启动短窗口恢复：

- `window.focus`
- `pageshow`
- `visibilitychange` 恢复可见
- sidebar toggle 后少量延迟检查

禁止为了“更稳”恢复长期观察整个 sidebar/document 的 MutationObserver。

### 7.6 设置弹窗预创建

v0.6.4 起 idle 预创建设置弹窗只在 `mounted` 已成功后进行。原因是即使主根节点尚未插入，过早向 `body` 添加脚本 DOM 也会扩大 hydration 干扰面。

## 8. 文件夹树与渲染策略

- 根节点只保留一个 `#cgfm-root`；
- `state` 是数据源，DOM 不是数据源；
- 初始化、导入、远端拉取、文件夹移动等结构性操作可全量 `render()`；
- 折叠、颜色等轻交互优先局部 DOM 更新；
- 不在每次 render 时重新排序；
- 文件夹树自然高度，与 ChatGPT 原生 sidebar 共用外层滚动条。

关键 CSS：

```css
#cgfm-root .cgfm-tree {
  height: auto;
  max-height: none;
  overflow: visible;
}
```

不要恢复独立 `max-height` / `overflow:auto`，否则会出现两个侧边栏滚动条。

## 9. 文件夹与聊天交互

### 9.1 文件夹创建、重命名、颜色、删除

- 新建文件夹直接进入 inline edit，不使用 `prompt()`；
- 空名称按现有逻辑回退或取消；
- 重命名后只排序相关同级文件夹；
- 设置颜色只更新相关节点和 state；
- 删除脚本文件夹只删除索引和其脚本管理的聊天引用，不删除 ChatGPT 官方聊天。

### 9.2 文件夹折叠

- `collapsed` 仅本地 UI 使用；
- 折叠只更新当前 children DOM；
- 保存可延迟；
- 不标记 WebDAV dirty。

### 9.3 文件夹拖动

payload：

```text
{ kind: "folder", folderId }
```

规则：

- 可拖入另一个文件夹成为子文件夹；
- 可拖到顶部标题行返回根目录；
- 根节点不能拖；
- 不能拖到自身或子孙；
- 移动后只排序源父级与目标父级；
- 不使用 mousemove 自定义拖动。

### 9.4 聊天拖入

聊天 payload：

```text
{ kind: "chat", id, title, url }
```

原生 drag/drop 识别路径：

1. pointerdown / mousedown 预缓存；
2. dragstart 从 `event.composedPath()` 找 `/c/` anchor；
3. 不清空 ChatGPT 原生 `dataTransfer`；
4. 追加脚本 MIME；
5. drop 优先读脚本缓存，再尝试 URI/plain/html；
6. dragend 只做有限兜底。

所有 `composedPath()` 项在传给 `Node.contains()` 前必须确认是 `Node`，避免 Firefox 类型错误。

某些 Recent 链接为 `draggable="false"` 时，只在用户按下该具体聊天时临时切换为 `true`，并在 dragend/mouseup/click/timeout 后恢复；禁止扫描或永久修改整个列表。

## 10. ChatGPT 原生三点菜单集成

用户点击 Recent 聊天的 options trigger 后：

1. 记录当前 conversation；
2. 短暂启动 MutationObserver 捕捉 Radix `role="menu"`；
3. 找到可见聊天菜单后注入“移至文件夹”；
4. 悬停/focus 时显示脚本自己的多级文件夹浮层；
5. 选择文件夹后添加聊天引用；
6. 捕捉成功或约 1.8 秒超时后立即 disconnect。

约束：

- 这是**唯一允许**的短时 body observer 类场景；
- 不给 Recent 每条聊天常驻注入按钮；
- 不依赖 React/Radix collection 内部状态；
- 不让脚本菜单项事件误冒泡到官方菜单；
- `nativeMenuPollTimer` 只在菜单打开期间做低频存活检查，菜单关闭后停止。

## 11. 聊天标题与跳转

标题来源必须按来源清洗：

- 原生 sidebar anchor 可见文本：只压缩异常空白、限制长度，保留用户真正输入的 `ChatGPT` / `OpenAI`；
- `aria-label`：只解包完整的“打开…的对话选项”/ `Open ... options` UI 文案；
- `document.title`：只移除明确分隔符连接的末尾 `ChatGPT` 品牌后缀。

不要泛化删除 `/^Open/` 或开头的 `ChatGPT`。

点击脚本文件夹中的聊天：

1. 找同 conversation 的 ChatGPT 原生 `/c/<id>` anchor；
2. 优先触发原生 click，让 ChatGPT router 自己处理；
3. 找不到时才 `location.assign()`；
4. 不强行 `history.pushState()`。

## 12. Sidebar width

只通过 CSS 变量 `--sidebar-width` 控制宽度。

不要直接修改：

- `#stage-slideover-sidebar.style.width`
- `minWidth`
- `maxWidth`
- `flexBasis`
- nav / aside / 外层 flex 容器宽度

官方 sidebar 展开时才应用脚本覆盖；收起时撤销，让 ChatGPT tiny-bar/collapsed 布局接管。

sidebar toggle 后使用少量延迟检查（约 80/220/500/900ms），不要高频监听布局。

## 13. 本地存储与账号隔离

当前关键 storage key：

```text
cgfm.v3.profile.<account-key>
cgfm.v3.revision.<account-key>
cgfm.v3.remoteFileMap
cgfm.v3.deviceId
cgfm.v1.lastAccount
```

- `profile`：账号完整本地 profile 与本地同步元数据；
- `revision`：同浏览器多标签页事件键；
- `remoteFileMap`：账号到 WebDAV 文件名的稳定映射；
- `deviceId`：当前脚本管理器环境设备 ID；
- `lastAccount`：账号信息短暂不可读时的有限回退。

当前不自动迁移：

```text
cgfm.v1.state
cgfm.v2.currentProfile
cgfm.v2.revision
```

旧单 profile 无法可靠判断属于哪个 ChatGPT 账号；恢复旧数据应通过显式 JSON 导入。

## 14. 账号识别与切换

优先从 `script#client-bootstrap` 读取：

- `session.user.email` / `user.email`
- user name
- `session.account.id` / account id

账号稳定键优先 accountId，其次 email。

账号切换要求：

- 强账号信息连续观察两次后才切换，避免 hydration 瞬时身份噪声；
- 停止旧 WebDAV timers；
- teardown 旧 storage listener；
- `accountGeneration += 1`；
- 激活新 account-scoped profile；
- 重新绑定 storage sync 和 WebDAV 检查。

每个 WebDAV 请求绑定 generation/account key/目标 URL；响应返回时再次校验。旧账号延迟响应必须丢弃。

## 15. 同浏览器多标签页同步

流程：

1. 当前标签页写完整 profile；
2. 再写小型 revision metadata；
3. 其他标签页通过 `GM_addValueChangeListener` 监听小键；
4. 只有收到新 revision 时才读取大 profile；
5. 比较业务投影与 UI render 投影；
6. 真实业务变化才提示“已同步另一个标签页的文件夹更新”；
7. metadata-only 变化静默接收。

### 15.1 `syncProjection`

跨设备/业务投影包含：

- 文件夹结构、名称、父节点、颜色；
- 聊天引用；
- sidebar width 偏好。

不包含：

- WebDAV URL/username/password；
- WebDAV 状态、ETag、检查时间；
- folder `collapsed`；
- `sectionCollapsed`；
- storage revision；
- 本地 sync baseline / pending operations。

### 15.2 metadata-only revision

v0.6.2 起，另一个标签页仅因为 `lastRemoteCheckAt`、ETag、同步状态等运行元数据写入产生新 revision 时：

- 不应显示文件夹更新 toast；
- 不应无条件重绘文件夹树；
- 若当前标签页有尚未保存的业务修改，只确认新 revision，不得用 metadata-only profile 覆盖本地业务内存；
- 当前标签页随后仍可正常持久化自己的业务变化。

这是防止“刷新一个标签页导致另一个标签页正在编辑的数据被抢先覆盖”的重要不变量。

## 16. WebDAV 数据模型

### 16.1 远程文件名

默认：

```text
安全化邮箱-accountId前8位.json
```

例如：

```text
user_at_example_com-5a54db9a.json
```

用户可在设置中覆盖当前账号文件名，映射保存在 `cgfm.v3.remoteFileMap`。

### 16.2 schema 3 payload

```json
{
  "app": "ChatGPT文件夹",
  "version": "0.6.4",
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

远端 profile 不包含：

- WebDAV URL、username、password；
- WebDAV 本地运行状态；
- `__cgfm`；
- `__cgfmSync`；
- folder collapsed / sectionCollapsed；
- ChatGPT token、cookie 或完整聊天正文。

## 17. 本地同步元数据 `__cgfmSync`

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

- `baseRevision`：基准快照对应远端 revision；
- `baseProfile`：上次成功同步后的稳定业务投影；
- `operations`：基准之后的本地待同步对象级操作；
- `tombstones`：删除记录；
- `lastCompactedAt`：未来压缩预留。

不要只保存 revision 而丢弃 `baseProfile`，否则无法可靠三方合并。

## 18. Operation log

操作类型：

```text
folder-upsert
folder-delete
conversation-upsert
conversation-delete
settings-update
```

结构：

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

业务动作调用 `schedulePersist(..., { webdav: true })` 后，通过比较：

```text
mutationBaseline
当前 syncProjection(state)
```

自动 derive 对象级操作。这样 UI 函数不需要各自维护第二套日志。

本地待同步 operation 上限约 500，远端保留约 1500；日志不足以重建远端当前快照时，脚本使用 snapshot diff 补齐。

## 19. Tombstone

删除操作同时维护墓碑：

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

作用：

- 区分“被删除”与“暂时缺失”；
- 防止离线旧设备重新上传已删除对象；
- 在 operation log 截断、snapshot diff 回退时保存删除语义。

## 20. 多端同步决策

每次真实同步先 GET 远端。

### 20.1 本地干净 + 远端未变化

```text
remote revision == baseRevision
remote snapshot == baseProfile
local operations == empty
```

结果：只更新核对时间，不 PUT。

### 20.2 本地干净 + 远端变化

自动应用远端 profile，同时保留当前设备本地 UI 状态和 WebDAV 凭据，并更新 baseline/revision。

### 20.3 本地变化 + 远端未变化

应用本地 operation，生成新 revision，条件 PUT，随后 GET 写后校验。

### 20.4 本地 + 远端同时变化

1. 读取 `baseProfile`；
2. 提取远端 `revision > baseRevision` 的 operation；
3. 校验 operation 能否重建当前远端 snapshot；不足则 snapshot diff 补操作；
4. 同样校验本地 operation；
5. 合并 operation；
6. 按时间和 operation id 稳定排序；
7. 应用到基准；
8. normalize 父子关系和聊天归属；
9. 条件 PUT；
10. GET 校验；
11. 建立新 baseline。

同一对象冲突使用稳定 last-operation-wins：先比较 `at`，相同再比较 `id`。

## 21. ETag 与 HTTP 412

正常：

```text
GET
→ 读取这次 GET 的 ETag
→ merge
→ PUT If-Match
→ GET verify
```

ETag 只在事务内使用，不作为跨会话长期写凭据。

412：重新 GET、重新 merge、有限重试，最多三轮。

兼容部分 Nextcloud/代理的特殊情况：只有重试到后段，并且再次 GET 证明远端内容与上传前 byte-for-byte 相同，才允许一次无条件 PUT。不要改成首次 412 就 force PUT。

## 22. WebDAV 状态与周期检查

状态圆圈：

- 灰：未启用/未配置；
- 绿：最近一次已真正与云端核对；
- 橙：本地有待同步业务变化；
- 蓝：同步中；
- 红：同步失败/冲突。

点击圆圈执行真实 `webdavSync()`。

默认前台检查约 30 秒，设置允许 15～300 秒：

- 页面可见：周期检查；
- 页面隐藏：暂停；
- focus/pageshow/恢复可见：安排检查；
- 本地业务修改：debounce 后自动同步。

不要把间隔降低到几秒级。

## 23. 强制拉取与新设备初始化

“强制拉取”是恢复工具，不是日常同步按钮。若本地存在未同步修改，必须确认用户愿意放弃。

新设备本地为空：配置 WebDAV 后可以从账号专属 JSON 自动初始化 baseline。

若本地已有用户数据但尚未建立当前远端 baseline，不要猜两份数据关系；应要求先备份，再选择强制拉取或重新初始化。

## 24. 导入与导出

导出：

- 使用当前 schema 3 payload；
- 包含业务 snapshot、operation、tombstone；
- 不包含 WebDAV 凭据、token、cookie、完整聊天正文。

导入：

- 校验 `folders` / `conversations`；
- 保留当前 WebDAV 本地配置；
- 保留本地同步基准；
- 将导入结果视为本地业务变化并进入后续 operation/sync 流程；
- 不在 file reader 回调里直接做阻塞网络同步。

## 25. 性能约束 / 禁止事项

这是未来 AI 最需要遵守的章节。

禁止：

1. 长期 `MutationObserver` 观察 `document.body` 或整个 sidebar；
2. 长期 `mousemove` 热路径；
3. 给 Recent 每一条聊天注入常驻 button/icon/wrapper；
4. hover Recent 时扫描历史列表；
5. 每次 render 重新 sort 整棵树；
6. 折叠/展开触发 WebDAV dirty；
7. 页面隐藏时继续高频 WebDAV GET；
8. 同时运行多个 WebDAV 操作；
9. 泛化修改 nav/aside/flex/grid 容器宽度；
10. 强行 `history.pushState()` 模拟 ChatGPT 路由；
11. hydration 稳定前向 React-managed sidebar/body 注入脚本 UI；
12. fallback 全局搜索 `/c/` 时把 `.cgfm-chat-title` 当作原生聊天；
13. 允许 `rootEl` 挂载到自身或 descendant；
14. 在日志/诊断中输出密码、Authorization、token、cookie、完整 client-bootstrap；
15. 让 metadata-only cross-tab revision 覆盖本标签未保存业务变化。

允许的 observer：仅用户主动打开 Recent 三点菜单后的短时 Radix 捕捉，成功或超时立即断开。

## 26. 故障诊断

### 26.1 `HierarchyRequestError: new child element contains the parent`

**症状**：Console 出现 `insertBefore` / `appendChild` 的层级异常，常伴随 sidebar React 重建或休眠恢复。

**历史根因**：native `#history` 暂时消失后，fallback 命中 `#cgfm-root` 自己的 `/c/` anchor，错误地把脚本后代当成 mount parent。

**正确检查**：

- `findNativeChatLink()` 是否排除 `.cgfm-chat-title`；
- `rootEl.contains(candidate)` 是否为 false；
- `isSafeMountParent()` 是否仍在 mount 和 parentChanged 判断中。

**不要**仅通过增加 retry 或 observer 掩盖结构错误。

### 26.2 React RecoverableError #418

**症状**：首次加载 ChatGPT 时 Console 显示 hydration mismatch，stack 常落在 `nav`。

**已验证根因**：脚本首次向 React-managed sidebar 注入 DOM 太早。A/B 测试关闭脚本后错误消失，重新开启后复现。

**正确检查**：

- 首次 mount 是否仍走 `initialMountHostStable()`；
- 是否要求 `document.readyState === 'complete'`；
- 同一个 parent 是否稳定至少 `INITIAL_MOUNT_STABLE_MS`；
- 稳定前是否意外调用 `injectStyle()`、`applySidebarWidth()`、`ensureSettingsModal()` 或插入 `#cgfm-root`；
- 后续 remount 是否仍保持快速而没有重复等待。

**不要**用固定 5 秒 sleep 或长期 MutationObserver 代替稳定宿主门槛。

### 26.3 Adblock Plus `:has-text(...)` selector SyntaxError

若 stack 明确来自 `chrome-extension://.../@eyeo/webext-ad-filtering-solution/...`，这是广告过滤扩展自己的 selector 问题，不属于本脚本。它与 React #418 曾同时出现，但禁用 Adblock Plus 后 #418 仍存在，最终通过脚本 A/B 单独定位到首次 mount timing。

### 26.4 两个 sidebar 滚动条

确认 `.cgfm-tree` 没有恢复独立 `max-height` / `overflow:auto`，且 `#cgfm-root` 仍在官方外层 scroll container 内。

### 26.5 刷新一个标签页，另一个标签页误报“文件夹更新”

检查新 revision 的业务投影是否真的变化。仅 WebDAV 检查时间、ETag、lastStatus 等变化必须静默接收。

### 26.6 本地编辑被另一个标签页覆盖

检查 `localUnsavedChanges` 时 metadata-only revision 是否只更新 revision 认知而没有调用业务 profile 覆盖。

### 26.7 HTTP 412 持续失败

检查：

- 是否存在旧脚本持续写同一远端文件；
- server/proxy 是否返回或改写 ETag；
- 三轮重试期间远端是否持续变化；
- force PUT 前是否做了 byte-for-byte 再确认。

### 26.8 删除对象重新出现

检查 delete operation、tombstone、远端 operation 窗口和旧设备版本。

## 27. 发布与最低测试

任何 `.user.js` 行为变更先提升 `@version`，并保持 metadata 与 `const VERSION` 一致。

最低静态检查：

```bash
node --check userscripts/chatgpt/chatgpt-folders.user.js
```

最低人工检查：

1. 首次打开 ChatGPT 无 React #418；
2. 只存在一个 `#cgfm-root`；
3. sidebar 展开/收起正常；
4. 创建、重命名、改色、删除、折叠文件夹正常；
5. Recent 拖入文件夹正常，拖到 Projects 尽量不受影响；
6. 文件夹移动不会形成循环；
7. Recent 三点菜单“移至文件夹”正常且 observer 会停止；
8. 文件夹聊天点击优先走原生 SPA 链接；
9. 文件夹树无内部滚动条；
10. sidebar width 收起时释放；
11. 多标签真实业务更新能同步；
12. metadata-only revision 不误报、不覆盖本地未保存业务修改；
13. WebDAV 单向 pull/push、并发不同对象 merge、同对象稳定冲突、删除传播均正常；
14. 412 能重新 GET/merge/retry；
15. 导出和远端 JSON 不包含凭据。

## 28. 推荐双端测试

### A. 单向更新

Chrome 创建文件夹 A → 等待上传 → Safari 前台一个检查周期内出现 A。

### B. 不同对象并发

Chrome 重命名 A，Safari 向 B 添加聊天，两端分别同步；最终两端都保留两个修改。

### C. 同对象并发

两端依次重命名同一文件夹；同步后最终名称一致，遵循稳定 last-operation-wins。

### D. 删除传播

一端删除文件夹 C；另一端同步后 C 不应重新出现，远端 tombstone 保留删除语义。

### E. 412 重试

两端尽可能同时同步；某一端收到 412 后应自动重新 GET、merge 和有限重试，不要求用户先覆盖本地。

### F. 首次 hydration

完全关闭 ChatGPT 标签页 → 新开页面 → 确认 Console 不出现 React #418 → 文件夹在短暂稳定窗口后出现。

### G. 休眠/React 重建恢复

首次已经挂载成功后，让 sidebar 重建、切换可见性或系统休眠恢复；确认脚本能快速 remount，不再重新等待完整首次稳定窗口。

## 29. 已知限制

1. WebDAV 是轮询，不是 WebSocket 推送；
2. 同对象冲突依赖设备时间，严重时钟偏差会影响 last-operation-wins；
3. operation log 会增加远端 JSON 大小，目前通过条数上限控制；
4. 极端跨设备父子移动冲突经过 normalize 后结果稳定，但未必符合所有主观意图；
5. 运行旧版本脚本的设备可能不理解新同步语义，应尽量保证活跃设备版本一致；
6. ChatGPT DOM 是外部依赖，`#history`、sidebar/nav/menu 结构未来可能变化；修改 selector 时必须继续保留 native-only 和 hydration-safe 两条原则。

## 30. 历史决策与版本演进

### v0.3.x：交互与性能路线稳定

- 放弃为 Recent 每项注入气泡/常驻按钮；
- 放弃自定义 pointer drag，回到原生 drag/drop；
- 放弃长期 sidebar/document observer；
- 放弃 `history.pushState()` 模拟路由；
- 支持 draggable=false Recent link 的按需临时启用；
- selected folder 高亮改为仅当前页面内存状态。

### v0.5.x：账号隔离与滚动结构

- 本地 profile 按 ChatGPT 账号隔离；
- 不再自动迁移旧单 profile；
- WebDAV 文件按账号映射；
- 文件夹树改为自然高度，与官方 sidebar 共用滚动条。

### v0.6.0：真正的多端合并

- 状态圆圈执行真实同步；
- 远端 schema 3；
- `syncProjection`、`baseProfile`、operation log、tombstone；
- 本地与远端同时变化时自动 merge；
- 412 后重新 GET/merge/有限重试；
- folder collapse 明确为设备本地状态。

### v0.6.1：标题清洗按来源拆分

- 原生可见文本保留用户输入的 ChatGPT/OpenAI；
- aria-label 只解包完整 UI 包装；
- document.title 只移除明确的末尾品牌后缀。

### v0.6.2：cross-tab metadata-only revision

- 引入最近已接受业务投影基线；
- WebDAV 状态/ETag/检查时间等变化不再冒充文件夹更新；
- metadata-only revision 不得抢先覆盖另一个标签页尚未持久化的业务修改。

### v0.6.3：防止 root 自引用挂载

- native chat fallback 排除脚本自身 `/c/` links；
- mount parent 禁止为 `rootEl` 或 descendant；
- parentChanged 只接受安全宿主；
- 修复 React 重建期间反复出现的 `HierarchyRequestError`。

### v0.6.4：hydration-safe 首次 mount

- 首次 mount 要求同一原生 sidebar host 稳定至少 1200ms；
- 稳定前不注入主样式、sidebar width override 或根节点；
- 设置弹窗预创建延后到首次成功 mount 后；
- 后续 remount 保持快速；
- 修复由脚本首次 DOM 注入触发的 React RecoverableError #418。

## 31. 不建议重新引入的方案

- 自动迁移 v1/v2 单 profile；
- 长期持久化 ETag 并直接用于下一会话 PUT；
- 远端变化时要求用户先 pull 覆盖本地；
- 本地/远端并发时整份 JSON last-writer-wins；
- 点击同步圆圈只读缓存状态；
- 首次 412 就无条件 PUT；
- 同步 folder collapse；
- 页面隐藏时持续频繁 GET；
- 长期观察整个 DOM；
- Recent 每项常驻按钮；
- 自定义 pointer drag；
- 强行 `history.pushState()`；
- hydration 阶段一发现 nav 就立即注入脚本 DOM；
- 在 mount fallback 中使用未排除脚本自身 DOM 的全局 `/c/` selector。

## 32. 未来可考虑的改进

- Hybrid Logical Clock，降低设备时间偏差影响；
- operation log 分段或压缩；
- 显示最近 merge 摘要与设备名；
- 可选脱敏同步诊断面板；
- 为纯函数/merge 增加自动化单元测试；
- 将 WebDAV URL、账号文件名、连接测试进一步模块化；
- 若 ChatGPT DOM 再次变化，优先研究更稳定的原生 sidebar semantic anchor，而不是扩大全局扫描范围。

## 33. 文档维护规则

本文件是完整说明源。未来改动遵循：

- 仅注释、拼写或排版变更：通常不需要提升 userscript 版本；
- 用户可见行为或可执行代码变更：提升 `@version`；
- 改 sidebar mount / React 生命周期：更新第 7、25、26、27、30 节；
- 改 storage / cross-tab：更新第 13～15、26、27 节；
- 改 WebDAV schema / merge：更新第 16～23、26～30 节；
- 改 drag/menu/title/sidebar width：更新对应交互章节；
- 不要重新把本文件的大段内容复制回 `.user.js` 头部，只保持脚本维护摘要和指向本文件的路径。

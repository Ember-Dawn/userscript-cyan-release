// ==UserScript==
// @name         ChatGPT文件夹
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js
// @version      0.3.18
// @description  ChatGPT 普通聊天文件夹管理：v0.3.18；文件夹选中高亮仅在当前页面保留，并继续兼容最近列表中 draggable=false 的 GPT 对话。
// @author       ChatGPT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

/*
================================================================================
ChatGPT文件夹 - 脚本维护说明 / AI 交接说明
适用版本：v0.3.18 附近
================================================================================

这是一个用于 ChatGPT 网页端普通聊天的 Tampermonkey 用户脚本。它在 ChatGPT 左侧侧边栏中增加一个“文件夹”区域，用于本地管理聊天链接。它不是 ChatGPT 官方 Project 功能，也不会修改 ChatGPT 后端数据；它只保存“聊天标题 + 链接 + conversation id + 文件夹结构 + 部分 UI 设置”。

本说明用于粘贴在脚本前面，方便未来把脚本交给其他 AI 或维护者时快速理解当前架构、功能边界、性能约束和历史踩坑。

--------------------------------------------------------------------------------
一、核心目标
--------------------------------------------------------------------------------

1. 在 ChatGPT 普通聊天左侧栏中提供文件夹管理。
2. 支持创建文件夹、子文件夹、重命名、设置颜色、删除、折叠 / 展开。
3. 支持无限嵌套文件夹。
4. 支持把 ChatGPT 原生“最近”列表里的聊天拖入脚本文件夹。
5. 支持拖动脚本文件夹到另一个脚本文件夹中，变成子文件夹。
6. 支持把子文件夹拖到顶部“文件夹”标题行，移动回根目录。
7. 支持在 ChatGPT 原生最近对话三点菜单中增加“移至文件夹”选项，并通过多级菜单选择脚本文件夹。
8. 拖入 / 移入文件夹后，ChatGPT 原生最近聊天列表保持完全原样，不隐藏、不归档、不移动。
9. 脚本文件夹中的聊天只是链接引用，不保存完整聊天内容。
10. 脚本应与 ChatGPT 官方 Projects 共存，尽量不影响官方 Project 的拖拽功能和原生菜单。
11. 性能优先：避免高频监听、避免长期 MutationObserver、避免给“最近”列表每条聊天注入元素。
12. 同一浏览器多标签页通过小 revision key 事件驱动同步；如果 API 不可用，自动降级，不影响主功能。

--------------------------------------------------------------------------------
二、当前稳定技术路线
--------------------------------------------------------------------------------

当前稳定路线是：

1. Firefox 原生 drag/drop 拖拽。
2. 低侵入侧边栏挂载。
3. 文件夹 UI 独立根节点。
4. 最近对话菜单只在用户点击三点按钮后进行短暂 Radix 菜单捕捉和注入。
5. WebDAV 按 ChatGPT 账号生成不同远程 JSON 文件。
6. 本地只保存当前数据，不做复杂多账号本地 profile。
7. 同浏览器多标签页同步为事件驱动、可降级补丁，不使用轮询。

历史上曾尝试过以下方案，但因为性能或兼容性问题已放弃：

1. 给“最近”列表每条聊天注入气泡拖拽手柄。
   - 问题：DOM 注入多，ChatGPT React 重绘频繁，Firefox 下 CPU 升高。
2. 浮动气泡手柄 / 懒激活手柄。
   - 问题：仍需跟踪侧边栏悬停状态，性能损耗不理想。
3. 自定义 pointer 拖拽。
   - 问题：会影响 ChatGPT 官方 Project 拖拽体验，且没有浏览器原生拖拽反馈。
4. 长期 MutationObserver 监听整个 sidebar 或 document。
   - 问题：ChatGPT React 页面动态更新频繁，容易导致卡顿。
5. 强行 history.pushState 模拟 ChatGPT SPA 跳转。
   - 问题：ChatGPT 路由状态不只是 URL，强行 pushState 可能导致页面状态不一致。
6. 泛化修改 nav / aside / flex 容器宽度。
   - 问题：容易破坏 ChatGPT 原生侧边栏布局和折叠逻辑。
7. 给最近列表每条聊天常驻注入“添加到文件夹”按钮。
   - 问题：性能成本高，并且容易和 ChatGPT React 虚拟化 / hover 操作冲突。

因此，后续维护应避免重新引入上述路线，除非有充分理由并经过性能测试。

--------------------------------------------------------------------------------
三、聊天拖拽实现原则
--------------------------------------------------------------------------------

聊天拖拽采用 ChatGPT 原生最近列表里的 draggable 链接，不向最近列表注入任何元素。

目标交互：

- 拖动 ChatGPT 原生最近对话 → 拖到脚本文件夹行 → 添加到该文件夹。
- 拖动 ChatGPT 原生最近对话 → 拖到 ChatGPT 官方 Project → 仍然尽量交给官方处理。
- 脚本只在自己的文件夹行上处理 dragover / drop。
- 不在全局 dragover 阻止默认行为。
- 不拦截 ChatGPT 官方 Project 区域的 drop。

拖拽源识别采用多路兜底：

1. pointerdown / mousedown 阶段预缓存最近对话链接。
2. dragstart 阶段再次从 event.composedPath() 中查找 a[href*="/c/"]。
3. dragstart 时向 dataTransfer 追加脚本自己的 MIME payload，但不清空 ChatGPT 原生 drag 数据。
4. drop 阶段优先读取脚本缓存。
5. drop 阶段可尝试读取 dataTransfer 的 text/uri-list、text/plain、text/html。
6. dragend 可作为兜底：如果 drop 没成功但最后悬停在脚本文件夹上，可尝试补提交。
7. 所有 composedPath() 项都必须先判断是否为 Node / Element，避免 Firefox 报错：
   “Node.contains: Argument 1 does not implement interface Node.”

拖入聊天后：

- 文件夹内聊天保持加入顺序，新聊天放在最后。
- 不触发 WebDAV 立即同步，只标记 dirty 并延迟保存 / 延迟备份。
- 只高亮文件夹行，不高亮文件夹中的聊天行。
- 目标文件夹如果折叠，可以自动展开或在 render 后显示新聊天。

--------------------------------------------------------------------------------
四、文件夹拖拽移动实现原则
--------------------------------------------------------------------------------

当前脚本支持文件夹拖动到其他文件夹中，也支持拖到顶部“文件夹”标题行返回根目录。

目标交互：

- 拖动文件夹 A → 放到文件夹 B 行上：A 变成 B 的子文件夹。
- 拖动文件夹 A → 放到顶部“文件夹”标题行：A 移动到根目录。
- 拖动根目录不允许。
- 拖动文件夹到自己或自己的任意子孙文件夹中不允许。

实现原则：

1. 文件夹行可设置 draggable="true"。
2. 拖拽 payload 使用 kind 区分类型：
   - { kind: "chat", id, title, url }
   - { kind: "folder", folderId }
3. drop 时根据 kind 分流：
   - chat：加入目标文件夹。
   - folder：移动到目标父文件夹。
4. 顶部“文件夹”标题行作为 root drop target。
5. 移动文件夹时必须防止循环引用：
   - sourceId !== targetParentId
   - targetParentId 不能是 sourceId 的 descendant
6. 文件夹移动后只对相关父级的 childFolderIds 使用 Intl.Collator 排序。
7. 文件夹移动是低频操作，drop 后重绘一次文件夹树可以接受。
8. 不要监听 mousemove 来实现文件夹拖拽；继续依赖浏览器原生 drag/drop。

--------------------------------------------------------------------------------
五、最近对话三点菜单集成
--------------------------------------------------------------------------------

当前脚本支持在 ChatGPT 原生最近对话三点菜单中增加“移至文件夹”选项。

ChatGPT 最近对话菜单是 Radix/React Portal 渲染的菜单，一般不在最近列表 DOM 内，而是临时渲染到 body 末尾附近。菜单结构通常包含：

- role="menu"
- data-radix-menu-content
- data-testid="share-chat-menu-item"
- data-testid="delete-chat-menu-item"
- 原生“移至项目”菜单项，且该项自带右箭头和子菜单结构

实现策略：

1. 全局只监听 pointerdown / click，用来捕获用户是否点击了最近对话的三点按钮。
2. 通过 data-conversation-options-trigger 读取 conversation id。
3. 通过外层 a[href*="/c/"] 读取标题和链接。
4. 点击三点按钮后，短暂启动 MutationObserver 捕捉 Radix 菜单出现。
5. 找到可见的聊天菜单后，向菜单中注入一项：
   “移至文件夹”
6. 鼠标悬停或 focus “移至文件夹”时，脚本显示自己的多级文件夹浮层菜单。
7. 点击某个文件夹后，把该最近聊天加入脚本文件夹。
8. 菜单注入完成后立即停止临时 observer；不要长期观察 body。

性能原则：

- 不给最近列表每一项注入常驻按钮。
- 不扫描全部历史聊天。
- 不长期监听菜单变化。
- 只在用户点击三点按钮后的 1~2 秒内短暂观察菜单。
- 自定义多级文件夹菜单使用脚本自己的浮层 DOM，不试图驱动 ChatGPT 的 React/Radix 子菜单状态。

关于“移至文件夹”右箭头：

- 当前路线基于 v0.3.6 样式，不使用 v0.3.7 的完整克隆菜单结构。
- 右箭头位置由 CSS 选择器控制：
  .cgfm-native-menu-item[data-cgfm-native-add] > svg
- v0.3.8 / v0.3.9 附近使用 transform: translateX(...) 微调位置。
- 负数越大，箭头越往左；例如 -4px、-8px、-12px。
- 不要通过给整个菜单项加大 padding 来调箭头，容易影响和原生菜单的对齐。
- 如果用户手动调试，优先调这一条规则里的 transform: translateX(...)。

注意：

- 插入的菜单项是后插入 DOM，不是 ChatGPT React 组件本身。
- 它应尽量复用 ChatGPT 原生 __menu-item / icon 样式，但不能假设 Radix collection 会管理它。
- 不能让该菜单项点击事件冒泡到 ChatGPT 官方菜单导致误关闭或误触发。

--------------------------------------------------------------------------------
六、文件夹排序规则
--------------------------------------------------------------------------------

只对“同级文件夹”排序。

默认使用 Intl.Collator，例如：

- numeric: true
- sensitivity: "base"
- locale 可使用浏览器默认语言

注意：

- 文件夹中的聊天不排序。
- 新拖入 / 菜单移入的聊天直接放在该文件夹末尾。
- 文件夹拖动移动后，只对源父级和目标父级排序。
- 排序应只在新增文件夹、重命名文件夹、移动文件夹、导入配置等需要排序的时刻执行。
- 不要在每次 render 时重复 sort，以免造成不必要性能开销。

--------------------------------------------------------------------------------
七、性能设计原则
--------------------------------------------------------------------------------

这是本脚本最重要的维护原则。

必须避免：

1. 不要长期监听 document.body 的 MutationObserver。
2. 不要长期监听 mousemove。
3. 不要给 ChatGPT “最近”列表里的每条聊天注入按钮、图标或 wrapper。
4. 不要在 hover 最近聊天时执行脚本逻辑。
5. 不要在折叠 / 展开文件夹时重绘整棵树。
6. 不要在取消设置弹窗时保存、重绘、同步 WebDAV。
7. 不要在拖入聊天后立即执行 WebDAV 上传。
8. 不要把诊断逻辑放在常态运行路径中。
9. 不要泛化修改 ChatGPT 原生 nav / aside / flex / grid 容器样式。
10. 不要让“移至文件夹”菜单功能使用常驻 observer。

允许的轻量 observer：

- 只允许在用户点击最近对话三点按钮后，短暂监听 body，等待 Radix 菜单出现。
- 捕捉成功或超时后必须 disconnect。
- 超时时间建议不超过 1.8 秒左右。

推荐做法：

1. 文件夹 UI 只挂载一个根节点。
2. 使用事件委托，少量事件监听绑定到脚本根节点。
3. 文件夹折叠 / 展开只做局部 DOM 更新：
   - 切换当前文件夹 children 容器的 hidden / display。
   - 切换当前箭头方向。
   - 延迟保存折叠状态。
   - 不触发 WebDAV dirty。
4. 重命名只更新当前节点文本。
5. 设置颜色只更新当前节点图标 / CSS 变量。
6. 删除只移除当前 DOM 子树并更新内存 state。
7. 本地保存使用 debounce。
8. WebDAV 自动备份使用更长延迟。
9. 设置弹窗 DOM 复用，避免每次打开都重建。
10. 取消 / 点击遮罩关闭设置弹窗只关闭，不保存、不重绘、不 dirty。

--------------------------------------------------------------------------------
八、侧边栏挂载位置
--------------------------------------------------------------------------------

脚本文件夹区域应挂载到 ChatGPT 官方展开的历史列表容器内部，尽量插在“最近”section 之前。

不要挂载到太外层的 #stage-slideover-sidebar 直接子层，否则官方侧边栏收起时，脚本区域可能不会随官方内容一起隐藏。

ChatGPT 当前侧边栏大致结构：

#stage-slideover-sidebar
  ├─ #stage-sidebar-tiny-bar                  // 收起后的窄栏 / tiny bar
  └─ 展开的历史列表容器
      └─ nav[aria-label="历史聊天记录"]
          ├─ GPT section
          ├─ 项目 section
          ├─ 最近 section
          └─ account footer

脚本应插入到 nav[aria-label="历史聊天记录"] 中，通常在“最近”section 之前。

挂载策略：

1. 页面加载后有限重试挂载。
2. 不使用长期 MutationObserver。
3. 如果 React 重绘导致脚本根节点消失，可在有限时机重新挂载：
   - 初始化后的稀疏有限延迟检查，最长约 90 秒，例如 0.7s、1.5s、2.8s、4.8s、8s、13s、21s、34s、55s、90s。
   - window focus。
   - visibilitychange。
   - pageshow。
   - 侧边栏展开后短暂检查。
4. 检查逻辑必须轻量，只判断根节点是否存在，不扫描大量历史聊天。
5. 为了性能优先，不使用长期 MutationObserver；延长重试只增加少量 setTimeout 检查，挂载成功后后续检查基本为空操作。

--------------------------------------------------------------------------------
九、侧边栏宽度控制
--------------------------------------------------------------------------------

ChatGPT 原生侧边栏宽度主要由 CSS 变量 --sidebar-width 控制。

原生结构中可见：

- body 上可能有 style="--sidebar-width: 314px;"
- #stage-slideover-sidebar 使用 width: var(--sidebar-width)
- 展开历史区域使用 w-(--sidebar-width)

因此，自定义宽度应只改 --sidebar-width。

不要直接修改：

- #stage-slideover-sidebar.style.width
- minWidth
- maxWidth
- flexBasis
- nav / aside / 外层 flex 容器宽度

否则会破坏 ChatGPT 官方侧边栏折叠逻辑，表现为：
“内容收起来了，但左侧外壳还占宽度，主对话区没有扩展”。

正确逻辑：

1. 只通过样式规则覆盖 --sidebar-width。
2. 当官方侧边栏展开时，应用用户设置的宽度。
3. 当官方侧边栏收起时，撤销脚本宽度覆盖，让 ChatGPT 官方 tiny-bar / collapsed 布局接管。
4. 点击官方收起 / 展开按钮后，用低频延迟检查同步：约 80ms、220ms、500ms、900ms。
5. 不要高频监听布局变化。
6. 旧版遗留的 documentElement 或 #stage-slideover-sidebar 上的 --sidebar-width inline override 应清理。

设置页中的滑块逻辑：

- 拖动滑块时，只更新右侧 px 文本。
- 松开鼠标 / change / pointerup 时，才应用侧边栏宽度。
- 保存时持久化设置。
- 取消时恢复打开设置前的宽度预览。

--------------------------------------------------------------------------------
十、WebDAV 同步设计
--------------------------------------------------------------------------------

WebDAV 设置中只填写“WebDAV 文件夹路径”，不填写具体 JSON 文件名。

用户可能填写：

https://example.com/dav/chatgpt-folders

脚本内部必须自动处理末尾斜杠，生成：

https://example.com/dav/chatgpt-folders/<account-file>.json

WebDAV 用不同远程 JSON 文件实现 ChatGPT 账号隔离。本地脚本不维护复杂多账号 profile；本地只保存当前使用数据。

当前推荐的远程文件名规则：

邮箱安全化 + "-" + ChatGPT account.id 前 8 位 + ".json"

例如：

pd25520@uga.edu + 5a54db9a-3236-461a-85c3-f1fbb9d03231
→ pd25520_at_uga_edu-5a54db9a.json

账号信息读取优先级：

1. 从 script#client-bootstrap 的 JSON 中读取：
   - session.user.email
   - user.email
   - session.account.id
2. 如果 client-bootstrap 解析失败，可从页面文本 / 账号区域尝试匹配邮箱。
3. 如果仍失败，回退到旧的 acct_xxxxxxxx.json hash 文件名。

安全注意：

- 只读取 email、name、account.id 等必要字段。
- 不要读取、保存、导出、诊断输出 accessToken / sessionToken。
- WebDAV 用户名、密码、应用密码只保存在 Tampermonkey 本地。
- WebDAV JSON 中不要保存 WebDAV 密码。
- 导出 JSON 中也不要包含 WebDAV 密码。

WebDAV 文件不存在时：

1. GET 当前账号 JSON。
2. 200：读取。
3. 404：自动创建父目录，必要时 MKCOL 逐级创建，然后 PUT 初始 JSON。
4. 401 / 403：提示认证失败或无权限。
5. 409：通常父目录不存在，尝试创建目录后再 PUT。

同步状态图标：

工具栏中在设置按钮左边有一个 WebDAV 状态圆点，建议与上传 / 下载 / 设置按钮同尺寸点击区域。

状态含义：

- 灰色：未启用 / 未配置
- 绿色：已同步
- 橙色：本地有改动等待同步
- 蓝色旋转：正在同步
- 红色：同步失败

WebDAV 操作应异步执行：

- 测试连接
- 立即推送
- 立即拉取

这些按钮不应关闭设置弹窗，也不应阻塞 UI。操作过程中只更新按钮 loading 状态和同步圆点。

--------------------------------------------------------------------------------
十一、远程 JSON 数据结构建议
--------------------------------------------------------------------------------

当前导出 / WebDAV payload 以 exportPayload(profile) 为准，通常包含 app、version、exportedAt、account、profile 等字段。profile 内保存 folders、conversations、settings。

建议结构示意：

{
  "app": "ChatGPT文件夹",
  "version": "0.3.x",
  "exportedAt": "2026-xx-xxTxx:xx:xx.xxxZ",
  "account": {
    "id": "acct_xxxxxxxx",
    "label": "pd25520@uga.edu"
  },
  "profile": {
    "id": "local_current",
    "label": "pd25520@uga.edu",
    "folders": {
      "root": {
        "id": "root",
        "name": "root",
        "parentId": "",
        "childFolderIds": ["fld_xxx"],
        "chatIds": [],
        "color": "#6b7280",
        "collapsed": false
      },
      "fld_xxx": {
        "id": "fld_xxx",
        "name": "论文",
        "parentId": "root",
        "childFolderIds": [],
        "chatIds": ["conversation-id"],
        "color": "#444444",
        "collapsed": false
      }
    },
    "conversations": {
      "conversation-id": {
        "id": "conversation-id",
        "title": "聊天标题",
        "url": "/c/conversation-id",
        "folderId": "fld_xxx",
        "addedAt": "2026-xx-xxTxx:xx:xx.xxxZ",
        "updatedAt": "2026-xx-xxTxx:xx:xx.xxxZ"
      }
    },
    "settings": {
      "ui": {
        "sectionCollapsed": false,
        "sidebarWidthEnabled": true,
        "sidebarWidthPx": 312
      },
      "webdav": {
        "enabled": true,
        "url": "https://example.com/dav/chatgpt-folders/",
        "username": "",
        "password": "",
        "debounceMs": 12000,
        "intervalMs": 900000
      }
    }
  }
}

可同步的设置：

- sidebarWidthEnabled
- sidebarWidthPx
- 文件夹折叠状态
- 文件夹颜色
- UI 非敏感偏好
- WebDAV 自动备份开关和延迟等非敏感设置

不要同步：

- WebDAV password
- WebDAV username 如不必要也不要放远程
- accessToken
- sessionToken
- cookies
- ChatGPT 完整聊天内容

当前代码在 exportPayload 中应清空 settings.webdav.username 和 settings.webdav.password，避免远程 JSON 或导出 JSON 泄露凭据。

--------------------------------------------------------------------------------
十二、设置弹窗
--------------------------------------------------------------------------------

设置弹窗应复用 DOM，不要每次打开都重建。

打开设置：

- 只填充当前本地配置。
- 不自动测试 WebDAV。
- 不自动拉取远程。
- 不做诊断。
- 不重绘文件夹树。

保存：

- 读取表单。
- 更新内存 settings。
- 必要时应用 sidebar width。
- 延迟保存本地。
- 标记 WebDAV dirty，但不立即上传。
- 关闭弹窗。

取消：

- 恢复临时宽度预览。
- 关闭弹窗。
- 不保存。
- 不重绘。
- 不标记 WebDAV dirty。

点击空白遮罩：

- 等同取消。
- 不执行保存逻辑。

WebDAV 按钮：

- “测试连接”：异步检查文件夹 / 当前账号 JSON 文件。
- “立即推送”：异步 PUT 当前数据。
- “立即拉取”：异步 GET 远程数据并确认后合并或替换当前数据。
- 操作中更新按钮文案和同步圆点，不关闭设置弹窗。

--------------------------------------------------------------------------------
十三、文件夹标题和顶部工具栏
--------------------------------------------------------------------------------

文件夹区域标题为：

文件夹

要求：
- “文件夹”三个字顶格显示。
- 标题前的三角箭头隐藏。
- 点击“文件夹”这三个字仍然可以折叠 / 展开整个文件夹区域。
- 顶部标题行同时作为“移动到根目录”的 drop target：把子文件夹拖到该行即可放回根目录。
- 顶部右侧保留工具按钮，例如：
  - 导出 JSON
  - 导入 JSON
  - WebDAV 状态圆点
  - 设置
  - 新建文件夹

WebDAV 状态圆点应放在设置按钮左侧，并与其他工具按钮视觉尺寸一致。

--------------------------------------------------------------------------------
十四、文件夹菜单
--------------------------------------------------------------------------------

每个文件夹右侧始终显示三个点按钮。

点击后弹出菜单：

- 新建子文件夹
- 重命名
- 设置颜色
- 删除文件夹

命名建议使用更专业的词：

- “重命名” 不要叫“改名”
- “设置颜色” 不要叫“改色”

颜色菜单：

- 弹窗左上角应与当前菜单左上角对齐。
- 最后一个颜色为“自定义”。
- 点击自定义后，在同位置显示 hex 输入框。
- 删除确认弹窗也尽量与当前菜单左上角对齐。

新建文件夹：

- 不使用浏览器 prompt。
- 直接新增文件夹，并使名称进入编辑状态。
- 用户确认后保存；空名则回退默认名或取消创建。
- 同级文件夹创建 / 重命名后使用 Intl.Collator 排序。

--------------------------------------------------------------------------------
十五、聊天链接点击
--------------------------------------------------------------------------------

文件夹中的聊天链接只是引用 ChatGPT conversation。

点击文件夹中的聊天时，优先复用 ChatGPT 原生同 conversation 链接的 click 行为，让 ChatGPT 自己处理 SPA 路由。

流程建议：

1. preventDefault。
2. 查找页面中原生 a[href="/c/<id>"]。
3. 找到则触发原生链接 click。
4. 找不到再 fallback 到普通 location.assign('/c/<id>')。
5. 不再强行 history.pushState。

原因：

ChatGPT 的 SPA 路由状态不只是 URL，强行 pushState 可能导致页面状态不一致。

--------------------------------------------------------------------------------
十六、导入 / 导出
--------------------------------------------------------------------------------

导出 JSON 应包含：

- folders
- conversations / chats 引用
- 非敏感 settings
- version / exportedAt / updatedAt
- account 的非敏感信息

导出 JSON 不应包含：

- WebDAV 密码
- accessToken
- sessionToken
- cookies
- 完整聊天内容

导入时：

- 校验 JSON 基本结构。
- 对文件夹 id / chat id 做基本兼容。
- 导入后按 Intl.Collator 排序同级文件夹。
- 导入后重绘文件夹树。
- 保留当前本地 WebDAV 配置，尤其是 url / username / password。
- 标记本地 dirty。
- 不立即 WebDAV 上传，等待延迟自动备份或手动推送。

--------------------------------------------------------------------------------
十七、本地存储
--------------------------------------------------------------------------------

当前设计为“本地单一当前数据”，不做复杂多账号本地 profile。

原因：

- 简化代码。
- 降低账号识别时序问题。
- 账号隔离交给 WebDAV 远程文件名完成。

本地可保存：

- 当前文件夹数据
- 当前 settings
- WebDAV 文件夹路径
- WebDAV 用户名
- WebDAV 密码
- 上一次识别到的 email / accountId / accountFile
- 同步状态与上次同步时间

注意：

- 本地保存使用 debounce。
- 设置数据和文件夹大数据尽量分开保存。
- 轻 UI 状态，如折叠 / 展开，可延迟保存。
- 折叠 / 展开不应触发 WebDAV dirty。

--------------------------------------------------------------------------------
十八、代码维护建议
--------------------------------------------------------------------------------

脚本虽然是单文件，但建议内部按模块分区：

1. 常量、工具函数和 Tampermonkey 存储 wrapper
2. 状态、迁移和数据规范化
3. 账号识别与 WebDAV 文件名
4. UI 样式和图标
5. 侧边栏挂载与文件夹树渲染
6. 文件夹菜单、重命名、颜色、删除
7. Firefox 原生聊天拖拽
8. 文件夹拖拽移动
9. 最近对话三点菜单“移至文件夹”注入
10. 导入 / 导出
11. WebDAV 同步
12. 设置弹窗
13. 侧边栏宽度和可见性同步
14. 稀疏有限重挂载、休眠恢复自愈与 boot

尽量保持：

- 单一数据源：内存 state。
- UI 更新分局部更新和全量 render。
- 全量 render 只在初始化、导入、拉取远程、重大结构变化、文件夹移动时使用。
- 轻交互走局部 DOM 更新。
- 所有 timer 有明确用途，不重复创建。
- 所有全局 listener 只注册一次。
- 临时 observer 必须有 disconnect / timeout。

--------------------------------------------------------------------------------
十九、已知敏感点
--------------------------------------------------------------------------------

以下改动容易重新引入 bug 或卡顿：

1. 给最近列表注入常驻图标。
2. 监听 mousemove。
3. 使用 MutationObserver 长期监听 document.body 或整个 sidebar。
4. 在 hover 最近聊天时执行脚本逻辑。
5. 强行改 nav / aside / flex 容器宽度。
6. 强行 pushState。
7. 在取消设置时保存。
8. 在折叠 / 展开文件夹时全树重绘。
9. 在拖入聊天后立即 WebDAV 上传。
10. 在诊断信息里输出 token、cookie、完整 client-bootstrap。
11. 让“移至文件夹”菜单项依赖 ChatGPT React/Radix 内部状态。
12. 长期保留 nativeMenuObserver 或 nativeMenuPollTimer。
13. 把文件夹拖动允许到自身子孙节点，导致循环引用。
14. 多标签页同步回调里无条件重绘或无条件保存，导致卡顿或旧状态覆盖新状态。

--------------------------------------------------------------------------------
二十、当前期望行为总览
--------------------------------------------------------------------------------
- ChatGPT 官方侧边栏展开：显示脚本“文件夹”区域。
- ChatGPT 官方侧边栏收起：文件夹区域随之隐藏，并释放左侧宽度，不占空白外壳。
- 自定义侧边栏宽度：只在官方侧边栏展开时生效。
- 拖动最近聊天到脚本文件夹：添加链接引用。
- 拖动最近聊天到官方 Project：尽量不受脚本影响。
- 拖动脚本文件夹到另一个脚本文件夹：变成子文件夹。
- 拖动子文件夹到顶部“文件夹”标题行：移动回根目录。
- 最近对话三点菜单中显示“移至文件夹”。
- 悬停“移至文件夹”后显示脚本自己的多级文件夹菜单。
- 点击目标文件夹后，把该最近聊天加入脚本文件夹。
- 文件夹内聊天点击：优先走 ChatGPT 原生 SPA 点击。
- WebDAV：只填文件夹路径，脚本自动生成账号 JSON 文件名。
- 账号文件名：邮箱安全化 + accountId 前 8 位，例如 pd25520_at_uga_edu-5a54db9a.json。
- 本地不做复杂多账号 profile。
- WebDAV 远程文件负责账号隔离。
- 脚本不保存完整聊天内容。
- 脚本不修改 ChatGPT 后端。
- 通过最长约 90 秒的稀疏有限重试，降低书签打开 ChatGPT 首页时偶发未挂载的概率。
- 同一 Firefox 多个 ChatGPT 标签页之间通过小 revision key 自动同步文件夹状态，并用 revision 防止旧标签页覆盖新状态。
- Windows / Firefox 休眠恢复后，通过 focus、pageshow、visibilitychange 触发短窗口自愈检查，修复文件夹 DOM 被 React 重绘移除或误隐藏的问题。
- v0.3.14 起取消普通 pointerdown 自愈，避免影响正文选区、输入框聚焦和最近列表 hover 流畅度。
- v0.3.15 起兼容 ChatGPT 最近列表中 draggable="false" 的 /c/ 对话：只在用户按下该具体对话时临时改为 draggable=true，dragend / mouseup / click / timeout 后恢复，不扫描、不注入、不监听 mousemove。
- v0.3.18 起文件夹灰色选中高亮仅保留在当前页面内存；刷新或重启后清除，不写入本地 / WebDAV，也不跨标签同步。
- 性能优先，避免高频监听和大规模 DOM 注入。

================================================================================
*/


(function () {
  'use strict';

  const APP = 'cgfm';
  const APP_NAME = 'ChatGPT文件夹';
  const VERSION = '0.3.18';
  const STORAGE_KEY = 'cgfm.v2.currentProfile';
  const REVISION_KEY = 'cgfm.v2.revision';
  const LEGACY_STORAGE_KEY = 'cgfm.v1.state';
  const LAST_ACCOUNT_KEY = 'cgfm.v1.lastAccount';
  const CURRENT_PROFILE_ID = 'local_current';
  const ROOT_ID = 'root';
  const DRAG_MIME = 'application/x-chatgpt-folder-manager';
  const DEFAULT_FOLDER_COLOR = '#6b7280';
  const DEFAULT_DEBOUNCE_MS = 12000;
  const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
  const DEFAULT_SIDEBAR_WIDTH_PX = 312;
  const MIN_SIDEBAR_WIDTH_PX = 240;
  const MAX_SIDEBAR_WIDTH_PX = 520;
  const FOLDER_SORT_LOCALE = undefined;
  const folderCollator = new Intl.Collator(FOLDER_SORT_LOCALE, { numeric: true, sensitivity: 'base' });
  const TAB_ID = 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  let state = null;
  let currentAccount = null;
  let selectedFolderId = ROOT_ID; // 仅当前页面使用，不持久化、不跨标签同步
  let rootEl = null;
  let treeEl = null;
  let sidebarEl = null;
  let mounted = false;
  let renderQueued = false;
  let pendingPersistTimer = null;
  let pendingPersistReason = '';
  let pendingWebdavTimer = null;
  let periodicWebdavTimer = null;
  let dirtySincePush = false;
  let editingFolderId = '';
  let editingNewFolderId = '';
  let editingOriginalName = '';
  let dragPayload = null;
  let pointerPayload = null;
  let dragStartPayload = null;
  let lastHoveredFolderId = '';
  let lastHoveredFolderAt = 0;
  let dropCommitted = false;
  let menuEl = null;
  let modalEl = null;
  let sidebarWidthStyleEl = null;
  let syncStatus = 'off';
  let settingsModalSnapshot = null;
  let settingsWidthPreviewApplied = false;
  let sidebarToggleBound = false;
  let nativeMenuChat = null;
  let nativeMenuTriggerId = '';
  let nativeMenuObserver = null;
  let nativeMenuObserveTimer = null;
  let nativeFolderSubmenus = [];
  let nativeMenuPollTimer = null;
  let resumeRecoveryTimers = [];
  let sidebarVisibilityTimers = [];
  let storageWriteSeq = 0;
  let lastSeenStorageRevision = '';
  let localUnsavedChanges = false;
  let storageSyncBound = false;
  let crossTabApplyTimer = null;
  let transientDragAnchor = null;
  let transientDragOriginalDraggable = null;
  let transientDragRestoreTimer = null;

  // ---------------------------------------------------------------------------
  // 1. Constants, small utilities and safe Tampermonkey storage wrappers
  // ---------------------------------------------------------------------------

  function nowIso() { return new Date().toISOString(); }
  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function cleanText(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function unique(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
  function safeError(err) { return err && (err.message || err.toString()) || String(err || 'Unknown error'); }
  function shortTime(iso) { try { return new Date(iso).toLocaleString(); } catch (_) { return String(iso || ''); } }
  function normalizeColor(color) { return /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? String(color) : DEFAULT_FOLDER_COLOR; }
  function cssEscape(value) { return window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

  function gmGet(key, fallback) {
    try {
      const value = GM_getValue(key, fallback);
      return value === undefined ? fallback : value;
    } catch (err) {
      console.warn(APP_NAME, 'GM_getValue failed', err);
      return fallback;
    }
  }

  function gmSet(key, value) {
    try { GM_setValue(key, value); }
    catch (err) { console.warn(APP_NAME, 'GM_setValue failed', err); }
  }

  // ---------------------------------------------------------------------------
  // 2. State, migration and folder data normalization
  // ---------------------------------------------------------------------------

  function makeEmptyState(label) {
    return makeProfile(CURRENT_PROFILE_ID, label || 'ChatGPT account');
  }

  function makeProfile(id, label) {
    const t = nowIso();
    return {
      id,
      label: label || 'ChatGPT account',
      createdAt: t,
      updatedAt: t,
      folders: {
        [ROOT_ID]: { id: ROOT_ID, name: 'root', parentId: '', childFolderIds: [], chatIds: [], color: DEFAULT_FOLDER_COLOR, collapsed: false, createdAt: t, updatedAt: t }
      },
      conversations: {},
      settings: {
        ui: { sectionCollapsed: false, sidebarWidthEnabled: false, sidebarWidthPx: DEFAULT_SIDEBAR_WIDTH_PX },
        webdav: { enabled: false, url: '', username: '', password: '', debounceMs: DEFAULT_DEBOUNCE_MS, intervalMs: DEFAULT_INTERVAL_MS, lastPushAt: '', lastPullAt: '', lastStatus: '', lastError: '' }
      }
    };
  }

  function loadState() {
    const direct = gmGet(STORAGE_KEY, '');
    if (direct) {
      try {
        const parsed = typeof direct === 'string' ? JSON.parse(direct) : direct;
        return normalizeLoadedProfile(parsed, 'ChatGPT account');
      } catch (err) {
        console.warn(APP_NAME, 'failed to parse current profile; trying legacy state', err);
      }
    }

    // One-time compatibility migration from v0.2.x and earlier, which stored a profiles wrapper.
    const legacy = gmGet(LEGACY_STORAGE_KEY, '');
    if (legacy) {
      try {
        const parsed = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
        const info = getCurrentAccountInfo() || readLastAccountInfo();
        const migrated = chooseMigrationProfile(parsed, info) || (parsed && (parsed.profile || parsed));
        return normalizeLoadedProfile(migrated, info && info.label);
      } catch (err) {
        console.warn(APP_NAME, 'failed to migrate legacy state; starting empty', err);
      }
    }

    return makeEmptyState();
  }

  function normalizeLoadedProfile(data, label) {
    const profile = data && data.profile ? data.profile : data;
    if (profile && profile.folders && profile.conversations) return normalizeProfile(profile, CURRENT_PROFILE_ID, label || profile.label);
    return makeEmptyState(label);
  }

  function normalizeProfile(profile, id, label) {
    const p = profile && typeof profile === 'object' ? profile : makeProfile(id, label);
    p.id = id || p.id || 'default';
    p.label = label || p.label || 'ChatGPT account';
    p.createdAt = p.createdAt || nowIso();
    p.updatedAt = p.updatedAt || p.createdAt;
    p.folders = p.folders && typeof p.folders === 'object' ? p.folders : {};
    p.conversations = p.conversations && typeof p.conversations === 'object' ? p.conversations : {};
    p.settings = p.settings && typeof p.settings === 'object' ? p.settings : {};
    delete p.selectedFolderId; // 兼容旧数据：选中高亮不再属于持久化 profile。
    p.settings.ui = Object.assign({ sectionCollapsed: false, sidebarWidthEnabled: false, sidebarWidthPx: DEFAULT_SIDEBAR_WIDTH_PX }, p.settings.ui || {});
    p.settings.webdav = Object.assign({ enabled: false, url: '', username: '', password: '', debounceMs: DEFAULT_DEBOUNCE_MS, intervalMs: DEFAULT_INTERVAL_MS, lastPushAt: '', lastPullAt: '', lastStatus: '', lastError: '' }, p.settings.webdav || {});
    if (!p.folders[ROOT_ID]) p.folders[ROOT_ID] = { id: ROOT_ID, name: 'root', parentId: '', childFolderIds: [], chatIds: [], color: DEFAULT_FOLDER_COLOR, collapsed: false, createdAt: nowIso(), updatedAt: nowIso() };

    for (const fid of Object.keys(p.folders)) {
      const f = p.folders[fid] || {};
      f.id = fid;
      f.name = fid === ROOT_ID ? 'root' : String(f.name || '新建文件夹');
      f.parentId = fid === ROOT_ID ? '' : (p.folders[f.parentId] ? f.parentId : ROOT_ID);
      f.childFolderIds = unique(Array.isArray(f.childFolderIds) ? f.childFolderIds : []);
      f.chatIds = unique(Array.isArray(f.chatIds) ? f.chatIds : []);
      f.color = normalizeColor(f.color || DEFAULT_FOLDER_COLOR);
      f.collapsed = !!f.collapsed;
      f.createdAt = f.createdAt || nowIso();
      f.updatedAt = f.updatedAt || f.createdAt;
      p.folders[fid] = f;
    }

    for (const fid of Object.keys(p.folders)) {
      if (fid === ROOT_ID) continue;
      const f = p.folders[fid];
      const parent = p.folders[f.parentId] || p.folders[ROOT_ID];
      if (!parent.childFolderIds.includes(fid)) parent.childFolderIds.push(fid);
    }

    const seenChat = new Set();
    for (const cid of Object.keys(p.conversations)) {
      const c = p.conversations[cid] || {};
      c.id = cid;
      c.title = String(c.title || 'Untitled chat');
      c.url = normalizeStoredUrl(c.url || ('/c/' + cid));
      c.folderId = p.folders[c.folderId] ? c.folderId : ROOT_ID;
      c.addedAt = c.addedAt || nowIso();
      c.updatedAt = c.updatedAt || c.addedAt;
      p.conversations[cid] = c;
    }
    for (const fid of Object.keys(p.folders)) {
      const f = p.folders[fid];
      f.childFolderIds = unique(f.childFolderIds).filter(child => child !== fid && p.folders[child] && p.folders[child].parentId === fid);
      f.chatIds = unique(f.chatIds).filter(cid => p.conversations[cid] && !seenChat.has(cid));
      for (const cid of f.chatIds) {
        p.conversations[cid].folderId = fid;
        seenChat.add(cid);
      }
    }
    for (const cid of Object.keys(p.conversations)) {
      if (!seenChat.has(cid)) {
        const fid = p.conversations[cid].folderId || ROOT_ID;
        (p.folders[fid] || p.folders[ROOT_ID]).chatIds.push(cid);
        seenChat.add(cid);
      }
    }
    sortAllFolders(p);
    return p;
  }

  function sortFolderChildren(p, parentId) {
    const parent = p.folders[parentId];
    if (!parent) return;
    parent.childFolderIds = unique(parent.childFolderIds).filter(fid => p.folders[fid]).sort((a, b) => {
      const fa = p.folders[a];
      const fb = p.folders[b];
      return folderCollator.compare(fa.name || '', fb.name || '');
    });
  }

  function sortAllFolders(p) {
    for (const fid of Object.keys(p.folders || {})) sortFolderChildren(p, fid);
  }

  function makeStorageRevision() {
    storageWriteSeq += 1;
    return Date.now() + ':' + TAB_ID + ':' + storageWriteSeq;
  }

  function getProfileStorageMeta(profile) {
    return profile && profile.__cgfm && typeof profile.__cgfm === 'object' ? profile.__cgfm : {};
  }

  function getProfileStorageRevision(profile) {
    return String(getProfileStorageMeta(profile).storageRevision || '');
  }

  function getProfileStorageWriter(profile) {
    return String(getProfileStorageMeta(profile).writerTabId || '');
  }

  function revisionTime(revision) {
    const n = Number(String(revision || '').split(':')[0]);
    return Number.isFinite(n) ? n : 0;
  }

  function isRevisionNewer(candidate, base) {
    if (!candidate) return false;
    if (!base) return true;
    const ca = revisionTime(candidate);
    const ba = revisionTime(base);
    if (ca !== ba) return ca > ba;
    return String(candidate) > String(base);
  }

  function parseStoredProfileRaw(raw) {
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed && (parsed.profile || parsed);
    } catch (_) {
      return null;
    }
  }

  function markStorageRevision(profile, revision) {
    if (!profile || typeof profile !== 'object') return revision || '';
    const rev = revision || makeStorageRevision();
    profile.__cgfm = Object.assign({}, profile.__cgfm || {}, {
      storageRevision: rev,
      writerTabId: TAB_ID,
      writtenAt: nowIso()
    });
    return rev;
  }

  function parseRevisionMeta(raw) {
    if (!raw) return { revision: '', writer: '', writtenAt: '' };
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!obj || typeof obj !== 'object') return { revision: '', writer: '', writtenAt: '' };
      return {
        revision: String(obj.revision || obj.storageRevision || ''),
        writer: String(obj.writerTabId || obj.writer || ''),
        writtenAt: String(obj.writtenAt || '')
      };
    } catch (_) {
      return { revision: '', writer: '', writtenAt: '' };
    }
  }

  function writeRevisionMeta(revision) {
    const meta = { revision: String(revision || ''), writerTabId: TAB_ID, writtenAt: nowIso() };
    gmSet(REVISION_KEY, JSON.stringify(meta));
    return meta;
  }

  function currentStorageRevisionInfo() {
    const meta = parseRevisionMeta(gmGet(REVISION_KEY, ''));
    if (meta.revision) return meta;

    // Backward-compatible fallback for profiles written by v0.3.13 or earlier.
    // This reads the large profile only when the small revision key is missing.
    const stored = parseStoredProfileRaw(gmGet(STORAGE_KEY, ''));
    if (!stored) return { revision: '', writer: '', writtenAt: '' };
    return { revision: getProfileStorageRevision(stored), writer: getProfileStorageWriter(stored), writtenAt: '' };
  }

  function currentStoredProfileInfo() {
    const stored = parseStoredProfileRaw(gmGet(STORAGE_KEY, ''));
    if (!stored) return { profile: null, revision: '', writer: '' };
    return { profile: stored, revision: getProfileStorageRevision(stored), writer: getProfileStorageWriter(stored) };
  }

  function applyStoredProfileFromRaw(raw, reason) {
    const incoming = parseStoredProfileRaw(raw);
    if (!incoming || !incoming.folders || !incoming.conversations) return false;
    const rev = getProfileStorageRevision(incoming);
    if (rev && !isRevisionNewer(rev, lastSeenStorageRevision)) return false;

    const oldWebdav = state && state.settings && state.settings.webdav ? JSON.parse(JSON.stringify(state.settings.webdav)) : null;
    const normalized = normalizeProfile(incoming, CURRENT_PROFILE_ID, incoming.label || (state && state.label) || 'ChatGPT account');
    if (oldWebdav && normalized.settings && normalized.settings.webdav) {
      // WebDAV credentials are local-only. Do not replace this tab's credentials with
      // the sanitized username/password from another tab or an exported payload.
      normalized.settings.webdav.username = oldWebdav.username || normalized.settings.webdav.username || '';
      normalized.settings.webdav.password = oldWebdav.password || normalized.settings.webdav.password || '';
    }

    state = normalized;
    if (!state.folders[selectedFolderId]) selectedFolderId = ROOT_ID;
    lastSeenStorageRevision = getProfileStorageRevision(state) || rev || lastSeenStorageRevision;
    localUnsavedChanges = false;
    if (pendingPersistTimer) {
      clearTimeout(pendingPersistTimer);
      pendingPersistTimer = null;
    }
    pendingPersistReason = '';
    queueRender();
    applySidebarWidth();
    restartPeriodicBackup();
    updateSyncStatusIcon();
    if (reason === 'external-change') toast('已同步另一个标签页的文件夹更新。');
    return true;
  }

  function maybeApplyNewerStoredProfile(reason) {
    const stored = currentStorageRevisionInfo();
    if (!stored.revision || stored.writer === TAB_ID || !isRevisionNewer(stored.revision, lastSeenStorageRevision)) return false;
    if (localUnsavedChanges || editingFolderId || (modalEl && !modalEl.hidden)) {
      // Do not overwrite active local editing. persistNow() also checks revision before writing,
      // so this tab will not erase the newer stored state by accident.
      if (reason === 'external-change') toast('另一个标签页有文件夹更新；完成当前编辑后会同步。');
      return false;
    }
    return applyStoredProfileFromRaw(gmGet(STORAGE_KEY, ''), reason || 'newer-storage');
  }

  function flushPendingPersist(webdav) {
    if (pendingPersistTimer || localUnsavedChanges) persistNow({ webdav: !!webdav });
  }

  function schedulePersist(reason, opts) {
    const options = Object.assign({ webdav: true, touch: true }, opts || {});
    const p = getProfile();
    if (options.touch) {
      p.updatedAt = nowIso();

    }
    localUnsavedChanges = true;
    pendingPersistReason = reason || pendingPersistReason || 'change';
    if (options.webdav) {
      dirtySincePush = true;
      updateSyncStatusIcon();
    }
    if (pendingPersistTimer) clearTimeout(pendingPersistTimer);
    pendingPersistTimer = setTimeout(() => persistNow({ webdav: options.webdav }), 850);
  }

  function persistNow(opts) {
    const options = Object.assign({ webdav: true }, opts || {});
    if (pendingPersistTimer) {
      clearTimeout(pendingPersistTimer);
      pendingPersistTimer = null;
    }

    const stored = currentStorageRevisionInfo();
    if (stored.revision && stored.writer !== TAB_ID && isRevisionNewer(stored.revision, lastSeenStorageRevision)) {
      // A newer state was written by another tab. Do not overwrite it with a stale
      // in-memory copy from this tab. In the normal single-editor workflow, adopting
      // the newer state is safer than keeping an old pending save alive.
      applyStoredProfileFromRaw(gmGet(STORAGE_KEY, ''), 'newer-before-write');
      localUnsavedChanges = false;
      updateSyncStatusIcon();
      return;
    }

    state.version = VERSION;
    const revision = markStorageRevision(state);
    lastSeenStorageRevision = revision;
    gmSet(STORAGE_KEY, JSON.stringify(state));
    writeRevisionMeta(revision);
    localUnsavedChanges = false;
    if (options.webdav) scheduleAutoBackup(pendingPersistReason || 'change');
    else updateSyncStatusIcon();
    pendingPersistReason = '';
  }

  // ---------------------------------------------------------------------------
  // 3. ChatGPT account detection; used only for WebDAV remote filename isolation
  // ---------------------------------------------------------------------------

  function getCurrentAccountInfo() {
    const boot = getBootstrapAccountInfo();
    if (boot && boot.id) return boot;

    const buttons = Array.from(document.querySelectorAll('[data-testid="accounts-profile-button"]'));
    if (!buttons.length) return null;
    let best = null;
    for (const btn of buttons) {
      const rawText = cleanText(btn.textContent || '');
      const aria = cleanAccountLabel(btn.getAttribute('aria-label') || '');
      const img = btn.querySelector('img') ? String(btn.querySelector('img').src || '').split('?')[0] : '';
      const labelSource = rawText.length >= 3 ? rawText : aria;
      if (!labelSource && !img) continue;
      const label = (labelSource || 'ChatGPT account').slice(0, 100);
      const score = (labelSource ? labelSource.length : 0) + (img ? 20 : 0) + (rawText ? 10 : 0);
      if (!best || score > best.score) best = { label, img, score };
    }
    if (!best) return null;
    const raw = location.host + '|' + best.label + '|' + best.img;
    return { id: 'acct_' + fnv1a(raw), label: best.label, email: '', accountId: '' };
  }

  function getBootstrapAccountInfo() {
    try {
      const script = document.getElementById('client-bootstrap');
      if (!script || !script.textContent) return null;
      const data = JSON.parse(script.textContent);
      const user = (data.session && data.session.user) || data.user || {};
      const account = (data.session && data.session.account) || data.account || {};
      const email = cleanText(user.email || '');
      const name = cleanText(user.name || '');
      const accountId = cleanText(account.id || '');
      if (!email && !accountId && !name) return null;
      const label = email || name || 'ChatGPT account';
      const idSource = email || name || accountId || 'ChatGPT account';
      return {
        id: 'acct_' + fnv1a(location.host + '|' + idSource + '|' + accountId),
        label,
        email,
        accountId
      };
    } catch (_) {
      return null;
    }
  }

  function cleanAccountLabel(text) {
    return cleanText(text)
      .replace(/open.*profile.*menu/ig, '')
      .replace(/打开.*个人资料.*菜单/ig, '')
      .replace(/profile menu/ig, '')
      .replace(/personal profile/ig, '')
      .replace(/，?\s*打开.*$/ig, '')
      .replace(/,?\s*open.*$/ig, '')
      .replace(/\s+/g, ' ')
      .trim() || '';
  }

  function readLastAccountInfo() {
    try {
      const raw = gmGet(LAST_ACCOUNT_KEY, '');
      const info = raw ? JSON.parse(raw) : null;
      return info && info.id ? info : null;
    } catch (_) { return null; }
  }

  function rememberAccountInfo(info) {
    if (!info || !info.id) return;
    try { gmSet(LAST_ACCOUNT_KEY, JSON.stringify({ id: info.id, label: info.label || 'ChatGPT account', email: info.email || '', accountId: info.accountId || '' })); } catch (_) {}
  }

  function chooseMigrationProfile(wrapper, info) {
    const profiles = wrapper && wrapper.profiles;
    if (!profiles) return null;
    if (wrapper.activeProfileId && profiles[wrapper.activeProfileId]) return profiles[wrapper.activeProfileId];
    if (info && info.id && profiles[info.id]) return profiles[info.id];
    if (profiles[CURRENT_PROFILE_ID]) return profiles[CURRENT_PROFILE_ID];
    const ids = Object.keys(profiles).filter(id => profiles[id]);
    return ids.length ? profiles[ids[0]] : null;
  }

  function ensureActiveProfile() {
    if (!state) state = loadState();
    const detected = getCurrentAccountInfo();
    const info = detected || currentAccount || readLastAccountInfo() || { id: 'acct_default', label: 'ChatGPT account' };
    currentAccount = info;
    if (detected) rememberAccountInfo(detected);

    // v0.3.x: local storage keeps one current profile. ChatGPT account identity is only
    // used to generate the remote WebDAV JSON filename.
    state = normalizeProfile(state, CURRENT_PROFILE_ID, info.label || (state && state.label) || 'ChatGPT account');
    state.id = CURRENT_PROFILE_ID;
    state.label = info.label || state.label || 'ChatGPT account';
    return state;
  }

  function getProfile() {
    if (!state) return ensureActiveProfile();
    return state;
  }

  // ---------------------------------------------------------------------------
  // 4. UI styles and icons
  // ---------------------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById('cgfm-style')) return;
    const style = document.createElement('style');
    style.id = 'cgfm-style';
    style.textContent = `
      #cgfm-root { color: var(--text-primary, var(--token-text-primary, inherit)); font-size:14px; margin-bottom:12px; --cgfm-muted: var(--text-secondary, var(--token-text-tertiary, #6b7280)); --cgfm-text: var(--text-primary, var(--token-text-primary, #111827)); --cgfm-hover: var(--sidebar-surface-secondary, rgba(128,128,128,.12)); --cgfm-active: var(--sidebar-surface-secondary, rgba(128,128,128,.18)); --cgfm-danger:#ef4444; contain: layout paint style; }
      #cgfm-root * { box-sizing:border-box; }
      #cgfm-root button { font:inherit; }
      #cgfm-root .cgfm-header { display:flex; align-items:center; min-height:32px; padding:7px 10px 4px 16px; gap:6px; color:var(--cgfm-text); }
      #cgfm-root .cgfm-header.cgfm-root-drop { outline:1.5px solid #3b82f6; background:rgba(59,130,246,.10); border-radius:10px; }
      #cgfm-root .cgfm-title { flex:1; display:flex; align-items:center; gap:0; border:0; background:transparent; color:inherit; font-weight:600; font-size:14px; padding:0; cursor:pointer; min-width:0; }
      #cgfm-root .cgfm-title-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #cgfm-root .cgfm-actions { display:flex; align-items:center; gap:4px; }
      #cgfm-root .cgfm-icon { border:0; background:transparent; color:var(--cgfm-muted); cursor:pointer; border-radius:8px; width:28px; height:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; opacity:1; }
      #cgfm-root .cgfm-icon:hover { background:var(--cgfm-hover); color:var(--cgfm-text); }
      #cgfm-root .cgfm-icon svg { width:18px; height:18px; stroke-width:2; display:block; }
      #cgfm-root .cgfm-sync-status { position:relative; }
      #cgfm-root .cgfm-sync-status::before { content:''; width:17px; height:17px; border-radius:999px; border:2px solid currentColor; display:block; }
      #cgfm-root .cgfm-sync-off { color:#9ca3af; opacity:.9; }
      #cgfm-root .cgfm-sync-idle { color:#16a34a; }
      #cgfm-root .cgfm-sync-dirty { color:#f59e0b; }
      #cgfm-root .cgfm-sync-error { color:#ef4444; }
      #cgfm-root .cgfm-sync-syncing { color:#2563eb; }
      #cgfm-root .cgfm-sync-syncing::before { border-top-color:transparent; animation:cgfm-spin .75s linear infinite; }
      @keyframes cgfm-spin { to { transform:rotate(360deg); } }
      #cgfm-root .cgfm-tree { max-height:min(48vh, 420px); overflow:auto; padding:2px 4px 6px 0; contain: content; }
      #cgfm-root .cgfm-folder-children[hidden] { display:none !important; }
      #cgfm-root .cgfm-empty { color:var(--cgfm-muted); padding:7px 12px 11px 16px; font-size:12px; line-height:1.45; }
      #cgfm-root .cgfm-folder-row, #cgfm-root .cgfm-chat-row { display:flex; align-items:center; min-height:32px; gap:4px; padding:2px 6px 2px calc(8px + var(--depth, 0) * 20px); border-radius:9px; margin:1px 8px; position:relative; color:var(--cgfm-text); }
      #cgfm-root .cgfm-folder-row:hover, #cgfm-root .cgfm-chat-row:hover { background:var(--cgfm-hover); }
      #cgfm-root .cgfm-folder-row[draggable="true"] { cursor:grab; }
      #cgfm-root .cgfm-folder-row.cgfm-dragging-folder { opacity:.55; cursor:grabbing; }
      #cgfm-root .cgfm-folder-row.cgfm-selected { background:var(--cgfm-active); }
      #cgfm-root .cgfm-caret { width:18px; min-width:18px; height:22px; border:0; padding:0; background:transparent; display:flex; align-items:center; justify-content:center; color:var(--cgfm-muted); border-radius:6px; cursor:pointer; }
      #cgfm-root .cgfm-caret:hover { background:rgba(128,128,128,.12); color:var(--cgfm-text); }
      #cgfm-root .cgfm-caret svg { width:17px; height:17px; stroke-width:2; transition:transform .12s ease; }
      #cgfm-root .cgfm-caret.cgfm-open svg { transform:rotate(90deg); }
      #cgfm-root .cgfm-spacer { width:18px; min-width:18px; }
      #cgfm-root .cgfm-folder-icon { width:20px; min-width:20px; height:20px; display:flex; align-items:center; justify-content:center; color:var(--folder-color); }
      #cgfm-root .cgfm-folder-icon svg { width:20px; height:20px; stroke-width:2; }
      #cgfm-root .cgfm-chat-icon { width:16px; min-width:16px; height:20px; display:flex; align-items:center; justify-content:center; color:var(--cgfm-muted); margin-right:1px; }
      #cgfm-root .cgfm-chat-icon svg { width:16px; height:16px; stroke-width:1.9; }
      #cgfm-root .cgfm-folder-name, #cgfm-root .cgfm-chat-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; line-height:20px; }
      #cgfm-root .cgfm-folder-name { cursor:pointer; font-weight:500; }
      #cgfm-root .cgfm-chat-title { color:inherit; text-decoration:none; }
      #cgfm-root .cgfm-folder-more { flex:0 0 auto; color:var(--cgfm-muted); }
      #cgfm-root .cgfm-row-actions { display:none; align-items:center; gap:1px; }
      #cgfm-root .cgfm-chat-row:hover .cgfm-row-actions { display:flex; }
      #cgfm-root .cgfm-row-actions .cgfm-icon { width:24px; height:24px; }
      #cgfm-root .cgfm-row-actions .cgfm-icon svg { width:16px; height:16px; }
      #cgfm-root .cgfm-folder-name-input { flex:1; min-width:0; height:26px; border-radius:7px; border:1px solid rgba(128,128,128,.35); background:var(--main-surface-primary,#fff); color:var(--cgfm-text); padding:0 7px; font:inherit; }
      #cgfm-root .cgfm-folder-row.cgfm-drop-inside { outline:1.5px solid #3b82f6; background:rgba(59,130,246,.12); }
      .cgfm-menu, .cgfm-color-popover { position:fixed; z-index:2147483647; min-width:172px; padding:6px; border-radius:12px; background:var(--main-surface-primary,#fff); color:var(--text-primary,#111827); border:1px solid rgba(128,128,128,.25); box-shadow:0 12px 34px rgba(0,0,0,.22); font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
      .cgfm-menu-item { width:100%; display:flex; align-items:center; gap:9px; height:32px; border:0; background:transparent; color:inherit; border-radius:8px; padding:0 9px; cursor:pointer; text-align:left; }
      .cgfm-menu-item:hover { background:rgba(128,128,128,.12); }
      .cgfm-menu-item svg { width:16px; height:16px; stroke-width:2; }
      .cgfm-menu-item.cgfm-danger { color:var(--cgfm-danger,#ef4444); }
      .cgfm-color-popover { min-width:224px; padding:10px; display:grid; grid-template-columns:repeat(4,44px); gap:10px; }
      .cgfm-color-swatch { width:44px; height:44px; border:0; border-radius:10px; cursor:pointer; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
      .cgfm-color-custom { display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#fff,#eee); color:#111827; }
      .cgfm-color-custom svg { width:20px; height:20px; }
      .cgfm-confirm { min-width:220px; padding:10px; }
      .cgfm-confirm p { margin:0 0 10px; line-height:1.45; }
      .cgfm-confirm-actions { display:flex; justify-content:flex-end; gap:8px; }
      .cgfm-confirm-actions button { border:0; border-radius:8px; height:30px; padding:0 10px; cursor:pointer; }
      .cgfm-confirm-actions .cgfm-danger-btn { background:#ef4444; color:#fff; }
      .cgfm-modal-backdrop { position:fixed; inset:0; z-index:2147483646; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; }
      .cgfm-modal-backdrop[hidden] { display:none !important; }
      .cgfm-modal { width:min(620px,calc(100vw - 32px)); max-height:calc(100vh - 48px); overflow:auto; border-radius:14px; padding:18px; background:var(--main-surface-primary,#fff); color:var(--text-primary,#111827); box-shadow:0 18px 50px rgba(0,0,0,.28); font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
      .cgfm-modal h2 { font-size:16px; margin:0 0 12px; }
      .cgfm-modal label { display:block; margin:10px 0 4px; color:var(--text-secondary,#666); font-size:12px; }
      .cgfm-modal input[type="text"], .cgfm-modal input[type="password"], .cgfm-modal input[type="number"] { width:100%; height:34px; border-radius:8px; border:1px solid rgba(128,128,128,.32); background:var(--main-surface-primary,#fff); color:inherit; padding:0 9px; }
      .cgfm-modal-row { display:flex; align-items:center; gap:8px; margin:8px 0; }
      .cgfm-sidebar-width-grid { display:grid; grid-template-columns:1fr auto; align-items:center; gap:10px; }
      .cgfm-sidebar-width-badge { min-width:52px; text-align:right; color:var(--text-secondary,#666); font-variant-numeric:tabular-nums; }
      .cgfm-modal-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; margin-top:16px; }
      .cgfm-modal-actions button { height:34px; border-radius:9px; border:1px solid rgba(128,128,128,.25); padding:0 12px; cursor:pointer; background:transparent; color:inherit; }
      .cgfm-modal-actions .cgfm-primary-btn { background:#2563eb; border-color:#2563eb; color:#fff; }
      .cgfm-modal-actions .cgfm-cancel-btn { background:rgba(128,128,128,.12); }
      .cgfm-native-menu-item { user-select:none; }
      .cgfm-native-menu-item[data-cgfm-native-add] { cursor:default; width:100%; }
      .cgfm-native-menu-item[data-cgfm-native-add] > .cgfm-native-menu-leading { min-width:0; flex:1 1 auto; }
      .cgfm-native-menu-item .cgfm-native-menu-label { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cgfm-native-menu-item[data-cgfm-native-add] > svg { width:16px !important; height:16px !important; flex:0 0 16px !important; margin-inline-start:auto !important; transform:translateX(-12px) !important; }
      .cgfm-native-folder-menu { position:fixed; z-index:2147483647; min-width:210px; max-width:320px; max-height:min(70vh,520px); overflow:auto; padding:6px; border-radius:14px; background:var(--main-surface-primary,#fff); color:var(--text-primary,#111827); border:1px solid rgba(128,128,128,.22); box-shadow:0 12px 34px rgba(0,0,0,.22); font:14px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
      .cgfm-native-folder-item { width:100%; display:flex; align-items:center; gap:8px; min-height:34px; border:0; border-radius:9px; background:transparent; color:inherit; padding:0 8px; cursor:pointer; text-align:left; }
      .cgfm-native-folder-item:hover, .cgfm-native-folder-item.cgfm-open { background:rgba(128,128,128,.12); }
      .cgfm-native-folder-item svg { width:18px; height:18px; stroke-width:2; flex:0 0 auto; }
      .cgfm-native-folder-item .cgfm-native-folder-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .cgfm-native-folder-item .cgfm-native-folder-arrow { width:14px; height:14px; opacity:.72; }
      .cgfm-native-folder-empty { color:var(--text-secondary,#777); padding:8px 10px; white-space:nowrap; }
      .cgfm-toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); z-index:2147483647; background:rgba(17,24,39,.94); color:white; padding:8px 12px; border-radius:999px; font:13px/1.3 system-ui,sans-serif; box-shadow:0 10px 24px rgba(0,0,0,.25); max-width:70vw; }
    `;
    document.head.appendChild(style);
  }

  function icon(name) {
    const icons = {
      chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4.5 6.5A4.5 4.5 0 0 1 9 2h6a4.5 4.5 0 0 1 4.5 4.5v4A4.5 4.5 0 0 1 15 15H9l-4.5 4v-4.8A4.5 4.5 0 0 1 2 10.5v-4Z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>',
      settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.07A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 0 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.07A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 0 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.07A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.07A1.7 1.7 0 0 0 19.4 15Z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15V3m0 0 4 4m-4-4-4 4M5 19h14" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14 7 3 3" stroke-linecap="round"/></svg>',
      palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3a9 9 0 0 0 0 18h1.2a1.8 1.8 0 0 0 1.3-3 1.8 1.8 0 0 1 1.3-3H17a4 4 0 0 0 4-4 8 8 0 0 0-9-8Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="14" cy="7.5" r="1"/><circle cx="16.5" cy="10" r="1"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 12a8 8 0 0 1-14.9 4M4 12A8 8 0 0 1 18.9 8M19 4v4h-4M5 20v-4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/></svg>',
      custom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>'
    };
    return icons[name] || '';
  }

  // ---------------------------------------------------------------------------
  // 5. Mounting and folder tree rendering
  // ---------------------------------------------------------------------------

  function findHistorySection() {
    const history = document.getElementById('history');
    // In current ChatGPT markup, #history is inside the whole "最近" section.
    // Returning the section itself lets us insert our root as a sibling before Recent,
    // instead of mutating inside React's history list section.
    if (history) return (history.parentElement && history.parentElement !== document.body) ? history.parentElement : history;
    const firstChat = document.querySelector('a[href^="/c/"], a[href*="/c/"]');
    if (!firstChat) return null;
    let node = firstChat;
    for (let i = 0; i < 8 && node && node !== document.body; i++, node = node.parentElement) {
      if (node.tagName === 'DIV' && node.querySelectorAll && node.querySelectorAll('a[href*="/c/"]').length >= 2) return node;
    }
    return firstChat.parentElement;
  }

  function findSidebarParent() {
    const history = document.getElementById('history');
    if (history) return history.closest('nav[aria-label], nav, aside, [id*="sidebar"]') || history.parentElement;
    const nav = document.querySelector('#stage-slideover-sidebar nav, nav[aria-label*="Chat"], nav[aria-label*="历史"], nav[aria-label*="sidebar"], aside nav');
    if (nav) return nav;
    const link = document.querySelector('a[href^="/c/"], a[href*="/c/"]');
    return link ? (link.closest('nav, aside, [id*="sidebar"]') || link.parentElement) : null;
  }

  function mount() {
    injectStyle();
    ensureActiveProfile();
    applySidebarWidth();
    const recent = findHistorySection();
    const parent = (recent && recent.parentElement) || findSidebarParent();
    if (!parent) return false;
    sidebarEl = findSidebarParent() || parent;
    if (!rootEl) {
      rootEl = document.createElement('div');
      rootEl.id = 'cgfm-root';
      rootEl.setAttribute('data-cgfm-version', VERSION);
      bindRootEvents(rootEl);
    }
    if (!document.body.contains(rootEl) || rootEl.parentElement !== parent) {
      if (recent && recent.parentElement === parent) parent.insertBefore(rootEl, recent);
      else parent.appendChild(rootEl);
    }
    render();
    syncSidebarVisibility();
    setupNativeDragCache();
    setupNativeMenuHook();
    mounted = true;
    return true;
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!rootEl || !document.body.contains(rootEl)) mount();
      else render();
    });
  }

  function render() {
    if (!rootEl) return;
    const p = getProfile();
    const collapsed = !!p.settings.ui.sectionCollapsed;
    rootEl.innerHTML = `
      <div class="cgfm-header" data-root-drop="1">
        <button class="cgfm-title" data-action="toggle-section" title="折叠/展开文件夹">
          <span class="cgfm-title-text">文件夹</span>
        </button>
        <div class="cgfm-actions">
          <button class="cgfm-icon" data-action="export-json" title="导出 JSON">${icon('download')}</button>
          <button class="cgfm-icon" data-action="import-json" title="导入 JSON">${icon('upload')}</button>
          <button class="cgfm-icon cgfm-sync-status cgfm-sync-${computeSyncStatus()}" data-sync-status="1" data-action="sync-status" title="${escapeAttr(syncStatusTitle())}" aria-label="${escapeAttr(syncStatusTitle())}"></button>
          <button class="cgfm-icon" data-action="settings" title="设置">${icon('settings')}</button>
          <button class="cgfm-icon" data-action="new-folder" title="新建顶层文件夹">${icon('plus')}</button>
        </div>
      </div>
      ${collapsed ? '' : `<div class="cgfm-tree" data-folder-tree="1">${renderTree(p)}</div>`}
    `;
    treeEl = rootEl.querySelector('[data-folder-tree]');
    focusInlineFolderEditor();
  }

  function renderTree(p) {
    const root = p.folders[ROOT_ID];
    const parts = [];
    for (const fid of root.childFolderIds || []) parts.push(renderFolder(p, fid, 0));
    for (const cid of root.chatIds || []) parts.push(renderChat(p, cid, ROOT_ID, 0));
    return parts.length ? parts.join('') : '<div class="cgfm-empty">点击右上角 + 新建文件夹。直接把 ChatGPT 最近对话拖到文件夹。</div>';
  }

  function renderFolder(p, fid, depth) {
    const f = p.folders[fid];
    if (!f) return '';
    const selected = selectedFolderId === fid ? ' cgfm-selected' : '';
    const open = !f.collapsed;
    const isEditing = editingFolderId === fid;
    const nameHtml = isEditing
      ? `<input class="cgfm-folder-name-input" data-folder-edit-id="${escapeAttr(fid)}" value="${escapeAttr(f.name)}" spellcheck="false" autocomplete="off">`
      : `<span class="cgfm-folder-name" data-action="select-folder" data-folder-id="${escapeAttr(fid)}" title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span>`;
    const childHtml = [
      ...(f.childFolderIds || []).map(child => renderFolder(p, child, depth + 1)),
      ...(f.chatIds || []).map(cid => renderChat(p, cid, fid, depth))
    ].join('');
    return `
      <div class="cgfm-folder-block" data-folder-block="${escapeAttr(fid)}">
        <div class="cgfm-folder-row${selected}" data-folder-id="${escapeAttr(fid)}" data-depth="${depth}" draggable="${isEditing ? 'false' : 'true'}" style="--depth:${depth};--folder-color:${escapeAttr(normalizeColor(f.color))}">
          <button class="cgfm-caret ${open ? 'cgfm-open' : ''}" data-action="toggle-folder" data-folder-id="${escapeAttr(fid)}" title="折叠/展开">${icon('chevron')}</button>
          <span class="cgfm-folder-icon">${icon('folder')}</span>
          ${nameHtml}
          <button class="cgfm-icon cgfm-folder-more" data-action="folder-menu" data-folder-id="${escapeAttr(fid)}" title="文件夹菜单">${icon('more')}</button>
        </div>
        <div class="cgfm-folder-children" data-folder-children="${escapeAttr(fid)}" ${open ? '' : 'hidden'}>${childHtml}</div>
      </div>`;
  }

  function renderChat(p, cid, folderId, depth) {
    const c = p.conversations[cid];
    if (!c) return '';
    const title = c.title || 'Untitled chat';
    const url = normalizeStoredUrl(c.url || ('/c/' + cid));
    return `
      <div class="cgfm-chat-row" data-chat-id="${escapeAttr(cid)}" data-folder-id="${escapeAttr(folderId)}" data-depth="${depth}" style="--depth:${depth}">
        <span class="cgfm-spacer"></span>
        <span class="cgfm-chat-icon">${icon('chat')}</span>
        <a class="cgfm-chat-title" href="${escapeAttr(url)}" title="${escapeAttr(title)}">${escapeHtml(title)}</a>
        <span class="cgfm-row-actions">
          <button class="cgfm-icon" data-action="refresh-chat-title" data-chat-id="${escapeAttr(cid)}" title="刷新标题">${icon('refresh')}</button>
          <button class="cgfm-icon" data-action="remove-chat" data-chat-id="${escapeAttr(cid)}" title="从管理器移除">${icon('x')}</button>
        </span>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // 6. Folder tree actions and inline menus
  // ---------------------------------------------------------------------------

  function bindRootEvents(el) {
    el.addEventListener('click', onRootClick);
    el.addEventListener('dragstart', onRootDragStart);
    el.addEventListener('dragover', onRootDragOver);
    el.addEventListener('dragleave', onRootDragLeave);
    el.addEventListener('drop', onRootDrop);
    el.addEventListener('keydown', onRootKeydown, true);
    el.addEventListener('focusout', onRootFocusOut, true);
  }

  function onRootClick(event) {
    const chatLink = event.target.closest && event.target.closest('a.cgfm-chat-title[href]');
    if (chatLink && rootEl.contains(chatLink)) {
      event.preventDefault();
      navigateToConversation(chatLink.getAttribute('href') || chatLink.href || '');
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || !rootEl.contains(button)) return;
    const action = button.getAttribute('data-action');
    const fid = button.getAttribute('data-folder-id');
    const cid = button.getAttribute('data-chat-id');
    if (action !== 'select-folder') event.preventDefault();
    if (action === 'toggle-section') toggleSection();
    else if (action === 'new-folder') createFolder(ROOT_ID);
    else if (action === 'export-json') exportJson();
    else if (action === 'import-json') importJson();
    else if (action === 'settings') showSettings();
    else if (action === 'sync-status') toast(syncStatusTitle());
    else if (action === 'toggle-folder') toggleFolder(fid);
    else if (action === 'select-folder') selectFolder(fid);
    else if (action === 'folder-menu') showFolderMenu(fid, button);
    else if (action === 'refresh-chat-title') refreshChatTitle(cid);
    else if (action === 'remove-chat') removeChat(cid);
  }

  function toggleSection() {
    const p = getProfile();
    p.settings.ui.sectionCollapsed = !p.settings.ui.sectionCollapsed;
    queueRender();
    schedulePersist('toggle-section', { webdav: false });
  }

  function selectFolder(fid) {
    const p = getProfile();
    if (!p.folders[fid]) return;
    selectedFolderId = selectedFolderId === fid ? ROOT_ID : fid;
    queueRender();
  }

  function toggleFolder(fid) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f) return;
    f.collapsed = !f.collapsed;
    updateFolderCollapseDom(fid, f.collapsed);
    schedulePersist('toggle-folder', { webdav: false, touch: false });
  }

  function updateFolderCollapseDom(fid, collapsed) {
    if (!rootEl) return;
    const row = rootEl.querySelector('.cgfm-folder-row[data-folder-id="' + cssEscape(fid) + '"]');
    const children = rootEl.querySelector('.cgfm-folder-children[data-folder-children="' + cssEscape(fid) + '"]');
    const caret = row && row.querySelector('.cgfm-caret');
    if (children) children.hidden = !!collapsed;
    if (caret) caret.classList.toggle('cgfm-open', !collapsed);
  }

  function createFolder(parentId) {
    const p = getProfile();
    const parent = p.folders[parentId] || p.folders[ROOT_ID];
    const id = uid('fld');
    p.folders[id] = { id, name: '新建文件夹', parentId: parent.id, childFolderIds: [], chatIds: [], color: DEFAULT_FOLDER_COLOR, collapsed: false, createdAt: nowIso(), updatedAt: nowIso() };
    parent.childFolderIds.push(id);
    parent.collapsed = false;
    sortFolderChildren(p, parent.id);
    editingFolderId = id;
    editingNewFolderId = id;
    editingOriginalName = '新建文件夹';
    selectedFolderId = id;
    queueRender();
    schedulePersist('new-folder');
  }

  function beginRename(fid) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f || fid === ROOT_ID) return;
    editingFolderId = fid;
    editingNewFolderId = '';
    editingOriginalName = f.name;
    queueRender();
  }

  function onRootKeydown(event) {
    const input = event.target.closest('[data-folder-edit-id]');
    if (!input || !rootEl.contains(input)) return;
    if (event.key === 'Enter') { event.preventDefault(); commitFolderEdit(input, false); }
    else if (event.key === 'Escape') { event.preventDefault(); commitFolderEdit(input, true); }
  }

  function onRootFocusOut(event) {
    const input = event.target.closest('[data-folder-edit-id]');
    if (!input || !rootEl.contains(input)) return;
    setTimeout(() => {
      if (editingFolderId === input.getAttribute('data-folder-edit-id')) commitFolderEdit(input, false);
    }, 0);
  }

  function focusInlineFolderEditor() {
    if (!editingFolderId || !rootEl) return;
    const input = rootEl.querySelector('[data-folder-edit-id="' + cssEscape(editingFolderId) + '"]');
    if (!input) return;
    requestAnimationFrame(() => { try { input.focus(); input.select(); } catch (_) {} });
  }

  function commitFolderEdit(input, cancel) {
    const p = getProfile();
    const fid = input ? input.getAttribute('data-folder-edit-id') : editingFolderId;
    if (!fid || editingFolderId !== fid) return;
    const f = p.folders[fid];
    const isNew = editingNewFolderId === fid;
    if (!f) { clearEdit(); return; }
    const value = cleanText(input ? input.value : '');
    if (cancel) {
      if (isNew) deleteFolderImmediate(fid);
      else f.name = editingOriginalName || f.name;
      clearEdit();
      sortFolderChildren(p, f.parentId || ROOT_ID);
      queueRender();
      schedulePersist('cancel-edit');
      return;
    }
    if (!value) {
      if (isNew) deleteFolderImmediate(fid);
      else f.name = editingOriginalName || '新建文件夹';
    } else {
      f.name = value;
      f.updatedAt = nowIso();
      sortFolderChildren(p, f.parentId || ROOT_ID);
    }
    clearEdit();
    queueRender();
    schedulePersist('rename-folder');
  }

  function clearEdit() {
    editingFolderId = '';
    editingNewFolderId = '';
    editingOriginalName = '';
  }

  function showFolderMenu(fid, anchor) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f) return;
    closeMenu();
    const rect = anchor.getBoundingClientRect();
    menuEl = document.createElement('div');
    menuEl.className = 'cgfm-menu';
    menuEl.style.left = Math.round(rect.left) + 'px';
    menuEl.style.top = Math.round(rect.bottom + 4) + 'px';
    menuEl.innerHTML = `
      <button class="cgfm-menu-item" data-menu="child">${icon('plus')}<span>新建子文件夹</span></button>
      <button class="cgfm-menu-item" data-menu="rename">${icon('rename')}<span>重命名</span></button>
      <button class="cgfm-menu-item" data-menu="color">${icon('palette')}<span>设置颜色</span></button>
      <button class="cgfm-menu-item cgfm-danger" data-menu="delete">${icon('trash')}<span>删除文件夹</span></button>
    `;
    document.body.appendChild(menuEl);
    menuEl.addEventListener('click', event => {
      const item = event.target.closest('[data-menu]');
      if (!item) return;
      const action = item.getAttribute('data-menu');
      const left = parseInt(menuEl.style.left, 10) || rect.left;
      const top = parseInt(menuEl.style.top, 10) || rect.top;
      if (action === 'child') { closeMenu(); createFolder(fid); }
      else if (action === 'rename') { closeMenu(); beginRename(fid); }
      else if (action === 'color') showColorPopover(fid, left, top);
      else if (action === 'delete') showDeleteConfirm(fid, left, top);
    });
    setTimeout(() => document.addEventListener('mousedown', closeMenuOnOutside, true), 0);
  }

  function closeMenuOnOutside(event) {
    if (menuEl && !menuEl.contains(event.target)) closeMenu();
  }

  function closeMenu() {
    document.removeEventListener('mousedown', closeMenuOnOutside, true);
    if (menuEl) menuEl.remove();
    menuEl = null;
  }

  function showColorPopover(fid, left, top) {
    closeMenu();
    const colors = ['#6b7280', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
    menuEl = document.createElement('div');
    menuEl.className = 'cgfm-color-popover';
    menuEl.style.left = Math.round(left) + 'px';
    menuEl.style.top = Math.round(top) + 'px';
    menuEl.innerHTML = colors.map(c => `<button class="cgfm-color-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('') +
      `<button class="cgfm-color-swatch cgfm-color-custom" data-color="custom" title="自定义颜色">${icon('custom')}</button>`;
    document.body.appendChild(menuEl);
    menuEl.addEventListener('click', event => {
      const swatch = event.target.closest('[data-color]');
      if (!swatch) return;
      const color = swatch.getAttribute('data-color');
      if (color === 'custom') return showCustomColorInput(fid, left, top);
      setFolderColor(fid, color);
      closeMenu();
    });
    setTimeout(() => document.addEventListener('mousedown', closeMenuOnOutside, true), 0);
  }

  function showCustomColorInput(fid, left, top) {
    const p = getProfile();
    const current = normalizeColor((p.folders[fid] || {}).color);
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'cgfm-menu';
    menuEl.style.left = Math.round(left) + 'px';
    menuEl.style.top = Math.round(top) + 'px';
    menuEl.innerHTML = `<input id="cgfm-custom-color" value="${escapeAttr(current)}" style="width:150px;height:32px;border-radius:8px;border:1px solid rgba(128,128,128,.3);padding:0 8px;background:var(--main-surface-primary,#fff);color:inherit">`;
    document.body.appendChild(menuEl);
    const input = menuEl.querySelector('input');
    input.focus(); input.select();
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        const color = normalizeHex(input.value);
        if (!color) return toast('请输入合法 HEX 颜色。');
        setFolderColor(fid, color);
        closeMenu();
      } else if (event.key === 'Escape') closeMenu();
    });
    setTimeout(() => document.addEventListener('mousedown', closeMenuOnOutside, true), 0);
  }

  function normalizeHex(value) {
    const s = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s.slice(1).split('').map(ch => ch + ch).join('');
    return '';
  }

  function setFolderColor(fid, color) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f) return;
    f.color = normalizeColor(color);
    f.updatedAt = nowIso();
    const row = rootEl && rootEl.querySelector('[data-folder-id="' + cssEscape(fid) + '"]');
    if (row) row.style.setProperty('--folder-color', f.color);
    schedulePersist('folder-color');
  }

  function showDeleteConfirm(fid, left, top) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f || fid === ROOT_ID) return;
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'cgfm-menu cgfm-confirm';
    menuEl.style.left = Math.round(left) + 'px';
    menuEl.style.top = Math.round(top) + 'px';
    menuEl.innerHTML = `<p>删除“${escapeHtml(f.name)}”？<br><span style="color:var(--text-secondary,#777)">只会删除文件夹索引，不会删除 ChatGPT 原聊天。</span></p><div class="cgfm-confirm-actions"><button data-confirm="cancel">取消</button><button class="cgfm-danger-btn" data-confirm="delete">删除</button></div>`;
    document.body.appendChild(menuEl);
    menuEl.addEventListener('click', event => {
      const b = event.target.closest('[data-confirm]');
      if (!b) return;
      if (b.getAttribute('data-confirm') === 'delete') {
        deleteFolderImmediate(fid);
        queueRender();
        schedulePersist('delete-folder');
      }
      closeMenu();
    });
    setTimeout(() => document.addEventListener('mousedown', closeMenuOnOutside, true), 0);
  }

  function deleteFolderImmediate(fid) {
    const p = getProfile();
    const f = p.folders[fid];
    if (!f || fid === ROOT_ID) return;
    const parent = p.folders[f.parentId] || p.folders[ROOT_ID];
    parent.childFolderIds = parent.childFolderIds.filter(x => x !== fid);
    const ids = collectFolderIds(fid, p);
    for (const id of ids) {
      const folder = p.folders[id];
      if (folder) {
        for (const cid of folder.chatIds || []) delete p.conversations[cid];
      }
      delete p.folders[id];
    }
    if (!p.folders[selectedFolderId]) selectedFolderId = ROOT_ID;
  }

  function collectFolderIds(fid, p) {
    const out = [];
    const walk = id => {
      out.push(id);
      const f = p.folders[id];
      for (const child of (f && f.childFolderIds) || []) walk(child);
    };
    walk(fid);
    return out;
  }

  function removeChat(cid) {
    const p = getProfile();
    const c = p.conversations[cid];
    if (!c) return;
    const f = p.folders[c.folderId] || p.folders[ROOT_ID];
    f.chatIds = f.chatIds.filter(x => x !== cid);
    delete p.conversations[cid];
    queueRender();
    schedulePersist('remove-chat');
  }

  function refreshChatTitle(cid) {
    const p = getProfile();
    const c = p.conversations[cid];
    if (!c) return;
    const oldTitle = c.title || '';
    const native = findNativeConversationAnchor(cid);
    const nativeTitle = native ? extractTitleFromAnchor(native) : '';
    const currentPageTitle = extractTitleFromCurrentPage(cid);
    // If the user is currently viewing this conversation, document.title is often the
    // freshest source after a rename. Otherwise prefer the native sidebar link, never
    // the script's own folder link.
    const title = cleanConversationTitle((currentPageTitle && currentPageTitle !== oldTitle) ? currentPageTitle : (nativeTitle || currentPageTitle));
    if (!title) {
      toast('当前最近列表中找不到该对话。');
      return;
    }
    if (title === oldTitle) {
      toast('标题没有变化。');
      return;
    }
    c.title = title;
    c.updatedAt = nowIso();
    queueRender();
    schedulePersist('refresh-title');
    toast('标题已刷新。');
  }

  // ---------------------------------------------------------------------------
  // 7. Firefox-friendly native drag/drop integration
  // ---------------------------------------------------------------------------

  function setupNativeDragCache() {
    if (document.__cgfmNativeDragBound) return;
    document.__cgfmNativeDragBound = true;
    document.addEventListener('pointerdown', onNativeHistoryPointerDown, true);
    document.addEventListener('mousedown', onNativeHistoryPointerDown, true);
    document.addEventListener('dragstart', onNativeHistoryDragStart, true);
    document.addEventListener('dragend', onNativeHistoryDragEnd, true);
    document.addEventListener('mouseup', restoreTransientNativeChatDrag, true);
    document.addEventListener('click', restoreTransientNativeChatDrag, true);
  }

  function resetNativeDragState() {
    restoreTransientNativeChatDrag();
    dragPayload = null;
    dragStartPayload = null;
    pointerPayload = null;
    lastHoveredFolderId = '';
    lastHoveredFolderAt = 0;
    dropCommitted = false;
    clearDropHighlight();
  }

  function payloadKind(payload) {
    if (!payload) return '';
    if (payload.kind === 'folder' && payload.folderId) return 'folder';
    if (payload.kind === 'chat' && payload.id) return 'chat';
    if (payload.id) return 'chat';
    return '';
  }

  function onRootDragStart(event) {
    if (!event || !event.target || !rootEl || !rootEl.contains(event.target)) return;
    const interactive = event.target.closest && event.target.closest('button,input,textarea,select,a,[contenteditable="true"]');
    if (interactive) return;
    const row = event.target.closest && event.target.closest('.cgfm-folder-row[data-folder-id]');
    if (!row || !rootEl.contains(row)) return;
    const fid = row.getAttribute('data-folder-id');
    if (!fid || fid === ROOT_ID || !getProfile().folders[fid]) return;
    closeMenu();
    const payload = { kind: 'folder', folderId: fid };
    dragPayload = payload;
    dragStartPayload = payload;
    pointerPayload = null;
    dropCommitted = false;
    row.classList.add('cgfm-dragging-folder');
    try {
      if (event.dataTransfer) {
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.setData('text/plain', 'chatgpt-folder:' + fid);
        event.dataTransfer.effectAllowed = 'move';
      }
    } catch (_) {}
  }

  function onNativeHistoryPointerDown(event) {
    if (!event || !(event.target instanceof Element)) return;
    if (rootEl && event.target instanceof Node && rootEl.contains(event.target)) return;
    const chat = maybeEnableTransientNativeChatDrag(event) || extractChatFromEvent(event);
    if (chat) pointerPayload = chat;
  }

  function maybeEnableTransientNativeChatDrag(event) {
    const target = event && event.target;
    if (!(target instanceof Element)) return null;
    // Do not alter the trailing three-dot menu click path; that already has its own menu-based add flow.
    if (target.closest('button,input,textarea,select,[contenteditable="true"],[data-trailing-button],[data-conversation-options-trigger]')) return null;
    const anchor = target.closest('#history a[href*="/c/"]');
    if (!anchor || (rootEl && rootEl.contains(anchor))) return null;
    const chat = extractChatFromAnchor(anchor);
    if (!chat) return null;

    // Some GPT-generated conversations in ChatGPT's Recent list are rendered as
    // draggable="false" even though they are normal /c/<conversation-id> links.
    // To keep the native Firefox drag/drop route, temporarily enable native dragging
    // only for the pressed row, then restore it on dragend/mouseup/click/timeout.
    if (anchor.getAttribute('draggable') === 'false') {
      restoreTransientNativeChatDrag();
      transientDragAnchor = anchor;
      transientDragOriginalDraggable = anchor.getAttribute('draggable');
      anchor.setAttribute('draggable', 'true');
      anchor.setAttribute('data-cgfm-temp-draggable', '1');
      transientDragRestoreTimer = setTimeout(restoreTransientNativeChatDrag, 2500);
    }
    return chat;
  }

  function restoreTransientNativeChatDrag() {
    if (transientDragRestoreTimer) {
      clearTimeout(transientDragRestoreTimer);
      transientDragRestoreTimer = null;
    }
    const anchor = transientDragAnchor;
    if (anchor) {
      try {
        if (document.contains(anchor) && anchor.getAttribute('data-cgfm-temp-draggable') === '1') {
          if (transientDragOriginalDraggable === null) anchor.removeAttribute('draggable');
          else anchor.setAttribute('draggable', transientDragOriginalDraggable);
          anchor.removeAttribute('data-cgfm-temp-draggable');
        }
      } catch (_) {}
    }
    transientDragAnchor = null;
    transientDragOriginalDraggable = null;
  }

  function onNativeHistoryDragStart(event) {
    if (!event || !(event.target instanceof Element)) return;
    if (rootEl && event.target instanceof Node && rootEl.contains(event.target)) return;
    if (!event.target.closest('a[href*="/c/"]') && !pointerPayload) return;
    const chat = extractChatFromEvent(event) || pointerPayload;
    if (!chat) { dragPayload = null; dragStartPayload = null; return; }
    chat.kind = 'chat';
    dragPayload = chat;
    dragStartPayload = chat;
    dropCommitted = false;
    try {
      if (event.dataTransfer) {
        // Add our own payload without clearing ChatGPT's original drag data, so native Project drag remains intact.
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify(chat));
        event.dataTransfer.setData('text/uri-list', location.origin + chat.url);
        event.dataTransfer.setData('text/plain', location.origin + chat.url);
        event.dataTransfer.effectAllowed = 'copyMove';
      }
    } catch (_) {}
  }

  function onNativeHistoryDragEnd() {
    const shouldFallback = !dropCommitted && lastHoveredFolderId && (Date.now() - lastHoveredFolderAt < 900);
    const payload = dragPayload || dragStartPayload || pointerPayload;
    if (shouldFallback && payload) {
      commitDropPayload(payload, lastHoveredFolderId);
      dropCommitted = true;
    }
    if (rootEl) rootEl.querySelectorAll('.cgfm-dragging-folder').forEach(el => el.classList.remove('cgfm-dragging-folder'));
    resetNativeDragState();
  }

  function onRootDragOver(event) {
    const target = resolveFolderDropTarget(event, true);
    if (!target) return;
    event.preventDefault();
    const payload = getDragPayload(event, false);
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = payloadKind(payload) === 'folder' ? 'move' : 'copy';
    } catch (_) {}
    lastHoveredFolderId = target.folderId;
    lastHoveredFolderAt = Date.now();
    clearDropHighlight(target.element);
    target.element.classList.add(target.isRoot ? 'cgfm-root-drop' : 'cgfm-drop-inside');
  }

  function onRootDragLeave(event) {
    const row = event.target.closest && event.target.closest('.cgfm-folder-row[data-folder-id]');
    if (row && (!event.relatedTarget || !row.contains(event.relatedTarget))) row.classList.remove('cgfm-drop-inside');
    const header = event.target.closest && event.target.closest('.cgfm-header[data-root-drop]');
    if (header && (!event.relatedTarget || !header.contains(event.relatedTarget))) header.classList.remove('cgfm-root-drop');
  }

  function onRootDrop(event) {
    const target = resolveFolderDropTarget(event, true);
    clearDropHighlight();
    if (!target) return;
    event.preventDefault();
    const payload = getDragPayload(event, true);
    if (!payload) {
      toast('没有识别到被拖动的聊天或文件夹。');
      return;
    }
    commitDropPayload(payload, target.folderId);
    dropCommitted = true;
  }

  function resolveFolderDropTarget(event, allowUnknownChat) {
    if (!event || !event.target || !rootEl) return null;
    const payload = getDragPayload(event, false);
    const kind = payloadKind(payload);
    const header = event.target.closest && event.target.closest('.cgfm-header[data-root-drop]');
    if (header && rootEl.contains(header)) {
      if (kind === 'folder' && canMoveFolderTo(payload.folderId, ROOT_ID)) return { folderId: ROOT_ID, element: header, isRoot: true };
      return null;
    }
    const row = event.target.closest && event.target.closest('.cgfm-folder-row[data-folder-id]');
    if (!row || !rootEl.contains(row)) return null;
    const fid = row.getAttribute('data-folder-id');
    if (!fid || !getProfile().folders[fid]) return null;
    if (kind === 'folder') return canMoveFolderTo(payload.folderId, fid) ? { folderId: fid, element: row, isRoot: false } : null;
    if (kind === 'chat' || allowUnknownChat) return { folderId: fid, element: row, isRoot: false };
    return null;
  }

  function clearDropHighlight(except) {
    if (!rootEl) return;
    rootEl.querySelectorAll('.cgfm-drop-inside,.cgfm-root-drop').forEach(el => { if (el !== except) el.classList.remove('cgfm-drop-inside', 'cgfm-root-drop'); });
  }

  function commitDropPayload(payload, folderId) {
    const kind = payloadKind(payload);
    if (kind === 'folder') return moveFolderToFolder(payload.folderId, folderId);
    if (kind === 'chat') return addChatToFolder(payload, folderId);
    toast('没有识别到被拖动的聊天或文件夹。');
  }

  function getDragPayload(event, allowRead) {
    if (dragPayload) return dragPayload;
    if (dragStartPayload) return dragStartPayload;
    if (pointerPayload) return pointerPayload;
    if (!allowRead || !event || !event.dataTransfer) return null;
    try {
      const raw = event.dataTransfer.getData(DRAG_MIME);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (payloadKind(parsed)) return parsed;
      }
    } catch (_) {}
    const types = ['text/uri-list', 'text/plain', 'text/html'];
    for (const type of types) {
      try {
        const text = event.dataTransfer.getData(type);
        const chat = extractChatFromText(text);
        if (chat) return chat;
      } catch (_) {}
    }
    return null;
  }

  function extractChatFromEvent(event) {
    const anchor = findChatAnchorFromEvent(event);
    return anchor ? extractChatFromAnchor(anchor) : null;
  }

  function findChatAnchorFromEvent(event) {
    if (!event) return null;
    const isElement = node => node && node.nodeType === 1;
    const isChatAnchor = node => isElement(node) && node.matches && node.matches('a[href*="/c/"]');
    const insideRoot = node => {
      try { return !!(rootEl && node instanceof Node && rootEl.contains(node)); }
      catch (_) { return false; }
    };
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      // Firefox composedPath() contains Window/Document objects. Never pass them into Node.contains().
      if (!(node instanceof Node)) continue;
      if (insideRoot(node)) return null;
      if (isChatAnchor(node)) return node;
      if (isElement(node) && node.closest) {
        const a = node.closest('a[href*="/c/"]');
        if (a && !insideRoot(a)) return a;
      }
    }
    const target = event.target;
    if (target instanceof Element && target.closest) {
      const a = target.closest('a[href*="/c/"]');
      if (a && !insideRoot(a)) return a;
    }
    return null;
  }

  function extractChatFromText(text) {
    const id = extractConversationId(text);
    if (!id) return null;
    let title = '';
    try {
      const anchor = document.querySelector('a[href*="/c/' + cssEscape(id) + '"]');
      title = anchor ? extractTitleFromAnchor(anchor) : '';
    } catch (_) {}
    return { kind: 'chat', id, title: title || 'Untitled chat', url: '/c/' + id };
  }

  function canMoveFolderTo(sourceId, targetParentId) {
    const p = getProfile();
    if (!sourceId || sourceId === ROOT_ID || !p.folders[sourceId]) return false;
    const targetId = targetParentId || ROOT_ID;
    if (!p.folders[targetId]) return false;
    if (sourceId === targetId) return false;
    let cur = targetId;
    while (cur && cur !== ROOT_ID) {
      if (cur === sourceId) return false;
      const f = p.folders[cur];
      cur = f ? f.parentId : '';
    }
    return true;
  }

  function moveFolderToFolder(sourceId, targetParentId) {
    const p = getProfile();
    const source = p.folders[sourceId];
    const targetId = targetParentId || ROOT_ID;
    const target = p.folders[targetId];
    if (!source || !target) return;
    if (!canMoveFolderTo(sourceId, targetId)) {
      toast('不能把文件夹移动到自己或自己的子文件夹中。');
      return;
    }
    if (source.parentId === targetId) {
      sortFolderChildren(p, targetId);
      queueRender();
      return;
    }
    const oldParent = p.folders[source.parentId] || p.folders[ROOT_ID];
    oldParent.childFolderIds = oldParent.childFolderIds.filter(id => id !== sourceId);
    source.parentId = targetId;
    source.updatedAt = nowIso();
    if (!target.childFolderIds.includes(sourceId)) target.childFolderIds.push(sourceId);
    if (targetId !== ROOT_ID) target.collapsed = false;
    sortFolderChildren(p, oldParent.id);
    sortFolderChildren(p, targetId);
    selectedFolderId = sourceId;
    queueRender();
    schedulePersist('move-folder');
    toast(targetId === ROOT_ID ? '文件夹已移动到顶层。' : '文件夹已移动。');
  }

  function addChatToFolder(chat, folderId) {
    const p = getProfile();
    const f = p.folders[folderId];
    if (!f || !chat || !chat.id) return;
    const existing = p.conversations[chat.id];
    if (existing && existing.folderId && p.folders[existing.folderId]) {
      p.folders[existing.folderId].chatIds = p.folders[existing.folderId].chatIds.filter(x => x !== chat.id);
    }
    p.conversations[chat.id] = Object.assign({}, existing || {}, {
      id: chat.id,
      title: chat.title || (existing && existing.title) || 'Untitled chat',
      url: normalizeStoredUrl(chat.url || ('/c/' + chat.id)),
      folderId,
      addedAt: existing && existing.addedAt || nowIso(),
      updatedAt: nowIso()
    });
    if (!f.chatIds.includes(chat.id)) f.chatIds.push(chat.id);
    f.collapsed = false;
    queueRender();
    schedulePersist('add-chat');
    toast('聊天已加入文件夹。');
  }


  // ---------------------------------------------------------------------------
  // 7b. Add-to-folder entry in ChatGPT's native Recent-chat options menu
  // ---------------------------------------------------------------------------

  function setupNativeMenuHook() {
    if (document.__cgfmNativeMenuBound) return;
    document.__cgfmNativeMenuBound = true;
    document.addEventListener('pointerdown', onNativeConversationMenuPointer, true);
    document.addEventListener('click', onNativeConversationMenuClick, true);
  }

  function onNativeConversationMenuPointer(event) {
    rememberNativeConversationMenuTarget(event);
  }

  function onNativeConversationMenuClick(event) {
    if (rememberNativeConversationMenuTarget(event)) armNativeMenuInjection();
  }

  function rememberNativeConversationMenuTarget(event) {
    const target = event && event.target;
    if (!(target instanceof Element)) return false;
    const button = target.closest('[data-conversation-options-trigger]');
    if (!button) return false;
    if (rootEl && rootEl.contains(button)) return false;
    const chat = extractChatFromOptionsButton(button);
    if (!chat) return false;
    chat.kind = 'chat';
    nativeMenuChat = chat;
    nativeMenuTriggerId = button.id || '';
    return true;
  }

  function extractChatFromOptionsButton(button) {
    if (!button) return null;
    const id = cleanText(button.getAttribute('data-conversation-options-trigger') || '');
    const anchor = button.closest('a[href*="/c/"]') || (id ? document.querySelector('a[href*="/c/' + cssEscape(id) + '"]') : null);
    const fromAnchor = anchor ? extractChatFromAnchor(anchor) : null;
    if (fromAnchor) return fromAnchor;
    if (!id) return null;
    const aria = button.getAttribute('aria-label') || '';
    const title = cleanText(aria.replace(/^打开[“"]?/, '').replace(/[”"]?的对话选项.*$/, '').replace(/^Open[“"]?/, '').replace(/[”"]?.*options.*$/i, '')) || 'Untitled chat';
    return { id, title, url: '/c/' + id };
  }

  function armNativeMenuInjection() {
    disconnectNativeMenuObserver();
    closeNativeFolderMenus();
    const tryNow = () => {
      try {
        if (injectNativeAddToFolderItem()) {
          disconnectNativeMenuObserver();
          startNativeMenuLivenessPoll();
          return true;
        }
      } catch (err) {
        console.warn(APP_NAME, 'native menu injection failed', err);
      }
      return false;
    };
    if (tryNow()) return;
    nativeMenuObserver = new MutationObserver(() => tryNow());
    try { nativeMenuObserver.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    [40, 90, 180, 360, 700, 1200].forEach(delay => setTimeout(tryNow, delay));
    nativeMenuObserveTimer = setTimeout(disconnectNativeMenuObserver, 1800);
  }

  function disconnectNativeMenuObserver() {
    if (nativeMenuObserver) nativeMenuObserver.disconnect();
    nativeMenuObserver = null;
    if (nativeMenuObserveTimer) clearTimeout(nativeMenuObserveTimer);
    nativeMenuObserveTimer = null;
  }

  function findVisibleNativeChatMenu() {
    const menus = Array.from(document.querySelectorAll('[role="menu"][data-radix-menu-content]'));
    const visible = menus.filter(isVisibleElement);
    if (!visible.length) return null;
    if (nativeMenuTriggerId) {
      const byTrigger = visible.find(menu => menu.getAttribute('aria-labelledby') === nativeMenuTriggerId);
      if (byTrigger) return byTrigger;
    }
    return visible.find(menu => menu.querySelector('[data-testid="delete-chat-menu-item"], [data-testid="share-chat-menu-item"]') && /分享|Share|重命名|Rename|归档|Archive|删除|Delete/.test(cleanText(menu.textContent || ''))) || null;
  }

  function injectNativeAddToFolderItem() {
    if (!nativeMenuChat || !nativeMenuChat.id) return false;
    const menu = findVisibleNativeChatMenu();
    if (!menu) return false;
    if (menu.querySelector('[data-cgfm-native-add="1"]')) return true;
    const item = document.createElement('div');
    const firstGroup = menu.querySelector('[role="group"]') || menu.firstElementChild || menu;
    const projectItem = Array.from(firstGroup.querySelectorAll('[role="menuitem"]')).find(el => /移至项目|Move to project/i.test(cleanText(el.textContent || '')));
    const projectArrow = projectItem && projectItem.querySelector(':scope > svg');
    const arrowHtml = projectArrow
      ? projectArrow.outerHTML
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" aria-hidden="true" data-rtl-flip="" class="icon-sm -me-0.25" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.setAttribute('data-cgfm-native-add', '1');
    item.setAttribute('data-orientation', 'vertical');
    item.setAttribute('data-has-submenu', '');
    item.setAttribute('aria-haspopup', 'menu');
    item.setAttribute('aria-expanded', 'false');
    item.className = 'group __menu-item cgfm-native-menu-item';
    item.innerHTML = '<div class="flex min-w-0 items-center gap-1.5 cgfm-native-menu-leading"><div class="flex items-center justify-center [opacity:var(--menu-item-icon-opacity,1)] icon">' + icon('folder') + '</div><div class="flex min-w-0 grow items-center gap-2.5 cgfm-native-menu-label">移至文件夹</div></div>' + arrowHtml;
    item.addEventListener('mouseenter', () => showNativeFolderRootMenu(item));
    item.addEventListener('focus', () => showNativeFolderRootMenu(item));
    item.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); showNativeFolderRootMenu(item); });
    item.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });

    if (projectItem && projectItem.parentElement === firstGroup) projectItem.insertAdjacentElement('afterend', item);
    else firstGroup.appendChild(item);
    return true;
  }

  function showNativeFolderRootMenu(anchor) {
    if (!nativeMenuChat || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    showNativeFolderSubmenu(ROOT_ID, rect.right + 4, rect.top, 0, nativeMenuChat);
    startNativeMenuLivenessPoll();
  }

  function showNativeFolderSubmenu(parentId, left, top, level, chat) {
    const p = getProfile();
    const parent = p.folders[parentId] || p.folders[ROOT_ID];
    closeNativeFolderMenusFrom(level);
    const menu = document.createElement('div');
    menu.className = 'cgfm-native-folder-menu';
    menu.setAttribute('data-cgfm-folder-menu-level', String(level));
    const ids = (parent.childFolderIds || []).filter(fid => p.folders[fid]);
    if (!ids.length) {
      menu.innerHTML = '<div class="cgfm-native-folder-empty">暂无文件夹</div>';
    } else {
      menu.innerHTML = ids.map(fid => {
        const f = p.folders[fid];
        const hasChildren = (f.childFolderIds || []).some(child => p.folders[child]);
        return '<button type="button" class="cgfm-native-folder-item" data-folder-id="' + escapeAttr(fid) + '" data-has-children="' + (hasChildren ? '1' : '0') + '" style="--folder-color:' + escapeAttr(normalizeColor(f.color)) + '"><span style="color:var(--folder-color)">' + icon('folder') + '</span><span class="cgfm-native-folder-name">' + escapeHtml(f.name) + '</span>' + (hasChildren ? '<span class="cgfm-native-folder-arrow">' + icon('chevron') + '</span>' : '') + '</button>';
      }).join('');
    }
    document.body.appendChild(menu);
    positionFloatingMenu(menu, left, top);
    nativeFolderSubmenus[level] = menu;
    menu.addEventListener('mousemove', event => {
      const item = event.target.closest && event.target.closest('.cgfm-native-folder-item[data-folder-id]');
      if (!item || !menu.contains(item)) return;
      menu.querySelectorAll('.cgfm-native-folder-item.cgfm-open').forEach(el => { if (el !== item) el.classList.remove('cgfm-open'); });
      item.classList.add('cgfm-open');
      const fid = item.getAttribute('data-folder-id');
      if (item.getAttribute('data-has-children') === '1') {
        const r = item.getBoundingClientRect();
        showNativeFolderSubmenu(fid, r.right + 4, r.top, level + 1, chat);
      } else {
        closeNativeFolderMenusFrom(level + 1);
      }
    });
    menu.addEventListener('mousedown', event => {
      const item = event.target.closest && event.target.closest('.cgfm-native-folder-item[data-folder-id]');
      if (!item || !menu.contains(item)) return;
      event.preventDefault();
      event.stopPropagation();
      const fid = item.getAttribute('data-folder-id');
      addChatToFolder(chat, fid);
      closeNativeFolderMenus();
      closeNativeChatMenu();
    }, true);
  }

  function positionFloatingMenu(menu, left, top) {
    const margin = 8;
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    const rect = menu.getBoundingClientRect();
    let x = left;
    let y = top;
    if (x + rect.width > window.innerWidth - margin) x = Math.max(margin, left - rect.width - 8);
    if (y + rect.height > window.innerHeight - margin) y = Math.max(margin, window.innerHeight - rect.height - margin);
    menu.style.left = Math.round(x) + 'px';
    menu.style.top = Math.round(y) + 'px';
  }

  function closeNativeFolderMenusFrom(level) {
    for (let i = level; i < nativeFolderSubmenus.length; i++) {
      const menu = nativeFolderSubmenus[i];
      if (menu) menu.remove();
    }
    nativeFolderSubmenus.length = Math.max(0, level);
  }

  function closeNativeFolderMenus() {
    closeNativeFolderMenusFrom(0);
    stopNativeMenuLivenessPoll();
  }

  function closeNativeChatMenu() {
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); } catch (_) {}
  }

  function startNativeMenuLivenessPoll() {
    if (nativeMenuPollTimer) return;
    const check = () => {
      if (!findVisibleNativeChatMenu()) {
        closeNativeFolderMenus();
        nativeMenuChat = null;
        nativeMenuTriggerId = '';
      }
    };
    nativeMenuPollTimer = setInterval(check, 600);
  }

  function stopNativeMenuLivenessPoll() {
    if (nativeMenuPollTimer) clearInterval(nativeMenuPollTimer);
    nativeMenuPollTimer = null;
  }

  function navigateToConversation(url) {
    const id = extractConversationId(url);
    if (!id) return;
    const targetPath = '/c/' + id;
    const currentId = extractConversationId(location.pathname + location.search + location.hash);
    if (currentId === id) return;

    // Safest SPA-like path: reuse ChatGPT's own sidebar link if it is already present.
    // Do not force history.pushState here; ChatGPT's router has extra state beyond the URL.
    const native = findNativeConversationAnchor(id);
    if (native) {
      try {
        native.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
        return;
      } catch (_) {
        try { native.click(); return; } catch (__) {}
      }
    }

    // Last resort only. This may reload, but it is safer than faking router state.
    location.assign(targetPath);
  }

  function findNativeConversationAnchor(id) {
    try {
      const selector = 'a[href*="/c/' + cssEscape(id) + '"]';
      const anchors = Array.from(document.querySelectorAll(selector))
        .filter(a => !(rootEl && rootEl.contains(a)));
      if (!anchors.length) return null;
      // Prefer visible native sidebar/history links. Hidden portal/menu copies or other
      // framework anchors may contain stale text.
      return anchors.find(isVisibleElement) || anchors[0] || null;
    } catch (_) { return null; }
  }

  function extractChatFromAnchor(anchor) {
    if (!anchor) return null;
    const href = anchor.getAttribute('href') || anchor.href || '';
    const id = extractConversationId(href);
    if (!id) return null;
    const title = extractTitleFromAnchor(anchor) || 'Untitled chat';
    return { kind: 'chat', id, title, url: '/c/' + id };
  }

  function extractConversationId(href) {
    const m = String(href || '').match(/\/c\/([0-9a-fA-F-]{10,}|[^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function cleanConversationTitle(title) {
    return cleanText(title || '')
      .replace(/\s*[|｜·•-]\s*ChatGPT\s*$/i, '')
      .replace(/^ChatGPT\s*[|｜·•-]?\s*/i, '')
      .replace(/^打开[“"]?/, '')
      .replace(/[”"]?的对话选项.*$/, '')
      .replace(/^Open[“"]?/, '')
      .replace(/[”"]?.*options.*$/i, '')
      .trim()
      .slice(0, 200);
  }

  function extractTitleFromAnchor(anchor) {
    if (!anchor) return '';
    const clone = anchor.cloneNode(true);
    clone.querySelectorAll('[data-cgfm], button, svg, [aria-hidden="true"]').forEach(n => n.remove());
    const visibleText = cleanConversationTitle(clone.textContent || anchor.textContent || '');
    const ariaText = cleanConversationTitle(anchor.getAttribute('aria-label') || '');
    // ChatGPT sometimes updates visible menu/sidebar text before aria-label, so prefer
    // visible text and use aria-label only as a fallback.
    return visibleText || ariaText;
  }

  function extractTitleFromCurrentPage(id) {
    try {
      const currentId = extractConversationId(location.pathname + location.search + location.hash);
      if (currentId !== id) return '';
      const title = cleanConversationTitle(document.title || '');
      if (!title || /^ChatGPT$/i.test(title)) return '';
      return title;
    } catch (_) { return ''; }
  }
  function normalizeStoredUrl(url) {
    const id = extractConversationId(url);
    return id ? '/c/' + id : String(url || '');
  }

  // ---------------------------------------------------------------------------
  // 8. Import / export and WebDAV remote-file helpers
  // ---------------------------------------------------------------------------

  function exportPayload(p) {
    const copy = JSON.parse(JSON.stringify(p));
    delete copy.__cgfm;
    if (copy.settings && copy.settings.webdav) {
      copy.settings.webdav.username = '';
      copy.settings.webdav.password = '';
    }
    const acct = currentAccount || getCurrentAccountInfo() || readLastAccountInfo() || { id: 'acct_default', label: 'ChatGPT account' };
    return { app: APP_NAME, version: VERSION, exportedAt: nowIso(), account: { id: acct.id, label: acct.label || 'ChatGPT account' }, profile: copy };
  }

  function exportJson() {
    const p = getProfile();
    const blob = new Blob([JSON.stringify(exportPayload(p), null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ChatGPT文件夹-' + (p.label || 'profile').replace(/[\\/:*?"<>|]+/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || '{}'));
          const profile = data.profile || data;
          if (!profile || !profile.folders || !profile.conversations) throw new Error('不是有效的文件夹配置。');
          const p = getProfile();
          const currentWebdav = JSON.parse(JSON.stringify(p.settings.webdav || {}));
          const normalized = normalizeProfile(profile, p.id, p.label);
          normalized.id = p.id;
          normalized.label = p.label;
          normalized.settings.webdav = Object.assign({}, normalized.settings.webdav || {}, currentWebdav);
          state = normalized;
          if (!state.folders[selectedFolderId]) selectedFolderId = ROOT_ID;
          queueRender();
          schedulePersist('import-json');
          toast('导入完成。');
        } catch (err) {
          toast('导入失败：' + safeError(err));
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }


  function sanitizeFilePart(value) {
    const base = String(value || 'acct_default').trim() || 'acct_default';
    return base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96) || 'acct_default';
  }

  function sanitizeEmailFilePart(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return '';
    return sanitizeFilePart(e.replace('@', '_at_').replace(/\./g, '_'));
  }

  function getWebdavAccountInfo() {
    const detected = getCurrentAccountInfo();
    if (detected && detected.id) {
      currentAccount = detected;
      rememberAccountInfo(detected);
      return detected;
    }
    return currentAccount || readLastAccountInfo() || { id: 'acct_default', label: 'ChatGPT account', email: '', accountId: '' };
  }

  function currentWebdavFileName() {
    const acct = getWebdavAccountInfo();
    const emailPart = sanitizeEmailFilePart(acct.email || '');
    const accountPart = sanitizeFilePart(String(acct.accountId || '').slice(0, 8));
    if (emailPart) return emailPart + (accountPart ? '-' + accountPart : '') + '.json';
    return sanitizeFilePart(acct.id || 'acct_default') + '.json';
  }

  function normalizeWebdavFolderUrl(raw) {
    let url = cleanText(raw || '');
    if (!url) return '';
    url = url.replace(/\\/g, '/');
    try {
      const u = new URL(url, location.href);
      if (/\.json$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/[^/]*\.json$/i, '/');
      u.search = '';
      u.hash = '';
      url = u.href;
    } catch (_) {
      url = url.replace(/\/[^/]*\.json(?:[?#].*)?$/i, '/');
    }
    return url.endsWith('/') ? url : url + '/';
  }

  function effectiveWebdavFileUrl(settings) {
    const folder = normalizeWebdavFolderUrl(settings && settings.url);
    return folder ? folder + currentWebdavFileName() : '';
  }

  function webdavFolderLabel(settings) {
    return normalizeWebdavFolderUrl(settings && settings.url) || '';
  }

  function isIgnorableMkcolError(err) {
    return err && (err.status === 405 || err.status === 409 || err.status === 301 || err.status === 302);
  }

  async function tryMkcol(folderUrl, settings) {
    if (!folderUrl) return;
    try { await davRequest('MKCOL', folderUrl, null, settings); }
    catch (err) { if (!isIgnorableMkcolError(err)) throw err; }
  }

  async function putDavJson(settings, body) {
    const fileUrl = effectiveWebdavFileUrl(settings);
    if (!fileUrl) throw new Error('Missing WebDAV folder URL');
    try {
      return await davRequest('PUT', fileUrl, body, settings, { 'Content-Type': 'application/json;charset=utf-8' });
    } catch (err) {
      if (err && err.status === 409) {
        await tryMkcol(webdavFolderLabel(settings), settings);
        return await davRequest('PUT', fileUrl, body, settings, { 'Content-Type': 'application/json;charset=utf-8' });
      }
      throw err;
    }
  }

  async function getOrCreateDavJson(settings, body) {
    const fileUrl = effectiveWebdavFileUrl(settings);
    if (!fileUrl) throw new Error('Missing WebDAV folder URL');
    try {
      const res = await davRequest('GET', fileUrl, null, settings);
      res.created = false;
      return res;
    } catch (err) {
      if (err && err.status === 404) {
        const put = await putDavJson(settings, body);
        put.created = true;
        return put;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Sidebar width, sync status and settings modal
  // ---------------------------------------------------------------------------

  function sidebarIsExpandedNow() {
    try { return officialSidebarExpanded(); }
    catch (_) { return true; }
  }

  function syncSidebarWidthClass(expandedOverride) {
    const p = getProfile();
    const enabled = !!((p.settings.ui || {}).sidebarWidthEnabled);
    const expanded = typeof expandedOverride === 'boolean' ? expandedOverride : sidebarIsExpandedNow();
    document.documentElement.classList.toggle('cgfm-sidebar-width-enabled', enabled);
    document.documentElement.classList.toggle('cgfm-sidebar-width-active', enabled && expanded);
    document.documentElement.classList.toggle('cgfm-official-sidebar-collapsed', !expanded);
  }
  function ensureSidebarWidthStyle(cssPx) {
    if (!sidebarWidthStyleEl) {
      sidebarWidthStyleEl = document.getElementById('cgfm-sidebar-width-style') || document.createElement('style');
      sidebarWidthStyleEl.id = 'cgfm-sidebar-width-style';
      document.head.appendChild(sidebarWidthStyleEl);
    }
    // Match ChatGPT's native markup: #stage-slideover-sidebar already has width: var(--sidebar-width),
    // and its inner panels already use w-(--sidebar-width). We only override the CSS variable while
    // the official sidebar is expanded. When it is collapsed, the class is removed and ChatGPT's own
    // tiny-bar/collapsed layout can reclaim the width.
    sidebarWidthStyleEl.textContent = `
      html.cgfm-sidebar-width-active body {
        --sidebar-width:${cssPx} !important;
      }
    `;
  }

  function applySidebarWidth(enabledOverride, pxOverride) {
    try {
      const p = getProfile();
      const ui = p.settings.ui || {};
      const hasOverride = arguments.length > 0;
      const enabled = hasOverride ? !!enabledOverride : !!ui.sidebarWidthEnabled;
      const px = clamp(Number(hasOverride ? pxOverride : (ui.sidebarWidthPx || DEFAULT_SIDEBAR_WIDTH_PX)), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX);
      if (!sidebarWidthStyleEl) {
        sidebarWidthStyleEl = document.getElementById('cgfm-sidebar-width-style') || document.createElement('style');
        sidebarWidthStyleEl.id = 'cgfm-sidebar-width-style';
        document.head.appendChild(sidebarWidthStyleEl);
      }

      // Clean up custom-property overrides left by older versions. Do not remove ChatGPT's native
      // inline width: var(--sidebar-width) from #stage-slideover-sidebar.
      document.documentElement.style.removeProperty('--sidebar-width');
      const stage = document.getElementById('stage-slideover-sidebar');
      if (stage) stage.style.removeProperty('--sidebar-width');

      if (!enabled) {
        sidebarWidthStyleEl.textContent = '';
        document.documentElement.classList.remove('cgfm-sidebar-width-enabled', 'cgfm-sidebar-width-active');
        return;
      }
      ensureSidebarWidthStyle(px + 'px');
      syncSidebarWidthClass();
    } catch (err) {
      console.warn(APP_NAME, 'apply sidebar width failed', err);
    }
  }

  function computeSyncStatus() {
    const w = getProfile().settings.webdav || {};
    if (!w.enabled || !normalizeWebdavFolderUrl(w.url)) return 'off';
    if (syncStatus === 'syncing' || syncStatus === 'error') return syncStatus;
    if (dirtySincePush) return 'dirty';
    return 'idle';
  }

  function syncStatusTitle() {
    const w = getProfile().settings.webdav || {};
    const st = computeSyncStatus();
    if (st === 'off') return 'WebDAV：未启用';
    if (st === 'syncing') return 'WebDAV：正在同步';
    if (st === 'dirty') return 'WebDAV：有本地改动，等待自动备份';
    if (st === 'error') return 'WebDAV：上次同步失败' + (w.lastError ? '：' + w.lastError : '');
    return 'WebDAV：已同步' + (w.lastPushAt ? '，上次推送 ' + shortTime(w.lastPushAt) : '');
  }

  function setSyncStatus(status) {
    syncStatus = status || 'off';
    updateSyncStatusIcon();
  }

  function updateSyncStatusIcon() {
    const el = rootEl && rootEl.querySelector('[data-sync-status]');
    if (!el) return;
    const st = computeSyncStatus();
    el.className = 'cgfm-icon cgfm-sync-status cgfm-sync-' + st;
    const title = syncStatusTitle();
    el.title = title;
    el.setAttribute('aria-label', title);
  }

  function ensureSettingsModal() {
    if (modalEl && document.body.contains(modalEl)) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'cgfm-modal-backdrop';
    modalEl.className = 'cgfm-modal-backdrop';
    modalEl.hidden = true;
    modalEl.innerHTML = `
      <div class="cgfm-modal" role="dialog" aria-modal="true">
        <h2>WebDAV 备份</h2>
        <div class="cgfm-modal-row"><input id="cgfm-dav-enabled" type="checkbox"><span>本地修改后自动备份</span></div>
        <label for="cgfm-dav-url">WebDAV 文件夹地址</label><input id="cgfm-dav-url" type="text" placeholder="https://example.com/dav/chatgpt-folders">
        <div style="margin:6px 0 8px;color:var(--text-secondary,#777);font-size:12px">当前账号文件：<span id="cgfm-dav-file"></span></div>
        <label for="cgfm-dav-username">用户名</label><input id="cgfm-dav-username" type="text" autocomplete="username">
        <label for="cgfm-dav-password">密码 / 应用密码</label><input id="cgfm-dav-password" type="password" autocomplete="current-password">
        <label for="cgfm-dav-debounce">自动备份延迟（毫秒）</label><input id="cgfm-dav-debounce" type="number" min="1000" step="1000">
        <label for="cgfm-dav-interval">定时备份检查间隔（分钟）</label><input id="cgfm-dav-interval" type="number" min="1" step="1">
        <hr style="border:0;border-top:1px solid rgba(128,128,128,.22);margin:14px 0">
        <h2>界面</h2>
        <div class="cgfm-modal-row"><input id="cgfm-sidebar-width-enabled" type="checkbox"><span>自定义左侧侧边栏宽度</span></div>
        <div class="cgfm-sidebar-width-grid"><input id="cgfm-sidebar-width-range" type="range" min="240" max="520" step="1"><span id="cgfm-sidebar-width-label" class="cgfm-sidebar-width-badge">312px</span></div>
        <p style="margin:10px 0 0;color:var(--text-secondary,#777)">性能优先：WebDAV 只填写文件夹路径，脚本会按当前 ChatGPT 账号自动使用不同 JSON 文件。文件夹按 Intl.Collator 排序，对话保持加入顺序。</p>
        <div class="cgfm-modal-actions">
          <button id="cgfm-dav-push" type="button">立即推送</button>
          <button id="cgfm-dav-pull" type="button">立即拉取</button>
          <button id="cgfm-dav-test" type="button">测试连接</button>
          <button id="cgfm-dav-cancel" class="cgfm-cancel-btn" type="button">取消</button>
          <button id="cgfm-dav-save" class="cgfm-primary-btn" type="button">保存</button>
        </div>
      </div>`;
    document.body.appendChild(modalEl);
    bindSettingsModalEvents();
    return modalEl;
  }

  function modalById(id) { return modalEl && modalEl.querySelector('#' + id); }

  function bindSettingsModalEvents() {
    const byId = modalById;
    const updateWidthLabel = () => {
      const px = clamp(Number(byId('cgfm-sidebar-width-range').value || DEFAULT_SIDEBAR_WIDTH_PX), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX);
      byId('cgfm-sidebar-width-label').textContent = px + 'px';
      return px;
    };
    const applyWidthFromControls = () => {
      const enabled = !!byId('cgfm-sidebar-width-enabled').checked;
      const px = updateWidthLabel();
      applySidebarWidth(enabled, px);
      settingsWidthPreviewApplied = true;
    };
    byId('cgfm-sidebar-width-range').addEventListener('input', updateWidthLabel);
    byId('cgfm-sidebar-width-range').addEventListener('change', applyWidthFromControls);
    byId('cgfm-sidebar-width-range').addEventListener('pointerup', applyWidthFromControls);
    byId('cgfm-sidebar-width-enabled').addEventListener('change', applyWidthFromControls);
    byId('cgfm-dav-url').addEventListener('input', () => { byId('cgfm-dav-file').textContent = currentWebdavFileName(); });
    byId('cgfm-dav-cancel').addEventListener('click', cancelSettingsModal);
    byId('cgfm-dav-save').addEventListener('click', saveSettingsModal);
    byId('cgfm-dav-push').addEventListener('click', () => runSettingsButton('cgfm-dav-push', () => webdavPush(true)));
    byId('cgfm-dav-pull').addEventListener('click', () => runSettingsButton('cgfm-dav-pull', () => webdavPull(true)));
    byId('cgfm-dav-test').addEventListener('click', () => runSettingsButton('cgfm-dav-test', testWebdavFromModal));
    modalEl.addEventListener('click', event => { if (event.target === modalEl) cancelSettingsModal(); });
  }

  function fillSettingsModal() {
    ensureSettingsModal();
    const p = getProfile();
    const w = p.settings.webdav || {};
    const byId = modalById;
    byId('cgfm-dav-enabled').checked = !!w.enabled;
    byId('cgfm-dav-url').value = w.url ? normalizeWebdavFolderUrl(w.url).replace(/\/$/, '') : '';
    byId('cgfm-dav-file').textContent = currentWebdavFileName();
    byId('cgfm-dav-username').value = w.username || '';
    byId('cgfm-dav-password').value = w.password || '';
    byId('cgfm-dav-debounce').value = String(w.debounceMs || DEFAULT_DEBOUNCE_MS);
    byId('cgfm-dav-interval').value = String(Math.max(1, Math.round((w.intervalMs || DEFAULT_INTERVAL_MS) / 60000)));
    const enabled = !!p.settings.ui.sidebarWidthEnabled;
    const px = clamp(Number(p.settings.ui.sidebarWidthPx || DEFAULT_SIDEBAR_WIDTH_PX), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX);
    settingsModalSnapshot = { sidebarWidthEnabled: enabled, sidebarWidthPx: px };
    settingsWidthPreviewApplied = false;
    byId('cgfm-sidebar-width-enabled').checked = enabled;
    byId('cgfm-sidebar-width-range').value = String(px);
    byId('cgfm-sidebar-width-label').textContent = px + 'px';
  }

  function showSettings() {
    fillSettingsModal();
    modalEl.hidden = false;
  }

  function cancelSettingsModal() {
    if (settingsWidthPreviewApplied && settingsModalSnapshot) applySidebarWidth(settingsModalSnapshot.sidebarWidthEnabled, settingsModalSnapshot.sidebarWidthPx);
    closeModal();
  }

  function saveSettingsModal() {
    const p = getProfile();
    const byId = modalById;
    const w = Object.assign({}, p.settings.webdav || {});
    w.enabled = !!byId('cgfm-dav-enabled').checked;
    w.url = byId('cgfm-dav-url').value.trim();
    w.username = byId('cgfm-dav-username').value;
    w.password = byId('cgfm-dav-password').value;
    w.debounceMs = Math.max(1000, Number(byId('cgfm-dav-debounce').value || DEFAULT_DEBOUNCE_MS));
    w.intervalMs = Math.max(60000, Number(byId('cgfm-dav-interval').value || 15) * 60000);
    p.settings.webdav = w;
    p.settings.ui.sidebarWidthEnabled = !!byId('cgfm-sidebar-width-enabled').checked;
    p.settings.ui.sidebarWidthPx = clamp(Number(byId('cgfm-sidebar-width-range').value || DEFAULT_SIDEBAR_WIDTH_PX), MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX);
    applySidebarWidth();
    restartPeriodicBackup();
    closeModal();
    updateSyncStatusIcon();
    setTimeout(() => schedulePersist('settings'), 0);
    toast('设置已保存。');
  }

  async function runSettingsButton(buttonId, task) {
    const btn = modalById(buttonId);
    if (!btn || btn.disabled) return;
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '处理中…';
    try { await task(); }
    finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  async function testWebdavFromModal() {
    try {
      setSyncStatus('syncing');
      const tmp = { url: modalById('cgfm-dav-url').value.trim(), username: modalById('cgfm-dav-username').value, password: modalById('cgfm-dav-password').value };
      if (!normalizeWebdavFolderUrl(tmp.url)) throw new Error('Missing WebDAV folder URL');
      const body = JSON.stringify(exportPayload(getProfile()), null, 2);
      const res = await getOrCreateDavJson(tmp, body);
      setSyncStatus('idle');
      toast(res.created ? '测试连接成功：已创建当前账号文件。' : '测试连接成功：当前账号文件已存在。');
    } catch (err) {
      setSyncStatus('error');
      toast('测试连接失败：' + safeError(err));
    }
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
    settingsModalSnapshot = null;
    settingsWidthPreviewApplied = false;
  }

  async function webdavPush(manual) {
    persistNow({ webdav: false });
    const p = getProfile();
    const w = p.settings.webdav || {};
    if (!manual && !w.enabled) return;
    if (!normalizeWebdavFolderUrl(w.url)) { if (manual) toast('请先填写 WebDAV 文件夹地址。'); return; }
    try {
      setSyncStatus('syncing');
      w.lastStatus = 'pushing...';
      const body = JSON.stringify(exportPayload(p), null, 2);
      const res = await putDavJson(w, body);
      w.lastPushAt = nowIso();
      w.lastStatus = 'push OK ' + res.status + ' at ' + shortTime(w.lastPushAt);
      w.lastError = '';
      dirtySincePush = false;
      setSyncStatus('idle');
      schedulePersist('webdav-push-ok', { webdav: false, touch: false });
      if (manual) toast('WebDAV 推送完成：' + currentWebdavFileName());
    } catch (err) {
      w.lastError = safeError(err);
      w.lastStatus = 'push failed';
      setSyncStatus('error');
      schedulePersist('webdav-push-fail', { webdav: false, touch: false });
      if (manual) toast('WebDAV 推送失败：' + w.lastError);
      else console.warn(APP_NAME, 'auto WebDAV push failed', err);
    }
  }

  async function webdavPull(manual) {
    const p = getProfile();
    const w = p.settings.webdav || {};
    if (!normalizeWebdavFolderUrl(w.url)) { if (manual) toast('请先填写 WebDAV 文件夹地址。'); return; }
    try {
      setSyncStatus('syncing');
      const localBody = JSON.stringify(exportPayload(p), null, 2);
      const res = await getOrCreateDavJson(w, localBody);
      if (res.created) {
        w.lastPullAt = nowIso();
        w.lastStatus = 'remote created ' + res.status + ' at ' + shortTime(w.lastPullAt);
        w.lastError = '';
        dirtySincePush = false;
        setSyncStatus('idle');
        schedulePersist('webdav-create-ok', { webdav: false, touch: false });
        if (manual) toast('远程账号文件不存在，已创建：' + currentWebdavFileName());
        return;
      }
      const data = JSON.parse(res.responseText || '{}');
      const profile = data.profile || data;
      if (!profile || !profile.folders || !profile.conversations) throw new Error('远程 JSON 不是有效配置。');
      if (manual && !confirm('用远程 WebDAV JSON 替换当前本地文件夹数据？不会删除 ChatGPT 原聊天。')) return;
      const currentWebdav = JSON.parse(JSON.stringify(w));
      const normalized = normalizeProfile(profile, p.id, p.label);
      normalized.id = p.id;
      normalized.label = p.label;
      const remoteWebdav = normalized.settings.webdav || {};
      normalized.settings.webdav = Object.assign({}, remoteWebdav, {
        url: currentWebdav.url,
        username: currentWebdav.username,
        password: currentWebdav.password,
        lastPullAt: nowIso(),
        lastStatus: 'pull OK ' + res.status + ' at ' + shortTime(nowIso()),
        lastError: ''
      });
      state = normalized;
      if (!state.folders[selectedFolderId]) selectedFolderId = ROOT_ID;
      dirtySincePush = false;
      setSyncStatus('idle');
      queueRender();
      applySidebarWidth();
      restartPeriodicBackup();
      schedulePersist('webdav-pull-ok', { webdav: false, touch: false });
      if (manual) toast('WebDAV 拉取完成：' + currentWebdavFileName());
    } catch (err) {
      w.lastError = safeError(err);
      w.lastStatus = 'pull failed';
      setSyncStatus('error');
      schedulePersist('webdav-pull-fail', { webdav: false, touch: false });
      if (manual) toast('WebDAV 拉取失败：' + w.lastError);
    }
  }

  // ---------------------------------------------------------------------------
  // 10. WebDAV network operations and deferred backup scheduling
  // ---------------------------------------------------------------------------

  function scheduleAutoBackup(reason) {
    const p = getProfile();
    const w = p.settings.webdav || {};
    if (!w.enabled || !normalizeWebdavFolderUrl(w.url)) { updateSyncStatusIcon(); return; }
    if (pendingWebdavTimer) clearTimeout(pendingWebdavTimer);
    const delay = Math.max(3000, Number(w.debounceMs || DEFAULT_DEBOUNCE_MS));
    pendingWebdavTimer = setTimeout(() => {
      pendingWebdavTimer = null;
      if (dirtySincePush) webdavPush(false);
    }, delay);
  }

  function restartPeriodicBackup() {
    if (periodicWebdavTimer) clearInterval(periodicWebdavTimer);
    periodicWebdavTimer = null;
    const w = getProfile().settings.webdav || {};
    if (!w.enabled || !normalizeWebdavFolderUrl(w.url)) return;
    const interval = Math.max(60000, Number(w.intervalMs || DEFAULT_INTERVAL_MS));
    periodicWebdavTimer = setInterval(() => { if (dirtySincePush) webdavPush(false); }, interval);
  }

  function davRequest(method, url, body, settings, extraHeaders) {
    return new Promise((resolve, reject) => {
      const headers = Object.assign({}, extraHeaders || {});
      if (settings && settings.username) headers.Authorization = 'Basic ' + base64(settings.username + ':' + (settings.password || ''));
      GM_xmlhttpRequest({
        method,
        url,
        data: body || undefined,
        headers,
        timeout: 30000,
        onload: res => {
          if (res.status >= 200 && res.status < 300) resolve(res);
          else {
            const err = new Error(method + ' failed with HTTP ' + res.status + ' ' + (res.statusText || ''));
            err.status = res.status;
            err.statusText = res.statusText || '';
            err.responseText = res.responseText || '';
            reject(err);
          }
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timed out'))
      });
    });
  }

  function base64(str) { return btoa(unescape(encodeURIComponent(str))); }

  // ---------------------------------------------------------------------------
  // 10b. Same-browser multi-tab synchronization
  // ---------------------------------------------------------------------------

  function setupCrossTabStorageSync() {
    if (storageSyncBound) return;
    storageSyncBound = true;
    const current = currentStorageRevisionInfo();
    if (current.revision) lastSeenStorageRevision = current.revision;

    // Some userscript managers or old installations may not expose this API even if
    // the grant is present. The feature must degrade silently; it must never block mount().
    if (typeof GM_addValueChangeListener !== 'function') {
      console.info(APP_NAME, 'GM_addValueChangeListener is unavailable; multi-tab sync disabled.');
      return;
    }

    try {
      // Performance-first design: listen only to the tiny revision key. The large
      // STORAGE_KEY is read and parsed only after a newer revision is observed.
      GM_addValueChangeListener(REVISION_KEY, (_key, _oldValue, newValue, remote) => {
        if (!remote) return; // Ignore this tab's own write.
        const meta = parseRevisionMeta(newValue);
        const rev = meta.revision;
        const writer = meta.writer;
        if (!rev || writer === TAB_ID || !isRevisionNewer(rev, lastSeenStorageRevision)) return;

        if (crossTabApplyTimer) clearTimeout(crossTabApplyTimer);
        crossTabApplyTimer = setTimeout(() => {
          crossTabApplyTimer = null;
          maybeApplyNewerStoredProfile('external-change');
        }, 300);
      });
    } catch (err) {
      console.warn(APP_NAME, 'GM_addValueChangeListener failed; multi-tab sync disabled.', err);
    }
  }

  // ---------------------------------------------------------------------------
  // 11. Low-cost remount checks and boot
  // ---------------------------------------------------------------------------

  function toast(message) {
    const old = document.querySelector('.cgfm-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'cgfm-toast';
    el.textContent = String(message || '');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function isVisibleElement(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && el.getClientRects().length > 0;
    } catch (_) {
      return false;
    }
  }

  function nativeSidebarContentVisible() {
    try {
      const sidebar = document.getElementById('stage-slideover-sidebar') || document;
      const history = document.getElementById('history');
      if (history && !history.closest('[inert]') && isVisibleElement(history)) return true;

      // Keep this check intentionally narrow. Do not querySelectorAll() every chat link:
      // sidebar open/close and sleep-resume checks should not scan the whole Recent list.
      const closeBtn = sidebar.querySelector('[data-testid="close-sidebar-button"]');
      if (closeBtn && !closeBtn.closest('[inert]') && isVisibleElement(closeBtn)) return true;

      const oneNativeChat = sidebar.querySelector('a[href^="/c/"], a[href*="/c/"]');
      if (oneNativeChat && !(rootEl && rootEl.contains(oneNativeChat)) && !oneNativeChat.closest('[inert]') && isVisibleElement(oneNativeChat)) return true;
    } catch (_) {}
    return false;
  }

  function officialSidebarExpanded() {
    const sidebar = document.getElementById('stage-slideover-sidebar');
    if (!sidebar) return true;

    // After Windows/Firefox sleep restore, ChatGPT can briefly show tiny-bar remnants
    // while the expanded history area is already visible. Prefer visible native history
    // content / close button over the tiny-bar signal to avoid keeping our root hidden.
    if (nativeSidebarContentVisible()) return true;

    const closeBtn = sidebar.querySelector('[data-testid="close-sidebar-button"]');
    if (closeBtn && closeBtn.getAttribute('aria-expanded') === 'true' && isVisibleElement(closeBtn)) return true;

    const tiny = document.getElementById('stage-sidebar-tiny-bar');
    if (tiny && !tiny.hasAttribute('inert') && isVisibleElement(tiny)) return false;

    const openBtn = sidebar.querySelector('button[aria-label*="打开边栏"],button[aria-label*="Open sidebar"],button[aria-label*="open sidebar"]');
    if (openBtn && !openBtn.closest('[inert]') && isVisibleElement(openBtn) && openBtn.getAttribute('aria-expanded') === 'false') return false;
    return true;
  }

  function syncSidebarVisibility() {
    const expanded = officialSidebarExpanded();
    if (rootEl) rootEl.hidden = !expanded;
    syncSidebarWidthClass(expanded);
  }

  function scheduleSidebarVisibilityCheck() {
    // Debounce sidebar animation checks. Firefox may emit multiple resize/click-related
    // events during ChatGPT's sidebar transition; avoid accumulating timer storms.
    sidebarVisibilityTimers.forEach(timer => clearTimeout(timer));
    sidebarVisibilityTimers = [80, 220, 500, 900].map(delay => setTimeout(() => {
      try { syncSidebarVisibility(); }
      finally { /* timers are cleared/replaced on the next schedule */ }
    }, delay));
  }

  function scheduleResumeRecovery(reason) {
    // Sleep / tab restore is not a full page load, so Tampermonkey does not rerun boot().
    // Run a short, sparse self-healing window after focus/pageshow/visibilitychange.
    // No long-running observer, no interval, and each check is the same lightweight mount check.
    resumeRecoveryTimers.forEach(timer => clearTimeout(timer));
    resumeRecoveryTimers = [];
    [0, 200, 800, 2000, 5000, 10000, 15000].forEach(delay => {
      const timer = setTimeout(() => {
        try {
          maybeApplyNewerStoredProfile('resume-' + reason);
          ensureMountedLight();
        }
        finally {
          resumeRecoveryTimers = resumeRecoveryTimers.filter(t => t !== timer);
        }
      }, delay);
      resumeRecoveryTimers.push(timer);
    });
  }

  function bindSidebarToggleWatcher() {
    if (sidebarToggleBound) return;
    sidebarToggleBound = true;
    document.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[aria-controls="stage-slideover-sidebar"], [data-testid="close-sidebar-button"]')) scheduleSidebarVisibilityCheck();
    }, true);
    window.addEventListener('resize', scheduleSidebarVisibilityCheck, { passive: true });
  }

  function ensureMountedLight() {
    try {
      const beforeAccount = currentAccount && currentAccount.id;
      ensureActiveProfile();
      const afterAccount = currentAccount && currentAccount.id;
      const recent = findHistorySection();
      const expectedParent = (recent && recent.parentElement) || findSidebarParent();
      const rootMissing = !rootEl || !document.body.contains(rootEl);
      const parentChanged = !!(rootEl && expectedParent && rootEl.parentElement !== expectedParent);

      if (rootMissing || parentChanged) mount();
      else {
        setupNativeDragCache();
        setupNativeMenuHook();
        applySidebarWidth();
        syncSidebarVisibility();
        // If sleep restore left the root hidden while the native history area is visible,
        // unhide it after syncSidebarVisibility has had a chance to update width classes.
        if (rootEl && rootEl.hidden && nativeSidebarContentVisible()) rootEl.hidden = false;
        if (beforeAccount && afterAccount && beforeAccount !== afterAccount) queueRender();
      }
    } catch (err) {
      console.warn(APP_NAME, 'ensure mount failed', err);
    }
  }

  function boot() {
    try {
      state = loadState();
      ensureActiveProfile();
      lastSeenStorageRevision = currentStorageRevisionInfo().revision || getProfileStorageRevision(state);
      setupCrossTabStorageSync();
      bindSidebarToggleWatcher();
      // Sparse finite remount checks. This fixes normal-refresh/bookmark-open cases where
      // ChatGPT hydrates or lazily creates the sidebar after the userscript has already run.
      // There is no long-running observer; each check is lightweight and becomes a no-op once mounted.
      [700, 1500, 2800, 4800, 8000, 13000, 21000, 34000, 55000, 90000].forEach(delay => setTimeout(ensureMountedLight, delay));
      const idle = window.requestIdleCallback || (fn => setTimeout(fn, 3500));
      idle(() => { try { ensureSettingsModal(); } catch (_) {} });
      restartPeriodicBackup();
      window.addEventListener('beforeunload', () => flushPendingPersist(false));
      window.addEventListener('pagehide', () => flushPendingPersist(false));
      window.addEventListener('focus', () => scheduleResumeRecovery('focus'), { passive: true });
      window.addEventListener('pageshow', () => scheduleResumeRecovery('pageshow'), { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) flushPendingPersist(false);
        else scheduleResumeRecovery('visibilitychange');
      }, { passive: true });
    } catch (err) {
      console.error(APP_NAME, 'boot failed', err);
    }
  }

  boot();
})();

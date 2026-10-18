# ChatGPT 文件夹：当前架构、维护规范与历史决策

## v1.4.8（2026-10-17）：拖拽目标统一、移动事务与回退保护

- 插件内 HTML5 拖拽保留；放置目标除文件夹标题行外，也识别相应文件夹块中的子节点与已有对话，按最近的文件夹块确定目标；不再要求必须精准落在文件夹标题行。
- 「最近对话 → 文件夹」「文件夹内对话 → 文件夹」「文件夹 → 文件夹」统一经过 `commitDropPayload`：提交前结清待保存编辑、检查较新的跨标签状态，修改业务归属后**立即**保存本地 GM 数据（WebDAV 仍异步）。不再等 850ms 才保存拖拽移动。
- 如果提交时恰逢另一标签页写入了不同业务状态，`persistNow` 先接管较新状态、再仅重放本次拖拽移动；不把整份过期快照写回。若来源或目标已不存在，明确提示失败，避免伪成功。
- WebDAV 正在请求期间发生本地业务变化时，不得用该次过期网络响应直接接管内存状态；放弃该轮并由后续自动同步处理，避免“刚移动成功就恢复原样”。
- 回归重点：三种拖拽、拖到文件夹已有聊天上、合法与非法嵌套、跨标签几乎同时移动、WebDAV 同步中拖动、F5 后归属保持、行内改名和编辑锁恢复。
- 这是同浏览器多标签的乐观冲突处理，并非跨设备严格原子事务；WebDAV 同步冲突仍由原 schema 3 操作日志与合并规则管理。


## v1.4.7（2026-10-17）：最近对话 API 缓存与限流保护

- 主动 API 同步仅在独立面板由关闭转为打开时尝试，优先展示现有本地最近对话缓存；成功后 30 分钟内不重复拉取。数据发现仍可通过官方侧栏的 DOM 采集补充。
- 每次最多发送 **1 次** `/backend-api/conversations?limit=20&offset=0` 请求；合并新 20 条与旧缓存，绝不因空结果抹除历史记录。该取舍意味着一次新设备启动无法单靠 API 获取第 21～100 条未收录的历史对话。
- `429` 后退避 30 分钟、1 小时、2 小时、4 小时（上限 4 小时），如服务器 `Retry-After` 更长则优先遵守（上限解析为 24 小时）；网络异常/5xx/响应格式错误休眠 10 分钟；401/403 沿用现有认证缓存失效处理并冷却 10 分钟。成功重置连续限流次数。
- 冷却、刷新时间和 15 秒短期租约使用 Tampermonkey GM 存储，**按 ChatGPT accountId 隔离**，F5 和同浏览器多个标签页共享。租约采用写入后延迟复核，并非严格原子锁；并发标签在极端竞态下仍可能同时请求，不承诺绝对互斥。仅保存时间和次数，不写入 token、Cookie 或会话内容。
- 不新增设置项、不改变 7 天最近对话内容缓存、WebDAV schema 3、行内重命名或纯插件内拖拽；不自动轮询、不在 429 后立即重试。
- 回归：频繁开关面板、F5、两个标签同开、网络断线、429 含/不含 `Retry-After`、接口空数组、账号切换、旧对话继续保留、标题保护和编辑状态；网络 API 行为需在真实 Chrome/Tampermonkey 验证。


## v1.4.6（2026-10-17）：插件内拖拽放置链路加固

- 拖放事件改由 `#cgfm-root` 捕获阶段处理 `dragenter` / `dragover` / `drop`，避免嵌套交互元素截断事件传播时仅看到原生拖动预览、没有完成插件提交。仅在本插件创建有效拖动负载后接受放置；保留目标文件夹的合法性判定和原来的业务移动函数。
- **拖动源 DOM 不可被中途替换**：有效插件拖动期间延后 `render()`、`queueRender()` 和 `updateRecentDom()` 可能执行的结构性重绘；`dragend` / `drop` 后安全释放拖动锁，并在需要时补一次渲染。这样官方最近对话采集与 API 响应不会打断 HTML5 DnD 的节点生命周期。
- 非法放置位置有明确提示，只有放置在可接受的文件夹行上才会提交；不同文件夹移动仍遵守不能移入自己、子级的既有规则。拖拽结束、Esc 和安全超时仍负责释放状态。
- 回归重点：最近对话 → 文件夹、文件夹内对话 → 另一个文件夹、文件夹 → 另一个文件夹；过程中恰好触发最近对话刷新；拖入无效区域、取消与越过面板；编辑框和浮层关闭行为。
- 根因说明：日志已证明 `dragstart` 和部分 `drop` 事件存在，且曾出现拖动至目标但未提交的情况；“冒泡阶段被阻断”与“拖动节点遭刷新替换”为防御性修复的两个风险点，未经过真实浏览器验证其为唯一根因。


## v1.4.5（2026-10-17）：行内编辑目标与编辑锁稳定性修复

- **根因**：同一 conversation ID 可能同时存在于已归类文件夹和最近对话；v1.4.4 的 `beginChatRename(id)` 使用 `.find()` 选择第一个匹配的 DOM 行，可能误将编辑器挂入隐藏的文件夹行，用户看到“无响应”，但编辑会话把面板锁定为展开。
- **修复**：点击编辑按钮或右键菜单时直接传递当前事件命中的行节点，按该行定位输入框，而非重新按 ID 查找；检查节点仍属于文件夹面板、ID 对应、已连接、非隐藏且有布局矩形，再允许编辑。
- **锁定规则**：仅在编辑节点确实连接后设置会话；意外移除时恢复行拖拽/按钮状态并清除锁，延后渲染在退出编辑时恢复。
- **保持**：Enter / Esc、中文 IME、保存失败留稿、单会话、服务端真实 POST、标题来源保护、现行独立侧栏和 WebDAV schema 3 均不改变。
- **测试**：同一对话同时在折叠文件夹与最近列表存在时，点击最近列表编辑，应在当前行出现输入框；展开文件夹后在文件夹行编辑同一对话也应就地显示。连续切换 A/B/C、Esc、失焦、保存失败、F5、面板离开自动关闭均须验证。



## v1.4.4（2026-10-17）：稳定的对话行内重命名

- **现行交互**：点击文件夹内或「最近对话」行的重命名图标、或右键对应对话，原位将标题链接替换为单行输入框，旁边提供保存（勾）与取消（叉）按钮。不再使用覆盖页面的独立重命名弹窗。
- 使用唯一 `chatRenameDialog` 会话对象管理 `row/link/edit/input/busy`。编辑中的对话行不可拖拽；面板显隐锁始终依据实际连接的输入框判断。切换编辑目标会取消旧会话；保存中不可切换。
- **防销毁约束**：编辑期间延后全量 `render()` 和对应「最近对话」的列表替换；保留编辑草稿及 DOM 焦点，退出会话后恢复必要渲染。不要恢复 v1.2.x 中会销毁输入框的直接重绘路径。
- Enter 保存（输入法组合中不提交）、Esc 取消；失焦不自动保存。保存失败保留输入、解除禁用后允许重试；成功必须先收到官方 POST 成功响应，继续按账号应用 v1.3.2 以来的标题保护。
- 仅修改标题编辑 UI/会话，不改变 v1.4.3 的纯插件内 HTML5 DnD、官方历史采集、认证缓存、WebDAV schema 3、账号隔离或官方 React 侧栏 DOM。
- **回归重点**：最近对话和文件夹内分别重命名；连续切换 A/B/C；中文输入法 Enter；Esc/叉取消；失焦不提交；失败重试；编辑期间触发缓存更新；编辑行禁止拖拽；取消或保存后面板自动收起；F5 后授权恢复、旧标题防回退。


## v1.4.3（2026-10-17）：移除官方对话拖拽兼容桥

- **现行边界**：仅支持自定义文件夹面板内的 HTML5 DnD——「最近对话 → 文件夹」「已归类对话 → 其他文件夹」「文件夹 → 文件夹」。不再从官方 ChatGPT 侧边栏直接拖入文件夹。
- 删除官方会话 `pointerdown/move/up` 全局捕获、点击回放、原生 `dragstart/dragend` 拦截、临时 `draggable` 属性、释放保护、预览及相关状态和计时器。不得重新引入阻断官方点击的事件桥。
- 只在 `#cgfm-root` 上绑定拖拽事件；`dragend`、`drop`、Escape 及 30 秒超时负责恢复面板拖拽锁、视觉高亮与拖拽状态。其他来源的外部链接不再解析为待归类对话。
- **保留的官方集成**：官方侧栏的最近对话 DOM 读取、官方菜单入口、认证上下文捕获与 API、标题保护。`extractChatFromNativeElement` 仍由最近对话 DOM 采集调用，不能随官方拖拽一起删除。
- 未改变文件夹归属、WebDAV schema 3、GM 认证缓存和独立弹窗重命名方式；行内重命名属于下一轮 v1.4.4，不在本次修改。
- 回归重点：三类插件内拖拽成功与取消；跨文件夹移动无重复；悬浮面板拖动时保持展开、拖动结束可自动收起；官方对话正常点击、右键、选中和原生拖拽行为不受脚本干扰；最近对话、重命名、F5 后授权和 WebDAV 正常。


> **现行版本：v1.4.5（对话行内重命名）**。本文件的第一部分是唯一现行规范；后面的历史档案仅记录曾经的实现和实验，历史文段中“当前”“应当”等词**不适用于现行版本**。
> 源码：`userscripts/chatgpt/chatgpt-folders.user.js`；仍是可直接安装的**单个 Tampermonkey `.user.js`**，无构建环节。
> v1.4.0 清理历史遗留并整理文档；v1.4.1 收敛面板、重命名与标题状态；v1.4.2 清理无调用延迟检查、减少无效 DOM 替换并改善观察器宿主重建恢复。

## 1. 现行设计与边界

- **独立面板**：`#cgfm-root` 是 `document.body` 的直属子节点；入口放在 `#app-shell-sidebar` 的导航 rail 中，悬浮打开、点击固定，收起时不改变官方 sidebar 的 React 状态。文件夹与最近对话共用一个滚动区，面板默认宽度 300 CSS px。
- **不控制官方侧栏**：不主动展开、固定官方侧栏，不强制修改 `inert`，不模拟鼠标悬浮，也不直接修改官方 React 对话标题 DOM。用户看到官方侧栏暂时保留旧标题，不代表服务器重命名失败。
- **文件夹数据**：按 ChatGPT 账号隔离的内存 profile 是业务数据源；目录结构、对话引用和设置持久化在本地，并按既有 schema 3 的 WebDAV 操作日志、基准快照、墓碑、冲突合并策略同步。**禁止**顺手改变持久化键、归属语义或 WebDAV 协议。
- **最近对话**：来自官方 sidebar DOM 采集、按账号隔离的短期本地缓存，以及在存在有效授权上下文时主动请求的官方历史接口；最近列表最多 100 条，不代表用户全部聊天。只在独立面板从关闭转为打开时主动刷新（不轮询）。不保存聊天正文。
- **重命名**：使用官方 `POST /backend-api/conversation/id/{id}/rename`；成功响应后更新插件的最近对话及文件夹标题。编辑使用插件对话行内的单一输入会话，保存失败保留内容，编辑期间禁止销毁编辑行。
- **标题保护**：`DOM` 和旧本地缓存均不是权威标题来源，不能覆盖脚本成功 POST 保存的标题；可信、时序合适的服务器请求才可核实后续变更。账号隔离的标题保护在刷新后仍有效；仅依靠旧 DOM 不得回退。
- **认证**：从页面自然产生的 `/backend-api/` 请求获取必要认证上下文；v1.3.3 起有按账号隔离、最长 24 小时的 Tampermonkey GM 认证头缓存，用于 F5 后尝试恢复。收到 401/403 时清除相应缓存；无法恢复时仅在需要权限的操作中提示。不会自动展开官方栏。此缓存包含敏感 Bearer Token，**不得进入**网页 localStorage、WebDAV、导入导出或日志；GM 存储并非加密保险箱。
- **拖拽**：仅支持插件独立面板内部的 HTML5 DnD；不得重新引入官方对话的 pointer 捕获、点击回放或原生拖拽桥。

## 2. 各组件的所有权与数据优先级

| 子系统 | 来源 / 所有者 | 可持久化 | 必须遵守的边界 |
|---|---|---|---|
| 官方导航 rail | ChatGPT React | 否 | 只插入脚本入口，不接管官方面板 |
| 文件夹浮层 | 脚本，body 直属根节点 | UI 状态不参与 WebDAV | 不随原生 sidebar 重渲染销毁 |
| 文件夹及对话归属 | 当前账号 profile | 本地 + WebDAV schema 3 | 不覆盖他人账号、不改变现有冲突协议 |
| 最近对话列表 | DOM / 官方 API / 按账号缓存 | 有期限的本地缓存 | 不能用旧 DOM 覆盖受保护标题 |
| 已确认标题 | 服务器保存结果 + 后续可靠核实 | 按账号本地保护 | 区分 DOM 与服务器结果和请求时序 |
| 认证上下文 | 官方请求与 GM 缓存 | 本地 GM，最多 24 小时 | 禁止跨账号复用或导出凭证 |
| 编辑与拖拽会话 | 用户输入、事件处理 | 否 | 可靠结束，解除关闭锁和定时器 |

## 3. 启动与关键交互流程

1. `document-start` 注册必要的官方聊天手势捕获；DOM 具备后启动并创建脚本持有的浮层。
2. 从当前 ChatGPT 账号恢复业务 profile；只在可验证账号一致时恢复已有的 GM 认证模板。
3. 导航入口悬停或点击时展示浮层，并根据实际 rail 位置定位；官方 React 重建时尝试恢复入口。
4. 从 DOM/缓存展示最近聊天；有可用认证时在“由关闭变打开”时刷新历史 API。不靠官方栏展开才能显示已有数据。
5. 发起重命名时显示独立对话框；POST 成功后本地标题受保护，不能被仍陈旧的官方 sidebar DOM 改回去。
6. 拖拽、编辑、菜单等暂时活动需避免面板意外收起；操作结束释放相应锁并核对实际悬浮。

## 4. 已知限制与安全要求

- ChatGPT 的 DOM 与 `/backend-api/` 均属于非公开实现，官方更新后仍可能失效；不保证官方 React 侧栏立即显示由脚本保存的新标题。
- GM 认证缓存可改善 F5 体验，但会在本机保留敏感令牌；令牌可能提前失效，24 小时只是本地缓存上限。用户此前明确要求**暂不增加**认证缓存开关或清理按钮。
- DOM/缓存采集可能缺少未加载或较旧的历史；API 返回空数组时不能直接清空已有缓存。
- 多设备标题变更必须经过可靠的新服务器结果才能覆盖旧保护；跨设备同步不等于实时推送。
- WebDAV 账号、凭证、冲突解决策略和旧文件兼容不可随意调整。

## 5. 审计与本轮低风险清理（v1.4.0）

- 源码基线来自私有仓库 `main`，经完整文件 Git Blob SHA 校验；只涉及当前 `.user.js` 及本 `.md`。
- 清理确认无调用的早期侧栏嵌入宿主定位函数、稳定挂载判定、旧 WebDAV push 兼容别名、旧文件夹拖拽命中封装、旧原生侧栏监听入口及它们独占的观察器状态。
- 清理只声明不读取、或仅写不读取的旧双列侧栏指针、宽度、定时器和编辑延后状态；现行挂载、最近对话 API、重命名、标题保护、认证缓存、WebDAV schema 与拖拽主逻辑不调整。
- 静态不可达不必然意味着可删：对复杂 DnD、跨标签同步、WebDAV 和被动态事件间接引用的代码保守保留；下一轮架构整理需在浏览器实际回归后推进。
- 检查只覆盖语法、静态引用、版本一致性与 ZIP 完整性，**不等于完成浏览器功能回归**。

## 6. 第二轮内部重构（v1.4.1）

- **单文件不拆分**：仍以 `chatgpt-folders.user.js` 直接分发。只整理原有函数职责，没有引入构建系统或新的外部库。
- **面板状态**：`panelHasVisibilityHold()` 将固定按钮、编辑会话、面板内部拖拽及原生对话拖拽统一判断；`shouldShowFolderPanel()` 再加入入口与面板悬浮状态。`scheduleFolderClose()` 与 `syncSidebarVisibility()` 共用这套规则，减少多个散落的显隐表达式。
- **编辑生命周期**：以 `chatRenameDialog` 内的会话对象及其 `busy` 作为编辑真值来源；删去与其并行维护的 `editingChatId`、`renameChatBusy`。重命名弹层仍只有一个，提交失败仍保留弹层，成功与取消仍解除锁。
- **标题数据流**：增加 `reconcileConversationTitles(items, source, requestStartedAt)` 作为列表级入口；服务器/API 结果保留来源与请求时序，DOM、缓存、渲染仅作为显示候选。沿用原有 `guardConversationTitle()` 判定规则，不改变保护持久化格式和跨设备核实语义。
- **最近列表缓存**：统一 `persistRecentCache()` 写入操作，重命名成功与列表合并共用同一持久化路径；键、缓存字段、TTL 和最多 100 条限制不变。
- **不修改内容**：WebDAV schema 3、认证 GM 缓存、ChatGPT 官方端点、拖拽核心手势、官方侧栏 React DOM 和 UI 外观都保持原样。
- **验收说明**：静态语法与结构核验并不能替代真实浏览器测试。要特别核实：连续编辑、保存期间锁、悬浮关闭、官方旧标题不回退、WebDAV 及认证恢复。

## 7. 第三轮事件与性能审查（v1.4.2）

- 以 v1.4.1 私有仓库 `main` 的完整文件为基线（Git Blob SHA `a98276489439ff7beddeb4aa4e726870687dc2e0`），继续保持单文件、原 WebDAV schema、认证缓存、标题一致性和原生拖拽手势不变。
- **已清理**：无实际调用入口的 `scheduleSidebarVisibilityCheck()`、其四组延迟触发逻辑及专用 `sidebarVisibilityTimers`。此删除不改变实际已注册事件，因为该函数在 v1.4.1 中不再被引用。
- **最近对话 DOM**：`updateRecentDom()` 发现输出 HTML 与当前列表完全一致时不替换列表子节点，避免无意义地重置原生 DOM 状态；仍保留焦点保护与既有渲染结果。
- **观察器恢复**：`watchRecentListChanges()` 检查旧观察宿主的连接状态，避免已脱离页面的节点阻止新的观察器绑定。仍只观察官方最近对话宿主，没有引入全局常驻 subtree 观察。
- **审计后保留**：官方原生对话拖拽的 window capture 监听、短期 Radix 菜单观察、按用户操作启动的 WebDAV 检查以及 focus/pageshow 后有限恢复窗口。这些都承担现行功能，不因为表面数量多而盲目移除。
- **静态回归审查**：核对 JS 语法、元数据/运行版本一致性、删除代码无残留引用、脚本头部及 WebDAV 关键协议常量；这些检查不能替代真实浏览器、跨账号或 WebDAV 并发场景的动态验证。
- **推荐实测**：官方侧栏多次展开/收起、最近对话更新/重命名、文件夹面板悬停与点击固定、官方聊天拖拽和取消、F5 认证恢复、旧标题防回退、WebDAV 上传/下载和多标签同步。

## 8. 完整回归清单

- **本轮已完成**：显隐状态判断收敛、编辑会话单一来源、最近对话标题批量协调与缓存写入统一；暂不重写 WebDAV 与原生聊天手势。
- **第三轮已完成**：针对可确定的无调用定时器和重复 DOM 替换做保守优化；未对需要浏览器验证的拖拽/菜单事件做激进删减。
- **每轮必须测试**：F5 后悬浮展开 → 悬浮官方栏再返回 → 点击固定/关闭 → 连续编辑 A/B/C → 中文输入及保存失败 → 本地标题保护 → 官方最近对话拖拽与取消 → 同账号多标签/跨账号隔离 → WebDAV 上传、下载和冲突场景。
- **发布**：行为或可执行代码变更提升 `@version` 和 `VERSION`；保留 `@name` / `@namespace` 以及私有源标准 Raw metadata。ZIP 只放涉及文件、位于 `payload/` 的原仓库相对路径；同时给出 `userscript-cyan-release/main` 的带新缓存穿透参数的直接安装链接，未发布前不得声称链接已有新版本。发布后再做浏览器回归。

## 9. 历史方案、证据和放弃原因（快速决策记录）

| 阶段 | 尝试与现象 | 最终决策 |
|---|---|---|
| v0.6–v0.8 | 直接插入官方 React 侧栏，hydration/remount 导致插件 DOM 消失；多次针对官方列表手势适配 | 当前 UI 不再挂入官方聊天列表，仅入口附着 rail |
| v0.9.x | 双列悬浮、拦截 `mouseout`、尝试修改 `inert` 或模拟原生侧栏固定；状态同步复杂、易影响第一列 | 明确废弃，不恢复官方侧栏控制桥 |
| v1.0–v1.1 | 独立 body-owned 浮层、共用滚动区及拖拽锁 | 作为现行架构基础 |
| v1.2.0–v1.2.2 | 内联聊天标题输入框受列表重绘影响，出现悬浮抖动、锁状态不释放 | 改为独立编辑器会话 |
| v1.3.0–v1.3.1 | 删除旧编辑函数时残留调用，使官方侧栏展开后最近列表更新抛异常 | 删除所有残留调用；增加静态引用检查 |
| v1.3.0–v1.3.2 | 官方 DOM 旧标题覆盖刚 POST 成功的新标题；24 小时保护仍有数据来源混淆 | 明确来源分级和服务端核实时序，不用旧 DOM 解锁保护 |
| v1.3.3 | F5 清空内存授权，第一次需要展开官方栏；无授权的普通 GET 曾返回 200 但空列表 | 捕获自然页面请求，辅以账号隔离、限时 GM 认证缓存 |
| 官方 React 即时同步研究 | 官方原生重命名只观察到 POST，现有链接元素原位变更；未发现可稳定调用的公开缓存更新接口 | 不直接篡改官方 React DOM；优先保证插件自身标题一致性 |

> 上述决策记录区分“已通过用户实际测试的现象”和“对内部 React 状态的推测”。不应把未验证的内部实现描述为已证实事实。完整实验过程保留在下一节原始历史档案中。

---

## 附录：历史维护说明原文（仅供考古，不适用现行实现）

以下为 v0.x–v1.3.3 历史文档原文，**全部视为历史材料**。其中所有写作当时的“现行”“唯一”“不要保存 Token”等断言，均应以本文件前述现行规范和实际 v1.4.2 源码为准。保留这些材料是为了理解尝试过的方案，不是建议重新启用它们。

# v1.1.0 独立面板：统一滚动与拖拽锁（2026-10-17）

- 文件夹树与最近对话顺序排列在同一个 `.cgfm-scroll-content` 内，仅使用一个纵向滚动条；工具栏固定。重新渲染时保留滚动位置。
- 面板内原生拖拽使用 `ownedDragActive` 锁，禁止悬停收起；`dragend`、`drop`、Escape、30 秒安全超时释放。官方最近对话拖拽的既有兼容路径仍保留。
- 导航文件夹 icon 使用琥珀金 `#E5A000`，尺寸保持不变。
- 观察官方最近对话已加载 DOM 的变动，并以 250ms 防抖采集；不保证未加载历史或跨设备实时完整性。
- 真实对话重命名使用经验证的 ChatGPT 官方接口；不做仅修改本地显示名称的虚假重命名。
- 保持已有数据键、WebDAV schema 及归属语义；不再操纵原生侧栏展开状态。

# v1.0.0 独立文件夹面板（2026-10-17）

- **架构替换**：官方导航栏 `nav[data-app-navigation-rail="true"]` 内新增独立文件夹按钮；悬停打开、点击锁定、再次点击解锁，离开入口与面板后约 220ms 自动收起，Esc 可关闭普通面板。
- **不干预 ChatGPT 原生侧边栏**：不调用官方展开按钮，不解除 `inert`，不拦截 `mouseout`，不依据官方固定/悬浮状态决定面板是否显示。独立面板作为 `document.body` 的持久根节点，覆盖正文而不改变其布局宽度。
- **位置**：独立面板以官方导航 rail 的实际右边界定位（一般 52px），宽度 300px；如果官方聊天侧栏固定展开，文件夹浮层可能临时覆盖其内容，但不会触发重新排版。
- **内容**：原文件夹树、归属、拖拽、右键、WebDAV 均保留；新增「最近对话（已发现）」区域，支持拖进文件夹。仅采集官方页面已加载的对话 DOM 和最多 100 条、7 天过期的按账号本地缓存。此列表不代表账号全部最近对话；不读取聊天正文，不调用未验证的 ChatGPT 私有 API，缓存不参与 WebDAV 同步。
- **兼容**：文件夹入口由独立恢复逻辑维护，React 重建 rail 时重插按钮，不重建持久文件夹根节点。面板状态是临时 UI 状态，不写入 WebDAV。
- **注意**：当前版本仍保留若干原生侧栏拖动和宽度选项的原业务代码；今后可在确认新交互稳定后独立清理。未在用户 Chrome 环境完成真实交互验收。

---

# v0.9.3 双列原生切换实验说明（2026-10-17）

- 保持 `#cgfm-root` 为 `document.body` 的持久子节点；不修改 WebDAV、存储键与文件夹操作。
- 移除 v0.9.2 对原生 `inert` 的强制解除和强制可见 CSS。
- 鼠标从原生悬浮列进入文件夹列时，若明确处于 `data-slate-sidebar-peeking=true` 且官方内容未收起，临时调用原生“显示/隐藏侧边栏”按钮；延迟核实官方真实展开，不反复重试。
- 鼠标离开整个双列范围后，仅在确认切换属于脚本本次事务且官方仍处于固定展开时调用原生按钮恢复。用户原本处于固定模式时不切换。
- **风险与局限**：ChatGPT 可能持久化原生侧边栏开关，点击可能导致正文重排。跨列状态及自动恢复尚须 Chrome 实测；浏览器崩溃、强制关闭可能使恢复未发生。程序化原生点击不是官方 API。版本仅作实验，实测失败时应回滚。

---

# ChatGPT 文件夹：架构与维护说明

> 对应脚本：`userscripts/chatgpt/chatgpt-folders.user.js`  
> 当前说明版本：v0.9.2  
> 面向对象：未来维护者、代码审查者，以及需要快速接手该脚本的 AI  
> 定位：本文件是 ChatGPT 文件夹脚本的**完整架构与维护说明源**；脚本头部只保留必要摘要。


## v0.9.2 跨列悬停兼容桥（实验性，待 Chrome 验收）

- 已通过浏览器日志确认：鼠标移到第二列时官方 `:hover` 丢失，React 随后进入收起流程；单纯用 CSS 强制显示无法保证内容可交互。
- 删除 v0.9.1 的全局 `mouseout` / `pointerout` 拦截及人工事件转发。该机制无可靠保障且可能影响官方交互。
- 本版采用**有限作用域的原生内容交互桥**：仅当脚本确认鼠标位于文件夹列、且不是固定模式时，维持官方内容外观，并在 React 将当前原生内容设置为 `inert` 时临时解除它；鼠标离开双列后释放，官方收起时恢复 `inert`。
- bridge 只跟踪当前原生内容节点，不移动/克隆官方 React DOM，不触碰文件夹数据、存储键、WebDAV、账号切换逻辑。文件夹节点继续挂在 `document.body`。
- **重要限制：** 这是针对非公开 DOM 行为的兼容桥，并不等于真正改变 React 内部 peeking 状态；官方可能因 React 更新、布局裁切、点击处理或未来网站改版继续出现第一列失效。尤其要实测第一列从第二列返回后能否点击、拖拽、正常关闭，以及固定模式是否正常。出现异常时请回滚，不应叠加模拟鼠标事件来掩盖。

## v0.9.1 双列悬停与拖拽显示修复（待 Chrome 实测）

- 修复文件夹列 `pointerleave` 立即清除悬停状态、数据更新后又依据官方栏 `inert` 收起的状态竞争；双列范围内的指针位置现在参与可见性判定。
- 在官方列转入文件夹列的边界，捕获并隔离与悬停收起相关的 `mouseout`/`pointerout`，避免官方 React 把跨列移动直接当作离开整个双列区域；在确实离开整个区域后尝试转发 `mouseout`，让 React 恢复原生关闭逻辑。
- 文件夹节点继续由 `document.body` 持有，数据写入/渲染不应销毁根节点；WebDAV 格式与存储键不变。
- **限制：** React 内部悬停实现不属于用户脚本公开接口，事件拦截及转发属于兼容适配，浏览器实测前不能保证官方栏所有跨列操作均正常。尤其要测试官方侧栏是否能正常自动收起、固定模式、右键菜单及拖拽；若实测不稳定，应回滚而非继续堆叠模拟事件。

## v0.9.1 当前生效架构：body-owned 双列面板

> **以下为现行架构规范，优先于本文后续 v0.8.x 及更早章节。** 后续章节中的“Recents 之前挂载”“hydration-safe 挂载到侧栏”“root 随宿主恢复”仅用于理解历史实现，不应再按其修改当前代码。

- 第一列为 ChatGPT 原生 sidebar，第二列 `#cgfm-root.cgfm-dual-pane` 是 `document.body` 直属子节点。两列分别滚动。
- 文件夹第二列宽度暂固定 **300 CSS px**；原设置“自定义左侧侧边栏宽度”只用于官方侧栏，不再兼任文件夹宽度。
- 官方侧栏提供 `#app-shell-sidebar` 的宽度参考；`[data-slate-sidebar-content]` 的 `inert` 和 `[data-slate-sidebar-peeking]` 作为可见性/固定性信号。通过少量属性与 ResizeObserver 更新面板位置，而**不再据此重挂载**。
- 鼠标跨列时，`pointerenter`/`pointerleave` 保持文件夹列显隐；利用 `cgfm-dual-hover-hold` 做官方第一列视觉保持，并在 v0.9.2 中以限定生命周期的交互桥临时解除 `inert`。这并未改变 React 的真实悬浮状态，属于**浏览器必须验证**的兼容点。
- 文件夹的滚动位置、展开状态不因 sidebar peeking 变化而重置；切换账号所需的业务重绘逻辑保留。WebDAV schema、profile key、revision、操作日志、拖拽 payload 均不变。
- 固定展开模式下，当前第二列作为覆盖层紧邻第一列；对正文和 Composer 的真正响应式空间预留需要基于实际 app-shell 布局作浏览器验收，避免未经验证就修改所有 `main` 节点。
- 文件夹根节点仅在丢失或重新加载页面时恢复。渲染方式保留原 `render()` 和用户交互，后台同步不依赖视图显隐。

### 发布前浏览器验收（尚未通过真实浏览器验证）

1. 悬浮侧栏展开/关闭、从第一列移到第二列并停留、移出两列，确认第一列不会发生不可用的 inert 状态。
2. 固定模式下确认第二列不会遮挡正文/Composer，且用户能够顺畅操作两列。
3. 拖拽原生最近对话到多级文件夹（特别是第一列先收起的场景）；测试取消与无效放置。
4. 再打开多个对话及进行 WebDAV 同步，确认 DOM 根节点不重新创建且旧数据未变。

---

## 1. 30 秒快速理解

`chatgpt-folders.user.js` 是一个 Tampermonkey 用户脚本，在 ChatGPT 官方左侧侧边栏旁显示独立的第二列“文件夹”区域，用来整理普通聊天链接。

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
3. `#cgfm-root` 是脚本唯一主 UI 根节点；v0.9.1 起始终作为 `document.body` 直属子节点，不嵌入任何 ChatGPT 官方 React 区域。
4. 手势监听在 `document-start` 尽早注册；DOM/state boot 延后至 DOMContentLoaded，UI 根节点不再依赖原生侧栏 hydration 稳定门槛。
5. 原生宿主探测必须排除脚本自己的 DOM，且永远不能把根节点挂到自身或其后代。
6. 性能优先：不长期观察整个 document/sidebar subtree，不给最近聊天逐项注入常驻 UI；仅允许对 app-shell left panel 的 peeking 属性与 conversation content 的 inert 属性做窄范围 attributes observer。
7. 新版原生 conversation row 拖入文件夹使用完整手势所有权的低开销自定义拖拽：手势层在 `document-start` 注册 window capture，实际处理仅在 `#cgfm-root` 已挂载后启用；聊天主交互的 pointerdown 从起点即由脚本 `preventDefault()` + `stopImmediatePropagation()` 独占，小于阈值时在 pointerup 主动回放原生聊天点击，大于阈值时进入脚本拖拽；不再依赖 `setPointerCapture()`。旧 `/c/` anchor 和脚本自身文件夹仍保留 HTML5 drag/drop。
8. 原生聊天三点菜单只在用户实际点击后短暂观察 Radix `role="menu"` / `role="menuitem"`。
9. 同浏览器多标签使用小 revision key 事件驱动同步；metadata-only revision 不得覆盖本标签未保存业务修改。
10. WebDAV 使用 schema 3、基准快照、对象级 operation log、墓碑和有限 412 重试实现多端合并。
11. WebDAV 凭据仅保存在本地；远端/导出数据不得包含密码、token、cookie。
12. 修改行为、DOM 生命周期、同步或数据模型时，应同步更新本文件。

### 1.1 系统数据流

```text
ChatGPT 原生 sidebar / conversation list / menu
          │
          ├─ 新版 conversation exclusive pointer gesture / legacy drag-drop / 三点菜单入口
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
7. 新版 conversation row 的独占 pointer 手势自定义拖拽与 legacy anchor 的聊天 drag/drop；
8. 文件夹拖拽移动；
9. ChatGPT 原生聊天三点菜单“移至文件夹”；
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

新版 ChatGPT 将“最近”包装为独立 section，并在其外层挂了官方 conversation/project drop target。脚本必须把文件夹放在**整个 Recents wrapper 之前**，而不是插入 Recents section 的标题和聊天列表之间：

```text
[data-app-action-sidebar-scroll]
  ├─ Projects section
  ├─ #cgfm-root                              ← 脚本
  └─ [data-chatgpt-project-conversation-drop-target]
      └─ [data-sidebar-project-container-id="chats"]
          └─ section[data-app-action-sidebar-section-heading="Recents"]
              ├─ “最近”标题
              └─ conversation list
```

这样“最近”标题仍与原生聊天保持一个整体，同时 `#cgfm-root` 不会落进 ChatGPT 官方 drop zone，避免官方 drop handler 抢走拖入文件夹的 `drop`。

旧 UI 仍保留 `#history` / `/c/` anchor 回退。不要把根节点挂到 `#stage-slideover-sidebar` 过外层的位置，否则官方 sidebar 收起时脚本可能残留或继续占宽度。

ChatGPT 2026-09 新 UI 中，`#app-shell-sidebar` 是**常驻 navigation rail 与 conversation sidebar 的共同外壳**，不是文件夹的合法挂载宿主。conversation sidebar 本体由 `[data-slate-sidebar-content="true"]` 标识；新版 fallback 只能使用其内部 `[data-app-action-sidebar-scroll]` 这类原生内容区，绝不能把 `#cgfm-root` 搬到常驻账号 rail 下方。

2026-09-29 的新版 app-shell 不再是简单的“展开 / 收起”二态，而是三态：

```text
rail-only
  left panel 只占 navigation rail 宽度
  [data-slate-sidebar-content] 仍可能存在，但带 inert

peeking
  left panel 带 data-slate-sidebar-peeking="true"
  conversation content 去掉 inert 并悬浮显示
  left panel 仍只占 rail 的页面布局宽度

pinned
  无 data-slate-sidebar-peeking
  conversation content 可交互
  left panel 占完整 sidebar 布局宽度
```

因此 `aria-expanded` 不再用于区分 peeking / pinned：实测两种状态都可能为 `true`。文件夹是否显示取决于 conversation content 是否处于 rail-only；自定义 sidebar width 只允许在 pinned 时激活，peeking 必须保持 overlay-only，避免 hover 时正文布局跳动。

### 7.2 原生宿主探测

`findHistorySection()` / `findSidebarParent()` 的语义是：**只寻找 ChatGPT 原生宿主**。

关键不变量：

- 新版优先使用 `[data-sidebar-chatgpt-conversation-key^="chatgpt:conversation:"][role="listitem"]` 识别原生聊天；
- conversation id 直接从 `data-sidebar-chatgpt-conversation-key` 提取；新版标题/主交互优先读 `a[data-interactive-row-link][href*="/c/"]` 的 `aria-label`，旧版 `role="button"` 仅作回退；
- 脚本自身生成的 `.cgfm-chat-title` `/c/` 链接不能作为 legacy fallback；
- `findNativeChatLink()` 必须排除 `rootEl` 内链接；
- 旧版 fallback 应尽量限制在原生 sidebar/nav 语义范围；
- `#app-shell-sidebar` 以及 `[data-app-navigation-rail]`（含其后代）都不是合法 mount parent；
- 新版无 Recents/聊天行时，可使用 `[data-app-action-sidebar-scroll]` 作为可收起 conversation sidebar 的可信 fallback；
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

### 7.4 app-shell 三态监听、宿主替换与即时恢复

新版 hover peeking 不一定触发 sidebar toggle click。仅监听 `data-slate-sidebar-peeking` 与 `inert` 会漏掉 ChatGPT 替换 conversation content / scroll 宿主，或原生 React 单独移除脚本根节点的情况；有限的稀疏重试无法在长期打开的标签页里及时修复。

v0.8.2 保留两个极窄的 attributes-only observer，并增设 **一个结构 observer**，只对左侧 app-shell 稳定祖先、conversation content 通往 shell 的直接祖先以及 `[data-app-action-sidebar-scroll]` 注册 `{ childList: true }`，**不启用 subtree**，不遍历 Recents 聊天行或监控 `document.body`。结构回调只有在 root 已脱离、宿主被替换或 root 脱离可信滚动宿主时才发起恢复检查；`requestAnimationFrame` 合并重复事件。重建宿主后重新绑定这些观察目标。

`ensureMountedLight()` 在根节点仍存在且宿主未变时仅更新拖拽/菜单 hooks、宽度和显隐；被移除或宿主发生变化时才重新调用 `mount()`，继续复用原有 `#cgfm-root`。首次 mount 才全量渲染；已有完整内容的恢复挂载不清空重绘文件夹树，从而减少 hover 时闪烁。首次 hydration-safe 的 1200ms 稳定等待不变。

### 7.5 首次挂载与 React hydration

脚本从 v0.7.8 起使用 `@run-at document-start`，但这**只用于尽早注册不改 DOM 的手势 capture listener**；DOM/state `boot()` 仍延后到 `DOMContentLoaded`。无论何种 run-at，DOM ready 都不等于 React hydration 已完成。

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

### 7.6 稀疏挂载检查

boot 使用有限延迟检查：

```text
0.7s, 1.5s, 2.8s, 4.8s, 8s, 13s, 21s, 34s, 55s, 90s
```

另外在以下事件后启动短窗口恢复：

- `window.focus`
- `pageshow`
- `visibilitychange` 恢复可见
- sidebar toggle 后少量延迟检查

禁止为了“更稳”恢复观察整个 sidebar/document subtree 的 MutationObserver；v0.8.2 的结构监听仅观察少量原生宿主的直属子节点变化，且回调必须先确认根节点/宿主失效。

### 7.7 设置弹窗预创建

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

### v0.8.2：悬浮侧边栏文件夹恢复修复

- 监听 app-shell 关键宿主的直接子节点替换，以发现原生 conversation subtree 或脚本 `#cgfm-root` 被卸载；不观察全局 subtree。
- 结构变化仅在根节点脱离或宿主不再匹配时触发合帧恢复；重绑原有 peeking / inert 观察器。
- 恢复挂载继续复用已经渲染的文件夹根节点，避免每次 React 替换宿主都执行 `innerHTML` 全量重绘。
- 保持 v0.8.1 拖拽修复、三态宽度策略及首次 hydration-safe 延迟机制不变。

### v0.8.1：聊天拖拽提交一致性修复

- `renderChat()` 为脚本文件夹内聊天行提供明确的 HTML5 `draggable` 来源，并禁止内层 anchor 抢走原生拖拽起点；`onRootDragStart()` 为聊天建立 `kind: "chat"` 的内部 payload 与 `dataTransfer`，排除独立操作按钮，避免出现浏览器拖拽预览正常但没有有效聊天 payload 的情况。
- `onRootDragOver()` 只在已有已验证的文件夹/聊天 payload 且目标可接收时高亮，取消以“未知聊天”提前高亮的行为；`onRootDrop()` 在同一份 payload 上再次验证并提交，避免高亮与提交条件分离。
- `commitDropPayload()` 返回成功标志，`dropCommitted` 仅在实际提交成功后标记，避免失败事件被误认为完成。
- 新版 Recent 自定义 pointer 拖拽仍优先在 `pointerup` 坐标重新命中；若瞬间重新命中失败，只在上次高亮的合法目标行仍连接且释放点落在其可视区域（允许 4px 边界误差）时回退，不向其他位置误投放。
- 原有账号隔离、WebDAV schema、本地键、rail/peeking/pinned 生命周期均不变。

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
- 拖拽移动只改变层级，不主动修改 `selectedFolderId`：原本未选中的文件夹移动后仍未选中，原本已选中的文件夹移动后继续保持选中；
- 拖入目标文件夹时保持目标原有 `collapsed` 状态：折叠目标继续折叠，展开目标继续展开；
- 不使用 mousemove 自定义拖动。

### 9.4 聊天拖入

聊天 payload：

```text
{ kind: "chat", id, title, url }
```

新版 conversation row 拖入文件夹使用**完整手势所有权的独占 pointer 自定义拖拽**：

1. 手势 capture listener 在 `document-start` 注册到 window，确保注册顺序尽量早于 ChatGPT 后续 sortable sensor；但在 `mounted === true`、`#cgfm-root` connected 且可见之前立即 return，不干扰 hydration/初始页面交互；
2. pointerdown 从 `data-sidebar-chatgpt-conversation-key` row 读取 conversation id，并优先从 `a[data-interactive-row-link]` 读取标题/主交互元素；只有真正的聊天主交互区域才能建立候选，点击菜单、置顶等独立 `button` 不建立聊天拖拽候选；
3. 对真正的聊天主交互 pointerdown 从起点同时执行 `preventDefault()` 与 `stopImmediatePropagation()`，使整条候选手势不再交给 ChatGPT 的 sortable/link 默认路径；这一步不修改 DOM，只改变当前手势所有权；
4. 同一候选手势的 pointermove 以及兼容 mousedown/mousemove/mouseup 都由 window capture 阻断，避免 MouseSensor 或 sortable 在中途重新武装；不再调用 `setPointerCapture()`；移动距离未超过 6px 时只保持候选，超过阈值后才创建预览并开始 hover/hit-test；
5. 活动拖拽期间 window capture 的 pointermove/mousemove 由脚本完整占有，并通过 `requestAnimationFrame` 限流到每帧最多一次视觉预览位置更新与 hit-test；
6. 激活拖拽时只创建一个 `position: fixed; pointer-events: none` 的浮动聊天预览，显示聊天图标和单行标题；其位置只通过 `translate3d()` 跟随鼠标，不移动或克隆进 React 列表布局；每次 hit-test 使用 `document.elementsFromPoint()` / `elementFromPoint()` 从坐标下方寻找 `#cgfm-root` 内的 `.cgfm-folder-row`，命中后显示脚本自己的 hover；
7. pointerup 时：若已超过阈值，则按最终坐标重新确认目标，命中文件夹后直接调用既有 `addChatToFolder()`；若从未超过阈值，则脚本主动对原生 `a[data-interactive-row-link]` / legacy 主交互执行一次 click replay，从而保留普通点击导航；两条路径的 pointerup 都不再传给 ChatGPT 的拖拽传感器；
8. 拖拽和 click replay 都保留约 350ms 的 release guard，并短暂屏蔽源 conversation row 可能随后生成的真实 click；脚本自身回放 click 通过单次 replay guard 放行，避免被自己的 click suppression 吃掉；
9. 未超过阈值的普通点击不再依赖浏览器原始 click 是否生成，而是由脚本在 pointerup 明确回放一次原生聊天主交互，因此点击语义与拖拽判定解耦。

性能约束：

- 不给每条 Recent conversation 注入常驻监听器；只使用少量 document/window 级事件委托；
- 无活动拖拽时 `pointermove` / `mousemove` 第一时间 return，不执行 DOM 查询；
- 只有用户实际拖动的短时间窗口执行坐标 hit-test和浮动预览 transform 更新，而且每动画帧最多一次；
- 不增加观察 document/body/sidebar subtree 的长期 MutationObserver、轮询或持续 sidebar 扫描；唯一例外是 7.4 所述两个 attributes-only app-shell 状态 observer。

兼容路径仍保留 HTML5 drag/drop：

- 脚本自身“文件夹 → 文件夹”及“文件夹内聊天 → 文件夹”拖拽使用带显式 payload 的 HTML5 DnD；
- 旧版 `/c/` anchor 仍可按需临时设置 `draggable=true`；
- 新版 anchor-based / button-based conversation row 都不设置 `draggable=true`；
- root-level dragover/drop 与 dragend fallback 只服务脚本文件夹拖拽和 legacy/浏览器兼容路径。

拖入聊天只改变聊天归属，不主动修改目标文件夹的 `collapsed`：目标原本折叠则继续折叠，原本展开则继续展开。通过原生三点菜单“移至文件夹”添加聊天时也复用同一 `addChatToFolder()` 语义。

## 10. ChatGPT 原生三点菜单集成

用户点击原生聊天的“聊天操作”按钮后：

1. 新版从所在 conversation row 记录当前 conversation；旧版 `data-conversation-options-trigger` 仍作回退；
2. 短暂启动 MutationObserver 捕捉 Radix `[role="menu"][data-radix-menu-content]`；
3. 优先通过菜单的 `aria-labelledby` 与触发按钮 id 绑定，无法绑定时再用“分享 / 重命名 / 归档 / 删除”等 `role="menuitem"` 文案识别聊天菜单；
4. 复用一个原生 `role="menuitem"` 的 class 作为“移至文件夹”入口样式基底；
5. 悬停/focus 时显示脚本自己的多级文件夹浮层；
6. 选择文件夹后添加聊天引用；
7. 捕捉成功或约 1.8 秒超时后立即 disconnect。

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

1. 新版先找同 conversation row 中的 `a[data-interactive-row-link][href*="/c/"]`，旧版主 `role="button"` 次之，再回退普通 `/c/<id>` anchor；
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

sidebar toggle 后使用少量延迟检查（约 80/220/500/900ms），不要高频监听布局。新版 `aria-controls="app-shell-sidebar"` toggle 也必须纳入监听；每次延迟检查复用 `ensureMountedLight()`，因为收起/展开过程中 ChatGPT 可能直接移除并重建可收起 conversation subtree。

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

账号稳定键优先 accountId，其次 email。`#client-bootstrap` 仍是首选来源；bootstrap 暂时不可用时，先读取 `document.documentElement` 上新版 ChatGPT 已暴露的 `data-theme-account-id` / `data-theme-user-id`，其中 account id 可直接复用为稳定 profile key。只有这些强标识也不可用时，才回退到旧 `[data-testid="accounts-profile-button"]` 或新版 `button[aria-label*="个人资料菜单"]` / 英文 profile-menu 按钮的标签与头像信息。

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
  "version": "0.7.3",
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

1. 长期 `MutationObserver` 观察 `document.body`、整个 sidebar 或 conversation subtree；仅允许 7.4 所述 peeking/inert attributes-only 窄范围 observer；
2. 长期 `mousemove` 热路径；
3. 给原生 conversation list 每一条聊天注入常驻 button/icon/wrapper；
4. hover 原生 conversation row 时扫描完整聊天列表；
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

允许的 observer：仅用户主动打开原生聊天三点菜单后的短时 Radix 捕捉，成功或超时立即断开。

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
6. 文件夹移动不会形成循环，且拖拽移动不会无故改变当前选中高亮或目标文件夹折叠状态；
7. 原生聊天三点菜单“移至文件夹”正常且 observer 会停止；
8. 文件夹聊天点击优先走原生 conversation button / SPA 导航；
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
6. ChatGPT DOM 是外部依赖；当前新版依赖 `data-app-action-sidebar-section-heading="Recents"`、`data-sidebar-chatgpt-conversation-key`、`a[data-interactive-row-link]` 和 Radix `role=menu/menuitem`，旧聊天 `role=button`、`#history` / `/c/` anchor 仅作兼容回退；修改 selector 时必须继续保留 native-only 和 hydration-safe 两条原则。

## 30. 历史决策与版本演进

### v0.3.x：交互与性能路线稳定

- 放弃为 Recent 每项注入气泡/常驻按钮；
- 不使用长期运行或逐行绑定的 mousemove 拖拽系统；v0.7.4 起只在用户实际按下新版 conversation row 的短暂手势窗口中启用 window-capture 拖拽处理，并用 `requestAnimationFrame` 限流；v0.7.5 起从 pointerdown 阶段即阻断 ChatGPT sortable sensor，避免释放后出现延迟原生拖拽。
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

### v0.6.5：文件夹移动保持选中状态语义

- `moveFolderToFolder()` 不再在移动成功后强制执行 `selectedFolderId = sourceId`；
- 拖到其他文件夹或拖到顶部“文件夹”标题返回根目录时，只改变文件夹层级，不把被移动文件夹自动设为选中；
- 若文件夹移动前本来已被用户选中，则因 `selectedFolderId` 保持不变，移动后仍继续选中；
- 修复“未选中文件夹拖回根目录后持续出现 `cgfm-selected` 色块”的问题。

### v0.6.6：拖拽保持目标折叠状态

- `moveFolderToFolder()` 不再为了接收子文件夹而强制展开目标文件夹；
- `addChatToFolder()` 不再为了接收聊天而强制展开目标文件夹；
- 拖拽只改变层级或聊天归属，目标文件夹原本折叠则保持折叠、原本展开则保持展开；
- 主动“新建子文件夹”仍保留自动展开父文件夹的行为，确保新建内容立即可见。

### v0.7.0：适配新版 ChatGPT sidebar 与聊天菜单

- 原生聊天主识别从旧 `#history` / `/c/<id>` anchor 迁移到 `data-sidebar-chatgpt-conversation-key="chatgpt:conversation:<id>"` + `role="listitem"`；
- conversation id 直接从 row key 提取，标题优先读取 row 内主 `role="button"` 的 `aria-label`；
- 聊天拖拽改为 row/anchor 双路径，仅在实际拖拽前临时设置 `draggable=true`；
- 三点菜单适配新版 `button[aria-label="聊天操作"][aria-haspopup="menu"]` 与 Radix `role="menu"` / `role="menuitem"`；
- 账号 fallback 增加新版“打开个人资料菜单”按钮，`#client-bootstrap` 仍保持首选；
- 普通聊天 URL 继续使用 `/c/<conversation-id>`，本地 profile、WebDAV schema 和同步数据模型不变；
- 旧 `#history`、旧 `/c/` anchor 与旧 menu trigger 仅保留为兼容回退。

### v0.7.1：Recents 挂载位置与拖拽提交修复

- `#cgfm-root` 改为插在整个 `Recents` 官方 wrapper 之前，不再插入“最近”标题和聊天列表之间；
- 文件夹因此脱离 ChatGPT 自己的 `data-chatgpt-project-conversation-drop-target`，避免官方 drop handler 抢占拖入文件夹事件；
- 新增 document capture `drop`：落点在脚本文件夹内时，优先使用 pointerdown 缓存的 conversation payload，并阻止外层官方 drop handler 接管；
- 根节点 `drop` 与 dragend 继续作为兼容兜底，旧 `/c/` anchor 拖拽路径继续保留。

### v0.7.2：新版 conversation pointer bridge

- 保持 `#cgfm-root` 位于整个 `Recents` wrapper 之前；
- 新版 `data-sidebar-chatgpt-conversation-key` row 不再强制切换 `draggable=true`，避免与 ChatGPT 自己的 sortable/drag system 竞争；
- pointerdown 缓存 conversation 与坐标，移动超过 6px 后由 `elementFromPoint()` 自行命中文件夹并显示 hover；
- pointerup 命中文件夹时直接调用既有 `addChatToFolder()`，不依赖 `dataTransfer` 或官方 drop zone；
- 脚本自身文件夹拖拽和 legacy `/c/` anchor 继续保留 HTML5 DnD 兼容路径。

### v0.7.3：document capture drag bridge

- 保持 `#cgfm-root` 位于整个 `Recents` wrapper 之前；
- 撤回 v0.7.2 的 pointermove/pointerup bridge，因为 ChatGPT 自己开始拖拽后不会可靠继续分发这条 pointer 事件链；
- pointerdown 只负责缓存 conversation payload；拖拽期间改由 document capture `dragover` / `drop` 接管脚本文件夹区域；
- `dragover` / `drop` 通过 `elementsFromPoint()` 按坐标穿透可能的拖拽 overlay，命中脚本文件夹后自行显示 hover、允许 drop 并提交缓存 conversation；
- 只有落点位于 `#cgfm-root` 文件夹时才 `preventDefault()` / `stopPropagation()`，不改变 ChatGPT Projects/Recents 自身拖拽行为；
- 三点菜单、profile、WebDAV、cross-tab 与业务数据模型保持不变。

### v0.7.4：pointer-capture custom drag

- 保持 `#cgfm-root` 位于整个 `Recents` wrapper 之前；
- 放弃依赖 ChatGPT native drag 的 `dragover`/`drop` bridge；新版 conversation row 改为一次性 pointer-capture 手势；
- pointerdown 只建立临时 drag candidate，移动超过 6px 才激活，普通点击不受影响；
- 激活后取消该 conversation 的 native `dragstart`，避免 ChatGPT sortable 抢走后续 pointer 事件；
- 活动拖拽期间由 window capture 先于 ChatGPT document/root handler 接管 pointermove，并用 `requestAnimationFrame` 将 `elementsFromPoint()` 命中限制为每帧最多一次，实现文件夹 hover；
- pointerup 直接按最终坐标调用 `addChatToFolder()`，并释放 capture、清除 hover、短暂抑制源聊天 click；
- 无活动拖拽时 pointermove 不做 DOM 工作；没有新增轮询或长期 observer；
- 脚本自身文件夹 DnD、legacy `/c/` anchor、三点菜单、profile、WebDAV、cross-tab 与业务数据模型保持不变。

### v0.7.5：gesture ownership / release suppression

- 保留 v0.7.4 已验证可用的 pointer-capture 文件夹拖入与 `requestAnimationFrame` hit-test；
- 新版 conversation row 的 pointerdown 改到 window capture，并从手势起点停止传播给 ChatGPT sortable sensor，但不 `preventDefault()`，普通点击仍由浏览器正常产生；
- 同步拦截该候选手势的 mousedown，避免 MouseSensor 旁路重新武装原生拖拽；
- 激活拖拽后对 pointermove/mousemove/pointerup 使用完整手势所有权（`stopImmediatePropagation`），防止 ChatGPT 在中途或释放阶段重新接管；
- 自定义拖拽结束后增加约 350ms release guard，隔离 mouseup/mousemove/延迟 dragstart，并继续短暂抑制源 row click，修复“松手后原生对话才开始跟随鼠标”的残留拖拽；
- 无候选/活动手势时新增 mouse 监听均立即 return，不执行 hit-test、轮询或 DOM 扫描；
- 文件夹自身 DnD、legacy `/c/` anchor、三点菜单、profile、WebDAV、cross-tab 和业务数据模型保持不变。


### v0.7.8：early gesture capture / interactive-row link

- `@run-at` 改为 `document-start`，但仅立即注册幂等的 window capture 手势监听；`boot()` 延后到 `DOMContentLoaded`，首次 DOM mount 仍要求 `document.readyState === complete` 且同一宿主稳定 1200ms，不恢复 hydration 阶段注入；
- pointerdown handler 在 `mounted`、`#cgfm-root` connected 且可见之前保持 inert，因此提前注册只改变 listener 顺序，不提前读取/修改业务 state 或 DOM；
- 新版 conversation 主交互优先识别 `a[data-interactive-row-link][href*="/c/"]`，标题读取其 `aria-label`，导航也优先复用该原生链接；旧 `role="button"` 继续作为兼容回退；
- pointer capture 优先落在实际主交互元素上，而不是一律落在 sortable `role=listitem`；保留 row 作为 conversation identity 与 release/click guard 范围；
- pointerdown 明确排除所有独立 `button`，避免新版“聊天操作”“置顶聊天”等按钮误建立聊天拖拽候选；
- 目的：降低 ChatGPT 自己的 sortable sensor 先于脚本武装而导致“第一次拖不动、第二次才生效”的事件竞争；不新增长期 observer、轮询或逐行监听器。

### v0.8.0：rail / peeking / pinned sidebar lifecycle

- 适配 ChatGPT 2026-09-29 新 app-shell：常驻 `[data-app-navigation-rail="true"]` 与 `[data-slate-sidebar-content="true"]` conversation sidebar 共存，正式把 sidebar 生命周期从 expanded/collapsed 二态升级为 `rail-only / peeking / pinned` 三态；
- `rail-only` 以 conversation content 的 `inert` 为主信号；`peeking` 以 left panel 的 `data-slate-sidebar-peeking="true"` 为主信号；content 可交互且无 peeking 属性时视为 `pinned`；不再依赖 `aria-expanded` 区分 peeking 与 pinned；
- 文件夹在 `peeking` 与 `pinned` 都立即显示，仅 `rail-only` 隐藏；新增两个窄范围 attributes-only observer，只观察 left panel 的 peeking 属性和当前 conversation content 的 inert 属性，经 `requestAnimationFrame` 合并后复用 `ensureMountedLight()`，解决 hover 悬浮 sidebar 已出现而文件夹慢拍的问题；
- observer 不观察 subtree / childList，不监听 conversation list，因此不恢复全局 DOM observer、高频扫描或逐聊天监听；原有稀疏恢复定时器继续作为 subtree 被 React 整体替换、休眠恢复等低频兜底；
- 自定义 sidebar width 只在 `pinned` 激活；`peeking` 保持 overlay-only，不推动正文布局。除 legacy `--sidebar-width` 外，同时覆盖新版原生 `--codex-sidebar-preferred-width`；
- 账号识别继续优先 `#client-bootstrap`，新增 `data-theme-account-id` / `data-theme-user-id` 强 fallback，再退到 profile button/头像弱 fallback；稳定 profile key 仍优先 accountId，WebDAV schema 与远端文件映射不变。

### v0.7.9：exclusive pointer gesture / click replay

- 放弃 v0.7.8 仍保留的 `setPointerCapture()` 路径；新版 conversation 主交互从 pointerdown 起由脚本同时 `preventDefault()` 与 `stopImmediatePropagation()` 独占，候选阶段也不再让 ChatGPT sortable/link 默认手势继续参与；
- 同一候选手势的 pointermove 与兼容 mouse 事件均被 window capture 阻断，移动超过 6px 后才创建浮动预览并进入文件夹 hit-test；
- 未超过阈值的 pointerup 不依赖浏览器后续是否生成 click，而是主动对原生 `a[data-interactive-row-link]`（旧结构回退到原生主交互）执行一次 click replay；
- click replay 期间使用短暂内部放行标志，避免被脚本自己的 click suppression 拦截；释放链仍使用 release guard 屏蔽可能残留的真实 click / mouseup / 延迟 dragstart；
- 目的：把“普通点击”和“拖入文件夹”统一为脚本先判定、再分流的单一手势状态机，彻底避免与 ChatGPT sortable sensor 争抢同一 pointer sequence；不增加逐行监听、长期 observer 或高频轮询。

### v0.7.7：app-shell collapsed sidebar host guard

- 适配 ChatGPT 2026-09 的双栏 app-shell：左侧常驻 `[data-app-navigation-rail]` 与右侧可收起 conversation sidebar 同属 `#app-shell-sidebar`；
- `#app-shell-sidebar` 不再作为 `findSidebarParent()` 的 fallback，并在 `isSafeMountParent()` 中显式拒绝共同外壳、常驻 navigation rail 及其后代；
- 新版可信 fallback 改为 `[data-app-action-sidebar-scroll]`，因此没有 Recents/聊天行时仍可挂载到可收起内容区；sidebar 收起且内容区被移除时则返回无宿主，不再把 `#cgfm-root` 搬到账号 rail 下方；
- `officialSidebarExpanded()` 新增 `button[aria-controls="app-shell-sidebar"][aria-expanded]` 与 action-sidebar scroll 可见性判定，修复新 UI 下 `#stage-slideover-sidebar` 不存在时始终误判为展开的问题；
- sidebar toggle 监听新增 `aria-controls="app-shell-sidebar"`，80/220/500/900ms 延迟检查改为复用 `ensureMountedLight()`，可在 ChatGPT 重建 conversation subtree 后自动 remount；
- 不新增长期 MutationObserver、轮询或高频 DOM 扫描；拖拽、WebDAV、cross-tab 与业务数据模型保持不变。

### v0.7.6：floating drag preview

- 保留 v0.7.5 已验证可用的完整手势所有权与 release guard，不恢复 ChatGPT 原生 sortable 拖拽；
- 自定义拖拽超过阈值激活时创建一个独立的轻量 floating preview，显示聊天图标与单行标题，并跟随鼠标移动；
- preview 使用 `position: fixed`、`pointer-events: none` 与 `translate3d()`，不改变原 conversation row 的 React 布局，也不会参与 `elementsFromPoint()` 命中；
- preview 与文件夹 hover 共用既有 `requestAnimationFrame` 节流，每帧最多更新一次位置；拖拽结束或取消时立即移除。

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
- 长期运行、逐聊天项绑定或不做帧限流的自定义 pointer drag；
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

## v1.2.0 (2026-10-17): recent history read and actual rename

- 入口文件夹图标改为 `#3A83F7` 蓝色轮廓、20% 不透明度内部浅填充；「文件夹」和「最近对话」标题同为 14px / 600。
- 最近对话刷新仅发生于独立面板由关闭转为打开时；不设置手动刷新按钮，不引入定时轮询。继续监听官方最近对话 DOM 的正常变化作为兜底。
- 官方列表接口：`GET /backend-api/conversations`，查询参数遵循在官方侧栏上观察到的 `exclude_conversation_origin=tpp`, `expand=false`, `hide_snorlax=false`, `is_archived=false`, `is_starred=false`, `order=updated`, `limit=20`, `offset=0,20,...`；最多 100 条。
- **限制**：直接用普通同源 `fetch` 发起上述请求曾返回 `200` / `items=[]` / `total=0`。官方网页调用含有 `authorization`、`chatgpt-account-id` 等额外上下文。此版只在页面主上下文的原生 `fetch` 实际发出官方最近对话请求后，在内存中临时复制必要请求头；后续面板打开才尝试复用。**没有观察到官方请求的全新会话不能保证主动获取列表**。不主动模拟官方侧边栏悬停或固定。
- 捕获到的请求头包含潜在认证信息，仅保留在运行时内存，绝不写入 localStorage/GM/WebDAV、导出文件或诊断日志；45 分钟后停止使用，页面刷新后需重新观察官方请求。调用失败或返回空数组时保留 DOM/缓存已有记录，不清空本地最近列表。
- 官方对话重命名经用户 Console 验证为 `POST /backend-api/conversation/id/{id}/rename`，JSON 请求体为 `{"title":"..."}`，官方操作返回 HTTP 200。独立面板内文件夹对话及最近对话均可鼠标右键或点悬浮铅笔进入行内编辑，Enter 保存、Esc 取消，服务端成功后才更新本地缓存和已归类会话。首次未观察到官方授权上下文时明确提示，不伪造成功。
- 上述路径为 ChatGPT **非公开内部端点**，可能随客户端版本变化；尚未在用户真实 Chrome/Tampermonkey 中完成端到端测试。确保所有版本的回退行为不更改文件夹归属、WebDAV schema 3、对话正文及官方侧边栏 React 状态。

## v1.2.1 (2026-10-17): hover and rename interaction stability

- 最近对话统一固定 36px 行高；重命名按钮常驻布局，仅通过透明度与 pointer-events 切换可见性，避免 hover 改变 flex 行高或文字宽度。
- 编辑态纳入独立面板可见性锁；编辑、提交期间不因 pointerleave 或自动收起计时器隐藏面板。
- 对话标题编辑改为原位替换链接为输入框，避免启动编辑时重建全部列表；编辑过程中延后全量渲染和最近列表 DOM 更新，防止输入框被销毁。
- 重命名只在 Enter 提交或 Esc 取消，不再在 blur 时自动提交；成功或取消后恢复正常渲染与关闭判定，失败保留编辑内容供重试。
- 不改动 WebDAV schema、官方历史接口、用户认证信息缓存策略及原生侧边栏状态。

## v1.2.2 (2026-10-17): single rename session and sidebar close reconciliation

- 连续点击不同对话的重命名时，先取消前一条的未提交编辑，再就地打开新编辑框；正在提交保存期间不允许切换，避免并发写入与锁状态错乱。
- 编辑锁现在检查当前编辑输入框是否仍存在；如果输入框意外被移除，就清除失效锁，防止面板永久保持展开。
- 编辑完成后在下一帧重新计算导航按钮与独立面板的实际 `:hover` 状态，避免旧的 pointer 标记造成悬浮面板无法收起；自动关闭计时器也会重新核对真实悬浮状态。
- 编辑框 Enter/Escape 阻止事件继续传播至全局快捷键，避免 Esc 取消编辑同时触发面板关闭。
- **官方侧栏标题即时同步限制**：脚本直调官方 rename 端点可更新服务器和自己的列表，但官方 React 侧栏可能仍显示旧客户端缓存，直至官方刷新。没有验证到受支持的 React 查询失效机制，因此本版不直接改写官方 DOM，也不模拟官方交互以强制更新。此限制仍需官方缓存机制研究和实测。
- 不改变 WebDAV schema、最近对话接口、拖拽与原始资料结构。


## v1.3.0 (2026-10-17): independent rename dialog and title reconciliation

- 对话重命名改为 document.body 下的统一独立弹层。只在弹层 DOM 确实挂载后才创建编辑锁；编辑不再依赖最近对话行或文件夹树中的输入框，普通重渲染不影响输入。
- 任何时刻只允许一条对话处于编辑会话；切换编辑对象会先撤销旧的未提交会话，保存中禁止切换。取消、成功及意外移除均清理状态；编辑弹层存在时面板保持展开。
- 保留已验证的真实服务端重命名 POST；提交期间禁用操作，失败保留弹层供重试。成功后更新归类记录和最近对话缓存。
- 新增按当前账号隔离、有效期 24 小时的“已确认标题保护”。旧官方 DOM 与本地缓存不能覆盖刚保存的标题；后续官方历史 API 返回相同的新标题时解除保护。保护只记录 ID、标题和保存时间，不保存授权上下文，也不上传 WebDAV。
- 不尝试直接修改 React 官方侧栏 DOM 或私有 React 状态；官方侧栏可能继续显示旧标题直到官方列表自行重新获取或刷新页面。
- 回归测试：连续点击 A/B/C 编辑、空白点击取消、Esc 取消、中文输入、保存成功和失败、面板离开后自动收起，以及旧 DOM 更新不回退标题。


## v1.3.1 (2026-10-17): 独立面板渲染回归修复

- 修复 v1.3.0 从行内聊天重命名迁移为独立弹层后遗留的两处 `focusInlineChatEditor()` 调用。`render()` 和 `updateRecentDom()` 在正常渲染及官方侧栏展开触发最近对话更新时不再调用已删除函数，避免抛出 `ReferenceError`。
- 清理已经不再生成的 `[data-chat-edit-id]` 输入框对应的旧 `keydown` 与 `focusout` 分支；文件夹名称的行内编辑分支保持不变。
- 统一脚本元数据 `@version` 与运行时 `VERSION` 为 `1.3.1`，避免页面级运行时标记继续显示旧版本。
- 保留独立重命名弹层、标题保护、最近对话 API、导航入口恢复、WebDAV 格式和已有交互不变。
- 回归验证重点：F5 后独立面板正常出现；悬浮展开官方侧栏并使最近对话更新；返回独立文件夹按钮后仍可悬浮展开；重命名弹层和文件夹名称编辑均可正常使用。


## v1.3.2 (2026-10-17): authoritative title guard

- 官方侧栏 DOM 与本地缓存均为非权威标题来源；二者不得覆盖插件已经成功 POST 到服务器的标题。
- `mergeRecentItems` 显式标记 `dom` / `server` 来源；仅请求在重命名成功后发起的服务器历史 API 结果有资格核实标题。
- 服务器返回同名时只标记已确认，不删除保护：官方 React DOM 仍可能持有旧标题。
- 跨设备修改采用两阶段服务器核实：先确认本次重命名，之后发起的服务器历史请求才能接受不同标题；防止重命名之前发起的异步请求覆盖本次结果。
- 本地保护记录按账号隔离、跨 F5 持久化，不再简单在 24 小时后过期；兼容既有记录。不改变 WebDAV schema 或原生侧栏 DOM。
- 修复范围仅限标题合并和保护；启动后官方授权上下文捕获行为维持原样。


## v1.3.3 (2026-10-17): F5 后认证上下文恢复

- 优先从页面正常的 `/backend-api/` 请求中捕获 `Authorization` 与账号 ID，扩大监听范围，不自动展开官方侧边栏。
- 支持以当前页面明确检测到的 ChatGPT 账号 ID 为键，从 Tampermonkey GM 存储中恢复认证请求头。仅白名单头允许存储，24 小时上限；不进入 localStorage、WebDAV、同步操作日志、导出文件或页面 DOM。**GM 存储不等于加密保险箱**。
- 缓存有效期不代表令牌有效。请求收到 401/403 即删除该账号缓存；HTTP 200 空列表不当作成功核实，不因此覆盖现有对话。缓存不可用时，只有实际操作需要认证才提示展开官方侧边栏。
- 不猜测认证刷新端点，不读取其他应用的凭据，不把请求认证头打印到控制台。
- 维护提醒：该改动引入本地持久化 Bearer Token 的安全代价；使用共享设备应避免此功能，后续宜提供显式禁用/清除凭证缓存设置。
- 浏览器回归重点：F5 后无需展开官方栏即可重命名；账号切换不能交叉复用；授权失效后提示；旧标题保护不回退；不会自动展开官方侧栏。

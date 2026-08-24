# ChatGPT 长对话优化助手

`chatgpt-long-chat-optimizer.user.js` 是用于 ChatGPT 网页版的 Tampermonkey 用户脚本。当前版本针对 ChatGPT 新版分页会话接口工作：优先复用网页自身的 `/backend-api/conversations/<id>` 请求，通过修改 `num_turns` 控制首次加载的历史窗口，而不是再依赖旧版完整 `mapping` 树进行本地裁剪。

## 目标

- 缓解超长 ChatGPT 对话在浏览器中的网络、React 渲染、DOM 和滚动负担。
- 不修改 OpenAI 服务端保存的完整对话。
- 首屏不额外请求完整历史；完整总轮数统计与历史窗口开关相互独立，首屏完成后以低速分页方式后台统计，并支持断点续跑。
- 通过页面右下角的轻量悬浮按钮设置最近 N 轮历史窗口；即使关闭历史窗口覆盖，也继续后台统计并显示完整总轮数。
- 保留对旧 `/backend-api/conversation/<id>` / `shared_conversation` 响应的兼容逻辑，作为旧页面或接口回退路径。

## 新版核心机制

> 当前 ChatGPT API 适配确认日期：**2026-08-22**。这一天发现旧版 `mapping` 主路径失效，并完成对新版 `conversations + num_turns` 分页接口的适配。

脚本使用：

```text
@run-at document-start
@sandbox raw
@grant GM_getValue
@grant GM_setValue
@grant unsafeWindow
```

v0.3.1 起采用“Tampermonkey 沙箱 + 页面主上下文桥接”的双层结构：GM API 只在 userscript 沙箱中负责持久缓存，`unsafeWindow` 只用于取得真实页面的 `window`、`fetch`、`Request`、`Response` 等对象并安装 Fetch Proxy。这样既保留 Tampermonkey 持久存储，也确保 `num_turns` 改写和分页观察实际作用于 ChatGPT 页面自己的网络请求。

当前 ChatGPT 正常会话主要使用：

```text
/backend-api/conversations/<id>?include_has_versions=true&num_turns=10
```

启用脚本时，若该请求属于当前页面会话，脚本只把 `num_turns` 改为用户配置的 `keepRounds`，例如：

```text
num_turns=10  ->  num_turns=20
```

其余 URL 参数、请求头、认证上下文和请求生命周期仍由 ChatGPT 原生代码负责。脚本不会自行构造一个新的裸认证请求，因此不会为了限制历史窗口额外访问 conversation history。

处理顺序：

1. 在 `document-start` 阶段通过 `unsafeWindow` 取得页面主上下文，并代理页面真实的 `window.fetch`；GM storage 仍留在 Tampermonkey userscript 沙箱。
2. 识别 `/backend-api/conversations/<id>`、旧 `/backend-api/conversation/<id>` 和 `shared_conversation` GET。
3. 校验请求 conversation id 与当前 `/c/<id>` 路由；普通对话与 Project `/g/g-p-<project-id>/c/<id>` 都支持。
4. 对新版 `conversations` 接口：启用时覆盖 `num_turns`，关闭时保持 ChatGPT 原始请求完全不变；总轮数统计不受这个开关影响。
5. 读取返回 JSON 中的 `messages`、`page_info`、`context_truncation_continuation` 等分页信息，不改写新版 response body。
6. 如果 `page_info.has_previous_page=true`，首屏仍立即交还给 ChatGPT；随后无论历史窗口覆盖是启用还是 Off，脚本都会短暂延迟，并以低速分页方式访问 `/backend-api/conversations/<id>/messages?before=<cursor>`，只统计唯一的 `user` message id。
7. 每一页统计完成后立即把 `countedRounds`、`nextBeforeCursor`、已见 user message id 等断点写入 Tampermonkey 持久存储；SPA 切换或页面隐藏时不继续发起新分页请求。
8. 直到 `has_previous_page=false` 后得到完整总轮数，并把缓存压缩为最终 `totalRounds`；以后再次进入该会话优先直接恢复缓存。
9. 对仍返回旧 `mapping + current_node` 的旧接口，继续保留原来的活动分支分析与本地 mapping 裁剪逻辑作为兼容路径。

新版方案的重点是：**首屏只请求需要的历史窗口，完整总轮数在首屏之后低速、可中断地补齐，不把后台取得的旧消息交给 React 渲染。**

## “轮”与 `num_turns`

用户设置仍以“保留轮数”表达，例如 10、20、30。新版主路径直接把该值写入 ChatGPT 原生请求的 `num_turns` 参数。

需要注意：`num_turns` 是 ChatGPT 内部接口参数，不属于公开稳定 API。脚本把它当作当前网页实现中的历史窗口参数使用；网站将来再次更改接口语义时需要重新验证。

旧接口回退路径中，一次 `user` 提问及其后续 `assistant` 回答仍按 1 轮处理；`system`、`tool`、`thinking` 等内部节点不单独计轮。

## 悬浮按钮

按钮将“历史窗口控制状态”和“总轮数统计状态”分开显示：

```text
LS 10 / +
LS 10 / …
LS 10 / 86
LS Off / +
LS Off / …
LS Off / 86
```

含义：

- `LS 10 / +`：首屏确认仍有更早历史，但后台统计尚未开始或当前已暂停。
- `LS 10 / …`：后台正在以低速分页方式统计完整总轮数。
- `LS 10 / 86`：后台统计已经完成，当前配置保留最近 10 轮，完整总轮数为 86。
- `LS Off / +`：不覆盖 `num_turns`，但确认仍有更早历史，完整总轮数尚未得到。
- `LS Off / …`：不覆盖 `num_turns`，后台仍在统计完整总轮数。
- `LS Off / 86`：不覆盖 `num_turns`，完整总轮数已经统计并缓存为 86。

后台分页响应只由脚本解析和计数，不交给 ChatGPT React，也不会因为统计而把全部历史消息强制渲染到当前页面。

点击按钮打开设置面板：

- switch“限制历史窗口”：启用 / 关闭 `num_turns` 覆盖；无论开关状态如何，总轮数统计都继续工作。
- `−` / `+`：调整保留轮数。
- 数字输入框：允许 `1–100`。
- “应用并刷新”：保存新值并刷新当前页面。

## 默认值与配置兼容

- 默认 `keepRounds = 10`。
- 旧版本已保存的 `keepRounds` 与 `enabled` 继续沿用。
- 配置仍保存在 `localStorage` 的 `cyan_chatgpt_long_chat_optimizer` 中。
- 允许范围仍为 `1–100`。

## 启用、关闭与刷新

### 启用

启用后刷新页面，使下一次 ChatGPT 原生 `/backend-api/conversations/<id>` 请求从开始阶段就被改写：

```text
num_turns=<keepRounds>
```

### 关闭

关闭后刷新页面。脚本不再覆盖 `num_turns`，而是把 ChatGPT 自己生成的请求原样发出。

因此新版中的“Off”只表示“关闭本脚本对历史窗口的覆盖”，**不会关闭总轮数统计**。ChatGPT 自身仍可能采用分页或默认 `num_turns`，而脚本会继续利用分页接口统计总轮数，并显示 `LS Off / …` 或 `LS Off / 总轮数`。

### 修改保留轮数

`−`、`+` 和输入框只修改面板草稿；点击“应用并刷新”后才写入配置并重新加载。

## 后台总轮数统计与持久缓存

新版 `page_info` 目前只有 `start_cursor`、`end_cursor`、`has_previous_page`、`has_next_page`，没有直接提供完整总轮数。因此 v0.3.0 开始使用 ChatGPT 网页自身已经采用的分页接口：

```text
/backend-api/conversations/<id>/messages
?before=<start_cursor>
&include_has_versions=true
&num_turns=25
```

这里的 `25` 只用于后台总轮数统计分页；页面首屏的 `num_turns` 仍由“限制历史窗口”的用户设置独立控制。提高后台分页窗口可以减少长对话所需的分页请求次数。

统计策略：

- 后台统计每页请求 `num_turns=25`，以减少长对话需要的分页次数；这不会改变首屏历史窗口设置。
- 首屏完成后随机等待约 1.0–2.0 秒，再开始第一笔后台分页请求。
- 每取得一页后再随机等待约 1.0–2.0 秒，避免连续快速请求；同一时刻只处理当前会话的一条后台统计链。
- 只统计 `author.role === "user"` 且 message id 未重复出现的消息；内部 tool / thinking / assistant 节点不计为新轮次。
- 后台响应仅在脚本内部解析，不交还给 ChatGPT 的分页渲染逻辑，因此不会主动把旧历史插入 DOM。
- 页面切换、SPA 导航或离开当前 document 时会中止当前请求；已完成的分页进度已经持久保存，下次进入同一 conversation 从 `nextBeforeCursor` 继续。
- 页面隐藏时不主动启动新的分页请求；回到页面后再继续。
- 如果分页请求返回非成功状态、非 JSON 或 cursor 无法继续推进，本次统计暂停而不是快速重试；以后重新进入或重新获得可用上下文时再续跑。

缓存使用 Tampermonkey 自己的 `GM_getValue` / `GM_setValue` 存储，而不是 `chatgpt.com` 的 Local Storage。清理 ChatGPT 网站数据通常不会删除这份脚本缓存；删除用户脚本、清理 Tampermonkey/扩展数据或浏览器配置后则可能丢失。

未完成条目保存 `countedRounds`、`nextBeforeCursor`、去重所需的 user message id、最近 user message id 和更新时间；完成后只保留最终总轮数等必要状态，减少存储体积。最多保存最近 300 个 conversation 的统计记录，超出后按最近更新时间淘汰较旧条目。

如果已经完成统计后又继续在当前页面新增用户提问，DOM 增量观察器会同步把总轮数 `+1` 并更新 Tampermonkey 缓存，不会为了每个新问题重新拉取一页历史；重新打开会话时也会用最新首屏 user message 检查缓存是否仍可直接沿用。

## 新旧接口兼容

当前主要接口：

```text
/backend-api/conversations/<id>
```

已观察到新版响应顶层包含：

```text
messages
current_node
page_info
context_truncation_continuation
```

而不再提供旧版完整 `mapping`。因此新版不能继续把 `mapping` 作为主要裁剪基础。

脚本仍保留旧接口：

```text
/backend-api/conversation/<id>
/backend-api/shared_conversation/<id>
```

如果旧接口仍返回 `mapping + current_node`，则继续使用旧活动分支裁剪逻辑。这只是兼容回退，不再是主实现。

`/textdocs`、`/url_safe`、`/stream_status` 等子路径不是对话主体接口，不参与历史窗口处理。

## 兼容性变更记录

### 2026-08-09：旧 `mapping` 方案基线

- 初版实现参考 LightSession `1.7.4`，基线 commit 为 `300aade18bff188749d062ac2fad7216c7bc36ca`。
- 当时 ChatGPT 主要使用 `/backend-api/conversation/<id>`。
- conversation response 提供完整 `mapping + current_node`。
- 脚本在浏览器端沿当前活动分支统计轮数，再重建并裁剪 `mapping`，让 React 初始渲染时只看到最近 N 轮。

### 2026-08-22：新版 `conversations + num_turns` 适配

- 当天发现旧方案失效，典型表现为悬浮按钮持续显示 `LS 10 / --`。
- 实测确认 ChatGPT 主接口改为 `/backend-api/conversations/<id>?...&num_turns=10`。
- 新响应改为 `messages + current_node + page_info + context_truncation_continuation`，不再提供旧版完整 `mapping`。
- 从 v0.2.0 起，主实现改为复用 ChatGPT 原生请求并覆盖 `num_turns`，让后端直接限制历史窗口。
- 旧 `mapping` 裁剪逻辑继续保留，但仅作为兼容回退。
- v0.2.0 首先停止强求精确总轮数，只在能够确认存在更早历史时使用 `LS N / +`。
- 同日后续 v0.3.0 在实测确认 `/messages?before=<cursor>` 分页方式后，加入低速后台统计、Tampermonkey 持久缓存和断点续跑；统计完成后恢复 `LS N / 总轮数`。
- v0.3.1 修复 v0.3.0 在声明 GM 权限后可能只运行在 userscript 隔离环境、未真正 patch ChatGPT 页面 `window.fetch` 的问题；改为通过 `unsafeWindow` 显式桥接页面主上下文，并使用页面 realm 的 `Request` / `URL` / `Headers` / `Response` 构造器。
- v0.3.2 将“历史窗口覆盖”和“完整总轮数统计”解耦：Off 只停止改写 `num_turns`，后台统计仍继续；同时把首次与页间随机等待从 2.5–4.5 秒缩短为 1.0–2.0 秒。
- v0.3.3 将后台总轮数统计的分页窗口从 `num_turns=10` 提高到 `num_turns=25`，减少较长对话需要的分页请求次数；首屏历史窗口仍保持独立配置。
- v0.3.4 初步加入新建对话 bootstrap，但当 ChatGPT 先进入 `/c/WEB:<temporary-id>`、随后再切到正式 `/c/<uuid>` 时，统计会被第二次路由切换清掉。
- v0.3.5 根据实测时序 `/ → /c/WEB:<temporary-id> → /c/<uuid>` 修复该问题：`WEB:` 只作为临时会话阶段，不写入持久缓存；临时阶段收集的 user message id 会在正式 UUID 出现时迁移并初始化精确总轮数。

这两个日期分别代表“旧架构参考基线”和“当前 ChatGPT 接口适配节点”，不应混为同一个维护日期。

### v0.3.5 新建对话的临时 `WEB:` 路由处理

实测新建对话并不是直接从 `/` 进入最终 conversation UUID，而是可能经历：

```text
/
→ /c/WEB:<temporary-id>
→ /c/<final-uuid>
```

`WEB:` 是 ChatGPT 新建会话过程中的临时路由。v0.3.5 将它与正式 conversation ID 分开处理：

- `/` 或 `/c/WEB:<temporary-id>` 阶段出现的 user message id 只保存在当前页面内存，不写入 GM storage 或 session conversation cache。
- 临时阶段已经看到 user message 时，右下角可以先显示当前临时精确数量，例如 `LS Off / 1`。
- 当路由从 `WEB:` 切换到正式 UUID 时，把临时阶段收集的 user message id 迁移到正式 UUID，并建立完成态总轮数缓存。
- 后续新 user message 继续沿用现有 DOM 增量逻辑直接 `+1`，无需重新分页，也无需手动刷新。
- 从首页直接打开一个已有正式 `/c/<uuid>` 对话时，如果没有 `WEB:` 临时阶段或预路由新消息证据，仍走正常的 `conversations + page_info` / 后台分页路径，避免把旧对话误判为新对话。

## SPA 与 Project 对话

脚本从 pathname 中识别最后的 `/c/<conversation-id>`，因此同时支持：

```text
/c/<conversation-id>
/g/g-p-<project-id>/c/<conversation-id>
```

请求返回前会核对当前页面 conversation id，避免 SPA 快速切换时旧会话请求影响新会话状态。

## DOM 观察器

脚本继续保留轻量 MutationObserver，主要承担：

- ChatGPT hydration / SPA 重建后恢复 `#cyan-ls-root` 悬浮 UI。
- 已完成总轮数统计后的本地用户消息增量统计，并同步更新 Tampermonkey 持久缓存。

观察器只处理新增节点，不持续扫描完整正文。新版 `conversations + num_turns` 主路径不依赖 DOM 来决定历史窗口大小。

## 已知限制

- `/backend-api/conversations`、`num_turns`、`messages`、`page_info` 等都是 ChatGPT 内部实现，不是公开稳定 API。
- 新版响应没有发现可直接读取的完整总轮数字段；精确总轮数依赖后台分页统计，因此首次进入很长的会话时需要一定时间才能完成。
- 后台统计会产生额外的历史分页 GET，但采用延迟、串行、随机间隔、页面隐藏暂停和错误即暂停的保守策略；内部接口仍可能随 ChatGPT 更新或服务端策略变化而失效。
- `LS N / +` 或 `LS Off / +` 表示仍有更早历史但当前没有进行统计；`LS N / …` 或 `LS Off / …` 表示统计进行中。
- 关闭脚本覆盖后，ChatGPT 自己仍可能只加载默认数量的历史轮次；“Off”不等于强制完整加载，但总轮数统计仍继续工作。
- 当前页面继续产生新消息后，ChatGPT 自己如何维护分页窗口由网页原生逻辑决定；重新加载时脚本会再次把 `num_turns` 设为当前配置。
- v0.3.1 通过 `unsafeWindow` 显式代理页面主上下文 `window.fetch`；如果未来 Tampermonkey、浏览器或 ChatGPT 改变跨上下文访问策略，首次会话请求仍可能需要重新适配。

## 隐私与安全

- 不向第三方服务器发送数据。
- 不保存 conversation response、Cookie、Token 或 Authorization Header。
- 首屏历史窗口不额外拉取完整历史；开启精确总轮数统计后会低速调用 ChatGPT 原生分页 history 接口，只读取计数所需 JSON。
- `localStorage` 只保存是否启用和 `keepRounds`。
- Tampermonkey GM storage 保存总轮数统计缓存与未完成的分页断点；不保存聊天正文、Cookie、Token 或 Authorization Header。`unsafeWindow` 仅作为页面主上下文桥接，不用于持久保存页面数据。
- 认证请求头只在当前页面内存中临时复用，用于让后台分页请求沿用 ChatGPT 已有认证上下文，不写入持久缓存。

## 上游同步基线

早期实现参考 LightSession：

```text
Repository: https://github.com/11me/light-session
Version:    1.7.4
Commit:     300aade18bff188749d062ac2fad7216c7bc36ca
Checked:    2026-08-09
```

当前 ChatGPT API 适配确认日期：

```text
Current ChatGPT API adaptation checked: 2026-08-22
```

`Checked: 2026-08-09` 仅表示当时检查 LightSession 上游基线的日期，不应随着本脚本后续维护自动改成最新日期。

当前 v0.2.x 已因 ChatGPT 内部接口从完整 `mapping` 转向 `messages + page_info + num_turns` 而采用不同的主路径。以后同步上游时，应把 LightSession 视为旧架构参考，而不是机械复制其 mapping 裁剪方式。

## 维护检查

修改脚本后至少执行：

```bash
node --check userscripts/chatgpt/chatgpt-long-chat-optimizer.user.js
```

实际页面建议至少验证：

1. 普通 `/c/<id>` 能捕获 `/backend-api/conversations/<id>`。
2. 页面 Console 中 `window.__CYAN_LS_FETCH_PATCHED__ === true`，确认补丁实际安装在 ChatGPT 页面主上下文，而不是仅存在于 userscript 隔离环境。
3. Project `/g/g-p-.../c/<id>` 同样能正确匹配当前 conversation id。
4. 启用且配置为 10 时，Network 中原生请求的 `num_turns` 为 10；改成 20 后刷新变为 20。
5. 关闭后脚本不修改 ChatGPT 原生 `num_turns`。
6. 首屏不会一次性拉取完整历史；存在更早历史时，后台分页 GET 使用 `num_turns=25`，串行且带 1.0–2.0 秒随机间隔。
7. `/textdocs`、`/url_safe`、`/stream_status` 不被误当作主体请求。
8. `messages/page_info/context_truncation_continuation` 响应能够正常交还 ChatGPT，不改写 response body。
9. 如果分页信息确认有更早历史，启用覆盖时显示 `LS N / +`、`LS N / …`、`LS N / 总轮数`；Off 时对应显示 `LS Off / +`、`LS Off / …`、`LS Off / 总轮数`。
10. 统计到一半执行 SPA 切换后请求被中止；返回原会话后从 Tampermonkey 缓存的 `nextBeforeCursor` 继续，而不是从头开始。
11. 手动清理 `chatgpt.com` 网站数据后，如果 Tampermonkey 脚本数据未被清理，已完成总轮数缓存仍能恢复。
12. 后台分页响应不会被插入 DOM；向上滚动触发的 ChatGPT 原生 `/messages?before=` 请求如果恰好推进当前断点，可被脚本顺带用于计数。
13. 非 2xx / 非 JSON / cursor 不推进时停止本轮后台统计，不进行高频重试。
14. 旧 `mapping + current_node` 接口如果仍出现，旧裁剪兼容路径不报错。
15. switch 关闭后只停止 `num_turns` 覆盖，后台总轮数统计仍继续工作；数字输入与“应用并刷新”继续沿用旧配置并正常工作。
16. 新建对话应兼容 `/ → /c/WEB:<temporary-id> → /c/<final-uuid>` 两阶段路由：`WEB:` 阶段不写持久缓存，第一条 user message 出现后可显示 `LS Off / 1`，切到正式 UUID 后总数保持不丢失且无需刷新；从其他路由打开已有正式对话不得被误判为新对话。

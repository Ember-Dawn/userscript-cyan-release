# ChatGPT 长对话优化助手

`chatgpt-long-chat-optimizer.user.js` 是用于 ChatGPT 网页版的 Tampermonkey 用户脚本。当前版本针对 ChatGPT 新版分页会话接口工作：优先复用网页自身的 `/backend-api/conversations/<id>` 请求，通过修改 `num_turns` 控制首次加载的历史窗口，而不是再依赖旧版完整 `mapping` 树进行本地裁剪。

## 目标

- 缓解超长 ChatGPT 对话在浏览器中的网络、React 渲染、DOM 和滚动负担。
- 不修改 OpenAI 服务端保存的完整对话。
- 不额外主动请求完整历史，只修改 ChatGPT 本来就会发出的当前会话请求。
- 通过页面右下角的轻量悬浮按钮设置最近 N 轮历史窗口。
- 保留对旧 `/backend-api/conversation/<id>` / `shared_conversation` 响应的兼容逻辑，作为旧页面或接口回退路径。

## 新版核心机制

脚本使用：

```text
@run-at document-start
@sandbox raw
@grant none
```

启动后立即在页面主上下文安装 Fetch Proxy。当前 ChatGPT 正常会话主要使用：

```text
/backend-api/conversations/<id>?include_has_versions=true&num_turns=10
```

启用脚本时，若该请求属于当前页面会话，脚本只把 `num_turns` 改为用户配置的 `keepRounds`，例如：

```text
num_turns=10  ->  num_turns=20
```

其余 URL 参数、请求头、认证上下文和请求生命周期仍由 ChatGPT 原生代码负责。脚本不会自行构造一个新的裸认证请求，因此不会为了限制历史窗口额外访问 conversation history。

处理顺序：

1. 在 `document-start` 阶段代理 `window.fetch`。
2. 识别 `/backend-api/conversations/<id>`、旧 `/backend-api/conversation/<id>` 和 `shared_conversation` GET。
3. 校验请求 conversation id 与当前 `/c/<id>` 路由；普通对话与 Project `/g/g-p-<project-id>/c/<id>` 都支持。
4. 对新版 `conversations` 接口：启用时覆盖 `num_turns`，关闭时保持 ChatGPT 原始请求完全不变。
5. 读取返回 JSON 中的 `messages`、`page_info`、`context_truncation_continuation` 等分页信息，仅用于轻量状态展示，不改写新版 response body。
6. 对仍返回旧 `mapping + current_node` 的旧接口，继续保留原来的活动分支分析与本地 mapping 裁剪逻辑作为兼容路径。

新版方案的重点是：**尽可能让服务端从一开始就只返回需要的历史窗口，而不是先下载完整 mapping 再在浏览器内删除。**

## “轮”与 `num_turns`

用户设置仍以“保留轮数”表达，例如 10、20、30。新版主路径直接把该值写入 ChatGPT 原生请求的 `num_turns` 参数。

需要注意：`num_turns` 是 ChatGPT 内部接口参数，不属于公开稳定 API。脚本把它当作当前网页实现中的历史窗口参数使用；网站将来再次更改接口语义时需要重新验证。

旧接口回退路径中，一次 `user` 提问及其后续 `assistant` 回答仍按 1 轮处理；`system`、`tool`、`thinking` 等内部节点不单独计轮。

## 悬浮按钮

启用新版分页模式时，按钮优先显示：

```text
LS 10
LS 10 / +
```

含义：

- `LS 10`：脚本把当前会话的历史窗口请求设置为最近 10 轮；当前响应没有可靠提供完整总轮数。
- `LS 10 / +`：同样请求最近 10 轮，并且从分页信息中确认仍存在更早历史。
- `LS Off`：脚本仍加载 UI，但不覆盖 `num_turns`，完全采用 ChatGPT 自己的原生请求参数。

旧接口兼容路径如果仍能取得完整活动分支总轮数，则可以继续显示传统的 `LS N / 总轮数`。

脚本**不会为了恢复“总轮数”数字而额外拉取完整历史**。这是新版设计中的主动取舍：长对话优化优先于显示一个精确总数。

点击按钮打开设置面板：

- switch：启用 / 关闭历史窗口覆盖。
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

因此新版中的“Off”含义是“关闭本脚本对历史窗口的覆盖”，**不保证 ChatGPT 会一次加载完整历史**；ChatGPT 自身仍可能采用分页或默认 `num_turns`。

### 修改保留轮数

`−`、`+` 和输入框只修改面板草稿；点击“应用并刷新”后才写入配置并重新加载。

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
- 旧接口兼容路径中的本地用户消息增量统计。

观察器只处理新增节点，不持续扫描完整正文。新版 `conversations + num_turns` 主路径不依赖 DOM 来决定历史窗口大小。

## 已知限制

- `/backend-api/conversations`、`num_turns`、`messages`、`page_info` 等都是 ChatGPT 内部实现，不是公开稳定 API。
- 新版响应目前没有发现可靠的完整总轮数字段，因此按钮默认不再承诺 `LS N / 总轮数`。
- `LS N / +` 只在分页元数据能够明确判断“存在更早历史”时显示；无法确认时只显示 `LS N`。
- 关闭脚本覆盖后，ChatGPT 自己仍可能只加载默认数量的历史轮次；“Off”不等于强制完整加载。
- 当前页面继续产生新消息后，ChatGPT 自己如何维护分页窗口由网页原生逻辑决定；重新加载时脚本会再次把 `num_turns` 设为当前配置。
- 如果 Tampermonkey 无法在页面主上下文及时代理 `window.fetch`，脚本可能无法改写首次会话请求。

## 隐私与安全

- 不向第三方服务器发送数据。
- 不保存 conversation response、Cookie、Token 或 Authorization Header。
- 不额外主动调用 conversation history 接口。
- `localStorage` 只保存是否启用和 `keepRounds`。
- 旧版兼容统计缓存如果存在，只保存 conversation id 与数字，不保存聊天正文。

## 上游同步基线

早期实现参考 LightSession：

```text
Repository: https://github.com/11me/light-session
Version:    1.7.4
Commit:     300aade18bff188749d062ac2fad7216c7bc36ca
Checked:    2026-08-09
```

当前 v0.2.x 已因 ChatGPT 内部接口从完整 `mapping` 转向 `messages + page_info + num_turns` 而采用不同的主路径。以后同步上游时，应把 LightSession 视为旧架构参考，而不是机械复制其 mapping 裁剪方式。

## 维护检查

修改脚本后至少执行：

```bash
node --check userscripts/chatgpt/chatgpt-long-chat-optimizer.user.js
```

实际页面建议至少验证：

1. 普通 `/c/<id>` 能捕获 `/backend-api/conversations/<id>`。
2. Project `/g/g-p-.../c/<id>` 同样能正确匹配当前 conversation id。
3. 启用且配置为 10 时，Network 中原生请求的 `num_turns` 为 10；改成 20 后刷新变为 20。
4. 关闭后脚本不修改 ChatGPT 原生 `num_turns`。
5. 不产生脚本主动发起的额外 conversation history GET。
6. `/textdocs`、`/url_safe`、`/stream_status` 不被误当作主体请求。
7. `messages/page_info/context_truncation_continuation` 响应能够正常交还 ChatGPT，不改写 response body。
8. 如果分页信息确认有更早历史，按钮显示 `LS N / +`；无法确认总历史时不伪造总轮数。
9. 旧 `mapping + current_node` 接口如果仍出现，旧裁剪兼容路径不报错。
10. switch、数字输入与“应用并刷新”继续沿用旧配置并正常工作。

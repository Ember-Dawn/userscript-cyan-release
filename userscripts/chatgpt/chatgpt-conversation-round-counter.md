# ChatGPT 对话轮数统计

`chatgpt-conversation-round-counter.user.js` 是用于 ChatGPT 网页版的 Tampermonkey 用户脚本，只负责统计、缓存并显示当前对话的完整用户轮数，不修改 ChatGPT 的历史窗口大小，也不改写 conversation response body。

## 功能定位

- 一次 `user` 提问按 1 轮计数；`assistant`、`system`、`tool`、`thinking` 等消息不单独增加轮数。
- 对当前新版 `/backend-api/conversations/<id>` 分页会话接口，先读取首屏 `messages` 与 `page_info`，再在需要时低速分页补齐更早历史。
- 完整轮数写入 Tampermonkey GM storage；未完成统计保存 cursor 和已见 user message id，可在再次进入会话时续跑。
- 已完成统计后，如果当前页面继续出现新的 user message，DOM 增量观察器直接把总轮数 `+1`，无需重新扫描历史。
- 支持普通 `/c/<id>` 和 Project `/g/g-p-<project-id>/c/<id>` 路由。
- 兼容当前新建普通对话的 `/ → /c/local-chatgpt:<uuid> → /c/<final-uuid>` 两阶段绑定。
- 保留旧 `/backend-api/conversation/<id>` / `shared_conversation` 的 `mapping + current_node` 只读计数兼容路径。

## 与已归档长对话优化助手的关系

本脚本从 `ChatGPT 长对话优化助手 v0.3.6` 中提取完整总轮数统计子系统并独立维护。

旧脚本同时包含两类职责：

1. 修改 ChatGPT 原生 conversation 请求中的 `num_turns`，限制首屏加载的历史窗口；
2. 通过分页、缓存和 DOM 增量统计完整总轮数。

从本脚本开始只保留第 2 类职责。新的轮数统计脚本：

- 不读取或保存 `keepRounds`；
- 不提供历史窗口开关；
- 不改写 `num_turns`；
- 不裁剪旧 `mapping`；
- 不构造修改后的 `Response`；
- 对 ChatGPT 原生 conversation 请求仅旁路观察并 `clone()` JSON 用于计数。

旧版完整实现原样归档为：

```text
archive/userscripts/chatgpt-long-chat-optimizer-v0.3.6.user.js
archive/userscripts/chatgpt-long-chat-optimizer-v0.3.6.md
```

## 新版分页统计机制

当前主要会话接口：

```text
/backend-api/conversations/<id>
```

首屏响应中使用：

```text
messages
page_info.start_cursor
page_info.has_previous_page
context_truncation_continuation
```

脚本只统计 `author.role === "user"` 的唯一 message id。

如果确认存在更早历史，则后台分页请求：

```text
/backend-api/conversations/<id>/messages
?before=<start_cursor>
&include_has_versions=true
&num_turns=25
```

这里的 `num_turns=25` 只用于轮数统计自己的后台分页，不修改 ChatGPT 首屏请求，也不改变页面实际渲染的历史窗口。

### 后台策略

- 首次补齐前随机等待约 1.0–2.0 秒。
- 每一页之间随机等待约 1.0–2.0 秒。
- 同一时刻只运行当前会话的一条统计链。
- 页面隐藏时不主动开始下一页；重新可见后继续。
- SPA 切换和 `pagehide` 会中止当前请求。
- 每页完成后立即持久保存断点。
- 非 2xx、非 JSON 或 cursor 无法推进时暂停，不进行高频重试。
- 最多保存最近 300 个稳定 conversation 的缓存记录。

后台分页响应只由脚本解析，不交给 ChatGPT React，不会因为统计而把旧消息插入当前 DOM。

## 请求上下文复用

脚本在 `document-start` 阶段通过 `unsafeWindow` 进入页面主上下文并链式包装页面真实 `window.fetch`。

当观察到当前会话的 `/backend-api/conversations/<id>` 请求时，只在内存中保存后台分页所需的请求模板：

- 请求 headers；
- credentials；
- 当前 conversation id。

后台请求沿用页面已有认证上下文，但不持久保存 Cookie、Token 或 Authorization Header。

Fetch wrapper 使用独立标记：

```text
__CYAN_ROUND_COUNTER_FETCH_PATCHED__
```

History wrapper 使用独立标记：

```text
__CYAN_ROUND_COUNTER_HISTORY_PATCHED__
```

因此即使其他 ChatGPT userscript 也包装 `fetch` / History，本脚本也不会复用旧长对话助手的全局 patch flag。

## 新建对话首次绑定

2026-09-25 的实测链路为：

```text
/
→ /c/local-chatgpt:<local-uuid>
→ /c/<final-uuid>
```

脚本将会话生命周期分成：

```text
UNBOUND  /                         尚未绑定
LOCAL    /c/local-chatgpt:<uuid>   中间绑定
STABLE   /c/<final-uuid>           最终稳定会话
```

处理规则：

- `/` 阶段捕获的 user message id 放入 `pendingNewConversationUserIds`。
- `local-chatgpt:*` 与历史兼容的 `WEB:*` 都视为临时 ID，不写正式 GM cache。
- 切到最终稳定 ID 后，把 pending user message id 一次性初始化到正式 conversation。
- 预期首轮链路为 `1 → 正式 UUID 后仍为 1 → 再发送一轮后为 2`。
- 从已有稳定 `/c/<uuid>` 打开的旧会话不使用 bootstrap，而是走首屏分页分析与持久缓存恢复。

## 悬浮状态

页面右下角仅显示轮数或统计状态，不再提供设置面板：

```text
0   当前尚无 user 轮次
…   正在后台补齐完整轮数
+   确认有更早历史，但当前统计处于等待或暂停状态
86  已获得完整总轮数 86
```

鼠标悬停可查看更完整的状态说明。

## 持久缓存

缓存键：

```text
cyan_chatgpt_conversation_round_counter_cache_v1
```

未完成条目保存：

- `countedRounds`
- `nextBeforeCursor`
- `seenUserMessageIds`
- `latestUserMessageId`
- `updatedAt`

完成后只保留最终 `totalRounds`、`latestUserMessageId` 等必要字段，并清空分页去重列表以减少存储体积。

新脚本使用独立的 Tampermonkey 存储空间和新缓存键，不尝试迁移已归档长对话优化助手中的旧缓存；首次进入已有长对话时可能需要重新完成一次统计。

## DOM 观察器

MutationObserver 只处理新增节点，用于：

- ChatGPT hydration / SPA 重建后恢复右下角状态 UI；
- 捕获新出现的 `[data-message-author-role="user"][data-message-id]`；
- 在完整统计已经建立后执行本地增量 `+1`；
- 在新建会话正式 UUID 尚未绑定时维护 pending user message id。

观察器不会持续遍历整篇对话正文。

## 隐私与安全

- 不向第三方服务器发送数据。
- 不保存聊天正文、conversation response、Cookie、Token 或 Authorization Header。
- GM storage 只保存轮数、message id、cursor 与时间戳等统计状态。
- 后台分页会产生额外的 ChatGPT 历史 GET 请求，但采用延迟、串行、页面隐藏暂停和错误即暂停策略。
- `/backend-api/conversations`、`/messages`、`page_info` 等均为 ChatGPT 内部实现，不属于公开稳定 API，未来可能需要重新适配。

## 维护检查

修改脚本后至少执行：

```bash
node --check userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
```

实际页面建议至少验证：

1. 普通 `/c/<id>` 能观察 `/backend-api/conversations/<id>`，且请求 URL 原样发送，不修改 `num_turns`。
2. 页面 Console 中 `window.__CYAN_ROUND_COUNTER_FETCH_PATCHED__ === true`。
3. Project `/g/g-p-.../c/<id>` 能正确匹配当前 conversation id。
4. 若首屏 `has_previous_page=true`，后台使用 `/messages?before=`、`num_turns=25` 串行补齐。
5. 统计过程中切换会话会中止当前链；返回后从持久 cursor 续跑。
6. 页面隐藏时不启动新的后台页；恢复可见后继续。
7. 完成统计后继续发送 user message，显示值只增加一次并同步缓存。
8. 页面自己向上滚动产生的 `/messages?before=` 如果刚好匹配当前断点，可被顺带用于统计。
9. 非 2xx / 非 JSON / cursor 不推进时暂停，不高频重试。
10. 新建对话 `/ → local-chatgpt:* → final UUID` 中首轮计数保持连续。
11. `WEB:*` 临时 ID 仍作为兼容路径，不写正式缓存。
12. 旧 `mapping + current_node` 响应仍可只读计算 user 轮数，不改写 response。
13. 与其他包装 `window.fetch` / History 的 userscript 共存时，不应覆盖对方的独立 patch flag。

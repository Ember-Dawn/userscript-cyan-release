# ChatGPT 对话轮数统计

`chatgpt-conversation-round-counter.user.js` 是用于 ChatGPT 网页版的 Tampermonkey 用户脚本。v0.2.x 使用被动 conversation 数据源计数核心：脚本不主动分页抓取历史，而是读取 ChatGPT 页面自己已经请求到的 conversation `mapping`，统计其中全部用户消息节点，并用 DOM 增量维护当前页面的新消息。v0.2.1 进一步修复 F5 首次加载时 Composer badge 可能错过挂载的问题。

## v0.2.5 自然 messages fallback

实测发现，ChatGPT 并不保证每次进入已有对话都会自然发送 `POST /backend-api/conversations/batch`。部分对话只自然请求：

```text
GET /backend-api/conversations/<id>?num_turns=...&include_has_versions=true
```

该响应包含 `messages`、`current_node`、`page_info` 和 `context_truncation_continuation`。v0.2.4 只监听 batch，因此当某个 conversation 没有自然 batch 时，badge 可能长期停留在旧 GM cache（例如一直显示 `2`）或没有缓存时显示 `–`。

v0.2.5 在不增加任何网络请求的前提下，把页面自己已经发送的上述 GET 也作为被动 fallback 数据源：

- `batch + mapping` 仍是最高优先级的全量权威校准，可向上或向下覆盖；
- `conversations/<id> + messages` 只作为局部历史下限，不假定它覆盖完整 conversation；
- fallback 只允许把当前值/缓存向上抬高，不会用局部 messages 把已有更高值向下覆盖；
- fallback 会把自然响应和当前可见 DOM 中已知的 user message id 合并为内存去重基线，并启用之后的新消息实时 `+1`；
- 后续若自然 batch 到达，仍由 mapping 接管并进行完整校准。

因此脚本继续保持“零主动请求”，但不再依赖每个 conversation 都一定会出现 batch。

## v0.2.4 Composer 会话迁移容错

普通新对话发送首条消息时，ChatGPT 可能同时保留多个 Composer，并在 `/ → /c/local-chatgpt:* → /c/<final-uuid>` 过程中让当前 thread Composer 长时间保留 `local-chatgpt:*` identity。v0.2.4 不再要求 portal identity 与最终 URL UUID 严格相等，而是优先选择当前 thread Composer；`local-chatgpt:*` 在正式 UUID 路由下视为合法迁移状态。

当暂时找不到有效 portal 时，脚本不再主动删除现有 badge，而是等待 Composer 状态收敛后重新挂载。这样可避免 ChatGPT React 过渡期间把轮数 badge 自己清掉。

## 功能定位

- “轮数”定义为当前 conversation `mapping` 中所有唯一的 `user` 消息节点数。
- 不按 `current_node` 只统计当前 active path，因此编辑旧消息并重新发送后形成的其他分支也会计入总数。
- 首选数据源为 ChatGPT 页面自己发送的 `POST /backend-api/conversations/batch`；若某次没有自然 batch，则被动利用页面自己请求的 `GET /backend-api/conversations/<id>` 中 `messages` 作为只增不减的局部下限。脚本不会主动发送这两类请求。
- 页面进入已有对话时先读取 Tampermonkey GM cache 秒显旧值；自然 batch 到达后用当前 `mapping` 重新校准。
- batch 校准允许增加也允许减少：缓存只是启动时的临时显示值，当前服务器返回的 mapping 才是权威基线。
- mapping 或自然 messages fallback 建立基线后，页面新出现的 user message DOM 使用 message id 去重并实时 `+1`，无需额外网络请求。
- 支持普通 `/c/<id>` 和 Project `/g/g-p-<project-id>/c/<id>` 路由。
- 兼容普通新对话的 `/ → /c/local-chatgpt:<uuid> → /c/<final-uuid>` 两阶段绑定。

## v0.2.1 Composer 首次挂载修复

F5 / Ctrl+Shift+R 首次加载时，ChatGPT 的 Composer 可能在 DOMContentLoaded 后较晚才真正建立。v0.2.0 只在 `0 / 60 / 180 / 400 / 800 / 1500 / 2500 ms` 内尝试寻找 Composer；若 2.5 秒内仍未出现，脚本便不再等待，表现为 badge 偶尔缺失，而 SPA 切换对话后因为重新触发挂载流程又会恢复。

v0.2.1 取消这组有限重试 timer，改为：

1. 网络层仍在 `document-start` 立即安装 batch 被动监听，不等待 UI；
2. badge 首次挂载不在页面 hydration 早期直接写入 Composer，先等待文档达到 `complete`；
3. 若此时 Composer 尚未出现，仅在“尚未挂载 badge”期间临时观察 DOM，直到找到当前 thread Composer 的 `data-above-composer-portal`；
4. 找到 portal 后再等待两个 animation frame，并确认 portal 仍是当前有效节点，才挂载 badge；
5. 挂载成功立即断开临时全局等待 observer；之后仍只使用 portal、composer form 和 form 直属父节点三个窄范围 `childList` observer 维护重挂载；
6. SPA 切换或 Composer 真正替换时重新进入同一等待流程，不设置固定截止时间。

因此首次加载即使 Composer 晚于 2.5 秒出现也不会永久错过，同时避免在 React 首次 hydration 尚未完成时过早向 Composer portal 插入 badge。

## v0.2.0 为什么重构

2026-09-27 实测确认，当前 ChatGPT 在切换已有对话时会自然发送：

```text
POST /backend-api/conversations/batch
```

请求体形态为：

```json
{
  "conversation_ids": ["<conversation-id>"]
}
```

响应是 conversation 数组，每个 conversation 直接包含：

```text
id
mapping
current_node
...
```

多组长对话实测显示，`mapping` 中全部 user 节点数与从 `current_node` 沿 parent 回溯得到的 active-path user 数可能差异很大，例如 `46 vs 4`、`61 vs 56`、`55 vs 52`。这说明同一个 conversation URL 内可以同时保留多个消息路径；编辑旧消息并重新发送会改变当前路径，但旧路径节点仍可能保留在 `mapping` 中。

v0.1.x 的分页方案会围绕 `/backend-api/conversations/<id>`、`page_info`、cursor 和 `latestUserMessageId` 维护完成状态，并主动调用 `/messages?before=...` 补齐历史。该设计既复杂，也会产生额外请求；同时 active-path 或局部历史变化可能让已缓存轮数被错误向下校正。

v0.2.0 因此改为直接使用页面自然取得的完整 `mapping`，彻底移除主动历史分页链。

## 计数规则

### mapping 全量校准

脚本只在观察到页面自己的：

```text
POST /backend-api/conversations/batch
```

成功 JSON 响应时读取 conversation `mapping`。

遍历每个 mapping node，仅保留：

```text
node.message.author.role === "user"
```

并按 message id 去重；若 message id 缺失，则退回 mapping key。最终唯一 user 节点数量就是该 conversation 的权威轮数。

脚本不使用 `current_node` 来决定轮数，因此：

- 当前 active path 变短不会让分支外的 user 节点自动消失；
- 编辑旧 user 消息重新发送后，新生成的 user 节点会作为新的累计节点计入；
- 同一个 conversation 内不同路径的 user 节点都会统计。

### batch 请求期间的新消息

batch 请求发出后到响应返回前，用户可能又发送了新消息。为了避免较早发出的 batch 快照覆盖刚刚出现的 DOM 新消息，脚本在内存中记录实时 user message id 的观察时间。

应用 batch 快照时：

1. 先采用 mapping 中全部 user message id；
2. 再保留“晚于该 batch 请求开始时间出现、且 mapping 尚未包含”的实时 user id；
3. 得到新的当前总数；
4. 后续 batch 一旦自然包含这些 id，就回到纯 mapping 基线。

这只是处理请求竞态，不是“只增不减”策略；如果新的权威 mapping 本身确实减少，缓存和显示值允许随之减少。

## 不主动请求网络

v0.2.0 的网络原则是：**100% 被动观察，不为轮数统计额外发送 ChatGPT 请求。**

脚本不会：

- 主动调用 `/backend-api/conversations/batch`；
- 主动调用 `/backend-api/conversations/<id>`；
- 主动调用 `/messages?before=...`；
- 定时轮询 conversation；
- 为了“等待新数据”执行高频重试。

Fetch wrapper 只识别页面自身已经发出的两类自然请求：

```text
POST /backend-api/conversations/batch
GET  /backend-api/conversations/<id>
```

然后对成功 JSON response 使用 `clone()` 解析；原 response 原样交还 ChatGPT，不修改请求、请求体或响应体。GET fallback 只消费页面本来已经请求到的 `messages`，不会继续请求更早 page。

因此脚本不会因为轮数统计增加服务器请求频率，也不会再触发 v0.1.x 的后台历史分页流量。

## GM 持久缓存

缓存键继续沿用：

```text
cyan_chatgpt_conversation_round_counter_cache_v1
```

沿用旧 key 是为了升级后仍能读取 v0.1.x 已保存的 `totalRounds`。v0.2.0 会把旧复杂条目归一化为简单结构：

```text
totalRounds
updatedAt
```

不再持久保存：

```text
countedRounds
nextBeforeCursor
seenUserMessageIds
latestUserMessageId
```

缓存职责只有两个：

1. 打开/刷新已有会话时，在自然 mapping/messages 数据到达前立即显示上次总数；
2. mapping 校准、messages fallback 抬高下限或当前页面实时新增后保存最新总数。

缓存不是单调计数器。自然 batch 到达后，当前 mapping 统计值可以覆盖更高或更低的旧缓存。

普通刷新、强制刷新、浏览器重启，以及只清理 `chatgpt.com` 的 Cookie / Local Storage / IndexedDB / Cache Storage，都不应删除 Tampermonkey GM storage。删除脚本、清除 Tampermonkey/扩展数据、卸载扩展或删除整个浏览器配置文件时则可能丢失缓存。

## 当前页面实时增量

batch mapping 建立权威基线后，脚本在页面 DOM 中观察：

```css
[data-message-author-role="user"][data-message-id]
```

新出现且 mapping 尚未认识的 user message id：

```text
当前总数 +1
→ 写入 GM cache
→ 更新 badge
```

为了避免进入旧会话时把 React 重新挂载、向上滚动或历史虚拟化产生的旧 DOM 当成“新轮次”，已有稳定 conversation 在只恢复到 GM cache、尚未收到本次自然 mapping/messages 数据前不会启用 DOM 增量。mapping 校准后使用完整 user id 基线；若只有自然 messages fallback，则把该响应和当前可见 DOM 中已知的 user id 作为局部去重基线，再启用后续实时增量。

新建对话例外：在正式 UUID 尚未建立时，脚本继续收集页面实际出现的 user message id；当 `/ → local-chatgpt:* → final UUID` 完成绑定后，以这些 pending id 初始化新 conversation，再等待后续自然 batch 校准。

## Composer 上沿状态

轮数 badge 继续挂载在当前 thread Composer 的 `data-above-composer-portal` 中，UI 位置与 v0.1.4 保持不变：

```text
0   新对话尚无 user 轮次
–   已进入稳定 conversation，但尚无缓存且仍在等待自然 batch
86  当前已有 86 个累计 user 节点
```

badge 固定为 40 × 24 px，`right: 14px`、`bottom: -1px`，使用 1 px 黑色边框、透明背景、黑色 14 px 文字。它紧贴 Composer 上边框，不提供点击行为。

若数字来自 GM cache，悬停 title 会标注“缓存，等待页面自然校准”；mapping 或实时 DOM 已更新后恢复普通轮数 title。

## DOM 与性能策略

- 全局消息 MutationObserver 只处理新增节点中的 user message selector，不承担 Composer UI 维护。
- 已有旧对话在只有 GM cache、尚未收到自然 mapping/messages 数据前关闭 DOM 增量；mapping 或 messages fallback 建立去重基线后才启用实时增量。
- mapping user id、当前页面实时新增 id 和新对话 pending id 只保存在当前页面内存；GM storage 只持久保存总数和更新时间。
- badge 首次加载先等待文档 `complete`；若 Composer 尚未出现，临时使用全局 `childList + subtree` observer 仅负责等待首次 portal。portal 出现后等待两个 animation frame 再挂载，成功后立即断开该临时 observer。Composer 迁移期间允许 thread portal 暂时保留 `local-chatgpt:*` identity，不要求它立即与最终 URL UUID 相等。
- badge 挂载成功后仅观察 portal、对应 composer form 和 form 直属父节点；同时监听 `data-composer-placement` 与 `data-above-composer-conversation-id` 属性变化。若暂时找不到当前 portal，不删除已有 badge，只重新进入等待流程。
- `renderUiState()` 只在文字、title 或来源状态实际变化时写 DOM。
- 不存在历史分页 timer、网络轮询 timer 或页面隐藏后恢复分页的逻辑。

## 隐私与安全

- 不向第三方服务器发送数据。
- 不为统计主动发送任何 ChatGPT API 请求。
- 不修改 ChatGPT 自身请求或响应。
- batch 与自然 `GET /backend-api/conversations/<id>` response 只在内存中通过 `response.clone()` 读取；不会持久保存完整 conversation、聊天正文、Cookie、Token 或 Authorization Header。
- 内存中只保留 mapping/messages/DOM 的 user message id 用于当前页面去重；GM storage 只保存轮数和更新时间。
- `/backend-api/conversations/batch`、`/backend-api/conversations/<id>`、`mapping` 与 `messages` 都属于 ChatGPT 内部实现，不是公开稳定 API；未来如果页面更换数据入口，需要重新观察真实网络请求后适配。

## 维护检查

修改脚本后至少执行：

```bash
node --check userscripts/chatgpt/chatgpt-conversation-round-counter.user.js
```

实际页面建议至少验证：

1. 切换已有 `/c/<id>` 时，若页面自然产生 `POST /backend-api/conversations/batch`，脚本使用 mapping 全量校准；若只自然产生 `GET /backend-api/conversations/<id>`，则使用 messages fallback。轮数脚本本身不会主动增加任何请求。
2. batch 返回 `mapping + current_node` 时，脚本统计整个 mapping 的唯一 user 节点，而不是只统计 current-node active path。
3. 对存在明显分支的 conversation，badge 应与 mapping 的 `allUserNodeCount` 一致，即使 active-path user 数明显更小。
4. 刷新已有对话时先显示 GM cache；自然 batch 到达后允许按当前 mapping 向上或向下校准。
5. batch 基线建立后继续发送一条 user 消息，badge 只增加一次；后续自然 batch 包含该 id 时不得再次增加。
6. batch 请求进行期间发送新消息时，即使响应快照尚未包含新 id，也不能把刚增加的实时轮次覆盖掉。
7. 只有 GM cache、但本次尚未收到 batch 时，滚动历史或 React 重挂载旧消息不得增加轮数。
8. 新对话 `/ → local-chatgpt:* → final UUID` 的第一轮计数保持连续，正式 UUID 建立后保存缓存。
9. Project `/g/g-p-.../c/<id>` 能正确匹配当前 conversation id。
10. Console 中 `window.__CYAN_ROUND_COUNTER_FETCH_PATCHED__ === true`；与其他包装 `window.fetch` / History 的 userscript 共存时不得复用对方 patch flag。
11. 不应出现脚本主动发出的 `/messages?before=`、conversation 分页请求、batch 请求或轮数相关轮询；`GET /backend-api/conversations/<id>` 只能被动读取页面自己已经发送的响应。
12. F5 / Ctrl+Shift+R 时即使 Composer 晚于 2.5 秒出现，badge 最终也应挂载；首次挂载前等待文档 `complete` 和两个 animation frame，避免过早介入 hydration。
13. badge 稳定挂载后，临时全局等待 observer 应已断开；后续只保留 portal、composer form 和直属父节点的窄范围 observer，Composer 重建或 identity 属性变化后仍可自动重新挂载。
14. 普通新对话首条消息期间，即使 URL 已进入正式 `/c/<UUID>` 而 thread portal 仍暂时保留 `local-chatgpt:*`，badge 不应被删除，并应继续挂在当前 thread Composer。

15. 对没有自然 batch、但自然 `GET /backend-api/conversations/<id>` 返回 messages 的对话，badge 不应长期卡在旧缓存或 `–`；fallback 只能向上抬高，不得把更高缓存向下覆盖。
16. messages fallback 生效后继续发送新 user 消息，badge 应能实时 `+1`；后续自然 batch 到达时由 mapping 接管完整校准。

# ChatGPT 长对话优化助手

`chatgpt-long-chat-optimizer.user.js` 是用于 ChatGPT 网页版的 Tampermonkey 用户脚本。它参考 LightSession 的“在 React 渲染之前裁剪 conversation mapping”思路，但以单文件 userscript 形式重新实现，并使用“轮”而不是可见角色段作为用户侧计数单位。

## 目标

- 缓解超长 ChatGPT 对话在浏览器中的 DOM、React 渲染和滚动负担。
- 不修改 OpenAI 服务端保存的完整对话。
- 通过页面右下角的轻量悬浮按钮显示保留轮数和总轮数。
- 不要求用户在 Tampermonkey 中反复启用或禁用整个脚本；裁剪功能由脚本面板内的 switch 控制。

## 一轮的定义

本脚本中：

- 一次 `user` 提问及其后续 `assistant` 回答视为 **1 轮**。
- 底层通过当前 active conversation path 中的 `user` 可见角色段计数。
- `system`、`tool`、`thinking` 等内部节点不单独计为一轮。
- 同一角色连续出现的多个节点视为同一个角色段，因此附件、内部拆分节点等不会因为节点数量增加而轻易重复计数。
- 如果当前最后一轮只有用户提问、回答尚未完成，该用户提问仍计为当前一轮。

脚本只处理 `current_node` 向上追溯得到的当前活动分支，不把未选中的分叉分支加入总轮数。

## 核心流程

脚本使用以下 UserScript 元数据：

```text
@run-at document-start
@sandbox raw
@grant none
```

启动后立即在页面主上下文中安装 Fetch Proxy。脚本只处理 ChatGPT 页面自身发出的以下 GET 请求，不再为了同步总轮数额外主动请求 conversation 接口：

```text
/backend-api/conversation/<id>
/backend-api/shared_conversation/<id>
```

处理顺序：

1. 调用原始 `fetch` 获取正常响应。
2. 从请求 URL 提取 conversation id，并与当前页面 URL 中的 `/c/<id>` 路由段做一致性校验；普通 `/c/<id>` 与 Project `/g/g-p-<project-id>/c/<id>` 都支持。不是当前页面的预取、迟到或旧会话响应直接原样返回。
3. 对当前会话的 conversation 响应执行 `Response.clone().json()`，不消费 ChatGPT 原本要读取的 Response。
4. 从 `current_node` 沿 `parent` 构建当前活动路径。
5. 在裁剪前统计完整路径中的总轮数。
6. 启用裁剪时，从倒数第 N 个用户轮开始保留后缀路径，并重建该活动路径的 `parent` / `children`。
7. 如果总轮数不超过限制，直接把原 Response 交还 ChatGPT，不重写 conversation tree。
8. 关闭裁剪时仍会读取当前会话的 conversation JSON 统计总轮数，但不修改响应。

这种方式的重点是让 ChatGPT 的 React 在初始渲染时只看到保留的最近 N 轮，而不是先渲染全部历史再从 DOM 中删除旧内容。

## 悬浮按钮

右下角按钮保持简短格式：

```text
LS 10 / 86
LS Off / 86
```

含义：

- `LS 10 / 86`：裁剪已启用，当前配置保留最近 10 轮，完整活动分支共 86 轮。
- `LS Off / 86`：脚本仍在运行并统计总轮数，但不会裁剪 conversation response。
- 请求尚未取得总轮数时使用 `--` 作为总数占位。

启用时按钮使用绿色强调色；关闭时使用灰色。按钮采用紧凑的小圆角矩形，不使用大胶囊圆角和固定最小宽度，以减少文本两侧空白。

点击按钮打开设置面板，面板包含：

- 横向 switch：启用 / 关闭裁剪。
- `−` / `+`：逐轮调整保留数量。
- 中间数字输入框：可直接输入 `1–100` 的整数；离开输入框时会归一化到合法范围。
- “应用并刷新”：保存新的保留轮数并刷新页面。

## 默认值与旧配置

- 新安装或没有保存配置时，默认保留 **10 轮**。
- 已经保存过 `keepRounds` 的用户升级后继续使用原值，不因默认值变化被强制覆盖。
- 保留轮数允许 `1–100`；输入为空或不合法时，离开输入框会恢复为当前已保存值。
- 设置面板标题为 `Light Session 长对话优化`。

## 刷新规则

### 启用 / 关闭

切换 switch 后立即：

1. 把 `enabled` 和当前面板中的保留轮数写入 `localStorage`。
2. 刷新当前页面。

关闭时刷新是为了重新取得未裁剪的完整 conversation response；开启时刷新是为了保证下一次 conversation GET 从首轮加载开始就经过 Fetch Proxy。

### 修改保留轮数

点击 `−`、`+` 或直接修改数字输入框只改变面板草稿，不立即刷新。

只有点击“应用并刷新”后才：

1. 保存新的 `keepRounds`。
2. 刷新当前页面。
3. 用新的限制重新裁剪 conversation response。

这样可以避免连续调整数字时多次 reload。

## 总轮数与 SPA 切换

conversation GET 是总轮数的权威来源，但脚本 **不会为了更新数字额外主动 GET `/backend-api/conversation/<id>`**。它只被动利用 ChatGPT 自己本来就会发出的 conversation 请求：

- 首次打开或刷新对话时，从 ChatGPT 原生 conversation response 得到权威总轮数。
- 同一标签页通过 SPA 从对话 A 切换到 B 时，立即清空 A 的 `totalRounds`、`keptRounds` 和已见 message id，按钮先显示 `LS N / --`。
- 随后只等待 ChatGPT 自己加载 B；捕获到 B 的原生 conversation response 后再显示 B 的权威总轮数。
- 不为“尽快显示数字”额外访问对话历史接口，以降低短时间重复访问 conversation history 的风险。

脚本从当前 pathname 中识别 `/c/<id>` 路由段，因此既支持普通 `/c/<id>`，也支持 Project `/g/g-p-<project-id>/c/<id>`。conversation response 返回时会再次核对请求 id 与当前 URL。快速执行 `A → B → C` 时，A/B 的迟到响应不会覆盖 C 的悬浮状态，也不会被本脚本改写；因此宁可暂时显示 `--`，也不沿用上一条会话的总轮数。

为避免用户在当前页面继续发送新消息后数字一直停留在初始值，脚本另外安装一个局部增量 MutationObserver：

- 只检查 `addedNodes`，不持续扫描完整正文。
- 只识别带 `data-message-author-role="user"` 和 `data-message-id` 的新增用户消息节点。
- 已见过的 message id 不重复计数。
- 权威 conversation response 到达后先建立当前 DOM 的 message-id 基线，之后才允许新增用户消息令总轮数 `+1`，减少初始历史渲染被误计为新轮次的风险。
- SPA 导航时禁用本地增量并清空基线，直到新会话的权威 response 建立新的基线。

这个 DOM 观察器只用于补充当前页面中新产生的轮数；真正的裁剪仍然发生在 conversation API response 层。

同一个观察器还承担轻量 UI 自愈：每批 DOM 变化只检查一次 `#cyan-ls-root` 是否仍存在。如果 ChatGPT 在 hydration 或 SPA 页面重建时移除了悬浮按钮，脚本会重新创建 UI；样式节点也会按需补回。该检查不遍历完整对话正文。

## 已知限制

- ChatGPT 的内部 API 路径、conversation mapping 结构和 DOM 属性都不是公开稳定接口；网站大改后可能需要维护。
- Fetch Proxy 主要优化 conversation 初始加载 / 重新加载时的历史渲染。当前页面继续产生的新轮次不会自动把 React 已有节点再次压回固定 N 轮；需要重新加载页面时才会重新严格裁剪为 N 轮。
- “总轮数”以当前活动分支计算，不代表 conversation mapping 中所有历史分叉节点的总量。
- 关闭裁剪后仍会 clone 并解析当前会话的 conversation GET 响应用于统计总轮数，因此并非完全零开销；但不会改写响应。
- SPA 切换后如果 ChatGPT 没有重新发出可捕获的当前 conversation GET，总轮数会暂时保持 `--`；脚本不会用额外历史请求强行补齐。
- 如果 Tampermonkey 无法把 `raw` userscript 注入页面主上下文，`window.fetch` 可能无法正确代理。排错时首先确认脚本是否在页面第一次 conversation GET 之前完成 patch。

## 隐私

- 不向第三方服务器发送数据。
- 不保存 conversation response、Cookie、Token 或 Authorization Header。
- 只在 ChatGPT 页面本地保存：是否启用，以及保留轮数。
- 日志默认不输出完整响应内容。

## 上游同步基线

核心架构思路参考 LightSession：

```text
Repository: https://github.com/11me/light-session
Version:    1.7.4
Commit:     300aade18bff188749d062ac2fad7216c7bc36ca
Checked:    2026-08-09
```

这里同时记录版本号和 commit SHA：版本号便于人工阅读，commit SHA 用作未来与上游精确 diff 的基线。检查上游更新时，优先比较该 commit 到上游最新 `master` 的变化，并重点关注：

- `extension/src/page/page-script.ts`：Fetch Proxy、conversation 请求识别和响应改写。
- `extension/src/shared/trimmer.ts`：conversation mapping 裁剪、隐藏节点保留和计数语义。
- `extension/src/content/page-inject.ts`：document-start 与页面主上下文注入。
- 与 bootstrap、状态同步相关的 content script 逻辑：用于判断 ChatGPT SPA 生命周期变化是否需要同步适配。

LightSession 使用 MIT License。当前 userscript 不是原扩展的官方 Tampermonkey 版本，而是针对本仓库单文件 userscript 结构重新实现的版本；本脚本的“一问一答按轮计数”、localStorage 设置、悬浮 switch、UI 自愈和刷新交互均属于本地适配层。

## 维护检查

修改脚本后至少执行：

```bash
node --check userscripts/chatgpt/chatgpt-long-chat-optimizer.user.js
```

实际页面验证建议覆盖：

1. 第一次打开长对话时按钮能显示 `LS N / 总轮数`。
2. 总轮数大于 N 时页面只初始渲染最近 N 轮附近的 conversation path。
3. 关闭 switch 后自动刷新并显示 `LS Off / 总轮数`，完整历史恢复。
4. 重新开启后自动刷新并恢复裁剪。
5. 修改保留轮数时不会立即刷新，点击“应用并刷新”后才生效。
6. 在当前会话新增用户消息时总轮数能够递增。
7. ChatGPT SPA 切换不同会话后立即显示 `LS N / --`，不会沿用上一条会话的总轮数。
8. 在 Network 中确认 SPA 切换只使用 ChatGPT 自己发出的 conversation 请求；脚本不额外主动 GET `/backend-api/conversation/<id>`。
9. 快速执行 `A → B → C` 时，A/B 的迟到 conversation response 不会覆盖 C 的总轮数。
10. 刷新页面并等待 ChatGPT 完成 hydration 后，`#cyan-ls-root` 仍存在；若页面曾删除该节点，悬浮按钮会自动恢复且不会重复创建。
11. 按钮保持紧凑小圆角布局，`LS 10 / 86` 和 `LS Off / 86` 不因固定最小宽度产生明显两端空白。
12. 新安装或没有旧配置时默认保留 10 轮；已有 `localStorage` 配置继续保留用户原值。
13. 设置面板标题显示为 `Light Session 长对话优化`，保留轮数可在中间输入框直接输入 `1–100` 的整数，且不再显示 `5 / 10 / 20 / 30` 快捷按钮。
14. 普通 `/c/<conversation-id>` 与 Project `/g/g-p-<project-id>/c/<conversation-id>` 页面都能识别当前 conversation id，并正常统计总轮数、执行裁剪和防止迟到响应串台。

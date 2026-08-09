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

启动后立即在页面主上下文中保存原始 `window.fetch`，再安装 Fetch Proxy。只对以下 GET 请求做 conversation JSON 检查：

```text
/backend-api/conversation/<id>
/backend-api/shared_conversation/<id>
```

处理顺序：

1. 调用原始 `fetch` 获取正常响应。
2. 对 conversation 响应执行 `Response.clone().json()`，不消费 ChatGPT 原本要读取的 Response。
3. 从 `current_node` 沿 `parent` 构建当前活动路径。
4. 在裁剪前统计完整路径中的总轮数。
5. 启用裁剪时，从倒数第 N 个用户轮开始保留后缀路径，并重建该活动路径的 `parent` / `children`。
6. 如果总轮数不超过限制，直接把原 Response 交还 ChatGPT，不重写 conversation tree。
7. 关闭裁剪时仍会读取 conversation JSON 统计总轮数，但不修改响应。

这种方式的重点是让 ChatGPT 的 React 在初始渲染时只看到保留的最近 N 轮，而不是先渲染全部历史再从 DOM 中删除旧内容。

## 悬浮按钮

右下角按钮保持简短格式：

```text
LS 12 / 86
LS Off / 86
```

含义：

- `LS 12 / 86`：裁剪已启用，当前配置保留最近 12 轮，完整活动分支共 86 轮。
- `LS Off / 86`：脚本仍在运行并统计总轮数，但不会裁剪 conversation response。
- 请求尚未取得总轮数时使用 `--` 作为总数占位。

启用时按钮使用绿色强调色；关闭时使用灰色。按钮采用紧凑的小圆角矩形，不使用大胶囊圆角和固定最小宽度，以减少文本两侧空白。

点击按钮打开设置面板，面板包含：

- 横向 switch：启用 / 关闭裁剪。
- `−` / `+`：逐轮调整保留数量。
- `5 / 10 / 20 / 30`：常用快捷值。
- “应用并刷新”：保存新的保留轮数并刷新页面。

## 刷新规则

### 启用 / 关闭

切换 switch 后立即：

1. 把 `enabled` 和当前面板中的保留轮数写入 `localStorage`。
2. 刷新当前页面。

关闭时刷新是为了重新取得未裁剪的完整 conversation response；开启时刷新是为了保证下一次 conversation GET 从首轮加载开始就经过 Fetch Proxy。

### 修改保留轮数

点击 `−`、`+` 或快捷值只改变面板草稿，不立即刷新。

只有点击“应用并刷新”后才：

1. 保存新的 `keepRounds`。
2. 刷新当前页面。
3. 用新的限制重新裁剪 conversation response。

这样可以避免连续调整数字时多次 reload。

## 总轮数的实时更新

conversation GET 是总轮数的权威来源。为避免用户在当前页面继续发送新消息后数字一直停留在初始值，脚本另外安装一个局部增量 MutationObserver：

- 只检查 `addedNodes`，不持续扫描完整正文。
- 只识别带 `data-message-author-role="user"` 和 `data-message-id` 的新增用户消息节点。
- 已见过的 message id 不重复计数。
- SPA 导航到另一条对话时清空本地 message id 集合，等待新 conversation response 重新给出权威总数。

这个 DOM 观察器只用于补充当前页面中新产生的轮数；真正的裁剪仍然发生在 conversation API response 层。

同一个观察器还承担轻量 UI 自愈：每批 DOM 变化只检查一次 `#cyan-ls-root` 是否仍存在。如果 ChatGPT 在 hydration 或 SPA 页面重建时移除了悬浮按钮，脚本会重新创建 UI；样式节点也会按需补回。该检查不遍历完整对话正文。

## 已知限制

- ChatGPT 的内部 API 路径、conversation mapping 结构和 DOM 属性都不是公开稳定接口；网站大改后可能需要维护。
- Fetch Proxy 主要优化 conversation 初始加载 / 重新加载时的历史渲染。当前页面继续产生的新轮次不会自动把 React 已有节点再次压回固定 N 轮；需要重新加载页面时才会重新严格裁剪为 N 轮。
- “总轮数”以当前活动分支计算，不代表 conversation mapping 中所有历史分叉节点的总量。
- 关闭裁剪后仍会 clone 并解析匹配的 conversation GET 响应用于统计总轮数，因此并非完全零开销；但不会改写响应。
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
7. ChatGPT SPA 切换不同会话后状态不会沿用上一条会话的总轮数。
8. 刷新页面并等待 ChatGPT 完成 hydration 后，`#cyan-ls-root` 仍存在；若页面曾删除该节点，悬浮按钮会自动恢复且不会重复创建。
9. 按钮保持紧凑小圆角布局，`LS 12 / 86` 和 `LS Off / 86` 不因固定最小宽度产生明显两端空白。

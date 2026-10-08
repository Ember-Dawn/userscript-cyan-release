# ChatGPT 界面视觉增强助手

文件：`chatgpt-visual-enhancer.user.js`

该脚本集中维护 ChatGPT 网页版中不改变对话内容和发送行为的显示层增强。当前版本整合了原“ChatGPT 宽屏”和“ChatGPT 文件链接高亮助手”的现役功能，并在 Composer 上沿显示当前对话名称。

## 主要功能

- 白天模式下将主界面与侧边栏背景统一为中性浅灰，并让 Composer 保持稍亮层次；
- 在桌面端放宽对话正文区域，便于阅读长文本、表格和代码；
- 保持底部 Composer 的官方默认宽度和响应式行为，不再随正文一起放宽；
- 在当前 thread Composer 左上沿显示当前对话名称，长标题单行省略并可悬停查看完整名称；
- 高亮助手回答中的文件引用、文件链接和官方“下载 / Download”入口；
- 临时对话在原 Composer 背景中混入 10% `#0891B2` 青色，浅色和深色模式均生效。

## 当前对话名称

标题挂载在当前 thread Composer 的：

```text
form[data-chatgpt-composer][data-composer-placement="thread"]
  > [data-above-composer-portal="true"]
```

若精确 thread 选择器暂时不可用，则回退到普通 `form[data-chatgpt-composer]` 下的同一 portal。首次挂载只在文档达到 `complete` 后进行，并在找到 portal 后等待两个 animation frame 再确认节点仍属于当前 Composer，避免在 ChatGPT hydration 早期过早写入。

标题位于 Composer 左上沿：

```text
left: 14px
right: 166px
bottom: -1px
height: 24px
```

右侧预留 `166px`，用于与当前独立的“顺序任务助手”按钮和“对话轮数统计” badge 共存；标题本身使用 `width: max-content` 和 `max-width: 100%`，短标题只占实际宽度，长标题使用单行省略，完整名称保存在原生 `title` 中供悬停查看。

当前标题来源按以下顺序处理：

1. `temporary-chat=true` 时直接显示“临时对话”；
2. URL 尚无 `/c/<conversation-id>` 时显示“新对话”；
3. 对稳定 conversation，优先使用当前页面 `document.title`，并只移除明确的 `ChatGPT` 品牌后缀；
4. SPA 切换后，在新的 `document.title` 尚未确认更新前，不复用旧页面标题，而是从原生 sidebar 中匹配同一 `/c/<conversation-id>` 的 anchor 作为回退；
5. 若两者都暂时不可用，则显示“加载中…”。

原生 sidebar 标题提取会优先读取 anchor 可见文本，并以 `aria-label` 作为回退；只压缩异常空白和限制最大长度，不泛化删除用户标题中真正存在的 `ChatGPT` / `OpenAI` 字样。

SPA 路由继续复用本脚本已有的 `pushState`、`replaceState` 和 `popstate` 监听。conversation id 变化后会立即把 `document.title` 标记为尚未校准，直到 `<title>` 发生实际变化后才重新将其作为当前对话标题来源，因此不会在 A → B 切换时短暂把 A 的标题当成 B 的标题。

脚本现有的页面 MutationObserver 同时承担 Composer 首次出现/替换检测与 `<title>` 变化检测，不新增持续高频轮询，也不发送任何 ChatGPT API 请求。

## 对话正文宽屏

宽屏功能仅作用于：

```text
[data-thread-user-message-navigation-content="true"]
```

桌面端最大宽度保持为 `min(90rem, calc(100vw - 8rem))`。

脚本不再修改以下区域：

- `data-thread-scroll-footer`；
- `form[data-chatgpt-composer]`；
- App Shell 上层共享的 `--thread-content-expanded-max-width` / `--thread-content-compact-max-width`。

因此输入框宽度继续由 ChatGPT 官方布局控制。

## 文件入口高亮

当前助手正文优先通过以下稳定语义属性识别：

```text
[data-markdown-text-style="assistant-message"]
```

并保留旧版助手 Markdown 结构作为回退。

候选文件入口包括：

- `[data-file-reference="true"]`，包括 ChatGPT 生成文件时出现的“下载本次 ZIP”一类入口；
- `a[href]`；
- `button`；
- `[role="link"]`，用于兼容新版 DIL 的 `span[data-d-component="pressable"][role="link"]` 下载入口。

脚本会结合文件扩展名、`data-markdown-copy-text`、`aria-label` 和“下载 / Download”标签判断是否高亮。兼容新版 DIL 下载链接的 `aria-label="Open 下载 NocoDB Webhook 修复补丁 ZIP"`，只在 `Open` 后明确接“下载 / Download”时去除该前缀，不会把所有 `role="link"` 或普通网页链接都高亮。输入框、Composer、可编辑区域和侧边浮层不会参与高亮。

流式生成可能只新增下载链接内部的文字节点；扫描时也会检查变化节点最近的候选链接祖先，确保外层 `pressable` 已存在的情况下仍能更新高亮。

高亮只改变文字颜色和字重，不创建新的下载按钮，也不改变官方点击或下载行为。

## 临时对话提示

脚本只根据 URL 查询参数 `temporary-chat=true` 判断临时对话，不读取页面标题或其他文案来决定临时状态。

新版 Composer 的视觉主体使用：

```text
[data-composer-body]
```

临时状态直接标记在当前 Composer 节点上，而不再依赖页面根元素。这样浏览器刷新后，即使 ChatGPT 在初始化过程中重新创建 Composer，脚本现有的 MutationObserver 也会在新节点插入时重新同步临时状态。

临时对话仅在原 Composer 背景中混入 10% `#0891B2`，浅色和深色模式采用相同混合比例；不增加边框、外环或阴影。

SPA 路由通过 `pushState`、`replaceState` 和 `popstate` 变化时，脚本会重新同步当前 Composer 状态。

## 白天模式柔化

浅色模式下使用以下变量：

```text
--main-surface-primary: #f4f4f2
--sidebar-surface-primary: #f4f4f2
--composer-surface-primary: #fafaf9
```

深色模式不应用这部分背景覆盖。

## 历史合并

以下独立脚本已停止作为现役脚本发布，其功能已并入本脚本：

```text
archive/userscripts/chatgpt-wide-v1.0.3.user.js
archive/userscripts/chatgpt-file-link-highlighter-v1.0.0.user.js
```

更早的自定义文件直链下载实现仍保存在：

```text
archive/userscripts/chatgpt-direct-download-v0.5.0.user.js
```

旧版临时对话独立高亮脚本保存在：

```text
archive/userscripts/chatgpt-temporary-chat-highlighter-v0.1.0.user.js
```

## 维护原则

- 优先使用 `data-*`、ARIA 和语义结构，不依赖 ChatGPT 的 hash class；
- 当前对话名称以 URL 中 conversation id 为身份基线，SPA 切换时不得把旧 `document.title` 直接沿用到新 conversation；
- Composer 标题 UI 只挂载到 `data-above-composer-portal`，不修改输入框正文或 Composer 官方宽度；
- 宽屏功能只修改正文，不改变 Composer 官方布局；
- 文件高亮 MutationObserver 只扫描新增或变化的局部节点；
- 临时对话状态只根据 URL 判断，并直接同步到当前 Composer 节点；
- 不修改对话正文、输入内容、发送行为、模型选择或下载行为；
- ChatGPT DOM 变化后，优先重新采集实际 outerHTML 再调整选择器。

## 维护检查

修改脚本后至少执行：

```bash
node --check userscripts/chatgpt/chatgpt-visual-enhancer.user.js
```

实际页面建议至少验证：

1. F5 / Ctrl+Shift+R 后标题最终挂载到当前 thread Composer 上沿，且不会因为 Composer 晚出现而永久缺失；
2. 普通 `/c/<id>` 与 Project `/g/g-p-.../c/<id>` 都能显示正确标题；
3. A → B SPA 切换时不应短暂显示 A 的旧标题，B 的 `document.title` 更新后应自动切换；
4. 当前对话 Rename 后，Composer 上沿标题会随 `<title>` 更新；
5. 新对话显示“新对话”，`temporary-chat=true` 显示“临时对话”；
6. 长标题不会侵入右侧顺序任务按钮和轮数 badge，占用空间不足时单行省略，悬停仍能看到完整标题；
7. 旧版 `a[href]`、`button`、`[data-file-reference="true"]` 和新版 DIL `span[role="link"]` 的下载入口均能高亮，包括流式补全文案；普通链接不得误高亮；
8. 原有白天模式、正文宽屏和临时对话 Composer 背景行为保持不变。

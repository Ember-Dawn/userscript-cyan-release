# ChatGPT 界面视觉增强助手

文件：`chatgpt-visual-enhancer.user.js`

该脚本集中维护 ChatGPT 网页版中不改变对话内容和发送行为的显示层增强。当前版本整合了原“ChatGPT 宽屏”和“ChatGPT 文件链接高亮助手”的现役功能。

## 主要功能

- 白天模式下将主界面与侧边栏背景统一为中性浅灰，并让 Composer 保持稍亮层次；
- 在桌面端放宽对话正文区域，便于阅读长文本、表格和代码；
- 保持底部 Composer 的官方默认宽度和响应式行为，不再随正文一起放宽；
- 高亮助手回答中的文件引用、文件链接和官方“下载 / Download”入口；
- 临时对话使用 `#0891B2` 青色描边和轻微同色阴影强调 Composer，浅色和深色模式均生效。

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
- `button`。

脚本会结合文件扩展名、`data-markdown-copy-text`、`aria-label` 和“下载 / Download”标签判断是否高亮。输入框、Composer、可编辑区域和侧边浮层不会参与高亮。

高亮只改变文字颜色和字重，不创建新的下载按钮，也不改变官方点击或下载行为。

## 临时对话提示

脚本根据 URL 查询参数 `temporary-chat=true` 判断临时对话，并在页面根元素维护内部状态属性。

新版 Composer 的视觉主体使用：

```text
[data-composer-body]
```

临时对话时仅增加：

- `2px solid #0891B2` 描边；
- `26px` 圆角匹配当前 Composer；
- 轻微 `#0891B2` 同色外框和阴影。

不强制改写 Composer 背景色，因此浅色和深色模式都沿用 ChatGPT 原生背景。

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
- 宽屏功能只修改正文，不改变 Composer 官方布局；
- 文件高亮 MutationObserver 只扫描新增或变化的局部节点；
- 不修改对话正文、输入内容、发送行为、模型选择或下载行为；
- ChatGPT DOM 变化后，优先重新采集实际 outerHTML 再调整选择器。

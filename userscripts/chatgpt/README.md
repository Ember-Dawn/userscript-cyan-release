# ChatGPT 用户脚本说明

本目录保存用于 ChatGPT 网页版的 Tampermonkey 用户脚本。简单脚本在本页提供索引；功能较复杂的脚本使用独立文档记录操作、限制和维护说明。

## 脚本索引

| 中文名称 | 文件 | 用途 |
|---|---|---|
| ChatGPT 宽屏 | `chatgpt-wide.user.js` | 放宽对话区和输入区，改善长文本与代码阅读。 |
| ChatGPT 文件夹 | `chatgpt-folders.user.js` | 提供聊天文件夹、排序、多标签同步和 WebDAV 同步。 |
| ChatGPT 文件链接高亮助手 | `chatgpt-file-link-highlighter.user.js` | 高亮助手回答中的文件链接和官方文件入口。 |
| ChatGPT GitHub 自动允许助手 | `chatgpt-auto-allow-github.user.js` | 自动处理 ChatGPT 中明确指向 GitHub 的授权卡片。 |
| ChatGPT 顺序任务助手 | `chatgpt-sequential-task-queue.user.js` | 将多行命令按会话顺序发送并显示进度。 |
| ChatGPT 朗读增强助手 | `chatgpt-read-aloud-enhancer.user.js` | 增加一级朗读入口、悬浮播放器、消息切换、快捷键和本地 MP3 下载。参见[详细说明](./chatgpt-read-aloud-enhancer.md)。 |

## 维护原则

- ChatGPT 是单页应用，新增控件应兼容消息和操作栏的动态重建。
- DOM 选择器应优先使用稳定的 `data-testid`、`aria-label`、角色和语义结构，避免依赖易变的样式类名。
- MutationObserver 热路径只处理新增或变化的局部节点，不持续遍历完整对话正文。
- 不调用未公开接口时，优先复用页面已有的官方操作和媒体元素。
- 修改用户可见行为后提升脚本版本号，并检查 `@updateURL` 与 `@downloadURL`。
- 不提交 Cookie、Token、Authorization Header、完整会话响应或其他凭据。


## MP3 下载排错

朗读增强助手的 MP3 下载失败时，会在浏览器本地保存最近一次脱敏诊断日志。通过 Tampermonkey 菜单中的“导出最近一次 MP3 诊断日志”可导出 JSON 文件。

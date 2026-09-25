# Cyan 脚本与插件合集

这是 Cyan 用户脚本和软件插件的公开发布仓库，用于提供可直接安装、在线导入和自动更新的发布文件。

本仓库中的文件由私有开发仓库自动同步。请通过下表安装或导入，不要直接修改公开仓库中的发布文件。

## 仓库结构

```text
userscript-cyan-release/
├─ README.md
├─ userscripts/
│  ├─ 1panel/
│  ├─ chatgpt/
│  ├─ github/
│  ├─ nocodb/
│  ├─ solidtime/
│  └─ youtube/
└─ plugins/
   └─ musicfree/
      ├─ README.md
      ├─ webdav-with-lyric.js
      └─ webdav-lyric.js
```

## Tampermonkey 用户脚本

### 1Panel

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| 1Panel 计划任务名称列宽调整 | [`1panel-cronjob-column-resizer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/1panel/1panel-cronjob-column-resizer.user.js) | 为计划任务表格增加“任务名称”列拖动调整功能。 |

### ChatGPT

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| ChatGPT 文件夹 | [`chatgpt-folders.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js) | 提供聊天文件夹、排序、多标签同步和 WebDAV 同步。 |
| ChatGPT 顺序任务助手 | [`chatgpt-sequential-task-queue.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js) | 每个非空行作为一轮命令，按对话独立保存并顺序发送；提供面板内确认弹窗和绿黄分段进度。 |
| ChatGPT 界面视觉增强助手 | [`chatgpt-visual-enhancer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-visual-enhancer.user.js) | 柔化白天模式；仅放宽对话正文并保留 Composer 默认宽度；高亮助手文件下载入口；临时对话在 Composer 背景中混入 10% `#0891B2` 青色提示。 |
| ChatGPT 对话轮数统计 | [`chatgpt-conversation-round-counter.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js) | 精确统计当前对话的完整用户轮数，支持后台分页补齐、断点续跑、持久缓存和新建对话实时计数。 |

ChatGPT 界面视觉增强助手的正文宽屏、文件入口高亮、临时对话提示和浅色主题说明见 [`userscripts/chatgpt/chatgpt-visual-enhancer.md`](./userscripts/chatgpt/chatgpt-visual-enhancer.md)。

ChatGPT 对话轮数统计的分页机制、缓存、新建对话绑定和维护说明见 [`userscripts/chatgpt/chatgpt-conversation-round-counter.md`](./userscripts/chatgpt/chatgpt-conversation-round-counter.md)。


### GitHub

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| GitHub 已归档仓库隐藏助手 | [`github-hide-archived-repositories.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js) | 默认隐藏个人仓库列表中的已归档仓库。 |

### NocoDB

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| NocoDB 代码块工具 | [`nocodb-code-tools.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-code-tools.user.js) | 为 Rich Text 代码块提供悬浮复制和带确认的安全清空功能。 |
| NocoDB Rich Text 视觉样式增强 | [`nocodb-richtext-style.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-style.user.js) | 为 H1-H6、加粗文字、`【xxx】` 和 `「xxx」` 提供显示层颜色增强，并统一放宽顶层段落与有序/无序列表之后的间距。 |
| NocoDB Rich Text 图片查看器 | [`nocodb-richtext-image.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-image.user.js) | 调整 Rich Text 正文图片宽度并居中；双击图片可缩放、拖拽和查看原始尺寸。 |
| NocoDB 音频播放器 | [`nocodb-audio-player.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-audio-player.user.js) | 接管指定 Media Manager MP3 Button，在 NocoDB 页面内显示可拖动的深色悬浮播放器，并提供进度、倍速和快捷键控制。 |
| NocoDB 思维导图 | [`nocodb-mindmap.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-mindmap.user.js) | 接管携带 Record ID 的原生 Button，在当前页面的大弹窗中编辑思维导图，并通过 NocoDB v3 API 自动保存到 `MindMapData` JSON 字段。 |
| NocoDB Markdown 表格 | [`nocodb-markdown-table.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js) | 自动识别 Markdown 表格，并提供表格渲染、单元格编辑及行列增删。 |
| NocoDB Rich Text Markdown 导出 | [`nocodb-richtext-markdown-export.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-markdown-export.user.js) | 将当前 Rich Text 编辑器导出为普通 Markdown，并通过“切换 TOC”按钮锚点定位导出按钮。 |
| NocoDB Rich Text 大纲 | [`nocodb-richtext-outline.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js) | 以纯 DOM 旁路方式提供可滚动、可调宽度的 H1-H6 TOC。 |

NocoDB 代码块工具的功能、确认交互和 ProseMirror 维护约定见 [`userscripts/nocodb/nocodb-code-tools.md`](./userscripts/nocodb/nocodb-code-tools.md)。

NocoDB Markdown 表格的实际保存、NodeView 渲染和导出规则见 [`userscripts/nocodb/README.md`](./userscripts/nocodb/README.md)。NocoDB Rich Text 大纲的纯 DOM 技术说明见 [`userscripts/nocodb/nocodb-richtext-outline.md`](./userscripts/nocodb/nocodb-richtext-outline.md)。NocoDB 音频播放器的 URL 拦截、悬浮播放器和快捷键说明见 [`userscripts/nocodb/nocodb-audio-player.md`](./userscripts/nocodb/nocodb-audio-player.md)。NocoDB 思维导图的 Button URL、`MindMapData` 数据结构、API Token 和自动保存说明见 [`userscripts/nocodb/nocodb-mindmap.md`](./userscripts/nocodb/nocodb-mindmap.md)。

### solidtime

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| solidtime 交互增强助手 | [`solidtime-enhancer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/solidtime/solidtime-enhancer.user.js) | 优化计时器与 Project/Task 交互，包括抑制非必要自动聚焦，以及 Project 和 Task 的中英混合自然升序；PC 和手机通用。 |

详细功能、Project/Task XHR 全分页排序机制和维护测试见 [`userscripts/solidtime/README.md`](./userscripts/solidtime/README.md)。

### YouTube

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| YouTube 工具箱 | [`youtube-tools.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/youtube/youtube-tools.user.js) | 打开频道上传播放列表、处理上传日期并导出 CSV。 |

## MusicFree 插件

| 插件名称 | 在线导入文件 | 用途 |
|---|---|---|
| WebDAV 音乐与内嵌歌词 | [`webdav-with-lyric.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-with-lyric.js) | 搜索和播放 WebDAV 音乐，并尝试读取内嵌歌词。 |
| WebDAV LRC 歌词 | [`webdav-lyric.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-lyric.js) | 搜索和读取 WebDAV 中的独立 `.lrc` 歌词。 |

详细配置见 [`plugins/musicfree/README.md`](./plugins/musicfree/README.md)。

## 安装和更新

1. 油猴脚本：点击上表中的 `.user.js` 文件名，在 Tampermonkey 页面中安装或更新。
2. MusicFree 插件：复制对应 `.js` 的 Raw 地址，在 MusicFree 插件管理页面中在线导入。
3. 后续更新由脚本或插件内部的公开地址检查。

## 隐私说明

仓库不应包含真实密码、Cookie、Token、API Key、Authorization Header 或其他登录凭据。WebDAV 等配置由用户在本地运行环境中填写。

## 来源与许可

`YouTube 工具箱`保留原始来源与 `Unlicense` 信息。其他文件目前没有统一设置仓库级许可证，各文件的来源和授权信息以文件内说明及其历史记录为准。

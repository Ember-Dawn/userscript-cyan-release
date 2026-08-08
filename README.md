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
| ChatGPT 宽屏 | [`chatgpt-wide.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-wide.user.js) | 自动放宽 ChatGPT 的对话区和输入区。 |
| ChatGPT 文件夹 | [`chatgpt-folders.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js) | 提供聊天文件夹、排序、多标签同步和 WebDAV 同步。 |
| ChatGPT 文件链接高亮助手 | [`chatgpt-file-link-highlighter.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-file-link-highlighter.user.js) | 高亮助手回答中的文件链接和 ChatGPT 官方下载入口。 |
| ChatGPT GitHub 自动允许助手 | [`chatgpt-auto-allow-github.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-auto-allow-github.user.js) | 自动处理 ChatGPT 的 GitHub 权限卡片。 |
| ChatGPT 顺序任务助手 | [`chatgpt-sequential-task-queue.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js) | 每个非空行作为一轮命令，按对话独立保存并顺序发送；提供面板内确认弹窗和绿黄分段进度。 |
| ChatGPT 朗读增强助手 | [`chatgpt-read-aloud-enhancer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-read-aloud-enhancer.user.js) | 为官方朗读增加一级入口、悬浮播放器、消息切换、跳转和倍速控制，并支持在浏览器本地下载 MP3。 |

详细功能和使用说明见 [`userscripts/chatgpt/chatgpt-read-aloud-enhancer.md`](./userscripts/chatgpt/chatgpt-read-aloud-enhancer.md)。

### GitHub

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| GitHub 已归档仓库隐藏助手 | [`github-hide-archived-repositories.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js) | 默认隐藏个人仓库列表中的已归档仓库。 |

### NocoDB

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| NocoDB 代码块工具 | [`nocodb-code-tools.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-code-tools.user.js) | 为 Rich Text 代码块提供悬浮复制和带确认的安全清空功能。 |
| NocoDB 彩虹标题 | [`nocodb-rainbow-headings.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-rainbow-headings.user.js) | 为 Rich Text 标题应用不同颜色。 |
| NocoDB 文件夹 | [`nocodb-folders.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-folders.user.js) | 为 NocoDB 表格提供文件夹式组织和 WebDAV 同步。 |
| NocoDB LongText 字体改色 | [`nocodb-longtext-color.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-longtext-color.user.js) | 为特定富文本内容应用颜色。 |
| NocoDB Markdown 表格 | [`nocodb-markdown-table.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-markdown-table.user.js) | 自动识别 Markdown 表格，并提供表格渲染、单元格编辑及行列增删。 |
| NocoDB Rich Text Markdown 导出 | [`nocodb-richtext-markdown-export.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-markdown-export.user.js) | 在 TOC 按钮右侧增加复制和下载按钮，将当前 Rich Text 编辑器导出为普通 Markdown。 |
| NocoDB Rich Text 大纲 | [`nocodb-richtext-outline.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js) | 在 Rich Text 弹窗旁显示标题大纲。 |

NocoDB 代码块工具的功能、确认交互和 ProseMirror 维护约定见 [`userscripts/nocodb/nocodb-code-tools.md`](./userscripts/nocodb/nocodb-code-tools.md)。

NocoDB Markdown 表格的实际保存、NodeView 渲染和导出规则见 [`userscripts/nocodb/README.md`](./userscripts/nocodb/README.md)。

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

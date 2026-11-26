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
│  ├─ flaticon/
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

| 中文名称 | 安装文件 | 最新快照（SHA） | 用途 |
|---|---|---|---|
| 1Panel 计划任务名称列宽调整 | [`1panel-cronjob-column-resizer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/1panel/1panel-cronjob-column-resizer.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/1panel/1panel-cronjob-column-resizer.user.js?t=20261126-161312) | 为计划任务表格增加“任务名称”列拖动调整功能。 |

### ChatGPT

| 中文名称 | 安装文件 | 最新快照（SHA） | 用途 |
|---|---|---|---|
| ChatGPT 文件夹 | [`chatgpt-folders.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-folders.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/chatgpt/chatgpt-folders.user.js?t=20261126-161312) | 提供聊天文件夹、排序、多标签同步和 WebDAV 同步。 |
| ChatGPT 顺序任务助手 | [`chatgpt-sequential-task-queue.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/chatgpt/chatgpt-sequential-task-queue.user.js?t=20261126-161312) | 每个非空行作为一轮命令，按对话独立保存并顺序发送；提供面板内确认弹窗和绿黄分段进度。 |
| ChatGPT 界面视觉增强助手 | [`chatgpt-visual-enhancer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-visual-enhancer.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/chatgpt/chatgpt-visual-enhancer.user.js?t=20261126-161312) | 柔化白天模式；仅放宽对话正文并保留 Composer 默认宽度；高亮助手文件下载入口；临时对话在 Composer 背景中混入 10% `#0891B2` 青色提示。 |
| ChatGPT 对话轮数统计 | [`chatgpt-conversation-round-counter.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/chatgpt/chatgpt-conversation-round-counter.user.js?t=20261126-161312) | 精确统计当前对话的完整用户轮数，支持后台分页补齐、断点续跑、持久缓存和新建对话实时计数。 |




### Flaticon

| 中文名称 | 安装文件 | 最新快照（SHA） | 用途 |
|---|---|---|---|
| Flaticon 快捷下载助手 | [`flaticon-quick-download.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/flaticon/flaticon-quick-download.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/flaticon/flaticon-quick-download.user.js?t=20261126-161312) | 在图标卡片左侧提供每次 hover 清空的可选 HEX 颜色、一键 Copy PNG 和一键 Download PNG，同时保留全部原生按钮并隐藏快捷下载过程中的中间弹窗。 |


### GitHub

| 中文名称 | 安装文件 | 最新快照（SHA） | 用途 |
|---|---|---|---|
| GitHub 已归档仓库隐藏助手 | [`github-hide-archived-repositories.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/github/github-hide-archived-repositories.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/github/github-hide-archived-repositories.user.js?t=20261126-161312) | 默认隐藏个人仓库列表中的已归档仓库。 |

### NocoDB

| 中文名称 | 安装文件 | 最新快照（SHA） | 用途 |
|---|---|---|---|
| NocoDB Rich Text 增强 | [`nocodb-richtext-enhancer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-enhancer.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/nocodb/nocodb-richtext-enhancer.user.js?t=20261126-161312) | 合并视觉样式、代码块复制/下载 TXT/清空、图片双击全屏查看器，以及多级有序/无序列表折叠。 |
| NocoDB 音频播放器 | [`nocodb-audio-player.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-audio-player.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/nocodb/nocodb-audio-player.user.js?t=20261126-161312) | 接管指定 Media Manager MP3 Button，在 NocoDB 页面内显示可拖动的深色悬浮播放器，并提供进度、倍速和快捷键控制。 |
| NocoDB Rich Text 思维导图 | [`nocodb-richtext-mindmap.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-mindmap.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/nocodb/nocodb-richtext-mindmap.user.js?t=20261126-161312) | 在 Rich Text 中保存 MindMap 永久链接，并以单 iframe 复用方式打开和保存独立导图。 |
| NocoDB Rich Text Markdown 导出 | [`nocodb-richtext-markdown-export.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-markdown-export.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/nocodb/nocodb-richtext-markdown-export.user.js?t=20261126-161312) | 将当前 Rich Text 编辑器导出为普通 Markdown，并通过“切换 TOC”按钮锚点定位导出按钮。 |
| NocoDB Rich Text 大纲 | [`nocodb-richtext-outline.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-richtext-outline.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/nocodb/nocodb-richtext-outline.user.js?t=20261126-161312) | 以纯 DOM 旁路方式提供可滚动、可调宽度的 H1-H6 TOC，并兼容 Source Code 源码模式。 |




### solidtime

| 中文名称 | 安装文件 | 最新快照（SHA） | 用途 |
|---|---|---|---|
| solidtime 交互增强助手 | [`solidtime-enhancer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/solidtime/solidtime-enhancer.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/solidtime/solidtime-enhancer.user.js?t=20261126-161312) | 优化计时器与 Project/Task 交互，包括抑制非必要自动聚焦，以及 Project 和 Task 的中英混合自然升序；PC 和手机通用。 |


### YouTube

| 中文名称 | 安装文件 | 最新快照（SHA） | 用途 |
|---|---|---|---|
| YouTube 工具箱 | [`youtube-tools.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/youtube/youtube-tools.user.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/userscripts/youtube/youtube-tools.user.js?t=20261126-161312) | 打开频道上传播放列表、处理上传日期并导出 CSV。 |

## MusicFree 插件

| 插件名称 | 在线导入文件 | 最新快照（SHA） | 用途 |
|---|---|---|---|
| WebDAV 音乐与内嵌歌词 | [`webdav-with-lyric.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-with-lyric.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/plugins/musicfree/webdav-with-lyric.js?t=20261126-161312) | 搜索和播放 WebDAV 音乐，并尝试读取内嵌歌词。 |
| WebDAV LRC 歌词 | [`webdav-lyric.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-lyric.js) | [`ddc385a`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/ddc385a08f8e1ec095d8de457c5ee78a80e6a2d7/plugins/musicfree/webdav-lyric.js?t=20261126-161312) | 搜索和读取 WebDAV 中的独立 `.lrc` 歌词。 |

详细配置见 [`plugins/musicfree/README.md`](./plugins/musicfree/README.md)。

## 安装和更新

1. 油猴脚本：点击上表中的 `.user.js` 文件名，在 Tampermonkey 页面中安装或更新。
2. MusicFree 插件：复制对应 `.js` 的 Raw 地址，在 MusicFree 插件管理页面中在线导入。
3. 后续更新由脚本或插件内部的公开地址检查。

## 隐私说明

仓库不应包含真实密码、Cookie、Token、API Key、Authorization Header 或其他登录凭据。WebDAV 等配置由用户在本地运行环境中填写。

## 来源与许可

`YouTube 工具箱`保留原始来源与 `Unlicense` 信息。其他文件目前没有统一设置仓库级许可证，各文件的来源和授权信息以文件内说明及其历史记录为准。

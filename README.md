# Cyan 脚本与插件合集

这是 Cyan 个人脚本和软件插件的公开发布仓库，用于提供：

- 可直接安装和自动更新的 Tampermonkey 用户脚本；
- 可由 MusicFree 在线导入的插件脚本。

本仓库中的公开文件由私有开发仓库维护。请通过本文提供的链接安装或导入，不要直接修改公开仓库中的发布文件。

## 仓库结构

```text
userscript-cyan-release/
├─ README.md
├─ scripts/
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
| 1Panel 计划任务名称列宽调整 | [`1panel-cronjob-column-resizer.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/1panel/1panel-cronjob-column-resizer.user.js) | 为计划任务表格增加“任务名称”列拖动调整功能，并通过压缩其他列保持表格总宽度基本不变。 |

### ChatGPT

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| ChatGPT 宽屏 | [`chatgpt-wide.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-wide.user.js) | 自动放宽 ChatGPT 的对话区和输入区，使长文本与代码更易阅读。 |
| ChatGPT 文件夹 | [`chatgpt-folders.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-folders.user.js) | 在 ChatGPT 侧边栏中提供聊天文件夹、排序、多标签同步和 WebDAV 同步等功能。 |
| ChatGPT 文件直链下载按钮助手 | [`chatgpt-direct-download.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-direct-download.user.js) | 在生成文件链接旁增加“下载”按钮，尽量绕过右侧预览栏并直接下载文件。 |
| ChatGPT GitHub 自动允许助手 | [`chatgpt-auto-allow-github.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/chatgpt/chatgpt-auto-allow-github.user.js) | 当 ChatGPT 出现 GitHub 权限卡片时，延迟后自动点击“允许”。 |

### GitHub

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| GitHub 已归档仓库隐藏助手 | [`github-hide-archived-repositories.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/github/github-hide-archived-repositories.user.js) | 在个人仓库列表中默认隐藏已归档仓库，并在筛选栏提供显示或隐藏开关。 |

### NocoDB

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| NocoDB 代码块复制 | [`nocodb-code-copy.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-code-copy.user.js) | 为 LongText/Rich Text 中的代码块增加悬浮复制按钮。 |
| NocoDB 复制 Record 为 JSON | [`nocodb-record-json.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-record-json.user.js) | 在记录详情弹层中增加按钮，将当前记录复制为 JSON。 |
| NocoDB 彩虹标题 | [`nocodb-rainbow-headings.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-rainbow-headings.user.js) | 为 Rich Text 编辑器中的 H1-H6 标题应用不同颜色。 |
| NocoDB 文件夹 | [`nocodb-folders.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-folders.user.js) | 为 NocoDB 表格提供文件夹式组织、排序、状态保存和 WebDAV 同步等功能。 |
| NocoDB LongText 字体改色 | [`nocodb-longtext-color.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-longtext-color.user.js) | 为加粗文字、`【xxx】` 和 `「xxx」` 等内容应用便于识别的颜色。 |
| NocoDB Rich Text 大纲 | [`nocodb-richtext-outline.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/nocodb/nocodb-richtext-outline.user.js) | 在 Rich Text 弹窗旁显示可滚动、可调整宽度的标题大纲。 |

### YouTube

| 中文名称 | 安装文件 | 用途 |
|---|---|---|
| YouTube 工具箱 | [`youtube-tools.user.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/youtube/youtube-tools.user.js) | 打开频道上传播放列表、处理播放列表上传日期并导出 CSV。 |

## MusicFree 插件

| 插件名称 | 在线导入文件 | 用途 |
|---|---|---|
| WebDAV 音乐与内嵌歌词 | [`webdav-with-lyric.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-with-lyric.js) | 搜索、浏览和播放 WebDAV 音乐，并在运行环境支持时尝试读取音频内嵌歌词。 |
| WebDAV LRC 歌词 | [`webdav-lyric.js`](https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-lyric.js) | 从 WebDAV 搜索并读取与歌曲名称匹配的独立 `.lrc` 歌词。 |

详细配置说明见 [`plugins/musicfree/README.md`](./plugins/musicfree/README.md)。

## 安装和导入

### Tampermonkey

1. 在浏览器中安装 Tampermonkey。
2. 点击上表中的 `.user.js` 文件名。
3. 在 Tampermonkey 页面中确认安装或更新。
4. 后续版本由脚本中的 `@updateURL` 自动检查。

各脚本的 `@name` 和 `@namespace` 用于维持 Tampermonkey 中的脚本身份。迁移到本发布仓库后，这些字段保持不变。

### MusicFree

1. 复制上表中对应插件的 Raw 地址。
2. 在 MusicFree 的插件管理界面选择在线导入。
3. 导入后填写 WebDAV 地址、用户名、密码和搜索目录。
4. 后续更新以插件中的 `srcUrl` 和 MusicFree 的插件更新机制为准。

## 隐私说明

仓库不应包含真实密码、Cookie、Token、API Key、Authorization Header 或其他登录凭据。WebDAV 凭据由用户在 MusicFree 中本地配置，不写入插件文件。

## 来源与许可

`YouTube 工具箱`保留了脚本头部中的原始来源与 `Unlicense` 信息。其他脚本和插件目前没有统一设置仓库级许可证，各文件的来源和授权信息以文件内说明及其历史记录为准。

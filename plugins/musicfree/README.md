# MusicFree 插件

本目录保存可由 MusicFree 在线导入的插件源文件。文件在私有开发仓库中维护，并由 GitHub Actions 同步到公开发布仓库。

## 插件列表

| 插件 | 文件 | 用途 |
|---|---|---|
| WebDAV 音乐与内嵌歌词 | `webdav-with-lyric.js` | 搜索、浏览和播放 WebDAV 中的音频，并在运行环境支持时尝试读取音频内嵌歌词。 |
| WebDAV LRC 歌词 | `webdav-lyric.js` | 搜索和读取 WebDAV 中与歌曲名称匹配的独立 `.lrc` 歌词。 |

## 在线导入地址

```text
https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-with-lyric.js
```

```text
https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-lyric.js
```

## 配置说明

两个插件均通过 MusicFree 的用户变量读取 WebDAV 配置，不应在仓库文件中写入真实用户名、密码、Cookie、Token 或其他凭据。

### WebDAV 音乐与内嵌歌词

需要配置：

- `url`：WebDAV 地址。
- `username`：WebDAV 用户名。
- `password`：WebDAV 密码。
- `searchPath`：歌曲目录；多个目录使用英文逗号分隔。

内嵌歌词读取依赖 MusicFree 插件环境是否允许访问相应的 React Native 原生模块。即使歌词读取不可用，音乐搜索和播放仍可继续工作。

### WebDAV LRC 歌词

需要配置：

- `url`：WebDAV 地址。
- `username`：WebDAV 用户名。
- `password`：WebDAV 密码。
- `searchPath`：歌词目录；多个目录使用英文逗号分隔。

推荐让歌曲标题与歌词文件同名，例如：

```text
周杰伦 - 晴天.mp3
周杰伦 - 晴天.lrc
```

## 维护规则

1. 只在私有开发仓库中修改插件文件。
2. 修改插件行为后提升文件中的 `version`。
3. `srcUrl` 始终指向公开发布仓库中的对应 Raw 地址。
4. 提交前执行 JavaScript 语法检查。
5. 等待发布工作流同步完成后，再使用公开 Raw 地址在 MusicFree 中导入或更新。

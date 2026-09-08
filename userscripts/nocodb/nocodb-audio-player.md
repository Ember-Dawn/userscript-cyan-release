# NocoDB 音频播放器

`nocodb-audio-player.user.js` 用于在自部署 NocoDB 页面内播放 Media Manager 中的 MP3。脚本不修改 NocoDB 源码，也不读取 Canvas Grid 的内部行列数据；它只拦截 NocoDB 原生 Button 字段最终触发的目标音频 URL，并在页面右下角显示独立的深色悬浮播放器。

## 1. 使用场景

英语语料表中的 `audio` 字段使用 NocoDB 原生 Button，并通过 Formula 构造：

```text
https://media.380782744.xyz/media/audio/{corpus_id}.mp3
```

例如 `corpus_id=j2jnfze2` 时：

```text
https://media.380782744.xyz/media/audio/j2jnfze2.mp3
```

NocoDB 当前会通过：

```text
window.open(url, "_blank", "noopener,noreferrer")
```

打开 Button URL。脚本在 `document-start` 阶段包装 `window.open`，只接管符合以下条件的 MP3：

```text
origin = https://media.380782744.xyz
path   = /media/audio/*.mp3
```

其他 URL 继续交给原始 `window.open`，因此不影响 NocoDB 中其他 Button 或普通外部链接。

### Batch TTS 音频的缓存规避

英语语料项目会用稳定文件名保存 Batch TTS 音频：

```text
/media/audio/{corpus_id}.mp3
```

其中 `corpus_id` 当前固定为 8 位小写字母或数字。重新生成音频时文件名和公开 URL 不变，因此浏览器或中间缓存层可能继续返回旧 MP3。实际排查中曾出现：服务器上的 MP3 已更新，但 NocoDB 中再次点击 Play 仍播放旧内容；给同一 URL 临时追加查询参数后即可拿到新音频。

为避免把缓存策略写进 Media Manager 服务端，本脚本只对符合以下模式的 Batch TTS 音频，在真正赋给 `<audio>` 播放时追加当前毫秒时间戳：

```text
/media/audio/[a-z0-9]{8}.mp3
```

逻辑 URL 仍保持不变，例如：

```text
https://media.380782744.xyz/media/audio/m4q8z2kp.mp3
```

实际播放请求会变成类似：

```text
https://media.380782744.xyz/media/audio/m4q8z2kp.mp3?_t=1788912345678
```

`_t` 只用于 cache busting，不写入 NocoDB，不改变文件名，也不改变播放器标题。每次重新加载该音频时都会生成新的时间戳；播放完毕后再次播放也会重新加载并生成新的时间戳。对于不符合 8 位 `corpus_id.mp3` 命名规则的其他 `/media/audio/*.mp3`，播放器仍按原 URL 请求，不主动增加缓存参数。

播放器内部继续用不带临时时间戳的逻辑 URL 判断“是否为同一条音频”，因此同一条尚未播放结束的音频再次点击仍保持原来的播放 / 暂停行为，不会仅因为 `_t` 不同而被误判为另一条音频。

## 2. 播放器行为

点击符合规则的 `Play` Button 后：

1. 不再打开新标签页；
2. 页面右下角显示深色悬浮播放器；
3. 自动加载并播放对应 MP3；符合 8 位 `corpus_id.mp3` 规则时，实际媒体请求会附加新的 `_t=<timestamp>`；
4. 再次点击同一条尚未播放结束的音频时切换播放 / 暂停；
5. 同一条音频播放结束后再次播放时重新加载，并为 Batch TTS 音频生成新的 `_t`；
6. 点击另一条音频时停止当前音频并直接切换到新音频；
7. 播放结束后播放器保留；
8. 点击关闭按钮后停止播放并隐藏播放器；
9. 可按住播放器顶部标题区域拖动整个播放器，拖动位置写入浏览器 `localStorage`，刷新页面后继续使用上次位置；窗口尺寸变化时会自动把已保存位置限制在可视区域内。

当前播放器采用紧凑的两层布局：顶部显示文件名、快捷键提示和当前倍速，底部只显示播放按钮、时间与进度条。倍速是纯状态文本，不再使用按钮样式或鼠标点击切换。快捷键提示保持较高对比度。

当前提供：

- 播放 / 暂停；
- 当前时间 / 总时长；
- 可拖动进度条；
- 倍速状态显示与键盘控制；
- 可拖动并记忆位置的悬浮播放器；
- 关闭播放器；
- 加载失败提示。

当前不提供音量控制。

## 3. 键盘快捷键

播放器有音频加载且页面焦点不在编辑控件中时：

| 按键 | 行为 |
|---|---|
| `Space` | 播放 / 暂停 |
| `←` | 后退 5 秒 |
| `→` | 前进 5 秒 |
| `↑` | 提高 `0.1×` 倍速 |
| `↓` | 降低 `0.1×` 倍速 |
| `Esc` | 全局关闭播放器；有可见 NocoDB 弹窗时不接管 |

倍速范围为 `0.5×`～`2.0×`，每次按 `↑` / `↓` 以 `0.1×` 为增量调整。

为了避免影响 NocoDB 编辑，以下区域获得焦点时快捷键不会被播放器接管：

- `input`
- `textarea`
- `select`
- `contenteditable`
- ProseMirror
- Monaco Editor

## 4. 为什么不操作 NocoDB Canvas Grid

当前 NocoDB Grid 主要由 `<canvas>` 渲染，表格里的 `corpus_id`、Button 等并不是稳定、独立的 DOM cell。直接按 Canvas 坐标推断行列会依赖 NocoDB 内部 Grid 实现、滚动位置和列宽，升级后维护成本较高。

当前原生 Button 已经完成：

```text
当前记录 → Formula → 目标 MP3 URL → window.open(...)
```

因此脚本只在最后一步接管目标 URL，可以保持与排序、筛选、分组、虚拟滚动和列顺序相对解耦。

## 5. 与 Media Manager 的边界

Media Manager 位于 `english-speaking-lab` 项目，负责文件管理与公开媒体分发；本脚本位于 `userscript-cyan`，负责 NocoDB 浏览器端播放体验，包括对 Batch TTS 固定 URL 的浏览器端 cache busting。

Media Manager 不理解 `corpus_id`。`corpus_id.mp3` 的命名和 NocoDB Button Formula 都属于上层英语语料项目约定。针对该命名模式追加 `_t` 是本播放器的客户端行为，不要求 Media Manager 增加专用禁缓存代码。

关联项目：

```text
https://github.com/Ember-Dawn/english-speaking-lab
```

Media Manager 文档：

```text
docs/media-manager.md
```

如果任务仅涉及本脚本的播放器 UI、快捷键、拖动、`window.open` 拦截或其他浏览器端交互，读取 `userscript-cyan` 本仓库中的当前脚本与本文档即可继续维护；除非任务涉及 Media Manager 服务端、公开 URL 约定或 `corpus_id.mp3` 文件命名，否则无需读取 `english-speaking-lab`。

## 6. 维护注意事项

- 不要扩大 `window.open` 拦截范围；只接管指定 Media Manager 音频路径下的 MP3。
- Batch TTS cache busting 只应用于 `/media/audio/[a-z0-9]{8}.mp3`；不要把 `_t` 自动加到所有媒体文件。
- `currentUrl` 保持逻辑上的原始 URL，不保存临时 `_t`；同一音频判断不能依赖每次变化的实际播放请求 URL。
- 保持 `@run-at document-start`，以便在 NocoDB Button 触发前完成包装。
- 不要依赖 Canvas cell DOM、固定列坐标或当前行号。
- 播放器拖动仅由顶部标题区域触发，按钮和进度条不应触发整体拖动。
- 当前倍速只作为顶部状态文本显示，不提供倍速按钮；倍速由 `↑` / `↓` 按 `0.1×` 增量控制，范围保持在 `0.5×`～`2.0×`。
- `Esc` 在播放器显示时作为全局关闭快捷键；但如果页面存在可见的 NocoDB `.ant-modal-content` 弹窗，脚本不接管该按键，让 NocoDB 自己处理 Escape。弹窗可见性通过实际布局与 `display` / `visibility` 判断，避免把残留但已隐藏的 modal DOM 误判为打开状态。
- 播放器位置使用 `tm-nocodb-audio-player-position-v1` 保存到当前 NocoDB 站点的 `localStorage`；如果存储不可用，播放器仍应可以在当前页面拖动。
- 修改可执行行为后提升 `@version`。
- 脚本 metadata 中的 `@updateURL` / `@downloadURL` 保持指向私有开发仓库标准 Raw URL，不写缓存参数。
- 如果 Media Manager 域名或音频目录变化，应同步修改脚本中的 `AUDIO_ORIGIN` / `AUDIO_PATH_PREFIX` 和本说明。

## 7. 回归测试

每次修改后至少验证：

1. 点击 `j2jnfze2` 等记录的 `Play` 后不打开新标签页，并自动播放正确 MP3；
2. 对 `j2jnfze2.mp3`、`m4q8z2kp.mp3` 等 8 位 `corpus_id.mp3`，实际 `<audio>` 请求 URL 带 `_t=<timestamp>`；重新加载同一音频时 `_t` 会变化；
3. 再点同一条尚未结束的音频时可以暂停 / 继续，不因临时时间戳变化而被当成另一条音频；
4. 音频播放结束后再次播放时会重新加载，并使用新的 `_t`；
5. 不符合 8 位 `corpus_id.mp3` 规则的其他 `/media/audio/*.mp3` 不会被自动追加 `_t`；
6. 点击另一条时立即切换音频；
7. `Space`、方向键按约定工作，`↑` / `↓` 每次精确调整 `0.1×`；
8. 在 NocoDB 输入框、Rich Text、ProseMirror 或 Monaco 中编辑时快捷键不被播放器抢占；
9. 进度条可以 seek；
10. 从顶部标题区域拖动播放器时不会误操作进度条、播放按钮或关闭按钮；顶部倍速只显示状态，不可点击；
11. 拖动后刷新页面，播放器再次出现时恢复上次位置；窗口尺寸变化后播放器不会停留在屏幕外；
12. 不存在的 MP3 显示错误状态而不影响页面；
13. 播放器显示且页面没有可见 NocoDB modal 时，无论当前焦点在哪里，按 `Esc` 都会关闭播放器；打开 LongText 等 `.ant-modal-content` 弹窗时，`Esc` 不被脚本接管并继续由 NocoDB 处理；
14. NocoDB 其他普通 URL Button 仍按原行为打开。

语法检查：

```bash
node --check userscripts/nocodb/nocodb-audio-player.user.js
```

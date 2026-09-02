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

## 2. 播放器行为

点击符合规则的 `Play` Button 后：

1. 不再打开新标签页；
2. 页面右下角显示深色悬浮播放器；
3. 自动加载并播放对应 MP3；
4. 再次点击同一条音频时切换播放 / 暂停；
5. 点击另一条音频时停止当前音频并直接切换到新音频；
6. 播放结束后播放器保留；
7. 点击关闭按钮后停止播放并隐藏播放器；
8. 可按住播放器顶部标题区域拖动整个播放器，拖动位置写入浏览器 `localStorage`，刷新页面后继续使用上次位置；窗口尺寸变化时会自动把已保存位置限制在可视区域内。

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
| `Esc` | 仅当焦点位于播放器内部时关闭播放器 |

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

Media Manager 位于 `english-speaking-lab` 项目，负责文件管理与公开媒体分发；本脚本位于 `userscript-cyan`，负责 NocoDB 浏览器端播放体验。

Media Manager 不理解 `corpus_id`。`corpus_id.mp3` 的命名和 NocoDB Button Formula 都属于上层英语语料项目约定。

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
- 保持 `@run-at document-start`，以便在 NocoDB Button 触发前完成包装。
- 不要依赖 Canvas cell DOM、固定列坐标或当前行号。
- 播放器拖动仅由顶部标题区域触发，按钮和进度条不应触发整体拖动。
- 当前倍速只作为顶部状态文本显示，不提供倍速按钮；倍速由 `↑` / `↓` 按 `0.1×` 增量控制，范围保持在 `0.5×`～`2.0×`。
- `Esc` 只在浏览器焦点位于播放器本身或其内部控件时关闭播放器，避免抢占 NocoDB 页面其他区域的 Escape 行为。
- 播放器位置使用 `tm-nocodb-audio-player-position-v1` 保存到当前 NocoDB 站点的 `localStorage`；如果存储不可用，播放器仍应可以在当前页面拖动。
- 修改可执行行为后提升 `@version`。
- 脚本 metadata 中的 `@updateURL` / `@downloadURL` 保持指向私有开发仓库标准 Raw URL，不写缓存参数。
- 如果 Media Manager 域名或音频目录变化，应同步修改脚本中的 `AUDIO_ORIGIN` / `AUDIO_PATH_PREFIX` 和本说明。

## 7. 回归测试

每次修改后至少验证：

1. 点击 `j2jnfze2` 等记录的 `Play` 后不打开新标签页，并自动播放正确 MP3；
2. 再点同一条时可以暂停 / 继续；
3. 点击另一条时立即切换音频；
4. `Space`、方向键按约定工作，`↑` / `↓` 每次精确调整 `0.1×`；
5. 在 NocoDB 输入框、Rich Text、ProseMirror 或 Monaco 中编辑时快捷键不被播放器抢占；
6. 进度条可以 seek；
7. 从顶部标题区域拖动播放器时不会误操作进度条、播放按钮或关闭按钮；顶部倍速只显示状态，不可点击；
8. 拖动后刷新页面，播放器再次出现时恢复上次位置；窗口尺寸变化后播放器不会停留在屏幕外；
9. 不存在的 MP3 显示错误状态而不影响页面；
10. 焦点位于播放器或其内部控件时按 `Esc` 会关闭播放器，焦点位于播放器外部时 `Esc` 不被脚本接管；
11. NocoDB 其他普通 URL Button 仍按原行为打开。

语法检查：

```bash
node --check userscripts/nocodb/nocodb-audio-player.user.js
```

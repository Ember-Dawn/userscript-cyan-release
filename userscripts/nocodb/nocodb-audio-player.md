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
2. 页面右下角显示固定深色悬浮播放器；
3. 自动加载并播放对应 MP3；
4. 再次点击同一条音频时切换播放 / 暂停；
5. 点击另一条音频时停止当前音频并直接切换到新音频；
6. 播放结束后播放器保留；
7. 点击关闭按钮后停止播放并隐藏播放器。

第一版提供：

- 播放 / 暂停；
- 当前时间 / 总时长；
- 可拖动进度条；
- 倍速控制；
- 关闭播放器；
- 加载失败提示。

第一版不提供音量控制。

## 3. 键盘快捷键

播放器有音频加载且页面焦点不在编辑控件中时：

| 按键 | 行为 |
|---|---|
| `Space` | 播放 / 暂停 |
| `←` | 后退 5 秒 |
| `→` | 前进 5 秒 |
| `↑` | 提高一个倍速档位 |
| `↓` | 降低一个倍速档位 |

倍速档位：

```text
0.50× → 0.75× → 1.00× → 1.25× → 1.50× → 1.75× → 2.00×
```

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

## 6. 维护注意事项

- 不要扩大 `window.open` 拦截范围；只接管指定 Media Manager 音频路径下的 MP3。
- 保持 `@run-at document-start`，以便在 NocoDB Button 触发前完成包装。
- 不要依赖 Canvas cell DOM、固定列坐标或当前行号。
- 修改可执行行为后提升 `@version`。
- 脚本 metadata 中的 `@updateURL` / `@downloadURL` 保持指向私有开发仓库标准 Raw URL，不写缓存参数。
- 如果 Media Manager 域名或音频目录变化，应同步修改脚本中的 `AUDIO_ORIGIN` / `AUDIO_PATH_PREFIX` 和本说明。

## 7. 回归测试

每次修改后至少验证：

1. 点击 `j2jnfze2` 等记录的 `Play` 后不打开新标签页，并自动播放正确 MP3；
2. 再点同一条时可以暂停 / 继续；
3. 点击另一条时立即切换音频；
4. `Space`、方向键按约定工作；
5. 在 NocoDB 输入框、Rich Text、ProseMirror 或 Monaco 中编辑时快捷键不被播放器抢占；
6. 进度条可以 seek；
7. 不存在的 MP3 显示错误状态而不影响页面；
8. NocoDB 其他普通 URL Button 仍按原行为打开。

语法检查：

```bash
node --check userscripts/nocodb/nocodb-audio-player.user.js
```

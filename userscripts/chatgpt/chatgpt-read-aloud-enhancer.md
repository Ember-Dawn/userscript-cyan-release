# ChatGPT 朗读增强助手

文件：`chatgpt-read-aloud-enhancer.user.js`

该脚本增强 ChatGPT 网页版的官方朗读功能。脚本不会自行生成语音，也不会替换 ChatGPT 的声音；它调用官方“朗读 / 重播”入口，并在官方音频开始播放后显示紧凑悬浮播放器。

## 主要功能

- 在每条助手回答的一级操作栏中增加“朗读 / 重播”快捷按钮；
- 播放、暂停、进度拖动和时间显示；
- 快退、快进，跳转步长可选 3、5、10 秒；
- 播放速度可选 0.5×、0.75×、1×、1.25×、1.5×、2×；
- 播放上一条或下一条当前可见的助手回答；
- 最小化、关闭和聊天切换状态清理；
- 在浏览器本地将当前朗读音频转换为单声道 96 kbps MP3；
- MP3 失败后可在播放器中导出最近一次脱敏诊断日志。

## 播放器设置菜单

“跳转”和“速度”使用统一的自定义菜单组件：

- 当前值显示在播放器顶部，不显示额外的下拉箭头；
- 菜单挂载到 `document.body`，使用固定定位，不受播放器圆角和 `overflow` 裁剪；
- 根据视口剩余空间自动选择向上或向下展开；
- 点击外部、按 `Esc`、滚动页面、调整窗口、折叠或关闭播放器时自动收起；
- 跳转秒数和播放速度保存到浏览器 `localStorage`。

## 键盘快捷键

| 按键 | 功能 |
|---|---|
| `↑` | 播放上一条助手消息 |
| `↓` | 播放下一条助手消息 |
| `←` | 按当前跳转步长快退 |
| `→` | 按当前跳转步长快进 |
| `Space` | 播放或暂停 |
| `Esc` | 优先关闭设置菜单；没有菜单时关闭播放器并暂停 |

焦点位于输入框、文本域、选择框或可编辑区域时，脚本不会接管快捷键。

## MP3 下载

点击播放器顶部的下载按钮后，脚本会：

1. 读取当前 ChatGPT 官方朗读音频；
2. 使用 Web Audio API 解码；
3. 优先在运行时创建的内联 Web Worker 中混合声道并编码 MP3；
4. Worker 不可用时回退到主线程编码；
5. 通过浏览器普通下载方式保存文件。

转换期间下载按钮显示独立的纯 CSS 圆环。圆环仅表示“处理中”，不与编码进度绑定，也不会显示百分比或中间文字。成功后短暂显示勾号；失败时显示感叹号并保存最近一次脱敏日志。

音频不会上传到第三方服务器。编码器通过 userscript 头部的 `@require` 加载：

- 构建：`lamejs-fixed@1.2.2`
- 地址：`https://cdn.jsdelivr.net/npm/lamejs-fixed@1.2.2/lame.min.js`
- 上游项目：`https://github.com/zhuker/lamejs`

## 单文件内部结构

4.0.0 在保持单个 `.user.js` 发布文件的前提下进行了等价重构。用户可见行为保持不变，内部按职责分区：

- 常量、选择器与持久化键；
- `state`：朗读触发、播放会话、消息导航、下载和浮层状态；
- `ui`：播放器 DOM 引用；
- `settings`：跳转、速度和折叠设置；
- 官方朗读按钮与菜单激活；
- 播放器控件与浮层选择器；
- MP3 下载、Worker 编码和诊断；
- 音频会话、消息切换与播放器状态；
- 页面观察、路由变化和全局事件生命周期。

本次重构移除了只写不读的会话计数、未使用的下载图标常量以及旧控件方案遗留代码，避免继续通过零散全局变量耦合各功能。

## 4.0.1 播放器样式回归修复

- 恢复 3.5.4 已验证的播放器 DOM 类名与 CSS 选择器契约；
- 修复 4.0.0 中类名被错误写成 `cyan-ui.player-*`，导致标题栏、按钮、控制区和进度区样式无法匹配的问题；
- 恢复下载圆环的合法关键帧名称，避免动画规则失效；
- 保留 4.0.0 的单文件状态分组与模块化内部结构，不改变现有功能和交互。

## 4.0.2 Detached Audio 兼容修复

- 兼容 ChatGPT 新版朗读使用未挂载到页面 DOM 的 `<audio>` 对象；
- 在保留原有 `document` 级 `play` 监听和 DOM 音频扫描兜底的同时，增加 `HTMLMediaElement.prototype.play` 捕获；
- 在实际调用 `play()` 前绑定目标 `<audio>` 的媒体事件，因此即使 `audio.isConnected === false`，播放器仍可接收播放、暂停、进度和结束事件；
- 不改变官方朗读菜单触发、播放器 UI、浮层菜单、MP3 下载和诊断逻辑。

## 4.0.3 Blob 音频 MP3 下载兼容修复

- 兼容普通对话朗读使用 `blob:` URL，而 ChatGPT 当前 CSP 禁止再次 `fetch(blob:...)` 的情况；
- 通过 `URL.createObjectURL` 捕获原始音频 `Blob`，并在 detached `<audio>` 播放时与音频对象关联；
- `blob:` 音频下载时直接读取已捕获的原始 `Blob`，绕过受 CSP 限制的二次 `fetch`；
- `https:` / `http:` 音频仍沿用原有 `fetch(source) -> decode -> MP3` 路径，因此 Voice 模式结束后的“重播”下载行为保持不变；
- Blob URL 缓存仅保留最近 32 项，避免长期无界持有临时对象。

## 4.0.4 MediaSource / AAC 下载兼容修复

- 兼容普通“朗读”使用 `MediaSource` + `SourceBuffer` 流式播放 `audio/aac` 的实现；
- 通过 `URL.createObjectURL(MediaSource)`、`MediaSource.addSourceBuffer()` 和 `SourceBuffer.appendBuffer()` 建立当前 `blob:` 音频与 AAC 数据片段的关联；
- 对每次追加的 `ArrayBuffer` / TypedArray 立即复制并按原顺序保存，下载时拼成 `audio/aac` Blob 后继续复用现有 Web Audio 解码与 MP3 编码流程；
- `blob:` URL 如果本身来自普通 `Blob`，仍保留 4.0.3 的直接 Blob 路径；`https:` / `http:` 音频继续沿用原有 `fetch(source) -> decode -> MP3` 路径，因此 Voice 模式结束后的“重播”下载路径不变；
- MSE 下载会等待 SourceBuffer 停止更新并短暂静默后再快照片段，诊断日志会记录捕获的片段数、总字节数、MIME 与 MediaSource 状态。

## 数据与隐私

- 跳转秒数、播放速度、播放器折叠状态和最近一次失败日志只保存在浏览器本地；
- 脚本不保存对话正文；
- 诊断日志不包含对话正文、音频内容或带查询参数的完整音频地址；
- 音频读取、解码、编码和保存均在当前浏览器中完成。

## 已知限制

- ChatGPT 页面结构或官方朗读实现变化后，DOM 选择器可能需要更新；
- 官方流式音频刚开始播放时，总时长可能暂时不可用；
- 音频源无法读取、格式无法解码或编码器加载失败时，MP3 下载会失败；
- 长音频转换会占用一定 CPU 和内存。

## 安装与更新

公开发布文件：

`https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/chatgpt/chatgpt-read-aloud-enhancer.user.js`

私有开发源文件：

`userscripts/chatgpt/chatgpt-read-aloud-enhancer.user.js`

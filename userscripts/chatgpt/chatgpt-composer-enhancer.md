# ChatGPT 输入框增强助手

## 当前定位

`chatgpt-composer-enhancer.user.js` 是 ChatGPT 网页版输入框的轻量增强脚本。脚本名称和原文件路径继续保持不变，以便沿用现有安装与更新入口。

当前版本：`2.0.0`

当前只提供一个功能：**粘贴后立即 Enter 的发送意图缓冲**。

旧版 v1.0.4 的 Raw Paste Mode 已停止维护，并原样归档到：

```text
archive/userscripts/chatgpt-composer-enhancer-v1.0.4.user.js
archive/userscripts/chatgpt-composer-enhancer-v1.0.4.md
```

## 背景

记录日期：**2026-08-17**。

当前 ChatGPT composer 已再次调整。实测发现，直接粘贴 Markdown raw 文本时已经不再需要 v1.0.4 的 Raw Paste Mode 来维持原始 Markdown 字符，因此新版不再接管粘贴内容，也不再使用 `document.execCommand('insertText')`。

同时观察到一个独立的时序问题：

1. 在空输入框中按 `Ctrl+V` 粘贴纯文本；
2. 紧接着立即按普通 `Enter`；
3. ChatGPT 稍后能够把粘贴内容放入 composer，但刚才的 Enter 可能被忽略，消息不会自动发送。

旧版 Raw Paste Mode 对部分文本使用同步 `execCommand('insertText')`。大量文本时该同步操作会阻塞页面一段时间，用户在此期间物理按下的 Enter 会延后到主线程恢复后才被浏览器分发，因此表现为“文本一出现，之前按下的 Enter 随即生效”。这个现象不是旧版脚本显式保存 Enter，而是同步插入带来的事件时序副作用。

v2.0.0 不再依赖这种副作用，而是显式保存用户的“粘贴后立即发送”意图。

## 2026-08-17 页面观察

当前统一 composer 仍可通过以下语义结构定位：

```html
<form data-type="unified-composer">
  ...
  <div
    id="prompt-textarea"
    class="ProseMirror"
    contenteditable="true"
    role="textbox"
    aria-multiline="true">
  </div>
  ...
</form>
```

空白状态下，`#prompt-textarea` 内部只有 placeholder 段落，右侧显示语音按钮。

当 composer 有可发送内容时，页面会创建发送按钮：

```html
<button
  id="composer-submit-button"
  data-testid="send-button"
  aria-label="发送提示">
</button>
```

脚本优先使用 `form[data-type="unified-composer"]`、`#prompt-textarea` 和 `data-testid="send-button"` 这类语义标识，不依赖构建生成的样式类名。

## 事件诊断结果

在关闭旧版脚本、使用 ChatGPT 原生 paste 的真实页面上进行了事件日志测试。

### 约 47,104 字符文本

观察到的大致顺序：

```text
paste
paste -> microtask
paste -> requestAnimationFrame
DOM mutation
keydown Enter
requestAnimationFrame
keyup Enter
约 3 秒后 DOM mutation
再约 3 秒后 DOM mutation
```

说明大文本原生 paste 的后续 DOM / 编辑器处理可能持续数秒，而 `keydown Enter` 可以在这些后续工作结束前被浏览器正常分发。

### 约 1,288 字符文本

观察到的大致顺序：

```text
paste
paste -> microtask
requestAnimationFrame
requestAnimationFrame
keydown Enter
DOM mutation
DOM mutation
keyup Enter
```

在 `keydown Enter` 的日志快照中已经可以看到：

- composer DOM 中已有粘贴文本；
- `#composer-submit-button` 已存在；
- 发送按钮不是 disabled。

但这次 Enter 仍可能被 ChatGPT 忽略。

这说明“DOM 已经有内容”或“发送按钮已经出现”都不能单独证明 ChatGPT 的粘贴事务已经完全稳定。测试中也没有观察到可作为可靠完成信号的 `beforeinput` / `input` 事件，因此 v2.0.0 不依赖这些事件判断 paste 完成。

## v2.0.0 行为

新版完全保留 ChatGPT 原生 paste：

- 不调用 `preventDefault()` 阻止 paste；
- 不调用 `stopImmediatePropagation()` 阻止 paste；
- 不自行插入剪贴板文本；
- 不修改 Markdown、URL、ProseMirror 节点或附件表示；
- 不调用 ChatGPT 未公开 API。

脚本只在以下窄场景介入 Enter：

1. paste 发生在当前 ChatGPT composer；
2. 剪贴板是纯文本，且不包含图片或文件 item；
3. 用户在 paste 后 **1,000 ms** 内按下第一次普通 Enter；
4. Enter 不是 `Shift+Enter`、`Ctrl+Enter`、`Cmd+Enter`、`Alt+Enter`，也不是 IME composition 中的 Enter。

满足这些条件时，脚本会阻止这一枚过早的 Enter 继续进入 ChatGPT，并把它记录为 `pending send`。

## 延迟发送策略

收到 `pending send` 后，脚本临时观察当前 `form[data-type="unified-composer"]` 的 DOM 变化。

发送条件采用混合稳定策略：

- 自最后一次相关 DOM mutation 起至少静默 **250 ms**；
- 从用户按下 Enter 起至少经过 **120 ms**；
- 再等待两个 `requestAnimationFrame`，并重新确认静默条件没有被新的 mutation 打断；
- 当前 form 内存在可用的 `#composer-submit-button` 或 `[data-testid="send-button"]`；
- 发送按钮不是 `disabled` / `aria-disabled="true"`。

满足后调用发送按钮自身的 `.click()`，而不是伪造新的键盘事件。

这里的 250 ms 和 120 ms 都是脚本自己的保守稳定窗口，不是 OpenAI 官方规格，也不是用来推断 ChatGPT 内部事务的固定完成时间。MutationObserver 只在一次短暂 paste session 中存在，不持续扫描页面。

## 生命周期和取消条件

为了避免一次旧 Enter 在很久以后意外发送，paste session 有明确生命周期：

- paste 后 1,000 ms 内没有出现待缓冲 Enter：自动结束 session；
- 用户在 paste 后先输入普通字符：结束 session，让后续 Enter 完全走原生逻辑；
- 用户按 `Escape`：取消 session；
- 用户使用带修饰键的 Enter 或 `Shift+Enter`：取消 session并保留该按键的原生行为；
- pending send 后点击当前 composer 之外的区域：取消 pending send；
- 页面离开 / `pagehide`：取消；
- pending send 最长保留 **10 秒**，仍未找到稳定且可用的发送按钮时自动放弃，不在更晚时间突然发送；
- 新的 paste 会替换旧的尚未发送 session。

## 图片、文件和附件

如果原始 ClipboardEvent 已包含任何 file / image item，脚本不创建 paste session，整个操作完全交给 ChatGPT 原生逻辑。

对于“纯文本本身很长，之后由 ChatGPT 自己决定是否转成附件”的情况，脚本仍不修改其内容或转换方式。是否能够最终自动发送，取决于 10 秒保护窗口内 ChatGPT 是否形成可用发送按钮并达到脚本的稳定条件。

## 与 v1.0.4 的区别

v1.0.4 的核心目标是 Raw Paste Mode：短纯文本由 userscript 接管并通过 `execCommand('insertText')` 插入；超过 1,500 字符以及图片/文件走原生 paste。

v2.0.0 已彻底删除这一分流。**所有文本长度都先走 ChatGPT 原生 paste**，不再存在 1,500 字符 Raw Paste 上限。

因此新版脚本不再负责：

- 保证某段 Markdown 一定以 raw text 插入；
- 禁止手动输入时的 Markdown 自动格式化；
- 选择原生 paste 或 userscript paste；
- 自己处理图片、文件或附件上传；
- 修改消息 payload；
- 深入访问 React / ProseMirror 私有对象。

## 兼容性与维护检查

ChatGPT 是单页应用，composer 可能在导航、切换会话或产品更新时重建。脚本在 `document-start` 注册 document 级捕获监听，因此不需要持续查找新 composer。

如果未来行为再次变化，应优先重新验证：

1. `form[data-type="unified-composer"]` 是否仍存在；
2. `#prompt-textarea[contenteditable="true"][role="textbox"]` 是否仍对应真实输入区域；
3. 有内容后是否仍出现 `#composer-submit-button` / `[data-testid="send-button"]`；
4. 原生 paste 后立即 Enter 是否仍会被忽略；
5. `keydown Enter` 到达时发送按钮和 composer 的实际状态；
6. 是否出现新的、比 DOM mutation quiet period 更可靠的公开完成信号；
7. 10 秒保护窗口对当前长文本 / 附件处理是否仍足够。

## 归档说明

v1.0.4 是 Raw Paste Mode 的最终版本。其脚本与完整维护文档被保留在 `archive/userscripts/`，用于以后比较 ChatGPT composer 行为或恢复历史实现；归档文件不参与公开发布。

当前维护入口继续保持：

```text
userscripts/chatgpt/chatgpt-composer-enhancer.user.js
userscripts/chatgpt/chatgpt-composer-enhancer.md
```

# ChatGPT 输入框增强助手

## 当前定位

`chatgpt-composer-enhancer.user.js` 是 ChatGPT 网页版输入框的增强脚本。脚本名称刻意保持宽泛，以便后续继续加入与 composer 直接相关的功能。

当前版本：`1.0.2`

当前只提供一个功能：**Raw Text Mode**。

## Raw Text Mode

Raw Text Mode 的目标是让 ChatGPT 输入框中的 Markdown 保持原始文本，不在输入或短文本粘贴时被自动转换为标题、列表、粗体、斜体、行内代码等富文本结构。

例如输入或粘贴：

```text
# Heading

**bold**

- item 1
- item 2

`code`
```

输入框中应继续看到上述原始字符，而不是对应的富文本效果。

对于超过 ChatGPT 原生长粘贴阈值的文本，本脚本不再强制插入输入框，而是放行 ChatGPT 原生 paste 行为，使其按产品逻辑自动转换为附件。

## 开发背景

记录日期：**2026-08-09**。

2026 年 8 月，ChatGPT 网页版开始在部分账号中出现 Markdown-aware / rich-text composer 行为。此前输入框通常直接显示用户键入的 Markdown 原始字符；新版行为会在输入或粘贴过程中，将部分 Markdown 语法即时转换为富文本。

这会带来两个问题：

1. 对普通聊天而言，视觉上的富文本通常没有问题；但对 Markdown 模板、代码、规则文本、DSL、字符串匹配或其他依赖字面字符的 prompt，`**text**` 与“粗体 text”并不是同一件事。
2. 用户无法再从输入框视觉上确认 `#`、`**`、`- `、反引号等原始字符是否仍然存在。

因此，本脚本的第一项功能选择恢复 raw-text 输入体验，而不是改变 ChatGPT 回答区域的 Markdown 渲染。

## 2026-08-09 页面观察

当日检查 ChatGPT 网页版 composer 的 OuterHTML，观察到：

```html
<textarea
  class="wcDTda_fallbackTextarea"
  name="prompt-textarea"
  style="display: none;">
</textarea>

<div
  contenteditable="true"
  class="ProseMirror"
  id="prompt-textarea"
  role="textbox"
  aria-multiline="true">
</div>
```

实际用户输入发生在 `contenteditable` 的 ProseMirror 编辑器中；隐藏的 fallback textarea 暂不作为替代输入框使用。

脚本优先使用语义结构识别统一 composer，不依赖 `wcDTda_*` 这类明显可能随构建变化的样式类名。

## 实现原则

v1.0.2 延续最小侵入策略：

- 保留 ChatGPT 原生 ProseMirror composer；
- 不替换成自定义 textarea；
- 只干预可能触发 Markdown 富文本转换的短文本输入和短文本粘贴路径；
- 图片或文件粘贴直接交给 ChatGPT 原生逻辑；
- 超过 10,000 字符的纯文本粘贴直接交给 ChatGPT 原生逻辑，以保留自动附件转换；
- 不调用 ChatGPT 未公开 API；
- 不使用持续扫描完整页面的 MutationObserver；
- 中文输入法组合输入时不执行 Raw Text Mode 的字符级拦截。

ProseMirror 提供 `handleKeyDown`、`handleKeyPress` 和 `handleTextInput` 等输入处理钩子，因此实际宿主可以在普通浏览器输入事件完成前执行编辑器级转换。

### v1.0.1 键盘输入修复尝试

v1.0.0 已能让纯文本粘贴保持 raw text，但实测发现逐字键盘输入仍可能触发 Markdown 转换。v1.0.1 因而在捕获阶段隔离 `keypress` 与 `beforeinput`，但真实 ChatGPT composer 测试表明仍不足以阻止转换。

### v1.0.2 键盘输入修复

2026-08-09 的实际事件日志进一步确认：

- 输入 `-` 后，DOM 先保持 `<p>-</p>`；按下空格时，在 `input` 事件出现之前已经转换成 `<ul>`；
- 输入 `#` 后同样在空格 `keydown` 阶段转换成 `<h1>`；
- 输入 `**abc**` 时原始字符可以暂时保留，但下一次按空格时，在 `input` 事件之前已经转换成 `<strong>`。

因此 v1.0.2 将 `keydown` 纳入 Raw Text Mode 的第一道隔离：

- 对 Markdown 常用触发字符及空格，在 document 捕获阶段拦截其继续传播到 composer 的编辑器级 `keydown` handler；
- 只调用 `stopImmediatePropagation()`，不调用 `preventDefault()`；
- 让浏览器默认行为继续插入字面字符；
- 保留 `keypress` 与 `beforeinput` 的隔离作为兼容层；
- Ctrl / Meta / Alt 组合快捷键不进入该字符级拦截；
- IME composition 期间不做该字符级拦截。

该设计针对实测确认的“转换先发生于 keydown，随后才出现 input”事件顺序，而不是继续假定所有 Markdown 转换都会经过 `beforeinput`。

### v1.0.2 长文本粘贴修复

v1.0.0 / v1.0.1 对所有纯文本 paste 都执行 `preventDefault()`，再通过 `document.execCommand('insertText')` 将完整文本强制插入 ProseMirror。这个策略对短文本可以保持 raw，但会绕过 ChatGPT 原生的大粘贴附件逻辑；当剪贴板包含很长的文本时，整段内容会被强制塞进 contenteditable，可能导致明显卡顿甚至页面假死。

OpenAI ChatGPT Release Notes 在 2026-06-22 说明：超过 **10,000 个字符**的长粘贴会自动转换为附件；Plus、Pro、Business 此前曾使用 5,000 字符阈值，但随后也提高到了 10,000。

因此 v1.0.2 的 paste 分流为：

1. 剪贴板中存在任何 file item / file：完全放行 ChatGPT 原生 paste；
2. 纯文本长度大于 10,000：完全放行 ChatGPT 原生 paste，使其自动转换为附件；
3. 其余较短纯文本：Raw Text Mode 接管，阻止 Markdown 富文本解析并插入原始文本。

脚本中的阈值使用 JavaScript 字符串 `length` 作为浏览器侧近似计数。OpenAI 后续如果再次调整产品阈值，应同步更新该常量和本文档。

## 非目标

v1.0.2 不负责：

- 提升 ChatGPT composer 本身的性能；
- 将 ProseMirror 替换为 textarea；
- 修改图片或文件粘贴行为；
- 一次粘贴多个文件；
- 自己实现附件上传流程；
- 修改消息发送 payload；
- 调用 ChatGPT 未公开 API；
- 改变助手回答区域的 Markdown 渲染。

## 兼容性与维护注意

ChatGPT 是单页应用，composer 可能在导航、切换会话或功能更新时重建。当前脚本通过在 `document-start` 注册捕获阶段事件监听器来覆盖后续创建的 composer，因此不需要反复扫描 DOM。

如果未来 ChatGPT 更换编辑器实现，应优先重新验证：

1. `form[data-type="unified-composer"]` 是否仍存在；
2. `#prompt-textarea[contenteditable="true"][role="textbox"]` 是否仍对应实际输入区域；
3. Markdown 转换是否仍会在 `keydown` / `keypress` / `beforeinput` 路径发生；
4. 图片和文件粘贴是否仍能在 Raw Text Mode 启用时保持原生行为；
5. 长文本自动转换附件的字符阈值是否仍为 10,000。

## 调研与来源

以下链接用于记录该脚本出现时的产品背景和技术依据。外部来源反映各自发布时间或抓取时的情况，不代表 OpenAI 的长期兼容承诺。

### OpenAI 官方

- ChatGPT Release Notes：2026-06-22 “Large pastes are now handled as attachments for more plans”  
  https://help.openai.com/en/articles/6825453-chatgpt-release-notes

### 用户与社区讨论

- OpenAI Developer Community：Add markdown support to input bar  
  https://community.openai.com/t/add-markdown-support-to-input-bar/70242
- Reddit：How do I turn off Auto-Formatting?  
  https://www.reddit.com/r/ChatGPT/comments/1vhrsty/how_do_i_turn_off_autoformatting/
- Reddit：ChatGPT finally allows markdown formatting in users' prompts!!  
  https://www.reddit.com/r/ChatGPT/comments/1vjjkit/chatgpt_finally_allows_markdown_formatting_in/

### 编辑器技术

- ProseMirror Reference Manual：Input Rules  
  https://prosemirror.net/docs/ref/#inputrules
- ProseMirror View：`handleKeyDown` / `handleKeyPress` / `handleTextInput`  
  https://github.com/ProseMirror/prosemirror-view
- 第三方 ChatGPT 前端技术分析  
  https://performance.dev/chatgpt

## 后续扩展

脚本文件名和显示名采用“输入框增强助手 / composer enhancer”，而不是绑定到 Raw Text Mode。未来如果需要新增 composer 相关功能，应继续保持功能之间边界清晰，并在本文件中分别记录用途、兼容性和非目标。

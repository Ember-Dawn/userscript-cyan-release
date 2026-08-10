# ChatGPT 输入框增强助手

## 当前定位

`chatgpt-composer-enhancer.user.js` 是 ChatGPT 网页版输入框的增强脚本。脚本名称刻意保持宽泛，以便后续继续加入与 composer 直接相关的功能。

当前版本：`1.0.4`

当前只提供一个功能：**Raw Paste Mode**。

## Raw Paste Mode

Raw Paste Mode 只处理“粘贴到 ChatGPT 输入框”的纯文本，不再尝试改变手动键盘输入行为。

当前规则：

1. 剪贴板中包含图片或文件：完全放行 ChatGPT 原生 paste；
2. 纯文本长度大于 **1,500 个 JavaScript 字符**：完全放行 ChatGPT 原生 paste；
3. 纯文本长度不超过 **1,500 个 JavaScript 字符**：由 Raw Paste Mode 接管，通过纯文本插入路径保留 Markdown 原始字符。

例如粘贴一段不超过 1,500 字符的文本：

```text
# Heading

**bold**

- item 1
- item 2

`code`
```

输入框中应继续看到上述原始字符，而不是在粘贴动作中直接转换为对应的富文本效果。

手动键盘输入仍完全使用 ChatGPT 原生行为；如果 ChatGPT 对后续手动输入自动渲染 Markdown，本脚本不会阻止。

### 粘贴后继续手动输入

2026-08-09 实测确认：先通过 Raw Paste Mode 粘贴约 500 字符的 raw 文本，再在其后继续手动输入并按空格，ChatGPT 的 Markdown 转换只影响后续手动输入的内容，**不会反向把此前已经粘贴并保持 raw 的那一段重新渲染**。

因此，同一个 composer 中可以出现混合状态：前一段由 ChatGPT 原生 paste 或手动输入产生的富文本，后一段由 Raw Paste Mode 插入的 raw Markdown，或者反过来。Raw Paste Mode 只保证其接管的那一次短纯文本粘贴按 raw text 插入，不负责改变其他已经存在或之后手动输入的内容。

## 开发背景

记录日期：**2026-08-09**。

2026 年 8 月，ChatGPT 网页版开始在部分账号中出现 Markdown-aware / rich-text composer 行为。此前输入框通常直接显示用户键入或粘贴的 Markdown 原始字符；新版行为会将部分 Markdown 语法即时转换为富文本。

这会带来两个问题：

1. 对 Markdown 模板、代码、规则文本、DSL、字符串匹配或其他依赖字面字符的 prompt，`**text**` 与“粗体 text”并不是同一件事。
2. 用户无法再从输入框视觉上确认 `#`、`**`、`- `、反引号等原始字符是否仍然存在。

最初脚本尝试同时恢复“手动输入”和“粘贴”的 raw-text 体验，但连续三轮实验表明，ChatGPT 当前 composer 的键盘 Markdown 转换与内部编辑器处理链耦合较深。为降低兼容风险，v1.0.3 正式放弃干预手动键盘输入，只保留文本粘贴处理；v1.0.4 又根据真实性能测试把 Raw Paste Mode 的接管范围限制到不超过 1,500 字符的纯文本。

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

## v1.0.4 实现原则

v1.0.4 继续保持 paste-only，并进一步缩小干预范围：

- 保留 ChatGPT 原生 ProseMirror composer；
- 不替换成自定义 textarea；
- 不监听 `keydown`、`keypress` 或 `beforeinput`；
- 不再尝试禁止手动键盘输入的 Markdown 渲染；
- 只监听统一 composer 的 `paste` 事件；
- 图片或文件粘贴直接交给 ChatGPT 原生逻辑；
- 纯文本超过 1,500 字符时直接交给 ChatGPT 原生逻辑；
- 只有不超过 1,500 字符的纯文本才由 Raw Paste Mode 接管并以原始文本插入；
- 不调用 ChatGPT 未公开 API；
- 不使用 MutationObserver 持续扫描页面。

这样既保留短文本 raw paste 的用途，又避免 userscript 对中长文本执行高成本的整段 `execCommand('insertText')`。

## 手动输入 Raw Text 实验日志

以下记录保留 2026-08-09 对“禁止手动输入 Markdown 自动渲染”的三轮实验。该功能最终被明确放弃，但保留日志便于以后判断 ChatGPT 编辑器实现是否发生变化。

### v1.0.0：`beforeinput + execCommand`

目标：在可能触发 Markdown input rule 的字符到达 ProseMirror 前拦截，再通过 `document.execCommand('insertText')` 插入同一个字面字符。

结果：

- 纯文本粘贴可以保持 raw text；
- 手动键盘输入仍会触发 Markdown 渲染。

推测原因：通过 `execCommand('insertText')` 重新插入的字符仍可能进入 ProseMirror / ChatGPT 的文本输入处理链，因此并没有真正绕开内部格式化逻辑。

### v1.0.1：隔离 `keypress` 与 `beforeinput`

目标：不再取消浏览器默认输入，仅在 document 捕获阶段对 Markdown 常用触发字符调用 `stopImmediatePropagation()`，尝试阻止 ProseMirror 的 `handleTextInput` / input-rules 路径看到事件。

结果：手动输入仍然会被转换。

说明：ChatGPT 当前 composer 的 Markdown transformation 并不只依赖 `keypress` 或 `beforeinput`。

### DevTools 事件与 DOM 实测

随后在开启脚本的真实 ChatGPT composer 中记录了键盘事件和 DOM Mutation。关键观察如下：

```text
输入 "-"
DOM: <p>-</p>

按 Space
DOM: <ul data-spread="false">...</ul>

输入 "#"
DOM: <p>#</p>

按 Space
DOM: <h1 ...></h1>

输入 "**abc**"
DOM: <p>**abc**</p>

按 Space
DOM: <p><strong>abc</strong> </p>
```

共同特征是：格式转换已经在对应的 `input` 事件出现之前完成。尤其是 `Space` 的 `keydown` 之后，可以直接观察到列表、标题或粗体结构已经生成。

该实测说明仅隔离 `keypress` / `beforeinput` 不足以阻止当前 ChatGPT composer 的 Markdown 转换。

### v1.0.2：进一步隔离 `keydown`

目标：根据 DevTools 实测，把 `keydown` 也纳入 document 捕获阶段的隔离，同时保留 `keypress` 和 `beforeinput` 作为兼容层。

结果：真实网页测试仍然失败，手动键盘输入依然会自动渲染 Markdown。

### 实验结论与设计决策

截至 2026-08-09：

- 短纯文本粘贴时保持 raw Markdown 已经可行；
- 通过普通 userscript 捕获浏览器键盘事件来稳定关闭 ChatGPT 当前 composer 的手动输入 Markdown 转换，没有取得可靠结果；
- 继续尝试可能需要更深地依赖 ProseMirror / ChatGPT 内部对象、私有实现或更激进的 DOM/state 改写；
- 这会显著增加光标、选择区、中文 IME、Undo/Redo、快捷键和未来 ChatGPT 更新的兼容风险。

因此从 v1.0.3 起：**停止实现“禁止手动打字 Markdown 渲染”，仅维护 Raw Paste Mode。**

如果未来 ChatGPT 更换 composer 实现、提供官方 raw/plain-text 模式，或出现稳定公开的编辑器配置入口，可以重新评估该实验目标；在此之前不继续对键盘输入链做补丁式拦截。

## ProseMirror 内部对象探测

为尝试避免 `execCommand('insertText')` 的性能问题，2026-08-09 进一步检查了当前 composer DOM 暴露的 ProseMirror / React 内部对象。

观察到 `#prompt-textarea.ProseMirror` 自身具有 `pmViewDesc` 属性；其 own properties 包括 `parent`、`children`、`dom`、`contentDOM`、`node`、`outerDeco`、`innerDeco` 等，prototype 上主要是 `parseRule`、`matchesNode`、`updateChildren`、`localPosFromDOM`、`setSelection`、`ignoreMutation` 等 ViewDesc 相关方法。

未在该对象或其 prototype 上找到 `EditorView` 常见的 `state`、`dispatch()`、`pasteText()`、`updateState()` 等接口。composer 外层 React 节点则暴露了标准形式的 `__reactFiber$...` 与 `__reactProps$...` 属性。

继续从 React Fiber、hooks 或打包模块中追踪 EditorView 虽可能技术上可行，但会高度依赖 ChatGPT 当前私有构建，不符合本脚本希望保持简单、低维护成本的目标。因此停止继续深挖内部对象，保留 DOM 级短文本 Raw Paste 方案，并通过长度上限控制性能风险。

## Raw Paste 性能实验与 1,500 字符上限

Raw Paste Mode 当前仍使用 `document.execCommand('insertText')` 将接管的纯文本一次性插入 `contenteditable` ProseMirror。

该方式对短文本有效，但实测发现文本规模上升后性能会迅速恶化：

- 约 6,219 字符、约 103 行的纯文本测试内容，在脚本接管时会导致输入框长时间卡住，甚至触发浏览器“页面无响应/是否退出网页”的提示；
- 同一份内容在关闭脚本后使用 ChatGPT 原生 paste，表现流畅；
- 后续按不同长度继续测试后，最终选择 **1,500 字符**作为当前环境下的保守 Raw Paste 安全上限。

因此需要区分两个完全不同的概念：

- **1,500 字符**：本脚本根据真实性能测试确定的 Raw Paste 接管上限；不是 OpenAI 官方限制；
- **ChatGPT 自己的长粘贴/附件规则**：属于产品原生行为，本脚本从 v1.0.4 起不再自己根据官方附件阈值做判断，只要文本超过 1,500 字符就整体放行，让 ChatGPT 自己决定如何处理。

当前 paste 分流为：

1. 剪贴板中存在任何 file item / file：完全放行 ChatGPT 原生 paste；
2. 纯文本长度大于 1,500：完全放行 ChatGPT 原生 paste；
3. 纯文本长度不超过 1,500：Raw Paste Mode 接管并插入原始文本。

`1,500` 使用 JavaScript 字符串 `length` 计数。该值是当前浏览器、ChatGPT composer 和测试内容条件下的经验阈值；如果未来 ProseMirror 实现、浏览器性能或插入机制发生变化，应重新实测，而不是把它视为固定的产品规格。

## 混合输入行为

因为脚本只对单次 paste 事件独立判断，同一个 composer 可以同时包含原生内容和 Raw Paste 内容。

例如：

1. 第一次粘贴 2,000 字符：超过 1,500，脚本完全放行，内容按 ChatGPT 原生 paste 处理；
2. 第二次粘贴 500 字符：不超过 1,500，由 Raw Paste Mode 接管，第二段 Markdown 保持原始字符。

最终输入框因此可以是“原生富文本/原生文本 + raw Markdown”的混合文档。两次 paste 不会因为发生在同一个 composer 中而强制使用同一种处理模式。

另有实测确认：如果先粘贴 500 字符 raw 文本，再在其后继续手动输入并按空格，ChatGPT 的 Markdown 渲染只影响后续手动输入的内容，不会反向处理此前已经 raw 插入的 500 字符段落。

## 图片和文件粘贴

Raw Paste Mode 只在剪贴板不包含 file item 时处理文本。

只要 `clipboardData.files` 非空，或 `clipboardData.items` 中存在 `kind === 'file'`，脚本就直接返回，不执行 `preventDefault()`，把整个 paste 交给 ChatGPT 原生逻辑。

这项规则用于避免脚本把截图、图片或文件的剪贴板表示错误地当成 `text/plain` 处理。

## 非目标

v1.0.4 不负责：

- 禁止手动键盘输入时的 Markdown 渲染；
- 提升 ChatGPT composer 本身的性能；
- 将 ProseMirror 替换为 textarea；
- 修改图片或文件粘贴行为；
- 一次粘贴多个文件；
- 自己实现附件上传流程；
- 修改消息发送 payload；
- 调用 ChatGPT 未公开 API；
- 改变助手回答区域的 Markdown 渲染。

## 兼容性与维护注意

ChatGPT 是单页应用，composer 可能在导航、切换会话或功能更新时重建。当前脚本通过在 `document-start` 注册 document 级捕获阶段 `paste` 监听器来覆盖后续创建的 composer，因此不需要反复扫描 DOM。

如果未来 ChatGPT 更换编辑器实现，应优先重新验证：

1. `form[data-type="unified-composer"]` 是否仍存在；
2. `#prompt-textarea[contenteditable="true"][role="textbox"]` 是否仍对应实际输入区域；
3. 不超过 1,500 字符的纯文本 paste 是否仍能以 raw text 插入；
4. 超过 1,500 字符的纯文本是否仍完整走 ChatGPT 原生 paste；
5. 图片和文件粘贴是否仍能保持原生行为；
6. 1,500 字符的经验性能上限是否仍合适。

## 调研与来源

以下链接用于记录该脚本出现时的产品背景和技术依据。外部来源反映各自发布时间或抓取时的情况，不代表 OpenAI 的长期兼容承诺。

### OpenAI 官方

- ChatGPT Release Notes：Large pastes / attachment behavior  
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
- ProseMirror View  
  https://github.com/ProseMirror/prosemirror-view
- 第三方 ChatGPT 前端技术分析  
  https://performance.dev/chatgpt

## 后续扩展

脚本文件名和显示名采用“输入框增强助手 / composer enhancer”，而不是绑定到 Raw Paste Mode。未来如果需要新增 composer 相关功能，应继续保持功能之间边界清晰，并在本文件中分别记录用途、兼容性和非目标。

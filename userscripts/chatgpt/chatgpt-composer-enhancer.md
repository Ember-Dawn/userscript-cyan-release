# ChatGPT 输入框增强助手

## 当前定位

`chatgpt-composer-enhancer.user.js` 是 ChatGPT 网页版输入框的增强脚本。脚本名称刻意保持宽泛，以便后续继续加入与 composer 直接相关的功能。

当前版本：`1.0.0`

当前只提供一个功能：**Raw Text Mode**。

## Raw Text Mode

Raw Text Mode 的目标是让 ChatGPT 输入框中的 Markdown 保持原始文本，不在输入或粘贴时被自动转换为标题、列表、粗体、斜体、行内代码等富文本结构。

例如输入或粘贴：

```text
# Heading

**bold**

- item 1
- item 2

`code`
```

输入框中应继续看到上述原始字符，而不是对应的富文本效果。

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

v1.0.0 采用最小侵入策略：

- 保留 ChatGPT 原生 ProseMirror composer；
- 不替换成自定义 textarea；
- 只干预文本输入和纯文本粘贴中可能触发 Markdown 富文本转换的路径；
- 图片或文件粘贴直接交给 ChatGPT 原生逻辑；
- 不调用 ChatGPT 未公开 API；
- 不使用持续扫描完整页面的 MutationObserver；
- 中文输入法组合输入时不执行 Raw Text Mode 的字符级拦截。

ProseMirror 官方文档中的 input rules 机制本身就是“文本输入匹配规则后触发转换”的设计，因此该层是本脚本的主要关注点。

## 非目标

v1.0.0 不负责：

- 提升 ChatGPT composer 性能；
- 将 ProseMirror 替换为 textarea；
- 修改图片或文件粘贴行为；
- 一次粘贴多个文件；
- 修改附件上传流程；
- 修改消息发送 payload；
- 调用 ChatGPT 未公开 API；
- 改变助手回答区域的 Markdown 渲染。

## 兼容性与维护注意

ChatGPT 是单页应用，composer 可能在导航、切换会话或功能更新时重建。当前脚本通过在 `document-start` 注册捕获阶段事件监听器来覆盖后续创建的 composer，因此不需要反复扫描 DOM。

如果未来 ChatGPT 更换编辑器实现，应优先重新验证：

1. `form[data-type="unified-composer"]` 是否仍存在；
2. `#prompt-textarea[contenteditable="true"][role="textbox"]` 是否仍对应实际输入区域；
3. 文本输入和文本粘贴是否仍通过浏览器标准 `beforeinput` / `paste` 事件；
4. 图片和文件粘贴是否仍能在 Raw Text Mode 启用时保持原生行为。

## 调研与来源

以下链接用于记录该脚本出现时的产品背景和技术依据。外部来源反映各自发布时间或抓取时的情况，不代表 OpenAI 的长期兼容承诺。

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
- 第三方 ChatGPT 前端技术分析  
  https://performance.dev/chatgpt

## 后续扩展

脚本文件名和显示名采用“输入框增强助手 / composer enhancer”，而不是绑定到 Raw Text Mode。未来如果需要新增 composer 相关功能，应继续保持功能之间边界清晰，并在本文件中分别记录用途、兼容性和非目标。

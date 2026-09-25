# ChatGPT 顺序任务助手

> 对应脚本：`userscripts/chatgpt/chatgpt-sequential-task-queue.user.js`  
> 当前说明版本：v1.4.1

## 1. 当前定位

`chatgpt-sequential-task-queue.user.js` 用于在 ChatGPT 网页版中按当前会话保存并顺序执行一组 Prompt。脚本只负责写入 Composer、点击页面现有发送按钮、观察生成状态并在当前轮完成后调度下一轮；不读取或判断回答正文。

主要行为：

- 没有单独一行 `---` 时，每个非空行作为一轮任务；存在 `---` 时按 Prompt 块分隔，单个 Prompt 可以包含多行。
- 每个 `/c/<conversation-id>` 会话保存独立任务、进度和等待时间；新对话创建正式 conversation id 后会迁移临时状态。
- 同一会话在多个标签页中使用运行锁，避免多个页面同时发送下一轮。
- “暂停”只阻止下一轮发送，不会点击 ChatGPT 自带停止按钮。
- 每轮回答完成后先确认空闲状态，再按照面板中的额外等待秒数发送下一轮。

## 2. v1.4.1 新对话首次绑定修复

记录日期：**2026-09-25**。

普通新对话最初位于 `https://chatgpt.com/`，第一轮发送后才获得 `/c/<conversation-id>`。如果这个过程伴随页面重新加载，旧版脚本可能在新页面启动时直接读取正式 conversation id 对应的空状态，从而丢失仍保存在当前标签页 `sessionStorage` 中的临时队列；表现为第一轮已经成功执行，但面板随后回到“尚未载入任务”的初始状态。

v1.4.1 只针对这一条首次绑定链路增加保护：

1. 未绑定新对话在真正点击第一轮发送按钮前，写入一个当前标签页专用的“首次绑定待完成”标记；
2. 如果随后通过 SPA 路由进入 `/c/<id>`，继续使用原有 `migrateTemporaryStateToConversation()` 迁移逻辑，并清理该标记；
3. 如果页面在进入 `/c/<id>` 时发生重新加载，新页面初始化会在读取正式会话状态前检查该标记，并优先把 `sessionStorage` 中仍存在的临时队列迁移到新的 conversation id；这类“首次绑定重载”不会按普通页面重载逻辑把运行中的队列强制暂停，随后会重新取得正式会话运行锁并继续监控当前轮；
4. 标记只在当前标签页有效，并设有 120 秒有效期，避免很久以前残留的临时状态被错误绑定到其他会话；
5. 已经具有稳定 `/c/<id>` 的旧对话不走这条逻辑，原有会话隔离、运行锁和队列状态机保持不变。

本修复**不专门处理临时对话**；临时对话没有普通新对话的 `/` → `/c/<id>` 首次 URL 绑定过程，不属于本次修复范围。

## 3. v1.4.0 Composer 结构约定

记录日期：**2026-09-25**。

ChatGPT 网页版 Composer 更新后，旧版的 `[data-composer-surface="true"]`、`#prompt-textarea` 和 `#composer-submit-button` 已不再适合作为主要定位方式。v1.4.0 根据实际页面的三个状态重新确认了当前语义结构。

### Composer 根节点

```css
form[data-chatgpt-composer]
```

脚本只在可见的 Composer form 中优先查找编辑器和按钮，避免把页面其他位置的同名控件误认为当前对话输入框。

### 编辑器

```css
[data-composer-markdown][contenteditable="true"][role="textbox"]
```

当前编辑区域仍是 ProseMirror，但脚本不依赖 `ProseMirror` 样式类名，也不依赖构建生成的类名。

### 可发送状态

当输入框中已有可发送文本时，当前页面出现：

```css
button[type="submit"][aria-label="发送"]
```

这是 v1.4.0 的首选发送按钮定位方式。旧的 `#composer-submit-button` 仍作为兼容回退保留，但不再是主要依据。

### 正在生成状态

回答正在思考或生成时，Composer 中出现：

```css
button[aria-label="停止"]
```

因此当前状态判断可以概括为：

```text
空闲 + 空输入框
→ 没有“发送”按钮，也没有“停止”按钮；通常显示“开始语音”

输入框已有内容
→ 出现 type="submit" + aria-label="发送"

已发送、正在思考/生成
→ 输入框清空，并出现 aria-label="停止"

回答结束
→ “停止”按钮消失；脚本继续等待 3 秒稳定空闲窗口
```

脚本仍保留旧版 `data-testid="stop-button"`、`aria-label="停止回答"`、`aria-label="Stop generating"` 和 `#composer-submit-button` 作为兼容回退。新增维护时不要为了“清理代码”无理由删除这些回退。

## 4. 顺序执行与完成判断

每轮发送流程保持原有状态机：

1. 确认当前页面仍处于绑定会话，并确认没有非队列回答正在运行。
2. 确认输入框为空，避免覆盖用户手动输入内容。
3. 通过 ChatGPT/ProseMirror 的 paste 事件路径写入当前 Prompt。
4. 等待可用的发送按钮并点击页面现有按钮。
5. 发送后观察输入框是否清空以及“停止”按钮是否出现。
6. 捕获到“停止”按钮后，将任务标记为运行中。
7. “停止”按钮消失后连续空闲 3 秒，认为当前轮完成。
8. 再等待用户设置的额外秒数，发送下一轮。

仍保留“超短任务”回退：如果发送后输入框已经清空，但前 8 秒始终没有捕获到停止按钮，则在输入框继续为空且停止按钮持续不存在 3 秒后按完成处理。若发送后 30 秒内既没有捕获停止按钮，也没有满足回退条件，则进入状态待确认/错误流程，而不是猜测任务已经完成。

## 5. ChatGPT Composer DOM 诊断方法

ChatGPT 网页更新后，如果顺序助手再次无法找到输入框、发送按钮或停止按钮，优先从真实页面重新采集 Composer 状态，不要根据旧 class 名或历史 DOM 猜测。

推荐分别在以下三个状态执行一次诊断：

1. **空闲 + 输入框为空**；
2. **空闲 + 输入框已有文本但尚未发送**；
3. **已经发送，ChatGPT 正在思考/生成**。

### 完整快照方法

在 DevTools Console 中运行：

```js
(() => {
  const form = document.querySelector('form[data-chatgpt-composer]');
  if (!form) {
    console.log('[Composer] 未找到 form[data-chatgpt-composer]');
    return;
  }

  const editor = form.querySelector(
    '[data-composer-markdown][contenteditable="true"][role="textbox"]'
  );

  const buttons = [...form.querySelectorAll('button')].map((btn) => ({
    type: btn.getAttribute('type'),
    ariaLabel: btn.getAttribute('aria-label'),
    testId: btn.getAttribute('data-testid'),
    disabled: btn.disabled,
    ariaDisabled: btn.getAttribute('aria-disabled'),
    text: btn.innerText?.trim() || '',
  }));

  console.log('===== CHATGPT COMPOSER SNAPSHOT =====');
  console.log('URL:', location.href);
  console.log('Editor text:', editor?.innerText ?? null);
  console.log('Editor HTML:', editor?.innerHTML ?? null);
  console.log('Buttons:', buttons);
  console.log('FORM OUTERHTML:');
  console.log(form.outerHTML);
  console.log('===== END SNAPSHOT =====');
})();
```

### 复制 Console 时必须展开 `Buttons`

Chrome DevTools 默认可能把数组显示成：

```text
Buttons: (5) [{…}, {…}, {…}, {…}, {…}]
```

**在复制 Console 内容之前，应先点击 `Buttons` 左侧的展开箭头，并确认各按钮至少能看到 `type`、`ariaLabel`、`testId`、`disabled`、`ariaDisabled`。**

如果没有展开，复制出来的文本往往只剩 `{…}`，维护者无法确认真正的发送/停止按钮属性。尤其要核对：

```text
有文本状态：type="submit" + ariaLabel="发送"
生成中状态：ariaLabel="停止"
```

### DevTools 很卡时的轻量方法

如果完整 `outerHTML` 太大，可只打印顺序助手真正关心的状态。这个版本使用 `JSON.stringify`，复制时**不需要再手动展开对象**：

```js
(() => {
  const form = document.querySelector('form[data-chatgpt-composer]');
  if (!form) return console.log('未找到 Composer');

  const editor = form.querySelector(
    '[data-composer-markdown][contenteditable="true"][role="textbox"]'
  );

  const result = {
    url: location.href,
    composerFound: !!form,
    placement: form.getAttribute('data-composer-placement'),
    editorFound: !!editor,
    editorText: editor?.innerText ?? null,
    buttons: [...form.querySelectorAll('button')].map((btn, i) => ({
      index: i,
      type: btn.getAttribute('type'),
      ariaLabel: btn.getAttribute('aria-label'),
      testId: btn.getAttribute('data-testid'),
      disabled: btn.disabled,
      ariaDisabled: btn.getAttribute('aria-disabled'),
    })),
  };

  console.log(JSON.stringify(result, null, 2));
})();
```

如果只是判断选择器是否失效，优先使用轻量方法；只有需要检查编辑器内部结构时，再使用完整快照。

## 6. DOM 维护原则

- 优先使用 `data-chatgpt-composer`、`data-composer-markdown`、`role`、`type`、`aria-label` 等语义属性。
- 不依赖 `ComposerLayoutRoot-XCKS7O`、`RichTextInput-j_tVa5` 等构建生成 class，它们可能随部署改变。
- 不依赖动态生成的 `radix-*` id 或文件 input id。
- 发送按钮和停止按钮应优先在当前可见 Composer 内查找，再使用兼容回退。
- 如果未来按钮文案或结构变化，先用上面的三状态 Console 方法重新采集实际 DOM，再修改选择器。
- 诊断内容可能包含当前 URL、conversation id 和输入框正文；对外分享前应检查并按需要删去敏感或不希望公开的内容。

## 7. 修改后的基本回归测试

至少验证：

1. 空输入框时脚本不会把“开始语音”误认为发送按钮。
2. 第一轮 Prompt 能写入编辑器并通过“发送”按钮提交。
3. 发送后能识别 `aria-label="停止"` 并进入“正在运行”。
4. 回答结束、停止按钮消失后，不会立即发送下一轮，而是先满足 3 秒稳定窗口和额外等待时间。
5. 多轮任务能够连续执行。
6. 用户手动编辑 Composer 时队列仍会暂停，避免覆盖输入。
7. 在普通新对话 `/` 中启动多轮队列，第一轮发送后 URL 变成 `/c/<id>` 时，队列和进度继续保留并执行第二轮。
8. 即使首次 `/` → `/c/<id>` 伴随页面重新加载，临时队列也会迁移到正式 conversation id，而不是回到空面板。
9. 已有 `/c/<id>` 的旧对话、切换会话、刷新页面、多标签运行锁和现有队列状态不受首次绑定修复影响。

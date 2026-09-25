# ChatGPT 顺序任务助手

> 对应脚本：`userscripts/chatgpt/chatgpt-sequential-task-queue.user.js`  
> 当前说明版本：v1.4.2

## 1. 当前定位

`chatgpt-sequential-task-queue.user.js` 用于在 ChatGPT 网页版中按当前会话保存并顺序执行一组 Prompt。脚本只负责写入 Composer、点击页面现有发送按钮、观察生成状态并在当前轮完成后调度下一轮；不读取或判断回答正文。

主要行为：

- 没有单独一行 `---` 时，每个非空行作为一轮任务；存在 `---` 时按 Prompt 块分隔，单个 Prompt 可以包含多行。
- 每个 `/c/<conversation-id>` 会话保存独立任务、进度和等待时间；新对话创建正式 conversation id 后会迁移临时状态。
- 同一会话在多个标签页中使用运行锁，避免多个页面同时发送下一轮。
- “暂停”只阻止下一轮发送，不会点击 ChatGPT 自带停止按钮。
- 每轮回答完成后先确认空闲状态，再按照面板中的额外等待秒数发送下一轮。

## 2. v1.4.2 新对话双阶段会话绑定修复

记录日期：**2026-09-25**。

实际诊断确认，普通新对话第一轮并不是简单地从 `https://chatgpt.com/` 一次跳到最终 `/c/<conversation-id>`，而是可能经历下面的双阶段路由：

```text
https://chatgpt.com/
→ /c/local-chatgpt%3A<local-id>
→ /c/<正式 UUID>
```

v1.4.1 只覆盖了“无 conversation id → 第一个 conversation id”的迁移，因此第一阶段 `/` → `local-chatgpt:*` 可以保留队列；但第二阶段 `local-chatgpt:*` → 正式 UUID 会被旧逻辑当成普通“切换会话”，从新的正式 UUID 下读取空状态，表现为第一轮结束附近面板突然回到“尚未载入任务”。

v1.4.2 将整个双阶段过程视为**同一次普通新对话首次绑定**：

1. 在 `/` 页面真正点击第一轮发送按钮前，继续写入当前标签页专用的“首次绑定待完成”标记；
2. `/` → `local-chatgpt:*` 时，把临时队列迁移到该中间 conversation id，但**保留首次绑定标记**，并把 `local-chatgpt:*` 记为中间会话；
3. 随后 `local-chatgpt:*` → 正式 UUID 时，直接把当前完整队列状态迁移到正式 UUID，同时迁移运行所有权、清理中间会话的状态/锁，并继续当前轮监控；这一步不会走普通 `loadStateForContext(newId)` 空状态路径；
4. 若双阶段中的任一步伴随页面重新加载，新页面会利用同一标签页的 pending 标记、临时状态或已记录的 `local-chatgpt:*` 中间状态恢复队列，再继续完成正式 UUID 绑定；
5. 正式 UUID 绑定完成后立即清理 pending 标记；之后 UUID → 其他 UUID 才重新按真实“用户切换会话”处理；
6. pending 标记仍只在当前标签页有效，并保留 120 秒有效期，防止陈旧首次绑定状态被错误带到其他会话。

已经具有稳定 `/c/<UUID>` 的旧对话不进入这条双阶段迁移路径，原有会话隔离、运行锁和队列状态机保持不变。

本修复仍**不专门处理临时对话功能本身**；这里的 `local-chatgpt:*` 是普通新对话首次建立过程中实际观察到的中间 conversation id，只用于完成普通新对话的首次绑定。

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

## 6. 首轮会话路由 / 队列状态诊断方法

当现象是“第一轮可以发送，但随后队列突然清空、切到空面板或绑定到错误会话”时，不要只检查 Composer DOM。应优先观察**首轮期间 ChatGPT 的 history 路由、conversation id、顺序助手内部 state 和存储 key 是否同步变化**。

2026-09-25 的双阶段绑定问题就是通过这种方法定位出来的：自动日志显示 URL 先从 `/` 变成 `/c/local-chatgpt%3A...`，此时队列和锁仍在；之后又通过 `replaceState` 变成正式 `/c/<UUID>`，紧接着 `queue.conversationId` 切换到正式 UUID、运行锁丢失，说明真正的问题发生在第二次 conversation id 替换，而不是第一轮生成完成判断。

### 一次执行、自动追踪首轮变化

在普通新对话 `/` 页面、尚未点击顺序助手“开始”之前，在 DevTools Console 中执行一次：

```js
(() => {
  const PREFIX = '[STQ-FIRST-TURN]';

  const getSnapshot = (reason) => {
    let queue = null;
    try {
      queue = window.__cgSequentialTaskQueue?.getState?.() ?? null;
    } catch (error) {
      queue = { error: String(error) };
    }

    const state = queue?.state ?? null;
    const result = {
      time: new Date().toISOString(),
      reason,
      url: location.href,
      conversationId: queue?.conversationId ?? null,
      lockOwnedByThisTab: queue?.lockOwnedByThisTab ?? null,
      mode: state?.mode ?? null,
      taskCount: state?.tasks?.length ?? null,
      activeIndex: state?.activeIndex ?? null,
      nextIndex: state?.nextIndex ?? null,
      sessionKeys: Object.keys(sessionStorage)
        .filter((key) => key.includes('chatgptSequentialTaskQueue')),
      localKeys: Object.keys(localStorage)
        .filter((key) => key.includes('chatgptSequentialTaskQueue')),
    };

    console.log(PREFIX, JSON.stringify(result, null, 2));
  };

  const wrapHistory = (methodName) => {
    const original = history[methodName];
    if (typeof original !== 'function') return;

    history[methodName] = function (...args) {
      const before = location.href;
      const result = original.apply(this, args);
      queueMicrotask(() => {
        console.log(PREFIX, JSON.stringify({
          time: new Date().toISOString(),
          reason: methodName,
          before,
          after: location.href,
          target: args[2] ?? null,
        }, null, 2));
        getSnapshot(`after ${methodName}`);
      });
      return result;
    };
  };

  wrapHistory('pushState');
  wrapHistory('replaceState');

  window.addEventListener('popstate', () => {
    getSnapshot('after popstate');
  });

  let lastSummary = '';
  const timer = setInterval(() => {
    let data = null;
    try {
      data = window.__cgSequentialTaskQueue?.getState?.() ?? null;
    } catch (_) {
      data = null;
    }

    const summary = JSON.stringify({
      url: location.href,
      conversationId: data?.conversationId ?? null,
      lockOwnedByThisTab: data?.lockOwnedByThisTab ?? null,
      mode: data?.state?.mode ?? null,
      taskCount: data?.state?.tasks?.length ?? null,
      activeIndex: data?.state?.activeIndex ?? null,
      nextIndex: data?.state?.nextIndex ?? null,
    });

    if (summary !== lastSummary) {
      lastSummary = summary;
      getSnapshot('state changed');
    }
  }, 250);

  window.__stqFirstTurnDebugStop = () => {
    clearInterval(timer);
    console.log(PREFIX, 'debug stopped');
  };

  getSnapshot('debug started');
})();
```

然后只需要正常执行一次多轮队列，等问题出现或第二轮成功开始后，把所有带有 `[STQ-FIRST-TURN]` 的日志复制出来。测试结束可执行：

```js
window.__stqFirstTurnDebugStop?.();
```

这个版本使用 `JSON.stringify` 输出关键状态，**不需要手动展开 Console 对象**。如果使用普通 `console.log({ ... })` 版本，复制前必须展开对象，否则复制出来可能只有 `{…}`，会丢掉关键字段。

### 重点看什么

优先按时间顺序检查：

1. `url` 是否只变化一次，还是存在 `/` → `local-chatgpt:*` → 正式 UUID 等多阶段路由；
2. 每次 `pushState` / `replaceState` 后，`queue.conversationId` 是否与 URL 中的 conversation id 同步；
3. `taskCount` 是否仍保持原队列数量，还是在某次路由后突然变成 `0`；
4. `lockOwnedByThisTab` 是否在 conversation id 替换后从 `true` 变成 `false`；
5. `sessionKeys` / `localKeys` 中状态和运行锁究竟留在临时 key、中间 `local-chatgpt:*` key，还是已经写入正式 UUID key。

判读原则：

```text
URL / conversationId 变化后 taskCount 立刻归零
→ 优先查会话状态迁移 / loadStateForContext，而不是 Composer 或完成判断。

队列仍在，但 lockOwnedByThisTab 丢失
→ 优先查运行锁是否随 conversation id 正确迁移。

conversationId 不变，但停止按钮始终识别不到
→ 再回到 Composer 三状态 DOM 诊断。
```

该方法用于定位 ChatGPT 首轮建会话流程变化；未来若 OpenAI 再次调整客户端路由，不应预设只存在一次 URL 变化，应先用自动追踪日志确认真实顺序后再修改迁移逻辑。

## 7. DOM 维护原则

- 优先使用 `data-chatgpt-composer`、`data-composer-markdown`、`role`、`type`、`aria-label` 等语义属性。
- 不依赖 `ComposerLayoutRoot-XCKS7O`、`RichTextInput-j_tVa5` 等构建生成 class，它们可能随部署改变。
- 不依赖动态生成的 `radix-*` id 或文件 input id。
- 发送按钮和停止按钮应优先在当前可见 Composer 内查找，再使用兼容回退。
- 如果未来按钮文案或结构变化，先用上面的三状态 Console 方法重新采集实际 DOM，再修改选择器。
- 诊断内容可能包含当前 URL、conversation id 和输入框正文；对外分享前应检查并按需要删去敏感或不希望公开的内容。

## 8. 修改后的基本回归测试

至少验证：

1. 空输入框时脚本不会把“开始语音”误认为发送按钮。
2. 第一轮 Prompt 能写入编辑器并通过“发送”按钮提交。
3. 发送后能识别 `aria-label="停止"` 并进入“正在运行”。
4. 回答结束、停止按钮消失后，不会立即发送下一轮，而是先满足 3 秒稳定窗口和额外等待时间。
5. 多轮任务能够连续执行。
6. 用户手动编辑 Composer 时队列仍会暂停，避免覆盖输入。
7. 在普通新对话 `/` 中启动多轮队列，确认 `/` → `local-chatgpt:*` 后任务数、当前轮和运行锁仍保留。
8. 当 `local-chatgpt:*` 再变成正式 `/c/<UUID>` 时，队列状态继续迁移到正式 UUID，第一轮完成后能够继续执行第二轮，而不是回到空面板。
9. 若 `/` → `local-chatgpt:*` 或 `local-chatgpt:*` → 正式 UUID 的任一步伴随页面重新加载，队列仍能从临时/中间状态恢复并完成正式绑定。
10. 已有稳定 `/c/<UUID>` 的旧对话、真实切换会话、刷新页面、多标签运行锁和现有队列状态不受首次绑定修复影响。

# NocoDB 思维导图

`nocodb-mindmap.user.js` 用于在自部署 NocoDB CE 的 Grid 中通过原生 Button 打开思维导图大弹窗。脚本不解析 Canvas Grid 的行列 DOM；当前记录由 Button URL 中的 `recordId` 定位，Base ID 和 Table ID 从当前 NocoDB 页面 URL 解析，脑图内容保存到同一记录的 `MindMapData` JSON 字段。

从 v0.2.0 开始，油猴脚本不再自己加载和实例化 `simple-mind-map`。完整编辑器由单独部署的 `Ember-Dawn/mind-map` WebUI 提供，油猴脚本只负责 NocoDB 集成、外层 Modal、iframe、API Token、GET/PATCH 和保存确认。

## 架构

```text
NocoDB Grid
  → MindMap Button
  → Tampermonkey 拦截 /__mindmap__?recordId=...
  → 读取当前 NocoDB record
  → 打开当前页面内的大 Modal
  → iframe 加载 https://mindmap.380782744.xyz/?embed=1&parentOrigin=...
  → postMessage 发送完整脑图数据
  → MindMap WebUI 负责编辑、快捷键和完整 UI
  → 手动保存时 WebUI postMessage 回传完整数据
  → Tampermonkey PATCH NocoDB MindMapData
```

两个项目的职责保持分离：

- `Ember-Dawn/mind-map`：完整 MindMap WebUI、官方编辑功能、快捷键、dirty 状态、iframe bridge。
- `Ember-Dawn/userscript-cyan`：NocoDB Button 接管、record 上下文、API Token、NocoDB Data API、大弹窗、iframe bridge、保存与关闭确认。

## MindMap WebUI

当前固定使用：

```text
https://mindmap.380782744.xyz/
```

油猴脚本实际加载：

```text
https://mindmap.380782744.xyz/?embed=1&parentOrigin=https%3A%2F%2Fnocodb.380782744.xyz
```

`embed=1` 会启用 `mind-map` 仓库中的 NocoDB bridge。`parentOrigin` 用于限制 iframe 与父页面之间的 `postMessage` 来源。

油猴脚本不再包含以下第三方依赖：

- `@require simple-mind-map`
- `@resource simpleMindMapCss`
- `GM_getResourceText`
- SimpleMindMap UMD/CSS 注入逻辑

因此 SimpleMindMap 的完整 UI、插件和快捷键均由独立 WebUI 自己维护。

## NocoDB 字段

目标表需要两个字段：

| 字段 | 类型 | 用途 |
|---|---|---|
| `MindMapData` | JSON | 保存完整脑图数据；建议在日常 Grid View 中隐藏 |
| `MindMap` | Button | 用户入口；Action 使用 `Open URL` |

`MindMapData` 必须保持这个固定名称。脚本读取记录后会检查该字段是否存在；不存在时不会创建或猜测其他字段，而是在弹窗中提示配置错误。

### Button URL

`MindMap` Button 的 URL 只负责携带当前 Record ID。当前自部署域名使用：

```text
https://nocodb.380782744.xyz/__mindmap__?recordId=<当前 Record ID>
```

当前已验证可用的 NocoDB Formula 为：

```text
CONCAT("https://nocodb.380782744.xyz/__mindmap__?recordId=", RECORD_ID())
```

脚本在 `document-start` 包装页面 `window.open`。NocoDB 原生 Button 准备打开 `/__mindmap__?recordId=...` 时会被脚本接管，不会真的跳转或打开新标签页。

## URL 上下文

当前 NocoDB Grid URL 形如：

```text
/<workspaceId>/<baseId>/<tableId>/<viewId>/<slug>
```

脚本按 NocoDB ID 前缀解析：

- `p...` → Base ID
- `m...` → Table ID
- `v...` → View ID
- Base ID 前一段 → Workspace ID（仅保留上下文，目前 API 不使用）

Record ID 不从 Canvas Grid 推断，而是完全由 Button URL 提供。

## API Token

NocoDB v3 Data API 使用 API Token。Token 不得写入仓库、UserScript metadata、MindMap WebUI 或 NocoDB Formula。

第一次点击 `MindMap` Button 时，如果本地没有 Token，脚本才显示密码输入弹窗。Token 保存到 Tampermonkey 当前脚本自己的 `GM_setValue` 存储中，键名为：

```text
tm-nocodb-mindmap-api-token-v1
```

如果 NocoDB API 返回 `401` 或 `403`，脚本会自动弹出 Token 设置窗口；保存新 Token 后自动重试刚才的 API 请求一次。普通网络异常或 `5xx` 服务端错误不会触发 Token 重设，也不会覆盖本地已保存 Token。

Token 输入框继续对 `Ctrl/Cmd + V`、`Ctrl/Cmd + C`、`Ctrl/Cmd + X`、`Ctrl/Cmd + A` 以及粘贴/复制/剪切事件做隔离，只阻止 NocoDB 或页面级快捷键继续处理，不阻止浏览器原生编辑行为。

## 读取与 iframe 初始化

点击某条记录的 `MindMap` Button 后：

```text
Button Open URL
  → recordId
  → 从当前页面 URL 解析 baseId / tableId
  → GET /api/v3/data/{baseId}/{tableId}/records/{recordId}
  → 读取 fields.MindMapData
  → 创建 iframe
  → 等待 mindmap:ready
  → 发送 mindmap:init
  → WebUI 初始化完整脑图
```

如果 `MindMapData` 为空，油猴脚本会在内存中生成默认脑图，并把它作为 `mindmap:init` 数据发给 WebUI；此时不会自动 PATCH NocoDB。

## iframe 通信

所有消息都校验：

- `event.origin === https://mindmap.380782744.xyz`
- `event.source === 当前 iframe.contentWindow`
- 消息 `source` 字段必须匹配约定值

WebUI → 油猴：

```text
mindmap:ready
mindmap:app-ready
mindmap:dirty
mindmap:save
mindmap:save-status
```

油猴 → WebUI：

```text
mindmap:init
mindmap:request-save
mindmap:save-result
```

WebUI 自己维护 revision。保存结果只有在对应 revision 仍然是当前 revision 时才会清除 dirty，这样可以避免“保存请求发出后又继续编辑”导致新修改被误标为已保存。

## `MindMapData` 数据格式

保存时继续使用原有 wrapper，不改变已有 NocoDB 数据格式：

```json
{
  "schemaVersion": 1,
  "engine": "simple-mind-map",
  "engineVersion": "0.14.0-fix.3",
  "data": {
    "layout": "mindMap",
    "root": {},
    "theme": {
      "template": "default",
      "config": {}
    },
    "view": null
  }
}
```

读取逻辑继续兼容早期直接保存的 SimpleMindMap 完整数据；只要对象顶层存在 `root`，脚本会将其视为旧格式读取，下一次保存时再统一包装成当前 schema。

## 首次打开

当 `MindMapData` 为 `null`、空值或没有有效脑图数据时，脚本自动创建新脑图：

- 默认布局：`mindMap`
- 默认主题：`default`
- 根节点文本优先取 `Title`、`Name`、`标题`、`名称`
- 上述字段均不存在时，使用第一项非空字符串字段
- 仍无法取得时使用 `Record <id>`

首次创建只发生在浏览器内存中；只有用户实际编辑后并执行保存，才会写回 NocoDB。

## 弹窗与保存

思维导图仍使用当前 NocoDB 页面内的大 Modal：

- 常规尺寸：最大约 `90vw × 85vh`
- Modal 主体内嵌独立 MindMap WebUI iframe
- 关闭后仍停留在原 NocoDB Grid 和原滚动位置
- 顶部保留状态文字和一个明确的“保存”按钮

v0.2.0 取消自动保存。普通编辑只会收到 WebUI 的 `mindmap:dirty`，油猴脚本只标记“有未保存修改”，不会自动调用 NocoDB PATCH。

保存入口有两个：

1. 外层 Modal 顶部“保存”按钮。
2. MindMap WebUI 内按 `Ctrl+S` / `Cmd+S`。

两者都会让 WebUI 提供当前 `getData(true)` 完整数据，再由油猴脚本执行：

```text
PATCH /api/v3/data/{baseId}/{tableId}/records
```

PATCH Body 继续使用 NocoDB v3 批量记录格式：

```json
[
  {
    "id": "<recordId>",
    "fields": {
      "MindMapData": {}
    }
  }
]
```

认证 Header：

```text
xc-token: <Tampermonkey 本地保存的 API Token>
```

## 关闭确认

没有未保存修改时，点击 `×`、点击遮罩或在父页面按 `Esc` 会直接关闭。

有未保存修改时不会自动 PATCH，而是在 `×` 左下侧显示小 Popover：

```text
有未保存修改
[放弃] [保存]
```

Popover 使用 `top: 32px; right: 32px` 挂在 32×32 的关闭按钮容器上，因此其右上角与 `×` 按钮左下角对齐。

- `放弃`：立即关闭，不写 NocoDB。
- `保存`：请求 iframe 返回当前完整数据；PATCH 成功且 WebUI 已确认 dirty 清除后再关闭。
- 保存失败：保持弹窗打开，并在顶部显示错误状态。

## 快捷键

思维导图快捷键现在全部由独立 iframe 中的官方 WebUI 处理，因此不会再由油猴脚本直接实现节点快捷键。常用快捷键包括：

| 功能 | Windows / Linux |
|---|---|
| 插入下级节点 | `Tab` / `Insert` |
| 插入同级节点 | `Enter` |
| 插入父节点 | `Shift + Tab` |
| 删除节点 | `Delete` / `Backspace` |
| 仅删除当前节点 | `Shift + Backspace` |
| 复制 / 剪切 / 粘贴 | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` |
| 全选 | `Ctrl+A` |
| 整理布局 | `Ctrl+L` |
| 搜索替换 | `Ctrl+F` |
| 手动保存到 NocoDB | `Ctrl+S` |

iframe 使这些快捷键与 NocoDB 父页面的全局快捷键天然隔离。父页面脚本只处理 Modal 层面的关闭操作。

## 维护边界

- 不解析、替换或注入 NocoDB Canvas Grid 的单元格 DOM。
- `MindMap` Button 只负责提供 `recordId`；Base ID / Table ID 继续从当前页面上下文取得。
- 不复用 NocoDB GUI 的内部 JWT、Cookie 或 undocumented session API；正式数据读写只走带 API Token 的 v3 Data API。
- Token 只允许保存在 Tampermonkey 本地存储，不得发送给 MindMap iframe，不得写入 GitHub、NocoDB 字段或日志。
- 油猴脚本不再直接依赖 SimpleMindMap bundle；编辑器版本和插件由 `Ember-Dawn/mind-map` WebUI 负责。
- MindMap WebUI URL 当前固定为 `https://mindmap.380782744.xyz/`；域名变更时需要同步修改油猴脚本中的 `MINDMAP_WEB_URL`。
- iframe bridge 必须继续使用明确的 origin 校验，不要改成无条件接受 `*` 来源的跨窗口消息。
- 如果未来 NocoDB 的 Button 不再通过 `window.open` 实现 Open URL，应优先检查 Button 导航机制，不要退回到 Canvas 坐标推断 recordId。

## 快速回归测试

1. 在包含 `MindMapData` JSON 和 `MindMap` Button 的 Grid 中点击 Button，确认不会打开新页。
2. 确认大 Modal 内加载 `mindmap.380782744.xyz` WebUI，而不是油猴自己创建 SimpleMindMap 工具栏。
3. 清空该脚本的 Tampermonkey 本地存储后点击 Button，确认仅此时要求输入 NocoDB API Token。
4. 在 Token 输入框中测试 `Ctrl/Cmd + V`，并确认 `Ctrl/Cmd + A/C/X` 保持浏览器原生行为。
5. 打开已有 `MindMapData` 的记录，确认节点、布局、主题和视图状态可以恢复。
6. 修改节点后等待数秒，确认不会自动 PATCH，顶部保持“有未保存修改”。
7. 点击顶部“保存”，确认出现“保存中…”并最终显示“✓ 已保存”。
8. 修改后按 `Ctrl+S` / `Cmd+S`，确认同样保存到 NocoDB。
9. 修改后点击 `×`，确认 `×` 左下方出现“有未保存修改 / 放弃 / 保存” Popover。
10. 点击 Popover 的“放弃”，重新打开后确认未保存修改没有写入 NocoDB。
11. 点击 Popover 的“保存”，确认成功保存后才关闭 Modal。
12. 在保存请求发出后继续编辑，确认旧保存结果不会清除新修改的 dirty 状态。
13. 使用错误 Token，确认 `401/403` 会弹出 Token 设置窗口；保存新 Token 后自动重试当前请求一次。
14. 模拟网络错误或 `5xx`，确认不会弹出 Token 设置窗口，也不会覆盖已有 Token。
15. 在没有 `MindMapData` 字段的表点击 Button，确认明确提示字段缺失。
16. 点击其他普通 Open URL Button，确认仍保持 NocoDB 原生行为。

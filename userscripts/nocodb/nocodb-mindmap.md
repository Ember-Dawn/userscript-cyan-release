# NocoDB 思维导图

`nocodb-mindmap.user.js` 用于在自部署 NocoDB CE 的 Grid 中通过原生 Button 打开思维导图大弹窗。脚本不解析 Canvas Grid 的行列 DOM；当前记录由 Button URL 中的 `recordId` 定位，Base ID 和 Table ID 从当前 NocoDB 页面 URL 解析，脑图内容保存到同一记录的 `MindMapData` JSON 字段。

从 v0.2.0 开始，油猴脚本不再自己加载和实例化 `simple-mind-map`。完整编辑器由单独部署的 `Ember-Dawn/mind-map` WebUI 提供，油猴脚本只负责 NocoDB 集成、外层 Modal、iframe、API Token、GET/PATCH 和保存确认。v0.2.1 进一步修正手动保存、dirty 状态、初始主题和 iframe 预热逻辑。

## 架构

```text
NocoDB Grid
  → MindMap Button
  → Tampermonkey 拦截 /__mindmap__?recordId=...
  → GET 当前 NocoDB record
  → 打开当前页面内的大 Modal
  → iframe 加载 https://mindmap.380782744.xyz/?embed=1&parentOrigin=...
  → postMessage 发送完整脑图数据
  → MindMap WebUI 负责编辑、快捷键和完整 UI
  → 手动保存时 WebUI 回传当前 getData(true)
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

油猴脚本不再包含 `@require simple-mind-map`、`@resource simpleMindMapCss` 或 `GM_getResourceText`。SimpleMindMap 的完整 UI、插件和快捷键均由独立 WebUI 自己维护。

## NocoDB 字段

目标表需要两个字段：

| 字段 | 类型 | 用途 |
|---|---|---|
| `MindMapData` | JSON | 保存完整脑图数据；建议在日常 Grid View 中隐藏 |
| `MindMap` | Button | 用户入口；Action 使用 `Open URL` |

`MindMapData` 必须保持这个固定名称。脚本读取记录后会检查该字段是否存在；不存在时不会创建或猜测其他字段，而是在弹窗中提示配置错误。

### Button URL

```text
https://nocodb.380782744.xyz/__mindmap__?recordId=<当前 Record ID>
```

当前可用的 NocoDB Formula：

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

Token 保存到 Tampermonkey 当前脚本自己的 `GM_setValue` 存储中，键名为：

```text
tm-nocodb-mindmap-api-token-v1
```

顶部现在提供可点击的 API 状态按钮：

```text
API 未配置
API 待验证
API ✓
API ✕
```

点击该按钮可以重新输入 Token，并立即用当前 record 做一次 API 验证。正常 GET/PATCH 成功后显示 `API ✓`；网络错误、鉴权错误或其他 API 失败显示 `API ✕`。如果 NocoDB API 返回 `401` 或 `403`，脚本仍会自动弹出 Token 设置窗口，保存新 Token 后自动重试刚才的请求一次。普通网络异常或 `5xx` 不会覆盖本地已保存 Token。

Token 输入框继续对 `Ctrl/Cmd + V`、`Ctrl/Cmd + C`、`Ctrl/Cmd + X`、`Ctrl/Cmd + A` 以及粘贴/复制/剪切事件做隔离，只阻止 NocoDB 或页面级快捷键继续处理，不阻止浏览器原生编辑行为。

## 读取与 iframe 初始化

点击某条记录的 `MindMap` Button 后：

```text
Button Open URL
  → recordId
  → 从当前页面 URL 解析 baseId / tableId
  → GET /api/v3/data/{baseId}/{tableId}/records/{recordId}
  → 读取 fields.MindMapData
  → 等待 iframe bridge ready
  → mindmap:init
  → WebUI 只初始化一次并强制应用该完整数据
```

外层 loading 会一直覆盖 iframe，直到 WebUI 确认 SimpleMindMap 实例已经应用父页面传入的数据，避免先显示默认 `根节点` 再闪换为真实数据。

如果 `MindMapData` 为空，油猴脚本会在内存中生成新脑图；不会自动 PATCH NocoDB。

## 首次打开默认值

当 `MindMapData` 为 `null`、空值或没有有效脑图数据时：

- 默认布局：`mindMap`
- 默认主题：`classic15`，即“脑图经典15”
- 根节点文本只优先取 `Title`、`Name`、`标题`、`名称`
- 如果这些明确标题字段都不存在，则使用 `中心主题`

不再使用“第一项非空字符串字段”作为根节点，因此日期、URL 或其他普通文本字段不会被误当成主节点标题。Modal 顶部标题同样只使用明确标题字段；没有时显示 `Record <id>`。

已有 `MindMapData` 的主题完全保留，不会被强制替换成 `classic15`。

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
mindmap:data
mindmap:save-status
```

油猴 → WebUI：

```text
mindmap:init
mindmap:request-save
mindmap:request-data
mindmap:save-result
```

WebUI 自己维护 revision。保存结果只有在对应 revision 仍然是当前 revision 时才会清除 dirty，避免“保存请求发出后又继续编辑”导致新修改被误标为已保存。

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
      "template": "classic15",
      "config": {}
    },
    "view": null
  }
}
```

上面的 `classic15` 只是新建脑图的默认示例；已有数据继续使用其保存的主题。读取逻辑继续兼容早期直接保存的 SimpleMindMap 完整数据；只要对象顶层存在 `root`，脚本会将其视为旧格式读取，下一次保存时再统一包装成当前 schema。

## 手动保存

v0.2.0 起取消自动保存。普通编辑只标记 dirty，不自动调用 NocoDB PATCH。

保存入口：

1. 外层 Modal 顶部“保存”按钮。
2. MindMap WebUI 内按 `Ctrl+S` / `Cmd+S`。
3. 关闭 Popover 中的“保存”。

v0.2.1 起，显式保存**不再以父页面当前 dirty 值作为是否 PATCH 的前置条件**。每次用户明确触发保存都会：

```text
请求 iframe 当前 getData(true)
  → mindmap:save
  → PATCH /api/v3/data/{baseId}/{tableId}/records
  → mindmap:save-result
  → WebUI 核对 revision
  → mindmap:dirty / mindmap:save-status
```

因此即使 dirty 通知链短暂异常，用户点击“保存”仍会真正发起 NocoDB PATCH。

PATCH Body：

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

## dirty 状态

正确状态流：

```text
加载已有数据 → ✓ 已加载
编辑 → 有未保存修改
保存 → 请求保存… / 保存中…
PATCH 成功且 revision 未变化 → ✓ 已保存
继续编辑 → 有未保存修改
```

新建但尚未写入 NocoDB 的脑图从打开完成开始就视为 dirty，因此直接关闭时也会出现保存确认。

## 关闭确认

没有未保存修改时，点击 `×`、点击遮罩或在父页面按 `Esc` 会直接关闭。

有未保存修改时不会自动 PATCH，而是在 `×` 左下侧显示：

```text
有未保存修改
[放弃] [保存]
```

Popover 使用 `top: 32px; right: 32px` 挂在 32×32 的关闭按钮容器上，其右上角与 `×` 按钮左下角对齐。

- `放弃`：立即关闭，不写 NocoDB。
- `保存`：显式请求 iframe 当前完整数据；PATCH 成功并收到 WebUI 保存确认后再关闭。
- 保存失败或保存期间又发生新编辑：保持弹窗打开。

## 打开速度优化

脚本在 NocoDB 页面空闲时进行两级预热：

1. 对 `https://mindmap.380782744.xyz` 建立 `preconnect`。
2. 创建一个屏幕外 iframe，只加载 WebUI/bridge 和静态依赖，不发送 `mindmap:init`，加载完成后自动移除。

这样不会读取或修改任何 NocoDB record，也不会创建实际脑图实例，但可以提前缓存 Vue、SimpleMindMap 和 WebUI 相关资源，降低真正点击 Button 后的等待时间。当前部署仍是 Vue Dev Server/HMR；未来切到 production build + nginx 后还可进一步缩短冷启动时间。

## 快捷键

思维导图快捷键由独立 iframe 中的官方 WebUI 处理。常用快捷键：

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

## 维护边界

- 不解析、替换或注入 NocoDB Canvas Grid 的单元格 DOM。
- `MindMap` Button 只负责提供 `recordId`；Base ID / Table ID 继续从当前页面上下文取得。
- 正式数据读写只走带 API Token 的 NocoDB v3 Data API。
- Token 只允许保存在 Tampermonkey 本地存储，不得发送给 MindMap iframe，不得写入 GitHub、NocoDB 字段或日志。
- 油猴脚本不再直接依赖 SimpleMindMap bundle；编辑器版本和插件由 `Ember-Dawn/mind-map` WebUI 负责。
- MindMap WebUI URL 当前固定为 `https://mindmap.380782744.xyz/`。
- iframe bridge 必须继续使用明确的 origin 校验，不要改成无条件接受 `*` 来源的跨窗口消息。
- 如果未来 NocoDB 的 Button 不再通过 `window.open` 实现 Open URL，应优先检查 Button 导航机制，不要退回到 Canvas 坐标推断 recordId。

## 快速回归测试

1. 点击 MindMap Button，确认不打开新页且 iframe 正常加载。
2. 确认顶部 API 状态能在 `未配置 / 待验证 / ✓ / ✕` 间正确变化；点击按钮可以重设并验证 Token。
3. 清空 Token 后点击 Button，确认会要求输入 Token，且粘贴快捷键正常。
4. 打开空 `MindMapData`，确认第一帧最终显示 `中心主题`，主题为“脑图经典15”，不再先显示日期或最终回退为 `根节点`。
5. 打开已有 `MindMapData`，确认节点、布局、主题和视图状态保持原样。
6. 修改任意节点后，顶部立即变成“有未保存修改”，且等待不会自动 PATCH。
7. 在 dirty 与非 dirty 两种状态下分别点击顶部“保存”，确认都真正执行 PATCH，并最终显示“✓ 已保存”。
8. 修改后按 `Ctrl+S` / `Cmd+S`，确认同样保存到 NocoDB。
9. 保存请求发出后继续编辑，确认旧保存结果不会清除新修改的 dirty 状态。
10. 新建脑图但不编辑，直接点 `×`，确认仍会出现“放弃 / 保存”。
11. 点击 Popover“保存”，确认收到 WebUI 保存确认后才关闭。
12. 使用错误 Token，确认 `401/403` 会要求更新 Token 并只自动重试一次。
13. 模拟网络错误或 `5xx`，确认不会覆盖已有 Token。
14. 在没有 `MindMapData` 字段的表点击 Button，确认明确提示字段缺失。
15. 点击其他普通 Open URL Button，确认仍保持 NocoDB 原生行为。

# NocoDB 思维导图

`nocodb-mindmap.user.js` 用于在自部署 NocoDB CE 的 Grid 中通过原生 Button 打开思维导图大弹窗。脚本不解析 Canvas Grid 的行列 DOM；当前记录由 Button URL 中的 `recordId` 定位，Base ID 和 Table ID 从当前 NocoDB 页面 URL 解析，脑图内容保存到同一记录的 `MindMapData` JSON 字段。

## 依赖与版本

- 思维导图库：`simple-mind-map` `0.14.0-fix.3`（MIT License）
- JS：固定版本的 UMD bundle，由 UserScript `@require` 从固定版本 UNPKG URL 加载
- CSS：固定版本的 `simpleMindMap.esm.min.css`，由 UserScript `@resource` 从固定版本 UNPKG URL 加载
- NocoDB 数据接口：v3 Data API

SimpleMindMap UMD 会创建 `simpleMindMap` 全局对象，构造函数位于 `simpleMindMap.default`。脚本只使用固定版本 URL，不跟随 `latest`，避免上游更新直接改变运行行为。

本实现不把约 6.8 MB 的 UMD bundle 和配套 CSS 复制进 `userscript-cyan`；它们由 Tampermonkey 按固定版本 URL 获取，因此 release 仓库也无需额外同步第三方 bundle。

## NocoDB 字段

目标表需要两个字段：

| 字段 | 类型 | 用途 |
|---|---|---|
| `MindMapData` | JSON | 保存完整脑图数据；建议在日常 Grid View 中隐藏 |
| `MindMap` | Button | 用户入口；Action 使用 `Open URL` |

`MindMapData` 必须保持这个固定名称。脚本读取记录后会检查该字段是否存在；不存在时不会创建或猜测其他字段，而是在弹窗中提示配置错误。

### Button URL

`MindMap` Button 的 URL 只负责携带当前 Record ID。当前自部署域名可使用：

```text
https://nocodb.380782744.xyz/__mindmap__?recordId=<当前 Record ID>
```

当前已验证可用的 NocoDB Formula 为：

```text
CONCAT("https://nocodb.380782744.xyz/__mindmap__?recordId=", RECORD_ID())
```

只要最终得到上述地址即可，脚本不依赖其他 Formula 细节。

脚本在 `document-start` 包装页面 `window.open`。NocoDB 原生 Button 准备打开 `/__mindmap__?recordId=...` 时会被脚本接管，不会真的跳转或打开新标签页，而是在当前 NocoDB 页面显示大弹窗。

## URL 上下文

当前 NocoDB Grid URL 形如：

```text
/<workspaceId>/<baseId>/<tableId>/<viewId>/<slug>
```

例如：

```text
/wqziq3ee/pzgykcvb6mla5bv/mpd1e2gv3tclzc1/vwgu9xm6veau8yjg/...
```

脚本按 NocoDB ID 前缀解析：

- `p...` → Base ID
- `m...` → Table ID
- `v...` → View ID
- Base ID 前一段 → Workspace ID（仅保留上下文，目前 API 不使用）

Record ID 不从 Canvas Grid 推断，而是完全由 Button URL 提供。

## API Token

NocoDB v3 Data API 使用 API Token。Token 不得写入仓库、UserScript metadata 或 NocoDB Formula。

第一次点击 `MindMap` Button 时，如果本地没有 Token，脚本才显示密码输入弹窗。Token 保存到 Tampermonkey 当前脚本自己的 `GM_setValue` 存储中，键名为：

```text
tm-nocodb-mindmap-api-token-v1
```

脚本不再向 Tampermonkey 脚本菜单注册“设置 / 清除 Token”等菜单项，也不在思维导图工具栏中常驻 Token 设置按钮。正常情况下保存一次后后续使用完全无感。

如果 NocoDB API 返回 `401` 或 `403`，脚本会认为当前 Token 已失效或权限不足，自动弹出 Token 设置窗口；保存新 Token 后自动重试刚才的 API 请求一次。普通网络异常或 `5xx` 服务端错误不会触发 Token 重设，也不会覆盖本地已保存 Token。

## 读取与写回

点击某条记录的 `MindMap` Button 后：

```text
Button Open URL
  → recordId
  → 从当前页面 URL 解析 baseId / tableId
  → GET /api/v3/data/{baseId}/{tableId}/records/{recordId}
  → 读取 fields.MindMapData
  → SimpleMindMap 大弹窗
```

保存时：

```text
SimpleMindMap getData(true)
  → 包装 metadata
  → PATCH /api/v3/data/{baseId}/{tableId}/records
  → 更新当前 record 的 MindMapData
```

PATCH Body 使用 NocoDB v3 的批量记录格式：

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

认证 Header 使用：

```text
xc-token: <本地 Tampermonkey 中保存的 API Token>
```

## `MindMapData` 数据格式

正式保存时不直接裸存节点树，而是保存一个很薄的 wrapper：

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

其中 `data` 就是 `mindMap.getData(true)` 返回的完整数据，包括节点树、布局、主题和视图状态。

为方便早期测试和迁移，读取逻辑也兼容直接保存的 SimpleMindMap 完整数据；只要对象顶层存在 `root`，脚本会将其视为旧格式读取，下一次保存时再统一包装成当前 schema。

## 首次打开

当 `MindMapData` 为 `null`、空值或没有有效脑图数据时，脚本自动创建新脑图：

- 默认布局：`mindMap`
- 默认主题：`default`
- 根节点文本优先取 `Title`、`Name`、`标题`、`名称`
- 上述字段均不存在时，使用第一项非空字符串字段
- 仍无法取得时使用 `Record <id>`

首次创建后会进入自动保存流程，无需预先向每条记录写入 JSON。

## 弹窗与操作

思维导图使用当前页面内的大 Modal，而不是新页面：

- 常规尺寸：最大约 `90vw × 85vh`
- 小屏幕时自动接近全屏，但仍保持弹窗结构
- 关闭后仍停留在原 NocoDB Grid 和原滚动位置

顶部工具栏提供基础操作：

- 新增子节点
- 新增同级节点
- 删除节点
- 撤销 / 重做
- 一键整理布局
- 缩小 / 适应画布 / 放大
- 立即保存

SimpleMindMap 自身快捷键仍可使用，例如 `Tab` 新增子节点、`Enter` 新增同级节点、`Del/Backspace` 删除节点、`Ctrl+Z` 撤销。

## 自动保存

脚本监听：

- `data_change`
- `view_data_change`
- `layout_change`

发生变化后采用约 1.5 秒 debounce 自动保存。状态栏会显示：

```text
有未保存修改
保存中…
✓ 已保存
保存失败
```

关闭弹窗时会先 flush 尚未保存的修改；如果最终保存仍失败，会询问是否仍然关闭，避免无提示丢失改动。

## 维护边界

- 不解析、替换或注入 NocoDB Canvas Grid 的单元格 DOM。
- `MindMap` Button 只负责提供 `recordId`；Base ID / Table ID 继续从当前页面上下文取得。
- 不复用 NocoDB GUI 的内部 JWT、Cookie 或 undocumented session API；正式数据读写只走带 API Token 的 v3 Data API。
- Token 只允许保存在 Tampermonkey 本地存储，不得写入 GitHub、NocoDB 字段或日志。
- Token 配置采用按需弹窗：无 Token 时请求输入，`401/403` 时请求更新并仅自动重试一次；网络错误和 `5xx` 不得误判为 Token 失效。
- SimpleMindMap 依赖固定到明确版本；升级版本时应同时验证 UMD 全局变量、CSS、`getData(true)`、`data_change` / `view_data_change`、`destroy()` 和基础命令是否仍兼容。
- 如果未来 NocoDB 的 Button 不再通过 `window.open` 实现 Open URL，应优先检查 Button 导航机制，不要退回到 Canvas 坐标推断 recordId。

## 快速回归测试

1. 在包含 `MindMapData` JSON 和 `MindMap` Button 的 Grid 中点击 Button，确认不会打开新页。
2. 清空该脚本的 Tampermonkey 本地存储后点击 Button，确认仅此时要求输入 API Token，且脚本菜单中没有新增 Token 选项。
3. 对空 `MindMapData` 记录创建节点，等待约 1.5 秒，确认显示 `✓ 已保存`。
4. 关闭并重新打开同一记录，确认节点、布局和画布视图可以恢复。
5. 修改节点后立刻关闭，确认关闭前会执行最后一次保存。
6. 使用错误 Token，确认 `401/403` 会弹出 Token 设置窗口；保存新 Token 后自动重试当前请求一次。
7. 模拟网络错误或 `5xx`，确认不会弹出 Token 设置窗口，也不会覆盖已有 Token。
8. 在没有 `MindMapData` 字段的表点击 Button，确认明确提示字段缺失。
9. 点击其他普通 Open URL Button，确认仍保持 NocoDB 原生行为。

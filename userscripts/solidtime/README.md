# solidtime 交互增强助手

`solidtime-enhancer.user.js` 用于补充 solidtime WebUI 中一些更适合个人使用习惯的交互行为。当前脚本在 PC 和手机浏览器中共用同一套实现，不修改 solidtime 服务端或前端源码。

## 当前功能

1. **Start 后不自动聚焦 Description**
   - solidtime 原生行为会在点击 Start 后主动聚焦 Description。
   - 脚本只取消这次由程序触发的自动聚焦，不影响之后手动点击 Description。

2. **打开 Project 后不自动聚焦搜索框**
   - Project 下拉打开后，solidtime 会主动聚焦搜索框。
   - 脚本取消程序触发的自动聚焦，避免手机端无意弹出软键盘。
   - 用户手动点击搜索框时仍正常聚焦和输入。

3. **Project 中英混合自然升序**
   - solidtime 后端 Project 列表默认按 `created_at DESC` 返回，新建项目通常排在前面。
   - 脚本在浏览器侧拦截 Project 列表的 XHR 请求，收集全部分页后再统一排序。
   - 排序使用 `Intl.Collator(['zh-CN-u-co-pinyin', 'en'], { sensitivity: 'base', numeric: true })`：中文按拼音规则参与比较，英文忽略大小写差异，数字采用自然顺序，例如 `Project 2` 排在 `Project 10` 前。

## 关键 solidtime 实现依据

当前脚本依赖以下较稳定的页面/API 约定：

- Start/Stop 按钮：`[data-testid="timer_button"]`
- Description：`[data-testid="time_entry_description"]`
- Project 搜索框：`[data-testid="client_dropdown_search"]`
- Project API：`/api/v1/organizations/{organization}/projects`
- Time Tracker 通过 `useProjectsQuery()` 调用 `fetchAllPages()` 获取所有 Project。
- solidtime API 客户端使用 Zodios/Axios；浏览器侧 Project 请求实际可从 `XMLHttpRequest` 链路拦截。
- Project 下拉使用虚拟列表，因此不要通过重排已渲染 DOM 的方式实现排序。

## Project 排序机制

### 为什么不直接改 DOM

Project 下拉使用虚拟列表，页面上只挂载当前可见的一部分 Project。直接重排 DOM 会造成滚动、索引、高亮和 Project/Task 对应关系不稳定。

### 为什么不能只排序单个分页

solidtime 的 Project API 是分页接口，前端会把第 1 页、第 2 页等依次取回后再合并。如果每页单独排序，跨页后的整体顺序仍然可能错误。

### 当前方案

脚本在 `document-start` 阶段包装 `XMLHttpRequest`：

1. 识别 `GET /api/v1/organizations/{organization}/projects?archived=all&page=1`。
2. 保留第一页原始请求和响应。
3. 根据第一页 `meta.last_page`，使用原生 XHR 获取剩余分页。
4. 合并所有 Project。
5. 按名称执行中英混合自然升序。
6. 把合并后的结果伪装为 `last_page = 1` 的完整响应交回 Axios。
7. 如果额外分页、JSON 解析或响应覆盖失败，则回退到 solidtime 原始响应，不阻断正常使用。

### 历史说明

v0.4.0 曾尝试包装 `window.fetch`，但 solidtime 当前 API 客户端走 Zodios/Axios，未经过该拦截链路，因此排序没有实际生效。v0.5.0 改为 XHR 方案后已在 PC 端确认 Project 排序成功。

## 维护注意事项

- 不要无理由修改上述 `data-testid` 选择器。
- 不要把 Project 排序改成最终 DOM 重排。
- 修改 XHR 代理时优先保持“失败后放行原始响应”的降级策略，避免 Project API 异常导致 solidtime 无法使用。
- `@run-at document-start` 是 Project 请求拦截能够足够早安装的重要前提。
- 如果 solidtime 未来把 API 客户端从 XHR/Axios 改为 Fetch，需要重新确认请求链路。
- 如果 solidtime 后端未来增加原生 Project 名称排序参数，应优先考虑使用官方排序能力，减少客户端代理逻辑。

## 建议回归测试

每次修改后至少检查：

1. PC：点击 Start 后 Description 不会被自动聚焦。
2. 手机/Via：点击 Start 后 Description 不会导致无意弹出软键盘。
3. PC：打开 Project 后搜索框不会自动聚焦。
4. 手机/Via：打开 Project 后不会自动弹出软键盘。
5. PC/手机：手动点击 Project 搜索框后仍可正常输入。
6. Project 列表按名称中英混合自然升序。
7. 名称包含数字时按自然数字顺序排列。
8. Project 数量跨越多个 API 分页时无缺失、无重复，排序仍为全局升序。
9. Project 搜索、选择 Project、选择 Task 等原生功能保持正常。

语法检查：

```bash
node --check userscripts/solidtime/solidtime-enhancer.user.js
```

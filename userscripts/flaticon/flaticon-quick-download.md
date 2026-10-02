# Flaticon 快捷下载助手

`flaticon-quick-download.user.js` 用于缩短 Flaticon 图标列表中的 PNG 操作路径。脚本只增强现有免费 PNG 复制/下载流程，不提供 SVG 权限、不绕过 Premium 权限，也不改变 Flaticon 的授权与署名要求。

## 当前功能

1. **图标左侧快捷操作列**
   - 当鼠标悬停到脚本已识别的 Flaticon 图标卡片时，在左上侧显示一列紧凑控件。
   - 第一项为短 HEX 输入框；第二项为一键 Copy PNG；第三项为一键 Download PNG。
   - 原生 Copy 与 Download 两个会继续弹出 SVG/PNG 二级菜单的入口会在已增强卡片中隐藏；其他原生操作保留。

2. **可选 HEX 颜色**
   - 支持 `#2563EB`、`2563EB`、`#ABC`、`ABC` 等 3 位或 6 位 HEX 输入。
   - 脚本会把 3 位 HEX 展开为 6 位并统一为带 `#` 的大写形式。
   - 输入框留空时不覆盖 Flaticon 的原始颜色，继续使用网站默认效果。
   - 当前实现会在触发原生 PNG 操作前，把颜色同步到当前卡片可识别的 `color` 输入或 `data-color` 状态；Flaticon 若调整内部颜色状态结构，需要重新确认该链路。

3. **一键 Copy PNG**
   - 直接触发当前卡片原生 `.copypng--button` PNG 复制逻辑。
   - 不显示原来的 `Copy to clipboard -> SVG / PNG` 二级菜单。
   - 浏览器仍可能依据自身剪贴板权限策略决定是否允许图片写入剪贴板。

4. **一键 Download PNG**
   - 直接触发 Flaticon 原生 PNG 下载逻辑，并自动继续当前免费 PNG 流程中的 `Free download`。
   - 自动下载期间隐藏中间下载弹窗，下载触发后自动关闭当前已识别的 attribution confirmation 弹窗。
   - 完成后只显示一个短提示，提醒免费图标仍需遵守 Flaticon 的署名要求。

## 当前依赖的 Flaticon 页面约定

脚本当前基于 2026-10-02 实测页面中的以下结构：

- 原生 Copy 容器：`.copy-png-svg-list`
- 原生 Copy PNG 按钮：`.copypng--button[data-copy-format="png"]`
- 原生 Download 容器：`.download-png-svg-list`
- 原生 Download PNG 按钮：`.GA_CM_download-png button`
- 原生 PNG 下载调用：`Downloads.direct_download_icon_post(event, 'png')`
- 免费下载按钮：`#download-free`
- 下载表单：`#download-form-{iconId}`
- 下载表单中已确认存在 `format=png`、`color`、`size=512`、`premium=0` 等字段。

这些是第三方站点内部 DOM/JS 约定，不属于稳定 API。Flaticon 改版后，如果快捷按钮消失、Copy 无反应、Download 停在弹窗或颜色不生效，应优先重新抓取相关 DOM 与点击链路，而不是直接扩大选择器范围。

## 交互与实现原则

- 只增强当前页面已经提供给用户的免费 PNG 能力。
- 不保存、硬编码或上传 Flaticon 的 Cookie、Token、Premium token 或其他会话凭据。
- 不重新实现 Flaticon 的权限判断；Copy 与 Download 尽量复用网站自己的原生逻辑。
- HEX 留空时不主动写入颜色参数，避免破坏彩色图标或网站默认颜色。
- MutationObserver 只负责在页面动态增加图标卡片后进行防抖扫描，以及在一键下载期间继续完成短暂的弹窗链路。
- 一键下载期间还会在真正的 `download-form-{iconId}` 提交前再次写入已验证的颜色，避免中间弹窗创建表单的时序导致颜色丢失。

## 建议回归测试

每次修改后至少检查：

1. Flaticon 搜索结果页正常加载，未 hover 的图标不会显示快捷操作列。
2. hover 图标后左侧显示 HEX、Copy、Download 三个控件，右侧原生 Copy / Download 入口被隐藏，其他原生按钮仍存在。
3. HEX 留空时 Copy PNG 与 Download PNG 都保持 Flaticon 默认颜色。
4. 输入 `2563EB` 或 `#2563EB` 后不会报错，并规范化为 `#2563EB`。
5. 输入非法 HEX 时不会继续执行 Copy / Download，并出现轻量错误提示。
6. Copy PNG 点击一次即可触发原生 PNG 复制，不出现 SVG/PNG 二级菜单。
7. Download PNG 点击一次即可继续免费 PNG 下载，不停留在 `Free download` 二次确认弹窗。
8. 下载完成后不会残留遮罩或阻塞页面交互。
9. 动态滚动加载出新的图标后，新卡片也能获得快捷操作列。
10. 免费图标的署名责任不因脚本操作路径缩短而改变。

语法检查：

```bash
node --check userscripts/flaticon/flaticon-quick-download.user.js
```

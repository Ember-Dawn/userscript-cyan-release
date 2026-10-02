# Flaticon 快捷下载助手

`flaticon-quick-download.user.js` 用于缩短 Flaticon 图标列表中的 PNG 操作路径。脚本只增强现有免费 PNG 复制/下载流程，不提供 SVG 权限、不绕过 Premium 权限，也不改变 Flaticon 的授权与署名要求。

## 当前功能

1. **图标左侧快捷操作列**
   - 当鼠标悬停到脚本已识别的 Flaticon 图标卡片时，在左上侧显示一列紧凑控件。
   - 第一项为短 HEX 输入框；第二项为一键 Copy PNG；第三项为一键 Download PNG。
   - Flaticon 右侧原生按钮全部保留；快捷操作列只作为额外入口，不再隐藏原生 Copy / Download。
   - Copy / Download 使用脚本自绘的 CSS 图标，不依赖 Flaticon 内部 icon font，避免站点样式变化后出现空按钮。

2. **可选 HEX 颜色**
   - 支持 `#2563EB`、`2563EB`、`#ABC`、`ABC` 等 3 位或 6 位 HEX 输入。
   - 脚本会把 3 位 HEX 展开为 6 位并统一为带 `#` 的大写形式。
   - 输入框留空时不覆盖 Flaticon 的原始颜色，继续使用网站默认效果。
   - 每次鼠标重新进入一张图标卡片时，HEX 输入框都会清空；在同一次 hover 内从输入框移动到 Copy / Download 不会清空。
   - Download 会在原生下载 form 真正提交前再次写入颜色，并同时覆盖 `submit()`、`requestSubmit()` 和 `submit` 事件路径，减少 Flaticon 中间流程重新生成表单导致颜色丢失的问题。

3. **一键 Copy PNG**
   - 仍触发当前卡片原生 `.copypng--button` PNG 复制流程，因此继续复用 Flaticon 自己的复制与下载计数逻辑。
   - HEX 留空时完全保持原生 PNG。
   - HEX 有值时，脚本临时代理浏览器 `Clipboard.write()`，在原生 PNG 真正写入剪贴板前仅替换 PNG 像素颜色，同时保留透明度，再把处理后的 PNG 交给浏览器剪贴板。
   - 不显示原来的 `Copy to clipboard -> SVG / PNG` 二级菜单。

4. **一键 Download PNG**
   - 直接触发 Flaticon 原生 PNG 下载流程，并自动继续当前免费 PNG 流程中的 `Free download`。
   - 自动流程开始前即进入隐藏模式；`Free download` 与下载后的 attribution confirmation 弹窗会在 MutationObserver 回调阶段隐藏并自动处理，避免中间弹窗干扰操作。
   - 下载完成后只显示轻量的“PNG 下载已触发”提示。

## 当前依赖的 Flaticon 页面约定

脚本当前基于 2026-10-02 实测页面中的以下结构：

- 原生 Copy 容器：`.copy-png-svg-list`
- 原生 Copy PNG 按钮：`.copypng--button[data-copy-format="png"]`
- 原生 Download 容器：`.download-png-svg-list`
- 原生 Download PNG 按钮：`.GA_CM_download-png button`
- 原生 PNG 下载调用：`Downloads.direct_download_icon_post(event, 'png')`
- 免费下载按钮：`#download-free`
- 下载表单：`#download-form-{iconId}`
- 下载后的 attribution confirmation 关闭按钮：`.detail__download-confirmation__close`
- 下载表单中已确认存在 `format=png`、`color`、`size=512`、`premium=0` 等字段。
- 原生 Copy PNG 当前通过浏览器 Clipboard API 写入 PNG；脚本只在用户填写 HEX 时对该次 PNG 写入做本地像素换色。

这些是第三方站点内部 DOM/JS 约定，不属于稳定 API。Flaticon 改版后，如果快捷按钮消失、Copy 无反应、Download 停在弹窗或颜色不生效，应优先重新抓取相关 DOM 与点击链路，而不是直接扩大选择器范围。

## 交互与实现原则

- 只增强当前页面已经提供给用户的免费 PNG 能力。
- 不保存、硬编码或上传 Flaticon 的 Cookie、Token、Premium token 或其他会话凭据。
- 不重新实现 Flaticon 的权限判断；Copy 与 Download 继续由网站原生入口发起。
- HEX 留空时不主动写入颜色参数，避免破坏彩色图标或网站默认颜色。
- Copy 的有色 PNG 只在当前用户点击触发的 Clipboard 写入阶段本地处理；不会修改页面预览或长期保存颜色。
- Download 在真正提交当前图标的原生 form 前写入已验证颜色，不创建或保存新的下载 token。
- MutationObserver 只负责在页面动态增加图标卡片后进行防抖扫描，以及在一键下载期间继续完成短暂的隐藏弹窗链路。

## 建议回归测试

每次修改后至少检查：

1. Flaticon 搜索结果页正常加载，未 hover 的图标不会显示快捷操作列。
2. hover 图标后左侧显示 HEX、带可见图标的 Copy、Download 三个控件，右侧三个原生按钮仍全部存在。
3. 每次重新离开再 hover 同一图标，HEX 都恢复为空；同一次 hover 内移动到快捷按钮不会清空。
4. HEX 留空时 Copy PNG 与 Download PNG 都保持 Flaticon 默认颜色。
5. 输入 `2563EB` 或 `#2563EB` 后不会报错，并规范化为 `#2563EB`。
6. 输入非法 HEX 时不会继续执行 Copy / Download，并出现轻量错误提示。
7. 输入 HEX 后 Copy PNG 写入剪贴板的 PNG 使用目标颜色，透明背景保持不变。
8. 输入 HEX 后 Download PNG 下载的 PNG 使用目标颜色。
9. Copy PNG 点击一次即可触发原生 PNG 复制，不出现 SVG/PNG 二级菜单。
10. Download PNG 点击一次即可完成免费 PNG 下载，不显示 `Free download` 或 attribution confirmation 中间弹窗。
11. 下载完成后不会残留遮罩或阻塞页面交互，原生 Download 仍可正常手动使用。
12. 动态滚动加载出新的图标后，新卡片也能获得快捷操作列。
13. 免费图标的署名责任不因脚本操作路径缩短而改变。

语法检查：

```bash
node --check userscripts/flaticon/flaticon-quick-download.user.js
```

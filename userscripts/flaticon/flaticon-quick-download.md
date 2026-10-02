# Flaticon 快捷下载助手

`flaticon-quick-download.user.js` 用于缩短 Flaticon 图标列表中的 PNG 操作路径。脚本只增强现有免费 PNG 复制/下载流程，不提供 SVG 权限、不绕过 Premium 权限，也不改变 Flaticon 的授权与署名要求。

## 当前功能

1. **图标左侧快捷操作列**
   - 当鼠标悬停到脚本已识别的 Flaticon 图标卡片时，在左上侧显示一列紧凑控件。
   - 第一项为 HEX 输入框；第二项为一键 Copy PNG；第三项为一键 Download PNG。
   - 三个快捷控件统一使用蓝色视觉，并动态读取右侧原生按钮的实际尺寸、顶部位置和行间距，让左右三行尽量严格对齐。
   - HEX 输入框与 Copy / Download 按钮使用相同外尺寸；Copy / Download 使用脚本自绘的 CSS 图标，不依赖 Flaticon 内部 icon font。
   - Flaticon 右侧原生三个按钮全部保留；快捷操作列只作为额外入口，不隐藏或替换原生入口。

2. **可选 HEX 颜色**
   - 支持 `#2563EB`、`2563EB`、`#ABC`、`ABC` 等 3 位或 6 位 HEX 输入。
   - 脚本会把 3 位 HEX 展开为 6 位并统一为带 `#` 的大写形式。
   - 输入框留空时不覆盖 Flaticon 的原始颜色，继续使用网站默认效果。
   - 每次鼠标重新进入一张图标卡片时，HEX 输入框都会清空并恢复默认蓝色；在同一次 hover 内从输入框移动到 Copy / Download 不会清空。
   - 输入合法 3 位或 6 位 HEX 时，输入框背景会实时变成目标颜色，并根据亮度自动切换黑/白文字；输入为空或尚未构成合法 HEX 时保持默认蓝色。
   - Download 会在原生下载 form 真正提交前再次写入颜色，并同时覆盖 `submit()`、`requestSubmit()` 和 `submit` 事件路径，减少 Flaticon 中间流程重新生成表单导致颜色丢失的问题。

3. **一键 Copy PNG**
   - 仍触发当前卡片原生 `.copypng--button` PNG 复制流程，因此继续复用 Flaticon 自己的复制与下载计数逻辑。
   - HEX 留空时完全保持原生 PNG。
   - HEX 有值时，脚本临时代理浏览器 `Clipboard.write()`，在原生 PNG 真正写入剪贴板前仅替换 PNG 像素颜色，同时保留透明度，再把处理后的 PNG 交给浏览器剪贴板。
   - 不显示原来的 `Copy to clipboard -> SVG / PNG` 二级菜单。
   - 快捷 Copy 成功后抑制该次原生 Copy toast，并统一使用脚本自己的底部居中提示 `PNG 已复制`；右侧原生 Copy 按钮仍保持 Flaticon 原生反馈。

4. **一键 Download PNG**
   - 直接触发 Flaticon 原生 PNG 下载流程，并自动继续当前免费 PNG 流程中的 `Free download`。
   - 自动流程开始前即进入隐藏模式；`Free download` 与下载后的 attribution confirmation 弹窗会在 MutationObserver 回调阶段隐藏并自动处理，避免中间弹窗干扰操作。
   - 下载完成后只显示与 Copy 相同位置、相同样式的脚本 toast，文案为 `PNG 已下载`。

5. **统一快捷操作反馈**
   - 左侧快捷 Copy / Download 都使用脚本自己的底部居中轻量 toast。
   - 脚本只在左侧快捷 Copy 的短暂操作窗口内尝试隐藏与 Copy/Clipboard 文案匹配的原生 toast，不影响用户点击右侧原生按钮时的站点反馈。

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
- MutationObserver 只负责在页面动态增加图标卡片后进行防抖扫描、一键下载期间继续完成短暂的隐藏弹窗链路，以及在快捷 Copy 的极短窗口内抑制原生 Copy toast。
- 快捷操作列会根据右侧原生按钮实际几何位置更新自身尺寸和间距；不要把对齐参数写死为只适配某一种卡片尺寸。

## 建议回归测试

每次修改后至少检查：

1. Flaticon 搜索结果页正常加载，未 hover 的图标不会显示快捷操作列。
2. hover 图标后左侧显示同尺寸蓝色 HEX、Copy、Download 三个控件，右侧三个原生按钮仍全部存在；左右三行顶部和间距对齐。
3. 每次重新离开再 hover 同一图标，HEX 都恢复为空；同一次 hover 内移动到快捷按钮不会清空。
4. HEX 留空时 Copy PNG 与 Download PNG 都保持 Flaticon 默认颜色。
5. 输入 `2563EB` 或 `#2563EB` 后不会报错；输入框背景实时变为该颜色，文字在浅色背景用深色、深色背景用白色，并在执行操作时规范化为 `#2563EB`。
6. 输入非法 HEX 时不会继续执行 Copy / Download，并出现轻量错误提示。
7. 输入 HEX 后 Copy PNG 写入剪贴板的 PNG 使用目标颜色，透明背景保持不变。
8. 输入 HEX 后 Download PNG 下载的 PNG 使用目标颜色。
9. Copy PNG 点击一次即可触发原生 PNG 复制，不出现 SVG/PNG 二级菜单；成功后只看到脚本底部居中 `PNG 已复制` toast。
10. Download PNG 点击一次即可完成免费 PNG 下载，不显示 `Free download` 或 attribution confirmation 中间弹窗；成功后只看到同样式、同位置的 `PNG 已下载` toast。
11. 下载完成后不会残留遮罩或阻塞页面交互，原生 Download 仍可正常手动使用。
12. 动态滚动加载出新的图标后，新卡片也能获得快捷操作列。
13. 免费图标的署名责任不因脚本操作路径缩短而改变。

语法检查：

```bash
node --check userscripts/flaticon/flaticon-quick-download.user.js
```

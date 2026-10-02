# Flaticon 快捷下载助手

`flaticon-quick-download.user.js` 用于缩短 Flaticon 图标列表中的 PNG 操作路径。脚本只增强现有免费 PNG 复制/下载流程，不提供 SVG 权限、不绕过 Premium 权限，也不改变 Flaticon 的授权与署名要求。

## 当前功能

1. **图标左侧快捷操作列**
   - 当鼠标悬停到脚本已识别的 Flaticon 图标卡片时，在左上侧显示一列紧凑控件。
   - 第一项为 HEX 输入框；第二项为一键 Copy PNG；第三项为一键 Download PNG。
   - 三个快捷控件统一使用蓝色视觉，并在卡片左上侧以固定尺寸和固定间距均匀纵向排列；不再读取右侧原生按钮的几何位置，减少第三方布局变化带来的错位。
   - HEX 输入框与 Copy / Download 按钮统一为 42 × 42 px；Copy / Download 使用 CSS `background-image` 承载的 `data:image/svg+xml` 自绘线框图标，按钮 DOM 内不再插入 `<svg>` / `<path>` / `<rect>`，避免 Flaticon 全局 SVG/CSS 规则改变图标定位。
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
   - 快捷 Copy 触发时会临时启动短生命周期 MutationObserver，优先识别并隐藏左下角新增的原生 Copy/Clipboard toast，只保留脚本自己的底部居中提示 `PNG 已复制`；右侧原生 Copy 按钮仍保持 Flaticon 原生反馈。

4. **一键 Download PNG**
   - 直接触发 Flaticon 原生 PNG 下载流程，并自动继续当前免费 PNG 流程中的 `Free download`。
   - 自动流程开始前即进入隐藏模式；`Free download` 与下载后的 attribution confirmation 弹窗会在 MutationObserver 回调阶段隐藏并自动处理，避免中间弹窗干扰操作。
   - 下载完成后只显示与 Copy 相同位置、相同样式的脚本 toast，文案为 `PNG 已下载`。

5. **统一快捷操作反馈**
   - 左侧快捷 Copy / Download 都使用脚本自己的底部居中轻量 toast。
   - 脚本只在左侧快捷 Copy 的短暂操作窗口内监听新加入页面的提示节点，并结合 Copy/Clipboard 文案、toast 类名、左下角位置与绿色提示特征进行抑制；操作窗口结束即停止监听，不影响右侧原生按钮。

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
- 快捷操作列使用固定的左上偏移、42 × 42 px 控件尺寸和 8 px 纵向间距，不再依赖右侧原生按钮坐标；维护时优先保持这套简单布局，避免重新引入动态几何对齐。
- Copy / Download 图标必须继续作为按钮背景图维护，不要重新把 SVG DOM 节点插入按钮；2026-10-02 实测 Flaticon 全局样式会把按钮内部 SVG 从按钮中心偏移到左上方。

## 建议回归测试

每次修改后至少检查：

1. Flaticon 搜索结果页正常加载，未 hover 的图标不会显示快捷操作列。
2. hover 图标后左侧显示同尺寸蓝色 HEX、Copy、Download 三个控件，三项以固定间距均匀纵向排列；Copy / Download 白色线框图标完整显示在按钮正中央；右侧三个原生按钮仍全部存在。
3. 每次重新离开再 hover 同一图标，HEX 都恢复为空；同一次 hover 内移动到快捷按钮不会清空。
4. HEX 留空时 Copy PNG 与 Download PNG 都保持 Flaticon 默认颜色。
5. 输入 `2563EB` 或 `#2563EB` 后不会报错；输入框背景实时变为该颜色，文字在浅色背景用深色、深色背景用白色，并在执行操作时规范化为 `#2563EB`。
6. 输入非法 HEX 时不会继续执行 Copy / Download，并出现轻量错误提示。
7. 输入 HEX 后 Copy PNG 写入剪贴板的 PNG 使用目标颜色，透明背景保持不变。
8. 输入 HEX 后 Download PNG 下载的 PNG 使用目标颜色。
9. Copy PNG 点击一次即可触发原生 PNG 复制，不出现 SVG/PNG 二级菜单；成功后只看到脚本底部居中 `PNG 已复制` toast，不再同时出现左下角原生提示。
10. Download PNG 点击一次即可完成免费 PNG 下载，不显示 `Free download` 或 attribution confirmation 中间弹窗；成功后只看到同样式、同位置的 `PNG 已下载` toast。
11. 下载完成后不会残留遮罩或阻塞页面交互，原生 Download 仍可正常手动使用。
12. 动态滚动加载出新的图标后，新卡片也能获得快捷操作列。
13. 免费图标的署名责任不因脚本操作路径缩短而改变。

语法检查：

```bash
node --check userscripts/flaticon/flaticon-quick-download.user.js
```

## v0.1.3 维护记录

- 修正快捷操作列误把原生 Copy 按钮当作第一行锚点的问题；改为识别右侧同列的三个原生按钮，从第一行开始逐行对齐。
- Copy / Download 图标改为脚本内嵌 SVG 路径，避免 CSS 拼接图形在不同缩放和浏览器下出现形状异常。
- 快捷 Copy 增加短生命周期原生 toast 观察器，只在快捷 Copy 窗口内抑制左下角站点提示，保留脚本统一 toast；原生右侧按钮不受影响。

## v0.1.4 维护记录

- 移除与右侧原生按钮逐项读取 `getBoundingClientRect()` 的动态对齐逻辑，左侧三项改为固定尺寸、固定间距的独立竖向布局，减少 hover DOM 变化造成的错位。
- 左侧 HEX / Copy / Download 统一为 42 × 42 px，纵向间距固定为 8 px。
- Copy / Download 继续使用内嵌自绘 SVG，但给 SVG 和各图形元素直接写入显示、尺寸、白色描边、线宽、端点和连接样式，降低 Flaticon 全局 SVG 样式导致图标不可见的风险。

## v0.1.5 维护记录

- 根据 Console 实测确认，按钮内部 SVG 虽然尺寸、可见性和描边均正常，但其实际坐标会被 Flaticon 全局样式向左上方偏移，导致蓝色按钮看似没有图标、图标却出现在按钮外。
- 删除 Copy / Download 按钮内部的 `<svg>` DOM 及相关防覆盖样式，改为 CSS `background-image` 的 `data:image/svg+xml` 自绘图标，从根源上隔离 Flaticon 对 `svg` / `path` / `rect` 的全局规则。
- 保留左侧独立 `flex` 竖列、42 × 42 px 固定尺寸和 8 px 固定间距，不恢复任何右侧按钮坐标读取或动态对齐逻辑。

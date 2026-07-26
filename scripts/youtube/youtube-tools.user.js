// ==UserScript==
// @name         YouTube Tools (byD)
// @namespace    https://github.com/hoppingd/youtubequickchannelplaylist
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/youtube/youtube-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/scripts/youtube/youtube-tools.user.js
// @version      1.6.3
// @description  Open a channel upload playlist, convert playlist upload dates, and export playlist CSV.
// @author       OpenAI (merged from hoppingd/youtubequickchannelplaylist and uploaded playlist tools)
// @license      Unlicense
// @match        https://www.youtube.com/*
// @match        http://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-idle
// ==/UserScript==


/*
【脚本说明 / 维护速读】

一、脚本用途
这是一个 YouTube 工具集合脚本，当前包含 3 个核心能力：
1. 打开当前频道对应的上传播放列表
2. 在 YouTube 播放列表页面把“相对上传时间”转换为“绝对日期（YYYY-MM-DD）”
3. 在 YouTube 播放列表页面自动加载全部视频并导出 CSV

本脚本的目标不是做“全站通用增强”，而是把这 3 个功能稳定地合并到同一个油猴脚本里，并保持菜单、提示、默认行为一致。

--------------------------------------------------

二、功能模块
本脚本大致分为 4 个模块：

1. Channel playlist 模块
- 负责识别当前页面所属频道
- 负责生成频道上传播放列表 URL
- 负责菜单项 “YouTube Channel playlist”
- 负责快捷键打开频道播放列表

2. Playlist dates 模块
- 只在 YouTube playlist 页面工作
- 自动扫描视频卡片中的相对日期
- 使用队列 + 并发 + 重试 + 缓存 把相对日期替换成绝对日期
- 负责菜单项 “[ON]/[OFF] Show absolute upload dates”
- 该模块的实现应尽量保持稳定版本逻辑，不要随意简化

3. Export CSV 模块
- 只在 YouTube playlist 页面工作
- 自动加载全部视频（load all）
- 解析页面中的视频信息并导出 CSV
- 负责菜单项 “Export CSV: YouTube Playlist”

4. Notification / Popup 模块
- 统一管理右上角提示
- 支持多个提示并发显示
- 采用“右上角、向下堆叠、最新消息在最上面”的设计
- 同时服务于日期转换、CSV 导出、菜单开关提示

--------------------------------------------------

三、菜单项与默认值
当前菜单结构与默认行为如下：

1. YouTube Channel playlist
- 动作项
- 点击后直接打开当前频道的上传播放列表

2. Export CSV: YouTube Playlist
- 动作项
- 仅在 playlist 页面有实际用途
- 点击后执行 load all + parse + export

3. [ON]/[OFF] Include Shorts and livestreams
- 开关项
- 默认 OFF
- OFF 时打开普通视频上传列表
- ON 时包含 Shorts / livestreams

4. [ON]/[OFF] Show absolute upload dates
- 开关项
- 默认 ON
- 仅控制 playlist 页面里的日期转换功能

注意：
- 不要随意改动菜单顺序
- 不要随意改动默认状态
- 菜单文案可能被其他工作流依赖

--------------------------------------------------

四、页面适用范围
1. Channel playlist 模块
- 用于视频页、频道页、handle 页、legacy custom path 页等
- 目标是识别频道 ID 并跳转到对应 playlist

2. Playlist dates 模块
- 只在 URL 形如 /playlist?list=... 的页面运行
- 不负责首页、搜索页、频道页等其它页面

3. Export CSV 模块
- 只在 /playlist?list=... 页面运行
- 不应扩展到非播放列表页面

--------------------------------------------------

五、核心实现思路
1. Channel playlist
- 从当前页面中推断频道 ID
- 再按固定规则构造频道上传播放列表地址
- Include Shorts and livestreams 决定生成哪一种 playlist list 参数

2. Playlist dates
- 扫描播放列表中每个视频卡片
- 找到包含“相对日期”的节点
- 提取视频 ID
- 请求 YouTube 接口获取上传日期
- 格式化为 YYYY-MM-DD
- 写回页面 DOM
- 使用缓存避免重复请求
- 使用并发队列、重试和延迟避免请求过猛

3. Export CSV
- 先滚动 / 触发 continuation，尽量把整个播放列表加载完整
- 然后从每个视频卡片中提取：
 name / duration / upload_time / channel / views / url / thumbnail_url
- 最后拼装 CSV 并触发下载

--------------------------------------------------

六、状态存储
本脚本通过 GM_getValue / GM_setValue 保存部分状态。

当前主要包括：
1. shortsToggle
- 控制 Include Shorts and livestreams
- 默认 false

2. absoluteDatesToggle
- 控制 Show absolute upload dates
- 默认 true

维护时注意：
- 修改默认值会改变用户初始体验
- 修改 key 名会导致旧用户设置失效

--------------------------------------------------

七、右上角提示系统
本脚本使用统一通知管理器，而不是各功能模块各自创建弹窗。

设计原则：
1. 所有提示共用一个右上角容器
2. 多个提示可以同时存在
3. 新消息插在最上面
4. 短提示（例如开关切换）与持续状态卡片（例如日期转换 / CSV 导出）共存
5. 不要再新增独立的 popup 容器，避免弹窗互相覆盖

当前提示类型分为两类：
1. 短提示 toast
- 用于开关状态切换
- 自动消失

2. 状态卡片 status card
- 用于日期转换过程
- 用于 CSV 导出过程
- 会动态更新内容
- 流程结束后再消失

--------------------------------------------------

八、日期转换模块的特殊约束
这是整个脚本里最容易被“优化坏”的部分，必须特别注意。

1. 当前日期模块来源
- 基于一个已经验证可正常工作的 playlist 专用版本整合而来
- 包含扫描、队列、并发、重试、缓存、状态提示等逻辑

2. 不要做的事
- 不要把日期模块“简化成只靠几条 selector + 一次遍历”
- 不要删除队列 / 并发 / 重试 / 缓存
- 不要把 playlist 专用逻辑改成全站通用逻辑
- 不要随意改日期节点识别方式，除非你已经验证不会漏视频

3. 开关行为
- Show absolute upload dates = ON：自动扫描并转换
- Show absolute upload dates = OFF：恢复原始相对日期（如果原始值仍可恢复）

--------------------------------------------------

九、CSV 导出字段规则
CSV 字段当前为：
- name
- duration
- upload_time
- channel
- views
- url
- thumbnail_url

其中 upload_time 有明确优先级，必须遵守：
1. 优先读取日期模块写入的绝对日期值（例如 data-ytpd-value）
2. 其次读取页面中已经显示出来的 YYYY-MM-DD
3. 最后才回退到原始相对日期

注意：
- 这里曾经出现过 bug：页面已经显示绝对日期，但 CSV 仍导出“7周前”
- 因此不要再把 upload_time 简单写成“直接读原始文本”
- 也不要无条件恢复为相对日期后再导出

--------------------------------------------------

十、不要随意改动的部分
以下内容如果没有充分测试，不要修改：

1. 菜单顺序
2. 菜单默认开关值
3. 右上角提示系统的统一容器设计
4. 日期转换模块的扫描 / 队列 / 重试 / 缓存逻辑
5. upload_time 的三层优先级读取规则
6. playlist 页面专用的判断逻辑
7. CSV 导出的字段顺序

--------------------------------------------------

十一、已知限制 / 边界
1. CSV 下载
- 脚本只能确认“已触发下载”
- 不能严格确认“文件已保存到磁盘完成”

2. Load all 判断
- 依赖前端滚动、continuation 是否消失、条目数量是否继续增长
- 属于启发式判断，不是 YouTube 官方完成事件

3. 日期转换
- 依赖当前 YouTube 播放列表页面的 DOM 结构
- 如果 YouTube 改版，可能需要重新适配

4. 页面范围
- 日期转换和 CSV 导出只针对 playlist 页面
- 不应默认扩展到首页 / 搜索 / 频道页

--------------------------------------------------

十二、初始化顺序
脚本大致按以下顺序启动：

1. 注册菜单项
2. 注册快捷键
3. 初始化日期转换模块
4. 等用户点击菜单时再触发 CSV 导出
5. Channel playlist 功能按菜单或快捷键触发

--------------------------------------------------

十三、维护建议
如果后续要让其他 AI 修改这个脚本，建议先说明以下几点：
1. 不能破坏现有菜单结构
2. 不能改默认开关状态
3. 不能简化日期模块核心逻辑
4. 不能让多个弹窗重新变成互相覆盖
5. upload_time 导出必须保持“绝对日期优先”

如果要新增功能，优先新增独立模块，并接入统一通知系统，而不是直接改坏已有逻辑。
*/

(function () {
 'use strict';

 const SCRIPT_NAME = 'YouTube Tools (byD)';
 const SHORTS_STORE_KEY = 'shortsToggle';
 const ABSOLUTE_DATES_STORE_KEY = 'absoluteDatesToggle';
 const SHORTCUT_EVENT_GUARD_MS = 600;
 const ORIGINAL_DATE_ATTR = 'data-ytd-original-date';

 const NotificationManager = (() => {
   const CONTAINER_ID = 'ytd-tools-notification-container';

   function getContainer() {
     let container = document.getElementById(CONTAINER_ID);
     if (!container) {
       container = document.createElement('div');
       container.id = CONTAINER_ID;
       container.style.position = 'fixed';
       container.style.top = '16px';
       container.style.right = '16px';
       container.style.zIndex = '2147483647';
       container.style.display = 'flex';
       container.style.flexDirection = 'column';
       container.style.alignItems = 'flex-end';
       container.style.gap = '8px';
       container.style.pointerEvents = 'none';
       (document.documentElement || document.body).appendChild(container);
     }
     return container;
   }

   function createBaseCard() {
     const card = document.createElement('div');
     card.style.minWidth = '280px';
     card.style.maxWidth = '420px';
     card.style.padding = '12px 14px';
     card.style.borderRadius = '12px';
     card.style.background = 'rgba(15, 15, 15, 0.92)';
     card.style.color = '#fff';
     card.style.font = '12px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
     card.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.35)';
     card.style.border = '1px solid rgba(255, 255, 255, 0.14)';
     card.style.opacity = '0';
     card.style.transform = 'translateY(-6px)';
     card.style.transition = 'opacity 180ms ease, transform 180ms ease';
     card.style.pointerEvents = 'none';
     return card;
   }

   function animateIn(card) {
     requestAnimationFrame(() => {
       card.style.opacity = '1';
       card.style.transform = 'translateY(0)';
     });
   }

   function removeCard(card, delay = 220) {
     if (!card || !card.isConnected) return;
     card.style.opacity = '0';
     card.style.transform = 'translateY(-6px)';
     setTimeout(() => {
       if (card.isConnected) {
         card.remove();
       }
       const container = document.getElementById(CONTAINER_ID);
       if (container && !container.childNodes.length && container.parentNode) {
         container.parentNode.removeChild(container);
       }
     }, delay);
   }

   function createStatusCard(id, titleText) {
     const card = createBaseCard();
     card.id = id;

     const title = document.createElement('div');
     title.style.fontSize = '13px';
     title.style.fontWeight = '600';
     title.style.marginBottom = '6px';
     title.dataset.role = 'title';
     title.textContent = titleText || '';

     const status = document.createElement('div');
     status.style.opacity = '0.92';
     status.dataset.role = 'status';
     status.textContent = '';

     const meta = document.createElement('div');
     meta.style.opacity = '0.72';
     meta.style.marginTop = '5px';
     meta.dataset.role = 'meta';
     meta.textContent = '';

     card.appendChild(title);
     card.appendChild(status);
     card.appendChild(meta);
     return card;
   }

   function ensureStatusCard(id, titleText) {
     const container = getContainer();
     let card = document.getElementById(id);

     if (!card) {
       card = createStatusCard(id, titleText);
       if (container.firstChild) {
         container.insertBefore(card, container.firstChild);
       } else {
         container.appendChild(card);
       }
       animateIn(card);
     }

     const title = card.querySelector('[data-role="title"]');
     const status = card.querySelector('[data-role="status"]');
     const meta = card.querySelector('[data-role="meta"]');

     if (title && typeof titleText === 'string') {
       title.textContent = titleText;
     }

     return { card, title, status, meta };
   }

   function updateStatusCard(id, payload) {
     const nodes = ensureStatusCard(id, payload.title || '');
     if (typeof payload.status === 'string' && nodes.status) {
       nodes.status.textContent = payload.status;
     }
     if (typeof payload.meta === 'string' && nodes.meta) {
       nodes.meta.textContent = payload.meta;
     }
     return nodes;
   }

   function hideStatusCard(id, duration = 2200) {
     const card = document.getElementById(id);
     if (!card) return;
     setTimeout(() => removeCard(card), duration);
   }

   function removeStatusCardNow(id) {
     const card = document.getElementById(id);
     if (!card) return;
     removeCard(card, 180);
   }

   function showToast(message, duration = 2600, titleText = '') {
     const container = getContainer();
     const card = createBaseCard();

     if (titleText) {
       const title = document.createElement('div');
       title.style.fontSize = '13px';
       title.style.fontWeight = '600';
       title.style.marginBottom = '6px';
       title.textContent = titleText;
       card.appendChild(title);
     }

     const body = document.createElement('div');
     body.textContent = message;
     body.style.opacity = '0.92';
     card.appendChild(body);

     if (container.firstChild) {
       container.insertBefore(card, container.firstChild);
     } else {
       container.appendChild(card);
     }
     animateIn(card);

     setTimeout(() => {
       removeCard(card);
     }, duration);
   }

   return {
     updateStatusCard,
     hideStatusCard,
     removeStatusCardNow,
     showToast
   };
 })();

 let openMenuCommandId = null;
 let exportMenuCommandId = null;
 let includeMenuCommandId = null;
 let absoluteDatesMenuCommandId = null;
 let lastShortcutAt = 0;
 let exportIsRunning = false;

 function getIncludeShorts() {
   return Boolean(GM_getValue(SHORTS_STORE_KEY, false));
 }

 function setIncludeShorts(value) {
   GM_setValue(SHORTS_STORE_KEY, Boolean(value));
 }

 function getAbsoluteDatesEnabled() {
   return Boolean(GM_getValue(ABSOLUTE_DATES_STORE_KEY, true));
 }

 function setAbsoluteDatesEnabled(value) {
   GM_setValue(ABSOLUTE_DATES_STORE_KEY, Boolean(value));
 }

 function unregisterMenuIfNeeded(commandId) {
   if (!commandId) return;
   try {
     GM_unregisterMenuCommand(commandId);
   } catch (_) {}
 }

 function registerMenu() {
   unregisterMenuIfNeeded(openMenuCommandId);
   unregisterMenuIfNeeded(exportMenuCommandId);
   unregisterMenuIfNeeded(includeMenuCommandId);
   unregisterMenuIfNeeded(absoluteDatesMenuCommandId);

   openMenuCommandId = GM_registerMenuCommand(
     'YouTube Channel playlist',
     () => openChannelPlaylist()
   );

   exportMenuCommandId = GM_registerMenuCommand(
     'Export CSV: YouTube Playlist',
     () => runExportWorkflow()
   );

   includeMenuCommandId = GM_registerMenuCommand(
     `${getIncludeShorts() ? '[ON]' : '[OFF]'} Include Shorts and livestreams`,
     () => {
       const next = !getIncludeShorts();
       setIncludeShorts(next);
       registerMenu();
       NotificationManager.showToast(
         next ? 'Shorts and livestreams enabled.' : 'Shorts and livestreams disabled.',
         2400,
         'YouTube Channel playlist'
       );
     }
   );

   absoluteDatesMenuCommandId = GM_registerMenuCommand(
     `${getAbsoluteDatesEnabled() ? '[ON]' : '[OFF]'} Show absolute upload dates`,
     () => {
       const next = !getAbsoluteDatesEnabled();
       setAbsoluteDatesEnabled(next);
       registerMenu();
       if (next) {
         PlaylistDatesModule.enable();
         NotificationManager.showToast('Absolute upload dates enabled.', 2400, 'YouTube 日期转换');
       } else {
         PlaylistDatesModule.disable();
         NotificationManager.showToast('Absolute upload dates disabled.', 2400, 'YouTube 日期转换');
       }
     }
   );
 }

 function isYouTubeWatchPage(url = location.href) {
   return /[?&]v=([a-zA-Z0-9_-]{6,})/.test(url);
 }

 function getVideoIdFromUrl(url = location.href) {
   const match = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
   return match ? match[1] : null;
 }

 function getHandleFromUrl(url = location.href) {
   const match = url.match(/youtube\.com\/@([a-zA-Z0-9._-]+)/i);
   return match ? match[1] : null;
 }

 function getDirectChannelIdFromUrl(url = location.href) {
   const match = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/i);
   return match ? match[1] : null;
 }

 function getLegacyCustomPathFromUrl(url = location.href) {
   const match = url.match(/youtube\.com\/c\/([a-zA-Z0-9._-]+)/i);
   return match ? match[1] : null;
 }

 function normalizeChannelId(value) {
   return typeof value === 'string' && /^UC[a-zA-Z0-9_-]+$/.test(value) ? value : null;
 }

 function buildPlaylistUrl(channelId) {
   const playlistType = getIncludeShorts() ? 'UU' : 'UULF';
   return `https://www.youtube.com/playlist?list=${playlistType}${channelId.slice(2)}`;
 }

 function extractYtcfgValue(key) {
   try {
     const ytcfg = window.ytcfg;
     if (ytcfg && typeof ytcfg.get === 'function') {
       return ytcfg.get(key);
     }
   } catch (_) {}
   return null;
 }

 function collectCandidateChannelIds() {
   const candidates = new Set();

   const directUrlChannelId = getDirectChannelIdFromUrl();
   if (directUrlChannelId) candidates.add(directUrlChannelId);

   const configChannelId = normalizeChannelId(extractYtcfgValue('CHANNEL_ID'));
   if (configChannelId) candidates.add(configChannelId);

   const externalIdMeta = normalizeChannelId(document.querySelector('meta[itemprop="channelId"]')?.content || '');
   if (externalIdMeta) candidates.add(externalIdMeta);

   const canonicalHref = document.querySelector('link[rel="canonical"]')?.href || '';
   const canonicalChannelId = normalizeChannelId((canonicalHref.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/i) || [])[1]);
   if (canonicalChannelId) candidates.add(canonicalChannelId);

   const ownerLinks = Array.from(document.querySelectorAll('a[href*="/channel/UC"]'));
   for (const link of ownerLinks) {
     const match = link.href.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/i);
     const id = normalizeChannelId(match?.[1]);
     if (id) candidates.add(id);
   }

   const html = document.documentElement?.innerHTML || '';
   const htmlMatches = html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/g) || [];
   for (const item of htmlMatches.slice(0, 20)) {
     const id = normalizeChannelId((item.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/) || [])[1]);
     if (id) candidates.add(id);
   }

   return [...candidates].filter(Boolean);
 }

 async function fetchText(url) {
   const response = await fetch(url, {
     credentials: 'same-origin',
     cache: 'no-store'
   });
   if (!response.ok) {
     throw new Error(`Fetch failed: ${response.status}`);
   }
   return response.text();
 }

 async function resolveChannelIdFromHandle(handle) {
   if (!handle) return null;
   const html = await fetchText(`https://www.youtube.com/@${encodeURIComponent(handle)}`);
   const match = html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/);
   return normalizeChannelId(match?.[1]);
 }

 async function resolveChannelIdFromLegacyCustomPath(customPath) {
   if (!customPath) return null;
   const html = await fetchText(`https://www.youtube.com/c/${encodeURIComponent(customPath)}`);
   const match = html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/);
   return normalizeChannelId(match?.[1]);
 }

 async function resolveChannelIdFromWatchPage(videoId) {
   if (!videoId) return null;

   const watchCandidates = collectCandidateChannelIds();
   if (watchCandidates.length) return watchCandidates[0];

   const html = await fetchText(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
   const match = html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/);
   return normalizeChannelId(match?.[1]);
 }

 async function getChannelId() {
   const direct = getDirectChannelIdFromUrl();
   if (direct) return direct;

   const pageCandidates = collectCandidateChannelIds();
   if (!isYouTubeWatchPage() && pageCandidates.length) {
     return pageCandidates[0];
   }

   const handle = getHandleFromUrl();
   if (handle) {
     const fromHandle = await resolveChannelIdFromHandle(handle);
     if (fromHandle) return fromHandle;
   }

   const legacyCustomPath = getLegacyCustomPathFromUrl();
   if (legacyCustomPath) {
     const fromLegacy = await resolveChannelIdFromLegacyCustomPath(legacyCustomPath);
     if (fromLegacy) return fromLegacy;
   }

   const videoId = getVideoIdFromUrl();
   if (videoId) {
     const fromWatch = await resolveChannelIdFromWatchPage(videoId);
     if (fromWatch) return fromWatch;
   }

   const fallbackCandidates = collectCandidateChannelIds();
   if (fallbackCandidates.length) return fallbackCandidates[0];

   throw new Error('Channel ID not found on this page.');
 }

 async function openChannelPlaylist() {
   try {
     const channelId = await getChannelId();
     if (!channelId) {
       throw new Error('Channel ID not found.');
     }
     const playlistUrl = buildPlaylistUrl(channelId);
     location.href = playlistUrl;
   } catch (error) {
     console.error(`[${SCRIPT_NAME}] Error:`, error);
     alert(`${SCRIPT_NAME}\n\n${error.message || error}`);
   }
 }

 function installShortcuts() {
   window.addEventListener('keydown', event => {
     if (!(event.altKey && event.shiftKey)) return;
     if (event.repeat) return;

     const now = Date.now();
     if (now - lastShortcutAt < SHORTCUT_EVENT_GUARD_MS) return;

     const tag = document.activeElement?.tagName?.toLowerCase();
     const isTyping = ['input', 'textarea'].includes(tag) || document.activeElement?.isContentEditable;
     if (isTyping) return;

     if (event.code === 'KeyP') {
       lastShortcutAt = now;
       event.preventDefault();
       openChannelPlaylist();
     } else if (event.code === 'KeyS') {
       lastShortcutAt = now;
       event.preventDefault();
       const next = !getIncludeShorts();
       setIncludeShorts(next);
       registerMenu();
       NotificationManager.showToast(
         next ? 'Shorts and livestreams enabled.' : 'Shorts and livestreams disabled.',
         2400,
         'YouTube Channel playlist'
       );
     }
   }, true);
 }

 const PlaylistDatesModule = (() => {
   const CONFIG = {
     cardSelector: 'ytd-playlist-video-renderer',
     infoSelector: '#video-info',
     titleLinkSelector: 'a#video-title, a#thumbnail',
     concurrency: 8,
     maxRetries: 2,
     requestDelayMs: 200,
     retryBaseDelayMs: 700,
     popupAutoHideMs: 2200,
     scanDebounceMs: 400,
     startupDelays: [200, 900, 1800],
     cachePrefix: 'ytPlaylistAbsDate:v3:',
     popupCardId: 'ytd-tools-playlist-dates-status'
   };

   const state = {
     initialized: false,
     observer: null,
     queue: [],
     running: 0,
     queuedIds: new Set(),
     pendingById: new Map(),
     popupTimer: null,
     scanTimer: null,
     stats: {
       scanned: 0,
       totalCandidates: 0,
       done: 0,
       failed: 0,
       cacheHit: 0,
       phase: 'idle',
       lastMessage: ''
     }
   };

   function isPlaylistPage() {
     try {
       const url = new URL(window.location.href);
       return url.hostname === 'www.youtube.com' && url.pathname === '/playlist' && !!url.searchParams.get('list');
     } catch (error) {
       return /youtube\.com\/playlist$1list=/.test(String(window.location.href || ''));
     }
   }

   function isEnabled() {
     return getAbsoluteDatesEnabled();
   }

   function shouldRun() {
     return isEnabled() && isPlaylistPage();
   }

   function sleep(ms) {
     return new Promise(function (resolve) {
       setTimeout(resolve, ms);
     });
   }

   function getClientVersion() {
     try {
       if (window.ytcfg && typeof window.ytcfg.get === 'function') {
         const value = window.ytcfg.get('INNERTUBE_CLIENT_VERSION') || window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION');
         if (value && typeof value === 'string') {
           return value;
         }
       }
     } catch (error) {}
     return '2.20240416.01.00';
   }

   function ensurePopupNodes() {
     return NotificationManager.updateStatusCard(CONFIG.popupCardId, {
       title: 'YouTube 日期转换',
       status: '准备中...',
       meta: '等待页面内容...'
     });
   }

   function hidePopupSoon() {
     clearTimeout(state.popupTimer);
     state.popupTimer = setTimeout(function () {
       NotificationManager.removeStatusCardNow(CONFIG.popupCardId);
     }, CONFIG.popupAutoHideMs);
   }

   function updatePopup(statusText, metaText, keepVisible) {
     const popup = ensurePopupNodes();
     if (!popup) return;
     if (popup.status) popup.status.textContent = statusText || '';
     if (popup.meta) popup.meta.textContent = metaText || '';
     clearTimeout(state.popupTimer);
     if (!keepVisible) {
       hidePopupSoon();
     }
   }

   function renderStatus() {
     if (!shouldRun()) {
       return;
     }
     const stats = state.stats;
     let line1 = stats.lastMessage || '准备中...';
     let line2 = '';

     if (stats.phase === 'scanning') {
       line1 = stats.lastMessage || '扫描视频中...';
       line2 = '已扫 ' + stats.scanned + ' 项 | 命中 ' + stats.totalCandidates + ' 项 | 缓存 ' + stats.cacheHit + ' 项';
       updatePopup(line1, line2, true);
       return;
     }

     if (stats.phase === 'processing') {
       line1 = stats.lastMessage || '正在转换日期...';
       line2 = '完成 ' + stats.done + ' | 处理中 ' + state.running + ' | 排队 ' + state.queue.length + ' | 失败 ' + stats.failed;
       updatePopup(line1, line2, true);
       return;
     }

     if (stats.phase === 'done') {
       line1 = stats.lastMessage || '转换完成';
       line2 = '完成 ' + stats.done + ' | 缓存 ' + stats.cacheHit + ' | 失败 ' + stats.failed;
       updatePopup(line1, line2, false);
       return;
     }

     if (stats.phase === 'error') {
       line1 = stats.lastMessage || '执行时出现错误';
       line2 = '完成 ' + stats.done + ' | 失败 ' + stats.failed;
       updatePopup(line1, line2, false);
       return;
     }

     line2 = '进入播放列表页面后会自动开始';
     updatePopup(line1, line2, true);
   }

   function setPhase(phase, message) {
     state.stats.phase = phase;
     if (message) {
       state.stats.lastMessage = message;
     }
     try {
       renderStatus();
     } catch (error) {
       console.error('[YT Playlist Dates] renderStatus error:', error);
     }
   }

   function getCacheKey(videoId) {
     return CONFIG.cachePrefix + videoId;
   }

   function getCachedDate(videoId) {
     try {
       const value = localStorage.getItem(getCacheKey(videoId));
       return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
     } catch (error) {
       return null;
     }
   }

   function setCachedDate(videoId, dateStr) {
     if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
       return;
     }
     try {
       localStorage.setItem(getCacheKey(videoId), dateStr);
     } catch (error) {}
   }

   function extractVideoId(url) {
     if (!url) return null;
     try {
       const full = new URL(url, location.origin);
       if (full.pathname === '/watch') {
         return full.searchParams.get('v');
       }
       const shortsMatch = full.pathname.match(/\/shorts\/([^/?&#]+)/);
       if (shortsMatch) {
         return shortsMatch[1];
       }
     } catch (error) {
       const watch = String(url).match(/[?&]v=([^&]+)/);
       if (watch) return watch[1];
       const shorts = String(url).match(/\/shorts\/([^/?&#]+)/);
       if (shorts) return shorts[1];
     }
     return null;
   }

   function isRelativeDateText(text) {
     if (!text) return false;
     const value = text.replace(/\u200b/g, '').trim();
     if (!value) return false;
     if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
     return /ago/i.test(value)
       || /前$/.test(value)
       || /刚刚$/.test(value)
       || /秒钟?前$/.test(value)
       || /分鐘?前$/.test(value)
       || /分鐘前$/.test(value)
       || /分钟前$/.test(value)
       || /小时前$/.test(value)
       || /天前$/.test(value)
       || /周前$/.test(value)
       || /週前$/.test(value)
       || /个月前$/.test(value)
       || /個月前$/.test(value)
       || /年前$/.test(value);
   }

   function findDateNode(card) {
     const info = card.querySelector(CONFIG.infoSelector);
     if (!info) {
       return null;
     }

     const spans = Array.from(info.querySelectorAll('span, yt-formatted-string'));
     for (let i = spans.length - 1; i >= 0; i -= 1) {
       if (isRelativeDateText(spans[i].textContent || '')) {
         return spans[i];
       }
     }

     const walker = document.createTreeWalker(info, NodeFilter.SHOW_TEXT, {
       acceptNode: function (node) {
         return isRelativeDateText(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
       }
     });
     const textNode = walker.nextNode();
     return textNode ? textNode.parentElement : null;
   }

   function applyDateToNode(node, dateStr) {
     if (!node || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
       return false;
     }

     if (!node.getAttribute(ORIGINAL_DATE_ATTR)) {
       const originalText = (node.textContent || '').replace(/\u200b/g, '').trim();
       if (originalText) {
         node.setAttribute(ORIGINAL_DATE_ATTR, originalText);
       }
     }

     node.textContent = dateStr;
     if (node.dataset) {
       node.dataset.ytpdApplied = '1';
       node.dataset.ytpdValue = dateStr;
     }
     return true;
   }

   function restoreOriginalDates() {
     const nodes = document.querySelectorAll('[' + ORIGINAL_DATE_ATTR + ']');
     nodes.forEach(function (node) {
       const originalText = node.getAttribute(ORIGINAL_DATE_ATTR);
       if (!originalText) return;
       node.textContent = originalText;
       if (node.dataset) {
         delete node.dataset.ytpdApplied;
         delete node.dataset.ytpdValue;
       }
     });
   }

   function collectCardInfo(card) {
     if (!card || !(card instanceof Element)) return null;
     const link = card.querySelector(CONFIG.titleLinkSelector);
     if (!link) return null;
     const href = link.getAttribute('href') || '';
     const videoId = extractVideoId(href);
     if (!videoId) return null;
     const dateNode = findDateNode(card);
     if (!dateNode) return null;
     return { card, link, videoId, dateNode };
   }

   function queueItem(item) {
     if (!item || !item.videoId || !item.dateNode) return;

     const cached = getCachedDate(item.videoId);
     if (cached) {
       if (applyDateToNode(item.dateNode, cached)) {
         state.stats.cacheHit += 1;
         state.stats.done += 1;
       }
       return;
     }

     if (state.queuedIds.has(item.videoId)) {
       const pending = state.pendingById.get(item.videoId);
       if (pending && pending.dateNode !== item.dateNode) {
         pending.extraNodes = pending.extraNodes || [];
         pending.extraNodes.push(item.dateNode);
       }
       return;
     }

     state.queuedIds.add(item.videoId);
     item.retries = 0;
     item.extraNodes = [];
     state.pendingById.set(item.videoId, item);
     state.queue.push(item);
   }

   function scheduleScan(delay) {
     clearTimeout(state.scanTimer);
     state.scanTimer = setTimeout(function () {
       try {
         scanPage();
       } catch (error) {
         console.error('[YT Playlist Dates] scanPage error:', error);
         state.stats.failed += 1;
         setPhase('error', '扫描时出现错误');
       }
     }, typeof delay === 'number' ? delay : CONFIG.scanDebounceMs);
   }

   function scanPage() {
     if (!shouldRun()) {
       return;
     }

     setPhase('scanning', '扫描视频中...');

     const cards = Array.from(document.querySelectorAll(CONFIG.cardSelector));
     state.stats.scanned = cards.length;
     state.stats.totalCandidates = 0;

     cards.forEach(function (card) {
       const info = collectCardInfo(card);
       if (!info) {
         return;
       }
       state.stats.totalCandidates += 1;
       const alreadyApplied = info.dateNode.dataset
         && info.dateNode.dataset.ytpdApplied === '1'
         && /^\d{4}-\d{2}-\d{2}$/.test((info.dateNode.textContent || '').trim());
       if (alreadyApplied) {
         return;
       }
       queueItem(info);
     });

     if (state.queue.length > 0 || state.running > 0) {
       setPhase('processing', '正在转换日期...');
       pumpQueue();
     } else {
       setPhase('done', '没有新的视频需要处理');
     }
   }

   function formatDateYYYYMMDD(value) {
     if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
       return value;
     }
     const dt = new Date(value);
     if (Number.isNaN(dt.getTime())) {
       return '';
     }
     const yyyy = String(dt.getFullYear());
     const mm = String(dt.getMonth() + 1).padStart(2, '0');
     const dd = String(dt.getDate()).padStart(2, '0');
     return yyyy + '-' + mm + '-' + dd;
   }

   async function fetchUploadDate(videoId) {
     const clientVersion = getClientVersion();
     const body = {
       context: {
         client: {
           clientName: 'WEB',
           clientVersion: clientVersion
         }
       },
       videoId: videoId
     };

     const response = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
       method: 'POST',
       credentials: 'same-origin',
       headers: {
         'Content-Type': 'application/json'
       },
       body: JSON.stringify(body)
     });

     if (!response.ok) {
       throw new Error('HTTP ' + response.status);
     }

     const data = await response.json();
     const object = data && data.microformat && data.microformat.playerMicroformatRenderer;
     if (!object) {
       throw new Error('playerMicroformatRenderer not found');
     }

     if (object.liveBroadcastDetails && object.liveBroadcastDetails.isLiveNow && object.liveBroadcastDetails.startTimestamp) {
       return object.liveBroadcastDetails.startTimestamp;
     }
     if (object.publishDate) {
       return object.publishDate;
     }
     if (object.uploadDate) {
       return object.uploadDate;
     }
     throw new Error('No publishDate/uploadDate');
   }

   async function processItem(item) {
     try {
       const uploadDate = await fetchUploadDate(item.videoId);
       const formatted = formatDateYYYYMMDD(uploadDate);
       if (!formatted) {
         throw new Error('Invalid date');
       }

       if (shouldRun()) {
         applyDateToNode(item.dateNode, formatted);
         if (Array.isArray(item.extraNodes)) {
           item.extraNodes.forEach(function (node) {
             applyDateToNode(node, formatted);
           });
         }
       }
       setCachedDate(item.videoId, formatted);

       state.stats.done += 1;
       state.pendingById.delete(item.videoId);
       state.queuedIds.delete(item.videoId);
     } catch (error) {
       if (item.retries < CONFIG.maxRetries) {
         item.retries += 1;
         await sleep(CONFIG.retryBaseDelayMs * item.retries);
         state.queue.push(item);
         return;
       }
       console.error('[YT Playlist Dates] processItem error:', item.videoId, error);
       state.stats.failed += 1;
       state.pendingById.delete(item.videoId);
       state.queuedIds.delete(item.videoId);
     }
   }

   function pumpQueue() {
     if (!isPlaylistPage()) {
       return;
     }

     while (state.running < CONFIG.concurrency && state.queue.length > 0) {
       const item = state.queue.shift();
       state.running += 1;
       if (shouldRun()) {
         setPhase('processing', '正在转换日期...');
       }

       Promise.resolve()
         .then(function () {
           return sleep(CONFIG.requestDelayMs);
         })
         .then(function () {
           return processItem(item);
         })
         .catch(function (error) {
           console.error('[YT Playlist Dates] unexpected queue error:', error);
           state.stats.failed += 1;
           state.pendingById.delete(item.videoId);
           state.queuedIds.delete(item.videoId);
         })
         .finally(function () {
           state.running -= 1;
           if (state.queue.length > 0) {
             pumpQueue();
           } else if (state.running === 0) {
             if (shouldRun()) {
               setPhase('done', '转换完成');
             }
           } else if (shouldRun()) {
             renderStatus();
           }
         });
     }

     if (shouldRun()) {
       renderStatus();
     }
   }

   function initObserver() {
     if (state.observer || !document.body) {
       return;
     }

     state.observer = new MutationObserver(function (mutations) {
       if (!shouldRun()) {
         return;
       }
       for (const mutation of mutations) {
         if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) {
           continue;
         }
         for (const node of mutation.addedNodes) {
           if (!(node instanceof Element)) {
             continue;
           }
           if (node.matches(CONFIG.cardSelector) || node.querySelector(CONFIG.cardSelector)) {
             scheduleScan(CONFIG.scanDebounceMs);
             return;
           }
         }
       }
     });

     state.observer.observe(document.body, {
       childList: true,
       subtree: true
     });
   }

   function resetStatsForPage() {
     state.stats.scanned = 0;
     state.stats.totalCandidates = 0;
     state.stats.done = 0;
     state.stats.failed = 0;
     state.stats.cacheHit = 0;
     state.stats.phase = 'idle';
     state.stats.lastMessage = '';
   }

   function bootstrap() {
     if (!document.body) {
       setTimeout(bootstrap, 100);
       return;
     }

     if (!state.initialized) {
       state.initialized = true;
       initObserver();
       window.addEventListener('yt-navigate-finish', function () {
         if (shouldRun()) {
           scheduleScan(350);
         } else {
           NotificationManager.removeStatusCardNow(CONFIG.popupCardId);
         }
       }, true);
       window.addEventListener('popstate', function () {
         if (shouldRun()) {
           scheduleScan(350);
         } else {
           NotificationManager.removeStatusCardNow(CONFIG.popupCardId);
         }
       }, true);
       document.addEventListener('visibilitychange', function () {
         if (document.visibilityState === 'visible' && shouldRun()) {
           scheduleScan(250);
         }
       }, true);
     }

     if (!shouldRun()) {
       NotificationManager.removeStatusCardNow(CONFIG.popupCardId);
       return;
     }

     resetStatsForPage();
     setPhase('scanning', '开始扫描页面...');
     CONFIG.startupDelays.forEach(function (delay) {
       scheduleScan(delay);
     });
   }

   function enable() {
     if (!isPlaylistPage()) {
       return;
     }
     bootstrap();
   }

   function disable() {
     clearTimeout(state.scanTimer);
     clearTimeout(state.popupTimer);
     restoreOriginalDates();
     NotificationManager.removeStatusCardNow(CONFIG.popupCardId);
     state.stats.phase = 'idle';
     state.stats.lastMessage = '已关闭';
   }

   function init() {
     window.addEventListener('load', function () {
       if (shouldRun()) {
         scheduleScan(500);
       }
     }, true);

     if (document.readyState === 'loading') {
       document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
     } else {
       bootstrap();
     }
   }

   return {
     init,
     enable,
     disable
   };
 })();

 const ExportModule = (() => {
   const STATUS_CARD_ID = 'ytd-tools-export-status';

   const SELECTORS = {
     item: 'ytd-playlist-video-renderer',
     title: 'a#video-title',
     duration: 'ytd-thumbnail-overlay-time-status-renderer .ytBadgeShapeText, ytd-thumbnail-overlay-time-status-renderer #text',
     channel: 'ytd-channel-name #text a, ytd-channel-name #text, #channel-name #text a, #channel-name #text',
     info: 'yt-formatted-string#video-info',
     thumbImage: 'ytd-thumbnail img, img.ytCoreImageHost',
     listRenderer: 'ytd-playlist-video-list-renderer',
     continuation: 'ytd-playlist-video-list-renderer ytd-continuation-item-renderer'
   };

   const MAX_ROUNDS = 400;
   const CONTINUATION_WAIT_MS = 8000;
   const STABLE_WITHOUT_CONTINUATION_TO_STOP = 2;
   const POLL_MS = 250;

   function showStatus(status, meta = '', keepVisible = true) {
     NotificationManager.updateStatusCard(STATUS_CARD_ID, {
       title: 'Export CSV: YouTube Playlist',
       status,
       meta
     });
     if (!keepVisible) {
       NotificationManager.hideStatusCard(STATUS_CARD_ID, 2800);
     }
   }

   function isTargetPage() {
     const url = new URL(window.location.href);
     return url.hostname === 'www.youtube.com' && url.pathname === '/playlist' && !!url.searchParams.get('list');
   }

   function sleep(ms) {
     return new Promise((resolve) => setTimeout(resolve, ms));
   }

   function norm(value) {
     return (value || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
   }

   function absoluteUrl(value) {
     if (!value) return '';
     try {
       return new URL(value, window.location.origin).toString();
     } catch (error) {
       return value;
     }
   }

   function getVideoItems() {
     return Array.from(document.querySelectorAll(SELECTORS.item));
   }

   function getPlaylistRenderer() {
     return document.querySelector(SELECTORS.listRenderer);
   }

   function getContinuationElement() {
     return document.querySelector(SELECTORS.continuation);
   }

   function getContinuationVisibleState() {
     const continuation = getContinuationElement();
     if (!continuation) return false;

     const style = window.getComputedStyle(continuation);
     if (!style) return true;
     return style.display !== 'none' && style.visibility !== 'hidden';
   }

   async function waitForPlaylistItems(timeoutMs = 15000) {
     const start = Date.now();
     while (Date.now() - start < timeoutMs) {
       if (getVideoItems().length > 0) return true;
       await sleep(250);
     }
     return false;
   }

   function scrollTailIntoView() {
     const continuation = getContinuationElement();
     const items = getVideoItems();
     const lastItem = items[items.length - 1];
     const target = continuation || lastItem || getPlaylistRenderer();

     if (target && typeof target.scrollIntoView === 'function') {
       target.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' });
     }

     window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight || 0);
   }

   async function waitForTailUpdate(previousCount, hadContinuation, timeoutMs = CONTINUATION_WAIT_MS) {
     const start = Date.now();

     while (Date.now() - start < timeoutMs) {
       const currentCount = getVideoItems().length;
       const hasContinuation = getContinuationVisibleState();

       if (currentCount > previousCount) {
         return { grew: true, hasContinuation };
       }

       if (hadContinuation && !hasContinuation) {
         return { grew: false, hasContinuation: false };
       }

       await sleep(POLL_MS);
     }

     return {
       grew: getVideoItems().length > previousCount,
       hasContinuation: getContinuationVisibleState()
     };
   }

   async function autoLoadAllVideos(onProgress) {
     let stableWithoutContinuation = 0;
     let round = 0;

     while (round < MAX_ROUNDS) {
       round += 1;
       const countBefore = getVideoItems().length;
       const hadContinuation = getContinuationVisibleState();

       if (typeof onProgress === 'function') {
         onProgress({
           stage: 'load',
           round,
           count: countBefore,
           hasContinuation: hadContinuation
         });
       }

       scrollTailIntoView();
       await sleep(350);

       const result = await waitForTailUpdate(countBefore, hadContinuation);
       const countAfter = getVideoItems().length;
       const hasContinuationAfter = result.hasContinuation;

       if (typeof onProgress === 'function') {
         onProgress({
           stage: 'load',
           round,
           count: countAfter,
           hasContinuation: hasContinuationAfter
         });
       }

       if (countAfter > countBefore) {
         stableWithoutContinuation = 0;
       } else if (!hasContinuationAfter) {
         stableWithoutContinuation += 1;
       } else {
         stableWithoutContinuation = 0;
       }

       if (!hasContinuationAfter && stableWithoutContinuation >= STABLE_WITHOUT_CONTINUATION_TO_STOP) {
         break;
       }

       await sleep(250);
     }

     scrollTailIntoView();
     await sleep(500);
     return getVideoItems().length;
   }

   function restoreOriginalDateTextInClone(clone) {
     if (!clone) return clone;

     if (clone.hasAttribute && clone.hasAttribute(ORIGINAL_DATE_ATTR)) {
       const originalText = clone.getAttribute(ORIGINAL_DATE_ATTR) || '';
       clone.textContent = originalText;
     }

     const markedNodes = clone.querySelectorAll('[' + ORIGINAL_DATE_ATTR + ']');
     markedNodes.forEach((node) => {
       const originalText = node.getAttribute(ORIGINAL_DATE_ATTR) || '';
       node.textContent = originalText;
     });

     return clone;
   }

   function getInfoTextForExport(infoEl) {
     if (!infoEl) return '';

     const clone = infoEl.cloneNode(true);
     const nodes = Array.from(clone.querySelectorAll('span, yt-formatted-string'));

     // Layer 1: prefer the absolute date written by the trusted-fixed date converter.
     for (let i = nodes.length - 1; i >= 0; i -= 1) {
       const node = nodes[i];
       const absoluteFromDataset = node.getAttribute && node.getAttribute('data-ytpd-value');
       if (absoluteFromDataset && /^\d{4}-\d{2}-\d{2}$/.test(absoluteFromDataset)) {
         node.textContent = absoluteFromDataset;
         return norm(clone.textContent);
       }
     }

     // Layer 2: if the visible text is already an absolute date, use it directly.
     for (let i = nodes.length - 1; i >= 0; i -= 1) {
       const node = nodes[i];
       const visible = norm(node.textContent);
       if (/^\d{4}-\d{2}-\d{2}$/.test(visible)) {
         return norm(clone.textContent);
       }
     }

     // Layer 3: fallback to the original relative-date text preserved on the node.
     restoreOriginalDateTextInClone(clone);
     return norm(clone.textContent);
   }

   function parseViewsAndUploadTime(item) {
     const infoEl = item.querySelector(SELECTORS.info);
     if (!infoEl) {
       return { views: '', upload_time: '' };
     }

     const raw = getInfoTextForExport(infoEl);
     if (!raw) {
       return { views: '', upload_time: '' };
     }

     const parts = raw
       .split(/\s*[\u2022\u00b7]\s*/)
       .map((part) => norm(part))
       .filter(Boolean);

     return {
       views: parts[0] || '',
       upload_time: parts[1] || ''
     };
   }

   function normalizeDurationText(value) {
     const raw = norm(value);
     if (!raw) return '';

     const parts = raw
       .split(':')
       .map((part) => part.replace(/\D+/g, ''))
       .filter(Boolean);

     if (!parts.length) return raw;

     if (parts.length === 1) {
       return parts[0].padStart(2, '0');
     }

     if (parts.length === 2) {
       return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
     }

     const lastThree = parts.slice(-3);
     return lastThree.map((part) => part.padStart(2, '0')).join(':');
   }

   function simplifyVideoUrl(value) {
     if (!value) return '';

     try {
       const url = new URL(value, window.location.origin);
       const videoId = url.searchParams.get('v');
       if (videoId) {
         return 'https://www.youtube.com/watch?v=' + videoId;
       }
       return url.origin + url.pathname;
     } catch (error) {
       return value;
     }
   }

   function extractItem(item) {
     const titleEl = item.querySelector(SELECTORS.title);
     const durationEl = item.querySelector(SELECTORS.duration);
     const channelEl = item.querySelector(SELECTORS.channel);
     const thumbEl = item.querySelector(SELECTORS.thumbImage);
     const parsedInfo = parseViewsAndUploadTime(item);

     const title = norm(
       (titleEl && (titleEl.getAttribute('title') || titleEl.textContent)) || ''
     );

     const url = simplifyVideoUrl(titleEl ? titleEl.getAttribute('href') || '' : '');
     const duration = normalizeDurationText(durationEl ? durationEl.textContent : '');
     const channel = norm(channelEl ? channelEl.textContent : '');
     const thumbnailUrl = absoluteUrl(
       thumbEl ? thumbEl.getAttribute('src') || thumbEl.getAttribute('data-thumb') || '' : ''
     );

     return {
       name: title,
       duration: duration,
       upload_time: parsedInfo.upload_time,
       channel: channel,
       views: parsedInfo.views,
       url: url,
       thumbnail_url: thumbnailUrl
     };
   }

   function extractAllItems() {
     return getVideoItems().map(extractItem);
   }

   function csvPlainCell(value) {
     return String(value == null ? '' : value)
       .replace(/\r?\n|\r/g, ' ')
       .replace(/,/g, '，')
       .trim();
   }

   function buildCsv(rows) {
     const headers = ['name', 'duration', 'upload_time', 'channel', 'views', 'url', 'thumbnail_url'];
     const lines = [headers.join(',')];

     for (const row of rows) {
       lines.push(headers.map((key) => csvPlainCell(row[key] || '')).join(','));
     }

     return '\uFEFF' + lines.join('\r\n');
   }

   function sanitizeFileName(value) {
     return String(value || 'youtube_playlist_export')
       .replace(/[\\/:*?"<>|]+/g, '_')
       .replace(/\s+/g, '_')
       .replace(/_+/g, '_')
       .replace(/^_+|_+$/g, '')
       .slice(0, 120) || 'youtube_playlist_export';
   }

   function getFileName() {
     const playlistTitle = norm(
       (document.querySelector('ytd-playlist-sidebar-primary-info-renderer h1 yt-formatted-string') ||
         document.querySelector('yt-formatted-string.ytd-playlist-panel-renderer'))?.textContent ||
       document.title ||
       'youtube_playlist_export'
     );

     const now = new Date();
     const yyyy = now.getFullYear();
     const mm = String(now.getMonth() + 1).padStart(2, '0');
     const dd = String(now.getDate()).padStart(2, '0');
     const hh = String(now.getHours()).padStart(2, '0');
     const mi = String(now.getMinutes()).padStart(2, '0');
     const ss = String(now.getSeconds()).padStart(2, '0');

     return sanitizeFileName(playlistTitle) + '_' + yyyy + mm + dd + '_' + hh + mi + ss + '.csv';
   }

   function downloadCsv(csvText) {
     const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
     const url = URL.createObjectURL(blob);
     const link = document.createElement('a');
     link.href = url;
     link.download = getFileName();
     document.body.appendChild(link);
     link.click();
     link.remove();
     setTimeout(() => URL.revokeObjectURL(url), 1000);
   }

   async function run() {
     if (exportIsRunning) {
       NotificationManager.showToast('Script is already running.', 2400, 'Export CSV: YouTube Playlist');
       return;
     }

     if (!isTargetPage()) {
       alert('This tool only runs on YouTube playlist pages with a list parameter.');
       return;
     }

     exportIsRunning = true;
     showStatus('Starting export...', 'Preparing playlist page...', true);

     try {
       const ready = await waitForPlaylistItems();
       if (!ready) {
         throw new Error('Playlist items were not found on the page.');
       }

       showStatus('Loading all playlist videos...', 'Scrolling and waiting for continuation...', true);

       const totalLoaded = await autoLoadAllVideos((state) => {
         const meta = 'Round ' + state.round + ' | Loaded ' + state.count + (state.hasContinuation ? ' | Continuation visible' : ' | Continuation hidden');
         showStatus('Loading all playlist videos...', meta, true);
       });

       showStatus('Parsing playlist items...', 'Loaded ' + totalLoaded + ' cards on page', true);
       const rows = extractAllItems();
       if (!rows.length) {
         throw new Error('No playlist videos were extracted.');
       }

       showStatus('Building CSV...', 'Parsed ' + rows.length + ' videos', true);
       const csvText = buildCsv(rows);

       showStatus('Starting download...', 'Filename will be generated automatically', true);
       downloadCsv(csvText);

       showStatus('Export complete. Download started.', 'Parsed ' + rows.length + ' videos', false);
     } catch (error) {
       console.error('[YT Playlist Export]', error);
       showStatus('Export failed: ' + (error && error.message ? error.message : 'Unknown error'), 'Check browser console for details', false);
       alert('Export failed. Check the browser console for details.');
     } finally {
       exportIsRunning = false;
     }
   }

   return { run };
 })();

 function runExportWorkflow() {
   return ExportModule.run();
 }

 function init() {
   registerMenu();
   installShortcuts();
   PlaylistDatesModule.init();
 }

 if (document.readyState === 'loading') {
   document.addEventListener('DOMContentLoaded', init, { once: true });
 } else {
   init();
 }
})();

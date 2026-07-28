"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

const webdav_1 = require("webdav");

let cachedData = {};

function stripExt(name) {
  const s = String(name || "").trim();
  const idx = s.lastIndexOf(".");
  if (idx <= 0) return s;
  return s.slice(0, idx);
}

function safeSplitPathList(searchPath) {
  // 允许用户用逗号分隔多个目录
  // 兼容空格："/lrc, /lyrics"
  const raw = String(searchPath || "").trim();
  if (!raw) return ["/"];
  const list = raw
    .split(",")
    .map((s) => String(s || "").trim())
    .filter((s) => s !== "");
  return list.length ? list : ["/"];
}

function getClient() {
  var _a, _b;
  const { url, username, password, searchPath } =
    (_b =
      (_a = env === null || env === void 0 ? void 0 : env.getUserVariables) ===
        null || _a === void 0
        ? void 0
        : _a.call(env)) !== null && _b !== void 0
      ? _b
      : {};

  if (!(url && username && password)) {
    return null;
  }

  // 模仿 webdav插件.js：变量变化则清缓存
  if (
    !(
      cachedData.url === url &&
      cachedData.username === username &&
      cachedData.password === password &&
      cachedData.searchPath === searchPath
    )
  ) {
    cachedData.url = url;
    cachedData.username = username;
    cachedData.password = password;
    cachedData.searchPath = searchPath;
    cachedData.searchPathList = safeSplitPathList(searchPath);
    cachedData.cacheFileList = null; // 缓存 lrc 文件列表
  }

  return (0, webdav_1.createClient)(url, {
    authType: webdav_1.AuthType.Password,
    username,
    password,
  });
}

function getSearchPathList() {
  // 确保始终有默认目录
  return cachedData.searchPathList && cachedData.searchPathList.length
    ? cachedData.searchPathList
    : ["/"];
}

function isLrcFile(it) {
  if (!it || it.type !== "file") return false;
  const base = String(it.basename || "");
  return base.toLowerCase().endsWith(".lrc");
}

async function ensureLrcFileList() {
  const client = getClient();
  if (!client) return [];

  if (cachedData.cacheFileList) {
    return cachedData.cacheFileList;
  }

  let result = [];
  const searchPathList = getSearchPathList();

  for (let search of searchPathList) {
    try {
      const fileItems = await client.getDirectoryContents(search);
      const lrcItems = (fileItems || []).filter(isLrcFile);
      result = result.concat(lrcItems);
    } catch (_e) {}
  }

  cachedData.cacheFileList = result;
  return result;
}

async function search(query, page, type) {
  if (type !== "lyric") return;

  const client = getClient();
  if (!client) {
    return { isEnd: true, data: [] };
  }

  const list = await ensureLrcFileList();

  // 把 musicName.mp3 -> musicName（用于面板自动填入文件名时）
  const qNoExt = stripExt(query);

  const data = (list || [])
    .filter((it) => String(it.basename || "").includes(qNoExt))
    .map((it) => ({
      title: it.basename,
      id: it.filename, // 直接用 filename 作为唯一 id（getLyric 可直接读）
      artist: "WebDAV",
      album: "LRC",
    }));

  return { isEnd: true, data };
}

async function getLyric(musicItem) {
  const client = getClient();
  if (!client || !musicItem) return null;

  // 1) 如果是从 search() 结果点进来的：musicItem.id 就是 lrc 路径
  if (musicItem.id && String(musicItem.id).toLowerCase().endsWith(".lrc")) {
    try {
      const raw = await client.getFileContents(musicItem.id, { format: "text" });
      return raw ? { rawLrc: String(raw) } : null;
    } catch (_e) {
      return null;
    }
  }

  // 2) 自动匹配：用 title 精确匹配同名 .lrc
  const title = stripExt(musicItem.title || "");
  if (!title) return null;

  const targetBaseName = `${title}.lrc`;

  const list = await ensureLrcFileList();
  const hit = (list || []).find(
    (it) => String(it.basename || "").toLowerCase() === targetBaseName.toLowerCase()
  );
  if (!hit || !hit.filename) return null;

  try {
    const raw = await client.getFileContents(hit.filename, { format: "text" });
    return raw ? { rawLrc: String(raw) } : null;
  } catch (_e) {
    return null;
  }
}

module.exports = {
  platform: "WebDAV歌词",
  author: "Cyan",
  description: "从 WebDAV 中搜索/读取与歌曲文件名完全一致的 .lrc 歌词",
  version: "0.1.0",
  srcUrl: "https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-lyric.js",
  cacheControl: "no-cache",
  supportedSearchType: ["lyric"],
  userVariables: [
    { key: "url", name: "WebDAV地址" },
    { key: "username", name: "用户名" },
    { key: "password", name: "密码", type: "password" },
    { key: "searchPath", name: "存放歌词的路径（可多个逗号分隔）" },
  ],
  search,
  getLyric,
};

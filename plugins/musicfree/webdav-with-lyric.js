"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webdav_1 = require("webdav");

let cachedData = {};

/**
 * 尝试在插件环境中加载可选依赖。
 * 注意：MusicFree 插件的 require 是宿主注入的 _require，未必允许加载 react-native / react-native-fs。
 */
function tryRequire(modName) {
  try {
    return require(modName);
  } catch {
    return null;
  }
}

function getClient() {
  var _a, _b, _c;
  const { url, username, password, searchPath } =
    (_b = (_a = env === null || env === void 0 ? void 0 : env.getUserVariables) === null || _a === void 0 ? void 0 : _a.call(env)) !== null && _b !== void 0 ? _b : {};
  if (!(url && username && password)) {
    return null;
  }
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
    cachedData.searchPathList = (_c = searchPath === null || searchPath === void 0 ? void 0 : searchPath.split) === null || _c === void 0 ? void 0 : _c.call(searchPath, ",");
    cachedData.cacheFileList = null;
  }
  return (0, webdav_1.createClient)(url, {
    authType: webdav_1.AuthType.Password,
    username,
    password,
  });
}

async function searchMusic(query) {
  var _a, _b;
  const client = getClient();
  if (!client) {
    return { isEnd: true, data: [] };
  }

  if (!cachedData.cacheFileList) {
    const searchPathList = ((_a = cachedData.searchPathList) === null || _a === void 0 ? void 0 : _a.length)
      ? cachedData.searchPathList
      : ["/"];
    let result = [];
    for (let search of searchPathList) {
      try {
        const fileItems = (await client.getDirectoryContents(search)).filter(
          (it) => it.type === "file" && it.mime && it.mime.startsWith("audio")
        );
        result = [...result, ...fileItems];
      } catch (_c) {}
    }
    cachedData.cacheFileList = result;
  }
  return {
    isEnd: true,
    data: ((_b = cachedData.cacheFileList) !== null && _b !== void 0 ? _b : [])
      .filter((it) => it.basename.includes(query))
      .map((it) => ({
        title: it.basename,
        id: it.filename,
        artist: "未知作者",
        album: "未知专辑",
      })),
  };
}

async function getTopLists() {
  getClient();
  const data = {
    title: "全部歌曲",
    data: (cachedData.searchPathList || []).map((it) => ({
      title: it,
      id: it,
    })),
  };
  return [data];
}

async function getTopListDetail(topListItem) {
  const client = getClient();
  if (!client) {
    return { musicList: [] };
  }
  const fileItems = (await client.getDirectoryContents(topListItem.id)).filter(
    (it) => it.type === "file" && it.mime && it.mime.startsWith("audio")
  );
  return {
    musicList: fileItems.map((it) => ({
      title: it.basename,
      id: it.filename,
      artist: "未知作者",
      album: "未知专辑",
    })),
  };
}

/**
 * 读取 WebDAV 音乐的内嵌歌词：
 * - 先下载到本地临时文件
 * - 再调用 NativeModules.Mp3Util.getLyric(localPath)
 *
 * 如果插件环境无法 require 到 react-native / react-native-fs，则返回 null（不影响播放）。
 */
async function getLyric(musicItem) {
  try {
    const client = getClient();
    if (!client || !musicItem || !musicItem.id) {
      return null;
    }

    const rn = tryRequire("react-native");
    const rnfs = tryRequire("react-native-fs");

    const Mp3Util =
      rn && rn.NativeModules && rn.NativeModules.Mp3Util
        ? rn.NativeModules.Mp3Util
        : null;

    if (!Mp3Util || !rnfs) {
      // 插件运行环境不支持直接调用 RN NativeModules / RNFS
      return null;
    }

    // 远端下载链接（可能包含鉴权信息或走 webdav client 的内部处理）
    const fromUrl = client.getFileDownloadLink(musicItem.id);

    // 生成一个本地缓存文件名（尽量保留扩展名，便于某些库识别）
    const basename = String(musicItem.id).split("/").pop() || "track";
    const safeBase = basename.replace(/[\\/:*?"<>|]/g, "_");
    const toFile = `${rnfs.CachesDirectoryPath}/musicfree_webdav_${Date.now()}_${safeBase}`;

    // 下载
    const dl = rnfs.downloadFile({
      fromUrl,
      toFile,
      background: false,
    });
    await dl.promise;

    // 读取内嵌歌词（tag: FieldKey.LYRICS）
    const raw = await Mp3Util.getLyric(toFile).catch(() => null);

    // 可选：清理临时文件（如果你想省空间；但如果要复用缓存可不删）
    try {
      await rnfs.unlink(toFile);
    } catch {}

    if (!raw) {
      return null;
    }
    return { rawLrc: raw };
  } catch {
    return null;
  }
}

module.exports = {
  platform: "WebDAV-内嵌歌词",
  author: "猫头猫",
  description: "使用此插件前先配置用户变量（可选：支持尝试读取内嵌歌词）",
  userVariables: [
    { key: "url", name: "WebDAV地址" },
    { key: "username", name: "用户名" },
    { key: "password", name: "密码", type: "password" },
    { key: "searchPath", name: "存放歌曲的路径" },
  ],
  version: "0.0.3",
  supportedSearchType: ["music"],
  srcUrl: "https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/plugins/musicfree/webdav-with-lyric.js",
  cacheControl: "no-cache",

  search(query, page, type) {
    if (type === "music") {
      return searchMusic(query);
    }
  },

  getTopLists,
  getTopListDetail,

  getMediaSource(musicItem) {
    const client = getClient();
    return {
      url: client.getFileDownloadLink(musicItem.id),
    };
  },

  // 新增：歌词接口
  getLyric,
};

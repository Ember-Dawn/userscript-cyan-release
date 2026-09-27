# Git Bridge

ZTools 本地 Git 更新桥接插件。它将标准 ZIP 更新包安全应用到本地 Git 仓库，自动完成 Commit / Push，并可选通过 SSH 同步同名 Ubuntu 仓库。

本插件由独立的 `chatgpt-git-bridge` WinForms 工具迁移而来，保留原有核心业务规则和安全边界，并改为 ZTools + 原生 HTML/CSS/JavaScript + Node preload 实现。插件通过轻量 launcher 创建独立 BrowserWindow；可维护源码位于 `preload.cjs`，实际运行入口使用已提交的 `preload.bundle.cjs`。

## 功能

- 配置一个或多个 Git 仓库根目录。
- 扫描根目录自身及第一层子目录，以 `.git` 文件或目录识别 Git 仓库。
- 配置 ZIP 下载目录并自动监控变化，按修改时间降序列出最多 100 个 ZIP。
- 默认自动选择最新 ZIP；手动选择旧 ZIP 后保持该选择，文件消失时恢复自动选择最新 ZIP。
- 解析标准 `payload/` + `__delete__.txt` 更新包。
- 预览新增、修改、删除、内容相同和删除目标不存在。
- ZIP 安全检查：
  - 普通文件只能位于 `payload/`；
  - 禁止路径越界；
  - 禁止修改 `.git`；
  - 同一路径不能同时位于 payload 与删除清单；
  - 最多 5,000 个 payload 文件；
  - 解压后总大小最多 1 GiB。
- 应用前检查 Git 工作区；存在未提交修改时可先创建 checkpoint commit。
- 应用前执行 `git pull --ff-only`。
- 应用 ZIP 后按原 WinForms 规则清理空目录：只检查仓库第 1、2 层，跳过 `.gitignore` 命中的目录、子 Git 仓库和链接目录，并批量调用 `git check-ignore -z --stdin` 避免逐目录启动 Git 进程。
- 自动执行 `git add -A`、`git commit`、`git push`。
- 提供独立的“提交并推送”，用于提交当前仓库已有工作区修改而不应用 ZIP。
- 日志保存在内存中，可随时复制给 AI 分析。
- 支持跟随系统 / 浅色 / 深色主题。
- 支持多个 SSH 服务器，每台服务器可独立启用或停用；主流程并行处理多台服务器，正常干净仓库在单次 SSH 连接中完成状态检查、同步和 HEAD 校验。
- SSH 服务器中不存在同名仓库时正常跳过。
- 服务器仓库存在未提交修改时可跳过，或先保存为备份 Commit；保存后本次同步停止，避免分支分叉。
- 服务器存在 `sync.sh` 时执行 `bash ./sync.sh`，否则执行 `git pull --ff-only`。
- 同步完成后验证服务器 `HEAD` 是否等于本地刚 Push 的 Commit SHA。
- 临时同步失败按 `0、2、4、8、15` 秒退避重试，最多 5 次。
- 保存并校验 SSH SHA256 主机指纹；主机或端口改变后重新建立信任。
- 插件设置保存在 ZTools 插件数据库中；SSH 密码使用主密码派生的密钥进行 AES-256-GCM 加密后再写入设置，不保存明文密码或主密码。
- 首次运行会优先读取 ZTools 插件数据库；若检测到旧版 renderer `localStorage` 设置，会一次性迁移到 ZTools 数据库并删除旧副本；如仍无设置，再尝试从 `%LOCALAPPDATA%\ChatGPTGitBridge\settings.json` 导入原 WinForms 版本配置。

## ZIP 格式

```text
update.zip
├── payload/
│   ├── README.md
│   └── src/Example.js
└── __delete__.txt   # 可选
```

规则：

1. `payload/` 中只放本次新增或修改后的完整文件。
2. `payload/` 内路径就是仓库相对路径。
3. 删除的旧路径逐行写入根目录的 `__delete__.txt`。
4. 改名或移动 = 新路径完整文件放入 `payload/`，旧路径写入 `__delete__.txt`。

## 运行要求

- Windows 10/11
- ZTools
- Git for Windows，并已配置目标仓库的 Git 身份验证
- 旧版 DPAPI 密码自动迁移时需要 Windows PowerShell；新保存的密码不依赖 DPAPI
- SSH 服务器同步时需要可通过账号密码登录的 SSH 服务端

## Preload 与运行依赖

`preload.cjs` 是可维护源码，其中使用：

- `adm-zip`：读取和应用 ZIP 更新包；
- `ssh2`：账号密码 SSH、主机指纹验证和远程命令执行。

仓库同时提交 `preload.bundle.cjs`，插件的 `plugin.json` 和独立窗口 launcher 都以该 bundle 作为实际 preload。`adm-zip`、`ssh2` 及其可打包的 JavaScript 依赖已经包含在 bundle 中，因此正常运行 Git Bridge 时不需要在插件目录执行 `npm install`，也不需要保留 `node_modules`。

在 ZTools 开发项目中直接导入：

```text
E:\github\ztools-plugins\plugins\git-bridge\plugin.json
```

修改 `preload.cjs`、升级 `adm-zip` / `ssh2`，或调整相关 preload 依赖后，必须重新生成并测试 `preload.bundle.cjs`；只修改 `app.js`、`index.html`、`style.css` 或一般 launcher UI 时不需要重新 bundle。完整构建和验证流程见 [`docs/preload-bundle-guide.md`](../../docs/preload-bundle-guide.md)。

## 独立窗口

`plugin.json` 以 `launcher.html` 为主入口，`launcher.js` 再通过 `window.ztools.createBrowserWindow()` 创建真正的 Git Bridge 窗口。launcher 负责复用已有窗口、记忆普通尺寸与最大化状态、转发自定义标题栏命令，并在独立窗口关闭后结束插件实例，避免后台无意义驻留。实现原则和复用清单见 [`docs/ztools-independent-window-guide.md`](../../docs/ztools-independent-window-guide.md)。

Git Bridge 当前有意继续使用自定义 BrowserWindow，而不是切换到 ZTools 原生 `Ctrl+D` detached window：这样可以自行控制窗口最小尺寸和标题栏。当前 ZTools 会优先处理插件视图中的 `Ctrl+D` 并执行宿主自己的分离流程，因此 Git Bridge 不尝试接管该快捷键，也暂不提供“ZTools 内嵌 + 自定义独立窗口”的双模式；相关取舍和未来重新评估条件见上述独立窗口指南。

## 主流程

### 应用并推送

1. 检查 Git 是否可用。
2. 检查目标仓库工作区。
3. 如存在未提交修改，可创建本地 checkpoint commit 后继续。
4. 执行 `git pull --ff-only`。
5. 分析 ZIP 并确认实际变化。
6. 应用 `__delete__.txt` 和 `payload/`。
7. `git add -A`。
8. 创建 Commit。
9. Push 到 upstream。
10. 读取本地 HEAD。
11. 并行处理已启用的 SSH 服务器，并核对远程 HEAD；服务器存在未提交修改时再进入用户决策流程。

### 提交并推送

不读取或应用 ZIP，只检查当前目标仓库已有修改，然后执行 Stage、Commit、Push 和可选服务器同步。该独立流程仍会在读取工作区状态前执行两层空目录清理；“应用并推送”则与原 EXE 保持一致，只在真正应用 ZIP 后清理空目录，避免应用前重复扫描。

## 安全说明

Git Bridge 的仓库目录、下载目录、主题、提交说明和服务器配置统一保存在 ZTools 为该插件隔离的数据库文档中。服务器密码不会以明文写入数据库，主密码也不会保存或同步。ZTools 数据库命名空间、当前账号同步范围、资料核对基线和多端凭据设计详见 [`docs/ztools-plugin-storage-and-sync-guide.md`](../../docs/ztools-plugin-storage-and-sync-guide.md)。

凭据加密采用：

```text
KDF: scrypt (N=32768, r=8, p=1, random 16-byte salt)
Cipher: AES-256-GCM (random 12-byte IV + authentication tag)
```

主密码只在当前 Git Bridge 运行期间用于派生 256-bit 密钥；插件退出时会从内存清除，不再提供手动“锁定”操作。已有凭据的设备启动后显示“已设置 · 待解锁”，输入同一主密码即可使用同步后的服务器密码；主密码不设最低长度硬限制，但建议使用较长且不易猜测的密码。ZTools 账号同步可以同步插件数据库中的加密凭据和 KDF 参数；当前 `plugin.json` 仍只声明 Windows 平台，但凭据格式本身不依赖 Windows，可用于未来的跨平台版本。

旧版 WinForms / DPAPI 密码保留只读迁移兼容：首次设置或解锁主密码后，Git Bridge 会尝试使用 Windows DPAPI 解密旧密文，并立即重新加密为新的可移植凭据格式。新保存的服务器密码不再使用 DPAPI。如果忘记主密码，已加密的服务器密码无法恢复，需要重新输入服务器密码。

凭据库带有递增的 `generation`。保存服务器配置、迁移旧凭据或修改主密码前会重新读取 ZTools 数据库；如果检测到另一设备已经同步了更新版本，当前旧页面会拒绝覆盖并提示重新打开 Git Bridge。普通主题、仓库路径等设置保存时若发现凭据版本已变化，会保留数据库中的最新凭据与服务器配置，避免静默覆盖。

首次成功建立 SSH 连接时保存服务端公钥的 SHA256 指纹；之后若同一配置返回不同指纹，SSH 握手会被拒绝。修改服务器地址或端口时，旧指纹会被清空并重新建立信任。OpenSSH 风格 SHA256 指纹的 Base64 padding、规范化和 host-key 验证踩坑详见 [`docs/ssh-integration-guide.md`](../../docs/ssh-integration-guide.md)。

## 与原 WinForms 版本的对应关系

- `BridgeEngine.cs` → `preload.cjs`（源码）/ `preload.bundle.cjs`（运行产物）中的 ZIP、文件系统和 Git 操作。
- `ServerSyncService.cs` → `preload.cjs`（源码）/ `preload.bundle.cjs`（运行产物）中的 SSH 测试、检查、checkpoint、同步和重试。
- `AppSettings.cs` → ZTools 插件数据库设置 + 主密码派生密钥 / AES-256-GCM 加密凭据。
- `MainForm.cs` → `index.html` + `style.css` + `app.js`。
- `RepositoryChangesDialog.cs` → `app.js` 中的本地 / 服务器脏工作区模态框。

原项目的 WinForms 布局、DPI 和焦点专用代码不再需要。

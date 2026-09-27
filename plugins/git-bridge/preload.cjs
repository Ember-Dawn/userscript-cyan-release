'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const MAX_ZIP_FILES = 5000
const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
const RETRY_DELAYS_MS = [0, 2000, 4000, 8000, 15000]
const DEFAULT_LOCAL_CHECKPOINT_MESSAGE = 'Checkpoint local changes before ChatGPT Git Bridge update'
const DEFAULT_SERVER_CHECKPOINT_MESSAGE = 'Checkpoint server changes before bridge synchronization'
const LEGACY_DPAPI_ENTROPY = 'ChatGPTGitBridge.SshPassword.v1'
const CREDENTIAL_VERSION = 1
const CREDENTIAL_SENTINEL = 'GitBridgeCredentialVault:v1'
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_LENGTH = 32
const SCRYPT_MAXMEM = 64 * 1024 * 1024

let zipWatcher = null
let zipRefreshTimer = null
let credentialKey = null
let credentialVaultTag = ''

function emit(type, payload = {}) {
  window.postMessage({ source: 'git-bridge', type, ...payload }, '*')
}

function requireDependency(name) {
  try {
    return require(name)
  } catch (error) {
    const wrapped = new Error(`缺少运行依赖 ${name}。请在插件目录执行 npm install 后重新进入插件。`)
    wrapped.cause = error
    throw wrapped
  }
}

function normalizeArchive(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function normalizeRelative(value) {
  return normalizeArchive(value).replace(/^\/+|\/+$/g, '')
}

function validateRelative(value) {
  const normalized = normalizeRelative(value)
  if (!normalized || path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`必须使用仓库相对路径：${value}`)
  }
  const parts = normalized.split('/').filter(Boolean)
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`路径包含非法片段：${value}`)
  }
  if (parts.some((part) => part.toLowerCase() === '.git')) {
    throw new Error(`禁止修改 .git：${value}`)
  }
  return normalized
}

function resolveInside(root, relative) {
  const normalized = validateRelative(relative)
  const fullRoot = path.resolve(root)
  const target = path.resolve(fullRoot, ...normalized.split('/'))
  const prefix = fullRoot.endsWith(path.sep) ? fullRoot : fullRoot + path.sep
  if (target !== fullRoot && !target.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new Error(`路径越界：${relative}`)
  }
  return target
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value / 1024
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }
  const digits = amount >= 100 || Number.isInteger(amount) ? 0 : 1
  return `${amount.toFixed(digits)} ${units[index]}`
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function pathExists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function isGitRepository(target) {
  try {
    const stat = await fsp.stat(target)
    if (!stat.isDirectory()) return false
    const marker = path.join(target, '.git')
    return await pathExists(marker)
  } catch {
    return false
  }
}

async function scanRepositories(roots) {
  const candidates = []
  for (const rawRoot of roots || []) {
    const root = String(rawRoot || '').trim()
    if (!root || !(await pathExists(root))) continue
    if (await isGitRepository(root)) candidates.push({ path: path.resolve(root), root: path.resolve(root) })
    let entries = []
    try {
      entries = await fsp.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(root, entry.name)
      if (await isGitRepository(candidate)) candidates.push({ path: path.resolve(candidate), root: path.resolve(root) })
    }
  }

  const seen = new Set()
  const unique = []
  for (const item of candidates) {
    const key = item.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }

  const counts = new Map()
  for (const item of unique) {
    const name = path.basename(item.path).toLowerCase()
    counts.set(name, (counts.get(name) || 0) + 1)
  }

  return unique
    .sort((a, b) => path.basename(a.path).localeCompare(path.basename(b.path), undefined, { sensitivity: 'base' }))
    .map((item) => {
      const name = path.basename(item.path)
      return {
        ...item,
        name,
        display: (counts.get(name.toLowerCase()) || 0) > 1 ? `${name} — ${item.root}` : name
      }
    })
}

async function listZips(directory) {
  const root = String(directory || '').trim()
  if (!root) return []
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const files = []
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.zip') continue
    const fullPath = path.join(root, entry.name)
    try {
      const stat = await fsp.stat(fullPath)
      files.push({
        path: fullPath,
        name: entry.name,
        mtimeMs: stat.mtimeMs,
        modified: formatDateTime(stat.mtime),
        sizeBytes: stat.size,
        size: formatBytes(stat.size)
      })
    } catch {}
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 100)
}

function stopZipWatcher() {
  if (zipRefreshTimer) {
    clearTimeout(zipRefreshTimer)
    zipRefreshTimer = null
  }
  if (zipWatcher) {
    try { zipWatcher.close() } catch {}
    zipWatcher = null
  }
}

function watchZipDirectory(directory) {
  stopZipWatcher()
  const root = String(directory || '').trim()
  if (!root || !fs.existsSync(root)) return false
  try {
    zipWatcher = fs.watch(root, { persistent: false }, (_eventType, filename) => {
      if (filename && path.extname(String(filename)).toLowerCase() !== '.zip') return
      if (zipRefreshTimer) clearTimeout(zipRefreshTimer)
      zipRefreshTimer = setTimeout(() => emit('zip-directory-changed'), 250)
    })
    zipWatcher.on('error', (error) => emit('zip-watcher-error', { message: error.message }))
    return true
  } catch (error) {
    emit('zip-watcher-error', { message: error.message })
    return false
  }
}

function openZip(zipPath) {
  const AdmZip = requireDependency('adm-zip')
  return new AdmZip(zipPath)
}

function parseDeleteList(text) {
  const seen = new Set()
  const values = []
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = validateRelative(line)
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    values.push(normalized)
  }
  return values
}

async function sameEntryContent(entry, targetPath) {
  let stat
  try {
    stat = await fsp.stat(targetPath)
  } catch {
    return false
  }
  if (!stat.isFile() || stat.size !== Number(entry.header?.size || 0)) return false
  const disk = await fsp.readFile(targetPath)
  const zipped = entry.getData()
  return disk.equals(zipped)
}

async function analyzePackage(zipPath, repositoryPath) {
  if (!(await pathExists(zipPath))) throw new Error(`ZIP 不存在：${zipPath}`)
  if (!(await isGitRepository(repositoryPath))) throw new Error('目标不是有效 Git 仓库。')

  const zip = openZip(zipPath)
  const entries = zip.getEntries()
  const payloadEntries = []
  let deleteEntry = null
  let totalUncompressed = 0

  for (const entry of entries) {
    if (entry.isDirectory) continue
    const normalized = normalizeArchive(entry.entryName)
    if (normalized.toLowerCase() === '__delete__.txt') {
      if (deleteEntry) throw new Error('ZIP 中存在多个 __delete__.txt。')
      deleteEntry = entry
      continue
    }
    if (!normalized.toLowerCase().startsWith('payload/')) {
      throw new Error(`ZIP 根目录中发现不允许的文件：${entry.entryName}\n普通文件必须放在 payload/ 中。`)
    }
    const relative = validateRelative(normalized.slice('payload/'.length))
    payloadEntries.push({ entry, relative })
    totalUncompressed += Number(entry.header?.size || 0)
  }

  if (payloadEntries.length > MAX_ZIP_FILES || totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new Error('ZIP 文件数量或解压后总大小超过限制。')
  }

  const payloadSet = new Set(payloadEntries.map((item) => item.relative.toLowerCase()))
  const changes = []
  const payloadFiles = []
  for (const item of payloadEntries) {
    payloadFiles.push(item.relative)
    const target = resolveInside(repositoryPath, item.relative)
    let kind = 'add'
    if (await pathExists(target)) kind = (await sameEntryContent(item.entry, target)) ? 'unchanged' : 'modify'
    changes.push({ kind, path: item.relative })
  }

  const deletePaths = deleteEntry ? parseDeleteList(deleteEntry.getData().toString('utf8')) : []
  for (const relative of deletePaths) {
    if (payloadSet.has(relative.toLowerCase())) {
      throw new Error(`同一路径同时位于 payload 和删除清单：${relative}`)
    }
    const target = resolveInside(repositoryPath, relative)
    changes.push({ kind: (await pathExists(target)) ? 'delete' : 'delete-missing', path: relative })
  }

  if (!payloadFiles.length && !deletePaths.length) throw new Error('ZIP 没有可应用内容。')
  const actionableCount = changes.filter((item) => ['add', 'modify', 'delete'].includes(item.kind)).length
  return { zipPath, repositoryPath, changes, payloadFiles, deletePaths, actionableCount }
}

async function applyPackage(plan) {
  const { zipPath, repositoryPath, deletePaths = [] } = plan || {}
  if (!(await isGitRepository(repositoryPath))) throw new Error('目标不是有效 Git 仓库。')
  const zip = openZip(zipPath)

  for (const relative of deletePaths) {
    const target = resolveInside(repositoryPath, relative)
    try {
      const stat = await fsp.lstat(target)
      if (stat.isDirectory()) await fsp.rm(target, { recursive: true, force: true })
      else await fsp.unlink(target)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const normalized = normalizeArchive(entry.entryName)
    if (!normalized.toLowerCase().startsWith('payload/')) continue
    const relative = validateRelative(normalized.slice('payload/'.length))
    const target = resolveInside(repositoryPath, relative)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, entry.getData())
  }

  await cleanEmptyDirectories(repositoryPath)
  return true
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      windowsHide: true,
      shell: false,
      env: process.env
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    if (options.input !== undefined) child.stdin?.end(String(options.input))
  })
}

function ensureCommand(result, message) {
  if (result.code === 0) return result
  const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join(os.EOL)
  throw new Error(detail ? `${message}\n\n${detail}` : message)
}

async function runGit(repo, ...args) {
  return runProcess('git', args, { cwd: repo })
}

async function ensureGit() {
  ensureCommand(await runProcess('git', ['--version']), '未找到 Git。请安装 Git for Windows 并加入 PATH。')
  return true
}

async function getWorkingTreeStatus(repo, options = {}) {
  if (options.cleanEmptyDirectories !== false) await cleanEmptyDirectories(repo)
  const result = ensureCommand(await runGit(repo, 'status', '--porcelain'), '无法读取仓库状态')
  return result.stdout.trim()
}

async function pullFastForward(repo) {
  ensureCommand(await runGit(repo, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'), '当前分支没有配置 upstream')
  ensureCommand(await runGit(repo, 'pull', '--ff-only'), 'git pull --ff-only 失败；程序尚未应用 ZIP')
  return true
}

async function stage(repo) {
  ensureCommand(await runGit(repo, 'add', '-A'), 'git add -A 失败')
  const result = ensureCommand(await runGit(repo, 'diff', '--cached', '--name-status'), '无法读取暂存变化')
  return result.stdout.trim()
}

async function commit(repo, message) {
  ensureCommand(await runGit(repo, 'commit', '-m', String(message || '')), 'git commit 失败')
  return true
}

async function push(repo) {
  ensureCommand(await runGit(repo, 'push'), 'git push 失败；本地 commit 已保留')
  return true
}

async function getHeadSha(repo) {
  const result = ensureCommand(await runGit(repo, 'rev-parse', 'HEAD'), '无法读取本地 Commit SHA')
  return result.stdout.trim()
}

async function rollback(repo) {
  await runGit(repo, 'reset', '--hard', 'HEAD')
  await runGit(repo, 'clean', '-fd')
  return true
}

async function gitIgnored(repo, relatives) {
  if (!relatives.length) return new Set()
  const normalized = relatives.map((relative) => relative.replace(/\\/g, '/'))
  const input = normalized.map((relative) => `${relative}\0`).join('')
  const result = await runProcess('git', ['check-ignore', '-z', '--stdin'], { cwd: repo, input })
  if (result.code !== 0 && result.code !== 1) {
    return new Set(normalized.map((relative) => relative.toLowerCase()))
  }
  return new Set(result.stdout.split('\0').filter(Boolean).map((relative) => relative.toLowerCase()))
}

async function safeChildDirectories(parent) {
  try {
    const entries = await fsp.readdir(parent, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(parent, entry.name))
  } catch {
    return []
  }
}

async function isSafeCleanupDirectory(directory) {
  if (path.basename(directory).toLowerCase() === '.git') return false
  try {
    const stat = await fsp.lstat(directory)
    if (stat.isSymbolicLink()) return false
    return !(await pathExists(path.join(directory, '.git')))
  } catch {
    return false
  }
}

async function tryDeleteEmptyDirectory(directory) {
  try {
    const entries = await fsp.readdir(directory)
    if (entries.length) return false
    await fsp.rmdir(directory)
    return true
  } catch {
    return false
  }
}

async function cleanEmptyDirectories(repo) {
  if (!(await isGitRepository(repo))) throw new Error('目标不是有效 Git 仓库。')
  const root = path.resolve(repo)
  const levelOne = []
  for (const candidate of await safeChildDirectories(root)) {
    if (await isSafeCleanupDirectory(candidate)) levelOne.push(candidate)
  }
  const levelOneRel = levelOne.map((item) => path.relative(root, item))
  const ignoredOne = await gitIgnored(root, levelOneRel)
  const activeOne = levelOne.filter((item) => !ignoredOne.has(path.relative(root, item).toLowerCase()))

  const levelTwo = []
  for (const parent of activeOne) {
    for (const candidate of await safeChildDirectories(parent)) {
      if (await isSafeCleanupDirectory(candidate)) levelTwo.push(candidate)
    }
  }
  const levelTwoRel = levelTwo.map((item) => path.relative(root, item))
  const ignoredTwo = await gitIgnored(root, levelTwoRel)
  let deleted = 0
  for (const directory of levelTwo) {
    if (ignoredTwo.has(path.relative(root, directory).toLowerCase())) continue
    if (await tryDeleteEmptyDirectory(directory)) deleted += 1
  }
  for (const directory of activeOne) {
    if (await tryDeleteEmptyDirectory(directory)) deleted += 1
  }
  return deleted
}

async function openPath(targetPath) {
  if (!targetPath) return false
  if (window.ztools?.shellOpenPath) {
    await Promise.resolve(window.ztools.shellOpenPath(targetPath))
    return true
  }
  const child = spawn('explorer.exe', [targetPath], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return true
}

async function chooseDirectory(title) {
  if (!window.ztools?.showOpenDialog) return ''
  const result = await Promise.resolve(window.ztools.showOpenDialog({
    title: title || '选择目录',
    properties: ['openDirectory', 'createDirectory']
  }))
  if (!result) return ''
  if (Array.isArray(result)) return result[0] || ''
  if (Array.isArray(result.filePaths)) return result.filePaths[0] || ''
  return ''
}

function powershell(script, input = '') {
  return runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { input })
}

function validateMasterPassword(value) {
  const password = String(value || '')
  if (!password) throw new Error('主密码不能为空。')
  return password
}

function normalizeCredentialVault(vault) {
  if (!vault || Number(vault.version) !== CREDENTIAL_VERSION || vault.kdf?.name !== 'scrypt') return null
  if (!vault.kdf?.salt || !vault.verifier?.iv || !vault.verifier?.ciphertext || !vault.verifier?.tag) return null
  return { ...vault, generation: Math.max(1, Number(vault.generation) || 1) }
}

function normalizeCredentialPayload(payload) {
  if (!payload || Number(payload.version) !== CREDENTIAL_VERSION || payload.algorithm !== 'aes-256-gcm') return null
  if (!payload.iv || !payload.ciphertext || !payload.tag) return null
  return payload
}

function deriveCredentialKey(masterPassword, vault) {
  const normalized = normalizeCredentialVault(vault)
  if (!normalized) throw new Error('凭据加密配置无效。')
  const password = validateMasterPassword(masterPassword)
  return crypto.scryptSync(password, Buffer.from(normalized.kdf.salt, 'base64'), SCRYPT_KEY_LENGTH, {
    N: Number(normalized.kdf.N) || SCRYPT_N,
    r: Number(normalized.kdf.r) || SCRYPT_R,
    p: Number(normalized.kdf.p) || SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  })
}

function encryptWithCredentialKey(key, value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    version: CREDENTIAL_VERSION,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64')
  }
}

function decryptWithCredentialKey(key, payload) {
  const normalized = normalizeCredentialPayload(payload)
  if (!normalized) throw new Error('已保存的服务器凭据格式无效。')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(normalized.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(normalized.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(normalized.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

function clearCredentialKey() {
  if (credentialKey) credentialKey.fill(0)
  credentialKey = null
  credentialVaultTag = ''
}

function rememberCredentialKey(key, vault) {
  clearCredentialKey()
  credentialKey = Buffer.from(key)
  credentialVaultTag = String(vault?.verifier?.tag || '')
}

function isCredentialVaultUnlocked(vault) {
  const normalized = normalizeCredentialVault(vault)
  return Boolean(normalized && credentialKey && credentialVaultTag === String(normalized.verifier.tag || ''))
}

function requireCredentialKey(vault) {
  if (!isCredentialVaultUnlocked(vault)) throw new Error('服务器凭据已锁定，请先输入主密码解锁。')
  return credentialKey
}

function createCredentialVault(masterPassword, generation = 1) {
  const password = validateMasterPassword(masterPassword)
  const vault = {
    version: CREDENTIAL_VERSION,
    generation: Math.max(1, Number(generation) || 1),
    kdf: {
      name: 'scrypt',
      salt: crypto.randomBytes(16).toString('base64'),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    },
    verifier: null
  }
  const key = deriveCredentialKey(password, { ...vault, verifier: { iv: 'AA==', ciphertext: 'AA==', tag: 'AA==' } })
  vault.verifier = encryptWithCredentialKey(key, CREDENTIAL_SENTINEL)
  rememberCredentialKey(key, vault)
  key.fill(0)
  return vault
}

function unlockCredentialVault(vault, masterPassword) {
  const normalized = normalizeCredentialVault(vault)
  if (!normalized) throw new Error('尚未设置主密码。')
  let key
  try {
    key = deriveCredentialKey(masterPassword, normalized)
    const verifier = decryptWithCredentialKey(key, normalized.verifier)
    if (!crypto.timingSafeEqual(Buffer.from(verifier), Buffer.from(CREDENTIAL_SENTINEL))) {
      throw new Error('credential verifier mismatch')
    }
    rememberCredentialKey(key, normalized)
    return true
  } catch {
    clearCredentialKey()
    throw new Error('主密码不正确或凭据数据已损坏。')
  } finally {
    key?.fill(0)
  }
}

function lockCredentialVault() {
  clearCredentialKey()
  return true
}

function encryptCredential(value, vault) {
  if (!String(value || '')) throw new Error('服务器密码不能为空。')
  return encryptWithCredentialKey(requireCredentialKey(vault), value)
}

function decryptCredential(payload, vault) {
  try {
    return decryptWithCredentialKey(requireCredentialKey(vault), payload)
  } catch (error) {
    if (error?.message?.includes('锁定')) throw error
    throw new Error('无法解密服务器密码。请确认主密码正确且同步数据未损坏。')
  }
}

function rotateCredentialVault(vault, entries, newMasterPassword) {
  const currentKey = requireCredentialKey(vault)
  const plainEntries = (entries || []).map((entry) => ({
    id: String(entry.id || ''),
    value: decryptWithCredentialKey(currentKey, entry.credential)
  }))
  const normalizedVault = normalizeCredentialVault(vault)
  const nextVault = createCredentialVault(newMasterPassword, (normalizedVault?.generation || 1) + 1)
  const credentials = plainEntries.map((entry) => ({
    id: entry.id,
    credential: encryptCredential(entry.value, nextVault)
  }))
  return { vault: nextVault, credentials }
}

async function unprotectLegacySecret(value) {
  if (!value) return ''
  const script = [
    '$inputBase64=[Console]::In.ReadToEnd().Trim();',
    '$enc=[Convert]::FromBase64String($inputBase64);',
    `$entropy=[Text.Encoding]::UTF8.GetBytes('${LEGACY_DPAPI_ENTROPY}');`,
    '$bytes=[System.Security.Cryptography.ProtectedData]::Unprotect($enc,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Convert]::ToBase64String($bytes)'
  ].join(' ')
  const result = ensureCommand(await powershell(script, String(value)), '无法读取旧版 Windows DPAPI 密码')
  const plainBase64 = result.stdout.trim()
  return plainBase64 ? Buffer.from(plainBase64, 'base64').toString('utf8') : ''
}


async function getInitialSettings() {
  const preferredRepo = 'E:\\GitHub'
  const preferredDownloads = 'E:\\软件数据\\Edge下载'
  const fallbackDownloads = path.join(os.homedir(), 'Downloads')
  const defaults = {
    repositoryRoots: (await pathExists(preferredRepo)) ? [preferredRepo] : [],
    downloadDirectory: (await pathExists(preferredDownloads)) ? preferredDownloads : fallbackDownloads,
    commitMessage: 'Update files from ChatGPT',
    lastRepositoryPath: '',
    themeMode: 'system',
    servers: []
  }

  const legacyPath = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ChatGPTGitBridge', 'settings.json')
  let legacy
  try {
    legacy = JSON.parse(await fsp.readFile(legacyPath, 'utf8'))
  } catch {
    return { settings: defaults, importedLegacy: false, legacyPath }
  }

  const roots = Array.isArray(legacy.RepositoryRoots) && legacy.RepositoryRoots.length
    ? legacy.RepositoryRoots
    : (legacy.RepositoryRoot ? [legacy.RepositoryRoot] : defaults.repositoryRoots)
  const themeMap = { 0: 'system', 1: 'light', 2: 'dark', System: 'system', Light: 'light', Dark: 'dark' }
  let servers = Array.isArray(legacy.Servers) ? legacy.Servers.map((server) => ({
    id: String(server.Id || crypto.randomUUID()),
    name: String(server.Name || ''),
    enabled: server.Enabled !== false,
    host: String(server.Host || ''),
    port: Number(server.Port) || 22,
    username: String(server.Username || ''),
    encryptedPassword: String(server.EncryptedPassword || ''),
    remoteRoot: String(server.RemoteRoot || '~/app'),
    hostFingerprint: String(server.HostFingerprint || '')
  })) : []
  if (!servers.length && (legacy.SshHost || legacy.SshUsername || legacy.EncryptedSshPassword)) {
    servers = [{
      id: crypto.randomUUID(),
      name: '',
      enabled: legacy.ServerSyncEnabled !== false,
      host: String(legacy.SshHost || ''),
      port: Number(legacy.SshPort) || 22,
      username: String(legacy.SshUsername || ''),
      encryptedPassword: String(legacy.EncryptedSshPassword || ''),
      remoteRoot: String(legacy.SshRemoteRoot || '~/app'),
      hostFingerprint: String(legacy.SshHostFingerprint || '')
    }]
  }

  return {
    settings: {
      repositoryRoots: roots.map((item) => String(item || '')).filter(Boolean),
      downloadDirectory: String(legacy.DownloadDirectory || defaults.downloadDirectory),
      commitMessage: String(legacy.CommitMessage || defaults.commitMessage),
      lastRepositoryPath: String(legacy.LastRepositoryPath || ''),
      themeMode: themeMap[legacy.ThemeMode] || 'system',
      servers
    },
    importedLegacy: true,
    legacyPath
  }
}

function normalizeFingerprint(value) {
  const text = String(value || '').trim().replace(/\s+/g, '')
  if (!text) return ''
  if (!/^sha256:/i.test(text)) return text
  return `SHA256:${text.slice(7).replace(/=+$/, '')}`
}

function fingerprintKey(key) {
  const digest = crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

function validateServer(options) {
  if (!String(options?.host || '').trim()) throw new Error('服务器地址不能为空。')
  const port = Number(options?.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口必须在 1–65535 之间。')
  if (!String(options?.username || '').trim()) throw new Error('SSH 用户名不能为空。')
  if (!String(options?.password || '')) throw new Error('SSH 密码不能为空。')
  if (!String(options?.remoteRoot || '').trim()) throw new Error('服务器仓库根目录不能为空。')
}

function connectSsh(options) {
  validateServer(options)
  const { Client } = requireDependency('ssh2')
  return new Promise((resolve, reject) => {
    const client = new Client()
    let observedFingerprint = ''
    let settled = false
    const finishReject = (error) => {
      if (settled) return
      settled = true
      try { client.end() } catch {}
      reject(error)
    }
    client.on('ready', () => {
      if (settled) return
      settled = true
      resolve({ client, hostFingerprint: observedFingerprint })
    })
    client.on('error', (error) => {
      const expected = normalizeFingerprint(options.expectedHostFingerprint)
      if (expected && observedFingerprint && expected !== normalizeFingerprint(observedFingerprint)) {
        finishReject(new Error(`SSH 主机指纹与已保存值不一致。已保存：${expected}；当前：${observedFingerprint}`))
        return
      }
      finishReject(error)
    })
    client.connect({
      host: String(options.host).trim(),
      port: Number(options.port),
      username: String(options.username).trim(),
      password: String(options.password),
      readyTimeout: 12000,
      keepaliveInterval: 15000,
      hostVerifier: (key) => {
        observedFingerprint = fingerprintKey(key)
        const expected = normalizeFingerprint(options.expectedHostFingerprint)
        return !expected || expected === normalizeFingerprint(observedFingerprint)
      }
    })
  })
}

function executeSsh(client, commandText, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('远程命令执行超时。'))
    }, timeoutMs)

    client.exec(String(commandText).replace(/\r\n/g, '\n').replace(/\r/g, '\n'), (error, stream) => {
      if (error) {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(error)
        }
        return
      }
      let stdout = ''
      let stderr = ''
      stream.setEncoding('utf8')
      stream.stderr.setEncoding('utf8')
      stream.on('data', (chunk) => { stdout += chunk })
      stream.stderr.on('data', (chunk) => { stderr += chunk })
      stream.on('close', (code) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        resolve({ code: Number.isInteger(code) ? code : -1, stdout, stderr })
      })
    })
  })
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function remoteRootWord(value) {
  let root = String(value || '~/app').trim().replace(/\/+$/, '')
  if (!root || root === '~') return '$HOME'
  if (root.startsWith('~/')) return `$HOME/${shellQuote(root.slice(2))}`
  return shellQuote(root)
}

function parseMarker(output, marker) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const line = [...lines].reverse().find((item) => item.startsWith(marker))
  return line ? line.slice(marker.length).trim() : ''
}

function parseBlock(output, startMarker, endMarker) {
  const normalized = String(output || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const startIndex = normalized.indexOf(startMarker)
  if (startIndex < 0) return ''
  const start = startIndex + startMarker.length
  const end = normalized.indexOf(endMarker, start)
  if (end < 0) return ''
  return normalized.slice(start, end).trim()
}

function commandError(prefix, result) {
  const detail = [String(result.stdout || '').trim(), String(result.stderr || '').trim()].filter(Boolean).join(os.EOL)
  return detail ? `${prefix}（退出码 ${result.code}）：${os.EOL}${detail}` : `${prefix}（退出码 ${result.code}）。`
}

async function withSsh(options, callback) {
  const connection = await connectSsh(options)
  try {
    return await callback(connection.client, connection.hostFingerprint)
  } finally {
    try { connection.client.end() } catch {}
  }
}

async function testServer(options) {
  return withSsh(options, async (client, hostFingerprint) => {
    const root = remoteRootWord(options.remoteRoot)
    const command = [
      `root=${root}`,
      'if [ ! -d "$root" ]; then echo "服务器仓库根目录不存在：$root" >&2; exit 42; fi',
      'count=0',
      'for d in "$root"/*; do [ -d "$d" ] || continue; [ -e "$d/.git" ] || continue; count=$((count + 1)); done',
      `printf '__COUNT__=%s\\n' "$count"`
    ].join('\n')
    const result = await executeSsh(client, command, 30000)
    if (result.code !== 0) return { success: false, message: commandError('SSH 已连接，但服务器路径扫描失败', result), repositoryCount: 0, hostFingerprint }
    const count = Number(parseMarker(result.stdout, '__COUNT__=')) || 0
    return { success: true, message: `SSH 连接成功，服务器根目录中发现 ${count} 个 Git 仓库。`, repositoryCount: count, hostFingerprint }
  })
}

async function inspectServerRepository(options, repositoryName) {
  return withSsh(options, async (client, hostFingerprint) => {
    const root = remoteRootWord(options.remoteRoot)
    const repoWord = shellQuote(repositoryName)
    const command = [
      `root=${root}`,
      `repo="$root"/${repoWord}`,
      `if [ ! -d "$repo" ] || [ ! -e "$repo/.git" ]; then printf '__SKIP__=missing-repository\\n'; exit 0; fi`,
      'cd "$repo" || exit 45',
      `printf '__STATUS_BEGIN__\\n'`,
      'git status --porcelain',
      'status_rc=$?',
      `printf '__STATUS_END__\\n'`,
      'exit "$status_rc"'
    ].join('\n')
    const result = await executeSsh(client, command, 30000)
    const skipReason = parseMarker(result.stdout, '__SKIP__=')
    if (skipReason === 'missing-repository') {
      return { success: true, skipped: true, reason: skipReason, status: '', hostFingerprint }
    }
    if (result.code !== 0) throw new Error(commandError('无法读取服务器仓库状态', result))
    return { success: true, skipped: false, status: parseBlock(result.stdout, '__STATUS_BEGIN__', '__STATUS_END__'), hostFingerprint }
  })
}

async function checkpointServer(options, repositoryName, message) {
  return withSsh(options, async (client, hostFingerprint) => {
    const root = remoteRootWord(options.remoteRoot)
    const repoWord = shellQuote(repositoryName)
    const command = [
      `root=${root}`,
      `repo="$root"/${repoWord}`,
      'cd "$repo" || exit 45',
      'git add -A || exit $?',
      `git commit -m ${shellQuote(message)} || exit $?`,
      'git rev-parse HEAD'
    ].join('\n')
    const result = await executeSsh(client, command, 120000)
    if (result.code !== 0) throw new Error(commandError('服务器修改备份 Commit 创建失败', result))
    const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    return { success: true, head: lines.at(-1) || '', hostFingerprint }
  })
}

async function runSyncAttempt(options, repositoryName) {
  return withSsh(options, async (client, hostFingerprint) => {
    const root = remoteRootWord(options.remoteRoot)
    const repoWord = shellQuote(repositoryName)
    const inspectCommand = [
      `root=${root}`,
      `repo="$root"/${repoWord}`,
      `if [ ! -d "$repo" ] || [ ! -e "$repo/.git" ]; then printf '__SKIP__=missing-repository\\n'; exit 0; fi`,
      'cd "$repo" || exit 45',
      `printf '__STATUS_BEGIN__\\n'`,
      'git status --porcelain',
      'status_rc=$?',
      `printf '__STATUS_END__\\n'`,
      'exit "$status_rc"'
    ].join('\n')
    const inspection = await executeSsh(client, inspectCommand, 30000)
    const skipReason = parseMarker(inspection.stdout, '__SKIP__=')
    if (skipReason === 'missing-repository') {
      return { success: true, skipped: true, reason: skipReason, status: '', message: `服务器中没有同名 Git 仓库“${repositoryName}”，已跳过同步。`, mode: 'skipped', head: '', hostFingerprint }
    }
    if (inspection.code !== 0) {
      return { success: false, skipped: false, message: commandError('无法读取服务器仓库状态', inspection), mode: 'status-check', head: '', hostFingerprint }
    }
    const status = parseBlock(inspection.stdout, '__STATUS_BEGIN__', '__STATUS_END__')
    if (status) {
      return { success: true, skipped: false, requiresDecision: true, status, message: '服务器仓库存在未提交修改，需要用户决定后再继续。', mode: 'status-check', head: '', hostFingerprint }
    }

    const command = [
      `root=${root}`,
      `repo="$root"/${repoWord}`,
      'cd "$repo" || exit 45',
      `if [ -f sync.sh ]; then printf '__MODE__=sync.sh\\n'; bash ./sync.sh; else printf '__MODE__=git-pull\\n'; git pull --ff-only; fi`,
      'sync_rc=$?',
      'if [ "$sync_rc" -ne 0 ]; then exit "$sync_rc"; fi',
      `find . -mindepth 1 -maxdepth 1 -type d ! -name .git -print | while IFS= read -r parent; do`,
      `  parent_rel=$(printf '%s\\n' "$parent" | sed 's#^\\./##')`,
      '  git check-ignore -q -- "$parent_rel" && continue',
      '  [ -e "$parent/.git" ] && continue',
      `  find "$parent" -mindepth 1 -maxdepth 1 -type d -print | while IFS= read -r child; do`,
      `    child_rel=$(printf '%s\\n' "$child" | sed 's#^\\./##')`,
      '    git check-ignore -q -- "$child_rel" && continue',
      '    [ -e "$child/.git" ] && continue',
      '    rmdir -- "$child" 2>/dev/null || true',
      '  done',
      '  rmdir -- "$parent" 2>/dev/null || true',
      'done',
      'head_sha=$(git rev-parse HEAD) || exit $?',
      `printf '\\n__HEAD__=%s\\n' "$head_sha"`
    ].join('\n')
    const result = await executeSsh(client, command, 600000)
    const mode = parseMarker(result.stdout, '__MODE__=')
    const head = parseMarker(result.stdout, '__HEAD__=')
    if (result.code !== 0) return { success: false, skipped: false, message: commandError('远程同步命令失败', result), mode, head, hostFingerprint }
    if (!head) return { success: false, skipped: false, message: '远程同步命令已结束，但未能读取服务器仓库 HEAD。', mode, head, hostFingerprint }
    return { success: true, skipped: false, message: result.stdout.trim(), mode: mode || 'unknown', head, hostFingerprint }
  })
}

async function syncServer(options, repositoryName, expectedCommitSha) {
  let last = { success: false, message: '服务器同步未执行。', mode: '', head: '', hostFingerprint: '' }
  for (let index = 0; index < RETRY_DELAYS_MS.length; index += 1) {
    const delay = RETRY_DELAYS_MS[index]
    if (delay > 0) {
      emit('server-sync-progress', { server: String(options.host || ''), message: `等待 ${delay / 1000} 秒后重试服务器同步…`, attempt: index + 1 })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    emit('server-sync-progress', { server: String(options.host || ''), message: `服务器同步尝试 ${index + 1}/${RETRY_DELAYS_MS.length}…`, attempt: index + 1 })
    try {
      last = await runSyncAttempt(options, repositoryName)
      if (last.skipped || last.requiresDecision) {
        return { ...last, attempts: index + 1 }
      }
      if (last.success && String(last.head).toLowerCase() === String(expectedCommitSha).toLowerCase()) {
        return { ...last, attempts: index + 1, message: `服务器同步成功：${last.mode}，HEAD=${String(last.head).slice(0, 8)}` }
      }
      if (last.success) {
        last = { ...last, success: false, message: `服务器 HEAD 尚未更新：远程 ${String(last.head).slice(0, 8)}，期望 ${String(expectedCommitSha).slice(0, 8)}。` }
      }
      emit('server-sync-progress', { server: String(options.host || ''), message: last.message, attempt: index + 1 })
    } catch (error) {
      last = { success: false, message: error.message, mode: '', head: '', hostFingerprint: '' }
      emit('server-sync-progress', { server: String(options.host || ''), message: `服务器同步失败：${error.message}`, attempt: index + 1 })
    }
  }
  return { ...last, attempts: RETRY_DELAYS_MS.length }
}

window.gitBridgeApi = {
  defaults: {
    commitMessage: 'Update files from ChatGPT',
    localCheckpointMessage: DEFAULT_LOCAL_CHECKPOINT_MESSAGE,
    serverCheckpointMessage: DEFAULT_SERVER_CHECKPOINT_MESSAGE,
    remoteRoot: '~/app',
    sshPort: 22
  },
  chooseDirectory,
  getInitialSettings,
  scanRepositories,
  listZips,
  watchZipDirectory,
  stopZipWatcher,
  analyzePackage,
  applyPackage,
  ensureGit,
  getWorkingTreeStatus,
  pullFastForward,
  stage,
  commit,
  push,
  getHeadSha,
  rollback,
  cleanEmptyDirectories,
  openPath,
  createCredentialVault,
  unlockCredentialVault,
  lockCredentialVault,
  isCredentialVaultUnlocked,
  encryptCredential,
  decryptCredential,
  rotateCredentialVault,
  unprotectLegacySecret,
  testServer,
  inspectServerRepository,
  checkpointServer,
  syncServer
}

window.ztools?.onPluginEnter((action) => emit('plugin-enter', { action: action || null }))
window.ztools?.onPluginOut((isKill) => {
  stopZipWatcher()
  lockCredentialVault()
  emit('plugin-out', { isKill: Boolean(isKill) })
})

'use strict'

const api = window.gitBridgeApi

const SETTINGS_DOC_ID = 'git-bridge-settings'
const LEGACY_LOCAL_STORAGE_KEY = 'git-bridge-settings'

const DEFAULT_SETTINGS = {
  repositoryRoots: [],
  downloadDirectory: '',
  commitMessage: api?.defaults?.commitMessage || 'Update files from ChatGPT',
  lastRepositoryPath: '',
  themeMode: 'system',
  credentialVault: null,
  servers: []
}

const state = {
  settings: normalizeSettings({ ...DEFAULT_SETTINGS }),
  repositories: [],
  zips: [],
  zipSelectionMode: 'auto',
  manualZipPath: '',
  log: '',
  busy: false,
  credentialGeneration: 0
}

const el = {}

function $(id) { return document.getElementById(id) }

function sendWindowCommand(type) {
  try {
    window.ztools?.dbPut?.('git-bridge-window-command', {
      type,
      token: `${Date.now()}-${Math.random().toString(36).slice(2)}`
    })
  } catch (error) {
    console.warn('Failed to send window command:', error)
  }
}

function normalizeSettings(input) {
  const roots = Array.isArray(input.repositoryRoots) ? input.repositoryRoots : []
  const servers = Array.isArray(input.servers) ? input.servers : []
  return {
    repositoryRoots: [...new Set(roots.map((item) => String(item || '').trim()).filter(Boolean))],
    downloadDirectory: String(input.downloadDirectory || ''),
    commitMessage: String(input.commitMessage || DEFAULT_SETTINGS.commitMessage),
    lastRepositoryPath: String(input.lastRepositoryPath || ''),
    themeMode: ['system', 'light', 'dark'].includes(input.themeMode) ? input.themeMode : 'system',
    credentialVault: normalizeCredentialVault(input.credentialVault),
    servers: servers.map(normalizeServer)
  }
}

function normalizeCredentialVault(vault) {
  if (!vault || Number(vault.version) !== 1 || vault.kdf?.name !== 'scrypt') return null
  const verifier = normalizeCredential(vault.verifier)
  if (!vault.kdf?.salt || !verifier) return null
  return {
    version: 1,
    generation: Math.max(1, Number(vault.generation) || 1),
    kdf: {
      name: 'scrypt',
      salt: String(vault.kdf.salt),
      N: Number(vault.kdf.N) || 32768,
      r: Number(vault.kdf.r) || 8,
      p: Number(vault.kdf.p) || 1
    },
    verifier
  }
}

function normalizeCredential(credential) {
  if (!credential || Number(credential.version) !== 1 || credential.algorithm !== 'aes-256-gcm') return null
  if (!credential.iv || !credential.ciphertext || !credential.tag) return null
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: String(credential.iv),
    ciphertext: String(credential.ciphertext),
    tag: String(credential.tag)
  }
}

function normalizeServer(server = {}) {
  return {
    id: String(server.id || crypto.randomUUID()),
    name: String(server.name || ''),
    enabled: server.enabled !== false,
    host: String(server.host || ''),
    port: Number(server.port) || 22,
    username: String(server.username || ''),
    credential: normalizeCredential(server.credential),
    encryptedPassword: String(server.encryptedPassword || ''),
    remoteRoot: String(server.remoteRoot || '~/app'),
    hostFingerprint: String(server.hostFingerprint || '')
  }
}

function readSettingsDocument() {
  const db = window.ztools?.db
  if (!db?.get) throw new Error('当前 ZTools 版本不支持插件数据库。')
  const doc = db.get(SETTINGS_DOC_ID)
  if (!doc) return null
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...(doc.settings || {}) })
}

function credentialGeneration(vault) {
  return vault ? Math.max(1, Number(vault.generation) || 1) : 0
}

function assertCredentialWriteCurrent() {
  const latest = readSettingsDocument()
  const latestGeneration = credentialGeneration(latest?.credentialVault)
  if (latestGeneration !== state.credentialGeneration) {
    throw new Error('凭据配置已在其他设备更新，请重新打开 Git Bridge 后再修改。')
  }
}

function refreshCredentialStateFromDatabase() {
  const latest = readSettingsDocument()
  if (!latest) return false
  const latestGeneration = credentialGeneration(latest.credentialVault)
  if (latestGeneration === state.credentialGeneration) return false
  state.settings.credentialVault = latest.credentialVault
  state.settings.servers = latest.servers
  state.credentialGeneration = latestGeneration
  updateServerSummary()
  updateCredentialUi()
  return true
}

function writeSettingsDocument(settings, { credentialSensitive = false, bumpCredential = false } = {}) {
  const db = window.ztools?.db
  if (!db?.get || !db?.put) throw new Error('当前 ZTools 版本不支持插件数据库。')
  const existing = db.get(SETTINGS_DOC_ID)
  let normalized = normalizeSettings(settings)
  const latest = existing ? normalizeSettings({ ...DEFAULT_SETTINGS, ...(existing.settings || {}) }) : null
  const latestGeneration = credentialGeneration(latest?.credentialVault)

  if (latestGeneration !== state.credentialGeneration) {
    if (credentialSensitive) {
      throw new Error('凭据配置已在其他设备更新，请重新打开 Git Bridge 后再修改。')
    }
    if (latest) {
      normalized = normalizeSettings({
        ...normalized,
        credentialVault: latest.credentialVault,
        servers: latest.servers
      })
    }
  }

  if (bumpCredential && normalized.credentialVault) {
    normalized.credentialVault = {
      ...normalized.credentialVault,
      generation: Math.max(latestGeneration, credentialGeneration(normalized.credentialVault)) + 1
    }
  }

  const doc = { _id: SETTINGS_DOC_ID, settings: normalized }
  if (existing?._rev) doc._rev = existing._rev
  const result = db.put(doc)
  if (!result?.ok) {
    const detail = result?.message || result?.error || '未知错误'
    throw new Error('保存 ZTools 数据库失败：' + detail)
  }
  state.credentialGeneration = credentialGeneration(normalized.credentialVault)
  return normalized
}

function readLegacyLocalSettings() {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY)
    if (!raw) return null
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) })
  } catch {
    return null
  }
}

function saveSettings(options = {}) {
  state.settings.downloadDirectory = el.downloadDirectory.value.trim()
  state.settings.commitMessage = el.commitMessage.value.trim() || DEFAULT_SETTINGS.commitMessage
  state.settings.themeMode = el.themeMode.value
  const selectedRepo = selectedRepository()
  if (selectedRepo) state.settings.lastRepositoryPath = selectedRepo.path
  state.settings = writeSettingsDocument(state.settings, options)
  updateRepoRootsSummary()
  updateServerSummary()
  updateCredentialUi()
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function setStatus(message, tone = 'normal') {
  el.status.textContent = message
  el.status.dataset.tone = tone
}

function setServerStatus(message, tone = 'muted') {
  el.serverStatus.textContent = message
  el.serverStatus.dataset.tone = tone
}

function log(message) {
  const text = String(message || '').trimEnd()
  if (!text) return
  state.log += `${state.log ? '\n' : ''}${text}`
  updateCopyLogButton()
}

function replaceLog(message) {
  state.log = String(message || '').trimEnd()
  updateCopyLogButton()
}

function updateCopyLogButton() {
  el.copyLog.disabled = !state.log
}

function setBusy(value, message = '') {
  state.busy = Boolean(value)
  document.body.classList.toggle('is-busy', state.busy)
  for (const button of document.querySelectorAll('button[data-operation]')) button.disabled = state.busy
  if (message) setStatus(message, 'info')
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.themeMode
}

function updateRepoRootsSummary() {
  const roots = state.settings.repositoryRoots
  el.repoRootsSummary.value = roots.length ? (roots.length === 1 ? roots[0] : `${roots.length} 个目录`) : '未配置'
}

function updateServerSummary() {
  const total = state.settings.servers.length
  const enabled = state.settings.servers.filter((server) => server.enabled).length
  el.serverSummary.textContent = total ? `${enabled}/${total} 台已启用` : '未配置服务器'
  setServerStatus(enabled ? `服务器：${enabled} 台已启用` : '服务器：未启用', enabled ? 'normal' : 'muted')
}

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

function closeDropdown(root, trigger, menu) {
  root?.classList.remove('is-open')
  if (menu) menu.hidden = true
  trigger?.setAttribute('aria-expanded', 'false')
}

function closeAllDropdowns(except = null) {
  if (except !== el.repositoryDropdown) closeDropdown(el.repositoryDropdown, el.repositoryTrigger, el.repositoryMenu)
  if (except !== el.themeDropdown) closeDropdown(el.themeDropdown, el.themeTrigger, el.themeMenu)
}

function openDropdown(root, trigger, menu) {
  closeAllDropdowns(root)
  root.classList.add('is-open')
  menu.hidden = false
  trigger.setAttribute('aria-expanded', 'true')
}

function renderRepositoryOptions(query = '') {
  const needle = String(query || '').trim().toLowerCase()
  const items = state.repositories.filter((repo) => !needle || repo.display.toLowerCase().includes(needle) || repo.path.toLowerCase().includes(needle))
  el.repositoryOptions.innerHTML = ''
  if (!items.length) {
    el.repositoryOptions.innerHTML = '<div class="custom-select-empty">没有匹配的仓库</div>'
    return
  }
  for (const repo of items) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'custom-select-option'
    button.classList.toggle('is-selected', repo.path === el.repository.value)
    button.textContent = repo.display
    button.title = repo.path
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', repo.path === el.repository.value ? 'true' : 'false')
    button.addEventListener('click', () => {
      el.repository.value = repo.path
      el.repositoryDisplay.textContent = repo.display
      state.settings.lastRepositoryPath = repo.path
      saveSettings()
      closeDropdown(el.repositoryDropdown, el.repositoryTrigger, el.repositoryMenu)
    })
    el.repositoryOptions.appendChild(button)
  }
}

function renderRepositories() {
  const desired = state.settings.lastRepositoryPath
  if (!state.repositories.length) {
    el.repository.value = ''
    el.repositoryDisplay.textContent = '暂无仓库'
    renderRepositoryOptions()
    return
  }
  const match = state.repositories.find((repo) => repo.path.toLowerCase() === desired.toLowerCase()) || state.repositories[0]
  el.repository.value = match.path
  el.repositoryDisplay.textContent = match.display
  state.settings.lastRepositoryPath = match.path
  renderRepositoryOptions(el.repositorySearch.value)
}

function renderThemeOptions() {
  el.themeOptions.innerHTML = ''
  for (const item of THEME_OPTIONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'custom-select-option'
    button.classList.toggle('is-selected', item.value === el.themeMode.value)
    button.textContent = item.label
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', item.value === el.themeMode.value ? 'true' : 'false')
    button.addEventListener('click', () => {
      el.themeMode.value = item.value
      el.themeDisplay.textContent = item.label
      state.settings.themeMode = item.value
      applyTheme()
      saveSettings()
      renderThemeOptions()
      closeDropdown(el.themeDropdown, el.themeTrigger, el.themeMenu)
    })
    el.themeOptions.appendChild(button)
  }
}

function syncThemeDropdown() {
  const item = THEME_OPTIONS.find((option) => option.value === state.settings.themeMode) || THEME_OPTIONS[0]
  el.themeMode.value = item.value
  el.themeDisplay.textContent = item.label
  renderThemeOptions()
}

function renderZips() {
  const tbody = el.zipTableBody
  tbody.innerHTML = ''
  for (const [index, item] of state.zips.entries()) {
    const row = document.createElement('tr')
    row.dataset.path = item.path
    row.innerHTML = `<td class="zip-name">${escapeHtml(item.name)}</td><td>${escapeHtml(item.modified)}</td><td class="numeric">${escapeHtml(item.size)}</td>`
    row.addEventListener('click', () => selectZip(item.path, index === 0 ? 'auto' : 'manual'))
    row.addEventListener('dblclick', () => previewPackage())
    tbody.appendChild(row)
  }
  restoreZipSelection()
}

function restoreZipSelection() {
  if (!state.zips.length) {
    el.zipEmpty.hidden = false
    return
  }
  el.zipEmpty.hidden = true
  let selectedPath = state.zips[0].path
  if (state.zipSelectionMode === 'manual' && state.manualZipPath) {
    const found = state.zips.find((item) => item.path.toLowerCase() === state.manualZipPath.toLowerCase())
    if (found) selectedPath = found.path
    else {
      state.zipSelectionMode = 'auto'
      state.manualZipPath = ''
    }
  }
  markZipSelected(selectedPath)
}

function markZipSelected(zipPath) {
  for (const row of el.zipTableBody.querySelectorAll('tr')) row.classList.toggle('selected', row.dataset.path === zipPath)
  el.zipTableBody.dataset.selectedPath = zipPath || ''
}

function selectZip(zipPath, mode) {
  const index = state.zips.findIndex((item) => item.path === zipPath)
  state.zipSelectionMode = index === 0 && mode === 'auto' ? 'auto' : 'manual'
  state.manualZipPath = state.zipSelectionMode === 'manual' ? zipPath : ''
  markZipSelected(zipPath)
}

function selectedZip() {
  const selected = el.zipTableBody.dataset.selectedPath
  return state.zips.find((item) => item.path === selected) || null
}

function selectedRepository() {
  return state.repositories.find((repo) => repo.path === el.repository.value) || null
}

function getSelection() {
  const repo = selectedRepository()
  const zip = selectedZip()
  if (!repo) throw new Error('请选择目标仓库。')
  if (!zip) throw new Error('请选择 ZIP 更新包。')
  return { repository: repo.path, zip: zip.path }
}

async function refreshRepositories() {
  state.repositories = await api.scanRepositories(state.settings.repositoryRoots)
  renderRepositories()
}

async function refreshZips({ updateStatus = true } = {}) {
  state.zips = await api.listZips(el.downloadDirectory.value.trim())
  renderZips()
  if (!updateStatus) return
  if (!el.downloadDirectory.value.trim()) setStatus('请先配置 ZIP 下载目录', 'warning')
  else if (!state.zips.length) setStatus(`发现 ${state.repositories.length} 个仓库；ZIP 下载目录中暂无 ZIP`, 'warning')
  else setStatus(`发现 ${state.repositories.length} 个仓库、${state.zips.length} 个 ZIP；正在自动监测下载目录`, 'normal')
}

async function configureZipWatcher({ updateStatus = true } = {}) {
  const active = await api.watchZipDirectory(el.downloadDirectory.value.trim())
  if (updateStatus && !active && el.downloadDirectory.value.trim()) setStatus('ZIP 自动监测未启动，可使用刷新按钮', 'warning')
}

async function refreshAll({ updateStatus = !state.busy } = {}) {
  saveSettings()
  await refreshRepositories()
  await refreshZips({ updateStatus })
  await configureZipWatcher({ updateStatus })
}

function groupChanges(plan) {
  const groups = [
    ['add', '新增 (A)'],
    ['modify', '修改 (M)'],
    ['delete', '删除 (D)'],
    ['unchanged', '内容相同 (=)'],
    ['delete-missing', '删除目标不存在 (!)']
  ]
  const lines = [`ZIP:  ${plan.zipPath}`, `Repo: ${plan.repositoryPath}`, '']
  for (const [kind, title] of groups) {
    const items = plan.changes.filter((item) => item.kind === kind).sort((a, b) => a.path.localeCompare(b.path))
    if (!items.length) continue
    lines.push(title)
    for (const item of items) lines.push(`  ${item.path}`)
    lines.push('')
  }
  lines.push(`实际变更：${plan.actionableCount}`)
  return lines.join('\n')
}

function modal({ title, body, actions = [], wide = false, dangerous = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `<section class="modal ${wide ? 'modal-wide' : ''} ${dangerous ? 'modal-danger' : ''}" role="dialog" aria-modal="true"><header><h2>${escapeHtml(title)}</h2></header><div class="modal-body"></div><footer></footer></section>`
    const bodyHost = overlay.querySelector('.modal-body')
    if (typeof body === 'string') bodyHost.innerHTML = body
    else bodyHost.appendChild(body)
    const footer = overlay.querySelector('footer')
    const close = (value) => {
      document.removeEventListener('keydown', onKey)
      overlay.remove()
      resolve(value)
    }
    const onKey = (event) => { if (event.key === 'Escape') close(null) }
    document.addEventListener('keydown', onKey)
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(null) })
    for (const [index, action] of actions.entries()) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = action.label
      button.className = action.className || (index === actions.length - 1 ? 'btn-primary' : 'btn-secondary')
      button.addEventListener('click', async () => {
        try {
          if (action.beforeClose) {
            const result = await action.beforeClose(overlay)
            if (result === false) return
            close(result === undefined ? action.value : result)
          } else close(action.value)
        } catch (error) { showToast(error.message, 'error') }
      })
      footer.appendChild(button)
    }
    document.body.appendChild(overlay)
    requestAnimationFrame(() => footer.querySelector('button:last-child')?.focus())
  })
}

function textAreaBlock(text) {
  const host = document.createElement('div')
  host.className = 'dialog-stack'
  const area = document.createElement('textarea')
  area.className = 'mono-view'
  area.readOnly = true
  area.value = text
  host.appendChild(area)
  return host
}

async function showPreview(plan) {
  const text = groupChanges(plan)
  replaceLog(text)
  await modal({
    title: `ZIP 预览 · ${plan.actionableCount} 项实际变化`,
    body: textAreaBlock(text),
    wide: true,
    actions: [{ label: '关闭', value: true, className: 'btn-primary' }]
  })
}

async function confirmAction(title, description, details) {
  const body = document.createElement('div')
  body.className = 'dialog-stack'
  body.innerHTML = `<p>${escapeHtml(description)}</p><div class="detail-box">${details.map((item) => `<div>${escapeHtml(item)}</div>`).join('')}</div>`
  return Boolean(await modal({
    title,
    body,
    actions: [
      { label: '取消', value: false, className: 'btn-secondary' },
      { label: '继续', value: true, className: 'btn-primary' }
    ]
  }))
}

async function promptRepositoryChanges({ title, description, location, status, defaultMessage, cancelText, confirmText }) {
  const body = document.createElement('div')
  body.className = 'dialog-stack'
  body.innerHTML = `<p>${escapeHtml(description)}</p><div class="muted">位置：${escapeHtml(location)}</div><textarea class="mono-view compact" readonly>${escapeHtml(status)}</textarea><label class="field"><span>Commit Message</span><input id="checkpoint-message" value="${escapeHtml(defaultMessage)}"></label>`
  const result = await modal({
    title,
    body,
    wide: true,
    actions: [
      { label: cancelText, value: null, className: 'btn-secondary' },
      {
        label: confirmText,
        className: 'btn-primary',
        beforeClose: (overlay) => {
          const value = overlay.querySelector('#checkpoint-message').value.trim()
          if (!value) { showToast('Commit Message 不能为空。', 'warning'); return false }
          return value
        }
      }
    ]
  })
  return result
}

async function ensureLocalChangesCheckpointed(repo) {
  const status = await api.getWorkingTreeStatus(repo, { cleanEmptyDirectories: false })
  if (!status) return
  const message = await promptRepositoryChanges({
    title: '检测到本地未提交修改',
    description: '目标仓库中存在尚未提交的本地修改。是否先保存这些修改，然后继续应用 ZIP 更新包？',
    location: repo,
    status,
    defaultMessage: api.defaults.localCheckpointMessage,
    cancelText: '取消任务',
    confirmText: '提交并继续'
  })
  if (!message) throw new DOMException('用户取消了任务。', 'AbortError')
  const staged = await api.stage(repo)
  if (!staged) throw new Error('检测到工作区修改，但 git add -A 后没有可提交内容。')
  await api.commit(repo, message)
  log(`已保存本地修改 checkpoint：\n${staged}`)
}

function updateCredentialUi() {
  if (!el.credentialStatus || !el.credentialPrimary || !el.credentialSecondary) return
  const vault = state.settings.credentialVault
  const unlocked = Boolean(vault && api.isCredentialVaultUnlocked(vault))
  if (!vault) {
    el.credentialStatus.textContent = '未设置'
    el.credentialPrimary.textContent = '设置主密码'
    el.credentialSecondary.hidden = true
    return
  }
  el.credentialStatus.textContent = unlocked ? '已设置 · 已解锁' : '已设置 · 待解锁'
  el.credentialPrimary.textContent = unlocked ? '修改主密码' : '解锁'
  el.credentialSecondary.hidden = true
}

async function promptMasterPassword(title, { confirmNew = false, description = '' } = {}) {
  const body = document.createElement('div')
  body.className = 'dialog-stack'
  body.innerHTML = `${description ? `<p>${escapeHtml(description)}</p>` : ''}<label class="field"><span>${confirmNew ? '新主密码' : '主密码'}</span><input id="master-password" type="password" autocomplete="${confirmNew ? 'new-password' : 'current-password'}"></label>${confirmNew ? '<label class="field"><span>确认主密码</span><input id="master-password-confirm" type="password" autocomplete="new-password"></label><div class="muted">建议使用较长且不易猜测的主密码；主密码不会写入 ZTools 数据库。</div>' : ''}`
  const result = await modal({
    title,
    body,
    actions: [
      { label: '取消', value: null, className: 'btn-secondary' },
      {
        label: confirmNew ? '保存' : '解锁',
        className: 'btn-primary',
        beforeClose: (overlay) => {
          const password = overlay.querySelector('#master-password').value
          if (!password) { showToast('主密码不能为空。', 'warning'); return false }
          if (confirmNew && password !== overlay.querySelector('#master-password-confirm').value) { showToast('两次输入的主密码不一致。', 'warning'); return false }
          return password
        }
      }
    ]
  })
  return typeof result === 'string' ? result : null
}

async function migrateLegacyCredentials() {
  if (!state.settings.credentialVault || !api.isCredentialVaultUnlocked(state.settings.credentialVault)) return { migrated: 0, failed: 0 }
  let migrated = 0
  let failed = 0
  for (const server of state.settings.servers) {
    if (server.credential || !server.encryptedPassword) continue
    try {
      const plain = await api.unprotectLegacySecret(server.encryptedPassword)
      server.credential = api.encryptCredential(plain, state.settings.credentialVault)
      server.encryptedPassword = ''
      migrated += 1
    } catch (error) {
      console.warn('Failed to migrate legacy server credential:', error)
      failed += 1
    }
  }
  if (migrated) saveSettings({ credentialSensitive: true, bumpCredential: true })
  if (failed) showToast(`${failed} 个旧版 DPAPI 密码未能自动迁移，请重新输入服务器密码。`, 'warning')
  return { migrated, failed }
}

async function setupCredentialVault() {
  const password = await promptMasterPassword('设置主密码', {
    confirmNew: true,
    description: '主密码用于跨设备解锁同步后的服务器密码；它本身不会保存或同步。'
  })
  if (!password) return false
  assertCredentialWriteCurrent()
  state.settings.credentialVault = api.createCredentialVault(password)
  saveSettings({ credentialSensitive: true })
  const migration = await migrateLegacyCredentials()
  updateCredentialUi()
  showToast(migration.migrated ? `主密码已设置，并迁移 ${migration.migrated} 个旧版密码。` : '主密码已设置。', 'success')
  return true
}

async function unlockCredentials() {
  if (!state.settings.credentialVault) return setupCredentialVault()
  const password = await promptMasterPassword('解锁服务器凭据')
  if (!password) return false
  api.unlockCredentialVault(state.settings.credentialVault, password)
  const migration = await migrateLegacyCredentials()
  updateCredentialUi()
  showToast(migration.migrated ? `已解锁，并迁移 ${migration.migrated} 个旧版密码。` : '服务器凭据已解锁。', 'success')
  return true
}

async function ensureCredentialVaultUnlocked() {
  refreshCredentialStateFromDatabase()
  if (!state.settings.credentialVault) return setupCredentialVault()
  if (api.isCredentialVaultUnlocked(state.settings.credentialVault)) return true
  return unlockCredentials()
}

async function changeMasterPassword() {
  if (!(await ensureCredentialVaultUnlocked())) return
  await migrateLegacyCredentials()
  const password = await promptMasterPassword('修改主密码', {
    confirmNew: true,
    description: '所有已保存的服务器密码会使用新主密码重新加密。'
  })
  if (!password) return
  assertCredentialWriteCurrent()
  const entries = state.settings.servers.filter((server) => server.credential).map((server) => ({ id: server.id, credential: server.credential }))
  const rotated = api.rotateCredentialVault(state.settings.credentialVault, entries, password)
  state.settings.credentialVault = rotated.vault
  const byId = new Map(rotated.credentials.map((item) => [item.id, item.credential]))
  for (const server of state.settings.servers) {
    if (byId.has(server.id)) server.credential = byId.get(server.id)
  }
  saveSettings({ credentialSensitive: true })
  updateCredentialUi()
  showToast('主密码已修改，服务器密码已重新加密。', 'success')
}

async function handleCredentialPrimary() {
  try {
    refreshCredentialStateFromDatabase()
    if (!state.settings.credentialVault) await setupCredentialVault()
    else if (api.isCredentialVaultUnlocked(state.settings.credentialVault)) await changeMasterPassword()
    else await unlockCredentials()
  } catch (error) { handleError('凭据操作失败', error) }
}

async function serverRuntimeOptions(server) {
  let password = ''
  if (server.credential) {
    if (!(await ensureCredentialVaultUnlocked())) throw new DOMException('用户取消了解锁。', 'AbortError')
    password = api.decryptCredential(server.credential, state.settings.credentialVault)
  } else if (server.encryptedPassword) {
    password = await api.unprotectLegacySecret(server.encryptedPassword)
  }
  return {
    host: server.host,
    port: server.port,
    username: server.username,
    password,
    remoteRoot: server.remoteRoot,
    expectedHostFingerprint: server.hostFingerprint
  }
}

function persistFingerprint(serverId, fingerprint) {
  if (!fingerprint) return
  const server = state.settings.servers.find((item) => item.id === serverId)
  if (!server || server.hostFingerprint === fingerprint) return
  server.hostFingerprint = fingerprint
  saveSettings({ credentialSensitive: true, bumpCredential: Boolean(state.settings.credentialVault) })
}

async function synchronizeOneServer(server, repositoryPath, localHead) {
  const repoName = repositoryPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  const options = await serverRuntimeOptions(server)
  log(`[Server ${server.name || server.host}] 检查仓库并同步…`)
  const result = await api.syncServer(options, repoName, localHead)
  persistFingerprint(server.id, result.hostFingerprint)
  return { server, repoName, options, result }
}

async function resolveServerSynchronization({ server, repoName, options, result }) {
  if (result.requiresDecision) {
    const checkpointMessage = await promptRepositoryChanges({
      title: 'SSH 服务器存在未提交修改',
      description: '服务器仓库存在未提交修改，无法安全执行同步。可以跳过服务器同步，或先保存为备份 Commit；保存后本次服务器同步仍会停止。',
      location: `${server.host}:${server.port}\n${server.remoteRoot}/${repoName}`,
      status: result.status,
      defaultMessage: api.defaults.serverCheckpointMessage,
      cancelText: '跳过服务器同步',
      confirmText: '保存修改并停止同步'
    })
    if (!checkpointMessage) {
      const message = '检测到服务器未提交修改；用户选择跳过本次服务器同步，服务器文件保持不变。'
      log(`[Server ${server.name || server.host}] ${message}`)
      return { success: true, skipped: true, message }
    }
    const checkpoint = await api.checkpointServer(options, repoName, checkpointMessage)
    persistFingerprint(server.id, checkpoint.hostFingerprint)
    const message = `服务器未提交修改已保存为备份 Commit（HEAD=${checkpoint.head.slice(0, 8)}）；为避免分支分叉，本次服务器同步已停止。`
    log(`[Server ${server.name || server.host}] ${message}`)
    return { success: true, skipped: true, message }
  }
  log(`[Server ${server.name || server.host}] ${result.message}`)
  return { ...result, skipped: Boolean(result.skipped) }
}

async function enabledServers() {
  const servers = state.settings.servers.filter((server) => server.enabled)
  for (const server of servers) {
    if (!server.host.trim()) throw new Error(`服务器“${server.name || '未命名'}”地址为空。`)
    if (!server.username.trim()) throw new Error(`服务器“${server.name || server.host}”用户名为空。`)
    if (!server.remoteRoot.trim()) throw new Error(`服务器“${server.name || server.host}”仓库根目录为空。`)
    if (!server.credential && !server.encryptedPassword) throw new Error(`服务器“${server.name || server.host}”尚未保存密码。`)
  }
  return servers
}

async function synchronizeServers(servers, repositoryPath, localHead) {
  if (servers.some((server) => server.credential) && state.settings.credentialVault && !api.isCredentialVaultUnlocked(state.settings.credentialVault)) {
    if (!(await ensureCredentialVaultUnlocked())) throw new DOMException('用户取消了解锁。', 'AbortError')
  }
  setServerStatus(`服务器：0/${servers.length}`, 'info')
  log(`Starting parallel synchronization for ${servers.length} server(s)...`)
  const pending = await Promise.all(servers.map(async (server) => {
    try {
      return { server, value: await synchronizeOneServer(server, repositoryPath, localHead), error: null }
    } catch (error) {
      return { server, value: null, error }
    }
  }))
  const outcomes = []
  let completed = 0
  for (const item of pending) {
    let outcome
    if (item.error) {
      const message = item.error.message || String(item.error)
      log(`[Server ${item.server.name || item.server.host}] 同步失败：${message}`)
      outcome = { success: false, skipped: false, message }
    } else {
      try {
        outcome = await resolveServerSynchronization(item.value)
      } catch (error) {
        const message = error.message || String(error)
        log(`[Server ${item.server.name || item.server.host}] 同步失败：${message}`)
        outcome = { success: false, skipped: false, message }
      }
    }
    outcomes.push(outcome)
    completed += 1
    setServerStatus(`服务器：${completed}/${servers.length}`, completed === servers.length ? 'normal' : 'info')
  }
  return outcomes
}

async function finishPush(repositoryPath, localHead, servers) {
  if (!servers.length) {
    setStatus(`✓ 已成功 Commit 并 Push（${nowTime()}）`, 'success')
    setServerStatus('服务器：未启用', 'muted')
    return
  }
  setStatus('GitHub Push 成功，正在同步服务器…', 'info')
  const outcomes = await synchronizeServers(servers, repositoryPath, localHead)
  const success = outcomes.filter((item) => item.success).length
  const failed = outcomes.length - success
  const skipped = outcomes.filter((item) => item.skipped).length
  if (!failed) {
    setStatus(`✓ Push 成功；${success}/${outcomes.length} 台服务器处理完成（${nowTime()}）`, 'success')
    setServerStatus(skipped === outcomes.length ? `服务器：${skipped} 台无需同步` : `服务器：${success}/${outcomes.length} 成功`, 'success')
  } else {
    setStatus('GitHub Push 成功；部分服务器同步失败，可复制日志分析', 'warning')
    setServerStatus(`服务器：${success} 成功 · ${failed} 失败`, 'error')
  }
}

async function previewPackage() {
  if (state.busy) return
  try {
    const selection = getSelection()
    setBusy(true, '正在分析 ZIP…')
    const plan = await api.analyzePackage(selection.zip, selection.repository)
    await showPreview(plan)
    setStatus(`预览完成：${plan.actionableCount} 项实际变化`, 'info')
  } catch (error) { handleError('预览失败', error) }
  finally { setBusy(false) }
}

async function commitAndPush() {
  if (state.busy) return
  try {
    const repo = selectedRepository()
    if (!repo) throw new Error('请选择目标仓库。')
    const message = el.commitMessage.value.trim()
    if (!message) { showToast('Commit message 不能为空', 'warning'); el.commitMessage.focus(); return }
    saveSettings()
    const servers = await enabledServers()
    setBusy(true, '正在检查仓库修改…')
    replaceLog('')
    await api.ensureGit()
    const status = await api.getWorkingTreeStatus(repo.path)
    if (!status) { setStatus('当前仓库没有可提交的修改', 'warning'); return }
    replaceLog(`Repository: ${repo.path}\n\nLocal changes:\n${status}`)
    const count = status.split(/\r?\n/).filter(Boolean).length
    const confirmed = await confirmAction('提交并推送', `检测到 ${count} 项工作区修改。`, [`仓库：${repo.path}`, `服务器：${servers.length} 台已启用`])
    if (!confirmed) return
    setStatus('正在暂存修改…', 'info')
    log('Staging current repository changes...')
    const staged = await api.stage(repo.path)
    log(staged)
    if (!staged) { setStatus('没有可提交变化', 'warning'); return }
    setStatus('正在创建 Commit…', 'info')
    await api.commit(repo.path, message)
    setStatus('正在 Push…', 'info')
    log('Commit created. Pushing...')
    await api.push(repo.path)
    const head = await api.getHeadSha(repo.path)
    log(`Done: push completed. HEAD=${head}`)
    await finishPush(repo.path, head, servers)
  } catch (error) { handleError('提交并推送失败', error) }
  finally { setBusy(false) }
}

async function applyAndPush() {
  if (state.busy) return
  try {
    const selection = getSelection()
    const message = el.commitMessage.value.trim()
    if (!message) { showToast('Commit message 不能为空', 'warning'); el.commitMessage.focus(); return }
    saveSettings()
    const servers = await enabledServers()
    setBusy(true, '正在检查仓库…')
    replaceLog('')
    await api.ensureGit()
    await ensureLocalChangesCheckpointed(selection.repository)
    setStatus('正在拉取远程更新…', 'info')
    log('Repository clean. Running git pull --ff-only...')
    await api.pullFastForward(selection.repository)
    setStatus('正在分析 ZIP…', 'info')
    const plan = await api.analyzePackage(selection.zip, selection.repository)
    replaceLog(groupChanges(plan))
    if (!plan.actionableCount) { setStatus('没有实际变化', 'warning'); return }
    const confirmed = await confirmAction('应用 ZIP 并推送', `即将应用 ${plan.actionableCount} 项实际变化。`, [`仓库：${selection.repository}`, `ZIP：${selection.zip}`, `服务器：${servers.length} 台已启用`])
    if (!confirmed) return
    setStatus('正在应用 ZIP…', 'info')
    await api.applyPackage(plan)
    setStatus('正在暂存修改…', 'info')
    log('Files applied. Staging changes...')
    const staged = await api.stage(selection.repository)
    log(staged)
    if (!staged) {
      await api.rollback(selection.repository)
      setStatus('没有可提交变化', 'warning')
      return
    }
    setStatus('正在创建 Commit…', 'info')
    await api.commit(selection.repository, message)
    setStatus('正在 Push…', 'info')
    log('Commit created. Pushing...')
    await api.push(selection.repository)
    const head = await api.getHeadSha(selection.repository)
    log(`Done: push completed. HEAD=${head}`)
    state.zipSelectionMode = 'auto'
    state.manualZipPath = ''
    await Promise.all([
      refreshZips({ updateStatus: false }),
      finishPush(selection.repository, head, servers)
    ])
  } catch (error) { handleError('任务失败', error) }
  finally { setBusy(false) }
}

async function openRepository() {
  const repo = selectedRepository()
  if (!repo) return showToast('请选择目标仓库。', 'warning')
  await api.openPath(repo.path)
}

async function copyLog() {
  if (!state.log) return
  await navigator.clipboard.writeText(state.log)
  showToast('日志已复制。', 'success')
}

async function manageRepositoryRoots() {
  const roots = [...state.settings.repositoryRoots]
  const host = document.createElement('div')
  host.className = 'dialog-stack'
  host.innerHTML = `<div id="roots-list" class="editable-list"></div><button type="button" id="add-root" class="btn-secondary inline-button">+ 添加目录</button>`
  const render = () => {
    const list = host.querySelector('#roots-list')
    list.innerHTML = roots.length ? roots.map((root, index) => `<div class="editable-row"><span title="${escapeHtml(root)}">${escapeHtml(root)}</span><button type="button" data-remove-root="${index}" class="icon-button" title="移除">×</button></div>`).join('') : '<div class="empty-note">尚未添加 Git 仓库根目录。</div>'
    for (const button of list.querySelectorAll('[data-remove-root]')) button.onclick = () => { roots.splice(Number(button.dataset.removeRoot), 1); render() }
  }
  render()
  host.querySelector('#add-root').onclick = async () => {
    const selected = await api.chooseDirectory('选择 Git 仓库根目录')
    if (selected && !roots.some((item) => item.toLowerCase() === selected.toLowerCase())) { roots.push(selected); render() }
  }
  const result = await modal({
    title: 'Git 仓库目录',
    body: host,
    wide: true,
    actions: [
      { label: '取消', value: null, className: 'btn-secondary' },
      { label: '保存', value: true, className: 'btn-primary' }
    ]
  })
  if (!result) return
  state.settings.repositoryRoots = roots
  saveSettings()
  await refreshAll()
}

function serverEditor(server, index) {
  const row = document.createElement('article')
  row.className = 'server-editor'
  row.dataset.serverIndex = index
  row.innerHTML = `
    <div class="server-editor-head"><label class="switch-line"><input type="checkbox" data-field="enabled" ${server.enabled ? 'checked' : ''}><span>启用</span></label><strong>${escapeHtml(server.name || server.host || `服务器 ${index + 1}`)}</strong><button type="button" class="btn-danger compact server-delete-button" data-remove-server>删除</button></div>
    <div class="form-grid two-col">
      <label class="field"><span>名称</span><input data-field="name" value="${escapeHtml(server.name)}" placeholder="可选"></label>
      <label class="field"><span>服务器仓库根目录</span><input data-field="remoteRoot" value="${escapeHtml(server.remoteRoot || '~/app')}"></label>
      <label class="field"><span>服务器地址</span><input data-field="host" value="${escapeHtml(server.host)}"></label>
      <label class="field"><span>SSH 端口</span><input data-field="port" type="number" min="1" max="65535" value="${server.port || 22}"></label>
      <label class="field"><span>用户名</span><input data-field="username" value="${escapeHtml(server.username)}"></label>
      <label class="field"><span>密码</span><input data-field="password" type="password" placeholder="${server.credential || server.encryptedPassword ? '已保存；留空保持不变' : '请输入密码'}"></label>
    </div>
    <div class="fingerprint">主机指纹：${escapeHtml(server.hostFingerprint || '尚未建立')}</div>
    <div class="server-editor-actions"><button type="button" class="btn-secondary" data-test-server>测试连接</button><button type="button" class="btn-secondary" data-sync-server>同步当前仓库</button><span class="server-inline-status" data-server-inline-status></span></div>`
  return row
}

async function manageServers() {
  const drafts = state.settings.servers.map((server) => ({ ...server, _originalHost: server.host, _originalPort: server.port }))
  const host = document.createElement('div')
  host.className = 'dialog-stack'
  host.innerHTML = `<div id="server-list" class="server-list"></div><button type="button" id="add-server" class="btn-secondary inline-button">+ 添加服务器</button>`

  const readEditor = (editor, draft) => {
    const get = (name) => editor.querySelector(`[data-field="${name}"]`)
    draft.enabled = get('enabled').checked
    draft.name = get('name').value.trim()
    draft.host = get('host').value.trim()
    draft.port = Number(get('port').value) || 22
    draft.username = get('username').value.trim()
    draft.remoteRoot = get('remoteRoot').value.trim() || '~/app'
    draft._plainPassword = get('password').value
    if (draft.host !== draft._originalHost || draft.port !== draft._originalPort) draft.hostFingerprint = ''
    return draft
  }

  const runtimeFromEditor = async (editor, draft) => {
    readEditor(editor, draft)
    let password = draft._plainPassword || ''
    if (!password && draft.credential) {
      if (!(await ensureCredentialVaultUnlocked())) throw new DOMException('用户取消了解锁。', 'AbortError')
      password = api.decryptCredential(draft.credential, state.settings.credentialVault)
    } else if (!password && draft.encryptedPassword) {
      password = await api.unprotectLegacySecret(draft.encryptedPassword)
    }
    return { host: draft.host, port: draft.port, username: draft.username, password, remoteRoot: draft.remoteRoot, expectedHostFingerprint: draft.hostFingerprint }
  }

  const render = () => {
    const list = host.querySelector('#server-list')
    list.innerHTML = ''
    drafts.forEach((draft, index) => {
      const editor = serverEditor(draft, index)
      editor.querySelector('[data-remove-server]').onclick = () => { drafts.splice(index, 1); render() }
      editor.querySelector('[data-test-server]').onclick = async () => {
        const status = editor.querySelector('[data-server-inline-status]')
        try {
          status.textContent = '测试中…'
          const options = await runtimeFromEditor(editor, draft)
          const result = await api.testServer(options)
          if (!result.success) throw new Error(result.message)
          draft.hostFingerprint = result.hostFingerprint || draft.hostFingerprint
          status.textContent = result.message
          editor.querySelector('.fingerprint').textContent = `主机指纹：${draft.hostFingerprint || '尚未建立'}`
        } catch (error) { status.textContent = `失败：${error.message}` }
      }
      editor.querySelector('[data-sync-server]').onclick = async () => {
        const status = editor.querySelector('[data-server-inline-status]')
        const repo = selectedRepository()
        if (!repo) { status.textContent = '请先选择目标仓库。'; return }
        try {
          status.textContent = '同步中…'
          const options = await runtimeFromEditor(editor, draft)
          const head = await api.getHeadSha(repo.path)
          const repoName = repo.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
          const result = await api.syncServer(options, repoName, head)
          draft.hostFingerprint = result.hostFingerprint || draft.hostFingerprint
          if (result.requiresDecision) { status.textContent = '服务器存在未提交修改，请先保存设置后从主流程处理。'; return }
          status.textContent = result.success ? result.message : `失败：${result.message}`
          editor.querySelector('.fingerprint').textContent = `主机指纹：${draft.hostFingerprint || '尚未建立'}`
        } catch (error) { status.textContent = `失败：${error.message}` }
      }
      list.appendChild(editor)
    })
    if (!drafts.length) list.innerHTML = '<div class="empty-note">尚未配置服务器。</div>'
  }

  host.querySelector('#add-server').onclick = () => {
    drafts.push({ ...normalizeServer({}), _originalHost: '', _originalPort: 22 })
    render()
  }
  render()

  const result = await modal({
    title: '服务器同步配置',
    body: host,
    wide: true,
    actions: [
      { label: '取消', value: null, className: 'btn-secondary' },
      {
        label: '保存',
        className: 'btn-primary',
        beforeClose: async (overlay) => {
          assertCredentialWriteCurrent()
          const editors = [...overlay.querySelectorAll('.server-editor')]
          for (let index = 0; index < editors.length; index += 1) {
            const draft = readEditor(editors[index], drafts[index])
            if (draft._plainPassword) {
              if (!(await ensureCredentialVaultUnlocked())) return false
              draft.credential = api.encryptCredential(draft._plainPassword, state.settings.credentialVault)
              draft.encryptedPassword = ''
            }
            delete draft._plainPassword
            delete draft._originalHost
            delete draft._originalPort
          }
          return true
        }
      }
    ]
  })
  if (!result) return
  state.settings.servers = drafts.map((draft) => normalizeServer(draft))
  saveSettings({ credentialSensitive: true, bumpCredential: Boolean(state.settings.credentialVault) })
}

async function chooseDownloadDirectory() {
  const selected = await api.chooseDirectory('选择 ZIP 下载目录')
  if (!selected) return
  el.downloadDirectory.value = selected
  saveSettings()
  await refreshAll()
}

function showToast(message, tone = 'normal') {
  const toast = document.createElement('div')
  toast.className = `toast toast-${tone}`
  toast.textContent = message
  el.toastHost.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('show'))
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 180) }, 3000)
}

function handleError(prefix, error) {
  if (error?.name === 'AbortError') {
    setStatus('操作已取消', 'warning')
    return
  }
  const message = error?.message || String(error)
  log(`${prefix}: ${message}`)
  setStatus(`${prefix}：${message.split(/\r?\n/)[0]}`, 'error')
  showToast(`${prefix}：${message}`, 'error')
}

function bindEvents() {
  el.windowTitlebar.addEventListener('dblclick', (event) => {
    if (!event.target.closest('.window-controls')) sendWindowCommand('toggle-maximize')
  })
  el.windowMinimize.addEventListener('click', () => sendWindowCommand('minimize'))
  el.windowMaximize.addEventListener('click', () => sendWindowCommand('toggle-maximize'))
  el.windowClose.addEventListener('click', () => {
    sendWindowCommand('close')
    setTimeout(() => window.close(), 350)
  })
  el.commitMessage.addEventListener('change', saveSettings)
  el.repositoryTrigger.addEventListener('click', () => {
    if (el.repositoryMenu.hidden) {
      openDropdown(el.repositoryDropdown, el.repositoryTrigger, el.repositoryMenu)
      el.repositorySearch.value = ''
      renderRepositoryOptions()
      requestAnimationFrame(() => el.repositorySearch.focus())
    } else closeDropdown(el.repositoryDropdown, el.repositoryTrigger, el.repositoryMenu)
  })
  el.repositorySearch.addEventListener('input', () => renderRepositoryOptions(el.repositorySearch.value))
  el.repositorySearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDropdown(el.repositoryDropdown, el.repositoryTrigger, el.repositoryMenu)
      el.repositoryTrigger.focus()
    }
    if (event.key === 'Enter') {
      const first = el.repositoryOptions.querySelector('.custom-select-option')
      if (first) { event.preventDefault(); first.click() }
    }
  })
  el.themeTrigger.addEventListener('click', () => {
    if (el.themeMenu.hidden) openDropdown(el.themeDropdown, el.themeTrigger, el.themeMenu)
    else closeDropdown(el.themeDropdown, el.themeTrigger, el.themeMenu)
  })
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.custom-select')) closeAllDropdowns()
  })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAllDropdowns() })
  el.settingsPanel.addEventListener('toggle', () => {
    if (el.settingsPanel.open) requestAnimationFrame(() => el.settingsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  })
  el.manageRepoRoots.addEventListener('click', manageRepositoryRoots)
  el.chooseDownload.addEventListener('click', chooseDownloadDirectory)
  el.refresh.addEventListener('click', refreshAll)
  el.manageServers.addEventListener('click', manageServers)
  el.credentialPrimary.addEventListener('click', handleCredentialPrimary)
  el.openRepo.addEventListener('click', openRepository)
  el.copyLog.addEventListener('click', copyLog)
  el.commitPush.addEventListener('click', commitAndPush)
  el.applyPush.addEventListener('click', applyAndPush)
  window.addEventListener('message', async (event) => {
    const data = event.data
    if (!data || data.source !== 'git-bridge') return
    if (data.type === 'zip-directory-changed') await refreshZips({ updateStatus: !state.busy })
    if (data.type === 'zip-watcher-error') setStatus(`ZIP 自动监测异常：${data.message}`, 'warning')
    if (data.type === 'server-sync-progress') {
      const label = data.server ? ` ${data.server}` : ''
      setServerStatus(`服务器${label}：${data.message}`, 'info')
      log(data.server ? `[Server ${data.server}] ${data.message}` : data.message)
    }
    if (data.type === 'plugin-enter') await refreshAll({ updateStatus: !state.busy })
  })
}

async function init() {
  Object.assign(el, {
    windowTitlebar: $('window-titlebar'),
    windowMinimize: $('window-minimize'),
    windowMaximize: $('window-maximize'),
    windowClose: $('window-close'),
    themeMode: $('theme-mode'),
    themeDropdown: $('theme-dropdown'),
    themeTrigger: $('theme-trigger'),
    themeDisplay: $('theme-display'),
    themeMenu: $('theme-menu'),
    themeOptions: $('theme-options'),
    commitMessage: $('commit-message'),
    repoRootsSummary: $('repo-roots-summary'),
    manageRepoRoots: $('manage-repo-roots'),
    downloadDirectory: $('download-directory'),
    chooseDownload: $('choose-download'),
    repository: $('repository'),
    repositoryDropdown: $('repository-dropdown'),
    repositoryTrigger: $('repository-trigger'),
    repositoryDisplay: $('repository-display'),
    repositoryMenu: $('repository-menu'),
    repositorySearch: $('repository-search'),
    repositoryOptions: $('repository-options'),
    refresh: $('refresh'),
    zipTableBody: $('zip-table-body'),
    zipEmpty: $('zip-empty'),
    serverSummary: $('server-summary'),
    manageServers: $('manage-servers'),
    credentialStatus: $('credential-status'),
    credentialPrimary: $('credential-primary'),
    credentialSecondary: $('credential-secondary'),
    openRepo: $('open-repo'),
    copyLog: $('copy-log'),
    commitPush: $('commit-push'),
    applyPush: $('apply-push'),
    status: $('status'),
    serverStatus: $('server-status'),
    settingsPanel: $('settings-panel'),
    toastHost: $('toast-host')
  })
  let loadedSettings = false
  try {
    const stored = readSettingsDocument()
    if (stored) {
      state.settings = stored
      loadedSettings = true
    } else {
      const legacyLocal = readLegacyLocalSettings()
      if (legacyLocal) {
        state.settings = writeSettingsDocument(legacyLocal)
        localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)
        loadedSettings = true
        showToast('已将 Git Bridge 设置迁移到 ZTools 数据库。', 'success')
      }
    }
  } catch (error) {
    console.warn('Failed to load Git Bridge settings from ZTools database:', error)
  }
  if (!loadedSettings) {
    try {
      const initial = await api.getInitialSettings()
      state.settings = writeSettingsDocument(initial.settings)
      if (initial.importedLegacy) showToast('已导入原 ChatGPT Git Bridge 设置。', 'success')
    } catch (error) {
      console.warn('Failed to initialize Git Bridge settings:', error)
    }
  }
  state.credentialGeneration = credentialGeneration(state.settings.credentialVault)
  syncThemeDropdown()
  el.commitMessage.value = state.settings.commitMessage
  el.downloadDirectory.value = state.settings.downloadDirectory
  applyTheme()
  updateRepoRootsSummary()
  updateServerSummary()
  updateCredentialUi()
  updateCopyLogButton()
  bindEvents()
  try { await refreshAll() } catch (error) { handleError('初始化失败', error) }
}

document.addEventListener('DOMContentLoaded', init)

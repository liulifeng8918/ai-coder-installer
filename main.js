const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, spawnSync, execFileSync } = require('child_process')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')

const APPDATA_DIR = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const CONFIG_DIR = path.join(APPDATA_DIR, 'AIInstaller')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const LOG_FILE = path.join(CONFIG_DIR, 'install.log')

const USER_HOME = os.homedir()
const CODEX_DIR = path.join(USER_HOME, '.codex')
const CODEX_CONFIG = path.join(CODEX_DIR, 'config.toml')
const CLAUDE_DIR = path.join(USER_HOME, '.claude')
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json')
const CC_SWITCH_DIR = path.join(USER_HOME, '.cc-switch')
const CC_SWITCH_DB = path.join(CC_SWITCH_DIR, 'cc-switch.db')
const CC_SWITCH_SETTINGS = path.join(CC_SWITCH_DIR, 'settings.json')

// Replace these values before shipping a real release.
const AGNES_BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1'
const AGNES_REGISTER_URL = process.env.AGNES_REGISTER_URL || 'https://platform.agnes-ai.com/'
const AGNES_CODEX_MODEL = process.env.AGNES_CODEX_MODEL || 'agnes-2.0-flash'
const AGNES_CLAUDE_MODEL = process.env.AGNES_CLAUDE_MODEL || 'agnes-2.0-flash'
const AGNES_KEY_OBFUSCATED = process.env.AGNES_KEY_OBFUSCATED || 'WUEHfm1ven1wEh15Eh1oEmljf3xJWhxpW2tzW2NQZxtnYVl6TGtPQlBpcmsSa15EQ2lt'
const AGNES_KEY_EXPIRY_DAYS = 7
const CC_SWITCH_PROVIDER_ID = 'agnes-ai'
const CC_SWITCH_PROVIDER_NAME = 'Agnes-AI'
const CC_SWITCH_LISTEN_ADDRESS = '127.0.0.1'
const CC_SWITCH_LISTEN_PORT = 15721
const CC_SWITCH_BASE_URL = `http://${CC_SWITCH_LISTEN_ADDRESS}:${CC_SWITCH_LISTEN_PORT}`
const CC_SWITCH_CODEX_BASE_URL = `${CC_SWITCH_BASE_URL}/v1`

const CODEX_STORE_URI = 'ms-windows-store://pdp/?productid=9PLM9XGG6VKS'
const CODEX_STORE_WEB_URL = 'https://apps.microsoft.com/detail/9PLM9XGG6VKS'
const CODEX_STORE_PRODUCT_ID = '9PLM9XGG6VKS'
const SUPPORT_LINKS = {
  github: { label: 'GitHub 项目', detail: '待审核通过', url: '' },
  tutorial: {
    label: '图文教程',
    detail: '飞书链接',
    url: 'https://lcnna32svagn.feishu.cn/wiki/TF5PwHX4DiVaWYkZvfSceb7DnKc?from=from_copylink'
  },
  contact: { label: '联系我', detail: 'liulifeng8@qq.com', url: 'mailto:liulifeng8@qq.com' }
}
const DONATION_QR_FILE = 'donation-qr.jpg'
const WINGET_RELEASE_API = 'https://api.github.com/repos/microsoft/winget-cli/releases/latest'
const WINGET_VCLIBS_URL = 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx'
const WINGET_UIXAML_NUPKG_URL = 'https://www.nuget.org/api/v2/package/Microsoft.UI.Xaml/2.8.7'
const CC_SWITCH_RELEASE_API = 'https://api.github.com/repos/farion1231/cc-switch/releases/latest'
const CC_SWITCH_FALLBACK_MSI = 'https://github.com/farion1231/cc-switch/releases/download/v3.16.2/CC-Switch-v3.16.2-Windows.msi'
const NODE_LTS_ZIP_URL = 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip'
const GIT_RELEASE_API = 'https://api.github.com/repos/git-for-windows/git/releases/latest'
const GIT_FALLBACK_EXE_URL = 'https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/Git-2.54.0-64-bit.exe'
const LOCAL_TOOLS_DIR = path.join(process.env.LOCALAPPDATA || path.join(USER_HOME, 'AppData', 'Local'), 'AIInstaller')
const PORTABLE_NODE_DIR = path.join(LOCAL_TOOLS_DIR, 'node')
const NPM_GLOBAL_DIR = path.join(LOCAL_TOOLS_DIR, 'npm-global')

let mainWindow = null
let installRunning = false
let cachedWingetCommand = ''

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function ensureConfigDir() {
  ensureDir(CONFIG_DIR)
}

function send(event, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, data)
  }
}

function log(step, status, message) {
  ensureConfigDir()
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    step,
    status,
    message
  }) + '\n'
  fs.appendFileSync(LOG_FILE, line, 'utf8')
  send('log-line', { step, status, line: `[${step}] ${message}` })
}

function logCommandOutput(step, status, text) {
  if (!text) return
  ensureConfigDir()
  const lines = String(text).replace(/\r/g, '').split('\n').filter(Boolean)
  for (const message of lines) {
    fs.appendFileSync(LOG_FILE, JSON.stringify({
      ts: new Date().toISOString(),
      step,
      status,
      message
    }) + '\n', 'utf8')
  }
}

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
  } catch (err) {
    log('config', 'error', `读取配置失败: ${err.message}`)
  }
  return {}
}

function writeConfig(data) {
  ensureConfigDir()
  const current = readConfig()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...data }, null, 2), 'utf8')
}

function readJsonObject(file) {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    }
  } catch (err) {
    log('config', 'error', `读取 JSON 失败 ${file}: ${err.message}`)
  }
  return {}
}

function deobfuscate(encoded) {
  if (!encoded || encoded === 'REPLACE_WITH_OBFUSCATED_KEY') return ''
  const XOR_KEY = 42
  const buf = Buffer.from(encoded, 'base64')
  return buf.map(byte => byte ^ XOR_KEY).toString('utf8')
}

function maskSecret(value) {
  if (!value) return ''
  if (value.length <= 8) return '********'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function tomlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '')
}

function sqlJsWasmPath() {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    if (fs.existsSync(unpacked)) return unpacked
  }
  return path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

async function loadSqlJs() {
  const initSqlJs = require('sql.js')
  return initSqlJs({
    locateFile: file => file === 'sql-wasm.wasm' ? sqlJsWasmPath() : file
  })
}

function sqliteValue(db, sql, params = []) {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    if (!stmt.step()) return null
    return stmt.get()[0]
  } finally {
    stmt.free()
  }
}

function sqliteRun(db, sql, params = []) {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    stmt.step()
  } finally {
    stmt.free()
  }
}

function resourcePath(...segments) {
  const packagedPath = path.join(process.resourcesPath || '', 'resources', ...segments)
  if (app.isPackaged && fs.existsSync(packagedPath)) return packagedPath

  const devPath = path.join(__dirname, 'resources', ...segments)
  if (fs.existsSync(devPath)) return devPath

  return packagedPath
}

function findResourceFile(segments, pattern) {
  const dir = resourcePath(...segments)
  if (!fs.existsSync(dir)) return ''
  const found = fs.readdirSync(dir).find(name => pattern.test(name))
  return found ? path.join(dir, found) : ''
}

function backupFile(file) {
  if (!fs.existsSync(file)) return
  const backup = `${file}.ai-installer.bak`
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup)
    log('config', 'info', `已备份配置: ${backup}`)
  }
}

function runCommand(step, command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || 300000
    const displayCommand = options.logCommand || `${command} ${args.join(' ')}`
    log(step, 'info', `运行: ${displayCommand}`)

    const proc = spawn(command, args, {
      shell: options.shell ?? true,
      windowsHide: true,
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...(options.env || {})
      }
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`命令超时: ${command}`))
    }, timeoutMs)

    const echoOutput = options.echoOutput !== false

    proc.stdout?.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      if (echoOutput) {
        logCommandOutput(step, 'stdout', text)
        send('log-line', { step, status: 'info', line: text.trim() })
      }
    })

    proc.stderr?.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      if (echoOutput) {
        logCommandOutput(step, 'stderr', text)
        send('log-line', { step, status: 'error', line: text.trim() })
      }
    })

    proc.on('error', err => {
      clearTimeout(timer)
      log(step, 'error', err.message)
      reject(err)
    })

    proc.on('close', code => {
      clearTimeout(timer)
      if (code === 0) {
        log(step, 'ok', '命令完成')
        resolve({ stdout, stderr })
      } else {
        const tail = (stderr || stdout).slice(-600)
        const err = new Error(`退出码 ${code}${tail ? `: ${tail}` : ''}`)
        log(step, 'error', err.message)
        reject(err)
      }
    })
  })
}

function runPowershell(step, script, options = {}) {
  const utf8Script = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new()',
    script
  ].join('; ')

  return runCommand(step, 'powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    utf8Script
  ], {
    ...options,
    shell: false,
    logCommand: options.logCommand || 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command <script>'
  })
}

function commandOutput(command, args = [], timeoutMs = 15000) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true
  }).trim()
}

function commandOutputShell(command, args = [], timeoutMs = 15000) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    shell: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit code ${result.status}`).trim())
  }
  return String(result.stdout || '').trim()
}

function commandExists(command) {
  try {
    commandOutput('where.exe', [command], 8000)
    return true
  } catch {
    return false
  }
}

function resolveWingetCommand() {
  if (cachedWingetCommand && fs.existsSync(cachedWingetCommand)) return cachedWingetCommand

  try {
    const found = commandOutput('where.exe', ['winget'], 8000)
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean)
    if (found && fs.existsSync(found)) {
      cachedWingetCommand = found
      return cachedWingetCommand
    }
  } catch {
    // Continue to App Installer package probing.
  }

  const aliasPath = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'winget.exe')
  if (aliasPath && fs.existsSync(aliasPath)) {
    cachedWingetCommand = aliasPath
    return cachedWingetCommand
  }

  try {
    const script = [
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()',
      '$pkg = Get-AppxPackage Microsoft.DesktopAppInstaller | Sort-Object Version -Descending | Select-Object -First 1',
      'if ($pkg) {',
      '  $exe = Join-Path $pkg.InstallLocation "winget.exe"',
      '  if (Test-Path $exe) { Write-Output $exe }',
      '}'
    ].join('; ')
    const found = commandOutput('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], 20000)
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean)
    if (found && fs.existsSync(found)) {
      cachedWingetCommand = found
      return cachedWingetCommand
    }
  } catch {
    // winget is not registered yet.
  }

  return ''
}

function wingetExists() {
  const command = resolveWingetCommand()
  if (!command) return false
  try {
    commandOutput(command, ['--version'], 20000)
    return true
  } catch {
    cachedWingetCommand = ''
    return false
  }
}

function wingetVersion() {
  const command = resolveWingetCommand()
  if (!command) return ''
  return commandOutput(command, ['--version'], 20000)
}

function runWinget(step, args, options = {}) {
  const command = resolveWingetCommand()
  if (!command) throw new Error('winget is not available')
  return runCommand(step, command, args, { ...options, shell: false })
}

function versionMajor(output) {
  const match = String(output || '').match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function assertPathInside(rootDir, targetPath) {
  const root = path.resolve(rootDir).replace(/[\\/]+$/, '').toLowerCase()
  const target = path.resolve(targetPath).replace(/[\\/]+$/, '').toLowerCase()
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to remove path outside installer tools directory: ${targetPath}`)
  }
}

function removePathInside(rootDir, targetPath) {
  assertPathInside(rootDir, targetPath)
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true })
  }
}

async function waitForWingetReady(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await refreshPath()
    if (wingetExists()) return true
    await delay(3000)
  }
  return false
}

async function setUserEnv(name, value) {
  const script = `[System.Environment]::SetEnvironmentVariable(${psQuote(name)}, ${psQuote(value)}, 'User')`
  const maskedValue = /KEY|TOKEN|SECRET/i.test(name) ? maskSecret(value) : value
  await runPowershell('env', script, {
    timeoutMs: 30000,
    logCommand: `Set user environment variable ${name}=${maskedValue}`
  })
  process.env[name] = value
}

async function addUserPathEntry(dir) {
  ensureDir(dir)
  const script = [
    `$entry = ${psQuote(dir)}`,
    "$current = [System.Environment]::GetEnvironmentVariable('Path', 'User')",
    "if (-not $current) { $current = '' }",
    "$parts = $current -split ';' | Where-Object { $_ }",
    "$exists = $parts | Where-Object { $_.TrimEnd('\\') -ieq $entry.TrimEnd('\\') }",
    'if (-not $exists) {',
    "  $newPath = if ($current) { $current.TrimEnd(';') + ';' + $entry } else { $entry }",
    "  [System.Environment]::SetEnvironmentVariable('Path', $newPath, 'User')",
    '}'
  ].join('; ')
  await runPowershell('env', script, {
    timeoutMs: 30000,
    echoOutput: false,
    logCommand: `Add user PATH entry ${dir}`
  })
  const currentPath = String(process.env.PATH || '')
  if (!currentPath.toLowerCase().split(';').some(item => item.trim().replace(/\\+$/, '').toLowerCase() === dir.replace(/\\+$/, '').toLowerCase())) {
    process.env.PATH = `${dir};${currentPath}`
    process.env.Path = process.env.PATH
  }
}

async function refreshPath() {
  const script = [
    "$machine=[System.Environment]::GetEnvironmentVariable('Path','Machine')",
    "$user=[System.Environment]::GetEnvironmentVariable('Path','User')",
    "Write-Output ($machine + ';' + $user)"
  ].join('; ')
  try {
    const { stdout } = await runPowershell('env', script, {
      timeoutMs: 30000,
      echoOutput: false,
      logCommand: 'Refresh PATH from system/user environment'
    })
    if (stdout.trim()) process.env.PATH = `${stdout.trim()};${process.env.PATH || ''}`
  } catch (err) {
    log('env', 'error', `刷新 PATH 失败: ${err.message}`)
  }

  const windowsApps = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps')
  if (windowsApps && !String(process.env.PATH || '').toLowerCase().includes(windowsApps.toLowerCase())) {
    process.env.PATH = `${windowsApps};${process.env.PATH || ''}`
  }
}

async function checkUrl(label, url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'AI-Coder-Installer' }
    })
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    log('preflight', 'ok', `${label} network reachable`)
    return true
  } catch (err) {
    log('preflight', 'info', `${label} network precheck was inconclusive: ${err.message}. Continuing installation.`)
    send('log-line', {
      step: 'preflight',
      status: 'info',
      line: `${label} network precheck was inconclusive; installation will continue.`
    })
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function preflight(target) {
  send('step-start', { id: 'preflight', label: '检查 Windows 环境' })

  if (process.platform !== 'win32') {
    throw new Error('第一版只支持 Windows 10/11 x64')
  }
  if (os.arch() !== 'x64') {
    throw new Error(`当前架构是 ${os.arch()}，第一版只支持 x64`)
  }

  if (!wingetExists()) {
    const message = '未检测到 winget。将使用直接下载安装方式；Codex AI客户端可能需要手动从 Microsoft Store 安装。'
    log('preflight', 'error', message)
    send('step-warn', { id: 'preflight', message })
  }

  const diskScript = "$drive=$env:SystemDrive.TrimEnd(':'); $d=Get-PSDrive -Name $drive; [math]::Round($d.Free/1GB,2)"
  const { stdout: diskOut } = await runPowershell('preflight', diskScript, { timeoutMs: 30000 })
  const freeGb = Number(diskOut.trim())
  if (!Number.isNaN(freeGb) && freeGb < 2) {
    throw new Error(`系统盘剩余空间不足 2GB，当前约 ${freeGb}GB`)
  }

  await checkUrl('GitHub', 'https://github.com')
  await checkUrl('Agnes', normalizeBaseUrl(AGNES_BASE_URL))
  if (target === 'codex') {
    await checkUrl('Microsoft Store', 'https://apps.microsoft.com')
  } else {
    await checkUrl('Claude', 'https://claude.ai')
  }

  send('step-done', { id: 'preflight', message: '环境检查通过' })
}

async function installGit() {
  if (commandExists('git')) {
    const ver = commandOutput('git', ['--version'])
    log('deps', 'ok', `已检测到 ${ver}`)
    return
  }

  if (wingetExists()) {
    try {
      await runWinget('deps', [
        'install',
        '--id',
        'Git.Git',
        '-e',
        '--silent',
        '--accept-package-agreements',
        '--accept-source-agreements'
      ], { timeoutMs: 900000 })
      await refreshPath()
      if (!commandExists('git')) throw new Error('Git install finished but git command was not found')
      return
    } catch (err) {
      log('deps', 'error', `winget 安装 Git 失败，改用直接下载: ${err.message}`)
    }
  }

  const asset = await resolveLatestGitInstaller()
  const installerPath = path.join(os.tmpdir(), asset.name)
  await downloadFile('deps', asset.url, installerPath)
  await runCommand('deps', installerPath, [
    '/VERYSILENT',
    '/NORESTART',
    '/NOCANCEL',
    '/SP-',
    '/CLOSEAPPLICATIONS'
  ], { timeoutMs: 900000, shell: false })
  await refreshPath()
  if (!commandExists('git')) throw new Error('Git installer finished but git command was not found')
}

async function ensureNpmUserPrefix() {
  ensureDir(NPM_GLOBAL_DIR)
  await addUserPathEntry(NPM_GLOBAL_DIR)
  await runCommand('deps', 'npm', ['config', 'set', 'prefix', NPM_GLOBAL_DIR], {
    timeoutMs: 60000,
    logCommand: 'npm config set prefix <user npm-global>'
  })
}

async function installNode() {
  try {
    const ver = commandOutput('node', ['--version'])
    if (versionMajor(ver) >= 18 && commandExists('npm')) {
      log('deps', 'ok', `Detected Node.js ${ver}`)
      await ensureNpmUserPrefix()
      return
    }
  } catch {
    // Continue with the portable Node.js install.
  }

  ensureDir(LOCAL_TOOLS_DIR)
  const zipPath = path.join(LOCAL_TOOLS_DIR, 'node-lts-win-x64.zip')
  const extractRoot = path.join(LOCAL_TOOLS_DIR, 'node-extract')

  await downloadFile('deps', NODE_LTS_ZIP_URL, zipPath)
  removePathInside(LOCAL_TOOLS_DIR, extractRoot)
  ensureDir(extractRoot)

  await runPowershell('deps', [
    '$ErrorActionPreference = "Stop"',
    `$zip = ${psQuote(zipPath)}`,
    `$dest = ${psQuote(extractRoot)}`,
    'Expand-Archive -Path $zip -DestinationPath $dest -Force'
  ].join('; '), {
    timeoutMs: 300000,
    logCommand: 'Extract portable Node.js zip'
  })

  const extractedDir = fs.readdirSync(extractRoot)
    .map(name => path.join(extractRoot, name))
    .find(candidate => fs.existsSync(path.join(candidate, 'node.exe')))

  if (!extractedDir) {
    throw new Error('Portable Node.js archive did not contain node.exe')
  }

  removePathInside(LOCAL_TOOLS_DIR, PORTABLE_NODE_DIR)
  fs.cpSync(extractedDir, PORTABLE_NODE_DIR, { recursive: true })
  removePathInside(LOCAL_TOOLS_DIR, extractRoot)
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true })

  await addUserPathEntry(PORTABLE_NODE_DIR)
  await ensureNpmUserPrefix()

  if (!commandExists('node') || !commandExists('npm')) {
    throw new Error('Portable Node.js was installed but node/npm command was not found')
  }

  const ver = commandOutput('node', ['--version'])
  log('deps', 'ok', `Portable Node.js ready: ${ver}`)
}

async function installDependencies() {
  send('step-start', { id: 'deps', label: '安装基础依赖 Node.js' })
  await installNode()
  if (commandExists('git')) {
    const ver = commandOutput('git', ['--version'])
    log('deps', 'ok', `Detected optional Git: ${ver}`)
  } else {
    log('deps', 'info', 'Git is not installed; continuing because it is optional for this installer.')
  }
  send('step-done', { id: 'deps', message: 'Node.js 已就绪' })
}

async function resolveLatestWingetBundle() {
  try {
    const res = await fetch(WINGET_RELEASE_API, {
      headers: { 'User-Agent': 'AI-Coder-Installer' }
    })
    if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`)
    const release = await res.json()
    const asset = (release.assets || []).find(item => /Microsoft\.DesktopAppInstaller_.*\.msixbundle$/i.test(item.name))
    if (!asset) throw new Error('最新 Release 中未找到 Microsoft.DesktopAppInstaller msixbundle')
    return {
      name: asset.name,
      url: asset.browser_download_url
    }
  } catch (err) {
    log('winget', 'error', `获取 winget 最新版本失败: ${err.message}`)
    throw new Error('无法自动下载 winget/App Installer。请检查网络后重试。')
  }
}

async function tryRegisterExistingWinget() {
  try {
    await runPowershell(
      'winget',
      'Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe',
      { timeoutMs: 120000 }
    )
    return waitForWingetReady(60000)
  } catch (err) {
    log('winget', 'error', `注册现有 App Installer 失败: ${err.message}`)
    return false
  }
}

async function installWingetPackage() {
  const tempRoot = path.join(os.tmpdir(), 'ai-coder-winget')
  ensureDir(tempRoot)

  let vclibs = resourcePath('winget', 'Microsoft.VCLibs.x64.14.00.Desktop.appx')
  let uiAppx = resourcePath('winget', 'Microsoft.UI.Xaml.2.8.x64.appx')
  let wingetBundle = resourcePath('winget', 'Microsoft.DesktopAppInstaller.msixbundle')
  let dependencyPackages = [
    findResourceFile(['winget', 'DesktopAppInstaller_Dependencies', 'x64'], /^Microsoft\.VCLibs\.140\.00_.*_x64\.appx$/i),
    findResourceFile(['winget', 'DesktopAppInstaller_Dependencies', 'x64'], /^Microsoft\.VCLibs\.140\.00\.UWPDesktop_.*_x64\.appx$/i),
    findResourceFile(['winget', 'DesktopAppInstaller_Dependencies', 'x64'], /^Microsoft\.WindowsAppRuntime\.1\.8_.*_x64\.appx$/i)
  ].filter(Boolean)

  if (fs.existsSync(vclibs) && fs.existsSync(uiAppx) && fs.existsSync(wingetBundle)) {
    log('winget', 'ok', '使用安装包内置 winget/App Installer 离线依赖')
  } else {
    log('winget', 'info', '内置 winget 依赖不存在，改为联网下载')
    const wingetAsset = await resolveLatestWingetBundle()
    wingetBundle = path.join(tempRoot, wingetAsset.name)
    vclibs = path.join(tempRoot, 'Microsoft.VCLibs.x64.14.00.Desktop.appx')
    const uiNupkg = path.join(tempRoot, 'Microsoft.UI.Xaml.2.8.7.nupkg')
    const uiZip = path.join(tempRoot, 'Microsoft.UI.Xaml.2.8.7.zip')
    const uiDir = path.join(tempRoot, 'Microsoft.UI.Xaml.2.8.7')
    uiAppx = path.join(tempRoot, 'Microsoft.UI.Xaml.2.8.x64.appx')

    await downloadFile('winget', WINGET_VCLIBS_URL, vclibs)
    await downloadFile('winget', WINGET_UIXAML_NUPKG_URL, uiNupkg)
    await downloadFile('winget', wingetAsset.url, wingetBundle)

    const extractScript = [
      '$ErrorActionPreference = "Stop"',
      `$uiNupkg = ${psQuote(uiNupkg)}`,
      `$uiZip = ${psQuote(uiZip)}`,
      `$uiDir = ${psQuote(uiDir)}`,
      `$uiAppxOut = ${psQuote(uiAppx)}`,
      'if (Test-Path $uiDir) { Remove-Item -Recurse -Force $uiDir }',
      'Copy-Item $uiNupkg $uiZip -Force',
      'Expand-Archive -Path $uiZip -DestinationPath $uiDir -Force',
      '$found = Get-ChildItem -Path (Join-Path $uiDir "tools\\AppX\\x64\\Release") -Filter "Microsoft.UI.Xaml*.appx" | Select-Object -First 1',
      'if (-not $found) { throw "Microsoft.UI.Xaml x64 appx not found in NuGet package" }',
      'Copy-Item $found.FullName $uiAppxOut -Force'
    ].join('; ')
    await runPowershell('winget', extractScript, { timeoutMs: 120000 })
  }

  const packages = [...dependencyPackages, vclibs, uiAppx, wingetBundle].filter(Boolean)
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$packages = @(${packages.map(psQuote).join(',')})`,
    'foreach ($pkg in $packages) {',
    '  if (-not (Test-Path $pkg)) { throw "AppX package not found: $pkg" }',
    '  Write-Output "Installing AppX package: $pkg"',
    '  try {',
    '    Add-AppxPackage -Path $pkg -ErrorAction Stop',
    '  } catch {',
    '    $errText = ($_ | Out-String)',
    '    if ($errText -match "0x80073D06|0x80073CFB|higher version|newer version|already installed|already exists|已安装|更高版本") {',
    '      Write-Output "AppX package already present or newer: $pkg"',
    '      continue',
    '    }',
    '    $activity = ""',
    '    if ($errText -match "\\[ActivityId\\]\\s+([0-9a-fA-F-]+)") { $activity = $Matches[1] }',
    '    if ($activity) {',
    '      $details = Get-AppPackageLog -ActivityID $activity | Select-Object -First 40 | Out-String',
    '      throw "$errText`nAppx deployment log:`n$details"',
    '    }',
    '    throw',
    '  }',
    '}'
  ].join('; ')

  await runPowershell('winget', script, { timeoutMs: 900000 })
  await refreshPath()
}

async function ensureWinget(requiredForCodex) {
  send('step-start', { id: 'winget', label: '检查/安装 winget' })
  await refreshPath()

  if (wingetExists()) {
    const ver = wingetVersion()
    log('winget', 'ok', `已检测到 winget ${ver}`)
    send('step-done', { id: 'winget', message: `winget 已就绪 ${ver}` })
    return true
  }

  log('winget', 'info', '未检测到 winget，尝试注册系统已有 App Installer')
  if (await tryRegisterExistingWinget()) {
    const ver = wingetVersion()
    send('step-done', { id: 'winget', message: `winget 已注册 ${ver}` })
    return true
  }

  try {
    log('winget', 'info', '开始下载并安装 winget/App Installer 及依赖')
    await installWingetPackage()
    if (!(await waitForWingetReady(120000))) {
      throw new Error('安装完成后仍未检测到 winget 命令，可能需要重启 Windows')
    }
    const ver = wingetVersion()
    send('step-done', { id: 'winget', message: `winget 安装完成 ${ver}` })
    return true
  } catch (err) {
    const message = `winget 自动安装失败: ${err.message}`
    log('winget', 'error', message)
    if (requiredForCodex) {
      throw new Error(`${message}。Codex AI客户端需要 winget 或 Microsoft Store 才能自动安装。`)
    }
    send('step-warn', { id: 'winget', message })
    return false
  }
}

async function installCodexDesktop() {
  send('step-start', { id: 'target', label: '安装 Codex AI客户端' })

  if (codexDesktopExists()) {
    log('target', 'ok', 'Codex desktop already installed; skipping winget install')
    send('step-done', { id: 'target', message: '已检测到 Codex AI客户端，跳过安装' })
    return
  }

  if (!wingetExists()) {
    throw new Error('未检测到 winget，无法自动安装 Codex AI客户端。请打开 Microsoft Store 手动安装 Codex。')
  }

  try {
    await runWinget('target', ['source', 'update'], { timeoutMs: 300000 })
  } catch (err) {
    log('target', 'error', `winget source update failed, continuing: ${err.message}`)
  }

  const attempts = [
    {
      label: 'product id silent',
      args: [
        'install',
        '--id',
        CODEX_STORE_PRODUCT_ID,
        '-e',
        '-s',
        'msstore',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--silent'
      ]
    },
    {
      label: 'product id interactive',
      args: [
        'install',
        '--id',
        CODEX_STORE_PRODUCT_ID,
        '-e',
        '-s',
        'msstore',
        '--accept-package-agreements',
        '--accept-source-agreements'
      ]
    },
    {
      label: 'name silent',
      args: [
        'install',
        'Codex',
        '-s',
        'msstore',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--silent'
      ]
    },
    {
      label: 'name interactive',
      args: [
        'install',
        'Codex',
        '-s',
        'msstore',
        '--accept-package-agreements',
        '--accept-source-agreements'
      ]
    }
  ]

  let lastError = null
  for (const attempt of attempts) {
    try {
      log('target', 'info', `Trying Codex winget install via ${attempt.label}`)
      await runWinget('target', attempt.args, { timeoutMs: 1200000 })
      lastError = null
      break
    } catch (err) {
      lastError = err
      if (await waitForCodexDesktop(15000)) {
        log('target', 'ok', `Codex detected after ${attempt.label} returned non-zero: ${err.message}`)
        send('step-done', { id: 'target', message: '已检测到 Codex AI客户端，继续配置' })
        return
      }

      if (isWingetAlreadyInstalledError(err) && await waitForCodexDesktop()) {
        log('target', 'ok', `winget reported Codex already installed during ${attempt.label}: ${err.message}`)
        send('step-done', { id: 'target', message: 'Codex is already installed; continuing configuration' })
        return
      }

      log('target', isMicrosoftStoreSourceError(err) ? 'error' : 'info', `Codex winget install failed via ${attempt.label}: ${err.message}`)
    }
  }

  if (lastError) throw lastError

  if (!await waitForCodexDesktop()) {
    throw new Error('Codex install finished but the app was not found')
  }

  send('step-done', { id: 'target', message: 'Codex AI客户端安装完成' })
}
async function installClaudeCode() {
  send('step-start', { id: 'target', label: '安装 Claude Code' })
  if (commandExists('claude')) {
    const ver = commandOutputShell('claude', ['--version'])
    send('step-done', { id: 'target', message: `已检测到 Claude Code ${ver}` })
    return
  }

  try {
    await runPowershell('target', 'irm https://claude.ai/install.ps1 | iex', { timeoutMs: 1200000 })
    await refreshPath()
    if (!commandExists('claude')) throw new Error('官方安装脚本完成，但未检测到 claude 命令')
  } catch (err) {
    log('target', 'error', `Claude 官方安装脚本失败，使用 npm fallback: ${err.message}`)
    await runCommand('target', 'npm', [
      'install',
      '-g',
      '@anthropic-ai/claude-code',
      '--registry',
      'https://registry.npmmirror.com'
    ], { timeoutMs: 1200000 })
    await refreshPath()
  }

  if (!commandExists('claude')) throw new Error('Claude Code install finished but claude command was not found')
  send('step-done', { id: 'target', message: 'Claude Code 安装完成' })
}

async function resolveLatestCCSwitchMsi() {
  try {
    const res = await fetch(CC_SWITCH_RELEASE_API, {
      headers: { 'User-Agent': 'AI-Coder-Installer' }
    })
    if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`)
    const release = await res.json()
    const asset = (release.assets || []).find(item => /windows.*\.msi$/i.test(item.name))
    if (!asset) throw new Error('最新 Release 中未找到 Windows MSI')
    return {
      name: asset.name,
      url: asset.browser_download_url
    }
  } catch (err) {
    log('ccswitch', 'error', `获取 CC Switch 最新版本失败，使用 fallback: ${err.message}`)
    return {
      name: path.basename(CC_SWITCH_FALLBACK_MSI),
      url: CC_SWITCH_FALLBACK_MSI
    }
  }
}

function resolveBundledCCSwitchMsi() {
  const bundled = findResourceFile(['ccswitch'], /^CC-Switch-.*Windows\.msi$/i)
    || findResourceFile(['ccswitch'], /Windows.*\.msi$/i)
  return bundled && fs.existsSync(bundled) ? bundled : ''
}

async function resolveCCSwitchInstaller() {
  const bundled = resolveBundledCCSwitchMsi()
  if (bundled) {
    log('ccswitch', 'ok', `使用安装包内置 CC Switch MSI: ${bundled}`)
    return {
      name: path.basename(bundled),
      path: bundled,
      bundled: true
    }
  }

  return resolveLatestCCSwitchMsi()
}

async function downloadFile(step, url, destination, timeoutMs = 1200000) {
  ensureDir(path.dirname(destination))
  log(step, 'info', `下载: ${url}`)

  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const tempDestination = `${destination}.download`

    try {
      if (attempt > 1) log(step, 'info', `下载重试 ${attempt}/3: ${url}`)
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'AI-Coder-Installer' }
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`下载失败 HTTP ${res.status}: ${body.slice(0, 300)}`)
      }

      if (fs.existsSync(tempDestination)) fs.rmSync(tempDestination, { force: true })
      if (fs.existsSync(destination)) fs.rmSync(destination, { force: true })
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tempDestination))
      fs.renameSync(tempDestination, destination)
      const size = fs.statSync(destination).size
      log(step, 'ok', `下载完成: ${destination} (${Math.round(size / 1024 / 1024)} MB)`)
      return
    } catch (err) {
      lastError = err.name === 'AbortError' ? new Error(`下载超时: ${url}`) : err
      if (fs.existsSync(tempDestination)) fs.rmSync(tempDestination, { force: true })
      if (attempt < 3) {
        log(step, 'error', `下载失败，准备重试: ${lastError.message}`)
        await delay(attempt * 2000)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError || new Error(`下载失败: ${url}`)
}

async function resolveLatestGitInstaller() {
  try {
    const res = await fetch(GIT_RELEASE_API, {
      headers: { 'User-Agent': 'AI-Coder-Installer' }
    })
    if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`)
    const release = await res.json()
    const asset = (release.assets || []).find(item => /Git-.*-64-bit\.exe$/i.test(item.name))
    if (!asset) throw new Error('最新 Release 中未找到 Git 64-bit 安装包')
    return {
      name: asset.name,
      url: asset.browser_download_url
    }
  } catch (err) {
    log('deps', 'error', `获取 Git 最新版本失败，使用 fallback: ${err.message}`)
    return {
      name: path.basename(GIT_FALLBACK_EXE_URL),
      url: GIT_FALLBACK_EXE_URL
    }
  }
}

function findCCSwitchExe() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cc-switch', 'cc-switch.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CC Switch', 'CC Switch.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CC Switch', 'cc-switch.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'CC Switch', 'CC Switch.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'CC Switch', 'cc-switch.exe'),
    path.join(process.env.ProgramFiles || '', 'CC Switch', 'CC Switch.exe'),
    path.join(process.env.ProgramFiles || '', 'CC Switch', 'cc-switch.exe'),
    path.join(process.env.ProgramFiles || '', 'cc-switch', 'cc-switch.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'CC Switch', 'CC Switch.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'CC Switch', 'cc-switch.exe')
  ]
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null
}

async function installCCSwitch() {
  send('step-start', { id: 'ccswitch', label: '安装 CC Switch' })
  const existing = findCCSwitchExe()
  if (existing) {
    writeConfig({ ccSwitchExePath: existing, ccSwitchOk: true })
    send('step-done', { id: 'ccswitch', message: '已检测到 CC Switch' })
    return
  }

  const asset = await resolveCCSwitchInstaller()
  const installerPath = asset.path || path.join(os.tmpdir(), asset.name)
  if (!asset.path) await downloadFile('ccswitch', asset.url, installerPath)
  await runCommand('ccswitch', 'msiexec.exe', [
    '/i',
    installerPath,
    '/qn',
    '/norestart',
    'ALLUSERS=2',
    'MSIINSTALLPERUSER=1'
  ], {
    timeoutMs: 900000,
    shell: false,
    logCommand: 'msiexec.exe /i <CC Switch MSI> /qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1'
  })

  const exePath = findCCSwitchExe()
  writeConfig({ ccSwitchExePath: exePath, ccSwitchOk: true })
  send('step-done', {
    id: 'ccswitch',
    message: exePath ? 'CC Switch 安装完成' : 'CC Switch 已安装，可从开始菜单打开'
  })
}

function ccSwitchProcessRunning() {
  try {
    const output = commandOutput('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-Process | Where-Object { $_.ProcessName -like '*cc-switch*' -or $_.ProcessName -like '*CC Switch*' } | Select-Object -First 1 -ExpandProperty Id"
    ], 10000)
    return Boolean(output)
  } catch {
    return false
  }
}

async function startCCSwitchIfNeeded(options = {}) {
  const exePath = findCCSwitchExe() || readConfig().ccSwitchExePath
  if (!exePath || !fs.existsSync(exePath)) return false
  if (ccSwitchProcessRunning()) return true

  try {
    const script = options.visible
      ? `Start-Process -FilePath ${psQuote(exePath)}`
      : `Start-Process -FilePath ${psQuote(exePath)} -WindowStyle Hidden`
    await runPowershell('ccswitch', script, {
      timeoutMs: 30000,
      echoOutput: false,
      logCommand: options.visible ? 'Start CC Switch' : 'Start CC Switch for local proxy'
    })
    await delay(3000)
    if (!options.visible) await hideCCSwitchWindow()
    return true
  } catch (err) {
    log('ccswitch', 'error', `Failed to start CC Switch: ${err.message}`)
    return false
  }
}

async function hideCCSwitchWindow() {
  try {
    const script = [
      '$signature = "[DllImport(`"user32.dll`")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);"',
      'try { Add-Type -MemberDefinition $signature -Name Win32ShowWindow -Namespace AIInstaller -ErrorAction SilentlyContinue } catch {}',
      "$procs = Get-Process | Where-Object { $_.ProcessName -like '*cc-switch*' -or $_.ProcessName -like '*CC Switch*' }",
      'foreach ($proc in $procs) {',
      '  if ($proc.MainWindowHandle -ne 0) { [AIInstaller.Win32ShowWindow]::ShowWindow($proc.MainWindowHandle, 0) | Out-Null }',
      '}'
    ].join('; ')
    await runPowershell('ccswitch', script, {
      timeoutMs: 15000,
      echoOutput: false,
      logCommand: 'Hide CC Switch window'
    })
  } catch (err) {
    log('ccswitch', 'error', `Failed to hide CC Switch window: ${err.message}`)
  }
}

async function stopCCSwitchForDatabaseWrite() {
  if (!ccSwitchProcessRunning()) return
  try {
    const script = [
      "$procs = Get-Process | Where-Object { $_.ProcessName -like '*cc-switch*' -or $_.ProcessName -like '*CC Switch*' }",
      'foreach ($proc in $procs) {',
      '  try { if ($proc.MainWindowHandle -ne 0) { $null = $proc.CloseMainWindow() } } catch {}',
      '}',
      'Start-Sleep -Seconds 2',
      "$procs = Get-Process | Where-Object { $_.ProcessName -like '*cc-switch*' -or $_.ProcessName -like '*CC Switch*' }",
      'foreach ($proc in $procs) {',
      '  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}',
      '}'
    ].join('; ')
    await runPowershell('ccswitch', script, {
      timeoutMs: 30000,
      echoOutput: false,
      logCommand: 'Close CC Switch before database update'
    })
    await delay(1000)
  } catch (err) {
    log('ccswitch', 'error', `Failed to close CC Switch before database update: ${err.message}`)
  }
}

async function ensureCCSwitchDatabaseReady(timeoutMs = 20000) {
  if (fs.existsSync(CC_SWITCH_DB)) return true
  const exePath = findCCSwitchExe() || readConfig().ccSwitchExePath
  if (!exePath || !fs.existsSync(exePath)) return false

  await startCCSwitchIfNeeded()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(CC_SWITCH_DB)) {
      await delay(1000)
      await stopCCSwitchForDatabaseWrite()
      return true
    }
    await delay(1000)
  }
  await stopCCSwitchForDatabaseWrite()
  return fs.existsSync(CC_SWITCH_DB)
}

function ensureCCSwitchSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      website_url TEXT,
      category TEXT,
      created_at INTEGER,
      sort_index INTEGER,
      notes TEXT,
      icon TEXT,
      icon_color TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      is_current BOOLEAN NOT NULL DEFAULT 0,
      in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
      cost_multiplier TEXT NOT NULL DEFAULT '1.0',
      limit_daily_usd TEXT,
      limit_monthly_usd TEXT,
      provider_type TEXT,
      PRIMARY KEY (id, app_type)
    );
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS proxy_config (
      app_type TEXT PRIMARY KEY,
      proxy_enabled INTEGER NOT NULL DEFAULT 0,
      listen_address TEXT NOT NULL DEFAULT '127.0.0.1',
      listen_port INTEGER NOT NULL DEFAULT 15721,
      enable_logging INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 0,
      auto_failover_enabled INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      streaming_first_byte_timeout INTEGER NOT NULL DEFAULT 60,
      streaming_idle_timeout INTEGER NOT NULL DEFAULT 120,
      non_streaming_timeout INTEGER NOT NULL DEFAULT 600,
      circuit_failure_threshold INTEGER NOT NULL DEFAULT 4,
      circuit_success_threshold INTEGER NOT NULL DEFAULT 2,
      circuit_timeout_seconds INTEGER NOT NULL DEFAULT 60,
      circuit_error_rate_threshold REAL NOT NULL DEFAULT 0.6,
      circuit_min_requests INTEGER NOT NULL DEFAULT 10,
      default_cost_multiplier TEXT NOT NULL DEFAULT '1',
      pricing_model_source TEXT NOT NULL DEFAULT 'response',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      live_takeover_active INTEGER NOT NULL DEFAULT 0
    );
  `)
  db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);')
}

function ccSwitchProviderSettings(appType, key) {
  const common = {
    providerType: 'openai_chat',
    provider_type: 'openai_chat',
    apiFormat: 'openai_chat',
    api_format: 'openai_chat',
    authBinding: 'ANTHROPIC_AUTH_TOKEN',
    auth_binding: 'ANTHROPIC_AUTH_TOKEN',
    apiKeyField: 'apiKey',
    api_key_field: 'apiKey',
    apiBaseUrl: normalizeBaseUrl(AGNES_BASE_URL),
    baseUrl: normalizeBaseUrl(AGNES_BASE_URL),
    base_url: normalizeBaseUrl(AGNES_BASE_URL),
    apiKey: key,
    api_key: key,
    token: key,
    accessToken: key,
    ANTHROPIC_AUTH_TOKEN: key,
    ANTHROPIC_API_KEY: key,
    OPENAI_API_KEY: key,
    primaryModel: AGNES_CODEX_MODEL,
    smallFastModel: AGNES_CODEX_MODEL,
    model: AGNES_CODEX_MODEL,
    models: [AGNES_CODEX_MODEL],
    promptCacheKey: '',
    endpointAutoSelect: false,
    custom_endpoints: []
  }

  if (appType === 'codex') {
    return {
      ...common,
      auth: {
        apiKey: key,
        api_key: key,
        token: key,
        accessToken: key,
        ANTHROPIC_AUTH_TOKEN: key,
        ANTHROPIC_API_KEY: key,
        OPENAI_API_KEY: key
      },
      env: {
        ANTHROPIC_BASE_URL: normalizeBaseUrl(AGNES_BASE_URL),
        ANTHROPIC_AUTH_TOKEN: key,
        ANTHROPIC_API_KEY: key,
        OPENAI_API_KEY: key,
        AGNES_API_KEY: key
      },
      modelCatalog: {
        models: [
          {
            model: AGNES_CODEX_MODEL,
            displayName: AGNES_CODEX_MODEL,
            contextWindow: 128000
          }
        ]
      },
      config: ccSwitchCodexProviderToml()
    }
  }

  return {
    ...common,
    auth: {
      apiKey: key,
      api_key: key,
      token: key,
      accessToken: key,
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: key,
      OPENAI_API_KEY: key
    },
    env: {
      ANTHROPIC_BASE_URL: normalizeBaseUrl(AGNES_BASE_URL),
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: key,
      ANTHROPIC_MODEL: AGNES_CLAUDE_MODEL
    }
  }
}

function upsertCCSwitchProvider(db, appType, key) {
  const now = Date.now()
  const settings = JSON.stringify(ccSwitchProviderSettings(appType, key))
  const maxSort = sqliteValue(db, 'SELECT MAX(sort_index) FROM providers WHERE app_type = ?', [appType])
  const sortIndex = Number.isFinite(Number(maxSort)) ? Number(maxSort) + 1 : 10

  sqliteRun(db, 'UPDATE providers SET is_current = 0 WHERE app_type = ?', [appType])
  sqliteRun(db, `
    INSERT INTO providers (
      id, app_type, name, settings_config, website_url, category, created_at, sort_index,
      notes, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier,
      limit_daily_usd, limit_monthly_usd, provider_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, '1.0', NULL, NULL, ?)
    ON CONFLICT(id, app_type) DO UPDATE SET
      name = excluded.name,
      settings_config = excluded.settings_config,
      website_url = excluded.website_url,
      category = excluded.category,
      sort_index = COALESCE(providers.sort_index, excluded.sort_index),
      notes = excluded.notes,
      icon = excluded.icon,
      icon_color = excluded.icon_color,
      meta = excluded.meta,
      is_current = 1,
      provider_type = excluded.provider_type
  `, [
    CC_SWITCH_PROVIDER_ID,
    appType,
    CC_SWITCH_PROVIDER_NAME,
    settings,
    AGNES_REGISTER_URL,
    'custom',
    now,
    sortIndex,
    'Generated by AI Coder Installer',
    'openai',
    '#00A67E',
    JSON.stringify({
      aiCoderInstallerManaged: true,
      liveConfigManaged: true,
      apiFormat: appType === 'codex' ? 'openai_chat' : 'openai_chat',
      api_format: 'openai_chat'
    }),
    'openai_chat'
  ])
}

function upsertCCSwitchProxyConfig(db, appType) {
  sqliteRun(db, `
    INSERT INTO proxy_config (
      app_type, proxy_enabled, listen_address, listen_port, enable_logging, enabled,
      auto_failover_enabled, max_retries, streaming_first_byte_timeout, streaming_idle_timeout,
      non_streaming_timeout, circuit_failure_threshold, circuit_success_threshold,
      circuit_timeout_seconds, circuit_error_rate_threshold, circuit_min_requests,
      default_cost_multiplier, pricing_model_source, created_at, updated_at, live_takeover_active
    ) VALUES (?, 1, ?, ?, 1, 1, 0, 3, 60, 120, 600, 4, 2, 60, 0.6, 10, '1', 'response', datetime('now'), datetime('now'), 1)
    ON CONFLICT(app_type) DO UPDATE SET
      proxy_enabled = 1,
      listen_address = excluded.listen_address,
      listen_port = excluded.listen_port,
      enable_logging = 1,
      enabled = 1,
      live_takeover_active = 1,
      updated_at = datetime('now')
  `, [appType, CC_SWITCH_LISTEN_ADDRESS, CC_SWITCH_LISTEN_PORT])
}

function upsertCCSwitchSetting(db, key, value) {
  sqliteRun(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)])
}

function writeCCSwitchDeviceSettings() {
  ensureDir(CC_SWITCH_DIR)
  const settings = readJsonObject(CC_SWITCH_SETTINGS)
  const next = {
    ...settings,
    currentProviderClaude: CC_SWITCH_PROVIDER_ID,
    currentProviderCodex: CC_SWITCH_PROVIDER_ID,
    enableLocalProxy: true,
    proxyConfirmed: true,
    commonConfigConfirmed: true,
    streamCheckConfirmed: true,
    showInTray: true,
    minimizeToTrayOnClose: true,
    silentStartup: true
  }

  fs.writeFileSync(CC_SWITCH_SETTINGS, JSON.stringify(next, null, 2), 'utf8')
  log('ccswitch', 'ok', `CC Switch device settings configured: ${CC_SWITCH_SETTINGS}`)
}

async function writeCCSwitchAgnesConfig(key) {
  ensureDir(CC_SWITCH_DIR)
  const SQL = await loadSqlJs()
  const existing = fs.existsSync(CC_SWITCH_DB) ? fs.readFileSync(CC_SWITCH_DB) : null
  const db = existing ? new SQL.Database(existing) : new SQL.Database()

  try {
    ensureCCSwitchSchema(db)
    upsertCCSwitchProvider(db, 'claude', key)
    upsertCCSwitchProvider(db, 'codex', key)
    upsertCCSwitchProxyConfig(db, 'claude')
    upsertCCSwitchProxyConfig(db, 'codex')
    upsertCCSwitchSetting(db, 'currentProviderClaude', CC_SWITCH_PROVIDER_ID)
    upsertCCSwitchSetting(db, 'currentProviderCodex', CC_SWITCH_PROVIDER_ID)
    upsertCCSwitchSetting(db, 'enableLocalProxy', 'true')
    upsertCCSwitchSetting(db, 'proxy_takeover_claude', 'true')
    upsertCCSwitchSetting(db, 'proxy_takeover_codex', 'true')
    upsertCCSwitchSetting(db, 'silentStartup', 'true')
    upsertCCSwitchSetting(db, 'showInTray', 'true')
    upsertCCSwitchSetting(db, 'minimizeToTrayOnClose', 'true')
    upsertCCSwitchSetting(db, 'proxyConfirmed', 'true')
    upsertCCSwitchSetting(db, 'commonConfigConfirmed', 'true')
    upsertCCSwitchSetting(db, 'streamCheckConfirmed', 'true')

    const data = db.export()
    fs.writeFileSync(CC_SWITCH_DB, Buffer.from(data))
    writeCCSwitchDeviceSettings()
    log('ccswitch', 'ok', `CC Switch Agnes provider configured: ${CC_SWITCH_DB}`)
  } finally {
    db.close()
  }
}

async function tryCCSwitchCodexProxySmoke(key) {
  const res = await fetchWithTimeout(`${CC_SWITCH_CODEX_BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: AGNES_CODEX_MODEL,
      input: 'reply OK only',
      max_output_tokens: 8
    })
  }, 30000)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`CC Switch proxy smoke test HTTP ${res.status}: ${body.slice(0, 400)}`)
  }
}

async function waitForCCSwitchProxy(key, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      await tryCCSwitchCodexProxySmoke(key)
      return true
    } catch (err) {
      lastError = err
    }
    await delay(2000)
  }
  if (lastError) log('ccswitch', 'error', lastError.message)
  return false
}

async function configureCCSwitchAgnes(key, target) {
  try {
    if (!await ensureCCSwitchDatabaseReady()) {
      log('ccswitch', 'error', 'CC Switch database was not created; Agnes provider was not written.')
      return false
    }

    await stopCCSwitchForDatabaseWrite()
    await writeCCSwitchAgnesConfig(key)
    await startCCSwitchIfNeeded()

    const proxyReady = target === 'codex' ? await waitForCCSwitchProxy(key, 30000) : true
    if (proxyReady) {
      log('ccswitch', 'ok', `CC Switch Agnes provider is active with local routing at ${CC_SWITCH_BASE_URL}.`)
    } else {
      log('ccswitch', 'error', `CC Switch provider was written, but local routing did not become ready at ${CC_SWITCH_BASE_URL}.`)
      send('step-warn', {
        id: 'agnes',
        message: 'Agnes provider 已写入 CC Switch，但本地路由暂未通过检测。请在 CC Switch 中确认路由开关为开启状态。'
      })
    }
    return proxyReady
  } catch (err) {
    log('ccswitch', 'error', `CC Switch Agnes provider write failed: ${err.message}`)
    return false
  }
}

function getAgnesKey() {
  const config = readConfig()
  const key = config.agnesKey || deobfuscate(AGNES_KEY_OBFUSCATED)
  const isBuiltIn = !config.agnesKey
  if (!key) {
    throw new Error('Agnes 内置 Key 未配置。请先运行 scripts/obfuscate.js 生成混淆 Key，并写入 main.js。')
  }
  return { key, isBuiltIn }
}

async function writeCommonAgnesEnv(key) {
  await setUserEnv('AGNES_API_KEY', key)
  await cleanupInstallerManagedModelEnv(key)
}

async function cleanupInstallerManagedModelEnv(key) {
  const installerValues = [
    key,
    deobfuscate(AGNES_KEY_OBFUSCATED),
    normalizeBaseUrl(AGNES_BASE_URL)
  ].filter(Boolean)

  const envNames = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY'
  ]

  const script = [
    '$ErrorActionPreference = "Stop"',
    `$names = @(${envNames.map(psQuote).join(',')})`,
    `$installerValues = @(${installerValues.map(psQuote).join(',')})`,
    'foreach ($name in $names) {',
    '  $current = [System.Environment]::GetEnvironmentVariable($name, "User")',
    '  if ($current -and ($installerValues -contains $current)) {',
    '    [System.Environment]::SetEnvironmentVariable($name, $null, "User")',
    '    Write-Output "Removed installer-managed environment variable $name"',
    '  }',
    '}'
  ].join('; ')

  await runPowershell('env', script, {
    timeoutMs: 30000,
    echoOutput: false,
    logCommand: 'Remove installer-managed OPENAI/ANTHROPIC environment variables'
  })

  for (const name of envNames) {
    if (installerValues.includes(process.env[name])) delete process.env[name]
  }
}

function codexConfigToml({ providerId, providerName, baseUrl, envKey, wireApi }) {
  return [
    '# Generated by AI Coder Installer.',
    '# To restore your previous file, use config.toml.ai-installer.bak if it exists.',
    `model = "${tomlString(AGNES_CODEX_MODEL)}"`,
    `model_provider = "${tomlString(providerId)}"`,
    '',
    `[model_providers.${providerId}]`,
    `name = "${tomlString(providerName)}"`,
    `base_url = "${tomlString(normalizeBaseUrl(baseUrl))}"`,
    `env_key = "${tomlString(envKey)}"`,
    `wire_api = "${tomlString(wireApi)}"`,
    ''
  ].join('\n')
}

function ccSwitchCodexProviderToml() {
  return [
    `model_provider = "${tomlString(CC_SWITCH_PROVIDER_ID)}"`,
    `model = "${tomlString(AGNES_CODEX_MODEL)}"`,
    'model_reasoning_effort = "high"',
    'disable_response_storage = true',
    '',
    `[model_providers.${CC_SWITCH_PROVIDER_ID}]`,
    `name = "${tomlString(CC_SWITCH_PROVIDER_NAME)}"`,
    `base_url = "${tomlString(normalizeBaseUrl(AGNES_BASE_URL))}"`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    ''
  ].join('\n')
}

function writeCodexConfig(useCCSwitchProxy = true) {
  ensureDir(CODEX_DIR)
  backupFile(CODEX_CONFIG)
  const content = codexConfigToml({
    providerId: 'ccswitch',
    providerName: 'CC Switch Agnes',
    baseUrl: CC_SWITCH_CODEX_BASE_URL,
    envKey: 'AGNES_API_KEY',
    wireApi: 'responses'
  })
  fs.writeFileSync(CODEX_CONFIG, content, 'utf8')
  log('agnes', 'ok', `Codex config written (cc-switch proxy, responses): ${CODEX_CONFIG}`)
}

function writeClaudeSettings(key, useCCSwitchProxy = false) {
  ensureDir(CLAUDE_DIR)
  backupFile(CLAUDE_SETTINGS)

  let settings = {}
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
    } catch (err) {
      log('agnes', 'error', `Claude settings.json parse failed; rewriting: ${err.message}`)
    }
  }

  settings.env = {
    ...(settings.env || {}),
    ANTHROPIC_BASE_URL: useCCSwitchProxy ? CC_SWITCH_BASE_URL : normalizeBaseUrl(AGNES_BASE_URL),
    ANTHROPIC_AUTH_TOKEN: key,
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_MODEL: AGNES_CLAUDE_MODEL
  }

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2), 'utf8')
  log('agnes', 'ok', `Claude config written (${useCCSwitchProxy ? 'cc-switch proxy' : 'direct Agnes'}): ${CLAUDE_SETTINGS}`)
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

async function trySmokeRequest(label, url, options) {
  const res = await fetchWithTimeout(url, options, 30000)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${label} HTTP ${res.status}: ${body.slice(0, 400)}`)
  }
  return true
}

async function smokeTestAgnes(target, key) {
  const base = normalizeBaseUrl(AGNES_BASE_URL)
  const attempts = []

  if (target === 'codex') {
    attempts.push({
      label: 'OpenAI Chat Completions',
      url: `${base}/chat/completions`,
      options: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: AGNES_CODEX_MODEL,
          messages: [{ role: 'user', content: 'reply OK only' }],
          max_tokens: 8
        })
      }
    })
  } else {
    attempts.push({
      label: 'Anthropic Messages',
      url: `${base}/messages`,
      options: {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: AGNES_CLAUDE_MODEL,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'reply OK only' }]
        })
      }
    })
    attempts.push({
      label: 'OpenAI Chat Completions',
      url: `${base}/chat/completions`,
      options: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: AGNES_CLAUDE_MODEL,
          messages: [{ role: 'user', content: 'reply OK only' }],
          max_tokens: 8
        })
      }
    })
  }

  const errors = []
  for (const attempt of attempts) {
    try {
      await trySmokeRequest(attempt.label, attempt.url, attempt.options)
      log('agnes', 'ok', `Agnes smoke test 通过: ${attempt.label}`)
      return
    } catch (err) {
      errors.push(err.message)
      log('agnes', 'error', `${attempt.label} 验证失败: ${err.message}`)
    }
  }
  throw new Error(`Agnes API 验证失败: ${errors.join(' | ')}`)
}

async function configureAgnes(target, overrideKey) {
  send('step-start', { id: 'agnes', label: 'Configure Agnes model' })
  const source = overrideKey ? { key: overrideKey, isBuiltIn: false } : getAgnesKey()
  await writeCommonAgnesEnv(source.key)
  const ccSwitchReady = await configureCCSwitchAgnes(source.key, target)

  if (target === 'codex') writeCodexConfig(true)
  if (target === 'claude') writeClaudeSettings(source.key, ccSwitchReady)

  if (!ccSwitchReady) {
    send('step-warn', {
      id: 'agnes',
      message: target === 'codex'
        ? 'CC Switch 本地路由暂未通过检测。Codex 配置已写为本地 responses 路由，请在 CC Switch 中启用 Generated by AI Coder Installer 的 Agnes-AI。'
        : 'CC Switch 本地路由暂未通过检测。Claude 已写入 Agnes 配置。'
    })
  }

  await smokeTestAgnes(target, source.key)

  writeConfig({
    selectedTool: target,
    agnesKeyIsBuiltIn: source.isBuiltIn,
    agnesKeySetAt: new Date().toISOString(),
    installDate: readConfig().installDate || new Date().toISOString()
  })

  send('step-done', {
    id: 'agnes',
    message: 'Agnes 已写入 CC Switch，并配置为本地 responses 路由',
    isBuiltIn: source.isBuiltIn,
    expiryDays: AGNES_KEY_EXPIRY_DAYS
  })
}
function codexAppPackageFamilyName() {
  try {
    const script = [
      "$pkg=Get-AppxPackage | Where-Object { $_.Name -like '*Codex*' -or $_.PackageFullName -like '*Codex*' } | Select-Object -First 1",
      "if ($pkg) { Write-Output $pkg.PackageFamilyName }"
    ].join('; ')
    const output = commandOutput('powershell.exe', ['-NoProfile', '-Command', script], 20000)
    return output || ''
  } catch {
    return ''
  }
}

function codexStartAppId() {
  try {
    const script = [
      "$app=Get-StartApps | Where-Object { $_.Name -like '*Codex*' -or $_.AppID -like '*Codex*' } | Select-Object -First 1",
      "if ($app) { Write-Output $app.AppID }"
    ].join('; ')
    const output = commandOutput('powershell.exe', ['-NoProfile', '-Command', script], 20000)
    return output || ''
  } catch {
    return ''
  }
}

function codexWingetListed() {
  if (!wingetExists()) return false
  try {
    const command = resolveWingetCommand()
    const output = commandOutput(command, ['list', 'Codex', '-s', 'msstore'], 120000)
    return /Codex/i.test(output)
  } catch {
    return false
  }
}

function codexDesktopExists() {
  return Boolean(codexAppPackageFamilyName() || codexStartAppId() || codexWingetListed())
}

async function waitForCodexDesktop(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (codexDesktopExists()) return true
    await delay(3000)
  }
  return codexDesktopExists()
}

function isWingetAlreadyInstalledError(err) {
  const message = String(err && err.message ? err.message : err)
  return /2316632107|-1978335189|8A15002B|No available upgrade|No newer|already installed|already.*installed|已安装|没有新版|没有可用升级|无可用升级/i.test(message)
}

function isMicrosoftStoreSourceError(err) {
  const message = String(err && err.message ? err.message : err)
  return /0x80072efd|WinHttpSendRequest|12029|No packages were found among the working sources|Failed when searching source:\s*msstore|source requires.*geographic region|msstore source|Microsoft Store/i.test(message)
}

async function verifyInstall(target, options = {}) {
  send('step-start', { id: 'verify', label: '验证安装结果' })

  if (target === 'codex') {
    if (!codexDesktopExists()) {
      if (options.allowMissingCodex) {
        send('step-warn', {
          id: 'verify',
          message: '未检测到 Codex AI客户端；Agnes 和 CC Switch 配置已完成，手动安装 Codex 后会自动读取配置'
        })
      } else {
        throw new Error('未能验证 Codex AI客户端')
      }
    }
    if (!fs.existsSync(CODEX_CONFIG)) {
      throw new Error('未找到 Codex Agnes 配置文件')
    }
    const codexConfig = fs.readFileSync(CODEX_CONFIG, 'utf8')
    if (/wire_api\s*=\s*["']chat["']/i.test(codexConfig)) {
      throw new Error('Codex 配置仍包含已不支持的 wire_api = "chat"')
    }
  }

  if (target === 'claude') {
    await runCommand('verify', 'claude', ['--version'], { timeoutMs: 120000 })
    if (!fs.existsSync(CLAUDE_SETTINGS)) {
      throw new Error('未找到 Claude Agnes 配置文件')
    }
  }

  const ccSwitchPath = findCCSwitchExe() || readConfig().ccSwitchExePath
  writeConfig({ ccSwitchExePath: ccSwitchPath || null })

  send('step-done', { id: 'verify', message: '安装验证完成' })
}

async function runInstall(target) {
  if (installRunning) return
  installRunning = true

  const selectedTarget = target === 'claude' ? 'claude' : 'codex'
  ensureConfigDir()
  fs.appendFileSync(LOG_FILE, `\n=== Install started ${new Date().toISOString()} target=${selectedTarget} ===\n`, 'utf8')
  writeConfig({ selectedTool: selectedTarget })

  let ccSwitchWarning = ''
  let targetWarning = ''
  let codexManualInstallNeeded = false

  try {
    await preflight(selectedTarget)
    await ensureWinget(selectedTarget === 'codex')
    await installDependencies()

    if (selectedTarget === 'codex') {
      try {
        await installCodexDesktop()
      } catch (err) {
        codexManualInstallNeeded = true
        targetWarning = isMicrosoftStoreSourceError(err)
          ? 'Codex 自动安装失败：当前机器的 Microsoft Store/winget msstore 源不可用。安装器将继续完成 CC Switch 和 Agnes 配置；之后请点击“打开 Microsoft Store”手动安装 Codex。'
          : `Codex 自动安装失败：${err.message}。安装器将继续完成 CC Switch 和 Agnes 配置；之后请手动安装 Codex。`
        send('step-warn', { id: 'target', message: targetWarning })
        log('target', 'error', `${targetWarning} 原始错误: ${err.message}`)
      }
    } else {
      await installClaudeCode()
    }

    try {
      await installCCSwitch()
    } catch (err) {
      ccSwitchWarning = `CC Switch 安装失败: ${err.message}`
      writeConfig({ ccSwitchOk: false, ccSwitchError: err.message })
      send('step-warn', { id: 'ccswitch', message: 'CC Switch 安装失败，可查看日志后重试' })
      log('ccswitch', 'error', ccSwitchWarning)
    }

    await configureAgnes(selectedTarget)
    await verifyInstall(selectedTarget, { allowMissingCodex: codexManualInstallNeeded })

    send('install-done', {
      target: selectedTarget,
      logFile: LOG_FILE,
      ccSwitchWarning,
      targetWarning,
      expiryDays: AGNES_KEY_EXPIRY_DAYS,
      agnesRegisterUrl: AGNES_REGISTER_URL
    })
  } catch (err) {
    const action = selectedTarget === 'codex' && /winget|Microsoft Store|Codex/i.test(err.message)
      ? 'open-store'
      : undefined
    send('step-error', { message: err.message, action })
    log('install', 'error', `安装中止: ${err.message}`)
  } finally {
    installRunning = false
  }
}

function openCodexDesktop() {
  const appId = codexStartAppId()
  if (appId) {
    spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], {
      detached: true,
      shell: false,
      windowsHide: true
    })
    return true
  }

  const family = codexAppPackageFamilyName()
  if (family) {
    spawn('explorer.exe', [`shell:AppsFolder\\${family}!App`], {
      detached: true,
      shell: false,
      windowsHide: true
    })
    return true
  }
  return false
}

function openClaudeTerminal() {
  spawn('cmd.exe', ['/d', '/s', '/c', 'start "" cmd.exe /k claude'], {
    detached: true,
    shell: false,
    windowsHide: false
  })
}

function openCCSwitch() {
  const config = readConfig()
  const exePath = config.ccSwitchExePath || findCCSwitchExe()
  if (exePath && fs.existsSync(exePath)) {
    shell.openPath(exePath)
    return true
  }
  return false
}

ipcMain.on('start-install', (_event, payload = {}) => {
  runInstall(payload.target)
})

ipcMain.on('open-log', () => {
  ensureConfigDir()
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '', 'utf8')
  shell.openPath(LOG_FILE)
})

ipcMain.on('open-store', () => {
  shell.openExternal(CODEX_STORE_URI).catch(() => shell.openExternal(CODEX_STORE_WEB_URL))
})

ipcMain.on('open-agnes-register', () => {
  shell.openExternal(AGNES_REGISTER_URL)
})

ipcMain.on('open-tool', (_event, payload = {}) => {
  const tool = payload.tool
  if (tool === 'codex') {
    if (!openCodexDesktop()) {
      send('tool-not-found', {
        tool,
        hint: '未找到 Codex AI客户端，请从开始菜单搜索 Codex，或点击打开 Microsoft Store。'
      })
    }
    return
  }

  if (tool === 'claude') {
    openClaudeTerminal()
    return
  }

  if (tool === 'ccswitch') {
    if (!openCCSwitch()) {
      send('tool-not-found', {
        tool,
        hint: '未找到 CC Switch，请从开始菜单搜索 CC Switch。'
      })
    }
  }
})

ipcMain.handle('get-config', () => readConfig())

ipcMain.handle('get-support-info', () => ({
  links: Object.entries(SUPPORT_LINKS).map(([id, item]) => ({
    id,
    label: item.label,
    detail: item.detail,
    clickable: Boolean(item.url),
    pending: !item.url
  })),
  donationQr: `assets/${DONATION_QR_FILE}`
}))

ipcMain.on('open-support-link', (_event, payload = {}) => {
  const id = String(payload.id || '')
  const item = SUPPORT_LINKS[id]
  if (!item) {
    send('support-link-result', { ok: false, message: '未知入口' })
    return
  }
  if (!item.url) {
    send('support-link-result', { ok: false, message: `${item.label}${item.detail ? `：${item.detail}` : '暂未开放'}` })
    return
  }
  shell.openExternal(item.url).then(() => {
    send('support-link-result', { ok: true, message: `已打开：${item.label}` })
  }).catch(err => {
    send('support-link-result', { ok: false, message: `打开失败：${err.message}` })
  })
})

ipcMain.on('save-key', async (_event, payload = {}) => {
  const key = String(payload.key || '').trim()
  const target = payload.target === 'claude' ? 'claude' : 'codex'

  if (!key) {
    send('save-key-result', { ok: false, message: '请输入 Agnes Key' })
    return
  }

  try {
    log('agnes', 'info', `开始验证用户 Key: ${maskSecret(key)}`)
    await smokeTestAgnes(target, key)
    await writeCommonAgnesEnv(key)
    const ccSwitchImportOpened = await configureCCSwitchAgnes(key, target)
    if (target === 'codex') writeCodexConfig(true)
    if (target === 'claude') writeClaudeSettings(key, ccSwitchImportOpened)
    writeConfig({
      selectedTool: target,
      agnesKey: key,
      agnesKeyIsBuiltIn: false,
      agnesKeySetAt: new Date().toISOString()
    })
    send('save-key-result', { ok: true })
  } catch (err) {
    send('save-key-result', {
      ok: false,
      message: `Key 验证失败，请检查 Key 是否正确、模型是否可用或额度是否充足。错误详情：${err.message}`
    })
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 760,
    minWidth: 560,
    minHeight: 680,
    title: 'Codex 一键安装工具',
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'install.html'))
  mainWindow.setMenuBarVisibility(false)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

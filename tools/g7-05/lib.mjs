// Shared utilities for G7-05 Linux desktop packaging, T1 smoke, T2 zero-network, and T6 performance measurements.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { sha256File } from './fixtures-data.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '../..')

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function safeGit(repoRoot, args, fallback = 'unknown') {
  try {
    const out = execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || fallback
  } catch {
    return fallback
  }
}

export function collectBuildMetadata(repoRoot = REPO_ROOT) {
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const shellPkg = JSON.parse(readFileSync(join(repoRoot, 'apps/shell/package.json'), 'utf8'))
  const forkSha = safeGit(repoRoot, ['rev-parse', 'HEAD'])
  const forkShortSha = safeGit(repoRoot, ['rev-parse', '--short=12', 'HEAD'])
  const gitDescribe = safeGit(repoRoot, ['describe', '--tags', '--always', '--dirty'])
  const latestReleaseTag = safeGit(repoRoot, ['describe', '--tags', '--abbrev=0'], 'none')
  const serverVersion = process.env.UNIWORK_SERVER_VERSION?.trim() || 'unknown'

  return {
    forkSha,
    forkShortSha,
    gitDescribe,
    latestReleaseTag,
    appVersion: shellPkg.version || 'unknown',
    rootPackageVersion: rootPkg.version || 'unknown',
    serverVersion,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    collectedAt: new Date().toISOString(),
  }
}

export function findLinuxArtifacts(releaseDir = join(REPO_ROOT, 'apps/shell/release')) {
  const absDir = resolve(releaseDir)
  if (!existsSync(absDir)) {
    throw new Error(`Release directory does not exist: ${absDir}`)
  }
  const entries = readdirSync(absDir)
  const appImageName = entries.find((f) => f.endsWith('.AppImage') && !f.endsWith('.blockmap'))
  const debName = entries.find((f) => f.endsWith('.deb'))
  const rpmName = entries.find((f) => f.endsWith('.rpm'))

  const describeFile = (name) => {
    if (!name) return null
    const fullPath = join(absDir, name)
    const st = statSync(fullPath)
    return {
      name,
      path: fullPath,
      bytes: st.size,
      mib: Number((st.size / (1024 * 1024)).toFixed(2)),
      sha256: sha256File(fullPath),
    }
  }

  return {
    releaseDir: absDir,
    appImage: describeFile(appImageName),
    deb: describeFile(debName),
    rpm: describeFile(rpmName),
  }
}

export function directorySizeBytes(dirPath) {
  if (!dirPath || !existsSync(dirPath)) return 0
  let total = 0
  const stack = [resolve(dirPath)]
  while (stack.length > 0) {
    const current = stack.pop()
    let st
    try {
      st = statSync(current, { throwIfNoEntry: false })
    } catch {
      continue
    }
    if (!st) continue
    if (st.isDirectory()) {
      let children
      try {
        children = readdirSync(current)
      } catch {
        children = []
      }
      for (const child of children) {
        stack.push(join(current, child))
      }
    } else if (st.isFile()) {
      total += st.size
    }
  }
  return total
}

export function sampleProcessTreeRssKb(rootPid) {
  if (!rootPid || !existsSync('/proc')) return { rssKb: 0, processCount: 0, pids: [] }
  const childrenByPpid = new Map()
  const rssByPid = new Map()

  let procEntries
  try {
    procEntries = readdirSync('/proc')
  } catch {
    return { rssKb: 0, processCount: 0, pids: [] }
  }

  for (const name of procEntries) {
    if (!/^\d+$/.test(name)) continue
    const pid = Number(name)
    try {
      const statText = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const rparen = statText.lastIndexOf(')')
      if (rparen === -1) continue
      const afterComm = statText.slice(rparen + 2).split(' ')
      const ppid = Number(afterComm[1])
      if (Number.isFinite(ppid)) {
        let list = childrenByPpid.get(ppid)
        if (!list) {
          list = []
          childrenByPpid.set(ppid, list)
        }
        list.push(pid)
      }
      const statusText = readFileSync(`/proc/${pid}/status`, 'utf8')
      const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(statusText)
      if (match) {
        rssByPid.set(pid, Number(match[1]))
      }
    } catch {
      // Process may have exited while scanning /proc.
    }
  }

  if (!rssByPid.has(rootPid) && !childrenByPpid.has(rootPid)) {
    return { rssKb: 0, processCount: 0, pids: [] }
  }

  const visited = new Set()
  const queue = [rootPid]
  let totalRssKb = 0

  while (queue.length > 0) {
    const pid = queue.shift()
    if (visited.has(pid)) continue
    visited.add(pid)
    totalRssKb += rssByPid.get(pid) || 0
    const kids = childrenByPpid.get(pid) || []
    for (const kid of kids) {
      if (!visited.has(kid)) queue.push(kid)
    }
  }

  return {
    rssKb: totalRssKb,
    processCount: visited.size,
    pids: [...visited],
  }
}

export function createRssSampler(rootPid, intervalMs = 250) {
  let peakRssKb = 0
  let peakProcessCount = 0
  let sampleCount = 0
  const samples = []

  const tick = () => {
    const snap = sampleProcessTreeRssKb(rootPid)
    if (snap.processCount > 0) {
      sampleCount += 1
      if (snap.rssKb > peakRssKb) peakRssKb = snap.rssKb
      if (snap.processCount > peakProcessCount) peakProcessCount = snap.processCount
      samples.push({
        tsMs: Math.round(performance.now()),
        rssKb: snap.rssKb,
        processCount: snap.processCount,
      })
    }
  }

  tick()
  const timer = setInterval(tick, intervalMs)

  return {
    sampleNow: tick,
    stop() {
      clearInterval(timer)
      tick()
      return {
        peakRssKb,
        peakRssMib: Number((peakRssKb / 1024).toFixed(2)),
        peakProcessCount,
        sampleCount,
      }
    },
  }
}

function isStrictLoopbackIp(addr) {
  if (!addr) return false
  const clean = addr.trim().toLowerCase()
  return clean === '127.0.0.1' || clean === '::1' || clean === '::ffff:127.0.0.1'
}

export function parseStraceLog(straceText) {
  const lines = String(straceText || '').split(/\r?\n/)
  const inetEvents = []
  const loopbackEvents = []
  const outboundEvents = []
  const dnsEvents = []

  for (const line of lines) {
    if (!line.includes('sa_family=AF_INET')) continue
    const syscallMatch = /\b(connect|sendto)\s*\(/.exec(line)
    if (!syscallMatch) continue
    const syscall = syscallMatch[1]
    const family = line.includes('sa_family=AF_INET6') ? 'AF_INET6' : 'AF_INET'
    const portMatch = /sin6?_port=htons\((\d+)\)/.exec(line)
    const port = portMatch ? Number(portMatch[1]) : null
    const ipv4Match = /inet_addr\("([^"]+)"\)/.exec(line)
    const ipv6Match = /inet_pton\(AF_INET6,\s*"([^"]+)"/.exec(line)
    const addr = ipv4Match ? ipv4Match[1] : ipv6Match ? ipv6Match[1] : 'unknown'
    const pidMatch = /^(\d+)\s+/.exec(line.trim())
    const pid = pidMatch ? Number(pidMatch[1]) : null

    // Ignore port 0 dummy socket routing checks to unspecified 0.0.0.0 / :: if any.
    if (port === 0 && (addr === '0.0.0.0' || addr === '::')) {
      continue
    }

    const event = { pid, syscall, family, addr, port, raw: line.trim() }
    inetEvents.push(event)

    // Per G7-05 / G7-A03 spec: DNS on port 53 (including 127.0.0.53 / 127.0.0.1) counts as outbound DNS.
    if (port === 53) {
      dnsEvents.push(event)
      outboundEvents.push({ ...event, reason: 'dns_port_53' })
      continue
    }

    if (isStrictLoopbackIp(addr)) {
      loopbackEvents.push(event)
    } else {
      outboundEvents.push({ ...event, reason: 'non_loopback_ip' })
    }
  }

  return {
    totalInetEvents: inetEvents.length,
    loopbackCount: loopbackEvents.length,
    outboundCount: outboundEvents.length,
    dnsCount: dnsEvents.length,
    outboundEvents,
    dnsEvents,
  }
}

const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:'])

/**
 * Returns whether a URL uses an outbound network scheme (http/https/ws/wss/ftp)
 * targeting a non-loopback host. Every non-network scheme (genoffice-app://,
 * genoffice-docx-media://, genoffice-renderer://, devtools://, file://, data:, etc.)
 * is treated as internal.
 */
export function classifyRequestUrl(urlStr) {
  if (typeof urlStr !== 'string') return 'internal'
  const trimmed = urlStr.trim()
  if (!trimmed) return 'internal'
  const schemeMatch = /^([a-z][a-z0-9+.-]*:)/i.exec(trimmed)
  if (!schemeMatch) return 'internal'
  const protocol = schemeMatch[1].toLowerCase()
  if (!NETWORK_SCHEMES.has(protocol)) return 'internal'
  try {
    const u = new URL(trimmed)
    const host = u.hostname.toLowerCase()
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') {
      return 'loopback'
    }
    return 'outbound'
  } catch {
    return 'outbound'
  }
}

export function isOutboundNetworkUrl(urlStr) {
  return classifyRequestUrl(urlStr) === 'outbound'
}

export function parseNetLog(netLogText) {
  const raw = String(netLogText || '').trim()
  if (!raw) {
    return {
      parsedOk: false,
      totalEvents: 0,
      loopbackUrlCount: 0,
      outboundUrlCount: 0,
      outboundDnsCount: 0,
      outboundUrls: [],
      outboundDnsHosts: [],
    }
  }

  let parsed = null
  for (const suffix of ['', ']}', '"}]}']) {
    try {
      parsed = JSON.parse(raw + suffix)
      break
    } catch {
      // Try next recovery suffix in case Electron exited before writing the closing bracket.
    }
  }

  const events = Array.isArray(parsed?.events) ? parsed.events : []
  if (!parsed && raw.includes('"events"')) {
    const lines = raw.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim().replace(/,$/, '')
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue
      try {
        const obj = JSON.parse(trimmed)
        if (obj && typeof obj === 'object' && ('params' in obj || 'type' in obj)) {
          events.push(obj)
        }
      } catch {
        // Ignore unparseable header/footer lines.
      }
    }
  }

  const loopbackUrls = new Set()
  const outboundUrls = new Set()
  const outboundDnsHosts = new Set()

  for (const ev of events) {
    const params = ev?.params
    if (!params || typeof params !== 'object') continue

    if (typeof params.url === 'string') {
      const urlStr = params.url.trim()
      const kind = classifyRequestUrl(urlStr)
      if (kind === 'loopback') {
        loopbackUrls.add(urlStr)
      } else if (kind === 'outbound') {
        outboundUrls.add(urlStr)
      }
    }

    if (typeof params.host === 'string') {
      const host = params.host.trim().toLowerCase()
      if (
        host &&
        host !== '127.0.0.1' &&
        host !== 'localhost' &&
        host !== '::1' &&
        host !== '[::1]'
      ) {
        outboundDnsHosts.add(host)
      }
    }
  }

  return {
    parsedOk: events.length > 0 || parsed !== null,
    totalEvents: events.length,
    loopbackUrlCount: loopbackUrls.size,
    outboundUrlCount: outboundUrls.size,
    outboundDnsCount: outboundDnsHosts.size,
    outboundUrls: [...outboundUrls],
    outboundDnsHosts: [...outboundDnsHosts],
  }
}

export function createLaunchWrapper({
  scratchDir,
  binaryPath,
  isAppImage = false,
  straceLogPath = '',
}) {
  const wrapperPath = join(scratchDir, 'launch-uniwork-wrapper.sh')
  const lines = ['#!/usr/bin/env bash', 'set -e']
  const quotedBin = JSON.stringify(resolve(binaryPath))

  if (straceLogPath) {
    const quotedStrace = JSON.stringify(resolve(straceLogPath))
    if (isAppImage) {
      lines.push(
        `exec strace -f -s 256 -e trace=connect,sendto -o ${quotedStrace} ${quotedBin} --appimage-extract-and-run --no-sandbox --disable-gpu "$@"`,
      )
    } else {
      lines.push(
        `exec strace -f -s 256 -e trace=connect,sendto -o ${quotedStrace} ${quotedBin} --no-sandbox --disable-gpu "$@"`,
      )
    }
  } else if (isAppImage) {
    lines.push(`exec ${quotedBin} --appimage-extract-and-run --no-sandbox --disable-gpu "$@"`)
  } else {
    lines.push(`exec ${quotedBin} --no-sandbox --disable-gpu "$@"`)
  }

  writeFileSync(wrapperPath, `${lines.join('\n')}\n`, 'utf8')
  chmodSync(wrapperPath, 0o755)
  return wrapperPath
}

export function findInstancePids(rootPid, instanceId = '') {
  if (!existsSync('/proc')) return []
  const childrenByPpid = new Map()
  const matchedByEnv = new Set()
  const allPids = new Set()

  let procEntries
  try {
    procEntries = readdirSync('/proc')
  } catch {
    return []
  }

  const envNeedle = instanceId ? `G7_05_INSTANCE_ID=${instanceId}` : ''

  for (const name of procEntries) {
    if (!/^\d+$/.test(name)) continue
    const pid = Number(name)
    if (pid === process.pid) continue
    try {
      const statText = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const rparen = statText.lastIndexOf(')')
      if (rparen !== -1) {
        const afterComm = statText.slice(rparen + 2).split(' ')
        const ppid = Number(afterComm[1])
        if (Number.isFinite(ppid)) {
          let list = childrenByPpid.get(ppid)
          if (!list) {
            list = []
            childrenByPpid.set(ppid, list)
          }
          list.push(pid)
        }
      }
      allPids.add(pid)
    } catch {
      continue
    }

    if (envNeedle) {
      try {
        const envRaw = readFileSync(`/proc/${pid}/environ`, 'utf8')
        if (envRaw.includes(envNeedle)) {
          matchedByEnv.add(pid)
        }
      } catch {
        // Ignore unreadable /proc/<pid>/environ.
      }
    }
  }

  const result = new Set(matchedByEnv)
  const roots = rootPid && allPids.has(rootPid) ? [rootPid, ...matchedByEnv] : [...matchedByEnv]
  const queue = [...roots]

  while (queue.length > 0) {
    const pid = queue.shift()
    if (!pid || pid === process.pid) continue
    result.add(pid)
    const kids = childrenByPpid.get(pid) || []
    for (const kid of kids) {
      if (!result.has(kid)) queue.push(kid)
    }
  }

  return [...result]
}

export async function launchPackagedApp({
  binaryPath,
  isAppImage = false,
  args = [],
  scratchPrefix = 'g7-05-run-',
  seedOnboardingSeen = false,
  straceLogPath = '',
  netLogPath = '',
}) {
  const scratchDir = mkdtempSync(join(tmpdir(), scratchPrefix))
  const homeDir = join(scratchDir, 'home')
  const xdgConfigHome = join(scratchDir, 'xdg-config')
  const xdgCacheHome = join(scratchDir, 'xdg-cache')
  const xdgDataHome = join(scratchDir, 'xdg-data')
  mkdirSync(homeDir, { recursive: true })
  mkdirSync(xdgConfigHome, { recursive: true })
  mkdirSync(xdgCacheHome, { recursive: true })
  mkdirSync(xdgDataHome, { recursive: true })

  // In packaged mode on Linux, Electron places userData at $XDG_CONFIG_HOME/UniWork Office.
  const userDataDir = join(xdgConfigHome, 'UniWork Office')

  if (seedOnboardingSeen) {
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(join(userDataDir, 'onboarding-seen.json'), JSON.stringify({ seen: true }), 'utf8')
    writeFileSync(
      join(userDataDir, 'app-settings.json'),
      JSON.stringify({ onboardingSeen: true, language: 'en' }),
      'utf8',
    )
  }

  const wrapperPath = createLaunchWrapper({
    scratchDir,
    binaryPath,
    isAppImage,
    straceLogPath,
  })

  const launchArgs = [...args]
  if (netLogPath) {
    launchArgs.unshift(`--log-net-log=${resolve(netLogPath)}`)
  }

  // Strip ELECTRON_RUN_AS_NODE as e2e/helpers.ts does so Electron always boots as an app.
  const hostEnv = { ...process.env }
  delete hostEnv.ELECTRON_RUN_AS_NODE

  const instanceId = `g705-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const launchStartMs = performance.now()
  const app = await electron.launch({
    executablePath: wrapperPath,
    args: launchArgs,
    timeout: 90_000,
    env: {
      ...hostEnv,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_DATA_HOME: xdgDataHome,
      GENOFFICE_USER_DATA: userDataDir,
      GENOFFICE_NO_SPARE_VIEW: '1',
      GENOFFICE_LANG: 'en',
      G7_05_INSTANCE_ID: instanceId,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      ELECTRON_DISABLE_SANDBOX: '1',
      NO_AT_BRIDGE: '1',
    },
  })

  return {
    app,
    instanceId,
    scratchDir,
    userDataDir,
    xdgConfigHome,
    launchStartMs,
    cleanup() {
      try {
        rmSync(scratchDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors.
      }
    },
  }
}

export async function closePackagedApp(launched) {
  if (!launched?.app) return
  const proc = launched.app.process()
  const rootPid = proc?.pid || null
  const instanceId = launched.instanceId || ''
  const trackedPids = new Set(findInstancePids(rootPid, instanceId))
  if (rootPid) trackedPids.add(rootPid)

  // Stub Save/Don't Save close dialog to "Don't Save" (response: 1) as e2e/helpers.ts does.
  await launched.app
    .evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      })
    })
    .catch(() => {})

  try {
    await Promise.race([launched.app.close(), sleep(8_000)])
  } catch {
    // Ignore close errors and ensure full process tree termination below.
  }

  for (const pid of findInstancePids(rootPid, instanceId)) {
    trackedPids.add(pid)
  }

  const alivePids = () =>
    [...trackedPids].filter((pid) => {
      if (!pid || pid === process.pid) return false
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })

  // Send SIGTERM to any remaining child/root processes (children first).
  for (const pid of alivePids().reverse()) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Ignore if already exited.
    }
  }

  const termDeadline = Date.now() + 1_500
  while (Date.now() < termDeadline && alivePids().length > 0) {
    await sleep(100)
  }

  // Force-kill any survivors by exact PID so no child keeps xvfb-run's temp directory busy.
  for (const pid of findInstancePids(rootPid, instanceId)) {
    trackedPids.add(pid)
  }
  for (const pid of alivePids().reverse()) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Ignore if already exited.
    }
  }

  const killDeadline = Date.now() + 1_500
  while (Date.now() < killDeadline && alivePids().length > 0) {
    await sleep(50)
  }
  await sleep(300)
}

/**
 * Inspects the main-process BrowserWindow and its mounted WebContentsView children
 * (same pattern as visual-SIZE-2/stageB.cjs).
 */
export async function listShellAndEditorViews(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const shellWin = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w.webContents.getURL().includes('/out/renderer/index.html'),
    )
    const views = shellWin
      ? shellWin.contentView.children.map((v) => ({
          id: v.webContents.id,
          url: v.webContents.getURL(),
          bounds: v.getBounds(),
          focused: v.webContents.isFocused(),
        }))
      : []
    const allWc = webContents.getAllWebContents().map((wc) => ({
      id: wc.id,
      url: wc.getURL(),
      destroyed: wc.isDestroyed(),
    }))
    return {
      shellUrl: shellWin ? shellWin.webContents.getURL() : null,
      views,
      allWebContents: allWc,
    }
  })
}

/**
 * Polls document.readyState through evaluate on the live CDP session instead of
 * waitForLoadState (which can hang on Linux when CDP attach races navigation; see e2e/helpers.ts).
 */
export async function waitForDocumentReady(app, page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate(() =>
        globalThis.document.readyState !== 'loading' &&
        globalThis.window.location.href !== 'about:blank'
          ? globalThis.document.readyState
          : null,
      )
      .catch(() => null)
    if (ready) return
    await sleep(100)
  }
  const diag = await listShellAndEditorViews(app).catch((e) => String(e))
  throw new Error(
    `Window never finished loading (url: ${page.url()}, diag: ${JSON.stringify(diag)})`,
  )
}

/**
 * Waits for a Playwright Page (BrowserWindow or WebContentsView) whose URL contains `urlPart`
 * (copied from e2e/helpers.ts waitForPageWithUrl).
 */
export async function waitForPageWithUrl(app, urlPart, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    for (const candidate of app.windows()) {
      try {
        if (candidate.url().includes(urlPart)) {
          await waitForDocumentReady(app, candidate, Math.max(5_000, deadline - Date.now()))
          return candidate
        }
        // page.url() stays empty when attach raced navigation; ask the document directly
        const href = await candidate.evaluate(() => globalThis.window.location.href).catch(() => '')
        if (href.includes(urlPart)) {
          await waitForDocumentReady(app, candidate, Math.max(5_000, deadline - Date.now()))
          return candidate
        }
      } catch {
        // Candidate may still be attaching.
      }
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      const diag = await listShellAndEditorViews(app).catch((e) => ({ error: String(e) }))
      const urls = app.windows().map((p) => {
        try {
          return p.url()
        } catch {
          return '<closed>'
        }
      })
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for window URL containing "${urlPart}". Open windows: ${urls.join(', ')}; main views: ${JSON.stringify(diag)}`,
      )
    }
    await app.waitForEvent('window', { timeout: Math.min(remaining, 500) }).catch(() => {})
  }
}

export async function waitForShellReady(app, timeoutMs = 45_000) {
  // Packaged builds load file:///opt/UniWork%20Office/resources/app.asar/out/renderer/index.html
  // (or /tmp/appimage_extracted_*/resources/app.asar/out/renderer/index.html); dev loads apps/shell/out/renderer/index.html.
  const shellPage = await waitForPageWithUrl(app, '/out/renderer/index.html', timeoutMs)
  await shellPage.locator('.tab-bar').waitFor({ state: 'visible', timeout: timeoutMs })
  return shellPage
}

export async function openFixtureViaShell(shellPage, filePath) {
  const absPath = resolve(filePath)
  await shellPage.evaluate(async (targetPath) => {
    if (typeof globalThis.window?.aiOffice?.openPath === 'function') {
      await globalThis.window.aiOffice.openPath(targetPath)
      return
    }
    throw new Error(`window.aiOffice.openPath is not available on shell page (${targetPath})`)
  }, absPath)
}

/**
 * Waits for the main process to mount the editor WebContentsView matching `urlPart` in
 * the shell BrowserWindow's contentView.children (as visual-SIZE-2/stageB.cjs does) and returns
 * its corresponding Playwright Page from app.windows() (as e2e/helpers.ts does).
 */
export async function waitForEditorViewPage(app, urlPart, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = await listShellAndEditorViews(app).catch(() => null)
    const mounted =
      info?.views?.some((v) => v.url.includes(urlPart) && v.bounds.width > 0) ||
      info?.allWebContents?.some((wc) => !wc.destroyed && wc.url.includes(urlPart))
    if (mounted) break
    await sleep(100)
  }
  const remaining = Math.max(5_000, deadline - Date.now())
  return waitForPageWithUrl(app, urlPart, remaining)
}

export async function waitForFixtureFirstPaint(app, fixture, timeoutMs = 45_000) {
  const ext = fixture.ext.toLowerCase()

  // Same per-module first-paint signals as e2e/packaged-linux-smoke.spec.ts and module e2e specs.
  if (ext === 'docx') {
    const page = await waitForEditorViewPage(app, '://docs/', timeoutMs)
    await page.locator('.editor-scroll').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.waitForFunction(() => Boolean(globalThis.window.__aidocs?.editor), null, {
      timeout: timeoutMs,
    })
    await page.locator('.doc-page').first().waitFor({ state: 'visible', timeout: timeoutMs })
    return page
  }

  if (ext === 'xlsx') {
    const page = await waitForEditorViewPage(app, '://sheets/', timeoutMs)
    await page
      .locator('#univer-container')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
    await page.waitForFunction(
      () => {
        const bodyText = globalThis.document.body?.textContent || ''
        const hasSheetTab =
          bodyText.includes('Doanh thu Q1') ||
          bodyText.includes('Sheet1') ||
          Boolean(
            globalThis.document.querySelector('#univer-container [data-u-comp="slide-tab-item"]'),
          )
        if (!hasSheetTab) return false
        for (const canvas of globalThis.document.querySelectorAll('canvas')) {
          const rect = canvas.getBoundingClientRect()
          if (rect.width > 500 && rect.height > 300) return true
        }
        return false
      },
      null,
      { timeout: timeoutMs },
    )
    return page
  }

  if (ext === 'pptx') {
    const page = await waitForEditorViewPage(app, '://slides/', timeoutMs)
    await page.locator('.stage-wrap').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page
      .locator('.stage-wrap canvas')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
    return page
  }

  if (ext === 'pdf') {
    const page = await waitForEditorViewPage(app, '://pdf/', timeoutMs)
    await page.locator('.pdf-scroll').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.locator('.pdf-page').first().waitFor({ state: 'visible', timeout: timeoutMs })
    return page
  }

  if (ext === 'md') {
    const page = await waitForEditorViewPage(app, '://markdown/', timeoutMs)
    await page.locator('.editor-scroll').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.locator('.doc-editor h1').first().waitFor({ state: 'visible', timeout: timeoutMs })
    return page
  }

  if (ext === 'html') {
    const page = await waitForEditorViewPage(app, '://html/', timeoutMs)
    await page.locator('.ribbon-body').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.locator('.preview-stage').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page
      .frameLocator('.preview-frame')
      .locator('h1')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
    return page
  }

  throw new Error(`Unsupported fixture extension: ${ext}`)
}

async function waitForFileShaChange(filePath, preSaveSha, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const st = statSync(filePath)
      if (st.size > 0) {
        const curSha = sha256File(filePath)
        if (curSha !== preSaveSha) {
          return curSha
        }
      }
    } catch {
      // File may be mid-rename during atomic write.
    }
    await sleep(25)
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for saved file ${basename(filePath)} to update on disk (sha256 remained ${preSaveSha})`,
  )
}

export async function editAndSaveFixture(app, editorPage, fixture, timeoutMs = 45_000) {
  const ext = fixture.ext.toLowerCase()
  const filePath = resolve(fixture.path)
  const preSaveSha = sha256File(filePath)

  // Follow e2e/docs-edit-save.spec.ts: select end of doc via __aidocs.editor, type marker,
  // send ('menu:command', 'save') to the ://docs/ webContents, and verify on-disk file update.
  if (ext === 'docx') {
    const marker = 'UNIWORK_DOCX_SMOKE'
    await editorPage.locator('.doc-page').first().click()
    await editorPage.evaluate(() => {
      const ed = globalThis.window.__aidocs.editor
      ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    })
    await editorPage.keyboard.type(` ${marker}`, { delay: 20 })

    const saveStartMs = performance.now()
    await app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('://docs/'))
      wc?.send('menu:command', 'save')
    })
    await waitForFileShaChange(filePath, preSaveSha, timeoutMs)
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  // Follow e2e/sheets-edit-save.spec.ts: wait 1500ms for viewport range, click cell A1 on the
  // worksheet canvas, type into the cell, press Enter, and send ('menu:action', 'save') to ://sheets/.
  if (ext === 'xlsx') {
    await editorPage.waitForTimeout(1_500)
    const grid = await editorPage.evaluate(() => {
      for (const canvas of globalThis.document.querySelectorAll('canvas')) {
        const rect = canvas.getBoundingClientRect()
        if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
      }
      return null
    })
    if (!grid) throw new Error('worksheet canvas not found in sheets WebContentsView')
    await editorPage.mouse.click(grid.x + 46 + 43, grid.y + 24 + 12)
    await editorPage
      .locator('[data-u-comp="defined-name"] input')
      .waitFor({ state: 'visible', timeout: timeoutMs })
    await editorPage.keyboard.type('Hello', { delay: 50 })
    await editorPage.keyboard.press('Enter')

    const saveStartMs = performance.now()
    await app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('://sheets/'))
      wc?.send('menu:action', 'save')
    })
    await waitForFileShaChange(filePath, preSaveSha, timeoutMs)
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  // Follow e2e/slides-edit-save.spec.ts: edit via window.slidesApi.findReplace (fallback setNotes)
  // and send ('slides:menu', 'save') to the ://slides/ webContents.
  if (ext === 'pptx') {
    const marker = 'UNIWORK_PPTX_SMOKE'
    const replaced = await editorPage.evaluate(
      async ({ find, replace }) => {
        return globalThis.window.slidesApi.findReplace({ find, replace })
      },
      { find: '2026', replace: `2026 ${marker}` },
    )
    if (!replaced || replaced.count <= 0) {
      await editorPage.evaluate(async (text) => {
        await globalThis.window.slidesApi.setNotes({ slideIndex: 0, text })
      }, marker)
    }

    const saveStartMs = performance.now()
    await app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('://slides/'))
      wc?.send('slides:menu', 'save')
    })
    await waitForFileShaChange(filePath, preSaveSha, timeoutMs)
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  if (ext === 'pdf') {
    const saveStartMs = performance.now()
    const saveRes = await editorPage.evaluate(async (targetPath) => {
      return globalThis.window.pdfApi.save({
        path: targetPath,
        markups: [],
        drawings: [
          {
            kind: 'note',
            pageIndex: 0,
            color: [1, 0.85, 0.2],
            at: [72, 72],
            contents: 'G7-05 local save verification',
          },
        ],
        formValues: [],
        stamps: [],
        origin: 'user',
      })
    }, filePath)
    if (!saveRes || !saveRes.ok) {
      throw new Error(`PDF save failed: ${JSON.stringify(saveRes)}`)
    }
    await waitForFileShaChange(filePath, preSaveSha, timeoutMs)
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  // Follow e2e/markdown-tab.spec.ts & e2e/uniwork-documents.spec.ts: focus end via Tiptap instance,
  // type marker, press ControlOrMeta+s, and wait for .status-save /Saved/ + file change.
  if (ext === 'md') {
    const editor = editorPage.locator('.doc-editor').first()
    await editor.click()
    await editor.evaluate((element) => {
      const tiptap = element.editor
      if (tiptap?.commands?.focus) {
        tiptap.commands.focus('end')
      }
    })
    await editorPage.keyboard.press('ControlOrMeta+End')
    await editorPage.keyboard.press('Enter')
    await editorPage.keyboard.type('UniWorkE2eEdit')
    const saveStartMs = performance.now()
    await editorPage.keyboard.press('ControlOrMeta+s')
    await editorPage
      .locator('.status-save')
      .filter({ hasText: /Saved/i })
      .waitFor({ state: 'visible', timeout: timeoutMs })
    await waitForFileShaChange(filePath, preSaveSha, timeoutMs)
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  // Follow e2e/html-tab.spec.ts & e2e/uniwork-documents.spec.ts: switch to Split view, click
  // .source-editor .cm-content, append comment at end, wait for Unsaved, press ControlOrMeta+s, wait for Saved.
  if (ext === 'html') {
    await editorPage.locator('.rb-view', { hasText: /Split/i }).click()
    const cmContent = editorPage.locator('.source-editor .cm-content').first()
    await cmContent.waitFor({ state: 'visible', timeout: timeoutMs })
    await cmContent.click()
    await editorPage.keyboard.press('ControlOrMeta+End')
    await editorPage.keyboard.type('<!-- G7-05 -->')
    await editorPage
      .locator('.status-save')
      .filter({ hasText: /Unsaved/i })
      .waitFor({ state: 'visible', timeout: timeoutMs })
    const saveStartMs = performance.now()
    await editorPage.keyboard.press('ControlOrMeta+s')
    await editorPage
      .locator('.status-save')
      .filter({ hasText: /Saved/i })
      .waitFor({ state: 'visible', timeout: timeoutMs })
    await waitForFileShaChange(filePath, preSaveSha, timeoutMs)
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  throw new Error(`Unsupported fixture extension for save: ${ext}`)
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return Number(sorted[mid].toFixed(2))
  return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
}

export function runCmd(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
  return {
    status: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  }
}

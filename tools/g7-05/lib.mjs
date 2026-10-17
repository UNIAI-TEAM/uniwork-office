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

  const ignoredSchemes = [
    'devtools:',
    'chrome:',
    'chrome-extension:',
    'data:',
    'blob:',
    'file:',
    'about:',
    'genoffice-renderer:',
    'html-preview:',
    'local-media:',
  ]

  for (const ev of events) {
    const params = ev?.params
    if (!params || typeof params !== 'object') continue

    if (typeof params.url === 'string') {
      const urlStr = params.url.trim()
      const lower = urlStr.toLowerCase()
      if (ignoredSchemes.some((scheme) => lower.startsWith(scheme))) {
        continue
      }
      try {
        const u = new URL(urlStr)
        const host = u.hostname.toLowerCase()
        if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') {
          loopbackUrls.add(urlStr)
        } else {
          outboundUrls.add(urlStr)
        }
      } catch {
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
        `exec strace -f -s 256 -e trace=connect,sendto -o ${quotedStrace} ${quotedBin} --appimage-extract-and-run --no-sandbox "$@"`,
      )
    } else {
      lines.push(
        `exec strace -f -s 256 -e trace=connect,sendto -o ${quotedStrace} ${quotedBin} --no-sandbox "$@"`,
      )
    }
  } else if (isAppImage) {
    lines.push(`exec ${quotedBin} --appimage-extract-and-run --no-sandbox "$@"`)
  } else {
    lines.push(`exec ${quotedBin} --no-sandbox "$@"`)
  }

  writeFileSync(wrapperPath, `${lines.join('\n')}\n`, 'utf8')
  chmodSync(wrapperPath, 0o755)
  return wrapperPath
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
      JSON.stringify({ onboardingSeen: true }),
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

  const launchStartMs = performance.now()
  const app = await electron.launch({
    executablePath: wrapperPath,
    args: launchArgs,
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_DATA_HOME: xdgDataHome,
      GENOFFICE_USER_DATA: userDataDir,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      ELECTRON_DISABLE_SANDBOX: '1',
      NO_AT_BRIDGE: '1',
    },
  })

  return {
    app,
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
  try {
    await Promise.race([launched.app.close(), sleep(8_000)])
  } catch {
    // Ignore close errors and ensure process termination below.
  }
  if (proc && proc.exitCode === null) {
    try {
      proc.kill('SIGTERM')
    } catch {
      // Ignore if already dead.
    }
    await sleep(500)
    if (proc.exitCode === null) {
      try {
        proc.kill('SIGKILL')
      } catch {
        // Ignore if already dead.
      }
    }
  }
}

export async function waitForPageWithUrl(app, substring, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        if (page.url().includes(substring)) {
          await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
          return page
        }
      } catch {
        // Page may be navigating or closing.
      }
    }
    await sleep(100)
  }
  const urls = app.windows().map((p) => {
    try {
      return p.url()
    } catch {
      return '<closed>'
    }
  })
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for window URL containing "${substring}". Open windows: ${urls.join(', ')}`,
  )
}

export async function waitForShellReady(app, timeoutMs = 45_000) {
  const shellPage = await waitForPageWithUrl(app, 'shell/out', timeoutMs)
  await shellPage.locator('.tab-bar').waitFor({ state: 'visible', timeout: timeoutMs })
  await shellPage.waitForFunction(() => globalThis.document.readyState === 'complete', null, {
    timeout: timeoutMs,
  })
  return shellPage
}

export async function openFixtureViaShell(shellPage, filePath) {
  const res = await shellPage.evaluate(async (targetPath) => {
    return globalThis.window.shellApi.openFileByPath(targetPath)
  }, resolve(filePath))
  if (res && res.ok === false) {
    throw new Error(
      `shellApi.openFileByPath(${basename(filePath)}) failed: ${res.error || 'unknown'}`,
    )
  }
  return res
}

export async function waitForFixtureFirstPaint(app, fixture, timeoutMs = 45_000) {
  const ext = fixture.ext.toLowerCase()
  if (ext === 'docx') {
    const page = await waitForPageWithUrl(app, '://docs/', timeoutMs)
    const editor = page.locator('.doc-editor, .ProseMirror').first()
    await editor.waitFor({ state: 'visible', timeout: timeoutMs })
    await page.waitForFunction(
      () => {
        const el = globalThis.document.querySelector('.doc-editor, .ProseMirror')
        return Boolean(el && (el.textContent || '').trim().length > 10)
      },
      null,
      { timeout: timeoutMs },
    )
    return page
  }

  if (ext === 'xlsx') {
    const page = await waitForPageWithUrl(app, '://sheets/', timeoutMs)
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.locator('.sheet-tab').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll('.sheet-tab').length >= 1,
      null,
      {
        timeout: timeoutMs,
      },
    )
    return page
  }

  if (ext === 'pptx') {
    const page = await waitForPageWithUrl(app, '://slides/', timeoutMs)
    await page
      .locator('.slide-canvas, .stage-wrap canvas')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
    await page.locator('.thumb-card').first().waitFor({ state: 'visible', timeout: timeoutMs })
    return page
  }

  if (ext === 'pdf') {
    const page = await waitForPageWithUrl(app, '://pdf/', timeoutMs)
    await page.locator('.pdf-page').first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.waitForFunction(
      () => {
        const canvas = globalThis.document.querySelector('.pdf-page canvas')
        return Boolean(canvas && canvas.width > 0 && canvas.height > 0)
      },
      null,
      { timeout: timeoutMs },
    )
    return page
  }

  if (ext === 'md') {
    const page = await waitForPageWithUrl(app, '://markdown/', timeoutMs)
    const editor = page.locator('.doc-editor').first()
    await editor.waitFor({ state: 'visible', timeout: timeoutMs })
    await page.waitForFunction(
      () => {
        const el = globalThis.document.querySelector('.doc-editor')
        return Boolean(el && (el.textContent || '').trim().length > 10)
      },
      null,
      { timeout: timeoutMs },
    )
    return page
  }

  if (ext === 'html') {
    const page = await waitForPageWithUrl(app, '://html/', timeoutMs)
    const frame = page.locator('.preview-frame').first()
    await frame.waitFor({ state: 'visible', timeout: timeoutMs })
    const body = page.frameLocator('.preview-frame').locator('body')
    await body.waitFor({ state: 'visible', timeout: timeoutMs })
    return page
  }

  throw new Error(`Unsupported fixture extension: ${ext}`)
}

export async function editAndSaveFixture(app, editorPage, fixture, timeoutMs = 45_000) {
  const ext = fixture.ext.toLowerCase()
  const filePath = resolve(fixture.path)

  if (ext === 'docx') {
    const editor = editorPage.locator('.doc-editor, .ProseMirror').first()
    await editor.click()
    await editorPage.keyboard.press('End')
    await editorPage.keyboard.type(' G7-05')
    await sleep(100)
    const saveStartMs = performance.now()
    await editorPage.keyboard.press('ControlOrMeta+s')
    await editorPage.waitForFunction(
      () => {
        const el = globalThis.document.querySelector('.save-state')
        return Boolean(el && /Saved/i.test(el.textContent || ''))
      },
      null,
      { timeout: timeoutMs },
    )
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  if (ext === 'xlsx') {
    const formulaInput = editorPage.locator('.formula-input').first()
    await formulaInput.click()
    await formulaInput.fill('G7-05')
    await formulaInput.press('Enter')
    await editorPage.waitForFunction(
      () => {
        const pill = globalThis.document.querySelector('.save-pill')
        return Boolean(pill && /Unsaved/i.test(pill.textContent || ''))
      },
      null,
      { timeout: timeoutMs },
    )
    const saveBtn = editorPage.locator('button[title="Save (Ctrl+S)"]').first()
    const saveStartMs = performance.now()
    await saveBtn.click()
    await editorPage.waitForFunction(
      () => {
        const pill = globalThis.document.querySelector('.save-pill')
        return Boolean(pill && /^Saved$/i.test((pill.textContent || '').trim()))
      },
      null,
      { timeout: timeoutMs },
    )
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  if (ext === 'pptx') {
    await editorPage.evaluate(async () => {
      await globalThis.window.slidesApi.setNotes({
        slideIndex: 0,
        text: 'G7-05 local save verification',
      })
    })
    const saveStartMs = performance.now()
    const saveRes = await editorPage.evaluate(async () => {
      return globalThis.window.slidesApi.save('user')
    })
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    if (!saveRes || !saveRes.ok) {
      throw new Error(`Slides save failed: ${JSON.stringify(saveRes)}`)
    }
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
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    if (!saveRes || !saveRes.ok) {
      throw new Error(`PDF save failed: ${JSON.stringify(saveRes)}`)
    }
    return { saveMs }
  }

  if (ext === 'md') {
    const editor = editorPage.locator('.doc-editor').first()
    await editor.click()
    await editorPage.keyboard.press('ControlOrMeta+End')
    await editorPage.keyboard.press('Enter')
    await editorPage.keyboard.type('G7-05')
    const saveStartMs = performance.now()
    await editorPage.keyboard.press('ControlOrMeta+s')
    await editorPage.waitForFunction(
      () => {
        const el = globalThis.document.querySelector('.status-save')
        return Boolean(el && /Saved/i.test(el.textContent || ''))
      },
      null,
      { timeout: timeoutMs },
    )
    const saveMs = Number((performance.now() - saveStartMs).toFixed(2))
    return { saveMs }
  }

  if (ext === 'html') {
    await editorPage.locator('.rb-view', { hasText: /Split/i }).click()
    const cmContent = editorPage.locator('.source-editor .cm-content').first()
    await cmContent.waitFor({ state: 'visible', timeout: timeoutMs })
    await cmContent.click()
    await editorPage.keyboard.press('ControlOrMeta+End')
    await editorPage.keyboard.type('<!-- G7-05 -->')
    await editorPage.waitForFunction(
      () => {
        const el = globalThis.document.querySelector('.status-save')
        return Boolean(el && /Unsaved/i.test(el.textContent || ''))
      },
      null,
      { timeout: timeoutMs },
    )
    const saveStartMs = performance.now()
    await editorPage.keyboard.press('ControlOrMeta+s')
    await editorPage.waitForFunction(
      () => {
        const el = globalThis.document.querySelector('.status-save')
        return Boolean(el && /Saved/i.test(el.textContent || ''))
      },
      null,
      { timeout: timeoutMs },
    )
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

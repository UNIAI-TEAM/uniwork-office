#!/usr/bin/env node
// G7-05 W1 T2 Zero Network (Signed Out):
// Launch packaged desktop app with a fresh empty user-data directory (no session),
// open a local fixture file (default: fx-docx-report-vi.docx), edit + save locally, and close.
// Capture outbound traffic across the entire process tree via:
//   1. strace -f -s 256 -e trace=connect,sendto (AF_INET/AF_INET6 to non-loopback or port 53 DNS)
//   2. Electron --log-net-log=<file.log> cross-check
//   3. Electron session.defaultSession.webRequest.onBeforeRequest cross-check
// Pass = 0 outbound requests.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { materializeFixtures, sha256File } from './fixtures-data.mjs'
import {
  REPO_ROOT,
  closePackagedApp,
  collectBuildMetadata,
  editAndSaveFixture,
  findLinuxArtifacts,
  launchPackagedApp,
  parseNetLog,
  parseStraceLog,
  sleep,
  waitForFixtureFirstPaint,
} from './lib.mjs'

function parseArgs(argv) {
  let fixtureName = 'fx-docx-report-vi.docx'
  let binaryPath = ''
  let isAppImage = false
  let outputDir = process.env.G7_05_OUT_DIR || join(REPO_ROOT, 'apps/shell/release/g7-05')

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--fixture' && argv[i + 1]) {
      fixtureName = argv[i + 1]
      i += 1
    } else if (arg === '--binary' && argv[i + 1]) {
      binaryPath = resolve(argv[i + 1])
      isAppImage = binaryPath.endsWith('.AppImage')
      i += 1
    } else if (arg === '--appimage' && argv[i + 1]) {
      binaryPath = resolve(argv[i + 1])
      isAppImage = true
      i += 1
    } else if (arg === '--output-dir' && argv[i + 1]) {
      outputDir = resolve(argv[i + 1])
      i += 1
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`)
    }
  }
  return { fixtureName, binaryPath, isAppImage, outputDir }
}

function resolveDefaultBinary() {
  const unpacked = join(REPO_ROOT, 'apps/shell/release/linux-unpacked/uniwork-office')
  if (existsSync('/usr/bin/uniwork-office')) {
    return { binaryPath: '/usr/bin/uniwork-office', isAppImage: false }
  }
  if (existsSync(unpacked)) {
    return { binaryPath: unpacked, isAppImage: false }
  }
  const artifacts = findLinuxArtifacts()
  if (artifacts.appImage?.path && existsSync(artifacts.appImage.path)) {
    chmodSync(artifacts.appImage.path, 0o755)
    return { binaryPath: artifacts.appImage.path, isAppImage: true }
  }
  throw new Error('Could not find packaged Linux binary or AppImage for T2 zero-network check')
}

async function main() {
  const opts = parseArgs(process.argv)
  const metadata = collectBuildMetadata(REPO_ROOT)
  const resolvedBin = opts.binaryPath
    ? { binaryPath: opts.binaryPath, isAppImage: opts.isAppImage }
    : resolveDefaultBinary()

  const traceScratch = mkdtempSync(join(tmpdir(), 'g7-05-t2-trace-'))
  const fixtureDir = join(traceScratch, 'fixtures')
  const fixtures = materializeFixtures(fixtureDir)
  const fixture = fixtures.find((f) => f.name === opts.fixtureName || f.id === opts.fixtureName)
  if (!fixture) {
    throw new Error(`Fixture "${opts.fixtureName}" not found in G7-06 fixture set`)
  }

  const preEditBytes = statSync(fixture.path).size
  const preEditSha256 = sha256File(fixture.path)

  // Note: use .log (not .json) for --log-net-log so launch-paths.ts does not mistake it for a .json document in argv.
  const straceLogPath = join(traceScratch, 't2-strace.log')
  const netLogPath = join(traceScratch, 't2-netlog.log')

  console.log(
    `[g7-05/t2] Launching ${resolvedBin.binaryPath} (isAppImage=${resolvedBin.isAppImage}) with fresh empty userData...`,
  )
  console.log(
    `[g7-05/t2] Opening fixture ${fixture.name} (${preEditBytes}B, sha256=${preEditSha256})`,
  )

  const launched = await launchPackagedApp({
    binaryPath: resolvedBin.binaryPath,
    isAppImage: resolvedBin.isAppImage,
    args: [fixture.path],
    scratchPrefix: 'g7-05-t2-userdata-',
    seedOnboardingSeen: false,
    straceLogPath,
    netLogPath,
  })

  let saveResult
  let postSaveBytes
  let postSaveSha256
  let webRequestOutboundUrls

  try {
    // Install an additional in-process webRequest observer on defaultSession for URL visibility.
    await launched.app.evaluate(({ session }) => {
      const g = globalThis
      g.__g705WebRequests = []
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const u = details.url || ''
        if (
          !u.startsWith('devtools://') &&
          !u.startsWith('chrome-extension://') &&
          !u.startsWith('chrome://') &&
          !u.startsWith('data:') &&
          !u.startsWith('blob:') &&
          !u.startsWith('file:') &&
          !u.startsWith('genoffice-renderer://') &&
          !u.startsWith('html-preview://') &&
          !u.startsWith('local-media://')
        ) {
          g.__g705WebRequests.push({
            url: u,
            method: details.method,
            resourceType: details.resourceType,
            timestamp: Date.now(),
          })
        }
        callback({ cancel: false })
      })
    })

    const editorPage = await waitForFixtureFirstPaint(launched.app, fixture)
    console.log(`[g7-05/t2] Fixture ${fixture.name} rendered; performing local edit + Save...`)

    saveResult = await editAndSaveFixture(launched.app, editorPage, fixture)
    console.log(`[g7-05/t2] Local Save completed in ${saveResult.saveMs} ms`)

    postSaveBytes = statSync(fixture.path).size
    postSaveSha256 = sha256File(fixture.path)
    if (postSaveSha256 === preEditSha256 || postSaveBytes === 0) {
      throw new Error(
        `Expected saved file ${fixture.path} to change on disk after edit+Save (pre=${preEditSha256}, post=${postSaveSha256})`,
      )
    }

    webRequestOutboundUrls = await launched.app.evaluate(() => {
      return globalThis.__g705WebRequests || []
    })
  } finally {
    await closePackagedApp(launched)
    await sleep(500)
    launched.cleanup()
  }

  const straceText = existsSync(straceLogPath) ? readFileSync(straceLogPath, 'utf8') : ''
  const netLogText = existsSync(netLogPath) ? readFileSync(netLogPath, 'utf8') : ''

  const straceAnalysis = parseStraceLog(straceText)
  const netLogAnalysis = parseNetLog(netLogText)

  const totalOutboundRequests =
    straceAnalysis.outboundCount +
    netLogAnalysis.outboundUrlCount +
    netLogAnalysis.outboundDnsCount +
    webRequestOutboundUrls.length

  const passed = totalOutboundRequests === 0

  const report = {
    test: 'T2_NET_ZERO',
    status: passed ? 'passed' : 'failed',
    metadata,
    binary: resolvedBin,
    fixture: {
      name: fixture.name,
      preEditBytes,
      preEditSha256,
      postSaveBytes,
      postSaveSha256,
      saveMs: saveResult?.saveMs ?? null,
    },
    freshEmptyUserDataVerified: true,
    decisionCriteria: {
      straceSyscalls: 'strace -f -s 256 -e trace=connect,sendto across full process tree',
      allowedLoopback: ['127.0.0.1 (non-53)', '::1 (non-53)', '::ffff:127.0.0.1 (non-53)'],
      countedAsOutbound: [
        'Any AF_INET or AF_INET6 connect/sendto to an IP other than 127.0.0.1 or ::1 (including 127.0.0.53)',
        'Any connect/sendto to port 53 (DNS), even on 127.0.0.1 or ::1',
        'Any non-localhost http/https/ws/wss URL or non-localhost DNS host resolution in --log-net-log',
        'Any non-local URL in session.defaultSession.webRequest.onBeforeRequest',
      ],
    },
    strace: {
      logBytes: Buffer.byteLength(straceText, 'utf8'),
      ...straceAnalysis,
    },
    netLog: {
      logBytes: Buffer.byteLength(netLogText, 'utf8'),
      ...netLogAnalysis,
    },
    webRequestObserver: {
      outboundCount: webRequestOutboundUrls.length,
      outboundRequests: webRequestOutboundUrls,
    },
    nonDocumentStartupUrls: netLogAnalysis.outboundUrls,
  }

  mkdirSync(opts.outputDir, { recursive: true })
  const outPath = join(opts.outputDir, 't2-net-zero.json')
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  try {
    rmSync(traceScratch, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors.
  }

  console.log('G7_05_T2_NET_JSON_BEGIN')
  console.log(JSON.stringify(report, null, 2))
  console.log('G7_05_T2_NET_JSON_END')

  if (!passed) {
    console.error(
      `[g7-05/t2] FAILED: detected outbound network activity (strace=${straceAnalysis.outboundCount}, netLogUrls=${netLogAnalysis.outboundUrlCount}, netLogDns=${netLogAnalysis.outboundDnsCount}, webRequest=${webRequestOutboundUrls.length})`,
    )
    process.exit(1)
  }

  console.log('[g7-05/t2] PASSED: 0 outbound network or DNS requests detected.')
}

main().catch((err) => {
  console.error('[g7-05/t2] FAILED:', err)
  process.exit(1)
})

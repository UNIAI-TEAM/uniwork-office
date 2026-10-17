#!/usr/bin/env node
// G7-05 W2 — T4: Pre-guard build behavior (pre-N', fcfcd29dd, v0.11.0-dev.6)
// Installs pre-N' (0.11.0, before the G5-04g store-level guard) over a store written by N+1
// (schema: 2, min_store_level: 3) and proves the known limit:
//   - parseBinding rejects schema !== 1 -> local file does NOT bind (uniworkDocStatus === null)
//   - uniworkSave returns null -> no pendingIntent queued, no pending-upload.bin written
//   - store files (binding.json, intents/<sha256>.rec, working copy) remain byte-for-byte identical
//   - zero outbound or apiOrigin upload traffic in strace + Chromium net-log
//
// Emits required exit markers:
//   T4_PRE_GUARD_EXIT=0|1
//   G7_05_T4_EXIT=0|1
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  REPO_ROOT,
  UPGRADE_MATRIX_IDS,
  closePackagedApp,
  diffTreeDigests,
  getUpgradeMatrixPaths,
  inspectUpgradeMatrixStore,
  launchPackagedApp,
  openFixtureViaShell,
  parseNetLog,
  parseStraceConnectsToTarget,
  parseStraceLog,
  runCmd,
  sleep,
  waitForFixtureFirstPaint,
  waitForShellReady,
} from './lib.mjs'

function parseArgs(argv) {
  const out = {
    matrixDir:
      process.env.G7_05_MATRIX_OUT_DIR || join(REPO_ROOT, 'apps/shell/release/g7-05-matrix'),
    outDir: process.env.G7_05_OUT_DIR || join(REPO_ROOT, 'apps/shell/release/g7-05'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--matrix-dir' && argv[i + 1]) {
      out.matrixDir = resolve(argv[++i])
    } else if (arg === '--output-dir' && argv[i + 1]) {
      out.outDir = resolve(argv[++i])
    }
  }
  return out
}

function installDebPackage(debPath, expectedVersion) {
  console.log(`[g7-05/t4] Installing ${debPath} via sudo dpkg -i ...`)
  let dpkgRes = runCmd('sudo', ['dpkg', '-i', debPath])
  if (dpkgRes.status !== 0) {
    console.log(
      '[g7-05/t4] dpkg reported missing dependencies; running sudo apt-get install -f -y ...',
    )
    runCmd('sudo', ['apt-get', 'install', '-f', '-y'])
    dpkgRes = runCmd('sudo', ['dpkg', '-i', debPath])
  }
  const queryRes = runCmd('dpkg-query', ['-W', '-f=${Status} ${Version}\\n', 'uniwork-office'])
  const queryLine = queryRes.stdout.trim()
  const ok =
    dpkgRes.status === 0 &&
    queryLine.includes('install ok installed') &&
    queryLine.endsWith(expectedVersion) &&
    existsSync('/usr/bin/uniwork-office')
  if (!ok) {
    throw new Error(
      `dpkg install check failed for ${debPath} (expected ${expectedVersion}): status=${dpkgRes.status}, query="${queryLine}", stderr="${dpkgRes.stderr.trim()}"`,
    )
  }
  return {
    debPath,
    expectedVersion,
    dpkgQuery: queryLine,
    binaryPath: '/usr/bin/uniwork-office',
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  mkdirSync(opts.outDir, { recursive: true })

  const manifestPath = join(opts.matrixDir, 'upgrade-matrix-artifacts.json')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing upgrade matrix manifest at ${manifestPath}. Run build-upgrade-matrix.sh first.`,
    )
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const { preNPrime, n1 } = manifest.builds

  const snapshotDir = join(opts.outDir, 't3-n1-env-snapshot')
  if (!existsSync(snapshotDir)) {
    throw new Error(
      `Missing N+1 environment snapshot at ${snapshotDir}. Run tools/g7-05/t3-upgrade-rollback.mjs first.`,
    )
  }

  const envRootDir = mkdtempSync(join(tmpdir(), 'g7-05-t4-env-'))
  cpSync(snapshotDir, envRootDir, { recursive: true })
  const userDataDir = join(envRootDir, 'xdg-config', 'UniWork Office')
  const paths = getUpgradeMatrixPaths(userDataDir)

  let t4Exit
  const report = {
    suite: 'T4-pre-guard',
    startedAt: new Date().toISOString(),
    builds: {
      n1,
      preNPrime,
    },
    ids: UPGRADE_MATRIX_IDS,
  }

  try {
    const beforeStore = inspectUpgradeMatrixStore(userDataDir)
    if (beforeStore.binding?.schema !== 2 || beforeStore.binding?.min_store_level !== 3) {
      throw new Error(
        `Expected N+1 store with schema=2, min_store_level=3 before T4; got ${JSON.stringify(beforeStore.binding)}`,
      )
    }

    console.log('==================================================================')
    console.log("[g7-05/t4] Installing pre-N' (v0.11.0-dev.6, fcfcd29dd) over N+1 store")
    console.log('==================================================================')
    const installRes = installDebPackage(preNPrime.deb.path, preNPrime.appVersion)

    const straceLogPath = join(opts.outDir, 't4-pre-guard.strace.log')
    const netLogPath = join(opts.outDir, 't4-pre-guard.netlog.log')

    const launched = await launchPackagedApp({
      binaryPath: '/usr/bin/uniwork-office',
      isAppImage: false,
      envRootDir,
      seedOnboardingSeen: true,
      straceLogPath,
      netLogPath,
      scratchPrefix: 'g7-05-t4-run-',
    })

    let runtime = null
    try {
      const shellPage = await waitForShellReady(launched.app)
      await openFixtureViaShell(shellPage, paths.docPath)
      const editorPage = await waitForFixtureFirstPaint(launched.app, {
        ext: 'docx',
        path: paths.docPath,
      })
      await sleep(300)

      const editorState = await editorPage.evaluate(() => {
        const pm = globalThis.document.querySelector('.ProseMirror')
        return {
          hasProseMirror: Boolean(pm),
          textLength: (pm?.textContent || '').trim().length,
        }
      })

      const shellState = await shellPage.evaluate(async (docPath) => {
        const docStatus =
          typeof globalThis.window?.aiOffice?.uniworkDocStatus === 'function'
            ? await globalThis.window.aiOffice.uniworkDocStatus(docPath)
            : null
        const saveAttempt =
          typeof globalThis.window?.aiOffice?.uniworkSave === 'function'
            ? await globalThis.window.aiOffice.uniworkSave(docPath)
            : null
        const hasUniworkLocksApi = typeof globalThis.window?.aiOffice?.uniworkLocks === 'function'
        return {
          docStatus,
          saveAttempt,
          hasUniworkLocksApi,
        }
      }, paths.docPath)

      runtime = {
        editorState,
        shellState,
      }
    } finally {
      await closePackagedApp(launched)
      launched.cleanup()
    }

    const afterStore = inspectUpgradeMatrixStore(userDataDir)
    const storeDiff = diffTreeDigests(beforeStore.combinedTree, afterStore.combinedTree)
    const straceRaw = existsSync(straceLogPath) ? readFileSync(straceLogPath, 'utf8') : ''
    const straceSummary = parseStraceLog(straceRaw)
    const apiOriginConnects = parseStraceConnectsToTarget(straceRaw, '127.0.0.1', 1)
    const netLogRaw = existsSync(netLogPath) ? readFileSync(netLogPath, 'utf8') : ''
    const netLogSummary = parseNetLog(netLogRaw)

    const pass =
      runtime?.editorState?.hasProseMirror === true &&
      runtime?.shellState?.docStatus === null &&
      runtime?.shellState?.saveAttempt === null &&
      afterStore.binding?.schema === 2 &&
      afterStore.binding?.min_store_level === 3 &&
      afterStore.hasLegacyPendingUpload === false &&
      afterStore.hasEncryptedIntentRecord === true &&
      afterStore.intentRecord?.header?.min_store_level === 3 &&
      storeDiff.identical === true &&
      straceSummary.outboundCount === 0 &&
      apiOriginConnects.count === 0 &&
      netLogSummary.outboundUrlCount === 0

    t4Exit = pass ? 0 : 1
    report.install = installRes
    report.beforeStore = beforeStore
    report.runtime = runtime
    report.afterStore = afterStore
    report.storeDiff = storeDiff
    report.network = {
      straceLogPath,
      straceOutboundCount: straceSummary.outboundCount,
      straceDnsCount: straceSummary.dnsCount,
      apiOriginConnects,
      netLogPath,
      netLogOutboundUrlCount: netLogSummary.outboundUrlCount,
    }
    report.pass = pass
  } finally {
    rmSync(envRootDir, { recursive: true, force: true })
  }

  report.completedAt = new Date().toISOString()
  report.markers = {
    T4_PRE_GUARD_EXIT: t4Exit,
    G7_05_T4_EXIT: t4Exit,
  }

  const reportPath = join(opts.outDir, 't4-pre-guard.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`[g7-05/t4] Saved T4 report to ${reportPath}`)
  console.log('G7_05_T4_JSON_BEGIN')
  console.log(JSON.stringify(report, null, 2))
  console.log('G7_05_T4_JSON_END')
  console.log(`T4_PRE_GUARD_EXIT=${t4Exit}`)
  console.log(`G7_05_T4_EXIT=${t4Exit}`)
  process.exit(t4Exit)
}

main().catch((err) => {
  console.error('[g7-05/t4] FATAL:', err)
  console.log('T4_PRE_GUARD_EXIT=1')
  console.log('G7_05_T4_EXIT=1')
  process.exit(1)
})

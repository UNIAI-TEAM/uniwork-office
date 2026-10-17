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
import { G7_06_FIXTURES, materializeFixtures } from './fixtures-data.mjs'
import {
  REPO_ROOT,
  UPGRADE_MATRIX_IDS,
  activateKeyringAndRestoreAccount,
  closePackagedApp,
  diffTreeDigests,
  editAndSaveBoundDocInN1,
  getUpgradeMatrixPaths,
  inspectUpgradeMatrixStore,
  launchPackagedApp,
  normalizeDebVersion,
  openFixtureViaShell,
  parseNetLog,
  parseStraceConnectsToTarget,
  parseStraceLog,
  readDebPackageVersion,
  runCmd,
  seedUpgradeMatrixStore,
  sleep,
  waitForFixtureFirstPaint,
  waitForShellReady,
} from './lib.mjs'

const UNEDITED_DOCX_FIXTURE_SHA256 =
  G7_06_FIXTURES.find((f) => f.id === 'fx-docx-report-vi')?.sha256 || null

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
  const debControlVersion = readDebPackageVersion(debPath)
  const expectedDebVersion = debControlVersion || normalizeDebVersion(expectedVersion)
  const ok =
    dpkgRes.status === 0 &&
    queryLine.includes('install ok installed') &&
    (queryLine.endsWith(expectedDebVersion) ||
      queryLine.endsWith(normalizeDebVersion(expectedVersion)) ||
      queryLine.endsWith(expectedVersion)) &&
    existsSync('/usr/bin/uniwork-office')
  if (!ok) {
    throw new Error(
      `dpkg install check failed for ${debPath} (expected ${expectedVersion} / deb ${expectedDebVersion}): status=${dpkgRes.status}, query="${queryLine}", stderr="${dpkgRes.stderr.trim()}"`,
    )
  }
  return {
    debPath,
    expectedVersion,
    expectedDebVersion,
    dpkgQuery: queryLine,
    binaryPath: '/usr/bin/uniwork-office',
  }
}

function isValidN1Store(storeSnap, uneditedDocSha256 = UNEDITED_DOCX_FIXTURE_SHA256) {
  return (
    storeSnap?.binding?.schema === 2 &&
    storeSnap?.binding?.min_store_level === 3 &&
    storeSnap?.binding?.state !== 'saving' &&
    storeSnap?.hasLegacyPendingUpload === false &&
    storeSnap?.hasEncryptedIntentRecord === true &&
    storeSnap?.intentRecord?.header?.min_store_level === 3 &&
    Boolean(storeSnap?.docSha256) &&
    (!uneditedDocSha256 || storeSnap.docSha256 !== uneditedDocSha256)
  )
}

async function prepareN1StoreOnProfile({ n1, envRootDir, userDataDir }) {
  console.log(
    '[g7-05/t4] N+1 snapshot missing or incomplete; building N+1-written level-3 store via real edit+save in N+1...',
  )
  let seeded = null
  const fxScratchDir = mkdtempSync(join(tmpdir(), 'g7-05-t4-fx-'))
  try {
    const fixtures = materializeFixtures(fxScratchDir)
    const docxFixture = fixtures.find((f) => f.id === 'fx-docx-report-vi')
    if (!docxFixture) {
      throw new Error('Could not find fx-docx-report-vi in G7-06 fixtures')
    }
    seeded = seedUpgradeMatrixStore({
      userDataDir,
      fixtureSourcePath: docxFixture.path,
    })
  } finally {
    rmSync(fxScratchDir, { recursive: true, force: true })
  }

  const n1Install = installDebPackage(n1.deb.path, n1.appVersion)
  const launchedN1 = await launchPackagedApp({
    binaryPath: '/usr/bin/uniwork-office',
    isAppImage: false,
    envRootDir,
    seedOnboardingSeen: true,
    scratchPrefix: 'g7-05-t4-n1-prep-',
  })
  let accountAfterRetry = null
  let editSaveRes = null
  try {
    const shellPage = await waitForShellReady(launchedN1.app)
    accountAfterRetry = await activateKeyringAndRestoreAccount(launchedN1.app, shellPage, 500)
    editSaveRes = await editAndSaveBoundDocInN1({
      app: launchedN1.app,
      shellPage,
      userDataDir,
      docPath: seeded.docPath,
      preEditDocSha256: seeded.docSha256,
      expectedLevel: 3,
      timeoutMs: 30_000,
    })
  } finally {
    await closePackagedApp(launchedN1)
    launchedN1.cleanup()
  }

  const postPrepStore = inspectUpgradeMatrixStore(userDataDir)
  if (!isValidN1Store(postPrepStore, seeded.docSha256)) {
    throw new Error(
      `[g7-05/t4] prepareN1StoreOnProfile failed to produce a valid level-3 N+1 store after edit+save: ${JSON.stringify(postPrepStore)}`,
    )
  }

  return {
    install: n1Install,
    accountAfterRetry,
    preEditDocSha256: seeded.docSha256,
    postEditDocSha256: postPrepStore.docSha256,
    saveMs: editSaveRes?.saveMs ?? null,
    cancelBeforeEdit: editSaveRes?.cancelBeforeEdit ?? null,
    fallbackSaveTriggered: editSaveRes?.fallbackSaveTriggered ?? false,
    editorState: editSaveRes?.editorState ?? null,
    bindingMinStoreLevel: postPrepStore.binding?.min_store_level ?? null,
    intentRecordMinStoreLevel: postPrepStore.intentRecord?.header?.min_store_level ?? null,
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
  const envRootDir = mkdtempSync(join(tmpdir(), 'g7-05-t4-env-'))
  const userDataDir = join(envRootDir, 'xdg-config', 'UniWork Office')
  const paths = getUpgradeMatrixPaths(userDataDir)

  let t4Exit = 1
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
    let snapshotUsed = false
    if (existsSync(snapshotDir)) {
      cpSync(snapshotDir, envRootDir, { recursive: true })
      const candidateStore = inspectUpgradeMatrixStore(userDataDir)
      if (isValidN1Store(candidateStore)) {
        snapshotUsed = true
        report.snapshotSource = 't3-n1-env-snapshot'
      } else {
        rmSync(envRootDir, { recursive: true, force: true })
        mkdirSync(envRootDir, { recursive: true })
      }
    }

    if (!snapshotUsed) {
      const n1Prep = await prepareN1StoreOnProfile({ n1, envRootDir, userDataDir })
      report.n1PrepInstall = n1Prep.install
      report.n1Prep = n1Prep
      report.snapshotSource = 'self-generated-by-n1'
      rmSync(snapshotDir, { recursive: true, force: true })
      cpSync(envRootDir, snapshotDir, { recursive: true })
    }

    const beforeStore = inspectUpgradeMatrixStore(userDataDir)
    report.preNPrimeStoreLevelAssertion = {
      verifiedBeforePreNPrimeInstall: isValidN1Store(beforeStore),
      snapshotSource: report.snapshotSource,
      bindingSchema: beforeStore.binding?.schema ?? null,
      bindingMinStoreLevel: beforeStore.binding?.min_store_level ?? null,
      bindingMinAppVersion: beforeStore.binding?.min_app_version ?? null,
      intentRecordSchema: beforeStore.intentRecord?.header?.schema ?? null,
      intentRecordMinStoreLevel: beforeStore.intentRecord?.header?.min_store_level ?? null,
      uneditedFixtureDocSha256: UNEDITED_DOCX_FIXTURE_SHA256,
      n1EditedDocSha256: beforeStore.docSha256,
      editedInN1: Boolean(
        beforeStore.docSha256 && beforeStore.docSha256 !== UNEDITED_DOCX_FIXTURE_SHA256,
      ),
    }
    if (!isValidN1Store(beforeStore)) {
      throw new Error(
        `Expected N+1 store with schema=2, min_store_level=3, encrypted level-3 intent, and edited docSha256 before T4; got ${JSON.stringify(beforeStore)}`,
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
        const locks =
          typeof globalThis.window?.aiOffice?.uniworkLocks === 'function'
            ? await globalThis.window.aiOffice.uniworkLocks()
            : 'unavailable'
        const docStatus =
          typeof globalThis.window?.aiOffice?.uniworkDocStatus === 'function'
            ? await globalThis.window.aiOffice.uniworkDocStatus(docPath)
            : 'unavailable'
        const saveAttempt =
          typeof globalThis.window?.aiOffice?.uniworkSave === 'function'
            ? await globalThis.window.aiOffice.uniworkSave(docPath)
            : 'unavailable'
        const tabs =
          typeof globalThis.window?.aiOfficeTabs?.list === 'function'
            ? await globalThis.window.aiOfficeTabs.list()
            : 'unavailable'
        return {
          locks,
          docStatus,
          saveAttempt,
          tabs,
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
      afterStore.binding?.schema === 2 &&
      afterStore.binding?.min_store_level === 3 &&
      afterStore.hasLegacyPendingUpload === false &&
      afterStore.hasEncryptedIntentRecord === true &&
      afterStore.intentRecord?.header?.min_store_level === 3 &&
      storeDiff.identical === true &&
      runtime?.shellState?.locks === 'unavailable' &&
      runtime?.shellState?.docStatus === null &&
      runtime?.shellState?.saveAttempt === null &&
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
  } catch (err) {
    report.error = String(err?.stack || err)
    console.error('[g7-05/t4] ERROR:', err)
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

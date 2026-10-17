#!/usr/bin/env node
// G7-05 W2 — T3: Upgrade & Rollback Matrix on Linux x86_64
// Exercises N' (v1.0.0-beta.3, level 2) -> N+1 (1.0.0-g705n1, level 3) -> rollback N' -> re-upgrade N+1
// on one machine and the same userData directory, installing each .deb over the previous one with dpkg -i
// (plus portable .AppImage verification during rollback).
//
// Emits required exit markers:
//   T3_UPGRADE_EXIT=0|1
//   T3_ROLLBACK_EXIT=0|1
//   T3_REUPGRADE_EXIT=0|1
//   G7_05_T3_EXIT=0|1
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
import { materializeFixtures } from './fixtures-data.mjs'
import {
  REPO_ROOT,
  UPGRADE_MATRIX_IDS,
  activateKeyringAndRestoreAccount,
  closePackagedApp,
  diffTreeDigests,
  inspectUpgradeMatrixStore,
  launchPackagedApp,
  openFixtureViaShell,
  parseNetLog,
  parseStraceConnectsToTarget,
  parseStraceLog,
  runCmd,
  seedUpgradeMatrixStore,
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
  console.log(`[g7-05/t3] Installing ${debPath} via sudo dpkg -i ...`)
  let dpkgRes = runCmd('sudo', ['dpkg', '-i', debPath])
  if (dpkgRes.status !== 0) {
    console.log(
      '[g7-05/t3] dpkg reported missing dependencies; running sudo apt-get install -f -y ...',
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
  const { nPrime, n1 } = manifest.builds

  const envRootDir = mkdtempSync(join(tmpdir(), 'g7-05-t3-env-'))
  const fxScratchDir = mkdtempSync(join(tmpdir(), 'g7-05-t3-fx-'))
  const userDataDir = join(envRootDir, 'xdg-config', 'UniWork Office')

  let upgradeExit
  let rollbackExit
  let reupgradeExit

  const report = {
    suite: 'T3-upgrade-rollback',
    startedAt: new Date().toISOString(),
    builds: {
      nPrime,
      n1,
    },
    ids: UPGRADE_MATRIX_IDS,
    steps: {},
  }

  try {
    // Materialize G7-06 fixtures and seed the initial store before Step 1.
    const fixtures = materializeFixtures(fxScratchDir)
    const docxFixture = fixtures.find((f) => f.id === 'fx-docx-report-vi')
    if (!docxFixture) {
      throw new Error('Could not find fx-docx-report-vi in G7-06 fixtures')
    }
    const seeded = seedUpgradeMatrixStore({
      userDataDir,
      fixtureSourcePath: docxFixture.path,
    })
    const step0Store = inspectUpgradeMatrixStore(userDataDir)
    report.steps.step0Seed = {
      docPath: seeded.docPath,
      docSha256: seeded.docSha256,
      store: step0Store,
    }

    // =========================================================================
    // STEP 1: Install N' (v1.0.0-beta.3, level 2), launch, migrate seed, open bound doc
    // =========================================================================
    console.log('==================================================================')
    console.log("[g7-05/t3] Step 1: Install & run N' (v1.0.0-beta.3, APP_STORE_LEVEL=2)")
    console.log('==================================================================')
    const step1Install = installDebPackage(nPrime.deb.path, nPrime.appVersion)
    let launched = await launchPackagedApp({
      binaryPath: '/usr/bin/uniwork-office',
      isAppImage: false,
      envRootDir,
      seedOnboardingSeen: true,
      scratchPrefix: 'g7-05-t3-step1-',
    })

    let step1Runtime = null
    try {
      const shellPage = await waitForShellReady(launched.app)
      const accountAfterRetry = await activateKeyringAndRestoreAccount(launched.app, shellPage, 500)
      await openFixtureViaShell(shellPage, seeded.docPath)
      const editorPage = await waitForFixtureFirstPaint(launched.app, {
        ext: 'docx',
        path: seeded.docPath,
      })
      const editorState = await editorPage.evaluate(() => {
        const pm = globalThis.document.querySelector('.ProseMirror')
        return {
          hasProseMirror: Boolean(pm),
          textLength: (pm?.textContent || '').trim().length,
          textPreview: (pm?.textContent || '').trim().slice(0, 120),
        }
      })
      const shellState = await shellPage.evaluate(async (docPath) => {
        const locks = await globalThis.window.aiOffice.uniworkLocks()
        const docStatus = await globalThis.window.aiOffice.uniworkDocStatus(docPath)
        const tabs = await globalThis.window.aiOffice.tabsList()
        return { locks, docStatus, tabs }
      }, seeded.docPath)
      step1Runtime = {
        accountAfterRetry,
        editorState,
        shellState,
      }
    } finally {
      await closePackagedApp(launched)
      launched.cleanup()
    }

    const step1Store = inspectUpgradeMatrixStore(userDataDir)
    const step1Pass =
      step1Runtime?.editorState?.hasProseMirror === true &&
      step1Runtime?.editorState?.textLength > 50 &&
      Array.isArray(step1Runtime?.shellState?.locks) &&
      step1Runtime.shellState.locks.length === 0 &&
      step1Runtime?.shellState?.docStatus?.documentId === UPGRADE_MATRIX_IDS.documentId &&
      step1Store.binding?.schema === 2 &&
      step1Store.binding?.min_store_level === 2 &&
      step1Store.binding?.min_app_version === '1.0.0' &&
      step1Store.hasLegacyPendingUpload === false &&
      step1Store.hasEncryptedIntentRecord === true &&
      step1Store.intentRecord?.header?.min_store_level === 2 &&
      step1Store.docSha256 === seeded.docSha256

    report.steps.step1NPrime = {
      pass: step1Pass,
      install: step1Install,
      runtime: step1Runtime,
      store: step1Store,
    }
    if (!step1Pass) {
      throw new Error(
        `Step 1 (N' baseline) failed assertions: ${JSON.stringify(report.steps.step1NPrime)}`,
      )
    }

    // =========================================================================
    // STEP 2: Upgrade to N+1 (1.0.0-g705n1, level 3) over N' via dpkg -i
    // =========================================================================
    console.log('==================================================================')
    console.log('[g7-05/t3] Step 2: Upgrade to N+1 (1.0.0-g705n1, APP_STORE_LEVEL=3)')
    console.log('==================================================================')
    const step2Install = installDebPackage(n1.deb.path, n1.appVersion)
    launched = await launchPackagedApp({
      binaryPath: '/usr/bin/uniwork-office',
      isAppImage: false,
      envRootDir,
      seedOnboardingSeen: true,
      scratchPrefix: 'g7-05-t3-step2-',
    })

    let step2Runtime = null
    try {
      const shellPage = await waitForShellReady(launched.app)
      const accountAfterRetry = await activateKeyringAndRestoreAccount(launched.app, shellPage, 500)
      await openFixtureViaShell(shellPage, seeded.docPath)
      const editorPage = await waitForFixtureFirstPaint(launched.app, {
        ext: 'docx',
        path: seeded.docPath,
      })
      const editorState = await editorPage.evaluate(() => {
        const pm = globalThis.document.querySelector('.ProseMirror')
        return {
          hasProseMirror: Boolean(pm),
          textLength: (pm?.textContent || '').trim().length,
          textPreview: (pm?.textContent || '').trim().slice(0, 120),
        }
      })
      const shellState = await shellPage.evaluate(async (docPath) => {
        const locks = await globalThis.window.aiOffice.uniworkLocks()
        const docStatus = await globalThis.window.aiOffice.uniworkDocStatus(docPath)
        const tabs = await globalThis.window.aiOffice.tabsList()
        return { locks, docStatus, tabs }
      }, seeded.docPath)
      step2Runtime = {
        accountAfterRetry,
        editorState,
        shellState,
      }
    } finally {
      await closePackagedApp(launched)
      launched.cleanup()
    }

    const step2Store = inspectUpgradeMatrixStore(userDataDir)
    const step2Pass =
      step2Runtime?.editorState?.hasProseMirror === true &&
      step2Runtime?.editorState?.textLength === step1Runtime.editorState.textLength &&
      Array.isArray(step2Runtime?.shellState?.locks) &&
      step2Runtime.shellState.locks.length === 0 &&
      step2Runtime?.shellState?.docStatus?.documentId === UPGRADE_MATRIX_IDS.documentId &&
      step2Store.binding?.schema === 2 &&
      step2Store.binding?.min_store_level === 3 &&
      step2Store.binding?.min_app_version === n1.appVersion &&
      step2Store.hasEncryptedIntentRecord === true &&
      step2Store.intentRecord?.header?.min_store_level === 3 &&
      step2Store.docSha256 === step1Store.docSha256

    upgradeExit = step2Pass ? 0 : 1
    report.steps.step2UpgradeN1 = {
      pass: step2Pass,
      install: step2Install,
      runtime: step2Runtime,
      store: step2Store,
    }
    console.log(`T3_UPGRADE_EXIT=${upgradeExit}`)
    if (!step2Pass) {
      throw new Error(
        `Step 2 (Upgrade to N+1) failed assertions: ${JSON.stringify(report.steps.step2UpgradeN1)}`,
      )
    }

    // =========================================================================
    // STEP 3: Rollback to N' (v1.0.0-beta.3, level 2) over N+1 via dpkg -i
    // =========================================================================
    console.log('==================================================================')
    console.log("[g7-05/t3] Step 3: Rollback to N' (v1.0.0-beta.3, APP_STORE_LEVEL=2)")
    console.log('==================================================================')
    const step3Install = installDebPackage(nPrime.deb.path, nPrime.appVersion)
    const step3StraceLogPath = join(opts.outDir, 't3-step3-rollback.strace.log')
    const step3NetLogPath = join(opts.outDir, 't3-step3-rollback.netlog.log')
    const step3ScreenshotPath = join(opts.outDir, 't3-step3-rollback-lock-panel.png')

    launched = await launchPackagedApp({
      binaryPath: '/usr/bin/uniwork-office',
      isAppImage: false,
      envRootDir,
      seedOnboardingSeen: true,
      straceLogPath: step3StraceLogPath,
      netLogPath: step3NetLogPath,
      scratchPrefix: 'g7-05-t3-step3-deb-',
    })

    let step3DebRuntime = null
    try {
      const shellPage = await waitForShellReady(launched.app)
      // Attempt to open the bound document (whose binding.json and intent .rec are now min_store_level: 3).
      await openFixtureViaShell(shellPage, seeded.docPath)
      await shellPage
        .locator('.uw-lock-panel')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
      await sleep(300)
      await shellPage.screenshot({ path: step3ScreenshotPath })

      step3DebRuntime = await shellPage.evaluate(async (docPath) => {
        const locks = await globalThis.window.aiOffice.uniworkLocks()
        const docStatus = await globalThis.window.aiOffice.uniworkDocStatus(docPath)
        const saveAttempt = await globalThis.window.aiOffice.uniworkSave(docPath)
        const tabs = await globalThis.window.aiOffice.tabsList()
        const panel = globalThis.document.querySelector('.uw-lock-panel')
        return {
          locks,
          docStatus,
          saveAttempt,
          tabs,
          lockPanelDom: panel
            ? {
                role: panel.getAttribute('role'),
                title: panel.querySelector('.uw-lock-panel__title')?.textContent?.trim() || '',
                body: panel.querySelector('.uw-lock-panel__body')?.textContent?.trim() || '',
                file: panel.querySelector('.uw-lock-panel__file')?.textContent?.trim() || '',
              }
            : null,
        }
      }, seeded.docPath)
    } finally {
      await closePackagedApp(launched)
      launched.cleanup()
    }

    const step3AfterDebStore = inspectUpgradeMatrixStore(userDataDir)
    const step3DebDiff = diffTreeDigests(step2Store.combinedTree, step3AfterDebStore.combinedTree)
    const step3StraceRaw = existsSync(step3StraceLogPath)
      ? readFileSync(step3StraceLogPath, 'utf8')
      : ''
    const step3StraceSummary = parseStraceLog(step3StraceRaw)
    const step3ServerConnects = parseStraceConnectsToTarget(step3StraceRaw, '127.0.0.1', 1)
    const step3NetLogRaw = existsSync(step3NetLogPath) ? readFileSync(step3NetLogPath, 'utf8') : ''
    const step3NetLogSummary = parseNetLog(step3NetLogRaw)

    // Portable .AppImage verification on the same N+1 store during rollback:
    console.log(
      "[g7-05/t3] Step 3b: Verifying N' .AppImage portable rollback guard on same userData...",
    )
    const appImageLaunched = await launchPackagedApp({
      binaryPath: nPrime.appImage.path,
      isAppImage: true,
      envRootDir,
      seedOnboardingSeen: true,
      scratchPrefix: 'g7-05-t3-step3-appimage-',
    })
    let step3AppImageRuntime = null
    try {
      const shellPage = await waitForShellReady(appImageLaunched.app)
      await openFixtureViaShell(shellPage, seeded.docPath)
      await shellPage
        .locator('.uw-lock-panel')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
      step3AppImageRuntime = await shellPage.evaluate(async (docPath) => {
        const locks = await globalThis.window.aiOffice.uniworkLocks()
        const docStatus = await globalThis.window.aiOffice.uniworkDocStatus(docPath)
        const saveAttempt = await globalThis.window.aiOffice.uniworkSave(docPath)
        const panel = globalThis.document.querySelector('.uw-lock-panel')
        return {
          locks,
          docStatus,
          saveAttempt,
          lockPanelTitle: panel?.querySelector('.uw-lock-panel__title')?.textContent?.trim() || '',
        }
      }, seeded.docPath)
    } finally {
      await closePackagedApp(appImageLaunched)
      appImageLaunched.cleanup()
    }

    const step3AfterAppImageStore = inspectUpgradeMatrixStore(userDataDir)
    const step3AppImageDiff = diffTreeDigests(
      step2Store.combinedTree,
      step3AfterAppImageStore.combinedTree,
    )

    const step3DocsTabsCount = (step3DebRuntime?.tabs?.tabs || []).filter(
      (t) => t.kind === 'docs',
    ).length
    const step3Pass =
      Array.isArray(step3DebRuntime?.locks) &&
      step3DebRuntime.locks.length === 1 &&
      step3DebRuntime.locks[0].reason === 'store_newer' &&
      step3DebRuntime.locks[0].path === seeded.docPath &&
      Boolean(step3DebRuntime?.lockPanelDom?.title) &&
      step3DebRuntime?.docStatus === null &&
      step3DebRuntime?.saveAttempt === null &&
      step3DocsTabsCount === 0 &&
      step3DebDiff.identical === true &&
      step3StraceSummary.outboundCount === 0 &&
      step3ServerConnects.count === 0 &&
      step3NetLogSummary.outboundUrlCount === 0 &&
      Array.isArray(step3AppImageRuntime?.locks) &&
      step3AppImageRuntime.locks.length === 1 &&
      step3AppImageRuntime.locks[0].reason === 'store_newer' &&
      step3AppImageDiff.identical === true

    rollbackExit = step3Pass ? 0 : 1
    report.steps.step3RollbackNPrime = {
      pass: step3Pass,
      install: step3Install,
      debRuntime: step3DebRuntime,
      screenshotPath: step3ScreenshotPath,
      storeAfterDeb: step3AfterDebStore,
      diffFromStep2AfterDeb: step3DebDiff,
      network: {
        straceLogPath: step3StraceLogPath,
        straceOutboundCount: step3StraceSummary.outboundCount,
        straceDnsCount: step3StraceSummary.dnsCount,
        apiOriginConnects: step3ServerConnects,
        netLogPath: step3NetLogPath,
        netLogOutboundUrlCount: step3NetLogSummary.outboundUrlCount,
      },
      appImageCheck: {
        binaryPath: nPrime.appImage.path,
        runtime: step3AppImageRuntime,
        diffFromStep2AfterAppImage: step3AppImageDiff,
      },
    }
    console.log(`T3_ROLLBACK_EXIT=${rollbackExit}`)
    if (!step3Pass) {
      throw new Error(
        `Step 3 (Rollback to N') failed assertions: ${JSON.stringify(report.steps.step3RollbackNPrime)}`,
      )
    }

    // =========================================================================
    // STEP 4: Re-upgrade to N+1 (1.0.0-g705n1, level 3) over N' via dpkg -i
    // =========================================================================
    console.log('==================================================================')
    console.log('[g7-05/t3] Step 4: Re-upgrade to N+1 (1.0.0-g705n1, APP_STORE_LEVEL=3)')
    console.log('==================================================================')
    const step4Install = installDebPackage(n1.deb.path, n1.appVersion)
    launched = await launchPackagedApp({
      binaryPath: '/usr/bin/uniwork-office',
      isAppImage: false,
      envRootDir,
      seedOnboardingSeen: true,
      scratchPrefix: 'g7-05-t3-step4-',
    })

    let step4Runtime = null
    try {
      const shellPage = await waitForShellReady(launched.app)
      const accountAfterRetry = await activateKeyringAndRestoreAccount(launched.app, shellPage, 500)
      await openFixtureViaShell(shellPage, seeded.docPath)
      const editorPage = await waitForFixtureFirstPaint(launched.app, {
        ext: 'docx',
        path: seeded.docPath,
      })
      const editorState = await editorPage.evaluate(() => {
        const pm = globalThis.document.querySelector('.ProseMirror')
        return {
          hasProseMirror: Boolean(pm),
          textLength: (pm?.textContent || '').trim().length,
          textPreview: (pm?.textContent || '').trim().slice(0, 120),
        }
      })
      const shellState = await shellPage.evaluate(async (docPath) => {
        const locks = await globalThis.window.aiOffice.uniworkLocks()
        const docStatus = await globalThis.window.aiOffice.uniworkDocStatus(docPath)
        const tabs = await globalThis.window.aiOffice.tabsList()
        return { locks, docStatus, tabs }
      }, seeded.docPath)
      step4Runtime = {
        accountAfterRetry,
        editorState,
        shellState,
      }
    } finally {
      await closePackagedApp(launched)
      launched.cleanup()
    }

    const step4Store = inspectUpgradeMatrixStore(userDataDir)
    const step4DiffFromStep2 = diffTreeDigests(step2Store.combinedTree, step4Store.combinedTree)
    const step4Pass =
      step4Runtime?.editorState?.hasProseMirror === true &&
      step4Runtime?.editorState?.textLength === step2Runtime.editorState.textLength &&
      Array.isArray(step4Runtime?.shellState?.locks) &&
      step4Runtime.shellState.locks.length === 0 &&
      step4Runtime?.shellState?.docStatus?.documentId === UPGRADE_MATRIX_IDS.documentId &&
      step4Store.binding?.schema === 2 &&
      step4Store.binding?.min_store_level === 3 &&
      step4Store.intentRecord?.header?.min_store_level === 3 &&
      step4Store.docSha256 === step2Store.docSha256 &&
      step4DiffFromStep2.identical === true

    reupgradeExit = step4Pass ? 0 : 1
    report.steps.step4ReupgradeN1 = {
      pass: step4Pass,
      install: step4Install,
      runtime: step4Runtime,
      store: step4Store,
      diffFromStep2: step4DiffFromStep2,
    }
    console.log(`T3_REUPGRADE_EXIT=${reupgradeExit}`)
    if (!step4Pass) {
      throw new Error(
        `Step 4 (Re-upgrade to N+1) failed assertions: ${JSON.stringify(report.steps.step4ReupgradeN1)}`,
      )
    }

    // Preserve a snapshot of the post-Step-4 N+1 environment so T4 (pre-N' guard) can run directly against it.
    const snapshotDir = join(opts.outDir, 't3-n1-env-snapshot')
    rmSync(snapshotDir, { recursive: true, force: true })
    cpSync(envRootDir, snapshotDir, { recursive: true })
    report.n1EnvSnapshotDir = snapshotDir
  } finally {
    rmSync(envRootDir, { recursive: true, force: true })
    rmSync(fxScratchDir, { recursive: true, force: true })
  }

  const allPass = upgradeExit === 0 && rollbackExit === 0 && reupgradeExit === 0
  report.completedAt = new Date().toISOString()
  report.markers = {
    T3_UPGRADE_EXIT: upgradeExit,
    T3_ROLLBACK_EXIT: rollbackExit,
    T3_REUPGRADE_EXIT: reupgradeExit,
    G7_05_T3_EXIT: allPass ? 0 : 1,
  }
  report.allPass = allPass

  const reportPath = join(opts.outDir, 't3-upgrade-rollback.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`[g7-05/t3] Saved T3 report to ${reportPath}`)
  console.log('G7_05_T3_JSON_BEGIN')
  console.log(JSON.stringify(report, null, 2))
  console.log('G7_05_T3_JSON_END')
  console.log(`T3_UPGRADE_EXIT=${upgradeExit}`)
  console.log(`T3_ROLLBACK_EXIT=${rollbackExit}`)
  console.log(`T3_REUPGRADE_EXIT=${reupgradeExit}`)
  console.log(`G7_05_T3_EXIT=${allPass ? 0 : 1}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error('[g7-05/t3] FATAL:', err)
  console.log('T3_UPGRADE_EXIT=1')
  console.log('T3_ROLLBACK_EXIT=1')
  console.log('T3_REUPGRADE_EXIT=1')
  console.log('G7_05_T3_EXIT=1')
  process.exit(1)
})

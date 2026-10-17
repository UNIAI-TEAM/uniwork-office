#!/usr/bin/env node
// G7-05 W1 T1 Smoke: Install, launch under xvfb-run, wait for app-ready signal, open all 6 G7-06 fixtures,
// close cleanly, and (for deb) uninstall + verify /opt/UniWork Office is removed.
// Reusable for later T3/T4 upgrade-rollback via --artifact, --keep-installed, and --user-data-dir.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { materializeFixtures, sha256File } from './fixtures-data.mjs'
import {
  REPO_ROOT,
  closePackagedApp,
  collectBuildMetadata,
  directorySizeBytes,
  findLinuxArtifacts,
  launchPackagedApp,
  openFixtureViaShell,
  runCmd,
  waitForFixtureFirstPaint,
  waitForShellReady,
} from './lib.mjs'

function parseArgs(argv) {
  let target = 'all'
  let artifactPath = ''
  let keepInstalled = false
  let outputDir = process.env.G7_05_OUT_DIR || join(REPO_ROOT, 'apps/shell/release/g7-05')

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--target' && argv[i + 1]) {
      target = argv[i + 1].toLowerCase()
      i += 1
    } else if (arg === '--artifact' && argv[i + 1]) {
      artifactPath = resolve(argv[i + 1])
      i += 1
    } else if (arg === '--keep-installed') {
      keepInstalled = true
    } else if (arg === '--output-dir' && argv[i + 1]) {
      outputDir = resolve(argv[i + 1])
      i += 1
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`)
    }
  }
  if (!['deb', 'appimage', 'all'].includes(target)) {
    throw new Error(`Invalid --target "${target}" (expected deb, appimage, or all)`)
  }
  return { target, artifactPath, keepInstalled, outputDir }
}

async function runSixFixturesSmoke({ binaryPath, isAppImage, label }) {
  const fixtureScratch = mkdtempSync(join(tmpdir(), `g7-05-t1-fixtures-${label}-`))
  const fixtures = materializeFixtures(fixtureScratch)
  const launched = await launchPackagedApp({
    binaryPath,
    isAppImage,
    scratchPrefix: `g7-05-t1-${label}-`,
    seedOnboardingSeen: true,
  })

  const fixtureResults = []
  let shellReadyMs

  try {
    const shellPage = await waitForShellReady(launched.app)
    shellReadyMs = Number((performance.now() - launched.launchStartMs).toFixed(2))
    console.log(`[g7-05/t1:${label}] Shell ready in ${shellReadyMs} ms`)

    for (const fixture of fixtures) {
      const openStart = performance.now()
      await openFixtureViaShell(shellPage, fixture.path)
      await waitForFixtureFirstPaint(launched.app, fixture)
      const openRenderMs = Number((performance.now() - openStart).toFixed(2))
      console.log(
        `[g7-05/t1:${label}] Opened and rendered ${fixture.name} (${fixture.ext}) in ${openRenderMs} ms`,
      )
      fixtureResults.push({
        id: fixture.id,
        name: fixture.name,
        ext: fixture.ext,
        bytes: fixture.bytes,
        sha256: fixture.sha256,
        openRenderMs,
        status: 'passed',
      })
    }
  } finally {
    await closePackagedApp(launched)
    launched.cleanup()
    try {
      rmSync(fixtureScratch, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors.
    }
  }

  return {
    shellReadyMs,
    fixturesChecked: fixtureResults.length,
    fixtures: fixtureResults,
  }
}

async function runDebSmoke({ artifactPath, keepInstalled, outputDir, metadata }) {
  const artifacts = artifactPath ? null : findLinuxArtifacts()
  const debPath = artifactPath || artifacts?.deb?.path
  if (!debPath || !existsSync(debPath)) {
    throw new Error(`Cannot find .deb artifact to test (looked at ${debPath || 'release dir'})`)
  }

  const debSt = statSync(debPath)
  const debSha = sha256File(debPath)
  console.log(`[g7-05/t1:deb] Installing ${debPath} (${debSt.size} bytes, sha256=${debSha})...`)

  let installRes = runCmd('sudo', [
    'DEBIAN_FRONTEND=noninteractive',
    'apt-get',
    'install',
    '-y',
    '--reinstall',
    debPath,
  ])
  if (installRes.status !== 0) {
    console.log(
      '[g7-05/t1:deb] apt-get install returned non-zero; falling back to dpkg -i + apt-get -f install...',
    )
    const dpkgRes = runCmd('sudo', ['dpkg', '-i', debPath])
    if (dpkgRes.status !== 0) {
      runCmd('sudo', ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-f', '-y'])
    }
    installRes = runCmd('dpkg', ['-s', 'uniwork-office'])
    if (installRes.status !== 0) {
      throw new Error(`Failed to install deb ${debPath}:\n${dpkgRes.stderr}\n${installRes.stderr}`)
    }
  }

  const installDir = '/opt/UniWork Office'
  const installedMainBin = '/opt/UniWork Office/uniwork-office'
  const symlinkBin = '/usr/bin/uniwork-office'
  const desktopFile = '/usr/share/applications/uniwork-office.desktop'

  if (!existsSync(installedMainBin)) {
    throw new Error(`Expected installed binary missing after deb install: ${installedMainBin}`)
  }
  if (!existsSync(symlinkBin)) {
    throw new Error(`Expected symlink missing after deb install: ${symlinkBin}`)
  }
  if (!existsSync(desktopFile)) {
    throw new Error(`Expected desktop entry missing after deb install: ${desktopFile}`)
  }

  const installedSizeBytes = directorySizeBytes(installDir)
  const installedSizeMib = Number((installedSizeBytes / (1024 * 1024)).toFixed(2))
  console.log(
    `[g7-05/t1:deb] Installed size of "${installDir}": ${installedSizeBytes} bytes (${installedSizeMib} MiB)`,
  )

  const smokeResult = await runSixFixturesSmoke({
    binaryPath: symlinkBin,
    isAppImage: false,
    label: 'deb',
  })

  let uninstalledCleanly = false
  if (!keepInstalled) {
    console.log('[g7-05/t1:deb] Uninstalling uniwork-office...')
    let rmRes = runCmd('sudo', [
      'DEBIAN_FRONTEND=noninteractive',
      'apt-get',
      'remove',
      '-y',
      'uniwork-office',
    ])
    if (rmRes.status !== 0) {
      rmRes = runCmd('sudo', ['dpkg', '-r', 'uniwork-office'])
      if (rmRes.status !== 0) {
        throw new Error(`Failed to uninstall uniwork-office:\n${rmRes.stderr}`)
      }
    }

    const installDirGone = !existsSync(installDir)
    const symlinkGone = !existsSync(symlinkBin)
    if (!installDirGone || !symlinkGone) {
      throw new Error(
        `Uninstall left files behind: installDirGone=${installDirGone} ("${installDir}"), symlinkGone=${symlinkGone} ("${symlinkBin}")`,
      )
    }
    uninstalledCleanly = true
    console.log(`[g7-05/t1:deb] Verified "${installDir}" and "${symlinkBin}" are removed.`)
  }

  const report = {
    test: 'T1_DEB',
    status: 'passed',
    metadata,
    artifact: {
      path: debPath,
      bytes: debSt.size,
      mib: Number((debSt.size / (1024 * 1024)).toFixed(2)),
      sha256: debSha,
    },
    installedDir: installDir,
    installedSizeBytes,
    installedSizeMib,
    uninstalledCleanly,
    keepInstalled,
    ...smokeResult,
  }

  mkdirSync(outputDir, { recursive: true })
  const outPath = join(outputDir, 't1-deb.json')
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('G7_05_T1_DEB_JSON_BEGIN')
  console.log(JSON.stringify(report, null, 2))
  console.log('G7_05_T1_DEB_JSON_END')
  return report
}

async function runAppImageSmoke({ artifactPath, outputDir, metadata }) {
  const artifacts = artifactPath ? null : findLinuxArtifacts()
  const appImagePath = artifactPath || artifacts?.appImage?.path
  if (!appImagePath || !existsSync(appImagePath)) {
    throw new Error(
      `Cannot find .AppImage artifact to test (looked at ${appImagePath || 'release dir'})`,
    )
  }

  chmodSync(appImagePath, 0o755)
  const st = statSync(appImagePath)
  const sha = sha256File(appImagePath)
  console.log(
    `[g7-05/t1:appimage] Running AppImage smoke (--appimage-extract-and-run) on ${appImagePath} (${st.size} bytes, sha256=${sha})...`,
  )

  const smokeResult = await runSixFixturesSmoke({
    binaryPath: appImagePath,
    isAppImage: true,
    label: 'appimage',
  })

  const report = {
    test: 'T1_APPIMAGE',
    status: 'passed',
    metadata,
    artifact: {
      path: appImagePath,
      bytes: st.size,
      mib: Number((st.size / (1024 * 1024)).toFixed(2)),
      sha256: sha,
    },
    launchMode: '--appimage-extract-and-run',
    ...smokeResult,
  }

  mkdirSync(outputDir, { recursive: true })
  const outPath = join(outputDir, 't1-appimage.json')
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('G7_05_T1_APPIMAGE_JSON_BEGIN')
  console.log(JSON.stringify(report, null, 2))
  console.log('G7_05_T1_APPIMAGE_JSON_END')
  return report
}

async function main() {
  const { target, artifactPath, keepInstalled, outputDir } = parseArgs(process.argv)
  const metadata = collectBuildMetadata(REPO_ROOT)

  if (target === 'deb' || target === 'all') {
    await runDebSmoke({
      artifactPath: target === 'deb' ? artifactPath : '',
      keepInstalled,
      outputDir,
      metadata,
    })
  }
  if (target === 'appimage' || target === 'all') {
    await runAppImageSmoke({
      artifactPath: target === 'appimage' ? artifactPath : '',
      outputDir,
      metadata,
    })
  }
}

main().catch((err) => {
  console.error('[g7-05/t1] FAILED:', err)
  process.exit(1)
})

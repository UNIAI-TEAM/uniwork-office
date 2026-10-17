#!/usr/bin/env node
// G7-05 W1 T6 Performance & Resource Measurements (report-only, no thresholds):
// For each of the 6 G7-06 fixtures (median of 3 runs):
//   - Launch-to-first-paint of document content (ms)
//   - Local Save end-to-end time (ms)
//   - Peak RSS of the whole app process tree (sampling /proc every 250 ms)
//   - Size on disk of the installed app and of the offline library / user-data dir after the run
// Outputs JSON + Markdown table with BENCH-01 comparison and build/version metadata.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { materializeFixtures } from './fixtures-data.mjs'
import {
  REPO_ROOT,
  closePackagedApp,
  collectBuildMetadata,
  createRssSampler,
  directorySizeBytes,
  editAndSaveFixture,
  findLinuxArtifacts,
  launchPackagedApp,
  median,
  waitForFixtureFirstPaint,
} from './lib.mjs'

// Baseline numbers from /home/ubuntu/office-g5g6g7/reports/g5-fork_main/BENCH-01.md
// (small synthetic tier on 16 vCPU / 62 GiB x86_64 Linux cloud VM at SHA 4f557941a).
const BENCH_01_SMALL_BASELINE = {
  docx: {
    benchFixture: 'docx-small.docx (37.3 KB, 1p)',
    harness: 'Playwright web (dist-web)',
    coldOpenMs: 67.1,
    warmOpenMs: 39.1,
    saveMs: 2.6,
    peakJsHeapMib: 14.55,
  },
  xlsx: {
    benchFixture: 'xlsx-small.xlsx (17.5 KB, 100x10)',
    harness: 'Playwright web (dist-web)',
    coldOpenMs: 49.9,
    warmOpenMs: 22.9,
    saveMs: 11.1,
    peakJsHeapMib: 7.89,
  },
  pptx: {
    benchFixture: 'pptx-small.pptx (32.7 KB, 5 slides)',
    harness: 'Electron desktop',
    coldOpenMs: 2115.6,
    warmOpenMs: 86.2,
    saveMs: 41.1,
    peakJsHeapMib: 15.72,
  },
  pdf: {
    benchFixture: 'pdf-small.pdf (2.7 KB, 5p)',
    harness: 'Playwright web (dist-web)',
    coldOpenMs: 107.6,
    warmOpenMs: 85.1,
    saveMs: 1.5,
    peakJsHeapMib: 9.77,
  },
  md: null,
  html: null,
}

function parseArgs(argv) {
  let runs = Number(process.env.G7_05_T6_RUNS) || 3
  let binaryPath = ''
  let isAppImage = false
  let outputDir = process.env.G7_05_OUT_DIR || join(REPO_ROOT, 'apps/shell/release/g7-05')

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--runs' && argv[i + 1]) {
      runs = Math.max(1, Number(argv[i + 1]) || 3)
      i += 1
    } else if (arg === '--binary' && argv[i + 1]) {
      binaryPath = resolve(argv[i + 1])
      isAppImage = binaryPath.endsWith('.AppImage')
      i += 1
    } else if (arg === '--output-dir' && argv[i + 1]) {
      outputDir = resolve(argv[i + 1])
      i += 1
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`)
    }
  }
  return { runs, binaryPath, isAppImage, outputDir }
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
  throw new Error('Could not find packaged Linux binary or AppImage for T6 perf measurement')
}

function collectInstalledDiskFootprint(outputDir) {
  const artifacts = findLinuxArtifacts()
  let debInstalledBytes = directorySizeBytes('/opt/UniWork Office')
  let debInstalledSource = '/opt/UniWork Office'

  if (debInstalledBytes === 0) {
    const t1DebJson = join(outputDir, 't1-deb.json')
    if (existsSync(t1DebJson)) {
      try {
        const parsed = JSON.parse(readFileSync(t1DebJson, 'utf8'))
        if (parsed.installedSizeBytes > 0) {
          debInstalledBytes = parsed.installedSizeBytes
          debInstalledSource = '/opt/UniWork Office (recorded during T1 deb install)'
        }
      } catch {
        // Fallback to linux-unpacked below.
      }
    }
  }

  const unpackedDir = join(REPO_ROOT, 'apps/shell/release/linux-unpacked')
  const unpackedBytes = directorySizeBytes(unpackedDir)
  if (debInstalledBytes === 0 && unpackedBytes > 0) {
    debInstalledBytes = unpackedBytes
    debInstalledSource = unpackedDir
  }

  return {
    installedAppBytes: debInstalledBytes,
    installedAppMib: Number((debInstalledBytes / (1024 * 1024)).toFixed(2)),
    installedAppSource: debInstalledSource,
    linuxUnpackedBytes: unpackedBytes,
    linuxUnpackedMib: Number((unpackedBytes / (1024 * 1024)).toFixed(2)),
    appImageArtifactBytes: artifacts.appImage?.bytes ?? 0,
    appImageArtifactMib: artifacts.appImage?.mib ?? 0,
    debArtifactBytes: artifacts.deb?.bytes ?? 0,
    debArtifactMib: artifacts.deb?.mib ?? 0,
  }
}

function formatMarkdownReport(report) {
  const { metadata, diskFootprint, results } = report
  const lines = [
    '# G7-05 W1 — T6 Linux Desktop Performance & Footprint Report',
    '',
    '## Build & Environment Metadata',
    '',
    `- **Fork SHA**: \`${metadata.forkSha}\``,
    `- **git describe --tags**: \`${metadata.gitDescribe}\``,
    `- **Latest release tag**: \`${metadata.latestReleaseTag}\``,
    `- **App version (` +
      '`apps/shell/package.json`' +
      `)**: \`${metadata.appVersion}\` (root \`package.json\`: \`${metadata.rootPackageVersion}\`)`,
    `- **Server version**: \`${metadata.serverVersion}\``,
    `- **Platform / Arch**: \`${metadata.platform} / ${metadata.arch}\` (Node \`${metadata.nodeVersion}\`)`,
    `- **Collected at**: \`${metadata.collectedAt}\``,
    '',
    '## Disk Footprint',
    '',
    '| Item | Source / Path | Bytes | MiB |',
    '| --- | --- | ---: | ---: |',
    `| Installed App Tree | \`${diskFootprint.installedAppSource}\` | ${diskFootprint.installedAppBytes.toLocaleString('en-US')} | ${diskFootprint.installedAppMib.toFixed(2)} |`,
    `| Packaged \`.AppImage\` | \`UniWork-Office-1.0.0-x86_64.AppImage\` | ${diskFootprint.appImageArtifactBytes.toLocaleString('en-US')} | ${diskFootprint.appImageArtifactMib.toFixed(2)} |`,
    `| Packaged \`.deb\` | \`UniWork-Office_1.0.0_amd64.deb\` | ${diskFootprint.debArtifactBytes.toLocaleString('en-US')} | ${diskFootprint.debArtifactMib.toFixed(2)} |`,
    `| User-Data Dir (after run, median per fixture) | \`$XDG_CONFIG_HOME/UniWork Office\` | ${diskFootprint.medianUserDataBytes.toLocaleString('en-US')} | ${diskFootprint.medianUserDataKib.toFixed(2)} KiB |`,
    `| Offline Library Dir (signed-out run) | \`$XDG_CONFIG_HOME/UniWork Office/uniwork-sync\` | ${diskFootprint.offlineLibraryBytes.toLocaleString('en-US')} | ${(diskFootprint.offlineLibraryBytes / 1024).toFixed(2)} KiB |`,
    '',
    '## Per-Fixture T6 Measurements (Median of 3 Runs) vs BENCH-01',
    '',
    '| Fixture | Format | Size (B) | Launch-to-First-Paint Median (ms) | Local Save Median (ms) | Peak Tree RSS Median (MiB) | UserData After Run (KiB) | BENCH-01 Cold Open (ms) | BENCH-01 Save (ms) | BENCH-01 Peak JS Heap (MiB) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]

  for (const r of results) {
    const b = r.bench01Comparison
    const bCold = b ? `${b.coldOpenMs} (${b.harness})` : 'N/A'
    const bSave = b ? `${b.saveMs}` : 'N/A'
    const bHeap = b ? `${b.peakJsHeapMib}` : 'N/A'
    lines.push(
      `| \`${r.name}\` | \`${r.ext}\` | ${r.bytes.toLocaleString('en-US')} | ${r.medianLaunchToFirstPaintMs.toFixed(2)} | ${r.medianSaveMs.toFixed(2)} | ${r.medianPeakRssMib.toFixed(2)} | ${r.medianUserDataKib.toFixed(2)} | ${bCold} | ${bSave} | ${bHeap} |`,
    )
  }

  lines.push(
    '',
    '> **Note on BENCH-01 comparison**: In `BENCH-01.md`, `.docx`, `.xlsx`, and `.pdf` were measured inside a running Playwright web browser against `dist-web` (measuring in-page bundle load + parse), while `.pptx` was measured in the Electron desktop app (`2115.6 ms` cold open, `41.1 ms` save). In G7-05 T6, all 6 G7-06 fixtures are measured end-to-end in the packaged Linux Electron desktop app from process spawn to document content first paint, and memory is whole-process-tree RSS (`/proc/<pid>/status` `VmRSS` across main, zygote, GPU, utility, shell, and editor renderer processes sampled every 250 ms) rather than single-renderer V8 `usedJSHeapSize`.',
    '',
  )

  return lines.join('\n')
}

async function main() {
  const opts = parseArgs(process.argv)
  const metadata = collectBuildMetadata(REPO_ROOT)
  const resolvedBin = opts.binaryPath
    ? { binaryPath: opts.binaryPath, isAppImage: opts.isAppImage }
    : resolveDefaultBinary()

  console.log(
    `[g7-05/t6] Starting T6 measurements (${opts.runs} runs per fixture) using ${resolvedBin.binaryPath}...`,
  )

  const results = []
  const allUserDataBytes = []
  let maxOfflineLibraryBytes = 0

  const baseFixtureDir = mkdtempSync(join(tmpdir(), 'g7-05-t6-base-'))
  const baseFixtures = materializeFixtures(baseFixtureDir)

  try {
    for (const baseFixture of baseFixtures) {
      const launchTimes = []
      const saveTimes = []
      const peakRssKbs = []
      const peakRssMibs = []
      const peakProcCounts = []
      const userDataSizes = []
      const runDetails = []

      for (let runIdx = 1; runIdx <= opts.runs; runIdx += 1) {
        const iterFixtureDir = mkdtempSync(
          join(tmpdir(), `g7-05-t6-${baseFixture.ext}-r${runIdx}-`),
        )
        const iterFixtures = materializeFixtures(iterFixtureDir)
        const fixture = iterFixtures.find((f) => f.name === baseFixture.name)

        const launched = await launchPackagedApp({
          binaryPath: resolvedBin.binaryPath,
          isAppImage: resolvedBin.isAppImage,
          args: [fixture.path],
          scratchPrefix: `g7-05-t6-ud-${baseFixture.ext}-r${runIdx}-`,
          seedOnboardingSeen: true,
        })

        const rootPid = launched.app.process()?.pid
        const rssSampler = createRssSampler(rootPid, 250)

        let launchToFirstPaintMs
        let saveMs
        let rssStats
        let userDataBytes
        let offlineLibBytes

        try {
          const editorPage = await waitForFixtureFirstPaint(launched.app, fixture)
          launchToFirstPaintMs = Number((performance.now() - launched.launchStartMs).toFixed(2))
          rssSampler.sampleNow()

          const saveOut = await editAndSaveFixture(launched.app, editorPage, fixture)
          saveMs = saveOut.saveMs
          rssSampler.sampleNow()
        } finally {
          rssStats = rssSampler.stop()
          await closePackagedApp(launched)
          userDataBytes = directorySizeBytes(launched.userDataDir)
          offlineLibBytes =
            directorySizeBytes(join(launched.userDataDir, 'uniwork-sync')) +
            directorySizeBytes(join(launched.userDataDir, 'offline-library'))
          if (offlineLibBytes > maxOfflineLibraryBytes) {
            maxOfflineLibraryBytes = offlineLibBytes
          }
          launched.cleanup()
          try {
            rmSync(iterFixtureDir, { recursive: true, force: true })
          } catch {
            // Ignore cleanup errors.
          }
        }

        launchTimes.push(launchToFirstPaintMs)
        saveTimes.push(saveMs)
        peakRssKbs.push(rssStats.peakRssKb)
        peakRssMibs.push(rssStats.peakRssMib)
        peakProcCounts.push(rssStats.peakProcessCount)
        userDataSizes.push(userDataBytes)
        allUserDataBytes.push(userDataBytes)

        runDetails.push({
          run: runIdx,
          launchToFirstPaintMs,
          saveMs,
          peakRssKb: rssStats.peakRssKb,
          peakRssMib: rssStats.peakRssMib,
          peakProcessCount: rssStats.peakProcessCount,
          rssSampleCount: rssStats.sampleCount,
          userDataBytes,
          offlineLibraryBytes: offlineLibBytes,
        })

        console.log(
          `[g7-05/t6] ${baseFixture.name} (run ${runIdx}/${opts.runs}): firstPaint=${launchToFirstPaintMs}ms, save=${saveMs}ms, peakRSS=${rssStats.peakRssMib}MiB (${rssStats.peakProcessCount} procs), userData=${(userDataBytes / 1024).toFixed(1)}KiB`,
        )
      }

      const medianUserDataBytes = Math.round(median(userDataSizes))
      results.push({
        id: baseFixture.id,
        name: baseFixture.name,
        ext: baseFixture.ext,
        bytes: baseFixture.bytes,
        sha256: baseFixture.sha256,
        runsCount: opts.runs,
        medianLaunchToFirstPaintMs: median(launchTimes),
        medianSaveMs: median(saveTimes),
        medianPeakRssKb: Math.round(median(peakRssKbs)),
        medianPeakRssMib: median(peakRssMibs),
        medianPeakProcessCount: Math.round(median(peakProcCounts)),
        medianUserDataBytes,
        medianUserDataKib: Number((medianUserDataBytes / 1024).toFixed(2)),
        runs: runDetails,
        bench01Comparison: BENCH_01_SMALL_BASELINE[baseFixture.ext] || null,
      })
    }
  } finally {
    try {
      rmSync(baseFixtureDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors.
    }
  }

  const baseFootprint = collectInstalledDiskFootprint(opts.outputDir)
  const medianUserDataBytes = Math.round(median(allUserDataBytes))
  const diskFootprint = {
    ...baseFootprint,
    medianUserDataBytes,
    medianUserDataKib: Number((medianUserDataBytes / 1024).toFixed(2)),
    offlineLibraryBytes: maxOfflineLibraryBytes,
  }

  const report = {
    test: 'T6_PERF',
    status: 'passed',
    metadata,
    binary: resolvedBin,
    rssSamplingIntervalMs: 250,
    runsPerFixture: opts.runs,
    diskFootprint,
    results,
  }

  mkdirSync(opts.outputDir, { recursive: true })
  const jsonPath = join(opts.outputDir, 't6-perf.json')
  const mdPath = join(opts.outputDir, 't6-perf.md')
  const markdown = formatMarkdownReport(report)

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(mdPath, markdown, 'utf8')

  console.log('\n' + markdown)
  console.log('G7_05_T6_PERF_JSON_BEGIN')
  console.log(JSON.stringify(report, null, 2))
  console.log('G7_05_T6_PERF_JSON_END')
}

main().catch((err) => {
  console.error('[g7-05/t6] FAILED:', err)
  process.exit(1)
})

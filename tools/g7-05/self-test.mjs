#!/usr/bin/env node
// Local lightweight self-test for tools/g7-05 (safe to run on bro: no Electron, no Playwright launch).
// Verifies G7-06 fixture materialization + SHA-256 integrity, strace parser, netlog parser, /proc RSS sampler, and metadata collection.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { N1_PATCHED_FILES, applyN1BuildTimePatch } from './apply-n1-patch.mjs'
import { G7_06_FIXTURES, materializeFixtures } from './fixtures-data.mjs'
import {
  REPO_ROOT,
  UPGRADE_MATRIX_IDS,
  classifyRequestUrl,
  collectBuildMetadata,
  createLaunchWrapper,
  diffTreeDigests,
  findInstancePids,
  inspectUpgradeMatrixStore,
  isOutboundNetworkUrl,
  median,
  parseNetLog,
  parseStraceConnectsToTarget,
  parseStraceLog,
  readUws1Header,
  runCmd,
  sampleProcessTreeRssKb,
  seedUpgradeMatrixStore,
  szv1Decode,
  szv1Encode,
  waitForEditorViewPage,
  waitForShellReady,
} from './lib.mjs'

function testFixtureMaterialization() {
  const dir = mkdtempSync(join(tmpdir(), 'g7-05-selftest-fx-'))
  try {
    const out = materializeFixtures(dir, { sourceDir: '' })
    assert.equal(out.length, 6, 'Should materialize all 6 G7-06 fixtures')
    for (let i = 0; i < G7_06_FIXTURES.length; i += 1) {
      assert.equal(out[i].name, G7_06_FIXTURES[i].name)
      assert.equal(out[i].bytes, G7_06_FIXTURES[i].bytes)
      assert.equal(out[i].sha256, G7_06_FIXTURES[i].sha256)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function testStraceParser() {
  const cleanTrace = [
    '1001 connect(12, {sa_family=AF_UNIX, sun_path="/tmp/.X11-unix/X99"}, 20) = 0',
    '1001 connect(14, {sa_family=AF_INET, sin_port=htons(38421), sin_addr=inet_addr("127.0.0.1")}, 16) = 0',
    '1002 connect(15, {sa_family=AF_INET6, sin6_port=htons(38421), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "::1", &sin6_addr), sin6_scope_id=0}, 28) = 0',
    '1003 connect(16, {sa_family=AF_INET, sin_port=htons(0), sin_addr=inet_addr("0.0.0.0")}, 16) = 0',
  ].join('\n')
  const cleanRes = parseStraceLog(cleanTrace)
  assert.equal(cleanRes.outboundCount, 0)
  assert.equal(cleanRes.dnsCount, 0)
  assert.equal(cleanRes.loopbackCount, 2)

  const dirtyTrace = [
    ...cleanTrace.split('\n'),
    '1004 connect(17, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = 0',
    '1005 sendto(18, "dns", 3, 0, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.1")}, 16) = 3',
    '1006 connect(19, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("93.184.216.34")}, 16) = -1 EINPROGRESS',
  ].join('\n')
  const dirtyRes = parseStraceLog(dirtyTrace)
  assert.equal(dirtyRes.dnsCount, 2, 'Port 53 to 127.0.0.53 and 127.0.0.1 must count as DNS')
  assert.equal(dirtyRes.outboundCount, 3, '2 DNS + 1 external IP must equal 3 outbound events')
}

function testNetLogParserAndUrlClassifier() {
  const internalSchemes = [
    'genoffice-docx-media://handoff/621db8c6-a171-4b5d-b256-538939540847',
    'genoffice-app://docs/assets/send-enter-off-B0IfWMyy.png',
    'genoffice-renderer://docs/index.html',
    'devtools://devtools/bundled/inspector.html',
    'chrome://gpu/',
    'chrome-extension://abcdef/index.html',
    'file:///opt/UniWork%20Office/resources/app.asar/out/renderer/index.html',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:null/123456',
    'about:blank',
    'html-preview://local/frame.html',
    'local-media://asset/1.png',
  ]
  for (const url of internalSchemes) {
    assert.equal(classifyRequestUrl(url), 'internal', `${url} must be classified as internal`)
    assert.equal(isOutboundNetworkUrl(url), false, `${url} must not be counted as outbound`)
  }

  const loopbackUrls = [
    'http://127.0.0.1:41234/json/version',
    'http://localhost:8080/health',
    'ws://[::1]:9229/devtools/page/1',
  ]
  for (const url of loopbackUrls) {
    assert.equal(classifyRequestUrl(url), 'loopback', `${url} must be classified as loopback`)
    assert.equal(isOutboundNetworkUrl(url), false, `${url} must not be counted as outbound`)
  }

  const realOutboundUrls = [
    'https://redirector.gvt1.com/edgedl/chrome/dict/en-us-10-1.bdic',
    'http://example.com/resource',
    'wss://realtime.uniwork.example/socket',
    'ftp://ftp.example.com/pub/file.txt',
  ]
  for (const url of realOutboundUrls) {
    assert.equal(classifyRequestUrl(url), 'outbound', `${url} must be classified as outbound`)
    assert.equal(isOutboundNetworkUrl(url), true, `${url} must be counted as outbound`)
  }

  const cleanNetLog = JSON.stringify({
    constants: {},
    events: [
      { type: 1, params: { url: 'devtools://devtools/bundled/inspector.html' } },
      { type: 2, params: { url: 'genoffice-renderer://docs/index.html' } },
      {
        type: 3,
        params: { url: 'genoffice-docx-media://handoff/621db8c6-a171-4b5d-b256-538939540847' },
      },
      { type: 4, params: { url: 'genoffice-app://docs/assets/send-enter-off-B0IfWMyy.png' } },
      { type: 5, params: { url: 'http://127.0.0.1:41234/json/version' } },
      { type: 6, params: { host: 'localhost' } },
    ],
  })
  const cleanRes = parseNetLog(cleanNetLog)
  assert.equal(cleanRes.parsedOk, true)
  assert.equal(cleanRes.outboundUrlCount, 0)
  assert.equal(cleanRes.outboundDnsCount, 0)
  assert.equal(cleanRes.loopbackUrlCount, 1)

  // Truncated netlog with an external request
  const dirtyTruncated =
    '{"constants":{},"events":[\n' +
    '{"type":1,"params":{"url":"https://api.github.com/repos/uniwork/office/releases"}},\n' +
    '{"type":2,"params":{"host":"api.github.com"}}\n'
  const dirtyRes = parseNetLog(dirtyTruncated)
  assert.equal(dirtyRes.parsedOk, true)
  assert.equal(dirtyRes.outboundUrlCount, 1)
  assert.equal(dirtyRes.outboundDnsCount, 1)
  assert.deepEqual(dirtyRes.outboundUrls, ['https://api.github.com/repos/uniwork/office/releases'])
}

function testRssAndMetadata() {
  const rss = sampleProcessTreeRssKb(process.pid)
  assert.ok(rss.rssKb > 0, 'Current process RSS must be > 0 kB on Linux')
  assert.ok(rss.processCount >= 1, 'Process tree count must be >= 1')

  const meta = collectBuildMetadata(REPO_ROOT)
  assert.equal(meta.appVersion, '1.0.0')
  assert.ok(meta.forkSha.length >= 40)
  assert.equal(median([30, 10, 20]), 20)
}

async function testWrapperAndProcessTracking() {
  const dir = mkdtempSync(join(tmpdir(), 'g7-05-selftest-wrap-'))
  try {
    const wDeb = createLaunchWrapper({
      scratchDir: dir,
      binaryPath: '/usr/bin/uniwork-office',
      isAppImage: false,
    })
    const debScript = readFileSync(wDeb, 'utf8')
    assert.ok(debScript.includes('--no-sandbox --disable-gpu "$@"'))

    const wAppImage = createLaunchWrapper({
      scratchDir: dir,
      binaryPath: '/tmp/UniWork.AppImage',
      isAppImage: true,
    })
    const appImageScript = readFileSync(wAppImage, 'utf8')
    assert.ok(appImageScript.includes('--appimage-extract-and-run --no-sandbox --disable-gpu "$@"'))

    const instanceId = `selftest-${Date.now()}`
    const child = spawn('node', ['-e', 'setTimeout(() => {}, 10000)'], {
      env: { ...process.env, G7_05_INSTANCE_ID: instanceId },
      stdio: 'ignore',
    })
    try {
      const pids = findInstancePids(child.pid, instanceId)
      assert.ok(pids.includes(child.pid), 'findInstancePids must locate child by PID/environ')
    } finally {
      child.kill('SIGKILL')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function testPackagedShellAndEditorViewResolution() {
  const packagedUrls = [
    'file:///opt/UniWork%20Office/resources/app.asar/out/renderer/index.html',
    'file:///tmp/appimage_extracted_e6ca4b0088ce781a7e5209fa98ecde9d/resources/app.asar/out/renderer/index.html',
  ]

  for (const shellUrl of packagedUrls) {
    const fakeShellPage = {
      url: () => shellUrl,
      evaluate: async () => 'complete',
      locator: (sel) => ({
        waitFor: async () => {
          assert.equal(sel, '.tab-bar')
        },
      }),
    }
    const fakeEditorPage = {
      url: () => 'genoffice-renderer://docs/index.html',
      evaluate: async () => 'complete',
    }
    const fakeApp = {
      windows: () => [fakeShellPage, fakeEditorPage],
      waitForEvent: async () => {},
      evaluate: async () => ({
        shellUrl,
        views: [
          {
            id: 2,
            url: 'genoffice-renderer://docs/index.html',
            bounds: { x: 0, y: 40, width: 1280, height: 760 },
            focused: true,
          },
        ],
        allWebContents: [
          { id: 1, url: shellUrl, destroyed: false },
          { id: 2, url: 'genoffice-renderer://docs/index.html', destroyed: false },
        ],
      }),
    }

    const resolvedShell = await waitForShellReady(fakeApp, 2_000)
    assert.equal(resolvedShell, fakeShellPage, `waitForShellReady must match ${shellUrl}`)

    const resolvedEditor = await waitForEditorViewPage(fakeApp, '://docs/', 2_000)
    assert.equal(
      resolvedEditor,
      fakeEditorPage,
      'waitForEditorViewPage must return the editor WebContentsView page',
    )
  }
}

function testUpgradeMatrixHelpersAndN1Patch() {
  const dir = mkdtempSync(join(tmpdir(), 'g7-05-selftest-matrix-'))
  try {
    // 1. SZV1 round-trip
    const plain = JSON.stringify({ hello: 'uniwork', level: 3 })
    const encoded = szv1Encode(plain)
    assert.ok(encoded.toString('utf8').startsWith('SZV1'))
    assert.equal(szv1Decode(encoded), plain)

    // 2. UWS1 header parser
    const headerBuf = Buffer.from(JSON.stringify({ schema: 1, min_store_level: 3 }), 'utf8')
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(headerBuf.byteLength, 0)
    const uws1Path = join(dir, 'sample.rec')
    writeFileSync(
      uws1Path,
      Buffer.concat([
        Buffer.from('UWS1', 'ascii'),
        lenBuf,
        headerBuf,
        Buffer.alloc(12 + 16 + 8, 0xaa),
      ]),
    )
    const uws1 = readUws1Header(uws1Path)
    assert.equal(uws1.magic, 'UWS1')
    assert.equal(uws1.header.schema, 1)
    assert.equal(uws1.header.min_store_level, 3)

    // 3. Seed & inspect upgrade matrix store + tree diff
    const fxDir = join(dir, 'fx')
    const fixtures = materializeFixtures(fxDir)
    const docx = fixtures.find((f) => f.id === 'fx-docx-report-vi')
    const userDataDir = join(dir, 'userData')
    const seeded = seedUpgradeMatrixStore({ userDataDir, fixtureSourcePath: docx.path })
    const snap1 = inspectUpgradeMatrixStore(userDataDir)
    assert.equal(snap1.binding.schema, 1)
    assert.equal(snap1.binding.documentId, UPGRADE_MATRIX_IDS.documentId)
    assert.equal(snap1.hasLegacyPendingUpload, true)
    assert.equal(snap1.docSha256, seeded.docSha256)
    const snap2 = inspectUpgradeMatrixStore(userDataDir)
    assert.equal(diffTreeDigests(snap1.combinedTree, snap2.combinedTree).identical, true)

    // 4. Target connect parser for apiOrigin 127.0.0.1:1
    const traceWithPort1 =
      '2001 connect(22, {sa_family=AF_INET, sin_port=htons(1), sin_addr=inet_addr("127.0.0.1")}, 16) = -1 ECONNREFUSED'
    assert.equal(parseStraceConnectsToTarget(traceWithPort1, '127.0.0.1', 1).count, 1)
    assert.equal(parseStraceConnectsToTarget(traceWithPort1, '127.0.0.1', 443).count, 0)

    // 5. applyN1BuildTimePatch against an isolated temp copy of the 6 target files
    const patchSource = readFileSync(join(REPO_ROOT, 'tools/g7-05/apply-n1-patch.mjs'), 'utf8')
    assert.equal(
      patchSource.includes('./lib.mjs') || patchSource.includes('playwright'),
      false,
      'apply-n1-patch.mjs must remain free of lib.mjs and playwright imports',
    )
    const fakeRepo = join(dir, 'fake-repo')
    for (const rel of N1_PATCHED_FILES) {
      const dest = join(fakeRepo, rel)
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(join(REPO_ROOT, rel), dest)
    }
    const patchRes = applyN1BuildTimePatch(fakeRepo, { version: '1.0.0-g705n1', storeLevel: 3 })
    assert.deepEqual(patchRes.patchedFiles, N1_PATCHED_FILES)
    assert.ok(
      readFileSync(
        join(fakeRepo, 'apps/shell/src/main/uniwork-sync/store-level.ts'),
        'utf8',
      ).includes('export const APP_STORE_LEVEL = 3'),
    )
    assert.equal(
      JSON.parse(readFileSync(join(fakeRepo, 'apps/shell/package.json'), 'utf8')).version,
      '1.0.0-g705n1',
    )

    // Verify CLI invocation directly from tools/g7-05/apply-n1-patch.mjs
    const fakeRepoCli = join(dir, 'fake-repo-cli')
    for (const rel of N1_PATCHED_FILES) {
      const dest = join(fakeRepoCli, rel)
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(join(REPO_ROOT, rel), dest)
    }
    const cliRes = runCmd(process.execPath, [
      join(REPO_ROOT, 'tools/g7-05/apply-n1-patch.mjs'),
      '--repo-root',
      fakeRepoCli,
      '--version',
      '1.0.0-g705n1',
      '--store-level',
      '3',
    ])
    assert.equal(cliRes.status, 0, `apply-n1-patch CLI failed: ${cliRes.stderr}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

testFixtureMaterialization()
testStraceParser()
testNetLogParserAndUrlClassifier()
testRssAndMetadata()
await testWrapperAndProcessTracking()
await testPackagedShellAndEditorViewResolution()
testUpgradeMatrixHelpersAndN1Patch()
console.log('[g7-05/self-test] All unit assertions passed.')

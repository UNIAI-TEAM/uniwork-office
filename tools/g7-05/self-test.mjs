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
  normalizeDebVersion,
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
  waitForUpgradeMatrixStoreLevel,
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

    // 2. UWS1 header parser in the real codec.ts format:
    //    4-byte 'UWS1' magic + 2-byte UInt16LE header length + UTF-8 JSON header + 12B IV + 16B tag + ciphertext
    const codecSrc = readFileSync(
      join(REPO_ROOT, 'apps/shell/src/main/uniwork-sync/store/codec.ts'),
      'utf8',
    )
    assert.ok(
      codecSrc.includes('const LENGTH_BYTES = 2') && codecSrc.includes('writeUInt16LE'),
      'codec.ts must use 2-byte UInt16LE header length',
    )
    for (const expectedLevel of [2, 3]) {
      const headerObj = { schema: 1, min_store_level: expectedLevel }
      const headerBuf = Buffer.from(JSON.stringify(headerObj), 'utf8')
      const lenBuf = Buffer.alloc(2)
      lenBuf.writeUInt16LE(headerBuf.byteLength, 0)
      const uws1Path = join(dir, `sample-level-${expectedLevel}.rec`)
      writeFileSync(
        uws1Path,
        Buffer.concat([
          Buffer.from('UWS1', 'latin1'),
          lenBuf,
          headerBuf,
          Buffer.alloc(12, 0x11), // 12-byte GCM IV
          Buffer.alloc(16, 0x22), // 16-byte GCM auth tag
          Buffer.alloc(64, 0xaa), // ciphertext payload
        ]),
      )
      const uws1 = readUws1Header(uws1Path)
      assert.equal(uws1.magic, 'UWS1')
      assert.equal(uws1.headerLength, headerBuf.byteLength)
      assert.equal(uws1.header.schema, 1)
      assert.equal(uws1.header.min_store_level, expectedLevel)
    }
    // Verify a 4-byte BE header length is rejected as corrupt/truncated (since bytes 4..5 are 0x0000 -> headerLength === 0)
    const bad4ByteLenBuf = Buffer.alloc(4)
    bad4ByteLenBuf.writeUInt32BE(34, 0)
    const badUws1Path = join(dir, 'bad-4byte-be.rec')
    writeFileSync(
      badUws1Path,
      Buffer.concat([
        Buffer.from('UWS1', 'latin1'),
        bad4ByteLenBuf,
        Buffer.from(JSON.stringify({ schema: 1, min_store_level: 2 }), 'utf8'),
        Buffer.alloc(12 + 16 + 8, 0xaa),
      ]),
    )
    assert.throws(() => readUws1Header(badUws1Path), /Truncated UWS1 header/)

    // 2b. Debian version normalizer (electron-builder converts '-' to '~' in .deb control Version)
    assert.equal(normalizeDebVersion('1.0.0-g705n1'), '1.0.0~g705n1')
    assert.equal(normalizeDebVersion('1.0.0-beta.3'), '1.0.0~beta.3')
    assert.equal(normalizeDebVersion('1.0.0'), '1.0.0')
    assert.equal(normalizeDebVersion('0.11.0'), '0.11.0')

    // 3. Seed & inspect upgrade matrix store + tree diff (including migrated intent record inspection)
    const fxDir = join(dir, 'fx')
    const fixtures = materializeFixtures(fxDir)
    const docx = fixtures.find((f) => f.id === 'fx-docx-report-vi')
    const userDataDir = join(dir, 'userData')
    const seeded = seedUpgradeMatrixStore({ userDataDir, fixtureSourcePath: docx.path })
    const snap1 = inspectUpgradeMatrixStore(userDataDir)
    assert.equal(snap1.binding.schema, 1)
    assert.equal(snap1.binding.documentId, UPGRADE_MATRIX_IDS.documentId)
    assert.equal(snap1.binding.pendingIntent?.intentId, UPGRADE_MATRIX_IDS.intentId)
    assert.equal(snap1.binding.pendingIntent?.idempotencyKey, UPGRADE_MATRIX_IDS.intentKey)
    assert.equal(snap1.binding.pendingIntent?.documentId, UPGRADE_MATRIX_IDS.documentId)
    assert.equal(snap1.binding.pendingIntent?.baseRevision, '1')
    assert.equal(snap1.binding.pendingIntent?.checksum, seeded.docSha256)
    assert.equal(snap1.hasLegacyPendingUpload, true)
    assert.equal(snap1.hasEncryptedIntentRecord, false)
    assert.equal(snap1.intentRecord, null)
    assert.equal(snap1.docSha256, seeded.docSha256)
    const snap2 = inspectUpgradeMatrixStore(userDataDir)
    assert.equal(diffTreeDigests(snap1.combinedTree, snap2.combinedTree).identical, true)

    // Write a simulated migrated UWS1 intent record at seeded.intentRecordPath and verify inspectUpgradeMatrixStore reads it
    mkdirSync(dirname(seeded.intentRecordPath), { recursive: true })
    const migratedHeaderBuf = Buffer.from(JSON.stringify({ schema: 1, min_store_level: 2 }), 'utf8')
    const migratedLenBuf = Buffer.alloc(2)
    migratedLenBuf.writeUInt16LE(migratedHeaderBuf.byteLength, 0)
    writeFileSync(
      seeded.intentRecordPath,
      Buffer.concat([
        Buffer.from('UWS1', 'latin1'),
        migratedLenBuf,
        migratedHeaderBuf,
        Buffer.alloc(12 + 16 + 11430, 0x55),
      ]),
    )
    const snapMigrated = inspectUpgradeMatrixStore(userDataDir)
    assert.equal(snapMigrated.hasEncryptedIntentRecord, true)
    assert.equal(snapMigrated.intentRecord?.header?.schema, 1)
    assert.equal(snapMigrated.intentRecord?.header?.min_store_level, 2)
    assert.equal(snapMigrated.intentRecord?.totalBytes, 11496)

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

async function testWaitForUpgradeMatrixStoreLevel() {
  const dir = mkdtempSync(join(tmpdir(), 'g7-05-selftest-wait-level-'))
  try {
    const fxDir = join(dir, 'fx')
    const fixtures = materializeFixtures(fxDir)
    const docx = fixtures.find((f) => f.id === 'fx-docx-report-vi')
    const userDataDir = join(dir, 'userData')
    const seeded = seedUpgradeMatrixStore({ userDataDir, fixtureSourcePath: docx.path })

    const writeUws1IntentFile = (targetPath, minStoreLevel, payloadByte = 0x55) => {
      mkdirSync(dirname(targetPath), { recursive: true })
      const headerBuf = Buffer.from(
        JSON.stringify({ schema: 1, min_store_level: minStoreLevel }),
        'utf8',
      )
      const lenBuf = Buffer.alloc(2)
      lenBuf.writeUInt16LE(headerBuf.byteLength, 0)
      writeFileSync(
        targetPath,
        Buffer.concat([
          Buffer.from('UWS1', 'latin1'),
          lenBuf,
          headerBuf,
          Buffer.alloc(12 + 16 + 128, payloadByte),
        ]),
      )
    }

    // Simulate Step 1 state on disk: schema-2 binding with min_store_level=2 and UWS1 intent with min_store_level=2.
    rmSync(seeded.legacyPendingUploadPath, { force: true })
    writeUws1IntentFile(seeded.intentRecordPath, 2, 0x22)
    writeFileSync(
      seeded.bindingPath,
      `${JSON.stringify(
        {
          schema: 2,
          min_store_level: 2,
          min_app_version: '1.0.0',
          documentId: UPGRADE_MATRIX_IDS.documentId,
          workspaceId: UPGRADE_MATRIX_IDS.workspaceId,
          orgId: UPGRADE_MATRIX_IDS.orgId,
          title: UPGRADE_MATRIX_IDS.title,
          filename: UPGRADE_MATRIX_IDS.filename,
          format: 'docx',
          access: 'edit',
          baseRevision: '1',
          baseVersion: 1,
          baseChecksum: '0'.repeat(64),
          state: 'queued',
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    // 1. Waiting for level 3 when store stays at level 2 must throw a clear timeout error with on-disk state.
    let timeoutErr = null
    try {
      await waitForUpgradeMatrixStoreLevel(userDataDir, 3, 120, { pollIntervalMs: 20 })
    } catch (err) {
      timeoutErr = err
    }
    assert.ok(timeoutErr instanceof Error, 'waitForUpgradeMatrixStoreLevel must throw on timeout')
    assert.match(timeoutErr.message, /min_store_level=3/)
    assert.match(timeoutErr.message, /On-disk state:/)
    assert.equal(timeoutErr.storeSnapshot?.binding?.min_store_level, 2)
    assert.equal(timeoutErr.storeSnapshot?.intentRecord?.header?.min_store_level, 2)

    // 2. Simulate an asynchronous N+1 editor edit+save that updates docPath bytes, intent .rec (level 3),
    //    and binding.json (level 3), and verify waitForUpgradeMatrixStoreLevel resolves with the level-3 store.
    setTimeout(() => {
      const editedBytes = Buffer.concat([
        readFileSync(seeded.docPath),
        Buffer.from(' UNIWORK_DOCX_SMOKE', 'utf8'),
      ])
      writeFileSync(seeded.docPath, editedBytes)
      writeUws1IntentFile(seeded.intentRecordPath, 3, 0x33)
      writeFileSync(
        seeded.bindingPath,
        `${JSON.stringify(
          {
            schema: 2,
            min_store_level: 3,
            min_app_version: '1.0.0',
            documentId: UPGRADE_MATRIX_IDS.documentId,
            workspaceId: UPGRADE_MATRIX_IDS.workspaceId,
            orgId: UPGRADE_MATRIX_IDS.orgId,
            title: UPGRADE_MATRIX_IDS.title,
            filename: UPGRADE_MATRIX_IDS.filename,
            format: 'docx',
            access: 'edit',
            baseRevision: '1',
            baseVersion: 1,
            baseChecksum: '0'.repeat(64),
            state: 'paused_offline',
            error: 'network',
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
    }, 50)

    const level3Snap = await waitForUpgradeMatrixStoreLevel(userDataDir, 3, 1_500, {
      notDocSha256: seeded.docSha256,
      pollIntervalMs: 20,
    })
    assert.equal(level3Snap.binding?.schema, 2)
    assert.equal(level3Snap.binding?.min_store_level, 3)
    assert.equal(level3Snap.intentRecord?.header?.min_store_level, 3)
    assert.notEqual(level3Snap.docSha256, seeded.docSha256)

    // 3. If notDocSha256 matches the current docSha256 (i.e. doc was not edited), it must time out and report the digest.
    await assert.rejects(
      () =>
        waitForUpgradeMatrixStoreLevel(userDataDir, 3, 100, {
          notDocSha256: level3Snap.docSha256,
          pollIntervalMs: 20,
        }),
      /Timed out after 100ms waiting for upgrade-matrix store/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function extractPreloadApiKeys(preloadSource, startMarker, endMarker) {
  const startIdx = preloadSource.indexOf(startMarker)
  const endIdx = preloadSource.indexOf(endMarker, startIdx)
  assert.ok(startIdx !== -1 && endIdx > startIdx, `Could not locate ${startMarker} .. ${endMarker}`)
  const block = preloadSource.slice(startIdx, endIdx)
  const keys = new Set()
  const keyRe = /^\s{2}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:)/gm
  let match
  while ((match = keyRe.exec(block)) !== null) {
    keys.add(match[1])
  }
  return keys
}

function findAiOfficeReferences(sourceText) {
  const aiOfficeRefs = new Set()
  const aiOfficeTabsRefs = new Set()
  const syncCenterRefs = new Set()
  const officeRe = /\baiOffice(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)/g
  const tabsRe = /\baiOfficeTabs(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)/g
  const syncCenterRe = /\buniworkSyncCenter(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)/g
  let m
  while ((m = officeRe.exec(sourceText)) !== null) {
    aiOfficeRefs.add(m[1])
  }
  while ((m = tabsRe.exec(sourceText)) !== null) {
    aiOfficeTabsRefs.add(m[1])
  }
  while ((m = syncCenterRe.exec(sourceText)) !== null) {
    syncCenterRefs.add(m[1])
  }
  return {
    aiOfficeRefs: [...aiOfficeRefs],
    aiOfficeTabsRefs: [...aiOfficeTabsRefs],
    syncCenterRefs: [...syncCenterRefs],
  }
}

function testPreloadApiReferencesAndUiSelectors() {
  const preloadPath = join(REPO_ROOT, 'apps/shell/src/preload/index.ts')
  const preloadSource = readFileSync(preloadPath, 'utf8')

  const homeApiKeys = extractPreloadApiKeys(
    preloadSource,
    'const homeApi: HomeApi = {',
    "contextBridge.exposeInMainWorld('aiOffice', homeApi)",
  )
  const tabsApiKeys = extractPreloadApiKeys(
    preloadSource,
    'const tabsApi: TabsApi = {',
    "contextBridge.exposeInMainWorld('aiOfficeTabs', tabsApi)",
  )
  const syncCenterApiKeys = extractPreloadApiKeys(
    preloadSource,
    'const syncCenterApi: UniworkSyncCenterApi = {',
    "contextBridge.exposeInMainWorld('uniworkSyncCenter', syncCenterApi)",
  )

  // Negative check: tabsList does NOT exist on window.aiOffice and must be rejected if referenced.
  assert.equal(
    homeApiKeys.has('tabsList'),
    false,
    'window.aiOffice.tabsList must not be present in homeApi',
  )
  const badRefs = findAiOfficeReferences('await globalThis.window.aiOffice.tabsList()')
  assert.deepEqual(badRefs.aiOfficeRefs, ['tabsList'])
  assert.equal(homeApiKeys.has(badRefs.aiOfficeRefs[0]), false)

  const targetScripts = [
    'tools/g7-05/t3-upgrade-rollback.mjs',
    'tools/g7-05/t4-pre-guard.mjs',
    'tools/g7-05/lib.mjs',
    'tools/g7-05/t1-smoke.mjs',
    'tools/g7-05/t2-net-zero.mjs',
    'tools/g7-05/t6-perf.mjs',
  ]

  for (const relPath of targetScripts) {
    const src = readFileSync(join(REPO_ROOT, relPath), 'utf8')
    const { aiOfficeRefs, aiOfficeTabsRefs, syncCenterRefs } = findAiOfficeReferences(src)
    if (relPath.includes('t3-upgrade-rollback') || relPath.includes('t4-pre-guard')) {
      assert.ok(
        aiOfficeRefs.length > 0,
        `${relPath} must reference at least one window.aiOffice.<name> preload method`,
      )
    }
    for (const refName of aiOfficeRefs) {
      assert.ok(
        homeApiKeys.has(refName),
        `${relPath} references window.aiOffice.${refName}, which does not exist in apps/shell/src/preload/index.ts`,
      )
    }
    for (const refName of aiOfficeTabsRefs) {
      assert.ok(
        tabsApiKeys.has(refName),
        `${relPath} references window.aiOfficeTabs.${refName}, which does not exist in apps/shell/src/preload/index.ts`,
      )
    }
    for (const refName of syncCenterRefs) {
      assert.ok(
        syncCenterApiKeys.has(refName),
        `${relPath} references window.uniworkSyncCenter.${refName}, which does not exist in apps/shell/src/preload/index.ts`,
      )
    }
  }

  // Verify S11 lock panel DOM selectors used in t3-upgrade-rollback.mjs exist in UniworkLockPanel.tsx.
  const lockPanelSource = readFileSync(
    join(REPO_ROOT, 'apps/shell/src/renderer/src/UniworkLockPanel.tsx'),
    'utf8',
  )
  for (const token of [
    'uw-lock-panel',
    'uw-lock-title',
    'uw-lock-body',
    'uw-lock-action',
    'uw-lock-alert',
  ]) {
    assert.ok(
      lockPanelSource.includes(token),
      `UniworkLockPanel.tsx must contain expected S11 selector token "${token}"`,
    )
  }
}

testFixtureMaterialization()
testStraceParser()
testNetLogParserAndUrlClassifier()
testRssAndMetadata()
await testWrapperAndProcessTracking()
await testPackagedShellAndEditorViewResolution()
testUpgradeMatrixHelpersAndN1Patch()
await testWaitForUpgradeMatrixStoreLevel()
testPreloadApiReferencesAndUiSelectors()
console.log('[g7-05/self-test] All unit assertions passed.')

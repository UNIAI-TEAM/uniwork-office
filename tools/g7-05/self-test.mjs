#!/usr/bin/env node
// Local lightweight self-test for tools/g7-05 (safe to run on bro: no Electron, no Playwright launch).
// Verifies G7-06 fixture materialization + SHA-256 integrity, strace parser, netlog parser, /proc RSS sampler, and metadata collection.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { G7_06_FIXTURES, materializeFixtures } from './fixtures-data.mjs'
import {
  REPO_ROOT,
  collectBuildMetadata,
  median,
  parseNetLog,
  parseStraceLog,
  sampleProcessTreeRssKb,
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

function testNetLogParser() {
  const cleanNetLog = JSON.stringify({
    constants: {},
    events: [
      { type: 1, params: { url: 'devtools://devtools/bundled/inspector.html' } },
      { type: 2, params: { url: 'genoffice-renderer://docs/index.html' } },
      { type: 3, params: { url: 'http://127.0.0.1:41234/json/version' } },
      { type: 4, params: { host: 'localhost' } },
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

testFixtureMaterialization()
testStraceParser()
testNetLogParser()
testRssAndMetadata()
console.log('[g7-05/self-test] All unit assertions passed.')

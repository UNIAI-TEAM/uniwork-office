/** The spawn wrappers every OCR helper runs through (src/ocr-vision.ts runOcrHelper /
 * runOcrHelperAsync), driven with fake helper scripts: the protocol happy path,
 * a timeout kill, an oversized stdout, a helper that exits before it reads its
 * stdin (EPIPE), garbage output, a missing binary. Sync and async must agree.
 * The fake helpers live in a directory with a Vietnamese, spaced name, like a
 * Windows profile path would. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OcrRecognition } from '../src/ocr'
import { runOcrHelper, runOcrHelperAsync, type HelperRunOptions } from '../src/ocr-vision'

let dir: string
beforeAll(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'ocr-run-')), 'tess Việt dữ liệu')
  mkdirSync(dir)
})
afterAll(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

/** write a fake helper and return the args that run it on this Node */
function fake(name: string, source: string): string[] {
  const file = join(dir, `${name}.cjs`)
  writeFileSync(file, source)
  return [file]
}

const OK_JSON =
  '{"paper":0.9,"lines":[{"t":"Xin chào","c":0.8,"b":[0.1,0.2,0.3,0.4],"chars":[{"t":"X","b":[0.1,0.2,0.15,0.4]}]}]}'
const BIG_PNG = new Uint8Array(8 * 1024 * 1024).fill(7)

type Runner = (
  args: string[],
  png?: Uint8Array,
  options?: HelperRunOptions,
  command?: string,
) => Promise<OcrRecognition | null>

const runners: [string, Runner][] = [
  [
    'runOcrHelper (sync)',
    (args, png = new Uint8Array([1, 2, 3]), options, command = process.execPath) =>
      Promise.resolve(runOcrHelper(command, args, png, options)),
  ],
  [
    'runOcrHelperAsync',
    (args, png = new Uint8Array([1, 2, 3]), options, command = process.execPath) =>
      runOcrHelperAsync(command, args, png, options),
  ],
]

describe.each(runners)('%s', (_name, run) => {
  it('parses a protocol answer from a helper in a non-ASCII, spaced directory', async () => {
    const got = await run(fake('ok', `process.stdout.write(${JSON.stringify(OK_JSON)})`))
    expect(got).toEqual({
      lines: [
        {
          text: 'Xin chào',
          confidence: 0.8,
          box: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 },
          chars: [{ text: 'X', box: { x0: 0.1, y0: 0.2, x1: 0.15, y1: 0.4 } }],
        },
      ],
      paperShare: 0.9,
    })
  })

  it('feeds the page PNG to stdin, whole', async () => {
    const got = await run(
      fake(
        'echo-size',
        "const c = []\nprocess.stdin.on('data', (d) => c.push(d))\n" +
          "process.stdin.on('end', () => process.stdout.write(JSON.stringify({ lines: [{ t: String(Buffer.concat(c).length), c: 1, b: [0, 0, 1, 1] }] })))\n",
      ),
      BIG_PNG,
    )
    expect(got?.lines[0]?.text).toBe(String(BIG_PNG.length))
  })

  it('strips a UTF-8 BOM from the helper output', async () => {
    const got = await run(
      fake('bom', `process.stdout.write('\\uFEFF' + ${JSON.stringify(OK_JSON)})`),
    )
    expect(got?.lines[0]?.text).toBe('Xin chào')
  })

  it('kills a helper that outlives the timeout and answers null', async () => {
    const pidFile = join(dir, 'hang.pid')
    rmSync(pidFile, { force: true })
    const args = fake(
      'hang',
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))\n` +
        'setInterval(() => {}, 1000)\n',
    )
    const started = Date.now()
    expect(await run(args, undefined, { timeoutMs: 1500 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(15_000)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(pid).toBeGreaterThan(0)
    // the helper process is gone (poll: the kill signal is delivered asynchronously)
    let alive = true
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(pid, 0)
        await new Promise((r) => setTimeout(r, 100))
      } catch {
        alive = false
      }
    }
    expect(alive).toBe(false)
  })

  it('answers null for stdout above the cap (and does not keep the process)', async () => {
    const args = fake(
      'flood',
      "const chunk = 'x'.repeat(256 * 1024)\n" +
        'for (let i = 0; i < 40; i++) process.stdout.write(chunk)\n' +
        'setInterval(() => {}, 1000)\n',
    )
    const started = Date.now()
    expect(
      await run(args, undefined, { maxBufferBytes: 1024 * 1024, timeoutMs: 20_000 }),
    ).toBeNull()
    expect(Date.now() - started).toBeLessThan(15_000)
  })

  it('answers null (no throw, no unhandled EPIPE) when the helper exits before reading stdin', async () => {
    expect(await run(fake('early-exit', 'process.exit(1)'), BIG_PNG)).toBeNull()
    // exit 0 without an answer is no answer either
    expect(await run(fake('early-ok', 'process.exit(0)'), BIG_PNG)).toBeNull()
  })

  it('answers null for a non-zero exit even after a valid answer', async () => {
    const args = fake(
      'fail-late',
      `process.stdout.write(${JSON.stringify(OK_JSON)}); process.exitCode = 3`,
    )
    expect(await run(args)).toBeNull()
  })

  it('answers null for output that is not the protocol', async () => {
    expect(await run(fake('garbage', "process.stdout.write('not json')"))).toBeNull()
    expect(await run(fake('no-lines', 'process.stdout.write(\'{"paper":1}\')'))).toBeNull()
    expect(await run(fake('null-json', "process.stdout.write('null')"))).toBeNull()
  })

  it('answers null when the binary does not exist', async () => {
    const missing = join(dir, 'no-such-binary.exe')
    expect(existsSync(missing)).toBe(false)
    expect(await run([], undefined, undefined, missing)).toBeNull()
  })

  it('passes env, drops dropEnv case-insensitively, and runs in cwd', async () => {
    const args = fake(
      'env',
      'const e = process.env\n' +
        "const t = [process.cwd(), String(e.OCR_RUN_KEEP), String(e.OCR_RUN_DROP), String(e.OCR_RUN_EXTRA)].join('|')\n" +
        'process.stdout.write(JSON.stringify({ lines: [{ t, c: 1, b: [0, 0, 1, 1] }] }))\n',
    )
    process.env.OCR_RUN_KEEP = 'kept'
    process.env.OCR_RUN_DROP = 'dropped'
    try {
      const got = await run(args, undefined, {
        env: { OCR_RUN_EXTRA: 'extra' },
        dropEnv: ['ocr_run_drop'],
        cwd: dir,
      })
      const [cwd, keep, drop, extra] = got!.lines[0]!.text.split('|')
      expect(cwd!.toLowerCase().replace(/\\/g, '/')).toContain('tess việt dữ liệu')
      expect([keep, drop, extra]).toEqual(['kept', 'undefined', 'extra'])
    } finally {
      delete process.env.OCR_RUN_KEEP
      delete process.env.OCR_RUN_DROP
    }
  })
})

describe('runOcrHelperAsync keeps the event loop turning', () => {
  it('fires timers while a helper is still working', async () => {
    const args = fake('slow', "setTimeout(() => process.stdout.write('" + OK_JSON + "'), 1200)")
    let ticks = 0
    const timer = setInterval(() => ticks++, 25)
    const started = Date.now()
    try {
      expect(await runOcrHelperAsync(process.execPath, args, new Uint8Array([1]))).not.toBeNull()
    } finally {
      clearInterval(timer)
    }
    expect(Date.now() - started).toBeGreaterThan(1000)
    expect(ticks).toBeGreaterThan(20)
  })

  it('the sync twin blocks it (the contrast that makes the test above mean something)', async () => {
    const args = fake('slow-sync', "setTimeout(() => process.stdout.write('" + OK_JSON + "'), 600)")
    let ticks = 0
    const timer = setInterval(() => ticks++, 25)
    try {
      expect(runOcrHelper(process.execPath, args, new Uint8Array([1]))).not.toBeNull()
    } finally {
      clearInterval(timer)
    }
    expect(ticks).toBe(0)
  })
})

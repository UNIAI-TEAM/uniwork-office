// node --test scripts/genoffice-tools-extract.test.mjs
//
// The extractor reads its inputs through git at a revision, so the fixtures are
// real (tiny) git repositories built in a temp dir: one commit, a handful of TS
// files that mirror the shapes the product sources use (literal schemas, schemas
// built from shared consts and spreads, a capability-keyed getter list, a
// duplicate tool name, a schema the evaluator must refuse to guess).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'

import { extract } from './genoffice-tools-extract.mjs'

const SCRIPT = fileURLToPath(new URL('./genoffice-tools-extract.mjs', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** write a file tree into a fresh git repo with one commit; returns { dir, sha } */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-tools-extract-'))
  roots.push(dir)
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  const git = (...args) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  git('init', '--quiet')
  git('add', '-A')
  git(
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=test',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  )
  return { dir, sha: git('rev-parse', 'HEAD').trim() }
}

/** independent canonical-JSON + sha256 (does not import the extractor's helpers) */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
}

function sha256(text) {
  // small, dependency-free implementation kept independent of the extractor
  return execFileSync(
    process.execPath,
    [
      '-e',
      'const c=require("node:crypto");let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>process.stdout.write(c.createHash("sha256").update(s,"utf8").digest("hex")))',
    ],
    { input: text, encoding: 'utf8' },
  )
}

function hashOf(schema) {
  return sha256(canonical(schema))
}

// ────────────────────────────── fixture ──────────────────────────────

const SHARED_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
}

const SPREAD_PARTS = {
  properties: { a: { type: 'integer' } },
  required: ['a'],
}

const ORDER_A = {
  type: 'object',
  properties: { alpha: { type: 'string' }, beta: { type: 'integer' } },
}

const ORDER_B = {
  properties: { beta: { type: 'integer' }, alpha: { type: 'string' } },
  type: 'object',
}

const LITERAL_SCHEMA = {
  type: 'object',
  properties: { zeta: { type: 'string' }, alpha: { type: 'integer' } },
  required: ['alpha'],
}

const FIXTURE = {
  'packages/agent-core/src/types.ts': [
    'export interface AgentToolDef {',
    '  name: string',
    '  description: string',
    '  inputSchema: Record<string, unknown>',
    '}',
    '',
  ].join('\n'),

  'apps/docs/src/renderer/ai/shared.ts': [
    "import type { AgentToolDef } from '@genoffice/agent-core'",
    '',
    'export const SHARED_SCHEMA = {',
    "  type: 'object',",
    '  properties: { query: { type: "string" } },',
    "  required: ['query'],",
    '}',
    '',
    'export const SPREAD_PARTS = {',
    '  properties: { a: { type: "integer" } },',
    "  required: ['a'],",
    '}',
    '',
    'export const SHARED_TOOL: AgentToolDef = {',
    "  name: 'shared_tool',",
    "  description: 'schema comes from a shared const in another file',",
    '  inputSchema: SHARED_SCHEMA,',
    '}',
    '',
    'export const SPREAD_TOOL: AgentToolDef = {',
    "  name: 'spread_tool',",
    "  description: 'schema assembled with a spread',",
    "  inputSchema: { type: 'object', ...SPREAD_PARTS },",
    '}',
    '',
  ].join('\n'),

  'apps/docs/src/renderer/ai/tools.ts': [
    "import type { AgentSkill, AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
    "import { SHARED_TOOL, SPREAD_TOOL } from './shared'",
    '',
    'export const AGENT_TOOLS: AgentToolDef[] = [',
    '  {',
    "    name: 'literal_tool',",
    "    description: 'literal schema',",
    '    inputSchema: {',
    "      type: 'object',",
    '      properties: { zeta: { type: "string" }, alpha: { type: "integer" } },',
    "      required: ['alpha'],",
    '    },',
    '  },',
    '  SHARED_TOOL,',
    '  SPREAD_TOOL,',
    '  {',
    "    name: 'duplicate',",
    "    description: 'first declaration of a duplicated name',",
    "    inputSchema: { type: 'object', properties: { one: { type: 'string' } } },",
    '  },',
    '  {',
    "    name: 'duplicate',",
    "    description: 'second declaration of a duplicated name',",
    "    inputSchema: { type: 'object', properties: { two: { type: 'string' } } },",
    '  },',
    '  {',
    "    name: 'order_a',",
    "    description: 'keys in one order',",
    '    inputSchema: {',
    "      type: 'object',",
    '      properties: { alpha: { type: "string" }, beta: { type: "integer" } },',
    '    },',
    '  },',
    '  {',
    "    name: 'order_b',",
    "    description: 'same schema, keys in another order',",
    '    inputSchema: {',
    '      properties: { beta: { type: "integer" }, alpha: { type: "string" } },',
    "      type: 'object',",
    '    },',
    '  },',
    '  {',
    "    name: 'unresolvable',",
    "    description: 'schema produced by a call the evaluator refuses to fold',",
    "    inputSchema: buildSchema('unresolvable'),",
    '  },',
    '  {',
    "    name: 'call_tool',",
    "    description: 'schema produced by an unsupported method call',",
    '    inputSchema: [1, 2].flat().slice(0, 1),',
    '  },',
    ']',
    '',
    '/** tools a view-only document keeps */',
    "export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['shared_tool'])",
    '',
    'export function createDocsSkill(available: () => boolean): AgentSkill {',
    '  return {',
    "    id: 'docs',",
    '    // live like tools: the capability is re-read before every request',
    '    get tools() {',
    '      return available()',
    '        ? [',
    '            ...AGENT_TOOLS,',
    '            {',
    "              name: 'gated_tool',",
    "              description: 'only offered while the capability is on',",
    "              inputSchema: { type: 'object', properties: {} },",
    '            },',
    '          ]',
    '        : AGENT_TOOLS',
    '    },',
    '  }',
    '}',
    '',
    'export function executeTool(call: AgentToolCall): ToolExecution {',
    '  switch (call.name) {',
    "    case 'literal_tool':",
    "      return { output: 'ok', mutated: true, summary: 'literal' }",
    "    case 'duplicate':",
    "      return { output: 'ok', mutated: false, summary: 'duplicate' }",
    "    case 'gated_tool':",
    "      return { output: 'ok', mutated: changes > 0, summary: 'gated' }",
    '    default:',
    "      return { output: 'unknown', isError: true, summary: call.name }",
    '  }',
    '}',
    '',
  ].join('\n'),

  'apps/sheets/src/renderer/ai/tools.ts': [
    "import type { AgentToolDef } from '@genoffice/agent-core'",
    '',
    'export const WORKBOOK_TOOLS: AgentToolDef[] = [',
    '  {',
    "    name: 'sheet_tool',",
    "    description: 'one tool in a second module',",
    "    inputSchema: { type: 'object', properties: { range: { type: 'string' } } },",
    '  },',
    ']',
    '',
  ].join('\n'),
}

const ROWS = [
  ['docs', 'call_tool', 'unresolved:call:flat', 'undeclared', 'apps/docs/src/renderer/ai/tools.ts'],
  [
    'docs',
    'duplicate',
    hashOf({ type: 'object', properties: { one: { type: 'string' } } }),
    'no',
    'apps/docs/src/renderer/ai/tools.ts',
  ],
  [
    'docs',
    'duplicate',
    hashOf({ type: 'object', properties: { two: { type: 'string' } } }),
    'no',
    'apps/docs/src/renderer/ai/tools.ts',
  ],
  [
    'docs',
    'gated_tool',
    hashOf({ type: 'object', properties: {} }),
    'yes',
    'apps/docs/src/renderer/ai/tools.ts',
  ],
  ['docs', 'literal_tool', hashOf(LITERAL_SCHEMA), 'yes', 'apps/docs/src/renderer/ai/tools.ts'],
  ['docs', 'order_a', hashOf(ORDER_A), 'undeclared', 'apps/docs/src/renderer/ai/tools.ts'],
  ['docs', 'order_b', hashOf(ORDER_B), 'undeclared', 'apps/docs/src/renderer/ai/tools.ts'],
  ['docs', 'shared_tool', hashOf(SHARED_SCHEMA), 'no', 'apps/docs/src/renderer/ai/shared.ts'],
  [
    'docs',
    'spread_tool',
    hashOf({ type: 'object', ...SPREAD_PARTS }),
    'undeclared',
    'apps/docs/src/renderer/ai/shared.ts',
  ],
  [
    'docs',
    'unresolvable',
    'unresolved:identifier:buildSchema',
    'undeclared',
    'apps/docs/src/renderer/ai/tools.ts',
  ],
  [
    'sheets',
    'sheet_tool',
    hashOf({ type: 'object', properties: { range: { type: 'string' } } }),
    'undeclared',
    'apps/sheets/src/renderer/ai/tools.ts',
  ],
]

function expectedText(sha, rows) {
  const lines = [
    `<!-- genoffice-tools-extract v1 rev=${sha} -->`,
    '| module | tool | input_schema_sha256 | editor_write | source |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ]
  return `${lines.join('\n')}\n`
}

// ────────────────────────────── tests ──────────────────────────────

describe('extract', () => {
  it('prints the exact table for the fixture', () => {
    const { dir, sha } = fixture(FIXTURE)
    const result = extract({ repo: dir, rev: 'HEAD' })
    assert.equal(result.sha, sha)
    assert.equal(result.text, expectedText(sha, ROWS))
  })

  it('resolves spread and shared-const schemas, and refuses to guess the rest', () => {
    const { dir } = fixture(FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const byName = (name, source) =>
      rows.filter((r) => r.tool === name && (!source || r.source === source))
    assert.equal(byName('spread_tool').length, 1)
    assert.equal(byName('shared_tool').length, 1)
    assert.equal(byName('unresolvable')[0].hash, 'unresolved:identifier:buildSchema')
    assert.equal(byName('call_tool')[0].hash, 'unresolved:call:flat')
  })

  it('finds tools reachable only through a capability-keyed getter', () => {
    const { dir } = fixture(FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    assert.ok(rows.some((r) => r.tool === 'gated_tool'))
  })

  it('keeps both rows of a duplicate (module, tool) pair', () => {
    const { dir } = fixture(FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const dup = rows.filter((r) => r.tool === 'duplicate')
    assert.equal(dup.length, 2)
    assert.notEqual(dup[0].hash, dup[1].hash)
  })

  it('hashes are independent of key order, at every nesting level', () => {
    const { dir } = fixture(FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const a = rows.find((r) => r.tool === 'order_a')
    const b = rows.find((r) => r.tool === 'order_b')
    assert.equal(a.hash, b.hash)
    // an independent canonicalizer agrees with the script's hash
    assert.equal(
      a.hash,
      hashOf({
        properties: { alpha: { type: 'string' }, beta: { type: 'integer' } },
        type: 'object',
      }),
    )
  })

  it('derives editor_write from declarations only', () => {
    const { dir } = fixture(FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    assert.equal(write('literal_tool'), 'yes') // mutated: true in its case
    assert.equal(write('gated_tool'), 'yes') // mutated: <expression> in its case
    assert.equal(write('duplicate'), 'no') // mutated: false in its case
    assert.equal(write('shared_tool'), 'no') // named by READ_ONLY_TOOLS
    assert.equal(write('spread_tool'), 'undeclared') // no declaration at all
  })

  it('is byte-identical across two runs', () => {
    const { dir } = fixture(FIXTURE)
    const first = extract({ repo: dir, rev: 'HEAD' }).text
    const second = extract({ repo: dir, rev: 'HEAD' }).text
    assert.equal(first, second)
  })

  it('sorts by module, then tool, then source', () => {
    const { dir } = fixture(FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const keys = rows.map((r) => `${r.module}\u0000${r.tool}\u0000${r.source}`)
    const sorted = [...keys].sort()
    assert.deepEqual(keys, sorted)
    assert.ok(keys.some((k) => k.startsWith('agent-core') === false))
    assert.ok(rows.some((r) => r.module === 'sheets'))
  })
})

describe('CLI', () => {
  const run = (args, cwd) => {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { status: 0, stdout }
    } catch (error) {
      return { status: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    }
  }

  it('exits 0 and prints the same table as the API', () => {
    const { dir } = fixture(FIXTURE)
    const cli = run([], dir)
    assert.equal(cli.status, 0)
    assert.equal(cli.stdout, extract({ repo: dir, rev: 'HEAD' }).text)
  })

  it('is byte-identical across two CLI runs', () => {
    const { dir } = fixture(FIXTURE)
    assert.equal(run([], dir).stdout, run([], dir).stdout)
  })

  it('reads an explicit --rev and --repo', () => {
    const { dir, sha } = fixture(FIXTURE)
    const cli = run(['--rev', sha, '--repo', dir], REPO_ROOT)
    assert.equal(cli.status, 0)
    assert.ok(cli.stdout.includes(`rev=${sha}`))
  })

  it('exits non-zero with a message on a bad rev', () => {
    const { dir } = fixture(FIXTURE)
    const cli = run(['--rev', 'deadbeef'], dir)
    assert.notEqual(cli.status, 0)
    assert.match(cli.stderr, /cannot read rev/)
  })
})

describe('real repo', () => {
  it('produces rows for each of the six apps at HEAD', () => {
    const { rows } = extract({ repo: REPO_ROOT, rev: 'HEAD' })
    const counts = new Map()
    for (const row of rows) counts.set(row.module, (counts.get(row.module) ?? 0) + 1)
    for (const app of ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']) {
      assert.ok((counts.get(app) ?? 0) > 0, `expected rows for ${app}`)
    }
  })

  it('is deterministic and keeps every hash well formed at HEAD', () => {
    const first = extract({ repo: REPO_ROOT, rev: 'HEAD' })
    const second = extract({ repo: REPO_ROOT, rev: 'HEAD' })
    assert.equal(first.text, second.text)
    for (const row of first.rows) {
      assert.ok(
        /^[0-9a-f]{64}$/.test(row.hash) || /^unresolved:[a-z]+/.test(row.hash),
        `bad hash for ${row.module}/${row.tool}: ${row.hash}`,
      )
      assert.ok(['yes', 'no', 'undeclared'].includes(row.write))
      assert.ok(!row.source.startsWith('/'))
    }
  })
})

// node --test scripts/genoffice-tools-extract.test.mjs
//
// The extractor reads its inputs through git at a revision, so the fixtures are
// real (tiny) git repositories built in a temp dir: one commit, a handful of TS
// files that mirror the shapes the product sources use (literal schemas, schemas
// built from shared consts and spreads, a capability-keyed getter list, a
// duplicate tool name, a schema the evaluator must refuse to guess).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'

import { extract } from './genoffice-tools-extract.mjs'
import * as extractor from './genoffice-tools-extract.mjs'

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

describe('editor_write routing', () => {
  // R1-1: a `call.name === 'x'` guard in a shared executor names its tool, but
  // only the branch that tool takes may contribute a flag. The read-only tool's
  // guard delegates to a helper that declares `mutated: false`, while a sibling
  // case in another helper declares `mutated: true`; the guard must not pick the
  // sibling's flag up.
  const GUARD_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentSkill, AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      '  {',
      "    name: 'read_only_tool',",
      "    description: 'guarded read-only tool',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      '  {',
      "    name: 'mutating_sibling',",
      "    description: 'mutating sibling in the same executor',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      ']',
      '',
      'export function createDocsSkill(): AgentSkill {',
      '  return {',
      "    id: 'docs',",
      '    tools: AGENT_TOOLS,',
      '    executeTool(call: AgentToolCall): ToolExecution | Promise<ToolExecution> {',
      "      if (call.name === 'read_only_tool') return executeAsyncTool(call)",
      '      return executeSyncTool(call)',
      '    },',
      '  }',
      '}',
      '',
      'async function executeAsyncTool(call: AgentToolCall): Promise<ToolExecution> {',
      "  return { output: 'searched', mutated: false, summary: 'search' }",
      '}',
      '',
      'function executeSyncTool(call: AgentToolCall): ToolExecution {',
      '  switch (call.name) {',
      "    case 'mutating_sibling':",
      "      return { output: 'wrote', mutated: true, summary: 'write' }",
      '    default:',
      "      return { output: 'unknown', isError: true, mutated: false, summary: call.name }",
      '  }',
      '}',
      '',
    ].join('\n'),
  }

  // R1-2: two same-named local closures in different case bodies. Keying helpers
  // by bare name collapses them and leaks the second one's `mutated: true`.
  const DUP_HELPER_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      '  {',
      "    name: 'read_tool',",
      "    description: 'read-only tool with its own finish',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      '  {',
      "    name: 'write_tool',",
      "    description: 'mutating tool with its own finish',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      ']',
      '',
      'export function executeTool(call: AgentToolCall): ToolExecution {',
      '  switch (call.name) {',
      "    case 'read_tool': {",
      '      const finish = (): ToolExecution => {',
      '        return {',
      "          output: 'read',",
      '          mutated: false,',
      "          summary: 'read',",
      '        }',
      '      }',
      '      return finish()',
      '    }',
      "    case 'write_tool': {",
      '      const finish = (): ToolExecution => {',
      '        return {',
      "          output: 'wrote',",
      '          mutated: true,',
      "          summary: 'write',",
      '        }',
      '      }',
      '      return finish()',
      '    }',
      '    default:',
      "      return { output: 'unknown', isError: true, mutated: false, summary: call.name }",
      '  }',
      '}',
      '',
    ].join('\n'),
  }

  // R1-3: a tool-shaped object with no `inputSchema` is reported, not dropped.
  const NO_SCHEMA_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolDef } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      '  {',
      "    name: 'normal_tool',",
      "    description: 'has a schema',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      '  {',
      "    name: 'no_schema_tool',",
      "    description: 'no schema property at all',",
      '  },',
      ']',
      '',
    ].join('\n'),
  }

  it('credits only the guard branch the named tool takes (R1-1)', () => {
    const { dir } = fixture(GUARD_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    assert.equal(write('read_only_tool'), 'no') // its own branch declares mutated: false
    assert.equal(write('mutating_sibling'), 'yes') // its own case declares mutated: true
  })

  it('keeps same-named local helpers distinct by position (R1-2)', () => {
    const { dir } = fixture(DUP_HELPER_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    assert.equal(write('read_tool'), 'no') // its own `finish` declares mutated: false
    assert.equal(write('write_tool'), 'yes') // its own `finish` declares mutated: true
  })

  it('reports a tool object without inputSchema as unresolved:missing (R1-3)', () => {
    const { dir } = fixture(NO_SCHEMA_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const noSchema = rows.find((r) => r.tool === 'no_schema_tool')
    assert.ok(noSchema, 'the schema-less tool must still get a row')
    assert.equal(noSchema.hash, 'unresolved:missing')
    assert.ok(rows.some((r) => r.tool === 'normal_tool'))
  })

  // R2-1 (negative): the `name` anchor must fire only inside a tools-list array.
  // A non-tool `{ name, description }` array — an option list, a typed command
  // list, a nested `options:` bag — must produce no row, while the real
  // (annotated) tools list next to it still yields its rows.
  const NON_TOOL_ARRAY_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolDef } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      '  {',
      "    name: 'real_tool',",
      "    description: 'a real tool in the annotated list',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      '  {',
      "    name: 'real_schemaless',",
      "    description: 'a real tool with no schema, still in the list',",
      '  },',
      ']',
      '',
      '// an unannotated menu of { name, description } rows is not a tools list',
      'const MENU_ITEMS = [',
      "  { name: 'menu_open', description: 'Open' },",
      "  { name: 'menu_save', description: 'Save' },",
      ']',
      '',
      'type Command = { name: string; description: string }',
      'const COMMANDS: Command[] = [',
      "  { name: 'cmd_export', description: 'Export' },",
      "  { name: 'cmd_print', description: 'Print' },",
      ']',
      '',
      'const CONFIG = {',
      '  options: [',
      "    { name: 'opt_a', description: 'A' },",
      "    { name: 'opt_b', description: 'B' },",
      '  ],',
      '}',
      '',
      'export function menu(): void {',
      '  void MENU_ITEMS',
      '  void COMMANDS',
      '  void CONFIG',
      '}',
      '',
    ].join('\n'),
  }

  it('ignores non-tool {name, description} arrays (R2-1)', () => {
    const { dir } = fixture(NON_TOOL_ARRAY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const tools = rows.map((r) => r.tool).sort()
    assert.deepEqual(tools, ['real_schemaless', 'real_tool'])
    const schemaless = rows.find((r) => r.tool === 'real_schemaless')
    assert.equal(schemaless.hash, 'unresolved:missing')
  })

  // R2-2 (negative): a mutating helper that only *mentions* `call.name` in a
  // ternary is not a dispatcher, so the walk follows it and the calling tool
  // still reads `yes`. The ternary names only this tool, so the old
  // "any comparison anywhere" rule wrongly stopped the walk.
  const TERNARY_HELPER_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      '  {',
      "    name: 'writer_tool',",
      "    description: 'a mutating tool whose helper mentions call.name in a ternary',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      ']',
      '',
      'export function executeTool(call: AgentToolCall): ToolExecution {',
      '  switch (call.name) {',
      "    case 'writer_tool':",
      '      return writeDoc(call)',
      '    default:',
      "      return { output: 'unknown', isError: true, mutated: false, summary: call.name }",
      '  }',
      '}',
      '',
      'function writeDoc(call: AgentToolCall): ToolExecution {',
      "  const summary = call.name === 'writer_tool' ? 'write doc' : 'other'",
      "  return { output: 'wrote', mutated: true, summary }",
      '}',
      '',
    ].join('\n'),
  }

  it('follows a mutating helper that only mentions call.name in a ternary (R2-2)', () => {
    const { dir } = fixture(TERNARY_HELPER_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const writer = rows.find((r) => r.tool === 'writer_tool')
    assert.ok(writer, 'the tool must get a row')
    assert.equal(writer.write, 'yes')
  })
})

describe('name anchor hardening (N1/N2)', () => {
  // N1 (negative): only `AgentToolDef` (and `AgentTool`) name a tool *definition*.
  // An array annotated `AgentToolCall[]` / `AgentToolResult[]` holds call/result
  // records, not tool definitions: a `{ name, description }` element there must
  // yield no row, while the real `AgentToolDef[]` list next to it still yields
  // its own members (including the schema-less one).
  const CALL_RESULT_TYPES_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolCall, AgentToolDef, AgentToolResult } from '@genoffice/agent-core'",
      '',
      '// a call record has `name` too — it is not a tool definition',
      'const CALLS: AgentToolCall[] = [',
      "  { name: 'call_like', description: 'looks like a tool call' },",
      ']',
      '',
      '// a result record has `name` too — it is not a tool definition',
      'const RESULTS: AgentToolResult[] = [',
      "  { name: 'result_like', description: 'looks like a tool result' },",
      ']',
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      '  {',
      "    name: 'real_tool',",
      "    description: 'a real tool in the annotated list',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      '  {',
      "    name: 'real_schemaless',",
      "    description: 'a real schema-less tool, still in the list',",
      '  },',
      ']',
      '',
      'export function touch(): void {',
      '  void CALLS',
      '  void RESULTS',
      '}',
      '',
    ].join('\n'),
  }

  it('ignores {name, description} elements of AgentToolCall[]/AgentToolResult[] (N1)', () => {
    const { dir } = fixture(CALL_RESULT_TYPES_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const tools = rows.map((r) => r.tool).sort()
    assert.deepEqual(tools, ['real_schemaless', 'real_tool'])
    const schemaless = rows.find((r) => r.tool === 'real_schemaless')
    assert.equal(schemaless.hash, 'unresolved:missing')
  })

  it('still finds a schema-less member of an AgentToolDef[] list (N1)', () => {
    const { dir } = fixture(CALL_RESULT_TYPES_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    assert.ok(
      rows.some((r) => r.tool === 'real_schemaless'),
      'the AgentToolDef[] schema-less member must keep its row',
    )
  })

  // N2 (positive): a schema-less tool written as a returned array literal inside a
  // `get tools()` accessor is a tools list, so the `name` anchor must fire and
  // report `unresolved:missing` instead of dropping the tool silently.
  const RETURNED_LITERAL_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentSkill } from '@genoffice/agent-core'",
      '',
      'export function createDocsSkill(): AgentSkill {',
      '  return {',
      "    id: 'docs',",
      '    get tools() {',
      '      return [',
      '        {',
      "          name: 'ret_tool',",
      "          description: 'schema-less tool in a returned array literal',",
      '        },',
      '        {',
      "          name: 'ret_tool2',",
      "          description: 'a tool with a schema in the same literal',",
      "          inputSchema: { type: 'object', properties: {} },",
      '        },',
      '      ]',
      '    },',
      '  }',
      '}',
      '',
    ].join('\n'),
  }

  it('reports a schema-less tool in a `get tools()` returned literal (N2)', () => {
    const { dir } = fixture(RETURNED_LITERAL_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const ret = rows.find((r) => r.tool === 'ret_tool')
    assert.ok(ret, 'the schema-less tool must get a row')
    assert.equal(ret.hash, 'unresolved:missing')
    assert.ok(rows.some((r) => r.tool === 'ret_tool2'))
  })

  // N2 (positive): the same shape written as a `tools: [ ... ]` field.
  const TOOLS_FIELD_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentSkill } from '@genoffice/agent-core'",
      '',
      'export const docsSkill: AgentSkill = {',
      "  id: 'docs',",
      '  tools: [',
      '    {',
      "      name: 'field_tool',",
      "      description: 'schema-less tool in a tools: field',",
      '    },',
      '  ],',
      '}',
      '',
    ].join('\n'),
  }

  it('reports a schema-less tool in a `tools: [...]` field (N2)', () => {
    const { dir } = fixture(TOOLS_FIELD_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const field = rows.find((r) => r.tool === 'field_tool')
    assert.ok(field, 'the schema-less tool must get a row')
    assert.equal(field.hash, 'unresolved:missing')
  })

  // N2 (negative): arrays that are not a tools list — a `get options()` returned
  // literal, an `options: [...]` field, an unannotated `return [...]` in a plain
  // helper — still yield no rows, while the real tools list does.
  const NON_TOOLS_ARRAYS_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolDef } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      '  {',
      "    name: 'real_tool',",
      "    description: 'a real tool in the annotated list',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      ']',
      '',
      '// a `get options()` accessor is not a tools list',
      'export const menu = {',
      '  get options() {',
      '    return [',
      "      { name: 'opt_a', description: 'A' },",
      "      { name: 'opt_b', description: 'B' },",
      '    ]',
      '  },',
      '}',
      '',
      '// an `options: [...]` field is not a tools list',
      'const CONFIG = {',
      '  options: [',
      "    { name: 'cfg_a', description: 'A' },",
      '  ],',
      '}',
      '',
      '// a plain helper returning a {name, description} array is not a tools list',
      'export function palette(): unknown {',
      '  return [',
      "    { name: 'menu_open', description: 'Open' },",
      '  ]',
      '}',
      '',
      'export function touch(): void {',
      '  void CONFIG',
      '  void palette',
      '}',
      '',
    ].join('\n'),
  }

  it('ignores non-tools returned/`options:` arrays (N2 negative)', () => {
    const { dir } = fixture(NON_TOOLS_ARRAYS_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const tools = rows.map((r) => r.tool).sort()
    assert.deepEqual(tools, ['real_tool'])
  })

  // N2 (edge case): a `}` inside a string literal in the accessor body must not
  // desynchronize the brace walk, or the tool is dropped.
  const STRING_BRACE_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentSkill } from '@genoffice/agent-core'",
      'export const s: AgentSkill = {',
      "  id: 'docs',",
      '  get tools() {',
      "    const brace = '}'",
      '    void brace',
      '    return [',
      "      { name: 'guarded_tool', description: 'no schema' },",
      '    ]',
      '  },',
      '}',
      '',
    ].join('\n'),
  }

  it('finds a returned tool past a brace inside a string (N2)', () => {
    const { dir } = fixture(STRING_BRACE_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const tool = rows.find((r) => r.tool === 'guarded_tool')
    assert.ok(tool, 'the schema-less tool must still get a row')
    assert.equal(tool.hash, 'unresolved:missing')
  })
})

describe('extractor residuals (G7-06)', () => {
  // R1-1 (g6-12/review-be-extractor-1.md): the `tools: [...]` branch is
  // file-global, so a property bag that happens to be named `tools` inside a
  // schema is read as a tools list and its `{ name, description }` items become
  // phantom rows. A schema property bag is a schema description, not a list of
  // tools, while a real `tools:` field next to it still names its tools.
  const SCHEMA_TOOLS_BAG_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentSkill, AgentToolDef } from '@genoffice/agent-core'",
      '',
      'export const realTool: AgentToolDef = {',
      "  name: 'real_tool',",
      "  description: 'a tool whose schema has a property bag named tools',",
      '  inputSchema: {',
      "    type: 'object',",
      '    properties: {',
      '      tools: [',
      "        { name: 'phantom_in_schema', description: 'a schema property bag item, not a tool' },",
      '      ],',
      '    },',
      '  },',
      '}',
      '',
      'export const docsSkill: AgentSkill = {',
      "  id: 'docs',",
      '  tools: [',
      '    {',
      "      name: 'field_tool',",
      "      description: 'schema-less tool in a real tools: field',",
      '    },',
      '  ],',
      '}',
      '',
    ].join('\n'),
  }

  it('ignores a `tools` property bag nested in a schema (R1-1)', () => {
    const { dir } = fixture(SCHEMA_TOOLS_BAG_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const tools = rows.map((r) => r.tool).sort()
    assert.deepEqual(tools, ['field_tool', 'real_tool'])
    assert.equal(rows.find((r) => r.tool === 'field_tool').hash, 'unresolved:missing')
  })

  // R1-2 (same review): `insideToolsAccessor` requires the token right before
  // the body brace to be `)`, so a return-type annotation on the accessor
  // (`get tools(): AgentToolDef[]`) hides the accessor and its schema-less
  // tools are dropped silently. The `get options()` negative must stay a
  // non-tools accessor.
  const ANNOTATED_ACCESSOR_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentSkill, AgentToolDef } from '@genoffice/agent-core'",
      '',
      'export const s: AgentSkill = {',
      "  id: 'docs',",
      '  get tools(): AgentToolDef[] {',
      '    return [',
      '      {',
      "        name: 'annotated_tool',",
      "        description: 'schema-less tool in a return-type-annotated accessor',",
      '      },',
      '    ]',
      '  },',
      '}',
      '',
      'export const menu = {',
      '  get options(): Option[] {',
      '    return [',
      "      { name: 'opt_a', description: 'A' },",
      '    ]',
      '  },',
      '}',
      '',
    ].join('\n'),
  }

  it('finds a returned tool in a return-type-annotated `get tools()` (R1-2)', () => {
    const { dir } = fixture(ANNOTATED_ACCESSOR_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const tool = rows.find((r) => r.tool === 'annotated_tool')
    assert.ok(tool, 'the annotated accessor tools list must be recognised')
    assert.equal(tool.hash, 'unresolved:missing')
    assert.ok(
      !rows.some((r) => r.tool === 'opt_a'),
      'a `get options()` accessor is not a tools list',
    )
  })

  // R1-3 (same review): `insideToolsAccessor` answered true when *any* enclosing
  // brace was a `get tools()` body, so a local helper declared inside the
  // accessor and returning a tool-shaped array was read as the accessor's own
  // tools list. Only the accessor body's own brace level is that list; the
  // direct `return [ ... ]` in the same fixture must keep its row.
  const NESTED_HELPER_RETURN_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentSkill } from '@genoffice/agent-core'",
      '',
      'export const s: AgentSkill = {',
      "  id: 'docs',",
      '  get tools() {',
      '    const helper = () => {',
      '      return [',
      "        { name: 'inner_tool', description: 'the helper return value, not the accessor list' },",
      '      ]',
      '    }',
      '    void helper',
      '    return [',
      "      { name: 'direct_tool', description: 'schema-less tool in the accessor return' },",
      '    ]',
      '  },',
      '}',
      '',
    ].join('\n'),
  }

  it('ignores a nested helper return inside `get tools()` (R1-3)', () => {
    const { dir } = fixture(NESTED_HELPER_RETURN_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const tools = rows.map((r) => r.tool).sort()
    assert.deepEqual(tools, ['direct_tool'])
    assert.equal(rows.find((r) => r.tool === 'direct_tool').hash, 'unresolved:missing')
  })

  // ASI (doc §3.1 group C, packet-G6-12): the markdown module routes with a
  // semicolon-free braceless guard — `if (call.name === 'ask_clarification')
  // return …` on one line with the `switch` below it. `branchRange()` used to
  // end such a branch only at the next `;` or `}`, so the guard swallowed the
  // `switch` and the guarded read-only tool was credited with a sibling case's
  // `mutated: true`. The consequent is a single statement: it ends at the line
  // break (ASI), while an unguarded sibling keeps its own switch flag.
  const BRACELESS_GUARD_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      '  {',
      "    name: 'read_only_tool',",
      "    description: 'guarded read-only tool',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      '  {',
      "    name: 'mutating_sibling',",
      "    description: 'mutating sibling routed by the switch below',",
      "    inputSchema: { type: 'object', properties: {} },",
      '  },',
      ']',
      '',
      'export function executeTool(call: AgentToolCall): ToolExecution {',
      "  if (call.name === 'read_only_tool') return executeRead(call)",
      '  const doc = state.doc',
      '  void doc',
      '  switch (call.name) {',
      "    case 'mutating_sibling':",
      '      return writeDoc(call)',
      '    default:',
      "      return { output: 'unknown', isError: true, mutated: false, summary: call.name }",
      '  }',
      '}',
      '',
      'function executeRead(call: AgentToolCall): ToolExecution {',
      "  return { output: 'read', mutated: false, summary: 'read' }",
      '}',
      '',
      'function writeDoc(call: AgentToolCall): ToolExecution {',
      "  return { output: 'wrote', mutated: true, summary: 'write' }",
      '}',
      '',
    ].join('\n'),
  }

  it('ends a semicolon-free braceless `if` branch at its own statement (G7-06 ASI)', () => {
    const { dir } = fixture(BRACELESS_GUARD_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    assert.equal(write('read_only_tool'), 'no')
    assert.equal(write('mutating_sibling'), 'yes')
  })
})

// G706-BE-R1 (reviewer-be-ext-r1.md): `statementContinues` looked only at the
// token after a line break, so a braceless consequent that was still open there
// — an unclosed call, a returned object or array, a trailing operator that
// still needs its operand, a nested control statement — was cut at that line
// break. The named tool then lost its own `mutated: true` and the table said
// `no` / `undeclared` for code that mutates. Each shape below must keep its
// declaration inside the branch; the negatives keep the statement after a bare
// `return` (a restricted production) out of it, and the sibling keeps the
// switch route itself intact.
describe('braceless consequent extent (G7-06 r2)', () => {
  const MULTILINE_CONSEQUENT_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      "  { name: 'open_call', description: 'an unclosed call continues', inputSchema: { type: 'object' } },",
      "  { name: 'object_return', description: 'a returned object continues', inputSchema: { type: 'object' } },",
      "  { name: 'array_return', description: 'a returned array continues', inputSchema: { type: 'object' } },",
      "  { name: 'trailing_operator', description: 'a trailing && continues', inputSchema: { type: 'object' } },",
      "  { name: 'comma_argument', description: 'a comma before the break continues', inputSchema: { type: 'object' } },",
      "  { name: 'comment_inside_call', description: 'a block comment spans the break', inputSchema: { type: 'object' } },",
      "  { name: 'string_punctuation', description: 'a string holding a brace is not punctuation', inputSchema: { type: 'object' } },",
      "  { name: 'nested_if', description: 'a nested braceless if is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'nested_if_block', description: 'a nested if with a block consequent', inputSchema: { type: 'object' } },",
      "  { name: 'nested_if_else', description: 'the else binds to the nested if', inputSchema: { type: 'object' } },",
      "  { name: 'nested_for', description: 'a nested for is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'nested_for_await', description: 'a nested for await is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'nested_while', description: 'a nested while is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'nested_do', description: 'a nested do/while is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'nested_switch', description: 'a nested switch is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'nested_try', description: 'a nested try is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'outer_else', description: 'the guard branch stops before its own else', inputSchema: { type: 'object' } },",
      "  { name: 'bare_return_block', description: 'a block after a bare return', inputSchema: { type: 'object' } },",
      "  { name: 'bare_return_call', description: 'a call after a bare return', inputSchema: { type: 'object' } },",
      "  { name: 'mutating_sibling', description: 'mutating sibling routed by the switch', inputSchema: { type: 'object' } },",
      ']',
      '',
      'const ready = true',
      'const pending = false',
      'const mode = 1',
      'const items = [1]',
      '',
      'function read(call: AgentToolCall): ToolExecution {',
      "  return { output: 'read', mutated: false, summary: 'read' }",
      '}',
      '',
      'function write(call: AgentToolCall): ToolExecution {',
      "  return { output: 'wrote', mutated: true, summary: 'write' }",
      '}',
      '',
      'function wrap(value: ToolExecution): ToolExecution {',
      '  return value',
      '}',
      '',
      'export async function executeTool(call: AgentToolCall): Promise<ToolExecution> {',
      "  if (call.name === 'open_call')",
      '    return wrap(',
      '      write(call)',
      '    )',
      "  if (call.name === 'object_return')",
      '    return {',
      "      output: 'wrote',",
      '      mutated: true,',
      "      summary: 'write',",
      '    }',
      "  if (call.name === 'array_return')",
      '    return [',
      '      write(call),',
      '    ]',
      "  if (call.name === 'trailing_operator')",
      '    return read(call) &&',
      '      write(call)',
      "  if (call.name === 'comma_argument')",
      '    return wrap(read(call),',
      '      write(call))',
      "  if (call.name === 'comment_inside_call')",
      '    return wrap(read(call), /* the comment',
      '      spans a line */',
      '      write(call))',
      "  if (call.name === 'string_punctuation')",
      "    return read(call).output === '}' ? write(call) : read(call)",
      "  if (call.name === 'nested_if')",
      '    if (ready)',
      '      return write(call)',
      "  if (call.name === 'nested_if_block')",
      '    if (ready) {',
      '      return write(call)',
      '    }',
      "  if (call.name === 'nested_if_else')",
      '    if (ready) return read(call)',
      '    else return write(call)',
      "  if (call.name === 'nested_for')",
      '    for (const item of items)',
      '      write(call)',
      "  if (call.name === 'nested_for_await')",
      '    for await (const item of items)',
      '      write(call)',
      "  if (call.name === 'nested_while')",
      '    while (pending)',
      '      write(call)',
      "  if (call.name === 'nested_do')",
      '    do {',
      '      write(call)',
      '    } while (pending)',
      "  if (call.name === 'nested_switch')",
      '    switch (mode) {',
      '      case 1:',
      '        return write(call)',
      '      default:',
      '        return read(call)',
      '    }',
      "  if (call.name === 'nested_try')",
      '    try {',
      '      write(call)',
      '    } catch {',
      '      return read(call)',
      '    }',
      "  if (call.name === 'outer_else')",
      '    return read(call)',
      '  else',
      '    write(call)',
      "  if (call.name === 'bare_return_block')",
      '    return',
      '  {',
      '    mutated: true',
      '  }',
      "  if (call.name === 'bare_return_call')",
      '    return',
      '  (write(call))',
      '  switch (call.name) {',
      "    case 'mutating_sibling':",
      '      return write(call)',
      '    default:',
      "      return { output: 'unknown', isError: true, mutated: false, summary: call.name }",
      '  }',
      '}',
      '',
    ].join('\n'),
  }

  it('keeps a multiline consequent inside the braceless guard that owns it (G706-BE-R1)', () => {
    const { dir } = fixture(MULTILINE_CONSEQUENT_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => {
      const row = rows.find((r) => r.tool === tool)
      assert.ok(row, `expected a row for ${tool}`)
      return row.write
    }
    // every consequent below runs `mutated: true`
    for (const tool of [
      'open_call', // return wrap( / write(call) / )
      'object_return', // return { / mutated: true / }
      'array_return', // return [ / write(call) / ]
      'trailing_operator', // return read(call) && / write(call)
      'comma_argument', // return wrap(read(call), / write(call))
      'comment_inside_call', // the line break sits inside a block comment
      'string_punctuation', // a string whose decoded value is `}` is not punctuation
      'nested_if', // if (ready) / return write(call)
      'nested_if_block', // if (ready) { / return write(call) / }
      'nested_if_else', // if (ready) return read(call) / else return write(call)
      'nested_for', // for (const item of items) / write(call)
      'nested_for_await', // for await (const item of items) / write(call)
      'nested_while', // while (pending) / write(call)
      'nested_do', // do { write(call) } while (pending)
      'nested_switch', // switch (mode) { case 1: return write(call) … }
      'nested_try', // try { write(call) } catch { … }
    ]) {
      assert.equal(write(tool), 'yes', `${tool} must keep its own mutating branch`)
    }
    // the guard's own `else` is not the `===` path, and the switch below still routes
    assert.equal(write('outer_else'), 'no')
    assert.equal(write('mutating_sibling'), 'yes')
  })

  it('does not credit a statement after a bare `return` (G706-BE-R1)', () => {
    const { dir } = fixture(MULTILINE_CONSEQUENT_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    // `return` NL is a restricted production: the line break ends the statement,
    // so the block / call below it runs for every tool, not as this guard's branch
    assert.equal(write('bare_return_block'), 'undeclared')
    assert.equal(write('bare_return_call'), 'undeclared')
  })
})

// G706-BE-R3/-R4 (reviewer-be-ext-r2-report.md §5): the statement walk treated
// a template literal as an operator that still needs its operand, so a
// consequent that *ended* in a template never ended there — the walk ran on and
// credited the following statement's `mutated: true` to a read-only tool, and
// the symmetric `!==` fall-through lost a real flag. A template literal is one
// complete primary expression: the next line continues the statement only when
// it opens with an operator, a tagged template included. The same rule covers
// the other completed tails (string, number, regex, an identifier — e.g. a
// keyword used as a property name like `read(call).in` — and a closing `)`),
// and a labelled control statement keeps its label inside the branch.
describe('completed primary expression (G7-06 r3)', () => {
  const COMPLETED_PRIMARY_FIXTURE = {
    'apps/docs/src/renderer/ai/tools.ts': [
      "import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      "  { name: 't_plain', description: 'a template ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_switch', description: 'a template then a sibling switch', inputSchema: { type: 'object' } },",
      "  { name: 't_interp', description: 'an interpolated template ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_nested', description: 'a nested template ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_void', description: 'a void template ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_assign', description: 'an assigned template ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 'read_and', description: 'a read && template branch falls through', inputSchema: { type: 'object' } },",
      "  { name: 't_prop_in', description: 'a property named in completes the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_prop_as', description: 'a property named as completes the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_string', description: 'a string ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_number', description: 'a number ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_regex', description: 'a regex ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 't_close', description: 'a member access on a call ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 'tag_next', description: 'a tagged template continues the statement', inputSchema: { type: 'object' } },",
      "  { name: 'call_template', description: 'a template inside an open call continues', inputSchema: { type: 'object' } },",
      "  { name: 'closed_call', description: 'a closed call with a template ends the statement', inputSchema: { type: 'object' } },",
      "  { name: 'lbl_if', description: 'a labelled if is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'lbl_for', description: 'a labelled for is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'lbl_while', description: 'a labelled while is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'lbl_block', description: 'a labelled block is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'lbl_switch', description: 'a labelled switch is the consequent', inputSchema: { type: 'object' } },",
      "  { name: 'sib_plain', description: 'mutating sibling of the plain template', inputSchema: { type: 'object' } },",
      "  { name: 'sib_switch', description: 'mutating sibling in the switch route', inputSchema: { type: 'object' } },",
      "  { name: 'sib_interp', description: 'mutating sibling of the interpolated template', inputSchema: { type: 'object' } },",
      "  { name: 'sib_nested', description: 'mutating sibling of the nested template', inputSchema: { type: 'object' } },",
      "  { name: 'sib_void', description: 'mutating sibling of the void template', inputSchema: { type: 'object' } },",
      "  { name: 'sib_assign', description: 'mutating sibling of the assigned template', inputSchema: { type: 'object' } },",
      "  { name: 'sib_read_and', description: 'mutating sibling after read && template', inputSchema: { type: 'object' } },",
      "  { name: 'sib_prop_in', description: 'mutating sibling of the in property', inputSchema: { type: 'object' } },",
      "  { name: 'sib_prop_as', description: 'mutating sibling of the as property', inputSchema: { type: 'object' } },",
      "  { name: 'sib_string', description: 'mutating sibling of the string tail', inputSchema: { type: 'object' } },",
      "  { name: 'sib_number', description: 'mutating sibling of the number tail', inputSchema: { type: 'object' } },",
      "  { name: 'sib_regex', description: 'mutating sibling of the regex tail', inputSchema: { type: 'object' } },",
      "  { name: 'sib_close', description: 'mutating sibling of the member access tail', inputSchema: { type: 'object' } },",
      "  { name: 'sib_closed', description: 'mutating sibling in the closed-call switch', inputSchema: { type: 'object' } },",
      "  { name: 'mutating_sibling', description: 'mutating sibling routed by the switch', inputSchema: { type: 'object' } },",
      ']',
      '',
      'const ready = true',
      'const pending = false',
      'const mode = 1',
      'const items = [1]',
      'let out: unknown',
      '',
      'function read(call: AgentToolCall): ToolExecution {',
      "  return { output: 'read', mutated: false, summary: 'read' }",
      '}',
      '',
      'function write(call: AgentToolCall): ToolExecution {',
      "  return { output: 'wrote', mutated: true, summary: 'write' }",
      '}',
      '',
      'function wrap(value: ToolExecution): ToolExecution {',
      "  return { output: 'wrapped', mutated: false, summary: 'wrap' }",
      '}',
      '',
      'export async function executeTool(call: AgentToolCall): Promise<ToolExecution> {',
      "  if (call.name === 't_plain')",
      '    return `a`',
      "  if (call.name === 'sib_plain') return write(call)",
      "  if (call.name === 't_switch')",
      '    return `a`',
      '  switch (call.name) {',
      "    case 'sib_switch':",
      '      return write(call)',
      '    default:',
      '      return read(call)',
      '  }',
      "  if (call.name === 't_interp')",
      '    return `${call.name}`',
      "  if (call.name === 'sib_interp') return write(call)",
      "  if (call.name === 't_nested')",
      '    return `${`inner ${1}`}`',
      "  if (call.name === 'sib_nested') return write(call)",
      "  if (call.name === 't_void')",
      '    void `a`',
      "  if (call.name === 'sib_void') return write(call)",
      "  if (call.name === 't_assign')",
      '    out = `a`',
      "  if (call.name === 'sib_assign') return write(call)",
      "  if (call.name === 'read_and')",
      '    read(call) &&',
      '      `a`',
      "  if (call.name === 'sib_read_and') return write(call)",
      "  if (call.name === 't_prop_in')",
      '    return read(call).in',
      "  if (call.name === 'sib_prop_in') return write(call)",
      "  if (call.name === 't_prop_as')",
      '    return read(call).as',
      "  if (call.name === 'sib_prop_as') return write(call)",
      "  if (call.name === 't_string')",
      "    return read(call) && 'a'",
      "  if (call.name === 'sib_string') return write(call)",
      "  if (call.name === 't_number')",
      '    return read(call) && 5',
      "  if (call.name === 'sib_number') return write(call)",
      "  if (call.name === 't_regex')",
      '    return read(call) && /a/',
      "  if (call.name === 'sib_regex') return write(call)",
      "  if (call.name === 't_close')",
      '    return read(call).output',
      "  if (call.name === 'sib_close') return write(call)",
      "  if (call.name === 'tag_next')",
      '    return wrap',
      '      `a${1}',
      'b` && write(call)',
      "  if (call.name === 'call_template')",
      '    return wrap(',
      '      `a',
      'b`,',
      '      write(call))',
      "  if (call.name === 'closed_call')",
      '    return wrap(',
      '      `a`',
      '    )',
      '  switch (call.name) {',
      "    case 'sib_closed':",
      '      return write(call)',
      '  }',
      "  if (call.name === 'lbl_if')",
      '    label_if: if (ready)',
      '      return write(call)',
      "  if (call.name === 'lbl_for')",
      '    label_for: for (const item of items)',
      '      write(call)',
      "  if (call.name === 'lbl_while')",
      '    label_while: while (pending)',
      '      write(call)',
      "  if (call.name === 'lbl_block')",
      '    label_block: {',
      '      return write(call)',
      '    }',
      "  if (call.name === 'lbl_switch')",
      '    label_switch: switch (mode) {',
      '      case 1:',
      '        write(call)',
      '    }',
      '  switch (call.name) {',
      "    case 'mutating_sibling':",
      '      return write(call)',
      '    default:',
      "      return { output: 'unknown', isError: true, mutated: false, summary: call.name }",
      '  }',
      '}',
      '',
    ].join('\n'),
    'apps/docs/src/renderer/ai/neq.ts': [
      "import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      "  { name: 't_neq', description: 'the fall-through keeps its own mutation', inputSchema: { type: 'object' } },",
      "  { name: 't_neq_prop', description: 'the fall-through after a property tail', inputSchema: { type: 'object' } },",
      ']',
      '',
      'function read(call: AgentToolCall): ToolExecution {',
      "  return { output: 'read', mutated: false, summary: 'read' }",
      '}',
      '',
      'function write(call: AgentToolCall): ToolExecution {',
      "  return { output: 'wrote', mutated: true, summary: 'write' }",
      '}',
      '',
      'export async function executeNeq(call: AgentToolCall): Promise<ToolExecution> {',
      "  if (call.name !== 't_neq')",
      '    return read(call) && `a`',
      '  write(call)',
      '}',
      '',
      'export async function executeNeqProp(call: AgentToolCall): Promise<ToolExecution> {',
      "  if (call.name !== 't_neq_prop')",
      '    return read(call).in',
      '  write(call)',
      '}',
      '',
    ].join('\n'),
  }

  it('ends a consequent at the primary expression that completes it (G706-BE-R3)', () => {
    const { dir } = fixture(COMPLETED_PRIMARY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => {
      const row = rows.find((r) => r.tool === tool)
      assert.ok(row, `expected a row for ${tool}`)
      return row.write
    }
    // the template (plain, interpolated, nested) ends the consequent at ASI, so
    // the sibling below it is a statement of its own, not part of this branch
    for (const tool of ['t_plain', 't_switch', 't_interp', 't_nested', 't_void', 't_assign']) {
      assert.equal(write(tool), 'undeclared', `${tool} must not borrow a sibling's mutation`)
    }
    // `read(call) &&` + template: the branch declares only read's `mutated: false`
    assert.equal(write('read_and'), 'no')
    // a keyword used as a property name is a complete expression too
    assert.equal(write('t_prop_in'), 'no')
    assert.equal(write('t_prop_as'), 'no')
    // the already-correct completed tails (string, number, regex, member access)
    for (const tool of ['t_string', 't_number', 't_regex', 't_close']) {
      assert.equal(write(tool), 'no', `${tool} must end at its own statement`)
    }
    // and every sibling guard keeps its own mutating branch
    for (const tool of [
      'sib_plain',
      'sib_switch',
      'sib_interp',
      'sib_nested',
      'sib_void',
      'sib_assign',
      'sib_read_and',
      'sib_prop_in',
      'sib_prop_as',
      'sib_string',
      'sib_number',
      'sib_regex',
      'sib_close',
      'sib_closed',
    ]) {
      assert.equal(write(tool), 'yes', `${tool} must keep its own mutating branch`)
    }
  })

  it('keeps a template that does not complete the statement inside the branch (G706-BE-R3)', () => {
    const { dir } = fixture(COMPLETED_PRIMARY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    // a tagged template on the next line continues the statement
    assert.equal(write('tag_next'), 'yes')
    // and a template spanning lines inside an open call keeps the call's argument
    assert.equal(write('call_template'), 'yes')
    // a closed call (wrap declares `mutated: false`) ends the statement at `)`
    assert.equal(write('closed_call'), 'no')
  })

  it('keeps the `!==` fall-through after a completed primary expression (G706-BE-R3)', () => {
    const { dir } = fixture(COMPLETED_PRIMARY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    // the early-return consequent ends at the template / the property access, so
    // the `write(call)` under it is the tool's own fall-through path
    assert.equal(write('t_neq'), 'yes')
    assert.equal(write('t_neq_prop'), 'yes')
  })

  it('takes a labelled control statement with the braceless branch (G706-BE-R4)', () => {
    const { dir } = fixture(COMPLETED_PRIMARY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    // the three shapes the review found broken, plus the labelled block and
    // labelled switch that were already correct before this fix
    for (const tool of ['lbl_if', 'lbl_for', 'lbl_while', 'lbl_block', 'lbl_switch']) {
      assert.equal(write(tool), 'yes', `${tool} must keep the labelled consequent`)
    }
  })
})

// G706-BE-R6/-R7 (reviewer-be-ext-r3-report.md §5): a keyword used as a property
// name (`read(call).in`, `read(call).instanceof`) completes the expression, but
// the tokenizer still read the `/` that opens the next line as a regex literal.
// One `regex` token swallowed the division (`/ 2 /`), the walk stopped at the
// property, and the consequent was cut short: the `===` branch lost its real
// `write` call and the `!==` fall-through started early and credited one. The
// tokenizer must keep a `/` after a member name a division — and after a
// postfix `++`/`--`, the same completed-expression class — so the division that
// really continues the statement does continue it.
describe('division after a property name (G7-06 r4)', () => {
  const KEYWORD_PROPERTIES = ['in', 'instanceof', 'typeof', 'delete', 'void', 'new', 'return']
  const EQ_TOOLS = [
    ...KEYWORD_PROPERTIES.flatMap((kw) => [`eq_${kw}`, `sib_eq_${kw}`]),
    'eq_opt_in',
    'sib_eq_opt_in',
    'eq_as',
    'sib_eq_as',
    'eq_output',
    'sib_eq_output',
    'div_paren',
    'sib_div_paren',
    'div_bracket',
    'sib_div_bracket',
    'div_brace',
    'sib_div_brace',
    'div_literal',
    'sib_div_literal',
    'div_ident',
    'sib_div_ident',
    'div_string',
    'sib_div_string',
    'div_template',
    'sib_div_template',
    'div_regex',
    'sib_div_regex',
    'div_postfix_inc',
    'sib_div_postfix_inc',
    'div_postfix_dec',
    'sib_div_postfix_dec',
    'ctrl_regex_return',
    'sib_ctrl_regex_return',
    'ctrl_regex_and',
    'sib_ctrl_regex_and',
    'ctrl_regex_stmt',
    'sib_ctrl_regex_stmt',
  ]
  // one guard per tool; the consequent on one line, its division on the next
  const NEQ_ROWS = [
    ...KEYWORD_PROPERTIES.map((kw) => [`neq_${kw}`, `read(call).${kw}`]),
    ['neq_as', 'read(call).as'],
    ['neq_output', 'read(call).output'],
  ]

  const DIVISION_PROPERTY_FIXTURE = {
    'apps/docs/src/renderer/ai/div_eq.ts': [
      "import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      ...EQ_TOOLS.map(
        (name) =>
          `  { name: '${name}', description: 'division continues a property tail', inputSchema: { type: 'object' } },`,
      ),
      ']',
      '',
      'const mode = 1',
      'let counter = 0',
      '',
      'function read(call: AgentToolCall): ToolExecution {',
      "  return { output: 'read', mutated: false, summary: 'read' }",
      '}',
      '',
      'function write(call: AgentToolCall): ToolExecution {',
      "  return { output: 'wrote', mutated: true, summary: 'write' }",
      '}',
      '',
      'function wrap(value: ToolExecution): ToolExecution {',
      "  return { output: 'wrapped', mutated: false, summary: 'wrap' }",
      '}',
      '',
      'export async function executeTool(call: AgentToolCall): Promise<ToolExecution> {',
      ...KEYWORD_PROPERTIES.flatMap((kw) => [
        `  if (call.name === 'eq_${kw}')`,
        `    return read(call).${kw}`,
        '      / 2 / write(call)',
        `  if (call.name === 'sib_eq_${kw}') return write(call)`,
      ]),
      "  if (call.name === 'eq_opt_in')",
      '    return read(call)?.in',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_eq_opt_in') return write(call)",
      "  if (call.name === 'eq_as')",
      '    return read(call).as',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_eq_as') return write(call)",
      "  if (call.name === 'eq_output')",
      '    return read(call).output',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_eq_output') return write(call)",
      "  if (call.name === 'div_paren')",
      '    return wrap(read(call))',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_paren') return write(call)",
      "  if (call.name === 'div_bracket')",
      '    return [read(call)][0]',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_bracket') return write(call)",
      "  if (call.name === 'div_brace')",
      '    return { output: read(call).output }',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_brace') return write(call)",
      "  if (call.name === 'div_literal')",
      '    return read(call) && 5',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_literal') return write(call)",
      "  if (call.name === 'div_ident')",
      '    return read(call) && mode',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_ident') return write(call)",
      "  if (call.name === 'div_string')",
      "    return read(call) && 'a'",
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_string') return write(call)",
      "  if (call.name === 'div_template')",
      '    return read(call) && `a`',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_template') return write(call)",
      "  if (call.name === 'div_regex')",
      '    return read(call) && /a/',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_regex') return write(call)",
      "  if (call.name === 'div_postfix_inc')",
      '    counter++',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_postfix_inc') return write(call)",
      "  if (call.name === 'div_postfix_dec')",
      '    counter--',
      '      / 2 / write(call)',
      "  if (call.name === 'sib_div_postfix_dec') return write(call)",
      "  if (call.name === 'ctrl_regex_return')",
      '    return / 2 /.test(String(read(call).output)) && write(call)',
      "  if (call.name === 'sib_ctrl_regex_return') return write(call)",
      "  if (call.name === 'ctrl_regex_and')",
      '    return read(call) &&',
      '      / 2 /.test(String(read(call).output)) && write(call)',
      "  if (call.name === 'sib_ctrl_regex_and') return write(call)",
      "  if (call.name === 'ctrl_regex_stmt')",
      '    / 2 /.test(String(read(call).output)) && write(call)',
      "  if (call.name === 'sib_ctrl_regex_stmt') return write(call)",
      '}',
      '',
    ].join('\n'),
    'apps/docs/src/renderer/ai/div_neq.ts': [
      "import type { AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'",
      '',
      'export const AGENT_TOOLS: AgentToolDef[] = [',
      ...NEQ_ROWS.map(
        ([name]) =>
          `  { name: '${name}', description: 'division after a property tail', inputSchema: { type: 'object' } },`,
      ),
      ']',
      '',
      'function read(call: AgentToolCall): ToolExecution {',
      "  return { output: 'read', mutated: false, summary: 'read' }",
      '}',
      '',
      'function write(call: AgentToolCall): ToolExecution {',
      "  return { output: 'wrote', mutated: true, summary: 'write' }",
      '}',
      '',
      // the consequent (the branch the tool does not take) ends after the whole
      // division statement, so the fall-through `return read(call)` is the
      // tool's own path, and `write` must never reach it
      ...NEQ_ROWS.flatMap(([name, tail]) => [
        `export async function execute_${name}(call: AgentToolCall): Promise<ToolExecution> {`,
        `  if (call.name !== '${name}')`,
        `    return ${tail}`,
        '      / 2 / write(call)',
        '  return read(call)',
        '}',
        '',
      ]),
    ].join('\n'),
  }

  it('keeps the division that continues a keyword property tail in the `===` branch (G706-BE-R6)', () => {
    const { dir } = fixture(DIVISION_PROPERTY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => {
      const row = rows.find((r) => r.tool === tool)
      assert.ok(row, `expected a row for ${tool}`)
      return row.write
    }
    // each consequent really is `return read(call).<kw> / 2 / write(call)`: the
    // division-initial line continues the statement, so `write` is reached
    for (const kw of KEYWORD_PROPERTIES) {
      assert.equal(write(`eq_${kw}`), 'yes', `eq_${kw} must keep its division continuation`)
      assert.equal(write(`sib_eq_${kw}`), 'yes', `sib_eq_${kw} must keep its own branch`)
    }
    assert.equal(write('eq_opt_in'), 'yes')
    assert.equal(write('sib_eq_opt_in'), 'yes')
  })

  it('credits the `!==` fall-through only after the whole division statement (G706-BE-R6)', () => {
    const { dir } = fixture(DIVISION_PROPERTY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => {
      const row = rows.find((r) => r.tool === tool)
      assert.ok(row, `expected a row for ${tool}`)
      return row.write
    }
    // the truncated consequent used to hand the rest of the statement to the
    // fall-through, so `write` was credited to a read-only tool
    for (const [name] of NEQ_ROWS) {
      assert.equal(write(name), 'no', `${name} must not credit the early-return branch`)
    }
  })

  it('keeps the division continuation after every other completed tail (G706-BE-R6 sweep)', () => {
    const { dir } = fixture(DIVISION_PROPERTY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    for (const tool of [
      'div_paren',
      'div_bracket',
      'div_brace',
      'div_literal',
      'div_ident',
      'div_string',
      'div_template',
      'div_regex',
      'div_postfix_inc',
      'div_postfix_dec',
    ]) {
      assert.equal(write(tool), 'yes', `${tool} must keep its division continuation`)
      assert.equal(write(`sib_${tool}`), 'yes', `sib_${tool} must keep its own branch`)
    }
  })

  it('keeps a non-keyword property and a real regex green (G706-BE-R6 controls)', () => {
    const { dir } = fixture(DIVISION_PROPERTY_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const write = (tool) => rows.find((r) => r.tool === tool).write
    // `as` / `output` never allowed a regex after them, so they were already
    // right; a real regex literal keeps being a regex
    for (const tool of [
      'eq_as',
      'sib_eq_as',
      'eq_output',
      'sib_eq_output',
      'ctrl_regex_return',
      'sib_ctrl_regex_return',
      'ctrl_regex_and',
      'sib_ctrl_regex_and',
      'ctrl_regex_stmt',
      'sib_ctrl_regex_stmt',
    ]) {
      assert.equal(write(tool), 'yes', `${tool} must keep its own branch`)
    }
  })
})

// G706-BE-R8/-R9/-R10 and the fail-closed question (reviewer-be-ext-r4-report.md).
// The residuals are LATENT under the advisor rule: no reachable trigger at
// 66169a9a, 0d03b185 or cb76dde5, and their three-rev stdout is byte-identical.
// They stay todos, with the exact source shape in each comment, so the fixture
// can be written from them without re-deriving the trigger.
describe('latent residuals (G7-06 r5)', () => {
  // LATENT: zero prefix update followed by a regex token at all three revs.
  // Equality shape, expected `yes` (f0fead82 gives `undeclared`):
  //   if (call.name === 'target') ++/;/.lastIndex && write(call)
  //   if (call.name === 'target') --/;/.lastIndex && write(call)
  // Inequality shape, expected `no` (f0fead82 gives `yes`), the consequent is the
  // early return and `return read(call)` is the fall-through:
  //   if (call.name !== 'target') ++/;/.lastIndex && write(call)
  //   return read(call)
  // Postfix controls keep their division, expected `yes` under `===`:
  //   counter++ NL / 2 / write(call)
  //   counter-- NL / 2 / write(call)
  it.todo('LATENT G706-BE-R8: prefix ++/-- before a regex member keeps the guard boundary')

  // LATENT: zero decoded `.` or `?.` string followed by a regex-allowing keyword
  // at all three revs (six `.` strings, each followed by `)` or `:`).
  // Equality shape inside the guard block, expected `yes` (f0fead82 gives `undeclared`):
  //   if (call.name === 'target') {
  //     const x = '.'
  //     return /}/.test('x') && write(call)
  //   }
  // The same with const x = '?.'. Real-member controls, expected `yes`:
  //   return read(call).output NL / 2 / write(call)
  //   return read(call).in NL / 2 / write(call)
  it.todo('LATENT G706-BE-R9: string dot before return does not turn a regex into division')

  // LATENT: verification gap linked to R8/R9. All 40 tests pass while the R8 and
  // R9 shapes regress, because no fixture covers a prefix update before a regex
  // member or a decoded dot string before a regex-allowing keyword. The two todos
  // above are those complementary fixtures; zero occurrences at all three revs.
  it.todo(
    'LATENT G706-BE-R10: new tokenizer branches have complementary fixtures for prefix update and string dot',
  )

  // Fail-closed, not latent: the extractor does not fail closed today. Each probe
  // below exits 0 with an ordinary cell (report: FAIL CLOSED NO). Expected: a
  // nonzero exit or an explicit unresolved cell, and no yes/no for that analysis.
  //   missing final `}` after `if (call.name === 't') return read(call)` + `return write(call)` (today: no)
  //   `return { mutated:false` never closed, then `return write(call)` (today: yes)
  //   unknown token `call.name §=== 't'` in the guard condition (today: no)
  //   unterminated `'oops` after `return read(call) +` (today: no)
  //   `return wrap(` NL `read(call)` NL `return write(call)`, no matching `)` (today: yes)
  //   unbounded consequent `return typeof` NL `write(call)` (today: undeclared)
  it.todo('extractor fails closed on malformed tokens and unbounded guard consequents')
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

  it('reports the two blocked rows as read-only at the pin (R1-1, R1-2)', () => {
    const { rows } = extract({ repo: REPO_ROOT, rev: 'HEAD' })
    const write = (module, tool) => rows.find((r) => r.module === module && r.tool === tool).write
    // docs web_search: its own `mutated: false` in executeAsyncTool, not the sibling executors
    assert.equal(write('docs', 'web_search'), 'no')
    // sheets find_cells: its own `finish` closure declares mutated: false
    assert.equal(write('sheets', 'find_cells'), 'no')
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

  it('resolves the recursive mind-map schema at the pin (G6-09d, REPIN-1, RBD9-6)', () => {
    const EXPECTED_HASH = '429247ed06edd88672907f9990f1a01dbfa0ca17691d13c8019be461fdf06cb5'
    const expectedNode = (depth) => ({
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description:
            "short node label (2-8 words) in the document's language, taken from its headings or key phrases",
        },
        block: {
          type: 'integer',
          description:
            '0-based block index this node summarizes (from the current block list); omit when the node spans several blocks',
        },
        children:
          depth > 0
            ? {
                type: 'array',
                description: 'sub-topics; 2-5 per node reads best',
                items: expectedNode(depth - 1),
              }
            : {
                type: 'array',
                description: 'sub-topics; 2-5 per node reads best',
                items: {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: "short node label (2-8 words) in the document's language",
                    },
                  },
                  required: ['label'],
                },
              },
      },
      required: ['label'],
    })
    const EXPECTED_SCHEMA = {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description:
            'optional: the aspect the map should center on (e.g. "risk controls", "for beginners"); omit for a whole-document map',
        },
        root: {
          type: 'object',
          description: 'the mind map tree: root node with nested children',
          ...expectedNode(5),
        },
      },
      required: ['root'],
    }
    assert.equal(hashOf(EXPECTED_SCHEMA), EXPECTED_HASH)

    const runtimeSchemas = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--experimental-strip-types',
          '--no-warnings',
          '-e',
          [
            "import { MIND_MAP_TOOL as docs } from './apps/docs/src/renderer/ai/mind-map.ts'",
            "import { MIND_MAP_TOOL as markdown } from './apps/markdown/src/renderer/ai/mind-map.ts'",
            'process.stdout.write(JSON.stringify({ docs: docs.inputSchema, markdown: markdown.inputSchema }))',
          ].join('\n'),
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      ),
    )

    const result = extract({ repo: REPO_ROOT, rev: 'HEAD' })
    const file = extractor.buildSchemaFile(result)
    for (const module of ['docs', 'markdown']) {
      const row = result.rows.find((r) => r.module === module && r.tool === 'generate_mindmap')
      assert.ok(row, `expected a ${module}/generate_mindmap row`)
      assert.equal(row.hash, EXPECTED_HASH)
      const tool = file[module].find((t) => t.function.name === 'generate_mindmap')
      assert.ok(tool, `${module}/generate_mindmap is offered`)
      const entry = file.catalogue.find((e) => e.module === module && e.name === 'generate_mindmap')
      assert.equal(entry.schemaComplete, true)
      assert.equal(entry.offered, true)
      assert.equal(entry.tableHash, EXPECTED_HASH)
      assert.equal(entry.inputSchemaSha256, EXPECTED_HASH)
      assert.equal(hashOf(runtimeSchemas[module]), EXPECTED_HASH)
      assert.deepEqual(tool.function.parameters, runtimeSchemas[module])
      assert.deepEqual(tool.function.parameters, EXPECTED_SCHEMA)

      // explicit structural pins for focus, descriptions, block, and leaf shape across all 6 levels
      assert.deepEqual(tool.function.parameters.properties.focus, EXPECTED_SCHEMA.properties.focus)
      let node = tool.function.parameters.properties.root
      for (let level = 0; level < 6; level += 1) {
        assert.deepEqual(Object.keys(node.properties).sort(), ['block', 'children', 'label'])
        assert.deepEqual(node.properties.label, EXPECTED_SCHEMA.properties.root.properties.label)
        assert.deepEqual(node.properties.block, EXPECTED_SCHEMA.properties.root.properties.block)
        assert.deepEqual(node.required, ['label'])
        node = node.properties.children.items
      }
      assert.deepEqual(node, {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: "short node label (2-8 words) in the document's language",
          },
        },
        required: ['label'],
      })
      assert.deepEqual(tool.function.parameters.required, ['root'])
    }
  })
})

// ────────────────────────── --emit-schemas (G6-09 W10, R2) ──────────────────────────

const EMIT_FIXTURE = {
  'apps/docs/src/renderer/ai/tools.ts': [
    "import type { AgentToolDef } from '@genoffice/agent-core'",
    '',
    "const SIZES = [{ label: 'A4' }, { label: 'Letter' }]",
    '',
    'export const AGENT_TOOLS: AgentToolDef[] = [',
    '  {',
    "    name: 'literal_tool',",
    "    description: 'a literal schema',",
    '    inputSchema: {',
    "      type: 'object',",
    '      properties: { zeta: { type: "string" }, alpha: { type: "integer" } },',
    "      required: ['alpha'],",
    '    },',
    '  },',
    '  {',
    "    name: 'enum_tool',",
    "    description: 'an enum built with an arrow function',",
    '    inputSchema: {',
    "      type: 'object',",
    "      properties: { size: { type: 'string', enum: SIZES.map((p) => p.label) } },",
    '    },',
    '  },',
    '  {',
    "    name: 'guide_tool',",
    "    description: 'Intro. ' + buildGuide(),",
    "    inputSchema: { type: 'object', properties: {} },",
    '  },',
    '  {',
    "    name: 'unresolvable',",
    "    description: `built by ${'a call'}`,",
    "    inputSchema: buildSchema('unresolvable'),",
    '  },',
    '  {',
    "    name: 'computed_description',",
    "    description: `ops: ${opNames().join(', ')}`,",
    "    inputSchema: { type: 'object', properties: { ops: { type: 'array' } } },",
    '  },',
    '  {',
    "    name: 'concat_tool',",
    "    description: 'first part. ' +",
    "      'second part.',",
    '    inputSchema: {',
    "      type: 'object',",
    "      properties: { q: { type: 'string', description: 'long ' + 'text', } },",
    '    },',
    '  },',
    '  {',
    "    name: 'operator_tool',",
    "    description: 'x' || 'y',",
    "    inputSchema: { type: 'object', properties: { n: { type: 'number' } } },",
    '  },',
    '  {',
    "    name: 'schemaless',",
    "    description: 'a tool with no inputSchema',",
    '  },',
    ']',
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
  'packages/agent-core/src/shared-tools.ts': [
    "import type { AgentToolDef } from './types'",
    '',
    'export const SHARED_TOOLS: AgentToolDef[] = [',
    '  {',
    "    name: 'ask_clarification',",
    "    description: 'shared by every module',",
    "    inputSchema: { type: 'object', properties: { question: { type: 'string' } } },",
    '  },',
    ']',
    '',
  ].join('\n'),
}

const RUNTIME_MARK = '[generated at runtime]'
const MODULE_KEYS = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']

describe('--emit-schemas', () => {
  const build = (repo, rev) => {
    assert.equal(typeof extractor.buildSchemaFile, 'function', 'buildSchemaFile is exported')
    return extractor.buildSchemaFile(extract({ repo, rev }))
  }

  it('emits the schema file the G7-12 harness loads, with the incomplete tools listed', () => {
    const { dir, sha } = fixture(EMIT_FIXTURE)
    const result = extract({ repo: dir, rev: sha })
    const file = build(dir, sha)

    assert.deepEqual(Object.keys(file), ['header', ...MODULE_KEYS, 'catalogue'])
    assert.deepEqual(file.header, {
      kind: 'genoffice-tool-schemas',
      version: 1,
      rev: sha,
      mechanicalBlockSha256: sha256(result.text),
      counts: { docs: 8, sheets: 1, slides: 0, pdf: 0, markdown: 0, html: 0, 'agent-core': 1 },
    })

    // the shape holdout-backend.mjs reads: per module, `{ type: 'function', function: { name, description, parameters } }`
    const tool = (module, name) => file[module].find((t) => t.function.name === name)
    assert.deepEqual(
      file.docs.map((t) => t.function.name),
      ['computed_description', 'concat_tool', 'enum_tool', 'guide_tool', 'literal_tool'],
    )
    assert.deepEqual(tool('docs', 'literal_tool'), {
      type: 'function',
      function: {
        name: 'literal_tool',
        description: 'a literal schema',
        parameters: LITERAL_SCHEMA,
      },
    })
    // source key order is kept (`zeta` before `alpha`), not sorted
    assert.deepEqual(Object.keys(tool('docs', 'literal_tool').function.parameters.properties), [
      'zeta',
      'alpha',
    ])
    assert.deepEqual(file.sheets, [
      {
        type: 'function',
        function: {
          name: 'sheet_tool',
          description: 'one tool in a second module',
          parameters: { type: 'object', properties: { range: { type: 'string' } } },
        },
      },
    ])
    for (const module of ['slides', 'pdf', 'markdown', 'html']) assert.deepEqual(file[module], [])

    // `first part. ` + `second part.` is one description, not its first operand
    assert.equal(tool('docs', 'concat_tool').function.description, 'first part. second part.')
    // an arrow function inside a call (`.map((p) => p.label)`) is folded, not flagged as an operator
    assert.deepEqual(tool('docs', 'enum_tool').function.parameters.properties.size.enum, [
      'A4',
      'Letter',
    ])
    // a description that needs product code is offered partial: the literal text, a neutral marker where the code ran
    assert.equal(tool('docs', 'computed_description').function.description, `ops: ${RUNTIME_MARK}`)
    assert.equal(tool('docs', 'guide_tool').function.description, `Intro. ${RUNTIME_MARK}`)

    const CONCAT_FULL = {
      type: 'object',
      properties: { q: { type: 'string', description: 'long text' } },
    }
    const askSchema = { type: 'object', properties: { question: { type: 'string' } } }
    const opsSchema = { type: 'object', properties: { ops: { type: 'array' } } }
    const rangeSchema = { type: 'object', properties: { range: { type: 'string' } } }
    const nSchema = { type: 'object', properties: { n: { type: 'number' } } }
    const emptySchema = { type: 'object', properties: {} }
    const enumSchema = {
      type: 'object',
      properties: { size: { type: 'string', enum: ['A4', 'Letter'] } },
    }
    const DOCS_SRC = 'apps/docs/src/renderer/ai/tools.ts'
    const base = (module, name, source) => ({
      module,
      name,
      host: source.startsWith('packages/') ? 'agent-core' : 'renderer',
      source,
    })
    assert.deepEqual(file.catalogue, [
      {
        ...base('agent-core', 'ask_clarification', 'packages/agent-core/src/shared-tools.ts'),
        schemaComplete: true,
        descriptionComplete: true,
        offered: true,
        inputSchemaSha256: hashOf(askSchema),
        tableHash: hashOf(askSchema),
      },
      {
        // partial: the schema is real, the description has a marker where `opNames()` ran
        ...base('docs', 'computed_description', DOCS_SRC),
        schemaComplete: true,
        descriptionComplete: false,
        offered: true,
        reason: 'description:identifier:opNames',
        inputSchemaSha256: hashOf(opsSchema),
        tableHash: hashOf(opsSchema),
      },
      {
        ...base('docs', 'concat_tool', DOCS_SRC),
        schemaComplete: true,
        descriptionComplete: true,
        offered: true,
        inputSchemaSha256: hashOf(CONCAT_FULL),
        // the table's evaluator stops the value at the `+` and reads `'text'` as a key of its own
        tableHash: 'unresolved:identifier:text',
      },
      {
        ...base('docs', 'enum_tool', DOCS_SRC),
        schemaComplete: true,
        descriptionComplete: true,
        offered: true,
        inputSchemaSha256: hashOf(enumSchema),
        tableHash: hashOf(enumSchema),
      },
      {
        ...base('docs', 'guide_tool', DOCS_SRC),
        schemaComplete: true,
        descriptionComplete: false,
        offered: true,
        reason: 'description:identifier:buildGuide',
        inputSchemaSha256: hashOf(emptySchema),
        tableHash: hashOf(emptySchema),
      },
      {
        ...base('docs', 'literal_tool', DOCS_SRC),
        schemaComplete: true,
        descriptionComplete: true,
        offered: true,
        inputSchemaSha256: hashOf(LITERAL_SCHEMA),
        tableHash: hashOf(LITERAL_SCHEMA),
      },
      {
        // `'x' || 'y'` is an operator the evaluator does not fold: no description at all, so not offered
        ...base('docs', 'operator_tool', DOCS_SRC),
        schemaComplete: true,
        descriptionComplete: false,
        offered: false,
        reason: 'description:operator:||',
        description: null,
        inputSchema: nSchema,
        inputSchemaSha256: hashOf(nSchema),
        tableHash: hashOf(nSchema),
      },
      {
        ...base('docs', 'schemaless', DOCS_SRC),
        schemaComplete: false,
        descriptionComplete: true,
        offered: false,
        reason: 'missing',
        description: 'a tool with no inputSchema',
        inputSchemaSha256: null,
        tableHash: 'unresolved:missing',
      },
      {
        ...base('docs', 'unresolvable', DOCS_SRC),
        schemaComplete: false,
        descriptionComplete: true,
        offered: false,
        reason: 'identifier:buildSchema',
        description: 'built by a call',
        inputSchemaSha256: null,
        tableHash: 'unresolved:identifier:buildSchema',
      },
      {
        ...base('sheets', 'sheet_tool', 'apps/sheets/src/renderer/ai/tools.ts'),
        schemaComplete: true,
        descriptionComplete: true,
        offered: true,
        inputSchemaSha256: hashOf(rangeSchema),
        tableHash: hashOf(rangeSchema),
      },
    ])
  })

  it('lists a table row whose object the default evaluator misread, instead of trusting its name', () => {
    // a `+` right before the `}` of a nested object: the default evaluator reads the string as a shorthand key and
    // swallows the closing brace, so the object runs on into the next tool and its `name` is overwritten
    const { dir, sha } = fixture({
      'apps/docs/src/renderer/ai/tools.ts': [
        "import type { AgentToolDef } from '@genoffice/agent-core'",
        '',
        'export const AGENT_TOOLS: AgentToolDef[] = [',
        '  {',
        "    name: 'swallowed',",
        "    description: 'first',",
        '    inputSchema: {',
        "      type: 'object',",
        "      properties: { q: { type: 'string', description: 'long ' + 'text' } },",
        '    },',
        '  },',
        '  {',
        "    name: 'next_tool',",
        "    description: 'second',",
        "    inputSchema: { type: 'object', properties: {} },",
        '  },',
        ']',
        '',
      ].join('\n'),
    })
    const file = build(dir, sha)
    const flagged = file.catalogue.filter((e) => !e.schemaComplete)
    assert.ok(flagged.length > 0, 'the misread row is listed as incomplete')
    for (const entry of flagged) assert.match(entry.reason, /^name:/)
    // and it is never offered under a name it does not carry
    assert.ok(!file.docs.some((t) => t.function.name === 'swallowed'))
  })

  it('is deterministic: two runs write byte-identical files', () => {
    const { dir, sha } = fixture(EMIT_FIXTURE)
    const a = JSON.stringify(build(dir, sha))
    const b = JSON.stringify(build(dir, sha))
    assert.equal(a, b)
  })

  it('lists one catalogue entry per mechanical table row, module by module', () => {
    const { dir, sha } = fixture(FIXTURE)
    const result = extract({ repo: dir, rev: sha })
    const file = build(dir, sha)
    const perModule = new Map()
    for (const row of result.rows) perModule.set(row.module, (perModule.get(row.module) ?? 0) + 1)
    const fromCatalogue = new Map()
    for (const entry of file.catalogue)
      fromCatalogue.set(entry.module, (fromCatalogue.get(entry.module) ?? 0) + 1)
    assert.deepEqual(fromCatalogue, perModule)
    assert.equal(file.catalogue.length, result.rows.length)
    // a complete schema is offered, an incomplete one is only listed
    const names = (module) => file[module].map((t) => t.function.name)
    assert.ok(names('docs').includes('literal_tool'))
    assert.ok(!names('docs').includes('unresolvable'))
    assert.ok(file.catalogue.some((e) => e.name === 'unresolvable' && e.schemaComplete === false))
  })

  it('CLI --emit-schemas writes the file and leaves the default markdown untouched', () => {
    const { dir, sha } = fixture(EMIT_FIXTURE)
    const out = join(dir, '..', `emit-${sha.slice(0, 8)}.json`)
    roots.push(out)
    const plain = execFileSync(process.execPath, [SCRIPT, '--repo', dir, '--rev', sha], {
      encoding: 'utf8',
    })
    assert.equal(plain, extract({ repo: dir, rev: sha }).text)
    const withFlag = execFileSync(
      process.execPath,
      [SCRIPT, '--repo', dir, '--rev', sha, '--emit-schemas', out],
      { encoding: 'utf8' },
    )
    assert.equal(withFlag, '')
    const written = readFileSync(out, 'utf8')
    assert.ok(written.endsWith('}\n'))
    assert.deepEqual(JSON.parse(written), build(dir, sha))
  })
})

// ────────────── parameterised recursive arrow (G6-09d, card REPIN-1) ──────────────
//
// apps/{docs,markdown}/src/renderer/ai/mind-map.ts builds its tree schema by
// calling a local arrow `nodeSchema(depth)`: one numeric parameter, an
// object-literal body, a `depth > 0` base case and a self-call one step down,
// with the depth argument read from a same-file `LIMITS` const object. The
// extractor has to fold exactly that shape into the schema the running code
// builds; everything else stays `unresolved:...`.

const AGENT_TOOL_DEF_FIXTURE = [
  'export interface AgentToolDef {',
  '  name: string',
  '  description: string',
  '  inputSchema: Record<string, unknown>',
  '}',
  '',
].join('\n')

/** the mind-map module, parameterised by its `LIMITS.maxDepth` */
const recursiveMindMap = (maxDepth) =>
  [
    "import type { AgentToolDef } from '@genoffice/agent-core'",
    '',
    'export const LIMITS = {',
    `  maxDepth: ${maxDepth},`,
    '} as const',
    '',
    'const nodeSchema = (depth: number): Record<string, unknown> => ({',
    "  type: 'object',",
    '  properties: {',
    "    label: { type: 'string' },",
    '    children:',
    '      depth > 0',
    '        ? {',
    "            type: 'array',",
    "            description: 'sub-topics',",
    '            items: nodeSchema(depth - 1),',
    '          }',
    '        : {',
    "            type: 'array',",
    "            description: 'sub-topics',",
    '            items: {',
    "              type: 'object',",
    "              properties: { label: { type: 'string' } },",
    "              required: ['label'],",
    '            },',
    '          },',
    '  },',
    "  required: ['label'],",
    '})',
    '',
    'export const MIND_MAP_TOOL: AgentToolDef = {',
    "  name: 'generate_mindmap',",
    `  description: 'draws the ${maxDepth === 2 ? 'docs' : 'markdown'} tree',`,
    '  inputSchema: {',
    "    type: 'object',",
    '    properties: {',
    "      focus: { type: 'string' },",
    "      root: { type: 'object', description: 'the tree', ...nodeSchema(LIMITS.maxDepth) },",
    '    },',
    "    required: ['root'],",
    '  },',
    '}',
    '',
  ].join('\n')

const RECURSIVE_FN_FIXTURE = {
  'packages/agent-core/src/types.ts': AGENT_TOOL_DEF_FIXTURE,
  'apps/docs/src/renderer/ai/mind-map.ts': recursiveMindMap(2),
  'apps/markdown/src/renderer/ai/mind-map.ts': recursiveMindMap(1),
}

/** hand-expanded `nodeSchema(2)`: the root plus two nested `children` levels */
const RECURSIVE_DOCS_PARAMS = {
  type: 'object',
  properties: {
    focus: { type: 'string' },
    root: {
      type: 'object',
      description: 'the tree',
      properties: {
        label: { type: 'string' },
        children: {
          type: 'array',
          description: 'sub-topics',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              children: {
                type: 'array',
                description: 'sub-topics',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    children: {
                      type: 'array',
                      description: 'sub-topics',
                      items: {
                        type: 'object',
                        properties: { label: { type: 'string' } },
                        required: ['label'],
                      },
                    },
                  },
                  required: ['label'],
                },
              },
            },
            required: ['label'],
          },
        },
      },
      required: ['label'],
    },
  },
  required: ['root'],
}

/** hand-expanded `nodeSchema(1)`: the root plus one nested level, leaf `items` at the bottom */
const RECURSIVE_MARKDOWN_PARAMS = {
  type: 'object',
  properties: {
    focus: { type: 'string' },
    root: {
      type: 'object',
      description: 'the tree',
      properties: {
        label: { type: 'string' },
        children: {
          type: 'array',
          description: 'sub-topics',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              children: {
                type: 'array',
                description: 'sub-topics',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' } },
                  required: ['label'],
                },
              },
            },
            required: ['label'],
          },
        },
      },
      required: ['label'],
    },
  },
  required: ['root'],
}

const RECURSIVE_FN_REFUSED_FIXTURE = {
  'packages/agent-core/src/types.ts': AGENT_TOOL_DEF_FIXTURE,
  'apps/docs/src/renderer/ai/tools.ts': [
    "import type { AgentToolDef } from '@genoffice/agent-core'",
    '',
    'const twoParams = (a: number, b: number) => ({',
    "  type: 'object',",
    '})',
    'const blockBody = (n: number) => {',
    "  return { type: 'object' }",
    '}',
    'const growing = (n: number) => ({',
    "  type: 'object',",
    "  properties: { x: { type: 'array', items: growing(n + 1) } },",
    '})',
    'const flat = (n: number) => ({',
    "  type: 'object',",
    "  properties: { y: { type: 'string' } },",
    '})',
    '',
    'export const TOOLS: AgentToolDef[] = [',
    "  { name: 'two_params', description: 'x', inputSchema: twoParams(1, 2) },",
    "  { name: 'block_body', description: 'x', inputSchema: blockBody(1) },",
    "  { name: 'growing', description: 'x', inputSchema: growing(0) },",
    "  { name: 'no_args', description: 'x', inputSchema: flat() },",
    "  { name: 'string_arg', description: 'x', inputSchema: flat('a') },",
    "  { name: 'free_arg', description: 'x', inputSchema: flat(unknownDepth) },",
    "  { name: 'huge_arg', description: 'x', inputSchema: flat(99) },",
    ']',
    '',
  ].join('\n'),
}

describe('parameterised recursive arrow (G6-09d)', () => {
  const build = (repo, rev) => extractor.buildSchemaFile(extract({ repo, rev }))

  it('folds a self-recursive local arrow into the table hash', () => {
    const { dir } = fixture(RECURSIVE_FN_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const hash = (module) =>
      rows.find((r) => r.module === module && r.tool === 'generate_mindmap').hash
    assert.equal(hash('docs'), hashOf(RECURSIVE_DOCS_PARAMS))
    assert.equal(hash('markdown'), hashOf(RECURSIVE_MARKDOWN_PARAMS))
    // the same body, two files: only the same-file `LIMITS.maxDepth` const differs
    assert.notEqual(hash('docs'), hash('markdown'))
  })

  it('offers the folded schema in the emitted file, complete', () => {
    const { dir, sha } = fixture(RECURSIVE_FN_FIXTURE)
    const file = build(dir, sha)
    const params = { docs: RECURSIVE_DOCS_PARAMS, markdown: RECURSIVE_MARKDOWN_PARAMS }
    for (const module of ['docs', 'markdown']) {
      const tool = file[module].find((t) => t.function.name === 'generate_mindmap')
      assert.deepEqual(tool.function.parameters, params[module])
      const entry = file.catalogue.find((e) => e.module === module && e.name === 'generate_mindmap')
      assert.equal(entry.schemaComplete, true)
      assert.equal(entry.offered, true)
      assert.equal(entry.inputSchemaSha256, hashOf(params[module]))
      // the table's own cell resolved too: no `unresolved:` left on this row
      assert.equal(entry.tableHash, hashOf(params[module]))
    }
  })

  it('refuses a call outside the bounded arrow shape', () => {
    const { dir } = fixture(RECURSIVE_FN_REFUSED_FIXTURE)
    const { rows } = extract({ repo: dir, rev: 'HEAD' })
    const hash = (tool) => rows.find((r) => r.tool === tool).hash
    // a self-call that never comes down runs into the depth guard
    assert.equal(hash('growing'), 'unresolved:recursion')
    // the argument must be one resolved integer inside the bound
    for (const tool of ['no_args', 'string_arg', 'free_arg', 'huge_arg'])
      assert.equal(hash(tool), 'unresolved:call:flat')
    // two parameters / a block body are not the folded shape
    for (const tool of ['two_params', 'block_body'])
      assert.match(hash(tool), /^unresolved:identifier:/)
  })

  it('does not silently truncate an arrow call argument when tokens remain before ) (RBD9-1)', () => {
    const flatSchema = (n) => ({
      type: 'object',
      properties: { v: { type: 'number', description: `n=${n}` } },
    })
    const { dir, sha } = fixture({
      'packages/agent-core/src/types.ts': AGENT_TOOL_DEF_FIXTURE,
      'apps/docs/src/renderer/ai/tools.ts': [
        "import type { AgentToolDef } from '@genoffice/agent-core'",
        '',
        'const flat = (n: number) => ({',
        "  type: 'object',",
        "  properties: { v: { type: 'number', description: `n=${n}` } },",
        '})',
        'const chainOuter = (d: number) => ({',
        "  type: 'object',",
        '  properties: { inner: flat(d - 1 + 1) },',
        '})',
        'const badBranch = (depth: number) => ({',
        "  type: 'object',",
        '  properties: { count: depth > 0 ? depth * 2 : 0 },',
        '})',
        '',
        'export const TOOLS: AgentToolDef[] = [',
        "  { name: 'sub_arg', description: 'x', inputSchema: { type: 'object', ...flat(4 - 1) } },",
        "  { name: 'mul_arg', description: 'x', inputSchema: { type: 'object', ...flat(4 * 2) } },",
        "  { name: 'chain_arg', description: 'x', inputSchema: chainOuter(5) },",
        "  { name: 'bad_branch', description: 'x', inputSchema: badBranch(2) },",
        ']',
        '',
      ].join('\n'),
    })
    const res = extract({ repo: dir, rev: sha })
    const file = build(dir, sha)
    const rowHash = (name) => res.rows.find((r) => r.tool === name).hash
    const offeredTool = (name) => file.docs.find((t) => t.function.name === name)

    // flat(4 - 1) must never fold as n=4; it is either n=3 or unresolved
    assert.notEqual(rowHash('sub_arg'), hashOf(flatSchema(4)))
    assert.ok(
      rowHash('sub_arg') === hashOf(flatSchema(3)) || /^unresolved:/.test(rowHash('sub_arg')),
      `unexpected sub_arg hash: ${rowHash('sub_arg')}`,
    )
    if (offeredTool('sub_arg')) {
      assert.deepEqual(offeredTool('sub_arg').function.parameters, flatSchema(3))
    }

    // flat(4 * 2) has an unsupported operator before `)` and must be refused, never n=4
    assert.equal(rowHash('mul_arg'), 'unresolved:call:flat')
    assert.equal(offeredTool('mul_arg'), undefined)

    // chainOuter(5) passes `d - 1 + 1` (= 5) inside an arrow body; never truncated to n=4
    assert.equal(
      rowHash('chain_arg'),
      hashOf({ type: 'object', properties: { inner: flatSchema(5) } }),
    )

    // unsupported `*` inside a taken ternary branch must not truncate to `depth`
    assert.match(rowHash('bad_branch'), /^unresolved:operator/)
    assert.equal(offeredTool('bad_branch'), undefined)
  })

  it('does not treat a data object with __arrowFn: true as an arrow descriptor or crash on call (RBD9-2)', () => {
    const { dir, sha } = fixture({
      'packages/agent-core/src/types.ts': AGENT_TOOL_DEF_FIXTURE,
      'apps/docs/src/renderer/ai/tools.ts': [
        "import type { AgentToolDef } from '@genoffice/agent-core'",
        '',
        'export const TOOLS: AgentToolDef[] = [',
        "  { name: 'called_sentinel', description: 'x', inputSchema: ({ __arrowFn: true })(5) },",
        "  { name: 'value_sentinel', description: 'x', inputSchema: { type: 'object', __arrowFn: true } },",
        ']',
        '',
      ].join('\n'),
    })
    const res = extract({ repo: dir, rev: sha })
    const file = build(dir, sha)
    const rowHash = (name) => res.rows.find((r) => r.tool === name).hash
    const entry = (name) => file.catalogue.find((e) => e.module === 'docs' && e.name === name)

    assert.equal(rowHash('called_sentinel'), 'unresolved:call:unknown')
    assert.equal(entry('called_sentinel').schemaComplete, false)
    assert.equal(entry('called_sentinel').offered, false)

    assert.equal(rowHash('value_sentinel'), hashOf({ type: 'object', __arrowFn: true }))
    assert.equal(entry('value_sentinel').schemaComplete, true)
    assert.equal(entry('value_sentinel').offered, true)
  })

  it('bounds total arrow applications on exponential fan-out like tree(18) (RBD9-3)', () => {
    const { dir, sha } = fixture({
      'packages/agent-core/src/types.ts': AGENT_TOOL_DEF_FIXTURE,
      'apps/docs/src/renderer/ai/tools.ts': [
        "import type { AgentToolDef } from '@genoffice/agent-core'",
        '',
        'const tree = (n: number) => ({',
        "  type: 'object',",
        '  properties: {',
        '    a: n > 0 ? tree(n - 1) : 0,',
        '    b: n > 0 ? tree(n - 1) : 0,',
        '  },',
        '})',
        '',
        'export const TOOLS: AgentToolDef[] = [',
        "  { name: 'fan_out', description: 'x', inputSchema: tree(18) },",
        ']',
        '',
      ].join('\n'),
    })
    const started = Date.now()
    const res = extract({ repo: dir, rev: sha })
    const file = build(dir, sha)
    const elapsed = Date.now() - started
    const row = res.rows.find((r) => r.tool === 'fan_out')
    const entry = file.catalogue.find((e) => e.module === 'docs' && e.name === 'fan_out')

    assert.equal(row.hash, 'unresolved:recursion')
    assert.equal(entry.schemaComplete, false)
    assert.equal(entry.offered, false)
    assert.equal(entry.reason, 'recursion')
    assert.ok(elapsed < 2000, `expected tree(18) extraction under 2000ms, took ${elapsed}ms`)
  })

  it('folds only const arrow declarations and refuses let/var arrows including reassigned let pick (RBD9-4)', () => {
    const { dir, sha } = fixture({
      'packages/agent-core/src/types.ts': AGENT_TOOL_DEF_FIXTURE,
      'apps/docs/src/renderer/ai/tools.ts': [
        "import type { AgentToolDef } from '@genoffice/agent-core'",
        '',
        'let pick = (n: number) => ({',
        "  type: 'object',",
        "  properties: { first: { type: 'number', description: `n=${n}` } },",
        '})',
        'pick = (n: number) => ({',
        "  type: 'object',",
        "  properties: { second: { type: 'number', description: `n=${n}` } },",
        '})',
        'var legacy = (n: number) => ({',
        "  type: 'object',",
        "  properties: { third: { type: 'number', description: `n=${n}` } },",
        '})',
        '',
        'export const TOOLS: AgentToolDef[] = [',
        "  { name: 'reassigned_let', description: 'x', inputSchema: pick(2) },",
        "  { name: 'var_arrow', description: 'x', inputSchema: legacy(2) },",
        ']',
        '',
      ].join('\n'),
    })
    const res = extract({ repo: dir, rev: sha })
    const file = build(dir, sha)
    for (const name of ['reassigned_let', 'var_arrow']) {
      const row = res.rows.find((r) => r.tool === name)
      const entry = file.catalogue.find((e) => e.module === 'docs' && e.name === name)
      assert.match(row.hash, /^unresolved:/)
      assert.equal(entry.schemaComplete, false)
      assert.equal(entry.offered, false)
    }
  })

  it('evaluates arrow call arguments pass-independently so tableHash matches inputSchemaSha256 (RBD9-5)', () => {
    const flatSchema = (n) => ({
      type: 'object',
      properties: { v: { type: 'number', description: `n=${n}` } },
    })
    const { dir, sha } = fixture({
      'packages/agent-core/src/types.ts': AGENT_TOOL_DEF_FIXTURE,
      'apps/docs/src/renderer/ai/tools.ts': [
        "import type { AgentToolDef } from '@genoffice/agent-core'",
        '',
        'const flat = (n: number) => ({',
        "  type: 'object',",
        "  properties: { v: { type: 'number', description: `n=${n}` } },",
        '})',
        '',
        'export const TOOLS: AgentToolDef[] = [',
        "  { name: 'plus_arg', description: 'x', inputSchema: { type: 'object', ...flat(2 + 1) } },",
        "  { name: 'minus_arg', description: 'x', inputSchema: { type: 'object', ...flat(4 - 1) } },",
        ']',
        '',
      ].join('\n'),
    })
    const res = extract({ repo: dir, rev: sha })
    const file = build(dir, sha)
    const expectedHash = hashOf(flatSchema(3))
    for (const name of ['plus_arg', 'minus_arg']) {
      const row = res.rows.find((r) => r.tool === name)
      const entry = file.catalogue.find((e) => e.module === 'docs' && e.name === name)
      const tool = file.docs.find((t) => t.function.name === name)
      assert.equal(entry.tableHash, entry.inputSchemaSha256)
      assert.equal(row.hash, expectedHash)
      assert.equal(entry.inputSchemaSha256, expectedHash)
      assert.equal(entry.schemaComplete, true)
      assert.equal(entry.offered, true)
      assert.deepEqual(tool.function.parameters, flatSchema(3))
    }
  })
})

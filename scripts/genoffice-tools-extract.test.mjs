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
})

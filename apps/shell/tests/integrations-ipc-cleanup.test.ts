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
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bundledSkillFrom,
  installSkill,
  LEDGER_KEY,
  type SkillLedger,
} from '@genoffice/cli/agent-skills'
import { registerIntegrationsIpc } from '../src/main/integrations-ipc'
import {
  INTEGRATIONS_CHANNELS,
  type LegacySweepResult,
  type SkillInstallState,
} from '../src/shared/integrations-api'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  userData: '',
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => (name === 'userData' ? h.userData : tmpdir()),
  },
  clipboard: { writeText: () => {} },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  },
  ipcMain: {
    handle: () => {},
  },
}))

vi.mock('@genoffice/cli/install', () => ({
  CLI_COMMAND: 'uniwork-office-cli',
  linkTarget: () => '/usr/local/bin/uniwork-office-cli',
  inspectCliLink: () => ({ status: 'missing' }),
}))

const SKILL_MD =
  '---\nname: genoffice\ndescription: test\nmetadata:\n  version: 2.1.0\n  cli: ">=0.4.0"\n---\n\nRun `genoffice --version`.\n'

function invoke<T>(channel: string, ...args: unknown[]): T {
  const handler = h.handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return handler(null, ...args) as T
}

const fakeIpc = {
  handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
    h.handlers.set(channel, fn)
  },
}

let dir = ''
let fakeHome = ''
let prevHome: string | undefined
let prevUserProfile: string | undefined
let prevCodexHome: string | undefined
let prevXdgConfigHome: string | undefined

beforeEach(() => {
  h.handlers.clear()
  dir = mkdtempSync(join(tmpdir(), 'genoffice-intg-real-'))
  h.userData = mkdtempSync(join(tmpdir(), 'genoffice-userdata-real-'))
  fakeHome = mkdtempSync(join(tmpdir(), 'genoffice-fakehome-real-'))
  prevHome = process.env.HOME
  prevUserProfile = process.env.USERPROFILE
  prevCodexHome = process.env.CODEX_HOME
  prevXdgConfigHome = process.env.XDG_CONFIG_HOME
  process.env.HOME = fakeHome
  process.env.USERPROFILE = fakeHome
  delete process.env.CODEX_HOME
  delete process.env.XDG_CONFIG_HOME

  writeFileSync(join(dir, 'SKILL.md'), SKILL_MD)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.4.0' }))
  registerIntegrationsIpc(fakeIpc, {
    settingsPath: () => join(dir, 'app-settings.json'),
    window: () => null,
    cliDir: dir,
    skillPath: join(dir, 'SKILL.md'),
    cliPackageJson: join(dir, 'package.json'),
    recommendedSkillsDir: join(dir, 'recommended'),
  })
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = prevUserProfile
  if (prevCodexHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = prevCodexHome
  if (prevXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = prevXdgConfigHome
  rmSync(dir, { recursive: true, force: true })
  rmSync(h.userData, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('integrations IPC legacy cleanup with real agent-skills helpers (R1-09)', () => {
  it('installs .agents, sweeps matching legacy copy, keeps user-made and edited copies, and persists ledger', () => {
    const b = bundledSkillFrom(Buffer.from(SKILL_MD))
    const initialLedger: SkillLedger = {}

    // 1. Matching old copy in ~/.codex/skills
    const codexPath = installSkill(join(fakeHome, '.codex', 'skills'), b, initialLedger)
    // 2. Hand-edited old copy in ~/.cursor/skills
    const cursorPath = installSkill(join(fakeHome, '.cursor', 'skills'), b, initialLedger)
    writeFileSync(cursorPath, 'edited by user\n')
    // 3. User-made unledgered copy in ~/.gemini/skills
    const geminiPath = join(fakeHome, '.gemini', 'skills', 'genoffice', 'SKILL.md')
    mkdirSync(join(fakeHome, '.gemini', 'skills', 'genoffice'), { recursive: true })
    writeFileSync(geminiPath, SKILL_MD)

    const settingsFile = join(dir, 'app-settings.json')
    writeFileSync(settingsFile, JSON.stringify({ [LEDGER_KEY]: initialLedger }, null, 2))

    const state = invoke<SkillInstallState>(INTEGRATIONS_CHANNELS.installSkill, {
      agentId: 'agents',
    })
    const sharedPath = join(fakeHome, '.agents', 'skills', 'genoffice', 'SKILL.md')
    expect(state).toMatchObject({
      status: 'installed',
      path: sharedPath,
      installedVersion: '2.1.0',
    })

    expect(existsSync(sharedPath)).toBe(true)
    expect(existsSync(codexPath)).toBe(false)
    expect(existsSync(cursorPath)).toBe(true)
    expect(readFileSync(cursorPath, 'utf-8')).toBe('edited by user\n')
    expect(existsSync(geminiPath)).toBe(true)

    const saved = JSON.parse(readFileSync(settingsFile, 'utf-8')) as Record<string, SkillLedger>
    const savedLedger = saved[LEDGER_KEY]!
    expect(Object.keys(savedLedger).sort()).toEqual([cursorPath, sharedPath].sort())
  })

  it('persists completed removals and reports failed/kept items on manual sweep partial failure', () => {
    const b = bundledSkillFrom(Buffer.from(SKILL_MD))
    const initialLedger: SkillLedger = {}
    const sharedPath = installSkill(join(fakeHome, '.agents', 'skills'), b, initialLedger)
    const codexPath = installSkill(join(fakeHome, '.codex', 'skills'), b, initialLedger)
    const cursorDir = join(fakeHome, '.cursor', 'skills', 'genoffice')
    const cursorPath = installSkill(join(fakeHome, '.cursor', 'skills'), b, initialLedger)
    const copilotPath = installSkill(join(fakeHome, '.copilot', 'skills'), b, initialLedger)
    writeFileSync(copilotPath, 'custom copilot skill\n')

    const settingsFile = join(dir, 'app-settings.json')
    writeFileSync(settingsFile, JSON.stringify({ [LEDGER_KEY]: initialLedger }, null, 2))

    chmodSync(cursorDir, 0o500)
    try {
      const res = invoke<LegacySweepResult>(INTEGRATIONS_CHANNELS.sweepLegacySkillCopies)
      expect(res.removed.map((c) => c.agent)).toEqual(['codex'])
      expect(res.kept).toMatchObject([{ agent: 'copilot', path: copilotPath, reason: 'edited' }])
      expect(res.failed).toMatchObject([{ agent: 'cursor', path: cursorPath, reason: 'error' }])

      expect(existsSync(codexPath)).toBe(false)
      expect(existsSync(cursorPath)).toBe(true)
      expect(existsSync(copilotPath)).toBe(true)

      const saved = JSON.parse(readFileSync(settingsFile, 'utf-8')) as Record<string, SkillLedger>
      const savedLedger = saved[LEDGER_KEY]!
      expect(Object.keys(savedLedger).sort()).toEqual([copilotPath, cursorPath, sharedPath].sort())
    } finally {
      chmodSync(cursorDir, 0o700)
    }
  })
})

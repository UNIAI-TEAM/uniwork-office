import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import type * as FsModule from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import {
  agentConfigDir,
  agentTarget,
  buildSkillZip,
  bundledSkillFrom,
  compareVersions,
  currentSkillInstalled,
  detectAgents,
  findLegacySkillCopies,
  installSkill,
  parseSkillFrontmatter,
  readInstallState,
  sweepLegacySkillCopies,
  uninstallSkill,
  type SkillLedger,
} from '../src/agent-skills'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  return {
    ...actual,
    rmdirSync: vi.fn(actual.rmdirSync),
    rmSync: vi.fn(actual.rmSync),
  }
})

const skillText = (version: string, body = 'Run `genoffice --version` first.') =>
  `---\nname: genoffice\ndescription: test\nmetadata:\n  version: ${version}\n  cli: '>=0.4.0'\n---\n\n${body}\n`

const bundled = (version = '1.2.0') => bundledSkillFrom(Buffer.from(skillText(version)))

function home(): string {
  return mkdtempSync(join(tmpdir(), 'genoffice-skills-'))
}

describe('detectAgents', () => {
  it('lists the tools whose dotfolder exists, honouring the env overrides', () => {
    const h = home()
    mkdirSync(join(h, '.claude'))
    mkdirSync(join(h, 'codex-elsewhere'))
    const found = detectAgents({ CODEX_HOME: join(h, 'codex-elsewhere') }, h)
    expect(found.map((a) => a.id)).toEqual(['claude-code', 'agents'])
    expect(found[0]!.skillsDir).toBe(join(h, '.claude', 'skills'))
    expect(found[1]!.skillsDir).toBe(join(h, '.agents', 'skills'))
    expect(found[1]!.label).toBe(
      '.agents (Codex / Cursor / Gemini CLI / Copilot / OpenCode / dsh …)',
    )
    expect(agentTarget('windsurf', {}, h)!.skillsDir).toBe(
      join(h, '.codeium', 'windsurf', 'skills'),
    )
  })

  it('sends the ~/.agents readers to the shared row, and keeps a probe for their dotfolders', () => {
    const h = home()
    mkdirSync(join(h, '.codex'))
    mkdirSync(join(h, '.cursor'))
    mkdirSync(join(h, '.gemini'))
    mkdirSync(join(h, '.copilot'))
    mkdirSync(join(h, '.config', 'opencode'), { recursive: true })
    expect(detectAgents({}, h).map((a) => a.id)).toEqual(['agents'])
    expect(agentTarget('codex', {}, h)).toBeNull()
    expect(agentTarget('cursor', {}, h)).toBeNull()
    expect(agentTarget('gemini', {}, h)).toBeNull()
    expect(agentTarget('copilot', {}, h)).toBeNull()
    expect(agentTarget('opencode', {}, h)).toBeNull()
    // `genoffice mcp` still reaches the per-tool dotfolders
    expect(agentConfigDir('codex', {}, h)).toBe(join(h, '.codex'))
    expect(agentConfigDir('cursor', {}, h)).toBe(join(h, '.cursor'))
    expect(agentConfigDir('gemini', {}, h)).toBe(join(h, '.gemini'))
    expect(agentConfigDir('copilot', {}, h)).toBe(join(h, '.copilot'))
    expect(agentConfigDir('opencode', {}, h)).toBe(join(h, '.config', 'opencode'))
  })

  it('shows the shared row for ~/.agents itself and keeps Windsurf and OpenClaw rows of their own', () => {
    const h = home()
    mkdirSync(join(h, '.agents', 'skills'), { recursive: true })
    mkdirSync(join(h, '.codeium', 'windsurf'), { recursive: true })
    mkdirSync(join(h, '.openclaw'))
    const found = detectAgents({}, h)
    expect(found.map((a) => a.id)).toEqual(['agents', 'windsurf', 'openclaw'])
    expect(found[0]!.skillsDir).toBe(join(h, '.agents', 'skills'))
    expect(found[1]!.skillsDir).toBe(join(h, '.codeium', 'windsurf', 'skills'))
    expect(found[2]!.skillsDir).toBe(join(h, '.openclaw', 'skills'))
  })

  it('keeps dsh a reader of the shared row', () => {
    const h = home()
    mkdirSync(join(h, '.dsh'))
    expect(detectAgents({}, h).map((a) => a.id)).toEqual(['agents'])
  })
})

describe('parseSkillFrontmatter / compareVersions', () => {
  it('reads name and metadata.version', () => {
    expect(parseSkillFrontmatter(skillText('2.1.0'))).toEqual({
      name: 'genoffice',
      version: '2.1.0',
    })
    expect(parseSkillFrontmatter('---\nname: other\n---\nx')).toEqual({
      name: 'other',
      version: '',
    })
    expect(parseSkillFrontmatter('no front matter')).toBeNull()
  })

  it('orders numeric semver and sorts junk lowest', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('', '0.0.1')).toBe(-1)
  })
})

describe('readInstallState', () => {
  it('walks the seven states of the design table', () => {
    const dir = join(home(), 'skills')
    const b = bundled('1.2.0')
    const ledger: SkillLedger = {}
    expect(readInstallState(dir, b, ledger).status).toBe('missing')

    // our install, current
    const path = installSkill(dir, b, ledger)
    expect(path).toBe(join(dir, 'genoffice', 'SKILL.md'))
    expect(readFileSync(path, 'utf-8')).toBe(b.text)
    expect(ledger[path]).toMatchObject({ version: '1.2.0', sha256: b.sha256, channel: 'app' })
    expect(readInstallState(dir, b, ledger)).toMatchObject({
      status: 'installed',
      installedVersion: '1.2.0',
    })

    // a newer bundle arrives
    expect(readInstallState(dir, bundled('1.3.0'), ledger)).toMatchObject({
      status: 'outdated',
      installedVersion: '1.2.0',
      older: true,
    })

    // the user edits the file
    writeFileSync(path, skillText('1.2.0', 'edited by hand'))
    expect(readInstallState(dir, b, ledger).status).toBe('modified')

    // written by someone else (no ledger entry): older → offers an update, current → nothing
    writeFileSync(path, skillText('1.1.0'))
    expect(readInstallState(dir, b, {})).toMatchObject({
      status: 'foreign',
      installedVersion: '1.1.0',
      older: true,
    })
    writeFileSync(path, skillText('1.2.0'))
    expect(readInstallState(dir, b, {})).toMatchObject({ status: 'foreign', older: false })

    // newer than the bundle, whoever wrote it
    writeFileSync(path, skillText('1.3.0'))
    expect(readInstallState(dir, b, ledger)).toMatchObject({
      status: 'newer',
      installedVersion: '1.3.0',
    })

    // the folder holds something else
    writeFileSync(path, '---\nname: other-skill\n---\n')
    expect(readInstallState(dir, b, ledger).status).toBe('occupied')
    mkdirSync(join(dir, 'genoffice', 'nested'))
    writeFileSync(path, 'not a skill at all')
    expect(readInstallState(dir, b, ledger).status).toBe('occupied')
  })
})

describe('uninstallSkill', () => {
  it('removes only what this app wrote and keeps a folder that holds other files', () => {
    const dir = join(home(), 'skills')
    const b = bundled()
    const ledger: SkillLedger = {}
    // foreign file: never touched
    mkdirSync(join(dir, 'genoffice'), { recursive: true })
    writeFileSync(join(dir, 'genoffice', 'SKILL.md'), skillText('1.0.0'))
    expect(uninstallSkill(dir, ledger)).toBe(false)
    expect(existsSync(join(dir, 'genoffice', 'SKILL.md'))).toBe(true)

    const path = installSkill(dir, b, ledger)
    writeFileSync(join(dir, 'genoffice', 'notes.txt'), 'mine')
    expect(uninstallSkill(dir, ledger)).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(join(dir, 'genoffice', 'notes.txt'))).toBe(true)
    expect(ledger[path]).toBeUndefined()

    installSkill(dir, b, ledger)
    // an empty folder goes with the file
    const dir2 = join(home(), 'skills')
    const p2 = installSkill(dir2, b, ledger)
    expect(uninstallSkill(dir2, ledger)).toBe(true)
    expect(existsSync(join(dir2, 'genoffice'))).toBe(false)
    expect(existsSync(p2)).toBe(false)
  })
})

describe('buildSkillZip', () => {
  it('holds genoffice/SKILL.md with the exact bundled bytes', async () => {
    const b = bundled('1.2.0')
    const zip = await JSZip.loadAsync(await buildSkillZip(b))
    expect(Object.keys(zip.files).filter((f) => !zip.files[f]!.dir)).toEqual(['genoffice/SKILL.md'])
    expect(await zip.file('genoffice/SKILL.md')!.async('string')).toBe(b.text)
  })
})

describe('the legacy per-tool skill copies', () => {
  it('are found through the ledger, not by guessing', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    // a copy this app wrote in the old layout
    installSkill(join(h, '.codex', 'skills'), b, ledger)
    // a copy in a folder the ledger does not know: not ours to touch
    mkdirSync(join(h, '.gemini', 'skills', 'genoffice'), { recursive: true })
    writeFileSync(join(h, '.gemini', 'skills', 'genoffice', 'SKILL.md'), 'hand written\n')

    const found = findLegacySkillCopies(ledger, {}, h)
    expect(found.map((c) => c.agent)).toEqual(['codex'])
    expect(found[0]).toMatchObject({
      label: 'Codex',
      skillsDir: join(h, '.codex', 'skills'),
      ours: true,
    })
  })

  it('sweep away the copies this app wrote and keep the edited ones', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    installSkill(join(h, '.agents', 'skills'), b, ledger)
    const codexPath = installSkill(join(h, '.codex', 'skills'), b, ledger)
    const cursorPath = installSkill(join(h, '.cursor', 'skills'), b, ledger)
    // someone edited this one by hand
    writeFileSync(cursorPath, 'my own version\n')

    const sweep = sweepLegacySkillCopies(ledger, {}, h)
    expect(sweep.removed.map((c) => c.agent)).toEqual(['codex'])
    expect(sweep.kept).toMatchObject([{ agent: 'cursor', reason: 'edited' }])
    expect(sweep.failed).toEqual([])
    expect(existsSync(codexPath)).toBe(false)
    expect(existsSync(join(h, '.codex', 'skills', 'genoffice'))).toBe(false)
    expect(existsSync(cursorPath)).toBe(true)
    expect(ledger[codexPath]).toBeUndefined()
    expect(ledger[cursorPath]).toBeDefined()
  })

  it('follow the env overrides the old layout used', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    const codexPath = installSkill(join(h, 'codex-elsewhere', 'skills'), b, ledger)
    const opencodePath = installSkill(join(h, 'cfg', 'opencode', 'skills'), b, ledger)

    const found = findLegacySkillCopies(
      ledger,
      { CODEX_HOME: join(h, 'codex-elsewhere'), XDG_CONFIG_HOME: join(h, 'cfg') },
      h,
    )
    expect(found.map((c) => c.path).sort()).toEqual([codexPath, opencodePath].sort())
  })

  it('never lists or deletes the shared .agents copy when CODEX_HOME points at .agents (R1-01)', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    const env = { CODEX_HOME: join(h, '.agents') }
    const sharedPath = installSkill(join(h, '.agents', 'skills'), b, ledger)
    const cursorPath = installSkill(join(h, '.cursor', 'skills'), b, ledger)

    const found = findLegacySkillCopies(ledger, env, h)
    expect(found.map((c) => c.agent)).toEqual(['cursor'])

    const sweep = sweepLegacySkillCopies(ledger, env, h)
    expect(sweep.removed.map((c) => c.agent)).toEqual(['cursor'])
    expect(existsSync(sharedPath)).toBe(true)
    expect(readFileSync(sharedPath, 'utf-8')).toBe(b.text)
    expect(ledger[sharedPath]).toBeDefined()
    expect(existsSync(cursorPath)).toBe(false)
  })

  it('the shared .agents copy gates the sweep and must exist with matching bytes (R1-05)', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    const codexPath = installSkill(join(h, '.codex', 'skills'), b, ledger)
    expect(currentSkillInstalled(ledger, {}, h)).toBe(false)

    const noSharedSweep = sweepLegacySkillCopies(ledger, {}, h)
    expect(noSharedSweep.removed).toEqual([])
    expect(noSharedSweep.kept).toMatchObject([{ agent: 'codex', reason: 'no_shared_copy' }])
    expect(existsSync(codexPath)).toBe(true)

    const sharedPath = installSkill(join(h, '.agents', 'skills'), b, ledger)
    expect(currentSkillInstalled(ledger, {}, h)).toBe(true)

    // Replace shared file with modified content: gate closes and nothing is deleted
    writeFileSync(sharedPath, 'replaced by hand\n')
    expect(currentSkillInstalled(ledger, {}, h)).toBe(false)
    const replacedSweep = sweepLegacySkillCopies(ledger, {}, h)
    expect(replacedSweep.removed).toEqual([])
    expect(replacedSweep.kept).toMatchObject([{ agent: 'codex', reason: 'no_shared_copy' }])
    expect(existsSync(codexPath)).toBe(true)

    // Remove shared file while keeping ledger entry: gate closes and nothing is deleted
    rmSync(sharedPath, { force: true })
    expect(currentSkillInstalled(ledger, {}, h)).toBe(false)
    const missingSweep = sweepLegacySkillCopies(ledger, {}, h)
    expect(missingSweep.removed).toEqual([])
    expect(missingSweep.kept).toMatchObject([{ agent: 'codex', reason: 'no_shared_copy' }])
    expect(existsSync(codexPath)).toBe(true)
  })

  it('leaves a user-made genoffice folder with no ledger entry untouched during sweep', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    installSkill(join(h, '.agents', 'skills'), b, ledger)
    installSkill(join(h, '.codex', 'skills'), b, ledger)
    const userMade = join(h, '.gemini', 'skills', 'genoffice', 'SKILL.md')
    mkdirSync(join(h, '.gemini', 'skills', 'genoffice'), { recursive: true })
    writeFileSync(userMade, b.text)

    const sweep = sweepLegacySkillCopies(ledger, {}, h)
    expect(sweep.removed.map((c) => c.agent)).toEqual(['codex'])
    expect(existsSync(userMade)).toBe(true)
  })

  it('rejects symlinks at .config, tool dotfolder, skills, genoffice, or SKILL.md (R1-02)', () => {
    const h = home()
    const outside = mkdtempSync(join(tmpdir(), 'genoffice-outside-'))
    const ledger: SkillLedger = {}
    const b = bundled()
    installSkill(join(h, '.agents', 'skills'), b, ledger)

    // 1. Symlinked genoffice dir (.codex/skills/genoffice -> outside/genoffice)
    const outsideGenoffice = join(outside, 'genoffice-dir')
    mkdirSync(outsideGenoffice, { recursive: true })
    const outsideGenofficeFile = join(outsideGenoffice, 'SKILL.md')
    writeFileSync(outsideGenofficeFile, b.bytes)
    const codexSkillsDir = join(h, '.codex', 'skills')
    const codexPath = installSkill(codexSkillsDir, b, ledger)
    rmSync(join(codexSkillsDir, 'genoffice'), { recursive: true, force: true })
    symlinkSync(outsideGenoffice, join(codexSkillsDir, 'genoffice'), 'dir')

    // 2. Symlinked SKILL.md file (.cursor/skills/genoffice/SKILL.md -> outside/SKILL.md)
    const outsideFile = join(outside, 'cursor-SKILL.md')
    writeFileSync(outsideFile, b.bytes)
    const cursorSkillsDir = join(h, '.cursor', 'skills')
    const cursorPath = installSkill(cursorSkillsDir, b, ledger)
    rmSync(cursorPath, { force: true })
    symlinkSync(outsideFile, cursorPath, 'file')

    // 3. Symlinked tool dotfolder (.gemini -> outside/gemini-dot)
    const outsideGemini = join(outside, 'gemini-dot')
    mkdirSync(join(outsideGemini, 'skills', 'genoffice'), { recursive: true })
    const outsideGeminiFile = join(outsideGemini, 'skills', 'genoffice', 'SKILL.md')
    writeFileSync(outsideGeminiFile, b.bytes)
    const geminiPath = installSkill(join(h, '.gemini', 'skills'), b, ledger)
    rmSync(join(h, '.gemini'), { recursive: true, force: true })
    symlinkSync(outsideGemini, join(h, '.gemini'), 'dir')

    // 4. Symlinked skills folder (.copilot/skills -> outside/copilot-skills)
    const outsideCopilotSkills = join(outside, 'copilot-skills')
    mkdirSync(join(outsideCopilotSkills, 'genoffice'), { recursive: true })
    const outsideCopilotFile = join(outsideCopilotSkills, 'genoffice', 'SKILL.md')
    writeFileSync(outsideCopilotFile, b.bytes)
    const copilotPath = installSkill(join(h, '.copilot', 'skills'), b, ledger)
    rmSync(join(h, '.copilot', 'skills'), { recursive: true, force: true })
    symlinkSync(outsideCopilotSkills, join(h, '.copilot', 'skills'), 'dir')

    // 5. Symlinked .config (.config -> outside/config-root)
    const outsideConfig = join(outside, 'config-root')
    mkdirSync(join(outsideConfig, 'opencode', 'skills', 'genoffice'), { recursive: true })
    const outsideOpencodeFile = join(outsideConfig, 'opencode', 'skills', 'genoffice', 'SKILL.md')
    writeFileSync(outsideOpencodeFile, b.bytes)
    const opencodePath = installSkill(join(h, '.config', 'opencode', 'skills'), b, ledger)
    rmSync(join(h, '.config'), { recursive: true, force: true })
    symlinkSync(outsideConfig, join(h, '.config'), 'dir')

    const sweep = sweepLegacySkillCopies(ledger, {}, h)
    expect(sweep.removed).toEqual([])
    expect(sweep.kept.map((c) => ({ agent: c.agent, reason: c.reason }))).toEqual([
      { agent: 'codex', reason: 'unsafe_link' },
      { agent: 'cursor', reason: 'unsafe_link' },
      { agent: 'gemini', reason: 'unsafe_link' },
      { agent: 'copilot', reason: 'unsafe_link' },
      { agent: 'opencode', reason: 'unsafe_link' },
    ])
    for (const f of [
      outsideGenofficeFile,
      outsideFile,
      outsideGeminiFile,
      outsideCopilotFile,
      outsideOpencodeFile,
    ]) {
      expect(existsSync(f)).toBe(true)
      expect(readFileSync(f, 'utf-8')).toBe(b.text)
    }
    for (const p of [codexPath, cursorPath, geminiPath, copilotPath, opencodePath]) {
      expect(ledger[p]).toBeDefined()
    }
  })

  it('re-reads and re-hashes SKILL.md immediately before unlink and keeps a copy edited after discovery (R1-03)', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    installSkill(join(h, '.agents', 'skills'), b, ledger)
    const codexPath = installSkill(join(h, '.codex', 'skills'), b, ledger)

    const sweep = sweepLegacySkillCopies(ledger, {}, h, {
      beforeUnlink: (copy) => {
        if (copy.agent === 'codex') {
          writeFileSync(copy.path, 'edited after discovery\n')
        }
      },
    })
    expect(sweep.removed).toEqual([])
    expect(sweep.kept).toMatchObject([{ agent: 'codex', reason: 'edited' }])
    expect(existsSync(codexPath)).toBe(true)
    expect(readFileSync(codexPath, 'utf-8')).toBe('edited after discovery\n')
    expect(ledger[codexPath]).toBeDefined()
  })

  it('uses non-recursive rmdirSync so a file appearing in genoffice/ at directory removal is never deleted (R1-04, R2-02)', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    installSkill(join(h, '.agents', 'skills'), b, ledger)
    const codexDir = join(h, '.codex', 'skills', 'genoffice')
    const codexPath = installSkill(join(h, '.codex', 'skills'), b, ledger)
    const extraFile = join(codexDir, 'user-note.txt')

    const realRmdirSync = vi.mocked(rmdirSync).getMockImplementation()!
    const realRmSync = vi.mocked(rmSync).getMockImplementation()!
    vi.mocked(rmdirSync).mockImplementation((target, ...rest) => {
      if (String(target) === codexDir) {
        writeFileSync(extraFile, 'do not delete me\n')
      }
      return realRmdirSync(target, ...rest)
    })
    vi.mocked(rmSync).mockImplementation((target, options) => {
      if (String(target) === codexDir) {
        writeFileSync(extraFile, 'do not delete me\n')
      }
      return realRmSync(target, options)
    })

    try {
      const sweep = sweepLegacySkillCopies(ledger, {}, h)
      expect(sweep.removed.map((c) => c.agent)).toEqual(['codex'])
      expect(existsSync(codexPath)).toBe(false)
      expect(existsSync(extraFile)).toBe(true)
      expect(readFileSync(extraFile, 'utf-8')).toBe('do not delete me\n')
    } finally {
      vi.mocked(rmdirSync).mockImplementation(realRmdirSync)
      vi.mocked(rmSync).mockImplementation(realRmSync)
    }
  })

  it('isolates per-candidate unlink failures so completed removals persist and failed ones are reported (R1-06)', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    installSkill(join(h, '.agents', 'skills'), b, ledger)
    const codexPath = installSkill(join(h, '.codex', 'skills'), b, ledger)
    const cursorDir = join(h, '.cursor', 'skills', 'genoffice')
    const cursorPath = installSkill(join(h, '.cursor', 'skills'), b, ledger)

    chmodSync(cursorDir, 0o500)
    try {
      const sweep = sweepLegacySkillCopies(ledger, {}, h)
      expect(sweep.removed.map((c) => c.agent)).toEqual(['codex'])
      expect(sweep.kept).toEqual([])
      expect(sweep.failed).toMatchObject([{ agent: 'cursor', path: cursorPath, reason: 'error' }])
      expect(existsSync(codexPath)).toBe(false)
      expect(ledger[codexPath]).toBeUndefined()
      expect(existsSync(cursorPath)).toBe(true)
      expect(ledger[cursorPath]).toBeDefined()
    } finally {
      chmodSync(cursorDir, 0o700)
    }
  })

  it('prunes absent ledger entries without listing them and keeps unreadable entries with reason error (R1-07)', () => {
    const h = home()
    const ledger: SkillLedger = {}
    const b = bundled()
    const codexPath = installSkill(join(h, '.codex', 'skills'), b, ledger)
    const cursorDir = join(h, '.cursor', 'skills', 'genoffice')
    const cursorPath = installSkill(join(h, '.cursor', 'skills'), b, ledger)
    rmSync(join(h, '.codex'), { recursive: true, force: true })
    chmodSync(cursorDir, 0o000)

    try {
      const found = findLegacySkillCopies(ledger, {}, h)
      expect(found).toMatchObject([
        { agent: 'cursor', path: cursorPath, ours: false, reason: 'error' },
      ])
      expect(ledger[codexPath]).toBeUndefined()
      expect(ledger[cursorPath]).toBeDefined()
    } finally {
      chmodSync(cursorDir, 0o700)
    }
  })
})

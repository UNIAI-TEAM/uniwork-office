/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type {
  IntegrationsApi,
  IntegrationsStatus,
  LegacySweepResult,
} from '../src/shared/integrations-api'
import { mcpClaudeCommand, mcpConfigJson, mcpLaunch } from '../src/renderer/src/IntegrationsPane'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal, type SettingsModalProps } from '../src/renderer/src/SettingsModal'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
    getAiPanelPrefs: async () => ({ fontSize: 'default', spellcheck: true }),
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
  } as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLButtonElement).click()
    await Promise.resolve()
  })
  await flush()
}

function buttonWithText(text: string, scope: ParentNode = host): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
}

function baseStatus(): IntegrationsStatus {
  return {
    cli: {
      status: 'missing',
      command: 'uniwork-office-cli',
      location: '/usr/local/bin/uniwork-office-cli',
      manual:
        'sudo ln -sf /Applications/GenOffice.app/Contents/Resources/cli/genoffice /usr/local/bin/uniwork-office-cli',
      launcherDir: '/Applications/GenOffice.app/Contents/Resources/cli',
      ephemeral: false,
      version: '0.4.0',
    },
    skillVersion: '2.1.0',
    skillNeedsCli: '0.4.0',
    legacy: [],
    agents: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        skillsDir: '/home/u/.claude/skills',
        state: { status: 'missing', path: '/home/u/.claude/skills/genoffice/SKILL.md' },
      },
      {
        id: 'codex',
        label: 'Codex',
        skillsDir: '/home/u/.codex/skills',
        state: {
          status: 'outdated',
          path: '/home/u/.codex/skills/genoffice/SKILL.md',
          installedVersion: '2.0.0',
          older: true,
        },
      },
      {
        id: 'cursor',
        label: 'Cursor',
        skillsDir: '/home/u/.cursor/skills',
        state: {
          status: 'foreign',
          path: '/home/u/.cursor/skills/genoffice/SKILL.md',
          installedVersion: '2.1.0',
        },
      },
    ],
  }
}

async function openIntegrations(
  api: Partial<IntegrationsApi>,
  extra: Partial<SettingsModalProps> = {},
): Promise<void> {
  window.aiOfficeIntegrations = api as IntegrationsApi
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SettingsModal, {
          status: null,
          loggingOut: false,
          loginWaiting: false,
          loginUrl: null,
          urlCopied: false,
          onOpenLoginUrl: vi.fn(),
          onCopyLoginUrl: vi.fn(),
          onClose: vi.fn(),
          onLogin: vi.fn(),
          onLogout: vi.fn(),
          ...extra,
        }),
      ),
    )
    await Promise.resolve()
  })
  await click(buttonWithText('Integrations'))
}

describe('Settings → Integrations', () => {
  it('names the command that is ready, the package link on deb/rpm included', async () => {
    const status = baseStatus()
    status.cli = {
      ...status.cli,
      status: 'present',
      location: '/usr/bin/uniwork-office-cli',
      command: 'uniwork-office-cli',
      manual: undefined,
    }
    await openIntegrations({ status: async () => status, copyText: async () => {} })
    expect(host.textContent).toContain(
      'UniWork Office (uniwork-office-cli) 0.4.0 · ready in your terminal (/usr/bin/uniwork-office-cli)',
    )
    expect(host.textContent).not.toContain('{cmd}')
  })

  it('lists detected agents with their state and offers the matching actions', async () => {
    await openIntegrations({ status: async () => baseStatus(), copyText: async () => {} })
    const rows = [...host.querySelectorAll('.set-intg-row')]
    expect(rows.map((r) => r.getAttribute('data-agent'))).toEqual([
      'claude-code',
      'codex',
      'cursor',
    ])
    expect(rows[0]!.textContent).toContain('Skill not installed')
    expect(buttonWithText('Install', rows[0]!)).toBeTruthy()
    expect(rows[1]!.textContent).toContain('Installed 2.0.0, update to 2.1.0 available')
    expect(buttonWithText('Update', rows[1]!)).toBeTruthy()
    expect(buttonWithText('Uninstall', rows[1]!)).toBeTruthy()
    // foreign and current: shown, no button
    expect(rows[2]!.textContent).toContain('Installed 2.1.0 (not by this app)')
    expect(rows[2]!.querySelectorAll('button')).toHaveLength(0)
    // CLI block: launcher path, PATH state in plain words, the manual command as copyable code
    expect(host.textContent).toContain('/Applications/GenOffice.app/Contents/Resources/cli')
    expect(host.textContent).toContain("not on your terminal's PATH")
    expect(host.querySelector('.set-intg-cli code')?.textContent).toContain('sudo ln -sf')
    expect(host.textContent).toContain('skill 2.1.0')
    // guidance: hero steps, one-of-three note, example prompts, npx command shown inline
    expect(host.querySelectorAll('.set-intg-hero-steps li')).toHaveLength(3)
    expect(host.textContent).toContain('Pick any one of these three ways')
    // the same three prompts appear under both the CLI and the MCP part
    expect(host.querySelectorAll('.set-intg-example')).toHaveLength(6)
    expect(host.textContent).toContain('npx skills add UNIAI-TEAM/uniwork-office')
    // MCP block: the launcher itself while genoffice is not on the PATH, as a command and as JSON
    const mcp = [...host.querySelectorAll('.set-intg-mcp code')].map((c) => c.textContent)
    expect(mcp[0]).toBe(
      'claude mcp add --transport stdio genoffice -- /Applications/GenOffice.app/Contents/Resources/cli/genoffice mcp',
    )
    expect(JSON.parse(mcp[1]!)).toEqual({
      mcpServers: {
        genoffice: {
          command: '/Applications/GenOffice.app/Contents/Resources/cli/genoffice',
          args: ['mcp'],
        },
      },
    })
    expect(host.textContent).toContain('assistant picks one')
  })

  it('shows the copies the shared row replaced, removes them, keeps the outcome visible and focused, and handles kept/failure/busy states (R1-08, R1-10)', async () => {
    const codexCopy = {
      agent: 'codex' as const,
      label: 'Codex',
      skillsDir: '/home/u/.codex/skills',
      path: '/home/u/.codex/skills/genoffice/SKILL.md',
      ours: true,
    }
    const cursorCopy = {
      agent: 'cursor' as const,
      label: 'Cursor',
      skillsDir: '/home/u/.cursor/skills',
      path: '/home/u/.cursor/skills/genoffice/SKILL.md',
      ours: false,
      reason: 'unsafe_link' as const,
    }
    const status = baseStatus()
    status.legacy = [codexCopy, cursorCopy]

    let call = 0
    const pendingSweep = Promise.withResolvers<LegacySweepResult>()
    await openIntegrations({
      status: async () => status,
      copyText: async () => {},
      sweepLegacySkillCopies: () => {
        call += 1
        if (call === 1) {
          return Promise.reject(
            new Error(
              "Error invoking remote method 'integrations:sweep-legacy-skill-copies': Error: the shared .agents copy is not installed yet",
            ),
          )
        }
        if (call === 2) {
          return Promise.reject(
            new Error(
              "Error invoking remote method 'integrations:sweep-legacy-skill-copies': Error: EACCES: permission denied",
            ),
          )
        }
        if (call === 3) {
          return pendingSweep.promise
        }
        status.legacy = []
        return Promise.resolve({
          removed: [cursorCopy],
          kept: [],
          failed: [],
        })
      },
    })

    // 1. Initial render shows both legacy copies with count-safe description and LTR paths (TV-2299-03, TV-2299-06)
    const legacyRow1 = host.querySelector('.set-intg-row[data-agent="legacy"]')
    expect(legacyRow1).toBeTruthy()
    expect(legacyRow1!.textContent).toContain('Copies still in place: 2.')
    expect(legacyRow1!.textContent).toContain(codexCopy.path)
    expect(legacyRow1!.textContent).toContain(cursorCopy.path)
    const pathSpans = [...legacyRow1!.querySelectorAll('.set-intg-legacy-item [dir="ltr"]')]
    expect(pathSpans.map((el) => el.textContent)).toEqual([codexCopy.path, cursorCopy.path])

    // 2a. First attempt rejects with no shared .agents copy: shows dedicated translated line, no Electron IPC wrapper (TV-2299-01)
    const cleanBtn1 = buttonWithText('Remove old copies', legacyRow1!)!
    await click(cleanBtn1)
    const alertNotice1 = host.querySelector('.set-intg-notice[role="alert"]')
    expect(alertNotice1?.textContent).toBe(
      'Install the skill into the shared .agents folder first, then remove the old copies.',
    )
    expect(alertNotice1?.textContent).not.toContain('Error invoking remote method')
    expect(cleanBtn1.disabled).toBe(false)
    expect(host.querySelector('.set-intg-details .set-intg-notice')).toBeNull()

    // 2b. Second attempt rejects with another error: shows translated failure line without raw error or IPC wrapper (TV-2299-01)
    await click(cleanBtn1)
    const alertNotice2 = host.querySelector('.set-intg-notice[role="alert"]')
    expect(alertNotice2?.textContent).toBe('Could not remove the old copies.')
    expect(alertNotice2?.textContent).not.toContain('Error invoking remote method')
    expect(alertNotice2?.textContent).not.toContain('EACCES')
    expect(cleanBtn1.disabled).toBe(false)
    // 3. Second attempt: test busy state while pending, then resolve with mixed kept state (unsafe_link)
    await act(async () => {
      cleanBtn1.click()
      await Promise.resolve()
    })
    expect(cleanBtn1.disabled).toBe(true)
    status.legacy = [cursorCopy]
    await act(async () => {
      pendingSweep.resolve({
        removed: [codexCopy],
        kept: [{ ...cursorCopy, reason: 'unsafe_link' }],
        failed: [],
      })
      await Promise.resolve()
    })
    await flush()
    expect(cleanBtn1.disabled).toBe(false)
    const legacyRow2 = host.querySelector('.set-intg-row[data-agent="legacy"]')
    expect(legacyRow2).toBeTruthy()
    expect(legacyRow2!.textContent).not.toContain(codexCopy.path)
    expect(legacyRow2!.textContent).toContain(cursorCopy.path)
    const keptNotice = host.querySelector('.set-intg-notice[role="status"]')
    expect(keptNotice?.textContent).toBe(
      'Old copies removed: 1. Left in place: 1 (behind a symlink).',
    )
    expect(host.querySelector('.set-intg-details .set-intg-notice')).toBeNull()

    // 4. Fourth attempt removes the last copy: row disappears, notice remains visible outside row & details, and receives focus
    await click(buttonWithText('Remove old copies', legacyRow2!))
    expect(host.querySelector('.set-intg-row[data-agent="legacy"]')).toBeNull()
    const finalNotice = host.querySelector('.set-intg-notice[role="status"]') as HTMLElement | null
    expect(finalNotice).toBeTruthy()
    expect(finalNotice!.textContent).toBe(
      'Old copies removed: 1. Edited by hand and left in place: 0.',
    )
    expect(host.querySelector('.set-intg-details .set-intg-notice')).toBeNull()
    expect(document.activeElement).toBe(finalNotice)
  })

  it('surfaces a resolved partial legacy sweep failure as a single role="alert" notice with counts and recovers on retry (R2-03)', async () => {
    const codexCopy = {
      agent: 'codex' as const,
      label: 'Codex',
      skillsDir: '/home/u/.codex/skills',
      path: '/home/u/.codex/skills/genoffice/SKILL.md',
      ours: true,
    }
    const copilotCopy = {
      agent: 'copilot' as const,
      label: 'Copilot',
      skillsDir: '/home/u/.copilot/skills',
      path: '/home/u/.copilot/skills/genoffice/SKILL.md',
      ours: true,
    }
    const cursorCopy = {
      agent: 'cursor' as const,
      label: 'Cursor',
      skillsDir: '/home/u/.cursor/skills',
      path: '/home/u/.cursor/skills/genoffice/SKILL.md',
      ours: false,
      reason: 'edited' as const,
    }
    const geminiCopy = {
      agent: 'gemini' as const,
      label: 'Gemini CLI',
      skillsDir: '/home/u/.gemini/skills',
      path: '/home/u/.gemini/skills/genoffice/SKILL.md',
      ours: true,
    }
    const status = baseStatus()
    status.legacy = [codexCopy, copilotCopy, cursorCopy, geminiCopy]

    let call = 0
    await openIntegrations({
      status: async () => status,
      copyText: async () => {},
      sweepLegacySkillCopies: async () => {
        call += 1
        if (call === 1) {
          status.legacy = [{ ...geminiCopy, ours: false, reason: 'error' }]
          return {
            removed: [codexCopy, copilotCopy],
            kept: [{ ...cursorCopy, reason: 'edited' }],
            failed: [{ ...geminiCopy, ours: false, reason: 'error' }],
          }
        }
        status.legacy = []
        return {
          removed: [geminiCopy],
          kept: [],
          failed: [],
        }
      },
    })

    const initialRow = host.querySelector('.set-intg-row[data-agent="legacy"]')
    expect(initialRow).toBeTruthy()
    await click(buttonWithText('Remove old copies', initialRow!))

    expect(host.querySelectorAll('.set-intg-notice')).toHaveLength(1)
    expect(host.querySelector('.set-intg-details .set-intg-notice')).toBeNull()
    const partialAlert = host.querySelector('.set-intg-notice[role="alert"]')
    expect(partialAlert).toBeTruthy()
    expect(partialAlert!.textContent).toBe(
      'Old copies removed: 2. Left in place: 1. Failed to remove: 1.',
    )

    const rowAfterPartial = host.querySelector('.set-intg-row[data-agent="legacy"]')
    expect(rowAfterPartial).toBeTruthy()
    expect(rowAfterPartial!.textContent).not.toContain(codexCopy.path)
    expect(rowAfterPartial!.textContent).toContain(geminiCopy.path)
    const retryBtn = buttonWithText('Remove old copies', rowAfterPartial!)!
    expect(retryBtn).toBeTruthy()
    expect(retryBtn.disabled).toBe(false)

    await click(retryBtn)
    expect(host.querySelector('.set-intg-row[data-agent="legacy"]')).toBeNull()
    expect(host.querySelector('.set-intg-notice[role="alert"]')).toBeNull()
    expect(host.querySelectorAll('.set-intg-notice')).toHaveLength(1)
    expect(host.querySelector('.set-intg-details .set-intg-notice')).toBeNull()
    const finalStatus = host.querySelector('.set-intg-notice[role="status"]') as HTMLElement | null
    expect(finalStatus).toBeTruthy()
    expect(finalStatus!.textContent).toBe(
      'Old copies removed: 1. Edited by hand and left in place: 0.',
    )
    expect(document.activeElement).toBe(finalStatus)
  })

  it('names the bare command once it is on the PATH and runs the app as Node on Windows', () => {
    const launcherDir = '/Applications/GenOffice.app/Contents/Resources/cli'
    expect(mcpLaunch({ status: 'present', launcherDir })).toEqual({
      command: 'uniwork-office-cli',
      args: ['mcp'],
    })
    // the name the app reports (the same on every OS) is the command that is ready
    expect(mcpLaunch({ status: 'present', launcherDir, command: 'uniwork-office-cli' })).toEqual({
      command: 'uniwork-office-cli',
      args: ['mcp'],
    })
    const winDir = 'C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\GenOffice\\resources\\cli'
    const win = {
      command: `${winDir}\\..\\..\\UniWork Office.exe`,
      args: [`${winDir}\\genoffice.cjs`, 'mcp'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }
    expect(mcpLaunch({ status: 'missing', launcherDir: winDir })).toEqual(win)
    expect(mcpLaunch({ status: 'present', launcherDir: winDir })).toEqual(win)
    expect(mcpClaudeCommand(win)).toBe(
      `claude mcp add -e ELECTRON_RUN_AS_NODE=1 --transport stdio genoffice -- "${win.command}" "${win.args[0]}" mcp`,
    )
    expect(JSON.parse(mcpConfigJson(win))).toEqual({ mcpServers: { genoffice: win } })
    expect(
      mcpClaudeCommand({ command: '/Applications/Gen Office.app/cli/genoffice', args: ['mcp'] }),
    ).toBe(
      'claude mcp add --transport stdio genoffice -- "/Applications/Gen Office.app/cli/genoffice" mcp',
    )
  })

  it('writes only after the path was shown and confirmed, then refreshes the row', async () => {
    const status = baseStatus()
    const install = vi.fn(async (target: { agentId?: string; dir?: string }) => {
      const row = status.agents.find((a) => a.id === target.agentId)!
      row.state = { status: 'installed', path: row.state.path, installedVersion: '2.1.0' }
      return row.state
    })
    await openIntegrations({
      status: async () => status,
      installSkill: install as IntegrationsApi['installSkill'],
    })
    const row = host.querySelector('[data-agent="claude-code"]')!
    await click(buttonWithText('Install', row))
    expect(install).not.toHaveBeenCalled()
    expect(row.textContent).toContain('Will write: /home/u/.claude/skills/genoffice/SKILL.md')

    await click(buttonWithText('Cancel', row))
    expect(row.querySelector('.set-intg-confirm')).toBeNull()
    expect(install).not.toHaveBeenCalled()

    await click(buttonWithText('Install', row))
    await click(buttonWithText('Confirm', row))
    expect(install).toHaveBeenCalledWith({ agentId: 'claude-code' })
    const after = host.querySelector('[data-agent="claude-code"]')!
    expect(after.getAttribute('data-state')).toBe('installed')
    expect(after.textContent).toContain('Skill 2.1.0 installed · ready in your next chat')
    expect(buttonWithText('Uninstall', after)).toBeTruthy()
  })

  it('installs into a picked folder and saves the zip through the main process', async () => {
    const install = vi.fn(async () => ({
      status: 'installed' as const,
      path: '/x/genoffice/SKILL.md',
      installedVersion: '2.1.0',
    }))
    const saveZip = vi.fn(async () => '/Users/u/Downloads/genoffice-skill-2.1.0.zip')
    await openIntegrations({
      status: async () => baseStatus(),
      pickSkillDir: async () => '/x',
      installSkill: install,
      saveSkillZip: saveZip,
    })
    await click(buttonWithText('Install into another folder…'))
    expect(host.textContent).toContain('Will write: /x/genoffice/SKILL.md')
    await click(buttonWithText('Confirm'))
    expect(install).toHaveBeenCalledWith({ dir: '/x' })

    await click(buttonWithText('Download skill (zip)'))
    expect(saveZip).toHaveBeenCalledWith('Save skill')
    expect(host.textContent).toContain('Saved to /Users/u/Downloads/genoffice-skill-2.1.0.zip')
  })

  it('marks the Integrations entry while a detected assistant holds an older skill', async () => {
    const onDue = vi.fn()
    await openIntegrations(
      { status: async () => baseStatus() },
      { skillUpdateDue: true, onSkillUpdateDue: onDue },
    )
    expect(buttonWithText('Integrations')!.querySelector('.set-nav-dot')).toBeTruthy()
    // codex is outdated in baseStatus → the pane reports "update due" once it has probed
    expect(onDue).toHaveBeenLastCalledWith(true)

    const fresh = baseStatus()
    for (const a of fresh.agents) a.state = { status: 'missing', path: a.state.path }
    await openIntegrations(
      { status: async () => fresh },
      { skillUpdateDue: false, onSkillUpdateDue: onDue },
    )
    expect(buttonWithText('Integrations')!.querySelector('.set-nav-dot')).toBeNull()
    expect(onDue).toHaveBeenLastCalledWith(false)
  })

  it('shows the shared .agents row and confirms its absolute target path before writing', async () => {
    const status = baseStatus()
    status.agents = [
      {
        id: 'claude-code',
        label: 'Claude Code',
        skillsDir: '/home/u/.claude/skills',
        state: { status: 'missing', path: '/home/u/.claude/skills/genoffice/SKILL.md' },
      },
      {
        id: 'agents',
        label: '.agents (Codex / Cursor / Gemini CLI / Copilot / OpenCode / dsh …)',
        skillsDir: '/home/u/.agents/skills',
        state: { status: 'missing', path: '/home/u/.agents/skills/genoffice/SKILL.md' },
      },
    ]
    const install = vi.fn(async () => ({
      status: 'installed' as const,
      path: '/home/u/.agents/skills/genoffice/SKILL.md',
      installedVersion: '2.1.0',
    }))
    await openIntegrations({
      status: async () => status,
      installSkill: install,
    })
    const row = host.querySelector('[data-agent="agents"]')!
    expect(row.textContent).toContain(
      '.agents (Codex / Cursor / Gemini CLI / Copilot / OpenCode / dsh …)',
    )
    await click(buttonWithText('Install', row))
    expect(row.textContent).toContain('Will write: /home/u/.agents/skills/genoffice/SKILL.md')
    await click(buttonWithText('Confirm', row))
    expect(install).toHaveBeenCalledWith({ agentId: 'agents' })
  })
})

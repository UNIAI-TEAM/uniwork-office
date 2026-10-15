// The PDF AI panel brackets each run with the app's undo group and offers "Undo this run" on
// the answer of a run that changed the document (G6-09 W7): enabled while the run is the latest
// step, disabled with a visible reason once later edits exist, a quiet "Run undone" afterwards,
// nothing for a run that changed nothing.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { createFakeRunHistoryGroup } from '@genoffice/agent-core'
import { LocaleProvider } from '../src/renderer/i18n/locale'

interface FakeEvents {
  onRunStart?: (runId: string) => void
  onRunEnd?: (runId: string, end: { mutated: boolean; outcome: string }) => void
  onToolExecuted?: (e: { call: unknown; execution: unknown }) => void
  onDone?: (r: { text: string; cancelled: boolean; turnLimit: boolean; truncated: boolean }) => void
}

const harness = vi.hoisted(() => ({ mutate: true, runs: 0 }))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    private events: FakeEvents | undefined
    constructor(opts?: { events?: FakeEvents }) {
      this.events = opts?.events
    }
    async run(): Promise<void> {
      this.busy = true
      const runId = `run-${++harness.runs}`
      this.events?.onRunStart?.(runId)
      if (harness.mutate) {
        for (let i = 0; i < 3; i++)
          this.events?.onToolExecuted?.({
            call: { id: `c${i}`, name: 'add_text', input: {} },
            execution: { output: 'ok', mutated: true, summary: 'edit' },
          })
      }
      this.events?.onRunEnd?.(runId, { mutated: harness.mutate, outcome: 'done' })
      this.busy = false
      this.events?.onDone?.({ text: 'done', cancelled: false, turnLimit: false, truncated: false })
    }
    cancel(): void {}
    reset(): void {}
    restore(): void {}
  }
  return { ...real, AgentLoop: FakeLoop }
})

import { AiPanel } from '../src/renderer/ai/AiPanel'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

type RunState = 'ready' | 'later' | 'undone' | 'none'

describe('pdf AI panel: Undo this run', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    harness.mutate = true
    harness.runs = 0
    delete (window as any).pdfApi
  })

  async function mount(initial: RunState) {
    Element.prototype.scrollTo = () => {}
    const settings = { ...defaultAiSettings(), uniAiAvailable: false, provider: 'openai' as const }
    settings.providers.openai = { ...settings.providers.openai, apiKey: 'k', model: 'm' }
    ;(window as any).pdfApi = {
      getAiSettings: async () => settings,
      onAiSettingsChanged: () => () => {},
      setAiPanelPrefs: () => {},
      gskStatus: async () => ({ loggedIn: false }),
      onLanguageChanged: () => () => {},
    }
    const group = createFakeRunHistoryGroup()
    const state = { value: initial }
    const undoRun = vi.fn((_runId: string) => {
      state.value = 'undone'
      return true
    })
    const asked: string[] = []
    const api = new Proxy(
      {
        fileName: () => 'doc.pdf',
        readOnly: () => false,
        selection: () => null,
        runHistory: group,
        runUndoState: (runId: string) => {
          asked.push(runId)
          return state.value
        },
        undoRun,
      },
      { get: (t, p: string) => (p in t ? (t as never)[p] : () => null) },
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    let nonce = 0
    const render = (preset: string | null) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(AiPanel, {
              api: api as never,
              filePath: '/docs/a.pdf',
              onCollapse: () => {},
              open: true,
              onExpand: () => {},
              ...(preset === null ? {} : { preset: { text: preset, nonce: ++nonce } }),
            }),
          ),
        ),
      )
    render(null)
    await flush()
    await flush()
    return {
      group,
      state,
      undoRun,
      asked,
      /** the app re-renders the panel when its history moves */
      refresh: async () => {
        render(null)
        await flush()
      },
      run: async () => {
        render(`run ${nonce + 1}`)
        await flush()
        await flush()
      },
      button: () => container!.querySelector<HTMLButtonElement>('button.ai-run-undo-btn') ?? null,
      reason: () => container!.querySelector('.ai-run-undo-note')?.textContent ?? null,
    }
  }

  it('opens the app undo group when a run starts and closes it with the run outcome', async () => {
    const panel = await mount('ready')
    await panel.run()
    expect(panel.group.calls).toEqual([
      ['begin', 'run-1'],
      ['end', 'run-1', true],
    ])
    expect(panel.group.errors).toEqual([])
  })

  it('offers an enabled Undo this run on the answer of a run that changed the document', async () => {
    const panel = await mount('ready')
    await panel.run()
    const button = panel.button()!
    expect(button).not.toBeNull()
    expect(button.textContent).toBe('Undo this run')
    expect(button.getAttribute('aria-disabled')).not.toBe('true')
    expect(panel.asked).toContain('run-1')
    act(() => button.click())
    expect(panel.undoRun).toHaveBeenCalledTimes(1)
    expect(panel.undoRun).toHaveBeenCalledWith('run-1')
  })

  it('says Run undone, with no button, once the run has been taken back', async () => {
    const panel = await mount('ready')
    await panel.run()
    act(() => panel.button()!.click())
    await panel.refresh()
    expect(panel.button()).toBeNull()
    expect(container!.textContent).toContain('Run undone')
  })

  it('keeps the button reachable but disabled, with the reason in view, once later edits exist', async () => {
    const panel = await mount('later')
    await panel.run()
    const button = panel.button()!
    expect(button).not.toBeNull()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    // not the native disabled attribute: it would drop the button out of the tab order
    expect(button.disabled).toBe(false)
    expect(panel.reason()).toContain('Later changes sit on top of this run')
    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(container!.querySelector(`#${describedBy}`)?.textContent).toBe(panel.reason())
    act(() => button.click())
    expect(panel.undoRun).not.toHaveBeenCalled()
  })

  it('shows no button for a run that changed nothing', async () => {
    harness.mutate = false
    const panel = await mount('none')
    await panel.run()
    expect(panel.group.calls).toEqual([
      ['begin', 'run-1'],
      ['end', 'run-1', false],
    ])
    expect(panel.button()).toBeNull()
    expect(container!.textContent).not.toContain('Undo this run')
  })

  it('shows no button when the app no longer holds a step for the run', async () => {
    const panel = await mount('none')
    await panel.run()
    expect(panel.button()).toBeNull()
  })

  it('labels the button in Vietnamese', async () => {
    const { strings } = await import('../src/renderer/i18n/strings')
    expect(strings.vi.aiRunUndo).toBe('Hoàn tác lượt này')
    expect(strings.vi.aiRunUndoDone).toBeTruthy()
    expect(strings.vi.aiRunUndoLater).toBeTruthy()
  })
})

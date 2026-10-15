// The html AI panel brackets every loop run with the editor's undo group (G6-09 W5): onRunStart
// opens it, onRunEnd closes it with the run's mutated flag, for done, stopped and failed runs alike;
// a panel whose app gives no group (view-only, tests) still runs.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

interface FakeEvents {
  onRunStart?: (runId: string) => void
  onRunEnd?: (runId: string, end: { mutated: boolean; outcome: string }) => void
  onToolExecuted?: (e: { call: unknown; execution: unknown; snapshotBefore?: unknown }) => void
  onDone?: (r: { text: string; cancelled: boolean; turnLimit: boolean; truncated: boolean }) => void
}

const harness = vi.hoisted(() => ({ mutate: true, outcome: 'done', runs: 0 }))
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
        this.events?.onToolExecuted?.({
          call: { id: 'c', name: 'edit_html', input: {} },
          execution: { output: 'ok', mutated: true, summary: 'edit' },
          snapshotBefore: { text: 'before' },
        })
      }
      this.busy = false
      this.events?.onRunEnd?.(runId, { mutated: harness.mutate, outcome: harness.outcome })
      this.events?.onDone?.({ text: 'done', cancelled: false, turnLimit: false, truncated: false })
    }
    cancel(): void {}
    reset(): void {}
    restore(): void {}
  }
  return { ...real, AgentLoop: FakeLoop }
})

import { createFakeRunHistoryGroup } from '@genoffice/agent-core'
import { AiPanel, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('html AI panel: run hooks bracket the editor undo group', () => {
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
    harness.outcome = 'done'
    harness.runs = 0
    vi.unstubAllGlobals()
  })

  async function mount(withGroup = true) {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const save = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal(
      'htmlApi',
      new Proxy({} as Record<string, unknown>, {
        get(target, prop: string) {
          if (!(prop in target)) {
            target[prop] =
              prop === 'save'
                ? save
                : prop === 'getAiSettings'
                  ? vi.fn(async () => ({ ...usableAiSettings(), provider: 'openai' }))
                  : /^on[A-Z]/.test(prop)
                    ? vi.fn(() => () => {})
                    : vi.fn(async () => undefined)
          }
          return target[prop]
        },
      }),
    )
    const text = '<!doctype html>\n<html><body><h1>Quarterly</h1></body></html>'
    const group = createFakeRunHistoryGroup()
    const onSaveOffer = vi.fn()
    const deps = {
      access: {
        getText: () => text,
        getVersion: () => 1,
        getMap: () => buildParseMap(text, 1, null),
        getLastManualVersion: () => 0,
        getFilePath: () => null,
        getSelectedSid: () => null,
        applyOps: () => ({ ok: true, ranges: [] }),
        replaceAll: () => {},
      },
      getSnapshot: () => ({ text }),
      restoreSnapshot: () => {},
      onPrompt: () => {},
      onRunDone: () => null,
      onSaveOffer,
      clearHighlights: () => {},
      navigateTo: () => {},
      onBriefConfirmed: () => {},
      previewDraft: () => {},
      ...(withGroup ? { runHistory: group } : {}),
    } as unknown as HtmlAiDeps
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
              deps,
              filePath: null,
              editQueue: [],
              onQueueEditInstruction: () => {},
              onQueueRemove: () => {},
              onQueueClear: () => {},
              onQueueFocus: () => {},
              onQueueConsume: () => {},
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
      run: async () => {
        render(`run ${nonce + 1}`)
        await flush()
        await flush()
      },
    }
  }

  it('opens the group at the start of a run and closes it with mutated at the end', async () => {
    const panel = await mount()
    await panel.run()
    expect(panel.group.calls).toEqual([
      ['begin', 'run-1'],
      ['end', 'run-1', true],
    ])
    expect(panel.group.errors).toEqual([])
  })

  it('a run that changed nothing closes its group with mutated false', async () => {
    harness.mutate = false
    const panel = await mount()
    await panel.run()
    expect(panel.group.calls).toEqual([
      ['begin', 'run-1'],
      ['end', 'run-1', false],
    ])
  })

  it('a stopped run closes its group too, and the next run gets its own', async () => {
    const panel = await mount()
    harness.outcome = 'aborted'
    await panel.run()
    harness.outcome = 'done'
    await panel.run()
    expect(panel.group.calls.map((c) => c[0])).toEqual(['begin', 'end', 'begin', 'end'])
    expect(panel.group.errors).toEqual([])
  })

  it('an app without a group still runs', async () => {
    const panel = await mount(false)
    await panel.run()
    expect(panel.group.calls).toEqual([])
  })
})

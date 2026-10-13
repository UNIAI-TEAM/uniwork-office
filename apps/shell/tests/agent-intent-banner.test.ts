/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentIntent, type AgentIntent } from '@uniwork/practice-core'
import type { AgentIntentApplyResult } from '../src/renderer/src/agent-intent-apply'

const apply = vi.hoisted(() => vi.fn())
vi.mock('../src/renderer/src/agent-intent-apply', () => ({ applyAgentIntent: apply }))
vi.mock('../src/renderer/src/context-manager', () => ({
  buildContextPack: () => ({ actionLabel: 'Add', targetLabel: 'Tasks', charCount: 0, chunks: [] }),
}))

import { AgentIntentBanner } from '../src/renderer/src/AgentIntentBanner'
import { LocaleProvider } from '../src/renderer/src/locale'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const DONE: AgentIntentApplyResult = {
  ok: true,
  tabId: 'tasks',
  messageVi: 'Đã thêm vào Việc: Call the bank',
  messageEn: 'Added to tasks: Call the bank',
}

let host: HTMLDivElement
let root: Root
let deliver: (intent: unknown) => void = () => undefined
let ack: ReturnType<typeof vi.fn>

const intent = (requireConsent: boolean): AgentIntent =>
  createAgentIntent({
    target: { kind: 'module', id: 'tasks' },
    action: 'add_item',
    scope: 'local',
    source: 'desktop',
    summary: 'Add a task',
    text: 'Call the bank',
    requireConsent,
  })

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(AgentIntentBanner, { practiceId: 'entrepreneur', ensureWorkbench: vi.fn() }),
      ),
    )
  })
}

const allow = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === 'Allow on device',
  )

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  apply.mockReset()
  ack = vi.fn(async () => undefined)
  ;(window as unknown as { aiOffice: unknown }).aiOffice = {
    onAgentIntent: (handler: (i: unknown) => void) => {
      deliver = handler
      return () => undefined
    },
    agentIntentAck: ack,
  }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('AgentIntentBanner', () => {
  it('a no-consent intent whose apply rejects is still acknowledged as failed', async () => {
    apply.mockRejectedValueOnce(new Error('ipc closed'))
    await mount()
    const i = intent(false)
    await act(async () => deliver(i))
    await flush()
    expect(ack).toHaveBeenCalledWith(i.intentId, 'failed')
  })

  it('Allow is disabled while the apply runs, so one click creates one task', async () => {
    let finish: (r: AgentIntentApplyResult) => void = () => undefined
    apply.mockImplementationOnce(
      () =>
        new Promise<AgentIntentApplyResult>((resolve) => {
          finish = resolve
        }),
    )
    await mount()
    const i = intent(true)
    await act(async () => deliver(i))
    await act(async () => allow()!.click())
    expect(allow()!.disabled).toBe(true)
    await act(async () => allow()!.click())
    expect(apply).toHaveBeenCalledTimes(1)
    await act(async () => finish(DONE))
    await flush()
    expect(ack).toHaveBeenCalledWith(i.intentId, 'applied')
    expect(host.textContent).toContain('Added to tasks: Call the bank')
  })
})

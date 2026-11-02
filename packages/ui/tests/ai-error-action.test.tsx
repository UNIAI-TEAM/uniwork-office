/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resultChip } from '@genoffice/agent-core'
import { AiErrorAction } from '../src/AiErrorAction'
import { aiUniworkText } from '../src/strings-ai-uniwork'

// The S9 error table gives each error turn one labelled action (EXPERIENCE l.510-527), chipwire F1.

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const handlers = () => ({
  onRetry: vi.fn(),
  onSignIn: vi.fn(),
  onAskAgain: vi.fn(),
  onOpenInApp: vi.fn(),
})

const chipFor = (error: string) => resultChip({ error })
const render = (props: Parameters<typeof AiErrorAction>[0]) =>
  act(() => root.render(createElement(AiErrorAction, props)))
const button = () => host.querySelector('button')

describe('AiErrorAction', () => {
  it.each([
    ['aiErrUnavailable', 'aiRunRetry', 'onRetry'],
    ['aiErrDisconnected', 'aiRunRetry', 'onRetry'],
    ['aiErrRateLimitedNoWait', 'aiRunRetry', 'onRetry'],
    ['aiErrSession', 'acctSignInAgain', 'onSignIn'],
    ['aiErrRunLimit', 'aiRunAskAgain', 'onAskAgain'],
    ['aiErrWorkbookTooLarge', 'aiRunOpenInApp', 'onOpenInApp'],
  ] as const)('%s renders one text button (%s) wired to %s', (error, labelKey, handler) => {
    const h = handlers()
    render({ chip: chipFor(error), lang: 'vi', ...h })
    expect(host.querySelectorAll('button')).toHaveLength(1)
    expect(button()!.textContent).toBe(aiUniworkText('vi', labelKey))
    expect(button()!.getAttribute('type')).toBe('button')
    act(() => button()!.click())
    expect(h[handler]).toHaveBeenCalledTimes(1)
    for (const [name, fn] of Object.entries(h))
      if (name !== handler) expect(fn).not.toHaveBeenCalled()
  })

  it('vi labels read Thử lại / Đăng nhập lại / Hỏi tiếp', () => {
    const labelOf = (error: string) => {
      render({ chip: chipFor(error), lang: 'vi', ...handlers() })
      return button()?.textContent
    }
    expect(labelOf('aiErrUnavailable')).toBe('Thử lại')
    expect(labelOf('aiErrSession')).toBe('Đăng nhập lại')
    expect(labelOf('aiErrRunLimit')).toBe('Hỏi tiếp')
  })

  it('renders nothing for a plan state: there is no other provider to choose (UNI-2309)', () => {
    for (const error of ['aiErrCredits', 'aiErrEntitlement', 'aiErrCapabilityOff']) {
      render({ chip: chipFor(error), lang: 'vi', ...handlers() })
      expect(host.querySelector('button'), error).toBeNull()
    }
  })

  it('renders nothing for a generic error, an offline error and a non-error chip', () => {
    for (const chip of [
      chipFor('aiErrGeneric'),
      chipFor('aiErrOffline'),
      chipFor('aiErrRevoked'),
      resultChip({ text: 'hi' }),
      null,
    ]) {
      render({ chip, lang: 'vi', ...handlers() })
      expect(host.querySelector('button')).toBeNull()
    }
  })

  it('shows no Retry while a 429 wait is running, and no action whose handler the panel lacks', () => {
    render({ chip: chipFor('aiErrUnavailable'), lang: 'vi', waiting: true, ...handlers() })
    expect(host.querySelector('button')).toBeNull()
    render({ chip: chipFor('aiErrUnavailable'), lang: 'vi' })
    expect(host.querySelector('button')).toBeNull()
  })

  it('an edited turn that then failed keeps its error action', () => {
    const chip = resultChip({ mutated: true, error: 'aiErrUnavailable' })
    render({ chip, lang: 'en', ...handlers() })
    expect(button()!.textContent).toBe('Retry')
  })
})

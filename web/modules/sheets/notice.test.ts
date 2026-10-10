// UNI-1016 SH3: the engine-recovered notice reaches the Sheets renderer's toast.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const showToast = vi.hoisted(() => vi.fn())
vi.mock('../../../apps/sheets/src/renderer/toast-bus', () => ({ showToast }))

import { notifyEngineRecovered, text } from './notice'

describe('notifyEngineRecovered', () => {
  beforeEach(() => showToast.mockClear())

  it('tells the user the engine restarted and the workbook was reopened', () => {
    notifyEngineRecovered({ sessions: 1 })
    expect(showToast).toHaveBeenCalledExactlyOnceWith(text('appWebEngineRestarted'), 'error')
    expect(text('appWebEngineRestarted')).toMatch(/\S{10}/)
  })

  it('stays quiet when no workbook was open', () => {
    notifyEngineRecovered({ sessions: 0 })
    expect(showToast).not.toHaveBeenCalled()
  })
})

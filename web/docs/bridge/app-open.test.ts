// A7: the frame side of the app.open contract (protocol f723f28).
import { describe, expect, it } from 'vitest'
import { appOpenGranted, createAppOpen } from './app-open'
import { createMockPort, protocolError } from './testing/mock-port'

describe('app.open helper', () => {
  it('reads the grant by value: an unset key is not a grant', () => {
    expect(appOpenGranted({ desktopOpen: true })).toBe(true)
    expect(appOpenGranted({ desktopOpen: false })).toBe(false)
    expect(appOpenGranted({})).toBe(false)
    expect(appOpenGranted(undefined)).toBe(false)
  })

  it('sends nothing without the capability', async () => {
    const mock = createMockPort()
    const open = createAppOpen(mock.port, { desktopOpen: false })
    expect(await open('pdf.ocr')).toEqual({ outcome: 'unavailable' })
    expect(mock.calls.filter((c) => c.type === 'app.open')).toHaveLength(0)
  })

  it('sends one app.open with the feature tag and no timeout (the host may wait on its dialog)', async () => {
    const mock = createMockPort()
    mock.override('app.open', () => ({ outcome: 'installer' }))
    const open = createAppOpen(mock.port, { desktopOpen: true })
    expect(await open('pdf.ocr')).toEqual({ outcome: 'installer' })
    const calls = mock.calls.filter((c) => c.type === 'app.open')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.payload).toEqual({ feature: 'pdf.ocr' })
    expect(calls[0]!.opts?.timeoutMs).toBe(0)
  })

  it('a rejection (old host: unsupported) stays quiet: unavailable, no throw', async () => {
    const mock = createMockPort()
    mock.override('app.open', () => {
      throw protocolError('unsupported')
    })
    const open = createAppOpen(mock.port, { desktopOpen: true })
    expect(await open()).toEqual({ outcome: 'unavailable' })
  })
})

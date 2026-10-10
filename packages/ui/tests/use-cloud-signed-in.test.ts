/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCloudSignedIn } from '../src/use-cloud-signed-in'

/**
 * GOA9-r4-04: an AI panel re-reads the UniWork cloud state every time it is
 * opened, not only on its first mount or a window focus.
 */

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let seen: ReturnType<typeof useCloudSignedIn>

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

function Probe(props: { read: () => Promise<{ loggedIn?: boolean }>; open?: boolean }) {
  seen = useCloudSignedIn(props.read, props.open)
  return null
}

const render = (props: Parameters<typeof Probe>[0]) =>
  act(async () => root.render(createElement(Probe, props)))

it('reads once on mount and again each time the panel opens', async () => {
  const read = vi.fn(async () => ({ loggedIn: false }))
  await render({ read, open: false })
  // a panel that mounts collapsed reads when it is first opened
  expect(read).toHaveBeenCalledTimes(0)
  await render({ read, open: true })
  expect(read).toHaveBeenCalledTimes(1)
  await render({ read, open: true })
  expect(read).toHaveBeenCalledTimes(1)
  await render({ read, open: false })
  expect(read).toHaveBeenCalledTimes(1)
  await render({ read, open: true })
  expect(read).toHaveBeenCalledTimes(2)
})

it('shows a plan turned on while the panel was collapsed once it reopens', async () => {
  let entitled = false
  const read = vi.fn(async () => ({ loggedIn: entitled }))
  await render({ read, open: true })
  expect(seen.loggedInRef.current).toBe(false)
  await render({ read, open: false })
  entitled = true
  expect(seen.loggedInRef.current).toBe(false)
  await render({ read, open: true })
  expect(seen.loggedInRef.current).toBe(true)
})

it('a panel without an open flag reads on mount and on window focus', async () => {
  const read = vi.fn(async () => ({ loggedIn: true }))
  await render({ read })
  expect(read).toHaveBeenCalledTimes(1)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(read).toHaveBeenCalledTimes(2)
  expect(seen.loggedInRef.current).toBe(true)
})

it('refresh() reads on demand and a missing bridge or a rejected read is harmless', async () => {
  const read = vi.fn(async () => ({ loggedIn: true }))
  await render({ read })
  await act(async () => seen.refresh())
  expect(read).toHaveBeenCalledTimes(2)
  await render({ read: () => undefined as never, open: true })
  await act(async () => seen.refresh())
  await render({ read: () => Promise.reject(new Error('no bridge')), open: true })
  await act(async () => seen.refresh())
  expect(seen.loggedInRef.current).toBe(true)
})

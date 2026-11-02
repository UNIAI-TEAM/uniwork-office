/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
import { useImageGenerationOffered } from '../src/use-image-generation-offered'

/**
 * The visible image-generation entries (Slides "AI Image" buttons, the "Regenerate with AI" chip)
 * are offered only with the host grant AND the UniWork cloud (signed in, cloud tools on): the rule
 * the generate_image tool uses. There is no image model of the person's own (UNI-2309).
 */

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let offered: boolean

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

type ProbeProps = {
  granted: boolean
  settings: AiSettings | null
  read: () => Promise<{ loggedIn?: boolean }> | undefined
}

function Probe(props: ProbeProps) {
  offered = useImageGenerationOffered(props.granted, props.settings, props.read)
  return null
}

const render = (props: ProbeProps) => act(async () => root.render(createElement(Probe, props)))

it('grant off: hidden even while signed in, and the cloud is never read', async () => {
  const read = vi.fn(async () => ({ loggedIn: true }))
  await render({ granted: false, settings: defaultAiSettings(), read })
  expect(offered).toBe(false)
  expect(read).not.toHaveBeenCalled()
})

it('grant on: shown only while the UniWork cloud answers signed in with tools on', async () => {
  const settings = defaultAiSettings()
  await render({ granted: true, settings, read: async () => ({ loggedIn: false }) })
  expect(offered).toBe(false)
  await render({ granted: true, settings: { ...settings }, read: async () => ({ loggedIn: true }) })
  expect(offered).toBe(true)
  // the cloud tool switch can still say no
  await render({
    granted: true,
    settings: { ...settings, gskToolsEnabled: false },
    read: async () => ({ loggedIn: true }),
  })
  expect(offered).toBe(false)
})

it('re-reads on window focus, and a missing bridge or a rejected read stays hidden', async () => {
  let entitled = false
  const read = vi.fn(async () => ({ loggedIn: entitled }))
  const settings = defaultAiSettings()
  await render({ granted: true, settings, read })
  expect(offered).toBe(false)
  entitled = true
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(offered).toBe(true)
  await render({ granted: true, settings: { ...settings }, read: () => undefined })
  await act(async () => window.dispatchEvent(new Event('focus')))
  await render({
    granted: true,
    settings: { ...settings },
    read: () => Promise.reject(new Error('x')),
  })
  expect(typeof offered).toBe('boolean')
})

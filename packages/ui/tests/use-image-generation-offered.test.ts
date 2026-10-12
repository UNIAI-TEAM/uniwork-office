/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultAiMediaSettings, defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
import { useImageGenerationOffered } from '../src/use-image-generation-offered'

/**
 * The visible image-generation entries (Slides "AI Image" buttons, the "Regenerate with AI" chip)
 * are offered only with the host grant AND a live way to generate, the rule the generate_image
 * tool uses.
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

/** the person's own OpenAI image model: works without any UniWork cloud sign-in */
function ownKey(): AiSettings {
  const media = defaultAiMediaSettings()
  media.imageProvider = 'openai'
  media.providers.openai = { apiKey: 'sk-test', imageModel: 'gpt-image-2', analysisModel: '' }
  const base = defaultAiSettings()
  return { ...base, media }
}

it('grant off: hidden even with a key, and the cloud is never read', async () => {
  const read = vi.fn(async () => ({ loggedIn: true }))
  await render({ granted: false, settings: ownKey(), read })
  expect(offered).toBe(false)
  expect(read).not.toHaveBeenCalled()
})

it('grant on, own provider key: shown without a cloud sign-in', async () => {
  await render({ granted: true, settings: ownKey(), read: async () => ({ loggedIn: false }) })
  expect(offered).toBe(true)
})

it('grant on, no key: shown only while the UniWork cloud answers signed in with tools on', async () => {
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

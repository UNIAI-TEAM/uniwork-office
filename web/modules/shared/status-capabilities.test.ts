// One announcement per state: every web module starts with the renderer's own save-state label and
// "view only" chip switched off (the host header and its one banner announce them), and no host
// grant turns them back on.
import { describe, expect, it } from 'vitest'
import { MODULE_WEB_CAPABILITIES } from '../../docs/bridge/module-bridge'
import { hostGrants } from '../../docs/bridge/hide'
import { SLIDES_WEB_CAPABILITIES, slidesHostGrants } from '../slides/capabilities'
import { sheetsWebCapabilities } from '../sheets/capabilities'
import { TEXT_MODULE_WEB_CAPABILITIES, textModuleGrants } from './capabilities'

const ALL_GRANTS = {
  ai: true,
  save: true,
  saveAs: true,
  filePick: true,
  recents: true,
  images: true,
  print: true,
}

const REPEATS = ['saveStatus', 'viewOnlyChip'] as const

// (PDF spreads MODULE_WEB_CAPABILITIES in pdf/install.ts, which needs the wasm build to import)
describe('host-announced states', () => {
  const defaults: Record<string, Readonly<Record<string, unknown>>> = {
    'module default': MODULE_WEB_CAPABILITIES,
    'text modules (markdown, html)': TEXT_MODULE_WEB_CAPABILITIES,
    slides: SLIDES_WEB_CAPABILITIES,
    sheets: sheetsWebCapabilities({ kind: 'wasm', features: {} } as never),
  }

  for (const [name, caps] of Object.entries(defaults)) {
    it(`${name}: the renderer's own save-state label and view-only chip are off`, () => {
      for (const key of REPEATS) expect(caps[key], key).toBe(false)
    })
  }

  it('sheets: the ribbon-row echo of the status bar and the AI run states are off too', () => {
    expect(sheetsWebCapabilities({ kind: 'wasm', features: {} } as never).statusEcho).toBe(false)
  })

  it('slides: the AI panel keeps no "Error:" label before its typed inline error', () => {
    expect(SLIDES_WEB_CAPABILITIES.errorLabel).toBe(false)
    expect('errorLabel' in slidesHostGrants(ALL_GRANTS as never)).toBe(false)
  })

  it('no host grant switches them back on', () => {
    for (const grants of [
      hostGrants(ALL_GRANTS as never),
      textModuleGrants(ALL_GRANTS as never),
      slidesHostGrants(ALL_GRANTS as never),
    ]) {
      for (const key of REPEATS) expect(key in grants, key).toBe(false)
    }
  })
})

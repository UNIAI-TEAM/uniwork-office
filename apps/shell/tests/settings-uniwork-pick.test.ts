/**
 * The home Settings window shows and saves the account's UniWork AI pick (docs-main
 * `ai:get-settings` / `ai:set-settings` take `{ includeUniworkPick }`); My AI, email and the
 * credit wallet read the file provider. Wiring pin by source: the handlers' behaviour is in
 * apps/docs/tests/uniwork-ai-choice.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')

describe('Settings window UniWork AI pick wiring', () => {
  it('the AI panes of Settings read and save with the pick option', () => {
    const src = read('src/renderer/src/SettingsModal.tsx')
    expect(src).toMatch(/const SETTINGS_PICK = \{ includeUniworkPick: true \}/)
    expect(src.match(/getAiSettings\?\.\(SETTINGS_PICK\)/g)).toHaveLength(2)
    // the model pane adds the model the user chose; the media pane saves the plain option
    expect(src).toMatch(
      /saveOptions = modelPick \? \{ \.\.\.SETTINGS_PICK, modelPick \} : SETTINGS_PICK/,
    )
    expect(src.match(/setAiSettings\?\.\(settings, saveOptions\)/g)).toHaveLength(1)
    expect(src.match(/setAiSettings\?\.\(settings, SETTINGS_PICK\)/g)).toHaveLength(1)
    expect(src).not.toMatch(/getAiSettings\?\.\(\)/)
  })

  it('the preload forwards the option and only when asked', () => {
    const src = read('src/preload/index.ts')
    expect(src).toMatch(
      /'ai:get-settings',\s*options\?\.includeUniworkPick \? \{ includeUniworkPick: true \} : undefined/,
    )
    expect(src).toMatch(
      /\.\.\.\(options\?\.includeUniworkPick \? \{ includeUniworkPick: true \} : \{\}\)/,
    )
    expect(src).toMatch(
      /\.\.\.\(options\?\.modelPick \? \{ modelPick: options\.modelPick \} : \{\}\)/,
    )
    expect(src).toMatch(
      /'ai:set-settings',\s*settings,\s*Object\.keys\(sent\)\.length > 0 \? sent : undefined/,
    )
  })

  it('My AI, the credit wallet and the one-click read keep the file provider', () => {
    expect(read('src/renderer/src/NewChatPane.tsx')).toMatch(/api\.getAiSettings\(\)/)
    expect(read('src/renderer/src/CreditWallet.tsx')).toMatch(/aiOffice\.getAiSettings\(\)/)
    expect(read('src/preload/index.ts')).toMatch(/ipcRenderer\.invoke\('ai:get-settings'\)/)
  })
})

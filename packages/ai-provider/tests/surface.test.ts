// UniWork AI is the only provider: the package no longer carries a provider catalog, the
// bring-your-own-key protocols, Codex or OpenRouter.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as browser from '../src/browser'
import * as index from '../src/index'

describe('package surface', () => {
  it('the barrels export no provider catalog, provider call or key helper', () => {
    for (const name of [
      'AI_PROVIDERS',
      'streamForProvider',
      'chatForProvider',
      'selectedProvider',
      'probeOpenRouterKey',
      'listCodexModels',
    ]) {
      expect(index).not.toHaveProperty(name)
      expect(browser).not.toHaveProperty(name)
    }
  })

  it('package.json exposes no Codex or model-listing subpath', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
      exports: Record<string, string>
    }
    for (const subpath of ['./codex-app-server', './custom-models', './provider-models'])
      expect(pkg.exports).not.toHaveProperty(subpath)
  })
})

// Guards the slides session extraction (docs/upstream/UPSTREAM_SYNC.md, "Slides: the session core left
// slides-main.ts"): a `slides:*` channel that the session registry serves must not be registered a second
// time in slides-main.ts. An upstream sync patch that re-adds an `ipcMain.handle('slides:x', ...)` body there
// would shadow (or, at registration, collide with) the registry handler and fork the logic; it belongs in
// src/session/handlers/*.ts.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(__dirname, '../src')

function registryChannels(): string[] {
  const dir = join(src, 'session/handlers')
  const out: string[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(dir, file), 'utf8')
    for (const m of text.matchAll(/^ {2}'(slides:[^']+)':/gm)) out.push(m[1]!)
  }
  return out
}

function mainChannels(): string[] {
  const text = readFileSync(join(src, 'main/slides-main.ts'), 'utf8')
  return [...text.matchAll(/ipcMain\.handle\(\s*'(slides:[^']+)'/g)].map((m) => m[1]!)
}

describe('slides session registry vs slides-main.ts', () => {
  it('finds the registry handlers (the scan itself works)', () => {
    expect(registryChannels().length).toBeGreaterThan(100)
    expect(mainChannels().length).toBeGreaterThan(10)
  })

  it('no channel is served by both the registry and slides-main.ts', () => {
    const registry = new Set(registryChannels())
    expect(mainChannels().filter((c) => registry.has(c))).toEqual([])
  })

  it('every registry channel is unique', () => {
    const all = registryChannels()
    expect(all.filter((c, i) => all.indexOf(c) !== i)).toEqual([])
  })
})

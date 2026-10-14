// @vitest-environment jsdom
/**
 * G8-13 (UNI-1408), lane decision D6: the Sheets frame claims `comments` once its editor serves the
 * cell comments (S12) through `window.uniworkComments`. That also turns on the G8-11 frame
 * Discussion panel for Sheets, mounted silent on a reveal miss (the editor owns anchored ids and
 * shows its own S15 line), so exactly one panel reacts to a reveal.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mounted = vi.hoisted(() => [] as unknown[][])
vi.mock('../shared/discussion/mount', () => ({
  mountFrameDiscussion: (...args: unknown[]) => {
    mounted.push(args)
    return Promise.resolve(() => undefined)
  },
}))

import { installModuleBridge, moduleFrameCapabilities } from '../../docs/bridge/module-bridge'
import { createMockPort } from '../../docs/bridge/testing/mock-port'
import { FRAME_COMMENTS } from '../shared/discussion/claim'

afterEach(() => {
  mounted.length = 0
})

describe('Sheets frame comments claim (D6)', () => {
  it('the switch is on for sheets and the ready capabilities carry `comments`', () => {
    expect(FRAME_COMMENTS.sheets).toBe(true)
    expect(moduleFrameCapabilities({ module: 'sheets', frameCapabilities: {} }).comments).toBe(true)
  })

  it('install.ts claims comments, installs the frame comments API and keeps Discussion silent', () => {
    const src = readFileSync(join(__dirname, 'install.ts'), 'utf8')
    expect(src).toMatch(/frameComments: true\b/)
    expect(src).toMatch(/discussionRevealMissing: 'silent'/)
    expect(src).toMatch(/uniworkCommentsReady =\s*installFrameComments\(bridge\.client\)/)
  })

  it('the module bridge mounts the Discussion panel with the module’s reveal-miss rule', () => {
    const mock = createMockPort()
    installModuleBridge({
      module: 'sheets',
      frameComments: true,
      discussionRevealMissing: 'silent',
      frameCapabilities: {},
      globals: {},
      client: mock.port,
      target: {},
    })
    expect(mounted).toHaveLength(1)
    expect(mounted[0]![1]).toEqual({ revealMissing: 'silent' })
  })

  it('other modules keep the default (notice) rule', () => {
    const mock = createMockPort()
    installModuleBridge({
      module: 'markdown',
      frameCapabilities: {},
      globals: {},
      client: mock.port,
      target: {},
    })
    expect(mounted).toHaveLength(1)
    expect(mounted[0]![1]).toEqual({})
  })
})

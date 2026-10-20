/**
 * UNI-1993 (UW-SOURCE-RO) contract 3.7 item 1: the registry of view-only source
 * paths and the seam wrapper built on it. A registered path reads as bound,
 * read-only and locked to every editor module; any other path goes to the
 * service seam untouched, and the service itself never learns of the source.
 */
import { describe, expect, it, vi } from 'vitest'
import type { UniworkModuleSeam } from '../src/main/uniwork-docs/modules'
import { SourceViewRegistry, withSourceViews } from '../src/main/uniwork-docs/source-view'

const SOURCE = 'C:\\Users\\me\\AppData\\Roaming\\app\\uniwork-drafts-preview\\sources-s1\\ab12\\Plan.docx'
const OTHER = 'C:/Users/me/Documents/notes.docx'
const META = { name: 'Plan.docx', origin: 'chat', parentTitle: 'Launch' }

/** a service-like seam: every answer is false and every call is recorded */
function fakeSeam(over: Partial<UniworkModuleSeam> = {}) {
  const seam = {
    isBound: vi.fn(() => false),
    isReadOnly: vi.fn(() => false),
    isLocked: vi.fn(() => false),
    consumeCapture: vi.fn(() => false),
    onUserSave: vi.fn(),
    onReadOnlySave: vi.fn(),
    refuseLockedPath: vi.fn(() => false),
    ...over,
  } satisfies UniworkModuleSeam
  return seam
}

describe('SourceViewRegistry', () => {
  it('keeps meta per path and lists the paths as they were added', () => {
    const registry = new SourceViewRegistry()
    registry.add(SOURCE, META)
    expect(registry.has(SOURCE)).toBe(true)
    expect(registry.meta(SOURCE)).toEqual(META)
    expect(registry.paths()).toEqual([SOURCE])
    expect(registry.has(OTHER)).toBe(false)
    expect(registry.meta(OTHER)).toBeNull()
  })

  it('normalises a path like the service does: separators, and letter case on a drive path', () => {
    const registry = new SourceViewRegistry()
    registry.add(SOURCE, META)
    expect(registry.has(SOURCE.replace(/\\/g, '/'))).toBe(true)
    expect(registry.has(SOURCE.replace(/\\/g, '/').toLowerCase())).toBe(true)
    expect(registry.meta(SOURCE.toUpperCase())).toEqual(META)
    // a POSIX path is case sensitive, as pathKey keeps it
    registry.add('/tmp/Prev/A.docx', META)
    expect(registry.has('/tmp/Prev/A.docx')).toBe(true)
    expect(registry.has('/tmp/prev/a.docx')).toBe(false)
  })

  it('remove() drops one entry and reports whether it was there', () => {
    const registry = new SourceViewRegistry()
    registry.add(SOURCE, META)
    registry.add(OTHER, META)
    expect(registry.remove(SOURCE.replace(/\\/g, '/'))).toBe(true)
    expect(registry.remove(SOURCE)).toBe(false)
    expect(registry.has(SOURCE)).toBe(false)
    expect(registry.paths()).toEqual([OTHER])
  })

  it('refuses a blank or non-string path instead of registering everything', () => {
    const registry = new SourceViewRegistry()
    expect(() => registry.add('', META)).toThrow()
    expect(registry.has('')).toBe(false)
    expect(registry.has(undefined as unknown as string)).toBe(false)
    expect(registry.meta(null as unknown as string)).toBeNull()
  })
})

describe('withSourceViews', () => {
  it('answers bound + read-only + locked only for a registered path', () => {
    const registry = new SourceViewRegistry()
    registry.add(SOURCE, META)
    const seam = withSourceViews(fakeSeam(), registry)
    expect(seam.isBound(SOURCE)).toBe(true)
    expect(seam.isReadOnly(SOURCE)).toBe(true)
    expect(seam.isLocked?.(SOURCE)).toBe(true)
    expect(seam.isBound(OTHER)).toBe(false)
    expect(seam.isReadOnly(OTHER)).toBe(false)
    expect(seam.isLocked?.(OTHER)).toBe(false)
  })

  it('hands every other path to the service seam and returns its answer unchanged', () => {
    const registry = new SourceViewRegistry()
    registry.add(SOURCE, META)
    const inner = fakeSeam({
      isBound: vi.fn((p: string) => p === OTHER),
      isReadOnly: vi.fn((p: string) => p === OTHER),
      isLocked: vi.fn((p: string) => p === OTHER),
      refuseLockedPath: vi.fn((p: string) => p === OTHER),
      consumeCapture: vi.fn((p: string) => p === OTHER),
    })
    const seam = withSourceViews(inner, registry)
    expect(seam.isBound(OTHER)).toBe(true)
    expect(seam.isReadOnly(OTHER)).toBe(true)
    expect(seam.isLocked?.(OTHER)).toBe(true)
    expect(seam.refuseLockedPath(OTHER)).toBe(true)
    expect(seam.consumeCapture?.(OTHER)).toBe(true)
    seam.onUserSave(OTHER)
    expect(inner.onUserSave).toHaveBeenCalledWith(OTHER)
  })

  it('wrapped seam leaves the service verdicts untouched: nothing leaks into recents, sync or tab logic', () => {
    const registry = new SourceViewRegistry()
    registry.add(SOURCE, META)
    const service = fakeSeam()
    const seam = withSourceViews(service, registry)
    // the editors see the source view ...
    expect(seam.isBound(SOURCE)).toBe(true)
    // ... while the service, asked directly, still says it is none of its documents
    expect(service.isBound(SOURCE)).toBe(false)
    expect(service.isReadOnly(SOURCE)).toBe(false)
    expect(service.isLocked?.(SOURCE)).toBe(false)
  })

  it('routes Ctrl+S on a source path to the source hint, never to the service explain popover', () => {
    const registry = new SourceViewRegistry()
    registry.add(SOURCE, META)
    const inner = fakeSeam()
    const onSourceSave = vi.fn()
    const seam = withSourceViews(inner, registry, { onSourceSave })
    seam.onReadOnlySave?.(SOURCE)
    expect(onSourceSave).toHaveBeenCalledWith(SOURCE)
    expect(inner.onReadOnlySave).not.toHaveBeenCalled()
    seam.onReadOnlySave?.(OTHER)
    expect(inner.onReadOnlySave).toHaveBeenCalledWith(OTHER)
    expect(onSourceSave).toHaveBeenCalledTimes(1)
  })

  it('a source path never fires the user-save hook, never consumes a capture and is never refused as a locked store', () => {
    const registry = new SourceViewRegistry()
    registry.add(SOURCE, META)
    const inner = fakeSeam({ refuseLockedPath: vi.fn(() => true), consumeCapture: vi.fn(() => true) })
    const seam = withSourceViews(inner, registry)
    seam.onUserSave(SOURCE)
    expect(inner.onUserSave).not.toHaveBeenCalled()
    expect(seam.consumeCapture?.(SOURCE)).toBe(false)
    expect(seam.refuseLockedPath(SOURCE)).toBe(false)
    expect(inner.refuseLockedPath).not.toHaveBeenCalled()
  })

  it('keeps the optional recovery/originals registration hooks of the service seam', () => {
    const registry = new SourceViewRegistry()
    const setClearRecovery = vi.fn()
    const setClearOriginals = vi.fn()
    const seam = withSourceViews(fakeSeam({ setClearRecovery, setClearOriginals }), registry)
    const clear = () => undefined
    seam.setClearRecovery?.(clear)
    seam.setClearOriginals?.(clear)
    expect(setClearRecovery).toHaveBeenCalledWith(clear)
    expect(setClearOriginals).toHaveBeenCalledWith(clear)
    // a seam without them stays without them
    const bare = withSourceViews(fakeSeam(), registry)
    expect(() => bare.setClearRecovery?.(clear)).not.toThrow()
  })

  it('sees an entry added or removed after the wrapper was built (the registry is live)', () => {
    const registry = new SourceViewRegistry()
    const seam = withSourceViews(fakeSeam(), registry)
    expect(seam.isReadOnly(SOURCE)).toBe(false)
    registry.add(SOURCE, META)
    expect(seam.isReadOnly(SOURCE)).toBe(true)
    registry.remove(SOURCE)
    expect(seam.isReadOnly(SOURCE)).toBe(false)
  })
})

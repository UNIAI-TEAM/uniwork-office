/**
 * Safe no-op API objects (generic bridge piece, GO-B4/B5/B6; extracted from install.ts).
 *
 * A web frame installs the renderer's preload globals (window.desktop, window.pdfApi,
 * window.slidesApi, ...) as objects that never throw on a missing member: every key no
 * bridge module implements gets a fallback the first time it is read.
 *   - `on*` subscribers get a no-op disposer (they are called synchronously and their return
 *     value is used as an unsubscribe function),
 *   - everything else gets an async no-op resolving `undefined`.
 * Symbols (String(api), devtools) and `then` (so `await api` does not treat it as a thenable)
 * are never filled.
 */

export type BridgeObject = Record<string, unknown>

export function fallbackFor(key: string): unknown {
  if (key.startsWith('on')) return () => () => {}
  return () => Promise.resolve(undefined)
}

/** wrap `target` (mutated: fallbacks are cached on it) in the safe no-op Proxy */
export function safeApi<T extends BridgeObject>(target: T): T {
  return new Proxy(target, {
    get(obj, prop: string | symbol) {
      if (typeof prop !== 'string' || prop === 'then') return Reflect.get(obj, prop)
      if (prop in obj) return obj[prop]
      const fallback = fallbackFor(prop)
      ;(obj as BridgeObject)[prop] = fallback
      return fallback
    },
  })
}

/** merge bridge modules into one object, later modules win per key */
export function mergeModules(
  modules: ReadonlyArray<BridgeObject | null | undefined>,
): BridgeObject {
  const out: BridgeObject = {}
  for (const mod of modules) for (const key of Object.keys(mod ?? {})) out[key] = mod?.[key]
  return out
}

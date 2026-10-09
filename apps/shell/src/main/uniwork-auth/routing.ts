import {
  extractAuthCallbackFromArgv,
  extractAuthCallbackFromLockData,
  isAuthCallbackUrl,
} from './callback'

/**
 * Where a sign-in callback can enter the process: the cold-start argv
 * (Windows/Linux), `open-url` (macOS, possibly before app ready) and a second
 * instance's argv or lock data. Callbacks that arrive before the account is
 * started are held (latest wins) and handed over by start(). Electron-free so
 * the routing rules are unit-tested; index.ts only binds the events.
 */
export interface AuthCallbackRouter {
  /** the held callback, for the single-instance lock data */
  pending(): string | null
  /** `open-url`: true when the URL is a sign-in callback (routed or held) */
  openUrl(url: unknown): boolean
  /** `second-instance`: argv first, then the lock's additionalData */
  secondInstance(argv: readonly unknown[], additionalData: unknown): boolean
  /** routes from now on, starting with the held callback */
  start(route: (url: string) => void): void
}

/** the slice of Electron's `app` the callback events need */
export interface AuthCallbackEventSource {
  on(event: string, listener: (...args: never[]) => void): unknown
}

/**
 * Binds `open-url` and `second-instance` to the router. A sign-in callback
 * stops there; anything else goes to `fallback` (office-bridge URLs, files).
 */
export function bindAuthCallbackEvents(
  app: AuthCallbackEventSource,
  router: AuthCallbackRouter,
  fallback: {
    openUrl(url: string): void
    secondInstance(argv: string[], additionalData: unknown): void
  },
): void {
  app.on('open-url', (event: { preventDefault(): void }, url: string) => {
    event.preventDefault()
    if (router.openUrl(url)) return
    fallback.openUrl(url)
  })
  app.on(
    'second-instance',
    (_event: unknown, argv: string[], _cwd: string, additionalData: unknown) => {
      if (router.secondInstance(argv, additionalData)) return
      fallback.secondInstance(argv, additionalData)
    },
  )
}

export function createAuthCallbackRouter(initialArgv: readonly unknown[]): AuthCallbackRouter {
  let held = extractAuthCallbackFromArgv(initialArgv)
  let route: ((url: string) => void) | null = null
  const deliver = (url: string) => {
    if (route) route(url)
    else held = url
  }
  return {
    pending: () => held,
    openUrl(url) {
      if (!isAuthCallbackUrl(url)) return false
      deliver(url)
      return true
    },
    secondInstance(argv, additionalData) {
      const url =
        extractAuthCallbackFromArgv(argv) ?? extractAuthCallbackFromLockData(additionalData)
      if (!url) return false
      deliver(url)
      return true
    },
    start(next) {
      route = next
      const first = held
      held = null
      if (first) next(first)
    },
  }
}

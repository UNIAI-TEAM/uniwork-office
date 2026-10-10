import {
  extractAuthCallbackFromArgv,
  extractAuthCallbackFromLockData,
  extractOfficeLaunchFromArgv,
  extractOfficeLaunchFromLockData,
  isAuthCallbackUrl,
  isOfficeLaunchUrl,
} from './callback'

/**
 * Where a sign-in callback can enter the process: the cold-start argv
 * (Windows/Linux), `open-url` (macOS, possibly before app ready) and a second
 * instance's argv or lock data. Callbacks that arrive before the account is
 * started are held (latest wins) and handed over by start(). Document launch
 * links (`uniwork-office[-dev]://open?ticket=`) enter the same way and are
 * held in arrival order until startLaunch(). Electron-free so the routing
 * rules are unit-tested; index.ts only binds the events.
 */
export interface AuthCallbackRouter {
  /** the held callback, for the single-instance lock data */
  pending(): string | null
  /** the first held document launch link, for the single-instance lock data */
  pendingLaunch(): string | null
  /** `open-url`: true when the URL is a sign-in callback or launch link (routed or held) */
  openUrl(url: unknown): boolean
  /** `second-instance`: argv first, then the lock's additionalData */
  secondInstance(argv: readonly unknown[], additionalData: unknown): boolean
  /** routes from now on, starting with the held callback */
  start(route: (url: string) => void): void
  /** routes launch links from now on, starting with the held ones */
  startLaunch(route: (url: string) => void): void
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

/** launch links held before the launch route exists (a burst of clicks stays bounded) */
const MAX_HELD_LAUNCHES = 8

export function createAuthCallbackRouter(initialArgv: readonly unknown[]): AuthCallbackRouter {
  let held = extractAuthCallbackFromArgv(initialArgv)
  let route: ((url: string) => void) | null = null
  const heldLaunches: string[] = []
  const coldLaunch = extractOfficeLaunchFromArgv(initialArgv)
  if (coldLaunch) heldLaunches.push(coldLaunch)
  let launchRoute: ((url: string) => void) | null = null
  const deliver = (url: string) => {
    if (route) route(url)
    else held = url
  }
  const deliverLaunch = (url: string) => {
    if (launchRoute) launchRoute(url)
    else if (heldLaunches.length < MAX_HELD_LAUNCHES) heldLaunches.push(url)
  }
  return {
    pending: () => held,
    pendingLaunch: () => heldLaunches[0] ?? null,
    openUrl(url) {
      if (isOfficeLaunchUrl(url)) {
        deliverLaunch(url)
        return true
      }
      if (!isAuthCallbackUrl(url)) return false
      deliver(url)
      return true
    },
    secondInstance(argv, additionalData) {
      const launch =
        extractOfficeLaunchFromArgv(argv) ?? extractOfficeLaunchFromLockData(additionalData)
      if (launch) {
        deliverLaunch(launch)
        return true
      }
      const url =
        extractAuthCallbackFromArgv(argv) ?? extractAuthCallbackFromLockData(additionalData)
      if (!url) return false
      deliver(url)
      return true
    },
    startLaunch(next) {
      launchRoute = next
      for (const url of heldLaunches.splice(0)) next(url)
    },
    start(next) {
      route = next
      const first = held
      held = null
      if (first) next(first)
    },
  }
}

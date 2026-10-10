import type { HomeApi } from '../../shared/home-api'
import { onUniworkNotice } from './uniwork-notice-bus'

/**
 * Run `refresh` whenever a UniWork document has just been opened, wherever the
 * open came from: the picker or a recents row (the in-renderer feed) or a link
 * from the web (pushed by main). The recents list is only re-read on window
 * focus otherwise, and the shell already holds focus while these happen, so the
 * document that was just opened would not show up until the next focus change.
 * Returns the unsubscribe function.
 */
export function subscribeUniworkOpened(
  api: Pick<HomeApi, 'onUniworkLaunch'>,
  refresh: () => void,
): () => void {
  const onEvent = (event: { phase: string }): void => {
    if (event.phase === 'opened') refresh()
  }
  const offLaunch = api.onUniworkLaunch(onEvent)
  const offBus = onUniworkNotice(onEvent)
  return () => {
    offLaunch()
    offBus()
  }
}

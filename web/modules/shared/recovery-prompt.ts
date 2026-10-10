/**
 * The Restore / Discard prompt of web draft recovery (CONTRACT C18), one component for Docs and
 * every module frame: the shared dialog chrome of ./notice.ts (theme tokens) and the strings of
 * ./i18n/strings-web.ts in the UI language. Escape restores nothing and keeps the copy.
 */
import { webLanguage } from '../../docs/bridge/browser'
import {
  createDraftRecovery,
  type DraftChoice,
  type DraftHost,
  type DraftInfo,
  type DraftRecovery,
  type DraftRecoveryOptions,
} from '../../docs/bridge/draft-recovery'
import type { FramePort, PortSession } from '../../docs/bridge/frame-port'
import type { InitRecovery, OfficeModule } from '../../docs/protocol/types'
import { ask, text } from './notice'

export const DRAFT_PROMPT_MARKER = 'draft-recovery'

function when(savedAt: number): string {
  try {
    return new Intl.DateTimeFormat(webLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(savedAt)
  } catch {
    return new Date(savedAt).toLocaleString()
  }
}

export function promptDraftRestore(draft: DraftInfo): Promise<DraftChoice> {
  const details = [`${text('webDraftSavedAt')} ${when(draft.savedAt)}`, text('webDraftKept')]
  if (draft.older) details.push(text('webDraftOlder'))
  return ask<DraftChoice>({
    title: 'webDraftTitle',
    body: 'webDraftBody',
    details,
    choices: [
      { id: 'discard', label: 'webDraftDiscard', danger: true },
      { id: 'restore', label: 'webDraftRestore', primary: true },
    ],
    cancelId: 'dismiss',
    marker: DRAFT_PROMPT_MARKER,
  })
}

/**
 * The host's recovery grant as the protocol session holds it (a later `init` after a frame reload
 * updates the same session object): read at every use, undefined until `init` or when absent.
 */
export function bridgeRecoveryGrant(
  port: Pick<FramePort, 'whenInitialized'>,
): () => InitRecovery | undefined {
  let session: PortSession | null = null
  port.whenInitialized().then(
    (s) => {
      session = s
    },
    () => {},
  )
  return () => session?.recovery
}

/**
 * The draft recovery of one bridge: the grant comes from the protocol session, the prompt is the
 * shared one above.
 */
export function bridgeDraftRecovery(
  port: Pick<FramePort, 'whenInitialized'>,
  module: OfficeModule,
  host: DraftHost,
  overrides: Partial<Omit<DraftRecoveryOptions, 'module' | 'host'>> = {},
): DraftRecovery {
  return createDraftRecovery({
    module,
    host,
    prompt: promptDraftRestore,
    recovery: bridgeRecoveryGrant(port),
    ...overrides,
  })
}

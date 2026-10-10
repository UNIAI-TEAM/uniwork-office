/**
 * Capability keys of the text modules on the web (inventory-b4 section 5.2). The renderers read
 * them with `cap(key)` (apps/<module>/src/renderer/capabilities.ts, @genoffice/ui
 * createCapabilityReader): an entry is on unless its key is explicitly false, so desktop (no
 * object) keeps everything.
 */
import type { Capabilities } from '../../docs/protocol/types'
import { MODULE_WEB_CAPABILITIES } from '../../docs/bridge/module-bridge'

/** what every text module hides on the web, whatever the host grants */
export const TEXT_MODULE_WEB_CAPABILITIES: Readonly<Record<string, unknown>> = Object.freeze({
  ...MODULE_WEB_CAPABILITIES,
  // the AI family (same keys as Docs): no AI on the web in this lane
  webSearch: false,
  imageSearch: false,
  imageGeneration: false,
  createDocument: false,
  billing: false,
  // editing and saving: on only with the host's `save` grant (view-only otherwise)
  save: false,
  // pictures go to the asset store only with the host's `images` grant (else embedded)
  images: false,
  // "Open in the UniWork Office app" action of the use-the-app messages: on with the host's `desktopOpen` grant
  desktopOpen: false,
})

/**
 * Host grants -> capability entries (frame ∩ host from `init`). `open` / `recents` as Docs
 * (`filePick`, `recents`); `save` is the view-only switch (protocol README "Read-only documents").
 */
export function textModuleGrants(granted: Capabilities | undefined): Record<string, unknown> {
  return {
    open: granted?.filePick === true,
    recents: granted?.recents === true,
    save: granted?.save === true,
    images: granted?.images === true,
    desktopOpen: granted?.desktopOpen === true,
  }
}

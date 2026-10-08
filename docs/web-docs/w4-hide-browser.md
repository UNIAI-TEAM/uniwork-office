# W4: HIDE + BROWSER classes on the web (UNI-1013)

## One capability source

`web/docs/bridge/hide.ts` exports the frozen `webCapabilities` and puts it on the
bridge as `window.desktop.capabilities` (hide is merged into `window.desktop` by
`install.ts`, which needed no edit). The renderer reads it once, lazily, through
`apps/docs/src/renderer/capabilities.ts`:

```ts
cap('zotero') // true unless window.desktop.capabilities.zotero === false
```

Electron's preload never sets `capabilities`, so every `cap()` is `true` on desktop and
the desktop UI is unchanged. There is no `isWeb` check anywhere: each entry is declared
against a capability key where it renders. The type is `DesktopCapabilities` in
`apps/docs/src/shared/ipc.ts`.

## Hidden entries and how each is gated

| Entry (desktop-only / AI)                                                                             | Capability        | Gate                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| References > Zotero group (Citation, Bibliography, Refresh, Document settings)                        | `zotero`          | `ribbon-references-tab.tsx`: group + separator wrapped in `cap('zotero')`                                                                             |
| Protect dialog > "Password to open" + confirm fields                                                  | `docPassword`     | `ProtectDialog.tsx`: `openPasswordAvailable`; modify-password, restrict-editing and privacy stay                                                      |
| View > Window > New Tab                                                                               | `tabs`            | `ribbon-tabs.tsx`                                                                                                                                     |
| View > Window > Switch Tabs                                                                           | `tabs`            | `ribbon-tabs.tsx` (Split stays: it is renderer-only)                                                                                                  |
| Quick-access AutoSave toggle                                                                          | `autoSaveToDisk`  | `App.tsx`: toggle not rendered and `autoSave` forced off                                                                                              |
| 30 s crash-recovery copy timer (silently saved never-saved docs, i.e. a download per tick on the web) | `autoSaveToDisk`  | `App.tsx` timer effect                                                                                                                                |
| `createDocument` AI tool (opens a new tab)                                                            | `createDocument`  | `ai/docs-skill.ts` tool list                                                                                                                          |
| Home > AI group (AI, Summarize, Polish, Tidy)                                                         | `ai`              | `Ribbon.tsx`                                                                                                                                          |
| Review > Editor                                                                                       | `ai`              | `ribbon-tabs.tsx`                                                                                                                                     |
| Review > Language > Translate (whole group)                                                           | `ai`              | `ribbon-tabs.tsx`                                                                                                                                     |
| Review > AI Resolve Comments                                                                          | `ai`              | `ribbon-tabs.tsx`                                                                                                                                     |
| Review > AI Revision Summary                                                                          | `ai`              | `ribbon-tabs.tsx`                                                                                                                                     |
| View > AI Panel                                                                                       | `ai`              | `ribbon-tabs.tsx`                                                                                                                                     |
| AI dock (panel) and the ask-AI popover on selection                                                   | `ai`              | `App.tsx`: not mounted; `showAi` is `aiEnabled && pref`, so a stray `setShowAi(true)`, the native `toggle-ai` command or a stored pref cannot show it |
| Context menu > Synonyms, Translate                                                                    | `ai`              | `ContextMenu.tsx`                                                                                                                                     |
| F7 / `ai-proofread` menu command                                                                      | `ai`              | `App.tsx` `runAiProofread` returns early                                                                                                              |
| AI tool `web_search`                                                                                  | `webSearch`       | `ai/docs-skill.ts`                                                                                                                                    |
| AI tool `image_search`                                                                                | `imageSearch`     | `ai/docs-skill.ts`                                                                                                                                    |
| AI tool `generate_image`                                                                              | `imageGeneration` | `ai/docs-skill.ts`                                                                                                                                    |
| AI panel "Buy plan" button                                                                            | `billing`         | `ai/AiPanel.tsx`                                                                                                                                      |

The 7 entries from `docs/web-spike/hide-flags.md` that still showed on the web
(`zoteroCommand`, `setDocPassword`, `openNewTab`, `listDocsTabs`, `focusDocsTab`,
`getAutoSaveDefault`, `createDocument`) are covered by the `zotero`, `docPassword`, `tabs`,
`autoSaveToDisk` and `createDocument` rows above. `aiOpenBilling` is the `billing` row.

## AI bridge stays stubbed (`ai.ts`)

No model or network call. Each method answers with a typed `ai-unavailable` result that
fits its `DesktopApi` return type (`isAiUnavailable(error)` matches the prefix):
`aiChat` `{ok:false}`, `aiStream` one `error` chunk, `webSearch`/`imageSearch`
`{method:'error', error}` (the renderer already treats that as a failure, not "no results"),
`aiGenerateImage` `{error}`, `fetchImage` `null`, `aiGskStatus` `{loggedIn:false}`,
`getAiSettings` an empty valid config. The spike's canned demo replies are gone.

## BROWSER class (`browser.ts`)

- **print**: `window.print()` of the frame (an iframe prints only its own document). A
  temporary `@media print` sheet sets `@page {margin:0}`, `print-color-adjust: exact` on
  the document pages (cell fills / highlights print like Electron's `printBackground`),
  and neutralises the preview print-zoom (a browser cannot print at the inverse scale).
  `data-theme` is pinned to `light` for the job and restored on `afterprint`, so the output
  is the same whatever UI theme the user has (CLAUDE.md rule 4; the dark page is already
  `@media screen`-only). `print()` resolves on `afterprint` (Chromium blocks in print();
  Firefox/Safari return at once and the renderer clears its print state when this settles).
  Verified: print-media bitmap of the first page is pixel-identical for a dark and a light UI
  (`web/e2e/w4-hide.spec.ts`).
- **downloads**: `downloadBlob` / `downloadBytes(name, bytes, mime)` through Blob +
  `<a download>`, file name sanitised (`safeFileName`). For W3's export / save-a-copy.
- **open-external**: `window.open` is guarded at bridge load (`guardedOpen`): http(s) only,
  always `_blank` with `noopener,noreferrer`, anything else returns `null`. The renderer's
  Ctrl/Cmd-click on a document hyperlink (`App.tsx` `window.open(href)`) goes through it, so a
  document-authored link can never get a `window.opener` handle to the same-origin UniWork page.
  `openExternal(url)` is exported for host-side use.
- **clipboard**: `copyImageToClipboard` (image/png + text/html) already existed; unchanged.
- **file picker**: `pickImage` / `pickAttachments` unchanged; `pickFiles` is now exported.

## Open items / notes for the lead

- The Protect dialog description (`appProtectDesc`, 19 locales) still says "open and modify
  passwords" on the web. Not changed: it needs a string variant in every shard.
- `autoSaveToDisk` is `false` on the web. If W3 wants a server-backed autosave later, flip the
  capability (or add a new key) rather than reviving the toggle.
- Paper size for print comes from the browser's print dialog (desktop does the same via
  the default printer); mixed-paper documents are not grouped into separate jobs on the web.
- Hosting iframe must not use `sandbox` without `allow-downloads allow-modals` (`window.print`,
  `<a download>`).
- Tests: `apps/docs/tests/web-capabilities.test.ts` (renderer gating, mounts the real Ribbon /
  ContextMenu / ProtectDialog), `web/docs/bridge/hide.test.ts`, `web/docs/bridge/browser.test.ts`,
  Playwright `web/e2e/w4-hide.spec.ts`; screenshots in `docs/web-docs/screenshots/w4/`.

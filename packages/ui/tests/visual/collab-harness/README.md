# Collab visual harness (G8-20)

A Vite page that mounts the real shared collab components (`CollabPanel`, `CollabComposer`, the mention
picker, the body renderer, the anchor label) with `tokens.css` + `collab.css` and a fake `CollabSource`.
It is a test-only tool for the visual stage: it is not imported by any app, vitest does not load it (the
vitest `include` is `tests/**/*.test.ts`) and the package `tsc` only covers `src`.

## Run

```sh
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd packages/ui
npx vite tests/visual/collab-harness --port <free port> --strictPort   # serves http://127.0.0.1:<port>/
```

`vite` and `@vitejs/plugin-react` come from the root `devDependencies`; the config is `vite.config.ts` next to this
file. Stop the server by its PID when you are done.

## URL parameters

| Parameter | Values                        | Effect                                                                 |
| --------- | ----------------------------- | ---------------------------------------------------------------------- |
| `theme`   | `light` (default), `dark`     | sets `data-theme` on `<html>`                                          |
| `lang`    | `vi` (default), `en`          | the UI language of every panel (`collabStrings(lang)`)                 |
| `width`   | `300`, `360` (default), `420` | the side-panel column width                                            |
| `only`    | a section id                  | render just that section (see below why this matters for focus states) |

The toolbar buttons change the same parameters (the URL follows). Section anchors: `#<section id>`.

## How states are produced

Each section is one panel with its own fake source. After the first list settles, the page plays a short script
(clicks, typing, one reload) one section at a time, so the section shows the state a person would reach. The
**Replay** button on a section remounts it and plays the script again.

Focus-dependent states (the S14 picker rows and the delete dialog's focus ring) only hold while their control keeps
focus, and a later section would take it away. In the all-sections view they wait for **Replay**; opening with
`?only=<id>` plays them straight away. Take screenshots of those with `only` (or press Replay and capture at once).

`pointer: coarse` cannot be switched from the page: the toolbar shows the live value. Open the page with touch
emulation (for example Playwright `hasTouch: true, isMobile: true`, or the Chromium device toolbar) to see the 44px targets.

## Sections

| Id                                                                               | What it shows                                                                                      |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `s12-list-docx` / `s12-list-xlsx` / `s12-list-pptx` / `s12-list-pdf`             | list with exact, stale and lost anchors per format (docx cut long quote, xlsx other-sheet label)   |
| `s12-resolved`                                                                   | resolved group opened, Resolved badge, Reopen, a reply thread inside it                            |
| `s12-tombstone`                                                                  | deleted root, deleted reply between live ones                                                      |
| `s12-thread-replies`, `s12-replies-collapsed`                                    | thread with replies; body with current-name mention, unavailable mention, bold, italic, code, link |
| `s12-reply-composer`, `s12-new-thread`                                           | reply composer open; root composer at an anchor (the editor's Comment command)                     |
| `s12-edit`, `s12-history`, `s12-history-error`, `s12-delete-dialog`              | inline edit, edit history (with versions / failed), delete confirm                                 |
| `s12-view-only`, `s12-level-own`                                                 | view-only level (no actions); own-comments-only level                                              |
| `s12-status-offline`, `s12-status-server-error`, `s12-status-signed-out`         | the three status lines after a good load                                                           |
| `s12-loading`, `s12-empty`, `s12-load-error`, `s12-no-access`                    | panel states                                                                                       |
| `s12-conflict-deleted`, `s12-notice-deleted`                                     | send hits `comment_deleted`; a reveal of a deleted comment                                         |
| `s13-discussion`, `s13-discussion-empty`, `s13-discussion-view-only`             | Discussion with composer (posts, resolved post, deleted post), empty, view-only                    |
| `s14-results`, `s14-searching`, `s14-no-match`, `s14-no-candidates`, `s14-error` | the @ picker rows, typed into the Discussion composer (`@Mi`, `@slow`, `@zz`, `@`, `@boom`)        |

## Files

- `index.html`, `main.tsx` — the page, the scenario table and the autoplay.
- `fixtures.ts` — comments, anchors, the body fixture, revisions. `fake-source.ts` — the `CollabSource` fake.
- `harness.css` — page chrome, tokens only. The host accent (`--accent`, `--accent-soft`) is defined in `index.html`.

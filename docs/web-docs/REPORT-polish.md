# Web polish lane for the six genoffice modules inside UniWork web: lane report (GO-B8)

Ticket UNI-1232, parent UNI-1001. Fork lane branch `feature/UNI-1232-web-polish` (uniwork-office, base `f50a745` =
the end of the B456 lane); UniWork lane branch `feature/UNI-1232-office-web-polish` (dev-uniwork, base `12cae471f`).
The lane continues `docs/web-docs/REPORT-modules.md` (GO-B4/B5/B6): it fixes every minor and nit that visual round 2
left on Docs, PDF, Markdown, HTML, Slides and Sheets, and (user addendum of 2026-10-11 UTC+7) builds the web-port
features the user marked as necessary and replaces silent hiding by a clear "use the app" message for the rest.

User order (via the Advisor): "sửa luôn", fix them all now. User decisions applied (addendum A, B, C of the brief):

- **A, build now**: images over asset routes; Sheets stale dependents and the Name Box; view-only correctness; AI
  chip and late credentials; Markdown/HTML export; draft-recovery data loss; Open in desktop app.
- **B, do not build**: the feature stays in the app; the web says "Open in the UniWork Office app to use this feature"
  (vi "Mở trong ứng dụng UniWork Office để dùng tính năng này") with the Open-in-app action.
- **C**: the AI bridge is tested with a real model vendor on the test machine (section 5).

Times in this report are UTC, taken from the lane log (`.uniwork-lane/STATUS.md`). Where a source does not say, the
report says "not recorded". Rule used for every "fixed" below: a commit is named; "explained" names the reason;
"re-check pending" means the fix landed after visual round 3 and the final targeted visual re-check has not run yet.

## 1. Summary

**What the lane delivered.** 83 fork commits (`f50a745..f7930bc`, merges included) and 29 dev commits (`12cae471f..edf466059`), made by
workers (one per module group, then per addendum feature, then per review or CI finding) under one lead.

- **Round-2 polish**: every minor and nit of the six modules and the cross-module bullets of REPORT-modules section 7 is
  fixed, explained, or listed as an open nit (seven nits are marked "not recorded": the lane log has no fix and no
  reason for them; section 9).
- **All seven addendum A features** are built and were exercised by visual round 3 in a browser (section 3), with one
  limit each where it applies.
- **Addendum B**: PDF OCR, Convert to Office and Redact, Docs Zotero / open password / encrypted `.docx`, HTML preview
  `fetch`/XHR and nested frames, Slides linked media and print-quality PDF now show the localised use-the-app message
  and the Open-in-app action instead of hiding or failing (section 4).
- **Security**: a read-only review of the A1 image/sibling-file routes found one major (a plain frame token of any
  module could read any viewable picture/CSS/JS file by id); it is fixed in dev `77141d724` and pinned by tests; every
  other finding is fixed except one pre-existing nit (section 6).
- **AI**: tested against a real OpenAI-compatible model in vi and en in every module but HTML; chip, error copy once,
  and credentials saved after boot work (section 5).

**Verdicts at the time of writing** (code under test is not yet the final code; final values are in section 10):

| Check                                                    | Code under test                  | Result                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual round 3 (`tester_visual`, three reports, 9 crit.) | fork `2161dd6`, dev `c52be8447`  | **All six modules PASS**, 0 blocking, 0 major; minors 4 + 2 + 7, nits 8 + 7 + 10 (section 7)                                                      |
| Fork cloud CI replica r2                                 | `2161dd6`                        | `office-ci-test` PASS, `web-ci` PASS, `office-ci-e2e` FAIL only `markdown-tab.spec.ts:101` (pre-existing test race, fixed test-only in `69c9ea9`) |
| Dev cloud r1 / r3                                        | `e17a2c55a` / `c52be8447`        | ts 8/8 PASS, e2e PASS, go PASS except the known `TestPlanSubcommandWritesJSON` (r2 e2e = stale ports on a warm VM, rerun r3 PASS), section 8      |
| Fixes after round 3 (FX2, FX3, DX, FX4)                  | fork `f7930bc`+, dev `edf466059` | merged locally; exact-file tests green; **visual re-check and cloud rounds pending** (final verdicts: section 10)                                 |

**Open at the time of writing.** (1) FX4 (the shared host-save conflict sentence for Docs, PDF, Markdown and HTML) was
still running; it is not in this report's code base. (2) Seven round-2/round-3 nits have no fix and no reason in the lane
log (section 9). (3) Items that visual round 3 could not verify on its host: the Slides fullscreen gesture warning, the
Slides linked-media message (no fixture), the Sheets raw "(Internal Server Error)" hint, the Sheets console warning, the
encrypted `.docx` message, and the installer download (no installer URLs on the test host).

## 2. Round-2 items: one row each

Sources: the round-2 reports (`visual-r2-src/<module>-r2.md`, ids as the tester wrote them) and REPORT-modules section 7.
Commits are `fork` unless prefixed `dev`. Round-3 column = what `tester_visual` saw on fork `2161dd6` / dev `c52be8447`
(reports in section 7); "fixed after r3" rows name the commit that closes the round-3 leftover.

Worker streams referenced: **XS** shared pieces, **DP** Docs + PDF, **MH** Markdown + HTML, **SS** Slides + Sheets,
**A7DV** dev host polish and app.open, **DP2/SA/A1F/A4** addendum workers, **FX/MT/FX2/FX3/DX** CI and visual r3 fixes,
**FL** the earlier frame-load fallback (already in dev `12cae471f`).

### 2.1 Cross-module bullets of REPORT-modules section 7

| Id  | Item                                                               | Status                                                                                                                                                                                                                                                              | Commits                                                                                      | Round 3                                                                                                    |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| X1  | 390 px layouts cramped (Docs, Markdown, Slides, HTML)              | fixed per module (rows below); Docs zoom floor 60 %, Markdown gutters, Slides canvas 26 % (was 14 %), HTML chip + bottom-sheet inspector                                                                                                                            | `1aeab0c`, `b328e81`, `0eeadf0`, `bca3176`, `6f12b3b`, `00f6199`, `9229918`; dev `3df8aa564` | usable in all modules; leftovers explained or fixed after r3 (Slides icon size: section 9)                 |
| X2  | Spurious "Saved" toast after a language switch                     | fixed: it was the host preference toast, not a frame save; it now names the preference ("Language preference saved", in the chosen language)                                                                                                                        | dev `032b9fd58`                                                                              | fixed in all six                                                                                           |
| X3  | AI error doubled; provider name differs from the chip or by locale | fixed: a failed chat turn shows once, inline; key copy is vendor-neutral in 21 locales; chip shows the configured model (A4); Sheets ribbon hint and status bar stopped echoing it                                                                                  | `575ca58`, `0ee7e08`, `78fce81`, `6046dfc`, `375ebff`                                        | fixed everywhere; Slides en "Error:" prefix removed after r3 (`375ebff`)                                   |
| X4  | Frame dialogs lighter than the host leave dialog                   | fixed: close X, filled safe primary, host scrim token `--color-dialog-scrim`, host-like order; the draft dialog gets a page sheet behind it; AI settings and the use-the-app dialog moved into the family after r3; dev pins the host leave dialog as the reference | `385c3ca`, `c258273`, `854fab2`, `9fe49dc`; dev `1b6a888dd`                                  | one family, except AI settings and use-the-app dialog (fixed after r3, re-check pending)                   |
| X5  | Dark-theme Restore button contrast about 2.8:1                     | **not reproducible** at `f50a745` (primary is `#0d1220` on `#5a96ff` = 6.44:1 dark, 6.25:1 light); a WCAG test now pins every dialog button tone in light, dark and system-dark                                                                                     | `385c3ca`                                                                                    | measured 6.4:1 in dark by the tester                                                                       |
| X6  | Conflict dialog default focus                                      | changed twice: XS focused the safe primary (Reload latest); r3 showed Enter on it discards the user's edits, so the final default is **Cancel**                                                                                                                     | `385c3ca`, `549c273`                                                                         | r3 liked Reload latest for HTML (N-06) but flagged it for Slides (N3-11); final = Cancel, re-check pending |

### 2.2 Docs (generic host)

| Id          | Item                                                        | Status                                                                                                                                     | Commits                                          | Round 3                                                                                           |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| N-01 (F-03) | 60 s silent skeleton before the G3 fallback                 | fixed by FL before the lane ("taking longer" at ~8 s, auto fallback at ~25 s)                                                              | dev (in `12cae471f`)                             | fixed (10 s hint, fallback before 30 s)                                                           |
| N-02 (F-05) | 390 px: 29-36 % zoom, ribbon cut, no Save button            | fixed: 60 % width-fit floor, ribbon overflow cue + tab edge shadow, header Save button, desktop actions in "More actions"                  | `1aeab0c`, `353a89f`, `dcd5a05`; dev `3df8aa564` | fixed; status bar still clipped (D-N1), fixed after r3                                            |
| N-03 (F-08) | "Saved" toast after a language switch                       | fixed (X2)                                                                                                                                 | dev `032b9fd58`                                  | fixed                                                                                             |
| N-04 (F-10) | Status ellipsis; English "Opened ..." in vi                 | fixed: the status is kept as key + params and translated when drawn; shorter zoom slider; phone status bar keeps page, save state and zoom | `1aeab0c`, `b328e81`                             | vi fixed; ellipsis with both comment panes open remains, 390 px fixed after r3 (re-check pending) |
| N-06 (F-12) | Focus on the frame body after the leave dialog              | fixed: the bridge refocuses the last editing surface on a pointer-less window focus; the host hand-back is pinned by a dev test            | `1aeab0c`; dev `1b6a888dd`                       | fixed (4/4 checks)                                                                                |
| N-08        | AI error vendor-specific and doubled                        | fixed (X3)                                                                                                                                 | `575ca58`                                        | fixed                                                                                             |
| N-05        | Table style gallery labels truncated                        | fixed: cards size to their label, `aria-label`                                                                                             | `1aeab0c`                                        | fixed; "Table Grid" stays English in vi (D-N2): not recorded as fixed                             |
| N-07        | Frame dialog buttons outlined, no filled primary            | fixed (X4)                                                                                                                                 | `385c3ca`                                        | fixed                                                                                             |
| F-11        | Comment author truncated                                    | fixed: wraps, tooltip; date and icons drop to a second line                                                                                | `1aeab0c`, `353a89f`                             | fixed (a 120-character author wraps over 7 lines)                                                 |
| F-13        | Empty font-name box                                         | fixed: names the page default (Calibri)                                                                                                    | `1aeab0c`                                        | fixed                                                                                             |
| F-02, F-14  | Viewer has no Open in desktop; installer menu has two items | explained: by design, the same rule as the G3 host                                                                                         | n/a                                              | by design; the viewer has one banner now                                                          |

### 2.3 PDF

| Id     | Item                                              | Status                                                                                                                     | Commits                                    | Round 3                                                                                                      |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| PDF-02 | Raw English HTTP status in the vi save toast      | fixed: `saveFailureText` maps every code and status (8 keys x 21 locales); Docs, Slides and Sheets call it too             | `4bb727f`                                  | fixed                                                                                                        |
| PDF-04 | "Unsaved"/"View only" repeated in three places    | fixed: capabilities `saveStatus` and `viewOnlyChip` are false on the web; PDF keeps no ribbon-row copy (`ribbonSaveState`) | `7f6d181`, `4b10f12`, `353a89f`            | fixed (one banner, header "Unsaved" only)                                                                    |
| PDF-07 | vi ribbon "Xuất hình ảnh" clipped, no cue         | fixed: shared edge fade + chevron; a late-rendered ribbon (PDF renders it after load) also gets it                         | `dcd5a05`, `353a89f`, `7aa26d4`            | fixed                                                                                                        |
| R2-01  | Vendor name differs per locale                    | fixed (X3)                                                                                                                 | `575ca58`                                  | fixed                                                                                                        |
| R2-04  | Slow boot, skeleton about 65 s                    | fixed by FL                                                                                                                | dev (in `12cae471f`)                       | fixed                                                                                                        |
| PDF-03 | Save failure shown three times                    | fixed: header chip + one toast                                                                                             | `4b10f12`, `4bb727f`                       | fixed                                                                                                        |
| PDF-05 | Sign / Add-text dialogs black primary             | fixed: the web frame follows the host blue dialog token; the desktop keeps its look (`html[data-web-frame]`)               | `4b10f12`                                  | fixed                                                                                                        |
| PDF-06 | 390 px: tab row wraps, ribbon without cue         | one-line tab row that scrolls, 60 % zoom floor, ribbon cue; the page is pannable inside the slot after r3                  | `4b10f12`, `353a89f`, `1befadc`, `25f6551` | partly: last tab cut without cue (P-N1, not recorded as fixed); page cut at the right (P-N4, fixed after r3) |
| PDF-09 | "Saved" toast after theme/language switch         | fixed (X2)                                                                                                                 | dev `032b9fd58`                            | fixed                                                                                                        |
| PDF-10 | AI panel open by default at 1440                  | explained: by design (open at 1440, collapsed at 390 and 768)                                                              | n/a                                        | by design                                                                                                    |
| R2-03  | Add-text dialog focus on the font-size input      | fixed; the fixing commit is not recorded in the lane log                                                                   | not recorded                               | fixed (the text area is focused)                                                                             |
| R2-02  | Hint after placing text reads "Click an image..." | not recorded: no fix and no reason in the lane log                                                                         | n/a                                        | not re-exercised                                                                                             |

### 2.4 Markdown

| Id           | Item                                                     | Status                                                                                                                                                                            | Commits                               | Round 3                                                                   |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| MK-02        | Relative image without an asset: unexplained placeholder | fixed: placeholder shows the path and "Not shown: this image was not uploaded with the document." (vi too). With A1 relative images of an existing document now resolve           | `0eeadf0`, `3f56256`; dev `8721b4457` | fixed                                                                     |
| MK-06        | Raw HTML block has no "inert" label                      | fixed: "HTML kept as-is, not shown" label in a fixed band (does not move the blocks)                                                                                              | `0eeadf0`, `b2cedac`                  | fixed                                                                     |
| MK-07        | Mermaid error English in vi                              | fixed: localised title, technical details collapsed                                                                                                                               | `0eeadf0`                             | fixed                                                                     |
| MK-09        | Source mode: combining marks wrong in the mono font      | fixed: a Vietnamese-safe mono font stack                                                                                                                                          | `0eeadf0`, `00f6199`                  | mostly fixed (long-line behaviour not provoked)                           |
| R2-01        | 60 s silent skeleton                                     | fixed by FL                                                                                                                                                                       | dev (in `12cae471f`)                  | fixed                                                                     |
| R2-02        | 390 px gutters of about 72 px                            | fixed: about 16 px, table scrolls inside its wrapper                                                                                                                              | `0eeadf0`, `f5821a3`                  | fixed                                                                     |
| R2-03        | 390 px viewer title collapses to one letter (host)       | fixed: on a phone the back control replaces the crumbs and the title truncates at the tail only, full name as tooltip                                                             | dev `3df8aa564`                       | fixed                                                                     |
| R2-05        | AI error twice; provider vs chip                         | fixed (X3)                                                                                                                                                                        | `575ca58`, `0ee7e08`                  | fixed                                                                     |
| R2-06        | View-only announced 3 times; AI composer enabled         | announcement: fixed (one banner). Composer: **explained**, fixed by GO-A9 (fork `a22f9071`, lands on fork main later), not redone here                                            | `5d37a31`, `0c92112`; dev `3df8aa564` | one banner; composer still enabled on this code, as expected before GO-A9 |
| R2-07        | Draft dialog on a flat scrim                             | fixed: the dialog runs before the first render, so a faint blurred page sheet is drawn behind it (tokens only)                                                                    | `385c3ca`, `c258273`                  | mostly fixed; the scrim fix landed after r3, re-check pending             |
| R2-08        | "Save could not be confirmed" stays after an edit        | fixed in three steps: protocol client re-sends dirty after a failed save, host re-enters Unsaved on dirty, and both renderers now report every edit (root cause of the r3 repeat) | `0c92112`; dev `78afa5dfd`; `4827fee` | r3 still saw it (N3-02); `4827fee` landed after r3, re-check pending      |
| MK-03, MK-08 | Viewer has no desktop button; mermaid card white in dark | explained: by design (G3 rule; document data is never recoloured)                                                                                                                 | n/a                                   | by design                                                                 |

### 2.5 HTML

| Id   | Item                                                      | Status                                                                                                                                                                                                                          | Commits                         | Round 3                                                               |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| H-02 | Frame dialogs vs host leave dialog                        | fixed (X4); the conflict dialog's default focus is now Cancel (X6)                                                                                                                                                              | `385c3ca`, `549c273`            | fixed                                                                 |
| H-04 | 390 px: no save chip; about 110 px of preview with AI     | fixed: AI dock overlays the page, split stacks, status bar wraps with the save state first; host header carries Save                                                                                                            | `00f6199`; dev `3df8aa564`      | fixed                                                                 |
| N-01 | Silent skeleton                                           | fixed by FL                                                                                                                                                                                                                     | dev (in `12cae471f`)            | fixed                                                                 |
| N-02 | AI error twice; vendor name vs chip                       | fixed (X3)                                                                                                                                                                                                                      | `575ca58`                       | fixed                                                                 |
| H-06 | Inspector covers the floating toolbar                     | fixed: a toolbar wider than the room next to the panel wraps; re-measured when stage or panel change (a regression of this fix caught by the CI replica); at 390 px the inspector is a bottom sheet and the toolbar steps aside | `00f6199`, `fc614d6`, `9229918` | fixed at 1440; 390 overlap (N3-04) fixed after r3, re-check pending   |
| H-07 | No hint why AI is missing                                 | fixed: a disabled AI entry with the tooltip "AI is not turned on for your workspace"                                                                                                                                            | `00f6199`                       | fixed                                                                 |
| H-08 | "Saved" toast after a language switch                     | fixed (X2)                                                                                                                                                                                                                      | dev `032b9fd58`                 | fixed                                                                 |
| N-03 | "Denied" panel with a useless Try again                   | fixed: states the reason and links back to the document list; retry stays for network and load failures                                                                                                                         | dev `134047e40`                 | fixed                                                                 |
| N-04 | Empty frame and "No changes" while the draft dialog waits | explained: the host gets no signal while a frame dialog is open (A7DV); the page sheet behind the dialog (`c258273`) removes the empty black frame                                                                              | `c258273`                       | unchanged (header says "No changes")                                  |
| N-05 | vi viewer banner mixes the English "edit"                 | fixed (dev vi copy)                                                                                                                                                                                                             | dev `3df8aa564`                 | fixed                                                                 |
| N-06 | Cancel carries the default focus in the conflict dialog   | changed twice (X6): XS made Reload latest the default, FX2 then made Cancel the default because Enter on Reload latest discards edits                                                                                           | `385c3ca`, `549c273`            | r3: default was Reload latest (liked); final Cancel, re-check pending |
| H-05 | Viewer has no Open-in-desktop                             | explained: by design                                                                                                                                                                                                            | n/a                             | by design                                                             |

### 2.6 Slides

| Id   | Item                                                  | Status                                                                                                                                                                                           | Commits                         | Round 3                                                    |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------- |
| S-07 | Presenter View chrome 11-12 px, low contrast          | fixed: 14 px controls and labels, 44 px round tools, no dim text (a CSS test guards it); timers 22 px                                                                                            | `bca3176`                       | fixed                                                      |
| S-09 | Fullscreen user-gesture warning                       | fixed by code: the show and presenter view skip the second fullscreen request on the web; **not verified** in a headed browser                                                                   | `980da03`                       | not verifiable (headless)                                  |
| S-10 | AI panel clips the Home ribbon at 1440                | explained: the panel is by design; the shared overflow cue (fade + chevron) now shows that more is there                                                                                         | `dcd5a05`                       | mitigated, nit                                             |
| S-11 | Leave dialog title tight                              | fixed (host dialog); the fixing commit is not recorded                                                                                                                                           | not recorded                    | fixed                                                      |
| N-01 | 60 s silent skeleton                                  | fixed by FL                                                                                                                                                                                      | dev (in `12cae471f`)            | fixed                                                      |
| N-02 | Mocked `can_edit:false` canvas still takes typing     | fixed: a frame without the save grant answers `uniworkState` read-only, so Reading view stays and the canvas, cell and notes editors never open (real viewers still get the G3 viewer by design) | `bca3176`                       | fixed                                                      |
| N-03 | 390 px: canvas 14 %, ribbon tabs clipped, icons small | canvas fits (26 %), thumbnails hidden, tab row scrolls with a chevron and 44 px tabs; ribbon-body icons stay below 44 px (explained: a fixed 80 px band)                                         | `bca3176`, `fe9e540`, `6f12b3b` | improved; tab cue fixed after r3 (N3-06), re-check pending |
| N-04 | Dark Restore contrast 2.8:1                           | not reproducible (X5)                                                                                                                                                                            | `385c3ca`                       | 6.4:1                                                      |
| N-05 | AI error twice, "Error:" prefix                       | fixed: once, inline; the prefix is dropped on the web                                                                                                                                            | `575ca58`, `375ebff`            | doubled copy fixed; prefix fixed after r3                  |
| S-08 | Viewer (G3) shows three notices                       | fixed after r3: no draft banner or "permission required" chip for a pure viewer                                                                                                                  | dev `d6d2a3d1c`                 | open minor in r3, re-check pending                         |

`fe9e540` also fixes a lane regression caught by the cloud replica path: the phone-width fit maths used the stage width
where the CSS keys on the window width (`stage-refit-follow` tests).

### 2.7 Sheets

| Id    | Item                                                                        | Status                                                                                                                                                                            | Commits                                    | Round 3                                                                       |
| ----- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| S-05  | Ribbon cut with the AI panel open; truncated hint                           | fixed: overflow cue; the status hint wraps to two lines with a tooltip. The hint copy itself is **explained** as upstream (the `appFullyLoaded` line of the imported Univer copy) | `dcd5a05`, `78fce81`                       | mitigated, nit                                                                |
| S-06  | Raw "Failed to fetch" / "(Internal Server Error)" in vi                     | fixed: every code and status is mapped to a localised sentence                                                                                                                    | `4bb727f`                                  | not re-triggered (no 500 without mocks)                                       |
| S-07  | Bare loading line; 11 MiB workbook opens G3 unexplained                     | fixed: a loading card with spinner and skeleton rows; one sentence above the standard editor ("too large for the web editor") for the host gate and the frame `too_large` refusal | `78fce81`; dev `60ea119ee`                 | fixed                                                                         |
| S-08  | Viewer hint says "rows/columns editable"                                    | fixed: view-only copy                                                                                                                                                             | not recorded                               | fixed; the sentence then repeated 4 times (N3-05), fixed after r3 (`6046dfc`) |
| S-09  | Console warning `UI_PLUGIN_SHEETS_MENU_ITEM_INPUT_COMPONENT already exists` | fixed: the Enter wrapper replaces the registry entry without the warning and installs once; an e2e asserts no duplicate                                                           | `78fce81`, `2ec44db`                       | not verified (warnings not captured)                                          |
| S-10  | View-only toast covers ribbon controls                                      | explained: transient; toast placement is product-wide (the Toaster), not a Sheets item                                                                                            | n/a                                        | open nit                                                                      |
| R2-01 | 60 s skeleton                                                               | fixed by FL                                                                                                                                                                       | dev (in `12cae471f`)                       | fixed                                                                         |
| R2-02 | AI error wrong vendor, four times, near-black pill                          | fixed: vendor-neutral copy shown once in the panel; ribbon hint and status bar no longer echo it; the AI settings dialog follows the frame dialog family after r3                 | `575ca58`, `78fce81`, `6046dfc`, `854fab2` | fixed; settings dialog re-check pending                                       |

### 2.8 Not exercised by the testers in round 2 (REPORT-modules section 7, last bullet)

The frame-fatal dialog cannot be triggered from outside and is still unexercised. AI with a real provider is now
exercised (section 5). The HTML Present menu and a second display for the Slides audience window are still unexercised.

## 3. Addendum A: features built

### A1. Images and sibling files (Markdown, HTML)

**Built.** The host fills `open.assets` with same-origin signed URLs and grants `images` over asset routes; a picture
pasted or dropped into Markdown/HTML uploads as a document asset instead of a `data:` URI.

- **Resolution order** for a relative path: a document asset stored under that name (newest wins), then a sibling
  file document found by walking the Documents tree from the document's folder (`..` only up to the workspace root;
  every target passes its own view ACL). PNG, JPEG, GIF, WebP and SVG pictures, plus CSS and JS for the HTML preview.
- **Server** (dev): new signed GET/HEAD `/office-frame/documents/{documentID}/linked/{linkedDocumentID}`
  (`?sig=` only after RA-1), `Content-Type` from an extension allow-list checked against the stored type, `sandbox`
  CSP, `nosniff`, `no-store`. Documents accept GIF, WebP, SVG, CSS and JS as file documents (the other pipelines map
  them back to `text/plain`). `POST .../assets/resolve` (`api.assets.resolve`) returns fresh signed URLs for paths typed
  after the open and for the 1 h expiry. Next rewrites make the two byte routes same-origin.
- **Frame** (fork): the asset store reads the map with paths as written (with or without `./`, percent-decoded),
  treats a 401/403/404/410 URL as missing (one HEAD probe), draws the explained placeholder, re-signs after about
  50 minutes, asks the host for paths typed after the open, and builds the HTML preview with the folder's CSS, JS and
  pictures inlined (preview CSP deliberately unchanged). A picture on screen is never baked into the file.
- **Commits.** Dev: `5b9989862` (contract), `db1485391`, `8721b4457`, `79d04e464`, `f6c9bf87f` (e2e),
  `61e56762d` (contract A1b), `77141d724`, `efdc2e9e2` (`api.assets.resolve` in the vendored protocol and host),
  `3cb125e30`, `e17a2c55a` (contract notes). Fork: `3f56256`, `9d52457`, `5bfa998`, `4c239bc`, `87e25c2`, `b3701f5`.
- **Verified.** Go handler, service, document and isolation tests and vitest by the workers; the security review
  (section 6); dev cloud r1 and r3 run `office-markdown-assets-web.spec.ts` green; visual round 3 (Markdown): relative PNG,
  WebP, SVG and a sibling render, a missing one shows the explained placeholder, a pasted picture uploads
  (`POST .../assets` 201, source shows `![pasted-pic](assets/image-....png)`, no `data:`); (HTML): a page with a
  sibling `style.css`, `script.js` and a picture renders styled in vi dark, en light and 390 px.
- **Limits.** A pasted SVG stays a `data:` URI (assets accept only PNG/JPEG/GIF/WebP uploads). Asset URLs are
  signatures in a query string (reverse-proxy logs keep them); they live 1 h for Markdown/HTML and 10 min for Docs.

### A2. Sheets: stale dependents and the Name Box

**Built (safe choice, documented).** Before, a save patched only the cells the user edited, so a formula depending on an
edited cell kept its old cached `<v>`. Now the save refreshes every formula cell of the file with the wasm engine's
recalculation when it can replay the save; otherwise (structural or sheet-tab change, a sheet added this session, bulk
fills, pivot output, defined names, above 64 MB, more than 10,000 pending edits, more than 200,000 formulas, importer
failure, engine crash) it **drops the cached value of every formula cell**. A save that cannot change a value touches
nothing. Excel and the desktop recalculate on open (`fullCalcOnLoad`). Commit `71abbd1`; `29b87de` gives the real-engine
wasm tests a 60 s timeout (a 5 s timeout failed under load, not an A2 defect).

**Name Box.** Univer's Name Box selected the typed cell without scrolling to it or streaming its rows in, so the first
edit after a jump back to the already active A1 was refused ("still streaming in"). Enter in the Name Box now goes
through `goToReference` first (reveal, grid focus, explicit `loadVisibleRange`). Commit `5547ab6` (the e2e helper no
longer goes through another cell first).

**Verified.** Unit tests and e2e by the worker; round 3 on `Book Formula Chain.xlsx`: A1 10 -> 15 and saved, reopened in
a fresh browser B1 = 30 and Sheet2 C1 = 31 (the stale values would be 20 and 21). The tester cannot tell from the UI
whether the saved file holds refreshed or dropped cached values (the editor recalculates on open). Name Box: Ctrl+A,
`E5`, Enter, typing lands in E5. Not covered by any cloud run: the replica VM has no Rust sidecar, so a formula-bearing
save is untestable there (also true on bro, section 8).

### A3. View-only correctness

**Built.** The Markdown source panes (CodeMirror and the plain textarea) are read-only in view-only, so a viewer can no
longer type into the source and make the document dirty (`58c2d52`; the Source button is disabled, the HTML source pane
has `contenteditable=false`). A Slides frame without the save grant answers `uniworkState` read-only, so the canvas,
cell and notes editors never open and the header never says "Unsaved" (`bca3176`).

**Verified.** Round 3: Markdown viewer typing ignored; HTML source `contenteditable=false`; Slides with a mocked
`can_edit:false` token shows only Slide Show and View, no AI panel, no Save, and typing does nothing. Real Slides viewers
still get the G3 viewer by design. The view-only AI composer is GO-A9's (`a22f9071`), not redone.

### A4. AI: chip label and late credentials

**Built.** The web bridge used to return an empty `apiKey` for every provider, so the picker fell back to the UniAI
default and the chip read `openrouter/auto` in every module. A provider with a key stored in UniWork now carries its
masked key hint (never sent; the proxy transport drops it), the UniAI pool is not offered on the web, and with no key the
chip neutrally says "Choose model". The credential list used to be cached for the frame's lifetime; it now goes stale
after 4 s and on window focus or tab visibility, every AI call and settings read re-fetches when stale, and a new
`onAiSettingsChanged` member tells each panel's chip. Commits `0ee7e08`, `7aa26d4` (the overflow cue also mounts on a
ribbon rendered after the hook); related shared work `575ca58` (error once, vendor-neutral key copy in 21 locales) and
`265f6ef` (a stored key with no known model asks for a model instead of showing "Request refused"; a model-less provider
that lists exactly one model on its own `/models` route runs on it).

**Verified.** Section 5 (real model, vi and en). Round 3 confirmed the chip shows the configured model, the error copy
is neutral and shown once, and a key added or removed through the credential API while the page stays open is used by
the next send with no reload. Limit: the chosen model is stored per browser (section 9).

### A5. Markdown/HTML export on the web

**Built.** Both ribbons carry an export button in the web frame (platform web only): Export Word for Markdown, Export
HTML for HTML, through the existing bridge `exportDocx` / `exportHtml`; the entry stays usable in view-only because
exporting changes nothing. Commit `58c2d52`; e2e `87e25c2` (also view-only). **Verified.** Round 3: `Markdown Kitchen Sink.docx` and
`Html Single File.html` download.

### A6. Draft-recovery data loss

**Built.**

- Sheets re-drafts edits made after a Restore: the desktop recovery tick stood down once a session was restored (the copy
  on disk backs it), which is wrong for the web's IndexedDB record; the tick keeps running (`bf61883`, e2e for Sheets and
  Slides).
- HTML visual-style edits still waiting for their 600 ms commit are folded into the draft text (`58c2d52`).
- PDF open editor boxes (a comment typed into the margin card, a comment being rewritten, the floating text editor) are
  folded into the draft through a state-free twin of the save-time commit and make the frame report unsaved; Save now
  folds the new-comment card in (`1befadc`, `192c5d4` with the PDF draft e2e).
- Slides text in a text box still in edit mode is drafted (`3803bac`, after round 3).

**Verified.** Round 3: PDF open note box survives Restore ("OPENBOXPROBE" back, header Unsaved); HTML `h1` set to 44 px
in the inspector survives reload and Restore; Sheets: draft A restored, draft B typed after Restore, second reload
offers Restore and shows both; Slides: Restore returns the committed text, a second edit after Restore drafts again.
The Slides box still in edit mode at reload was lost in r3 (N3-02); `3803bac` fixes it, re-check pending. Limit: the
Slides table-cell editor and the notes textarea still commit on blur and are drafted only then.

### A7. Open in desktop app

**Built.** The launch target (GO-A6) and installer URLs (GO-A8) were already in dev; the missing piece was a
frame-callable host request. Fork protocol `f723f28` adds the capability `desktopOpen` (default false) and the additive
request `app.open {feature?} -> {outcome: launched | installer | unavailable}`; the frame side `d42412f` is one helper
that sends it only with the explicit grant, with no request timeout (the host may wait on its unsaved-changes dialog for
as long as the user takes) and swallows rejections, so an old host leaves the message alone. Dev: contract `8370edd45`,
host `09ef34356` (runs the header button's own flow: dirty dialog, launch ticket, deep link, installer prompt) and
`a37556cb5` (vendored protocol identical to the fork commit); `ebd99e7f3` shows a missing installer link as plain text.
Every B message of section 4 relies on it.

**Verified.** Round 3: header button, "Open in app" in a message and the installer menu (Open / Download) are styled
like the host in vi and en, light and dark; the click reaches the dialog "Get UniWork Office for desktop / The desktop
app didn't respond..." with "Install link unavailable" because the test host has no `OFFICE_INSTALLER_DEV_URLS`
(deployment configuration, not a defect; it means the install and launch halves were not seen end to end).

## 4. Addendum B: "Open in the UniWork Office app" items

Rule: class **A** if a web user cannot finish a normal task without the feature, otherwise class **B**. Class B is shown
as the one localised sentence plus the Open-in-app action (only when the host grants `desktopOpen`), never a raw error
and never silent hiding. Classes marked "lead" were decided by the lead during the lane; the others follow the rule.
**No item was classed A**; every A candidate became a build item of section 3.

| Module     | Item                                                                     | Class          | What the web does now                                                                                                                                                                                   | Commit                     |
| ---------- | ------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| PDF        | OCR of a scanned document                                                | B              | one-time notice "This PDF has scanned pages. Text recognition (OCR) is not available here..." + Open in app                                                                                             | `1befadc`                  |
| PDF        | Convert to Office                                                        | B              | the entry stays in the ribbon; its menu explains and offers Open in app                                                                                                                                 | `1befadc`                  |
| PDF        | Redact (found later: it was hidden)                                      | B (lead)       | the entry stays visible and opens the same note (it writes a working copy next to the file)                                                                                                             | `2666ae4`                  |
| PDF        | Text insert/edit with CJK, emoji, symbol fonts                           | B              | the existing "no installed font" message gets the app hint only when the app could draw the text (installed system fonts cover CJK and most symbols, never emoji)                                       | `1befadc`                  |
| Docs       | Zotero group (found later)                                               | B              | the References tab keeps a Zotero entry whose popover explains, with Open in app                                                                                                                        | `37eb637`, `04dfaec`       |
| Docs       | Password to open (found later)                                           | B              | the Protect dialog shows a note where the fields were                                                                                                                                                   | `37eb637`                  |
| Docs       | Encrypted `.docx` (found later)                                          | B (lead)       | **message only**: an encrypted package (compound file with an `EncryptedPackage` stream; a legacy `.doc` is not matched) opens the shared dialog instead of a raw zip error; decrypting it is not built | `37eb637`                  |
| Markdown   | Source mode                                                              | not applicable | the Markdown frame already has a working source view on the web, so no message is owed (the REPORT-modules sentence "no Source mode" is outdated for the source view)                                   | n/a                        |
| HTML       | Preview `fetch`/XHR and nested frames                                    | B              | one amber note above the preview (not inside the document) when the page uses them, with Open in app                                                                                                    | `58c2d52`                  |
| Slides     | External linked media                                                    | B              | click on a linked clip in the show shows the note + Open in app                                                                                                                                         | `8a9d1cc`                  |
| Slides     | Print-quality PDF                                                        | B              | File > "Print-quality PDF..." opens "Available in the app / Open in the UniWork Office app to use this feature"                                                                                         | `8a9d1cc`, `9fe49dc`       |
| Sheets     | Workbook above the web cap (10 MiB host gate or the frame's `too_large`) | B              | opens the standard (G3) editor under one sentence: "This file is too large for the web editor, so it opened in the standard editor."                                                                    | dev `60ea119ee`            |
| Sheets/all | Frame-load failure                                                       | B              | FL: "taking longer" at ~8 s, automatic fallback to the G3 editor with a notice (before the lane)                                                                                                        | dev (before lane)          |
| Markdown   | Pasted SVG upload (found later, A1)                                      | B              | stays a `data:` URI in the document; the picture still displays and saves                                                                                                                               | n/a                        |
| all        | Chosen AI model is not portable across browsers (found later)            | B              | the person types the model name once per browser; needs a server field on the credential to fix                                                                                                         | n/a (`265f6ef` softens it) |
| Slides     | Table-cell editor and notes textarea drafted only on blur (found later)  | B              | the text is protected as soon as it is committed; typing in a text box itself is drafted                                                                                                                | `3803bac`                  |

**Recorded only, not product work** (no message, no code; from the brief): PDF JPX/JBIG2 test fixtures; the PDF save
core on the frame's main thread; the Slides initial chunk carrying all 21 locales; browser gesture rules (fullscreen,
clipboard); draft records kept until sign-out; the asynchronous `pagehide` write.

**Copy rule used.** vi "Mở trong ứng dụng UniWork Office để dùng tính năng này", en "Open in the UniWork Office app to
use this feature"; keys are in the `zh` shard and every sibling locale (the `satisfies` check turns a missing key into
a type error). No internal codes, no git wording in any of them.

## 5. Addendum C: AI testing setup and results

**Setup.** The test stacks were given a real model vendor: the local OpenAI-compatible router on the test machine (the
same one the user's coding agents use), one model, chosen from the AI settings dialog or seeded through the real
credential API. The credential is read from the environment of the seeding script only; it is never printed, logged,
screenshotted or committed, and no endpoint is written into a repo file. Two deliberate test-only mechanisms exist:

- The fork test host's `fake-ai.mjs` can forward chat to a real vendor through environment variables with no defaults
  (used for A4's local proof).
- The product's BYOK routes refuse non-https and loopback base URLs (SSRF guards), so the shared visual host built
  its dev server with an **uncommitted** patch that allows exactly one host:port taken from an environment variable
  (unset = unchanged). The patch lives only in the visual-host worktree and was never committed, pushed or built into
  the tarball. Before every dev merge or push and before each tarball, the lead ran a guard script on the dev lane (clean
  tracked tree, no diff in `service/ai_credentials.go` and `ai/provider/byok_client.go` against `12cae471f`, no
  references to the test variable). Result at every check, including DX before and after its merge: **no SSRF patch**.
  The product's SSRF guards are unchanged.

**Results.**

- A4's local proof (en and vi): with no key the chip says "Choose model"; a key seeded after the page booted is picked
  up without a reload; the answer streams; an error shows once.
- Visual round 3, real model: Docs ("2 + 2 = 4." streams), PDF (a long vi summary streams, Markdown rendered), Markdown
  (answer streamed, status 200), Slides and Sheets (chat answers, "Thinking..." with a stop button, then the answer).
  The chip shows the configured model, never `openrouter/auto`. HTML AI with a real model was not exercised (the shared
  panel was proved on Markdown).
- Error copy: a mocked 502 gives vendor-neutral "AI provider" copy once; a viewer without a key gets "No AI key yet.
  Add an API key in AI settings to use the assistant." once; no vendor is named, so nothing can contradict the chip.
  Other error states (429, 5xx) were not exercised by round 3.
- Late credentials: key removed through the API while the page stays open gives the no-key copy and the chip returns to
  "Choose model"; key added again, the next send in the same page answers.
- Found by this testing: a stored key with no model in this browser gave "Request refused" (G-N1, N3-01, N3-04), fixed by
  `265f6ef` (after round 3, re-check pending). A shared test credential was refused once (HTTP 424) by another run and
  re-seeded; that was a host-sharing artefact, not an app defect.

## 6. Security review of A1

**Review.** A read-only reviewer (RA, Sonnet 5.5 high) read all 31 changed files of the A1 server, host and core diff
(`12cae471f..f6c9bf87f`, merged as `634829934`) against the dev `CLAUDE.md` tenant rules and the A1 contract, and ran
the isolation matrix and the OfficeFrame handler tests on a throwaway database (dropped afterwards). Report:
`.uniwork-lane/review-a1.md`.

**Verdict: changes_required**, 0 blocking, 1 major, 4 minor, 4 nit; 7 of 9 checks passed, check 1 failed and check 3 was
partial.

**RA-1 (major).** `GET .../linked/{docId}` also accepted a plain frame Bearer token of any module and served any
viewable PNG/JPEG/GIF/WebP/SVG/CSS/JS file of the workspace by id, so the "a frame credential binds exactly one
document" invariant was widened to every viewable picture of the workspace. The isolation matrix passed only because its
control read the picture through a DOCX token. **Fix (DV2, dev `77141d724`):** the route accepts only the `?sig=`
minted for that one file (Markdown and HTML modules only); the matrix uses signed URLs and gains a negative (a DOCX or
PDF Bearer on `/linked/` is refused).

**Other findings.**

| Id   | Severity | Finding                                                             | Outcome                                                                                                            |
| ---- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| RA-2 | minor    | asset URL TTL raised to 1 h also for Docs                           | fixed: 1 h only for Markdown/HTML, Docs keeps 10 min; `assets/resolve` (A1b) lets long sessions re-sign            |
| RA-3 | minor    | up to ~10^3 ACL queries per open                                    | fixed: reuses rows in hand, caps distinct ACL checks at 100 per call                                               |
| RA-4 | minor    | missing negative tests                                              | fixed: cross-workspace, trashed after signing, member removed, forged signature, expiry, signed path in the matrix |
| RA-5 | minor    | `..` walk ignored archived ancestors                                | fixed: the walk stops at an archived ancestor and needs view on it                                                 |
| RA-6 | nit      | Next rewrites forward cookies on same-origin `<img>`/`<link>` loads | accepted, documented in the contract ("cookies on frame loads"); credentials are omitted only for `fetch`          |
| RA-7 | nit      | asset upload writes an audit row but no outbox event                | **skipped**: pre-existing, not in this diff, no catalogue entry owed                                               |
| RA-8 | nit      | WebP check reads only 30 bytes                                      | fixed: RIFF size and first chunk size must fit the file (`3cb125e30`)                                              |
| RA-9 | nit      | `isFrameRoute` is a prefix test                                     | fixed: strict frame-route pattern                                                                                  |

**What is guarded (passing checks).** Tenant-scoped queries only (no new SQL, no migration); the tree walk cannot leave
the workspace and every downward folder and the target go through the view ACL; the signature kind prefix is inside the
MAC (`ofa1`, `ofl1` and `oft1` are not interchangeable), it binds document, target, user, workspace and organisation,
expires, and is compared in constant time; every response carries `Content-Security-Policy: sandbox; default-src 'none'`,
`nosniff` and `no-store`, the content type comes from an allow-list AND the stored type, never from the request, and
SVG/CSS/JS are `attachment`; uploads are capped at 10 MiB, sniffed, PNG/JPEG/GIF/WebP only (no SVG), with an audit row in
the same transaction; path normalisation refuses absolute paths, schemes, control characters and empty segments, caps
at 16 segments, 512 bytes, 200 references and 2,000 children per folder; the Next rewrite has two fixed sources, a fixed
destination origin and ULID-only ids; the API rules (SDI/SDO, error codes, `parseWithFallback` with a malformed-response
test) hold.

**Verification after the fix.** The lead read the RA-1 auth change, re-ran the core and views tests, and dev cloud r1 on
`e17a2c55a` ran the Go handler and service packages (including the isolation matrix with signed URLs) green. No second
independent review of the DV2 diff was recorded.

## 7. Visual round 3

Three `tester_visual` sessions (Sonnet 5.5 medium, 9 criteria, severity per finding, vi and en, light and dark, 1440 and
390 px) on one shared host with the final pins: fork `2161dd6` (bundles `0.1.0-2161dd6`), dev `c52be8447`, real AI.
Reports: `.uniwork-lane/visual/docs-pdf-r3.md`, `markdown-html-r3.md`, `slides-sheets-r3.md`.

| Report          | Verdict  | Blocking / major / minor / nit | Notes                                                                                                         |
| --------------- | -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Docs + PDF      | **PASS** | 0 / 0 / 4 / 8                  | every round-2 item fixed or explained; all Docs and PDF addendum features work                                |
| Markdown + HTML | **PASS** | 0 / 0 / 2 / 7                  | round-2 items: Markdown 11 -> 7 fixed, 1 by design, 3 nits open; HTML 11 -> 8 fixed, 1 by design, 2 explained |
| Slides + Sheets | **PASS** | 0 / 0 / 7 / 10                 | 4 items not verifiable on the host (section 1)                                                                |

No screen was unstyled, raw DOM or placeholder; the document was never recoloured by a theme in any module.

How each leftover was closed (fork unless `dev`; all closing commits landed after the round, so each needs the final
targeted re-check):

| Id (report)                   | Sev   | Leftover                                                                       | Closed by                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-N1, N3-01, N3-04 (all)      | minor | stored key without a model: "Request refused", empty model menu                | **FX2** `265f6ef`: nothing is sent without a model, localised "Choose a model" hint, send stays off, one-model providers auto-run                                                                                                                                                  |
| D-N5 (docs)                   | minor | host Comments drawer "0 comments" vs the frame's "Comments (1)"                | **FX2** `e4611f2` (frame pane "Comments on this document"); **DX** dev `edf466059` (host drawer "File discussion")                                                                                                                                                                 |
| P-N3 (pdf)                    | minor | zoom 50 % after Restore                                                        | **explained**, pinned by test `4cad46a`: the restored copy opens at the same zoom as a normal open of that copy                                                                                                                                                                    |
| P-N4 (pdf)                    | minor | page at the 60 % floor cut at 390 px                                           | **FX2** `25f6551`: the page stays inside the slot, any overflow is pannable                                                                                                                                                                                                        |
| N3-02 / R2-08 (md)            | minor | failed-save chip stays after an edit                                           | **FX2** `4827fee` (renderers report every edit); host side already `78afa5dfd`                                                                                                                                                                                                     |
| N3-01 (slides, sheets)        | minor | header Save conflict: no dialog, raw account-language server text, "Try again" | **FX3** `edfa3a8` (page-language conflict copy, no retry hint, the host owns the UI of a host save); **DX** `ec2ac66bf` (host dialog "Keep my edits" default / "Reload latest", stable code `document_version_conflict`). Docs, PDF, Markdown and HTML share path: **FX4 pending** |
| N3-02 (slides)                | minor | text box in edit mode not drafted                                              | **FX3** `3803bac`; table-cell editor and notes still on blur (section 9)                                                                                                                                                                                                           |
| N3-03 (slides, sheets)        | minor | AI settings dialog unlike the frame dialogs                                    | **FX2** `854fab2`                                                                                                                                                                                                                                                                  |
| N3-05 (sheets)                | minor | viewer sentence 4 times, AI composer enabled                                   | **FX3** `6046dfc` (one notice, no AI echo); composer: GO-A9 (explained)                                                                                                                                                                                                            |
| N3-06 (slides)                | minor | 390 tab row clipped, no cue                                                    | **FX3** `6f12b3b` (chevron, 44 px tabs); ribbon-body icons stay under 44 px, explained                                                                                                                                                                                             |
| N3-07 / S-08 (slides)         | minor | viewer shows three notices                                                     | **DX** dev `d6d2a3d1c`                                                                                                                                                                                                                                                             |
| N3-03 / D-N4 / N3-09          | nit   | "Install link unavailable" drawn like an input                                 | **DX** dev `ebd99e7f3` (plain status text)                                                                                                                                                                                                                                         |
| N3-04 (html)                  | nit   | 390 inspector + toolbar cover the selection                                    | **FX2** `9229918` (inspector is a bottom sheet, toolbar steps aside)                                                                                                                                                                                                               |
| N3-05 (md)                    | nit   | inline picture on the text baseline                                            | **FX2** `8a76f7c` (centred; saved Markdown unchanged)                                                                                                                                                                                                                              |
| D-N1 (docs)                   | nit   | 390 status bar clips                                                           | **FX2** `b328e81`                                                                                                                                                                                                                                                                  |
| R2-07 (md)                    | nit   | draft dialog on a flat scrim                                                   | **FX2** `c258273`                                                                                                                                                                                                                                                                  |
| R2-06 (md)                    | nit   | viewer AI composer enabled                                                     | **explained**: GO-A9 `a22f9071`                                                                                                                                                                                                                                                    |
| N3-08 (slides)                | nit   | use-the-app dialog: no X, near-white pill primary                              | **FX2** `9fe49dc`                                                                                                                                                                                                                                                                  |
| N3-11 (slides)                | nit   | default-focused Reload latest discards edits on Enter                          | **FX2** `549c273` (Cancel is the default)                                                                                                                                                                                                                                          |
| N3-12, N3-13 (slides, sheets) | nit   | "Try again" on a conflict; AI echo; "Error:" prefix                            | **FX3** `edfa3a8`, `6046dfc`, `375ebff`                                                                                                                                                                                                                                            |
| N3-10 (sheets)                | nit   | formula cells blank for about 1 s                                              | **explained**: upstream Univer formula closure (imported in `7424fc7`)                                                                                                                                                                                                             |
| N3-14, S-10 (all)             | nit   | toasts overlap ribbon or status bar                                            | **explained**: product-wide Toaster placement (A7DV and DX skipped it); the red Sheets toast is in-frame                                                                                                                                                                           |
| S-10 (slides), S-05 (sheets)  | nit   | AI panel clips Home ribbon; Sheets hint wraps                                  | **explained**: overflow cue present; the hint copy is upstream                                                                                                                                                                                                                     |

Not closed and not explained in the lane log: D-N2 ("Table Grid" English in vi), D-N3 (Zotero popover action looks like
plain text; Protect dialog alignment), P-N1 (PDF 390 tab row last tab cut, no cue), P-N2 (OCR toast overlaps the AI
composer), G-N2 (AI chip shows the model only, not provider and model), R2-02 (PDF hint after placing text) and MK-09 long-line
behaviour (not provoked). They are nits, in section 9.

## 8. Cloud results

All non-visual checks ran on the Cursor cloud runner (never GitHub Actions on lane branches, no probe branches).

### Fork CI replica (specs `office-ci-test`, `office-ci-e2e`, `web-ci`)

| Round | Code           | Result                                                                                                                                                                                                                                                                                                | Cost                      |
| ----- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| r1    | `0e384f8`      | 3 shards **FAIL**, 5 lane reds: `ai-web.spec.ts:269` x4 (unawaited `frame.evaluate`); `format:check` on 9 files; docs Zotero capability test vs the new B message; `html-insert-drag.spec.ts:8` (a real desktop regression from `00f6199`, stale floating-toolbar height); `markdown-tab.spec.ts:101` | not recorded              |
| FX    | `2161dd6`      | four reds fixed (`d4c96c4`, `34b8b93`, `04dfaec`, `fc614d6`); the fifth got a test-only fix `2161dd6` that did not work                                                                                                                                                                               |                           |
| r2    | `2161dd6`      | `office-ci-test` **PASS**, `web-ci` **PASS**, `office-ci-e2e` **FAIL** only `markdown-tab.spec.ts:101`                                                                                                                                                                                                | 8.47 + 5.51 + 20.52 cents |
| final | final fork SHA | TBD (final)                                                                                                                                                                                                                                                                                           | TBD (final)               |

**`markdown-tab.spec.ts:101` is a pre-existing test race, not a lane regression** (MT, 30 repeats each on fresh cloud
VMs): main `f50a745` failed 6/30, the lane `2161dd6` 13/30, the lane with the fixed test 0/30 (overlay). Root cause:
ProseMirror's focus handler re-syncs the DOM selection about 20 ms after `focus()` and overwrites a caret set right after
it. The fix is test-only (`69c9ea9`: the caret is set inside `expect().toPass()` keyed on `selectionchange`, no timers;
local 80/80); there is no product change and no re-pin. The earlier theory in `2161dd6` (an autofocus `rAF` race) was
wrong. (REPORT-modules recorded this spec as a 3/10 flake on `afd42b8`.)

### Dev rounds (specs `ts`, `go`, `e2e`)

| Round | Code                   | ts                                                                                | go                                                                                               | e2e                                                                                                                                                               | Cost (cents)          |
| ----- | ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| r1    | `e17a2c55a`            | **PASS** 8/8 (typecheck, lint, knip, core/views/web tests, governance, web build) | build + vet clean, handler/service/document/router ok, only `TestPlanSubcommandWritesJSON` fails | **PASS** 5 office-web specs (incl. `office-markdown-assets-web`)                                                                                                  | 11.95 / 11.75 / 12.04 |
| r2    | `c52be8447`            | **PASS** 8/8                                                                      | same single known failure                                                                        | 10 failed, 35 skipped: **infra**, all 60 s waits for the editor host (stale r1 servers on the warm VM, `next build` rewrote `.next` under a running `next start`) | 12.08 / 11.94 / 7.79  |
| r3    | `c52be8447` (e2e only) | n/a                                                                               | n/a                                                                                              | **PASS** 10 passed, 35 skipped, fresh ports, stale listeners killed (the VM has no `ss`, so the listener check was not a real proof; health checks answered)      | 6.65                  |
| final | final dev SHA          | TBD (final)                                                                       | TBD (final)                                                                                      | TBD (final)                                                                                                                                                       | TBD (final)           |

The 35 skips are the bundle-installed cases the runner cannot run without the tarball (as in REPORT-modules).

### Known non-lane reds

| Red                                                                                                                              | Where                       | Why it is not the lane                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sheets native sidecar tests (21 `apps/sheets` failures locally; `build:all` stops at the Sheets crate: rustc 1.85 < 1.88 on bro) | local on bro                | the same 21 fail on `f50a745`; the missing native `xlsx-sidecar` binary and the old rustc are environment limits     |
| `apps/pdf` `text-insert-fallback.test.ts` (1 case)                                                                               | local on bro                | bro has GNU Unifont, which draws every codepoint; the test now skips like its siblings (`984869c`)                   |
| dev `cmd/files-backfill` `TestPlanSubcommandWritesJSON`: `PREVIEW_ORIGIN must be an absolute http(s) origin, got ""`             | dev go shard, every round   | requirement from dev `0e0bdd3e9`, older than the lane base; the lane touches neither `cmd/files-backfill` nor config |
| `markdown-tab.spec.ts:101`                                                                                                       | fork `office-ci-e2e`        | test race with rates 6/30 on main, 13/30 on the lane, 0/30 with the fixed test (above)                               |
| dev e2e r2 (10 failed)                                                                                                           | dev e2e shard               | stale ports and a rebuilt `.next` on a warm VM; the same cases passed in r1 and r3                                   |
| `docs-spell-suggestions.spec.ts:71`, Electron `docs-visual`, `font-covering`                                                     | fork `office-ci-e2e` (base) | known base reds of REPORT-modules; none appeared in r1 or r2                                                         |

Local verification followed the team rule: exact affected test files only (vitest roots `web/modules`, `web/docs/bridge`,
`web/docs/protocol`, `apps/<module>`, `packages/ui`), `check:brand` 0 violations, `test:rebrand` 65/65, the theme-colour
check; production-build web e2e specs were run locally only where a worker owned the spec (FX2: whole web e2e after
rebuilding five modules, 163 passed, 39 skipped because Sheets cannot be built on bro, 0 failed).

## 9. Known limits and follow-ups

Product and behaviour:

- **Toast placement is product-wide.** Transient toasts overlap the ribbon or the status-bar zoom controls; the Toaster
  is shared by the whole app and was not changed (A7DV and DX skipped it).
- **The chosen AI model is stored per browser.** A new browser shows "Choose model" until a model is typed or listed.
  The credential has no server field for it; adding one is the follow-up.
- **Slides drafts**: the table-cell editor and the notes textarea are drafted only after blur. Text in a text box is
  drafted since `3803bac`.
- **Ribbon icon touch size at 390 px.** Ribbon-body icons stay under 44 px (a fixed 80 px band in Slides and Sheets);
  tab rows and dialog buttons meet 44 px.
- **Sheets formula cells are blank for about 1 s** after the grid appears (upstream Univer formula closure, import
  `7424fc7`); the Sheets status hint copy is upstream.
- **GO-A9 viewer composer.** The AI composer of a viewer stays enabled on this code (a send ends in the no-key copy);
  GO-A9 (`a22f9071`) fixes it on fork main and was deliberately not redone.
- **Installer URLs are not configured on the test host**, so the install and launch halves of Open in desktop app were
  checked only up to the "Install link unavailable" status; it is deployment configuration (`OFFICE_INSTALLER_DEV_URLS`).
- **Encrypted `.docx` could not be tested**: the host upload API refuses a synthetic compound file (415) and no real
  encrypted fixture was seeded. The message is built and unit tested, not seen in a browser.
- **Pasted SVG** stays a `data:` URI; asset URLs are query-string signatures (1 h, Markdown/HTML).
- **Decisions that changed late**: the conflict dialog's default focus is Cancel (X6); the final choice should be
  confirmed by the final visual re-check.

Open nits with no recorded fix (section 7): D-N2, D-N3, P-N1, P-N2, G-N2, R2-02, MK-09 long lines, plus the unverifiable
items (Slides fullscreen gesture, Slides linked-media message, Sheets "(Internal Server Error)" hint, Sheets console
warning).

Build, CI and release:

- **Tarball.** The final linux-arm64 `dist-web` tarball is built on bro and published by the Advisor, who also updates
  the CI secret (`OFFICE_FRAME_SOURCE`); until then the dev e2e job runs only the cases that need no bundle. Interim
  tarballs: `0.1.0-0e384f8` (sha256 `da523c07...1538`) and `0.1.0-2161dd6` (sha256 `7c30921c...3ee3`); neither is final.
  The per-platform Sheets wasm checksum rule of REPORT-modules section 7 still holds (the wasm is unchanged since
  the B456 pin; the arm64 line matches).
- **Dev pin.** The dev lane pins the six modules to the fork SHA in `*.pin.json`; a later fork change needs a re-vendor
  (the protocol copy is identical to the fork's) and a re-pin, as DPIN did twice (`d81a8879e`, `c52be8447`).
- **Branches** are pushed only for the cloud runner and at the end; no pull requests.

## 10. Final versions

To be filled in by a second commit when the lead sends the values.

| Item                                                 | Value       |
| ---------------------------------------------------- | ----------- |
| Fork final SHA (`feature/UNI-1232-web-polish`)       | TBD (final) |
| Dev final SHA (`feature/UNI-1232-office-web-polish`) | TBD (final) |
| Tarball name                                         | TBD (final) |
| Tarball sha256                                       | TBD (final) |
| Final visual verdict (targeted re-check)             | TBD (final) |
| Final fork cloud verdict (CI replica)                | TBD (final) |
| Final dev cloud verdict (ts, go, e2e)                | TBD (final) |
| FX4 (shared host-save conflict sentence) SHA         | TBD (final) |

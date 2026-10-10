# PDF on the web (GO-B4 / UNI-1014, worker P1)

The genoffice PDF viewer/editor (`apps/pdf` renderer) runs inside the UniWork web frame. Module bundle:
`npm run build:web -- --module pdf` -> `dist-web/pdf/<pkgver>-<sha>/`; test host `/test-host/?module=pdf`.
Inventory and decisions this implements: `docs/web-modules/inventory-b4.md` (1.1, 2.1, 3.1-3.3, 5.2, 5.3 P-1..P-5).

## 1. Shape

| Piece                                       | What it does                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/modules/pdf/install.ts`                | `installModuleBridge({module: 'pdf'})`, web capability defaults, host grant mapping, the pdfium availability check                                                                                |
| `web/modules/pdf/webapi.ts`                 | `window.pdfApi` over the protocol: working copy, save / Save As / conflicts, host `save` / `saveAs` / `print` / `doc.closeCheck` / `open`, page operations, downloads, typed stubs                |
| `web/modules/pdf/core.ts`                   | the save core of `apps/pdf/src/main` (`save-pdf.ts`, `text-edit.ts`, `image-edit.ts`), loaded on first use                                                                                        |
| `web/modules/pdf/core-env-web.ts`           | the web seams of the core: fetched `pdfium.wasm` / `hb-subset.wasm`, bundled Liberation TTFs, canvas image codec, Buffer shim                                                                     |
| `web/modules/pdf/signatures.ts`             | saved signatures, encrypted per user (risk R6 below)                                                                                                                                              |
| `web/modules/pdf/notice.ts`                 | in-frame dialogs (save conflict, merge prompt, open failure) on the renderer's modal classes and web strings                                                                                      |
| `apps/pdf/src/main/core-env.ts`             | the platform seams (wasm bytes, font files / font index, image codec). Desktop installs `node-env.ts` + `electron-image.ts` (unchanged behaviour); `save-pdf-file.ts` keeps the atomic file write |
| `apps/pdf/src/renderer/capabilities.ts`     | `cap(key)` over `window.pdfApi.capabilities` (`@genoffice/ui/capabilities`); Electron sets nothing, so the desktop keeps everything                                                               |
| `apps/pdf/src/renderer/i18n/strings-web.ts` | web-only strings, one shard per language under `i18n/web/` (zh defines the keys)                                                                                                                  |

### Working copy

The desktop renderer works on a path: after every save or page operation it calls `readFile(path)` and reloads, and
the main process rewrites the file. The frame has no disk: it keeps the bytes of the version it last opened or saved.
`readFile` returns a copy (pdf.js transfers its buffer); every save and every in-place page operation runs the save core
on the working copy and uploads the result with `api.save {fileId, data, etag}`. A successful save replaces the working
copy and its etag (`saved` event); the renderer then reloads from it exactly as on the desktop.

| Renderer call                                                                                                                  | Web                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `save(request)`                                                                                                                | `applyAndVerifySaveRequest` in the frame -> `api.save` (If-Match = working-copy etag)                 |
| `save({targetPath})` (host Save As)                                                                                            | same bytes -> `api.saveAs {name, data, sourceFileId}`; the original stays open and untouched          |
| `insertBlankPage`, `setPageSize`, `cropPages`                                                                                  | core on the working copy -> `api.save` (the desktop rewrites the file in place too)                   |
| `insertPdf`, `replacePages`                                                                                                    | `file.pick {purpose:'insert', accept:['pdf']}` (only with the `filePick` grant) -> core -> `api.save` |
| `extractPages`, `mergePages`, `splitPages`                                                                                     | download of the new PDF (the desktop writes it into the default folder and opens it)                  |
| `mergePdf`                                                                                                                     | repeated single `file.pick`s ("Add another PDF / Merge now") -> download                              |
| `splitPdf`, `exportImages`                                                                                                     | one file: download; several: one `.zip` download                                                      |
| `listStaticFormFills`, `validateTextEdits`, `listPageImages`, `pageImagePng`, `pagePreviewPng`, `listEditFonts`, `canDrawText` | core in the frame on the working copy                                                                 |

### Saves and conflicts

- Explicit saves only (CONTRACT C10): the renderer's autosave timer is hidden behind `autoSave`, `api.save` never carries `auto`.
- `conflict` on a frame-initiated save: dialog **Overwrite** (re-read the head etag, save again) / **Reload latest** (the
  renderer reopens the head version through `pdfApi.onReloadRequest`; pending edits are dropped) / **Cancel** (stays dirty,
  "Save failed"). A host `save` request gets the conflict in its `SaveResult` and owns the UI.
- A timed-out / network-failed save re-reads the head and adopts it when its size equals what was sent (Docs rule).
- `verifyContentEdits` runs before the upload, as before the desktop write: a content edit that did not land fails the
  save and nothing is uploaded.

## 2. Capabilities (`window.pdfApi.capabilities`)

| Key                                                                                             | Web                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edit`                                                                                          | host grant `save`. Absent = **view-only**: joins the renderer's read-only mode (all edit entries disabled, Fill Form tab hidden, "View only" badge); `save` and every write path refuse; print works                                                                                                        |
| `insertPages`                                                                                   | host grant `filePick` (Import pages, Replace pages, Merge PDF)                                                                                                                                                                                                                                              |
| `pdfTextEdit`, `pdfImageEdit`, `pdfAnnotDelete`                                                 | on; switched off when pdfium cannot be compiled in the frame (checked once after `init` when `edit` is granted)                                                                                                                                                                                             |
| `savedSignatures`                                                                               | on (encrypted per-user library)                                                                                                                                                                                                                                                                             |
| `ai`, `aiCredentials`, `webSearch`, `imageSearch`, `imageGeneration`                            | follow the host grant: **shown with the host's `ai` grant** (organization entitlement + the frame-token AI routes live; the three cloud keys also need their own grant), **hidden without it** (AI panel, ribbon AI group, ask-AI popover and AI tools all disappear and the page reflows). See section 2.1 |
| `autoSave`, `autoSaveToDisk`, `autoRename`, `convertOffice`, `ocr`, `createDocument`, `billing` | off: no autosave on the web, the rest need the desktop shell or an OS engine (OCR answers "no engine")                                                                                                                                                                                                      |
| `open`, `recents`                                                                               | from `filePick` / `recents` like Docs (the PDF renderer has no File > Open of its own)                                                                                                                                                                                                                      |

### 2.1 AI on the web

AI is built by the shared web AI bridge (`web/modules/shared/ai/`, CONTRACT C16), the same one Docs, Markdown, HTML,
Slides and Sheets use; the PDF frame adds nothing of its own.

- **Grant.** The host grants `ai` only when the organization has the entitlement and the frame-token AI mount is live
  (AI1/AI2). With the grant the panel and every AI entry show; without it they stay hidden, exactly as before.
- **Calls.** The frame talks to the AI routes of its own document directly (same origin, `connect-src 'self'`,
  `Authorization: Bearer <frame token>`, no cookies, SSE streaming native); keys are stored by the server and the
  frame never sees one.
- **Failures.** The server's error envelope (`{ "error": { code, message } }`) and a vendor adapter's own failure
  text ("... HTTP 502: {...}") never reach the panel as raw text: they become a typed, translated state card
  (missing or refused key with an "AI settings" action, credits used up, not in the plan, rate limit, provider or
  cloud unavailable, session expired, generic failure).
- **Narrow windows.** Below 900 px the AI panel starts closed unless the user opened it before, so the page keeps
  its width on a phone.

Every hidden `pdfApi` member still exists with a typed safe answer; `PdfWebApi` is a mapped type over `PdfApi`, so a new
preload method is a compile error in `webapi.ts`.

## 3. Save core in the browser (P-2)

The save pipeline is bytes in / bytes out. Its platform seams (`apps/pdf/src/main/core-env.ts`):

| Seam               | Desktop (`node-env.ts`, `electron-image.ts`) | Web (`core-env-web.ts`)                                                             |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pdfiumWasm`       | fs read (`node_modules` / `Resources/wasm`)  | `assets/pdfium-*.wasm` (4.6 MiB, fetched on first pdfium use)                       |
| `hbSubsetWasm`     | fs read                                      | `assets/hb-subset-*.wasm` (0.6 MiB)                                                 |
| `readFontFile`     | fs read of OS font paths                     | bundled Liberation Sans / Serif / Mono TTFs, matched by file name                   |
| `findSystemFont`   | installed-font index                         | Liberation by PostScript name; Arial/Helvetica, Times, Courier aliases              |
| `findFontCovering` | installed-font index scan                    | first bundled face whose cmap covers the text                                       |
| `image`            | Electron `nativeImage`                       | `createImageBitmap` + `OffscreenCanvas`                                             |
| `Buffer`           | Node                                         | `web/modules/pdf/buffer-shim.ts` (only what the core uses; unknown encodings throw) |

Golden test (`web/modules/pdf/save-core.golden.test.ts`): one source PDF + one request covering pdfium annotation delete
and image transform, markups, ink / shapes / notes + replies, note edits, form values, stamps, rotation, deletion,
reorder and metadata gives **identical bytes** with the desktop seams and with the web seams on the Buffer shim. Not in the
golden request: text edits / inserts (font resolution differs by design: OS fonts vs Liberation) and image insert /
replace (nativeImage vs canvas decoding; neither exists in Node).

Fonts for text edit are document data (pdf-lib / pdfium embed them), so they ship as TTF, not WOFF2, under `fonts/`
(never inlined, fetched on first text-edit use; 12 files, 4.2 MiB).

## 4. Assets and CSP (P-4)

Module CSP = Docs CSP + `script-src 'wasm-unsafe-eval'` (lane decision B4-1; reason in `csp.json` notes), also sent on
`/assets/**` for the pdf.js worker. Measured build (`0.1.0-e9c78f5`): 229 files, 16.0 MiB (gzip 7.6), initial 1.52 MiB
(gzip 0.46), deferred 14.5 MiB (pdf.js worker + `pdfjs/` CMaps / standard fonts / wasm codecs, pdfium, hb-subset,
Liberation TTFs, lazily imported core chunks, jszip).

e2e (`web/e2e/pdf-web.spec.ts`, production build in the test host): zero `securitypolicyviolation`, console errors and
page errors for `sample.pdf` (text), `pdf-scanned.pdf` (JPEG scan, ICCBased), `pdf-fonts.pdf` (embedded Type 1C and
TrueType subsets), `pdf-form.pdf` (AcroForm) and `pdf-encrypted.pdf` (password prompt). Fixtures:
`web/fixtures/make-pdf-fixtures.mjs`. **Not exercised:** JPX and JBIG2 images (no encoder in this toolchain;
ghostscript cannot write them) - pdf.js decodes both with its wasm codecs, which the CSP allows.

## 5. Gaps and risks

- **R6 saved signatures are encrypted and per user** (`web/modules/pdf/signatures.ts`, finding RF-3). The frame is
  same-origin with the UniWork app and its storage is shared by every user of the browser profile, so the list is
  never plaintext and never user-agnostic: with the host's recovery grant it is one AES-GCM record in the frame
  database (`uniwork-office-frame-drafts`, store `drafts`, key `~signatures:<user>` with the user part of the recovery scope), encrypted
  with the host's per-user key, so another user cannot read it and the host's sign-out deletes it with the database.
  Without a grant (host without recovery) the list lives in memory for the page load only. The first call deletes
  the plaintext `localStorage` key of the first build (`uniwork.office.pdf.savedSignatures`) and, when a grant
  exists, adopts its entries into the encrypted store. The library follows the user to no other browser; a host
  user-preferences store (new optional protocol request) is the later replacement.
- Text insert / edit on the web uses Liberation only: text no Liberation face covers (CJK, emoji, most symbols) is
  rejected at confirm time with the existing "no installed font" message.
- The save core runs on the frame's main thread (no worker yet): large files freeze the UI while saving (inventory 3.2).
- Every save uploads the whole rewritten file as a new version (same as G3).
- The size gate is the host's (`too_large` on `api.open`); the frame shows its open-failure notice.
- OCR and Convert to Office are hidden (desktop engines). AI is shown with the host's `ai` grant and hidden without it (section 2.1).

## 6. Evidence

- Screenshots (`web/e2e/pdf-web.spec.ts`, production build `0.1.0-e9c78f5`): `docs/web-modules/screenshots/pdf/`
  `{main,conflict,view-only,password}-{en,vi}-{light,dark}.png`.
- An empty new Documents file opens as the desktop's blank A4 page (`blank-pdf.ts`); the first save makes it real.

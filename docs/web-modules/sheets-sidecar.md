# GO-D3: Sheets and the native xlsx-sidecar on the web (UNI-1016, worker S6)

> **GO-D3 question for the user (answer in one line):** Sheets cannot open, scroll, save or show the images of _any_ `.xlsx`
> without the native `xlsx-sidecar` (a Rust process the Electron main process spawns). On the web, where should that work
> run? **A** in the browser (sidecar compiled to WebAssembly, in a Web Worker of the Sheets frame) · **B** server-side in
> office-engine (a new _stateful_ xlsx session service) · **C** = A up to a measured size cap, the existing G3 xlsx editor
> above it · **D** keep Sheets off the web (G3 only).
>
> **Recommendation: C**, answered as
> **"C: WASM in the browser for open/read/formulas/media/pivot/save/.xls-convert; disabled on the web for recalc-fallback,
> merge-workbooks and the recovery copy; G3 above the WASM cap; nothing server-side."**
> Why: every core operation is a per-scroll read against a resident, indexed workbook session. Server-side
> that means a sticky process per open document (measured 7 MB to 3 GB RSS) plus a network round trip and up to 4.8 MB of
> JSON per read. The same engine already compiles to `wasm32-wasip1` and ran every command correctly on all 11 G0
> fixtures. It crashed Node's WASI at ≥15k rows × 22 columns (open item O1), and the size cap covers that until a
> browser run fixes or bounds it.
>
> **Update 2026-10-09 (SH1, section 4.5): O1 and O7 are resolved.** In headless Chromium 151 (module Web Worker,
> `@bjorn3/browser_wasi_shim`, Sheets CSP + `'wasm-unsafe-eval'`) the same wasm build ran every command on all 15
> fixtures up to 100k rows × 22 (2.2M cells), with 0 traps, 0 crashes and 0 CSP violations. The ≥8 MB crash was Node's
> `node:wasi`: Node plus the browser shim does not crash either. The cap in C therefore becomes a memory budget, not a
> correctness limit: Chromium's renderer peaked at 777 MB at 2.2M cells. The real cost is latency before the first
> paint, because the index now runs inline: 1.2 s at 440k cells and 4.9 s at 2.2M (native: tens of ms, with the index
> built in the background).

Analysis plus measurement only: no `apps/sheets` source was changed. Fork `uniwork-office` at `5a81008`, branch
`zone17th/uni-1014-s6-sidecar` (child of `feature/UNI-1014-web-modules`). dev-uniwork lane worktree
`feature-UNI-1014-office-web-modules` was read only. Written 2026-10-09.

Contents: 0 summary · 1 method and machine · 2 the sidecar today (protocol and every call site) · 3 measured operation
list · 4 measurements · 5 options per operation · 6 recommendation · 7 preload inventory and capability keys ·
8 standalone renderer web build · 9 open items · appendix A reproduce, appendix B grep evidence.

## 0. Summary

1. **The sidecar is the Sheets document I/O layer, not a feature.** The renderer never holds the workbook bytes. It holds a
   `sessionId` and streams 256-row chunks (`read_range`), formula lists (`read_formula_cells`) and pictures (`read_media`)
   from a resident, indexed sidecar session. Saves go through the sidecar's archive commands, and every save re-opens the
   saved file as a new session. **12 sidecar commands** sit behind **14 IPC channels** of the 47 (section 2). Without a
   replacement, the web frame can only show "engine unavailable". "Disabled on the web" (option c) is possible only for
   **5 peripheral operations**: recalc fallback, `.xls` convert, merge workbooks, recovery copy, pivot refresh.
2. **Native build on this box works with Rust ≥ 1.88.** The box default rustc 1.85 fails (`calamine 0.36` / `time 0.3.54`
   need 1.88). With `cargo +1.90.0`: 2 min 48 s release compile, 10.2 MB binary (8.6 MB stripped), linux-arm64, glibc only.
   dev-uniwork's office-engine image **already builds this same sidecar** (rustup 1.88.0, Dockerfile stage `xlsx-src`) and
   uses `recalc_cells` per job (G2-04).
3. **Native speed is not the problem** (section 4.1). 11 real G0 fixtures: open 0.7–2.5 ms warm (6.8–14.6 ms cold incl.
   spawn), save 10 edits 12–42 ms, RSS ≤ 8.7 MB. A 2M-cell workbook: open 0.7–0.8 s, first viewport 15 ms, full index
   2.0–2.3 s, save of 1000 edits 1.8–2.2 s, **peak RSS 0.87–0.96 GB**. A 6.6M-cell workbook: open 2.4 s, save 7.5 s,
   **peak RSS 3.0 GB**. The cost of option (a) is **state and memory per open document plus transfer per read**, not CPU.
4. **office-engine's model does not fit the read path.** office-engine (dev-uniwork) is a stateless job runner: one
   grant per job, a sandboxed worker per job, the sidecar killed and staging deleted after each job
   (`packages/office-engine/src/node/xlsx-sidecar.ts`). The Sheets renderer needs a session that lives as long as the tab,
   with dozens of reads per scroll. Server-side Sheets therefore means a new stateful session service with affinity,
   idle eviction and memory budgeting, plus new frame→host message types for reads. That is heavy and against the engine's
   design. It does fit the stateless operations: `.xls` convert and recalc. Both are optional (section 5).
5. **WASM (option b) is feasible and measured** (section 4.3). Four mechanical changes, kept in a scratch copy only (patch in
   `docs/web-modules/sheets-probes/wasm-probe.patch`), let the unmodified command set compile to a **6.8 MB
   `wasm32-wasip1` module (1.97 MB gzip)**:
   - turn off zip 0.6's bzip2/zstd C libraries, which `ironcalc 0.7.1` pulls in;
   - run the 3 thread spawns inline;
   - fall back for `canonicalize()`;
   - fall back for `temp_dir()`.

   It then ran **every command correctly on all 11 fixtures under Node 22 WASI**: open 2–14 ms warm, save 26–103 ms,
   `.xls` convert 94 ms incl. instance start. It **segfaults the Node process on open of a worksheet ≥ ~8 MB uncompressed**
   (10k × 22 cells OK, 15k × 22 crash, deterministic, also in a 256 MB-stack worker). That is undiagnosed and was not tried
   in a browser yet (O1). The web frame also needs `'wasm-unsafe-eval'`, the same CSP change the PDF module needs
   (inventory-b4 C-1).

6. **Pure JS (no engine) is too slow for open** (section 4.4). The gateway's whole-file reader (`readBasicWorkbook`)
   took 2.4 s / 11.0 s / 46.7 s for 0.44M / 2.2M / 6.6M cells, against 0.2 s / 0.8 s / 2.4 s native. Re-implementing the
   streaming session in TS would mean porting ~18.5k lines of Rust. The **save** planner, however, is already TypeScript
   (`planCellEditsToXlsx`). Only its archive I/O uses the sidecar, and an in-memory JSZip path exists
   (`applyCellEditsToXlsx`): 26–68 ms on small files, 2.8 s / 16.6 s for 0.44M / 2.2M cells (vs 0.55 s / 2.2 s streaming).
7. **Preload inventory** (section 7): `window.desktopApi` **64 methods**. 14 of them reach the sidecar on desktop: 7 stay
   SIDECAR, i.e. in the GO-D3 engine; 3 are HIDE sidecar-only; the save-edits transfer is 3 INFRA; `writeWorkbookRecovery`
   is HIDE. Over all 64: 11 PROTO, 4 BROWSER, 5 INFRA, 30 HIDE, 7 STUB, 7 SIDECAR. Plus `window.projectApi` with 10 methods. The preload uses **73 distinct channels**: all **47** `IPC_CHANNELS`
   plus 26 literal channels. The Sheets renderer has **no capability mechanism** today (Docs has `desktop.capabilities` +
   `cap()`). Adding one is a prerequisite for every hide in this lane. Proposed keys: 12 general and 5 sidecar-only.
8. **The renderer builds standalone for the web**: plain `vite build --config apps/sheets/vite.renderer.config.ts` succeeds
   in 36.4 s with no Node-builtin externalisation warnings. Bundle: 202 files, **23.1 MB raw / 6.15 MB gzip / 4.78 MB
   brotli**, one 10.7 MB (3.0 MB gzip) main chunk. Blockers are web-readiness, not build errors: desktop meta CSP in
   `index.html`, absolute `/assets/` base, 4 TTF fonts (2.75 MB, no WOFF2), no bridge, and no capability mechanism.

## 1. Method and machine

- Machine: VPS "bro", Oracle Cloud, **ARM Neoverse-N1, 4 vCPU, 23 GiB RAM**, Ubuntu 24.04.4, kernel 6.17.0-1020-oracle,
  Node v22.23.2, rustc/cargo 1.90.0 (`rustup toolchain install 1.90.0 --profile minimal`). Default 1.85.0 left untouched.
- Every build and measurement ran under `flock /home/ubuntu/.uniwork-lane-build.lock`, so no other heavy lane job ran at
  the same time. Light processes of other workers did run. Numbers are single runs, not medians: read them as order of
  magnitude.
- Driver: `docs/web-modules/sheets-probes/measure-sidecar.ts` drives the **app's own** `XlsxSidecarClient`
  (`apps/sheets/src/main/xlsx-sidecar-client.ts`) and **the app's own save pipeline** `saveWorkbookViaSidecar`
  (`packages/xlsx-gateway/src/gateway/xlsx-package-io.ts`). It uses one fresh sidecar process per fixture and opens a
  snapshot copy, as the app does. Timings are wall clock around each client call (`performance.now()`), so they include
  NDJSON serialisation and the zod-free parse in the client. Peak RSS is `VmHWM` of the sidecar process from
  `/proc/<pid>/status` at the end of the fixture's sequence (open → reads → recalc → save → close). Sizes are
  `JSON.stringify` byte lengths of the result.
- Pure-JS comparison: `measure-js.ts`, one process per fixture, `process.resourceUsage().maxRSS`.
- WASM: the same driver against `wasi-sidecar.mjs`, a 10-line Node `node:wasi` shim that runs the `.wasm` as a drop-in
  sidecar over stdin/stdout. Its RSS therefore includes Node itself (~70 MB baseline). Its "cold" numbers include Node
  start and wasm compile.
- Fixtures:
  - the 11 `.xlsx`/`.xlsm` + 1 `.xls` of the dev-uniwork G0 corpus (`docs/office/g0/fixtures/files/sheets/`, 3.3–13.8 KB,
    read in place). They include chart, pivot, macro, protected, Vietnamese, satellite-sheets and number-format files;
  - synthetic large workbooks from `gen-large.ts`: one sheet, 20 numeric columns + a formula column (`=A{r}+B{r}` with
    cached `<v>`) + an inline-string column. Sizes: 20k / 90k / 100k / 300k rows = **0.44M / 1.98M / 2.2M / 6.6M cells**,
    2.0 / 9.3 / 10.3 / 30.7 MB on disk, 13.9 / 63.7 / 70.8 / 218 MB sheet XML. 90k rows sits just under the renderer's
    recalc cap of `RECALC_MAX_GRID_CELLS = 2_000_000`.
- Saves: 10 edits on small files and 1000 on large ones. Edits overwrite cells read by the first viewport. Appending a new
  row fails on 8 of the 11 G0 fixtures in the TS planner, identically in the pure-JS path, so it is not a sidecar
  issue (O4).
- Raw results: `docs/web-modules/sheets-probes/results/*.json`.

## 2. The sidecar today

**Process and protocol.** `XlsxSidecarClient` spawns `native/xlsx-sidecar` once per app. All tabs share it, and
`sheets-main.ts` prewarms it in `createSheetsWindow` / `createSheetsView` / `exportSheetsPdfHeadless`. It speaks NDJSON
over stdin/stdout (`{version:1, requestId, command, ...}` → `{version, requestId, ok, result|error}`). Timeouts are 30 s,
or 180 s for archive commands and recalc. The binary keeps **sessions**: `open` returns a `sessionId` plus workbook
metadata (sheets, styles, visuals, defined names, theme, pivots). A background thread per sheet indexes the worksheet
XML into an on-disk chunk cache (`$TMP/genspark-ai-excel-<session>`). `read_range` answers from that index and waits
when the requested rows are not indexed yet. The binary's threads are the stdin reader, one index thread per sheet, and a
recalc worker.

**Commands** (`apps/sheets/native/xlsx-engine/src/main.rs:445-534`): `open`, `read_range`, `read_formula_cells`,
`read_media`, `close`, `cancel`, `convert_workbook`, `archive_manifest`, `read_entries`, `scan_entries`, `save_archive`,
`recalc_cells`. The file has 12 commands. `cancel` is client-internal.

**Every call site** (grep in appendix B; no other runtime users; the CLI `packages/cli/src/formats/xlsx.ts` spawns its own
per-call sidecar and is not part of the web frame):

| Main-process call site                                              | Sidecar command(s)                                                                    | Reached from IPC channel                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheets-main.ts:3930` `openWorkbookSession` → `client.open`         | `open`                                                                                | `workbook:select`, `workbook:select-for-merge`, `workbook:open-for-merge`, **and after every `workbook:save`** (session swap, `sheets-main.ts:3053`) |
| `sheets-main.ts:4035` `prepareWorkbookForOpen` → `convertWorkbook`  | `convert_workbook`                                                                    | `workbook:select` / merge on a `.xls`. `.csv`/`.tsv` convert in TS (`csvToXlsxBufferForOpen`), then go through `open`                                |
| `sheets-main.ts:2599`                                               | `read_range`                                                                          | `workbook:read-range`                                                                                                                                |
| `sheets-main.ts:2607`                                               | `read_formula_cells`                                                                  | `workbook:read-formulas`                                                                                                                             |
| `sheets-main.ts:2642`                                               | `recalc_cells` (path = session snapshot)                                              | `workbook:recalc`                                                                                                                                    |
| `sheets-main.ts:2682`                                               | `read_media`                                                                          | `workbook:read-media`                                                                                                                                |
| `sheets-main.ts:2804-2805` `readArchiveEntryText` ×2                | `read_entries`                                                                        | `workbook:read-pivot-definition`                                                                                                                     |
| `sheets-main.ts:3837` `writeWorkbookTo` → `saveWorkbookViaSidecar`  | `archive_manifest`, `read_entries` (per patched part), `scan_entries`, `save_archive` | `workbook:save` (+ chunked `workbook:save-edits-begin/chunk/abort` feeding it), `workbook:write-recovery`                                            |
| `sheets-main.ts:2491, 2533, 3051, 3152, 4269` `client.close`        | `close`                                                                               | `workbook:close`, save swap, merge cleanup, tab teardown (`closeAllSessions`)                                                                        |
| `sheets-main.ts:1987, 2066, 2112` `client.start()`, `4150` `stop()` | (spawn / kill)                                                                        | window/view creation, app quit                                                                                                                       |

That gives 14 of the 47 `IPC_CHANNELS` that reach the sidecar: select, select-for-merge, open-for-merge, read-range,
read-formulas, recalc, read-media, read-pivot-definition, save, save-edits-begin/chunk/abort (via save), write-recovery
and close.

## 3. Measured operation list

Sizes: "in" = request, "out" = result JSON (measured unless marked ≈). Frequency is from renderer code. "Today without
the sidecar" is what the Electron app does when the sidecar is missing or crashed: the spawn error surfaces on the first
request, and on a crash `onProcessExit` is not wired in this fork, so the request rejects.

| #   | Operation (sidecar cmd)                                                                         | User-visible entry points (renderer)                                                                                                                                                                                                                                  | Size in / out (measured)                                                                                                                             | How often                                                                                              | Today without sidecar                               | Renderer fallback                                                                              |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| S1  | **Open** (`open`)                                                                               | File > Open / Ctrl+O, queued open from the shell, drag-drop, new blank, recovery restore (`App.tsx:3970` `handleInspectWorkbook` → `openLazyWorkbook`)                                                                                                                | in: path; out 1.3–2.2 KB (G0), 0.8 KB (large, metadata only)                                                                                         | once per document **plus once after every save** (session swap)                                        | open fails: "XLSX sidecar failed to start"; no grid | **none**                                                                                       |
| S2  | **Cell streaming** (`read_range`)                                                               | the grid itself: viewport and scroll (`univer-sync.ts:1770-1823`, 256-row chunks, ≤90k cells per batch), copy/find/sort/filter/fill over unloaded rows (`univer-sync.ts:5353, 6517`), AI aggregate (`ai/aggregate-range.ts:396`), merge (`merge-workbooks.ts:90,101`) | viewport 100×22–50 cells: **114 KB**; 90k-cell batch: **4.8 MB**                                                                                     | every scroll into unloaded rows; bulk ops scan the sheet in 90k-cell batches                           | blank grid                                          | none                                                                                           |
| S3  | **Formula lists** (`read_formula_cells`)                                                        | formula bar / formula view, closure analysis (`univer-sync.ts:1376, 2292`), AI formula audit (`ai/formula-audit.ts:385`), AI plan ops (`plan-operations.ts:1351`)                                                                                                     | 20k formulas **1.6 MB**, 100k (cap) **8.1 MB**                                                                                                       | once per sheet (cached), AI on demand                                                                  | formulas shown as values                            | none                                                                                           |
| S4  | **Pictures** (`read_media`)                                                                     | image visuals on the grid (`WorkbookVisuals.tsx:1594`), header/footer pictures in PDF export and print (`page-layout-actions.ts:479`)                                                                                                                                 | out = base64 of the image part (×1.33), ≤ 20 MiB per image (`MAX_MEDIA_BYTES`). Not measured: no fixture yields an image visual (O5)                 | once per visual when first painted; per export                                                         | image frames empty                                  | none                                                                                           |
| S5  | **Close** (`close`)                                                                             | tab close, workbook switch, merge cleanup                                                                                                                                                                                                                             | tiny                                                                                                                                                 | per session                                                                                            | leak only                                           | n/a                                                                                            |
| S6  | **Save** (`archive_manifest` + `read_entries` + `scan_entries` + `save_archive`; planner is TS) | Save / Ctrl+S, Save As (`save-actions.ts:361, 436`), AutoSave pill (30 s + blur, `App.tsx:535`), close-save prompt, MCP save-to                                                                                                                                       | in: edit journal (1000 edits = **83 KB**; >10k edits via chunked transfer, ≤10M edits); out: the file (2.1 / 9.5 / 10.6 / 31.7 MB for the large set) | per save; AutoSave every 30 s when on (hidden on the web: explicit save only, lane decision `e977e00`) | save fails                                          | none                                                                                           |
| S7  | **Recovery copy** (same pipeline as S6 to userData)                                             | none visible: 30 s timer while dirty (`App.tsx:568`) + restore prompt on reopen                                                                                                                                                                                       | as S6                                                                                                                                                | every 30 s while dirty                                                                                 | silent `{ok:false}`                                 | silent                                                                                         |
| S8  | **Recalc fallback** (`recalc_cells`, IronCalc)                                                  | none visible; runs 600 ms after edits **only** for streamed workbooks whose formula closure is unavailable (formula-heavy, or defined names / external refs) (`univer-sync.ts:2249`), and at open of such files                                                       | in: edits ≤10k + reads ≤20k cells; out 20k cells **1.8 MB**                                                                                          | debounced per edit burst, rare                                                                         | cached values stay (stale after edits)              | **yes**: fail-soft, 3 failures retire it, `engineOverBudget` caps (64 MB file / 2M grid cells) |
| S9  | **Legacy .xls open** (`convert_workbook`, calamine)                                             | File > Open of `.xls` (and merge sources)                                                                                                                                                                                                                             | 13.8 KB `.xls` → 2.7 KB `.xlsx`                                                                                                                      | per `.xls` open                                                                                        | open fails                                          | none                                                                                           |
| S10 | **Pivot definition** (`read_entries` ×2)                                                        | eager at open for every pivot with a cache (`App.tsx:3783`); feeds PivotTable refresh                                                                                                                                                                                 | 326 B pivot XML (G0 pivot)                                                                                                                           | once per pivot per open                                                                                | refresh disabled                                    | **yes**: "a failed parse just disables refresh"                                                |
| S11 | **Merge workbooks** (S1+S2+S5 on extra sessions)                                                | Data ribbon > merge workbooks (`ribbon-actions.ts:1510` → `merge-workbooks.ts:306`), AI chat attachments (`merge-workbooks.ts:325`)                                                                                                                                   | per source as S1/S2                                                                                                                                  | on demand                                                                                              | fails                                               | none                                                                                           |

## 4. Measurements

### 4.1 Native sidecar, G0 corpus (11 files, 3.3–6.9 KB) and `.xls`

| Operation                                   | Measured (min–max)               |
| ------------------------------------------- | -------------------------------- |
| open, cold incl. process spawn              | 6.8–14.6 ms                      |
| open, warm (same process)                   | 0.7–2.5 ms                       |
| first viewport `read_range`                 | 0.8–6.3 ms (0.7–2.0 KB)          |
| `read_formula_cells` (all sheets)           | 0.2–5.4 ms                       |
| `archive_manifest`                          | 0.3–2.8 ms                       |
| pivot part `read_entries` (xlsx-pivot)      | 3.3 ms                           |
| `recalc_cells` cold / warm (8 files)        | 1.2–9.2 ms / 0.3–3.9 ms          |
| save via sidecar, 10 edits                  | 11.9–42 ms                       |
| close                                       | 0.4–2.0 ms                       |
| sidecar peak RSS                            | 6.8–8.5 MiB                      |
| `convert_workbook` legacy-xls.xls (13.8 KB) | 14.7 ms incl. spawn, 6.7 MiB RSS |

### 4.2 Native sidecar, large synthetic workbooks (1000-edit save)

| Cells (rows × 22)                              | 0.44M (20k)          | 1.98M (90k)          | 2.2M (100k)           | 6.6M (300k)               |
| ---------------------------------------------- | -------------------- | -------------------- | --------------------- | ------------------------- |
| file / sheet XML                               | 2.0 MB / 13.9 MB     | 9.3 MB / 63.7 MB     | 10.3 MB / 70.8 MB     | 30.7 MB / 218 MB          |
| open (cold incl. spawn / warm)                 | 175 / 190 ms         | 716 / 708 ms         | 805 / 791 ms          | 2,376 / 2,589 ms          |
| first viewport (2,200 cells, 114 KB)           | 26 ms                | 16 ms                | 15 ms                 | 16 ms                     |
| full index (last rows readable)                | 0.58 s               | 2.02 s               | 2.27 s                | 7.11 s                    |
| 90k-cell batch read (4.8 MB JSON)              | 255 ms               | 200 ms               | 214 ms                | 230 ms                    |
| `read_formula_cells` (count, JSON)             | 201 ms (20k, 1.6 MB) | 237 ms (90k, 7.3 MB) | 270 ms (100k, 8.1 MB) | 252 ms (100k cap, 8.1 MB) |
| `recalc_cells` 1 edit + 20k reads, cold / warm | 1.45 s / 96 ms       | **28.5 s** / 88 ms   | **38.5 s** / 93 ms    | timeout (> 180 s)         |
| save, 1000 edits (in 83 KB)                    | 0.55 s               | 1.84 s               | 2.18 s                | 7.53 s                    |
| sidecar peak RSS (whole sequence)              | 213 MiB              | 846 MiB              | 939 MiB               | 2,950 MiB                 |

The renderer never sends 6.6M cells to recalc: `RECALC_MAX_GRID_CELLS` keeps cached values above 2M grid cells.

### 4.3 WASM build of the same engine (scratch copy; Node 22 `node:wasi`)

Build: `cargo +1.90.0 build --release --target wasm32-wasip1`. As-is it fails in `zstd-sys`, which needs clang for wasm
(`ironcalc 0.7.1` → `zip 0.6.6` default features `bzip2` + `zstd`, both C). `wasm32-unknown-unknown` fails the same way.
With the scratch patch (`sheets-probes/wasm-probe.patch`) it builds:

1. `[patch.crates-io]` zip 0.6.6 with `default = ["deflate"]`;
2. the stdin reader, the recalc worker and the per-sheet index thread run inline under `cfg(target_os = "wasi")`;
3. `canonicalize()` falls back to the given path (unsupported on wasip1);
4. `temp_dir()` reads `TMPDIR`, because std panics with "no filesystem on wasm".

The result is 1 min 10 s cold and 19–30 s incremental. **6.8 MB `.wasm`, 1.97 MB gzip.** A first build without
change 2 produced a 429 KB module that exits immediately: the compiler drops the request loop because `spawn` always
fails on wasip1.

| Operation (G0 corpus, 11 files)                | WASM (Node WASI)                                      | vs native warm |
| ---------------------------------------------- | ----------------------------------------------------- | -------------- |
| open, cold incl. Node start + wasm compile     | 114–345 ms                                            | n/a            |
| open, warm                                     | 2.2–13.9 ms                                           | ~3–6×          |
| first viewport (includes the now-inline index) | 18–74 ms                                              | n/a            |
| `read_formula_cells`                           | 0.8–8.6 ms                                            | ~2–4×          |
| `recalc_cells` cold / warm                     | 89–201 ms / 0.4–1.9 ms                                | warm ≈ native  |
| save, 10 edits                                 | 26–103 ms                                             | ~2×            |
| `convert_workbook` legacy-xls.xls              | 94 ms incl. instance start                            | n/a            |
| process RSS (Node + wasm)                      | 74–134 MiB                                            | n/a            |
| **large files (≥15k rows × 22)**               | **open segfaults the Node process** (O1); 10k rows OK | n/a            |

### 4.5 The same build in a browser (O1/O7, SH1)

Harness (`sheets-probes/browser/`):

- `driver.mjs` holds **one scripted conversation** shared by every runtime. The wasm sidecar is single-threaded, so
  stdin is a function that builds the next request from the previous answer (session id, sheet ids, entry names).
  The sequence is: open → first viewport → bottom viewport → 90k-cell batch → `read_formula_cells` per sheet →
  `archive_manifest` → `read_entries` (largest worksheet) → `save_archive` with that part as a replacement (the
  sidecar half of a save) → `recalc_cells` cold/warm (files ≤ 3 MB) → `close`.
- `worker.mjs` + `page.mjs` + `serve.mjs` + `run-chromium.mjs`: a module Worker per workbook (fresh wasm memory),
  served with the Sheets frame CSP (`csp.ts` base) plus `script-src 'wasm-unsafe-eval'` on every response, in
  Playwright headless Chromium 151.0.7922.34. The runner samples the renderer processes' `VmHWM`.
- `run-node.mjs`: the same driver against the native binary and in Node 22 with the same shim.
- The shim (`@bjorn3/browser_wasi_shim` 0.4.2, scratch copy, not a repo dependency) keeps files in memory. Its file
  write grows the buffer to the exact size on every append, which makes writing a multi-MB xlsx quadratic, so
  `driver.mjs` patches `fd_write` to grow geometrically. A product integration needs the same fix.

Same machine as section 1. Single runs under the lane lock. Raw: `results/o7-{native,node-shim,chromium}.json`.

| ms (native / Chromium)                | G0 corpus (11 files)                 | 220k cells (10k rows) | 330k (15k)              | 440k (20k)                | 2.2M (100k)      |
| ------------------------------------- | ------------------------------------ | --------------------- | ----------------------- | ------------------------- | ---------------- |
| wasm compile (6.8 MB, per Worker)     | – / 44–66                            | – / 58                | – / 79                  | – / 64                    | – / 51           |
| open                                  | 1.4–4.4 / 54–74                      | 82 / 244              | 125 / 435               | 279 / 508                 | 903 / 1,822      |
| first viewport (wasm: full index)     | 0.6–0.9 / 20–34                      | 18 / 559              | 15 / 1,244              | 30 / 1,219                | 16 / 4,924       |
| bottom viewport (after index)         | 0.2–0.3 / 0.5–1.1                    | 0.2 / 21              | 0.2 / 11                | 0.2 / 22                  | 0.2 / 25         |
| 90k-cell batch read                   | 0.2–0.4 / 0.4–1.5                    | 359 / 1,169           | 423 / 1,319             | 485 / 1,190               | 371 / 1,256      |
| `read_formula_cells`                  | 0.1–0.8 / 0.7–3.8                    | 31 / 29               | 46 / 65                 | 45 / 117                  | 54 / 2,542       |
| `read_entries` (largest worksheet)    | 0.2–0.8 / 3.0–4.9                    | 13 / 34               | 20 / 87                 | 28 / 82                   | 145 / 391        |
| `save_archive` (sidecar part of save) | 3.8–28 / 11–19                       | 145 / 197             | 223 / 327               | 335 / 443                 | 2,167 / 2,186    |
| `recalc_cells` cold / warm            | 1.0–3.2 / 94–107 · 0.2–0.5 / 0.2–0.4 | 583 / 898 · 52 / 68   | 999 / 1,615 · 136 / 133 | 1,315 / 1,975 · 112 / 214 | not run (> 3 MB) |
| wasm linear memory                    | 3.3–3.4 MB                           | 73 MB                 | 112 MB                  | 143 MB                    | 271 MB           |
| Chromium renderer peak RSS            | 197 MB (whole group)                 | 358 MB                | 357 MB                  | 410 MB                    | 777 MB           |
| native sidecar peak RSS (sampled)     | 6.8–8.4 MiB                          | 110 MiB               | 162 MiB                 | 209 MiB                   | 101 MiB¹         |

¹ Native sampling happens at each response. The 2.2M-cell native index runs in a background thread after the first
viewport answers, so its peak is under-sampled here. Section 4.2 has the whole-sequence peak.

Results:

- **No crash and no trap in Chromium**: 0 renderer crashes, 0 console errors, 0 CSP violations over 15 workbooks.
  **Node + the same shim does not crash either** (`o7-node-shim.json`; Node and Chromium timings agree within about
  30 %). O1 was Node's experimental `node:wasi` (uvwasi), not the engine.
- **The only failing command is `close`** on 5 of 15 workbooks (`io_error: Directory not empty`). The shim's
  in-memory directory removal cannot remove the session's non-empty chunk-cache directory. It is harmless here (the
  Worker is discarded) but needs a shim fix or an in-memory cache in the product.
- **Factor vs native**:
  - open: 2–3× on large files; small files pay a fixed ~55 ms (the first call JITs the module);
  - batch reads: ~3×;
  - `save_archive`: about 1×, deflate dominates;
  - recalc: about 1.5×;
  - formula lists at 2.2M cells: 47×, the one outlier, not investigated.
- **The cost to fix before shipping is the first viewport.** The scratch build runs the per-sheet index inline on the
  first read, so the grid's first paint waits for the whole sheet: 0.56 s / 1.2 s / 4.9 s at 0.22M / 0.44M / 2.2M
  cells. Natively that index is a background thread, and the first viewport answers in 15–30 ms. Two fixes: index in
  bounded slices between requests (the read path already waits per chunk, `RANGE_WAIT_MAX_LAG_ROWS`), or run a second
  Worker over the same bytes.
- **Memory**: the wasm heap grows to 271 MB at 2.2M cells and the renderer process to 777 MB (wasm heap + the shim's
  in-memory chunk cache + JS). That is within a browser tab's budget and below wasm32's 4 GiB, so option C's cap becomes
  a memory-budget decision (for example "≤ 2M cells, G3 above") rather than a crash guard.

#### 4.5.1 Size cap for option C (after the user chose C, CONTRACT C11)

Same harness with larger and wider synthetic workbooks: `results/o7-chromium-cap.json`, `results/o7-native-cap.json`.
"First viewport" means open plus the first `read_range`, i.e. what the user waits for before the grid paints.

| workbook (rows × cols) | cells | file / sheet XML | first viewport, Chromium (native) | save_archive, Chromium (native) | wasm heap | renderer peak RSS |
| ---------------------- | ----- | ---------------- | --------------------------------- | ------------------------------- | --------- | ----------------- |
| 10k × 22               | 0.22M | 1.0 / 6.8 MB     | 0.8 s (0.10 s)                    | 0.20 s (0.14 s)                 | 73 MB     | 358 MB            |
| 20k × 22               | 0.44M | 2.0 / 13.9 MB    | 1.7 s (0.31 s)                    | 0.44 s (0.33 s)                 | 143 MB    | 410 MB            |
| 50k × 22               | 1.1M  | 5.1 / 35.3 MB    | 3.9 s (0.49 s)                    | 1.15 s (0.83 s)                 | 137 MB    | 497 MB            |
| 5k × 400 (wide)        | 2.0M  | 9.2 MB / –       | 7.8 s (0.95 s)                    | 1.81 s (1.35 s)                 | 137 MB    | 611 MB            |
| 100k × 22              | 2.2M  | 10.3 / 70.8 MB   | 6.7 s (0.92 s)                    | 2.19 s (2.17 s)                 | 271 MB    | 777 MB            |
| 200k × 22              | 4.4M  | 20.5 / 144.6 MB  | 15.6 s (2.54 s)                   | 5.55 s (3.64 s)                 | 540 MB    | 1,328 MB          |

There is still no trap, crash or CSP violation at any size. The cap is a UX and memory budget.

**Cap proposal (sent to the lead 2026-10-09):**

1. **Host gate at token mint** on the stored file size: ≤ **5 MB** opens in the frame, above it the host opens G3. The
   server knows the size without parsing. 5 MB of dense cells is about 1M cells: ≤ 4 s to the first viewport and
   < 0.5 GB.
2. **Frame gate after `archive_manifest`**: the sum of uncompressed `xl/worksheets/*.xml` must be ≤ **40 MB**. Above
   that the frame answers `too_large` and the host falls back to G3. This catches string- and style-heavy files that
   are small when compressed.
3. **After SH2 makes the index incremental** (first viewport ≈ open time: 1.1 s at 1.1M cells, 1.8 s at 2.2M), raise
   the gates to file ≤ **10 MB** and XML ≤ **80 MB** (2.2M cells, about 0.8 GB).

### 4.4 Pure JS (`@genoffice/xlsx-gateway`, JSZip, no engine)

| Cells                                   | G0 (3 files) | 0.44M   | 2.2M    | 6.6M      |
| --------------------------------------- | ------------ | ------- | ------- | --------- |
| `readBasicWorkbook` (whole-file parse)  | 37–41 ms     | 2.41 s  | 11.04 s | 46.73 s   |
| `applyCellEditsToXlsx` (in-memory save) | 59–68 ms     | 2.81 s  | 16.64 s | 59.49 s   |
| process max RSS                         | 81–95 MiB    | 270 MiB | 831 MiB | 2,458 MiB |

`readBasicWorkbook` is not the sidecar's equivalent. It is a non-lazy regex reader without styles, visuals or row
metadata. A real JS replacement of S1–S4 would be a port of the session engine.

## 5. Options per operation

Common prerequisites whatever the answer: a web bridge for Sheets (`web/modules/sheets/`, contract C2), a Sheets
capability mechanism (section 7.3), and moving the main-process session logic of `sheets-main.ts` into the frame:
session map, snapshot, `writeWorkbookTo` sheet-op resolution and CSV import. It is Node (`fs`, `crypto`, `path`) today,
the same "injection job" B4 found for PDF.

**(a) server-side in office-engine.** Needs:

- the sidecar binary in the image (already built there, 1.88.0, linux amd64/arm64 from the same Dockerfile);
- a new stateful service kind: open document → resident session pinned to one engine process (affinity), idle eviction,
  memory admission (measured 7 MiB to 3 GiB per session), session-scoped grants instead of per-job grants;
- Go routes to proxy reads, and new frame→host message types for `read_range` / `read_formula_cells` / `read_media`
  (contract C1: only when truly needed).

Latency per read = measured sidecar time + network RTT + transfer. Estimate: RTT 30–100 ms browser↔VPS, plus 114 KB per
viewport and 4.8 MB per 90k-cell bulk batch, against 15–30 ms in-process today. Per save: upload of the edit journal
(83 KB / 1000 edits), sidecar time, and the saved file stays server-side (no download needed: the frame commits by
file id). Fits naturally only S8 (stateless `recalc_cells` on saved bytes plus edits, a job like G2-04 `edit:xlsx`) and
S9 (bytes → bytes).

**(b) browser.**

- **b1, WASM sidecar in a Web Worker.** Needs: the four engine changes above (fork-side, `cfg`-gated, desktop
  unchanged); a browser WASI layer with an in-memory FS (e.g. `@bjorn3/browser_wasi_shim`), or a `wasm-bindgen` entry
  instead of NDJSON-over-stdio; CSP `script-src 'wasm-unsafe-eval'` and `worker-src 'self'`; +1.97 MB gzip. Memory ceiling
  is wasm32's 4 GiB: native peaks were 0.2 / 0.9 / 3.0 GiB at 0.44M / 2.2M / 6.6M cells. Measured 2–6× native on the
  small corpus. The large-file crash (O1) must be fixed or capped.
- **b2, pure JS.** Measured too slow for S1/S2 above ~0.5M cells. Feasible for S6 (planner already TS; in-memory
  JSZip assemble exists, slower than streaming), S10 (2 zip entries) and S4 (one zip entry + base64).

**(c) disabled on the web**, hidden through a capability key.

| Op                   | (a) server                                                                  | (b) browser                                                                                                               | (c) disabled: UX impact                                                                                                     |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| S1 open              | stateful session service; 0.2–2.4 s server time + bytes already server-side | b1: 2–14 ms small (Node WASI); large blocked by O1                                                                        | **impossible**: no Sheets                                                                                                   |
| S2 cell streaming    | +RTT per chunk; 114 KB/viewport, 4.8 MB/bulk batch over the network         | b1: in-worker, no network                                                                                                 | impossible                                                                                                                  |
| S3 formula lists     | +RTT; up to 8.1 MB                                                          | b1                                                                                                                        | impossible (formula bar shows values)                                                                                       |
| S4 pictures          | +RTT; base64 ≤ 20 MiB                                                       | b1 or b2 (JSZip entry)                                                                                                    | images blank: not acceptable                                                                                                |
| S5 close             | session eviction                                                            | b1                                                                                                                        | n/a                                                                                                                         |
| S6 save              | job with journal upload; 0.55–7.5 s server                                  | b1 (26–103 ms small) or b2 (2.8 s @0.44M)                                                                                 | impossible                                                                                                                  |
| S7 recovery copy     | n/a                                                                         | n/a (no disk)                                                                                                             | **hide** `recoveryCopy`: no crash-recovery copy on the web (Docs hides the same as `autoSaveToDisk`)                        |
| S8 recalc fallback   | stateless job fits (G2-04 precedent); cold import 1.4 s @0.44M, 28–38 s @2M | b1 works (same module) but single-threaded: a cold import blocks the worker's reads, so it needs a 2nd worker and +~1 GiB | **hide** `recalcFallback`: big formula-heavy workbooks keep cached values after edits (desktop does the same past its caps) |
| S9 `.xls` convert    | stateless job fits; 15 ms                                                   | b1: 94 ms incl. start                                                                                                     | hide `xlsImport`: `.xls` cannot be opened in the frame (host routes `.xls` to G3 or asks to convert)                        |
| S10 pivot definition | +RTT                                                                        | b1 or b2                                                                                                                  | hide `pivotRefresh`: pivots display (cached) but Refresh is unavailable                                                     |
| S11 merge workbooks  | as S1/S2 ×N                                                                 | b1 + `file.pick` (repeat single picks)                                                                                    | **hide** `mergeWorkbooks`: Data > Merge workbooks and AI attachment merge gone                                              |

## 6. Recommendation

Per operation:

| Op                                           | Recommendation                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 open, S2 streaming, S3 formulas, S5 close | **(b1) WASM in a Web Worker**. Above the cap (O1), the host keeps G3                                                                           |
| S4 pictures                                  | (b1), same worker                                                                                                                              |
| S6 save                                      | (b1) archive I/O in the worker + TS planner in the frame, then `api.save {data}` (bytes); b2 as a fallback                                     |
| S7 recovery copy                             | **(c) hide** `recoveryCopy` (no disk; explicit save only, lane decision)                                                                       |
| S8 recalc fallback                           | **(c) hide** `recalcFallback` first; later (b1) in a second worker. Not (a): a server job per edit burst with 28–38 s cold imports at 2M cells |
| S9 `.xls` convert                            | (b1): free with the same module (hide `xlsImport` until the worker exists)                                                                     |
| S10 pivot definition                         | (b1) or (b2), trivial                                                                                                                          |
| S11 merge workbooks                          | **(c) hide** `mergeWorkbooks` first; later (b1) + repeated `file.pick`                                                                         |

**Overall: C.** The engine runs in the browser as WASM for every core operation. The 5 peripheral operations are hidden
until follow-ups. Nothing runs server-side: no new stateful office-engine service and no new frame→host read
messages. Files above the WASM cap stay on G3 through the existing fallback (contract C4: G3 whenever the module's bundle
or flag is off). The host needs a size gate: format + size known at token mint, refuse frame mode above the cap.

Reasons, in order: (1) the read path is chatty and stateful, so server-side multiplies network and server memory per
open document; (2) the same engine already runs in WASM with small, `cfg`-gated changes, and desktop keeps the native
binary; (3) the CSP widening (`'wasm-unsafe-eval'`) is already needed by PDF; (4) everything that is not core can be
hidden today with fail-soft behaviour the renderer already has.

**What "A" would change:** the same as C without a cap, only safe once O1 is fixed and memory is bounded (3 GiB at 6.6M
cells is close to the wasm32 limit). **"B"** is the alternative if the user wants no WASM in the frame: expect a new
session service in office-engine and Go, plus new protocol message types, before Sheets can open a file. **"D"** keeps
B6 to the inventory and build work, and xlsx stays on G3.

Until GO-D3 is answered, B6 can build everything that does not depend on it: the web module skeleton, bridge
classification, capability mechanism, the hide list for the 12 general keys, and the build:web module. But **no
end-to-end Sheets flow works in the frame**: `office_sheets_web` must stay off (G3 serves xlsx), which contract C4/C5
already guarantee.

## 7. Preload inventory

Tags as in `inventory-b4.md`: **PROTO** (existing protocol type), **BROWSER** (in-frame browser feature), **HIDE `key`**
(capability key, STUB behind it), **STUB** (typed no-op), **INFRA** (bridge plumbing), plus **SIDECAR** (needs the
GO-D3 engine; classed by the section 6 recommendation). Sites = renderer references `desktopApi\s*?.method` in
`apps/sheets/src/renderer/**` (non-test), first three `file:line`. Aliased users are named.

### 7.1 `window.desktopApi` (64 methods; `apps/sheets/src/shared/desktop-api.ts:2528`)

| #   | method                     | sites                                                                    | channel                          | desktop behaviour                                                  | web class                                                                                                               |
| --- | -------------------------- | ------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `getLanguage`              | 1: main.tsx:63                                                           | `app:get-language`               | shell UI language                                                  | PROTO `init.locale` (host-appearance)                                                                                   |
| 2   | `onLanguageChanged`        | 1: i18n/locale.tsx:81                                                    | `app:language-changed`           | live language switch                                               | PROTO `language` event                                                                                                  |
| 3   | `getTheme`                 | 1: main.tsx:64                                                           | `app:get-theme`                  | light/dark/system                                                  | PROTO `init.theme`                                                                                                      |
| 4   | `onThemeChanged`           | 2: App.tsx:1552, main.tsx:73                                             | `app:theme-changed`              | live theme                                                         | PROTO `theme` event                                                                                                     |
| 5   | `getAutoSaveDefault`       | 0 direct                                                                 | `app:get-auto-save-default`      | shell AutoSave default                                             | HIDE `autoSave` (STUB `{on:false}`)                                                                                     |
| 6   | `onAutoSaveDefaultChanged` | 0 direct                                                                 | `app:auto-save-default-changed`  | live default                                                       | STUB disposer                                                                                                           |
| 7   | `getAiPanelPrefs`          | 1: main.tsx:74                                                           | `app:get-ai-panel-prefs`         | AI dock prefs                                                      | HIDE `ai` (STUB defaults)                                                                                               |
| 8   | `onAiPanelPrefsChanged`    | 1: main.tsx:78                                                           | `app:ai-panel-prefs-changed`     | live prefs                                                         | STUB disposer                                                                                                           |
| 9   | `onChromePressed`          | 1: ColorDropdown.tsx:95                                                  | `app:chrome-pressed`             | shell chrome click closes popups                                   | STUB disposer                                                                                                           |
| 10  | `selectWorkbook`           | 1: App.tsx:3970                                                          | `workbook:select`                | open dialog / queued path → (convert) → snapshot → `open`          | **SIDECAR S1/S9** + PROTO `init.open` / `api.open` / `file.pick` for the bytes                                          |
| 11  | `selectWorkbooksForMerge`  | 1: merge-workbooks.ts:306                                                | `workbook:select-for-merge`      | multi-pick + sessions                                              | HIDE `mergeWorkbooks` (SIDECAR S11)                                                                                     |
| 12  | `openWorkbooksForMerge`    | 1: merge-workbooks.ts:325                                                | `workbook:open-for-merge`        | chat-attachment paths as sessions                                  | HIDE `mergeWorkbooks` (also `ai`)                                                                                       |
| 13  | `readWorkbookRange`        | 10: ai/aggregate-range.ts:396, merge-workbooks.ts:90, :101               | `workbook:read-range`            | `read_range`                                                       | **SIDECAR S2**                                                                                                          |
| 14  | `readWorkbookFormulas`     | 4: ai/formula-audit.ts:385, plan-operations.ts:1351, univer-sync.ts:1376 | `workbook:read-formulas`         | `read_formula_cells`                                               | **SIDECAR S3**                                                                                                          |
| 15  | `recalcWorkbook`           | 1: univer-sync.ts:2380                                                   | `workbook:recalc`                | `recalc_cells` on the snapshot                                     | HIDE `recalcFallback` (SIDECAR S8; STUB rejects, so the renderer keeps cached values)                                   |
| 16  | `readWorkbookMedia`        | 2: WorkbookVisuals.tsx:1594, page-layout-actions.ts:479                  | `workbook:read-media`            | `read_media`                                                       | **SIDECAR S4**                                                                                                          |
| 17  | `readPivotDefinition`      | 1: App.tsx:3783                                                          | `workbook:read-pivot-definition` | `read_entries` ×2 + TS parse                                       | SIDECAR S10, HIDE `pivotRefresh` until the worker exists (STUB rejects, refresh disabled)                               |
| 18  | `readLocalImage`           | 1: op-executor.ts:199                                                    | `shell:read-local-image`         | AI op: read an image file by path                                  | HIDE `ai` (STUB)                                                                                                        |
| 19  | `captureScreenSources`     | 1: ScreenshotDialog.tsx:33                                               | `sheets:capture-screen-sources`  | Insert > Screenshot: window list                                   | HIDE `screenshot`                                                                                                       |
| 20  | `captureScreenSource`      | 1: ScreenshotDialog.tsx:54                                               | `sheets:capture-screen-source`   | capture one window                                                 | HIDE `screenshot`                                                                                                       |
| 21  | `saveWorkbookEdits`        | 2: save-actions.ts:361, :436                                             | `workbook:save`                  | dialogs, disk guards, `writeWorkbookTo`, session swap              | **SIDECAR S6** then PROTO `api.save` / `api.saveAs {data}` (`conflict` → Docs-style dialog)                             |
| 22  | `beginSaveEditsTransfer`   | 0 direct (save-edits-staging.ts:10, 50 via `api`)                        | `workbook:save-edits-begin`      | chunked journal upload (context-bridge cost)                       | INFRA: in-frame pass-through (no bridge hop)                                                                            |
| 23  | `sendSaveEditsChunk`       | 0 direct (save-edits-staging.ts:15, 53)                                  | `workbook:save-edits-chunk`      | ″                                                                  | INFRA                                                                                                                   |
| 24  | `abortSaveEditsTransfer`   | 0 direct (save-edits-staging.ts:21, 76)                                  | `workbook:save-edits-abort`      | ″                                                                  | INFRA                                                                                                                   |
| 25  | `writeWorkbookRecovery`    | 1: save-actions.ts:349                                                   | `workbook:write-recovery`        | S7 copy under userData                                             | HIDE `recoveryCopy` (STUB `{ok:false}`)                                                                                 |
| 26  | `autoRenameWorkbook`       | 1: App.tsx:3055                                                          | `workbook:auto-rename`           | rename untitled after an AI run                                    | HIDE `autoRename` (STUB `{renamed:false}`)                                                                              |
| 27  | `exportPdf`                | 1: page-layout-actions.ts:405                                            | `workbook:export-pdf`            | hidden print window → `printToPDF` (`pdf-export.ts`)               | PROTO `api.export {format:'pdf', html}` (B4 host-route flavour) or BROWSER print-to-PDF; header/footer pictures need S4 |
| 28  | `printWorkbook`            | 1: page-layout-actions.ts:427                                            | `workbook:print`                 | native print dialog                                                | BROWSER `window.print` on a print frame (Docs pattern)                                                                  |
| 29  | `exportCsv`                | 1: csv-export.ts:147                                                     | `workbook:export-csv`            | save dialog + write CSV                                            | BROWSER download (Blob); CSV "Save As" → PROTO `api.saveAs {name, data}`                                                |
| 30  | `confirmCsvSave`           | 1: save-actions.ts:260                                                   | `workbook:csv-save-confirm`      | native message box keep-CSV/xlsx                                   | BROWSER in-frame dialog                                                                                                 |
| 31  | `createDocument`           | 2: ai/create-document.ts:26, :64                                         | `workbook:create-document`       | AI create_document                                                 | HIDE `createDocument`                                                                                                   |
| 32  | `closeWorkbook`            | 3: App.tsx:2864, :3704, merge-workbooks.ts:292                           | `workbook:close`                 | `close` + temp cleanup                                             | **SIDECAR S5**                                                                                                          |
| 33  | `openExternal`             | 1: App.tsx:2777                                                          | `shell:open-external`            | hyperlink in the OS browser                                        | BROWSER `guardedOpen` (http/s, noopener)                                                                                |
| 34  | `onMenuAction`             | 1: App.tsx:2643                                                          | `menu:action`                    | app menu → open/save/save-as/print/export-pdf/export-csv/undo/redo | PROTO host `save`/`saveAs`/`print` requests mapped to the same actions; rest in-frame                                   |
| 35  | `onWorkbookRenamed`        | 1: App.tsx:902                                                           | `workbook:renamed`               | tab title after rename                                             | PROTO `file.renamed` event                                                                                              |
| 36  | `notifyPendingEdits`       | 1: App.tsx:509                                                           | `workbook:pending-edits`         | close guard count                                                  | PROTO `dirty` event                                                                                                     |
| 37  | `onCloseSaveRequest`       | 1: App.tsx:2647                                                          | `workbook:close-save-request`    | shell asks to save before close                                    | PROTO host `save {reason:'navigate'}` / `doc.closeCheck`                                                                |
| 38  | `reportCloseSaveResult`    | 2: App.tsx:3990, :3997                                                   | `workbook:close-save-result`     | answer to 37                                                       | PROTO (the `save` request's result)                                                                                     |
| 39  | `onRecoveryPrompt`         | 1: App.tsx:573                                                           | `workbook:recovery-prompt`       | restore newer recovery copy?                                       | HIDE `recoveryCopy` (STUB disposer)                                                                                     |
| 40  | `replyRecoveryPrompt`      | 1: App.tsx:4166                                                          | `workbook:recovery-prompt-reply` | answer                                                             | STUB                                                                                                                    |
| 41  | `consumeNewBlankWorkbook`  | 1: App.tsx:1605                                                          | `sheets:consume-new-blank`       | shell "New spreadsheet"                                            | STUB `false` (a new blank file is a Documents action; frame opens it via `init.open`)                                   |
| 42  | `consumeAiPreset`          | 1: App.tsx:1613                                                          | `sheets:consume-ai-preset`       | Home / My AI preset                                                | HIDE `ai` (STUB null)                                                                                                   |
| 43  | `onAiPreset`               | 1: App.tsx:1621                                                          | `my-ai:ai-preset`                | live preset                                                        | STUB disposer                                                                                                           |
| 44  | `hasQueuedWorkbook`        | 1: App.tsx:1610                                                          | `sheets:has-queued-workbook`     | a path waits for this tab                                          | PROTO: `true` iff `init.open` present                                                                                   |
| 45  | `consumeHeadlessExport`    | 1: App.tsx:765                                                           | `sheets:consume-headless-export` | headless PDF run target                                            | INFRA headless entry (null in the interactive frame)                                                                    |
| 46  | `headlessExportDone`       | 1: App.tsx:793                                                           | `sheets:headless-export-done`    | headless run result                                                | INFRA                                                                                                                   |
| 47  | `getAiSettings`            | 1: App.tsx:1467                                                          | `ai:get-settings`                | AI provider settings                                               | HIDE `ai`                                                                                                               |
| 48  | `setAiSettings`            | 0                                                                        | `ai:set-settings`                | ″                                                                  | HIDE `ai`                                                                                                               |
| 49  | `aiChat`                   | 0                                                                        | `ai:chat`                        | ″                                                                  | HIDE `ai`                                                                                                               |
| 50  | `aiStream`                 | 1: ai/transport.ts:9                                                     | `ai:stream`                      | ″                                                                  | HIDE `ai`                                                                                                               |
| 51  | `aiStreamCancel`           | 1: ai/transport.ts:10                                                    | `ai:stream-cancel`               | ″                                                                  | HIDE `ai`                                                                                                               |
| 52  | `aiGskStatus`              | 2: App.tsx:853, :1275                                                    | `ai:gsk-status`                  | GenSpark account                                                   | HIDE `ai` / `billing`                                                                                                   |
| 53  | `aiGskLogin`               | 1: ai/AiChatPanel.tsx:636                                                | `ai:gsk-login`                   | ″                                                                  | HIDE `ai`                                                                                                               |
| 54  | `webSearch`                | 1: ai/search-skill.ts:41                                                 | `ai:web-search`                  | AI tool                                                            | HIDE `webSearch`                                                                                                        |
| 55  | `imageSearch`              | 1: ai/image-skill.ts:82                                                  | `ai:image-search`                | AI tool                                                            | HIDE `imageSearch`                                                                                                      |
| 56  | `generateImage`            | 1: ai/image-skill.ts:111                                                 | `sheets:ai-generate-image`       | AI tool                                                            | HIDE `imageGeneration`                                                                                                  |
| 57  | `fetchImage`               | 1: op-executor.ts:189                                                    | `ai:fetch-image`                 | AI op: download an image URL                                       | HIDE `ai` (PROTO `image.fetch` if AI is ever enabled)                                                                   |
| 58  | `onAiStream`               | 1: ai/transport.ts:8                                                     | `ai:stream-chunk`                | ″                                                                  | HIDE `ai`                                                                                                               |
| 59  | `pickAttachments`          | 1: App.tsx:1372                                                          | `sheets:files-pick`              | AI chat attachments                                                | HIDE `ai`                                                                                                               |
| 60  | `addAttachmentPaths`       | 1: App.tsx:1377                                                          | `sheets:files-add`               | ″                                                                  | HIDE `ai`                                                                                                               |
| 61  | `addPastedImage`           | 1: App.tsx:1381                                                          | `sheets:files-add-pasted-image`  | ″                                                                  | HIDE `ai`                                                                                                               |
| 62  | `readAttachment`           | 1: ai/files-skill.ts:80                                                  | `sheets:files-read`              | ″                                                                  | HIDE `ai`                                                                                                               |
| 63  | `readAttachmentImage`      | 2: App.tsx:1315, ai/AiChatPanel.tsx:320                                  | `sheets:files-read-image`        | ″                                                                  | HIDE `ai`                                                                                                               |
| 64  | `getPathForFile`           | 2: ai/AiChatPanel.tsx:469, :479                                          | (sync, `webUtils`)               | OS path of a dropped file                                          | STUB `''`                                                                                                               |

Counts (64): PROTO 11 (1–4, 27, 34–38, 44) · SIDECAR 7 (10, 13, 14, 16, 17, 21, 32) · HIDE 30, of which 3
sidecar-only (11, 12, 15) and 27 general (5, 7, 18–20, 25, 26, 31, 39, 42, 47–63) · STUB 7 (6, 8, 9, 40, 41, 43, 64) ·
BROWSER 4 (28–30, 33) · INFRA 5 (22–24, 45, 46). On desktop, 14 methods reach the sidecar (10–17, 21–25, 32), matching
the 14 channels of section 2. 27 `exportPdf` also needs S4 for header/footer pictures.

### 7.2 `window.projectApi` (10 methods; `apps/sheets/src/preload/index.ts:672`)

`resolveChat`, `appendChat`, `loadChat`, `rebindChat`, `listProjects`, `createProject`, `renameProject`, `deleteProject`,
`moveFile`, `getTimeline` → channels `project:*`. Used only by the AI panel (`App.tsx:928, 989, 1060`, aliased
`api`). Web: INFRA, the Docs in-memory `web/docs/bridge/project-memory.ts`, behind HIDE `ai`.

### 7.3 Channels and capability keys

- **47 `IPC_CHANNELS`** (`apps/sheets/src/shared/ipc-channels.ts`) are all used by the preload. 26 more literal channels
  (`app:*` ×9, `project:*` ×10, `sheets:*` ×5, `ai:web-search`, `my-ai:ai-preset`) make **73 distinct channels**
  (appendix B). The 14 sidecar channels are listed in section 2.
- **No capability mechanism exists in Sheets** (`grep -rl capabilities apps/sheets/src/renderer` → nothing). Proposed:
  add `DesktopApi.capabilities?: SheetsCapabilities`, absent on Electron so everything stays on, and a
  `renderer/capabilities.ts` `cap(key)` helper. This mirrors `apps/docs/src/shared/ipc.ts:227-262` +
  `apps/docs/src/renderer/capabilities.ts`, and is a renderer source change for the B6 implementation worker.

Proposed Sheets capability keys (renderer-local; host protocol grants stay `save`/`saveAs`/`filePick`/`print`/`exportPdf`):

| key               | hides                                                                                                                                                | kind                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `ai`              | AI panel/dock, AI ribbon entries, AI presets, op-executor image ops, chat attachments                                                                | general                  |
| `webSearch`       | AI tool web_search                                                                                                                                   | general                  |
| `imageSearch`     | AI tool image_search                                                                                                                                 | general                  |
| `imageGeneration` | AI tool generate_image                                                                                                                               | general                  |
| `createDocument`  | AI tool create_document                                                                                                                              | general                  |
| `autoRename`      | post-AI rename of untitled workbooks                                                                                                                 | general                  |
| `billing`         | GenSpark account/plan UI                                                                                                                             | general                  |
| `screenshot`      | Insert > Screenshot                                                                                                                                  | general                  |
| `autoSave`        | AutoSave pill + 30 s / blur autosave (web: explicit save only, `e977e00`)                                                                            | general                  |
| `recoveryCopy`    | 30 s crash-recovery copy + restore prompt                                                                                                            | general (uses S6 path)   |
| `open`            | File > Open / Ctrl+O (on only with the host's `filePick` grant)                                                                                      | general                  |
| `exportCsv`       | File > Export CSV / CSV Save As (on: BROWSER download)                                                                                               | general                  |
| `xlsxEngine`      | **the whole workbook surface** (S1–S6, S10): off means the frame shows "engine unavailable"; the host never routes xlsx to the frame while it is off | **sidecar-only (GO-D3)** |
| `recalcFallback`  | IronCalc recalc fallback (S8)                                                                                                                        | **sidecar-only (GO-D3)** |
| `xlsImport`       | `.xls` open (S9)                                                                                                                                     | **sidecar-only (GO-D3)** |
| `pivotRefresh`    | PivotTable refresh (S10)                                                                                                                             | **sidecar-only (GO-D3)** |
| `mergeWorkbooks`  | Data > Merge workbooks, AI attachment merge (S11)                                                                                                    | **sidecar-only (GO-D3)** |

## 8. Standalone renderer web build

Command (under the lock, from `apps/sheets`):
`../../node_modules/.bin/vite build --config vite.renderer.config.ts --outDir <scratch>/sheets-web-dist --emptyOutDir`.

- **Result: success**, `✓ built in 36.35s`. There are no "externalized for browser compatibility" warnings: the renderer
  imports no Node builtins. Only the chunk-size warning appears.
- **Size** (`web/measure/bundle-size.mjs --dist`; `sheets-probes/results/renderer-bundle-size.json`):

  | Type      | Files   | Raw                                   | gzip                   | brotli      |
  | --------- | ------- | ------------------------------------- | ---------------------- | ----------- |
  | **total** | **202** | **23.09 MB**                          | **6.15 MB**            | **4.78 MB** |
  | JS        | 195     | 20.15 MB (main `index-*.js` 10.74 MB) | 4.95 MB (main 3.02 MB) | 3.84 MB     |
  | fonts     | 4       | 2.75 MB                               | 1.16 MB                | 0.91 MB     |
  | CSS       | 1       | 178 KB                                | 30 KB                  | 25 KB       |

  The fonts are 4 Carlito TTFs. The 190 other JS files are mostly Univer locale chunks (60–300 KB each). Option C adds
  the 1.97 MB gzip `.wasm`.

- **Blockers for the web** (none is a build error):
  1. `src/renderer/index.html` carries a desktop `<meta http-equiv="Content-Security-Policy">` with
     `connect-src 'self' ws://localhost:*` and `worker-src 'self' blob:`. The web entry must use the header-only CSP
     (B2B3 rule) and, for C, add `'wasm-unsafe-eval'`.
  2. Absolute `/assets/...` URLs: the plain config has no `base: './'` (same finding as B4).
  3. `window.desktopApi` is required at open (`App.tsx:3967` throws `appBridgeUnavailable`): needs `web/modules/sheets`
     bridge + installer.
  4. No capability mechanism (7.3).
  5. Fonts are TTF; the Docs WOFF2/never-inline rule (C3) needs the WOFF2 plugin for this module.
  6. One 10.7 MB main chunk: works, worth code-splitting later. Not a blocker.

## 9. Open items

- **O1 (resolved, section 4.5):** the wasm build segfaulted the Node 22 process on `open` of a worksheet part ≥ ~8 MB
  uncompressed under `node:wasi` (10k × 22 OK, 15k × 22 crash). Under the browser shim it does not crash, in Chromium or
  in Node, up to 100k × 22 (70.8 MB sheet XML). Cause: Node's experimental `node:wasi` (uvwasi), not the engine.
- **O2:** the native sidecar needs rustc ≥ 1.88 (box default 1.85). CI uses `dtolnay/rust-toolchain` stable, office-engine
  Docker uses 1.88.0. Anyone building on this VPS needs `cargo +1.90.0` (installed under `~/.rustup`).
- **O3:** a fork-side wasm build needs a decision on `zip 0.6` default features via `ironcalc 0.7.1`: vendored
  `[patch]`, an ironcalc feature flag upstream, or clang/wasi-sdk on the build host.
- **O4 (not sidecar):** `planCellEditsToXlsx` throws "Worksheet has no sheetData element." when an edit appends a
  new row on 8 of the 11 G0 fixtures (xlsx-chart, compatibility-basic/edit/structure, protected, satellite-sheets,
  vietnamese, macro). It reproduces identically in the pure-JS `applyCellEditsToXlsx`. Worth a gateway ticket.
- **O5:** `read_media` is unmeasured: none of the 11 G0 fixtures and no fixture-builder variant (`buildSatelliteSheetFixture
{sharedImage}`) produced an `image` visual in the open result. Cost is a zip entry read + base64.
- **O6:** RSS figures are whole-sequence peaks (open + index + recalc + save), not per operation.
- **O7 (resolved, section 4.5):** Chromium numbers measured: 2–3× native for open and reads, about 1× for archive
  writes, about 1.5× for recalc. The first viewport waits for the full index (0.56–4.9 s), which is the follow-up to fix.
- **O8 (new):** the browser shim needs two fixes for product use: geometric file growth (patched in the probe) and
  removal of non-empty directories (`close` fails with `Directory not empty`). Alternative: an in-memory chunk cache in
  the engine instead of a temp directory.

## Appendix A. Reproduce

```sh
# native build (under the lane lock)
cd apps/sheets && flock /home/ubuntu/.uniwork-lane-build.lock cargo +1.90.0 build --release \
  --manifest-path native/xlsx-engine/Cargo.toml --config native/xlsx-engine/.cargo/config.toml
# fixtures
P=docs/web-modules/sheets-probes; G=<dev-uniwork>/docs/office/g0/fixtures/files/sheets
node_modules/.bin/tsx $P/gen-large.ts /tmp/large-100000.xlsx 100000 20
# native probe
node_modules/.bin/tsx $P/measure-sidecar.ts $PWD/apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar \
  out.json $G/*.xlsx $G/*.xlsm --edits 10 --xls $G/legacy-xls.xls
# pure JS
node_modules/.bin/tsx $P/measure-js.ts /tmp/large-100000.xlsx 1000
# wasm: copy native/xlsx-engine + zip-0.6.6 from ~/.cargo/registry, apply wasm-probe.patch, then
cargo +1.90.0 build --release --target wasm32-wasip1
printf '#!/bin/sh\nexec node --no-warnings %s\n' "$PWD/$P/wasi-sidecar.mjs" > /tmp/wasm-sidecar.sh; chmod +x /tmp/wasm-sidecar.sh
SIDECAR_WASM=<target>/wasm32-wasip1/release/xlsx-sidecar.wasm node_modules/.bin/tsx $P/measure-sidecar.ts /tmp/wasm-sidecar.sh out.json ...
# renderer web build
cd apps/sheets && flock /home/ubuntu/.uniwork-lane-build.lock ../../node_modules/.bin/vite build \
  --config vite.renderer.config.ts --outDir /tmp/sheets-web-dist --emptyOutDir
node web/measure/bundle-size.mjs out.json --dist /tmp/sheets-web-dist
```

## Appendix B. Grep evidence

```text
$ grep -rln "XlsxSidecarClient|xlsx-sidecar|resolveSidecarPath|sidecarPath" apps packages (non-test runtime files)
apps/sheets/src/main/xlsx-sidecar-client.ts      # the client
apps/sheets/src/main/sheets-main.ts              # every app call site (section 2)
apps/shell/src/main/index.ts                     # binary path + stopSheetsSidecar() only
packages/xlsx-gateway/src/gateway/xlsx-package-io.ts  # save/read archive helpers (ArchiveClient)
packages/cli/src/formats/xlsx.ts, packages/cli/src/resources.ts  # CLI, own per-call process
(apps/slides/src/main/ai-ipc.ts matches "sidecarPath" for an unrelated .styleskill.json file)

$ grep -nE "(client|entry\.client)\.(open|readRange|readFormulaCells|readMedia|close|convertWorkbook|recalcCells)\(|readArchiveEntryText|saveWorkbookViaSidecar" apps/sheets/src/main/sheets-main.ts
2491 2533 3051 3152 4269  close            2599 readRange        2607 readFormulaCells
2642 recalcCells                          2682 readMedia        2804 2805 readArchiveEntryText
3837 saveWorkbookViaSidecar               3930 open             4035 convertWorkbook
$ grep -n "client\.\(readEntries\|archiveManifest\|saveArchive\|scanEntries\)" packages/xlsx-gateway/src/gateway/xlsx-package-io.ts
127 readEntries  147 archiveManifest  184 saveArchive  230 scanEntries  252 readEntries

$ node (scanner over apps/sheets/src/preload/index.ts: ipcRenderer.(invoke|send|on)(<channel>))
73 distinct channels = 47 IPC_CHANNELS.* + 26 literals; every IPC_CHANNELS key is used.
```

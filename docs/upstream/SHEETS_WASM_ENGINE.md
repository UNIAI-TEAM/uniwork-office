# Sheets wasm engine: what the fork changes in the xlsx-sidecar (UNI-1016)

The Sheets web frame (GO-D3 = C, lane contract C11) runs upstream's xlsx-sidecar
(`apps/sheets/native/xlsx-engine`) as a `wasm32-wasip1` **reactor** in a Web Worker. The desktop binary and its
`cargo test` are unchanged. Everything web-specific is either behind `cfg(target_os = "wasi")` in upstream's files,
or lives in the UniWork-owned `wasm/` directory.

## Changes inside upstream's sources (re-apply after a conflicting sync)

| file               | wasi-only change                                                                                                                                                                                                                                                                                                                                     | why                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/main.rs`      | `mod wasm_reactor`: exports `xlsx_sidecar_alloc`, `xlsx_sidecar_handle` (one NDJSON request line → response on fd 1, through the unchanged `handle_request`) and `xlsx_sidecar_index_step`; the recalc worker runs inline; a no-op `main`; thread/mpsc/BufRead imports gated                                                                         | wasm32-wasip1 has no threads; the frame drives the engine call by call              |
| `src/lib.rs`       | `canonicalize()` → the given path; `temp_root()` (`$TMPDIR` or `/tmp`) instead of `std::env::temp_dir()`; resumable index: `advance_index` / `index_pending` / `WorkbookSessions::index_step`, `SheetIndex.done_chunk` / `pause_after_chunk`, `SheetRuntime.started`; `read_range` indexes through the requested rows and never waits on the condvar | no realpath; `temp_dir()` panics on wasip1; the index thread becomes passes (below) |
| `src/worksheet.rs` | `flush_chunk` skips chunks an earlier pass flushed and pauses after the pass target (`INDEX_PAUSED`); the end-of-sheet flush clears the pause                                                                                                                                                                                                        | incremental index                                                                   |
| `src/archive.rs`   | `same_file()`: `canonicalize()` comparison on desktop, plain comparison on wasi                                                                                                                                                                                                                                                                      | no realpath                                                                         |

Non-wasi code is untouched apart from that `same_file` extraction (same comparison) and the `cfg!(target_os = "wasi")`
term in `read_range` (false on the desktop).

**Incremental index.** The desktop indexes a worksheet on a background thread. Without threads, an index pass parses the
worksheet from the start, skips the chunks (256 rows each) that earlier passes already wrote, and pauses after
`max(requested chunk, 4 × previous extent)`. The first viewport needs one chunk, and the whole sheet costs about two
parses spread over background passes. The Worker runs `xlsx_sidecar_index_step` between requests.

## UniWork-owned: `apps/sheets/native/xlsx-engine/wasm/`

- `Cargo.toml`: a `cdylib` reactor that depends on the parent crate and compiles `../src/main.rs` as a module, with its
  own `Cargo.lock` (seeded from the parent's) and a `[patch.crates-io]` for zip 0.6.6.
- `build-wasm.mjs` (run by `build:web --module sheets`):
  - `cargo fetch`, then vendors the registry's zip 0.6.6 with `default = ["deflate"]`. ironcalc 0.7.1 pulls zip 0.6
    with bzip2/zstd, which are C libraries that need a C toolchain for wasm, and IronCalc reads only deflate parts. The
    registry `Cargo.toml` sha256 is checked first.
  - builds with the toolchain pinned in `rust-toolchain.toml` (1.90.0 + wasm32-wasip1, installed by rustup on demand),
    `--locked`, with remapped paths;
  - checks the module against `xlsx-sidecar.wasm.sha256`, or `--update-checksum` after an intended engine change.
  - `WEB_SHEETS_WASM=<file>` supplies a prebuilt module, still checksum-verified.
- Upstream `cargo` changes to the parent's dependency versions flow in through `cargo fetch`. If a new upstream
  dependency needs C code for wasm, the build fails at `cargo build`; patch it the way zip is patched.

## After an upstream sync

1. `cargo +1.90.0 test --manifest-path apps/sheets/native/xlsx-engine/Cargo.toml` (desktop).
2. `node apps/sheets/native/xlsx-engine/wasm/build-wasm.mjs`. On a checksum mismatch caused by upstream engine
   changes, run `npx vitest run --root web/modules` (the real-engine tests), then `--update-checksum` and commit.
3. If upstream added a new sidecar command, it works on wasm without changes: `handle_request` is shared. If it starts
   threads or calls `canonicalize` / `temp_dir`, it needs a wasi branch like the ones above.

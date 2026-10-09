//! xlsx-sidecar WebAssembly reactor (UNI-1016). The request loop, protocol types and
//! command handling are the desktop sidecar's own `src/main.rs`; on wasm32-wasip1 it exports
//! `xlsx_sidecar_alloc` / `xlsx_sidecar_handle` / `xlsx_sidecar_index_step` (see
//! `wasm_reactor` there) instead of reading stdin on threads.
#![allow(dead_code)]

#[path = "../../src/main.rs"]
mod sidecar;

# F4 (UNI-1013) visual fixes: before / after

Captured through the protocol test host (`web/server/test-host`), headless Chromium, by
`capture.mjs` here (`node capture.mjs <repo> <baseUrl> <outDir> <before|after>`).
Before = fork `b7e577d` (code `5a81008`), after = `9b93c9b`. Measured DOM facts per run are in
`facts-before.json` / `facts-after.json`.

| Finding                          | Files                                                             | Result                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| #2 dark File button contrast     | `01-dark-ribbon-file-*`                                           | white on `#4a9eff` 2.75:1 -> white on `#2a6fd0` 4.9:1 (new `--docs-accent-fill` token, light/dark/system-dark)                     |
| #5 conflict dialog focus         | `02-conflict-dialog-*`                                            | initial focus Overwrite -> Cancel; Overwrite red "danger" style; Esc = Cancel; Tab trapped                                         |
| #11 frame scrim                  | `02-conflict-dialog-*`                                            | dark grey scrim -> light blurred scrim like the host's dialogs; frame emits protocol `modal` {open} for the host                   |
| #4 dirty / saved state           | `03a-status-opened-*`, `03b-status-dirty-*`, `03c-status-saved-*` | stale "Opened x" kept while editing -> "Có thay đổi chưa lưu" / "Đã lưu mọi thay đổi", stale message cleared on edit               |
| #6 export fallback message (vi)  | `04-export-fallback-vi-*`                                         | "Đã xuất PDF: simple.pdf (browser print dialog)" -> "Không xuất được PDF trực tiếp; đã dùng hộp thoại in của trình duyệt thay thế" |
| #7 Styles at 1024 (frame 944 px) | `05-ribbon-944-vi-light-*`, `05-ribbon-944-en-dark-*`             | row 1121 px in 944 (card cut) -> 944 in 944, one card + expander                                                                   |
| #8 loading / save-as feedback    | `06a-opening-*`, `06b-saving-as-*`, `06c-saved-as-*`              | "Ready" while opening -> spinner + "Opening…"; Save As shows "Saving as…"                                                          |

Not changed: #1 (dark page), pending a product decision.

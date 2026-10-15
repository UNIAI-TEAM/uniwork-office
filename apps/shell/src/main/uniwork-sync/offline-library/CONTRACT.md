# Offline library engine - contract (card G5-05)

Read-only pinning (the read-only pinning / edit-lock decision): pin, download (progress + cancel), verify, cache, `openCached()`
read-only, refresh, unpin, quota. No offline editing, no "Giữ quyền sửa khi offline" hold, no
drafts created offline (G5-08d); no renderer / i18n / S3 UI and no wiring of `openCached()` into
the docs open path (G5-05u / G5-08d). Values come from U-01 and EXPERIENCE S3; nothing here
re-decides them.

## Row states (EXPERIENCE › Offline library rows, S3)

`waiting-network`, `downloading`, `verifying`, `ready`, `update-available`, `update-kept`,
`interrupted`, `disk-full`, `corrupt`, `lease-expiring`, `lease-expired`, `locked`, `revoked`,
`deleted`, `archived`, `moved`, `view-only`.

A row shows one state. `effectiveRowState()` picks the highest of every condition that holds, in
this order (S3 priority):

1. `revoked`, `deleted`
2. `lease-expired`, `locked`
3. `disk-full`, `corrupt`
4. `interrupted`
5. `downloading`, `verifying`
6. `lease-expiring`
7. `update-available`, `update-kept`
8. `waiting-network`
9. `archived`, `moved`
10. `ready`, `view-only`

Conditions come from the stored row (base state, `updateAvailable` / `updateKept` / `archived`
flags) and from the lease manager's effective state of the document: `expiring_soon` ->
`lease-expiring`; `expired` / `clock_rollback` -> `lease-expired`; `locked` / `keystore_locked` /
`keyring_unavailable` (or no lease while a committed copy exists) -> `locked`; `revoked` ->
`revoked`; a `view` lease on a ready copy -> `view-only`.

## Result codes

Refusals carry `{ kind: 'refused', code }`:

| Code                                                   | When                                                                                              | UI key (G5-05u)       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------- |
| `offline_cap_reached`                                  | 2 GiB of pinned bytes or 200 pins per account per machine would be crossed; nothing is downloaded | `uwOfflineCapReached` |
| `too_large`                                            | one file (main or declared asset) over 256 MiB (`MAX_DOWNLOAD_BYTES`)                             | -                     |
| `capability_off`                                       | app capability `offline_library` off: new pins, refresh and re-download refused (OQ-UX11 a)       | -                     |
| `not_a_file`                                           | the document is not a file (no folder / space pinning in v1)                                      | -                     |
| `not_pinned`                                           | the document has no pin                                                                           | -                     |
| `not_ready`                                            | no verified committed copy                                                                        | -                     |
| `corrupt`                                              | the committed copy failed verification on open; the row turns `corrupt` and its bytes are deleted | -                     |
| `lease_unusable`                                       | the lease does not allow opening (`state` says which)                                             | by lease reason       |
| `revoked`, `deleted`                                   | the copy was removed for lost permission / server deletion                                        | -                     |
| `no_session`, `keystore_locked`, `keyring_unavailable` | the store cannot be reached right now                                                             | -                     |

`unpin()` returns `{ kind: 'needsConfirm' }` when the document still has drafts or intents
(UI `uwOfflineUnpinConfirm`) and is called again with `{ confirmed: true }`.

## Manifest

```
PinManifest = {
  main:   { version, versionId?, sha256, sizeBytes, filename, mimeType }
  assets: [{ path, sha256, sizeBytes }]
}
```

v1 builds it from `GET /documents/{id}` (`file.version`, `file.version_id`,
`file.checksum_sha256`, `file.size_bytes`, `file.filename`, `file.mime_type`) with `assets: []`
(Advisor Q1). The engine verifies every declared asset: a missing asset or a checksum / size
mismatch keeps the snapshot from becoming ready. Asset bytes come through the injectable
`fetchAsset` port; production has none yet (D residual: an asset manifest and route, see the
W5 report).

## Store

- `OFFLINE_LIBRARY_STORE_REGISTRATION` = `offline-library`, schema 1, `APP_STORE_LEVEL`.
- Lives in its own encrypted store layer (`userData/uniwork-sync/library/store`, its own
  safeStorage-wrapped key per scope under `.../library/keys`) so library bytes never count
  against the sync store budget. Layer budget `OFFLINE_LIBRARY_LAYER_BUDGET_BYTES` =
  2 GiB quota + 256 MiB staging + 16 MiB overhead; the quota itself is enforced by the
  manager from manifest sizes.
- Records: `index` (pin ids + deferred cleanups), `pin/<id>` (the row), `blob/<id>/<gen>/main`
  and `blob/<id>/<gen>/asset/<n>` (file bytes). Every byte is an AES-256-GCM record; there is no
  plaintext copy, temp file or staging file outside the store.
- Staging: a download writes generation `<gen>` blobs that only the row's `staging` field names;
  the copy is committed by one atomic row write (`readyGeneration = <gen>`) after every checksum
  passed on the bytes read back from the store. A failure deletes the staging blobs.
- Result kinds as the lease store: `keystore_locked`, `keyring_unavailable`, `no_session`,
  `store_full`, `refused`, plus `interrupted` (the scope was wiped under the call) and, for
  blobs, `missing` / `corrupt`. A filesystem `ENOSPC` is `store_full`.

## Download outcomes

| Outcome                                                   | First download                                            | Re-download (a `ready` copy exists)                   |
| --------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| cancel / network loss                                     | `interrupted`, staging wiped                              | `interrupted`, staging wiped, old copy kept and opens |
| `store_full` / disk full                                  | `disk-full`                                               | old copy kept, `update-kept`                          |
| checksum / size mismatch, truncated, missing or bad asset | `corrupt`                                                 | old copy kept, `update-kept`                          |
| over 256 MiB                                              | `too_large` refusal                                       | old copy kept, `update-kept`                          |
| sign-out / account boundary                               | `interrupted`, staging wiped, nothing ready, no plaintext | same                                                  |

"Ready" is only reported after verification.

## Reactions

- Quota U-01: 2 GiB and 200 pins per account per machine; the first hit refuses with
  `offline_cap_reached` before anything is downloaded.
- Pin while offline -> `waiting-network`; `onReconnect()` downloads it.
- Unpin deletes only that pin's committed cache, assets and staging; never drafts, intents or the
  queue. While a tab has the document open (`markOpen` / `markClosed`) the bytes are deleted when
  the last tab closes; the pending cleanup is persisted in the index and finished by `recover()`.
- `evict()` drops the committed copy and keeps the pin (`waiting-network`).
- Deleted on the server, `permission_revoked`, or a lease revoke notice with
  `deleteCommittedCache` -> committed cache + assets deleted at once, row `deleted` / `revoked`,
  drafts untouched (kept locked by the lease).
- Archived -> row stays (`archived`), `openCached()` works while the lease is usable, then the
  lease locks it (`lease-expired`).
- Capability `offline_library` off (OQ-UX11 a) -> copies kept until re-enabled or sign-out, they
  open while the lease is valid, new pins / refresh refused with `capability_off`, no renew.
- Sign-out / account switch -> `lockBoundary()` aborts every download (no commit) and the wiring
  wipes the library scope beside the sync scope.
- Every removal deletes the bytes from disk: no encrypted blob or staging record of that pin is
  left under the store root.

# GO-1 telemetry audit

> **Superseded (UNI-1002 follow-up):** the GA4 tracker described below (`apps/shell/src/main/analytics.ts`, the Settings switch, the `GENOFFICE_GA4_*` packaging variables) was removed from the product. The brand scan fails on `google-analytics.com` and GA4 credentials in source or packaging config. This table is the historical GO-1 state.

| Channel | Class | Notes |
| --- | --- | --- |
| GA4 Measurement Protocol | `THIRD_PARTY` when packaged **with injected keys**; `DISABLED` in source/dev and UniWork GO-1 packs | `apps/shell/src/main/analytics.ts`. Keys come from `GENOFFICE_GA4_*` at electron-builder time. Not in the repo. `extractPackagedAnalyticsKeys` returns null unless `app.isPackaged`. |
| Sentry / Amplitude / PostHog / Mixpanel / Segment | `DISABLED` | No matches in application code |
| Electron `crashReporter` | `DISABLED` | No matches |
| `@univerjs/telemetry` | `REVIEW_REQUIRED` | Transitive Univer dependency; no direct app import found |
| OpenTelemetry packages in lockfile | `REVIEW_REQUIRED` | lockfile only; no app wiring found |

## UniWork GO-1 policy

- Do not set `GENOFFICE_GA4_MEASUREMENT_ID` or `GENOFFICE_GA4_API_SECRET` when packaging.
- Source/`npm run dev` builds never send GA4.
- Settings → General still exposes the analytics toggle for packaged builds that *do* have keys (upstream behavior). Without keys the tracker is a no-op.
- Official GenOffice marketing analytics therefore cannot silently run in a UniWork fork unless someone injects those secrets.

## Remaining

The settings copy still describes GA4 because the code path still exists. It does not send data without packaged credentials.

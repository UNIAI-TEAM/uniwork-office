# uniAI PWA

Standalone ChatGPT-style shell for UniWork AI (Token Hub + UniOffice hub).

**Office roadmap (in this PWA):**

1. **Open UniWork Office** — `uniwork://office/app?kind=docs|sheets|…` or Bridge `uniwork://office/open?token=…` when API + Work Product ID are set (Settings → Office Bridge).
2. **On-device preview** — upload PDF / Markdown / HTML / images (IndexedDB); DOCX/XLSX/PPTX open via desktop UniOffice.
3. **Hybrid** — detail view = preview (when possible) + primary CTA **Mở trong UniWork Office**.

## Production / staging URL

Serve this folder at **`https://uniwork.app/app/`** (trailing slash; `start_url` / `scope` are `/app/`).

Staging can mirror the same path on a preview host, e.g. `https://staging.uniwork.app/app/`.

## Local

```bash
npm run start -w @uniwork/uniai-pwa
# → http://localhost:5188
```

## Deploy

Copy static assets (`index.html`, `fonts.css`, `styles.css`, `plans.js`, `office-hub.js`, `app.js`, `sw.js`, `manifest.webmanifest`, `fonts/`, `icons/`) to the CDN/origin path `/app/` with HTTPS. Service worker and installability require a secure origin. Self-hosted Inter + Be Vietnam Pro (OFL) cover English and Vietnamese offline.

## Install (users)

Settings → **uniAI** in UniWork Office opens `https://uniwork.app/app` and lists Chrome / Edge / Safari install steps. Or open the URL and use the browser’s Install / Add to Home Screen.

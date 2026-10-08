export interface PwaWorkProductView {
  workProductId: string
  title: string
  fileName: string
  supported: boolean
}

/**
 * Minimal UniWork PWA snippet: Open in UniWork Office + not-installed fallback.
 * Production UniWork should call POST /api/office/sessions with the signed-in user cookie/bearer.
 */
export function renderWorkProductPage(view: PwaWorkProductView): string {
  const title = escapeHtml(view.title)
  const fileName = escapeHtml(view.fileName)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · UniWork</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; }
    button { padding: 0.6rem 1rem; border-radius: 8px; border: 0; background: #1e3a5f; color: #fff; cursor: pointer; }
    .muted { color: #555; margin-top: 1rem; }
    .fallback { display: none; border: 1px solid #ddd; padding: 1rem; border-radius: 8px; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Work Product · ${fileName}</p>
  ${
    view.supported
      ? `<button id="open">Open in UniWork Office</button>
         <p id="status" class="muted"></p>
         <div id="fallback" class="fallback">
           <p>UniWork Office is required to edit this file.</p>
           <button type="button" id="retry">Retry</button>
         </div>`
      : `<p>Unsupported format.</p>`
  }
  <script>
    const documentId = ${JSON.stringify(view.workProductId)};
    const openBtn = document.getElementById('open');
    const status = document.getElementById('status');
    const fallback = document.getElementById('fallback');
    async function openOffice() {
      if (!openBtn) return;
      status.textContent = 'Opening UniWork Office…';
      fallback.style.display = 'none';
      const res = await fetch('/api/office/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (window.__UNIWORK_USER_TOKEN || '') },
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) {
        status.textContent = 'Session expired or you do not have access.';
        return;
      }
      const body = await res.json();
      window.location.href = body.launchUrl;
      setTimeout(() => { fallback.style.display = 'block'; status.textContent = 'UniWork Office not installed'; }, 2500);
    }
    openBtn?.addEventListener('click', () => { void openOffice(); });
    document.getElementById('retry')?.addEventListener('click', () => { void openOffice(); });
  </script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

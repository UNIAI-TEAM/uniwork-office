import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, screenshotPath } from './helpers'

/**
 * G6-09 N4 on the real desktop shell: the html-preview:// document carries a policy that Chromium
 * enforces (not just a header string a unit test reads). A hostile page that runs inline script,
 * fetches and nests a frame must (1) still run its own inline script, (2) record
 * `securitypolicyviolation` for connect-src and frame-src, and (3) never reach a local server.
 *
 * Red check (the lead's cloud shard): empty `PREVIEW_CONTENT_SECURITY_POLICY` in
 * apps/html/src/main/preview-protocol.ts (`export const PREVIEW_CONTENT_SECURITY_POLICY = ''`),
 * rebuild the shell, run this spec: the violation and no-request assertions must fail while the
 * "own inline script ran" assertion still passes. Restore the policy and it passes.
 */
test.describe('html preview policy (desktop)', () => {
  test('blocks fetch and nested frames of a page, keeps its own inline script running', async () => {
    const hits: string[] = []
    const server = createServer((req, res) => {
      hits.push(req.url ?? '')
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
      res.end('reached')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const dir = await mkdtemp(join(tmpdir(), 'genoffice-html-csp-'))
    const htmlPath = join(dir, 'hostile.html')
    await writeFile(
      htmlPath,
      `<!doctype html><html><head><title>hostile</title></head><body>
<h1 id="ran">before</h1>
<ul id="violations"></ul>
<script>
  // listener first: every blocked request below reports here, into the DOM the test reads
  document.addEventListener('securitypolicyviolation', function (e) {
    var li = document.createElement('li')
    li.textContent = e.violatedDirective
    document.getElementById('violations').appendChild(li)
  })
  // the page's own inline script still runs under the policy
  document.getElementById('ran').textContent = 'inline script ran'
  // network: connect-src 'none'
  fetch('${origin}/probe-fetch').catch(function () {})
  // nested page: frame-src 'none'
  var frame = document.createElement('iframe')
  frame.src = '${origin}/probe-frame'
  document.body.appendChild(frame)
</script>
</body></html>
`,
    )

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'html-preview-csp',
      openFile: htmlPath,
    })
    const { app } = launched
    try {
      const editorPage = await waitForPageWithUrl(app, '://html/')
      const frame = editorPage.frameLocator('.preview-frame')
      // the document rendered and its inline script ran (default-src 'none' did not break it)
      await expect(frame.locator('#ran')).toHaveText('inline script ran')
      // Chromium reported the blocked requests as violations of the two directives
      await expect(frame.locator('#violations li')).toContainText(['connect-src', 'frame-src'])
      await editorPage.screenshot({ path: screenshotPath('html-preview-csp') })
      // and neither request ever left the page: the local server saw nothing
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(hits).toEqual([])
    } finally {
      await closeAndSaveVideo(launched, 'html-preview-csp')
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

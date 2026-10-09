/**
 * Web-only build plugins of the Slides module (GO-B5): the pptx engine/ops/render closure now
 * runs in the frame, so its Node imports get browser shims (./shims) and its free `Buffer`
 * identifier gets an explicit import of the Buffer shim. Scoped to those three packages (and
 * the slides session core) so no other module of the bundle sees a Node-looking global.
 * Wired through `webPlugins` of the slides entry in web/docs/build/modules.ts.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const shim = (name: string): string => resolve(here, 'shims', name)

/** node specifiers the engine closure imports -> browser shim */
export const NODE_SHIMS: Readonly<Record<string, string>> = {
  'node:crypto': shim('crypto.ts'),
  'node:zlib': shim('zlib.ts'),
  'node:fs': shim('node-fs.ts'),
  'node:stream/promises': shim('node-fs.ts'),
}

/** source files whose free `Buffer` gets the shim import */
const BUFFER_SCOPE = /[\\/]packages[\\/]pptx-(?:engine|ops|render)[\\/]src[\\/].*\.ts$/
const USES_BUFFER = /\bBuffer\b/
const DECLARES_BUFFER =
  /\bimport\s*(?:type\s*)?\{[^}]*\bBuffer\b[^}]*\}|\b(?:const|let|var|class|function)\s+Buffer\b/

export function injectBuffer(id: string, code: string): string | null {
  if (!BUFFER_SCOPE.test(id) || !USES_BUFFER.test(code) || DECLARES_BUFFER.test(code)) return null
  return `import { Buffer } from ${JSON.stringify(shim('buffer.ts'))};\n${code}`
}

export default function slidesWebPlugins(): Plugin[] {
  return [
    {
      name: 'slides-web-node-shims',
      enforce: 'pre',
      resolveId(source) {
        return NODE_SHIMS[source] ?? null
      },
      transform(code, id) {
        const out = injectBuffer(id.split('?')[0]!, code)
        return out === null ? null : { code: out, map: null }
      },
    },
  ]
}

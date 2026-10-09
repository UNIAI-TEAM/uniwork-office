import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { buildCspManifest, buildHeadersManifest, type CspOptions } from './csp'
import { buildManifest, MANIFEST_FILE } from './manifest'
import type { VersionInfo } from './version'

const FONT_FILE = /\.(ttf|otf|woff2?)$/i

/**
 * Font files never go into the entry bundle:
 *  - emitted under fonts/ (hashed, immutable-cacheable, easy for a host to put on its own path/CDN),
 *  - never inlined into the CSS as data: URIs (Vite inlines assets under 4 KiB by default), so
 *    `font-src` needs no data: and every face stays an individually fetched, on-demand file.
 * The @font-face rules themselves (apps/docs fonts.css) are what makes loading lazy: a browser fetches a
 * face only when text is laid out (or canvas-measured) in a family/unicode-range that resolves to it.
 */
export const fontBuildOptions = {
  assetsInlineLimit: (file: string): boolean | undefined =>
    FONT_FILE.test(file) ? false : undefined,
  assetFileNames: (info: { names?: string[]; name?: string }): string => {
    const name = info.names?.[0] ?? info.name ?? ''
    return FONT_FILE.test(name) ? 'fonts/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'
  },
}

export interface WebDocsPluginOptions {
  version: VersionInfo
  csp?: CspOptions
  /** written to manifest.json `module` (default 'docs') */
  module?: string
}

/**
 * After the bundle is written: stamp the version into index.html, then emit csp.json, headers.json and
 * manifest.json next to it (manifest last: it lists and hashes everything else).
 */
export function webDocsManifestPlugin({
  version,
  csp,
  module = 'docs',
}: WebDocsPluginOptions): Plugin {
  let outDir = ''
  return {
    name: 'web-docs-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { name: 'docs-web-version', content: version.version },
          injectTo: 'head',
        },
      ]
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const cspManifest = buildCspManifest(csp)
        writeFileSync(join(outDir, 'csp.json'), JSON.stringify(cspManifest, null, 2) + '\n')
        writeFileSync(
          join(outDir, 'headers.json'),
          JSON.stringify(buildHeadersManifest(cspManifest), null, 2) + '\n',
        )
        const manifest = buildManifest({ dir: outDir, version, module })
        writeFileSync(join(outDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n')
        const mib = (n: number) => (n / 1024 / 1024).toFixed(2)
        console.log(
          `\nweb-${module} ${manifest.version}: ${manifest.files.length} files, ${mib(manifest.totalBytes)} MiB (gzip ${mib(manifest.gzipBytes)}); ` +
            `initial ${mib(manifest.initial.bytes)} MiB (gzip ${mib(manifest.initial.gzipBytes)}), deferred ${mib(manifest.deferred.bytes)} MiB\n  -> ${outDir}`,
        )
      },
    },
  }
}

#!/usr/bin/env node
// Builds every app-icon file of the artwork overlay (tools/rebrand/assets/) from the UniWork Office
// logo, a single SVG: the packager icons (png / ico / icns / hicolor sizes), the macOS grid-margin
// variant and the in-app logo. Each size is rasterized from the vector, not scaled from a bitmap.
//
//   node tools/rebrand/gen-brand-icons.mjs [logo.svg]
//   node tools/rebrand/rebrand.mjs --icons [logo.svg]    same, then applies the overlay in one step
//
// The logo defaults to assets/_source/uniwork-office-logo.svg (the source of truth, the "Page" mark:
// two people forming a W on a blue-cyan gradient, document-page tile with a folded corner). The
// `_source` folder is not an overlay: rebrand.mjs never copies it into the repo. Outputs are
// committed; `node tools/rebrand/rebrand.mjs` copies them over upstream's icons after a sync, so
// the build never runs this script: it is only needed when the logo changes. It relies on the
// transitive, optional @napi-rs/canvas (not a declared dependency of the repo, so nothing is added
// to package.json); when that package is missing the script stops with a clear message.
//
// The macOS icon follows Apple's grid (824 / 1024 content, transparent margin, same treatment as
// upstream's icon-mac.png); the icns packs PNG entries (types icp4..ic14), no iconutil needed.
// The ico packs PNG entries too (16, 24, 32, 48, 64, 128, 256), which Windows reads since Vista.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, 'assets')
export const DEFAULT_LOGO = join(ASSETS, '_source', 'uniwork-office-logo.svg')
const HICOLOR_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const MAC_CONTENT_RATIO = 824 / 1024

let canvasModule
/** @napi-rs/canvas arrives only transitively, so it is loaded when first drawn, with a readable failure */
async function loadCanvas() {
  if (canvasModule) return canvasModule
  try {
    canvasModule = await import('@napi-rs/canvas')
  } catch (error) {
    throw new Error(
      'gen-brand-icons needs @napi-rs/canvas, which is not installed here (it is only a transitive, ' +
        'optional dependency). Run npm install (or install it ad hoc without saving it: ' +
        'npm i --no-save @napi-rs/canvas) and try again. The generated icons are committed, so this ' +
        'is only needed when the logo changes.',
      { cause: error },
    )
  }
  return canvasModule
}

function put(rel, data) {
  const target = join(ASSETS, rel)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
  console.log(`wrote ${rel}`)
}

/**
 * Rasterizes the SVG into a size x size PNG, the artwork scaled to `ratio` of the canvas and
 * centred (the rest stays transparent). The logo only has a viewBox, so it is given the pixel size
 * it is drawn at, which keeps every size crisp.
 */
async function rasterize(svg, size, ratio = 1) {
  const { createCanvas, loadImage } = await loadCanvas()
  const side = Math.round(size * ratio)
  const img = await loadImage(
    Buffer.from(svg.replace('<svg ', `<svg width="${side}" height="${side}" `)),
  )
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, (size - side) / 2, (size - side) / 2, side, side)
  return canvas.toBuffer('image/png')
}

/** .ico container with PNG entries, one per size. */
function ico(pngBySize) {
  const sizes = [...pngBySize.keys()]
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2) // resource type: icon
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length + sizes.length * 16
  const dir = sizes.map((size) => {
    const png = pngBySize.get(size)
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // 0 means 256
    entry[1] = size >= 256 ? 0 : size
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([head, ...dir, ...sizes.map((size) => pngBySize.get(size))])
}

/** .icns container with PNG entries (the format macOS reads since 10.7). */
function icns(pngBySize) {
  const entries = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32], // 16 @2x
    ['ic12', 64], // 32 @2x
    ['ic13', 256], // 128 @2x
    ['ic14', 512], // 256 @2x
  ]
  const chunks = entries.map(([type, size]) => {
    const png = pngBySize.get(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

/** Maps every size to its PNG. */
async function rasterizeAll(svg, sizes, ratio = 1) {
  return new Map(await Promise.all(sizes.map(async (s) => [s, await rasterize(svg, s, ratio)])))
}

/** Writes every icon slot of the overlay from the logo SVG at `logoPath`. */
export async function generateBrandIcons(logoPath = DEFAULT_LOGO) {
  const svg = readFileSync(resolve(logoPath), 'utf8')
  if (!/<svg\s[^>]*viewBox=/.test(svg) || /<svg\s[^>]*\swidth=/.test(svg)) {
    throw new Error(`${logoPath}: expected an <svg> with a viewBox and no fixed width / height`)
  }
  const flat = await rasterizeAll(svg, [...new Set([...HICOLOR_SIZES, ...ICO_SIZES])])
  const mac = await rasterizeAll(svg, [16, 32, 64, 128, 256, 512, 1024], MAC_CONTENT_RATIO)
  const icoBytes = ico(new Map(ICO_SIZES.map((s) => [s, flat.get(s)])))
  const icnsBytes = icns(mac)

  // packager icons: the shell app, and the standalone Docs app that builds from its own build/ dir
  for (const app of ['shell', 'docs']) {
    put(`apps/${app}/build/icon.png`, flat.get(1024))
    put(`apps/${app}/build/icon.ico`, icoBytes)
    put(`apps/${app}/build/icon-mac.png`, mac.get(1024))
    put(`apps/${app}/build/icon.icns`, icnsBytes)
  }

  // Linux icon SET (electron-builder `linux.icon: 'build/icons'`): <n>x<n>.png and the hicolor
  // layout <n>x<n>/apps/<executableName>.png, 16..1024
  for (const size of HICOLOR_SIZES) {
    put(`apps/shell/build/icons/${size}x${size}.png`, flat.get(size))
    put(`apps/shell/build/icons/${size}x${size}/apps/uniwork-office.png`, flat.get(size))
  }

  // in-app logo: onboarding / About / home sidebar / update window read the shell's app-icon.png
  put('apps/shell/src/renderer/src/assets/app-icon.png', flat.get(512))
  // upstream's per-module app-icon.png is referenced by no source file; keep it off the old mark
  for (const app of ['docs', 'sheets', 'slides']) {
    put(`apps/${app}/src/renderer/assets/app-icon.png`, flat.get(256))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateBrandIcons(process.argv[2])
}

#!/usr/bin/env node
// Builds every app-icon file of the artwork overlay (tools/rebrand/assets/) from the UniWork Office
// master icon set (the blue "W" rounded square): the packager icons (png / ico / icns / hicolor
// sizes), the macOS grid-margin variant and the in-app logo.
//
//   node tools/rebrand/gen-brand-icons.mjs <master-dir>
//   node tools/rebrand/rebrand.mjs --icons <master-dir>    same, then applies the overlay in one step
//
// <master-dir> holds icon.png (1024 px), icon.ico (16..256 px) and icons/<n>x<n>.png
// (16, 32, 48, 64, 128, 256, 512). Outputs are committed; `node tools/rebrand/rebrand.mjs`
// copies them over upstream's icons after a sync, so the build never runs this script.
// Needs @napi-rs/canvas (a dev dependency of the repo) only for the macOS variant and the icns sizes.
//
// The macOS icon follows Apple's grid (824 / 1024 content, transparent margin, same treatment as
// upstream's icon-mac.png); the icns packs PNG entries (types icp4..ic14), no iconutil needed.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, 'assets')
const SIZES = [16, 32, 48, 64, 128, 256, 512]
const MAC_CONTENT_RATIO = 824 / 1024

function put(rel, data) {
  const target = join(ASSETS, rel)
  mkdirSync(dirname(target), { recursive: true })
  if (typeof data === 'string') copyFileSync(data, target)
  else writeFileSync(target, data)
  console.log(`wrote ${rel}`)
}

/** Draws `img` into a size x size canvas, scaled to `ratio` of the canvas and centred. */
function render(img, size, ratio = 1) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  const side = size * ratio
  ctx.drawImage(img, (size - side) / 2, (size - side) / 2, side, side)
  return canvas.toBuffer('image/png')
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

/** Writes every icon slot of the overlay from the master set in `masterDir`. */
export async function generateBrandIcons(masterDir) {
  const master = resolve(masterDir)
  const masterPng = join(master, 'icon.png')
  const sourceImg = await loadImage(readFileSync(masterPng))
  const macImg = await loadImage(render(sourceImg, 1024, MAC_CONTENT_RATIO))
  const macPng = render(macImg, 1024)
  const macBySize = new Map([16, 32, 64, 128, 256, 512, 1024].map((s) => [s, render(macImg, s)]))
  const icnsBytes = icns(macBySize)

  // packager icons: the shell app, and the standalone Docs app that builds from its own build/ dir
  for (const app of ['shell', 'docs']) {
    put(`apps/${app}/build/icon.png`, masterPng)
    put(`apps/${app}/build/icon.ico`, join(master, 'icon.ico'))
    put(`apps/${app}/build/icon-mac.png`, macPng)
    put(`apps/${app}/build/icon.icns`, icnsBytes)
  }

  // Linux icon SET (electron-builder `linux.icon: 'build/icons'`): <n>x<n>.png and the hicolor
  // layout <n>x<n>/apps/<executableName>.png, 16..1024
  for (const size of [...SIZES, 1024]) {
    const src = size === 1024 ? masterPng : join(master, 'icons', `${size}x${size}.png`)
    put(`apps/shell/build/icons/${size}x${size}.png`, src)
    put(`apps/shell/build/icons/${size}x${size}/apps/uniwork-office.png`, src)
  }

  // in-app logo: onboarding / About / update window read the shell's app-icon.png
  put('apps/shell/src/renderer/src/assets/app-icon.png', join(master, 'icons', '512x512.png'))
  // upstream's per-module app-icon.png is referenced by no source file; keep it off the old mark
  for (const app of ['docs', 'sheets', 'slides']) {
    put(`apps/${app}/src/renderer/assets/app-icon.png`, join(master, 'icons', '256x256.png'))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('usage: node tools/rebrand/gen-brand-icons.mjs <master-dir>')
    process.exit(2)
  }
  await generateBrandIcons(process.argv[2])
}

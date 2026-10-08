#!/usr/bin/env node
// Renders the UniWork "UW" mark (the same artwork as the home lockup in
// apps/shell/src/renderer/src/assets/genoffice-logo.svg: navy rounded square, sky accent bar,
// "UW") to a PNG. The first-run welcome dialog and About read app-icon.png; the placeholder
// that shipped there was a plain navy square without the letters.
//
//   node tools/rebrand/gen-app-icon.mjs [out.png] [size]
//
// Default output is the overlay file tools/rebrand/assets/apps/shell/src/renderer/src/assets/app-icon.png
// (run `node tools/rebrand/rebrand.mjs` afterwards to copy it to the app). Needs @napi-rs/canvas
// (a dev dependency of the repo) and a bold sans system font; the result is committed, so the
// build never runs this. Replace the artwork with the official UniWork icon before a public
// release (see apps/shell/src/renderer/src/assets/UNIWORK_BRAND_ASSET_REQUIRED.md).
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = resolve(
  process.argv[2] ?? join(HERE, 'assets/apps/shell/src/renderer/src/assets/app-icon.png'),
)
const size = Number(process.argv[3] ?? 512)

const FONT_FILES = [
  'C:/Windows/Fonts/segoeuib.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
const fontFile = FONT_FILES.find((f) => existsSync(f))
if (!fontFile) throw new Error('no bold sans font found; add one to FONT_FILES')
GlobalFonts.registerFromPath(fontFile, 'UniWorkMark')

const k = size / 240 // the SVG lockup is drawn on a 240 box
const canvas = createCanvas(size, size)
const ctx = canvas.getContext('2d')

ctx.beginPath()
ctx.roundRect(0, 0, size, size, 48 * k)
ctx.fillStyle = '#0F172A'
ctx.fill()

ctx.beginPath()
ctx.roundRect(28 * k, 196 * k, 184 * k, 16 * k, 8 * k)
ctx.fillStyle = '#38BDF8'
ctx.fill()

ctx.fillStyle = '#F8FAFC'
ctx.font = `${72 * k}px UniWorkMark`
ctx.textAlign = 'center'
ctx.textBaseline = 'alphabetic'
ctx.fillText('UW', 120 * k, 132 * k)

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, canvas.toBuffer('image/png'))
console.log(`wrote ${out} (${size}x${size}, font ${fontFile})`)

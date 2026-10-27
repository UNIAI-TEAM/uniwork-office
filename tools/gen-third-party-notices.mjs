/**
 * Aggregates licenses of third-party components shipped with the installer
 * into apps/shell/build/THIRD-PARTY-NOTICES.txt.
 *
 * The shipped set is derived from what the source actually imports, then closed
 * over the dependency graph — not from `dependencies` vs `devDependencies`,
 * which in this repo says nothing about what ships: electron-vite bundles the
 * renderer/main graph into out/ and no node_modules directory is packaged, so
 * several genuinely-bundled libraries are declared as devDependencies.
 *
 * The Chromium part is too large (18MB); electron-builder extraResources ships
 * LICENSES.chromium.html separately, referenced from the body text.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { builtinModules, createRequire } from 'node:module'
import { licenseText } from './license-text.mjs'

const require = createRequire(import.meta.url)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILTIN = new Set(builtinModules)

/**
 * Source trees whose imports end up in a shipped bundle. Deliberately only
 * `src/` — vite configs and scripts pull in the whole build toolchain, which
 * is not distributed.
 */
const SRC_GLOBS = [
  'apps/docs/src',
  'apps/html/src',
  'apps/markdown/src',
  'apps/pdf/src',
  'apps/sheets/src',
  'apps/shell/src',
  'apps/slides/src',
  ...readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `packages/${e.name}/src`),
]
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const SKIP_DIR = /^(node_modules|out|dist|release|tests|__tests__|target)$/

/** Runtime that is always present but never imported by specifier */
const IMPLICIT = ['electron']

/**
 * Packages copied into the installer verbatim by electron-builder rather than
 * bundled — the gsk CLI and its runtime deps are spawned, never imported, so
 * they are invisible to the import scan.
 */
function extraResourceSeeds() {
  // the electron-builder config lives in its own cjs module (not package.json
  // "build") so the publish URL can be injected from the environment
  const build = require(join(ROOT, 'apps/shell/electron-builder.cjs'))
  const entries = [build.extraResources, build.mac?.extraResources, build.win?.extraResources]
  const names = []
  for (const e of entries.flat()) {
    const m = e?.from && /node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(e.from)
    if (m) names.push(m[1])
  }
  return names
}

/** license text is not published to npm; supply the notice by hand */
const NOTE = {
  '@fluentui/react-icons':
    'Copyright (c) Microsoft Corporation. Licensed under the MIT License.\nhttps://github.com/microsoft/fluentui-system-icons',
  '@genspark/cli':
    'Copyright (c) Genspark. Licensed under the MIT License.\nhttps://www.npmjs.com/package/@genspark/cli',
}

/** SPDX strings that need a word on which side of a dual license we take */
const SPDX_NOTE = {
  jszip: 'MIT (dual MIT/GPL-3.0-or-later, used under MIT)',
  'r-efi': 'MIT (tri-licensed MIT/Apache-2.0/LGPL-2.1-or-later, used under MIT)',
}

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(e.name)) walk(join(dir, e.name), out)
    } else if (CODE_EXT.test(e.name)) out.push(join(dir, e.name))
  }
  return out
}

// the lookbehind keeps Array.from('x') / obj.import out of the results
const SPECIFIER = /(?<![.\w])(?:from|import|require)\s*\(?\s*['"]([^'"\n]+)['"]/g

const IN_NODE_MODULES = /node_modules\/((?:@[^/]+\/)?[^/?]+)/

/** 'foo/bar' -> 'foo'; '@a/b/c' -> '@a/b'; relative/builtin/workspace -> null */
function bareName(spec) {
  if (!spec || spec.startsWith('node:')) return null
  // a few deep imports reach into node_modules by relative path (harfbuzzjs wasm)
  const viaPath = IN_NODE_MODULES.exec(spec)
  if (viaPath) return viaPath[1]
  if (spec.startsWith('.') || spec.startsWith('/')) return null
  const parts = spec.split('/')
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  if (BUILTIN.has(name) || name.startsWith('@genoffice/')) return null
  // the specifier regex also fires on prose inside string concatenations
  return NPM_NAME.test(name) ? name : null
}

const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

function importedNames() {
  const names = new Set([...IMPLICIT, ...extraResourceSeeds()])
  for (const g of SRC_GLOBS) {
    for (const file of walk(join(ROOT, g))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(SPECIFIER)) {
        const n = bareName(m[1])
        if (n) names.add(n)
      }
    }
  }
  return names
}

const WORKSPACE_MODULES = SRC_GLOBS.map((g) => join(ROOT, g.replace(/\/src$/, ''), 'node_modules'))

/** installed package names, unscoped first so existing resolutions keep winning */
function topLevelPackages() {
  const dirs = (at) => readdirSync(at, { withFileTypes: true }).filter((e) => e.isDirectory())
  const top = dirs(join(ROOT, 'node_modules')).map((e) => e.name)
  const scoped = top.filter((n) => n.startsWith('@'))
  return [
    ...top.filter((n) => !n.startsWith('@')),
    ...scoped.flatMap((s) => dirs(join(ROOT, 'node_modules', s)).map((e) => `${s}/${e.name}`)),
  ]
}

/** npm hoists, so the root copy is the usual answer; fall back to a nested one */
function pkgDir(name) {
  const root = join(ROOT, 'node_modules', name)
  if (existsSync(join(root, 'package.json'))) return root
  for (const owner of topLevelPackages()) {
    const nested = join(ROOT, 'node_modules', owner, 'node_modules', name)
    if (existsSync(join(nested, 'package.json'))) return nested
  }
  for (const modules of WORKSPACE_MODULES) {
    const own = join(modules, name)
    if (existsSync(join(own, 'package.json'))) return own
  }
  return null
}

const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

/** transitive closure over runtime deps (build-only devDependencies of a dep never ship) */
function closure(seed) {
  const seen = new Map()
  const queue = [...seed].map((name) => ({ name, optional: false }))
  const missing = new Set()
  while (queue.length > 0) {
    const { name, optional } = queue.shift()
    if (seen.has(name)) continue
    const dir = pkgDir(name)
    if (dir === null) {
      // an uninstalled optional dep is a platform variant for another host, not a gap
      if (!optional) missing.add(name)
      seen.set(name, null)
      continue
    }
    const pkg = manifest(dir)
    seen.set(name, { dir, pkg })
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!seen.has(dep)) queue.push({ name: dep, optional: false })
    }
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      if (!seen.has(dep)) queue.push({ name: dep, optional: true })
    }
  }
  return { resolved: [...seen].filter(([, v]) => v !== null), missing }
}

function noticeText(dir) {
  for (const f of ['NOTICE', 'NOTICE.txt', 'NOTICE.md']) {
    if (existsSync(join(dir, f))) return readFileSync(join(dir, f), 'utf8').trim()
  }
  return null
}

function spdxOf(name, pkg) {
  if (SPDX_NOTE[name]) return SPDX_NOTE[name]
  const raw = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type
  if (raw) return raw
  // some packages ship the file but omit the field (e.g. @univerjs/telemetry)
  return 'see license text below'
}

function repoOf(pkg) {
  const r = pkg.repository
  const url = typeof r === 'string' ? r : r?.url
  return url ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null
}

/** Rust crates statically linked into xlsx-sidecar */
function rustCrates() {
  const target = join(ROOT, 'apps/sheets/native/xlsx-engine/Cargo.toml')
  try {
    const raw = execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--manifest-path', target],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return JSON.parse(raw)
      .packages.filter((p) => p.name !== 'xlsx-sidecar')
      .map((p) => ({
        name: p.name,
        version: p.version,
        spdx: SPDX_NOTE[p.name] ?? p.license ?? 'see repository',
        url: p.repository ?? `https://crates.io/crates/${p.name}`,
        dir: p.manifest_path ? dirname(p.manifest_path) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return null
  }
}

const hr = (title) => `\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}\n`
const sub = (title) => `\n${'-'.repeat(72)}\n${title}\n${'-'.repeat(72)}\n`

const seed = importedNames()
const { resolved, missing } = closure(seed)
resolved.sort(([a], [b]) => a.localeCompare(b))

// product, company and upstream names come from the one legal identity file
const legal = JSON.parse(readFileSync(join(ROOT, 'apps/shell/src/shared/legal.json'), 'utf8'))

let out = `${legal.product} — Third-Party Software Notices

${legal.product} is a modified version of ${legal.upstream.name}, licensed under the
${legal.upstream.license}. The license (LICENSE), the attribution notice
(NOTICE) and the statement of changes (MODIFICATIONS) ship next to this file.

This application includes third-party software components under the licenses
reproduced below.

Chromium (bundled via Electron) is licensed under BSD-style and other
licenses — see LICENSES.chromium.html next to this file.
`

out += hr(`1. npm packages (${resolved.length})`)
const noText = []
for (const [name, { dir, pkg }] of resolved) {
  out += sub(`${name} v${pkg.version} — ${spdxOf(name, pkg)}`)
  const text = licenseText(name, dir) ?? NOTE[name]
  if (text) {
    out += text + '\n'
  } else {
    noText.push(name)
    const repo = repoOf(pkg)
    out += `Licensed under ${spdxOf(name, pkg)}.${repo ? `\n${repo}` : ''}\n`
  }
  const notice = noticeText(dir)
  if (notice) out += `\nNOTICE:\n${notice}\n`
}

const crates = rustCrates()
out += hr(`2. Rust crates (xlsx-sidecar native component, statically linked)`)
if (crates === null) {
  out += '\ncargo metadata unavailable at generation time; see'
  out += ' apps/sheets/native/xlsx-engine/Cargo.lock for the full crate list.\n'
} else {
  out += `\n${crates.length} crates, all under permissive terms:\n\n`
  for (const c of crates) out += `  ${c.name} ${c.version}  —  ${c.spdx}\n    ${c.url}\n`
  const texts = new Map()
  for (const c of crates) {
    if (!c.dir) continue
    const text = licenseText(c.name, c.dir)
    if (text && !texts.has(text)) texts.set(text, c.name)
  }
  out += sub('Crate license texts (deduplicated)')
  for (const [text, first] of texts) out += `\n[first seen in ${first}]\n${text}\n`
}

const GOTHIC_KR_COPYRIGHT = [
  'Copyright (c) 2010, NHN Corporation (http://www.nhncorp.com),',
  'with Reserved Font Name Nanum, Naver Nanum, NanumGothic, Naver ',
  'NanumGothic, NanumMyeongjo, Naver NanumMyeongjo, NanumBrush, Naver',
  'NanumBrush, NanumPen, Naver NanumPen.',
].join('\n')

/**
 * Bundled web/document fonts. KaTeX code remains separately covered by its
 * npm-package MIT notice above; its webfonts carry OFL terms.
 */
const FONTS = [
  [
    'Liberation Sans / Serif / Mono 2.1.5',
    'SIL OFL 1.1',
    'Digitized data © 2010 Google Corporation with Reserved Font Names Arimo, Tinos and Cousine.\n© 2012 Red Hat, Inc. with Reserved Font Name Liberation.',
  ],
  [
    'Carlito',
    'SIL OFL 1.1',
    '© 2010-2013 tyPoland Lukasz Dziedzic with Reserved Font Name "Carlito".',
  ],
  [
    'Caladea',
    'Apache-2.0',
    '© Huerta Tipográfica. Licensed under the Apache License, Version 2.0.',
  ],
  [
    'Noto Sans CJK SC / Noto Serif CJK SC (subset)',
    'SIL OFL 1.1',
    '© Adobe / Google. This bundle ships a subset of the original fonts (reduced glyph coverage for size);\nno other modifications were made.',
  ],
  [
    'GenOffice UI Kana JP (Noto Sans JP derivative)',
    'SIL OFL 1.1',
    'Source: Noto Sans JP from https://github.com/notofonts/noto-cjk. Copyright 2014-2021 Adobe\n(http://www.adobe.com/), with Reserved Font Name "Source". This bundle ships Regular and Bold\ninstances subset to U+3000-30FF, with modified advances and horizontally condensed outlines to\nmatch Meiryo UI metrics and vertical metrics set to the Hiragino class. Renamed to GenOffice UI\nKana JP per OFL 1.1; the upstream Reserved Font Name is not used.',
  ],
  [
    'GenOffice Sans KR (Noto Sans CJK KR derivative)',
    'SIL OFL 1.1',
    'Copyright 2014-2021 Adobe (http://www.adobe.com/), Google LLC, Reserved Font Name "Source".\nSubset with modified advance widths and horizontally transformed Noto CJK outlines to match measured\nKorean Office-family metrics; renamed per OFL 1.1. No Microsoft font outlines are included.',
  ],
  [
    'GenOffice Serif KR (Noto Serif CJK KR derivative)',
    'SIL OFL 1.1',
    'Copyright 2017-2024 Adobe (http://www.adobe.com/), Reserved Font Name "Source".\nSubset with modified advance widths and horizontally transformed Noto CJK outlines to match measured\nKorean Office-family metrics; renamed per OFL 1.1. No Microsoft font outlines are included.',
  ],
  [
    'GenOffice Che Latin KR (Noto Sans CJK KR derivative)',
    'SIL OFL 1.1',
    'Copyright 2014-2021 Adobe (http://www.adobe.com/), Google LLC, Reserved Font Name "Source".\nASCII subset with fixed 0.5em advances and horizontally transformed Noto CJK outlines; Microsoft\nDotumChe is used only as a metric reference. Renamed per OFL 1.1. No Microsoft outlines are included.',
  ],
  [
    'Noto Naskh Arabic / Noto Sans Arabic (subset)',
    'SIL OFL 1.1',
    '© The Noto Project Authors. This bundle ships a subset of the original fonts;\nglyphs and metrics are unmodified.',
  ],
  [
    'GenOffice Gothic KR (NanumGothic derivative)',
    'SIL OFL 1.1',
    `${GOTHIC_KR_COPYRIGHT}\nSubset with unmodified metrics; renamed per OFL 1.1.`,
  ],
  [
    'GenOffice Poppins (Poppins derivative)',
    'SIL OFL 1.1',
    'Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins).\nLatin subset with unmodified metrics and advances; renamed.',
  ],
  [
    'GenOffice DM Sans (DM Sans derivative)',
    'SIL OFL 1.1',
    'Copyright 2014-2017 Indian Type Foundry (info@indiantypefoundry.com). Copyright 2019 Google LLC.\nLatin subset with unmodified metrics and advances; renamed.',
  ],
  [
    'GenOffice Tamil (Noto Sans Tamil derivative)',
    'SIL OFL 1.1',
    '© The Noto Project Authors, original Reserved Font Name "Noto". Modified advance widths;\nrenamed per OFL 1.1.',
  ],
  [
    'Inter 4.x (UniWork Sans, Workbench UI)',
    'SIL OFL 1.1',
    '© 2016 The Inter Project Authors (https://github.com/rsms/inter).\nLatin, Latin Extended and Vietnamese woff2 subsets; unmodified otherwise.',
  ],
  [
    'KaTeX webfonts',
    'SIL OFL 1.1',
    'Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)\n' +
      'Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),\n' +
      'with Reserved Font Names KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Fraktur, ' +
      'KaTeX_Main, KaTeX_Math, KaTeX_SansSerif, KaTeX_Script, KaTeX_Size1, ' +
      'KaTeX_Size2, KaTeX_Size3, KaTeX_Size4, and KaTeX_Typewriter.',
  ],
]

out += hr('3. Bundled fonts')
for (const [name, spdx, copyright] of FONTS) out += sub(`${name} — ${spdx}`) + copyright + '\n'
out += sub('SIL Open Font License 1.1 — full text')
out +=
  readFileSync(join(ROOT, 'apps/docs/src/renderer/fonts/LICENSE-OFL.txt'), 'utf8').trim() + '\n'

out += hr('4. Unicode Character Database data')
out += `
apps/pdf/src/shared/radicals.ts contains a generated mapping derived from
Unicode Character Database 17.0.0, EquivalentUnifiedIdeograph.txt
(2025-08-01):
https://www.unicode.org/Public/17.0.0/ucd/EquivalentUnifiedIdeograph.txt

`
out += readFileSync(join(ROOT, 'LICENSE-UNICODE.txt'), 'utf8').trim() + '\n'

out += hr('5. Bundled OCR engine (offline Tesseract)')
out += `
The installer ships an OCR engine that reads Vietnamese (and other Latin-script
text) entirely offline: no model is downloaded and the engine opens no network
connection. It runs as a script on the application binary
(Resources/ocr/tesseract).

  Tesseract OCR 5 (LSTM engine) — Apache-2.0
    https://github.com/tesseract-ocr/tesseract
    compiled to WebAssembly, with the modifications its packager lists, inside
    the npm package tesseract.js-core (section 1) — Apache-2.0
  tesseract.js — Apache-2.0 (section 1)
    https://github.com/naptha/tesseract.js
  tessdata_fast "vie" (Vietnamese) language model, unmodified — Apache-2.0
    https://github.com/tesseract-ocr/tessdata_fast
    commit 923915d4ced2a7235221788285785a29c4a42d4a
    sha256 79df64caf7bcfb2a27df5042ecb6121e196eada34da774956995747636d5bfa1
    license text: Resources/ocr/tesseract/tessdata/LICENSE
  Leptonica — BSD-2-Clause, compiled into tesseract.js-core; its license follows.

The tesseract.js-core build also compiles in the image-codec and math libraries
its repository lists as submodules (https://github.com/naptha/tesseract.js-core):
libpng (libpng-2.0), zlib (Zlib), libjpeg (Independent JPEG Group), giflib (MIT),
libtiff (libtiff license, BSD-style), libwebp (BSD-3-Clause), openlibm (MIT, ISC,
BSD-2-Clause) and Leptonica (BSD-2-Clause). Which of them are really linked into
the shipped WebAssembly engine, with the evidence and the upstream commit of each,
and their FULL license texts follow; the same text ships next to the engine in
Resources/ocr/tesseract/LICENSES-tesseract-core.txt. The Tesseract changes made by
the tesseract.js-core packager are listed in
Resources/ocr/tesseract/node_modules/tesseract.js-core/README.md.

This software is based in part on the work of the Independent JPEG Group.
`
out += sub('Licenses of the libraries compiled into the OCR engine')
out += `${readFileSync(join(ROOT, 'packages/pdf2docx/ocr-tesseract/LICENSES-tesseract-core.txt'), 'utf8').trim()}
`

out += hr('6. Bundled legacy format converter (LibreOffice 26.8.2.2)')
out += `
The desktop installer ships an unmodified trimmed subset of official TDF
LibreOffice 26.8.2.2 (build 9dea406ab7695df6325b11b0e19fdca8db4b7276) under
Resources/libreoffice/ and invokes its soffice executable as a separate
headless child process solely to convert legacy binary Microsoft Office 97-2003
documents (.doc -> .docx, .xls -> .xlsx, .ppt -> .pptx).

  LibreOffice 26.8.2.2 — Mozilla Public License 2.0 (MPL-2.0)
    Copyright © 2000-2026 LibreOffice contributors and The Document Foundation.
    Portions Copyright © 2000-2011 Oracle and/or its affiliates.
    Portions Copyright © 2011, 2014 The Apache Software Foundation.
    Upstream source code archive (MPL-2.0 Section 3.2):
      https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.2.2/src/
    Upstream binary archive directory:
      https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.2.2/
    Full third-party component notices and licenses shipped inside the pack:
      Resources/libreoffice/LICENSE
      Resources/libreoffice/LICENSE.html
      Resources/libreoffice/NOTICE

  Bundled metric-compatible fonts inside Resources/libreoffice/ (24 font files):
    - Liberation Sans, Liberation Serif, Liberation Mono (9 files) — SIL Open Font License 1.1
      Digitized data © 2010 Google Corporation with Reserved Font Names Arimo, Tinos and Cousine.
      © 2012 Red Hat, Inc. with Reserved Font Name Liberation. (SIL OFL 1.1 full text in section 3.)
    - Carlito (4 files) — SIL Open Font License 1.1
      © 2010-2013 tyPoland Lukasz Dziedzic with Reserved Font Name "Carlito". (SIL OFL 1.1 full text in section 3.)
    - Caladea (4 files) — Apache License 2.0
      © 2012 Huerta Tipográfica. Licensed under the Apache License, Version 2.0.
    - Noto Sans, Noto Serif (4 files) — SIL Open Font License 1.1
      © The Noto Project Authors / Google LLC, with Reserved Font Name "Noto". (SIL OFL 1.1 full text in section 3.)
    - DejaVu Sans (2 files: DejaVuSans.ttf, DejaVuSans-Bold.ttf) — Bitstream Vera / Arev / DejaVu License
      Fonts are © 2003 Bitstream, Inc. DejaVu changes are in the public domain.
      Glyphs imported from Arev fonts are © 2006 Tavmjong Bah. Full license text follows below.
    - OpenSymbol (1 file: opens___.ttf) — Mozilla Public License 2.0 (MPL-2.0)
      © 2009 Sun Microsystems, Inc. / The Document Foundation; portions © 2010 Google Corporation.
`
out += sub('DejaVu Fonts — Bitstream Vera and Arev Font Licenses')
out += `
Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. Bitstream Vera is a
trademark of Bitstream, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of
the fonts accompanying this license ("Fonts") and associated documentation
files (the "Font Software"), to reproduce and distribute the Font Software,
including without limitation the rights to use, copy, merge, publish,
distribute, and/or sell copies of the Font Software, and to permit persons to
whom the Font Software is furnished to do so, subject to the following
conditions:

The above copyright and trademark notices and this permission notice shall be
included in all copies of one or more of the Font Software typefaces.

The Font Software may be modified, altered, or added to, and in particular the
designs of glyphs or characters in the Fonts may be modified and additional
glyphs or characters may be added to the Fonts, only if the fonts are renamed to
names not containing either the words "Bitstream" or the word "Vera".

This License becomes null and void to the extent applicable to Fonts or Font
Software that has been modified and is distributed under the "Bitstream Vera"
names.

The Font Software may be sold as part of a larger software package but no copy
of one or more of the Font Software typefaces may be sold by itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME FOUNDATION
BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL,
SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO
USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.

Except as contained in this notice, the names of Gnome, the Gnome Foundation,
and Bitstream Inc., shall not be used in advertising or otherwise to promote
the sale, use or other dealings in this Font Software without prior written
authorization from the Gnome Foundation or Bitstream Inc., respectively. For
further information, contact: fonts at gnome dot org.

Arev Fonts Copyright:
Copyright (c) 2006 by Tavmjong Bah. All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of
the fonts accompanying this license ("Fonts") and associated documentation
files (the "Font Software"), to reproduce and distribute the modifications to
the Bitstream Vera Font Software, including without limitation the rights to
use, copy, merge, publish, distribute, and/or sell copies of the Font Software,
and to permit persons to whom the Font Software is furnished to do so, subject
to the same conditions as the Bitstream Vera license above (renamed without
"Tavmjong Bah" or "Arev").
`
out += sub('Mozilla Public License Version 2.0 — full text')
out += `
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

6. Disclaimer of Warranty
-------------------------

Covered Software is provided under this License on an "as is" basis,
without warranty of any kind, either expressed, implied, or statutory,
including, without limitation, warranties that the Covered Software is
free of defects, merchantable, fit for a particular purpose or
non-infringing. The entire risk as to the quality and performance of the
Covered Software is with You. Should any Covered Software prove
defective in any respect, You (not any Contributor) assume the cost of
any necessary servicing, repair, or correction. This disclaimer of
warranty constitutes an essential part of this License. No use of any
Covered Software is authorized under this License except under this
disclaimer.

7. Limitation of Liability
--------------------------

Under no circumstances and under no legal theory, whether tort
(including negligence), contract, or otherwise, shall any Contributor,
or anyone who distributes Covered Software as permitted above, be liable
to You for any direct, indirect, special, incidental, or consequential
damages of any character including, without limitation, damages for lost
profits, loss of goodwill, work stoppage, computer failure or
malfunction, or any and all other commercial damages or losses, even if
such party shall have been informed of the possibility of such damages.
This limitation of liability shall not apply to liability for death or
personal injury resulting from such party's negligence to the extent
applicable law prohibits such limitation. Some jurisdictions do not
allow the exclusion or limitation of incidental or consequential
damages, so this exclusion and limitation may not apply to You.

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at https://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
`

for (const term of [
  '@embedpdf/pdfium',
  'Copyright 2014 PDFium Authors',
  'Apache License',
  'tesseract.js-core',
  'tessdata_fast',
  'Leptonica',
  'PNG Reference Library License',
  'Jean-loup Gailly',
  'Independent JPEG Group',
  'GIFLIB',
  'Sam Leffler',
  'Google Inc.',
  'OpenLibm',
  'LibreOffice 26.8.2.2',
  'Mozilla Public License Version 2.0',
  'https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.2.2/src/',
  'Bitstream Vera',
]) {
  if (!out.includes(term)) {
    throw new Error(`generated third-party notice is missing required term: ${term}`)
  }
}

const dest = join(ROOT, 'apps/shell/build/THIRD-PARTY-NOTICES.txt')
mkdirSync(dirname(dest), { recursive: true })
writeFileSync(dest, out)
console.log(
  `written: ${relative(ROOT, dest)} (${(out.length / 1024).toFixed(0)} KB) — ` +
    `${resolved.length} npm packages, ${crates?.length ?? 0} crates`,
)
if (noText.length > 0) console.warn(`no license file published: ${noText.join(', ')}`)
if (missing.size > 0) console.warn(`not installed, skipped: ${[...missing].join(', ')}`)

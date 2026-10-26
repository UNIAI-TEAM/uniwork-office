import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

interface LicenseTextModule {
  licenseText(name: string, dir: string): string | null
}

describe('third-party license aggregation', () => {
  it('includes the PDFium wrapper and binary redistribution terms', async () => {
    const root = join(__dirname, '../../..')
    const modulePath = pathToFileURL(join(root, 'tools/license-text.mjs')).href
    const { licenseText } = (await import(modulePath)) as LicenseTextModule
    const text = licenseText('@embedpdf/pdfium', join(root, 'node_modules/@embedpdf/pdfium'))

    expect(text).toContain('MIT License')
    expect(text).toContain('Copyright 2014 PDFium Authors')
    expect(text).toContain('Apache License')
  })

  it('generates the notice consumed by every shell packaging entrypoint', () => {
    const root = join(__dirname, '../../..')
    execFileSync(process.execPath, [join(root, 'tools/gen-third-party-notices.mjs')], {
      cwd: root,
      stdio: 'pipe',
    })
    const text = readFileSync(join(root, 'apps/shell/build/THIRD-PARTY-NOTICES.txt'), 'utf8')
    expect(text).toContain('@embedpdf/pdfium')
    expect(text).toContain('Copyright 2014 PDFium Authors')
    expect(text).toContain('Apache License')

    // the bundled OCR engine: tesseract.js-core / the model / Leptonica and the full
    // license text of every codec library linked into the WebAssembly engine
    for (const term of [
      'tesseract.js-core',
      'tessdata_fast',
      'Leptonica',
      'Copyright (C) 2001-2020 Leptonica', // Leptonica BSD-2-Clause
      'PNG Reference Library License version 2', // libpng
      'Jean-loup Gailly and Mark Adler', // zlib
      'Permission is granted to anyone to use this software for any purpose', // zlib
      'This software is based in part on the work of the Independent JPEG Group', // libjpeg (IJG condition 2)
      'The GIFLIB distribution is Copyright (c) 1997  Eric S. Raymond', // giflib
      'Copyright (c) 1988-1997 Sam Leffler', // libtiff
      'Copyright (c) 2010, Google Inc.', // libwebp
      'Neither the name of Google nor the names of its contributors', // libwebp BSD-3-Clause
      'Copyright (c) 2011-14 The Julia Project', // openlibm MIT
      'Copyright (c) 2008 Stephen L. Moshier', // openlibm ISC
      'Copyright 1992-2011 The FreeBSD Project', // openlibm BSD-2-Clause
      'a37d4836519517bdce6cb9d956092321eca3e73b', // libpng: pinned upstream commit
      'Resources/ocr/tesseract/LICENSES-tesseract-core.txt',
    ]) {
      expect(text, term).toContain(term)
    }
    // the shipped file next to the engine is the very text embedded in the notice
    const shipped = readFileSync(
      join(root, 'packages/pdf2docx/ocr-tesseract/LICENSES-tesseract-core.txt'),
      'utf8',
    ).trim()
    expect(text).toContain(shipped)

    const shellPackage = JSON.parse(
      readFileSync(join(root, 'apps/shell/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }
    for (const target of ['dist:mac', 'dist:win', 'dist:linux']) {
      expect(shellPackage.scripts[target]).toContain('npm run notices')
    }
    const builder = readFileSync(join(root, 'apps/shell/electron-builder.cjs'), 'utf8')
    expect(builder).toContain('ensureThirdPartyNotices()')
  })
})

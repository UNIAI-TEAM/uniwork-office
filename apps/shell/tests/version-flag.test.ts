import { describe, expect, it } from 'vitest'
import { isVersionRequest } from '../src/main/version-flag'

describe('isVersionRequest', () => {
  it('is true for --version after the executable', () => {
    expect(isVersionRequest(['UniWork-Office.AppImage', '--version'])).toBe(true)
    expect(isVersionRequest(['electron', '.', '--version'])).toBe(true)
  })

  it('is false for a normal launch, a document launch or only the executable', () => {
    expect(isVersionRequest(['UniWork-Office.AppImage'])).toBe(false)
    expect(isVersionRequest(['UniWork-Office.AppImage', '/home/me/report.docx'])).toBe(false)
    expect(isVersionRequest([])).toBe(false)
  })

  it('does not treat the executable path itself as the flag', () => {
    expect(isVersionRequest(['--version'])).toBe(false)
  })
})

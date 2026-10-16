// G6-09 N-6: the finished-steps group label reads the same in every app: vi "Đã xử lý · n bước".
import { afterEach, describe, expect, it } from 'vitest'
import { setModuleLang, t } from '../src/renderer/i18n/locale'

afterEach(() => setModuleLang('en'))

describe('vi worked-steps label', () => {
  it('uses "Đã xử lý" for one, few and many steps', () => {
    setModuleLang('vi')
    expect(t('aiWorkedStepsOne', { n: 1 })).toBe('Đã xử lý · 1 bước')
    expect(t('aiWorkedStepsFew', { n: 3 })).toBe('Đã xử lý · 3 bước')
    expect(t('aiWorkedSteps', { n: 12 })).toBe('Đã xử lý · 12 bước')
  })
})

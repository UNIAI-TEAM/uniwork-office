// G6-09 visual r1 F7 (html): the collapsed tool group says "Worked · 1 step", not "1 steps": the
// count picks the plural form of the interface language (one / few / other).
import { afterEach, describe, expect, it } from 'vitest'
import type { Lang } from '@genoffice/i18n'
import { getLang, setModuleLang, t } from '../src/renderer/i18n/locale'
import { workedStepsLabel } from '../src/renderer/ai/worked-steps'

const initial = getLang()
afterEach(() => setModuleLang(initial))

const label = (lang: Lang, n: number) => {
  setModuleLang(lang)
  return workedStepsLabel(t, lang, n)
}

describe('Worked · N steps (html)', () => {
  it('English: singular for one step, plural otherwise', () => {
    expect(label('en', 1)).toBe('Worked · 1 step')
    expect(label('en', 2)).toBe('Worked · 2 steps')
    expect(label('en', 11)).toBe('Worked · 11 steps')
  })

  it('Vietnamese has one form', () => {
    expect(label('vi', 1)).toBe('Đã xử lý · 1 bước')
    expect(label('vi', 4)).toBe('Đã xử lý · 4 bước')
  })

  it('languages with a singular use it for one step', () => {
    expect(label('de', 1)).toBe('Erledigt · 1 Schritt')
    expect(label('fr', 1)).toBe('Terminé · 1 étape')
    expect(label('es', 1)).toBe('Completado · 1 paso')
    expect(label('pt', 1)).toBe('Concluído · 1 etapa')
    expect(label('it', 1)).toBe('Completato · 1 passaggio')
    expect(label('nl', 1)).toBe('Klaar · 1 stap')
  })

  it('Slavic languages take the few form for 2 to 4', () => {
    expect([1, 3, 5].map((n) => label('ru', n))).toEqual([
      'Готово · 1 шаг',
      'Готово · 3 шага',
      'Готово · 5 шагов',
    ])
    expect([1, 2, 5].map((n) => label('pl', n))).toEqual([
      'Ukończono · 1 krok',
      'Ukończono · 2 kroki',
      'Ukończono · 5 kroków',
    ])
    expect([1, 4, 7].map((n) => label('cs', n))).toEqual([
      'Hotovo · 1 krok',
      'Hotovo · 4 kroky',
      'Hotovo · 7 kroků',
    ])
  })
})

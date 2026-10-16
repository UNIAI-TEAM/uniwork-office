import type { Lang } from '@genoffice/i18n'
import type { TFunc } from '../i18n/locale'

/**
 * "Worked · N steps" in the plural form the language uses for N: `one` and `few` have their own
 * strings (languages without the distinction repeat the plural there), every other category
 * reads the plural.
 */
export function workedStepsLabel(tr: TFunc, lang: Lang, n: number): string {
  let category: Intl.LDMLPluralRule = 'other'
  try {
    category = new Intl.PluralRules(lang).select(n)
  } catch {
    /* unknown locale tag: the plural */
  }
  const key =
    category === 'one'
      ? 'aiWorkedStepsOne'
      : category === 'few'
        ? 'aiWorkedStepsFew'
        : 'aiWorkedSteps'
  return tr(key, { n })
}

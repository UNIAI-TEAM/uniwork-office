/** "Worked · N steps" for a tool group; exactly one step has its own singular line (aiWorkedStepOne). */
export function workedStepsLabel(
  t: (key: 'aiWorkedSteps' | 'aiWorkedStepOne', params?: { n: number }) => string,
  count: number,
): string {
  return count === 1 ? t('aiWorkedStepOne') : t('aiWorkedSteps', { n: count })
}

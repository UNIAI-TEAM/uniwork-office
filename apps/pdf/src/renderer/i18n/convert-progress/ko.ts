import type { zh } from './zh'

export const ko = {
  convertToWordPreparing: 'Word로 변환 중… 준비 중…',
  convertToWordRunning: 'Word로 변환 중… {page} / {total}페이지',
  convertToExcelPreparing: 'Excel로 변환 중… 준비 중…',
  convertToExcelRunning: 'Excel로 변환 중… {page} / {total}페이지',
  convertToPptPreparing: 'PowerPoint로 변환 중… 준비 중…',
  convertToPptRunning: 'PowerPoint로 변환 중… {page} / {total}페이지',
} satisfies Record<keyof typeof zh, string>

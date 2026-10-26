import type { zh } from './zh'

export const hi = {
  convertToWordPreparing: 'Word में बदला जा रहा है… तैयार किया जा रहा है…',
  convertToWordRunning: 'Word में बदला जा रहा है… पृष्ठ {page} / {total}',
  convertToExcelPreparing: 'Excel में बदला जा रहा है… तैयार किया जा रहा है…',
  convertToExcelRunning: 'Excel में बदला जा रहा है… पृष्ठ {page} / {total}',
  convertToPptPreparing: 'PowerPoint में बदला जा रहा है… तैयार किया जा रहा है…',
  convertToPptRunning: 'PowerPoint में बदला जा रहा है… पृष्ठ {page} / {total}',
} satisfies Record<keyof typeof zh, string>

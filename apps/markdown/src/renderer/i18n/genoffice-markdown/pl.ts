import type { zh } from './zh'

export const pl = {
  backlinks: 'Odwołania',
  backlinksEmpty: 'Żadna notatka nie linkuje tu jeszcze.',
  backlinksRefresh: 'Odśwież odwołania',
  graph: 'Widok grafu',
  graphClose: 'Zamknij graf',
  graphEmpty: 'W sejfie nie ma jeszcze notatek.',
  graphTruncated: 'Za dużo notatek: wykres pokazuje pierwsze {shown} z {total}.',
  suggestCreateNote: 'Utwórz nową notatkę',
  tags: 'Tagi',
  tagsEmpty: 'W sejfie nie ma jeszcze #tagów',
} satisfies Record<keyof typeof zh, string>

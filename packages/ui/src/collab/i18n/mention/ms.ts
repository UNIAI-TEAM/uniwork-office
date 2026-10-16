import type { zh } from './zh'

export const ms = {
  collabMentionLabel: 'Sebut seseorang',
  collabMentionSearching: 'Sedang mencari…',
  collabMentionCount: 'Hasil: {count}',
  collabMentionNoMatch:
    'Tiada sesiapa yang mempunyai akses kepada dokumen ini sepadan dengan “{query}”.',
  collabMentionNoCandidates: 'Belum ada orang lain yang mempunyai akses kepada dokumen ini.',
  collabMentionError: 'Tidak dapat memuatkan senarai orang.',
  collabMentionNoAccessBadge: 'Tidak dapat melihat',
} satisfies Record<keyof typeof zh, string>

import type { zh } from './zh'

export const id = {
  collabMentionLabel: 'Sebut seseorang',
  collabMentionSearching: 'Mencari…',
  collabMentionCount: 'Hasil: {count}',
  collabMentionNoMatch: 'Tidak ada orang dengan akses ke dokumen ini yang cocok dengan “{query}”.',
  collabMentionNoCandidates: 'Belum ada orang lain yang memiliki akses ke dokumen ini.',
  collabMentionError: 'Tidak dapat memuat daftar orang.',
} satisfies Record<keyof typeof zh, string>

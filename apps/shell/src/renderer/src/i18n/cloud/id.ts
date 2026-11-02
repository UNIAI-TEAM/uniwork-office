import type { zh } from './zh'

export const id = {
  cloudTitle: 'AI cloud UniWork',
  cloudStateReady: 'Tersedia',
  cloudStateNotEntitled: 'Tidak termasuk dalam paket Anda',
  cloudStateExhausted: 'Kredit AI habis',
  cloudStateUnavailable: 'Tidak tersedia',
  cloudStateInactive: 'Langganan tidak aktif',
  cloudCredits: 'Kredit AI',
  cloudCreditsLeft: 'Sisa {remaining} / {limit}',
  cloudCreditsUnlimited: 'Tanpa batas',
  cloudCreditsRenews: 'Diperbarui {date}',
  cloudToolsToggle: 'Gunakan alat cloud UniWork',
  cloudToolsToggleDesc:
    'Tanpa penyedia sendiri, pencarian web, pembuatan gambar, dan analisis media berjalan lewat cloud UniWork (memakai kredit AI).',
} satisfies Record<keyof typeof zh, string>

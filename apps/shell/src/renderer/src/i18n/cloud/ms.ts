import type { zh } from './zh'

export const ms = {
  cloudTitle: 'AI awan UniWork',
  cloudStateReady: 'Tersedia',
  cloudStateNotEntitled: 'Tiada dalam pelan anda',
  cloudStateExhausted: 'Kredit AI habis',
  cloudStateUnavailable: 'Tidak tersedia',
  cloudStateInactive: 'Langganan tidak aktif',
  cloudCredits: 'Kredit AI',
  cloudCreditsLeft: 'Baki {remaining} / {limit}',
  cloudCreditsUnlimited: 'Tanpa had',
  cloudCreditsRenews: 'Diperbaharui {date}',
  cloudToolsToggle: 'Guna alat awan UniWork',
  cloudToolsToggleDesc:
    'Tanpa penyedia sendiri, carian web, penjanaan imej dan analisis media berjalan melalui awan UniWork (menggunakan kredit AI).',
} satisfies Record<keyof typeof zh, string>

import type { zh } from './zh'

export const id = {
  cloudTitle: 'AI cloud UniWork',
  cloudStatus: 'Status',
  cloudStateReady: 'Tersedia',
  cloudStateNotEntitled: 'Tidak termasuk dalam paket Anda',
  cloudStateExhausted: 'Kredit AI habis',
  cloudStateUnavailable: 'Tidak tersedia',
  cloudCredits: 'Kredit AI',
  cloudCreditsLeft: 'Sisa {remaining} / {limit}',
  cloudCreditsUnlimited: 'Tanpa batas',
  cloudCreditsRenews: 'Diperbarui {date}',
  cloudSignedOutBody:
    'Masuk ke UniWork untuk memakai pencarian web, pembuatan gambar, dan analisis media yang dibayar dengan kredit AI organisasi Anda.',
  cloudNotEntitledBody:
    'Paket organisasi Anda tidak mencakup AI cloud UniWork. Anda tetap dapat memakai penyedia Anda sendiri di bawah.',
  cloudExhaustedBody:
    'Organisasi Anda telah memakai semua kredit AI UniWork untuk periode ini. Alat cloud dijeda hingga kredit diperbarui; penyedia Anda sendiri di bawah tetap berfungsi.',
  cloudUnavailableBody:
    'AI cloud UniWork sedang tidak tersedia. Penyedia Anda sendiri di bawah tetap berfungsi.',
  cloudReadyBody:
    'Tanpa penyedia sendiri, pencarian, pembuatan gambar, dan analisis media memakai kredit AI UniWork organisasi Anda.',
  cloudToolsToggle: 'Gunakan alat cloud UniWork',
  cloudToolsToggleDesc:
    'Tanpa penyedia sendiri, pencarian web, pembuatan gambar, dan analisis media berjalan lewat cloud UniWork (memakai kredit AI).',
  cloudMediaLabel: 'Cloud UniWork',
  cloudMediaDesc: 'Memakai kredit AI UniWork organisasi Anda; tanpa kunci.',
  cloudSearchAutoHint: 'Cloud UniWork dulu (memakai kredit AI), lalu pencarian gratis.',
} satisfies Record<keyof typeof zh, string>

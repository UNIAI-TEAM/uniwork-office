import type { zh } from './zh'

export const ms = {
  cloudTitle: 'AI awan UniWork',
  cloudStatus: 'Status',
  cloudStateReady: 'Tersedia',
  cloudStateNotEntitled: 'Tiada dalam pelan anda',
  cloudStateExhausted: 'Kredit AI habis',
  cloudStateUnavailable: 'Tidak tersedia',
  cloudCredits: 'Kredit AI',
  cloudCreditsLeft: 'Baki {remaining} / {limit}',
  cloudCreditsUnlimited: 'Tanpa had',
  cloudCreditsRenews: 'Diperbaharui {date}',
  cloudSignedOutBody:
    'Log masuk ke UniWork untuk menggunakan carian web, penjanaan imej dan analisis media yang dibayar dengan kredit AI organisasi anda.',
  cloudNotEntitledBody:
    'Pelan organisasi anda tidak termasuk AI awan UniWork. Anda masih boleh menggunakan penyedia anda sendiri di bawah.',
  cloudExhaustedBody:
    'Organisasi anda telah menggunakan semua kredit AI UniWork bagi tempoh ini. Alat awan dijeda sehingga kredit diperbaharui; penyedia anda sendiri di bawah terus berfungsi.',
  cloudUnavailableBody:
    'AI awan UniWork tidak tersedia buat masa ini. Penyedia anda sendiri di bawah terus berfungsi.',
  cloudReadyBody:
    'Tanpa penyedia sendiri, carian, penjanaan imej dan analisis media menggunakan kredit AI UniWork organisasi anda.',
  cloudToolsToggle: 'Guna alat awan UniWork',
  cloudToolsToggleDesc:
    'Tanpa penyedia sendiri, carian web, penjanaan imej dan analisis media berjalan melalui awan UniWork (menggunakan kredit AI).',
  cloudMediaLabel: 'Awan UniWork',
  cloudMediaDesc: 'Menggunakan kredit AI UniWork organisasi anda; tiada kunci diperlukan.',
  cloudSearchAutoHint: 'Awan UniWork dahulu (menggunakan kredit AI), kemudian carian percuma.',
} satisfies Record<keyof typeof zh, string>

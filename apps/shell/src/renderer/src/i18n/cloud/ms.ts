import type { zh } from './zh'

export const ms = {
  cloudTitle: 'AI awan UniWork',
  cloudStateReady: 'Tersedia',
  cloudStateNotEntitled: 'Tiada dalam pelan anda',
  cloudStateExhausted: 'Kredit AI habis',
  cloudStateUnavailable: 'Tidak tersedia',
  cloudStateSignedOut: 'Belum log masuk',
  cloudStateInactive: 'Langganan tidak aktif',
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
  cloudInactiveBody:
    'Langganan UniWork organisasi anda tidak aktif, jadi AI awan dijeda. Minta pentadbir memperbaharuinya; pembekal anda sendiri di bawah terus berfungsi.',
  cloudToolsOffBody:
    'Alat awan UniWork dimatikan. Hidupkan “{switch}” di {section} untuk menggunakan kredit AI organisasi anda; pembekal anda sendiri di bawah tidak terjejas.',
  cloudReadyBody:
    'Tanpa penyedia sendiri, carian, penjanaan imej dan analisis media menggunakan kredit AI UniWork organisasi anda.',
  cloudToolsToggle: 'Guna alat awan UniWork',
  cloudToolsToggleDesc:
    'Tanpa penyedia sendiri, carian web, penjanaan imej dan analisis media berjalan melalui awan UniWork (menggunakan kredit AI).',
  cloudMediaLabel: 'Awan UniWork',
  cloudMediaDesc: 'Menggunakan kredit AI UniWork organisasi anda; tiada kunci diperlukan.',
  cloudSearchAutoHint: 'Awan UniWork dahulu (menggunakan kredit AI), kemudian carian percuma.',
  aiTestErrInvalidKey: 'Kunci API tiada atau ditolak',
  aiTestErrNetwork: 'Tidak dapat bersambung. Semak rangkaian anda',
  aiTestErrLimit: 'Had pembekal dicapai. Cuba lagi nanti',
  aiTestErrUnavailable: 'Perkhidmatan tidak memberi respons. Cuba lagi nanti',
} satisfies Record<keyof typeof zh, string>

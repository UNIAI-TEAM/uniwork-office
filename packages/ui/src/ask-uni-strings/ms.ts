import type { zh } from './zh'

export const ms = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI sedang berfikir…',
  askUniYou: 'Anda',
  askUniUni: 'UNI',
  askUniSources: 'Sumber',
  askUniKindDocument: 'Dokumen',
  askUniKindTask: 'Tugasan',
  askUniKindMeeting: 'Mesyuarat',
  askUniKindChat: 'Sembang',
  askUniKindMember: 'Ahli',
  askUniKindOther: 'Lain-lain',
  askUniOpenDocument: 'Buka dokumen',
  askUniOpenBrowser: 'Buka dalam pelayar',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed: 'Sumber ini tidak dapat dibuka. Cuba lagi atau buka di web.',
  askUniErrForbidden: 'Anda tiada akses kepada data ini.',
  askUniErrQuota: 'Organisasi telah menghabiskan kuota token AI bulan ini.',
  askUniErrRateLimited: 'Anda bertanya terlalu laju; cuba lagi dalam satu minit.',
  askUniErrRateLimitedIn: 'Anda bertanya terlalu laju; cuba lagi dalam {seconds} saat.',
  askUniErrDisabled: 'AI belum dikonfigurasikan pada pelayan ini.',
  askUniErrOffline: 'Anda luar talian. Tanya UNI memerlukan sambungan untuk mencari dokumen.',
  askUniErrSession: 'Sesi UniWork anda telah tamat. Log masuk semula untuk terus bertanya.',
  askUniErrDefault: 'Tidak dapat bertanya sekarang; cuba lagi nanti.',
  askUniSignedOut:
    'Log masuk ke akaun UniWork anda untuk bertanya kepada UNI tentang ruang kerja anda.',
  askUniNoticeNoSources:
    'Belum ada data yang anda boleh lihat dalam ruang kerja ini yang sepadan dengan soalan ini.',
  askUniNoticeUnavailable: 'UNI tidak dapat menjawab soalan ini.',
  askUniStop: 'Henti',
  askUniSend: 'Hantar',
  askUniCounter: '{used}/{max} aksara',
  askUniPlaceholder: 'Tanya UNI tentang kerja anda…',
} satisfies Record<keyof typeof zh, string>

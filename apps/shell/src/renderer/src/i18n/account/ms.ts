import type { zh } from './zh'

export const ms = {
  acctTitle: 'Akaun UniWork',
  acctOpenSettings: 'Buka tetapan akaun',
  acctSignIn: 'Log masuk',
  acctSignInUniwork: 'Log masuk ke UniWork',
  acctSignInAgain: 'Log masuk semula',
  acctSignOut: 'Log keluar',
  acctSigningOut: 'Sedang log keluar…',
  acctSigningIn: 'Sedang log masuk…',
  acctSigningInHint: 'Teruskan dalam pelayar anda untuk melengkapkan log masuk.',
  acctCancel: 'Batal',
  acctOpenAgain: 'Buka pelayar semula',
  acctCopyLink: 'Salin pautan log masuk',
  acctLinkCopied: 'Pautan disalin',
  acctSignedInAs: 'Log masuk sebagai {name}',
  acctSignedOutTitle: 'Anda belum log masuk',
  acctSignedOutBody:
    'Log masuk dengan akaun UniWork anda untuk menggunakan pelan organisasi anda pada peranti ini.',
  acctRefreshing: 'Mengemas kini akaun…',
  acctName: 'Nama',
  acctEmail: 'E-mel',
  acctOrg: 'Organisasi',
  acctPlan: 'Pelan',
  acctServer: 'Pelayan',
  acctNoPlan: 'Tiada pelan',
  acctSwitchOrg: 'Tukar organisasi',
  acctSwitchOrgFailed: 'Tidak dapat menukar organisasi. Sila cuba lagi.',
  acctExpiredShort: 'Sesi tamat tempoh',
  acctExpiredTitle: 'Sesi anda telah tamat tempoh',
  acctExpiredBody:
    'Demi keselamatan anda, log masuk semula untuk terus menggunakan akaun UniWork anda.',
  acctRevokedShort: 'Sesi ditamatkan',
  acctRevokedTitle: 'Anda telah dilog keluar pada peranti ini',
  acctRevokedBody:
    'Sesi peranti ini telah ditamatkan daripada peranti lain atau oleh pentadbir. Log masuk semula untuk meneruskan.',
  acctUnreachableTitle: 'Tidak dapat menghubungi UniWork',
  acctUnreachableBody:
    'Semak sambungan internet atau tetapan proksi anda. Anda masih log masuk; butiran di bawah mungkin sudah lapuk.',
  acctRetry: 'Cuba lagi',
  acctRetrying: 'Mencuba semula…',
  acctWrongServerShort: 'Pelayan berbeza',
  acctWrongServerTitle: 'Log masuk ke pelayan yang berbeza',
  acctWrongServerBody:
    'Apl ini dipautkan kepada {server}, tetapi sesi anda milik pelayan UniWork yang lain. Log masuk semula dengan {server}, atau log keluar.',
  acctThisServer: 'pelayan yang dikonfigurasikan',
  acctNotConfiguredShort: 'Belum dipautkan',
  acctNotConfiguredTitle: 'Tidak dipautkan kepada pelayan UniWork',
  acctNotConfiguredBody:
    'Salinan UniWork Office ini belum disediakan dengan pelayan UniWork, jadi log masuk tidak tersedia. Minta pentadbir anda untuk pemasang yang telah dikonfigurasikan.',
  acctKeyringShort: 'Storan selamat diperlukan',
  acctKeyringTitle: 'Storan selamat tidak tersedia',
  acctKeyringBody:
    'UniWork Office menyimpan log masuk anda dalam storan selamat sistem anda (Keychain, Credential Manager atau keyring). Buka kunci atau sediakannya, kemudian mulakan semula apl.',
  acctErrLaunch: 'Tidak dapat memulakan log masuk. Sila cuba lagi.',
  acctErrNetwork:
    'Tidak dapat menyambung ke UniWork. Semak sambungan internet atau tetapan proksi anda.',
  acctErrTimeout: 'UniWork mengambil masa terlalu lama untuk membalas. Sila cuba lagi.',
  acctErrLoginTimeout: 'Log masuk tamat masa. Sila cuba lagi.',
  acctErrCancelled: 'Log masuk dibatalkan.',
  acctErrInvalidCallback: 'Respons log masuk tidak sah. Sila cuba lagi.',
  acctErrStateMismatch:
    'Pautan log masuk ini tidak sepadan dengan percubaan semasa. Mulakan log masuk semula daripada apl.',
  acctErrAuthCodeInvalid:
    'Kod log masuk telah tamat tempoh atau sudah digunakan. Sila log masuk semula.',
  acctErrRateLimited: 'Terlalu banyak percubaan. Tunggu sebentar dan cuba lagi.',
  acctErrUnauthorized: 'Sesi anda tidak lagi sah. Sila log masuk semula.',
  acctErrDeviceRevoked: 'Peranti ini telah dilog keluar. Sila log masuk semula.',
  acctErrRefreshReused: 'Demi keselamatan anda, sesi ini telah ditamatkan. Sila log masuk semula.',
  acctErrWrongDeployment: 'Akaun ini milik pelayan UniWork yang lain.',
  acctErrNotConfigured: 'Apl ini tidak dipautkan kepada pelayan UniWork.',
  acctErrKeyringUnavailable: 'Storan selamat pada komputer ini tidak tersedia.',
  acctErrServerError: 'UniWork menghadapi masalah. Sila cuba lagi kemudian.',
  acctErrMalformedResponse:
    'UniWork menghantar respons yang tidak dijangka. Sila cuba lagi kemudian.',
} satisfies Record<keyof typeof zh, string>

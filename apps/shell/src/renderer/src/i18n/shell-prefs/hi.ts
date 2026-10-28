import type { zh } from './zh'

export const hi = {
  setRestoreSession: 'पिछली बार के दस्तावेज़ फिर से खोलें',
  setRestoreSessionDesc:
    'UniWork Office बंद करते समय खुले दस्तावेज़ अगली बार शुरू होने पर अपने-आप फिर से खुल जाते हैं।',
  setAutoUpdateCheck: 'अपडेट अपने-आप जाँचें',
  setAutoUpdateCheckDesc:
    'बंद होने पर UniWork Office शुरू होते समय या बैकग्राउंड में नए संस्करण नहीं जाँचता। आप फिर भी सहायता › अपडेट जांचें से जाँच सकते हैं।',
} satisfies Record<keyof typeof zh, string>

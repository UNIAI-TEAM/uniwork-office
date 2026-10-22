import type { zh } from './zh'

export const hi = {
  algMenu: 'एक्सेस लॉग',
  algTitle: 'एक्सेस लॉग',
  algDescription:
    'किसने दस्तावेज़ देखा, डाउनलोड किया या लिंक से खोला। इसे केवल प्रबंधक पढ़ सकते हैं।',
  algManageOnly: 'एक्सेस लॉग पढ़ने के लिए आपको प्रबंधन अनुमति चाहिए।',
  algLoading: 'लॉग लोड हो रहा है…',
  algError: 'एक्सेस लॉग लोड नहीं हो सका।',
  algEmpty: 'अभी तक कोई एक्सेस दर्ज नहीं हुआ।',
  algFilterLabel: 'कार्रवाई',
  algFilterAll: 'सभी कार्रवाइयाँ',
  algActionView: 'देखा',
  algActionDownload: 'डाउनलोड',
  algActionExport: 'निर्यात',
  algActionLinkView: 'लिंक से खोला',
  algActionUnknown: 'अन्य',
  algActorAnonymous: 'अनाम',
  algActorSystem: 'सिस्टम',
  algActorUnknown: 'अज्ञात',
  algVersion: 'संस्करण {no}',
} satisfies Record<keyof typeof zh, string>

import type { zh } from './zh'

export const hi = {
  usMyFolder: 'मेरा फ़ोल्डर',
  usPrivateTag: 'निजी',
  usDialogTitle: 'दस्तावेज़ को नाम दें',
  usHint:
    'पहली बार सहेजना। आगे सहेजने पर यही नाम रहेगा; बदलने के लिए "इस रूप में सहेजें" का उपयोग करें।',
  usName: 'नाम',
  usLocation: 'स्थान',
  usSavingIn: 'यहाँ सहेजा जा रहा है: {folder}',
  usMyFolderPrivate: 'निजी, सिर्फ़ आप देख सकते हैं',
  usChange: 'बदलें',
  usSave: 'सहेजें',
  usClose: 'बंद करें',
  usPickTitle: 'सहेजने की जगह चुनें',
  usBack: 'नाम देने पर वापस जाएँ',
  usSearchFolders: 'फ़ोल्डर खोजें',
  usSharedNote: 'साझा फ़ोल्डर में सहेजने पर दस्तावेज़ को उस फ़ोल्डर की अनुमतियाँ मिलती हैं।',
  usChooseFolder: '"{folder}" चुनें',
  usSelected: 'चुना गया',
  usRootBlocked: 'कोई फ़ोल्डर चुनें',
  usErrInvalidDestination: 'यहाँ सहेजा नहीं जा सकता। कोई दूसरा फ़ोल्डर चुनें।',
  usErrMyFolderLocked:
    'मेरा फ़ोल्डर आपका निजी सिस्टम फ़ोल्डर है; इसका नाम बदला, साझा, स्थानांतरित या संग्रहित नहीं किया जा सकता।',
  usErrFlushFailed:
    'दस्तावेज़ अभी इस डिवाइस पर लिखा नहीं जा सका। पहले दस्तावेज़ सहेजें, फिर दोबारा कोशिश करें।',
  usErrBindFailed:
    '"{title}" (ID {id}) बन गया, लेकिन इसे इस टैब से जोड़ा नहीं जा सका। दस्तावेज़ ट्रैश में चला गया है और उसे वापस लाया जा सकता है।',
  usErrOrphaned:
    'UniWork में "{title}" (ID {id}) बन गया, लेकिन इसे न इस टैब से जोड़ा जा सका, न ट्रैश में ले जाया जा सका। UniWork में उस दस्तावेज़ को हटाएँ या उपयोग करें।',
  usErrAlreadyBound: 'यह टैब पहले से एक UniWork दस्तावेज़ से जुड़ा है। हमेशा की तरह सहेजें।',
  usErrNotFound:
    'सहेजने वाली फ़ाइल या चुना गया फ़ोल्डर नहीं मिला। सहेजने की जगह फिर से चुनें और दोबारा कोशिश करें।',
} satisfies Record<keyof typeof zh, string>

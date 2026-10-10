import type { zh } from './zh'

export const hi = {
  webCancel: 'रद्द करें',
  webConflictTitle: 'यह दस्तावेज़ कहीं और बदला गया है',
  webConflictBody:
    'आपके संपादन के दौरान एक नया संस्करण सहेजा गया। क्या आप इसे अपने संस्करण से अधिलेखित करना चाहते हैं, या नवीनतम संस्करण फिर से लोड करके अपने बदलाव छोड़ना चाहते हैं?',
  webConflictOverwrite: 'अधिलेखित करें',
  webConflictReload: 'नवीनतम संस्करण लोड करें',
  webConflictNotSaved: 'दस्तावेज़ कहीं और बदला गया है',
  webFatalTitle: 'दस्तावेज़ नहीं खोला जा सका',
  webFatalBody:
    'संपादन और सहेजना बंद हैं। पेज फिर से लोड करें या UniWork से दस्तावेज़ दोबारा खोलें।',
  webNoHost: 'यह संपादक UniWork के अंदर चलता है। UniWork से दस्तावेज़ खोलें।',
  webViewOnly: 'केवल देखें',
  webViewOnlyNotSaved: 'यह दस्तावेज़ केवल देखने के लिए है और सहेजा नहीं जा सकता',
  webNotUtf8:
    'यह फ़ाइल UTF-8 टेक्स्ट नहीं है। यह केवल देखने के लिए खुलती है ताकि सहेजने से इसकी सामग्री न बदले',
  webDraftTitle: 'सहेजे न गए बदलाव पुनर्स्थापित करें?',
  webDraftBody:
    'इस ब्राउज़र ने इस दस्तावेज़ के सहेजे न गए बदलावों की एक प्रति रखी है। उन्हें पुनर्स्थापित करें या हटाएँ?',
  webDraftOlder:
    'यह प्रति दस्तावेज़ के पुराने संस्करण पर आधारित है। इसे सहेजने से नया संस्करण बदल जाएगा।',
  webDraftSavedAt: 'प्रति रखी गई',
  webDraftRestore: 'पुनर्स्थापित करें',
  webDraftDiscard: 'हटाएँ',
} satisfies Record<keyof typeof zh, string>

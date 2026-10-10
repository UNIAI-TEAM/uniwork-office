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
  webReloaded: 'नवीनतम संस्करण फिर से लोड किया गया और आपके बदलाव हटा दिए गए',
  webViewOnlyNoSave: 'यह दस्तावेज़ केवल देखने के लिए है',
  webMergeTitle: 'PDF मर्ज करें',
  webMergeBody: '{count} PDF चुनी गईं। एक और PDF जोड़ें या अभी मर्ज करें?',
  webMergeAdd: 'एक और PDF जोड़ें',
  webMergeNow: 'अभी मर्ज करें',
  webSaveNetwork: 'UniWork से संपर्क नहीं हो सका। अपना कनेक्शन जाँचें और फिर से प्रयास करें।',
  webSaveTimeout: 'सहेजने में बहुत अधिक समय लगा। अपना कनेक्शन जाँचें और फिर से प्रयास करें।',
} satisfies Record<keyof typeof zh, string>

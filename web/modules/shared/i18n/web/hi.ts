import type { zh } from './zh'

export const hi = {
  webCancel: 'रद्द करें',
  webConflictTitle: 'यह दस्तावेज़ कहीं और बदला गया है',
  webConflictBody:
    'आपके बदलाव अभी UniWork पर नहीं हैं और साइन आउट करने तक इस ब्राउज़र में रखे जाते हैं।',
  webConflictOverwrite: 'अधिलेखित करें…',
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
  webDraftKept: 'यह ब्राउज़र प्रतिलिपि को तब तक रखता है जब तक आप साइन आउट नहीं करते।',
  webDraftRestore: 'पुनर्स्थापित करें',
  webDraftDiscard: 'हटाएँ',
  webSaveNetwork: 'UniWork से संपर्क नहीं हो सका। अपना कनेक्शन जाँचें और फिर से प्रयास करें।',
  webSaveTimeout: 'सहेजने में बहुत अधिक समय लगा। अपना कनेक्शन जाँचें और फिर से प्रयास करें।',
  webClose: 'बंद करें',
  webSaveUnauthorized:
    'आपका UniWork सत्र समाप्त हो गया। फिर से साइन इन करें और दोबारा सहेजने का प्रयास करें।',
  webSaveForbidden: 'आपको इस दस्तावेज़ को सहेजने की अनुमति नहीं है।',
  webSaveNotFound: 'यह दस्तावेज़ अब मौजूद नहीं है या कहीं और ले जाया गया है।',
  webSaveTooLarge: 'दस्तावेज़ सहेजने के लिए बहुत बड़ा है।',
  webSaveRateLimited: 'बहुत अधिक अनुरोध। कुछ देर प्रतीक्षा करें और फिर प्रयास करें।',
  webSaveServer: 'UniWork को सहेजते समय समस्या हुई। थोड़ी देर बाद फिर प्रयास करें।',
  webSaveFailedGeneric: 'दस्तावेज़ सहेजा नहीं जा सका। फिर प्रयास करें।',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'आपके बदलाव अभी UniWork पर नहीं हैं और साइन आउट करने तक इस ब्राउज़र में रखे जाते हैं।',
  uwConflictReloadWebBody:
    'ब्राउज़र टकराव के ड्राफ़्ट नहीं रखता। बाद में कॉपी करने के लिए अपना संस्करण डाउनलोड करें, या अपने बदलाव छोड़ें।',
  uwConflictDownloadThenReload: 'मेरा संस्करण डाउनलोड करें, फिर लोड करें',
  uwConflictDiscardThenReload: 'बदलाव छोड़ें और फिर से लोड करें',
  uwConflictMineFileSuffix: '(मेरा संस्करण)',
  uwConflictDownloadCheck:
    'आपके ब्राउज़र को फ़ाइल मिल गई। जाँचें कि वह सहेजी गई, फिर "फिर से लोड करें" चुनें।',
  uwConflictSessionWeb:
    'आपका सत्र समाप्त हो गया, इसलिए अधिलेखन नहीं हुआ। आपके बदलाव इस ब्राउज़र में रहेंगे; फिर से साइन इन करें और दोबारा कोशिश करें।',
  uwConflictTooLarge: 'आपका संस्करण UniWork की आकार सीमा से बड़ा है, इसलिए अधिलेखित नहीं हो सका।',
  uwConflictDownloadTooLarge:
    'आपका संस्करण UniWork की आकार सीमा से बड़ा है, इसलिए इसे यहाँ डाउनलोड नहीं किया जा सकता।',
  uwConflictDownloadFailed:
    'आपका संस्करण डाउनलोड नहीं हो सका, इसलिए दस्तावेज़ फिर से लोड नहीं हुआ। फिर से कोशिश करें।',
  uwConflictOfflineWeb:
    'आप ऑफ़लाइन हैं। वेब पर इसके लिए कनेक्शन चाहिए; आपके बदलाव इस ब्राउज़र में रहेंगे।',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'आपका संस्करण',
  uwConflictColServer: 'UniWork पर संस्करण',
  uwConflictRowVersion: 'संस्करण',
  uwConflictRowTime: 'समय',
  uwConflictRowBy: 'किसने सहेजा',
  uwConflictMineUnsaved: 'आप (सहेजा नहीं गया)',
  uwConflictBasedOn: 'संस्करण {n} पर आधारित',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'अंतर देखें',
  uwConflictDiffPending: 'तुलना की जा रही है…',
  uwConflictDiffFailed: 'अभी संस्करणों की तुलना नहीं हो सकी। बाद में फिर कोशिश करें।',
  uwConflictNoEdit: 'अब आपके पास इस दस्तावेज़ को संपादित करने की पहुँच नहीं है।',
  uwConflictOverwriteTitle: 'अपने संस्करण से अधिलेखित करें?',
  uwConflictOverwriteConfirm:
    'UniWork आपकी प्रति से संस्करण {next} बनाएगा। {author} का संस्करण {server} इतिहास में बना रहेगा।',
  uwConflictOverwriteGo: 'अधिलेखित करें',
  uwConflictBack: 'वापस',
  uwConflictHeadMoved: 'इस बीच UniWork पर संस्करण {n} आ गया। तालिका अपडेट हो गई है; फिर से चुनें।',
  uwConflictReloadTitle: 'नवीनतम फिर से लोड करें',
  uwConflictReloadGo: 'फिर से लोड करें',
  uwConflictSaveCopy: 'प्रति के रूप में सहेजें…',
  uwConflictSaveCopyTitle: 'प्रति के रूप में सहेजें?',
  uwConflictSaveCopyConfirm:
    'UniWork आपके संस्करण से एक नया दस्तावेज़ बनाएगा, जिसका स्वामी और पहुँच इस दस्तावेज़ जैसी होगी। मौजूदा दस्तावेज़ और {author} का संस्करण {server} जैसे हैं वैसे ही रहेंगे।',
  uwConflictSaveCopyGo: 'प्रति बनाएँ',
  uwConflictSaveCopyDone:
    'आपका संस्करण नए दस्तावेज़ के रूप में सहेजा गया: {title}। यह दस्तावेज़ नहीं बदला; आप अब भी फिर से लोड या अधिलेखित कर सकते हैं।',
  uwConflictSaveCopyFailed: 'प्रति नहीं बन सकी। आपके बदलाव अब भी सुरक्षित हैं; फिर से कोशिश करें।',
  uwConflictSaveCopyOffline:
    'आप ऑफ़लाइन हैं। प्रति बनाने के लिए कनेक्शन चाहिए; आपके बदलाव रखे गए हैं।',
  uwConflictReloadFailed:
    'नवीनतम संस्करण लोड नहीं हो सका। आपका दस्तावेज़ नहीं बदला; फिर से कोशिश करें।',
  uwConflictOverwriteFailed:
    'अभी अधिलेखित नहीं हो सका। आपका दस्तावेज़ नहीं बदला; फिर से कोशिश करें।',
  uwConflictClose: 'बंद करें',

  // S6 new-version bar
  uwRemoteRegion: 'नया संस्करण',
  uwRemoteUpdated: 'संस्करण {n} पर अपडेट किया गया, जिसे {author} ने {time} पर सहेजा।',
  uwRemoteUpdatedNoRev: 'UniWork पर नवीनतम संस्करण पर अपडेट किया गया।',
  uwRemoteNewerDirty:
    'UniWork पर नया संस्करण है (संस्करण {n})। आपके बदलाव सहेजे नहीं गए हैं, इसलिए दस्तावेज़ फिर से लोड नहीं हुआ।',
  uwRemoteNewerAi:
    'UniWork पर नया संस्करण है (संस्करण {n})। UniWork AI चल रहा है, इसलिए दस्तावेज़ फिर से लोड नहीं हुआ; AI के परिणाम केवल खुली प्रति पर लागू होते हैं।',
  uwRemoteNowClean: 'आपने सभी बदलाव पूर्ववत कर दिए। UniWork पर संस्करण {n} खुली प्रति से नया है।',
  uwRemoteStopAiConfirm:
    'फिर से लोड करने के लिए चल रहा UniWork AI रोकें? AI के किए गए बदलाव खुली प्रति के हैं।',
  uwRemoteWaitCommit: 'चल रही सहेज पूरी होने की प्रतीक्षा; उसके बाद आप फिर से लोड कर सकते हैं।',
  uwRemoteReload: 'नवीनतम फिर से लोड करें…',
  uwRemoteLater: 'बाद में',
  uwRemoteClose: 'बंद करें',
  uwRemoteReloadFailed: 'संस्करण {n} लोड नहीं हो सका। आप अभी भी पिछला संस्करण देख रहे हैं।',
  uwRemoteDeleted: 'यह दस्तावेज़ UniWork पर हटा दिया गया। कतार की सहेजें रुक गईं।',
  uwAuthorFallback: 'एक सदस्य',
  uwLockRegion: 'दस्तावेज़ की स्थिति',
  uwActRetry: 'फिर से कोशिश करें',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'अब आपके पास इस दस्तावेज़ की पहुँच नहीं है। सहेजना रुक गया; बिना सहेजे बदलाव साइन आउट करने तक इस ब्राउज़र में रखे जाते हैं।',
  uwRemoteOrgBlockedWeb:
    'सहेजा नहीं जा सका: {reason}। बिना सहेजे बदलाव साइन आउट करने तक इस ब्राउज़र में रखे जाते हैं।',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'दस्तावेज़ संग्रहित किया गया',
  uwReasonSuspended: 'संगठन निलंबित है',
  uwReasonDeactivated: 'इस संगठन में आपका खाता निष्क्रिय है',

  webSizeWarnChip: '{max} की सीमा के करीब (वर्तमान में {size})।',
  webSaveBlockTitle: 'UniWork में सहेजा नहीं जा सका',
  webSaveBlockBody:
    'यह दस्तावेज़ {max} से अधिक है। आपके बदलाव अभी भी यहाँ हैं। अपनी प्रति कंप्यूटर पर डाउनलोड करें, फिर छवियों का आकार कम करें या दस्तावेज़ को विभाजित करें।',
  webSaveBlockDownload: 'मेरी प्रति डाउनलोड करें',
  uwConflictTooLargeWithLimit:
    'आपका संस्करण {max} से अधिक है (वर्तमान में {size})। फ़ाइल का आकार कम करने के लिए “मेरी प्रति डाउनलोड करें” चुनें या इस संवाद को बंद करें।',
} satisfies Record<keyof typeof zh, string>

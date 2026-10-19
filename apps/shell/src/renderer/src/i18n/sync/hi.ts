import type { zh } from './zh'

export const hi = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'सहेजना कतार में है — अभी UniWork पर नहीं',
  uwChipQueuedNewer: 'सहेजना कतार में है · नए बदलाव',
  uwChipPausedAdmin: 'सहेजना कतार में है · भेजना रुका हुआ है',
  uwChipReconciling: 'पिछली सहेज की जाँच हो रही है…',
  uwChipReconcileStuck: 'सहेज की पुष्टि के लिए सहायता चाहिए',
  uwErrReconcileStuck: 'सहेज की पुष्टि के लिए सहायता चाहिए।',
  uwChipRemoteNewer: 'UniWork पर नया संस्करण',
  uwTipQueued:
    '{time} की आपकी सहेज इस कंप्यूटर पर सुरक्षित रखी गई है और संभव होने पर भेजी जाएगी।',
  uwTipQueuedNewer:
    '{time} की सहेज भेजे जाने की प्रतीक्षा में है। बाद के बदलाव इसमें शामिल नहीं हैं।',
  uwTipPausedAdmin: 'आपके व्यवस्थापक ने भेजना रोक दिया है। सहेज इस कंप्यूटर पर रखी गई है।',
  uwTipPausedUser:
    'आपने भेजना रोका है। {time} की सहेज इस कंप्यूटर पर रखी गई है; सिंक केंद्र में "भेजना फिर शुरू करें" चुनें।',
  uwTipReconciling:
    'अभी स्पष्ट नहीं है कि पिछली सहेज UniWork तक पहुँची या नहीं। ऐप जाँच कर रहा है और डुप्लिकेट नहीं बनाएगा।',
  uwTipRemoteNewer: 'आपके बदलाव सहेजे नहीं गए हैं, इसलिए दस्तावेज़ फिर से लोड नहीं हुआ।',
  uwTipFailed: 'यह सहेज अपने आप दोबारा नहीं होगी: {reason}। आपके बदलाव इस कंप्यूटर पर बने रहेंगे।',
  uwTipWaitAi: 'AI के मौजूदा चरण पूरा करने की प्रतीक्षा, फिर सहेजा जाएगा।',
  uwTipWaitAiLong: 'AI ने मौजूदा चरण पूरा नहीं किया है। अभी सहेजने के लिए AI रन रोकें।',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'कतार देखें',
  uwActSaveAgain: 'फिर से सहेजें',
  uwActStopAi: 'AI रोकें',
  uwActBack: 'वापस',
  uwQueuePopWaiting: 'सहेजने की प्रतीक्षा: {time} से (संस्करण {base} पर आधारित)',
  uwQueuePopNewer: 'उसके बाद के नए बदलाव — भेजे नहीं गए',
  uwQueueBlockedSave:
    'आपकी पिछली सहेज अभी प्रतीक्षा में है। उसके पूरा होने पर आप फिर से सहेज सकते हैं।',
  uwQueueFull:
    'इस कंप्यूटर पर सिंक स्टोरेज भर गया है, इसलिए सहेज कतार में नहीं जुड़ी। आपके बदलाव अभी खुली विंडो में हैं; सिंक केंद्र में जगह खाली करें।',
  uwQueueOpenCenter: 'सिंक केंद्र खोलें',
  uwQueueCancel: 'सहेजना रद्द करें…',
  uwQueueCancelConfirm:
    'कतार में रखी सहेज रद्द करें? आपके बदलाव इस कंप्यूटर पर रहेंगे; UniWork पर दस्तावेज़ नहीं बदलेगा।',
  uwQueueCancelGo: 'सहेजना रद्द करें',
  uwQueueCancelled: 'कतार की सहेज रद्द कर दी गई। आपके बदलाव इस कंप्यूटर पर रहेंगे।',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'फिर से साइन इन करें',
  uwReasonSignedOut: 'साइन आउट हो गया',
  uwReasonForeign: 'किसी दूसरे खाते का है',
  uwReasonArchived: 'दस्तावेज़ संग्रहित किया गया',
  uwReasonSuspended: 'संगठन निलंबित है',
  uwReasonDeactivated: 'इस संगठन में आपका खाता निष्क्रिय है',
  uwReasonLease: 'ऑफ़लाइन पहुँच समाप्त हो गई',
  uwReasonKeystore: 'इस कंप्यूटर का कीचेन लॉक है',
  uwReasonClock: 'घड़ी पीछे कर दी गई',
  uwReasonStoreFull: 'इस कंप्यूटर पर सिंक स्टोरेज भर गया है',
  uwReasonStoreNewer: 'ऐप का नया संस्करण चाहिए',

  // S2 queue-row badges
  uwBadgeQueued: 'प्रतीक्षा में',
  uwBadgeWaitNetwork: 'नेटवर्क की प्रतीक्षा',
  uwBadgePausedUser: 'आपने रोका',
  uwBadgePausedAdmin: 'व्यवस्थापक ने रोका',
  uwBadgeSending: 'भेजा जा रहा है',
  uwBadgeReconciling: 'जाँच हो रही है',
  uwBadgeReconcileStuck: 'सहायता चाहिए',
  uwBadgeConflict: 'टकराव',
  uwBadgeBlocked: 'अवरुद्ध',
  uwBadgeLocked: 'लॉक है',
  uwBadgeRevoked: 'पहुँच नहीं',
  uwBadgeDeleted: 'हटाया गया',
  uwBadgeReconnect: 'फिर से कनेक्ट करना होगा',
  uwBadgeKeystore: 'कीचेन लॉक है',
  uwBadgeFailed: 'भेजा नहीं जा सका',
  uwBadgeSaved: 'सहेजा गया',
  uwBadgeKeptDraft: 'रखा गया ड्राफ़्ट',
  uwBadgeMoved: 'स्थानांतरित',
  uwBadgeArchived: 'संग्रहित',

  // S2 queue-row details
  uwRowQueued: '{time} को सहेजा गया · संस्करण {base} पर आधारित · {size}',
  uwRowWaitNetwork: 'ऑनलाइन होने पर भेजा जाएगा',
  uwRowPausedUser: '"भेजना फिर शुरू करें" चुनने पर भेजा जाएगा',
  uwRowPausedAdmin: 'व्यवस्थापक के भेजना फिर चालू करने पर भेजा जाएगा',
  uwRowUploading: 'अपलोड हो रहा है {done} / {total}',
  uwRowCommitting: 'संस्करण बनाया जा रहा है',
  uwRowReconciling: '{time} पर भेजने का परिणाम अभी स्पष्ट नहीं है। UniWork से जाँच हो रही है।',
  uwRowReconcileStuck:
    'मिलान के प्रयास: {count}, अभी कोई परिणाम नहीं। ऐप दोबारा नहीं भेजेगा; सहायता कोड अपने व्यवस्थापक को भेजें।',
  uwStuckDiscardConfirm:
    'यह सहेज छोड़ें? अगर यह UniWork तक पहुँच चुकी है तो वह संस्करण बना रहेगा; आपकी प्रति सिंक केंद्र में ड्राफ़्ट के रूप में रखी जाएगी।',
  uwRowConflict: 'संस्करण {n} को {author} ने {time} पर सहेजा',
  uwRowFailed: 'भेजा नहीं जा सका: {reason}',
  uwRowBlocked: 'सहेजा नहीं जा सकता: {reason}',
  uwRowCommitted: 'संस्करण {n} · {time}',
  uwRowKeptDraft: '{time} पर फिर से लोड करते समय रखा गया',
  uwRowMoved: 'दस्तावेज़ {workspace} में ले जाया गया',
  uwRowArchived: 'दस्तावेज़ UniWork पर संग्रहित किया गया',

  // S2 row actions
  uwActDiscard: 'छोड़ें',
  uwActDiscardSave: 'सहेज छोड़ें…',
  uwActSendNow: 'अभी भेजें',
  uwActRecheck: 'फिर से जाँचें',
  uwActGuide: 'मार्गदर्शिका',
  uwActOpenToResolve: 'हल करने के लिए खोलें',
  uwActCopySupport: 'सहायता कोड कॉपी करें',
  uwActDownloadMine: 'मेरा संस्करण डाउनलोड करें',
  uwActOpenDraft: 'ड्राफ़्ट खोलें',
  uwActDiscardDraft: 'ड्राफ़्ट छोड़ें…',
  uwActSignInAgain: 'फिर से साइन इन करें',
  uwActSignIn: 'साइन इन करें',
  uwActSwitchAccount: 'खाता बदलें',
  uwActReconnect: 'फिर से कनेक्ट करें',
  uwActDetails: 'विवरण',
  uwActOpen: 'खोलें',
  uwDiscardDraftConfirm:
    'यह ड्राफ़्ट छोड़ें? इसके बदलाव इस कंप्यूटर से हटा दिए जाएँगे और वापस नहीं लाए जा सकेंगे।',

  // Sign-out prompt
  uwSignOutTitle: 'UniWork से साइन आउट करें?',
  uwSignOutBody:
    'बिना सहेजे बदलाव या कतार में सहेज वाले दस्तावेज़: {count}। ये इस कंप्यूटर पर लॉक रहेंगे और केवल आपका खाता इन्हें फिर से खोल सकेगा।',
  uwSignOutKeystore:
    'कंप्यूटर का कीचेन लॉक है, इसलिए बिना सहेजे बदलाव केवल खुली विंडो में हैं। अभी साइन आउट करने पर वे हट जाएँगे; जो पहले से एन्क्रिप्ट करके रखा गया है वह बना रहेगा। उन्हें रखने के लिए पहले कंप्यूटर अनलॉक करें।',
  uwSignOutGo: 'साइन आउट करें',
  uwSignOutWaiting: 'साइन आउट से पहले चल रही सहेज पूरी की जा रही है…',
  uwSignOutCaptureFailed:
    'कुछ असहेजे बदलाव समय पर कैप्चर नहीं हो सके; आपके खाते के लिए सबसे हाल का सहेजा गया या ऑटोसेव किया गया संस्करण रखा गया है।',
  uwSignOutTimedOut: 'साइन-आउट की पुष्टि होने में बहुत समय लगा; खाता अब भी साइन-इन हो सकता है।',
  uwSwitchLostTitle: 'पिछले खाते के कुछ असहेजे बदलाव खो गए',
  uwSwitchLostBody:
    'इस कंप्यूटर पर किसी दूसरे खाते ने साइन इन किया, इसलिए पिछला खाता लॉक कर दिया गया। वे दस्तावेज़ जिनके असहेजे बदलाव रखे नहीं जा सके: {count}। बाकी सब कुछ उस खाते के लिए इस कंप्यूटर पर लॉक रहता है।',
  uwSwitchLostOk: 'ठीक है',

  // S2 sync center
  uwSyncTitle: 'सिंक केंद्र',
  uwSyncOpenFromSettings: 'सिंक केंद्र',
  uwSyncOnline: 'UniWork से कनेक्टेड · {time} पर सिंक हुआ',
  uwSyncOffline: 'ऑफ़लाइन · पिछला सिंक {time}',
  uwSyncOnlineNoTime: 'UniWork से कनेक्टेड',
  uwSyncOfflineNoTime: 'ऑफ़लाइन',
  uwSyncPaused: 'भेजना रुका है — नई सहेजें प्रतीक्षा करेंगी',
  uwSyncAdminPaused: 'आपके व्यवस्थापक ने भेजना रोका है। सहेजें इस कंप्यूटर पर रखी गई हैं।',
  uwSyncFeedOff: 'नए संस्करण की सूचनाएँ रुकी हैं। सहेजते समय UniWork अब भी टकराव जाँचता है।',
  uwSyncResynced: '{time} पर पूरी तरह फिर से सिंक हुआ',
  uwSyncResyncFailed:
    'कई प्रयासों के बाद भी फिर से सिंक नहीं हो सका। नए संस्करण की सूचनाएँ रुकी हैं; सहेजते समय UniWork अब भी टकराव जाँचता है।',
  uwSyncSignedOut: 'आप साइन आउट हैं। इस कंप्यूटर पर लॉक करके रखे गए आइटम: {count}।',
  uwSyncSignedOutEmpty: 'आप साइन आउट हैं।',
  uwSyncSessionExpired: 'आपका सत्र समाप्त हो गया। भेजना जारी रखने के लिए फिर से साइन इन करें।',
  uwSyncOtherOrg: 'दूसरे संगठन में प्रतीक्षारत सहेजें: {count}',
  uwSyncStoreBudget: 'इस कंप्यूटर पर सिंक स्टोरेज: {cap} में से {used}',
  uwSyncStoreError: 'इस कंप्यूटर पर कतार पढ़ी नहीं जा सकी। कुछ भी हटाया नहीं गया।',
  uwSyncNow: 'अभी सिंक करें',
  uwSyncPause: 'भेजना रोकें',
  uwSyncResume: 'भेजना फिर शुरू करें',
  uwSyncNowOffline: 'सिंक करने के लिए कनेक्शन चाहिए।',
  uwSyncTabAttention: 'ध्यान देना है',
  uwSyncTabQueue: 'सहेजने की प्रतीक्षा',
  uwSyncTabOffline: 'ऑफ़लाइन उपलब्ध',
  uwSyncTabRecent: 'हाल में सहेजे गए',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'दस्तावेज़',
  uwSyncColState: 'स्थिति',
  uwSyncColDetail: 'विवरण',
  uwSyncColActions: 'कार्रवाइयाँ',
  uwSyncMoreActions: '{doc} के लिए और कार्रवाइयाँ',
  uwSyncEmptyQueue: 'सहेजने के लिए कुछ भी प्रतीक्षा में नहीं है।',
  uwSyncEmptyAttention: 'किसी चीज़ पर ध्यान देने की ज़रूरत नहीं है।',
  uwSyncEmptyRecent: 'हाल की कोई सहेज नहीं।',
  uwSyncActionFailed: 'यह नहीं हो सका। कुछ भी हटाया नहीं गया; फिर से कोशिश करें।',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'ऑफ़लाइन उपलब्ध करें',
  uwOfflineUnpin: 'ऑफ़लाइन प्रति हटाएँ',
  uwOfflineUnpinShort: 'अनपिन करें',
  uwOfflineAdd: 'दस्तावेज़ जोड़ें…',
  uwOfflineUsage: 'इस कंप्यूटर पर {cap} में से {used} उपयोग में',
  uwOfflineEmpty: 'अभी कोई दस्तावेज़ ऑफ़लाइन उपलब्ध नहीं है।',
  uwOfflineCapReached:
    'इस कंप्यूटर पर ऑफ़लाइन लाइब्रेरी सीमा पर है: स्टोरेज {cap}; अधिकतम दस्तावेज़: {maxDocs}। दूसरा जोड़ने के लिए एक ऑफ़लाइन प्रति हटाएँ।',
  uwOfflineReady: 'ऑफ़लाइन उपलब्ध',
  uwOfflineBadgeWaiting: 'नेटवर्क की प्रतीक्षा',
  uwOfflineBadgeDownloading: 'डाउनलोड हो रहा है',
  uwOfflineBadgeVerifying: 'सत्यापित हो रहा है',
  uwOfflineBadgeUpdate: 'अपडेट उपलब्ध',
  uwOfflineBadgeInterrupted: 'तैयार नहीं',
  uwOfflineBadgeDiskFull: 'पर्याप्त जगह नहीं',
  uwOfflineBadgeCorrupt: 'डाउनलोड क्षतिग्रस्त',
  uwOfflineBadgeLeaseSoon: 'ऑफ़लाइन पहुँच जल्द समाप्त होगी',
  uwOfflineBadgeViewOnly: 'ऑफ़लाइन उपलब्ध · केवल देखें',
  uwOfflineRowWaiting: 'ऑनलाइन होने पर डाउनलोड होगा',
  uwOfflineRowProgress: '{total} में से {done}',
  uwOfflineRowProgressAria: '{total} में से {done}',
  uwOfflineRowVerifying: 'अखंडता की जाँच हो रही है',
  uwOfflineRowReady: 'संस्करण {n} · {size} · {datetime} तक ऑफ़लाइन पहुँच',
  uwOfflineRowUpdate: 'संस्करण {n} ऑनलाइन होने पर डाउनलोड होगा; संस्करण {old} अभी भी काम करता है',
  uwOfflineRowUpdateKept:
    'संस्करण {n} में अपडेट नहीं हो सका: {reason}। संस्करण {old} अभी भी काम करता है।',
  uwOfflineRowInterrupted: 'डाउनलोड बाधित हुआ। पुरानी प्रति (यदि कोई हो) अभी भी काम करती है।',
  uwOfflineRowDiskFull: '{size} और चाहिए। पुरानी प्रति रखी गई है।',
  uwOfflineRowCorrupt: 'क्षतिग्रस्त प्रति हटा दी गई। इसे फिर से डाउनलोड करें।',
  uwOfflineRowLeaseSoon: 'नवीनीकरण के लिए {datetime} से पहले कनेक्ट करें',
  uwOfflineRowRevoked:
    'अब आपके पास इस दस्तावेज़ की पहुँच नहीं है। डाउनलोड की गई प्रति हटा दी गई; ड्राफ़्ट लॉक रहेंगे।',
  uwOfflineRowDeleted:
    'दस्तावेज़ UniWork पर हटा दिया गया। डाउनलोड की गई प्रति हटा दी गई; ड्राफ़्ट लॉक रहेंगे।',
  uwOfflineRowArchived:
    'दस्तावेज़ संग्रहित किया गया; यहाँ की प्रति ऑफ़लाइन पहुँच समाप्त होने तक खुलेगी।',
  uwOfflineRowMoved: '{workspace} में ले जाया गया; यहाँ की प्रति अभी भी काम करती है।',
  uwOfflineRowViewOnly: 'संस्करण {n} · केवल देखें · {datetime} तक ऑफ़लाइन पहुँच',
  uwOfflineReadyAnnounce: 'ऑफ़लाइन उपलब्ध: {doc}',
  uwOfflineUnpinConfirm:
    'डाउनलोड की गई प्रति इस कंप्यूटर से हटा दी जाएगी। ड्राफ़्ट और कतार की सहेजें रखी जाएँगी।',
  uwOfflineCancelDownload: 'डाउनलोड रद्द करें',
  uwOfflineDownloadNow: 'अभी डाउनलोड करें',
  uwOfflineOpenFolder: 'स्टोरेज फ़ोल्डर खोलें',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'फिर से कनेक्ट करना होगा',
  uwLockKeystoreTitle: 'इस कंप्यूटर का कीचेन लॉक है',
  uwLockClockTitle: 'समय की जाँच ज़रूरी है',
  uwLockRevokedTitle: 'पहुँच नहीं',
  uwLockDeletedTitle: 'दस्तावेज़ हटाया गया',
  uwLockForeignTitle: 'दूसरे खाते का है',
  uwLockOrgTitle: 'इस संगठन में नहीं खुल सकता',
  uwLockExpired:
    'ऑफ़लाइन पहुँच समाप्त हो गई। सामग्री एन्क्रिप्टेड रहती है; फिर से खोलने के लिए कनेक्ट करें।',
  uwLockLibraryOff:
    'आपके व्यवस्थापक ने ऑफ़लाइन दस्तावेज़ बंद कर दिए हैं, इसलिए ऑफ़लाइन पहुँच नवीनीकृत नहीं हो सकती। ड्राफ़्ट सिंक केंद्र में लॉक रहेंगे।',
  uwLockKeystore:
    'कंप्यूटर का कीचेन लॉक है, इसलिए एन्क्रिप्टेड सामग्री नहीं खुल सकती। इसे अनलॉक करके फिर से कोशिश करें; कुछ भी हटाया नहीं गया।',
  uwLockClock:
    'कंप्यूटर की घड़ी पीछे कर दी गई, इसलिए ऑफ़लाइन पहुँच लॉक है। कनेक्ट करें ताकि UniWork समय जाँच सके।',
  uwLockForeign: 'यह दस्तावेज़ इस कंप्यूटर पर दूसरे खाते का है। इसे खोलने के लिए उस खाते पर जाएँ।',
  uwLockSuspended:
    'संगठन निलंबित है। सामग्री एन्क्रिप्टेड रहती है; अपने व्यवस्थापक से संपर्क करें।',
  uwLockDeactivated:
    'इस संगठन में आपका खाता निष्क्रिय है। सामग्री एन्क्रिप्टेड रहती है; अपने व्यवस्थापक से संपर्क करें।',
  uwLockSignedOutTitle: 'आप साइन आउट हैं',
  uwLockSignedOut:
    'सामग्री इस कंप्यूटर पर लॉक रहती है। फिर से खोलने के लिए उसी खाते से साइन इन करें।',
  uwLockRegion: 'दस्तावेज़ की स्थिति',
  uwLockWhileOpen:
    'खुले रहते समय दस्तावेज़ लॉक हो गया। बिना सहेजे बदलाव एन्क्रिप्ट करके रखे गए हैं; अनलॉक होने तक आप सहेज या कॉपी नहीं कर सकते।',
  uwLockWhileOpenRam:
    'खुले रहते समय दस्तावेज़ लॉक हो गया और यह कंप्यूटर अभी आपके बदलाव सुरक्षित नहीं रख सकता। वे केवल इस विंडो में हैं (केवल देखें); इसे बंद करने पर वे खो जाएँगे।',
  uwLockOtherWindow:
    'यह दस्तावेज़ दूसरी विंडो में संपादन के लिए खुला है। यह विंडो केवल देखने के लिए है।',
  uwLockOtherWindowGone:
    'इस दस्तावेज़ को संपादित कर रही विंडो ने जवाब देना बंद कर दिया। आप इस विंडो में संपादित कर सकते हैं।',
  uwLockGoToWindow: 'उस विंडो पर जाएँ',
  uwLockTakeEdit: 'इस विंडो में संपादित करें',

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
  uwConflictSaveCopyNoSeat:
    'प्रति नहीं बन सकी, क्योंकि आप उस कार्यक्षेत्र के सदस्य नहीं हैं जिसमें यह दस्तावेज़ है। आपके बदलाव अब भी सुरक्षित हैं; आप अपना संस्करण डाउनलोड कर सकते हैं।',
  uwConflictSaveCopyFolderRefused:
    'आप इस फ़ोल्डर में दस्तावेज़ नहीं बना सकते। इसके बजाय अपना संस्करण डाउनलोड करें।',
  uwConflictDownloadDone:
    'आपका संस्करण इस कंप्यूटर में सहेजा गया: {file}। यह दस्तावेज़ नहीं बदला; आप अब भी फिर से लोड या ओवरराइट कर सकते हैं।',
  uwConflictDownloadFailedDesktop:
    'फ़ाइल सहेजी नहीं जा सकी। आपके बदलाव अब भी सुरक्षित हैं; फिर से कोशिश करें।',
  uwConflictSaveCopyOffline:
    'आप ऑफ़लाइन हैं। प्रति बनाने के लिए कनेक्शन चाहिए; आपके बदलाव रखे गए हैं।',
  uwConflictReloadFailed:
    'नवीनतम संस्करण लोड नहीं हो सका। आपका दस्तावेज़ नहीं बदला; फिर से कोशिश करें।',
  uwConflictOverwriteFailed:
    'अभी अधिलेखित नहीं हो सका। आपका दस्तावेज़ नहीं बदला; फिर से कोशिश करें।',
  uwConflictClose: 'बंद करें',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'यह दस्तावेज़ कहीं और बदला गया',
  uwConflictBody: 'आपके बदलाव अभी UniWork पर नहीं हैं और इस कंप्यूटर पर सुरक्षित हैं।',
  uwConflictReload: 'नवीनतम फिर से लोड करें',
  uwConflictOverwrite: 'अधिलेखित करें…',
  uwConflictCancel: 'रद्द करें',
  uwConflictKeepUnavailable:
    'यह कंप्यूटर अभी ड्राफ़्ट नहीं रख सकता (सिंक स्टोरेज भरा है या कीचेन लॉक है)।',
  uwConflictOfflineDesktop:
    'आप ऑफ़लाइन हैं और नवीनतम संस्करण इस कंप्यूटर पर नहीं है, इसलिए अभी फिर से लोड नहीं हो सकता।',
  uwConflictReloadDesktopBody: 'संस्करण {n} लोड होने से पहले चुनें कि आपके बदलावों का क्या होगा।',
  uwConflictKeepDraft: 'मेरा संस्करण ड्राफ़्ट के रूप में रखें',
  uwConflictDiscard: 'मेरे बदलाव छोड़ें',
  uwConflictKeepDraftHint:
    'ड्राफ़्ट सिंक केंद्र में देखने या कॉपी करने के लिए रहता है; इसे नए संस्करण पर कभी अपने आप लागू नहीं किया जाता।',
  uwConflictDraftCapReached:
    'इस दस्तावेज़ के रखे गए ड्राफ़्ट की अधिकतम संख्या पूरी हो गई: {cap}। दूसरा रखने के लिए सिंक केंद्र में एक पुराना ड्राफ़्ट छोड़ें।',

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
  uwRemoteWaitCommit: 'चल रही सहेज पूरी होने की प्रतीक्षा; उसके बाद आप जारी रख सकते हैं।',
  uwRemoteReload: 'नवीनतम फिर से लोड करें…',
  uwRemoteLater: 'बाद में',
  uwRemoteClose: 'बंद करें',
  uwRemoteReloadFailed: 'संस्करण {n} लोड नहीं हो सका। आप अभी भी पिछला संस्करण देख रहे हैं।',
  uwRemoteDeleted: 'यह दस्तावेज़ UniWork पर हटा दिया गया। कतार की सहेजें रुक गईं।',
  uwAuthorFallback: 'एक सदस्य',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'पिछली सहेज को सहायता चाहिए, इसलिए अभी आप फिर से लोड या अधिलेखित नहीं कर सकते। इसे हल करने के लिए सिंक केंद्र खोलें।',
  uwRemoteRevoked:
    'अब आपके पास इस दस्तावेज़ की पहुँच नहीं है। सहेजना रुक गया; बिना सहेजे बदलाव इस कंप्यूटर पर लॉक रखे गए हैं।',
} satisfies Record<keyof typeof zh, string>

import type { zh } from './zh'

export const hi = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'बचे क्रेडिट: {limit} में से {remaining}',
  aiUniworkFooterSignIn: 'UniWork AI इस्तेमाल करने के लिए UniWork में साइन इन करें',
  aiUniworkSignedOut: 'आप UniWork से साइन आउट हैं। कोई दूसरा प्रदाता चुनें या फिर से साइन इन करें।',
  aiUniworkOff: 'इस दस्तावेज़ के लिए UniWork AI बंद है। कोई दूसरा प्रदाता चुनें।',
  aiUniworkViewOnly: 'केवल देखें: AI जवाब दे सकता है, पर दस्तावेज़ संपादित या सहेज नहीं सकता।',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI इस दस्तावेज़ में खुली सामग्री, बिना सहेजे बदलावों सहित, पढ़ता है और जवाब देने के लिए UniWork और मॉडल प्रदाता को भेजता है। हर रन {org} के AI क्रेडिट इस्तेमाल करता है। AI आपके लिए कभी नहीं सहेजता: समीक्षा करें, फिर सहेजें दबाएँ।',
  aiUniworkDisclosureLabel: 'UniWork AI को क्या मिलता है',
  aiUniworkDisclosureShort: 'खुली सामग्री (बिना सहेजी भी) UniWork को भेजता है · {org} के क्रेडिट',
  aiUniworkLocalFile:
    'यह फ़ाइल आपके कंप्यूटर पर है, UniWork में नहीं। UniWork AI के साथ, खुली फ़ाइल की सामग्री UniWork को भेजी जाती है और {org} के AI क्रेडिट इस्तेमाल होते हैं। फ़ाइल UniWork दस्तावेज़ के रूप में अपलोड नहीं होती।',
  aiUniworkAck: 'समझ गया',
  aiUniworkLearnMore: 'और जानें',
  aiUniworkDetails: 'विवरण',
  aiUniworkSendNeedsAck: 'भेजने से पहले सूचना पढ़ें और पुष्टि करें।',

  // S9 result chips and run controls
  aiResultAnswer: 'जवाब',
  aiResultClarify: 'स्पष्टीकरण चाहिए',
  aiResultEdited: 'दस्तावेज़ में संपादित',
  aiResultUnsupported: 'समर्थित नहीं',
  aiResultError: 'त्रुटि',
  aiResultEditedHint: 'सहेजा नहीं गया — Ctrl/⌘+Z से पूर्ववत करें, या ठीक लगे तो सहेजें दबाएँ।',
  aiResultViewChanges: 'बदलाव देखें',
  aiRunStop: 'रोकें',
  aiRunSend: 'भेजें',
  aiRunRunning: 'चल रहा है… रोकने के लिए रोकें या Esc दबाएँ।',
  aiRunStopped: 'रोक दिया गया। पहले से लागू बदलाव दस्तावेज़ में रहेंगे और पूर्ववत किए जा सकते हैं।',
  aiRunAskAgain: 'फिर से पूछें',
  aiRunChooseOther: 'दूसरा प्रदाता चुनें',
  aiRunOpenInApp: 'ऐप में खोलें',
  aiConversationRestarted:
    'पिछली बातचीत की अवधि समाप्त हो गई, इसलिए UniWork AI ने नई बातचीत शुरू की और पहले के संदेश याद नहीं रखता। जारी रखने के लिए अपना प्रश्न फिर से भेजें।',
  aiConversationBoundary: '{provider} के साथ नई बातचीत: ऊपर के संदेश साथ नहीं भेजे जाते।',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'यह रन UniWork AI की चरण सीमा तक पहुँच गया। अब तक के परिणाम सुरक्षित हैं; अनुरोध को छोटे हिस्सों में बाँटें और फिर से पूछें।',
  aiErrCredits: 'आपके संगठन के इस अवधि के AI क्रेडिट खत्म हो गए हैं। यह रन रुक गया।',
  aiErrEntitlement: 'आपके संगठन के प्लान में अब UniWork AI शामिल नहीं है।',
  aiErrRateLimited: 'आप बहुत तेज़ी से भेज रहे हैं। {seconds} सेकंड बाद फिर से कोशिश करें।',
  aiErrRateLimitedNoWait: 'आप बहुत तेज़ी से भेज रहे हैं। कुछ मिनट बाद फिर से कोशिश करें।',
  aiErrUnavailable: 'UniWork AI अभी जवाब नहीं दे रहा। आपका दस्तावेज़ और सहेजें अब भी काम करते हैं।',
  aiErrDisconnected:
    'कनेक्शन टूट गया, इसलिए यह रन रुक गया। पहले से लागू बदलाव दस्तावेज़ में रहेंगे और पूर्ववत किए जा सकते हैं।',
  aiErrOffline: 'आप ऑफ़लाइन हैं। UniWork AI ऑफ़लाइन नहीं चलता और अनुरोध कतार में नहीं रखे जाते।',
  aiErrSession:
    'आपका UniWork सत्र समाप्त हो गया, इसलिए यह रन रुक गया। जारी रखने के लिए फिर से साइन इन करें।',
  aiErrRevoked: 'अब आपके पास इस दस्तावेज़ की पहुँच नहीं है, इसलिए AI रन रुक गया।',
  aiErrDowngraded:
    'आपकी पहुँच अभी केवल देखने में बदल गई, इसलिए AI ने संपादन रोक दिया। जवाब जारी रहेंगे।',
  aiErrCapabilityOff:
    'इस दस्तावेज़ के लिए UniWork AI अभी बंद किया गया, इसलिए रन मौजूदा चरण के बाद रुक गया।',
  aiErrUnsupported: 'UniWork AI अभी {module} में यह नहीं कर सकता।',
  aiErrViewOnlyEdit:
    'आपके पास इस दस्तावेज़ की केवल देखने की पहुँच है, इसलिए AI इसे संपादित नहीं कर सकता।',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'आपका अनुरोध UniWork AI के लिए बहुत लंबा है। इसे 8,000 वर्णों से कम करके फिर भेजें।',
  aiErrQuestionRejected: 'UniWork AI यह अनुरोध स्वीकार नहीं कर सका। इसे बदलकर फिर भेजें।',
  aiUniworkImagesNotSent: 'छवियाँ UniWork AI को नहीं भेजी जातीं; केवल आपका टेक्स्ट भेजा गया।',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
  cloudStateReady: 'उपलब्ध',
  cloudStateNotEntitled: 'आपके प्लान में शामिल नहीं',
  cloudStateExhausted: 'AI क्रेडिट खत्म',
  cloudStateUnavailable: 'अभी उपलब्ध नहीं',
  cloudStateSignedOut: 'साइन इन नहीं है',
  cloudStateInactive: 'सदस्यता सक्रिय नहीं है',
  cloudCredits: 'AI क्रेडिट',
  cloudCreditsLeft: '{remaining} / {limit} शेष',
  cloudCreditsUnlimited: 'असीमित',
  cloudCreditsRenews: '{date} को रीन्यू',
  cloudInactiveBody: 'आपके संगठन की UniWork सदस्यता सक्रिय नहीं है, इसलिए क्लाउड AI रुका हुआ है। किसी एडमिन से इसे नवीनीकृत करवाएँ; नीचे आपके अपने प्रदाता काम करते रहेंगे।',
  acctSignIn: 'साइन इन करें',
  acctSignInAgain: 'फिर से साइन इन करें',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart: 'स्थानीय फ़ाइलें आपके संगठन के अंतर्गत एक नई बातचीत शुरू करती हैं और अन्य फ़ाइलों के संवाद नहीं रखतीं।',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta: 'लिखी गई सेल: {written} ({range}) · ओवरराइट हुई मौजूदा सेल: {overwritten}',
  aiErrWorkbookTooLarge: 'यह वर्कबुक वेब पर AI के लिए बहुत बड़ी है। इसे UniWork Office ऐप में खोलें।',
} satisfies Record<keyof typeof zh, string>

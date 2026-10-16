import type { zh } from './zh'

export const hi = {
  webConflictTitle: 'यह प्रस्तुति कहीं और बदली गई थी',
  webConflictBody:
    'आपके बदलाव अभी UniWork पर नहीं हैं और साइन आउट करने तक इस ब्राउज़र में रखे जाते हैं।',
  webConflictOverwrite: 'अधिलेखित करें…',
  webConflictReload: 'नवीनतम फिर से लोड करें',
  webConflictNotSaved: 'प्रस्तुति कहीं और बदली गई थी',
  webDiscardTitle: 'सहेजे न गए परिवर्तन छोड़ें?',
  webDiscardBody: 'इस प्रस्तुति में सहेजे न गए परिवर्तन हैं। दूसरी फ़ाइल खोलने पर वे खो जाएंगे।',
  webDiscard: 'छोड़ें और खोलें',
  webCancel: 'रद्द करें',
  webOk: 'ठीक है',
  webFatalTitle: 'प्रस्तुति नहीं खोली जा सकी',
  webFatalBody: 'UniWork से फ़ाइल लोड नहीं हो सकी। यह टैब बंद करें और फिर से प्रयास करें।',
  webRefusedTooLarge: 'यह प्रस्तुति वेब पर खोलने के लिए बहुत बड़ी या बहुत जटिल है।',
  webRefusedTooComplex:
    'यह प्रस्तुति वेब पर खोलने के लिए बहुत जटिल है ({parts} भाग, सीमा {limit})।',
  webRefusedOutOfMemory: 'यह प्रस्तुति बहुत बड़ी है और खोलते समय ब्राउज़र की मेमोरी समाप्त हो गई।',
  webNoHost: 'यह संपादक UniWork के अंदर चलता है। प्रस्तुति को UniWork से खोलें।',
  webLegacyPpt:
    'यह पुरानी .ppt फ़ाइल है और ब्राउज़र में नहीं खुल सकती। पहले इसे PowerPoint में .pptx के रूप में सहेजें।',
  webEncryptedPptx: 'यह प्रस्तुति पासवर्ड से सुरक्षित है और ब्राउज़र में नहीं खुल सकती।',
  webCommentAuthor: 'उपयोगकर्ता',
  webExternalMedia: 'लिंक किया गया बाहरी मीडिया केवल डेस्कटॉप ऐप में चलता है।',
  webReadOnly: 'यह प्रस्तुति केवल पढ़ने के लिए है।',
  webSaveNetwork: 'UniWork से संपर्क नहीं हो सका। अपना कनेक्शन जाँचें और फिर से प्रयास करें।',
  webSaveTimeout: 'सहेजने में बहुत अधिक समय लगा। अपना कनेक्शन जाँचें और फिर से प्रयास करें।',
  webFullscreenHint: 'पूर्ण स्क्रीन में जाने के लिए क्लिक करें या कोई भी कुंजी दबाएँ',
} satisfies Record<keyof typeof zh, string>

import type { zh } from './zh'

export const hi = {
  cloudTitle: 'UniWork क्लाउड AI',
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
  cloudSignedOutBody:
    'अपने संगठन के AI क्रेडिट से वेब सर्च, इमेज जनरेशन और मीडिया विश्लेषण इस्तेमाल करने के लिए UniWork में साइन इन करें।',
  cloudNotEntitledBody:
    'आपके संगठन के प्लान में UniWork क्लाउड AI शामिल नहीं है। आप नीचे अपने प्रदाता अब भी इस्तेमाल कर सकते हैं।',
  cloudExhaustedBody:
    'आपके संगठन ने इस अवधि के सभी UniWork AI क्रेडिट इस्तेमाल कर लिए हैं। क्रेडिट रीन्यू होने तक क्लाउड टूल रुके रहेंगे; नीचे आपके प्रदाता काम करते रहेंगे।',
  cloudUnavailableBody: 'UniWork क्लाउड AI अभी उपलब्ध नहीं है। नीचे आपके प्रदाता काम करते रहेंगे।',
  cloudInactiveBody:
    'आपके संगठन की UniWork सदस्यता सक्रिय नहीं है, इसलिए क्लाउड AI रुका हुआ है। किसी एडमिन से इसे नवीनीकृत करवाएँ; नीचे आपके अपने प्रदाता काम करते रहेंगे।',
  cloudToolsOffBody:
    'UniWork क्लाउड टूल बंद हैं। संगठन के AI क्रेडिट इस्तेमाल करने के लिए {section} में “{switch}” चालू करें; नीचे आपके अपने प्रदाता प्रभावित नहीं होंगे।',
  cloudReadyBody:
    'अपना प्रदाता न होने पर सर्च, इमेज जनरेशन और मीडिया विश्लेषण आपके संगठन के UniWork AI क्रेडिट इस्तेमाल करते हैं।',
  cloudToolsToggle: 'UniWork क्लाउड टूल इस्तेमाल करें',
  cloudToolsToggleDesc:
    'अपना प्रदाता न होने पर वेब सर्च, इमेज जनरेशन और मीडिया विश्लेषण UniWork क्लाउड से चलते हैं (AI क्रेडिट खर्च होते हैं)।',
  cloudMediaLabel: 'UniWork क्लाउड',
  cloudMediaDesc: 'आपके संगठन के UniWork AI क्रेडिट इस्तेमाल करता है; कुंजी की ज़रूरत नहीं।',
  cloudSearchAutoHint: 'पहले UniWork क्लाउड (AI क्रेडिट खर्च), फिर मुफ़्त सर्च।',
  aiTestErrInvalidKey: 'API कुंजी नहीं है या अस्वीकार हुई',
  aiTestErrNetwork: 'कनेक्ट नहीं हो सका। अपना नेटवर्क जाँचें',
  aiTestErrLimit: 'प्रदाता की सीमा पूरी हो गई। बाद में फिर कोशिश करें',
  aiTestErrUnavailable: 'सेवा जवाब नहीं दे रही। बाद में फिर कोशिश करें',
  aiTestErrMisconfigured: 'सेटिंग अधूरी हैं: सेवा का पता और खाते के फ़ील्ड जाँचें',
} satisfies Record<keyof typeof zh, string>

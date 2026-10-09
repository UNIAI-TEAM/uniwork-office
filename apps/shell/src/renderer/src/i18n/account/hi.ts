import type { zh } from './zh'

export const hi = {
  acctTitle: 'UniWork खाता',
  acctOpenSettings: 'खाता सेटिंग खोलें',
  acctSignIn: 'साइन इन करें',
  acctSignInUniwork: 'UniWork में साइन इन करें',
  acctSignInAgain: 'फिर से साइन इन करें',
  acctSignOut: 'साइन आउट करें',
  acctSigningOut: 'साइन आउट हो रहा है…',
  acctSigningIn: 'साइन इन हो रहा है…',
  acctSigningInHint: 'साइन इन पूरा करने के लिए अपने ब्राउज़र में जारी रखें।',
  acctCancel: 'रद्द करें',
  acctOpenAgain: 'ब्राउज़र फिर से खोलें',
  acctCopyLink: 'साइन-इन लिंक कॉपी करें',
  acctLinkCopied: 'लिंक कॉपी हो गया',
  acctSignedInAs: '{name} के रूप में साइन इन हैं',
  acctSignedOutTitle: 'आपने साइन इन नहीं किया है',
  acctSignedOutBody:
    'इस डिवाइस पर अपने संगठन के प्लान का उपयोग करने के लिए अपने UniWork खाते से साइन इन करें।',
  acctRefreshing: 'खाता अपडेट हो रहा है…',
  acctName: 'नाम',
  acctEmail: 'ईमेल',
  acctOrg: 'संगठन',
  acctPlan: 'प्लान',
  acctServer: 'सर्वर',
  acctNoPlan: 'कोई प्लान नहीं',
  acctSwitchOrg: 'संगठन बदलें',
  acctSwitchOrgFailed: 'संगठन नहीं बदला जा सका। कृपया फिर से प्रयास करें।',
  acctExpiredShort: 'सत्र समाप्त हो गया',
  acctExpiredTitle: 'आपका सत्र समाप्त हो गया है',
  acctExpiredBody: 'आपकी सुरक्षा के लिए, UniWork खाते का उपयोग जारी रखने हेतु फिर से साइन इन करें।',
  acctRevokedShort: 'सत्र समाप्त किया गया',
  acctRevokedTitle: 'आपको इस डिवाइस पर साइन आउट कर दिया गया',
  acctRevokedBody:
    'इस डिवाइस का सत्र किसी अन्य डिवाइस से या व्यवस्थापक द्वारा समाप्त कर दिया गया। जारी रखने के लिए फिर से साइन इन करें।',
  acctUnreachableTitle: 'UniWork से कनेक्ट नहीं हो पा रहा',
  acctUnreachableBody:
    'अपना इंटरनेट कनेक्शन या प्रॉक्सी सेटिंग जाँचें। आप अभी भी साइन इन हैं; नीचे दी गई जानकारी पुरानी हो सकती है।',
  acctRetry: 'फिर से प्रयास करें',
  acctRetrying: 'फिर से प्रयास हो रहा है…',
  acctWrongServerShort: 'अलग सर्वर',
  acctWrongServerTitle: 'किसी अलग सर्वर में साइन इन हैं',
  acctWrongServerBody:
    'यह ऐप {server} से जुड़ा है, लेकिन आपका सत्र किसी दूसरे UniWork सर्वर का है। {server} के साथ फिर से साइन इन करें, या साइन आउट करें।',
  acctThisServer: 'कॉन्फ़िगर किया गया सर्वर',
  acctNotConfiguredShort: 'जुड़ा नहीं है',
  acctNotConfiguredTitle: 'UniWork सर्वर से नहीं जुड़ा है',
  acctNotConfiguredBody:
    'UniWork Office की यह कॉपी अभी किसी UniWork सर्वर के साथ सेट अप नहीं है, इसलिए साइन इन उपलब्ध नहीं है। अपने व्यवस्थापक से कॉन्फ़िगर किया हुआ इंस्टॉलर माँगें।',
  acctKeyringShort: 'सुरक्षित स्टोरेज ज़रूरी है',
  acctKeyringTitle: 'सुरक्षित स्टोरेज उपलब्ध नहीं है',
  acctKeyringBody:
    'UniWork Office आपका साइन-इन आपके सिस्टम के सुरक्षित स्टोरेज (Keychain, Credential Manager या keyring) में रखता है। उसे अनलॉक या सेट अप करें, फिर ऐप को फिर से शुरू करें।',
  acctErrLaunch: 'साइन इन शुरू नहीं हो सका। कृपया फिर से प्रयास करें।',
  acctErrNetwork:
    'UniWork से कनेक्ट नहीं हो पा रहा। अपना इंटरनेट कनेक्शन या प्रॉक्सी सेटिंग जाँचें।',
  acctErrTimeout: 'UniWork ने जवाब देने में बहुत समय लिया। कृपया फिर से प्रयास करें।',
  acctErrLoginTimeout: 'साइन इन का समय समाप्त हो गया। कृपया फिर से प्रयास करें।',
  acctErrCancelled: 'साइन इन रद्द कर दिया गया।',
  acctErrInvalidCallback: 'साइन-इन का जवाब मान्य नहीं था। कृपया फिर से प्रयास करें।',
  acctErrStateMismatch:
    'यह साइन-इन लिंक मौजूदा प्रयास से मेल नहीं खाता। ऐप से साइन इन फिर से शुरू करें।',
  acctCallbackMismatch:
    'यह साइन-इन लिंक मेल नहीं खाता। इस ऐप द्वारा खोली गई ब्राउज़र विंडो में साइन इन पूरा करें।',
  acctErrAuthCodeInvalid:
    'साइन-इन कोड की समय-सीमा समाप्त हो गई है या वह पहले ही उपयोग हो चुका है। कृपया फिर से साइन इन करें।',
  acctErrRateLimited: 'बहुत ज़्यादा प्रयास हो चुके हैं। थोड़ी देर रुकें और फिर से प्रयास करें।',
  acctErrUnauthorized: 'आपका सत्र अब मान्य नहीं है। कृपया फिर से साइन इन करें।',
  acctErrDeviceRevoked: 'इस डिवाइस को साइन आउट कर दिया गया। कृपया फिर से साइन इन करें।',
  acctErrRefreshReused:
    'आपकी सुरक्षा के लिए यह सत्र समाप्त कर दिया गया। कृपया फिर से साइन इन करें।',
  acctErrWrongDeployment: 'यह खाता किसी दूसरे UniWork सर्वर का है।',
  acctErrNotConfigured: 'यह ऐप किसी UniWork सर्वर से नहीं जुड़ा है।',
  acctErrKeyringUnavailable: 'इस कंप्यूटर पर सुरक्षित स्टोरेज उपलब्ध नहीं है।',
  acctErrServerError: 'UniWork में कोई समस्या आई। कृपया बाद में फिर से प्रयास करें।',
  acctErrMalformedResponse: 'UniWork ने अप्रत्याशित जवाब भेजा। कृपया बाद में फिर से प्रयास करें।',
} satisfies Record<keyof typeof zh, string>

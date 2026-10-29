import type { zh } from './zh'

export const hi = {
  aiWebClose: 'बंद करें',
  aiWebStateCreditsTitle: 'AI क्रेडिट समाप्त',
  aiWebStateCreditsBody:
    'आपके संगठन ने इस अवधि के सभी UniWork AI क्रेडिट उपयोग कर लिए हैं। अपने व्यवस्थापक से संपर्क करें या नवीनीकरण की प्रतीक्षा करें।',
  aiWebStateEntitlementTitle: 'आपकी योजना में AI नहीं है',
  aiWebStateEntitlementBody:
    'आपके संगठन की UniWork योजना में यह AI सुविधा शामिल नहीं है। अपने व्यवस्थापक से संपर्क करें।',
  aiWebStateRateTitle: 'बहुत अधिक AI अनुरोध',
  aiWebStateRateBody: '{seconds} सेकंड रुकें और फिर कोशिश करें।',
  aiWebStateRateBodyNow: 'थोड़ा रुकें और फिर कोशिश करें।',
  aiWebStateUnreachableTitle: 'AI प्रदाता से संपर्क नहीं हो सका',
  aiWebStateUnreachableBody: 'UniWork AI प्रदाता तक नहीं पहुँच सका। थोड़ी देर में फिर कोशिश करें।',
  aiWebStateCloudTitle: 'क्लाउड टूल उपलब्ध नहीं',
  aiWebStateCloudBody: 'यह UniWork AI टूल अभी सर्वर पर सेट नहीं है।',
  aiWebStateOutageTitle: 'UniWork अस्थायी रूप से उपलब्ध नहीं',
  aiWebStateOutageBody: 'अभी UniWork तक नहीं पहुँचा जा सका। थोड़ी देर में फिर कोशिश करें।',
  aiWebStateSessionTitle: 'सत्र समाप्त',
  aiWebStateSessionBody: 'जारी रखने के लिए UniWork से दस्तावेज़ फिर से खोलें।',
  aiWebStateRefusedTitle: 'अनुरोध अस्वीकृत',
  aiWebStateRefusedBody: 'सर्वर ने AI अनुरोध अस्वीकार कर दिया।',
  aiWebStateUnknownTitle: 'AI अनुरोध विफल',
  aiWebStateUnknownBody: 'कुछ गलत हो गया। फिर कोशिश करें।',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'यह वर्कबुक वेब पर AI के लिए बहुत बड़ी है। इसे UniWork Office ऐप में खोलें।',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'अगले भाग के साथ जारी रखें।',
} satisfies Record<keyof typeof zh, string>

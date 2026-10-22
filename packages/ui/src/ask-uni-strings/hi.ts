import type { zh } from './zh'

export const hi = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI सोच रहा है…',
  askUniYou: 'आप',
  askUniUni: 'UNI',
  askUniSources: 'स्रोत',
  askUniKindDocument: 'दस्तावेज़',
  askUniKindTask: 'कार्य',
  askUniKindMeeting: 'मीटिंग',
  askUniKindChat: 'चैट',
  askUniKindMember: 'सदस्य',
  askUniKindOther: 'अन्य',
  askUniOpenDocument: 'दस्तावेज़ खोलें',
  askUniOpenBrowser: 'ब्राउज़र में खोलें',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed: 'यह स्रोत नहीं खुल सका। फिर से कोशिश करें या इसे वेब पर खोलें।',
  askUniErrForbidden: 'आपके पास इस डेटा तक पहुँच नहीं है।',
  askUniErrQuota: 'संगठन इस महीने का AI टोकन कोटा पूरा उपयोग कर चुका है।',
  askUniErrRateLimited: 'आप बहुत तेज़ी से पूछ रहे हैं; एक मिनट बाद फिर कोशिश करें।',
  askUniErrRateLimitedIn: 'आप बहुत तेज़ी से पूछ रहे हैं; {seconds} सेकंड बाद फिर कोशिश करें।',
  askUniErrDisabled: 'इस सर्वर पर AI कॉन्फ़िगर नहीं है।',
  askUniErrOffline: 'आप ऑफ़लाइन हैं। दस्तावेज़ खोजने के लिए "UNI से पूछें" को कनेक्शन चाहिए।',
  askUniErrSession:
    'आपका UniWork सत्र समाप्त हो गया है। पूछना जारी रखने के लिए फिर से साइन इन करें।',
  askUniErrDefault: 'अभी सवाल नहीं पूछा जा सका; बाद में फिर कोशिश करें।',
  askUniSignedOut:
    'अपने वर्कस्पेस के बारे में UNI से पूछने के लिए अपने UniWork खाते में साइन इन करें।',
  askUniNoticeNoSources:
    'इस वर्कस्पेस में आप जो देख सकते हैं, उसमें से अभी कुछ भी इस सवाल से मेल नहीं खाता।',
  askUniNoticeUnavailable: 'UNI इस सवाल का जवाब नहीं दे सका।',
  askUniStop: 'रोकें',
  askUniSend: 'भेजें',
  askUniCounter: '{used}/{max} अक्षर',
  askUniPlaceholder: 'अपने काम के बारे में UNI से पूछें…',
} satisfies Record<keyof typeof zh, string>

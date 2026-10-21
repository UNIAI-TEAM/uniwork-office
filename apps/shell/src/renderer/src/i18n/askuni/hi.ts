import type { zh } from './zh'

export const hi = {
  askUniModeGroup: 'मोड',
  askUniModeChat: 'सहायक',
  askUniModeAsk: 'UNI से पूछें',
  askUniTitle: 'UNI से पूछें',
  askUniDescription:
    'UNI केवल उस डेटा से जवाब देता है जो आप इस वर्कस्पेस में देख सकते हैं, और स्रोत भी बताता है।',
  askUniWorkspace: 'वर्कस्पेस',
  askUniEmptyTitle: 'आप टीम के काम के बारे में क्या जानना चाहते हैं?',
  askUniEmptyDescription:
    'UNI कार्य, मीटिंग, आपकी चैट और सदस्यों को पढ़ता है — जवाब हमेशा स्रोत के साथ आते हैं।',
  askUniPlaceholder: 'अपने काम के बारे में UNI से पूछें…',
  askUniSend: 'भेजें',
  askUniStop: 'रोकें',
  askUniStopped: 'रोक दिया गया। जवाब नहीं दिखाया जाएगा।',
  askUniThinking: 'UNI सोच रहा है…',
  askUniNewChat: 'नई चैट',
  askUniYou: 'आप',
  askUniUni: 'UNI',
  askUniSources: 'स्रोत',
  askUniKindDocument: 'दस्तावेज़',
  askUniKindTask: 'कार्य',
  askUniKindMeeting: 'मीटिंग',
  askUniKindChat: 'चैट',
  askUniKindMember: 'सदस्य',
  askUniOpenDocument: 'दस्तावेज़ खोलें',
  askUniOpenBrowser: 'ब्राउज़र में खोलें',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniCounter: '{used}/{max} अक्षर',
  askUniLoading: 'लोड हो रहा है…',
  askUniSignedOut:
    'अपने वर्कस्पेस के बारे में UNI से पूछने के लिए अपने UniWork खाते में साइन इन करें।',
  askUniNoWorkspace: 'आपके खाते में अभी पूछने लायक कोई वर्कस्पेस नहीं है।',
  askUniNoticeNoSources:
    'इस वर्कस्पेस में आप जो देख सकते हैं, उसमें से अभी कुछ भी इस सवाल से मेल नहीं खाता।',
  askUniNoticeUnavailable: 'UNI इस सवाल का जवाब नहीं दे सका।',
  askUniErrForbidden: 'आपके पास इस डेटा तक पहुँच नहीं है।',
  askUniErrQuota: 'संगठन इस महीने का AI टोकन कोटा पूरा उपयोग कर चुका है।',
  askUniErrRateLimited: 'आप बहुत तेज़ी से पूछ रहे हैं; एक मिनट बाद फिर कोशिश करें।',
  askUniErrRateLimitedIn: 'आप बहुत तेज़ी से पूछ रहे हैं; {seconds} सेकंड बाद फिर कोशिश करें।',
  askUniErrDisabled: 'इस सर्वर पर AI कॉन्फ़िगर नहीं है।',
  askUniErrOffline: 'आप ऑफ़लाइन हैं। दस्तावेज़ खोजने के लिए "UNI से पूछें" को कनेक्शन चाहिए।',
  askUniErrSession:
    'आपका UniWork सत्र समाप्त हो गया है। पूछना जारी रखने के लिए फिर से साइन इन करें।',
  askUniErrDefault: 'अभी सवाल नहीं पूछा जा सका; बाद में फिर कोशिश करें।',
} satisfies Record<keyof typeof zh, string>

import type { Lang } from '@genoffice/i18n'

/** Tooltips for the token-usage chips under assistant replies and on the composer
 * (all editors and the kb-ask panel share them; the chips themselves are numeric). */
export interface AiUsageLabels {
  /** per-reply chip tooltip */
  runTitle: string
  /** session-total chip tooltip */
  sessionTitle: string
<<<<<<< ours
  /** spoken noun after the input count ("1.2k input tokens"); the chip's arrows are not read */
  inputTokens: string
  /** spoken noun after the output count */
  outputTokens: string
=======
  /** tooltip suffix: share of the input served from the prompt cache ({pct}) */
  cacheHit: string
>>>>>>> theirs
}

export const AI_USAGE_LABELS: Record<Lang, AiUsageLabels> = {
  zh: {
    runTitle: '本回复 token 用量',
    sessionTitle: '本次会话累计用量',
<<<<<<< ours
    inputTokens: '输入 token',
    outputTokens: '输出 token',
=======
    cacheHit: '缓存命中 {pct}%',
>>>>>>> theirs
  },
  en: {
    runTitle: 'Token usage for this reply',
    sessionTitle: 'Session token usage',
<<<<<<< ours
    inputTokens: 'input tokens',
    outputTokens: 'output tokens',
=======
    cacheHit: '{pct}% from cache',
>>>>>>> theirs
  },
  ja: {
    runTitle: 'この回答のトークン使用量',
    sessionTitle: 'このセッションの累計',
<<<<<<< ours
    inputTokens: '入力トークン',
    outputTokens: '出力トークン',
=======
    cacheHit: 'キャッシュ利用 {pct}%',
>>>>>>> theirs
  },
  ko: {
    runTitle: '이 답변의 토큰 사용량',
    sessionTitle: '세션 누적 사용량',
<<<<<<< ours
    inputTokens: '입력 토큰',
    outputTokens: '출력 토큰',
=======
    cacheHit: '캐시 적중 {pct}%',
>>>>>>> theirs
  },
  fr: {
    runTitle: 'Tokens utilisés pour cette réponse',
    sessionTitle: 'Total de tokens de la session',
<<<<<<< ours
    inputTokens: "tokens d'entrée",
    outputTokens: 'tokens de sortie',
=======
    cacheHit: '{pct} % depuis le cache',
>>>>>>> theirs
  },
  de: {
    runTitle: 'Token-Verbrauch dieser Antwort',
    sessionTitle: 'Token-Verbrauch der Sitzung',
<<<<<<< ours
    inputTokens: 'Eingabe-Token',
    outputTokens: 'Ausgabe-Token',
=======
    cacheHit: '{pct} % aus dem Cache',
>>>>>>> theirs
  },
  es: {
    runTitle: 'Uso de tokens de esta respuesta',
    sessionTitle: 'Uso de tokens de la sesión',
<<<<<<< ours
    inputTokens: 'tokens de entrada',
    outputTokens: 'tokens de salida',
=======
    cacheHit: '{pct} % desde caché',
>>>>>>> theirs
  },
  th: {
    runTitle: 'การใช้โทเค็นของคำตอบนี้',
    sessionTitle: 'โทเค็นรวมของเซสชันนี้',
<<<<<<< ours
    inputTokens: 'โทเค็นอินพุต',
    outputTokens: 'โทเค็นเอาต์พุต',
=======
    cacheHit: 'จากแคช {pct}%',
>>>>>>> theirs
  },
  id: {
    runTitle: 'Penggunaan token balasan ini',
    sessionTitle: 'Penggunaan token sesi ini',
<<<<<<< ours
    inputTokens: 'token masukan',
    outputTokens: 'token keluaran',
=======
    cacheHit: '{pct}% dari cache',
>>>>>>> theirs
  },
  ru: {
    runTitle: 'Токены, использованные в этом ответе',
    sessionTitle: 'Токены за всю сессию',
<<<<<<< ours
    inputTokens: 'входные токены',
    outputTokens: 'выходные токены',
=======
    cacheHit: '{pct}% из кэша',
>>>>>>> theirs
  },
  ar: {
    runTitle: 'استخدام الرموز لهذه الإجابة',
    sessionTitle: 'إجمالي الرموز لهذه الجلسة',
<<<<<<< ours
    inputTokens: 'رموز الإدخال',
    outputTokens: 'رموز الإخراج',
=======
    cacheHit: '{pct}% من ذاكرة التخزين المؤقت',
>>>>>>> theirs
  },
  pt: {
    runTitle: 'Uso de tokens desta resposta',
    sessionTitle: 'Uso de tokens da sessão',
<<<<<<< ours
    inputTokens: 'tokens de entrada',
    outputTokens: 'tokens de saída',
=======
    cacheHit: '{pct}% do cache',
>>>>>>> theirs
  },
  it: {
    runTitle: 'Token usati per questa risposta',
    sessionTitle: 'Token usati nella sessione',
<<<<<<< ours
    inputTokens: 'token in ingresso',
    outputTokens: 'token in uscita',
=======
    cacheHit: '{pct}% dalla cache',
>>>>>>> theirs
  },
  pl: {
    runTitle: 'Tokeny użyte w tej odpowiedzi',
    sessionTitle: 'Tokeny użyte w tej sesji',
<<<<<<< ours
    inputTokens: 'tokeny wejściowe',
    outputTokens: 'tokeny wyjściowe',
=======
    cacheHit: '{pct}% z pamięci podręcznej',
>>>>>>> theirs
  },
  cs: {
    runTitle: 'Tokeny použité v této odpovědi',
    sessionTitle: 'Tokeny použité v této relaci',
<<<<<<< ours
    inputTokens: 'vstupní tokeny',
    outputTokens: 'výstupní tokeny',
=======
    cacheHit: '{pct} % z mezipaměti',
>>>>>>> theirs
  },
  nl: {
    runTitle: 'Tokengebruik van dit antwoord',
    sessionTitle: 'Tokengebruik van deze sessie',
<<<<<<< ours
    inputTokens: 'invoertokens',
    outputTokens: 'uitvoertokens',
=======
    cacheHit: '{pct}% uit cache',
>>>>>>> theirs
  },
  ms: {
    runTitle: 'Penggunaan token balasan ini',
    sessionTitle: 'Penggunaan token sesi ini',
<<<<<<< ours
    inputTokens: 'token input',
    outputTokens: 'token output',
=======
    cacheHit: '{pct}% daripada cache',
>>>>>>> theirs
  },
  he: {
    runTitle: 'צריכת אסימונים לתשובה זו',
    sessionTitle: 'צריכת אסימונים להפעלה זו',
<<<<<<< ours
    inputTokens: 'אסימוני קלט',
    outputTokens: 'אסימוני פלט',
=======
    cacheHit: '{pct}% מהמטמון',
>>>>>>> theirs
  },
  hi: {
    runTitle: 'इस उत्तर का टोकन उपयोग',
    sessionTitle: 'इस सत्र का कुल टोकन उपयोग',
<<<<<<< ours
    inputTokens: 'इनपुट टोकन',
    outputTokens: 'आउटपुट टोकन',
=======
    cacheHit: 'कैश से {pct}%',
>>>>>>> theirs
  },
  vi: {
    runTitle: 'Token dùng cho câu trả lời này',
    sessionTitle: 'Token dùng trong phiên này',
<<<<<<< ours
    inputTokens: 'token đầu vào',
    outputTokens: 'token đầu ra',
=======
    cacheHit: '{pct}% từ bộ nhớ đệm',
  },
  tr: {
    runTitle: 'Bu yanıtın token kullanımı',
    sessionTitle: 'Bu oturumun token kullanımı',
    cacheHit: '%{pct} önbellekten',
  },
  hu: {
    runTitle: 'A válasz tokenfelhasználása',
    sessionTitle: 'A munkamenet tokenfelhasználása',
    cacheHit: '{pct}% a gyorsítótárból',
>>>>>>> theirs
  },
  'zh-TW': {
    runTitle: '本回覆 token 用量',
    sessionTitle: '本次工作階段累計用量',
<<<<<<< ours
    inputTokens: '輸入 token',
    outputTokens: '輸出 token',
=======
    cacheHit: '快取命中 {pct}%',
>>>>>>> theirs
  },
}

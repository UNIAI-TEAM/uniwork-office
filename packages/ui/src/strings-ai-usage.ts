import type { Lang } from '@genoffice/i18n'

/** Tooltips for the token-usage chips under assistant replies and on the composer
 * (all editors and the kb-ask panel share them; the chips themselves are numeric). */
export interface AiUsageLabels {
  /** per-reply chip tooltip */
  runTitle: string
  /** session-total chip tooltip */
  sessionTitle: string
  /** spoken noun after the input count ("1.2k input tokens"); the chip's arrows are not read */
  inputTokens: string
  /** spoken noun after the output count */
  outputTokens: string
}

export const AI_USAGE_LABELS: Record<Lang, AiUsageLabels> = {
  zh: {
    runTitle: '本回复 token 用量',
    sessionTitle: '本次会话累计用量',
    inputTokens: '输入 token',
    outputTokens: '输出 token',
  },
  en: {
    runTitle: 'Token usage for this reply',
    sessionTitle: 'Session token usage',
    inputTokens: 'input tokens',
    outputTokens: 'output tokens',
  },
  ja: {
    runTitle: 'この回答のトークン使用量',
    sessionTitle: 'このセッションの累計',
    inputTokens: '入力トークン',
    outputTokens: '出力トークン',
  },
  ko: {
    runTitle: '이 답변의 토큰 사용량',
    sessionTitle: '세션 누적 사용량',
    inputTokens: '입력 토큰',
    outputTokens: '출력 토큰',
  },
  fr: {
    runTitle: 'Tokens utilisés pour cette réponse',
    sessionTitle: 'Total de tokens de la session',
    inputTokens: "tokens d'entrée",
    outputTokens: 'tokens de sortie',
  },
  de: {
    runTitle: 'Token-Verbrauch dieser Antwort',
    sessionTitle: 'Token-Verbrauch der Sitzung',
    inputTokens: 'Eingabe-Token',
    outputTokens: 'Ausgabe-Token',
  },
  es: {
    runTitle: 'Uso de tokens de esta respuesta',
    sessionTitle: 'Uso de tokens de la sesión',
    inputTokens: 'tokens de entrada',
    outputTokens: 'tokens de salida',
  },
  th: {
    runTitle: 'การใช้โทเค็นของคำตอบนี้',
    sessionTitle: 'โทเค็นรวมของเซสชันนี้',
    inputTokens: 'โทเค็นอินพุต',
    outputTokens: 'โทเค็นเอาต์พุต',
  },
  id: {
    runTitle: 'Penggunaan token balasan ini',
    sessionTitle: 'Penggunaan token sesi ini',
    inputTokens: 'token masukan',
    outputTokens: 'token keluaran',
  },
  ru: {
    runTitle: 'Токены, использованные в этом ответе',
    sessionTitle: 'Токены за всю сессию',
    inputTokens: 'входные токены',
    outputTokens: 'выходные токены',
  },
  ar: {
    runTitle: 'استخدام الرموز لهذه الإجابة',
    sessionTitle: 'إجمالي الرموز لهذه الجلسة',
    inputTokens: 'رموز الإدخال',
    outputTokens: 'رموز الإخراج',
  },
  pt: {
    runTitle: 'Uso de tokens desta resposta',
    sessionTitle: 'Uso de tokens da sessão',
    inputTokens: 'tokens de entrada',
    outputTokens: 'tokens de saída',
  },
  it: {
    runTitle: 'Token usati per questa risposta',
    sessionTitle: 'Token usati nella sessione',
    inputTokens: 'token in ingresso',
    outputTokens: 'token in uscita',
  },
  pl: {
    runTitle: 'Tokeny użyte w tej odpowiedzi',
    sessionTitle: 'Tokeny użyte w tej sesji',
    inputTokens: 'tokeny wejściowe',
    outputTokens: 'tokeny wyjściowe',
  },
  cs: {
    runTitle: 'Tokeny použité v této odpovědi',
    sessionTitle: 'Tokeny použité v této relaci',
    inputTokens: 'vstupní tokeny',
    outputTokens: 'výstupní tokeny',
  },
  nl: {
    runTitle: 'Tokengebruik van dit antwoord',
    sessionTitle: 'Tokengebruik van deze sessie',
    inputTokens: 'invoertokens',
    outputTokens: 'uitvoertokens',
  },
  ms: {
    runTitle: 'Penggunaan token balasan ini',
    sessionTitle: 'Penggunaan token sesi ini',
    inputTokens: 'token input',
    outputTokens: 'token output',
  },
  he: {
    runTitle: 'צריכת אסימונים לתשובה זו',
    sessionTitle: 'צריכת אסימונים להפעלה זו',
    inputTokens: 'אסימוני קלט',
    outputTokens: 'אסימוני פלט',
  },
  hi: {
    runTitle: 'इस उत्तर का टोकन उपयोग',
    sessionTitle: 'इस सत्र का कुल टोकन उपयोग',
    inputTokens: 'इनपुट टोकन',
    outputTokens: 'आउटपुट टोकन',
  },
  vi: {
    runTitle: 'Token dùng cho câu trả lời này',
    sessionTitle: 'Token dùng trong phiên này',
    inputTokens: 'token đầu vào',
    outputTokens: 'token đầu ra',
  },
  'zh-TW': {
    runTitle: '本回覆 token 用量',
    sessionTitle: '本次工作階段累計用量',
    inputTokens: '輸入 token',
    outputTokens: '輸出 token',
  },
}

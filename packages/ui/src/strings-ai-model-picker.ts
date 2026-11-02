import type { Lang } from '@genoffice/i18n'

export interface AiModelPickerStrings {
  /** chip tooltip / popover label */
  title: string
  /** composer hint while UniWork AI is not on here (send is off; the hint opens the account settings) */
  needModel: string
}

export const AI_MODEL_PICKER_STRINGS: Record<Lang, AiModelPickerStrings> = {
  zh: {
    title: '模型',
    needModel: 'UniWork AI 未对此格式或组织开启',
  },
  en: {
    title: 'Model',
    needModel: 'UniWork AI isn’t on for this format or organization',
  },
  ja: {
    title: 'モデル',
    needModel: 'この形式または組織では UniWork AI が有効になっていません',
  },
  ko: {
    title: '모델',
    needModel: '이 형식 또는 조직에서는 UniWork AI가 켜져 있지 않습니다',
  },
  fr: {
    title: 'Modèle',
    needModel: 'UniWork AI n’est pas activé pour ce format ou cette organisation',
  },
  de: {
    title: 'Modell',
    needModel: 'UniWork AI ist für dieses Format oder diese Organisation nicht aktiviert',
  },
  es: {
    title: 'Modelo',
    needModel: 'UniWork AI no está activado para este formato u organización',
  },
  th: {
    title: 'โมเดล',
    needModel: 'UniWork AI ยังไม่ได้เปิดสำหรับรูปแบบหรือองค์กรนี้',
  },
  id: {
    title: 'Model',
    needModel: 'UniWork AI belum aktif untuk format atau organisasi ini',
  },
  ru: {
    title: 'Модель',
    needModel: 'UniWork AI не включён для этого формата или организации',
  },
  ar: {
    title: 'النموذج',
    needModel: 'UniWork AI غير مفعّل لهذا التنسيق أو هذه المؤسسة',
  },
  pt: {
    title: 'Modelo',
    needModel: 'O UniWork AI não está ativado para este formato ou organização',
  },
  it: {
    title: 'Modello',
    needModel: 'UniWork AI non è attivo per questo formato o questa organizzazione',
  },
  pl: {
    title: 'Model',
    needModel: 'UniWork AI nie jest włączone dla tego formatu ani organizacji',
  },
  cs: {
    title: 'Model',
    needModel: 'UniWork AI není pro tento formát ani organizaci zapnuto',
  },
  nl: {
    title: 'Model',
    needModel: 'UniWork AI staat niet aan voor dit formaat of deze organisatie',
  },
  ms: {
    title: 'Model',
    needModel: 'UniWork AI belum diaktifkan untuk format atau organisasi ini',
  },
  he: {
    title: 'מודל',
    needModel: 'UniWork AI אינו מופעל עבור הפורמט או הארגון הזה',
  },
  hi: {
    title: 'मॉडल',
    needModel: 'इस फ़ॉर्मेट या संगठन के लिए UniWork AI चालू नहीं है',
  },
  'zh-TW': {
    title: '模型',
    needModel: 'UniWork AI 未對此格式或組織開啟',
  },
  vi: {
    title: 'Mô hình',
    needModel: 'UniWork AI chưa bật cho định dạng hoặc tổ chức này',
  },
}

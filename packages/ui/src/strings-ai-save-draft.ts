import type { Lang } from '@genoffice/i18n'

/**
 * Labels of the card the editors show under an AI answer when the run changed a document that was
 * never saved: nothing is written until the user says so. The question is the card's accessible
 * name; `saveAs` names the file the Save would offer.
 */
export interface AiSaveDraftLabels {
  question: string
  saveAs: (name: string) => string
  save: string
  later: string
}

export const AI_SAVE_DRAFT_LABELS: Record<Lang, AiSaveDraftLabels> = {
  zh: {
    question: '保存此文档？',
    saveAs: (name) => `另存为 ${name}`,
    save: '保存',
    later: '暂不',
  },
  en: {
    question: 'Save this document?',
    saveAs: (name) => `Save as ${name}`,
    save: 'Save',
    later: 'Not now',
  },
  ja: {
    question: 'このドキュメントを保存しますか？',
    saveAs: (name) => `${name} として保存`,
    save: '保存',
    later: 'あとで',
  },
  ko: {
    question: '이 문서를 저장할까요?',
    saveAs: (name) => `${name}(으)로 저장`,
    save: '저장',
    later: '나중에',
  },
  fr: {
    question: 'Enregistrer ce document ?',
    saveAs: (name) => `Enregistrer sous ${name}`,
    save: 'Enregistrer',
    later: 'Plus tard',
  },
  de: {
    question: 'Dieses Dokument speichern?',
    saveAs: (name) => `Speichern als ${name}`,
    save: 'Speichern',
    later: 'Später',
  },
  es: {
    question: '¿Guardar este documento?',
    saveAs: (name) => `Guardar como ${name}`,
    save: 'Guardar',
    later: 'Ahora no',
  },
  th: {
    question: 'บันทึกเอกสารนี้ไหม',
    saveAs: (name) => `บันทึกเป็น ${name}`,
    save: 'บันทึก',
    later: 'ไว้ทีหลัง',
  },
  id: {
    question: 'Simpan dokumen ini?',
    saveAs: (name) => `Simpan sebagai ${name}`,
    save: 'Simpan',
    later: 'Nanti saja',
  },
  ru: {
    question: 'Сохранить этот документ?',
    saveAs: (name) => `Сохранить как ${name}`,
    save: 'Сохранить',
    later: 'Не сейчас',
  },
  ar: {
    question: 'هل تريد حفظ هذا المستند؟',
    saveAs: (name) => `حفظ باسم ${name}`,
    save: 'حفظ',
    later: 'ليس الآن',
  },
  pt: {
    question: 'Salvar este documento?',
    saveAs: (name) => `Salvar como ${name}`,
    save: 'Salvar',
    later: 'Agora não',
  },
  it: {
    question: 'Salvare questo documento?',
    saveAs: (name) => `Salva come ${name}`,
    save: 'Salva',
    later: 'Non ora',
  },
  pl: {
    question: 'Zapisać ten dokument?',
    saveAs: (name) => `Zapisz jako ${name}`,
    save: 'Zapisz',
    later: 'Nie teraz',
  },
  cs: {
    question: 'Uložit tento dokument?',
    saveAs: (name) => `Uložit jako ${name}`,
    save: 'Uložit',
    later: 'Teď ne',
  },
  nl: {
    question: 'Dit document opslaan?',
    saveAs: (name) => `Opslaan als ${name}`,
    save: 'Opslaan',
    later: 'Niet nu',
  },
  ms: {
    question: 'Simpan dokumen ini?',
    saveAs: (name) => `Simpan sebagai ${name}`,
    save: 'Simpan',
    later: 'Bukan sekarang',
  },
  he: {
    question: 'לשמור את המסמך הזה?',
    saveAs: (name) => `שמירה בשם ${name}`,
    save: 'שמור',
    later: 'לא עכשיו',
  },
  hi: {
    question: 'क्या इस दस्तावेज़ को सहेजें?',
    saveAs: (name) => `${name} के नाम से सहेजें`,
    save: 'सहेजें',
    later: 'अभी नहीं',
  },
  'zh-TW': {
    question: '要儲存這份文件嗎？',
    saveAs: (name) => `另存為 ${name}`,
    save: '儲存',
    later: '稍後',
  },
  vi: {
    question: 'Lưu tài liệu này?',
    saveAs: (name) => `Lưu với tên ${name}`,
    save: 'Lưu',
    later: 'Để sau',
  },
}

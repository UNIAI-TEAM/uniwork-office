import type { Lang } from '@genoffice/i18n'

export interface AiModelPickerStrings {
  /** chip tooltip / list heading */
  title: string
  /** chip text while no provider is usable yet */
  choose: string
  /** last row: jump to Settings › AI Model */
  manage: string
  /** composer hint while a key is stored but no model is known (send is off until one is picked) */
  needModel: string
}

export const AI_MODEL_PICKER_STRINGS: Record<Lang, AiModelPickerStrings> = {
  zh: { title: '模型', choose: '选择模型', manage: '管理模型…', needModel: '请先选择模型再发送' },
  en: {
    title: 'Model',
    choose: 'Choose model',
    manage: 'Manage models…',
    needModel: 'Choose a model to send',
  },
  ja: {
    title: 'モデル',
    choose: 'モデルを選択',
    manage: 'モデルを管理…',
    needModel: '送信するにはモデルを選択してください',
  },
  ko: {
    title: '모델',
    choose: '모델 선택',
    manage: '모델 관리…',
    needModel: '보내려면 모델을 선택하세요',
  },
  fr: {
    title: 'Modèle',
    choose: 'Choisir un modèle',
    manage: 'Gérer les modèles…',
    needModel: 'Choisissez un modèle pour envoyer',
  },
  de: {
    title: 'Modell',
    choose: 'Modell wählen',
    manage: 'Modelle verwalten…',
    needModel: 'Zum Senden ein Modell auswählen',
  },
  es: {
    title: 'Modelo',
    choose: 'Elegir modelo',
    manage: 'Gestionar modelos…',
    needModel: 'Elige un modelo para enviar',
  },
  th: {
    title: 'โมเดล',
    choose: 'เลือกโมเดล',
    manage: 'จัดการโมเดล…',
    needModel: 'เลือกโมเดลก่อนส่ง',
  },
  id: {
    title: 'Model',
    choose: 'Pilih model',
    manage: 'Kelola model…',
    needModel: 'Pilih model untuk mengirim',
  },
  ru: {
    title: 'Модель',
    choose: 'Выбрать модель',
    manage: 'Управление моделями…',
    needModel: 'Выберите модель, чтобы отправить',
  },
  ar: {
    title: 'النموذج',
    choose: 'اختيار النموذج',
    manage: 'إدارة النماذج…',
    needModel: 'اختر نموذجًا للإرسال',
  },
  pt: {
    title: 'Modelo',
    choose: 'Escolher modelo',
    manage: 'Gerenciar modelos…',
    needModel: 'Escolha um modelo para enviar',
  },
  it: {
    title: 'Modello',
    choose: 'Scegli modello',
    manage: 'Gestisci modelli…',
    needModel: 'Scegli un modello per inviare',
  },
  pl: {
    title: 'Model',
    choose: 'Wybierz model',
    manage: 'Zarządzaj modelami…',
    needModel: 'Wybierz model, aby wysłać',
  },
  cs: {
    title: 'Model',
    choose: 'Vybrat model',
    manage: 'Spravovat modely…',
    needModel: 'Pro odeslání vyberte model',
  },
  nl: {
    title: 'Model',
    choose: 'Model kiezen',
    manage: 'Modellen beheren…',
    needModel: 'Kies een model om te versturen',
  },
  ms: {
    title: 'Model',
    choose: 'Pilih model',
    manage: 'Urus model…',
    needModel: 'Pilih model untuk menghantar',
  },
  he: {
    title: 'מודל',
    choose: 'בחירת מודל',
    manage: 'ניהול מודלים…',
    needModel: 'בחרו מודל כדי לשלוח',
  },
  hi: {
    title: 'मॉडल',
    choose: 'मॉडल चुनें',
    manage: 'मॉडल प्रबंधित करें…',
    needModel: 'भेजने के लिए मॉडल चुनें',
  },
  'zh-TW': {
    title: '模型',
    choose: '選擇模型',
    manage: '管理模型…',
    needModel: '請先選擇模型再傳送',
  },
  vi: {
    title: 'Mô hình',
    choose: 'Chọn mô hình',
    manage: 'Quản lý mô hình…',
    needModel: 'Chọn mô hình để gửi',
  },
}

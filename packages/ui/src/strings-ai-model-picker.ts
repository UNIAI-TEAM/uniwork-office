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
  /** composer hint while no key is stored (send is off until one is added in the AI settings) */
  needKey: string
}

export const AI_MODEL_PICKER_STRINGS: Record<Lang, AiModelPickerStrings> = {
  zh: {
    title: '模型',
    choose: '选择模型',
    manage: '管理模型…',
    needModel: '请先选择模型再发送',
    needKey: '请在 AI 设置中添加 API 密钥后再使用助手。',
  },
  en: {
    title: 'Model',
    choose: 'Choose model',
    manage: 'Manage models…',
    needModel: 'Choose a model to send',
    needKey: 'Add an API key in AI settings to use the assistant.',
  },
  ja: {
    title: 'モデル',
    choose: 'モデルを選択',
    manage: 'モデルを管理…',
    needModel: '送信するにはモデルを選択してください',
    needKey: 'アシスタントを使うには、AI 設定で API キーを追加してください。',
  },
  ko: {
    title: '모델',
    choose: '모델 선택',
    manage: '모델 관리…',
    needModel: '보내려면 모델을 선택하세요',
    needKey: '어시스턴트를 사용하려면 AI 설정에서 API 키를 추가하세요.',
  },
  fr: {
    title: 'Modèle',
    choose: 'Choisir un modèle',
    manage: 'Gérer les modèles…',
    needModel: 'Choisissez un modèle pour envoyer',
    needKey: 'Ajoutez une clé API dans les paramètres IA pour utiliser l’assistant.',
  },
  de: {
    title: 'Modell',
    choose: 'Modell wählen',
    manage: 'Modelle verwalten…',
    needModel: 'Zum Senden ein Modell auswählen',
    needKey:
      'Fügen Sie in den KI-Einstellungen einen API-Schlüssel hinzu, um den Assistenten zu nutzen.',
  },
  es: {
    title: 'Modelo',
    choose: 'Elegir modelo',
    manage: 'Gestionar modelos…',
    needModel: 'Elige un modelo para enviar',
    needKey: 'Añade una clave de API en los ajustes de IA para usar el asistente.',
  },
  th: {
    title: 'โมเดล',
    choose: 'เลือกโมเดล',
    manage: 'จัดการโมเดล…',
    needModel: 'เลือกโมเดลก่อนส่ง',
    needKey: 'เพิ่มคีย์ API ในการตั้งค่า AI เพื่อใช้ผู้ช่วย',
  },
  id: {
    title: 'Model',
    choose: 'Pilih model',
    manage: 'Kelola model…',
    needModel: 'Pilih model untuk mengirim',
    needKey: 'Tambahkan kunci API di pengaturan AI untuk memakai asisten.',
  },
  ru: {
    title: 'Модель',
    choose: 'Выбрать модель',
    manage: 'Управление моделями…',
    needModel: 'Выберите модель, чтобы отправить',
    needKey: 'Добавьте ключ API в настройках ИИ, чтобы пользоваться помощником.',
  },
  ar: {
    title: 'النموذج',
    choose: 'اختيار النموذج',
    manage: 'إدارة النماذج…',
    needModel: 'اختر نموذجًا للإرسال',
    needKey: 'أضف مفتاح API في إعدادات الذكاء الاصطناعي لاستخدام المساعد.',
  },
  pt: {
    title: 'Modelo',
    choose: 'Escolher modelo',
    manage: 'Gerenciar modelos…',
    needModel: 'Escolha um modelo para enviar',
    needKey: 'Adicione uma chave de API nas configurações de IA para usar o assistente.',
  },
  it: {
    title: 'Modello',
    choose: 'Scegli modello',
    manage: 'Gestisci modelli…',
    needModel: 'Scegli un modello per inviare',
    needKey: 'Aggiungi una chiave API nelle impostazioni IA per usare l’assistente.',
  },
  pl: {
    title: 'Model',
    choose: 'Wybierz model',
    manage: 'Zarządzaj modelami…',
    needModel: 'Wybierz model, aby wysłać',
    needKey: 'Dodaj klucz API w ustawieniach AI, aby korzystać z asystenta.',
  },
  cs: {
    title: 'Model',
    choose: 'Vybrat model',
    manage: 'Spravovat modely…',
    needModel: 'Pro odeslání vyberte model',
    needKey: 'Pro použití asistenta přidejte v nastavení AI klíč API.',
  },
  nl: {
    title: 'Model',
    choose: 'Model kiezen',
    manage: 'Modellen beheren…',
    needModel: 'Kies een model om te versturen',
    needKey: 'Voeg een API-sleutel toe in de AI-instellingen om de assistent te gebruiken.',
  },
  ms: {
    title: 'Model',
    choose: 'Pilih model',
    manage: 'Urus model…',
    needModel: 'Pilih model untuk menghantar',
    needKey: 'Tambah kunci API dalam tetapan AI untuk menggunakan pembantu.',
  },
  he: {
    title: 'מודל',
    choose: 'בחירת מודל',
    manage: 'ניהול מודלים…',
    needModel: 'בחרו מודל כדי לשלוח',
    needKey: 'הוסף מפתח API בהגדרות ה-AI כדי להשתמש בעוזר.',
  },
  hi: {
    title: 'मॉडल',
    choose: 'मॉडल चुनें',
    manage: 'मॉडल प्रबंधित करें…',
    needModel: 'भेजने के लिए मॉडल चुनें',
    needKey: 'सहायक का उपयोग करने के लिए AI सेटिंग में API कुंजी जोड़ें।',
  },
  'zh-TW': {
    title: '模型',
    choose: '選擇模型',
    manage: '管理模型…',
    needModel: '請先選擇模型再傳送',
    needKey: '請在 AI 設定中新增 API 金鑰後再使用助理。',
  },
  vi: {
    title: 'Mô hình',
    choose: 'Chọn mô hình',
    manage: 'Quản lý mô hình…',
    needModel: 'Chọn mô hình để gửi',
    needKey: 'Thêm khóa API trong Cài đặt AI để dùng trợ lý.',
  },
}

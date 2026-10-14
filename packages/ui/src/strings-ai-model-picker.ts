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
  /** composer hint while a custom endpoint has a model but no server URL (its API key is optional) */
  needBaseUrl: string
  /** quiet note in a group while its live model list is still loading (the suggested list shows meanwhile) */
  modelsLoading: string
  /** quiet note in a group whose live model list could not be loaded (the suggested list shows instead) */
  modelsUnavailable: string
  /** quiet tag on a group/row whose requests use the key saved on UniWork */
  orgKeyTag: string
  /** tooltip and first-use privacy note for a group served by a key saved on UniWork */
  orgKeyNote: string
  /** Settings link to manage keys saved on UniWork in the web app */
  orgKeyManage: string
}

export const AI_MODEL_PICKER_STRINGS: Record<Lang, AiModelPickerStrings> = {
  zh: {
    title: '模型',
    choose: '选择模型',
    manage: '管理模型…',
    needModel: '请先选择模型再发送',
    needKey: '请在 AI 设置中添加 API 密钥后再使用助手。',
    needBaseUrl: '请在 AI 设置中添加服务器地址后再使用助手。',
    modelsLoading: '正在加载模型列表…',
    modelsUnavailable: '无法加载模型列表，已显示推荐列表',
    orgKeyTag: 'UniWork 上的密钥',
    orgKeyNote:
      '通过组织的 UniWork 服务器并使用你在 UniWork 上保存的密钥发送。UniWork 仅记录用量，不保存内容。',
    orgKeyManage: '在 UniWork（网页版）管理密钥',
  },
  en: {
    title: 'Model',
    choose: 'Choose model',
    manage: 'Manage models…',
    needModel: 'Choose a model to send',
    needKey: 'Add an API key in AI settings to use the assistant.',
    needBaseUrl: 'Add the server URL in AI settings to use the assistant.',
    modelsLoading: 'Loading models…',
    modelsUnavailable: "Couldn't load the model list; showing suggestions",
    orgKeyTag: 'Key on UniWork',
    orgKeyNote:
      "Sent through your organization's UniWork server with the key you saved on UniWork. UniWork records usage only and does not store the content.",
    orgKeyManage: 'Manage keys on UniWork (web)',
  },
  ja: {
    title: 'モデル',
    choose: 'モデルを選択',
    manage: 'モデルを管理…',
    needModel: '送信するにはモデルを選択してください',
    needKey: 'アシスタントを使うには、AI 設定で API キーを追加してください。',
    needBaseUrl: 'アシスタントを使うには、AI 設定でサーバー URL を追加してください。',
    modelsLoading: 'モデル一覧を読み込み中…',
    modelsUnavailable: 'モデル一覧を読み込めなかったため、候補を表示しています',
    orgKeyTag: 'UniWork のキー',
    orgKeyNote:
      'UniWork に保存したキーを使い、組織の UniWork サーバー経由で送信されます。UniWork は利用量のみを記録し、内容は保存しません。',
    orgKeyManage: 'UniWork（Web）でキーを管理',
  },
  ko: {
    title: '모델',
    choose: '모델 선택',
    manage: '모델 관리…',
    needModel: '보내려면 모델을 선택하세요',
    needKey: '어시스턴트를 사용하려면 AI 설정에서 API 키를 추가하세요.',
    needBaseUrl: '어시스턴트를 사용하려면 AI 설정에서 서버 URL을 추가하세요.',
    modelsLoading: '모델 목록을 불러오는 중…',
    modelsUnavailable: '모델 목록을 불러오지 못해 추천 목록을 표시합니다',
    orgKeyTag: 'UniWork에 저장된 키',
    orgKeyNote:
      'UniWork에 저장한 키로 조직의 UniWork 서버를 통해 전송됩니다. UniWork는 사용량만 기록하며 내용은 저장하지 않습니다.',
    orgKeyManage: 'UniWork(웹)에서 키 관리',
  },
  fr: {
    title: 'Modèle',
    choose: 'Choisir un modèle',
    manage: 'Gérer les modèles…',
    needModel: 'Choisissez un modèle pour envoyer',
    needKey: 'Ajoutez une clé API dans les paramètres IA pour utiliser l’assistant.',
    needBaseUrl: 'Ajoutez l’URL du serveur dans les paramètres IA pour utiliser l’assistant.',
    modelsLoading: 'Chargement des modèles…',
    modelsUnavailable: 'Impossible de charger la liste des modèles ; suggestions affichées',
    orgKeyTag: 'Clé sur UniWork',
    orgKeyNote:
      'Envoyé via le serveur UniWork de votre organisation avec la clé enregistrée sur UniWork. UniWork n’enregistre que l’utilisation et ne stocke pas le contenu.',
    orgKeyManage: 'Gérer les clés sur UniWork (web)',
  },
  de: {
    title: 'Modell',
    choose: 'Modell wählen',
    manage: 'Modelle verwalten…',
    needModel: 'Zum Senden ein Modell auswählen',
    needKey:
      'Fügen Sie in den KI-Einstellungen einen API-Schlüssel hinzu, um den Assistenten zu nutzen.',
    needBaseUrl:
      'Fügen Sie in den KI-Einstellungen die Server-URL hinzu, um den Assistenten zu nutzen.',
    modelsLoading: 'Modelle werden geladen…',
    modelsUnavailable: 'Modellliste konnte nicht geladen werden; Vorschläge werden angezeigt',
    orgKeyTag: 'Schlüssel auf UniWork',
    orgKeyNote:
      'Wird über den UniWork-Server Ihrer Organisation mit dem auf UniWork gespeicherten Schlüssel gesendet. UniWork erfasst nur die Nutzung und speichert keine Inhalte.',
    orgKeyManage: 'Schlüssel auf UniWork verwalten (Web)',
  },
  es: {
    title: 'Modelo',
    choose: 'Elegir modelo',
    manage: 'Gestionar modelos…',
    needModel: 'Elige un modelo para enviar',
    needKey: 'Añade una clave de API en los ajustes de IA para usar el asistente.',
    needBaseUrl: 'Añade la URL del servidor en los ajustes de IA para usar el asistente.',
    modelsLoading: 'Cargando modelos…',
    modelsUnavailable: 'No se pudo cargar la lista de modelos; se muestran sugerencias',
    orgKeyTag: 'Clave en UniWork',
    orgKeyNote:
      'Se envía a través del servidor UniWork de tu organización con la clave que guardaste en UniWork. UniWork solo registra el uso y no almacena el contenido.',
    orgKeyManage: 'Gestionar claves en UniWork (web)',
  },
  th: {
    title: 'โมเดล',
    choose: 'เลือกโมเดล',
    manage: 'จัดการโมเดล…',
    needModel: 'เลือกโมเดลก่อนส่ง',
    needKey: 'เพิ่มคีย์ API ในการตั้งค่า AI เพื่อใช้ผู้ช่วย',
    needBaseUrl: 'เพิ่ม URL ของเซิร์ฟเวอร์ในการตั้งค่า AI เพื่อใช้ผู้ช่วย',
    modelsLoading: 'กำลังโหลดรายการโมเดล…',
    modelsUnavailable: 'โหลดรายการโมเดลไม่ได้ จึงแสดงรายการแนะนำ',
    orgKeyTag: 'คีย์บน UniWork',
    orgKeyNote:
      'ส่งผ่านเซิร์ฟเวอร์ UniWork ขององค์กรด้วยคีย์ที่คุณบันทึกไว้บน UniWork โดย UniWork จะบันทึกเฉพาะข้อมูลการใช้งานและไม่เก็บเนื้อหา',
    orgKeyManage: 'จัดการคีย์บน UniWork (เว็บ)',
  },
  id: {
    title: 'Model',
    choose: 'Pilih model',
    manage: 'Kelola model…',
    needModel: 'Pilih model untuk mengirim',
    needKey: 'Tambahkan kunci API di pengaturan AI untuk memakai asisten.',
    needBaseUrl: 'Tambahkan URL server di pengaturan AI untuk memakai asisten.',
    modelsLoading: 'Memuat model…',
    modelsUnavailable: 'Daftar model tidak dapat dimuat; menampilkan saran',
    orgKeyTag: 'Kunci di UniWork',
    orgKeyNote:
      'Dikirim melalui server UniWork organisasi Anda dengan kunci yang Anda simpan di UniWork. UniWork hanya mencatat penggunaan dan tidak menyimpan konten.',
    orgKeyManage: 'Kelola kunci di UniWork (web)',
  },
  ru: {
    title: 'Модель',
    choose: 'Выбрать модель',
    manage: 'Управление моделями…',
    needModel: 'Выберите модель, чтобы отправить',
    needKey: 'Добавьте ключ API в настройках ИИ, чтобы пользоваться помощником.',
    needBaseUrl: 'Добавьте URL сервера в настройках ИИ, чтобы пользоваться помощником.',
    modelsLoading: 'Загрузка списка моделей…',
    modelsUnavailable: 'Не удалось загрузить список моделей; показаны рекомендации',
    orgKeyTag: 'Ключ в UniWork',
    orgKeyNote:
      'Отправляется через сервер UniWork вашей организации с ключом, сохранённым в UniWork. UniWork учитывает только использование и не хранит содержимое.',
    orgKeyManage: 'Управление ключами в UniWork (веб)',
  },
  ar: {
    title: 'النموذج',
    choose: 'اختيار النموذج',
    manage: 'إدارة النماذج…',
    needModel: 'اختر نموذجًا للإرسال',
    needKey: 'أضف مفتاح API في إعدادات الذكاء الاصطناعي لاستخدام المساعد.',
    needBaseUrl: 'أضف عنوان URL للخادم في إعدادات الذكاء الاصطناعي لاستخدام المساعد.',
    modelsLoading: 'جارٍ تحميل النماذج…',
    modelsUnavailable: 'تعذّر تحميل قائمة النماذج؛ تُعرض الاقتراحات',
    orgKeyTag: 'مفتاح على UniWork',
    orgKeyNote:
      'يُرسل عبر خادم UniWork الخاص بمؤسستك باستخدام المفتاح الذي حفظته على UniWork. يسجّل UniWork الاستخدام فقط ولا يخزّن المحتوى.',
    orgKeyManage: 'إدارة المفاتيح على UniWork (الويب)',
  },
  pt: {
    title: 'Modelo',
    choose: 'Escolher modelo',
    manage: 'Gerenciar modelos…',
    needModel: 'Escolha um modelo para enviar',
    needKey: 'Adicione uma chave de API nas configurações de IA para usar o assistente.',
    needBaseUrl: 'Adicione o URL do servidor nas configurações de IA para usar o assistente.',
    modelsLoading: 'Carregando modelos…',
    modelsUnavailable: 'Não foi possível carregar a lista de modelos; mostrando sugestões',
    orgKeyTag: 'Chave no UniWork',
    orgKeyNote:
      'Enviado pelo servidor UniWork da sua organização com a chave que você salvou no UniWork. O UniWork registra apenas o uso e não armazena o conteúdo.',
    orgKeyManage: 'Gerenciar chaves no UniWork (web)',
  },
  it: {
    title: 'Modello',
    choose: 'Scegli modello',
    manage: 'Gestisci modelli…',
    needModel: 'Scegli un modello per inviare',
    needKey: 'Aggiungi una chiave API nelle impostazioni IA per usare l’assistente.',
    needBaseUrl: 'Aggiungi l’URL del server nelle impostazioni IA per usare l’assistente.',
    modelsLoading: 'Caricamento dei modelli…',
    modelsUnavailable: 'Impossibile caricare l’elenco dei modelli; vengono mostrati i suggerimenti',
    orgKeyTag: 'Chiave su UniWork',
    orgKeyNote:
      'Inviato tramite il server UniWork della tua organizzazione con la chiave salvata su UniWork. UniWork registra solo l’utilizzo e non memorizza il contenuto.',
    orgKeyManage: 'Gestisci chiavi su UniWork (web)',
  },
  pl: {
    title: 'Model',
    choose: 'Wybierz model',
    manage: 'Zarządzaj modelami…',
    needModel: 'Wybierz model, aby wysłać',
    needKey: 'Dodaj klucz API w ustawieniach AI, aby korzystać z asystenta.',
    needBaseUrl: 'Dodaj adres URL serwera w ustawieniach AI, aby korzystać z asystenta.',
    modelsLoading: 'Ładowanie modeli…',
    modelsUnavailable: 'Nie udało się wczytać listy modeli; wyświetlane są sugestie',
    orgKeyTag: 'Klucz w UniWork',
    orgKeyNote:
      'Wysyłane przez serwer UniWork Twojej organizacji przy użyciu klucza zapisanego w UniWork. UniWork rejestruje wyłącznie użycie i nie przechowuje treści.',
    orgKeyManage: 'Zarządzaj kluczami w UniWork (WWW)',
  },
  cs: {
    title: 'Model',
    choose: 'Vybrat model',
    manage: 'Spravovat modely…',
    needModel: 'Pro odeslání vyberte model',
    needKey: 'Pro použití asistenta přidejte v nastavení AI klíč API.',
    needBaseUrl: 'Pro použití asistenta přidejte v nastavení AI adresu URL serveru.',
    modelsLoading: 'Načítání modelů…',
    modelsUnavailable: 'Seznam modelů se nepodařilo načíst; zobrazují se návrhy',
    orgKeyTag: 'Klíč na UniWork',
    orgKeyNote:
      'Odesíláno přes server UniWork vaší organizace s klíčem uloženým na UniWork. UniWork zaznamenává pouze využití a neukládá obsah.',
    orgKeyManage: 'Spravovat klíče na UniWork (web)',
  },
  nl: {
    title: 'Model',
    choose: 'Model kiezen',
    manage: 'Modellen beheren…',
    needModel: 'Kies een model om te versturen',
    needKey: 'Voeg een API-sleutel toe in de AI-instellingen om de assistent te gebruiken.',
    needBaseUrl: 'Voeg de server-URL toe in de AI-instellingen om de assistent te gebruiken.',
    modelsLoading: 'Modellen laden…',
    modelsUnavailable: 'Modellenlijst kon niet worden geladen; suggesties worden getoond',
    orgKeyTag: 'Sleutel op UniWork',
    orgKeyNote:
      'Verzonden via de UniWork-server van uw organisatie met de sleutel die u op UniWork hebt opgeslagen. UniWork registreert alleen het gebruik en slaat de inhoud niet op.',
    orgKeyManage: 'Sleutels beheren op UniWork (web)',
  },
  ms: {
    title: 'Model',
    choose: 'Pilih model',
    manage: 'Urus model…',
    needModel: 'Pilih model untuk menghantar',
    needKey: 'Tambah kunci API dalam tetapan AI untuk menggunakan pembantu.',
    needBaseUrl: 'Tambah URL pelayan dalam tetapan AI untuk menggunakan pembantu.',
    modelsLoading: 'Memuatkan model…',
    modelsUnavailable: 'Senarai model tidak dapat dimuatkan; menunjukkan cadangan',
    orgKeyTag: 'Kunci pada UniWork',
    orgKeyNote:
      'Dihantar melalui pelayan UniWork organisasi anda dengan kunci yang anda simpan pada UniWork. UniWork hanya merekodkan penggunaan dan tidak menyimpan kandungan.',
    orgKeyManage: 'Urus kunci pada UniWork (web)',
  },
  he: {
    title: 'מודל',
    choose: 'בחירת מודל',
    manage: 'ניהול מודלים…',
    needModel: 'בחרו מודל כדי לשלוח',
    needKey: 'הוסף מפתח API בהגדרות ה-AI כדי להשתמש בעוזר.',
    needBaseUrl: 'הוסף את כתובת ה-URL של השרת בהגדרות ה-AI כדי להשתמש בעוזר.',
    modelsLoading: 'טוען מודלים…',
    modelsUnavailable: 'לא ניתן לטעון את רשימת המודלים; מוצגות הצעות',
    orgKeyTag: 'מפתח ב-UniWork',
    orgKeyNote:
      'נשלח דרך שרת UniWork של הארגון שלך עם המפתח ששמרת ב-UniWork. מערכת UniWork מתעדת שימוש בלבד ואינה שומרת את התוכן.',
    orgKeyManage: 'ניהול מפתחות ב-UniWork (אינטרנט)',
  },
  hi: {
    title: 'मॉडल',
    choose: 'मॉडल चुनें',
    manage: 'मॉडल प्रबंधित करें…',
    needModel: 'भेजने के लिए मॉडल चुनें',
    needKey: 'सहायक का उपयोग करने के लिए AI सेटिंग में API कुंजी जोड़ें।',
    needBaseUrl: 'सहायक का उपयोग करने के लिए AI सेटिंग में सर्वर URL जोड़ें।',
    modelsLoading: 'मॉडल लोड हो रहे हैं…',
    modelsUnavailable: 'मॉडल सूची लोड नहीं हो सकी; सुझाव दिखाए जा रहे हैं',
    orgKeyTag: 'UniWork पर कुंजी',
    orgKeyNote:
      'UniWork पर सहेजी गई कुंजी के साथ आपके संगठन के UniWork सर्वर के माध्यम से भेजा जाता है। UniWork केवल उपयोग रिकॉर्ड करता है और सामग्री संग्रहीत नहीं करता।',
    orgKeyManage: 'UniWork (वेब) पर कुंजियाँ प्रबंधित करें',
  },
  'zh-TW': {
    title: '模型',
    choose: '選擇模型',
    manage: '管理模型…',
    needModel: '請先選擇模型再傳送',
    needKey: '請在 AI 設定中新增 API 金鑰後再使用助理。',
    needBaseUrl: '請在 AI 設定中新增伺服器網址後再使用助理。',
    modelsLoading: '正在載入模型清單…',
    modelsUnavailable: '無法載入模型清單，已顯示建議清單',
    orgKeyTag: 'UniWork 上的金鑰',
    orgKeyNote:
      '透過組織的 UniWork 伺服器並使用你在 UniWork 上儲存的金鑰傳送。UniWork 僅記錄用量，不儲存內容。',
    orgKeyManage: '在 UniWork（網頁版）管理金鑰',
  },
  vi: {
    title: 'Mô hình',
    choose: 'Chọn mô hình',
    manage: 'Quản lý mô hình…',
    needModel: 'Chọn mô hình để gửi',
    needKey: 'Thêm khóa API trong Cài đặt AI để dùng trợ lý.',
    needBaseUrl: 'Thêm URL máy chủ trong Cài đặt AI để dùng trợ lý.',
    modelsLoading: 'Đang tải danh sách mô hình…',
    modelsUnavailable: 'Không tải được danh sách mô hình, đang hiện danh sách gợi ý',
    orgKeyTag: 'Khóa trên UniWork',
    orgKeyNote:
      'Gửi qua máy chủ UniWork của tổ chức bằng khóa bạn đã lưu trên UniWork. UniWork chỉ ghi số liệu sử dụng, không lưu nội dung.',
    orgKeyManage: 'Quản lý khóa trên UniWork (web)',
  },
}

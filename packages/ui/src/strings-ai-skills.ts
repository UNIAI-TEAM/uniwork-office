import type { Lang } from '@genoffice/i18n'

/** Labels for the composer "+" menu (add file / skills) and the attached-skill chips. */
export interface AiSkillsLabels {
  /** the "+" button tooltip */
  addTitle: string
  addFile: string
  skills: string
  searchPlaceholder: string
  /** list body when nothing is installed */
  noSkills: string
  /** list body when the search matches nothing */
  noMatch: string
  /** bottom row: jump to Settings › Skills */
  manage: string
  back: string
  removeTitle: string
  /** read-only chip row on a sent bubble */
  attachedTitle: string
  /** shown in the menu when 3 skills are already selected */
  maxSkillsHint: string
  /** shown above the composer when attached skills + prompt exceed UniWork AI's 8,000-rune limit */
  uniworkTooLongNotice: string
}

export const AI_SKILLS_LABELS: Record<Lang, AiSkillsLabels> = {
  zh: {
    addTitle: '添加',
    addFile: '添加文件',
    skills: '技能',
    searchPlaceholder: '搜索技能',
    noSkills: '还没有安装技能',
    noMatch: '没有匹配的技能',
    manage: '管理技能',
    back: '返回',
    removeTitle: '移除技能',
    attachedTitle: '本条消息附带的技能',
    maxSkillsHint: '每条消息最多附加 3 个技能',
    uniworkTooLongNotice:
      '附带的技能对于 UniWork AI 来说过长（超过 8,000 个字符）。请移除一个技能，或使用您自己的 API 密钥。',
  },
  en: {
    addTitle: 'Add',
    addFile: 'Add file',
    skills: 'Skills',
    searchPlaceholder: 'Search skills',
    noSkills: 'No skills installed yet',
    noMatch: 'No matching skills',
    manage: 'Manage skills',
    back: 'Back',
    removeTitle: 'Remove skill',
    attachedTitle: 'Skills attached to this message',
    maxSkillsHint: 'Up to 3 skills per message',
    uniworkTooLongNotice:
      'The attached skills are too long for UniWork AI (over 8,000 characters). Remove a skill or use your own API key.',
  },
  ja: {
    addTitle: '追加',
    addFile: 'ファイルを追加',
    skills: 'スキル',
    searchPlaceholder: 'スキルを検索',
    noSkills: 'スキルはまだインストールされていません',
    noMatch: '一致するスキルがありません',
    manage: 'スキルを管理',
    back: '戻る',
    removeTitle: 'スキルを外す',
    attachedTitle: 'このメッセージに添付したスキル',
    maxSkillsHint: '1件のメッセージに最大3つのスキルを添付できます',
    uniworkTooLongNotice:
      '添付されたスキルが UniWork AI の上限（8,000文字）を超えています。スキルを外すか、ご自身の API キーをご使用ください。',
  },
  ko: {
    addTitle: '추가',
    addFile: '파일 추가',
    skills: '스킬',
    searchPlaceholder: '스킬 검색',
    noSkills: '설치된 스킬이 없습니다',
    noMatch: '일치하는 스킬이 없습니다',
    manage: '스킬 관리',
    back: '뒤로',
    removeTitle: '스킬 제거',
    attachedTitle: '이 메시지에 첨부된 스킬',
    maxSkillsHint: '메시지당 최대 3개의 스킬을 첨부할 수 있습니다',
    uniworkTooLongNotice:
      '첨부된 스킬이 UniWork AI 한도(8,000자)를 초과합니다. 스킬을 제거하거나 자체 API 키를 사용하세요.',
  },
  fr: {
    addTitle: 'Ajouter',
    addFile: 'Ajouter un fichier',
    skills: 'Compétences',
    searchPlaceholder: 'Rechercher une compétence',
    noSkills: 'Aucune compétence installée',
    noMatch: 'Aucune compétence correspondante',
    manage: 'Gérer les compétences',
    back: 'Retour',
    removeTitle: 'Retirer la compétence',
    attachedTitle: 'Compétences jointes à ce message',
    maxSkillsHint: 'Jusqu’à 3 compétences par message',
    uniworkTooLongNotice:
      'Les compétences jointes sont trop longues pour UniWork AI (plus de 8 000 caractères). Retirez une compétence ou utilisez votre propre clé API.',
  },
  de: {
    addTitle: 'Hinzufügen',
    addFile: 'Datei hinzufügen',
    skills: 'Skills',
    searchPlaceholder: 'Skills durchsuchen',
    noSkills: 'Noch keine Skills installiert',
    noMatch: 'Keine passenden Skills',
    manage: 'Skills verwalten',
    back: 'Zurück',
    removeTitle: 'Skill entfernen',
    attachedTitle: 'An diese Nachricht angehängte Skills',
    maxSkillsHint: 'Bis zu 3 Skills pro Nachricht',
    uniworkTooLongNotice:
      'Die angehängten Skills sind für UniWork AI zu lang (über 8.000 Zeichen). Entfernen Sie einen Skill oder verwenden Sie Ihren eigenen API-Schlüssel.',
  },
  es: {
    addTitle: 'Añadir',
    addFile: 'Añadir archivo',
    skills: 'Habilidades',
    searchPlaceholder: 'Buscar habilidades',
    noSkills: 'Aún no hay habilidades instaladas',
    noMatch: 'Ninguna habilidad coincide',
    manage: 'Gestionar habilidades',
    back: 'Atrás',
    removeTitle: 'Quitar habilidad',
    attachedTitle: 'Habilidades adjuntas a este mensaje',
    maxSkillsHint: 'Hasta 3 habilidades por mensaje',
    uniworkTooLongNotice:
      'Las habilidades adjuntas son demasiado largas para UniWork AI (más de 8.000 caracteres). Quite una habilidad o use su propia clave API.',
  },
  th: {
    addTitle: 'เพิ่ม',
    addFile: 'เพิ่มไฟล์',
    skills: 'ทักษะ',
    searchPlaceholder: 'ค้นหาทักษะ',
    noSkills: 'ยังไม่ได้ติดตั้งทักษะ',
    noMatch: 'ไม่พบทักษะที่ตรงกัน',
    manage: 'จัดการทักษะ',
    back: 'ย้อนกลับ',
    removeTitle: 'นำทักษะออก',
    attachedTitle: 'ทักษะที่แนบกับข้อความนี้',
    maxSkillsHint: 'แนบได้สูงสุด 3 ทักษะต่อข้อความ',
    uniworkTooLongNotice:
      'ทักษะที่แนบมามีความยาวเกินขีดจำกัดของ UniWork AI (เกิน 8,000 อักขระ) โปรดนำทักษะออกหรือใช้คีย์ API ของคุณเอง',
  },
  id: {
    addTitle: 'Tambah',
    addFile: 'Tambah berkas',
    skills: 'Keterampilan',
    searchPlaceholder: 'Cari keterampilan',
    noSkills: 'Belum ada keterampilan terpasang',
    noMatch: 'Tidak ada keterampilan yang cocok',
    manage: 'Kelola keterampilan',
    back: 'Kembali',
    removeTitle: 'Hapus keterampilan',
    attachedTitle: 'Keterampilan yang dilampirkan pada pesan ini',
    maxSkillsHint: 'Maksimal 3 keterampilan per pesan',
    uniworkTooLongNotice:
      'Keterampilan yang dilampirkan terlalu panjang untuk UniWork AI (lebih dari 8.000 karakter). Hapus satu keterampilan atau gunakan kunci API Anda sendiri.',
  },
  ru: {
    addTitle: 'Добавить',
    addFile: 'Добавить файл',
    skills: 'Навыки',
    searchPlaceholder: 'Поиск навыков',
    noSkills: 'Навыки ещё не установлены',
    noMatch: 'Подходящих навыков нет',
    manage: 'Управлять навыками',
    back: 'Назад',
    removeTitle: 'Убрать навык',
    attachedTitle: 'Навыки, приложенные к этому сообщению',
    maxSkillsHint: 'Не более 3 навыков на сообщение',
    uniworkTooLongNotice:
      'Приложенные навыки слишком велики для UniWork AI (более 8 000 символов). Уберите навык или используйте собственный API-ключ.',
  },
  ar: {
    addTitle: 'إضافة',
    addFile: 'إضافة ملف',
    skills: 'المهارات',
    searchPlaceholder: 'ابحث في المهارات',
    noSkills: 'لم تُثبَّت أي مهارات بعد',
    noMatch: 'لا توجد مهارات مطابقة',
    manage: 'إدارة المهارات',
    back: 'رجوع',
    removeTitle: 'إزالة المهارة',
    attachedTitle: 'المهارات المرفقة بهذه الرسالة',
    maxSkillsHint: 'ما يصل إلى 3 مهارات لكل رسالة',
    uniworkTooLongNotice:
      'المهارات المرفقة طويلة جدًا بالنسبة إلى UniWork AI (أكثر من 8000 حرف). أزل مهارة أو استخدم مفتاح API الخاص بك.',
  },
  pt: {
    addTitle: 'Adicionar',
    addFile: 'Adicionar arquivo',
    skills: 'Habilidades',
    searchPlaceholder: 'Buscar habilidades',
    noSkills: 'Nenhuma habilidade instalada',
    noMatch: 'Nenhuma habilidade corresponde',
    manage: 'Gerenciar habilidades',
    back: 'Voltar',
    removeTitle: 'Remover habilidade',
    attachedTitle: 'Habilidades anexadas a esta mensagem',
    maxSkillsHint: 'Até 3 habilidades por mensagem',
    uniworkTooLongNotice:
      'As habilidades anexadas são longas demais para o UniWork AI (mais de 8.000 caracteres). Remova uma habilidade ou use sua própria chave de API.',
  },
  it: {
    addTitle: 'Aggiungi',
    addFile: 'Aggiungi file',
    skills: 'Competenze',
    searchPlaceholder: 'Cerca competenze',
    noSkills: 'Nessuna competenza installata',
    noMatch: 'Nessuna competenza corrispondente',
    manage: 'Gestisci competenze',
    back: 'Indietro',
    removeTitle: 'Rimuovi competenza',
    attachedTitle: 'Competenze allegate a questo messaggio',
    maxSkillsHint: 'Fino a 3 competenze per messaggio',
    uniworkTooLongNotice:
      'Le competenze allegate sono troppo lunghe per UniWork AI (oltre 8.000 caratteri). Rimuovi una competenza o usa la tua chiave API.',
  },
  pl: {
    addTitle: 'Dodaj',
    addFile: 'Dodaj plik',
    skills: 'Umiejętności',
    searchPlaceholder: 'Szukaj umiejętności',
    noSkills: 'Brak zainstalowanych umiejętności',
    noMatch: 'Brak pasujących umiejętności',
    manage: 'Zarządzaj umiejętnościami',
    back: 'Wstecz',
    removeTitle: 'Usuń umiejętność',
    attachedTitle: 'Umiejętności dołączone do tej wiadomości',
    maxSkillsHint: 'Maksymalnie 3 umiejętności na wiadomość',
    uniworkTooLongNotice:
      'Dołączone umiejętności są za długie dla UniWork AI (ponad 8000 znaków). Usuń umiejętność lub użyj własnego klucza API.',
  },
  cs: {
    addTitle: 'Přidat',
    addFile: 'Přidat soubor',
    skills: 'Dovednosti',
    searchPlaceholder: 'Hledat dovednosti',
    noSkills: 'Zatím žádné dovednosti',
    noMatch: 'Žádná odpovídající dovednost',
    manage: 'Spravovat dovednosti',
    back: 'Zpět',
    removeTitle: 'Odebrat dovednost',
    attachedTitle: 'Dovednosti připojené k této zprávě',
    maxSkillsHint: 'Nejvýše 3 dovednosti na zprávu',
    uniworkTooLongNotice:
      'Připojené dovednosti jsou pro UniWork AI příliš dlouhé (přes 8 000 znaků). Odeberte dovednost nebo použijte vlastní klíč API.',
  },
  nl: {
    addTitle: 'Toevoegen',
    addFile: 'Bestand toevoegen',
    skills: 'Vaardigheden',
    searchPlaceholder: 'Vaardigheden zoeken',
    noSkills: 'Nog geen vaardigheden geïnstalleerd',
    noMatch: 'Geen passende vaardigheden',
    manage: 'Vaardigheden beheren',
    back: 'Terug',
    removeTitle: 'Vaardigheid verwijderen',
    attachedTitle: 'Vaardigheden bij dit bericht',
    maxSkillsHint: 'Maximaal 3 vaardigheden per bericht',
    uniworkTooLongNotice:
      'De bijgevoegde vaardigheden zijn te lang voor UniWork AI (meer dan 8.000 tekens). Verwijder een vaardigheid of gebruik uw eigen API-sleutel.',
  },
  ms: {
    addTitle: 'Tambah',
    addFile: 'Tambah fail',
    skills: 'Kemahiran',
    searchPlaceholder: 'Cari kemahiran',
    noSkills: 'Belum ada kemahiran dipasang',
    noMatch: 'Tiada kemahiran sepadan',
    manage: 'Urus kemahiran',
    back: 'Kembali',
    removeTitle: 'Buang kemahiran',
    attachedTitle: 'Kemahiran yang dilampirkan pada mesej ini',
    maxSkillsHint: 'Sehingga 3 kemahiran setiap mesej',
    uniworkTooLongNotice:
      'Kemahiran yang dilampirkan terlalu panjang untuk UniWork AI (melebihi 8,000 aksara). Buang satu kemahiran atau gunakan kunci API anda sendiri.',
  },
  he: {
    addTitle: 'הוספה',
    addFile: 'הוספת קובץ',
    skills: 'מיומנויות',
    searchPlaceholder: 'חיפוש מיומנויות',
    noSkills: 'עדיין לא הותקנו מיומנויות',
    noMatch: 'אין מיומנויות תואמות',
    manage: 'ניהול מיומנויות',
    back: 'חזרה',
    removeTitle: 'הסרת מיומנות',
    attachedTitle: 'מיומנויות שצורפו להודעה זו',
    maxSkillsHint: 'עד 3 מיומנויות להודעה',
    uniworkTooLongNotice:
      'המיומנויות המצורפות ארוכות מדי עבור UniWork AI (מעל 8,000 תווים). הסר מיומנות או השתמש במפתח API משלך.',
  },
  hi: {
    addTitle: 'जोड़ें',
    addFile: 'फ़ाइल जोड़ें',
    skills: 'कौशल',
    searchPlaceholder: 'कौशल खोजें',
    noSkills: 'अभी कोई कौशल इंस्टॉल नहीं',
    noMatch: 'कोई मेल खाता कौशल नहीं',
    manage: 'कौशल प्रबंधित करें',
    back: 'वापस',
    removeTitle: 'कौशल हटाएँ',
    attachedTitle: 'इस संदेश के साथ जुड़े कौशल',
    maxSkillsHint: 'प्रति संदेश अधिकतम 3 कौशल',
    uniworkTooLongNotice:
      'जुड़े हुए कौशल UniWork AI के लिए बहुत लंबे हैं (8,000 वर्णों से अधिक)। कोई कौशल हटाएँ या अपनी स्वयं की API कुंजी का उपयोग करें।',
  },
  'zh-TW': {
    addTitle: '新增',
    addFile: '新增檔案',
    skills: '技能',
    searchPlaceholder: '搜尋技能',
    noSkills: '尚未安裝技能',
    noMatch: '沒有符合的技能',
    manage: '管理技能',
    back: '返回',
    removeTitle: '移除技能',
    attachedTitle: '此訊息附帶的技能',
    maxSkillsHint: '每則訊息最多附加 3 個技能',
    uniworkTooLongNotice:
      '附帶的技能對 UniWork AI 而言過長（超過 8,000 個字元）。請移除一個技能，或使用您自己的 API 金鑰。',
  },
  vi: {
    addTitle: 'Thêm',
    addFile: 'Thêm tệp',
    skills: 'Kỹ năng',
    searchPlaceholder: 'Tìm kỹ năng',
    noSkills: 'Chưa cài kỹ năng nào',
    noMatch: 'Không có kỹ năng phù hợp',
    manage: 'Quản lý kỹ năng',
    back: 'Quay lại',
    removeTitle: 'Gỡ kỹ năng',
    attachedTitle: 'Kỹ năng đính kèm tin nhắn này',
    maxSkillsHint: 'Tối đa 3 kỹ năng mỗi tin nhắn',
    uniworkTooLongNotice:
      'Kỹ năng đính kèm quá dài đối với UniWork AI (hơn 8.000 ký tự). Hãy gỡ bớt một kỹ năng hoặc dùng khóa API của riêng bạn.',
  },
}

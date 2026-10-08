// First-run welcome copy of the shell (apps/shell/src/renderer/src/strings.ts, keys onb*), all
// locales. Upstream's wording describes upstream's product and the earlier hand-written UniWork
// copy talked about internal phases ("not part of GO-1", "Work Graph"), so the table re-applies
// this file after every upstream sync (rule `onboarding-copy`) and the brand scan rejects
// planning vocabulary in user-visible strings.
//
// Slide 1: title, subtitle (onbSubtitle1), body (onbBody1). Slide 2: title (onbTitle2) and the
// line under it (onbBody2). Slide 3: title (onbTitle3), line (onbBody3) and the footnote (onbNote3).
// Upstream's slide 3 ("Free for everyone", "No license fees. No ads. No watermarks.") made pricing
// and licensing claims about upstream's product, so it is replaced in every locale; no copy here
// may claim a price, a license or a free offer. Other onb* keys (buttons, step labels) keep
// upstream's per-locale translation.
//
// Keep the apostrophes typographic (’): the transform writes single-quoted literals.

export const ONBOARDING_COPY = {
  vi: {
    onbSubtitle1: 'Tài liệu, bảng tính, trình chiếu và PDF trong một ứng dụng',
    onbBody1: 'Tạo tài liệu, lập bảng tính, làm trình chiếu và xem PDF ngay trên máy tính của bạn.',
    onbTitle2: 'AI hỗ trợ từng bước',
    onbBody2:
      'Soạn thảo, viết lại và giải thích ngay trong tài liệu của bạn. Dùng tài khoản UniWork hoặc khóa AI của riêng bạn.',
    onbNote3:
      'AI là tùy chọn. Tài liệu được chỉnh sửa ngay trên máy tính của bạn; mở và lưu tệp không cần tài khoản hay khóa.',
    onbTitle3: 'Bạn đã sẵn sàng',
    onbBody3: 'Mở một tệp hoặc tạo tài liệu mới để bắt đầu.',
  },
  en: {
    onbSubtitle1: 'Documents, spreadsheets, slides and PDFs in one app',
    onbBody1: 'Create docs, build sheets, make slides, and review PDFs, all on your own computer.',
    onbTitle2: 'AI at every step',
    onbBody2:
      'Draft, rewrite and explain right inside your documents. Use your UniWork account or your own AI provider key.',
    onbNote3:
      'AI is optional. Your documents are edited on your computer; no account or key is needed to open or save files.',
    onbTitle3: 'You’re all set',
    onbBody3: 'Open a file or create a new document to get started.',
  },
  zh: {
    onbSubtitle1: '文档、表格、演示和 PDF，尽在一个应用',
    onbTitle2: 'AI 贯穿每一步',
    onbBody2: '在文档中直接起草、改写和解释。使用你的 UniWork 账号，或自带 AI 服务商密钥。',
    onbTitle3: '一切就绪',
    onbBody3: '打开文件，或新建一个文档即可开始。',
  },
  'zh-TW': {
    onbSubtitle1: '文件、試算表、簡報與 PDF，盡在一個應用程式',
    onbTitle2: 'AI 貫穿每一步',
    onbBody2: '直接在文件中撰寫草稿、改寫與說明。使用你的 UniWork 帳號，或自備 AI 服務商金鑰。',
    onbTitle3: '一切就緒',
    onbBody3: '開啟檔案，或建立新文件即可開始。',
  },
  ja: {
    onbSubtitle1: 'ドキュメント、スプレッドシート、スライド、PDF をひとつのアプリで',
    onbTitle2: 'すべての作業に AI を',
    onbBody2:
      '文書の中でそのまま下書き・書き直し・説明ができます。UniWork アカウント、またはご自身の AI プロバイダーキーを使えます。',
    onbTitle3: '準備完了です',
    onbBody3: 'ファイルを開くか、新しいドキュメントを作成して始めましょう。',
  },
  ko: {
    onbSubtitle1: '문서, 스프레드시트, 슬라이드, PDF를 하나의 앱에서',
    onbTitle2: '모든 단계에 AI를',
    onbBody2:
      '문서 안에서 바로 초안 작성, 다시 쓰기, 설명을 할 수 있습니다. UniWork 계정이나 직접 마련한 AI 제공업체 키를 사용하세요.',
    onbTitle3: '준비가 끝났습니다',
    onbBody3: '파일을 열거나 새 문서를 만들어 시작하세요.',
  },
  fr: {
    onbSubtitle1: 'Documents, tableurs, présentations et PDF dans une seule application',
    onbTitle2: 'L’IA à chaque étape',
    onbBody2:
      'Rédigez, reformulez et expliquez directement dans vos documents. Utilisez votre compte UniWork ou votre propre clé de fournisseur d’IA.',
    onbTitle3: 'Tout est prêt',
    onbBody3: 'Ouvrez un fichier ou créez un nouveau document pour commencer.',
  },
  de: {
    onbSubtitle1: 'Dokumente, Tabellen, Präsentationen und PDFs in einer App',
    onbTitle2: 'KI bei jedem Schritt',
    onbBody2:
      'Entwerfen, umformulieren und erklären – direkt in Ihren Dokumenten. Nutzen Sie Ihr UniWork-Konto oder Ihren eigenen KI-Anbieter-Schlüssel.',
    onbTitle3: 'Alles bereit',
    onbBody3: 'Öffnen Sie eine Datei oder erstellen Sie ein neues Dokument, um loszulegen.',
  },
  es: {
    onbSubtitle1: 'Documentos, hojas de cálculo, presentaciones y PDF en una sola aplicación',
    onbTitle2: 'IA en cada paso',
    onbBody2:
      'Redacta, reescribe y explica directamente en tus documentos. Usa tu cuenta de UniWork o tu propia clave de proveedor de IA.',
    onbTitle3: 'Todo listo',
    onbBody3: 'Abre un archivo o crea un documento nuevo para empezar.',
  },
  th: {
    onbSubtitle1: 'เอกสาร สเปรดชีต งานนำเสนอ และ PDF ในแอปเดียว',
    onbTitle2: 'AI ช่วยในทุกขั้นตอน',
    onbBody2:
      'ร่าง เขียนใหม่ และอธิบายได้ในเอกสารของคุณโดยตรง ใช้บัญชี UniWork หรือคีย์ผู้ให้บริการ AI ของคุณเอง',
    onbTitle3: 'พร้อมแล้ว',
    onbBody3: 'เปิดไฟล์หรือสร้างเอกสารใหม่เพื่อเริ่มต้น',
  },
  id: {
    onbSubtitle1: 'Dokumen, spreadsheet, slide, dan PDF dalam satu aplikasi',
    onbTitle2: 'AI di setiap langkah',
    onbBody2:
      'Susun draf, tulis ulang, dan jelaskan langsung di dalam dokumen Anda. Gunakan akun UniWork atau kunci penyedia AI Anda sendiri.',
    onbTitle3: 'Semua siap',
    onbBody3: 'Buka berkas atau buat dokumen baru untuk memulai.',
  },
  ru: {
    onbSubtitle1: 'Документы, таблицы, презентации и PDF в одном приложении',
    onbTitle2: 'ИИ на каждом шаге',
    onbBody2:
      'Составляйте черновики, переписывайте и объясняйте прямо в документах. Используйте аккаунт UniWork или собственный ключ поставщика ИИ.',
    onbTitle3: 'Всё готово',
    onbBody3: 'Откройте файл или создайте новый документ, чтобы начать.',
  },
  ar: {
    onbSubtitle1: 'المستندات والجداول والعروض وملفات PDF في تطبيق واحد',
    onbTitle2: 'الذكاء الاصطناعي في كل خطوة',
    onbBody2:
      'اكتب المسودات وأعد الصياغة واشرح مباشرة داخل مستنداتك. استخدم حساب UniWork أو مفتاح مزوّد الذكاء الاصطناعي الخاص بك.',
    onbTitle3: 'كل شيء جاهز',
    onbBody3: 'افتح ملفًا أو أنشئ مستندًا جديدًا للبدء.',
  },
  pt: {
    onbSubtitle1: 'Documentos, planilhas, apresentações e PDFs em um só app',
    onbTitle2: 'IA em cada etapa',
    onbBody2:
      'Redija, reescreva e explique direto nos seus documentos. Use sua conta UniWork ou sua própria chave de provedor de IA.',
    onbTitle3: 'Tudo pronto',
    onbBody3: 'Abra um arquivo ou crie um novo documento para começar.',
  },
  it: {
    onbSubtitle1: 'Documenti, fogli di calcolo, presentazioni e PDF in una sola app',
    onbTitle2: 'L’IA in ogni passaggio',
    onbBody2:
      'Scrivi bozze, riformula e spiega direttamente nei tuoi documenti. Usa il tuo account UniWork o la tua chiave di un provider IA.',
    onbTitle3: 'Tutto pronto',
    onbBody3: 'Apri un file o crea un nuovo documento per iniziare.',
  },
  pl: {
    onbSubtitle1: 'Dokumenty, arkusze, prezentacje i PDF w jednej aplikacji',
    onbTitle2: 'AI na każdym kroku',
    onbBody2:
      'Twórz szkice, przepisuj i wyjaśniaj bezpośrednio w dokumentach. Użyj konta UniWork lub własnego klucza dostawcy AI.',
    onbTitle3: 'Wszystko gotowe',
    onbBody3: 'Otwórz plik lub utwórz nowy dokument, aby zacząć.',
  },
  cs: {
    onbSubtitle1: 'Dokumenty, tabulky, prezentace a PDF v jedné aplikaci',
    onbTitle2: 'AI v každém kroku',
    onbBody2:
      'Pište návrhy, přeformulovávejte a vysvětlujte přímo ve svých dokumentech. Použijte účet UniWork nebo vlastní klíč poskytovatele AI.',
    onbTitle3: 'Vše je připraveno',
    onbBody3: 'Otevřete soubor nebo vytvořte nový dokument a začněte.',
  },
  nl: {
    onbSubtitle1: 'Documenten, spreadsheets, presentaties en pdf’s in één app',
    onbTitle2: 'AI bij elke stap',
    onbBody2:
      'Schrijf concepten, herformuleer en leg uit, direct in je documenten. Gebruik je UniWork-account of je eigen sleutel van een AI-aanbieder.',
    onbTitle3: 'Alles staat klaar',
    onbBody3: 'Open een bestand of maak een nieuw document om te beginnen.',
  },
  ms: {
    onbSubtitle1: 'Dokumen, hamparan, slaid dan PDF dalam satu aplikasi',
    onbTitle2: 'AI pada setiap langkah',
    onbBody2:
      'Susun draf, tulis semula dan terangkan terus dalam dokumen anda. Gunakan akaun UniWork atau kunci pembekal AI anda sendiri.',
    onbTitle3: 'Semuanya sedia',
    onbBody3: 'Buka fail atau cipta dokumen baharu untuk bermula.',
  },
  he: {
    onbSubtitle1: 'מסמכים, גיליונות, מצגות וקובצי PDF באפליקציה אחת',
    onbTitle2: 'AI בכל שלב',
    onbBody2:
      'אפשר לנסח, לכתוב מחדש ולהסביר ישירות בתוך המסמכים. השתמשו בחשבון UniWork או במפתח ספק AI משלכם.',
    onbTitle3: 'הכול מוכן',
    onbBody3: 'פתחו קובץ או צרו מסמך חדש כדי להתחיל.',
  },
  hi: {
    onbSubtitle1: 'दस्तावेज़, स्प्रेडशीट, स्लाइड और PDF — एक ही ऐप में',
    onbTitle2: 'हर कदम पर AI',
    onbBody2:
      'अपने दस्तावेज़ों में ही ड्राफ़्ट बनाएँ, दोबारा लिखें और समझाएँ। अपना UniWork खाता या अपनी AI प्रदाता कुंजी इस्तेमाल करें।',
    onbTitle3: 'सब तैयार है',
    onbBody3: 'शुरू करने के लिए कोई फ़ाइल खोलें या नया दस्तावेज़ बनाएँ।',
  },
}

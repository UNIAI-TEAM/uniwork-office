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
      'Soạn thảo, viết lại và giải thích ngay trong tài liệu của bạn. AI chạy bằng tài khoản UniWork của bạn.',
    onbNote3:
      'AI là tùy chọn. Tài liệu được chỉnh sửa ngay trên máy tính của bạn; mở và lưu tệp không cần tài khoản.',
    onbTitle3: 'Bạn đã sẵn sàng',
    onbBody3: 'Mở một tệp hoặc tạo tài liệu mới để bắt đầu.',
  },
  en: {
    onbSubtitle1: 'Documents, spreadsheets, slides and PDFs in one app',
    onbBody1: 'Create docs, build sheets, make slides, and review PDFs, all on your own computer.',
    onbTitle2: 'AI at every step',
    onbBody2:
      'Draft, rewrite and explain right inside your documents. AI runs with your UniWork account.',
    onbNote3:
      'AI is optional. Your documents are edited on your computer; no account is needed to open or save files.',
    onbTitle3: 'You’re all set',
    onbBody3: 'Open a file or create a new document to get started.',
  },
  zh: {
    onbSubtitle1: '文档、表格、演示和 PDF，尽在一个应用',
    onbBody1: '创建文档、制作表格、生成演示、审阅 PDF，一切都在你自己的电脑上完成。',
    onbTitle2: 'AI 贯穿每一步',
    onbBody2: '在文档中直接起草、改写和解释。AI 通过你的 UniWork 账号运行。',
    onbNote3: 'AI 为可选功能。文档在你的电脑上编辑；打开或保存文件无需账号。',
    onbTitle3: '一切就绪',
    onbBody3: '打开文件，或新建一个文档即可开始。',
  },
  'zh-TW': {
    onbSubtitle1: '文件、試算表、簡報與 PDF，盡在一個應用程式',
    onbBody1: '建立文件、製作試算表、產生簡報、審閱 PDF，一切都在你自己的電腦上完成。',
    onbTitle2: 'AI 貫穿每一步',
    onbBody2: '直接在文件中撰寫草稿、改寫與說明。AI 透過你的 UniWork 帳號運作。',
    onbNote3: 'AI 為選用功能。文件在你的電腦上編輯；開啟或儲存檔案無需帳號。',
    onbTitle3: '一切就緒',
    onbBody3: '開啟檔案，或建立新文件即可開始。',
  },
  ja: {
    onbSubtitle1: 'ドキュメント、スプレッドシート、スライド、PDF をひとつのアプリで',
    onbBody1:
      'ドキュメントの作成、表計算、スライド作成、PDF のレビューを、すべてご自身のコンピューター上で行えます。',
    onbTitle2: 'すべての作業に AI を',
    onbBody2:
      '文書の中でそのまま下書き・書き直し・説明ができます。AI は UniWork アカウントで利用できます。',
    onbNote3:
      'AI の利用は任意です。ドキュメントはお使いのコンピューター上で編集され、ファイルを開いたり保存したりするのにアカウントは必要ありません。',
    onbTitle3: '準備完了です',
    onbBody3: 'ファイルを開くか、新しいドキュメントを作成して始めましょう。',
  },
  ko: {
    onbSubtitle1: '문서, 스프레드시트, 슬라이드, PDF를 하나의 앱에서',
    onbBody1:
      '문서 작성, 스프레드시트 제작, 프레젠테이션 생성, PDF 검토를 모두 내 컴퓨터에서 할 수 있습니다.',
    onbTitle2: '모든 단계에 AI를',
    onbBody2:
      '문서 안에서 바로 초안 작성, 다시 쓰기, 설명을 할 수 있습니다. AI는 UniWork 계정으로 실행됩니다.',
    onbNote3:
      'AI는 선택 사항입니다. 문서는 내 컴퓨터에서 편집되며, 파일을 열거나 저장하는 데 계정이 필요하지 않습니다.',
    onbTitle3: '준비가 끝났습니다',
    onbBody3: '파일을 열거나 새 문서를 만들어 시작하세요.',
  },
  fr: {
    onbSubtitle1: 'Documents, tableurs, présentations et PDF dans une seule application',
    onbBody1:
      'Créez des documents, des feuilles de calcul et des présentations, et relisez des PDF, le tout sur votre propre ordinateur.',
    onbTitle2: 'L’IA à chaque étape',
    onbBody2:
      'Rédigez, reformulez et expliquez directement dans vos documents. L’IA fonctionne avec votre compte UniWork.',
    onbNote3:
      'L’IA est facultative. Vos documents sont modifiés sur votre ordinateur ; aucun compte n’est nécessaire pour ouvrir ou enregistrer des fichiers.',
    onbTitle3: 'Tout est prêt',
    onbBody3: 'Ouvrez un fichier ou créez un nouveau document pour commencer.',
  },
  de: {
    onbSubtitle1: 'Dokumente, Tabellen, Präsentationen und PDFs in einer App',
    onbBody1:
      'Dokumente erstellen, Tabellen bauen, Präsentationen gestalten und PDFs prüfen – alles auf Ihrem eigenen Computer.',
    onbTitle2: 'KI bei jedem Schritt',
    onbBody2:
      'Entwerfen, umformulieren und erklären – direkt in Ihren Dokumenten. Die KI läuft über Ihr UniWork-Konto.',
    onbNote3:
      'KI ist optional. Ihre Dokumente werden auf Ihrem Computer bearbeitet; zum Öffnen oder Speichern von Dateien ist kein Konto nötig.',
    onbTitle3: 'Alles bereit',
    onbBody3: 'Öffnen Sie eine Datei oder erstellen Sie ein neues Dokument, um loszulegen.',
  },
  es: {
    onbSubtitle1: 'Documentos, hojas de cálculo, presentaciones y PDF en una sola aplicación',
    onbBody1:
      'Crea documentos, hojas de cálculo y presentaciones, y revisa PDF, todo en tu propio equipo.',
    onbTitle2: 'IA en cada paso',
    onbBody2:
      'Redacta, reescribe y explica directamente en tus documentos. La IA funciona con tu cuenta de UniWork.',
    onbNote3:
      'La IA es opcional. Tus documentos se editan en tu equipo; no hace falta una cuenta para abrir o guardar archivos.',
    onbTitle3: 'Todo listo',
    onbBody3: 'Abre un archivo o crea un documento nuevo para empezar.',
  },
  th: {
    onbSubtitle1: 'เอกสาร สเปรดชีต งานนำเสนอ และ PDF ในแอปเดียว',
    onbBody1:
      'สร้างเอกสาร ทำสเปรดชีต สร้างงานนำเสนอ และตรวจทาน PDF ได้ทั้งหมดบนคอมพิวเตอร์ของคุณเอง',
    onbTitle2: 'AI ช่วยในทุกขั้นตอน',
    onbBody2: 'ร่าง เขียนใหม่ และอธิบายได้ในเอกสารของคุณโดยตรง AI ทำงานผ่านบัญชี UniWork ของคุณ',
    onbNote3:
      'AI เป็นตัวเลือก เอกสารของคุณถูกแก้ไขบนคอมพิวเตอร์ของคุณ ไม่ต้องใช้บัญชีเพื่อเปิดหรือบันทึกไฟล์',
    onbTitle3: 'พร้อมแล้ว',
    onbBody3: 'เปิดไฟล์หรือสร้างเอกสารใหม่เพื่อเริ่มต้น',
  },
  id: {
    onbSubtitle1: 'Dokumen, spreadsheet, slide, dan PDF dalam satu aplikasi',
    onbBody1:
      'Buat dokumen, susun spreadsheet, rancang presentasi, dan tinjau PDF, semuanya di komputer Anda sendiri.',
    onbTitle2: 'AI di setiap langkah',
    onbBody2:
      'Susun draf, tulis ulang, dan jelaskan langsung di dalam dokumen Anda. AI berjalan dengan akun UniWork Anda.',
    onbNote3:
      'AI bersifat opsional. Dokumen Anda diedit di komputer Anda; tidak perlu akun untuk membuka atau menyimpan file.',
    onbTitle3: 'Semua siap',
    onbBody3: 'Buka berkas atau buat dokumen baru untuk memulai.',
  },
  ru: {
    onbSubtitle1: 'Документы, таблицы, презентации и PDF в одном приложении',
    onbBody1:
      'Создавайте документы, таблицы и презентации, работайте с PDF — всё на вашем компьютере.',
    onbTitle2: 'ИИ на каждом шаге',
    onbBody2:
      'Составляйте черновики, переписывайте и объясняйте прямо в документах. ИИ работает через ваш аккаунт UniWork.',
    onbNote3:
      'ИИ необязателен. Документы редактируются на вашем компьютере; для открытия и сохранения файлов аккаунт не нужен.',
    onbTitle3: 'Всё готово',
    onbBody3: 'Откройте файл или создайте новый документ, чтобы начать.',
  },
  ar: {
    onbSubtitle1: 'المستندات والجداول والعروض وملفات PDF في تطبيق واحد',
    onbBody1:
      'أنشئ المستندات وجداول البيانات والعروض التقديمية وراجع ملفات PDF، كل ذلك على جهاز الكمبيوتر الخاص بك.',
    onbTitle2: 'الذكاء الاصطناعي في كل خطوة',
    onbBody2:
      'اكتب المسودات وأعد الصياغة واشرح مباشرة داخل مستنداتك. يعمل الذكاء الاصطناعي عبر حساب UniWork الخاص بك.',
    onbNote3:
      'الذكاء الاصطناعي اختياري. تُحرَّر مستنداتك على جهاز الكمبيوتر الخاص بك، ولا حاجة إلى حساب لفتح الملفات أو حفظها.',
    onbTitle3: 'كل شيء جاهز',
    onbBody3: 'افتح ملفًا أو أنشئ مستندًا جديدًا للبدء.',
  },
  pt: {
    onbSubtitle1: 'Documentos, planilhas, apresentações e PDFs em um só app',
    onbBody1:
      'Crie documentos, planilhas e apresentações e revise PDFs, tudo no seu próprio computador.',
    onbTitle2: 'IA em cada etapa',
    onbBody2:
      'Redija, reescreva e explique direto nos seus documentos. A IA funciona com sua conta UniWork.',
    onbNote3:
      'A IA é opcional. Seus documentos são editados no seu computador; não é preciso conta para abrir ou salvar arquivos.',
    onbTitle3: 'Tudo pronto',
    onbBody3: 'Abra um arquivo ou crie um novo documento para começar.',
  },
  it: {
    onbSubtitle1: 'Documenti, fogli di calcolo, presentazioni e PDF in una sola app',
    onbBody1:
      'Crea documenti, fogli di calcolo e presentazioni e rivedi i PDF, tutto sul tuo computer.',
    onbTitle2: 'L’IA in ogni passaggio',
    onbBody2:
      'Scrivi bozze, riformula e spiega direttamente nei tuoi documenti. L’IA funziona con il tuo account UniWork.',
    onbNote3:
      'L’IA è facoltativa. I tuoi documenti vengono modificati sul tuo computer; per aprire o salvare i file non serve un account.',
    onbTitle3: 'Tutto pronto',
    onbBody3: 'Apri un file o crea un nuovo documento per iniziare.',
  },
  pl: {
    onbSubtitle1: 'Dokumenty, arkusze, prezentacje i PDF w jednej aplikacji',
    onbBody1:
      'Twórz dokumenty, arkusze i prezentacje oraz przeglądaj pliki PDF, a wszystko to na własnym komputerze.',
    onbTitle2: 'AI na każdym kroku',
    onbBody2:
      'Twórz szkice, przepisuj i wyjaśniaj bezpośrednio w dokumentach. AI działa z Twoim kontem UniWork.',
    onbNote3:
      'AI jest opcjonalna. Dokumenty są edytowane na Twoim komputerze; do otwierania i zapisywania plików nie potrzeba konta.',
    onbTitle3: 'Wszystko gotowe',
    onbBody3: 'Otwórz plik lub utwórz nowy dokument, aby zacząć.',
  },
  cs: {
    onbSubtitle1: 'Dokumenty, tabulky, prezentace a PDF v jedné aplikaci',
    onbBody1:
      'Vytvářejte dokumenty, tabulky a prezentace a kontrolujte PDF, a to vše na vlastním počítači.',
    onbTitle2: 'AI v každém kroku',
    onbBody2:
      'Pište návrhy, přeformulovávejte a vysvětlujte přímo ve svých dokumentech. AI funguje s vaším účtem UniWork.',
    onbNote3:
      'AI je volitelná. Dokumenty se upravují ve vašem počítači; k otevření nebo uložení souborů není potřeba účet.',
    onbTitle3: 'Vše je připraveno',
    onbBody3: 'Otevřete soubor nebo vytvořte nový dokument a začněte.',
  },
  nl: {
    onbSubtitle1: 'Documenten, spreadsheets, presentaties en pdf’s in één app',
    onbBody1:
      'Maak documenten, bouw spreadsheets, maak presentaties en beoordeel pdf’s, alles op je eigen computer.',
    onbTitle2: 'AI bij elke stap',
    onbBody2:
      'Schrijf concepten, herformuleer en leg uit, direct in je documenten. AI werkt met je UniWork-account.',
    onbNote3:
      'AI is optioneel. Je documenten worden op je computer bewerkt; om bestanden te openen of op te slaan heb je geen account nodig.',
    onbTitle3: 'Alles staat klaar',
    onbBody3: 'Open een bestand of maak een nieuw document om te beginnen.',
  },
  ms: {
    onbSubtitle1: 'Dokumen, hamparan, slaid dan PDF dalam satu aplikasi',
    onbBody1:
      'Cipta dokumen, bina hamparan, hasilkan persembahan dan semak PDF, semuanya pada komputer anda sendiri.',
    onbTitle2: 'AI pada setiap langkah',
    onbBody2:
      'Susun draf, tulis semula dan terangkan terus dalam dokumen anda. AI berjalan dengan akaun UniWork anda.',
    onbNote3:
      'AI adalah pilihan. Dokumen anda diedit pada komputer anda; tiada akaun diperlukan untuk membuka atau menyimpan fail.',
    onbTitle3: 'Semuanya sedia',
    onbBody3: 'Buka fail atau cipta dokumen baharu untuk bermula.',
  },
  he: {
    onbSubtitle1: 'מסמכים, גיליונות, מצגות וקובצי PDF באפליקציה אחת',
    onbBody1: 'צרו מסמכים, בנו גיליונות, הכינו מצגות ובדקו קובצי PDF, הכול במחשב שלכם.',
    onbTitle2: 'AI בכל שלב',
    onbBody2:
      'אפשר לנסח, לכתוב מחדש ולהסביר ישירות בתוך המסמכים. ה-AI פועל באמצעות חשבון UniWork שלכם.',
    onbNote3:
      'ה-AI הוא אופציונלי. המסמכים שלכם נערכים במחשב שלכם; אין צורך בחשבון כדי לפתוח או לשמור קבצים.',
    onbTitle3: 'הכול מוכן',
    onbBody3: 'פתחו קובץ או צרו מסמך חדש כדי להתחיל.',
  },
  hi: {
    onbSubtitle1: 'दस्तावेज़, स्प्रेडशीट, स्लाइड और PDF — एक ही ऐप में',
    onbBody1:
      'दस्तावेज़ बनाएँ, स्प्रेडशीट तैयार करें, स्लाइड बनाएँ और PDF की समीक्षा करें, यह सब आपके अपने कंप्यूटर पर।',
    onbTitle2: 'हर कदम पर AI',
    onbBody2:
      'अपने दस्तावेज़ों में ही ड्राफ़्ट बनाएँ, दोबारा लिखें और समझाएँ। AI आपके UniWork खाते से चलता है।',
    onbNote3:
      'AI वैकल्पिक है। आपके दस्तावेज़ आपके कंप्यूटर पर ही संपादित होते हैं; फ़ाइलें खोलने या सहेजने के लिए खाते की ज़रूरत नहीं है।',
    onbTitle3: 'सब तैयार है',
    onbBody3: 'शुरू करने के लिए कोई फ़ाइल खोलें या नया दस्तावेज़ बनाएँ।',
  },
}

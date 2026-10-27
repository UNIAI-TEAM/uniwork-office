import { createI18n, defineStrings } from '@genoffice/i18n'

/**
 * Copy of the legacy .doc/.xls/.ppt open flow (progress box and typed error
 * notices, legacy-open.ts). zh defines the key set; every other language must
 * cover it. `{name}` is the file name, `{ext}` the legacy extension.
 */
const legacyOpenStrings = defineStrings({
  zh: {
    legacyConvertingMsg: '正在转换“{name}”…',
    legacyConvertingDetail: '正在把旧版 Office 文件转换为可编辑的新格式，原文件不会被修改。',
    legacyEncrypted: '“{name}”设置了密码，无法转换。请先在原应用中取消密码后再打开。',
    legacyCorrupt:
      '“{name}”已损坏，或不是有效的 {ext} 文件，无法打开。请尝试使用原文件或备份副本。',
    legacyTimeout: '转换“{name}”耗时过长，已停止。请重试，或改用较小的副本。',
    legacyFailed: '无法转换“{name}”。',
    legacyMissing: '无法打开“{name}”：此安装缺少文件转换组件。请重新安装应用。',
    legacyXlsValuesOnly:
      '“{name}”仅以数值打开：因缺少转换组件，公式、图表和部分格式不会保留。重新安装应用即可恢复。',
  },
  en: {
    legacyConvertingMsg: 'Converting “{name}”…',
    legacyConvertingDetail:
      'The older Office file is being converted so you can edit it here. The original file is not changed.',
    legacyEncrypted:
      '“{name}” is password-protected, so it can’t be converted. Remove the password in the app that created it, then open it again.',
    legacyCorrupt:
      '“{name}” is damaged or isn’t a valid {ext} file, so it can’t be opened. Try the original file or a backup copy.',
    legacyTimeout:
      'Converting “{name}” took too long and was stopped. Try again, or open a smaller copy.',
    legacyFailed: '“{name}” couldn’t be converted.',
    legacyMissing:
      '“{name}” can’t be opened because the converter is missing from this installation. Reinstall the app to fix this.',
    legacyXlsValuesOnly:
      '“{name}” was opened with values only: formulas, charts and some formatting are not kept because the converter is missing. Reinstall the app to restore them.',
  },
  vi: {
    legacyConvertingMsg: 'Đang chuyển đổi “{name}”…',
    legacyConvertingDetail:
      'Tệp Office đời cũ đang được chuyển đổi để bạn chỉnh sửa tại đây. Tệp gốc không bị thay đổi.',
    legacyEncrypted:
      '“{name}” được bảo vệ bằng mật khẩu nên không thể chuyển đổi. Hãy gỡ mật khẩu trong ứng dụng đã tạo tệp rồi mở lại.',
    legacyCorrupt:
      '“{name}” bị hỏng hoặc không phải tệp {ext} hợp lệ nên không thể mở. Hãy thử tệp gốc hoặc một bản sao lưu.',
    legacyTimeout:
      'Chuyển đổi “{name}” mất quá nhiều thời gian và đã bị dừng. Hãy thử lại hoặc mở một bản nhỏ hơn.',
    legacyFailed: 'Không thể chuyển đổi “{name}”.',
    legacyMissing:
      'Không thể mở “{name}” vì bản cài đặt này thiếu bộ chuyển đổi. Hãy cài đặt lại ứng dụng.',
    legacyXlsValuesOnly:
      '“{name}” được mở chỉ với giá trị: công thức, biểu đồ và một số định dạng không được giữ lại vì thiếu bộ chuyển đổi. Hãy cài đặt lại ứng dụng để khôi phục chúng.',
  },
  ja: {
    legacyConvertingMsg: '「{name}」を変換しています…',
    legacyConvertingDetail:
      '古い形式の Office ファイルを編集できる形式に変換しています。元のファイルは変更されません。',
    legacyEncrypted:
      '「{name}」はパスワードで保護されているため変換できません。作成したアプリでパスワードを解除してから開き直してください。',
    legacyCorrupt:
      '「{name}」は破損しているか、有効な {ext} ファイルではないため開けません。元のファイルまたはバックアップのコピーをお試しください。',
    legacyTimeout:
      '「{name}」の変換に時間がかかりすぎたため中止しました。もう一度お試しいただくか、小さなコピーを開いてください。',
    legacyFailed: '「{name}」を変換できませんでした。',
    legacyMissing:
      '変換コンポーネントがこのインストールに含まれていないため、「{name}」を開けません。アプリを再インストールしてください。',
    legacyXlsValuesOnly:
      '「{name}」は値のみで開きました。変換コンポーネントがないため、数式・グラフ・一部の書式は保持されません。アプリを再インストールすると復元されます。',
  },
  ko: {
    legacyConvertingMsg: '“{name}” 변환 중…',
    legacyConvertingDetail:
      '이전 형식의 Office 파일을 편집할 수 있도록 변환하고 있습니다. 원본 파일은 변경되지 않습니다.',
    legacyEncrypted:
      '“{name}” 파일은 암호로 보호되어 있어 변환할 수 없습니다. 만든 앱에서 암호를 해제한 뒤 다시 여세요.',
    legacyCorrupt:
      '“{name}” 파일이 손상되었거나 올바른 {ext} 파일이 아니어서 열 수 없습니다. 원본 파일이나 백업 사본을 사용해 보세요.',
    legacyTimeout:
      '“{name}” 변환이 너무 오래 걸려 중단되었습니다. 다시 시도하거나 더 작은 사본을 여세요.',
    legacyFailed: '“{name}” 파일을 변환할 수 없습니다.',
    legacyMissing: '이 설치에 변환기가 없어 “{name}” 파일을 열 수 없습니다. 앱을 다시 설치하세요.',
    legacyXlsValuesOnly:
      '“{name}” 파일을 값만으로 열었습니다. 변환기가 없어 수식, 차트 및 일부 서식은 유지되지 않습니다. 앱을 다시 설치하면 복원됩니다.',
  },
  fr: {
    legacyConvertingMsg: 'Conversion de « {name} »…',
    legacyConvertingDetail:
      'Ce fichier Office ancien format est converti pour pouvoir être modifié ici. Le fichier d’origine n’est pas modifié.',
    legacyEncrypted:
      '« {name} » est protégé par mot de passe et ne peut pas être converti. Supprimez le mot de passe dans l’application d’origine, puis rouvrez-le.',
    legacyCorrupt:
      '« {name} » est endommagé ou n’est pas un fichier {ext} valide ; il ne peut pas être ouvert. Essayez le fichier d’origine ou une copie de sauvegarde.',
    legacyTimeout:
      'La conversion de « {name} » a pris trop de temps et a été arrêtée. Réessayez ou ouvrez une copie plus petite.',
    legacyFailed: '« {name} » n’a pas pu être converti.',
    legacyMissing:
      '« {name} » ne peut pas être ouvert : le convertisseur est absent de cette installation. Réinstallez l’application.',
    legacyXlsValuesOnly:
      '« {name} » a été ouvert avec les valeurs uniquement : les formules, graphiques et une partie de la mise en forme ne sont pas conservés, faute de convertisseur. Réinstallez l’application pour les rétablir.',
  },
  de: {
    legacyConvertingMsg: '„{name}“ wird konvertiert…',
    legacyConvertingDetail:
      'Die ältere Office-Datei wird konvertiert, damit Sie sie hier bearbeiten können. Die Originaldatei bleibt unverändert.',
    legacyEncrypted:
      '„{name}“ ist passwortgeschützt und kann nicht konvertiert werden. Entfernen Sie das Passwort in der erstellenden App und öffnen Sie die Datei erneut.',
    legacyCorrupt:
      '„{name}“ ist beschädigt oder keine gültige {ext}-Datei und kann nicht geöffnet werden. Versuchen Sie es mit der Originaldatei oder einer Sicherungskopie.',
    legacyTimeout:
      'Die Konvertierung von „{name}“ dauerte zu lange und wurde abgebrochen. Versuchen Sie es erneut oder öffnen Sie eine kleinere Kopie.',
    legacyFailed: '„{name}“ konnte nicht konvertiert werden.',
    legacyMissing:
      '„{name}“ kann nicht geöffnet werden, weil der Konverter in dieser Installation fehlt. Installieren Sie die App neu.',
    legacyXlsValuesOnly:
      '„{name}“ wurde nur mit Werten geöffnet: Formeln, Diagramme und ein Teil der Formatierung bleiben ohne Konverter nicht erhalten. Installieren Sie die App neu, um sie wiederherzustellen.',
  },
  es: {
    legacyConvertingMsg: 'Convirtiendo «{name}»…',
    legacyConvertingDetail:
      'Se está convirtiendo el archivo de Office antiguo para que pueda editarlo aquí. El archivo original no se modifica.',
    legacyEncrypted:
      '«{name}» está protegido con contraseña y no se puede convertir. Quite la contraseña en la aplicación que lo creó y vuelva a abrirlo.',
    legacyCorrupt:
      '«{name}» está dañado o no es un archivo {ext} válido, por lo que no se puede abrir. Pruebe con el archivo original o una copia de seguridad.',
    legacyTimeout:
      'La conversión de «{name}» tardó demasiado y se detuvo. Inténtelo de nuevo o abra una copia más pequeña.',
    legacyFailed: 'No se pudo convertir «{name}».',
    legacyMissing:
      'No se puede abrir «{name}» porque falta el conversor en esta instalación. Reinstale la aplicación.',
    legacyXlsValuesOnly:
      '«{name}» se abrió solo con valores: sin el conversor no se conservan las fórmulas, los gráficos ni parte del formato. Reinstale la aplicación para recuperarlos.',
  },
  th: {
    legacyConvertingMsg: 'กำลังแปลง “{name}”…',
    legacyConvertingDetail:
      'กำลังแปลงไฟล์ Office รุ่นเก่าเพื่อให้แก้ไขที่นี่ได้ ไฟล์ต้นฉบับจะไม่ถูกเปลี่ยนแปลง',
    legacyEncrypted:
      '“{name}” ถูกป้องกันด้วยรหัสผ่านจึงแปลงไม่ได้ โปรดนำรหัสผ่านออกในแอปที่สร้างไฟล์ แล้วเปิดใหม่อีกครั้ง',
    legacyCorrupt:
      '“{name}” เสียหายหรือไม่ใช่ไฟล์ {ext} ที่ถูกต้อง จึงเปิดไม่ได้ ลองใช้ไฟล์ต้นฉบับหรือสำเนาสำรอง',
    legacyTimeout:
      'การแปลง “{name}” ใช้เวลานานเกินไปและถูกหยุด โปรดลองอีกครั้งหรือเปิดสำเนาที่เล็กกว่า',
    legacyFailed: 'แปลง “{name}” ไม่ได้',
    legacyMissing: 'เปิด “{name}” ไม่ได้ เพราะการติดตั้งนี้ไม่มีตัวแปลง โปรดติดตั้งแอปใหม่',
    legacyXlsValuesOnly:
      'เปิด “{name}” ด้วยค่าเท่านั้น: สูตร แผนภูมิ และการจัดรูปแบบบางส่วนจะไม่ถูกเก็บไว้ เพราะไม่มีตัวแปลง ติดตั้งแอปใหม่เพื่อกู้คืน',
  },
  id: {
    legacyConvertingMsg: 'Mengonversi “{name}”…',
    legacyConvertingDetail:
      'File Office lama sedang dikonversi agar dapat diedit di sini. File asli tidak diubah.',
    legacyEncrypted:
      '“{name}” dilindungi kata sandi sehingga tidak dapat dikonversi. Hapus kata sandi di aplikasi pembuatnya, lalu buka lagi.',
    legacyCorrupt:
      '“{name}” rusak atau bukan file {ext} yang valid sehingga tidak dapat dibuka. Coba file asli atau salinan cadangan.',
    legacyTimeout:
      'Konversi “{name}” terlalu lama dan dihentikan. Coba lagi atau buka salinan yang lebih kecil.',
    legacyFailed: '“{name}” tidak dapat dikonversi.',
    legacyMissing:
      '“{name}” tidak dapat dibuka karena pengonversi tidak ada di instalasi ini. Instal ulang aplikasi.',
    legacyXlsValuesOnly:
      '“{name}” dibuka hanya dengan nilai: rumus, bagan, dan sebagian format tidak dipertahankan karena pengonversi tidak ada. Instal ulang aplikasi untuk memulihkannya.',
  },
  ru: {
    legacyConvertingMsg: 'Преобразование «{name}»…',
    legacyConvertingDetail:
      'Файл Office старого формата преобразуется, чтобы его можно было редактировать здесь. Исходный файл не изменяется.',
    legacyEncrypted:
      '«{name}» защищён паролем, поэтому его нельзя преобразовать. Снимите пароль в приложении, где файл был создан, и откройте его снова.',
    legacyCorrupt:
      '«{name}» повреждён или не является допустимым файлом {ext}, поэтому его нельзя открыть. Попробуйте исходный файл или резервную копию.',
    legacyTimeout:
      'Преобразование «{name}» заняло слишком много времени и было остановлено. Повторите попытку или откройте копию меньшего размера.',
    legacyFailed: 'Не удалось преобразовать «{name}».',
    legacyMissing:
      'Не удаётся открыть «{name}»: в этой установке нет конвертера. Переустановите приложение.',
    legacyXlsValuesOnly:
      '«{name}» открыт только со значениями: без конвертера формулы, диаграммы и часть форматирования не сохраняются. Переустановите приложение, чтобы вернуть их.',
  },
  ar: {
    legacyConvertingMsg: 'جارٍ تحويل «{name}»…',
    legacyConvertingDetail:
      'يجري تحويل ملف Office القديم لتتمكن من تحريره هنا. لن يتغير الملف الأصلي.',
    legacyEncrypted:
      '«{name}» محمي بكلمة مرور ولا يمكن تحويله. أزل كلمة المرور في التطبيق الذي أنشأه ثم افتحه مرة أخرى.',
    legacyCorrupt:
      '«{name}» تالف أو ليس ملف {ext} صالحًا، لذا لا يمكن فتحه. جرّب الملف الأصلي أو نسخة احتياطية.',
    legacyTimeout:
      'استغرق تحويل «{name}» وقتًا طويلًا جدًا وتم إيقافه. حاول مرة أخرى أو افتح نسخة أصغر.',
    legacyFailed: 'تعذّر تحويل «{name}».',
    legacyMissing: 'لا يمكن فتح «{name}» لأن المحوّل غير موجود في هذا التثبيت. أعد تثبيت التطبيق.',
    legacyXlsValuesOnly:
      'فُتح «{name}» بالقيم فقط: لا تُحفظ الصيغ والمخططات وبعض التنسيقات لأن المحوّل غير موجود. أعد تثبيت التطبيق لاستعادتها.',
  },
  pt: {
    legacyConvertingMsg: 'Convertendo “{name}”…',
    legacyConvertingDetail:
      'O arquivo Office antigo está sendo convertido para que você possa editá-lo aqui. O arquivo original não é alterado.',
    legacyEncrypted:
      '“{name}” está protegido por senha e não pode ser convertido. Remova a senha no aplicativo que o criou e abra-o novamente.',
    legacyCorrupt:
      '“{name}” está danificado ou não é um arquivo {ext} válido e não pode ser aberto. Tente o arquivo original ou uma cópia de backup.',
    legacyTimeout:
      'A conversão de “{name}” demorou demais e foi interrompida. Tente novamente ou abra uma cópia menor.',
    legacyFailed: 'Não foi possível converter “{name}”.',
    legacyMissing:
      'Não é possível abrir “{name}” porque o conversor não está nesta instalação. Reinstale o aplicativo.',
    legacyXlsValuesOnly:
      '“{name}” foi aberto apenas com valores: sem o conversor, fórmulas, gráficos e parte da formatação não são mantidos. Reinstale o aplicativo para restaurá-los.',
  },
  it: {
    legacyConvertingMsg: 'Conversione di “{name}”…',
    legacyConvertingDetail:
      'Il file Office di vecchio formato viene convertito per poterlo modificare qui. Il file originale non viene modificato.',
    legacyEncrypted:
      '“{name}” è protetto da password e non può essere convertito. Rimuovi la password nell’app che lo ha creato e riaprilo.',
    legacyCorrupt:
      '“{name}” è danneggiato o non è un file {ext} valido, quindi non può essere aperto. Prova il file originale o una copia di backup.',
    legacyTimeout:
      'La conversione di “{name}” ha richiesto troppo tempo ed è stata interrotta. Riprova o apri una copia più piccola.',
    legacyFailed: 'Impossibile convertire “{name}”.',
    legacyMissing:
      'Impossibile aprire “{name}” perché il convertitore manca in questa installazione. Reinstalla l’app.',
    legacyXlsValuesOnly:
      '“{name}” è stato aperto solo con i valori: senza il convertitore formule, grafici e parte della formattazione non vengono mantenuti. Reinstalla l’app per ripristinarli.',
  },
  pl: {
    legacyConvertingMsg: 'Konwertowanie „{name}”…',
    legacyConvertingDetail:
      'Starszy plik Office jest konwertowany, aby można go było edytować tutaj. Oryginalny plik nie jest zmieniany.',
    legacyEncrypted:
      '„{name}” jest chroniony hasłem i nie można go skonwertować. Usuń hasło w aplikacji, w której utworzono plik, i otwórz go ponownie.',
    legacyCorrupt:
      '„{name}” jest uszkodzony lub nie jest prawidłowym plikiem {ext}, więc nie można go otworzyć. Spróbuj użyć oryginalnego pliku lub kopii zapasowej.',
    legacyTimeout:
      'Konwersja „{name}” trwała zbyt długo i została zatrzymana. Spróbuj ponownie lub otwórz mniejszą kopię.',
    legacyFailed: 'Nie udało się skonwertować „{name}”.',
    legacyMissing:
      'Nie można otworzyć „{name}”, ponieważ w tej instalacji brakuje konwertera. Zainstaluj aplikację ponownie.',
    legacyXlsValuesOnly:
      '„{name}” otwarto tylko z wartościami: bez konwertera formuły, wykresy i część formatowania nie są zachowane. Zainstaluj aplikację ponownie, aby je przywrócić.',
  },
  cs: {
    legacyConvertingMsg: 'Převádí se „{name}“…',
    legacyConvertingDetail:
      'Starší soubor Office se převádí, aby jej šlo upravovat zde. Původní soubor se nemění.',
    legacyEncrypted:
      '„{name}“ je chráněn heslem, a proto jej nelze převést. Odeberte heslo v aplikaci, která soubor vytvořila, a otevřete jej znovu.',
    legacyCorrupt:
      '„{name}“ je poškozený nebo to není platný soubor {ext}, a proto jej nelze otevřít. Zkuste původní soubor nebo záložní kopii.',
    legacyTimeout:
      'Převod „{name}“ trval příliš dlouho a byl zastaven. Zkuste to znovu nebo otevřete menší kopii.',
    legacyFailed: 'Soubor „{name}“ se nepodařilo převést.',
    legacyMissing:
      'Soubor „{name}“ nelze otevřít, protože v této instalaci chybí převodník. Nainstalujte aplikaci znovu.',
    legacyXlsValuesOnly:
      'Soubor „{name}“ byl otevřen jen s hodnotami: bez převodníku se nezachovají vzorce, grafy ani část formátování. Nainstalujte aplikaci znovu, aby se obnovily.',
  },
  nl: {
    legacyConvertingMsg: '“{name}” wordt geconverteerd…',
    legacyConvertingDetail:
      'Het oudere Office-bestand wordt geconverteerd zodat u het hier kunt bewerken. Het originele bestand blijft ongewijzigd.',
    legacyEncrypted:
      '“{name}” is met een wachtwoord beveiligd en kan niet worden geconverteerd. Verwijder het wachtwoord in de app waarmee het is gemaakt en open het opnieuw.',
    legacyCorrupt:
      '“{name}” is beschadigd of geen geldig {ext}-bestand en kan niet worden geopend. Probeer het originele bestand of een back-up.',
    legacyTimeout:
      'Het converteren van “{name}” duurde te lang en is gestopt. Probeer het opnieuw of open een kleinere kopie.',
    legacyFailed: '“{name}” kan niet worden geconverteerd.',
    legacyMissing:
      '“{name}” kan niet worden geopend omdat de converter in deze installatie ontbreekt. Installeer de app opnieuw.',
    legacyXlsValuesOnly:
      '“{name}” is alleen met waarden geopend: zonder converter blijven formules, grafieken en een deel van de opmaak niet behouden. Installeer de app opnieuw om ze te herstellen.',
  },
  ms: {
    legacyConvertingMsg: 'Menukar “{name}”…',
    legacyConvertingDetail:
      'Fail Office lama sedang ditukar supaya anda boleh mengeditnya di sini. Fail asal tidak diubah.',
    legacyEncrypted:
      '“{name}” dilindungi kata laluan dan tidak boleh ditukar. Alih keluar kata laluan dalam aplikasi yang mencipta fail itu, kemudian buka semula.',
    legacyCorrupt:
      '“{name}” rosak atau bukan fail {ext} yang sah, jadi tidak boleh dibuka. Cuba fail asal atau salinan sandaran.',
    legacyTimeout:
      'Penukaran “{name}” mengambil masa terlalu lama dan dihentikan. Cuba lagi atau buka salinan yang lebih kecil.',
    legacyFailed: '“{name}” tidak dapat ditukar.',
    legacyMissing:
      '“{name}” tidak boleh dibuka kerana penukar tiada dalam pemasangan ini. Pasang semula aplikasi.',
    legacyXlsValuesOnly:
      '“{name}” dibuka dengan nilai sahaja: formula, carta dan sebahagian pemformatan tidak dikekalkan kerana penukar tiada. Pasang semula aplikasi untuk memulihkannya.',
  },
  he: {
    legacyConvertingMsg: 'ממיר את “{name}”…',
    legacyConvertingDetail:
      'קובץ ה-Office הישן מומר כדי שתוכלו לערוך אותו כאן. קובץ המקור אינו משתנה.',
    legacyEncrypted:
      '“{name}” מוגן בסיסמה ולכן אי אפשר להמיר אותו. הסירו את הסיסמה ביישום שיצר אותו ופתחו אותו שוב.',
    legacyCorrupt:
      '“{name}” פגום או שאינו קובץ {ext} תקין, ולכן אי אפשר לפתוח אותו. נסו את קובץ המקור או עותק גיבוי.',
    legacyTimeout: 'המרת “{name}” נמשכה זמן רב מדי ונעצרה. נסו שוב או פתחו עותק קטן יותר.',
    legacyFailed: 'לא ניתן להמיר את “{name}”.',
    legacyMissing: 'לא ניתן לפתוח את “{name}” כי המַמיר חסר בהתקנה זו. התקינו את היישום מחדש.',
    legacyXlsValuesOnly:
      '“{name}” נפתח עם ערכים בלבד: נוסחאות, תרשימים וחלק מהעיצוב אינם נשמרים כי המַמיר חסר. התקינו את היישום מחדש כדי לשחזר אותם.',
  },
  hi: {
    legacyConvertingMsg: '“{name}” को बदला जा रहा है…',
    legacyConvertingDetail:
      'पुरानी Office फ़ाइल को बदला जा रहा है ताकि आप उसे यहाँ संपादित कर सकें। मूल फ़ाइल में कोई बदलाव नहीं होता।',
    legacyEncrypted:
      '“{name}” पासवर्ड से सुरक्षित है, इसलिए उसे बदला नहीं जा सकता। जिस ऐप में बनी थी उसमें पासवर्ड हटाएँ और फिर खोलें।',
    legacyCorrupt:
      '“{name}” क्षतिग्रस्त है या मान्य {ext} फ़ाइल नहीं है, इसलिए खुल नहीं सकती। मूल फ़ाइल या बैकअप प्रति आज़माएँ।',
    legacyTimeout:
      '“{name}” को बदलने में बहुत समय लगा और उसे रोक दिया गया। फिर कोशिश करें या छोटी प्रति खोलें।',
    legacyFailed: '“{name}” को बदला नहीं जा सका।',
    legacyMissing:
      '“{name}” नहीं खुल सकती क्योंकि इस इंस्टॉलेशन में कन्वर्टर नहीं है। ऐप को दोबारा इंस्टॉल करें।',
    legacyXlsValuesOnly:
      '“{name}” केवल मानों के साथ खोली गई: कन्वर्टर न होने से सूत्र, चार्ट और कुछ फ़ॉर्मैटिंग सुरक्षित नहीं रहती। इन्हें वापस पाने के लिए ऐप को दोबारा इंस्टॉल करें।',
  },
  'zh-TW': {
    legacyConvertingMsg: '正在轉換「{name}」…',
    legacyConvertingDetail: '正在把舊版 Office 檔案轉換為可編輯的新格式，原始檔案不會被修改。',
    legacyEncrypted: '「{name}」設有密碼，無法轉換。請先在原應用程式中移除密碼後再開啟。',
    legacyCorrupt:
      '「{name}」已損毀，或不是有效的 {ext} 檔案，無法開啟。請嘗試使用原始檔案或備份副本。',
    legacyTimeout: '轉換「{name}」耗時過長，已停止。請重試，或改用較小的副本。',
    legacyFailed: '無法轉換「{name}」。',
    legacyMissing: '無法開啟「{name}」：此安裝缺少檔案轉換元件。請重新安裝應用程式。',
    legacyXlsValuesOnly:
      '「{name}」僅以數值開啟：因缺少轉換元件，公式、圖表與部分格式不會保留。重新安裝應用程式即可恢復。',
  },
})

export type LegacyOpenStringKey = keyof typeof legacyOpenStrings.zh

export const tLegacyOpen = createI18n(legacyOpenStrings)

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
    legacyOdfDetail: '正在把 OpenDocument 文件转换为可编辑的新格式，原文件不会被修改。',
    legacyEncrypted: '“{name}”设置了密码，无法转换。请先在原应用中取消密码后再打开。',
    legacyCorrupt:
      '“{name}”已损坏，或不是有效的 {ext} 文件，无法打开。请尝试使用原文件或备份副本。',
    legacyTimeout: '转换“{name}”耗时过长，已停止。请重试，或改用较小的副本。',
    legacyFailed: '无法转换“{name}”。',
    legacyMissing: '无法打开“{name}”：此安装缺少文件转换组件。请重新安装应用。',
    legacyXlsValuesOnly:
      '“{name}”仅以数值打开：因缺少转换组件，公式、图表和部分格式不会保留。重新安装应用即可恢复。',
    legacyOdfSimplified:
      '“{name}”已使用简化转换方式打开，排版可能与原件略有差异。重新安装应用即可恢复完整转换。',
    legacyOdfDropped: '“{name}”中有部分内容未能完整保留：{items}。重新安装应用即可恢复完整转换。',
    legacyOdfListSep: '、',
    legacyOdfDropFootnotes: '脚注（{count}）',
    legacyOdfDropComments: '批注（{count}）',
    legacyOdfDropTextboxesFlattened: '文本框（{count}，已转为纯文本）',
    legacyOdfDropShapes: '图形（{count}）',
    legacyOdfDropImages: '图片（{count}）',
    legacyOdfDropObjects: '嵌入对象（{count}）',
    legacyOdfDropTables: '表格（{count}）',
    legacyOdfDropNestedTables: '嵌套表格（{count}）',
    legacyOdfDropNotes: '演讲者备注（{count}）',
    legacyOdfDropFramesWithoutGeometry: '未定位的图文框（{count}）',
    legacyOdfDropStaleIndexes: '目录与索引（{count}）',
    legacyOdfDropUnhandledBlocks: '不支持的段落块（{count}）',
    legacyOdfDropHeadersFooters: '页眉与页脚（{count}）',
    legacyOdfDropTrackedChanges: '修订记录（{count}）',
    legacyOdfDropOther: '其他项目（{count}）',
  } satisfies Record<string, string>,
  en: {
    legacyConvertingMsg: 'Converting “{name}”…',
    legacyConvertingDetail:
      'The older Office file is being converted so you can edit it here. The original file is not changed.',
    legacyOdfDetail:
      'The OpenDocument file is being converted so you can edit it here. The original file is not changed.',
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
    legacyOdfSimplified:
      '“{name}” was opened with a simpler converter, so the layout may differ from the original. Reinstall the app to restore full fidelity.',
    legacyOdfDropped:
      'Some parts of “{name}” could not be carried over: {items}. Reinstall the app to restore full fidelity.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'footnotes ({count})',
    legacyOdfDropComments: 'comments ({count})',
    legacyOdfDropTextboxesFlattened: 'text boxes ({count}, shown as plain text)',
    legacyOdfDropShapes: 'shapes ({count})',
    legacyOdfDropImages: 'images ({count})',
    legacyOdfDropObjects: 'embedded objects ({count})',
    legacyOdfDropTables: 'tables ({count})',
    legacyOdfDropNestedTables: 'nested tables ({count})',
    legacyOdfDropNotes: 'speaker notes ({count})',
    legacyOdfDropFramesWithoutGeometry: 'unpositioned frames ({count})',
    legacyOdfDropStaleIndexes: 'indexes ({count})',
    legacyOdfDropUnhandledBlocks: 'unsupported blocks ({count})',
    legacyOdfDropHeadersFooters: 'headers and footers ({count})',
    legacyOdfDropTrackedChanges: 'tracked changes ({count})',
    legacyOdfDropOther: 'other items ({count})',
  },
  vi: {
    legacyConvertingMsg: 'Đang chuyển đổi “{name}”…',
    legacyConvertingDetail:
      'Tệp Office đời cũ đang được chuyển đổi để bạn chỉnh sửa tại đây. Tệp gốc không bị thay đổi.',
    legacyOdfDetail:
      'Tệp OpenDocument đang được chuyển đổi để bạn chỉnh sửa tại đây. Tệp gốc không bị thay đổi.',
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
    legacyOdfSimplified:
      '“{name}” được mở bằng bộ chuyển đổi rút gọn nên bố cục có thể khác đôi chút so với bản gốc. Hãy cài đặt lại ứng dụng để khôi phục chuyển đổi đầy đủ.',
    legacyOdfDropped:
      'Một số phần của “{name}” không thể giữ nguyên khi chuyển đổi: {items}. Hãy cài đặt lại ứng dụng để khôi phục chuyển đổi đầy đủ.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'chú thích cuối trang ({count})',
    legacyOdfDropComments: 'nhận xét ({count})',
    legacyOdfDropTextboxesFlattened: 'hộp văn bản ({count}, hiển thị dạng văn bản thuần)',
    legacyOdfDropShapes: 'hình vẽ ({count})',
    legacyOdfDropImages: 'hình ảnh ({count})',
    legacyOdfDropObjects: 'đối tượng nhúng ({count})',
    legacyOdfDropTables: 'bảng ({count})',
    legacyOdfDropNestedTables: 'bảng lồng nhau ({count})',
    legacyOdfDropNotes: 'ghi chú diễn giả ({count})',
    legacyOdfDropFramesWithoutGeometry: 'khung chưa có vị trí ({count})',
    legacyOdfDropStaleIndexes: 'mục lục và chỉ mục ({count})',
    legacyOdfDropUnhandledBlocks: 'khối nội dung chưa hỗ trợ ({count})',
    legacyOdfDropHeadersFooters: 'đầu trang và chân trang ({count})',
    legacyOdfDropTrackedChanges: 'thay đổi được theo dõi ({count})',
    legacyOdfDropOther: 'mục khác ({count})',
  },
  ja: {
    legacyConvertingMsg: '「{name}」を変換しています…',
    legacyConvertingDetail:
      '古い形式の Office ファイルを編集できる形式に変換しています。元のファイルは変更されません。',
    legacyOdfDetail:
      'OpenDocument ファイルを編集できる形式に変換しています。元のファイルは変更されません。',
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
    legacyOdfSimplified:
      '「{name}」は簡易変換で開いたため、元のレイアウトと異なる場合があります。アプリを再インストールすると通常の変換に戻ります。',
    legacyOdfDropped:
      '「{name}」の一部の要素は引き継げませんでした：{items}。アプリを再インストールすると通常の変換に戻ります。',
    legacyOdfListSep: '、',
    legacyOdfDropFootnotes: '脚注（{count}）',
    legacyOdfDropComments: 'コメント（{count}）',
    legacyOdfDropTextboxesFlattened: 'テキストボックス（{count}、テキストとして表示）',
    legacyOdfDropShapes: '図形（{count}）',
    legacyOdfDropImages: '画像（{count}）',
    legacyOdfDropObjects: '埋め込みオブジェクト（{count}）',
    legacyOdfDropTables: '表（{count}）',
    legacyOdfDropNestedTables: '入れ子の表（{count}）',
    legacyOdfDropNotes: '発表者ノート（{count}）',
    legacyOdfDropFramesWithoutGeometry: '位置未指定のフレーム（{count}）',
    legacyOdfDropStaleIndexes: '目次・索引（{count}）',
    legacyOdfDropUnhandledBlocks: '未対応のブロック（{count}）',
    legacyOdfDropHeadersFooters: 'ヘッダー・フッター（{count}）',
    legacyOdfDropTrackedChanges: '変更履歴（{count}）',
    legacyOdfDropOther: 'その他の項目（{count}）',
  },
  ko: {
    legacyConvertingMsg: '“{name}” 변환 중…',
    legacyConvertingDetail:
      '이전 형식의 Office 파일을 편집할 수 있도록 변환하고 있습니다. 원본 파일은 변경되지 않습니다.',
    legacyOdfDetail:
      'OpenDocument 파일을 편집할 수 있도록 변환하고 있습니다. 원본 파일은 변경되지 않습니다.',
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
    legacyOdfSimplified:
      '“{name}” 파일을 간소화된 변환기로 열어 레이아웃이 원본과 다를 수 있습니다. 앱을 다시 설치하면 전체 변환이 복원됩니다.',
    legacyOdfDropped:
      '“{name}” 파일의 일부 항목을 가져오지 못했습니다: {items}. 앱을 다시 설치하면 전체 변환이 복원됩니다.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: '각주({count})',
    legacyOdfDropComments: '메모({count})',
    legacyOdfDropTextboxesFlattened: '텍스트 상자({count}, 일반 텍스트로 표시됨)',
    legacyOdfDropShapes: '도형({count})',
    legacyOdfDropImages: '이미지({count})',
    legacyOdfDropObjects: '포함된 개체({count})',
    legacyOdfDropTables: '표({count})',
    legacyOdfDropNestedTables: '중첩 표({count})',
    legacyOdfDropNotes: '발표자 노트({count})',
    legacyOdfDropFramesWithoutGeometry: '위치가 지정되지 않은 프레임({count})',
    legacyOdfDropStaleIndexes: '색인({count})',
    legacyOdfDropUnhandledBlocks: '지원되지 않는 블록({count})',
    legacyOdfDropHeadersFooters: '머리글 및 바닥글({count})',
    legacyOdfDropTrackedChanges: '변경 내용 추적({count})',
    legacyOdfDropOther: '기타 항목({count})',
  },
  fr: {
    legacyConvertingMsg: 'Conversion de « {name} »…',
    legacyConvertingDetail:
      'Ce fichier Office ancien format est converti pour pouvoir être modifié ici. Le fichier d’origine n’est pas modifié.',
    legacyOdfDetail:
      'Ce fichier OpenDocument est converti pour pouvoir être modifié ici. Le fichier d’origine n’est pas modifié.',
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
    legacyOdfSimplified:
      '« {name} » a été ouvert avec un convertisseur simplifié ; la mise en page peut différer de l’original. Réinstallez l’application pour rétablir la conversion complète.',
    legacyOdfDropped:
      'Certains éléments de « {name} » n’ont pas pu être repris : {items}. Réinstallez l’application pour rétablir la conversion complète.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'notes de bas de page ({count})',
    legacyOdfDropComments: 'commentaires ({count})',
    legacyOdfDropTextboxesFlattened: 'zones de texte ({count}, affichées en texte brut)',
    legacyOdfDropShapes: 'formes ({count})',
    legacyOdfDropImages: 'images ({count})',
    legacyOdfDropObjects: 'objets incorporés ({count})',
    legacyOdfDropTables: 'tableaux ({count})',
    legacyOdfDropNestedTables: 'tableaux imbriqués ({count})',
    legacyOdfDropNotes: 'notes du présentateur ({count})',
    legacyOdfDropFramesWithoutGeometry: 'cadres sans position ({count})',
    legacyOdfDropStaleIndexes: 'index ({count})',
    legacyOdfDropUnhandledBlocks: 'blocs non pris en charge ({count})',
    legacyOdfDropHeadersFooters: 'en-têtes et pieds de page ({count})',
    legacyOdfDropTrackedChanges: 'modifications suivies ({count})',
    legacyOdfDropOther: 'autres éléments ({count})',
  },
  de: {
    legacyConvertingMsg: '„{name}“ wird konvertiert…',
    legacyConvertingDetail:
      'Die ältere Office-Datei wird konvertiert, damit Sie sie hier bearbeiten können. Die Originaldatei bleibt unverändert.',
    legacyOdfDetail:
      'Die OpenDocument-Datei wird konvertiert, damit Sie sie hier bearbeiten können. Die Originaldatei bleibt unverändert.',
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
    legacyOdfSimplified:
      '„{name}“ wurde mit einem vereinfachten Konverter geöffnet, daher kann das Layout vom Original abweichen. Installieren Sie die App neu, um die vollständige Konvertierung wiederherzustellen.',
    legacyOdfDropped:
      'Einige Teile von „{name}“ konnten nicht übernommen werden: {items}. Installieren Sie die App neu, um die vollständige Konvertierung wiederherzustellen.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'Fußnoten ({count})',
    legacyOdfDropComments: 'Kommentare ({count})',
    legacyOdfDropTextboxesFlattened: 'Textfelder ({count}, als einfacher Text angezeigt)',
    legacyOdfDropShapes: 'Formen ({count})',
    legacyOdfDropImages: 'Bilder ({count})',
    legacyOdfDropObjects: 'eingebettete Objekte ({count})',
    legacyOdfDropTables: 'Tabellen ({count})',
    legacyOdfDropNestedTables: 'verschachtelte Tabellen ({count})',
    legacyOdfDropNotes: 'Sprechernotizen ({count})',
    legacyOdfDropFramesWithoutGeometry: 'Rahmen ohne Position ({count})',
    legacyOdfDropStaleIndexes: 'Verzeichnisse ({count})',
    legacyOdfDropUnhandledBlocks: 'nicht unterstützte Blöcke ({count})',
    legacyOdfDropHeadersFooters: 'Kopf- und Fußzeilen ({count})',
    legacyOdfDropTrackedChanges: 'nachverfolgte Änderungen ({count})',
    legacyOdfDropOther: 'weitere Elemente ({count})',
  },
  es: {
    legacyConvertingMsg: 'Convirtiendo «{name}»…',
    legacyConvertingDetail:
      'Se está convirtiendo el archivo de Office antiguo para que pueda editarlo aquí. El archivo original no se modifica.',
    legacyOdfDetail:
      'Se está convirtiendo el archivo OpenDocument para que pueda editarlo aquí. El archivo original no se modifica.',
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
    legacyOdfSimplified:
      '«{name}» se abrió con un conversor simplificado, por lo que el diseño puede diferir del original. Reinstale la aplicación para recuperar la conversión completa.',
    legacyOdfDropped:
      'Algunas partes de «{name}» no se pudieron conservar: {items}. Reinstale la aplicación para recuperar la conversión completa.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'notas al pie ({count})',
    legacyOdfDropComments: 'comentarios ({count})',
    legacyOdfDropTextboxesFlattened: 'cuadros de texto ({count}, mostrados como texto sin formato)',
    legacyOdfDropShapes: 'formas ({count})',
    legacyOdfDropImages: 'imágenes ({count})',
    legacyOdfDropObjects: 'objetos incrustados ({count})',
    legacyOdfDropTables: 'tablas ({count})',
    legacyOdfDropNestedTables: 'tablas anidadas ({count})',
    legacyOdfDropNotes: 'notas del orador ({count})',
    legacyOdfDropFramesWithoutGeometry: 'marcos sin posición ({count})',
    legacyOdfDropStaleIndexes: 'índices ({count})',
    legacyOdfDropUnhandledBlocks: 'bloques no admitidos ({count})',
    legacyOdfDropHeadersFooters: 'encabezados y pies de página ({count})',
    legacyOdfDropTrackedChanges: 'cambios realizados ({count})',
    legacyOdfDropOther: 'otros elementos ({count})',
  },
  th: {
    legacyConvertingMsg: 'กำลังแปลง “{name}”…',
    legacyConvertingDetail:
      'กำลังแปลงไฟล์ Office รุ่นเก่าเพื่อให้แก้ไขที่นี่ได้ ไฟล์ต้นฉบับจะไม่ถูกเปลี่ยนแปลง',
    legacyOdfDetail:
      'กำลังแปลงไฟล์ OpenDocument เพื่อให้แก้ไขที่นี่ได้ ไฟล์ต้นฉบับจะไม่ถูกเปลี่ยนแปลง',
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
    legacyOdfSimplified:
      'เปิด “{name}” ด้วยตัวแปลงแบบย่อ จึงอาจมีเค้าโครงต่างจากต้นฉบับ ติดตั้งแอปใหม่เพื่อกู้คืนการแปลงแบบเต็ม',
    legacyOdfDropped:
      'บางส่วนของ “{name}” ไม่สามารถนำมาด้วยได้: {items} ติดตั้งแอปใหม่เพื่อกู้คืนการแปลงแบบเต็ม',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'เชิงอรรถ ({count})',
    legacyOdfDropComments: 'ความคิดเห็น ({count})',
    legacyOdfDropTextboxesFlattened: 'กล่องข้อความ ({count}, แสดงเป็นข้อความธรรมดา)',
    legacyOdfDropShapes: 'รูปร่าง ({count})',
    legacyOdfDropImages: 'รูปภาพ ({count})',
    legacyOdfDropObjects: 'วัตถุฝังตัว ({count})',
    legacyOdfDropTables: 'ตาราง ({count})',
    legacyOdfDropNestedTables: 'ตารางซ้อน ({count})',
    legacyOdfDropNotes: 'บันทึกย่อของผู้บรรยาย ({count})',
    legacyOdfDropFramesWithoutGeometry: 'เฟรมที่ไม่มีตำแหน่ง ({count})',
    legacyOdfDropStaleIndexes: 'ดัชนี ({count})',
    legacyOdfDropUnhandledBlocks: 'บล็อกที่ไม่รองรับ ({count})',
    legacyOdfDropHeadersFooters: 'หัวกระดาษและท้ายกระดาษ ({count})',
    legacyOdfDropTrackedChanges: 'การติดตามการแก้ไข ({count})',
    legacyOdfDropOther: 'รายการอื่น ({count})',
  },
  id: {
    legacyConvertingMsg: 'Mengonversi “{name}”…',
    legacyConvertingDetail:
      'File Office lama sedang dikonversi agar dapat diedit di sini. File asli tidak diubah.',
    legacyOdfDetail:
      'File OpenDocument sedang dikonversi agar dapat diedit di sini. File asli tidak diubah.',
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
    legacyOdfSimplified:
      '“{name}” dibuka dengan pengonversi sederhana, sehingga tata letaknya mungkin berbeda dari aslinya. Instal ulang aplikasi untuk memulihkan konversi penuh.',
    legacyOdfDropped:
      'Beberapa bagian dari “{name}” tidak dapat disertakan: {items}. Instal ulang aplikasi untuk memulihkan konversi penuh.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'catatan kaki ({count})',
    legacyOdfDropComments: 'komentar ({count})',
    legacyOdfDropTextboxesFlattened: 'kotak teks ({count}, ditampilkan sebagai teks biasa)',
    legacyOdfDropShapes: 'bentuk ({count})',
    legacyOdfDropImages: 'gambar ({count})',
    legacyOdfDropObjects: 'objek tertanam ({count})',
    legacyOdfDropTables: 'tabel ({count})',
    legacyOdfDropNestedTables: 'tabel bersarang ({count})',
    legacyOdfDropNotes: 'catatan pembicara ({count})',
    legacyOdfDropFramesWithoutGeometry: 'bingkai tanpa posisi ({count})',
    legacyOdfDropStaleIndexes: 'indeks ({count})',
    legacyOdfDropUnhandledBlocks: 'blok tidak didukung ({count})',
    legacyOdfDropHeadersFooters: 'header dan footer ({count})',
    legacyOdfDropTrackedChanges: 'perubahan terlacak ({count})',
    legacyOdfDropOther: 'item lainnya ({count})',
  },
  ru: {
    legacyConvertingMsg: 'Преобразование «{name}»…',
    legacyConvertingDetail:
      'Файл Office старого формата преобразуется, чтобы его можно было редактировать здесь. Исходный файл не изменяется.',
    legacyOdfDetail:
      'Файл OpenDocument преобразуется, чтобы его можно было редактировать здесь. Исходный файл не изменяется.',
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
    legacyOdfSimplified:
      '«{name}» открыт с помощью упрощённого конвертера, поэтому разметка может отличаться от оригинала. Переустановите приложение для полного преобразования.',
    legacyOdfDropped:
      'Некоторые части «{name}» не удалось перенести: {items}. Переустановите приложение для полного преобразования.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'сноски ({count})',
    legacyOdfDropComments: 'комментарии ({count})',
    legacyOdfDropTextboxesFlattened: 'текстовые поля ({count}, показаны как обычный текст)',
    legacyOdfDropShapes: 'фигуры ({count})',
    legacyOdfDropImages: 'изображения ({count})',
    legacyOdfDropObjects: 'встроенные объекты ({count})',
    legacyOdfDropTables: 'таблицы ({count})',
    legacyOdfDropNestedTables: 'вложенные таблицы ({count})',
    legacyOdfDropNotes: 'заметки докладчика ({count})',
    legacyOdfDropFramesWithoutGeometry: 'рамки без координат ({count})',
    legacyOdfDropStaleIndexes: 'указатели ({count})',
    legacyOdfDropUnhandledBlocks: 'неподдерживаемые блоки ({count})',
    legacyOdfDropHeadersFooters: 'колонтитулы ({count})',
    legacyOdfDropTrackedChanges: 'исправления ({count})',
    legacyOdfDropOther: 'прочие элементы ({count})',
  },
  ar: {
    legacyConvertingMsg: 'جارٍ تحويل «{name}»…',
    legacyConvertingDetail:
      'يجري تحويل ملف Office القديم لتتمكن من تحريره هنا. لن يتغير الملف الأصلي.',
    legacyOdfDetail: 'يجري تحويل ملف OpenDocument لتتمكن من تحريره هنا. لن يتغير الملف الأصلي.',
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
    legacyOdfSimplified:
      'فُتح «{name}» بمحوّل مبسّط، لذلك قد يختلف التخطيط عن الأصل. أعد تثبيت التطبيق لاستعادة التحويل الكامل.',
    legacyOdfDropped:
      'تعذّر نقل بعض أجزاء «{name}»: {items}. أعد تثبيت التطبيق لاستعادة التحويل الكامل.',
    legacyOdfListSep: '، ',
    legacyOdfDropFootnotes: 'حواشي سفلية ({count})',
    legacyOdfDropComments: 'تعليقات ({count})',
    legacyOdfDropTextboxesFlattened: 'مربعات نص ({count}، معروضة كنص عادي)',
    legacyOdfDropShapes: 'أشكال ({count})',
    legacyOdfDropImages: 'صور ({count})',
    legacyOdfDropObjects: 'كائنات مضمّنة ({count})',
    legacyOdfDropTables: 'جداول ({count})',
    legacyOdfDropNestedTables: 'جداول متداخلة ({count})',
    legacyOdfDropNotes: 'ملاحظات المحاضر ({count})',
    legacyOdfDropFramesWithoutGeometry: 'إطارات بلا موضع ({count})',
    legacyOdfDropStaleIndexes: 'فهارس ({count})',
    legacyOdfDropUnhandledBlocks: 'كتل غير مدعومة ({count})',
    legacyOdfDropHeadersFooters: 'رؤوس وتذييلات ({count})',
    legacyOdfDropTrackedChanges: 'تغييرات متتبّعة ({count})',
    legacyOdfDropOther: 'عناصر أخرى ({count})',
  },
  pt: {
    legacyConvertingMsg: 'Convertendo “{name}”…',
    legacyConvertingDetail:
      'O arquivo Office antigo está sendo convertido para que você possa editá-lo aqui. O arquivo original não é alterado.',
    legacyOdfDetail:
      'O arquivo OpenDocument está sendo convertido para que você possa editá-lo aqui. O arquivo original não é alterado.',
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
    legacyOdfSimplified:
      '“{name}” foi aberto com um conversor simplificado, por isso o layout pode diferir do original. Reinstale o aplicativo para restaurar a conversão completa.',
    legacyOdfDropped:
      'Algumas partes de “{name}” não puderam ser mantidas: {items}. Reinstale o aplicativo para restaurar a conversão completa.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'notas de rodapé ({count})',
    legacyOdfDropComments: 'comentários ({count})',
    legacyOdfDropTextboxesFlattened: 'caixas de texto ({count}, exibidas como texto simples)',
    legacyOdfDropShapes: 'formas ({count})',
    legacyOdfDropImages: 'imagens ({count})',
    legacyOdfDropObjects: 'objetos incorporados ({count})',
    legacyOdfDropTables: 'tabelas ({count})',
    legacyOdfDropNestedTables: 'tabelas aninhadas ({count})',
    legacyOdfDropNotes: 'notas do apresentador ({count})',
    legacyOdfDropFramesWithoutGeometry: 'quadros sem posição ({count})',
    legacyOdfDropStaleIndexes: 'índices ({count})',
    legacyOdfDropUnhandledBlocks: 'blocos não suportados ({count})',
    legacyOdfDropHeadersFooters: 'cabeçalhos e rodapés ({count})',
    legacyOdfDropTrackedChanges: 'alterações registradas ({count})',
    legacyOdfDropOther: 'outros itens ({count})',
  },
  it: {
    legacyConvertingMsg: 'Conversione di “{name}”…',
    legacyConvertingDetail:
      'Il file Office di vecchio formato viene convertito per poterlo modificare qui. Il file originale non viene modificato.',
    legacyOdfDetail:
      'Il file OpenDocument viene convertito per poterlo modificare qui. Il file originale non viene modificato.',
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
    legacyOdfSimplified:
      '“{name}” è stato aperto con un convertitore semplificato, quindi l’impaginazione potrebbe differire dall’originale. Reinstalla l’app per ripristinare la conversione completa.',
    legacyOdfDropped:
      'Alcune parti di “{name}” non sono state mantenute: {items}. Reinstalla l’app per ripristinare la conversione completa.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'note a piè di pagina ({count})',
    legacyOdfDropComments: 'commenti ({count})',
    legacyOdfDropTextboxesFlattened: 'caselle di testo ({count}, mostrate come testo semplice)',
    legacyOdfDropShapes: 'forme ({count})',
    legacyOdfDropImages: 'immagini ({count})',
    legacyOdfDropObjects: 'oggetti incorporati ({count})',
    legacyOdfDropTables: 'tabelle ({count})',
    legacyOdfDropNestedTables: 'tabelle nidificate ({count})',
    legacyOdfDropNotes: 'note del relatore ({count})',
    legacyOdfDropFramesWithoutGeometry: 'cornici senza posizione ({count})',
    legacyOdfDropStaleIndexes: 'indici ({count})',
    legacyOdfDropUnhandledBlocks: 'blocchi non supportati ({count})',
    legacyOdfDropHeadersFooters: 'intestazioni e piè di pagina ({count})',
    legacyOdfDropTrackedChanges: 'modifiche rilevate ({count})',
    legacyOdfDropOther: 'altri elementi ({count})',
  },
  pl: {
    legacyConvertingMsg: 'Konwertowanie „{name}”…',
    legacyConvertingDetail:
      'Starszy plik Office jest konwertowany, aby można go było edytować tutaj. Oryginalny plik nie jest zmieniany.',
    legacyOdfDetail:
      'Plik OpenDocument jest konwertowany, aby można go było edytować tutaj. Oryginalny plik nie jest zmieniany.',
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
    legacyOdfSimplified:
      'Plik „{name}” otwarto za pomocą uproszczonego konwertera, dlatego układ może różnić się od oryginału. Zainstaluj aplikację ponownie, aby przywrócić pełną konwersję.',
    legacyOdfDropped:
      'Niektórych elementów pliku „{name}” nie udało się przenieść: {items}. Zainstaluj aplikację ponownie, aby przywrócić pełną konwersję.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'przypisy dolne ({count})',
    legacyOdfDropComments: 'komentarze ({count})',
    legacyOdfDropTextboxesFlattened: 'pola tekstowe ({count}, wyświetlone jako zwykły tekst)',
    legacyOdfDropShapes: 'kształty ({count})',
    legacyOdfDropImages: 'obrazy ({count})',
    legacyOdfDropObjects: 'obiekty osadzone ({count})',
    legacyOdfDropTables: 'tabele ({count})',
    legacyOdfDropNestedTables: 'tabele zagnieżdżone ({count})',
    legacyOdfDropNotes: 'notatki prelegenta ({count})',
    legacyOdfDropFramesWithoutGeometry: 'ramki bez pozycji ({count})',
    legacyOdfDropStaleIndexes: 'indeksy ({count})',
    legacyOdfDropUnhandledBlocks: 'nieobsługiwane bloki ({count})',
    legacyOdfDropHeadersFooters: 'nagłówki i stopki ({count})',
    legacyOdfDropTrackedChanges: 'śledzone zmiany ({count})',
    legacyOdfDropOther: 'inne elementy ({count})',
  },
  cs: {
    legacyConvertingMsg: 'Převádí se „{name}“…',
    legacyConvertingDetail:
      'Starší soubor Office se převádí, aby jej šlo upravovat zde. Původní soubor se nemění.',
    legacyOdfDetail:
      'Soubor OpenDocument se převádí, aby jej šlo upravovat zde. Původní soubor se nemění.',
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
    legacyOdfSimplified:
      'Soubor „{name}“ byl otevřen zjednodušeným převodníkem, takže se rozvržení může lišit od originálu. Nainstalujte aplikaci znovu, aby se obnovil plný převod.',
    legacyOdfDropped:
      'Některé části souboru „{name}“ se nepodařilo přenést: {items}. Nainstalujte aplikaci znovu, aby se obnovil plný převod.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'poznámky pod čarou ({count})',
    legacyOdfDropComments: 'komentáře ({count})',
    legacyOdfDropTextboxesFlattened: 'textová pole ({count}, zobrazená jako prostý text)',
    legacyOdfDropShapes: 'tvary ({count})',
    legacyOdfDropImages: 'obrázky ({count})',
    legacyOdfDropObjects: 'vložené objekty ({count})',
    legacyOdfDropTables: 'tabulky ({count})',
    legacyOdfDropNestedTables: 'vnořené tabulky ({count})',
    legacyOdfDropNotes: 'poznámky přednášejícího ({count})',
    legacyOdfDropFramesWithoutGeometry: 'rámce bez pozice ({count})',
    legacyOdfDropStaleIndexes: 'rejstříky ({count})',
    legacyOdfDropUnhandledBlocks: 'nepodporované bloky ({count})',
    legacyOdfDropHeadersFooters: 'záhlaví a zápatí ({count})',
    legacyOdfDropTrackedChanges: 'sledované změny ({count})',
    legacyOdfDropOther: 'další položky ({count})',
  },
  nl: {
    legacyConvertingMsg: '“{name}” wordt geconverteerd…',
    legacyConvertingDetail:
      'Het oudere Office-bestand wordt geconverteerd zodat u het hier kunt bewerken. Het originele bestand blijft ongewijzigd.',
    legacyOdfDetail:
      'Het OpenDocument-bestand wordt geconverteerd zodat u het hier kunt bewerken. Het originele bestand blijft ongewijzigd.',
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
    legacyOdfSimplified:
      '“{name}” is geopend met een eenvoudigere converter, waardoor de opmaak kan afwijken van het origineel. Installeer de app opnieuw voor volledige conversie.',
    legacyOdfDropped:
      'Sommige onderdelen van “{name}” konden niet worden meegenomen: {items}. Installeer de app opnieuw voor volledige conversie.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'voetnoten ({count})',
    legacyOdfDropComments: 'opmerkingen ({count})',
    legacyOdfDropTextboxesFlattened: 'tekstvakken ({count}, weergegeven als platte tekst)',
    legacyOdfDropShapes: 'vormen ({count})',
    legacyOdfDropImages: 'afbeeldingen ({count})',
    legacyOdfDropObjects: 'ingesloten objecten ({count})',
    legacyOdfDropTables: 'tabellen ({count})',
    legacyOdfDropNestedTables: 'geneste tabellen ({count})',
    legacyOdfDropNotes: 'sprekersnotities ({count})',
    legacyOdfDropFramesWithoutGeometry: 'kaders zonder positie ({count})',
    legacyOdfDropStaleIndexes: 'indexen ({count})',
    legacyOdfDropUnhandledBlocks: 'niet-ondersteunde blokken ({count})',
    legacyOdfDropHeadersFooters: 'kop- en voetteksten ({count})',
    legacyOdfDropTrackedChanges: 'bijgehouden wijzigingen ({count})',
    legacyOdfDropOther: 'overige onderdelen ({count})',
  },
  ms: {
    legacyConvertingMsg: 'Menukar “{name}”…',
    legacyConvertingDetail:
      'Fail Office lama sedang ditukar supaya anda boleh mengeditnya di sini. Fail asal tidak diubah.',
    legacyOdfDetail:
      'Fail OpenDocument sedang ditukar supaya anda boleh mengeditnya di sini. Fail asal tidak diubah.',
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
    legacyOdfSimplified:
      '“{name}” dibuka dengan penukar ringkas, jadi susun atur mungkin berbeza daripada asal. Pasang semula aplikasi untuk memulihkan penukaran penuh.',
    legacyOdfDropped:
      'Sebahagian kandungan “{name}” tidak dapat dibawa bersama: {items}. Pasang semula aplikasi untuk memulihkan penukaran penuh.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'nota kaki ({count})',
    legacyOdfDropComments: 'komen ({count})',
    legacyOdfDropTextboxesFlattened: 'kotak teks ({count}, dipaparkan sebagai teks biasa)',
    legacyOdfDropShapes: 'bentuk ({count})',
    legacyOdfDropImages: 'imej ({count})',
    legacyOdfDropObjects: 'objek terbenam ({count})',
    legacyOdfDropTables: 'jadual ({count})',
    legacyOdfDropNestedTables: 'jadual bersarang ({count})',
    legacyOdfDropNotes: 'nota pembentang ({count})',
    legacyOdfDropFramesWithoutGeometry: 'bingkai tanpa kedudukan ({count})',
    legacyOdfDropStaleIndexes: 'indeks ({count})',
    legacyOdfDropUnhandledBlocks: 'blok tidak disokong ({count})',
    legacyOdfDropHeadersFooters: 'pengatas dan pengaki ({count})',
    legacyOdfDropTrackedChanges: 'perubahan dijejak ({count})',
    legacyOdfDropOther: 'item lain ({count})',
  },
  he: {
    legacyConvertingMsg: 'ממיר את “{name}”…',
    legacyConvertingDetail:
      'קובץ ה-Office הישן מומר כדי שתוכלו לערוך אותו כאן. קובץ המקור אינו משתנה.',
    legacyOdfDetail: 'קובץ ה-OpenDocument מומר כדי שתוכלו לערוך אותו כאן. קובץ המקור אינו משתנה.',
    legacyEncrypted:
      '“{name}” מוגן בסיסמה ולכן אי אפשר להמיר אותו. הסירו את הסיסמה ביישום שיצר אותו ופתחו אותו שוב.',
    legacyCorrupt:
      '“{name}” פגום או שאינו קובץ {ext} תקין, ולכן אי אפשר לפתוח אותו. נסו את קובץ המקור או עותק גיבוי.',
    legacyTimeout: 'המרת “{name}” נמשכה זמן רב מדי ונעצרה. נסו שוב או פתחו עותק קטן יותר.',
    legacyFailed: 'לא ניתן להמיר את “{name}”.',
    legacyMissing: 'לא ניתן לפתוח את “{name}” כי המַמיר חסר בהתקנה זו. התקינו את היישום מחדש.',
    legacyXlsValuesOnly:
      '“{name}” נפתח עם ערכים בלבד: נוסחאות, תרשימים וחלק מהעיצוב אינם נשמרים כי המַמיר חסר. התקינו את היישום מחדש כדי לשחזר אותם.',
    legacyOdfSimplified:
      '“{name}” נפתח באמצעות ממיר פשוט יותר, ולכן הפריסה עשויה להיות שונה מהמקור. התקינו את היישום מחדש כדי לשחזר המרה מלאה.',
    legacyOdfDropped:
      'חלקים מסוימים מתוך “{name}” לא הועברו: {items}. התקינו את היישום מחדש כדי לשחזר המרה מלאה.',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'הערות שוליים ({count})',
    legacyOdfDropComments: 'הערות ({count})',
    legacyOdfDropTextboxesFlattened: 'תיבות טקסט ({count}, מוצגות כטקסט רגיל)',
    legacyOdfDropShapes: 'צורות ({count})',
    legacyOdfDropImages: 'תמונות ({count})',
    legacyOdfDropObjects: 'אובייקטים מוטבעים ({count})',
    legacyOdfDropTables: 'טבלאות ({count})',
    legacyOdfDropNestedTables: 'טבלאות מקוננות ({count})',
    legacyOdfDropNotes: 'הערות דובר ({count})',
    legacyOdfDropFramesWithoutGeometry: 'מסגרות ללא מיקום ({count})',
    legacyOdfDropStaleIndexes: 'אינדקסים ({count})',
    legacyOdfDropUnhandledBlocks: 'בלוקים לא נתמכים ({count})',
    legacyOdfDropHeadersFooters: 'כותרות עליונות ותחתונות ({count})',
    legacyOdfDropTrackedChanges: 'מעקב אחר שינויים ({count})',
    legacyOdfDropOther: 'פריטים אחרים ({count})',
  },
  hi: {
    legacyConvertingMsg: '“{name}” को बदला जा रहा है…',
    legacyConvertingDetail:
      'पुरानी Office फ़ाइल को बदला जा रहा है ताकि आप उसे यहाँ संपादित कर सकें। मूल फ़ाइल में कोई बदलाव नहीं होता।',
    legacyOdfDetail:
      'OpenDocument फ़ाइल को बदला जा रहा है ताकि आप उसे यहाँ संपादित कर सकें। मूल फ़ाइल में कोई बदलाव नहीं होता।',
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
    legacyOdfSimplified:
      '“{name}” को सरल कन्वर्टर से खोला गया है, इसलिए लेआउट मूल फ़ाइल से थोड़ा अलग हो सकता है। पूर्ण रूपांतरण के लिए ऐप को दोबारा इंस्टॉल करें।',
    legacyOdfDropped:
      '“{name}” के कुछ हिस्से शामिल नहीं किए जा सके: {items}। पूर्ण रूपांतरण के लिए ऐप को दोबारा इंस्टॉल करें।',
    legacyOdfListSep: ', ',
    legacyOdfDropFootnotes: 'फ़ुटनोट ({count})',
    legacyOdfDropComments: 'टिप्पणियाँ ({count})',
    legacyOdfDropTextboxesFlattened: 'टेक्स्ट बॉक्स ({count}, सादे पाठ के रूप में दिखाए गए)',
    legacyOdfDropShapes: 'आकृतियाँ ({count})',
    legacyOdfDropImages: 'चित्र ({count})',
    legacyOdfDropObjects: 'एम्बेडेड ऑब्जेक्ट ({count})',
    legacyOdfDropTables: 'तालिकाएँ ({count})',
    legacyOdfDropNestedTables: 'नेस्टेड तालिकाएँ ({count})',
    legacyOdfDropNotes: 'वक्ता नोट्स ({count})',
    legacyOdfDropFramesWithoutGeometry: 'बिना स्थिति वाले फ़्रेम ({count})',
    legacyOdfDropStaleIndexes: 'अनुक्रमणिकाएँ ({count})',
    legacyOdfDropUnhandledBlocks: 'असमर्थित ब्लॉक ({count})',
    legacyOdfDropHeadersFooters: 'हेडर और फ़ुटर ({count})',
    legacyOdfDropTrackedChanges: 'ट्रैक किए गए बदलाव ({count})',
    legacyOdfDropOther: 'अन्य आइटम ({count})',
  },
  'zh-TW': {
    legacyConvertingMsg: '正在轉換「{name}」…',
    legacyConvertingDetail: '正在把舊版 Office 檔案轉換為可編輯的新格式，原始檔案不會被修改。',
    legacyOdfDetail: '正在把 OpenDocument 檔案轉換為可編輯的新格式，原始檔案不會被修改。',
    legacyEncrypted: '「{name}」設有密碼，無法轉換。請先在原應用程式中移除密碼後再開啟。',
    legacyCorrupt:
      '「{name}」已損毀，或不是有效的 {ext} 檔案，無法開啟。請嘗試使用原始檔案或備份副本。',
    legacyTimeout: '轉換「{name}」耗時過長，已停止。請重試，或改用較小的副本。',
    legacyFailed: '無法轉換「{name}」。',
    legacyMissing: '無法開啟「{name}」：此安裝缺少檔案轉換元件。請重新安裝應用程式。',
    legacyXlsValuesOnly:
      '「{name}」僅以數值開啟：因缺少轉換元件，公式、圖表與部分格式不會保留。重新安裝應用程式即可恢復。',
    legacyOdfSimplified:
      '「{name}」已使用簡化轉換方式開啟，排版可能與原件略有差異。重新安裝應用程式即可恢復完整轉換。',
    legacyOdfDropped:
      '「{name}」中有部分內容未能完整保留：{items}。重新安裝應用程式即可恢復完整轉換。',
    legacyOdfListSep: '、',
    legacyOdfDropFootnotes: '註腳（{count}）',
    legacyOdfDropComments: '註解（{count}）',
    legacyOdfDropTextboxesFlattened: '文字方塊（{count}，已轉為純文字）',
    legacyOdfDropShapes: '圖形（{count}）',
    legacyOdfDropImages: '圖片（{count}）',
    legacyOdfDropObjects: '嵌入物件（{count}）',
    legacyOdfDropTables: '表格（{count}）',
    legacyOdfDropNestedTables: '巢狀表格（{count}）',
    legacyOdfDropNotes: '演講者備忘稿（{count}）',
    legacyOdfDropFramesWithoutGeometry: '未定位的圖文框（{count}）',
    legacyOdfDropStaleIndexes: '目錄與索引（{count}）',
    legacyOdfDropUnhandledBlocks: '不支援的段落區塊（{count}）',
    legacyOdfDropHeadersFooters: '頁首與頁尾（{count}）',
    legacyOdfDropTrackedChanges: '修訂記錄（{count}）',
    legacyOdfDropOther: '其他項目（{count}）',
  },
})

export type LegacyOpenStringKey = keyof typeof legacyOpenStrings.zh

export const tLegacyOpen = createI18n(legacyOpenStrings)

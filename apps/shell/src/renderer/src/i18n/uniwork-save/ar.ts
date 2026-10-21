import type { zh } from './zh'

export const ar = {
  usMyFolder: 'مجلدي',
  usPrivateTag: 'خاص',
  usDialogTitle: 'تسمية المستند',
  usHint: 'هذا أول حفظ. تحتفظ مرات الحفظ اللاحقة بهذا الاسم؛ استخدم «حفظ باسم» لتغييره.',
  usName: 'الاسم',
  usLocation: 'الموقع',
  usSavingIn: 'الحفظ في: {folder}',
  usMyFolderPrivate: 'خاص، لا يراه غيرك',
  usChange: 'تغيير',
  usSave: 'حفظ',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'إغلاق',
  usPickTitle: 'اختيار مكان الحفظ',
  usBack: 'العودة إلى التسمية',
  usSearchFolders: 'البحث عن مجلد',
  usChooseFolder: 'اختيار «{folder}»',
  usSelected: 'محدد',
  usRootBlocked: 'اختر مجلدًا',
  usErrInvalidDestination: 'لا يمكن الحفظ هنا. اختر مجلدًا آخر.',
  usErrMyFolderLocked:
    'مجلدي هو مجلد النظام الشخصي الخاص بك ولا يمكن إعادة تسميته أو مشاركته أو نقله أو أرشفته.',
  usErrFlushFailed: 'تعذرت كتابة المستند على هذا الجهاز بعد. احفظ المستند أولًا ثم أعد المحاولة.',
  usErrBindFailed:
    'تم إنشاء «{title}» (المعرّف {id}) لكن تعذر ربطه بعلامة التبويب هذه. نُقل المستند إلى سلة المهملات ويمكن استعادته.',
  usErrOrphaned:
    'تم إنشاء «{title}» (المعرّف {id}) في UniWork لكن تعذر ربطه بعلامة التبويب هذه أو نقله إلى سلة المهملات. احذف ذلك المستند أو استخدمه في UniWork.',
  usErrAlreadyBound: 'علامة التبويب هذه مرتبطة بالفعل بمستند في UniWork. احفظ كالمعتاد.',
  usErrNotFound:
    'تعذر العثور على الملف المراد حفظه أو المجلد المحدد. اختر مكان الحفظ مجددًا ثم أعد المحاولة.',
  usShareToggle: 'Share with workspace',
  usShareHint: 'Everyone in this workspace can view this document',
  usShareAlready: 'Already shared with the workspace',
  usShareFailed: 'Could not share. Check the principal and the level.',
} satisfies Record<keyof typeof zh, string>

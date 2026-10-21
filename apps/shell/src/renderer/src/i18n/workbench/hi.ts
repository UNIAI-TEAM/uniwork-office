import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const hi = {
  ...en,
  wbNotif_document_changed: '{actor} ने {count} दस्तावेज़ बदले',
  wbNotif_document_changed_renamed_many: '{actor} ने {count} दस्तावेज़ों का नाम बदला',
  wbNotif_document_changed_renamed_one: '{actor} ने “{document}” का नाम बदला',
  wbNotif_document_changed_renamed_untitled: '{actor} ने एक दस्तावेज़ का नाम बदला',
  wbNotif_document_changed_moved_many: '{actor} ने {count} दस्तावेज़ ले जाए',
  wbNotif_document_changed_moved_one: '{actor} ने “{document}” को ले जाया',
  wbNotif_document_changed_moved_untitled: '{actor} ने एक दस्तावेज़ ले जाया',
  wbNotif_document_changed_trashed_many: '{actor} ने {count} दस्तावेज़ ट्रैश में भेजे',
  wbNotif_document_changed_trashed_one: '{actor} ने “{document}” को ट्रैश में भेजा',
  wbNotif_document_changed_trashed_untitled: '{actor} ने एक दस्तावेज़ ट्रैश में भेजा',
  wbNotif_document_changed_restored_many: '{actor} ने {count} दस्तावेज़ पुनर्स्थापित किए',
  wbNotif_document_changed_restored_one: '{actor} ने “{document}” को पुनर्स्थापित किया',
  wbNotif_document_changed_restored_untitled: '{actor} ने एक दस्तावेज़ पुनर्स्थापित किया',
  wbNotif_document_changed_deleted_many: '{actor} ने {count} दस्तावेज़ हमेशा के लिए हटाए',
  wbNotif_document_changed_deleted_one: '{actor} ने “{document}” को हमेशा के लिए हटाया',
  wbNotif_document_changed_deleted_untitled: '{actor} ने एक दस्तावेज़ हमेशा के लिए हटाया',
  wbNotif_document_changed_shelved_many: '{actor} ने {count} दस्तावेज़ संग्रहीत किए',
  wbNotif_document_changed_shelved_one: '{actor} ने “{document}” को संग्रहीत किया',
  wbNotif_document_changed_shelved_untitled: '{actor} ने एक दस्तावेज़ संग्रहीत किया',
  wbNotif_document_changed_unshelved_many: '{actor} ने {count} दस्तावेज़ संग्रह से निकाले',
  wbNotif_document_changed_unshelved_one: '{actor} ने “{document}” को संग्रह से निकाला',
  wbNotif_document_changed_unshelved_untitled: '{actor} ने एक दस्तावेज़ संग्रह से निकाला',
  wbNotif_document_changed_access_changed_many: '{actor} ने {count} दस्तावेज़ों की पहुँच बदली',
  wbNotif_document_changed_access_changed_one: '{actor} ने “{document}” की पहुँच बदली',
  wbNotif_document_changed_access_changed_untitled: '{actor} ने एक दस्तावेज़ की पहुँच बदली',
  wbNotif_document_changed_version_created_many:
    '{actor} ने {count} दस्तावेज़ों में नया संस्करण जोड़ा',
  wbNotif_document_changed_version_created_one: '{actor} ने “{document}” में नया संस्करण जोड़ा',
  wbNotif_document_changed_version_created_untitled:
    '{actor} ने एक दस्तावेज़ में नया संस्करण जोड़ा',
  wbNotif_document_changed_relocated_many:
    '{actor} ने आपके {count} दस्तावेज़ों वाला फ़ोल्डर ट्रैश में भेजा; दस्तावेज़ अब वर्कस्पेस के रूट में हैं',
  wbNotif_document_changed_relocated_one:
    '{actor} ने आपके “{document}” वाला फ़ोल्डर ट्रैश में भेजा; दस्तावेज़ अब वर्कस्पेस के रूट में है',
  wbNotif_document_changed_relocated_untitled:
    '{actor} ने आपके एक दस्तावेज़ वाला फ़ोल्डर ट्रैश में भेजा; दस्तावेज़ अब वर्कस्पेस के रूट में है',
  wbNotif_document_changed_generic_one: '{actor} ने “{document}” को बदला',
  wbNotif_document_changed_generic_untitled: '{actor} ने एक दस्तावेज़ बदला',
  wbNotif_document_comment_resolved:
    '{actor} ने “{document}” में एक टिप्पणी को हल किया चिह्नित किया।',
  wbNotif_document_comment_resolved_untitled: '{actor} ने एक टिप्पणी को हल किया चिह्नित किया।',
  wbDeskPillChanged: 'बदला गया',
  wbDeskPillResolved: 'हल हुआ',
  wbDocChangeTitle: 'बदले हुए दस्तावेज़',
  wbDocChangeLoading: 'दस्तावेज़ लोड हो रहे हैं',
  wbDocChangeEmptyTitle: 'आपके पढ़ने लायक कोई दस्तावेज़ नहीं बचा',
  wbDocChangeEmptyDesc: 'ये दस्तावेज़ हटा दिए गए हैं या अब आपके पास पहुँच नहीं है।',
  wbDocChangeErrorTitle: 'दस्तावेज़ लोड नहीं हो सके',
  wbDocChangeErrorDesc: 'कुछ गड़बड़ हुई, फिर से कोशिश करें',
  wbDocChangeLoadMore: 'और लोड करें',
  wbDocChangeLoadingMore: 'लोड हो रहा है…',
  wbDocChangeDeleted: 'हमेशा के लिए हटाया गया',
  wbDocChangeInTrash: 'ट्रैश में भेजा गया',
  wbDocChangeUntitled: 'बिना शीर्षक का दस्तावेज़',
  wbDocChangeViewList: '{count} दस्तावेज़ देखें',
  wbDocChangeMore: 'और {count}',
} satisfies Record<keyof typeof zh, string>

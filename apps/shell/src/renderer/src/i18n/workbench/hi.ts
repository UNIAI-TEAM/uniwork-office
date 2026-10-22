import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const hi = {
  ...en,
  wbNotif_document_commented_untitled: '{actor} ने एक दस्तावेज़ पर टिप्पणी की',
  wbNotif_document_mentioned: '{actor} ने “{document}” पर एक टिप्पणी में आपका उल्लेख किया।',
  wbNotif_document_mentioned_untitled: '{actor} ने एक दस्तावेज़ की टिप्पणी में आपका उल्लेख किया।',
  wbNotif_document_body_mentioned: '{actor} ने “{document}” में आपका उल्लेख किया।',
  wbNotif_document_body_mentioned_untitled: '{actor} ने एक दस्तावेज़ में आपका उल्लेख किया।',
  wbNotif_document_comment_replied: '{actor} ने “{document}” में आपकी टिप्पणी का जवाब दिया।',
  wbNotif_document_comment_replied_untitled:
    '{actor} ने एक दस्तावेज़ में आपकी टिप्पणी का जवाब दिया।',
  wbNotif_document_discussion_mentioned: '{actor} ने “{document}” की चर्चा में आपका उल्लेख किया।',
  wbNotif_document_discussion_mentioned_untitled:
    '{actor} ने एक दस्तावेज़ की चर्चा में आपका उल्लेख किया।',
  wbNotif_document_discussion_replied:
    '{actor} ने “{document}” की चर्चा में आपकी पोस्ट का जवाब दिया।',
  wbNotif_document_discussion_replied_untitled:
    '{actor} ने एक दस्तावेज़ की चर्चा में आपकी पोस्ट का जवाब दिया।',
  wbNotif_document_edit_requested: '{actor} “{document}” को संपादित करना चाहते हैं',
  wbNotif_document_edit_request_answered: '{actor} ने “{document}” का संपादन आपको सौंप दिया',
  wbNotif_document_edit_request_answered_declined:
    '{actor} अभी भी “{document}” का संपादन कर रहे हैं',
  wbNotif_document_edit_taken_over:
    '{actor} ने “{document}” का संपादन अपने हाथ में ले लिया है। आपके बिना सहेजे गए बदलाव खुले दस्तावेज़ में अब भी हैं।',
  wbNotif_document_break_glass:
    '{actor} ने “{document}” के लिए आपातकालीन देखने की पहुँच (24 घंटे) खोली है।',
  wbNotif_document_break_glass_untitled:
    '{actor} ने एक दस्तावेज़ के लिए आपातकालीन देखने की पहुँच (24 घंटे) खोली है।',
  wbNotif_document_access_requested: '{actor} ने “{document}” तक पहुँच का अनुरोध किया है।',
  wbNotif_document_access_requested_untitled: '{actor} ने एक दस्तावेज़ तक पहुँच का अनुरोध किया है।',
  wbNotif_document_access_approved: '{actor} ने आपको “{document}” तक पहुँच दी है।',
  wbNotif_document_access_approved_untitled: '{actor} ने आपको एक दस्तावेज़ तक पहुँच दी है।',
  wbNotif_document_access_declined: 'दस्तावेज़ तक पहुँच के लिए आपका अनुरोध अस्वीकार कर दिया गया।',
  wbNotif_document_shared: '{actor} ने “{document}” आपके साथ साझा किया ({level})।',
  wbNotif_document_shared_untitled: '{actor} ने एक दस्तावेज़ आपके साथ साझा किया ({level})।',
  wbNotif_document_shared_nolevel: '{actor} ने “{document}” आपके साथ साझा किया।',
  wbNotif_document_shared_untitled_nolevel: '{actor} ने एक दस्तावेज़ आपके साथ साझा किया।',
  wbNotif_document_trashed_by_other:
    '{actor} ने आपका दस्तावेज़ ट्रैश में डाल दिया। {date} से पहले उसे पुनर्स्थापित करें',
  wbNotif_document_trashed_by_other_untitled:
    '{actor} ने आपका एक दस्तावेज़ ट्रैश में डाल दिया। {date} से पहले उसे पुनर्स्थापित करें',
  wbNotif_document_trashed_by_other_nodate: '{actor} ने आपका दस्तावेज़ ट्रैश में डाल दिया',
  wbNotif_document_trashed_by_other_untitled_nodate:
    '{actor} ने आपका एक दस्तावेज़ ट्रैश में डाल दिया',
  wbNotif_chat_call_incoming: '{actor} कॉल कर रहे हैं',
  wbDeskPillReply: 'जवाब',
  wbDeskPillEdit: 'संपादन में',
  wbDeskPillAccess: 'पहुँच',
  wbDeskPillTrash: 'ट्रैश में',
  wbDeskPillBreakGlass: 'आपातकाल',
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
  wbDocChangeMore: 'और {count}',
  wbNoticeNoAccess: 'आपके पास इस दस्तावेज़ तक पहुँच नहीं है।',
} satisfies Record<keyof typeof zh, string>

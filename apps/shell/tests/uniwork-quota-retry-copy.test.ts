import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'

/**
 * UNI-2510 (web UNI-2502): a storage-full message ends with "If you just uploaded another version,
 * try again in a few minutes." (a quota refusal can be the previous version still settling). The
 * sentence is in every locale of the two sentence-level quota strings: the document save error
 * (`uwErrQuotaExceeded`) and the folder-upload report (`fuRepStorageQuota`).
 */

const RETRY_SENTENCE: Record<(typeof LANGS)[number], string> = {
  ar: 'إذا كنت قد رفعت للتو إصدارًا آخر، فحاول مرة أخرى بعد بضع دقائق.',
  cs: 'Pokud jste právě nahráli další verzi, zkuste to znovu za několik minut.',
  de: 'Wenn Sie gerade eine weitere Version hochgeladen haben, versuchen Sie es in ein paar Minuten erneut.',
  en: 'If you just uploaded another version, try again in a few minutes.',
  es: 'Si acabas de subir otra versión, inténtalo de nuevo en unos minutos.',
  fr: 'Si vous venez de téléverser une autre version, réessayez dans quelques minutes.',
  he: 'אם הרגע העליתם גרסה אחרת, נסו שוב בעוד כמה דקות.',
  hi: 'यदि आपने अभी-अभी कोई और संस्करण अपलोड किया है, तो कुछ मिनट बाद फिर कोशिश करें।',
  id: 'Jika Anda baru saja mengunggah versi lain, coba lagi dalam beberapa menit.',
  it: 'Se hai appena caricato un’altra versione, riprova tra qualche minuto.',
  ja: '別のバージョンをアップロードしたばかりの場合は、数分後にもう一度お試しください。',
  ko: '방금 다른 버전을 업로드했다면 몇 분 후에 다시 시도하세요.',
  ms: 'Jika anda baru sahaja memuat naik versi lain, cuba lagi dalam beberapa minit.',
  nl: 'Als je zojuist een andere versie hebt geüpload, probeer het over een paar minuten opnieuw.',
  pl: 'Jeśli przed chwilą przesłałeś inną wersję, spróbuj ponownie za kilka minut.',
  pt: 'Se você acabou de enviar outra versão, tente novamente em alguns minutos.',
  ru: 'Если вы только что загрузили другую версию, повторите попытку через несколько минут.',
  th: 'หากคุณเพิ่งอัปโหลดเวอร์ชันอื่น ให้ลองอีกครั้งในอีกไม่กี่นาที',
  vi: 'Nếu bạn vừa tải lên một phiên bản khác, thử lại sau vài phút.',
  'zh-TW': '如果你剛上傳了另一個版本，請幾分鐘後再試。',
  zh: '如果你刚上传了另一个版本，请几分钟后重试。',
}

describe('UNI-2510: the quota messages tell the user to retry after a just-uploaded version', () => {
  it('has a sentence for every UI language', () => {
    expect(Object.keys(RETRY_SENTENCE).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('locale %s: uwErrQuotaExceeded ends with the retry sentence', (lang) => {
    const text = (uniworkDocumentStrings[lang] as Record<string, string>).uwErrQuotaExceeded
    expect(text?.endsWith(RETRY_SENTENCE[lang])).toBe(true)
  })

  it.each([...LANGS])('locale %s: fuRepStorageQuota ends with the retry sentence', (lang) => {
    const text = (uniworkHomeStrings[lang] as Record<string, string>).fuRepStorageQuota
    expect(text?.endsWith(RETRY_SENTENCE[lang])).toBe(true)
  })
})

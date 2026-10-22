import type { zh } from './zh'

export const fr = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI réfléchit…',
  askUniYou: 'Vous',
  askUniUni: 'UNI',
  askUniSources: 'Sources',
  askUniKindDocument: 'Document',
  askUniKindTask: 'Tâche',
  askUniKindMeeting: 'Réunion',
  askUniKindChat: 'Discussion',
  askUniKindMember: 'Membre',
  askUniKindOther: 'Autre',
  askUniOpenDocument: 'Ouvrir le document',
  askUniOpenBrowser: 'Ouvrir dans le navigateur',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed: "Impossible d'ouvrir cette source. Réessayez ou ouvrez-la sur le web.",
  askUniErrForbidden: 'Vous n’avez pas accès à ces données.',
  askUniErrQuota: 'L’organisation a utilisé son quota de jetons IA pour ce mois-ci.',
  askUniErrRateLimited: 'Vous posez vos questions trop vite ; réessayez dans une minute.',
  askUniErrRateLimitedIn: 'Vous posez vos questions trop vite ; réessayez dans {seconds} secondes.',
  askUniErrDisabled: 'L’IA n’est pas configurée sur ce serveur.',
  askUniErrOffline:
    'Vous êtes hors ligne. Demander à UNI nécessite une connexion pour rechercher dans les documents.',
  askUniErrSession:
    'Votre session UniWork a expiré. Reconnectez-vous pour continuer à poser des questions.',
  askUniErrDefault: 'Impossible de poser la question pour le moment ; réessayez plus tard.',
  askUniSignedOut:
    'Connectez-vous à votre compte UniWork pour interroger UNI sur votre espace de travail.',
  askUniNoticeNoSources:
    'Rien de ce que vous pouvez voir dans cet espace de travail ne correspond encore à cette question.',
  askUniNoticeUnavailable: 'UNI n’a pas pu répondre à cette question.',
  askUniStop: 'Arrêter',
  askUniSend: 'Envoyer',
  askUniCounter: '{used}/{max} caractères',
  askUniPlaceholder: 'Posez une question à UNI sur votre travail…',
} satisfies Record<keyof typeof zh, string>

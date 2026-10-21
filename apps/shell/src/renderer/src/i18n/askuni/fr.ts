import type { zh } from './zh'

export const fr = {
  askUniModeGroup: 'Mode',
  askUniModeChat: 'Assistant',
  askUniModeAsk: 'Demander à UNI',
  askUniTitle: 'Demander à UNI',
  askUniDescription:
    'UNI ne répond qu’à partir des données que vous pouvez voir dans cet espace de travail, avec les sources.',
  askUniWorkspace: 'Espace de travail',
  askUniEmptyTitle: 'Que voulez-vous savoir sur le travail de l’équipe ?',
  askUniEmptyDescription:
    'UNI lit les tâches, les réunions, les discussions auxquelles vous participez et les membres — chaque réponse cite ses sources.',
  askUniPlaceholder: 'Posez une question à UNI sur votre travail…',
  askUniSend: 'Envoyer',
  askUniStop: 'Arrêter',
  askUniStopped: 'Arrêté. La réponse ne sera pas affichée.',
  askUniThinking: 'UNI réfléchit…',
  askUniNewChat: 'Nouvelle discussion',
  askUniYou: 'Vous',
  askUniUni: 'UNI',
  askUniSources: 'Sources',
  askUniKindDocument: 'Document',
  askUniKindTask: 'Tâche',
  askUniKindMeeting: 'Réunion',
  askUniKindChat: 'Discussion',
  askUniKindMember: 'Membre',
  askUniOpenDocument: 'Ouvrir le document',
  askUniOpenBrowser: 'Ouvrir dans le navigateur',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniCounter: '{used}/{max} caractères',
  askUniLoading: 'Chargement…',
  askUniSignedOut:
    'Connectez-vous à votre compte UniWork pour interroger UNI sur votre espace de travail.',
  askUniNoWorkspace: 'Votre compte n’a pas encore d’espace de travail à interroger.',
  askUniNoticeNoSources:
    'Rien de ce que vous pouvez voir dans cet espace de travail ne correspond encore à cette question.',
  askUniNoticeUnavailable: 'UNI n’a pas pu répondre à cette question.',
  askUniErrForbidden: 'Vous n’avez pas accès à ces données.',
  askUniErrQuota: 'L’organisation a utilisé son quota de jetons IA pour ce mois-ci.',
  askUniErrRateLimited: 'Vous posez vos questions trop vite ; réessayez dans une minute.',
  askUniErrRateLimitedIn: 'Vous posez vos questions trop vite ; réessayez dans {seconds} secondes.',
  askUniErrDisabled: 'L’IA n’est pas configurée sur ce serveur.',
  askUniErrOffline: 'Vous êtes hors ligne. Connectez-vous à Internet puis réessayez.',
  askUniErrSession:
    'Votre session UniWork a expiré. Reconnectez-vous pour continuer à poser des questions.',
  askUniErrDefault: 'Impossible de poser la question pour le moment ; réessayez plus tard.',
} satisfies Record<keyof typeof zh, string>

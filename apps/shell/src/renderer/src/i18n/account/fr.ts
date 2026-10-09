import type { zh } from './zh'

export const fr = {
  acctTitle: 'Compte UniWork',
  acctOpenSettings: 'Ouvrir les paramètres du compte',
  acctSignIn: 'Se connecter',
  acctSignInUniwork: 'Se connecter à UniWork',
  acctSignInAgain: 'Se reconnecter',
  acctSignOut: 'Se déconnecter',
  acctSigningOut: 'Déconnexion…',
  acctSigningIn: 'Connexion…',
  acctSigningInHint: 'Poursuivez dans votre navigateur pour terminer la connexion.',
  acctCancel: 'Annuler',
  acctOpenAgain: 'Rouvrir le navigateur',
  acctCopyLink: 'Copier le lien de connexion',
  acctLinkCopied: 'Lien copié',
  acctSignedInAs: 'Connecté en tant que {name}',
  acctSignedOutTitle: 'Vous n’êtes pas connecté',
  acctSignedOutBody:
    'Connectez-vous avec votre compte UniWork pour utiliser l’offre de votre organisation sur cet appareil.',
  acctRefreshing: 'Mise à jour du compte…',
  acctName: 'Nom',
  acctEmail: 'E-mail',
  acctOrg: 'Organisation',
  acctPlan: 'Offre',
  acctServer: 'Serveur',
  acctNoPlan: 'Aucune offre',
  acctSwitchOrg: 'Changer d’organisation',
  acctSwitchOrgFailed: 'Impossible de changer d’organisation. Veuillez réessayer.',
  acctExpiredShort: 'Session expirée',
  acctExpiredTitle: 'Votre session a expiré',
  acctExpiredBody:
    'Pour votre sécurité, reconnectez-vous afin de continuer à utiliser votre compte UniWork.',
  acctRevokedShort: 'Session terminée',
  acctRevokedTitle: 'Vous avez été déconnecté de cet appareil',
  acctRevokedBody:
    'La session de cet appareil a été terminée depuis un autre appareil ou par un administrateur. Reconnectez-vous pour continuer.',
  acctUnreachableTitle: 'Impossible de joindre UniWork',
  acctUnreachableBody:
    'Vérifiez votre connexion Internet ou vos paramètres de proxy. Vous êtes toujours connecté ; les informations ci-dessous peuvent ne pas être à jour.',
  acctRetry: 'Réessayer',
  acctRetrying: 'Nouvelle tentative…',
  acctWrongServerShort: 'Serveur différent',
  acctWrongServerTitle: 'Connecté à un autre serveur',
  acctWrongServerBody:
    'Cette application est liée à {server}, mais votre session appartient à un autre serveur UniWork. Reconnectez-vous avec {server} ou déconnectez-vous.',
  acctThisServer: 'le serveur configuré',
  acctNotConfiguredShort: 'Non lié',
  acctNotConfiguredTitle: 'Non lié à un serveur UniWork',
  acctNotConfiguredBody:
    'Cette copie d’UniWork Office n’est pas encore configurée avec un serveur UniWork ; la connexion n’est donc pas disponible. Demandez un programme d’installation configuré à votre administrateur.',
  acctKeyringShort: 'Stockage sécurisé requis',
  acctKeyringTitle: 'Le stockage sécurisé est indisponible',
  acctKeyringBody:
    'UniWork Office conserve vos informations de connexion dans le stockage sécurisé de votre système (Trousseau d’accès, Gestionnaire d’identification ou trousseau de clés). Déverrouillez-le ou configurez-le, puis redémarrez l’application.',
  acctErrLaunch: 'Impossible de démarrer la connexion. Veuillez réessayer.',
  acctErrNetwork:
    'Impossible de se connecter à UniWork. Vérifiez votre connexion Internet ou vos paramètres de proxy.',
  acctErrTimeout: 'UniWork a mis trop de temps à répondre. Veuillez réessayer.',
  acctErrLoginTimeout: 'La connexion a expiré. Veuillez réessayer.',
  acctErrCancelled: 'La connexion a été annulée.',
  acctErrInvalidCallback: 'La réponse de connexion n’était pas valide. Veuillez réessayer.',
  acctErrStateMismatch:
    'Ce lien de connexion ne correspond pas à la tentative en cours. Relancez la connexion depuis l’application.',
  acctErrAuthCodeInvalid:
    'Le code de connexion a expiré ou a déjà été utilisé. Veuillez vous reconnecter.',
  acctErrRateLimited: 'Trop de tentatives. Patientez un instant, puis réessayez.',
  acctErrUnauthorized: 'Votre session n’est plus valide. Veuillez vous reconnecter.',
  acctErrDeviceRevoked: 'Cet appareil a été déconnecté. Veuillez vous reconnecter.',
  acctErrRefreshReused:
    'Pour votre sécurité, cette session a été terminée. Veuillez vous reconnecter.',
  acctErrWrongDeployment: 'Ce compte appartient à un autre serveur UniWork.',
  acctErrNotConfigured: 'Cette application n’est pas liée à un serveur UniWork.',
  acctErrKeyringUnavailable: 'Le stockage sécurisé de cet ordinateur est indisponible.',
  acctErrServerError: 'UniWork a rencontré un problème. Veuillez réessayer plus tard.',
  acctErrMalformedResponse:
    'UniWork a envoyé une réponse inattendue. Veuillez réessayer plus tard.',
} satisfies Record<keyof typeof zh, string>

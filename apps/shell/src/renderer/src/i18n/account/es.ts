import type { zh } from './zh'

export const es = {
  acctTitle: 'Cuenta de UniWork',
  acctOpenSettings: 'Abrir configuración de la cuenta',
  acctSignIn: 'Iniciar sesión',
  acctSignInUniwork: 'Iniciar sesión en UniWork',
  acctSignInAgain: 'Volver a iniciar sesión',
  acctSignOut: 'Cerrar sesión',
  acctSigningOut: 'Cerrando sesión…',
  acctSigningIn: 'Iniciando sesión…',
  acctSigningInHint: 'Continúa en tu navegador para terminar de iniciar sesión.',
  acctCancel: 'Cancelar',
  acctOpenAgain: 'Abrir el navegador de nuevo',
  acctCopyLink: 'Copiar enlace de inicio de sesión',
  acctLinkCopied: 'Enlace copiado',
  acctSignedInAs: 'Sesión iniciada como {name}',
  acctSignedOutTitle: 'No has iniciado sesión',
  acctSignedOutBody:
    'Inicia sesión con tu cuenta de UniWork para usar el plan de tu organización en este dispositivo.',
  acctRefreshing: 'Actualizando cuenta…',
  acctName: 'Nombre',
  acctEmail: 'Correo electrónico',
  acctOrg: 'Organización',
  acctPlan: 'Plan',
  acctServer: 'Servidor',
  acctNoPlan: 'Sin plan',
  acctSwitchOrg: 'Cambiar de organización',
  acctSwitchOrgFailed: 'No se pudo cambiar de organización. Inténtalo de nuevo.',
  acctExpiredShort: 'Sesión caducada',
  acctExpiredTitle: 'Tu sesión ha caducado',
  acctExpiredBody:
    'Por tu seguridad, vuelve a iniciar sesión para seguir usando tu cuenta de UniWork.',
  acctRevokedShort: 'Sesión finalizada',
  acctRevokedTitle: 'Se cerró tu sesión en este dispositivo',
  acctRevokedBody:
    'La sesión de este dispositivo se finalizó desde otro dispositivo o por un administrador. Vuelve a iniciar sesión para continuar.',
  acctUnreachableTitle: 'No se puede conectar con UniWork',
  acctUnreachableBody:
    'Comprueba tu conexión a Internet o la configuración del proxy. Sigues con la sesión iniciada; es posible que los datos de abajo no estén actualizados.',
  acctRetry: 'Reintentar',
  acctRetrying: 'Reintentando…',
  acctWrongServerShort: 'Servidor distinto',
  acctWrongServerTitle: 'Sesión iniciada en otro servidor',
  acctWrongServerBody:
    'Esta aplicación está vinculada a {server}, pero tu sesión pertenece a otro servidor de UniWork. Vuelve a iniciar sesión con {server} o cierra la sesión.',
  acctThisServer: 'el servidor configurado',
  acctNotConfiguredShort: 'Sin vincular',
  acctNotConfiguredTitle: 'No vinculado a un servidor de UniWork',
  acctNotConfiguredBody:
    'Esta copia de UniWork Office aún no está configurada con un servidor de UniWork, por lo que no se puede iniciar sesión. Pide a tu administrador un instalador configurado.',
  acctKeyringShort: 'Se necesita almacenamiento seguro',
  acctKeyringTitle: 'El almacenamiento seguro no está disponible',
  acctKeyringBody:
    'UniWork Office guarda tu inicio de sesión en el almacenamiento seguro del sistema (Llavero, Administrador de credenciales o un llavero de claves). Desbloquéalo o configúralo y reinicia la aplicación.',
  acctErrLaunch: 'No se pudo iniciar el proceso de inicio de sesión. Inténtalo de nuevo.',
  acctErrNetwork:
    'No se puede conectar con UniWork. Comprueba tu conexión a Internet o la configuración del proxy.',
  acctErrTimeout: 'UniWork tardó demasiado en responder. Inténtalo de nuevo.',
  acctErrLoginTimeout: 'Se agotó el tiempo de espera del inicio de sesión. Inténtalo de nuevo.',
  acctErrCancelled: 'Se canceló el inicio de sesión.',
  acctErrInvalidCallback: 'La respuesta de inicio de sesión no era válida. Inténtalo de nuevo.',
  acctErrStateMismatch:
    'Este enlace de inicio de sesión no coincide con el intento actual. Vuelve a iniciar sesión desde la aplicación.',
  acctCallbackMismatch:
    'Este enlace de inicio de sesión no coincide. Termina de iniciar sesión en la ventana del navegador que abrió esta aplicación.',
  acctErrAuthCodeInvalid:
    'El código de inicio de sesión ha caducado o ya se usó. Vuelve a iniciar sesión.',
  acctErrRateLimited: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  acctErrUnauthorized: 'Tu sesión ya no es válida. Vuelve a iniciar sesión.',
  acctErrDeviceRevoked: 'Se cerró la sesión en este dispositivo. Vuelve a iniciar sesión.',
  acctErrRefreshReused: 'Por tu seguridad, se finalizó esta sesión. Vuelve a iniciar sesión.',
  acctErrWrongDeployment: 'Esta cuenta pertenece a otro servidor de UniWork.',
  acctErrNotConfigured: 'Esta aplicación no está vinculada a un servidor de UniWork.',
  acctErrKeyringUnavailable: 'El almacenamiento seguro de este equipo no está disponible.',
  acctErrServerError: 'UniWork ha tenido un problema. Inténtalo de nuevo más tarde.',
  acctErrMalformedResponse: 'UniWork envió una respuesta inesperada. Inténtalo de nuevo más tarde.',
} satisfies Record<keyof typeof zh, string>

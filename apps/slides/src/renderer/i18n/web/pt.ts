import type { zh } from './zh'

export const pt = {
  webConflictTitle: 'Esta apresentação foi alterada em outro lugar',
  webConflictBody:
    'Alguém salvou uma versão mais recente. Substituir a troca pelas suas alterações; Recarregar a mais recente descarta suas alterações e abre a versão mais recente.',
  webConflictOverwrite: 'Substituir',
  webConflictReload: 'Recarregar a mais recente',
  webConflictNotSaved: 'a apresentação foi alterada em outro lugar',
  webDiscardTitle: 'Descartar alterações não salvas?',
  webDiscardBody:
    'Esta apresentação tem alterações não salvas. Abrir outro arquivo fará com que sejam perdidas.',
  webDiscard: 'Descartar e abrir',
  webCancel: 'Cancelar',
  webOk: 'OK',
  webFatalTitle: 'Não foi possível abrir a apresentação',
  webFatalBody:
    'Não foi possível carregar o arquivo do UniWork. Feche esta guia e tente novamente.',
  webNoHost: 'Este editor é executado dentro do UniWork. Abra a apresentação pelo UniWork.',
  webLegacyPpt:
    'Este é um arquivo .ppt antigo e não pode ser aberto no navegador. Salve-o primeiro como .pptx no PowerPoint.',
  webEncryptedPptx: 'Esta apresentação é protegida por senha e não pode ser aberta no navegador.',
  webCommentAuthor: 'Usuário',
  webExternalMedia: 'Mídias externas vinculadas só são reproduzidas no aplicativo para desktop.',
  webReadOnly: 'Esta apresentação é somente leitura.',
  webSaveNetwork: 'Não foi possível acessar o UniWork. Verifique sua conexão e tente novamente.',
  webSaveTimeout: 'Salvar demorou demais. Verifique sua conexão e tente novamente.',
} satisfies Record<keyof typeof zh, string>

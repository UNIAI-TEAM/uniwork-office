import type { zh } from './zh'

export const pt = {
  algMenu: 'Registro de acesso',
  algTitle: 'Registro de acesso',
  algDescription:
    'Quem visualizou, baixou ou abriu o documento por um link. Somente gerentes podem ler.',
  algManageOnly: 'Você precisa de acesso de gerenciamento para ler o registro de acesso.',
  algLoading: 'Carregando o registro…',
  algError: 'Não foi possível carregar o registro de acesso.',
  algEmpty: 'Nenhum acesso registrado ainda.',
  algFilterLabel: 'Ação',
  algFilterAll: 'Todas as ações',
  algActionView: 'Visualizar',
  algActionDownload: 'Baixar',
  algActionExport: 'Exportar',
  algActionLinkView: 'Aberto por link',
  algActionUnknown: 'Outro',
  algActorAnonymous: 'Anônimo',
  algActorSystem: 'Sistema',
  algActorUnknown: 'Desconhecido',
  algVersion: 'versão {no}',
} satisfies Record<keyof typeof zh, string>

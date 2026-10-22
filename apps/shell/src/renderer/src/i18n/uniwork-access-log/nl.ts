import type { zh } from './zh'

export const nl = {
  algMenu: 'Toegangslogboek',
  algTitle: 'Toegangslogboek',
  algDescription:
    'Wie het document heeft bekeken, gedownload of via een link geopend. Alleen beheerders kunnen dit lezen.',
  algManageOnly: 'Je hebt beheertoegang nodig om het toegangslogboek te lezen.',
  algLoading: 'Logboek laden…',
  algError: 'Kan het toegangslogboek niet laden.',
  algEmpty: 'Nog geen toegang geregistreerd.',
  algFilterLabel: 'Actie',
  algFilterAll: 'Alle acties',
  algActionView: 'Bekijken',
  algActionDownload: 'Downloaden',
  algActionExport: 'Exporteren',
  algActionLinkView: 'Geopend via link',
  algActionUnknown: 'Overig',
  algActorAnonymous: 'Anoniem',
  algActorSystem: 'Systeem',
  algActorUnknown: 'Onbekend',
  algVersion: 'versie {no}',
} satisfies Record<keyof typeof zh, string>

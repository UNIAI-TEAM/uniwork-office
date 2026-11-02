import type { zh } from './zh'

export const cs = {
  cloudTitle: 'Cloudová AI UniWork',
  cloudStateReady: 'K dispozici',
  cloudStateNotEntitled: 'Není ve vašem tarifu',
  cloudStateExhausted: 'Kredity AI vyčerpány',
  cloudStateUnavailable: 'Nedostupné',
  cloudStateInactive: 'Předplatné není aktivní',
  cloudCredits: 'Kredity AI',
  cloudCreditsLeft: 'Zbývá {remaining} / {limit}',
  cloudCreditsUnlimited: 'Neomezeně',
  cloudCreditsRenews: 'Obnoví se {date}',
  cloudToolsToggle: 'Používat cloudové nástroje UniWork',
  cloudToolsToggleDesc:
    'Vyhledávání na webu, generování obrázků a analýza médií přes cloud UniWork (spotřebovává kredity AI).',
} satisfies Record<keyof typeof zh, string>

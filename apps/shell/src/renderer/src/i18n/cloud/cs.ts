import type { zh } from './zh'

export const cs = {
  cloudTitle: 'Cloudová AI UniWork',
  cloudStatus: 'Stav',
  cloudStateReady: 'K dispozici',
  cloudStateNotEntitled: 'Není ve vašem tarifu',
  cloudStateExhausted: 'Kredity AI vyčerpány',
  cloudStateUnavailable: 'Nedostupné',
  cloudCredits: 'Kredity AI',
  cloudCreditsLeft: 'Zbývá {remaining} / {limit}',
  cloudCreditsUnlimited: 'Neomezeně',
  cloudCreditsRenews: 'Obnoví se {date}',
  cloudSignedOutBody:
    'Přihlaste se do UniWork a používejte vyhledávání na webu, generování obrázků a analýzu médií placené kredity AI vaší organizace.',
  cloudNotEntitledBody:
    'Tarif vaší organizace nezahrnuje cloudovou AI UniWork. Vlastní poskytovatele níže můžete používat dál.',
  cloudExhaustedBody:
    'Vaše organizace vyčerpala všechny kredity AI UniWork pro toto období. Cloudové nástroje jsou pozastaveny do obnovení; vlastní poskytovatelé níže fungují dál.',
  cloudUnavailableBody:
    'Cloudová AI UniWork je teď nedostupná. Vlastní poskytovatelé níže fungují dál.',
  cloudReadyBody:
    'Bez vlastního poskytovatele používá vyhledávání, generování obrázků a analýza médií kredity AI UniWork vaší organizace.',
  cloudToolsToggle: 'Používat cloudové nástroje UniWork',
  cloudToolsToggleDesc:
    'Bez vlastního poskytovatele běží vyhledávání na webu, generování obrázků a analýza médií přes cloud UniWork (spotřebovává kredity AI).',
  cloudMediaLabel: 'Cloud UniWork',
  cloudMediaDesc: 'Používá kredity AI UniWork vaší organizace; klíč není potřeba.',
  cloudSearchAutoHint:
    'Nejprve cloud UniWork (spotřebovává kredity AI), pak bezplatné vyhledávání.',
} satisfies Record<keyof typeof zh, string>

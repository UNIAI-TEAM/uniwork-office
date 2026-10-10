import type { zh } from './zh'

export const cs = {
  cloudTitle: 'Cloudová AI UniWork',
  cloudStateReady: 'K dispozici',
  cloudStateNotEntitled: 'Není ve vašem tarifu',
  cloudStateExhausted: 'Kredity AI vyčerpány',
  cloudStateUnavailable: 'Nedostupné',
  cloudStateSignedOut: 'Nepřihlášeno',
  cloudStateInactive: 'Předplatné není aktivní',
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
  cloudInactiveBody:
    'Předplatné UniWork vaší organizace není aktivní, proto je cloudová AI pozastavena. Požádejte správce o obnovení; vaši vlastní poskytovatelé níže fungují dál.',
  cloudToolsOffBody:
    'Cloudové nástroje UniWork jsou vypnuté. Zapněte „{switch}“ v části {section}, abyste mohli používat kredity AI organizace; vaši vlastní poskytovatelé níže tím nejsou ovlivněni.',
  cloudReadyBody:
    'Bez vlastního poskytovatele používá vyhledávání, generování obrázků a analýza médií kredity AI UniWork vaší organizace.',
  cloudToolsToggle: 'Používat cloudové nástroje UniWork',
  cloudToolsToggleDesc:
    'Bez vlastního poskytovatele běží vyhledávání na webu, generování obrázků a analýza médií přes cloud UniWork (spotřebovává kredity AI).',
  cloudMediaLabel: 'Cloud UniWork',
  cloudMediaDesc: 'Používá kredity AI UniWork vaší organizace; klíč není potřeba.',
  cloudSearchAutoHint:
    'Nejprve cloud UniWork (spotřebovává kredity AI), pak bezplatné vyhledávání.',
  aiTestErrInvalidKey: 'Klíč API chybí nebo byl odmítnut',
  aiTestErrNetwork: 'Nelze se připojit. Zkontrolujte síť',
  aiTestErrLimit: 'Dosažen limit poskytovatele. Zkuste to později',
  aiTestErrUnavailable: 'Služba neodpovídá. Zkuste to později',
  aiTestErrMisconfigured: 'Nastavení je neúplné: zkontrolujte adresu služby a pole účtu',
} satisfies Record<keyof typeof zh, string>

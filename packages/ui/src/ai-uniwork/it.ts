import type { zh } from './zh'

export const it = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Crediti rimasti: {remaining} di {limit}',
  aiUniworkFooterSignIn: 'Accedi a UniWork per usare UniWork AI',
  aiUniworkSignedOut: 'Sei disconnesso da UniWork. Scegli un altro provider o accedi di nuovo.',
  aiUniworkOff: 'UniWork AI è disattivato per questo documento. Scegli un altro provider.',
  aiUniworkViewOnly:
    'Sola visualizzazione: l’IA può rispondere ma non può modificare né salvare il documento.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI legge ciò che è aperto in questo documento, comprese le modifiche non salvate, e lo invia a UniWork e al provider del modello per rispondere. Ogni esecuzione usa i crediti IA di {org}. L’IA non salva mai al posto tuo: controlla, poi premi Salva.',
  aiUniworkDisclosureLabel: 'Cosa riceve UniWork AI',
  aiUniworkDisclosureShort:
    'Invia il contenuto aperto (anche non salvato) a UniWork · crediti di {org}',
  aiUniworkLocalFile:
    'Questo file è sul tuo computer, non in UniWork. Con UniWork AI il contenuto del file aperto viene inviato a UniWork e usa i crediti IA di {org}. Il file non viene caricato come documento UniWork.',
  aiUniworkAck: 'Ho capito',
  aiUniworkLearnMore: 'Scopri di più',
  aiUniworkDetails: 'Dettagli',
  aiUniworkSendNeedsAck: 'Leggi e conferma l’avviso prima di inviare.',

  // S9 result chips and run controls
  aiResultAnswer: 'Risposta',
  aiResultClarify: 'Serve un chiarimento',
  aiResultEdited: 'Modificato nel documento',
  aiResultUnsupported: 'Non supportato',
  aiResultError: 'Errore',
  aiResultEditedHint: 'Non salvato — annulla con Ctrl/⌘+Z oppure premi Salva quando va bene.',
  aiResultViewChanges: 'Visualizza modifiche',
  aiRunStop: 'Interrompi',
  aiRunSend: 'Invia',
  aiRunRunning: 'In esecuzione… Premi Interrompi o Esc per fermare.',
  aiRunStopped:
    'Interrotto. Le modifiche già applicate restano nel documento e possono essere annullate.',
  aiRunAskAgain: 'Chiedi di nuovo',
  aiRunChooseOther: 'Scegli un altro provider',
  aiRunOpenInApp: 'Apri nell’app',
  aiConversationRestarted:
    'La conversazione precedente è scaduta, quindi UniWork AI ne ha iniziata una nuova e non ricorda più i turni precedenti. Invia di nuovo la domanda per continuare.',
  aiConversationBoundary:
    'Nuova conversazione con {provider}: i turni precedenti non vengono inviati.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Questa esecuzione ha raggiunto il limite di passaggi di UniWork AI. I risultati finora vengono mantenuti; dividi la richiesta e chiedi di nuovo.',
  aiErrCredits:
    'La tua organizzazione ha esaurito i crediti IA per questo periodo. Questa esecuzione si è interrotta.',
  aiErrEntitlement: 'Il piano della tua organizzazione non include più UniWork AI.',
  aiErrRateLimited: 'Stai inviando troppo velocemente. Riprova tra {seconds} s.',
  aiErrRateLimitedNoWait: 'Stai inviando troppo velocemente. Riprova tra qualche minuto.',
  aiErrUnavailable: 'UniWork AI non risponde al momento. Il documento e Salva funzionano ancora.',
  aiErrDisconnected:
    'La connessione si è interrotta, quindi questa esecuzione si è fermata. Le modifiche già applicate restano nel documento e possono essere annullate.',
  aiErrOffline:
    'Sei offline. UniWork AI non funziona offline e le richieste non vengono messe in coda.',
  aiErrSession:
    'La sessione UniWork è scaduta, quindi questa esecuzione si è fermata. Accedi di nuovo per continuare.',
  aiErrRevoked: 'Non hai più accesso a questo documento, quindi l’esecuzione dell’IA si è fermata.',
  aiErrDowngraded:
    'Il tuo accesso è appena passato a sola visualizzazione, quindi l’IA ha smesso di modificare. Le risposte continuano.',
  aiErrCapabilityOff:
    'UniWork AI è stato appena disattivato per questo documento, quindi l’esecuzione si è fermata dopo il passaggio corrente.',
  aiErrUnsupported: 'UniWork AI non può ancora farlo in {module}.',
  aiErrViewOnlyEdit:
    'Hai solo accesso in visualizzazione a questo documento, quindi l’IA non può modificarlo.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'La richiesta è troppo lunga per UniWork AI. Accorciala sotto gli 8.000 caratteri e inviala di nuovo.',
  aiErrQuestionRejected:
    'UniWork AI non ha potuto accettare questa richiesta. Modificala e inviala di nuovo.',
  aiUniworkImagesNotSent:
    'Le immagini non vengono inviate a UniWork AI; è stato inviato solo il testo.',
} satisfies Record<keyof typeof zh, string>

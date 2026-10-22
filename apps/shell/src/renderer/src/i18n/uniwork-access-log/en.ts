import type { zh } from './zh'

export const en = {
  algMenu: 'Access log',
  algTitle: 'Access log',
  algDescription:
    'Who viewed, downloaded or opened the document through a link. Only managers can read it.',
  algManageOnly: 'You need manage access to read the access log.',
  algLoading: 'Loading the log…',
  algError: 'Could not load the access log.',
  algEmpty: 'No access recorded yet.',
  algFilterLabel: 'Action',
  algFilterAll: 'All actions',
  algActionView: 'View',
  algActionDownload: 'Download',
  algActionExport: 'Export',
  algActionLinkView: 'Opened via link',
  algActionUnknown: 'Other',
  algActorAnonymous: 'Anonymous',
  algActorSystem: 'System',
  algActorUnknown: 'Unknown',
  algVersion: 'version {no}',
} satisfies Record<keyof typeof zh, string>

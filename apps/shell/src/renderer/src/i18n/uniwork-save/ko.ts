import type { zh } from './zh'

export const ko = {
  usMyFolder: '내 폴더',
  usPrivateTag: '비공개',
  usDialogTitle: '문서 이름 지정',
  usHint:
    '처음 저장합니다. 이후 저장할 때는 이 이름이 유지되며, 이름을 바꾸려면 "다른 이름으로 저장"을 사용하세요.',
  usName: '이름',
  usLocation: '저장 위치',
  usSavingIn: '저장 위치: {folder}',
  usMyFolderPrivate: '비공개, 나만 볼 수 있음',
  usChange: '변경',
  usSave: '저장',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: '닫기',
  usPickTitle: '저장 위치 선택',
  usBack: '이름 지정으로 돌아가기',
  usSearchFolders: '폴더 검색',
  usChooseFolder: '"{folder}" 선택',
  usSelected: '선택됨',
  usRootBlocked: '폴더를 선택하세요',
  usErrInvalidDestination: '여기에는 저장할 수 없습니다. 다른 폴더를 선택하세요.',
  usErrMyFolderLocked:
    '내 폴더는 개인 시스템 폴더이므로 이름 변경, 공유, 이동, 보관할 수 없습니다.',
  usErrFlushFailed:
    '문서를 아직 이 기기에 쓰지 못했습니다. 먼저 문서를 저장한 다음 다시 시도하세요.',
  usErrBindFailed:
    '"{title}"(ID {id})을(를) 만들었지만 이 탭에 연결하지 못했습니다. 문서는 휴지통으로 옮겨졌으며 복원할 수 있습니다.',
  usErrOrphaned:
    'UniWork에 "{title}"(ID {id})을(를) 만들었지만 이 탭에 연결하지 못했고 휴지통으로 옮기지도 못했습니다. UniWork에서 해당 문서를 삭제하거나 사용하세요.',
  usErrAlreadyBound: '이 탭은 이미 UniWork 문서에 연결되어 있습니다. 평소처럼 저장하세요.',
  usErrNotFound:
    '저장할 파일이나 선택한 폴더를 찾을 수 없습니다. 저장 위치를 다시 선택한 뒤 다시 시도하세요.',
  usShareToggle: 'Share with workspace',
  usShareHint: 'Everyone in this workspace can view this document',
  usShareAlready: 'Already shared with the workspace',
  usShareFailed: 'Could not share. Check the principal and the level.',
} satisfies Record<keyof typeof zh, string>

; Keeps the genoffice command line (resources\cli, holding genoffice.cmd and the
; extension-less genoffice for Git Bash) on the installing user's PATH for the
; lifetime of the install. The value is read and written unexpanded
; (REG_EXPAND_SZ) so entries such as %USERPROFILE%\bin survive, and Explorer
; is told about the change so terminals opened afterwards see it.
; electron-builder compiles the script twice (the second pass, with
; BUILD_UNINSTALLER, only produces the uninstaller); an unreferenced function
; in either pass is a warning makensis treats as an error, hence the guards.
!include "WinMessages.nsh"
!include "StrFunc.nsh"

!define GENOFFICE_PATH_MAX 7900

; Scope templates to our ProgIDs (electron-builder uses fileAssociations.name).
; A shared .ext\ShellNew would overwrite Office/WPS templates. OOXML files
; must be copied from valid packages, never created with NullFile.
!macro GenOfficeRegisterShellNew EXT PROGID
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew" "FileName" "$INSTDIR\resources\shell-new\blank.${EXT}"
!macroend

!macro GenOfficeUnregisterShellNew EXT PROGID
  ; Only remove our own registration, including when uninstalling for an update.
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew" "FileName"
  ${If} $0 == "$INSTDIR\resources\shell-new\blank.${EXT}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}"
  ${EndIf}
!macroend

!macro customInstall
  Push "$INSTDIR\resources\cli"
  Call GenOfficeAddToUserPath
  !insertmacro GenOfficeRegisterShellNew "docx" "Word Document"
  !insertmacro GenOfficeRegisterShellNew "xlsx" "Excel Workbook"
  !insertmacro GenOfficeRegisterShellNew "pptx" "PowerPoint Presentation"
  !insertmacro UPDATEFILEASSOC
  ; An organization download bundle ships deployment-profile.json next to the
  ; installer; the app reads it from resources\ (process.resourcesPath). A
  ; profile beside this installer always wins; otherwise the copy that
  ; customInit saved from the install being replaced is put back, so a plain
  ; installer (or an auto-update) does not drop the profile. Interactive installs
  ; hide the details list and silent ones have no log, so a failed copy is shown
  ; as a message box (answered with OK automatically in a silent install); the
  ; DetailPrint lines only record the other outcomes.
  ${If} ${FileExists} "$EXEDIR\deployment-profile.json"
    ClearErrors
    CopyFiles /SILENT "$EXEDIR\deployment-profile.json" "$INSTDIR\resources\deployment-profile.json"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "UniWork Office could not copy the organization deployment profile from the installer folder.$\r$\n$\r$\nExtract the whole download bundle to a folder, then run the installer again. If this message appears again, contact your administrator." /SD IDOK
    ${Else}
      DetailPrint "Deployment profile: installed from $EXEDIR\deployment-profile.json"
    ${EndIf}
  ${ElseIf} ${FileExists} "$PLUGINSDIR\deployment-profile.keep"
    ClearErrors
    CopyFiles /SILENT "$PLUGINSDIR\deployment-profile.keep" "$INSTDIR\resources\deployment-profile.json"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "UniWork Office could not restore the organization deployment profile of the previous installation.$\r$\n$\r$\nExtract the whole download bundle to a folder, then run the installer again. If this message appears again, contact your administrator." /SD IDOK
    ${Else}
      DetailPrint "Deployment profile: kept the profile of the previous install"
    ${EndIf}
  ${Else}
    DetailPrint "Deployment profile: none next to the installer ($EXEDIR), none to keep"
  ${EndIf}
!macroend

; Runs in .onInit, before the install section starts the old uninstaller. That
; uninstaller empties the whole install directory when updating, deployment
; profile included (and releases that predate this macro delete it
; unconditionally), so the file is saved to the installer's temp dir first.
!macro customInit
  InitPluginsDir
  Push $0
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\resources\deployment-profile.json"
    ClearErrors
    CopyFiles /SILENT "$0\resources\deployment-profile.json" "$PLUGINSDIR\deployment-profile.keep"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "UniWork Office could not save the organization deployment profile of the current installation before updating.$\r$\n$\r$\nExtract the whole download bundle to a folder, then run the installer again. If this message appears again, contact your administrator." /SD IDOK
    ${EndIf}
  ${EndIf}
  Pop $0
!macroend

!macro customUnInstall
  Push "$INSTDIR\resources\cli"
  Call un.GenOfficeRemoveFromUserPath
  Push $0
  !insertmacro GenOfficeUnregisterShellNew "docx" "Word Document"
  !insertmacro GenOfficeUnregisterShellNew "xlsx" "Excel Workbook"
  !insertmacro GenOfficeUnregisterShellNew "pptx" "PowerPoint Presentation"
  Pop $0
  !insertmacro UPDATEFILEASSOC
  ; Only a real uninstall removes the profile; an update keeps it (the
  ; installer restores it after this uninstaller has emptied the directory).
  ${IfNot} ${isUpdated}
    Delete "$INSTDIR\resources\deployment-profile.json"
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
${StrStr}

Function GenOfficeAddToUserPath
  Exch $0 ; directory
  Push $1
  Push $2
  Push $3
  ReadRegStr $1 HKCU "Environment" "Path"
  StrLen $2 $1
  ; leave an already oversized PATH alone rather than truncate it
  IntCmp $2 ${GENOFFICE_PATH_MAX} done 0 done
  ${StrStr} $3 ";$1;" ";$0;"
  StrCmp $3 "" 0 done
  StrCmp $1 "" 0 +3
    StrCpy $1 "$0"
    Goto write
  StrCpy $1 "$1;$0"
write:
  WriteRegExpandStr HKCU "Environment" "Path" $1
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
${UnStrStr}
${UnStrRep}

Function un.GenOfficeRemoveFromUserPath
  Exch $0 ; directory
  Push $1
  Push $2
  ReadRegStr $1 HKCU "Environment" "Path"
  StrCmp $1 "" done
  ${UnStrStr} $2 ";$1;" ";$0;"
  StrCmp $2 "" done
  StrCpy $1 ";$1;"
  ${UnStrRep} $1 $1 ";$0;" ";"
  ; strip the sentinels added above
  StrCpy $1 $1 -1
  StrCpy $1 $1 "" 1
  WriteRegExpandStr HKCU "Environment" "Path" $1
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif

; Animama's additions to electron-builder's per-user NSIS installer.

; Animama needs Windows 11 (build 22000) or later. A silent run exits with
; ERROR_OLD_WIN_VERSION (1150) instead of showing the message.
!macro customInit
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $0 < 22000
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Animama requires Windows 11 or later."
    ${EndIf}
    SetErrorLevel 1150
    Quit
  ${EndIf}
!macroend

; Keep the user's data unless they explicitly choose to delete it. Only a
; person-started uninstall asks: one without /S on its command line. The
; one-click uninstaller switches itself to silent mode after its confirmation,
; so the silent flag cannot tell, and installers always run the old uninstaller
; with /S (an update also passes --updated).
!macro customUnInstall
  Push $R0
  Push $R1
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${If} ${Errors}
  ${AndIfNot} ${isUpdated}
  ${AndIf} $LOCALAPPDATA != ""
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Animama data?$\r$\n$\r$\n$LOCALAPPDATA\Animama$\r$\n$\r$\nThis permanently removes your chats, Animas, Local content, settings, saved keys and downloaded speech models. Choose No to keep them for a later reinstall." IDNO animama_keep_data
    RMDir /r "$LOCALAPPDATA\Animama"
    animama_keep_data:
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

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

; Keep the user's data unless they explicitly choose to delete it, and never
; ask during a silent uninstall or an update, which also runs the uninstaller.
!macro customUnInstall
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
  ${AndIf} $LOCALAPPDATA != ""
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Animama data?$\r$\n$\r$\n$LOCALAPPDATA\Animama$\r$\n$\r$\nThis permanently removes your chats, Animas, Local content, settings and saved keys. Choose No to keep them for a later reinstall." IDNO animama_keep_data
    RMDir /r "$LOCALAPPDATA\Animama"
    animama_keep_data:
  ${EndIf}
!macroend

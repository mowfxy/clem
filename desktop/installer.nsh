!ifdef BUILD_UNINSTALLER
Var removeMowrData
!endif
!macro customUnInit
  StrCpy $removeMowrData "no"
  ${if} ${isUpdated}
    Goto keepMowrData
  ${endif}
  IfSilent keepMowrData
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also permanently delete all Mowr chats, files, subjects and local data from Documents? Choose No to keep your work for reinstalling." IDNO keepMowrData
    StrCpy $removeMowrData "yes"
  keepMowrData:
!macroend
!macro customUnInstall
  StrCmp $removeMowrData "yes" 0 doneMowrData
    SetShellVarContext current
    RMDir /r "$DOCUMENTS\Mowr"
    RMDir /r "$APPDATA\Mowr"
    RMDir /r "$APPDATA\mowr-desktop"
  doneMowrData:
!macroend

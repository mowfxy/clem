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
  ; A real uninstall (not an update) also removes Mowr from Windows' startup list ("Start with Windows").
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Mowr"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.mowrai.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Mowr"
  ${endIf}
  StrCmp $removeMowrData "yes" 0 doneMowrData
    SetShellVarContext current
    RMDir /r "$DOCUMENTS\Mowr"
    RMDir /r "$APPDATA\Mowr"
    RMDir /r "$APPDATA\mowr-desktop"
  doneMowrData:
!macroend

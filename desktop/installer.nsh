!ifdef BUILD_UNINSTALLER
Var removeClemData
!endif
!macro customUnInit
  StrCpy $removeClemData "no"
  ${if} ${isUpdated}
    Goto keepClemData
  ${endif}
  IfSilent keepClemData
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also permanently delete all Clem chats, files, subjects and local data from Documents? Choose No to keep your work for reinstalling." IDNO keepClemData
    StrCpy $removeClemData "yes"
  keepClemData:
!macroend
!macro customUnInstall
  ; A real uninstall (not an update) also removes Clem from Windows' startup list ("Start with Windows").
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Clem"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "xyz.m4labs.clem"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Clem"
  ${endIf}
  StrCmp $removeClemData "yes" 0 doneClemData
    SetShellVarContext current
    RMDir /r "$DOCUMENTS\Clem"
    RMDir /r "$APPDATA\Clem"
    RMDir /r "$APPDATA\clem-desktop"
  doneClemData:
!macroend

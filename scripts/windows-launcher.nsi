Unicode true
!include "FileFunc.nsh"
Name "Raumcast"
OutFile "${APP_DIR}/Raumcast.exe"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
LoadLanguageFile "${NSISDIR}/Contrib/Language files/German.nlf"

Section
  SetOutPath "$EXEDIR"
  ${GetParameters} $0
  ; nsExec runs Node without a console and waits for the application to finish.
  nsExec::ExecToStack '"$EXEDIR\runtime\node.exe" "$EXEDIR\dist\main.js" $0'
  Pop $1
  Pop $2
  StrCmp $1 "0" success
  MessageBox MB_OK|MB_ICONSTOP "Raumcast konnte nicht korrekt ausgeführt werden.$\r$\n$2$\r$\nDetails: $LOCALAPPDATA\Raumcast\raumcast.log" /SD IDOK
  SetErrorLevel 1
  Quit
success:
  SetErrorLevel 0
SectionEnd

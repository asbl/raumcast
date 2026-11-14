Unicode true
!include "MUI2.nsh"
Name "Raumcast"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Raumcast"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"

Section "Raumcast"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}/*"
  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  CreateShortcut "$SMPROGRAMS\Raumcast.lnk" "$INSTDIR\Raumcast.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raumcast" "DisplayName" "Raumcast"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raumcast" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raumcast" "UninstallString" '$\"$INSTDIR\Deinstallieren.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raumcast" "DisplayIcon" "$INSTDIR\Raumcast.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raumcast" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raumcast" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\Raumcast.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raumcast"
  ; Only remove shipped application files; saved rooms/profile remain untouched.
  RMDir /r "$INSTDIR\dist"
  RMDir /r "$INSTDIR\ui"
  RMDir /r "$INSTDIR\assets"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\docs"
  RMDir /r "$INSTDIR\scripts"
  Delete "$INSTDIR\Raumcast.exe"
  Delete "$INSTDIR\Raumcast.cmd"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\package-lock.json"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\AUDIT*.md"
  Delete "$INSTDIR\Deinstallieren.exe"
  RMDir "$INSTDIR"
SectionEnd

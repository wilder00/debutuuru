; Puts the `debutuuru` CLI on the user's PATH (setup.exe, per-user install).
; Only `$INSTDIR\bin` goes on PATH, so `uninstall.exe` doesn't.
; The PATH edit itself runs in the CLI (Rust): NSIS strings stop at 1024
; characters and would truncate a longer PATH.

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog '"$INSTDIR\bin\debutuuru.exe" windows-path add "$INSTDIR\bin"'
  Pop $0
  ; Tell open programs (Explorer, new terminals) the environment changed.
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog '"$INSTDIR\bin\debutuuru.exe" windows-path remove "$INSTDIR\bin"'
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

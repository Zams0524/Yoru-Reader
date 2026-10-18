; Yoru Reader installer theme (included automatically by electron-builder).
; Palette matches the app: background #0c0e13, panels #161921, text #e8e8f0, accent #ffe45c.
; Artwork: build/installerSidebar.bmp and build/installerHeader.bmp (regenerate with build/make-installer-art.ps1).
!pragma warning disable 6010
!pragma warning disable 6020

; Crisp text on scaled displays (otherwise Windows bitmap-stretches the whole window)
; and the modern system font instead of MS Shell Dlg.
ManifestDPIAware true
SetFont "Segoe UI" 9

!define YORU_BG 0x0C0E13
!define YORU_TEXT 0xE8E8F0
!define MUI_BGCOLOR "0C0E13"
!define MUI_TEXTCOLOR "E8E8F0"
!define MUI_LICENSEPAGE_BGCOLOR "161921"
!define MUI_DIRECTORYPAGE_BGCOLOR "161921"
!define MUI_INSTFILESPAGE_COLORS "E8E8F0 161921"
!define MUI_HEADER_TRANSPARENT_TEXT
!define MUI_CUSTOMFUNCTION_GUIINIT GuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.GuiInit

; Progress bar colours are COLORREF (0x00BBGGRR).
!define YORU_PROGRESS_BAR 0x005CE4FF ; #ffe45c
!define YORU_PROGRESS_BG 0x00211916  ; #161921
; Raw message ids: this file is included before WinMessages.nsh in the uninstaller pass,
; so PBM_SETBARCOLOR (0x0409) / PBM_SETBKCOLOR (0x2001) are not defined yet.

; Welcome page with the sidebar artwork before the install options.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro YoruHideBranding
  ; Hide the "Yoru-Reader x.y.z" branding text and the etched line it sits on.
  ; MUI shows them again on every inner page, so this runs on each page show too.
  GetDlgItem $0 $HWNDPARENT 1028
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1256
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1045
  ShowWindow $0 0
  ; Bright etched line under the page header
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 0
!macroend

!macro YoruDarkButtons
  ; Back (3), Next (1) and Cancel (2) with Windows' dark Explorer theme (Windows 10 1809+).
  GetDlgItem $0 $HWNDPARENT 1
  System::Call "uxtheme::SetWindowTheme(p r0, w 'DarkMode_Explorer', p 0)"
  GetDlgItem $0 $HWNDPARENT 2
  System::Call "uxtheme::SetWindowTheme(p r0, w 'DarkMode_Explorer', p 0)"
  GetDlgItem $0 $HWNDPARENT 3
  System::Call "uxtheme::SetWindowTheme(p r0, w 'DarkMode_Explorer', p 0)"
!macroend

!macro YoruStyleWindow
  ; Dark title bar (Windows 10 1809+ / Windows 11)
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4)'
  SetCtlColors $HWNDPARENT ${YORU_TEXT} ${YORU_BG}
  !insertmacro YoruHideBranding
  !insertmacro YoruDarkButtons
!macroend

; Inserted into exactly one function per installer/uninstaller, so the labels are unique there.
!macro YoruColorizeActivePage
  !insertmacro YoruHideBranding
  ; Colour every page dialog (#32770) and its controls; themes are removed so colours apply.
  ; When going Back the outgoing page still exists for a moment, so all of them are handled.
  StrCpy $4 0
  yoru_dialog:
  FindWindow $0 "#32770" "" $HWNDPARENT $4
  IntCmp $0 0 yoru_done
  StrCpy $4 $0
  SetCtlColors $0 ${YORU_TEXT} ${YORU_BG}
  System::Call "user32::GetWindow(p r0, i 5) p.r1" ; GW_CHILD
  yoru_loop:
    IntCmp $1 0 yoru_progress
    ; Push buttons (e.g. Browse...) get the dark Explorer theme; everything else is unthemed and recoloured.
    System::Call "user32::GetClassNameW(p r1, w .r2, i 64)"
    StrCmp $2 "Button" 0 yoru_plain
    System::Call "user32::GetWindowLongW(p r1, i -16) i.r3" ; GWL_STYLE
    IntOp $3 $3 & 0xF
    IntCmp $3 1 yoru_push yoru_push yoru_plain ; BS_PUSHBUTTON (0) or BS_DEFPUSHBUTTON (1)
    yoru_push:
      System::Call "uxtheme::SetWindowTheme(p r1, w 'DarkMode_Explorer', p 0)"
      Goto yoru_next
    yoru_plain:
      System::Call "uxtheme::SetWindowTheme(p r1, w ' ', w ' ')"
      SetCtlColors $1 ${YORU_TEXT} ${YORU_BG}
    yoru_next:
    System::Call "user32::GetWindow(p r1, i 2) p.r1" ; GW_HWNDNEXT
    Goto yoru_loop
  yoru_progress:
  ; Progress bar on the install page (control 1004): accent bar on a panel-coloured track.
  GetDlgItem $1 $0 1004
  IntCmp $1 0 yoru_dialog
  SendMessage $1 0x0409 0 ${YORU_PROGRESS_BAR} ; PBM_SETBARCOLOR
  SendMessage $1 0x2001 0 ${YORU_PROGRESS_BG}  ; PBM_SETBKCOLOR
  Goto yoru_dialog
  yoru_done:
!macroend

Function GuiInit
  !insertmacro YoruStyleWindow
  ; Dummy references so NSIS does not warn about functions only some page sets use.
  GetFunctionAddress $0 PageShow
  GetFunctionAddress $0 InstallModePre
  GetFunctionAddress $0 InstallModeShow
FunctionEnd

Function un.GuiInit
  !insertmacro YoruStyleWindow
FunctionEnd

; --- Installer pages ---

Function PageShow
  Call ColorizeActivePage
FunctionEnd

Function FinishPageShow
  Call ColorizeActivePage
  ; No "Back" on the last page.
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 0
FunctionEnd

Function InstallModePre
FunctionEnd

Function InstallModeShow
  Call ColorizeActivePage
FunctionEnd

Function ColorizeActivePage
  !insertmacro YoruColorizeActivePage
FunctionEnd

; --- Uninstaller pages ---

Function un.PageShow
  Call un.ColorizeActivePage
FunctionEnd

Function un.FinishPageShow
  Call un.ColorizeActivePage
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 0
FunctionEnd

Function un.InstallModePre
FunctionEnd

Function un.InstallModeShow
  Call un.ColorizeActivePage
FunctionEnd

Function un.ColorizeActivePage
  !insertmacro YoruColorizeActivePage
FunctionEnd

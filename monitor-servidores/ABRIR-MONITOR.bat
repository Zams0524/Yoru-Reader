@echo off
rem Abre el monitor de los servidores de Yoru: enciende lo que este apagado
rem (Tailscale, sincronizacion, Kavita y Audiobookshelf) y ensena el panel.
title Yoru - monitor de servidores
cd /d "%~dp0"
echo.
echo   Yoru - monitor de servidores
echo   Panel: http://127.0.0.1:3748/
echo   Cierra esta ventana para dejar de vigilar. Los servidores siguen encendidos.
echo.
node monitor.mjs
if errorlevel 1 (
  echo.
  echo   El monitor termino con error. Revisa el mensaje de arriba.
  pause
)

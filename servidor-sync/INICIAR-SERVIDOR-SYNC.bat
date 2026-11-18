@echo off
rem Arranca el servidor de sincronizacion de Yoru en este PC.
rem Doble clic y a leer. Para que arranque solo con Windows, ver README.md.
title Yoru - servidor de sincronizacion
cd /d "%~dp0"
echo.
echo   Yoru - servidor de sincronizacion
echo   Puerto 3747. Cierra esta ventana para pararlo.
echo.
node servidor.mjs
if errorlevel 1 (
  echo.
  echo   El servidor termino con error. Revisa el mensaje de arriba.
  pause
)

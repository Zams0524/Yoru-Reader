# Skill: actualizar-extension
Úsalo cuando haya que cambiar algo en `backend/reader-ext` (la extensión de lectura).

## REGLA CLAVE
`backend/reader-ext` **no se edita a mano**. El código fuente es el fork `Zams0524/JitenReader`, rama `yoru`. Directorio local del fork: `C:\Users\Zams\Documents\Codex\2026-10-16\co\work\JitenReader`.

## Flujo completo
1. **Hacer los cambios** en el fork (`C:\...\JitenReader`), rama `yoru`.
   - La documentación de los cambios específicos de Yoru está en `YORU.md` (en el fork).
2. **Commit y push** en el fork.
3. **Crear un tag** con el formato `yoru-vX-N` (X = versión base de JitenReader, N = número de parche Yoru):
   ```bash
   git tag yoru-v1.3.2-2
   git push origin yoru-v1.3.2-2
   ```
4. **Actualizar `build/reader-ext.json`** en Yoru Reader con el nuevo tag:
   ```json
   { "tag": "yoru-v1.3.2-2", "repo": "Zams0524/JitenReader" }
   ```
5. **Compilar localmente** para verificar:
   ```powershell
   node build/build-reader-ext.mjs
   ```
   Esto clona el tag, hace `npm ci`, compila y copia a `backend/reader-ext/`.
6. **Verificar** que `backend/reader-ext/manifest.json` y los archivos compilados se ven bien.
7. **Commit** en Yoru Reader:
   ```
   feat(ext): descripción del cambio (yoru-v1.3.2-2)
   ```
8. Push → el workflow de GitHub Actions recompilará la extensión automáticamente.

## Cómo probar sin publicar
```powershell
$env:ELECTRON_ARGS = "--user-data-dir=$env:TEMP\yoru-test --proxy-server=127.0.0.1:9"
npm run electron:start
```
Abrir DevTools del Electron, comprobar que la extensión carga sin errores en la consola.

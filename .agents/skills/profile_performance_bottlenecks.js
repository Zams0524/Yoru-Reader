// .agents/skills/profile_performance_bottlenecks.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @name profile_performance_bottlenecks
 * @description Escanea el código fuente buscando patrones ineficientes, falta de memorización en React o fugas de memoria en Electron.
 */
export default function profile_performance_bottlenecks() {
    const srcPath = path.join(__dirname, '../../src');
    if (!fs.existsSync(srcPath)) {
        return { status: "warning", message: "No se encontró la carpeta /src para analizar optimización." };
    }

    const issues = [];
    
    function scanDirectory(dir) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory() && file !== 'node_modules' && file !== 'dist-electron') {
                scanDirectory(fullPath);
            } else if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.ts') || file.endsWith('.tsx'))) {
                const content = fs.readFileSync(fullPath, 'utf8');
                
                // 1. Detectar falta de memorización en listas o mapeos grandes
                if (content.includes('.map(') && !content.includes('useMemo') && !content.includes('memo(')) {
                    issues.push({ file: path.basename(fullPath), type: "React Performance", detail: "Se detectó un .map() renderizando elementos sin optimización de useMemo o React.memo." });
                }
                // 2. Detectar posibles fugas de memoria en Electron IPC listeners
                if (content.includes('.on(') && !content.includes('.removeListener(') && !content.includes('.removeAllListeners(')) {
                    issues.push({ file: path.basename(fullPath), type: "Electron Memory Leak", detail: "Se usa ipcRenderer.on o similar pero no se limpia el listener al desmontar." });
                }
                // 3. Importaciones ineficientes (ej. Lodash entero en lugar de destructurado)
                if (content.includes("import lodash from 'lodash'") || content.includes("import _ from 'lodash'")) {
                    issues.push({ file: path.basename(fullPath), type: "Bundle Size", detail: "Importación completa de lodash detectada. Debería usarse importación atómica para optimizar peso." });
                }
            }
        });
    }

    scanDirectory(srcPath);
    return {
        status: "success",
        suggestionsCount: issues.length,
        bottlenecks: issues.slice(0, 15)
    };
}

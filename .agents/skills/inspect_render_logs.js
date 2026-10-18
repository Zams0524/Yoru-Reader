// .agents/skills/inspect_render_logs.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @name inspect_render_logs
 * @description Escanea los archivos de registro de errores (logs) del proceso de desarrollo buscando excepciones o fallos en tiempo de ejecución.
 */
export default function inspect_render_logs() {
    const logPath = path.join(__dirname, '../../dev.log');
    if (!fs.existsSync(logPath)) {
        return { status: "success", message: "No se detectaron archivos de error pendientes (dev.log limpio)." };
    }

    try {
        const logs = fs.readFileSync(logPath, 'utf8').split('\n');
        const criticalErrors = logs.filter(line => line.includes('Error:') || line.includes('Exception') || line.includes('UnhandledPromiseRejection'));
        
        return {
            status: criticalErrors.length ? "warning" : "success",
            criticalCount: criticalErrors.length,
            recentErrors: criticalErrors.slice(-5)
        };
    } catch (e) {
        return { status: "error", message: `No se pudieron leer los logs: ${e.message}` };
    }
}

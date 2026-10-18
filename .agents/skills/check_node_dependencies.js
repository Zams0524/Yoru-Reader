// .agents/skills/check_node_dependencies.js
import { execSync } from 'child_process';

/**
 * @name check_node_dependencies
 * @description Escanea node_modules en busca de librerías en conflicto, paquetes faltantes o problemas con módulos nativos.
 */
export default function check_node_dependencies() {
    try {
        console.log("Analizando dependencias del proyecto...");
        const output = execSync('npm ls --depth=0 --json', { encoding: 'utf8' });
        const parsed = JSON.parse(output);
        return { status: "success", data: parsed, message: "Estructura de paquetes consistente." };
    } catch (error) {
        if (error.stdout) {
            try {
                const parsed = JSON.parse(error.stdout);
                return { status: "warning", data: parsed, message: "Hay dependencias secundarias no resueltas (revisar npm ls)." };
            } catch (errJson) {
                // fall through
            }
        }
        return { status: "error", message: `Fallo al verificar dependencias de node: ${error.message}` };
    }
}

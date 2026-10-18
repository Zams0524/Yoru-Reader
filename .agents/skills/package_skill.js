// .agents/skills/package_skill.js
import { execSync } from 'child_process';

/**
 * @name test_and_package_yoru
 * @description Obligatorio ejecutar tras cambios de código para compilar la versión de escritorio local.
 */
export default function test_and_package_yoru() {
    try {
        console.log("Iniciando pruebas rápidas de compilación y empaquetado...");
        execSync('npm run electron:package', { stdio: 'inherit' });
        return { status: "success", message: "Empaquetado rápido completado. Carpeta temporal de distribución lista." };
    } catch (error) {
        return { status: "error", message: `Fallo al empaquetar el binario local: ${error.message}` };
    }
}

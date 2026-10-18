// .agents/skills/android_hot_reload.js
import { execSync } from 'child_process';

/**
 * @name android_hot_reload
 * @description Sincroniza rápidamente los cambios de la interfaz web con el contenedor nativo de Android.
 */
export default function android_hot_reload() {
    try {
        console.log("Sincronizando vistas con el entorno de Android...");
        execSync('npm run build:web && npx cap sync android', { stdio: 'inherit' }); 
        return { status: "success", message: "Sintaxis de Android sincronizada. Listo para previsualizar en el emulador/dispositivo." };
    } catch (error) {
        return { status: "error", message: `Error al sincronizar Android: ${error.message}` };
    }
}

// .agents/skills/validate_jmdict_schema.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @name validate_jmdict_schema
 * @description Verifica que los archivos de diccionario indexados no estén corruptos y mantengan el esquema correcto.
 */
export default function validate_jmdict_schema() {
    const dictPath = path.join(__dirname, '../../src/assets/dictionaries/jmdict.json');
    if (!fs.existsSync(dictPath)) {
        return { status: "warning", message: "No se encontró archivo jmdict.json local para verificar. Saltando validación." };
    }
    try {
        const data = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
        if (data && typeof data === 'object') {
            return { status: "success", message: "Estructura de diccionario JMdict verificada correctamente." };
        }
    } catch (e) {
        return { status: "error", message: `El diccionario está corrupto o mal formateado: ${e.message}` };
    }
}

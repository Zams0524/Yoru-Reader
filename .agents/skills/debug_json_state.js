// .agents/skills/debug_json_state.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @name debug_json_state
 * @description Analiza archivos de configuración o estado local para detectar corrupción de datos o valores undefined que generen bugs en la UI.
 */
export default function debug_json_state() {
    const pathsToConfig = [
        path.join(__dirname, '../../package.json'),
    ];

    let report = [];
    pathsToConfig.forEach(filePath => {
        if (!fs.existsSync(filePath)) return;
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(content);
            
            const keysWithIssues = [];
            Object.keys(parsed).forEach(key => {
                if (parsed[key] === null || parsed[key] === "undefined" || parsed[key] === "") {
                    keysWithIssues.push(key);
                }
            });

            report.push({
                file: path.basename(filePath),
                status: keysWithIssues.length ? "warning" : "ok",
                issues: keysWithIssues
            });
        } catch (e) {
            report.push({ file: path.basename(filePath), status: "corrupted", error: e.message });
        }
    });

    return { status: "success", analysis: report };
}

// .agents/skills/sync_mock_anki.js
import http from 'http';

/**
 * @name sync_mock_anki
 * @description Prueba si el payload de las palabras bajo 'Aprendiendo' se comunica bien con el formato de AnkiConnect.
 */
export default function sync_mock_anki() {
    return new Promise((resolve) => {
        console.log("🤖 Servidor simulado de Anki listo en el puerto 8765...");
        const server = http.createServer((req, res) => {
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    console.log("📥 Payload recibido desde Yoru Reader:", body);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ result: 123456789, error: null }));
                    server.close();
                    resolve({ status: "success", message: "Conexión validada. Formato de tarjeta compatible con AnkiConnect." });
                });
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end("Mock server is running");
            }
        });
        server.listen(8765);
    });
}

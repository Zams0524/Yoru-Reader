const WebSocket = require('ws');
const crypto = require('crypto');
const { Readable } = require('stream');

const CHROMIUM_FULL_VERSION = '130.0.2849.68';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WINDOWS_FILE_TIME_EPOCH = 11644473600n;

function generateRequestId() {
  return crypto.randomBytes(16).toString('hex');
}

function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Genera el token dinámico Sec-MS-GEC para autenticarse contra Microsoft Edge TTS
 */
function generateSecMsGecToken() {
  const ticks = BigInt(Math.floor((Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n;
  const roundedTicks = ticks - (ticks % 3000000000n);
  const strToHash = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;
  
  const hash = crypto.createHash('sha256');
  hash.update(strToHash, 'ascii');
  const digest = hash.digest('hex').toUpperCase();
  hash.destroy(); // Proactively destroy the hash context
  return digest;
}

/**
 * Sintetiza texto usando la API de lectura en voz alta gratuita de Microsoft Edge.
 * Devuelve un stream Readable que emite los fragmentos de audio MP3 a medida que se reciben.
 * Evita retener buffers masivos en memoria.
 */
function synthesizeEdgeTtsStream(text, voice = 'ja-JP-NanamiNeural', rate = 1.0) {
  const audioStream = new Readable({
    read() {} // Emisión bajo demanda
  });

  const requestId = generateRequestId();
  const secMsGec = generateSecMsGecToken();
  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
  
  let ws = new WebSocket(wsUrl, {
    host: 'speech.platform.bing.com',
    origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    headers: {
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0`
    }
  });

  ws.on('open', () => {
    // 1. Enviar configuración inicial del cliente
    const configMsg = `X-Timestamp:${getTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"system":{"name":"SpeechSDK","version":"1.30.0","build":"JavaScript","lang":"JavaScript"}}}`;
    ws.send(configMsg);

    // Convertir velocidad (1.0 -> "+0%", 1.25 -> "+25%", 0.75 -> "-25%")
    const percentChange = Math.round((rate - 1.0) * 100);
    const rateString = percentChange >= 0 ? `+${percentChange}%` : `${percentChange}%`;

    // 2. Enviar petición SSML
    const fullVoiceName = voice.includes('Voice') ? voice : `Microsoft Server Speech Text to Speech Voice (ja-JP, ${voice.replace('ja-JP-', '')})`;
    const ssmlMsg = `X-RequestId:${requestId}\r\nX-Timestamp:${getTimestamp()}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ja-JP'><voice name='${fullVoiceName}'><prosody rate='${rateString}'>${text}</prosody></voice></speak>`;
    ws.send(ssmlMsg);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const separator = 'Path:audio';
      const index = data.indexOf(separator);
      if (index !== -1) {
        const headerLength = data.readUInt16BE(0);
        const audioBuffer = data.subarray(2 + headerLength);
        audioStream.push(audioBuffer);
      }
    } else {
      const textMsg = data.toString('utf8');
      if (textMsg.includes('Path:turn.end')) {
        ws.close();
      }
    }
  });

  ws.on('close', () => {
    audioStream.push(null); // Fin de la lectura
    ws = null; // Liberar referencia
  });

  ws.on('error', (err) => {
    audioStream.destroy(err);
    ws = null;
  });

  return audioStream;
}

/**
 * Sintetiza texto devolviendo el buffer completo consumiendo el stream
 * de forma limpia para evitar fugas.
 */
function synthesizeEdgeTts(text, voice = 'ja-JP-NanamiNeural', rate = 1.0) {
  return new Promise((resolve, reject) => {
    const stream = synthesizeEdgeTtsStream(text, voice, rate);
    const audioBuffers = [];

    stream.on('data', (chunk) => {
      audioBuffers.push(chunk);
    });

    stream.on('end', () => {
      const concatenated = Buffer.concat(audioBuffers);
      audioBuffers.length = 0; // Limpiar array
      resolve(concatenated);
    });

    stream.on('error', (err) => {
      audioBuffers.length = 0;
      reject(err);
    });
  });
}

module.exports = { synthesizeEdgeTts, synthesizeEdgeTtsStream };

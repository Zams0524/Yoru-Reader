const WebSocket = require('ws');
const crypto = require('crypto');
const { Readable } = require('stream');
const { generateSecMsGecV2, TRUSTED_CLIENT_TOKEN } = require('./edgeTtsToken.cjs');

// What the service expects as of edge-tts 7.x (github.com/rany2/edge-tts, constants.py).
// With the old values (Chromium 130, "1-" version, SHA-256 token) it answers HTTP 403.
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;

// Seconds added to the local clock; learnt from the server's Date header after a 403.
let clockSkewSeconds = 0;

function generateRequestId() {
  return crypto.randomBytes(16).toString('hex');
}

function getTimestamp() {
  return new Date().toISOString();
}

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[char]));
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
  const secMsGec = generateSecMsGecV2(Date.now() / 1000 + clockSkewSeconds);
  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const wsUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
    + `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`
    + `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  let ws = new WebSocket(wsUrl, {
    host: 'speech.platform.bing.com',
    origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    headers: {
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`,
    }
  });

  // A 403 usually means the clock is off: learn the skew so the next request gets a valid token.
  ws.on('unexpected-response', (_request, response) => {
    const serverTime = Date.parse(response.headers.date || '');
    if (response.statusCode === 403 && Number.isFinite(serverTime)) {
      clockSkewSeconds += serverTime / 1000 - (Date.now() / 1000 + clockSkewSeconds);
    }
    const error = new Error(`Unexpected server response: ${response.statusCode}`);
    error.statusCode = response.statusCode;
    audioStream.destroy(error);
    if (ws) ws.terminate();
    ws = null;
  });

  ws.on('open', () => {
    // 1. Enviar configuración inicial del cliente
    const configMsg = `X-Timestamp:${getTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
      + '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
    ws.send(configMsg);

    // Convertir velocidad (1.0 -> "+0%", 1.25 -> "+25%", 0.75 -> "-25%")
    const percentChange = Math.round((rate - 1.0) * 100);
    const rateString = percentChange >= 0 ? `+${percentChange}%` : `${percentChange}%`;

    // 2. Enviar petición SSML (the trailing "Z" after the timestamp mirrors Edge itself)
    const fullVoiceName = voice.includes('Voice') ? voice : `Microsoft Server Speech Text to Speech Voice (ja-JP, ${voice.replace('ja-JP-', '')})`;
    const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${getTimestamp()}Z\r\nPath:ssml\r\n\r\n`
      + `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ja-JP'><voice name='${fullVoiceName}'><prosody pitch='+0Hz' rate='${rateString}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
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
function synthesizeEdgeTtsOnce(text, voice, rate) {
  return new Promise((resolve, reject) => {
    const stream = synthesizeEdgeTtsStream(text, voice, rate);
    const audioBuffers = [];

    stream.on('data', (chunk) => {
      audioBuffers.push(chunk);
    });

    stream.on('end', () => {
      const concatenated = Buffer.concat(audioBuffers);
      audioBuffers.length = 0; // Limpiar array
      // No audio means the voice does not exist (e.g. Mayu was withdrawn): report it as an error.
      if (concatenated.length === 0) reject(new Error('Edge TTS returned no audio for ' + voice));
      else resolve(concatenated);
    });

    stream.on('error', (err) => {
      audioBuffers.length = 0;
      reject(err);
    });
  });
}

/** Retries once after a 403, when the clock skew has just been corrected. */
async function synthesizeEdgeTts(text, voice = 'ja-JP-NanamiNeural', rate = 1.0) {
  try {
    return await synthesizeEdgeTtsOnce(text, voice, rate);
  } catch (error) {
    if (error && error.statusCode === 403) return synthesizeEdgeTtsOnce(text, voice, rate);
    throw error;
  }
}

module.exports = { synthesizeEdgeTts, synthesizeEdgeTtsStream };

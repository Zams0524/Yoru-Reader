/**
 * Servicio para sintetizar voz usando Azure Cognitive Services Text-to-Speech REST API.
 */

/**
 * Sintetiza texto a audio utilizando Azure TTS.
 * 
 * @param text Texto a sintetizar.
 * @param voiceName Nombre completo de la voz de Azure (ej. "ja-JP-NanamiNeural").
 * @param apiKey API Key de suscripción a Azure.
 * @param region Región del recurso de Azure (ej. "eastus", "japaneast").
 * @param rate Tasa de velocidad de reproducción (ej. 1.0).
 * @returns Promesa que resuelve a un Object URL del audio generado.
 */
export async function synthesizeSpeechAzure(
  text: string,
  voiceName: string,
  apiKey: string,
  region: string = 'eastus',
  rate: number = 1.0
): Promise<string> {
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  
  // Convertir la velocidad a formato de porcentaje relativo para SSML de Azure (ej: "+20%", "-10%")
  const percentChange = Math.round((rate - 1.0) * 100);
  const rateString = percentChange >= 0 ? `+${percentChange}%` : `${percentChange}%`;

  // Cuerpo en formato SSML
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ja-JP'><voice name='${voiceName}'><prosody rate='${rateString}'>${text}</prosody></voice></speak>`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'YoruReader'
    },
    body: ssml
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure TTS HTTP ${response.status}: ${errorText}`);
  }

  const audioBlob = await response.blob();
  return URL.createObjectURL(audioBlob);
}

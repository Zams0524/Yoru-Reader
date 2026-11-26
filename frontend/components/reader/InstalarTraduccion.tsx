import React, { useEffect, useRef, useState } from 'react';
import { getInstalledDictionaries, clearYomitanCache } from '../../utils/yomitanDB';
import { installRecommendedPack, isTranslatedDictionary, subscribePackProgress } from '../../utils/dictionaryPack';

/*
  Una sola instalación por sesión, la pida el popup que la pida. Si falla no se reintenta en cada
  palabra: se volverá a probar la próxima vez que se abra la app.
*/
let intento: Promise<boolean> | null = null;

async function asegurarTraduccion(): Promise<boolean> {
  const lista = await getInstalledDictionaries();
  if ((lista || []).some(isTranslatedDictionary)) return false; // ya estaba: nada que hacer
  await installRecommendedPack('es', ['translated']);
  clearYomitanCache();
  return true;
}

/**
 * Instala sola el JMdict traducido a máquina en cuanto el popup tiene que enseñar una palabra en
 * inglés con la app en español (lo pidió zams: nada de botón, que sea automático).
 *
 * En Android la app no instala diccionarios al arrancar (la WebView tiene poca memoria), así que
 * quien ya tenía el JMdict español lo recibe aquí, la primera vez que hace falta. Mientras se
 * instala se ve una línea de progreso; al terminar se vuelve a buscar la palabra, que ya sale en
 * español.
 */
export default function InstalarTraduccion({ color, onInstalled }: {
  color: string;
  onInstalled: () => void;
}) {
  const [porcentaje, setPorcentaje] = useState<number | null>(null);
  // La palabra puede cambiar mientras se instala: al terminar se busca la que esté abierta.
  const alTerminar = useRef(onInstalled);
  alTerminar.current = onInstalled;

  useEffect(() => {
    let vivo = true;
    const dejar = subscribePackProgress(progreso => { if (vivo && progreso.running) setPorcentaje(progreso.percent); });
    if (!intento) intento = asegurarTraduccion().catch(err => {
      console.warn('[Yoru] No se pudo instalar el JMdict traducido:', err);
      return false;
    });
    intento.then(instalado => {
      if (!vivo) return;
      setPorcentaje(null);
      if (instalado) alTerminar.current();
    });
    return () => { vivo = false; dejar(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (porcentaje === null) return null;
  return (
    <p style={{ margin: 0, fontSize: '0.7rem', color, fontStyle: 'italic' }}>
      Preparando la traducción al español… {porcentaje}%
    </p>
  );
}

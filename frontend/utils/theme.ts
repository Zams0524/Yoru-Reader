import { useEffect, useState } from 'react';

/**
 * El esquema de color de Yoru, en un solo sitio.
 *
 * Hasta ahora había **dos controles llamados «tema»** en Ajustes, con vocabularios
 * distintos: «Tema del Lector» (Oscuro Yoru / Sepia Relajante / Claro Clásico) en
 * Apariencia, y «Tema del libro» (Blanco / Crema / Oscuro) en Estilo de texto. No eran
 * dos ajustes: los dos escribían `settings.theme`. Y el segundo decía de sí mismo «se
 * aplica únicamente a la página de lectura», que era falso — cambiarlo teñía también
 * el catálogo.
 *
 * Queda un control con un vocabulario. Y entra «Sistema», que es lo que la mayoría de
 * la gente espera encontrar: seguir al escritorio y cambiar con él al anochecer.
 *
 * El sepia **se queda**. Para leer de noche es el que más sirve, y no se pierde por
 * parecerse a ninguna captura.
 */

export type ThemeChoice = 'system' | 'light' | 'dark' | 'sepia';

/** Lo que entiende el CSS: `data-theme` solo sabe de estos tres. */
export type ResolvedTheme = 'light' | 'dark' | 'sepia';

const QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : true;
}

/**
 * El tema que hay que pintar. «Sistema» se traduce aquí y no en el CSS, porque la hoja
 * de estilo va por `data-theme` y no sabe nada de preferencias del escritorio.
 */
export function resolveTheme(choice: string | undefined): ResolvedTheme {
  if (choice === 'light' || choice === 'dark' || choice === 'sepia') return choice;
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  // Lo guardado antes de que existiera «Sistema», y el valor por defecto.
  return 'dark';
}

/** Como `resolveTheme`, pero repintando cuando el escritorio cambia de esquema. */
export function useResolvedTheme(choice: string | undefined): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(choice));

  useEffect(() => {
    setResolved(resolveTheme(choice));
    if (choice !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(QUERY);
    const onChange = () => setResolved(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [choice]);

  return resolved;
}

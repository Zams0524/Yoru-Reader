import React, { useEffect, useState } from 'react';

/**
 * La portada de algo que lee otro miembro, con hueco si no carga.
 *
 * Estas portadas se piden a Kavita o a Audiobookshelf con el identificador que subió
 * otra persona: el libro puede haberse quitado del servidor desde entonces, o el
 * servidor estar apagado. Un icono de imagen rota en el perfil de alguien parece un
 * fallo de la app; el hueco con el título, no.
 */
export default function MemberCoverImage({
  src,
  className,
  fallback,
}: {
  src: string;
  className?: string;
  /** Lo que se pinta cuando no hay portada o no carga. */
  fallback: React.ReactNode;
}) {
  const [rota, setRota] = useState(false);
  useEffect(() => { setRota(false); }, [src]);
  if (!src || rota) return <>{fallback}</>;
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setRota(true)} />;
}

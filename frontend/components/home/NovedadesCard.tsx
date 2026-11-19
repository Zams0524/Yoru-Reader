import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { marcarNovedadVista, novedadPendiente } from '../../utils/novedades';

/**
 * El aviso de «esto se actualizó», arriba del todo de Inicio.
 *
 * Una línea y una cruz: se lee de pasada y se cierra. No vuelve hasta la siguiente
 * versión. Lo mismo queda apuntado en Notificaciones, por si se cierra sin leer.
 */
export default function NovedadesCard({ es }: { es: boolean }) {
  // Se mira una sola vez, al montar: que la tarjeta no aparezca a media sesión.
  const [novedad, setNovedad] = useState(() => novedadPendiente(es));
  if (!novedad) return null;

  const cerrar = () => {
    marcarNovedadVista();
    setNovedad(null);
  };

  return (
    <aside className="yoru-novedad" role="status">
      <span className="yoru-novedad-icon" aria-hidden="true"><Sparkles size={16} /></span>
      <span className="yoru-novedad-text">
        <strong>
          {es ? `Yoru se actualizó a la ${novedad.version}` : `Yoru was updated to ${novedad.version}`}
        </strong>
        <span>{novedad.texto}</span>
      </span>
      <button
        type="button"
        className="yoru-novedad-close"
        onClick={cerrar}
        title={es ? 'Entendido' : 'Got it'}
        aria-label={es ? 'Cerrar el aviso de novedades' : 'Dismiss the update notice'}
      >
        <X size={14} />
      </button>
    </aside>
  );
}

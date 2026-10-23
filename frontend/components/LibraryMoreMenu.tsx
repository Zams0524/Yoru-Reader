import React from 'react';
import { ArrowDown, ArrowUp, Check, ListChecks, RotateCcw } from 'lucide-react';

const DEFAULT_CARD_WIDTH = 160;

interface DetailToggle {
  key: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

interface Props {
  lang: string;
  sortBy: string;
  onSortBy: (value: string) => void;
  sortDirection: string;
  onSortDirection: (value: string) => void;
  groupBy: string;
  onGroupBy: (value: string) => void;
  details: DetailToggle[];
  coverFit: string;
  onCoverFit: (value: string) => void;
  cardWidth: number;
  onCardWidth: (value: number) => void;
  onSelectBooks: () => void;
  onClose: () => void;
}

/**
 * Library "⋮" menu on phones, ReadEra-style: select books, sort, group, what the cards show,
 * cover fit and card size. On phones it replaces the display settings panel entirely.
 */
export default function LibraryMoreMenu({
  lang, sortBy, onSortBy, sortDirection, onSortDirection, groupBy, onGroupBy, details,
  coverFit, onCoverFit, cardWidth, onCardWidth, onSelectBooks, onClose,
}: Props) {
  const es = lang === 'es';
  const sortOptions = [
    { value: 'lastRead', label: es ? 'Leído recientemente' : 'Recently read' },
    { value: 'added', label: es ? 'Añadido' : 'Added' },
    { value: 'title', label: es ? 'Título' : 'Title' },
    { value: 'author', label: es ? 'Autor' : 'Author' },
    { value: 'series', label: es ? 'Serie' : 'Series' },
    { value: 'progress', label: es ? 'Progreso' : 'Progress' },
  ];
  const groupOptions = [
    { value: 'none', label: es ? 'Ninguno' : 'None' },
    { value: 'series', label: es ? 'Serie' : 'Series' },
    { value: 'author', label: es ? 'Autor' : 'Author' },
  ];
  const coverFitOptions = [
    { value: 'cover', label: es ? 'Rellenar' : 'Fill' },
    { value: 'contain', label: es ? 'Ajustar' : 'Fit' },
  ];
  const ascending = sortDirection === 'asc';

  return (
    <>
      <div className="library-menu-backdrop" onClick={onClose} />
      <div className="library-menu" role="menu" aria-label={es ? 'Opciones de la biblioteca' : 'Library options'}>
        <button type="button" role="menuitem" className="library-menu-item" onClick={() => { onClose(); onSelectBooks(); }}>
          <span className="library-menu-item-label"><ListChecks size={18} />{es ? 'Seleccionar libros' : 'Select books'}</span>
        </button>
        <div className="library-menu-divider" />
        <div className="library-menu-section-head">
          <span>{es ? 'Ordenar por' : 'Sort by'}</span>
          <button
            type="button"
            className="library-menu-direction"
            onClick={() => onSortDirection(ascending ? 'desc' : 'asc')}
            aria-label={ascending ? (es ? 'Orden ascendente' : 'Ascending') : (es ? 'Orden descendente' : 'Descending')}
          >
            {ascending ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            {ascending ? (es ? 'Ascendente' : 'Ascending') : (es ? 'Descendente' : 'Descending')}
          </button>
        </div>
        {sortOptions.map((option) => (
          <button key={option.value} type="button" role="menuitemradio" aria-checked={sortBy === option.value} className="library-menu-item" onClick={() => onSortBy(option.value)}>
            <span>{option.label}</span>
            {sortBy === option.value && <Check size={18} />}
          </button>
        ))}

        <div className="library-menu-section-head"><span>{es ? 'Agrupar' : 'Group by'}</span></div>
        <div className="library-menu-segments" role="radiogroup" aria-label={es ? 'Agrupar' : 'Group by'}>
          {groupOptions.map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={groupBy === option.value} className={groupBy === option.value ? 'active' : ''} onClick={() => onGroupBy(option.value)}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="library-menu-section-head"><span>{es ? 'Mostrar en la tarjeta' : 'Show on cards'}</span></div>
        {details.map((detail) => (
          <button key={detail.key} type="button" role="menuitemcheckbox" aria-checked={detail.value} className="library-menu-item" onClick={() => detail.onChange(!detail.value)}>
            <span>{detail.label}</span>
            <span className={`library-menu-check${detail.value ? ' on' : ''}`}>{detail.value && <Check size={14} />}</span>
          </button>
        ))}

        <div className="library-menu-section-head"><span>{es ? 'Imagen de portada' : 'Cover image'}</span></div>
        <div className="library-menu-segments" role="radiogroup" aria-label={es ? 'Imagen de portada' : 'Cover image'}>
          {coverFitOptions.map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={coverFit === option.value} className={coverFit === option.value ? 'active' : ''} onClick={() => onCoverFit(option.value)}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="library-menu-section-head">
          <span>{es ? 'Tamaño de tarjeta' : 'Card size'}</span>
          {cardWidth !== DEFAULT_CARD_WIDTH && (
            <button type="button" className="library-menu-direction" onClick={() => onCardWidth(DEFAULT_CARD_WIDTH)}>
              <RotateCcw size={14} />
              {es ? 'Restablecer' : 'Reset'}
            </button>
          )}
        </div>
        <div className="library-menu-slider">
          <span>{es ? 'Pequeño' : 'Small'}</span>
          <input
            type="range"
            min={120}
            max={240}
            step={8}
            value={cardWidth}
            onChange={(e) => onCardWidth(parseInt(e.target.value, 10))}
            aria-label={es ? 'Tamaño de tarjeta' : 'Card size'}
            aria-valuetext={`${cardWidth} px`}
          />
          <span>{es ? 'Grande' : 'Large'}</span>
        </div>
      </div>
    </>
  );
}

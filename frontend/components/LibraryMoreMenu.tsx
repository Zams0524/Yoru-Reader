import React from 'react';
import { ArrowDown, ArrowUp, Check, ListChecks, SlidersHorizontal } from 'lucide-react';

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
  onSelectBooks: () => void;
  onMoreOptions: () => void;
  onClose: () => void;
}

/**
 * Library "⋮" menu on phones, ReadEra-style: sort, group, what the cards show, select books,
 * and a link to the advanced view options (card size, cover fit).
 */
export default function LibraryMoreMenu({
  lang, sortBy, onSortBy, sortDirection, onSortDirection, groupBy, onGroupBy, details, onSelectBooks, onMoreOptions, onClose,
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
  const ascending = sortDirection === 'asc';

  return (
    <>
      <div className="library-menu-backdrop" onClick={onClose} />
      <div className="library-menu" role="menu" aria-label={es ? 'Opciones de la biblioteca' : 'Library options'}>
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

        <div className="library-menu-divider" />
        <button type="button" role="menuitem" className="library-menu-item" onClick={() => { onClose(); onSelectBooks(); }}>
          <span className="library-menu-item-label"><ListChecks size={18} />{es ? 'Seleccionar libros' : 'Select books'}</span>
        </button>
        <button type="button" role="menuitem" className="library-menu-item" onClick={() => { onClose(); onMoreOptions(); }}>
          <span className="library-menu-item-label"><SlidersHorizontal size={18} />{es ? 'Más opciones de vista…' : 'More view options…'}</span>
        </button>
      </div>
    </>
  );
}

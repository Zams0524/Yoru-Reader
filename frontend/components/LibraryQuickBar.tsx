import React, { useMemo } from 'react';
import { LayoutGrid, List } from 'lucide-react';

export type LibraryView = 'grid' | 'list';

interface Filter {
  type: string;
  value: string | null;
}

interface Props {
  books: { status?: string; tags?: string[]; isDeleted?: boolean; progress?: { percent?: number } }[];
  activeFilter: Filter;
  onFilter: (filter: Filter) => void;
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  lang: string;
}

/**
 * ReadEra-style quick filters above the shelf: status chips and one chip per collection (tag),
 * with counts, plus the grid/list switch. The library drawer keeps the full filter list.
 */
export default function LibraryQuickBar({ books, activeFilter, onFilter, view, onViewChange, lang }: Props) {
  const es = lang === 'es';

  const { statusCounts, tagCounts } = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const tagCounts = new Map<string, number>();
    for (const book of books) {
      if (book.isDeleted) continue;
      // Same fallback as the library filter: books without a status count by their progress.
      const percent = book.progress?.percent ?? 0;
      const status = book.status || (percent === 0 ? 'unread' : percent >= 100 ? 'completed' : 'reading');
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      for (const tag of book.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    return { statusCounts, tagCounts: Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])) };
  }, [books]);

  const total = books.filter((book) => !book.isDeleted).length;
  const chips: { key: string; label: string; count: number; filter: Filter }[] = [
    { key: 'all', label: es ? 'Todos' : 'All', count: total, filter: { type: 'all', value: null } },
    { key: 'reading', label: es ? 'Leyendo' : 'Reading', count: statusCounts.reading || 0, filter: { type: 'reading', value: null } },
    { key: 'unread', label: es ? 'Por leer' : 'To read', count: statusCounts.unread || 0, filter: { type: 'unread', value: null } },
    { key: 'completed', label: es ? 'Leídos' : 'Finished', count: statusCounts.completed || 0, filter: { type: 'completed', value: null } },
    { key: 'planning', label: es ? 'Planeados' : 'Planned', count: statusCounts.planning || 0, filter: { type: 'planning', value: null } },
    { key: 'paused', label: es ? 'Pausados' : 'Paused', count: statusCounts.paused || 0, filter: { type: 'paused', value: null } },
  ].filter((chip) => chip.key === 'all' || chip.count > 0);

  const isActive = (filter: Filter) => activeFilter.type === filter.type && (activeFilter.value ?? null) === (filter.value ?? null);

  return (
    <div className="library-quick-bar">
      <div className="library-quick-chips" role="tablist" aria-label={es ? 'Filtrar libros' : 'Filter books'}>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={isActive(chip.filter)}
            className={`library-quick-chip${isActive(chip.filter) ? ' active' : ''}`}
            onClick={() => onFilter(chip.filter)}
          >
            {chip.label}
            <span className="library-quick-count">{chip.count}</span>
          </button>
        ))}
        {tagCounts.map(([tag, count]) => {
          const filter = { type: 'tag', value: tag };
          return (
            <button
              key={`tag-${tag}`}
              type="button"
              role="tab"
              aria-selected={isActive(filter)}
              className={`library-quick-chip is-collection${isActive(filter) ? ' active' : ''}`}
              onClick={() => onFilter(filter)}
              title={es ? 'Colección' : 'Collection'}
            >
              #{tag}
              <span className="library-quick-count">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="library-view-toggle" role="group" aria-label={es ? 'Vista' : 'View'}>
        <button
          type="button"
          aria-pressed={view === 'grid'}
          aria-label={es ? 'Vista en cuadrícula' : 'Grid view'}
          className={view === 'grid' ? 'active' : ''}
          onClick={() => onViewChange('grid')}
        >
          <LayoutGrid size={16} />
        </button>
        <button
          type="button"
          aria-pressed={view === 'list'}
          aria-label={es ? 'Vista en lista' : 'List view'}
          className={view === 'list' ? 'active' : ''}
          onClick={() => onViewChange('list')}
        >
          <List size={16} />
        </button>
      </div>
    </div>
  );
}

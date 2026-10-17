import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';

interface PaginationProps {
  page:       number;
  totalPages: number;
  onPage:     (p: number) => void;
}

export function Pagination({ page, totalPages, onPage }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages: Array<number | 'left-gap' | 'right-gap'> = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : page <= 4
      ? [1, 2, 3, 4, 5, 'right-gap', totalPages]
      : page >= totalPages - 3
        ? [1, 'left-gap', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
        : [1, 'left-gap', page - 1, page, page + 1, 'right-gap', totalPages];

  return (
    <div className="mt-8 flex items-center justify-center gap-1.5">
      <button
        className="btn btn-outline btn-sm h-9 w-9 p-0 rounded-xl"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Página anterior"
      >
        <ChevronLeft className="w-4 h-4 text-slate-600" />
      </button>

      <span className="px-3 text-xs font-bold text-slate-600 sm:hidden" aria-live="polite">
        Pág. {page} de {totalPages}
      </span>

      {pages.map((entry) => typeof entry === 'number' ? (
          <button
            key={entry}
            onClick={() => onPage(entry)}
            className={cn(
              'btn btn-sm hidden h-9 w-9 sm:inline-flex rounded-xl text-xs font-bold transition-all',
              entry === page
                ? '!inline-flex bg-charcoal-800 text-white shadow-xs'
                : 'btn-ghost text-slate-600 hover:text-charcoal-800',
            )}
          >
            {entry}
          </button>
        ) : <span key={entry} className="hidden px-1.5 text-slate-400 sm:inline" aria-hidden="true">…</span>)}

      <button
        className="btn btn-outline btn-sm h-9 w-9 p-0 rounded-xl"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label="Próxima página"
      >
        <ChevronRight className="w-4 h-4 text-slate-600" />
      </button>
    </div>
  );
}

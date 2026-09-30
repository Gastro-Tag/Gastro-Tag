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
    <div className="mt-6 flex items-center justify-center gap-1">
      <button
        className="btn-ghost btn btn-sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <span className="px-2 text-sm font-medium text-slate-600 sm:hidden" aria-live="polite">
        {page} / {totalPages}
      </span>

      {pages.map((entry) => typeof entry === 'number' ? (
          <button
            key={entry}
            onClick={() => onPage(entry)}
            className={cn(
              'btn btn-sm hidden h-9 w-9 sm:inline-flex',
              entry === page
                ? '!inline-flex bg-brand-700 font-semibold text-white'
                : 'btn-ghost',
            )}
          >
            {entry}
          </button>
        ) : <span key={entry} className="hidden px-1 text-slate-400 sm:inline" aria-hidden="true">…</span>)}

      <button
        className="btn-ghost btn btn-sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

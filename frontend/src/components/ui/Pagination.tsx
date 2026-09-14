import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';

interface PaginationProps {
  page:       number;
  totalPages: number;
  onPage:     (p: number) => void;
}

export function Pagination({ page, totalPages, onPage }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-1 mt-6">
      <button
        className="btn-ghost btn btn-sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
        const p = i + 1;
        return (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={cn(
              'btn btn-sm w-9 h-9',
              p === page
                ? 'bg-brand-700 text-white font-semibold'
                : 'btn-ghost',
            )}
          >
            {p}
          </button>
        );
      })}

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

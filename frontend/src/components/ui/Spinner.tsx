import { cn } from '@/utils/cn';

interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; className?: string; }

const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' };

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin text-brand-700', sizes[size], className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none" viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner size="lg" />
    </div>
  );
}

export function InlineLoader({ text = 'Carregando…' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
      <Spinner size="sm" />
      <span>{text}</span>
    </div>
  );
}

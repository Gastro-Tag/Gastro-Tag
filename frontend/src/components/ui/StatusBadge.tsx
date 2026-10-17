import { cn } from '@/utils/cn';

export type ProductStatus = 'valid' | 'expiring' | 'expired' | 'recent';

interface StatusBadgeProps {
  status: ProductStatus;
  label?: string;
  className?: string;
}

const config: Record<ProductStatus, { cls: string; dot: string; default: string }> = {
  valid:    { cls: 'badge-valid',    dot: 'bg-emerald-500', default: 'OK' },
  expiring: { cls: 'badge-expiring', dot: 'bg-amber-500',   default: 'Atenção' },
  expired:  { cls: 'badge-expired',  dot: 'bg-rose-500',    default: 'Crítico' },
  recent:   { cls: 'badge-recent',   dot: 'bg-sky-500',     default: 'Recente' },
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const item = config[status] ?? config.valid;
  return (
    <span className={cn('badge', item.cls, className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', item.dot)} />
      <span>{label ?? item.default}</span>
    </span>
  );
}

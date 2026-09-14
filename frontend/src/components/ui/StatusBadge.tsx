import { cn } from '@/utils/cn';

type Status = 'valid' | 'expiring' | 'expired' | 'recent';

interface StatusBadgeProps {
  status: Status;
  label?: string;
}

const config: Record<Status, { cls: string; dot: string; default: string }> = {
  valid:    { cls: 'badge-valid',    dot: 'bg-emerald-500', default: 'Válido'              },
  expiring: { cls: 'badge-expiring', dot: 'bg-amber-500',   default: 'Próximo do venc.'   },
  expired:  { cls: 'badge-expired',  dot: 'bg-red-500',     default: 'Vencido'             },
  recent:   { cls: 'badge-recent',   dot: 'bg-blue-500',    default: 'Recente'             },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const { cls, dot, default: def } = config[status];
  return (
    <span className={cn('badge', cls)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />
      {label ?? def}
    </span>
  );
}

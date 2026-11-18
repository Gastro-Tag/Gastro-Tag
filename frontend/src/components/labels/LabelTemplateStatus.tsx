import { AlertTriangle, Printer } from 'lucide-react';
import { LABEL_TEMPLATE_NOT_CHOSEN_TEXT, getLabelTemplate } from '@/utils/labelTemplates';
import { useLabelTemplate } from '@/hooks/useLabelTemplate';
import { cn } from '@/utils/cn';

/** Modelo de etiqueta ativo neste aparelho; destaca o aviso quando ninguém escolheu (impressão em A4). */
export function LabelTemplateStatus({ large = false, className }: { large?: boolean; className?: string }) {
  const { templateId, explicit } = useLabelTemplate();
  if (!explicit) {
    return (
      <p role="status" className={cn('flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 font-bold text-amber-800', large ? 'p-3 text-base [@media(max-height:500px)]:p-1.5 [@media(max-height:500px)]:text-xs' : 'p-2.5 text-xs', className)}>
        <AlertTriangle className={cn('shrink-0', large ? 'mt-0.5 h-5 w-5 [@media(max-height:500px)]:h-4 [@media(max-height:500px)]:w-4' : 'h-4 w-4')} aria-hidden="true" />
        <span className="min-w-0">{LABEL_TEMPLATE_NOT_CHOSEN_TEXT}</span>
      </p>
    );
  }
  return (
    <p className={cn('flex items-center justify-center gap-1.5 font-semibold text-slate-500', large ? 'text-base [@media(max-height:500px)]:text-xs' : 'text-xs', className)}>
      <Printer className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden="true" />
      <span>Etiqueta: {getLabelTemplate(templateId).name}</span>
    </p>
  );
}

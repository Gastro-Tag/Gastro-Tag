import { useState } from 'react';
import {
  Printer, Refrigerator, Snowflake, Tag, Scissors, CheckCircle2, GitBranch, ShieldCheck, PackageOpen,
} from 'lucide-react';
import { labelApi } from '@/services';
import { extractError } from '@/services/api';
import type { Label, LabelChild } from '@/types';
import { daysUntil, formatBR, formatDateTimeBR } from '@/utils/date';
import { outcomeText } from '@/utils/labelStatus';
import { isOtherPackage } from '@/utils/lotSource';
import { cn } from '@/utils/cn';

interface Props {
  label: Label;
  onReprint: () => void;
  onSplit: () => void;
  onCloseLabel: () => void;
  /** Filtra a lista pelo código da etiqueta de origem. */
  onSearchCode: (code: string) => void;
}

export function LabelCard({ label, onReprint, onSplit, onCloseLabel, onSearchCode }: Props) {
  const active = label.status !== 'ENCERRADA';
  const daysLeft = daysUntil(label.discardAt);
  const expired = daysLeft < 0;
  const expiring = !expired && daysLeft <= 2;
  const productName = label.productName ?? label.product?.name ?? '—';
  const productBrand = label.productBrand ?? label.product?.brand ?? '';

  // Etiqueta encerrada não "vence": o selo mostra o destino.
  const statusCls = !active
    ? 'bg-slate-100 text-slate-600 border-slate-200'
    : expired
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : expiring
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  const squircleCls = !active
    ? 'bg-slate-100 text-slate-400 border border-slate-200'
    : expired
    ? 'bg-rose-50 text-rose-600 border border-rose-100'
    : expiring
    ? 'bg-amber-50 text-amber-600 border border-amber-100'
    : 'bg-orange-50 text-brand-600 border border-orange-100';

  const outcomeCls = label.outcome === 'DESCARTADO'
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : label.outcome === 'CANCELADO'
    ? 'bg-slate-100 text-slate-600 border-slate-300'
    : 'bg-sky-50 text-sky-700 border-sky-200';

  return (
    <div className={cn(
      'card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-slate-300 hover:shadow-card-hover group',
      !active && 'bg-slate-50/60',
    )}>
      <div className="flex items-start gap-4 min-w-0 flex-1">
        <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-2xs', squircleCls)}>
          <Tag className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-bold text-charcoal-800 text-base group-hover:text-brand-600 transition-colors truncate">
              {productName}
            </h3>
            {active ? (
              <span className={cn('badge', statusCls)}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-current" />
                <span>
                  {expired
                    ? `Vencida há ${Math.abs(daysLeft)}d`
                    : daysLeft === 0
                    ? 'Vence hoje'
                    : `${daysLeft}d restantes`}
                </span>
              </span>
            ) : (
              <span className={cn('badge', outcomeCls)}>
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                <span>{outcomeText(label) || 'Encerrada'}</span>
              </span>
            )}
            {active && <span className="badge badge-recent">Ativa</span>}
            <span className="font-mono text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">
              {label.shortCode}
            </span>
          </div>

          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-slate-600">{productBrand}</span>
            <span>• Lote: <strong className="text-charcoal-800">{label.lot}</strong></span>
            <span>• Manipulador: <strong className="text-charcoal-800">{label.responsibleName ?? 'Não informado'}</strong></span>
            {isOtherPackage(label) && (
              <span className="badge badge-neutral gap-1" title="Validade digitada na hora, sem lote cadastrado">
                <PackageOpen className="h-3 w-3 shrink-0" aria-hidden="true" /> Outra embalagem
              </span>
            )}
            {label.handlerVerified && (
              <span className="badge badge-valid gap-1" title="O responsável confirmou o PIN no totem">
                <ShieldCheck className="h-3 w-3 shrink-0" /> Operador confirmado
              </span>
            )}
          </div>

          {label.parent && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
              <GitBranch className="h-3.5 w-3.5 text-slate-400" />
              Fracionado de{' '}
              <button
                type="button"
                className="font-mono font-bold text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-800"
                onClick={() => onSearchCode(label.parent!.shortCode)}
                title="Ver a etiqueta de origem"
              >
                {label.parent.shortCode}
              </button>
              {label.fractionedAt && <> em {formatBR(label.fractionedAt)}</>}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
            <span>Abertura: <strong className="text-charcoal-800">{formatBR(label.openedAt)}</strong></span>

            <span className="inline-flex items-center gap-1 font-semibold text-charcoal-800">
              Descarte:
              <strong className={cn('px-2 py-0.5 rounded-md', active && expired ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-charcoal-900')}>
                {formatBR(label.discardAt)}
              </strong>
            </span>

            <span className="inline-flex items-center gap-1">
              {label.storageType === 'REFRIGERADO' ? <Refrigerator className="w-3.5 h-3.5 text-sky-600" /> : <Snowflake className="w-3.5 h-3.5 text-indigo-600" />}
              <span>{label.storageType === 'REFRIGERADO' ? 'Refrigerado' : 'Congelado'} ({label.storageTemp})</span>
            </span>

            <span className="text-slate-400">
              Impresso {label.printCount}x {label.printedAt && `• ${formatDateTimeBR(label.printedAt)}`}
            </span>
          </div>

          {!active && (
            <p className="mt-1.5 text-xs text-slate-500">
              Encerrada{label.closedByName ? <> por <strong className="text-charcoal-800">{label.closedByName}</strong></> : ''}
              {label.closedAt && <> em {formatDateTimeBR(label.closedAt)}</>}
              {label.closeNote && <> • “{label.closeNote}”</>}
            </p>
          )}

          {label.shelfLifeDays != null && (
            <div className="mt-1.5 text-[11px] text-slate-400">
              Regra: {label.shelfLifeDays} dias •{' '}
              {label.ruleId
                ? <>{label.ruleSource ?? label.rule?.source ?? 'Regra cadastrada'}{label.ruleVersion != null && ` (v${label.ruleVersion})`}</>
                : <span className="font-semibold text-amber-700">Prazo do produto (sem regra validada)</span>}
              {label.cappedByOriginalExpiry && ' • (Teto: validade original)'}
              {label.cappedByParent && ' • Data limitada pela etiqueta de origem'}
            </div>
          )}

          {(label.flowMs != null || label.temperatureSource) && (
            <div className="mt-1 text-[11px] text-slate-400">
              {label.flowMs != null && <>Tempo no aparelho: {(label.flowMs / 1000).toFixed(1).replace('.', ',')} s</>}
              {label.flowMs != null && label.temperatureSource && ' • '}
              {label.temperatureSource && <>Temperatura: {label.temperatureSource === 'SUGERIDO' ? 'sugerida confirmada' : 'digitada'}</>}
            </div>
          )}

          {(label.childrenCount ?? 0) > 0 && <Children label={label} />}
        </div>
      </div>

      <div className="pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0 flex flex-row sm:flex-col gap-2">
        {active && (
          <button onClick={onReprint} className="btn btn-outline btn-sm flex-1 sm:flex-none gap-1.5" title="Reimprimir etiqueta">
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Reimprimir</span>
          </button>
        )}
        {active && !expired && (
          <button onClick={onSplit} className="btn btn-outline btn-sm flex-1 sm:flex-none gap-1.5" title="Dividir em etiquetas filhas">
            <Scissors className="w-3.5 h-3.5 text-slate-500" />
            <span>Dividir</span>
          </button>
        )}
        {active && (
          <button onClick={onCloseLabel} className="btn btn-primary btn-sm flex-1 sm:flex-none gap-1.5" title="Registrar o destino da etiqueta">
            <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
            <span>Encerrar</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Filhas carregadas sob demanda (a lista não traz as filhas). */
function Children({ label }: { label: Label }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<LabelChild[] | null>(null);
  const [total, setTotal] = useState(0);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setLoading(true);
    setError('');
    try {
      const { data } = await labelApi.list({ parentLabelId: label.id, limit: 50 });
      setTotal(data.meta.total);
      setItems(data.data.map((child) => ({ id: child.id, shortCode: child.shortCode, status: child.status, discardAt: child.discardAt })));
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1.5">
      <button
        type="button" onClick={() => void toggle()} aria-expanded={open}
        className="text-[11px] font-semibold text-slate-500 underline decoration-dotted underline-offset-2 hover:text-charcoal-800"
      >
        {open ? 'Ocultar etiquetas filhas' : 'Ver etiquetas filhas'}
      </button>
      {open && (
        <div className="mt-1 text-xs text-slate-600">
          {loading && <span className="text-slate-400">Carregando…</span>}
          {error && <span role="alert" className="font-semibold text-rose-600">{error}</span>}
          {!loading && items && total > items.length && (
            <p className="mb-1 font-semibold text-amber-700">Mostrando {items.length} de {total} filhas.</p>
          )}
          {!loading && !error && items?.length === 0 && <span className="text-slate-400">Nenhuma etiqueta filha.</span>}
          {!loading && items && items.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {items.map((child) => (
                <li key={child.id} className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
                  <span className="font-mono font-bold">{child.shortCode}</span>{' '}
                  <span className="text-slate-500">
                    {child.status === 'ATIVA' ? 'ativa' : 'encerrada'} · descarte {formatBR(child.discardAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, Printer, RefreshCw, Search, Tag,
  Clock, Refrigerator, Snowflake, User, Hash, CheckCircle2, AlertTriangle, AlertCircle
} from 'lucide-react';
import { labelApi } from '@/services';
import type { Label, StorageType } from '@/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { InlineLoader } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { daysUntil, formatBR, formatDateTimeBR } from '@/utils/date';
import { cn } from '@/utils/cn';
import { extractError } from '@/services/api';
import { printLabel } from '@/utils/printLabel';

export function LabelsPage() {
  const navigate = useNavigate();
  const { toast } = useToastContext();
  const [labels, setLabels] = useState<Label[]>([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, page: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [storageType, setStorageType] = useState<StorageType | ''>('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => { setPage(1); }, [debouncedSearch, from, to, storageType]);

  const fetchLabels = useCallback(async () => {
    if (from && to && from > to) {
      setLabels([]);
      setMeta({ total: 0, totalPages: 1, page: 1 });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await labelApi.list({
        page, limit: 20, q: debouncedSearch.trim() || undefined,
        from: from || undefined, to: to || undefined,
        storageType: storageType || undefined,
      });
      setLabels(data.data);
      setMeta({ total: data.meta.total, totalPages: data.meta.totalPages, page: data.meta.page });
    } catch (error) {
      toast(extractError(error), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, from, to, storageType, toast]);

  useEffect(() => { void fetchLabels(); }, [fetchLabels]);

  async function reprint(label: Label) {
    try {
      printLabel(label, localStorage.getItem('gastrotag_logo'));
      await labelApi.registerPrint(label.id);
      toast('Reimpressão registrada com sucesso.', 'success');
      void fetchLabels();
    } catch (error) {
      toast(extractError(error), 'error');
    }
  }

  const hasFilters = Boolean(search || from || to || storageType);
  const clearFilters = () => { setSearch(''); setFrom(''); setTo(''); setStorageType(''); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-charcoal-800 tracking-tight">
            Histórico de Etiquetas
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
            {meta.total} {meta.total === 1 ? 'etiqueta sanitária registrada' : 'etiquetas sanitárias registradas'}
          </p>
        </div>
        <button
          className="btn btn-primary shadow-sm"
          onClick={() => navigate('/products')}
        >
          <Tag className="w-4 h-4 text-brand-400" />
          <span>Gerar Nova Etiqueta</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="card p-4 sm:p-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5 bg-white">
        <label className="relative xl:col-span-2">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por produto, lote ou código curto..."
            className="input pl-10 text-xs"
          />
        </label>
        <label className="relative">
          <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="date"
            aria-label="Abertura inicial"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input pl-10 text-xs"
          />
        </label>
        <label className="relative">
          <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="date"
            aria-label="Abertura final"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input pl-10 text-xs"
          />
        </label>
        <select
          className="input text-xs"
          aria-label="Condição de Armazenamento"
          value={storageType}
          onChange={(e) => setStorageType(e.target.value as StorageType | '')}
        >
          <option value="">Todo Armazenamento</option>
          <option value="REFRIGERADO">Refrigerado</option>
          <option value="CONGELADO">Congelado</option>
        </select>
        <div className="flex items-center gap-2 md:col-span-2 xl:col-span-5 pt-1">
          <button
            onClick={() => void fetchLabels()}
            className="btn btn-outline btn-sm gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            <span>Atualizar</span>
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="btn btn-ghost btn-sm text-slate-500 hover:text-charcoal-800"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {from && to && from > to && (
        <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700">
          A data inicial de abertura deve ser anterior ou igual à data final.
        </div>
      )}

      {/* Label List */}
      {loading ? (
        <InlineLoader text="Carregando etiquetas sanitárias…" />
      ) : labels.length === 0 ? (
        <EmptyState
          icon="🏷"
          title="Nenhuma etiqueta encontrada"
          desc="Nenhum registro corresponde aos filtros selecionados ou nenhuma etiqueta foi gerada ainda."
          action={
            <button className="btn btn-primary" onClick={() => navigate('/products')}>
              <Tag className="w-4 h-4 text-brand-400" /> Gerar Primeira Etiqueta
            </button>
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {labels.map((label) => (
              <LabelCard
                key={label.id}
                label={label}
                onReprint={() => void reprint(label)}
              />
            ))}
          </div>
          <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}

// ── Label Card Component ─────────────────────────────────
function LabelCard({ label, onReprint }: { label: Label; onReprint: () => void }) {
  const daysLeft = daysUntil(label.discardAt);
  const expired = daysLeft < 0;
  const expiring = !expired && daysLeft <= 2;
  const productName = label.productName ?? label.product?.name ?? '—';
  const productBrand = label.productBrand ?? label.product?.brand ?? '';

  const statusCls = expired
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : expiring
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  const squircleCls = expired
    ? 'bg-rose-50 text-rose-600 border border-rose-100'
    : expiring
    ? 'bg-amber-50 text-amber-600 border border-amber-100'
    : 'bg-orange-50 text-brand-600 border border-orange-100';

  return (
    <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-slate-300 hover:shadow-card-hover group">
      {/* Left Item Details */}
      <div className="flex items-start gap-4 min-w-0 flex-1">
        <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-2xs', squircleCls)}>
          <Tag className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-bold text-charcoal-800 text-base group-hover:text-brand-600 transition-colors truncate">
              {productName}
            </h3>
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
            <span className="font-mono text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">
              {label.shortCode}
            </span>
          </div>

          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-slate-600">{productBrand}</span>
            <span>• Lote: <strong className="text-charcoal-800">{label.lot}</strong></span>
            <span>• Manipulador: <strong className="text-charcoal-800">{label.responsibleName ?? 'Não informado'}</strong></span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
            <span>Abertura: <strong className="text-charcoal-800">{formatBR(label.openedAt)}</strong></span>

            <span className="inline-flex items-center gap-1 font-semibold text-charcoal-800">
              Descarte:
              <strong className={cn('px-2 py-0.5 rounded-md', expired ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-charcoal-900')}>
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

          {label.shelfLifeDays != null && (
            <div className="mt-1.5 text-[11px] text-slate-400">
              Regra: {label.shelfLifeDays} dias • {label.rule?.source ?? 'Prazo cadastrado no produto'}
              {label.cappedByOriginalExpiry && ' • (Teto: validade original)'}
            </div>
          )}
        </div>
      </div>

      {/* Right Action */}
      <div className="pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
        <button
          onClick={onReprint}
          className="btn btn-outline btn-sm w-full sm:w-auto gap-1.5"
          title="Reimprimir etiqueta"
        >
          <Printer className="w-3.5 h-3.5 text-slate-500" />
          <span>Reimprimir</span>
        </button>
      </div>
    </div>
  );
}

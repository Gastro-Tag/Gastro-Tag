import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Printer, RefreshCw, Search, Tag } from 'lucide-react';
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
      toast('Reimpressão registrada.', 'success');
      void fetchLabels();
    } catch (error) {
      toast(extractError(error), 'error');
    }
  }

  const hasFilters = Boolean(search || from || to || storageType);
  const clearFilters = () => { setSearch(''); setFrom(''); setTo(''); setStorageType(''); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Histórico de etiquetas</h1>
          <p className="page-subtitle">{meta.total} etiqueta{meta.total !== 1 ? 's' : ''} gerada{meta.total !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary btn" onClick={() => navigate('/products')}><Tag className="h-4 w-4" /> Nova etiqueta</button>
      </div>

      <div className="card grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
        <label className="relative xl:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Produto, marca, lote ou código" className="input pl-9" />
        </label>
        <label className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="date" aria-label="Abertura a partir de" value={from} onChange={(event) => setFrom(event.target.value)} className="input pl-9" />
        </label>
        <label className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="date" aria-label="Abertura até" value={to} onChange={(event) => setTo(event.target.value)} className="input pl-9" />
        </label>
        <select className="input" aria-label="Tipo de armazenamento" value={storageType} onChange={(event) => setStorageType(event.target.value as StorageType | '')}>
          <option value="">Todo armazenamento</option>
          <option value="REFRIGERADO">Refrigerado</option>
          <option value="CONGELADO">Congelado</option>
        </select>
        <div className="flex gap-2 md:col-span-2 xl:col-span-5">
          <button onClick={() => void fetchLabels()} className="btn-outline btn btn-sm"><RefreshCw className="h-4 w-4" /> Atualizar</button>
          {hasFilters && <button onClick={clearFilters} className="btn-ghost btn btn-sm">Limpar filtros</button>}
        </div>
      </div>

      {from && to && from > to && <p role="alert" className="text-sm text-red-700">A data inicial deve ser anterior ou igual à data final.</p>}

      {loading ? <InlineLoader text="Carregando etiquetas…" /> : labels.length === 0 ? (
        <EmptyState icon="🏷" title="Nenhuma etiqueta encontrada" desc="Ajuste os filtros ou gere uma nova etiqueta." action={<button className="btn-primary btn" onClick={() => navigate('/products')}><Tag className="h-4 w-4" /> Gerar etiqueta</button>} />
      ) : (
        <>
          <div className="space-y-3">{labels.map((label) => <LabelCard key={label.id} label={label} onReprint={() => void reprint(label)} />)}</div>
          <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function LabelCard({ label, onReprint }: { label: Label; onReprint: () => void }) {
  const daysLeft = daysUntil(label.discardAt);
  const expired = daysLeft < 0;
  const expiring = !expired && daysLeft <= 2;
  const productName = label.productName ?? label.product?.name ?? '—';
  const productBrand = label.productBrand ?? label.product?.brand ?? '';

  return (
    <div className={cn('card grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3 border-l-4 p-3 sm:flex sm:gap-4 sm:p-4', expired ? 'border-l-red-500' : expiring ? 'border-l-amber-500' : 'border-l-brand-600')}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50"><Tag className="h-5 w-5 text-brand-700" /></div>
      <div className="col-start-2 row-start-1 min-w-0 sm:flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="break-words text-sm font-semibold text-slate-900">{productName}</div>
            <div className="mt-0.5 break-words text-xs text-slate-500">{productBrand} · Lote: <span className="font-medium">{label.lot}</span></div>
          </div>
          <span className={cn('badge', expired ? 'badge-expired' : expiring ? 'badge-expiring' : 'badge-valid')}>
            {expired ? `Vencida há ${Math.abs(daysLeft)}d` : daysLeft === 0 ? 'Vence hoje' : `${daysLeft}d restantes`}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span>Abertura: <strong className="text-slate-700">{formatBR(label.openedAt)}</strong></span>
          <span>Descarte: <strong className={cn(expired ? 'text-red-600' : 'text-slate-700')}>{formatBR(label.discardAt)}</strong></span>
          <span>{label.storageType === 'REFRIGERADO' ? '🌡' : '❄️'} {label.storageType.toLowerCase()}</span>
          <span>Temperatura: <strong className="text-slate-700">{label.storageTemp}</strong></span>
          <span>Manipulador: <strong className="text-slate-700">{label.responsibleName ?? 'Não informado'}</strong></span>
          <span>Criado por: <strong className="text-slate-700">{label.user?.name ?? 'Não identificado'}</strong></span>
          <span>🖨 {label.printCount}x impresso</span>
          <span>Última impressão: <strong className="text-slate-700">{formatDateTimeBR(label.printedAt)}</strong></span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">{label.shortCode}</span>
        </div>
        {label.shelfLifeDays != null && <div className="mt-2 text-xs text-slate-500">
          Prazo aplicado: {label.shelfLifeDays} dias · {label.rule?.source ?? 'Prazo informado no cadastro do produto'}
          {label.cappedByOriginalExpiry && ' · Limitado pela validade original'}
        </div>}
      </div>
      <button className="btn-outline btn btn-sm col-span-2 w-full justify-center sm:col-span-1 sm:ml-auto sm:w-auto sm:shrink-0" onClick={onReprint}><Printer className="h-3.5 w-3.5" /> Reimprimir</button>
    </div>
  );
}

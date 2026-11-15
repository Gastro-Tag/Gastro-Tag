import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, RefreshCw, Search, Tag, AlarmClock } from 'lucide-react';
import { labelApi } from '@/services';
import type { CloseLabelResult, Label, LabelListParams, LabelStatus, SplitResult, StorageType } from '@/types';
import { LabelCard } from '@/components/labels/LabelCard';
import { CloseLabelDialog } from '@/components/labels/CloseLabelDialog';
import { SplitLabelDialog } from '@/components/labels/SplitLabelDialog';
import { useAuthStore } from '@/store/authStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { InlineLoader } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { formatBR } from '@/utils/date';
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
  const [status, setStatus] = useState<LabelStatus | ''>('');
  const [due, setDue] = useState<'expired' | 'today' | 'upcoming' | ''>('');
  // Atalho: ativas vencidas ou que vencem hoje (duas consultas, pois o filtro de vencimento é único).
  const [discardToday, setDiscardToday] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [page, setPage] = useState(1);
  const [closing, setClosing] = useState<Label | null>(null);
  const [splitting, setSplitting] = useState<Label | null>(null);
  const isAdmin = useAuthStore((state) => state.user?.role) === 'ADMIN';
  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => { setPage(1); }, [debouncedSearch, from, to, storageType, status, due, discardToday]);

  const fetchLabels = useCallback(async () => {
    if (from && to && from > to) {
      setLabels([]);
      setMeta({ total: 0, totalPages: 1, page: 1 });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const base: LabelListParams = {
        q: debouncedSearch.trim() || undefined,
        from: from || undefined, to: to || undefined,
        storageType: storageType || undefined,
      };
      if (discardToday) {
        const [expired, today] = await Promise.all([
          labelApi.list({ ...base, status: 'ATIVA', due: 'expired', page: 1, limit: 100 }),
          labelApi.list({ ...base, status: 'ATIVA', due: 'today', page: 1, limit: 100 }),
        ]);
        const merged = [...expired.data.data, ...today.data.data]
          .sort((a, b) => a.discardAt.localeCompare(b.discardAt));
        setLabels(merged);
        setTruncated(expired.data.meta.total > expired.data.data.length || today.data.meta.total > today.data.data.length);
        setMeta({ total: expired.data.meta.total + today.data.meta.total, totalPages: 1, page: 1 });
      } else {
        const { data } = await labelApi.list({
          ...base, page, limit: 20,
          status: status || undefined,
          due: status === 'ATIVA' && due ? due : undefined,
        });
        setLabels(data.data);
        setTruncated(false);
        setMeta({ total: data.meta.total, totalPages: data.meta.totalPages, page: data.meta.page });
      }
    } catch (error) {
      toast(extractError(error), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, from, to, storageType, status, due, discardToday, toast]);

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

  function handleClosed(result: CloseLabelResult) {
    setClosing(null);
    const activeChildren = result.meta?.activeChildren ?? [];
    toast(`Etiqueta ${result.data.shortCode} encerrada.`, 'success');
    if (activeChildren.length > 0) {
      toast(
        `Atenção: as filhas ${activeChildren.map((child) => child.shortCode).join(', ')} continuam ativas e precisam ser encerradas separadamente.`,
        'warning',
      );
    }
    void fetchLabels();
  }

  function handleSplit(result: SplitResult, printed: boolean) {
    setSplitting(null);
    const codes = result.children.map((child) => child.shortCode).join(', ');
    toast(
      printed
        ? `${result.children.length} etiqueta(s) criada(s) e enviada(s) para impressão: ${codes}.`
        : `Etiquetas criadas (${codes}), mas a impressão falhou. Use Reimprimir.`,
      printed ? 'success' : 'warning',
    );
    void fetchLabels();
  }

  const hasFilters = Boolean(search || from || to || storageType || status || due || discardToday);
  const clearFilters = () => {
    setSearch(''); setFrom(''); setTo(''); setStorageType(''); setStatus(''); setDue(''); setDiscardToday(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-charcoal-800 tracking-tight">
            Histórico de Etiquetas
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
            {meta.total} {meta.total === 1 ? 'etiqueta registrada' : 'etiquetas registradas'}
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
      <div className="card p-4 sm:p-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 bg-white">
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
        <select
          className="input text-xs"
          aria-label="Situação da etiqueta"
          value={discardToday ? 'ATIVA' : status}
          disabled={discardToday}
          onChange={(e) => { setStatus(e.target.value as LabelStatus | ''); if (e.target.value !== 'ATIVA') setDue(''); }}
        >
          <option value="">Todas as situações</option>
          <option value="ATIVA">Ativas</option>
          <option value="ENCERRADA">Encerradas</option>
        </select>
        <select
          className="input text-xs"
          aria-label="Vencimento"
          value={discardToday ? '' : due}
          disabled={discardToday || status !== 'ATIVA'}
          title={status !== 'ATIVA' ? 'Escolha "Ativas" para filtrar por vencimento' : undefined}
          onChange={(e) => setDue(e.target.value as typeof due)}
        >
          <option value="">Qualquer vencimento</option>
          <option value="expired">Vencidas</option>
          <option value="today">Vencem hoje</option>
          <option value="upcoming">Próximas</option>
        </select>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-4 pt-1">
          <button
            type="button"
            aria-pressed={discardToday}
            onClick={() => { setDiscardToday((value) => !value); setStatus(''); setDue(''); }}
            className={cn('btn btn-sm gap-1.5', discardToday ? 'btn-danger' : 'btn-outline')}
          >
            <AlarmClock className="h-3.5 w-3.5" />
            <span>Para descartar hoje</span>
          </button>
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

      {discardToday && (
        <p className="text-xs font-semibold text-slate-500">
          Etiquetas ativas vencidas ou que vencem hoje, da mais antiga para a mais recente.
          {truncated && ' Mostrando as primeiras 100 de cada grupo: refine a busca para ver as demais.'}
        </p>
      )}

      {/* Label List */}
      {loading ? (
        <InlineLoader text="Carregando etiquetas…" />
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
                onSplit={() => setSplitting(label)}
                onCloseLabel={() => setClosing(label)}
                onSearchCode={setSearch}
              />
            ))}
          </div>
          <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />
        </>
      )}

      {closing && (
        <CloseLabelDialog label={closing} isAdmin={isAdmin} onClose={() => setClosing(null)} onClosed={handleClosed} />
      )}
      {splitting && (
        <SplitLabelDialog parent={splitting} onClose={() => setSplitting(null)} onDone={handleSplit} />
      )}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Filter, RefreshCw, Trash2, Tag,
  Package, ChevronDown,
} from 'lucide-react';
import { productApi } from '@/services';
import type { Product, ProductFilters, ProductStatus } from '@/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState }  from '@/components/ui/EmptyState';
import { Pagination }  from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { InlineLoader } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { useDebounce }   from '@/hooks/useDebounce';
import { formatBR, daysUntilLabel } from '@/utils/date';
import { cn } from '@/utils/cn';
import { extractError } from '@/services/api';
import { useAuthStore } from '@/store/authStore';

// ── Filter tab config ────────────────────────────────────
const statusTabs: { value: ProductStatus; label: string; icon: string }[] = [
  { value: 'all',      label: 'Todos',           icon: '📦' },
  { value: 'valid',    label: 'Válidos',          icon: '✅' },
  { value: 'expiring', label: 'Próx. vencimento', icon: '⚠️' },
  { value: 'expired',  label: 'Vencidos',         icon: '🔴' },
  { value: 'recent',   label: 'Recentes',         icon: '🆕' },
];

export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToastContext();

  // ── State ──────────────────────────────────────────────
  const [products, setProducts]     = useState<Product[]>([]);
  const [meta, setMeta]             = useState({ total: 0, totalPages: 1, page: 1 });
  const [loading, setLoading]       = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [toDelete, setToDelete]     = useState<Product | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Filters from URL ───────────────────────────────────
  const [search,   setSearch]   = useState(params.get('search')   ?? '');
  const [status,   setStatus]   = useState<ProductStatus>((params.get('status')  as ProductStatus) ?? 'all');
  const [storage,  setStorage]  = useState(params.get('storage')  ?? '');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [sort,     setSort]     = useState(params.get('sort')     ?? 'name');
  const [order,    setOrder]    = useState<'asc'|'desc'>((params.get('order') as 'asc'|'desc') ?? 'asc');
  const [page,     setPage]     = useState(Number(params.get('page')) || 1);

  const debouncedSearch = useDebounce(search, 400);

  // ── Load categories once ───────────────────────────────
  useEffect(() => {
    productApi.getCategories().then((r) => setCategories(r.data.data));
  }, []);

  // ── Fetch ──────────────────────────────────────────────
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const filters: ProductFilters = {
        search:   debouncedSearch || undefined,
        status:   status !== 'all' ? status : undefined,
        storage:  (storage as any) || undefined,
        category: category || undefined,
        sort:     (sort as any) || 'name',
        order,
        page,
        limit:    15,
      };
      // Sync URL
      const p = new URLSearchParams();
      if (debouncedSearch) p.set('search', debouncedSearch);
      if (status !== 'all') p.set('status', status);
      if (storage)  p.set('storage', storage);
      if (category) p.set('category', category);
      p.set('sort', sort); p.set('order', order); p.set('page', String(page));
      setParams(p, { replace: true });

      const res = await productApi.list(filters);
      setProducts(res.data.data);
      setMeta({ total: res.data.meta.total, totalPages: res.data.meta.totalPages, page: res.data.meta.page });
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, storage, category, sort, order, page, setParams]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // ── Delete ─────────────────────────────────────────────
  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await productApi.remove(toDelete.id);
      toast(`"${toDelete.name}" removido.`, 'success');
      setToDelete(null);
      fetchProducts();
    } catch (err) {
      toast(extractError(err), 'error');
    }
  }

  // ── Reset page when filters change ─────────────────────
  function changeFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Produtos</h1>
          <p className="page-subtitle">{meta.total} produto{meta.total !== 1 ? 's' : ''} cadastrado{meta.total !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary btn" onClick={() => navigate('/products/new')}>
          <Plus className="w-4 h-4" /> Novo Produto
        </button>
      </div>

      {/* ── Status Tabs ─────────────────────────────── */}
      <div className="flex w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => changeFilter(setStatus)(tab.value)}
            className={cn(
              'flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-xs font-medium transition-all sm:flex-1 sm:px-3',
              status === tab.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Search + Filters ────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Buscar por nome ou marca…"
              className="input pl-9"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={cn('btn-outline btn flex-1 gap-2 sm:flex-none', filtersOpen && 'border-brand-600 bg-brand-50 text-brand-700')}
              aria-expanded={filtersOpen}
            >
              <Filter className="h-4 w-4" />
              Filtros
              <ChevronDown className={cn('h-3 w-3 transition-transform', filtersOpen && 'rotate-180')} />
            </button>
            <button onClick={fetchProducts} className="btn-ghost btn" aria-label="Atualizar produtos" title="Atualizar produtos">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Advanced filters panel */}
        {filtersOpen && (
          <div className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Armazenamento</label>
              <select value={storage} onChange={(e) => changeFilter(setStorage)(e.target.value)} className="input text-sm">
                <option value="">Todos</option>
                <option value="refrigerado">🌡 Refrigerado</option>
                <option value="congelado">❄️ Congelado</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Categoria</label>
              <select value={category} onChange={(e) => changeFilter(setCategory)(e.target.value)} className="input text-sm">
                <option value="">Todas</option>
                {categories.map((c) => <option key={c} value={c!}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Ordenar por</label>
              <select value={sort} onChange={(e) => changeFilter(setSort)(e.target.value)} className="input text-sm">
                <option value="name">Nome</option>
                <option value="brand">Marca</option>
                <option value="date">Validade</option>
                <option value="created">Cadastro</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Direção</label>
              <select value={order} onChange={(e) => changeFilter(setOrder)(e.target.value as 'asc'|'desc')} className="input text-sm">
                <option value="asc">A → Z / Mais antigo</option>
                <option value="desc">Z → A / Mais recente</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ── Product List ────────────────────────────── */}
      {loading ? (
        <InlineLoader text="Carregando produtos…" />
      ) : products.length === 0 ? (
        <EmptyState
          icon="📦"
          title="Nenhum produto encontrado"
          desc={debouncedSearch ? `Sem resultados para "${debouncedSearch}".` : 'Cadastre seu primeiro produto para começar.'}
          action={
            <button className="btn-primary btn" onClick={() => navigate('/products/new')}>
              <Plus className="w-4 h-4" /> Cadastrar Produto
            </button>
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onLabel={() => navigate(`/labels/new?productId=${p.id}`)}
                onEdit={() => navigate(`/products/${p.id}/edit`)}
                onDelete={() => setToDelete(p)}
              />
            ))}
          </div>
          <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />
        </>
      )}

      {/* ── Confirm delete ───────────────────────────── */}
      <ConfirmDialog
        open={!!toDelete}
        title="Excluir produto"
        body={`Tem certeza que deseja remover "${toDelete?.name}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

// ── Product Card ─────────────────────────────────────────
function ProductCard({ product: p, onLabel, onEdit, onDelete }: {
  product:  Product;
  onLabel:  () => void;
  onEdit:   () => void;
  onDelete: () => void;
}) {
  const canDelete = useAuthStore((state) => state.user?.role === 'ADMIN');
  const borderColor =
    p.computedStatus === 'expired'  ? 'border-l-red-500' :
    p.computedStatus === 'expiring' ? 'border-l-amber-500' :
    'border-l-brand-600';

  const storageInfo = [
    p.daysValidRefrigerated > 0 ? `🌡 ${p.daysValidRefrigerated}d` : '',
    p.daysValidFrozen > 0       ? `❄️ ${p.daysValidFrozen}d`       : '',
  ].filter(Boolean).join('  ·  ');

  return (
    <div className={cn('card grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3 border-l-4 p-3 transition-shadow hover:shadow-card-lg sm:flex sm:gap-4 sm:p-4', borderColor)}>
      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
        <Package className="w-5 h-5 text-brand-700" />
      </div>

      {/* Info */}
      <div className="col-start-2 row-start-1 min-w-0 sm:flex-1">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="break-words text-sm font-semibold text-slate-900">{p.name}</div>
            <div className="mt-0.5 break-words text-xs text-slate-500">{p.brand}{p.category ? ` · ${p.category}` : ''}{p.unit ? ` · ${p.unit}` : ''}</div>
          </div>
          <StatusBadge
            status={p.computedStatus}
            label={daysUntilLabel(p.daysUntilExpiry)}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>📅 Val. original: <strong className="text-slate-700">{formatBR(p.originalExpiryDate)}</strong></span>
          {storageInfo && <span>{storageInfo}</span>}
          <span>🏷 {p.labelCount} etiqueta{p.labelCount !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Actions */}
      <div className={cn('col-span-2 grid w-full gap-2 sm:flex sm:w-auto sm:shrink-0', canDelete ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]' : 'grid-cols-2')}>
        <button className="btn-primary btn btn-sm w-full whitespace-nowrap px-2 sm:w-auto sm:px-3" onClick={onLabel}>
          <Tag className="w-3.5 h-3.5" /> Etiqueta
        </button>
        <button className="btn-outline btn btn-sm w-full whitespace-nowrap px-2 sm:w-auto sm:px-3" onClick={onEdit}>Editar</button>
        {canDelete && <button className="btn-ghost btn btn-sm text-red-500 hover:bg-red-50 hover:text-red-600" onClick={onDelete} aria-label={`Excluir ${p.name}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>}
      </div>
    </div>
  );
}

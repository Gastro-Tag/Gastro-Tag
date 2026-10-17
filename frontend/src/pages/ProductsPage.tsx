import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Filter, RefreshCw, Trash2, Tag,
  Package, ChevronDown, Utensils, Refrigerator, Snowflake, Calendar,
  Edit2
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
const statusTabs: { value: ProductStatus; label: string }[] = [
  { value: 'all',      label: 'Todos os Itens' },
  { value: 'valid',    label: 'Válidos (OK)' },
  { value: 'expiring', label: 'Próx. Vencimento' },
  { value: 'expired',  label: 'Vencidos / Crítico' },
  { value: 'recent',   label: 'Recentes' },
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
      toast(`"${toDelete.name}" removido com sucesso.`, 'success');
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-charcoal-800 tracking-tight">
            Controle de Produtos
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
            {meta.total} {meta.total === 1 ? 'alimento cadastrado' : 'alimentos cadastrados no catálogo'}
          </p>
        </div>
        <button
          className="btn btn-primary shadow-sm"
          onClick={() => navigate('/products/new')}
        >
          <Plus className="w-4 h-4 text-brand-400" />
          <span>Novo Alimento</span>
        </button>
      </div>

      {/* ── Status Tabs (Clean Pills) ───────────────── */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white border border-slate-200/80 shadow-xs overflow-x-auto">
        {statusTabs.map((tab) => {
          const isActive = status === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => changeFilter(setStatus)(tab.value)}
              className={cn(
                'px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0',
                isActive
                  ? 'bg-charcoal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-charcoal-800 hover:bg-slate-50'
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Search + Filter Bar ─────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Buscar por nome do produto ou marca..."
              className="input pl-10"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={cn(
                'btn btn-outline flex-1 sm:flex-none gap-2 text-xs font-bold',
                filtersOpen && 'border-charcoal-800 bg-slate-100 text-charcoal-800'
              )}
              aria-expanded={filtersOpen}
            >
              <Filter className="h-4 w-4" />
              <span>Filtros</span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', filtersOpen && 'rotate-180')} />
            </button>
            <button
              onClick={fetchProducts}
              className="btn btn-outline px-3"
              aria-label="Atualizar lista"
              title="Atualizar lista"
            >
              <RefreshCw className={cn('h-4 w-4 text-slate-500', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Advanced filters dropdown card */}
        {filtersOpen && (
          <div className="card grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4 bg-white">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Armazenamento
              </label>
              <select value={storage} onChange={(e) => changeFilter(setStorage)(e.target.value)} className="input text-xs">
                <option value="">Todos</option>
                <option value="refrigerado">Refrigerado</option>
                <option value="congelado">Congelado</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Categoria
              </label>
              <select value={category} onChange={(e) => changeFilter(setCategory)(e.target.value)} className="input text-xs">
                <option value="">Todas</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Ordenar por
              </label>
              <select value={sort} onChange={(e) => changeFilter(setSort)(e.target.value)} className="input text-xs">
                <option value="name">Nome do Produto</option>
                <option value="brand">Marca</option>
                <option value="date">Data de Validade</option>
                <option value="created">Data de Cadastro</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Ordem
              </label>
              <select value={order} onChange={(e) => changeFilter(setOrder)(e.target.value as 'asc'|'desc')} className="input text-xs">
                <option value="asc">Crescente (A → Z / Antigos)</option>
                <option value="desc">Decrescente (Z → A / Novos)</option>
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
          desc={debouncedSearch ? `Sem resultados para "${debouncedSearch}".` : 'Cadastre seu primeiro alimento para começar a rotulagem.'}
          action={
            <button className="btn btn-primary" onClick={() => navigate('/products/new')}>
              <Plus className="w-4 h-4 text-brand-400" /> Cadastrar Alimento
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
        body={`Tem certeza que deseja remover "${toDelete?.name}"? Esta ação desativará o produto no catálogo.`}
        confirmLabel="Excluir"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

// ── Product Card Component (Matching Reference) ─────────
function ProductCard({ product: p, onLabel, onEdit, onDelete }: {
  product:  Product;
  onLabel:  () => void;
  onEdit:   () => void;
  onDelete: () => void;
}) {
  const canDelete = useAuthStore((state) => state.user?.role === 'ADMIN');

  // Badge squircle icon styling based on status
  const iconStyle =
    p.computedStatus === 'expired'  ? 'bg-rose-50 text-rose-600 border border-rose-100' :
    p.computedStatus === 'expiring' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
    'bg-emerald-50 text-emerald-600 border border-emerald-100';

  return (
    <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-slate-300/80 hover:shadow-card-hover group">

      {/* Left Item Info */}
      <div className="flex items-start gap-4 min-w-0 flex-1">
        <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-2xs', iconStyle)}>
          <Utensils className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-bold text-charcoal-800 text-base group-hover:text-brand-600 transition-colors truncate">
              {p.name}
            </h3>
            <StatusBadge
              status={p.computedStatus}
              label={daysUntilLabel(p.daysUntilExpiry)}
            />
          </div>

          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-slate-600">{p.brand}</span>
            {p.category && <span>• {p.category}</span>}
            {p.unit && <span>({p.unit})</span>}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Val. Original: <strong className="text-charcoal-800">{formatBR(p.originalExpiryDate)}</strong></span>
            </span>

            {p.daysValidRefrigerated > 0 && (
              <span className="inline-flex items-center gap-1 text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md text-[11px] font-semibold border border-sky-100">
                <Refrigerator className="w-3 h-3" />
                <span>Refr.: {p.daysValidRefrigerated}d</span>
              </span>
            )}

            {p.daysValidFrozen > 0 && (
              <span className="inline-flex items-center gap-1 text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md text-[11px] font-semibold border border-indigo-100">
                <Snowflake className="w-3 h-3" />
                <span>Cong.: {p.daysValidFrozen}d</span>
              </span>
            )}

            <span className="text-[11px] text-slate-400 font-medium">
              {p.labelCount} {p.labelCount === 1 ? 'etiqueta gerada' : 'etiquetas geradas'}
            </span>
          </div>
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
        <button
          onClick={onLabel}
          className="btn btn-accent btn-sm flex-1 sm:flex-none gap-1.5 shadow-xs"
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Etiquetar</span>
        </button>

        <button
          onClick={onEdit}
          className="btn btn-outline btn-sm px-3 text-slate-600"
          title="Editar produto"
        >
          <Edit2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Editar</span>
        </button>

        {canDelete && (
          <button
            onClick={onDelete}
            className="btn btn-ghost btn-sm p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
            aria-label={`Excluir ${p.name}`}
            title="Excluir alimento"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

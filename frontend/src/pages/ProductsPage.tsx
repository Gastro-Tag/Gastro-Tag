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
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-full overflow-x-auto">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => changeFilter(setStatus)(tab.value)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-all flex-1 justify-center',
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
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Buscar por nome ou marca…"
              className="input pl-9"
            />
          </div>
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={cn('btn-outline btn gap-2', filtersOpen && 'border-brand-600 text-brand-700 bg-brand-50')}
          >
            <Filter className="w-4 h-4" />
            Filtros
            <ChevronDown className={cn('w-3 h-3 transition-transform', filtersOpen && 'rotate-180')} />
          </button>
          <button onClick={fetchProducts} className="btn-ghost btn">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Advanced filters panel */}
        {filtersOpen && (
          <div className="card p-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
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
  const borderColor =
    p.computedStatus === 'expired'  ? 'border-l-red-500' :
    p.computedStatus === 'expiring' ? 'border-l-amber-500' :
    'border-l-brand-600';

  const storageInfo = [
    p.daysValidRefrigerated > 0 ? `🌡 ${p.daysValidRefrigerated}d` : '',
    p.daysValidFrozen > 0       ? `❄️ ${p.daysValidFrozen}d`       : '',
  ].filter(Boolean).join('  ·  ');

  return (
    <div className={cn('card border-l-4 p-4 flex gap-4 items-start hover:shadow-card-lg transition-shadow', borderColor)}>
      {/* Icon */}
      <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
        <Package className="w-5 h-5 text-brand-700" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="font-semibold text-slate-900 text-sm">{p.name}</div>
            <div className="text-xs text-slate-500 mt-0.5">{p.brand}{p.category ? ` · ${p.category}` : ''}{p.unit ? ` · ${p.unit}` : ''}</div>
          </div>
          <StatusBadge
            status={p.computedStatus}
            label={daysUntilLabel(p.daysUntilExpiry)}
          />
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 text-xs text-slate-500">
          <span>📅 Val. original: <strong className="text-slate-700">{formatBR(p.originalExpiryDate)}</strong></span>
          <span>{storageInfo}</span>
          <span>🏷 {p.labelCount} etiqueta{p.labelCount !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-shrink-0">
        <button className="btn-primary btn btn-sm" onClick={onLabel}>
          <Tag className="w-3.5 h-3.5" /> Etiqueta
        </button>
        <button className="btn-outline btn btn-sm" onClick={onEdit}>Editar</button>
        <button className="btn-ghost btn btn-sm text-red-500 hover:bg-red-50 hover:text-red-600" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

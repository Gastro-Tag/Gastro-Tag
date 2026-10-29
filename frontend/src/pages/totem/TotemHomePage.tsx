import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, History, PackageOpen, Printer,
  Refrigerator, RefreshCw, Search, Snowflake, Tag, X,
} from 'lucide-react';
import { labelApi, productApi } from '@/services';
import { extractError } from '@/services/api';
import type { Label, Product } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { KeyboardSheet } from '@/components/totem/KeyboardSheet';
import { formatBR, formatDateTimeBR } from '@/utils/date';
import { printLabel } from '@/utils/printLabel';
import { getUsage, normalizeText } from '@/utils/totem';
import { cn } from '@/utils/cn';

type Tab = 'nova' | 'ultimas';
type Notice = { text: string; tone: 'ok' | 'error' };

async function loadAllProducts(): Promise<Product[]> {
  const all: Product[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await productApi.list({ page, limit: 100, sort: 'name', order: 'asc' });
    all.push(...data.data);
    if (!data.meta.hasNext) break;
  }
  return all;
}

export function TotemHomePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('nova');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProducts(await loadAllProducts());
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Inatividade: o shell avisa e a tela volta ao estado inicial.
  useEffect(() => {
    const reset = () => {
      setTab('nova'); setSearch(''); setSearchOpen(false); setCategory(''); setNotice(null);
    };
    window.addEventListener('totem:idle', reset);
    return () => window.removeEventListener('totem:idle', reset);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Mais usados neste totem primeiro; depois mais etiquetados; vencidos por último.
  const ordered = useMemo(() => {
    const usage = getUsage();
    return [...products].sort((a, b) => {
      const expiredA = a.computedStatus === 'expired' ? 1 : 0;
      const expiredB = b.computedStatus === 'expired' ? 1 : 0;
      if (expiredA !== expiredB) return expiredA - expiredB;
      const usedA = usage[a.id] ?? 0;
      const usedB = usage[b.id] ?? 0;
      if (usedA !== usedB) return usedB - usedA;
      if (a.labelCount !== b.labelCount) return b.labelCount - a.labelCount;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }, [products]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c))))
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [products],
  );

  const visible = useMemo(() => {
    const term = normalizeText(search);
    return ordered.filter((p) => {
      if (category && p.category !== category) return false;
      if (!term) return true;
      return normalizeText(`${p.name} ${p.brand}`).includes(term);
    });
  }, [ordered, search, category]);

  function openProduct(product: Product) {
    if (product.computedStatus === 'expired') {
      setNotice({
        tone: 'error',
        text: `${product.name} está VENCIDO. Não use o produto e não gere etiqueta: descarte.`,
      });
      return;
    }
    navigate(`/totem/etiqueta/${product.id}`);
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Abas */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-[#F3F4F6]/95 px-5 pb-3 pt-4 backdrop-blur">
        <div className="grid grid-cols-2 gap-3">
          <TabButton active={tab === 'nova'} icon={<Tag className="h-6 w-6" />} onClick={() => setTab('nova')}>
            Nova etiqueta
          </TabButton>
          <TabButton active={tab === 'ultimas'} icon={<History className="h-6 w-6" />} onClick={() => setTab('ultimas')}>
            Últimas etiquetas
          </TabButton>
        </div>

        {tab === 'nova' && (
          <div className="mt-3 space-y-3">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-16 min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-5 text-left text-xl font-semibold active:scale-[0.99]"
              >
                <Search className="h-6 w-6 shrink-0 text-slate-400" />
                <span className={cn('truncate', search ? 'text-charcoal-800' : 'text-slate-400')}>
                  {search || 'Buscar produto ou marca'}
                </span>
              </button>
              {search && (
                <button
                  type="button" aria-label="Limpar busca" onClick={() => setSearch('')}
                  className="flex h-16 w-16 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95"
                >
                  <X className="h-7 w-7" />
                </button>
              )}
              <button
                type="button" aria-label="Atualizar lista" onClick={() => void load()}
                className="flex h-16 w-16 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95"
              >
                <RefreshCw className={cn('h-6 w-6', loading && 'animate-spin')} />
              </button>
            </div>

            {categories.length > 0 && (
              <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
                <Chip active={category === ''} onClick={() => setCategory('')}>Todos</Chip>
                {categories.map((name) => (
                  <Chip key={name} active={category === name} onClick={() => setCategory(name)}>{name}</Chip>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={cn(
            'mx-5 mt-4 flex items-start gap-3 rounded-2xl border-2 p-4 text-lg font-bold',
            notice.tone === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-rose-300 bg-rose-50 text-rose-800',
          )}
        >
          {notice.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" /> : <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)} className="p-1">
            <X className="h-6 w-6" />
          </button>
        </div>
      )}

      <div className="flex-1 p-5">
        {tab === 'nova' ? (
          loading ? (
            <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>
          ) : error ? (
            <EmptyBlock
              icon={<AlertTriangle className="h-14 w-14 text-rose-500" />}
              title="Não foi possível carregar os produtos"
              text={error}
              action={<button type="button" className="btn btn-accent h-16 px-10 text-xl" onClick={() => void load()}>Tentar de novo</button>}
            />
          ) : visible.length === 0 ? (
            <EmptyBlock
              icon={<PackageOpen className="h-14 w-14 text-slate-300" />}
              title="Nenhum produto encontrado"
              text={search ? `Nada para “${search}”.` : 'Cadastre produtos no painel administrativo.'}
              action={search || category ? (
                <button type="button" className="btn btn-outline h-16 px-10 text-xl" onClick={() => { setSearch(''); setCategory(''); }}>
                  Limpar filtros
                </button>
              ) : undefined}
            />
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {visible.map((product) => (
                <ProductTile key={product.id} product={product} onPress={() => openProduct(product)} />
              ))}
            </div>
          )
        ) : (
          <RecentLabels onNotice={setNotice} />
        )}
      </div>

      {searchOpen && (
        <KeyboardSheet
          title="Buscar produto"
          hint="A lista filtra enquanto você digita."
          placeholder="Nome ou marca"
          initialValue={search}
          required={false}
          confirmLabel="Ver resultados"
          cancelLabel="Fechar"
          onLiveChange={setSearch}
          onCancel={() => setSearchOpen(false)}
          onConfirm={() => { setSearchOpen(false); }}
        />
      )}
    </div>
  );
}

// ── Peças ─────────────────────────────────────────────────
function TabButton({ active, icon, onClick, children }: {
  active: boolean; icon: React.ReactNode; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-16 touch-manipulation items-center justify-center gap-3 rounded-2xl text-xl font-extrabold transition-colors active:scale-[0.99]',
        active ? 'bg-charcoal-800 text-white shadow' : 'border-2 border-slate-200 bg-white text-slate-600',
      )}
    >
      {icon}{children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-14 shrink-0 touch-manipulation whitespace-nowrap rounded-full px-6 text-lg font-bold active:scale-95',
        active ? 'bg-brand-600 text-white shadow' : 'border-2 border-slate-200 bg-white text-slate-600',
      )}
    >
      {children}
    </button>
  );
}

function ProductTile({ product, onPress }: { product: Product; onPress: () => void }) {
  const expired = product.computedStatus === 'expired';
  const expiring = product.computedStatus === 'expiring';
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        'flex min-h-[148px] touch-manipulation flex-col justify-between rounded-3xl border-2 bg-white p-5 text-left shadow-card transition-transform active:scale-[0.97]',
        expired ? 'border-rose-300 bg-rose-50/60' : expiring ? 'border-amber-300' : 'border-slate-200',
      )}
    >
      <div>
        <div className={cn('line-clamp-2 text-2xl font-extrabold leading-tight', expired && 'text-rose-700')}>
          {product.name}
        </div>
        <div className="mt-1 truncate text-base font-medium text-slate-500">
          {product.brand}{product.category ? ` · ${product.category}` : ''}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-2 text-slate-400">
          {product.daysValidRefrigerated > 0 && <Refrigerator className="h-6 w-6 text-sky-600" aria-label="Refrigerado" />}
          {product.daysValidFrozen > 0 && <Snowflake className="h-6 w-6 text-indigo-600" aria-label="Congelado" />}
        </div>
        {expired && <span className="rounded-full bg-rose-600 px-3 py-1 text-sm font-extrabold uppercase text-white">Vencido</span>}
        {expiring && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-extrabold text-amber-800">
            Vence em {product.daysUntilExpiry}d
          </span>
        )}
      </div>
    </button>
  );
}

function EmptyBlock({ icon, title, text, action }: {
  icon: React.ReactNode; title: string; text: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center">
      {icon}
      <h2 className="text-2xl font-extrabold">{title}</h2>
      <p className="max-w-md text-lg text-slate-500">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ── Últimas etiquetas / reimpressão ───────────────────────
function RecentLabels({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await labelApi.list({ page: 1, limit: 15 });
      setLabels(data.data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function reprint(label: Label) {
    if (busyId) return;
    setBusyId(label.id);
    try {
      printLabel(label, localStorage.getItem('gastrotag_logo'));
      await labelApi.registerPrint(label.id);
      onNotice({ tone: 'ok', text: 'Etiqueta reimpressa e registrada no histórico.' });
      void load();
    } catch (err) {
      onNotice({ tone: 'error', text: extractError(err) });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;
  if (error) {
    return (
      <EmptyBlock
        icon={<AlertTriangle className="h-14 w-14 text-rose-500" />}
        title="Não foi possível carregar"
        text={error}
        action={<button type="button" className="btn btn-accent h-16 px-10 text-xl" onClick={() => void load()}>Tentar de novo</button>}
      />
    );
  }
  if (labels.length === 0) {
    return (
      <EmptyBlock
        icon={<Tag className="h-14 w-14 text-slate-300" />}
        title="Nenhuma etiqueta ainda"
        text="As etiquetas geradas aparecem aqui para reimpressão."
      />
    );
  }

  return (
    <div className="space-y-3">
      {labels.map((label) => (
        <div key={label.id} className="flex items-center gap-4 rounded-3xl border-2 border-slate-200 bg-white p-4 shadow-card">
          <div className="min-w-0 flex-1">
            <div className="truncate text-2xl font-extrabold">{label.productName ?? label.product?.name ?? '—'}</div>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-base font-medium text-slate-500">
              <span>Lote <strong className="text-charcoal-800">{label.lot}</strong></span>
              <span>{label.storageType === 'REFRIGERADO' ? 'Refrigerado' : 'Congelado'}</span>
              <span>Descarte <strong className="text-brand-700">{formatBR(label.discardAt)}</strong></span>
              <span>{formatDateTimeBR(label.createdAt)}</span>
            </div>
          </div>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => void reprint(label)}
            className="btn btn-primary h-16 shrink-0 gap-2 px-6 text-lg font-extrabold"
          >
            {busyId === label.id ? <Spinner size="sm" className="text-white" /> : <Printer className="h-6 w-6" />}
            Reimprimir
          </button>
        </div>
      ))}
    </div>
  );
}

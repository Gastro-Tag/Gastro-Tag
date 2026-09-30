import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Tag, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { dashboardApi } from '@/services';
import type { DashboardStats } from '@/types';
import { PageLoader } from '@/components/ui/Spinner';
import { cn } from '@/utils/cn';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    dashboardApi.getStats()
      .then((r) => setStats(r.data.data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;
  if (!stats)  return <p className="text-red-500">Erro ao carregar estatísticas.</p>;

  const { products, labels, topProducts } = stats;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Visão geral do sistema de rotulagem</p>
      </div>

      {/* ── Status Cards ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Produtos cadastrados"
          value={products.total}
          icon={Package}
          color="brand"
          onClick={() => navigate('/products')}
        />
        <StatCard
          label="Válidos"
          value={products.valid}
          icon={CheckCircle}
          color="green"
          onClick={() => navigate('/products?status=valid')}
        />
        <StatCard
          label="Próx. do vencimento"
          value={products.expiring}
          icon={AlertTriangle}
          color="amber"
          onClick={() => navigate('/products?status=expiring')}
        />
        <StatCard
          label="Vencidos"
          value={products.expired}
          icon={AlertTriangle}
          color="red"
          onClick={() => navigate('/products?status=expired')}
        />
      </div>

      {/* ── Label Stats ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-4 sm:p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center">
              <Tag className="w-4 h-4 text-brand-700" />
            </div>
            <h3 className="font-semibold text-slate-800">Etiquetas</h3>
          </div>
          <div className="space-y-3">
            <Row label="Total geradas" value={labels.total} />
            <Row label="Hoje"          value={labels.today} />
            <Row label="Esta semana"   value={labels.thisWeek} />
            <Row label="Refrigerado"   value={labels.byStorage['REFRIGERADO'] ?? 0} />
            <Row label="Congelado"     value={labels.byStorage['CONGELADO']   ?? 0} />
          </div>
        </div>

        {/* Top Products */}
        <div className="card p-4 sm:p-5 col-span-1 lg:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-brand-700" />
            </div>
            <h3 className="font-semibold text-slate-800">Produtos mais etiquetados</h3>
          </div>
          {topProducts.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Nenhum dado ainda.</p>
          ) : (
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <button key={p.id} type="button"
                  className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  onClick={() => navigate(`/products/${p.id}/edit`)}
                >
                  <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700
                                   text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.brand}</div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-brand-700">
                    {p.labelCount} etiq.
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent alert */}
      {products.expiring > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-900">
              {products.expiring} produto{products.expiring !== 1 ? 's' : ''} vence{products.expiring === 1 ? '' : 'm'} nos próximos 7 dias.
            </p>
            <button
              onClick={() => navigate('/products?status=expiring')}
              className="text-sm text-amber-700 underline underline-offset-2 mt-0.5"
            >
              Ver produtos →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────
type Color = 'brand' | 'green' | 'amber' | 'red';

const colorMap: Record<Color, { bg: string; icon: string; border: string }> = {
  brand: { bg: 'bg-brand-50',  icon: 'text-brand-700', border: 'border-brand-200' },
  green: { bg: 'bg-emerald-50', icon: 'text-emerald-700', border: 'border-emerald-200' },
  amber: { bg: 'bg-amber-50',  icon: 'text-amber-700', border: 'border-amber-200' },
  red:   { bg: 'bg-red-50',    icon: 'text-red-700',   border: 'border-red-200'   },
};

function StatCard({ label, value, icon: Icon, color, onClick }: {
  label: string; value: number;
  icon: React.ElementType; color: Color; onClick?: () => void;
}) {
  const c = colorMap[color];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'card block w-full border p-4 text-left transition-shadow hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 sm:p-5',
        c.border,
      )}
    >
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', c.bg)}>
        <Icon className={cn('w-5 h-5', c.icon)} />
      </div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1 font-medium">{label}</div>
    </button>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}

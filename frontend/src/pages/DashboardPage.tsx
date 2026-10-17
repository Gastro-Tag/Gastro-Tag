import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package,
  Tag,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Plus,
  ArrowUpRight,
  Clock,
  Snowflake,
  Refrigerator,
  UtensilsCrossed,
} from 'lucide-react';
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
  if (!stats)  return (
    <div className="card p-6 text-center text-rose-600">
      <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-500" />
      <p className="font-semibold">Erro ao carregar estatísticas do sistema.</p>
    </div>
  );

  const { products, labels, topProducts } = stats;

  return (
    <div className="space-y-8">
      {/* ── Top Bar / Page Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-charcoal-800 tracking-tight">
            Controle de Alimentos
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
            Monitoramento de validades, estoque ativo e rotulagem sanitária
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => navigate('/products/new')}
            className="btn btn-outline py-2.5 px-4 text-xs sm:text-sm"
          >
            <Plus className="w-4 h-4 text-slate-500" />
            <span>Cadastrar Produto</span>
          </button>
          <button
            onClick={() => navigate('/labels/new')}
            className="btn btn-accent py-2.5 px-4 text-xs sm:text-sm shadow-sm"
          >
            <Tag className="w-4 h-4" />
            <span>Gerar Etiqueta</span>
          </button>
        </div>
      </div>

      {/* ── Critical Alert Banner (if any expiring) ────────── */}
      {products.expiring > 0 && (
        <div className="flex items-center justify-between gap-3 p-4 bg-amber-50/80 border border-amber-200/80 rounded-2xl shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-950">
                Atenção de Validade: {products.expiring} {products.expiring === 1 ? 'produto próximo' : 'produtos próximos'} do vencimento
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Itens com data limite nos próximos 7 dias necessitam de rotação prioritária.
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/products?status=expiring')}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-white px-3 py-1.5 rounded-lg border border-amber-300 hover:bg-amber-100/50 transition-colors shrink-0"
          >
            <span>Ver itens</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── KPI Stat Cards (Matching Gestão de Estoque) ───── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total de Produtos"
          description="Itens ativos cadastrados"
          value={products.total}
          icon={Package}
          variant="brand"
          onClick={() => navigate('/products')}
        />
        <StatCard
          label="Validades Regulares"
          description="Em conformidade (OK)"
          value={products.valid}
          icon={CheckCircle2}
          variant="emerald"
          onClick={() => navigate('/products?status=valid')}
        />
        <StatCard
          label="Próx. do Vencimento"
          description="Atenção nos próx. 7 dias"
          value={products.expiring}
          icon={Clock}
          variant="amber"
          onClick={() => navigate('/products?status=expiring')}
        />
        <StatCard
          label="Produtos Vencidos"
          description="Descarte obrigatório"
          value={products.expired}
          icon={AlertTriangle}
          variant="rose"
          onClick={() => navigate('/products?status=expired')}
        />
      </div>

      {/* ── Main Content Grid (Etiquetas + Mais Utilizados) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Resumo de Rotulagem */}
        <div className="card p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-orange-50 text-brand-600 border border-orange-100 flex items-center justify-center">
                  <Tag className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-charcoal-800 text-base">Atividade de Rotulagem</h3>
              </div>
              <button
                onClick={() => navigate('/labels')}
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
              >
                <span>Histórico</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3.5">
              <MetricRow
                label="Total de etiquetas geradas"
                value={labels.total}
                badge="Geral"
              />
              <MetricRow
                label="Manipulados hoje"
                value={labels.today}
                badge="Hoje"
                highlight={labels.today > 0}
              />
              <MetricRow
                label="Manipulados nesta semana"
                value={labels.thisWeek}
              />
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-3">
                Distribuição por Armazenamento
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <Refrigerator className="w-4 h-4 text-sky-600 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs text-slate-500 block truncate">Refrigerado</span>
                    <span className="text-sm font-bold text-charcoal-800">{labels.byStorage['REFRIGERADO'] ?? 0}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <Snowflake className="w-4 h-4 text-indigo-600 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs text-slate-500 block truncate">Congelado</span>
                    <span className="text-sm font-bold text-charcoal-800">{labels.byStorage['CONGELADO'] ?? 0}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/labels/new')}
            className="btn btn-outline w-full mt-6 text-xs font-bold"
          >
            Imprimir nova etiqueta sanitária
          </button>
        </div>

        {/* Top Produtos mais etiquetados (Estilo Lista Ilustrativa) */}
        <div className="card p-5 sm:p-6 lg:col-span-2">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-charcoal-800 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-charcoal-800 text-base">Alimentos Mais Etiquetados</h3>
                <p className="text-xs text-slate-400">Itens com maior rotatividade e manipulação na cozinha</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/products')}
              className="text-xs font-semibold text-slate-500 hover:text-charcoal-900"
            >
              Ver todos
            </button>
          </div>

          {topProducts.length === 0 ? (
            <div className="py-12 text-center">
              <UtensilsCrossed className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-600">Nenhuma etiqueta registrada ainda</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Ao gerar etiquetas para produtos manipulados, os itens mais frequentes aparecerão aqui.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {topProducts.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate(`/products/${p.id}/edit`)}
                  className="group flex w-full items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-100 bg-white hover:bg-slate-50/80 hover:border-slate-200 transition-all text-left"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100/60 text-brand-600 flex items-center justify-center font-bold text-sm shrink-0">
                      #{i + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-charcoal-800 group-hover:text-brand-600 transition-colors truncate">
                        {p.name}
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-2 truncate">
                        <span>Marca: {p.brand}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-charcoal-800 border border-slate-200/60">
                      {p.labelCount} {p.labelCount === 1 ? 'etiqueta' : 'etiquetas'}
                    </span>
                    <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-charcoal-800 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components & Helpers ────────────────────────────

interface StatCardProps {
  label: string;
  description: string;
  value: number;
  icon: React.ElementType;
  variant: 'brand' | 'emerald' | 'amber' | 'rose';
  onClick?: () => void;
}

const variantStyles = {
  brand: {
    squircle: 'bg-orange-50 text-brand-600 border border-orange-100',
    borderHover: 'hover:border-orange-200',
    number: 'text-charcoal-900',
  },
  emerald: {
    squircle: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
    borderHover: 'hover:border-emerald-200',
    number: 'text-charcoal-900',
  },
  amber: {
    squircle: 'bg-amber-50 text-amber-600 border border-amber-100',
    borderHover: 'hover:border-amber-200',
    number: 'text-charcoal-900',
  },
  rose: {
    squircle: 'bg-rose-50 text-rose-600 border border-rose-100',
    borderHover: 'hover:border-rose-200',
    number: 'text-charcoal-900',
  },
};

function StatCard({ label, description, value, icon: Icon, variant, onClick }: StatCardProps) {
  const styles = variantStyles[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'card p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover group',
        styles.borderHover
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105', styles.squircle)}>
          <Icon className="w-5 h-5" />
        </div>
        <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors" />
      </div>
      <div className={cn('text-3xl sm:text-4xl font-extrabold tracking-tight', styles.number)}>
        {value}
      </div>
      <div className="text-sm font-bold text-charcoal-800 mt-1">{label}</div>
      <div className="text-xs text-slate-400 mt-0.5 font-medium">{description}</div>
    </button>
  );
}

function MetricRow({ label, value, badge, highlight }: {
  label: string;
  value: number;
  badge?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-slate-500 font-medium">{label}</span>
        {badge && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 uppercase">
            {badge}
          </span>
        )}
      </div>
      <span className={cn('font-bold', highlight ? 'text-brand-600' : 'text-charcoal-800')}>
        {value}
      </span>
    </div>
  );
}

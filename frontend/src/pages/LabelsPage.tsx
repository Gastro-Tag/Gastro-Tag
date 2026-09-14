import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Printer, Search, RefreshCw } from 'lucide-react';
import { labelApi } from '@/services';
import type { Label } from '@/types';
import { EmptyState }   from '@/components/ui/EmptyState';
import { Pagination }   from '@/components/ui/Pagination';
import { InlineLoader } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { useDebounce }  from '@/hooks/useDebounce';
import { formatBR }     from '@/utils/date';
import { cn }           from '@/utils/cn';
import { extractError } from '@/services/api';

export function LabelsPage() {
  const navigate = useNavigate();
  const { toast } = useToastContext();

  const [labels,   setLabels]   = useState<Label[]>([]);
  const [meta,     setMeta]     = useState({ total: 0, totalPages: 1, page: 1 });
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [page,     setPage]     = useState(1);

  const debouncedSearch = useDebounce(search, 400);

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await labelApi.list({ page, limit: 20 });
      setLabels(res.data.data);
      setMeta({
        total:      res.data.meta.total,
        totalPages: res.data.meta.totalPages,
        page:       res.data.meta.page,
      });
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchLabels(); }, [fetchLabels]);

  // Client-side filter by search (product name)
  const filtered = debouncedSearch
    ? labels.filter(
        (l) =>
          l.product?.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          l.product?.brand.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          l.shortCode.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : labels;

  async function reprint(label: Label) {
    try {
      await labelApi.registerPrint(label.id);
      const logoUrl = localStorage.getItem('gastrotag_logo');
      const el      = document.getElementById('print-root');
      if (!el) return;
      el.innerHTML  = buildReprintHTML(label, logoUrl);
      window.print();
      el.innerHTML  = '';
      toast('Reimpressão registrada.', 'success');
    } catch (err) {
      toast(extractError(err), 'error');
    }
  }

  return (
    <>
      <div id="print-root" style={{ display: 'none' }} />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="page-title">Histórico de Etiquetas</h1>
            <p className="page-subtitle">{meta.total} etiqueta{meta.total !== 1 ? 's' : ''} gerada{meta.total !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn-primary btn" onClick={() => navigate('/products')}>
            <Tag className="w-4 h-4" /> Nova Etiqueta
          </button>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por produto, marca ou código…"
              className="input pl-9"
            />
          </div>
          <button onClick={fetchLabels} className="btn-ghost btn">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        {loading ? (
          <InlineLoader text="Carregando etiquetas…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🏷"
            title="Nenhuma etiqueta encontrada"
            desc="As etiquetas geradas aparecerão aqui."
            action={
              <button className="btn-primary btn" onClick={() => navigate('/products')}>
                <Tag className="w-4 h-4" /> Gerar Etiqueta
              </button>
            }
          />
        ) : (
          <>
            <div className="space-y-3">
              {filtered.map((label) => (
                <LabelCard key={label.id} label={label} onReprint={() => reprint(label)} />
              ))}
            </div>
            <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

// ── Label Card ───────────────────────────────────────────
function LabelCard({ label, onReprint }: { label: Label; onReprint: () => void }) {
  const now       = new Date(); now.setHours(0, 0, 0, 0);
  const discardD  = new Date(label.discardAt); discardD.setHours(0, 0, 0, 0);
  const daysLeft  = Math.round((discardD.getTime() - now.getTime()) / 86_400_000);
  const expired   = daysLeft < 0;
  const expiring  = !expired && daysLeft <= 2;

  return (
    <div className={cn(
      'card p-4 flex gap-4 items-start border-l-4',
      expired  ? 'border-l-red-500'   :
      expiring ? 'border-l-amber-500' :
                 'border-l-brand-600',
    )}>
      {/* Icon */}
      <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
        <Tag className="w-5 h-5 text-brand-700" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="font-semibold text-slate-900 text-sm">
              {label.product?.name ?? '—'}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {label.product?.brand} · Lote: <span className="font-medium">{label.lot}</span>
            </div>
          </div>
          <span className={cn(
            'badge',
            expired ? 'badge-expired' : expiring ? 'badge-expiring' : 'badge-valid',
          )}>
            {expired
              ? `Vencida há ${Math.abs(daysLeft)}d`
              : daysLeft === 0
              ? 'Vence hoje'
              : `${daysLeft}d restantes`}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 text-xs text-slate-500">
          <span>📦 Abertura: <strong className="text-slate-700">{formatBR(label.openedAt)}</strong></span>
          <span>🗑 Descarte: <strong className={cn(expired ? 'text-red-600' : 'text-slate-700')}>{formatBR(label.discardAt)}</strong></span>
          <span>{label.storageType === 'REFRIGERADO' ? '🌡' : '❄️'} {label.storageType.toLowerCase()}</span>
          <span>🖨 {label.printCount}x impresso</span>
          <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{label.shortCode}</span>
        </div>
      </div>

      {/* Actions */}
      <button className="btn-outline btn btn-sm flex-shrink-0" onClick={onReprint}>
        <Printer className="w-3.5 h-3.5" /> Reimprimir
      </button>
    </div>
  );
}

// ── Reprint HTML ─────────────────────────────────────────
function buildReprintHTML(label: Label, logoUrl: string | null): string {
  const logoHtml = logoUrl
    ? `<div style="text-align:center;padding:8px 0;border-bottom:1px solid #ccc;margin-bottom:10px">
         <img src="${logoUrl}" style="max-height:36px;object-fit:contain" />
       </div>`
    : '';

  return `
    <div class="print-label">
      <div style="background:#1a2332;color:#fff;padding:8px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Etiqueta de Identificação de Alimento</span>
        <span style="font-size:8pt;opacity:.7;font-family:monospace">Cód: ${label.shortCode}</span>
      </div>
      <div style="padding:12px 14px">
        ${logoHtml}
        <div style="font-size:16pt;font-weight:700;margin-bottom:2px">${label.product?.name ?? ''}</div>
        <div style="font-size:9pt;color:#555;margin-bottom:12px">Marca: ${label.product?.brand ?? ''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          ${[
            ['Lote',            label.lot],
            ['Data de abertura', formatBR(label.openedAt)],
            ['Armazenamento',   label.storageType === 'REFRIGERADO' ? 'Refrigerado' : 'Congelado'],
            ['Temperatura',     label.storageTemp],
          ].map(([l, v]) => `
            <div>
              <div style="font-size:7pt;font-weight:700;text-transform:uppercase;color:#888">${l}</div>
              <div style="font-size:11pt;font-weight:600">${v}</div>
            </div>`).join('')}
        </div>
        <div style="background:#dc2626;color:#fff;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-radius:4px">
          <span style="font-size:8pt;font-weight:700;text-transform:uppercase">⚠ Descartar em:</span>
          <span style="font-size:15pt;font-weight:800">${formatBR(label.discardAt)}</span>
        </div>
        <div style="border-top:1px solid #ccc;padding-top:8px">
          <div style="font-size:9pt;color:#555">Responsável pela manipulação:</div>
          <div style="border-bottom:1px solid #000;height:22px;margin:8px 0 4px"></div>
          <div style="font-size:8pt;text-align:center;color:#888">Assinatura do responsável</div>
        </div>
      </div>
    </div>`;
}

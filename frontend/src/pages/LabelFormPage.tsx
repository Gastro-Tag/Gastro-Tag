import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Printer, Tag, Upload, X } from 'lucide-react';
import { productApi, labelApi } from '@/services';
import type { Product, StorageType } from '@/types';
import { useToastContext } from '@/components/ui/Toast';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { formatBR, todayISO } from '@/utils/date';
import { extractError } from '@/services/api';
import { cn } from '@/utils/cn';

export function LabelFormPage() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const { toast }      = useToastContext();
  const printRef       = useRef<HTMLDivElement>(null);

  const productId = searchParams.get('productId') ?? '';

  const [product,     setProduct]     = useState<Product | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [logoUrl,     setLogoUrl]     = useState<string | null>(
    () => localStorage.getItem('gastrotag_logo'),
  );
  const [discardDate, setDiscardDate] = useState('');

  const [form, setForm] = useState({
    lot:         '',
    openedAt:    todayISO(),
    storageType: '' as StorageType | '',
    storageTemp: '',
  });

  // Load product
  useEffect(() => {
    if (!productId) { navigate('/products'); return; }
    productApi.getById(productId)
      .then((r) => {
        const p = r.data.data;
        setProduct(p);
        // auto-select first available storage
        if (p.daysValidRefrigerated > 0) setForm((f) => ({ ...f, storageType: 'REFRIGERADO' }));
        else if (p.daysValidFrozen > 0)  setForm((f) => ({ ...f, storageType: 'CONGELADO' }));
      })
      .catch(() => { toast('Produto não encontrado.', 'error'); navigate('/products'); })
      .finally(() => setLoading(false));
  }, [productId]);

  // Recalculate discard date when storage or openedAt changes
  useEffect(() => {
    if (!product || !form.openedAt || !form.storageType) { setDiscardDate(''); return; }
    const days =
      form.storageType === 'REFRIGERADO'
        ? product.daysValidRefrigerated
        : product.daysValidFrozen;
    if (!days) { setDiscardDate(''); return; }
    const [y, m, d] = form.openedAt.split('-').map(Number);
    const date = new Date(y, m - 1, d + days);
    setDiscardDate(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    );
  }, [form.openedAt, form.storageType, product]);

  function setField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.storageType || !discardDate) {
      toast('Selecione o tipo de armazenamento.', 'error'); return;
    }
    setSubmitting(true);
    try {
      const { data } = await labelApi.create({
        productId,
        lot:         form.lot,
        openedAt:    form.openedAt,
        storageType: form.storageType,
        storageTemp: form.storageTemp,
      });
      toast('Etiqueta gerada!', 'success');
      // Register print
      await labelApi.registerPrint(data.data.id);
      // Print
      doPrint(data.data.id, data.data.shortCode);
    } catch (err) {
      toast(extractError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function doPrint(labelId: string, code: string) {
    const el = document.getElementById('print-root');
    if (!el || !product) return;
    el.innerHTML = buildPrintHTML({ product, form, discardDate, logoUrl, code });
    window.print();
    el.innerHTML = '';
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('Logo muito grande. Máximo 2MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const url = reader.result as string;
      setLogoUrl(url);
      localStorage.setItem('gastrotag_logo', url);
      toast('Logo salvo.', 'success');
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    setLogoUrl(null);
    localStorage.removeItem('gastrotag_logo');
  }

  if (loading) return <PageLoader />;
  if (!product) return null;

  const storageOptions: { value: StorageType; label: string; days: number }[] = [
    product.daysValidRefrigerated > 0
      ? { value: 'REFRIGERADO', label: `🌡 Refrigerado (${product.daysValidRefrigerated} dias)`, days: product.daysValidRefrigerated }
      : null,
    product.daysValidFrozen > 0
      ? { value: 'CONGELADO', label: `❄️ Congelado (${product.daysValidFrozen} dias)`, days: product.daysValidFrozen }
      : null,
  ].filter(Boolean) as any[];

  return (
    <>
      {/* Hidden print target */}
      <div id="print-root" style={{ display: 'none' }} />

      <div className="max-w-5xl">
        {/* Header */}
        <div className="mb-6">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3">
            <ChevronLeft className="w-4 h-4" /> Voltar
          </button>
          <h1 className="page-title">Gerar Etiqueta</h1>
          <p className="page-subtitle">
            <span className="font-medium text-slate-700">{product.name}</span> · {product.brand}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Form ─────────────────────────────────── */}
          <div className="space-y-4">
            <form id="label-form" onSubmit={handleSubmit} className="space-y-4">

              <div className="card p-5 space-y-4">
                <p className="section-label">Dados da Etiqueta</p>

                <Field label="Número de lote" required>
                  <input value={form.lot} onChange={(e) => setField('lot', e.target.value)}
                    className="input" placeholder="Ex: L20260417" required />
                </Field>

                <Field label="Data de abertura" required>
                  <input type="date" value={form.openedAt}
                    onChange={(e) => setField('openedAt', e.target.value)}
                    className="input" required />
                </Field>

                <Field label="Tipo de armazenamento" required>
                  <div className="flex flex-col gap-2">
                    {storageOptions.map((opt) => (
                      <label
                        key={opt.value}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-lg border-2 cursor-pointer transition-all',
                          form.storageType === opt.value
                            ? 'border-brand-600 bg-brand-50 text-brand-800'
                            : 'border-slate-200 hover:border-slate-300',
                        )}
                      >
                        <input
                          type="radio" name="storageType" value={opt.value}
                          checked={form.storageType === opt.value}
                          onChange={() => setField('storageType', opt.value)}
                          className="accent-brand-700"
                        />
                        <span className="text-sm font-medium">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </Field>

                <Field label="Temperatura de armazenamento" required>
                  <input value={form.storageTemp} onChange={(e) => setField('storageTemp', e.target.value)}
                    className="input" placeholder="Ex: 2°C a 8°C" required />
                </Field>
              </div>

              {/* Calculated discard */}
              {discardDate && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-1">
                    📅 Descartar em:
                  </div>
                  <div className="text-3xl font-bold text-emerald-900">{formatBR(discardDate)}</div>
                </div>
              )}
            </form>

            {/* Logo upload */}
            <div className="card p-5">
              <p className="section-label">Logo Institucional</p>
              {logoUrl ? (
                <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <img src={logoUrl} alt="Logo" className="max-h-12 object-contain" />
                  <button onClick={removeLogo} className="btn-ghost btn btn-sm text-red-500 ml-auto">
                    <X className="w-4 h-4" /> Remover
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-2 p-5 border-2 border-dashed border-slate-300
                                  rounded-lg cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-all">
                  <Upload className="w-6 h-6 text-slate-400" />
                  <span className="text-sm text-slate-500">Clique para fazer upload do logo</span>
                  <span className="text-xs text-slate-400">PNG, JPG ou SVG — máx. 2MB</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </label>
              )}
            </div>

            <button type="submit" form="label-form" disabled={submitting || !discardDate}
              className="btn-primary btn btn-lg w-full">
              {submitting
                ? <Spinner size="sm" className="text-white" />
                : <Printer className="w-4 h-4" />}
              Gerar e Imprimir Etiqueta
            </button>
          </div>

          {/* ── Preview ──────────────────────────────── */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Prévia da etiqueta</p>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 bg-slate-50">
              <LabelPreview
                product={product}
                lot={form.lot}
                openedAt={form.openedAt}
                storageType={form.storageType}
                storageTemp={form.storageTemp}
                discardDate={discardDate}
                logoUrl={logoUrl}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Label Preview Component ───────────────────────────────
function LabelPreview({ product, lot, openedAt, storageType, storageTemp, discardDate, logoUrl }: {
  product: Product; lot: string; openedAt: string;
  storageType: string; storageTemp: string;
  discardDate: string; logoUrl: string | null;
}) {
  return (
    <div className="border-2 border-slate-800 rounded-md bg-white text-sm font-sans overflow-hidden">
      {/* Header bar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
        <span className="text-xs font-bold uppercase tracking-wide">Etiqueta de Identificação</span>
        <span className="text-[10px] text-slate-400 font-mono">PRÉVIA</span>
      </div>

      <div className="p-4 space-y-3">
        {/* Logo */}
        {logoUrl && (
          <div className="flex justify-center pb-2 border-b border-slate-200">
            <img src={logoUrl} alt="Logo" className="max-h-10 object-contain" />
          </div>
        )}

        {/* Product */}
        <div>
          <div className="text-base font-bold text-slate-900">{product.name || '—'}</div>
          <div className="text-xs text-slate-500">Marca: {product.brand}</div>
        </div>

        {/* Grid fields */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { l: 'Lote',            v: lot || '___' },
            { l: 'Data abertura',   v: formatBR(openedAt) },
            { l: 'Armazenamento',   v: storageType === 'REFRIGERADO' ? '🌡 Refrigerado' : storageType === 'CONGELADO' ? '❄️ Congelado' : '—' },
            { l: 'Temperatura',     v: storageTemp || '___' },
          ].map(({ l, v }) => (
            <div key={l}>
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{l}</div>
              <div className="text-xs font-semibold text-slate-800">{v}</div>
            </div>
          ))}
        </div>

        {/* Discard */}
        <div className="bg-red-600 text-white rounded-md px-3 py-2 flex justify-between items-center">
          <span className="text-[10px] font-bold uppercase tracking-wide opacity-90">⚠ Descartar em:</span>
          <span className="text-base font-extrabold">{discardDate ? formatBR(discardDate) : '___________'}</span>
        </div>

        {/* Signature */}
        <div className="border-t border-slate-200 pt-2.5">
          <div className="text-[10px] text-slate-500 mb-1">Responsável pela manipulação:</div>
          <div className="border-b border-slate-800 h-6 mb-1" />
          <div className="text-[9px] text-center text-slate-400">Assinatura do responsável</div>
        </div>
      </div>
    </div>
  );
}

// ── Print HTML builder ────────────────────────────────────
function buildPrintHTML({ product, form, discardDate, logoUrl, code }: {
  product: Product; form: any; discardDate: string;
  logoUrl: string | null; code: string;
}): string {
  const logoHtml = logoUrl
    ? `<div style="text-align:center;padding:8px 0;border-bottom:1px solid #ccc;margin-bottom:10px">
         <img src="${logoUrl}" style="max-height:36px;object-fit:contain" />
       </div>`
    : '';

  return `
    <div class="print-label">
      <div style="background:#1a2332;color:#fff;padding:8px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Etiqueta de Identificação de Alimento</span>
        <span style="font-size:8pt;opacity:.7;font-family:monospace">Cód: ${code}</span>
      </div>
      <div style="padding:12px 14px">
        ${logoHtml}
        <div style="font-size:16pt;font-weight:700;margin-bottom:2px">${product.name}</div>
        <div style="font-size:9pt;color:#555;margin-bottom:12px">Marca: ${product.brand}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          ${[
            ['Lote', form.lot],
            ['Data de abertura', formatBR(form.openedAt)],
            ['Armazenamento', form.storageType === 'REFRIGERADO' ? 'Refrigerado' : 'Congelado'],
            ['Temperatura', form.storageTemp],
          ].map(([l, v]) => `
            <div>
              <div style="font-size:7pt;font-weight:700;text-transform:uppercase;color:#888">${l}</div>
              <div style="font-size:11pt;font-weight:600">${v}</div>
            </div>`).join('')}
        </div>
        <div style="background:#dc2626;color:#fff;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-radius:4px">
          <span style="font-size:8pt;font-weight:700;text-transform:uppercase">⚠ Descartar em:</span>
          <span style="font-size:15pt;font-weight:800">${formatBR(discardDate)}</span>
        </div>
        <div style="border-top:1px solid #ccc;padding-top:8px">
          <div style="font-size:9pt;color:#555">Responsável pela manipulação:</div>
          <div style="border-bottom:1px solid #000;height:22px;margin:8px 0 4px"></div>
          <div style="font-size:8pt;text-align:center;color:#888">Assinatura do responsável</div>
        </div>
      </div>
    </div>`;
}

function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

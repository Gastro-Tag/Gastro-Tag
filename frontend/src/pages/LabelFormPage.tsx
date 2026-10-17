import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Printer, Tag, Upload, X,
  Refrigerator, Snowflake, CheckCircle2, User, Hash, Calendar, Thermometer
} from 'lucide-react';
import { productApi, labelApi } from '@/services';
import type { LabelPreview, Product, StorageType } from '@/types';
import { useToastContext } from '@/components/ui/Toast';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { formatBR, todayISO } from '@/utils/date';
import { extractError } from '@/services/api';
import { cn } from '@/utils/cn';
import { printLabel } from '@/utils/printLabel';

export function LabelFormPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToastContext();
  const productId = searchParams.get('productId') ?? '';

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<(LabelPreview & { requestKey: string }) | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(() => localStorage.getItem('gastrotag_logo'));
  const [form, setForm] = useState({
    lot: '', responsibleName: '', openedAt: todayISO(), storageType: '' as StorageType | '', storageTemp: '',
  });

  useEffect(() => {
    if (!productId) { navigate('/products', { replace: true }); return; }
    let active = true;
    productApi.getById(productId)
      .then(({ data }) => {
        if (!active) return;
        const nextProduct = data.data;
        setProduct(nextProduct);
        if (nextProduct.daysValidRefrigerated > 0) {
          setForm((value) => ({ ...value, storageType: 'REFRIGERADO', storageTemp: '4 °C' }));
        } else if (nextProduct.daysValidFrozen > 0) {
          setForm((value) => ({ ...value, storageType: 'CONGELADO', storageTemp: '-18 °C' }));
        }
      })
      .catch(() => {
        if (active) { toast('Produto não encontrado.', 'error'); navigate('/products', { replace: true }); }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, navigate, toast]);

  const requestKey = useMemo(() => JSON.stringify([
    productId, form.openedAt, form.storageType, form.storageTemp.trim(),
  ]), [productId, form.openedAt, form.storageType, form.storageTemp]);
  const previewReady = Boolean(form.storageType && form.storageTemp.trim());
  const previewMatchesForm = preview?.requestKey === requestKey;

  useEffect(() => {
    if (!product || !previewReady) {
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const { data } = await labelApi.preview({
          productId, openedAt: form.openedAt,
          storageType: form.storageType as StorageType,
          storageTemp: form.storageTemp.trim(),
        });
        if (active) setPreview({ ...data.data, requestKey });
      } catch (error) {
        if (active) { setPreview(null); setPreviewError(extractError(error)); }
      } finally {
        if (active) setPreviewLoading(false);
      }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [product, productId, form.openedAt, form.storageType, form.storageTemp, previewReady, requestKey]);

  function setField(field: 'lot' | 'responsibleName' | 'openedAt' | 'storageType' | 'storageTemp', value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.storageType || !previewMatchesForm) return;
    setSubmitting(true);
    let createdLabel: import('@/types').Label | null = null;
    try {
      const { data } = await labelApi.create({
        productId,
        lot: form.lot.trim(),
        responsibleName: form.responsibleName.trim(),
        openedAt: form.openedAt,
        storageType: form.storageType,
        storageTemp: form.storageTemp.trim(),
      });
      createdLabel = data.data;
      printLabel(createdLabel, logoUrl);
      try {
        await labelApi.registerPrint(createdLabel.id);
        toast('Etiqueta gerada e impressão enviada!', 'success');
      } catch {
        toast('Etiqueta gerada. Falha ao atualizar contador de impressão.', 'warning');
      }
      navigate('/labels');
    } catch (error) {
      toast(createdLabel
        ? 'Etiqueta criada, mas ocorreu um erro na impressão. Ela está salva no histórico.'
        : extractError(error), 'error');
      if (createdLabel) navigate('/labels');
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast('Envie um arquivo PNG, JPG ou WebP.', 'error'); return;
    }
    if (file.size > 2 * 1024 * 1024) { toast('Tamanho máximo permitido: 2 MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = reader.result as string;
      setLogoUrl(value);
      localStorage.setItem('gastrotag_logo', value);
      toast('Logo institucional salvo.', 'success');
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    setLogoUrl(null);
    localStorage.removeItem('gastrotag_logo');
  }

  if (loading) return <PageLoader />;
  if (!product) return null;

  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-charcoal-800 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Produtos</span>
        </button>
        <h1 className="page-title">Gerar Etiqueta Sanitária</h1>
        <p className="page-subtitle">
          Alimento: <strong className="text-charcoal-800">{product.name}</strong> • Marca: {product.brand}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">

        {/* Left: Input Form */}
        <div className="lg:col-span-7 space-y-6">
          <form id="label-form" onSubmit={handleSubmit} className="card p-6 sm:p-7 space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <div className="w-7 h-7 rounded-lg bg-orange-50 text-brand-600 flex items-center justify-center">
                <Tag className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider">
                Dados da Manipulação
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Número do Lote" required>
                <div className="relative">
                  <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={form.lot}
                    onChange={(e) => setField('lot', e.target.value)}
                    className="input pl-10"
                    placeholder="Ex: LOTE-2026-10"
                    required
                    maxLength={60}
                  />
                </div>
              </Field>

              <Field label="Responsável pela Manipulação" required>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={form.responsibleName}
                    onChange={(e) => setField('responsibleName', e.target.value)}
                    className="input pl-10"
                    placeholder="Nome completo do manipulador"
                    required
                    maxLength={100}
                  />
                </div>
              </Field>
            </div>

            <Field label="Data de Abertura / Preparo" required>
              <div className="relative max-w-sm">
                <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="date"
                  value={form.openedAt}
                  onChange={(e) => setField('openedAt', e.target.value)}
                  className="input pl-10"
                  required
                />
              </div>
            </Field>

            <Field label="Condição de Armazenamento" required>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1.5">
                <label className={cn(
                  'flex items-center gap-3 p-3.5 rounded-2xl border-2 cursor-pointer transition-all',
                  form.storageType === 'REFRIGERADO'
                    ? 'border-brand-500 bg-orange-50/40 text-charcoal-800 shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600'
                )}>
                  <input
                    type="radio"
                    name="storageType"
                    value="REFRIGERADO"
                    checked={form.storageType === 'REFRIGERADO'}
                    onChange={() => {
                      setField('storageType', 'REFRIGERADO');
                      if (!form.storageTemp) setField('storageTemp', '4 °C');
                    }}
                    className="accent-brand-600"
                  />
                  <Refrigerator className="w-5 h-5 text-sky-600 shrink-0" />
                  <div>
                    <span className="text-xs font-bold block">Refrigerado</span>
                    <span className="text-[11px] text-slate-400">Padronizado ~4 °C</span>
                  </div>
                </label>

                <label className={cn(
                  'flex items-center gap-3 p-3.5 rounded-2xl border-2 cursor-pointer transition-all',
                  form.storageType === 'CONGELADO'
                    ? 'border-brand-500 bg-orange-50/40 text-charcoal-800 shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600'
                )}>
                  <input
                    type="radio"
                    name="storageType"
                    value="CONGELADO"
                    checked={form.storageType === 'CONGELADO'}
                    onChange={() => {
                      setField('storageType', 'CONGELADO');
                      if (!form.storageTemp) setField('storageTemp', '-18 °C');
                    }}
                    className="accent-brand-600"
                  />
                  <Snowflake className="w-5 h-5 text-indigo-600 shrink-0" />
                  <div>
                    <span className="text-xs font-bold block">Congelado</span>
                    <span className="text-[11px] text-slate-400">Padronizado ~ -18 °C</span>
                  </div>
                </label>
              </div>
            </Field>

            <Field label="Temperatura Registrada no Ponto" required>
              <div className="relative max-w-sm">
                <Thermometer className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={form.storageTemp}
                  onChange={(e) => setField('storageTemp', e.target.value)}
                  className="input pl-10"
                  placeholder="Ex: 4 °C ou -18 °C"
                  required
                  maxLength={40}
                />
              </div>
            </Field>
          </form>

          {/* Logo Customizer */}
          <div className="card p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-100 mb-3">
              Identificação do Estabelecimento
            </p>
            {logoUrl ? (
              <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-slate-200 bg-slate-50">
                <img src={logoUrl} alt="Logo Cozinha" className="max-h-10 object-contain" />
                <button
                  type="button"
                  onClick={removeLogo}
                  className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                >
                  <X className="h-4 w-4" />
                  <span>Remover logo customizado</span>
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-between p-3.5 rounded-xl border-2 border-dashed border-slate-200 hover:border-brand-500 hover:bg-orange-50/30 transition-all">
                <div className="flex items-center gap-3">
                  <Upload className="w-5 h-5 text-slate-400" />
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">Personalizar Logo da Cozinha</span>
                    <span className="text-[11px] text-slate-400">Padrão: Logo Oficial GastroTag (PNG, JPG até 2 MB)</span>
                  </div>
                </div>
                <span className="btn btn-outline btn-sm">Selecionar</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoUpload} />
              </label>
            )}
          </div>

          <button
            type="submit"
            form="label-form"
            disabled={submitting || !previewMatchesForm || previewLoading}
            className="btn btn-accent w-full py-3.5 text-sm font-bold shadow-md"
          >
            {submitting || previewLoading ? (
              <Spinner size="sm" className="text-white" />
            ) : (
              <>
                <Printer className="h-4 w-4" />
                <span>Gerar e Imprimir Etiqueta Sanitária</span>
              </>
            )}
          </button>
        </div>

        {/* Right: Real-time Label Preview */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Pré-Visualização em Tempo Real
            </p>
            {preview && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                <CheckCircle2 className="w-3 h-3" />
                <span>Cálculo Sanitário Ativo</span>
              </span>
            )}
          </div>

          {previewError && (
            <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium">
              {previewError}
            </div>
          )}

          <div className="p-6 rounded-3xl border-2 border-dashed border-slate-200 bg-slate-100/60 flex justify-center">
            <LabelPreviewCard
              product={product}
              lot={form.lot}
              responsibleName={form.responsibleName}
              openedAt={form.openedAt}
              storageType={form.storageType}
              storageTemp={form.storageTemp}
              preview={previewMatchesForm ? preview : null}
              previewLoading={previewLoading}
              logoUrl={logoUrl || '/logo.png'}
            />
          </div>

          {previewMatchesForm && preview?.cappedByOriginalExpiry && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Regra de Teto Sanitário:</strong> O prazo calculado foi limitado pela data de validade original do fabricante ({formatBR(preview.originalExpiryDate)}).
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Preview Card Component ─────────────────────────────
function LabelPreviewCard({
  product, lot, responsibleName, openedAt, storageType, storageTemp, preview, previewLoading, logoUrl
}: {
  product: Product;
  lot: string;
  responsibleName: string;
  openedAt: string;
  storageType: StorageType | '';
  storageTemp: string;
  preview: LabelPreview | null;
  previewLoading: boolean;
  logoUrl: string | null;
}) {
  return (
    <div className="w-full max-w-[340px] bg-white rounded-2xl border-2 border-charcoal-800 shadow-card-lg overflow-hidden text-slate-900 font-sans text-xs">
      {/* Header */}
      <div className="bg-charcoal-800 px-4 py-2.5 text-white flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-[11px] font-extrabold uppercase tracking-wider">Identificação Sanitária</span>
        </div>
        <span className="font-mono text-[9px] text-slate-300 font-bold bg-slate-700/60 px-1.5 py-0.5 rounded">
          PRÉVIA
        </span>
      </div>

      <div className="p-4 space-y-3.5">
        {/* Logo */}
        <div className="flex justify-center border-b border-slate-100 pb-2.5">
          <img src={logoUrl || '/logo.png'} alt="GastroTag" className="max-h-8 object-contain" />
        </div>

        {/* Product Details */}
        <div>
          <h3 className="font-extrabold text-sm text-charcoal-800 leading-tight">{product.name}</h3>
          <p className="text-[11px] text-slate-500 font-medium">Marca: {product.brand}</p>
        </div>

        {/* Grid info */}
        <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div>
            <span className="text-[9px] font-bold uppercase text-slate-400 block">Lote</span>
            <span className="text-xs font-bold text-charcoal-800 truncate block">{lot || '—'}</span>
          </div>
          <div>
            <span className="text-[9px] font-bold uppercase text-slate-400 block">Data Abertura</span>
            <span className="text-xs font-bold text-charcoal-800 block">{formatBR(openedAt)}</span>
          </div>
          <div>
            <span className="text-[9px] font-bold uppercase text-slate-400 block">Armazenamento</span>
            <span className="text-xs font-bold text-charcoal-800 block">
              {storageType === 'REFRIGERADO' ? 'Refrigerado' : storageType === 'CONGELADO' ? 'Congelado' : '—'}
            </span>
          </div>
          <div>
            <span className="text-[9px] font-bold uppercase text-slate-400 block">Temperatura</span>
            <span className="text-xs font-bold text-charcoal-800 block">{storageTemp || '—'}</span>
          </div>
        </div>

        {/* Big Discard Banner */}
        <div className="bg-brand-600 rounded-xl p-3 text-white flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-wider opacity-90 block">Data de Descarte</span>
            <span className="text-sm font-extrabold tracking-tight">
              {preview ? formatBR(preview.discardAt) : previewLoading ? 'Calculando...' : 'Preencha dados'}
            </span>
          </div>
          <span className="text-[10px] font-bold bg-black/20 px-2 py-1 rounded-md">
            {preview ? `${preview.rule.shelfLifeDays} dias` : '—'}
          </span>
        </div>

        {preview && (
          <div className="text-[10px] text-slate-500 font-medium">
            Fonte: {preview.rule.source}
          </div>
        )}

        {/* Signature & Responsible */}
        <div className="pt-2 border-t border-slate-100">
          <div className="text-[10px] text-slate-500 mb-0.5">
            Responsável: <strong className="text-charcoal-800">{responsibleName || '—'}</strong>
          </div>
          <div className="h-5 border-b border-slate-300" />
          <div className="text-center text-[8px] text-slate-400 mt-0.5 uppercase tracking-wide">
            Assinatura do Manipulador
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

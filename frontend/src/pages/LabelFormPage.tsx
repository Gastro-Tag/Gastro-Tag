import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, Printer, Tag, Upload, X } from 'lucide-react';
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
        if (nextProduct.daysValidRefrigerated > 0) setForm((value) => ({ ...value, storageType: 'REFRIGERADO' }));
        else if (nextProduct.daysValidFrozen > 0) setForm((value) => ({ ...value, storageType: 'CONGELADO' }));
      })
      .catch(() => { if (active) { toast('Produto não encontrado.', 'error'); navigate('/products', { replace: true }); } })
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
    }, 350);
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
        productId, lot: form.lot.trim(), responsibleName: form.responsibleName.trim(), openedAt: form.openedAt,
        storageType: form.storageType, storageTemp: form.storageTemp.trim(),
      });
      createdLabel = data.data;
      printLabel(createdLabel, logoUrl);
      try {
        await labelApi.registerPrint(createdLabel.id);
        toast('Etiqueta gerada e impressão registrada.', 'success');
      } catch {
        toast('Etiqueta gerada. Não foi possível registrar a impressão.', 'warning');
      }
      navigate('/labels');
    } catch (error) {
      toast(createdLabel
        ? 'Etiqueta criada, mas ocorreu um erro na impressão. Ela está no histórico para reimprimir.'
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
      toast('Use uma imagem PNG, JPG ou WebP.', 'error'); return;
    }
    if (file.size > 2 * 1024 * 1024) { toast('Logo muito grande. Máximo 2 MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = reader.result as string;
      setLogoUrl(value);
      localStorage.setItem('gastrotag_logo', value);
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

  const storageOptions: { value: StorageType; label: string }[] = [
    { value: 'REFRIGERADO', label: 'Refrigerado' },
    { value: 'CONGELADO', label: 'Congelado' },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <button onClick={() => navigate(-1)} className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ChevronLeft className="h-4 w-4" /> Voltar
        </button>
        <h1 className="page-title">Gerar Etiqueta</h1>
        <p className="page-subtitle"><span className="font-medium text-slate-700">{product.name}</span> · {product.brand}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <form id="label-form" onSubmit={handleSubmit} className="card space-y-4 p-5">
            <p className="section-label">Dados da etiqueta</p>
            <Field label="Número do lote" required>
              <input value={form.lot} onChange={(event) => setField('lot', event.target.value)} className="input" placeholder="Ex.: L20260417" required maxLength={60} />
            </Field>
            <Field label="Nome do responsável pela manipulação" required>
              <input value={form.responsibleName} onChange={(event) => setField('responsibleName', event.target.value)} className="input" placeholder="Nome completo" required maxLength={100} autoComplete="name" />
            </Field>
            <Field label="Data de abertura" required>
              <input type="date" value={form.openedAt} onChange={(event) => setField('openedAt', event.target.value)} className="input" required />
            </Field>
            <Field label="Tipo de armazenamento" required>
              <div className="flex flex-col gap-2">
                {storageOptions.map((option) => (
                  <label key={option.value} className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border-2 px-4 py-3 transition-all',
                    form.storageType === option.value ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 hover:border-slate-300',
                  )}>
                    <input type="radio" name="storageType" value={option.value} checked={form.storageType === option.value} onChange={() => setField('storageType', option.value)} className="accent-brand-700" />
                    <span className="text-sm font-medium">{option.label}</span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Temperatura de armazenamento" required>
              <input value={form.storageTemp} onChange={(event) => setField('storageTemp', event.target.value)} className="input" placeholder="Ex.: 4 °C" required maxLength={40} />
            </Field>
          </form>

          <div className="card p-5">
            <p className="section-label">Logo institucional</p>
            {logoUrl ? (
              <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <img src={logoUrl} alt="Logo" className="max-h-12 object-contain" />
                <button type="button" onClick={removeLogo} className="btn-ghost btn btn-sm ml-auto text-red-500"><X className="h-4 w-4" /> Remover</button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-5 transition-all hover:border-brand-500 hover:bg-brand-50">
                <Upload className="h-6 w-6 text-slate-400" />
                <span className="text-sm text-slate-500">Enviar logo</span>
                <span className="text-xs text-slate-400">PNG, JPG ou WebP · máx. 2 MB</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoUpload} />
              </label>
            )}
          </div>

          <button type="submit" form="label-form" disabled={submitting || !previewMatchesForm || previewLoading} className="btn-primary btn btn-lg w-full">
            {submitting || previewLoading ? <Spinner size="sm" className="text-white" /> : <Printer className="h-4 w-4" />}
            Gerar e imprimir etiqueta
          </button>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Prévia da etiqueta</p>
          {previewError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{previewError}</p>}
          {!previewReady && <p className="mb-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-500">Informe o armazenamento e a temperatura para calcular a data de descarte.</p>}
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-5">
            <LabelPreview product={product} lot={form.lot} responsibleName={form.responsibleName} openedAt={form.openedAt} storageType={form.storageType} storageTemp={form.storageTemp} preview={previewMatchesForm ? preview : null} previewLoading={previewLoading} logoUrl={logoUrl} />
          </div>
          {previewMatchesForm && preview?.cappedByOriginalExpiry && (
            <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="h-5 w-5 shrink-0" /> O prazo calculado foi limitado pela validade original do fabricante ({formatBR(preview.originalExpiryDate)}).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LabelPreview({ product, lot, responsibleName, openedAt, storageType, storageTemp, preview, previewLoading, logoUrl }: {
  product: Product; lot: string; responsibleName: string; openedAt: string; storageType: StorageType | ''; storageTemp: string;
  preview: LabelPreview | null; previewLoading: boolean; logoUrl: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-md border-2 border-slate-800 bg-white font-sans text-sm">
      <div className="flex items-center justify-between bg-slate-800 px-4 py-2.5 text-white">
        <span className="text-xs font-bold uppercase tracking-wide">Etiqueta de identificação</span>
        <span className="font-mono text-[10px] text-slate-400">PRÉVIA</span>
      </div>
      <div className="space-y-3 p-4">
        {logoUrl && <div className="flex justify-center border-b border-slate-200 pb-2"><img src={logoUrl} alt="Logo" className="max-h-10 object-contain" /></div>}
        <div><div className="text-base font-bold text-slate-900">{product.name}</div><div className="text-xs text-slate-500">Marca: {product.brand}</div></div>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'Lote', value: lot || '—' }, { label: 'Data de abertura', value: formatBR(openedAt) },
            { label: 'Armazenamento', value: storageType === 'REFRIGERADO' ? 'Refrigerado' : storageType === 'CONGELADO' ? 'Congelado' : '—' },
            { label: 'Temperatura', value: storageTemp || '—' },
          ].map((field) => <div key={field.label}><div className="text-[9px] font-bold uppercase text-slate-400">{field.label}</div><div className="text-xs font-semibold text-slate-800">{field.value}</div></div>)}
        </div>
        <div className="flex items-center justify-between rounded-md bg-red-600 px-3 py-2 text-white">
          <span className="text-[10px] font-bold uppercase">Descartar em</span>
          <span className="text-base font-extrabold">{preview ? formatBR(preview.discardAt) : previewLoading ? 'Calculando…' : '—'}</span>
        </div>
        {preview && <div className="text-[10px] text-slate-500">Prazo: {preview.rule.shelfLifeDays} dias · Fonte: {preview.rule.source}</div>}
        {preview?.cappedByOriginalExpiry && <div className="text-[10px] font-semibold text-amber-800">Limitado pela validade original do fabricante.</div>}
        <div className="border-t border-slate-200 pt-2.5"><div className="mb-1 text-[10px] text-slate-500">Responsável pela manipulação:</div><div className="mb-1 min-h-6 border-b border-slate-800 text-xs font-semibold text-slate-800">{responsibleName || '—'}</div><div className="text-center text-[9px] text-slate-400">Assinatura do responsável</div></div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-sm font-medium text-slate-700">{label} {required && <span className="text-red-500">*</span>}</label>{children}</div>;
}

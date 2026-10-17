import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle, Refrigerator, Snowflake, FileText, Package } from 'lucide-react';
import { productApi } from '@/services';
import { useToastContext } from '@/components/ui/Toast';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { extractError } from '@/services/api';
import { todayISO } from '@/utils/date';

export function ProductFormPage() {
  const { id }   = useParams<{ id: string }>();
  const isEdit   = !!id;
  const navigate = useNavigate();
  const { toast } = useToastContext();

  const [loading,    setLoading]    = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name:                  '',
    brand:                 '',
    category:              '',
    originalExpiryDate:    todayISO(),
    daysValidRefrigerated: '',
    daysValidFrozen:       '',
    unit:                  '',
    notes:                 '',
  });

  // Load for edit
  useEffect(() => {
    if (!isEdit) return;
    productApi.getById(id).then((r) => {
      const p = r.data.data;
      setForm({
        name:                  p.name,
        brand:                 p.brand,
        category:              p.category ?? '',
        originalExpiryDate:    p.originalExpiryDate.split('T')[0],
        daysValidRefrigerated: String(p.daysValidRefrigerated),
        daysValidFrozen:       String(p.daysValidFrozen),
        unit:                  p.unit ?? '',
        notes:                 p.notes ?? '',
      });
    }).finally(() => setLoading(false));
  }, [id, isEdit]);

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const ref  = Number(form.daysValidRefrigerated) || 0;
    const cong = Number(form.daysValidFrozen) || 0;
    if (!ref && !cong) {
      toast('Informe ao menos um tipo de validade pós-abertura (Refrigerado ou Congelado).', 'error');
      return;
    }

    const payload = {
      name:                  form.name,
      brand:                 form.brand,
      category:              form.category || undefined,
      originalExpiryDate:    form.originalExpiryDate,
      daysValidRefrigerated: ref,
      daysValidFrozen:       cong,
      unit:                  form.unit || undefined,
      notes:                 form.notes || undefined,
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        await productApi.update(id, payload);
        toast('Produto atualizado com sucesso!', 'success');
      } else {
        await productApi.create(payload);
        toast('Produto cadastrado com sucesso!', 'success');
      }
      navigate('/products');
    } catch (err) {
      toast(extractError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-charcoal-800 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Produtos</span>
        </button>
        <h1 className="page-title">{isEdit ? 'Editar Alimento' : 'Novo Alimento'}</h1>
        <p className="page-subtitle">Preencha as informações do produto e suas regras de descarte após abertura.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Basic Info */}
        <div className="card space-y-5 p-5 sm:p-7">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <div className="w-7 h-7 rounded-lg bg-orange-50 text-brand-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider">
              Identificação do Produto
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nome do Alimento" required>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className="input"
                placeholder="Ex: Leite Integral Pasteurizado"
                required
              />
            </Field>

            <Field label="Marca / Fornecedor" required>
              <input
                value={form.brand}
                onChange={(e) => set('brand', e.target.value)}
                className="input"
                placeholder="Ex: Fazenda Bela Vista"
                required
              />
            </Field>

            <Field label="Categoria">
              <input
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                className="input"
                placeholder="Ex: Laticínios, Carnes, Molhos"
              />
            </Field>

            <Field label="Unidade de Medida">
              <input
                value={form.unit}
                onChange={(e) => set('unit', e.target.value)}
                className="input"
                placeholder="Ex: Litros (L), kg, pct"
              />
            </Field>
          </div>

          <Field label="Validade Original da Embalagem Fechada" required>
            <input
              type="date"
              value={form.originalExpiryDate}
              onChange={(e) => set('originalExpiryDate', e.target.value)}
              className="input max-w-sm"
              required
            />
            <p className="text-xs text-slate-400 mt-1 font-medium">
              Data de validade impressa na embalagem pelo fabricante industrial.
            </p>
          </Field>
        </div>

        {/* Storage Rule */}
        <div className="card space-y-5 p-5 sm:p-7">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <div className="w-7 h-7 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
              <Refrigerator className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider">
              Regra Sanitária Pós-Abertura
            </h2>
          </div>

          <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Preencha ao menos uma condição. Esses prazos alimentam o cálculo automático da data de descarte no momento da rotulagem.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Refrigerado (dias pós-abertura)">
              <div className="relative">
                <Refrigerator className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sky-600" />
                <input
                  type="number"
                  min="0"
                  max="365"
                  value={form.daysValidRefrigerated}
                  onChange={(e) => set('daysValidRefrigerated', e.target.value)}
                  className="input pl-10"
                  placeholder="Ex: 3"
                />
              </div>
              <p className="text-xs text-slate-400 mt-1 font-medium">
                Prazo máximo sob refrigeração (4 °C).
              </p>
            </Field>

            <Field label="Congelado (dias pós-abertura)">
              <div className="relative">
                <Snowflake className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-600" />
                <input
                  type="number"
                  min="0"
                  max="1095"
                  value={form.daysValidFrozen}
                  onChange={(e) => set('daysValidFrozen', e.target.value)}
                  className="input pl-10"
                  placeholder="Ex: 30"
                />
              </div>
              <p className="text-xs text-slate-400 mt-1 font-medium">
                Prazo máximo em freezer (-18 °C).
              </p>
            </Field>
          </div>
        </div>

        {/* Notes */}
        <div className="card space-y-4 p-5 sm:p-7">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider">
              Instruções e Observações Técnicas
            </h2>
          </div>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            className="input resize-none"
            placeholder="Instruções de manuseio, alérgenos ou cuidados de temperatura na bancada..."
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary px-6 py-3"
          >
            {submitting ? <Spinner size="sm" className="text-white" /> : <Save className="w-4 h-4 text-brand-400" />}
            <span>{isEdit ? 'Salvar Alterações' : 'Cadastrar Alimento'}</span>
          </button>
          <button
            type="button"
            className="btn btn-outline px-5 py-3"
            onClick={() => navigate(-1)}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────
function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

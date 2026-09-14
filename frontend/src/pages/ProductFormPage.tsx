import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Save } from 'lucide-react';
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
      toast('Informe ao menos um tipo de validade pós-abertura.', 'error');
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
        toast('Produto atualizado!', 'success');
      } else {
        await productApi.create(payload);
        toast('Produto cadastrado!', 'success');
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
    <div className="max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ChevronLeft className="w-4 h-4" /> Voltar
        </button>
        <h1 className="page-title">{isEdit ? 'Editar Produto' : 'Novo Produto'}</h1>
        <p className="page-subtitle">Preencha as informações do produto e suas regras de validade.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Basic Info */}
        <div className="card p-6 space-y-4">
          <p className="section-label">Informações básicas</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nome do produto" required>
              <input value={form.name} onChange={(e) => set('name', e.target.value)}
                className="input" placeholder="Ex: Leite Integral" required />
            </Field>
            <Field label="Marca" required>
              <input value={form.brand} onChange={(e) => set('brand', e.target.value)}
                className="input" placeholder="Ex: Nestlé" required />
            </Field>
            <Field label="Categoria">
              <input value={form.category} onChange={(e) => set('category', e.target.value)}
                className="input" placeholder="Ex: Laticínios" />
            </Field>
            <Field label="Unidade">
              <input value={form.unit} onChange={(e) => set('unit', e.target.value)}
                className="input" placeholder="Ex: L, kg, un" />
            </Field>
          </div>

          <Field label="Validade original (na embalagem)" required>
            <input type="date" value={form.originalExpiryDate}
              onChange={(e) => set('originalExpiryDate', e.target.value)}
              className="input" required />
            <p className="text-xs text-slate-400 mt-1">Data impressa na embalagem pelo fabricante.</p>
          </Field>
        </div>

        {/* Storage */}
        <div className="card p-6 space-y-4">
          <p className="section-label">Validade pós-abertura</p>

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex gap-2">
            <span>⚠️</span>
            <span>Preencha ao menos um tipo. Esses valores definem a data de descarte calculada nas etiquetas.</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="🌡 Refrigerado (dias)">
              <input type="number" min="0" max="365"
                value={form.daysValidRefrigerated}
                onChange={(e) => set('daysValidRefrigerated', e.target.value)}
                className="input" placeholder="Ex: 3" />
              <p className="text-xs text-slate-400 mt-1">Dias de validade após abertura na geladeira.</p>
            </Field>
            <Field label="❄️ Congelado (dias)">
              <input type="number" min="0" max="1095"
                value={form.daysValidFrozen}
                onChange={(e) => set('daysValidFrozen', e.target.value)}
                className="input" placeholder="Ex: 30" />
              <p className="text-xs text-slate-400 mt-1">Dias de validade após abertura no freezer.</p>
            </Field>
          </div>
        </div>

        {/* Notes */}
        <div className="card p-6">
          <p className="section-label">Observações</p>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            className="input resize-none"
            placeholder="Informações adicionais sobre o produto…"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button type="submit" disabled={submitting} className="btn-primary btn btn-lg">
            {submitting ? <Spinner size="sm" className="text-white" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Salvar alterações' : 'Cadastrar Produto'}
          </button>
          <button type="button" className="btn-outline btn btn-lg" onClick={() => navigate(-1)}>
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
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

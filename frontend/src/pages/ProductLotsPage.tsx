import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { ArrowLeft, Boxes, Edit2, Plus, Save, X } from 'lucide-react';
import { lotApi, productApi } from '@/services';
import { extractError } from '@/services/api';
import type { Product, ProductLot } from '@/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToastContext } from '@/components/ui/Toast';
import { daysUntilLabel, formatBR } from '@/utils/date';

const EMPTY_FORM = { code: '', expiryDate: '' };

export function ProductLotsPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToastContext();

  const [product, setProduct] = useState<Product | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<ProductLot | null>(null);
  const [toClose, setToClose] = useState<ProductLot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const { data } = await productApi.getById(id);
      setProduct(data.data);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        toast('Produto não encontrado.', 'error');
        navigate('/products', { replace: true });
      } else {
        setLoadError(extractError(error));
      }
    }
  }, [id, navigate, toast]);

  useEffect(() => { void load(); }, [load]);

  function startEdit(lot: ProductLot) {
    setEditing(lot);
    setForm({ code: lot.code, expiryDate: lot.expiryDate.slice(0, 10) });
  }

  function resetForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (editing) {
        await lotApi.update(id, editing.id, form);
        toast('Lote atualizado. Etiquetas já emitidas não mudam.', 'success');
      } else {
        await lotApi.create(id, form);
        toast('Lote cadastrado.', 'success');
      }
      resetForm();
      await load();
    } catch (error) {
      toast(extractError(error), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmClose() {
    if (!toClose) return;
    try {
      await lotApi.remove(id, toClose.id);
      toast(`Lote ${toClose.code} encerrado.`, 'success');
      if (editing?.id === toClose.id) resetForm();
      setToClose(null);
      await load();
    } catch (error) {
      toast(extractError(error), 'error');
    }
  }

  const retry = (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm font-medium text-rose-700">
      <span>Não foi possível atualizar a lista. {loadError}</span>
      <button className="btn btn-outline btn-sm" onClick={() => void load()}>Tentar de novo</button>
    </div>
  );

  if (!product) return loadError ? <div className="max-w-3xl">{retry}</div> : <PageLoader />;
  const lots = product.lots ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <button
          onClick={() => navigate('/products')}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-charcoal-800 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Produtos</span>
        </button>
        <h1 className="page-title">Lotes de {product.name}</h1>
        <p className="page-subtitle">
          Cada lote guarda a validade impressa pelo fabricante. Ela limita a data de descarte das etiquetas.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-5 p-5 sm:p-7">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="w-7 h-7 rounded-lg bg-orange-50 text-brand-600 flex items-center justify-center">
            <Boxes className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-charcoal-800 uppercase tracking-wider">
            {editing ? `Corrigir lote ${editing.code}` : 'Novo Lote'}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="lot-code" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Código do Lote <span className="text-rose-500">*</span>
            </label>
            <input
              id="lot-code"
              value={form.code}
              onChange={(e) => setForm((value) => ({ ...value, code: e.target.value }))}
              className="input"
              placeholder="Ex: L2026-104"
              required
              maxLength={60}
            />
          </div>
          <div>
            <label htmlFor="lot-expiry" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Validade do Fabricante <span className="text-rose-500">*</span>
            </label>
            <input
              id="lot-expiry"
              type="date"
              value={form.expiryDate}
              onChange={(e) => setForm((value) => ({ ...value, expiryDate: e.target.value }))}
              className="input"
              required
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting
              ? <Spinner size="sm" className="text-white" />
              : editing ? <Save className="w-4 h-4 text-brand-400" /> : <Plus className="w-4 h-4 text-brand-400" />}
            <span>{editing ? 'Salvar Correção' : 'Cadastrar Lote'}</span>
          </button>
          {editing && (
            <button type="button" className="btn btn-outline" onClick={resetForm}>Cancelar</button>
          )}
        </div>
      </form>

      {loadError && retry}

      {lots.some((lot) => lot.needsReview) && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs font-medium text-amber-900">
          <strong>SEM-LOTE</strong> veio da validade antiga do produto. Corrija o código e a validade conforme o estoque
          ou encerre o lote. Até lá, ele nunca vem marcado na etiqueta.
        </div>
      )}

      {lots.length === 0 ? (
        <div className="card p-6 text-center text-sm font-medium text-slate-500">
          Nenhum lote em uso. Sem lote, a etiqueta pede a validade impressa na embalagem.
        </div>
      ) : (
        <div className="space-y-3">
          {lots.map((lot) => (
            <div key={lot.id} className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-charcoal-800 truncate">{lot.code}</h3>
                  <StatusBadge status={lot.computedStatus} label={daysUntilLabel(lot.daysUntilExpiry)} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Validade: <strong className="text-charcoal-800">{formatBR(lot.expiryDate)}</strong>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="btn btn-outline btn-sm px-3 text-slate-600" onClick={() => startEdit(lot)}>
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Corrigir</span>
                </button>
                <button
                  className="btn btn-ghost btn-sm px-3 text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                  onClick={() => setToClose(lot)}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Encerrar</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toClose}
        title="Encerrar lote"
        body={`Encerrar o lote "${toClose?.code}"? Ele deixa de aparecer para novas etiquetas. As etiquetas já emitidas não mudam.`}
        confirmLabel="Encerrar"
        danger
        onConfirm={confirmClose}
        onCancel={() => setToClose(null)}
      />
    </div>
  );
}

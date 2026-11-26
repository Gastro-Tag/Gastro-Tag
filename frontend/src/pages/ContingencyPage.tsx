import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, FileText, Link2Off, WifiOff } from 'lucide-react';
import { contingencyApi, productApi } from '@/services';
import { extractError } from '@/services/api';
import type { ContingencyOutage, ContingencyPreview, ContingencyRecord, DiscardReason, Product } from '@/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadError } from '@/components/ui/LoadError';
import { Modal } from '@/components/ui/Modal';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { formatBR, formatDateTimeBR } from '@/utils/date';
import { REASON_LABEL, REASON_OPTIONS } from '@/utils/labelStatus';
import { normalizeText } from '@/utils/totem';
import { outageDurationText } from '@/utils/outage';
import {
  CONTINGENCY_OUTCOME_LABEL, EMPTY_CONTINGENCY_FORM, blocksEmUso, buildContingencyDTO, previewSummary, toLocalInput,
  validateContingencyForm, type ContingencyForm,
} from '@/utils/contingency';
import { cn } from '@/utils/cn';

const STORAGE_LABEL = { REFRIGERADO: 'Refrigerado', CONGELADO: 'Congelado' } as const;
const PRODUCT_PAGE_LIMIT = 100;
const PRODUCT_MAX_PAGES = 10;

/** Todos os produtos ativos (a API pagina em até 100). */
async function loadAllProducts(): Promise<Product[]> {
  const all: Product[] = [];
  for (let page = 1; page <= PRODUCT_MAX_PAGES; page += 1) {
    const { data } = await productApi.list({ page, limit: PRODUCT_PAGE_LIMIT, sort: 'name', order: 'asc' });
    all.push(...data.data);
    if (!data.meta.hasNext) break;
  }
  return all;
}

/** Plano B: o que a cozinha abriu com etiqueta de papel durante uma queda de rede. Só ADMIN. Não imprime etiqueta. */
export function ContingencyPage() {
  const { toast } = useToastContext();
  const formRef = useRef<HTMLDivElement>(null);

  const [outages, setOutages] = useState<ContingencyOutage[]>([]);
  const [outagesError, setOutagesError] = useState('');
  const [records, setRecords] = useState<ContingencyRecord[]>([]);
  const [recordsError, setRecordsError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsError, setProductsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ record: ContingencyRecord; outcome: 'USADO' | 'DESCARTADO' } | null>(null);

  const loadOutages = useCallback(async () => {
    try {
      const { data } = await contingencyApi.listOutages(true);
      setOutages(data.data);
      setOutagesError('');
    } catch (err) {
      setOutagesError(extractError(err));
    }
  }, []);

  const loadRecords = useCallback(async (all: boolean) => {
    try {
      const { data } = await contingencyApi.list(all ? 'all' : 'open');
      setRecords(data.data);
      setRecordsError('');
    } catch (err) {
      setRecordsError(extractError(err));
    }
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      setProducts(await loadAllProducts());
      setProductsError('');
    } catch (err) {
      setProductsError(extractError(err));
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([loadOutages(), loadRecords(false), loadProducts()]).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadOutages, loadRecords, loadProducts]);

  function changeFilter(all: boolean) {
    setShowAll(all);
    void loadRecords(all);
  }

  async function review(outage: ContingencyOutage) {
    setReviewingId(outage.id);
    try {
      await contingencyApi.reviewOutage(outage.id);
      toast('Queda marcada como revisada.', 'success');
      await loadOutages();
    } catch (err) {
      toast(extractError(err), 'error');
    } finally {
      setReviewingId(null);
    }
  }

  const [linkedOutageId, setLinkedOutageId] = useState('');
  function launchForOutage(outage: ContingencyOutage) {
    setLinkedOutageId(outage.id);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div role="note" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <p>
          <strong>Isto não imprime etiqueta.</strong> Aqui você lança no sistema o que a cozinha abriu com etiqueta de papel
          quando a rede caiu. O que ainda está em uso deve ganhar etiqueta do sistema assim que possível.
        </p>
      </div>

      <section aria-labelledby="outages-title" className="card p-5">
        <h2 id="outages-title" className="section-label">Quedas de rede para conferir</h2>
        {outagesError ? (
          <LoadError title="Não foi possível carregar as quedas." message={outagesError} onRetry={() => void loadOutages()} />
        ) : outages.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma queda pendente.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {outages.map((outage) => (
              <li key={outage.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold text-charcoal-800">Rede fora por {outageDurationText(outage.durationMs)}</p>
                    <p className="text-xs text-slate-500">
                      Início aproximado: {formatDateTimeBR(outage.startedAt)} · avisada em {formatDateTimeBR(outage.reportedAt)}
                      {outage.reportedByName ? ` por ${outage.reportedByName}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => launchForOutage(outage)}>
                    <ClipboardList className="h-4 w-4" aria-hidden="true" /> Lançar etiqueta de papel
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={reviewingId === outage.id} onClick={() => void review(outage)}>
                    {reviewingId === outage.id ? <Spinner size="sm" className="text-white" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />} Revisada
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div ref={formRef} className="scroll-mt-4">
        <PaperRecordForm
          products={products}
          productsError={productsError}
          onRetryProducts={() => void loadProducts()}
          linkedOutage={outages.find((outage) => outage.id === linkedOutageId) ?? null}
          linkedOutageId={linkedOutageId}
          onUnlink={() => setLinkedOutageId('')}
          onCreated={() => { void loadRecords(showAll); }}
        />
      </div>

      <section aria-labelledby="records-title" className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="records-title" className="section-label mb-0">Registros do plano B</h2>
          <div role="group" aria-label="Filtro dos registros" className="flex gap-2">
            <button type="button" aria-pressed={!showAll} className={cn('btn btn-sm', !showAll ? 'btn-primary' : 'btn-outline')} onClick={() => changeFilter(false)}>Em uso</button>
            <button type="button" aria-pressed={showAll} className={cn('btn btn-sm', showAll ? 'btn-primary' : 'btn-outline')} onClick={() => changeFilter(true)}>Todos</button>
          </div>
        </div>
        {recordsError ? (
          <LoadError title="Não foi possível carregar os registros." message={recordsError} onRetry={() => void loadRecords(showAll)} />
        ) : records.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-7 w-7 text-slate-400" />} title={showAll ? 'Nenhum registro ainda' : 'Nada em uso no plano B'} desc="Os lançamentos de etiqueta de papel aparecem aqui." />
        ) : (
          <ul className="space-y-3">
            {records.map((record) => (
              <RecordRow key={record.id} record={record} onClose={(outcome) => setClosing({ record, outcome })} />
            ))}
          </ul>
        )}
      </section>

      {closing && (
        <CloseRecordDialog
          record={closing.record}
          initialOutcome={closing.outcome}
          onCancel={() => setClosing(null)}
          onClosed={() => { setClosing(null); toast('Registro encerrado.', 'success'); void loadRecords(showAll); }}
        />
      )}
    </div>
  );
}

function RecordRow({ record, onClose }: { record: ContingencyRecord; onClose: (outcome: 'USADO' | 'DESCARTADO') => void }) {
  const open = record.outcome === 'EM_USO';
  const overdue = open && record.expired;
  return (
    <li className={cn('rounded-xl border p-3', overdue ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-charcoal-800">
            {record.productName}{record.productBrand ? ` · ${record.productBrand}` : ''}
          </p>
          <p className="text-xs text-slate-600">
            Lote {record.lot} · {STORAGE_LABEL[record.storageType]} · aberto em {formatDateTimeBR(record.openedAt)} por {record.responsibleName}
            {record.paperRef ? ` · ref. da folha: ${record.paperRef}` : ''}
          </p>
          <p className={cn('mt-1 text-sm font-bold', overdue ? 'text-rose-700' : 'text-charcoal-800')}>
            Descarte {formatBR(record.discardAt)}
            {overdue && <span className="ml-2 inline-flex items-center gap-1"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Vencido</span>}
            {record.cappedByOriginalExpiry && <span className="ml-2 text-xs font-semibold text-slate-500">(limitado pela validade do fabricante)</span>}
          </p>
          {!open && (
            <p className="text-xs text-slate-600">
              {CONTINGENCY_OUTCOME_LABEL[record.outcome]}{record.discardReason ? ` · ${REASON_LABEL[record.discardReason]}` : ''}
              {record.closedAt ? ` em ${formatDateTimeBR(record.closedAt)}` : ''}{record.closedByName ? ` por ${record.closedByName}` : ''}
            </p>
          )}
          {record.note && <p className="text-xs text-slate-500">Obs.: {record.note}</p>}
        </div>
        {open && (
          <div className="flex shrink-0 gap-2">
            {/* Vencido só sai como descartado, como no totem e no painel de descarte. */}
            {!overdue && <button type="button" className="btn btn-outline btn-sm" onClick={() => onClose('USADO')}>Usado</button>}
            <button type="button" className="btn btn-danger btn-sm" onClick={() => onClose('DESCARTADO')}>Descartado</button>
          </div>
        )}
      </div>
    </li>
  );
}

interface FormProps {
  products: Product[];
  productsError: string;
  onRetryProducts: () => void;
  linkedOutage: ContingencyOutage | null;
  linkedOutageId: string;
  onUnlink: () => void;
  onCreated: () => void;
}

function PaperRecordForm({ products, productsError, onRetryProducts, linkedOutage, linkedOutageId, onUnlink, onCreated }: FormProps) {
  const { toast } = useToastContext();
  const [form, setForm] = useState<ContingencyForm>(EMPTY_CONTINGENCY_FORM);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<ContingencyPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState('');

  const outageId = linkedOutageId;
  const maxOpened = toLocalInput(new Date());

  const filtered = useMemo(() => {
    const term = normalizeText(search);
    const list = term ? products.filter((p) => normalizeText(`${p.name} ${p.brand}`).includes(term)) : products;
    // Mantém o produto escolhido na lista mesmo se a busca o esconder.
    const chosen = products.find((p) => p.id === form.productId);
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list;
  }, [products, search, form.productId]);

  function setField<K extends keyof ContingencyForm>(key: K, value: ContingencyForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setPreview(null); // qualquer mudança invalida o cálculo mostrado
    setError('');
  }

  const formWithOutage: ContingencyForm = { ...form, outageId };
  const validation = validateContingencyForm(formWithOutage);
  const emUsoVencido = blocksEmUso(preview, form.outcome);

  async function calculate() {
    if (validation) { setError(validation); return; }
    setBusy('preview');
    setError('');
    try {
      const { data } = await contingencyApi.preview(buildContingencyDTO(formWithOutage));
      setPreview(data.data);
    } catch (err) {
      setPreview(null);
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (busy) return;
    if (validation) { setError(validation); return; }
    setBusy('save');
    setError('');
    try {
      await contingencyApi.create(buildContingencyDTO(formWithOutage));
      toast('Etiqueta de papel lançada.', 'success');
      // Mantém responsável (e a queda escolhida) para lançar a próxima linha da mesma folha.
      setForm({ ...EMPTY_CONTINGENCY_FORM, responsibleName: form.responsibleName });
      setSearch('');
      setPreview(null);
      onCreated();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }

  const needsReason = form.outcome === 'DESCARTADO';
  const needsNote = needsReason && form.discardReason === 'OUTRO';
  const summary = preview ? previewSummary(preview) : null;

  return (
    <section aria-labelledby="form-title" className="card p-5">
      <h2 id="form-title" className="section-label">Lançar etiqueta de papel</h2>

      {outageId && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <span>Ligado à queda {linkedOutage ? `de ${formatDateTimeBR(linkedOutage.startedAt)} (${outageDurationText(linkedOutage.durationMs)})` : 'selecionada'}.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onUnlink}><Link2Off className="h-4 w-4" aria-hidden="true" /> Desligar</button>
        </div>
      )}

      {productsError && <LoadError title="Não foi possível carregar os produtos." message={productsError} onRetry={onRetryProducts} />}

      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
        <div className="sm:col-span-2">
          <label htmlFor="pb-search" className="mb-1 block text-xs font-bold text-slate-500">Produto</label>
          <input
            id="pb-search" type="search" className="input mb-2" placeholder="Buscar por nome ou marca"
            value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off"
          />
          <select
            id="pb-product" aria-label="Produto" className="input min-h-[44px]" required
            value={form.productId} onChange={(e) => setField('productId', e.target.value)}
          >
            <option value="">Selecione o produto…</option>
            {filtered.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.brand}</option>)}
          </select>
          {search && filtered.length === 0 && <p className="mt-1 text-xs text-slate-500">Nenhum produto encontrado.</p>}
        </div>

        <div>
          <label htmlFor="pb-storage" className="mb-1 block text-xs font-bold text-slate-500">Armazenamento</label>
          <select id="pb-storage" className="input min-h-[44px]" value={form.storageType} onChange={(e) => setField('storageType', e.target.value as ContingencyForm['storageType'])}>
            <option value="REFRIGERADO">Refrigerado</option>
            <option value="CONGELADO">Congelado</option>
          </select>
        </div>
        <div>
          <label htmlFor="pb-lot" className="mb-1 block text-xs font-bold text-slate-500">Lote</label>
          <input id="pb-lot" className="input min-h-[44px]" maxLength={60} value={form.lot} onChange={(e) => setField('lot', e.target.value)} />
        </div>
        <div>
          <label htmlFor="pb-expiry" className="mb-1 block text-xs font-bold text-slate-500">Validade do fabricante</label>
          <input id="pb-expiry" type="date" className="input min-h-[44px]" value={form.originalExpiryDate} onChange={(e) => setField('originalExpiryDate', e.target.value)} />
        </div>
        <div>
          <label htmlFor="pb-opened" className="mb-1 block text-xs font-bold text-slate-500">Abertura (data e hora)</label>
          <input id="pb-opened" type="datetime-local" className="input min-h-[44px]" max={maxOpened} value={form.openedAtLocal} onChange={(e) => setField('openedAtLocal', e.target.value)} />
        </div>
        <div>
          <label htmlFor="pb-resp" className="mb-1 block text-xs font-bold text-slate-500">Responsável da folha</label>
          <input id="pb-resp" className="input min-h-[44px]" maxLength={80} value={form.responsibleName} onChange={(e) => setField('responsibleName', e.target.value)} />
        </div>
        <div>
          <label htmlFor="pb-ref" className="mb-1 block text-xs font-bold text-slate-500">Referência da folha (opcional)</label>
          <input id="pb-ref" className="input min-h-[44px]" maxLength={60} placeholder="Ex.: folha 12" value={form.paperRef} onChange={(e) => setField('paperRef', e.target.value)} />
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-xs font-bold text-slate-500">Destino</legend>
          <div className="flex flex-wrap gap-2">
            {(['EM_USO', 'USADO', 'DESCARTADO'] as const).map((item) => (
              <label
                key={item}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm font-bold',
                  form.outcome === item ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200 bg-white',
                )}
              >
                <input type="radio" name="pb-outcome" className="h-4 w-4 accent-brand-600" checked={form.outcome === item} onChange={() => setField('outcome', item)} />
                {CONTINGENCY_OUTCOME_LABEL[item]}
              </label>
            ))}
          </div>
        </fieldset>

        {needsReason && (
          <div className="sm:col-span-2">
            <label htmlFor="pb-reason" className="mb-1 block text-xs font-bold text-slate-500">Motivo do descarte</label>
            <select id="pb-reason" className="input min-h-[44px]" value={form.discardReason} onChange={(e) => setField('discardReason', e.target.value as DiscardReason | '')}>
              <option value="">Selecione o motivo…</option>
              {REASON_OPTIONS.map((item) => <option key={item} value={item}>{REASON_LABEL[item]}</option>)}
            </select>
          </div>
        )}

        <div className="sm:col-span-2">
          <label htmlFor="pb-note" className="mb-1 block text-xs font-bold text-slate-500">Observação {needsNote ? '(obrigatória)' : '(opcional)'}</label>
          <textarea id="pb-note" className="input min-h-[72px]" rows={2} maxLength={300} value={form.note} onChange={(e) => setField('note', e.target.value)} />
        </div>

        {summary && preview && (
          <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" role="status">
            <p className="font-bold text-charcoal-800">Descarte em {formatBR(preview.discardAt)} · prazo de {preview.shelfLifeDays} {preview.shelfLifeDays === 1 ? 'dia' : 'dias'}</p>
            {preview.openedDate && (
              <p className="text-xs text-slate-600">Dia 1 (abertura, data da cozinha): {formatBR(preview.openedDate)}. Confira com a folha.</p>
            )}
            <p className={cn('text-xs', preview.rule.validated ? 'text-slate-600' : 'font-bold text-amber-800')}>{summary.ruleText.charAt(0).toUpperCase() + summary.ruleText.slice(1)}</p>
            {preview.cappedByOriginalExpiry && <p className="text-xs text-slate-600">Limitado pela validade do fabricante.</p>}
            {summary.warning && <p className="mt-1 font-bold text-rose-700">{summary.warning}</p>}
          </div>
        )}

        {error && <p role="alert" className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>}

        <div className="sm:col-span-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => void calculate()}>
            {busy === 'preview' && <Spinner size="sm" />} Calcular
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy !== null || emUsoVencido}>
            {busy === 'save' && <Spinner size="sm" className="text-white" />} Registrar
          </button>
        </div>
      </form>
    </section>
  );
}

function CloseRecordDialog({ record, initialOutcome, onCancel, onClosed }: {
  record: ContingencyRecord; initialOutcome: 'USADO' | 'DESCARTADO'; onCancel: () => void; onClosed: () => void;
}) {
  const [outcome, setOutcome] = useState<'USADO' | 'DESCARTADO'>(initialOutcome);
  const [reason, setReason] = useState<DiscardReason | ''>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const needsReason = outcome === 'DESCARTADO';
  const needsNote = needsReason && reason === 'OUTRO';
  const canSubmit = !submitting && (!needsReason || reason !== '') && (!needsNote || note.trim().length >= 3);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await contingencyApi.close(record.id, {
        outcome,
        discardReason: needsReason && reason ? reason : undefined,
        note: note.trim() || undefined,
      });
      onClosed();
    } catch (err) {
      setError(extractError(err));
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Encerrar: ${record.productName}`} onClose={onCancel} widthClass="max-w-lg" busy={submitting}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p className="text-sm text-slate-500">Lote {record.lot} · descarte previsto {formatBR(record.discardAt)}. Esta ação não pode ser desfeita.</p>
        <fieldset>
          <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Destino</legend>
          <div className="flex gap-2">
            {(['USADO', 'DESCARTADO'] as const).map((item) => (
              <label key={item} className={cn('flex min-h-[48px] flex-1 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm font-bold', outcome === item ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200')}>
                <input type="radio" name="pb-close-outcome" className="h-4 w-4 accent-brand-600" checked={outcome === item} onChange={() => { setOutcome(item); setError(''); }} />
                {CONTINGENCY_OUTCOME_LABEL[item]}
              </label>
            ))}
          </div>
        </fieldset>
        {needsReason && (
          <div>
            <label htmlFor="pb-close-reason" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">Motivo do descarte</label>
            <select id="pb-close-reason" className="input min-h-[44px]" required value={reason} onChange={(e) => setReason(e.target.value as DiscardReason | '')}>
              <option value="">Selecione o motivo…</option>
              {REASON_OPTIONS.map((item) => <option key={item} value={item}>{REASON_LABEL[item]}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="pb-close-note" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">Observação {needsNote ? '(obrigatória)' : '(opcional)'}</label>
          <textarea id="pb-close-note" className="input min-h-[72px]" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="submit" className={outcome === 'USADO' ? 'btn btn-primary' : 'btn btn-danger'} disabled={!canSubmit}>
            {submitting && <Spinner size="sm" className="text-white" />}
            {outcome === 'USADO' ? 'Marcar como usado' : 'Confirmar descarte'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Hash, Minus, Plus,
  Printer, Refrigerator, Snowflake, Thermometer, User,
} from 'lucide-react';
import { labelApi, productApi } from '@/services';
import { extractError } from '@/services/api';
import type { Label, LabelPreview, Product, StorageType } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { KeyboardSheet } from '@/components/totem/KeyboardSheet';
import { useTotemStore } from '@/store/totemStore';
import { formatBR, todayISO } from '@/utils/date';
import { printLabel } from '@/utils/printLabel';
import {
  DEFAULT_TEMP, STORAGE_LABEL, defaultLot, formatTemperature, getLastLot,
  getLastStorage, rememberChoices, temperatureDraft, weekdayShort,
} from '@/utils/totem';
import { cn } from '@/utils/cn';

const ALL_STORAGES: StorageType[] = ['REFRIGERADO', 'CONGELADO'];
const SUCCESS_SECONDS = 10;
const MAX_COPIES = 9;

type PreviewState =
  | { status: 'loading' }
  | { status: 'ok'; data: LabelPreview }
  | { status: 'error'; message: string };

type Sheet = 'lot' | 'temp' | null;
type Done = { label: Label; printed: boolean };

function logo(): string | null {
  return localStorage.getItem('gastrotag_logo');
}

export function TotemLabelPage() {
  const { productId = '' } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { operator, openOperatorSheet } = useTotemStore();
  const today = useMemo(() => todayISO(), []);

  const [product, setProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState('');
  const [storage, setStorage] = useState<StorageType | null>(null);
  const [temps, setTemps] = useState<Record<StorageType, string>>({ ...DEFAULT_TEMP });
  const [lot, setLot] = useState('');
  const [copies, setCopies] = useState(1);
  const [previews, setPreviews] = useState<Partial<Record<StorageType, PreviewState>>>({});
  const [sheet, setSheet] = useState<Sheet>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [seconds, setSeconds] = useState(SUCCESS_SECONDS);
  const lock = useRef(false);

  // Produto + atalhos memorizados (lote e armazenamento do último uso).
  useEffect(() => {
    let active = true;
    productApi.getById(productId)
      .then(({ data }) => {
        if (!active) return;
        const loaded = data.data;
        setProduct(loaded);
        setLot(getLastLot(loaded.id) ?? defaultLot());
        const options = storagesOf(loaded);
        const last = getLastStorage(loaded.id);
        setStorage(last && options.includes(last) ? last : options[0]);
      })
      .catch((err) => { if (active) setLoadError(extractError(err)); });
    return () => { active = false; };
  }, [productId]);

  // Sem responsável no turno: pede antes de o operador chegar no botão.
  useEffect(() => {
    if (product && !operator) openOperatorSheet();
  }, [product, operator, openOperatorSheet]);

  const options = useMemo(() => (product ? storagesOf(product) : []), [product]);

  // Pré-cálculo de cada armazenamento (a regra e o teto são do servidor).
  useEffect(() => {
    if (!product) return;
    let active = true;
    for (const type of options) {
      setPreviews((current) => ({ ...current, [type]: { status: 'loading' } }));
      labelApi.preview({ productId: product.id, openedAt: today, storageType: type, storageTemp: temps[type] })
        .then(({ data }) => {
          if (active) setPreviews((current) => ({ ...current, [type]: { status: 'ok', data: data.data } }));
        })
        .catch((err) => {
          if (active) setPreviews((current) => ({ ...current, [type]: { status: 'error', message: extractError(err) } }));
        });
    }
    return () => { active = false; };
  }, [product, options, today, temps.REFRIGERADO, temps.CONGELADO]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contagem regressiva para voltar ao início depois de imprimir.
  useEffect(() => {
    if (!done?.printed) return;
    const timer = window.setInterval(() => setSeconds((value) => value - 1), 1_000);
    return () => window.clearInterval(timer);
  }, [done]);

  useEffect(() => {
    if (done?.printed && seconds <= 0) navigate('/totem', { replace: true });
  }, [done, seconds, navigate]);

  const selectedPreview = storage ? previews[storage] : undefined;
  const canPrint = Boolean(product && storage && selectedPreview?.status === 'ok' && lot.trim() && !submitting);

  async function registerPrints(label: Label, count: number) {
    try {
      for (let i = 0; i < count; i++) await labelApi.registerPrint(label.id);
    } catch {
      /* o contador é secundário: a etiqueta já está salva e impressa */
    }
  }

  async function handlePrint() {
    if (lock.current || !product || !storage) return;
    if (!operator) { openOperatorSheet(); return; }
    if (selectedPreview?.status !== 'ok' || !lot.trim()) return;

    lock.current = true;
    setSubmitting(true);
    setSubmitError('');
    let created: Label | null = null;
    try {
      const { data } = await labelApi.create({
        productId: product.id,
        lot: lot.trim(),
        responsibleName: operator,
        openedAt: today,
        storageType: storage,
        storageTemp: temps[storage],
      });
      const label: Label = data.data;
      created = label;
      rememberChoices(product.id, lot.trim(), storage);
      printLabel(label, logo(), copies);
      await registerPrints(label, copies);
      setSeconds(SUCCESS_SECONDS);
      setDone({ label, printed: true });
    } catch (err) {
      if (created) {
        setDone({ label: created, printed: false });
      } else {
        setSubmitError(extractError(err));
      }
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  async function handleReprint() {
    if (lock.current || !done) return;
    lock.current = true;
    setSubmitting(true);
    try {
      printLabel(done.label, logo(), copies);
      await registerPrints(done.label, copies);
      setSeconds(SUCCESS_SECONDS);
      setDone({ label: done.label, printed: true });
    } catch (err) {
      setSubmitError(extractError(err));
      setDone({ label: done.label, printed: false });
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  // ── Estados de tela ────────────────────────────────────
  if (loadError) {
    return (
      <Centered>
        <AlertTriangle className="h-16 w-16 text-rose-500" />
        <h1 className="text-3xl font-extrabold">Produto indisponível</h1>
        <p className="max-w-md text-xl text-slate-500">{loadError}</p>
        <button type="button" className="btn btn-primary h-16 px-10 text-xl" onClick={() => navigate('/totem', { replace: true })}>
          Voltar ao início
        </button>
      </Centered>
    );
  }

  if (!product || !storage) {
    return <div className="flex h-full min-h-[50vh] items-center justify-center"><Spinner size="lg" /></div>;
  }

  if (product.computedStatus === 'expired') {
    return (
      <Centered>
        <AlertTriangle className="h-20 w-20 text-rose-600" />
        <h1 className="text-4xl font-extrabold text-rose-700">Produto vencido</h1>
        <p className="max-w-lg text-2xl font-semibold text-slate-600">
          {product.name} venceu em {formatBR(product.originalExpiryDate)}. Não use e não gere etiqueta: descarte.
        </p>
        <button type="button" className="btn btn-primary h-20 px-12 text-2xl" onClick={() => navigate('/totem', { replace: true })}>
          Voltar ao início
        </button>
      </Centered>
    );
  }

  if (done) {
    const { label, printed } = done;
    return (
      <Centered>
        {printed ? (
          <CheckCircle2 className="h-24 w-24 text-emerald-500" />
        ) : (
          <AlertTriangle className="h-24 w-24 text-amber-500" />
        )}
        <h1 className="text-4xl font-extrabold">
          {printed ? 'Etiqueta enviada para impressão' : 'Etiqueta salva, mas a impressão falhou'}
        </h1>
        <div className="w-full max-w-xl rounded-3xl border-2 border-slate-200 bg-white p-6 text-left shadow-card">
          <div className="text-2xl font-extrabold">{label.productName ?? product.name}</div>
          <div className="mt-1 text-lg font-medium text-slate-500">
            {STORAGE_LABEL[label.storageType]} · Lote {label.lot} · Cód. {label.shortCode}
          </div>
          <div className="mt-4 rounded-2xl bg-brand-600 px-5 py-4 text-white">
            <div className="text-sm font-bold uppercase tracking-wider opacity-90">Descartar em</div>
            <div className="text-4xl font-extrabold">{formatBR(label.discardAt)}</div>
          </div>
        </div>
        {submitError && <p className="text-lg font-semibold text-rose-600">{submitError}</p>}
        <div className="flex w-full max-w-xl gap-3">
          <button
            type="button" disabled={submitting} onClick={() => void handleReprint()}
            className="btn btn-outline h-20 flex-1 gap-2 text-xl font-extrabold"
          >
            {submitting ? <Spinner size="sm" /> : <Printer className="h-6 w-6" />}
            {printed ? 'Reimprimir' : 'Tentar imprimir'}
          </button>
          <button
            type="button" onClick={() => navigate('/totem', { replace: true })}
            className="btn btn-accent h-20 flex-1 text-xl font-extrabold"
          >
            Concluir
          </button>
        </div>
        {printed && <p className="text-base font-medium text-slate-400">Voltando ao início em {Math.max(seconds, 0)}s</p>}
      </Centered>
    );
  }

  const discardText = selectedPreview?.status === 'ok'
    ? `${weekdayShort(selectedPreview.data.discardAt)}, ${formatBR(selectedPreview.data.discardAt)}`
    : '';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 p-5">
      <div className="flex items-start gap-4">
        <button
          type="button" aria-label="Voltar" onClick={() => navigate('/totem')}
          className="flex h-20 w-20 shrink-0 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95"
        >
          <ArrowLeft className="h-9 w-9" />
        </button>
        <div className="min-w-0 pt-1">
          <h1 className="line-clamp-2 text-4xl font-extrabold leading-tight">{product.name}</h1>
          <p className="mt-1 truncate text-xl font-medium text-slate-500">
            {product.brand}{product.category ? ` · ${product.category}` : ''}
          </p>
        </div>
      </div>

      {/* Armazenamento: cada cartão já mostra a data de descarte calculada. */}
      <div className={cn('grid gap-4', options.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1')}>
        {options.map((type) => (
          <StorageCard
            key={type}
            type={type}
            temp={temps[type]}
            selected={storage === type}
            state={previews[type]}
            onSelect={() => { setStorage(type); setSubmitError(''); }}
          />
        ))}
      </div>

      {selectedPreview?.status === 'ok' && selectedPreview.data.cappedByOriginalExpiry && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-lg font-semibold text-amber-900">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
          <span>
            Data limitada pela validade original do fabricante ({formatBR(selectedPreview.data.originalExpiryDate)}).
          </span>
        </div>
      )}

      {/* Dados já preenchidos: tocar só se precisar mudar. */}
      <div className="grid gap-3 md:grid-cols-3">
        <FieldButton icon={<Hash className="h-6 w-6" />} label="Lote" value={lot || '—'} onClick={() => setSheet('lot')} />
        <FieldButton icon={<Thermometer className="h-6 w-6" />} label="Temperatura" value={temps[storage]} onClick={() => setSheet('temp')} />
        <FieldButton icon={<User className="h-6 w-6" />} label="Responsável" value={operator || 'Informar'} onClick={openOperatorSheet} warn={!operator} />
      </div>

      <div className="flex items-center justify-between rounded-2xl border-2 border-slate-200 bg-white px-5 py-3">
        <span className="text-xl font-bold text-slate-600">Quantidade de etiquetas</span>
        <div className="flex items-center gap-3">
          <button
            type="button" aria-label="Diminuir" disabled={copies <= 1} onClick={() => setCopies((n) => Math.max(1, n - 1))}
            className="flex h-16 w-16 touch-manipulation items-center justify-center rounded-2xl bg-slate-100 active:scale-95 disabled:opacity-40"
          >
            <Minus className="h-7 w-7" />
          </button>
          <span className="w-12 text-center text-4xl font-extrabold tabular-nums">{copies}</span>
          <button
            type="button" aria-label="Aumentar" disabled={copies >= MAX_COPIES} onClick={() => setCopies((n) => Math.min(MAX_COPIES, n + 1))}
            className="flex h-16 w-16 touch-manipulation items-center justify-center rounded-2xl bg-slate-100 active:scale-95 disabled:opacity-40"
          >
            <Plus className="h-7 w-7" />
          </button>
        </div>
      </div>

      {submitError && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-lg font-bold text-rose-800">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 mt-auto bg-gradient-to-t from-[#F3F4F6] via-[#F3F4F6] to-transparent px-5 pb-5 pt-4">
        <button
          type="button"
          disabled={!canPrint}
          onClick={() => void handlePrint()}
          className="btn btn-accent flex h-28 w-full flex-col gap-0 rounded-3xl text-3xl font-extrabold shadow-lg"
        >
          {submitting ? (
            <Spinner size="md" className="text-white" />
          ) : (
            <>
              <span className="flex items-center gap-3"><Printer className="h-8 w-8" /> IMPRIMIR ETIQUETA{copies > 1 ? ` (${copies})` : ''}</span>
              <span className="mt-1 text-lg font-semibold opacity-90">
                {STORAGE_LABEL[storage]}{discardText ? ` · descarte ${discardText}` : ''}
              </span>
            </>
          )}
        </button>
      </div>

      {sheet === 'lot' && (
        <KeyboardSheet
          title="Número do lote"
          hint="Use o lote da embalagem. Fica memorizado para este produto."
          placeholder="Ex.: L20261023"
          initialValue={lot}
          capitalize="upper"
          maxLength={60}
          confirmLabel="Salvar lote"
          onCancel={() => setSheet(null)}
          onConfirm={(value) => {
            const clean = value.trim();
            if (!clean) return 'Informe o lote.';
            setLot(clean);
            setSheet(null);
          }}
        />
      )}

      {sheet === 'temp' && (
        <KeyboardSheet
          title={`Temperatura — ${STORAGE_LABEL[storage]}`}
          hint="Digite em °C. Use ± para temperaturas negativas."
          placeholder="Ex.: 4"
          initialValue={temperatureDraft(temps[storage])}
          layout="numeric"
          maxLength={6}
          confirmLabel="Salvar temperatura"
          onCancel={() => setSheet(null)}
          onConfirm={(value) => {
            const formatted = formatTemperature(value);
            if (!formatted) return 'Digite uma temperatura válida, em °C.';
            setTemps((current) => ({ ...current, [storage]: formatted }));
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}

// ── Peças ─────────────────────────────────────────────────
function storagesOf(product: Product): StorageType[] {
  const available = ALL_STORAGES.filter((type) =>
    (type === 'REFRIGERADO' ? product.daysValidRefrigerated : product.daysValidFrozen) > 0);
  // Sem prazo no produto, o servidor ainda pode ter regra: deixa o cálculo decidir.
  return available.length > 0 ? available : ALL_STORAGES;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-5 p-6 text-center">
      {children}
    </div>
  );
}

function StorageCard({ type, temp, selected, state, onSelect }: {
  type: StorageType; temp: string; selected: boolean; state?: PreviewState; onSelect: () => void;
}) {
  const Icon = type === 'REFRIGERADO' ? Refrigerator : Snowflake;
  const iconColor = type === 'REFRIGERADO' ? 'text-sky-600' : 'text-indigo-600';
  const ok = state?.status === 'ok' ? state.data : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'relative flex min-h-[210px] touch-manipulation flex-col justify-between rounded-3xl border-4 bg-white p-6 text-left shadow-card transition-transform active:scale-[0.98]',
        selected ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200',
      )}
    >
      {selected && (
        <span className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-white">
          <Check className="h-6 w-6" />
        </span>
      )}
      <div className="flex items-center gap-3">
        <Icon className={cn('h-10 w-10', iconColor)} />
        <div>
          <div className="text-3xl font-extrabold">{STORAGE_LABEL[type]}</div>
          <div className="text-lg font-semibold text-slate-500">{temp}</div>
        </div>
      </div>

      <div className="mt-4">
        {state?.status === 'error' ? (
          <p className="text-lg font-bold leading-snug text-rose-700">{state.message}</p>
        ) : ok ? (
          <>
            <div className="text-sm font-bold uppercase tracking-wider text-slate-400">Descartar em</div>
            <div className="text-5xl font-extrabold leading-none text-charcoal-800">{formatBR(ok.discardAt)}</div>
            <div className="mt-2 text-lg font-semibold capitalize text-slate-500">
              {weekdayShort(ok.discardAt)} · {ok.rule.shelfLifeDays} dias
              {ok.cappedByOriginalExpiry ? ' · limitado pelo fabricante' : ''}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 text-xl font-semibold text-slate-400">
            <Spinner size="sm" /> Calculando…
          </div>
        )}
      </div>
    </button>
  );
}

function FieldButton({ icon, label, value, onClick, warn }: {
  icon: React.ReactNode; label: string; value: string; onClick: () => void; warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[84px] touch-manipulation items-center gap-4 rounded-2xl border-2 bg-white px-5 py-3 text-left active:scale-[0.98]',
        warn ? 'border-brand-500 bg-brand-50' : 'border-slate-200',
      )}
    >
      <span className="text-slate-400">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <span className="block truncate text-2xl font-extrabold">{value}</span>
      </span>
    </button>
  );
}


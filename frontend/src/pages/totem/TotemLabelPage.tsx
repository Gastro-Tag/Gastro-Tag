import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, CheckCircle2, Hash, Minus, Plus,
  Printer, Refrigerator, Snowflake, Thermometer, User,
} from 'lucide-react';
import { labelApi, productApi } from '@/services';
import { extractError } from '@/services/api';
import type { ExpirySource, Label, LabelPreview, Product, ProductLot, StorageType } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { KeyboardSheet } from '@/components/totem/KeyboardSheet';
import { useTotemStore } from '@/store/totemStore';
import { formatBR } from '@/utils/date';
import { printLabel } from '@/utils/printLabel';
import {
  DEFAULT_TEMP, STORAGE_LABEL, UNREADABLE_LOT, dateDraft, formatDateDraft, formatTemperature,
  getLastStorage, getOperator, parseDateDraft, rememberChoices, temperatureDraft, weekdayShort,
} from '@/utils/totem';
import { cn } from '@/utils/cn';
import { createRequestKeeper } from '@/utils/requestId';

const ALL_STORAGES: StorageType[] = ['REFRIGERADO', 'CONGELADO'];
const SUCCESS_SECONDS = 10;
const MAX_COPIES = 9;

type PreviewState =
  | { status: 'loading' }
  | { status: 'ok'; data: LabelPreview }
  | { status: 'error'; message: string };

type Sheet = 'lot' | 'temp' | 'expiry' | null;
type Done = { label: Label; printed: boolean };

function logo(): string | null {
  return localStorage.getItem('gastrotag_logo');
}

export function TotemLabelPage() {
  const { productId = '' } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { operator, openOperatorSheet, syncOperator } = useTotemStore();

  const [product, setProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState('');
  const [storage, setStorage] = useState<StorageType | null>(null);
  const [temps, setTemps] = useState<Record<StorageType, string>>({ ...DEFAULT_TEMP });
  // Lote cadastrado ou validade digitada a partir da embalagem em mãos.
  const [source, setSource] = useState<ExpirySource | null>(null);
  const [packageExpiry, setPackageExpiry] = useState('');
  const [lot, setLot] = useState('');
  const [copies, setCopies] = useState(1);
  const [previews, setPreviews] = useState<Partial<Record<StorageType, PreviewState>>>({});
  const [sheet, setSheet] = useState<Sheet>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [seconds, setSeconds] = useState(SUCCESS_SECONDS);
  const lock = useRef(false);
  const [requests] = useState(createRequestKeeper);

  // Produto + armazenamento do último uso. Com mais de um lote, quem está com a embalagem escolhe.
  useEffect(() => {
    let active = true;
    productApi.getById(productId)
      .then(({ data }) => {
        if (!active) return;
        const loaded = data.data;
        setProduct(loaded);
        const lots = usableLots(loaded);
        setSource(lots.length === 1 && !lots[0].needsReview ? { lotId: lots[0].id } : null);
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

  const lots = useMemo(() => (product ? usableLots(product) : []), [product]);
  const expiredLots = useMemo(() => (product?.lots ?? []).filter((item) => item.computedStatus === 'expired' && !item.needsReview), [product]);

  // Pré-cálculo de cada armazenamento. A regra, o teto e a data de hoje são do servidor.
  useEffect(() => {
    if (!product) return;
    if (!source) { setPreviews({}); return; }
    let active = true;
    for (const type of options) {
      setPreviews((current) => ({ ...current, [type]: { status: 'loading' } }));
      labelApi.preview({ ...source, productId: product.id, storageType: type, storageTemp: temps[type] })
        .then(({ data }) => {
          if (!active) return;
          setPreviews((current) => ({ ...current, [type]: { status: 'ok', data: data.data } }));
        })
        .catch((err) => {
          if (active) setPreviews((current) => ({ ...current, [type]: { status: 'error', message: extractError(err) } }));
        });
    }
    return () => { active = false; };
  }, [product, options, source, temps.REFRIGERADO, temps.CONGELADO]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const isPackage = Boolean(source?.originalExpiryDate);
  const lotReady = !isPackage || Boolean(lot.trim());
  const canPrint = Boolean(product && storage && selectedPreview?.status === 'ok' && lotReady && !submitting);

  async function registerPrints(label: Label, count: number) {
    try {
      for (let i = 0; i < count; i++) await labelApi.registerPrint(label.id);
    } catch {
      /* o contador é secundário: a etiqueta já está salva e impressa */
    }
  }

  async function handlePrint() {
    if (lock.current || !product || !storage) return;
    // Lê de novo no toque: o turno pode ter expirado desde a última sincronização.
    const responsible = getOperator();
    if (!responsible) { syncOperator(); openOperatorSheet(); return; }
    if (!source || selectedPreview?.status !== 'ok' || !lotReady) return;

    lock.current = true;
    setSubmitting(true);
    setSubmitError('');
    let created: Label | null = null;
    try {
      const payload = {
        ...source,
        productId: product.id,
        lot: isPackage ? lot.trim() : undefined,
        responsibleName: responsible,
        storageType: storage,
        storageTemp: temps[storage],
      };
      const { data } = await labelApi.create({ ...payload, requestId: requests.idFor(payload) });
      const label: Label = data.data;
      created = label;
      requests.reset(); // a próxima etiqueta, mesmo igual, é outro pedido
      rememberChoices(product.id, storage);
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
        <h1 className="text-2xl font-extrabold sm:text-3xl">Produto indisponível</h1>
        <p className="max-w-md text-lg text-slate-500 sm:text-xl">{loadError}</p>
        <button type="button" className="btn btn-primary h-16 px-10 text-xl" onClick={() => navigate('/totem', { replace: true })}>
          Voltar ao início
        </button>
      </Centered>
    );
  }

  if (!product || !storage) {
    return <div className="flex h-full min-h-[50vh] items-center justify-center"><Spinner size="lg" /></div>;
  }

  if (done) {
    const { label, printed } = done;
    return (
      <Centered>
        {printed ? (
          <CheckCircle2 className="h-16 w-16 text-emerald-500 sm:h-24 sm:w-24 [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:w-12" />
        ) : (
          <AlertTriangle className="h-16 w-16 text-amber-500 sm:h-24 sm:w-24 [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:w-12" />
        )}
        <h1 className="text-2xl font-extrabold sm:text-4xl">
          {printed ? 'Etiqueta enviada para impressão' : 'Etiqueta salva, mas a impressão falhou'}
        </h1>
        <div className="w-full max-w-xl rounded-3xl border-2 border-slate-200 bg-white p-4 text-left shadow-card sm:p-6">
          <div className="break-words text-xl font-extrabold sm:text-2xl">{label.productName ?? product.name}</div>
          <div className="mt-1 break-words text-base font-medium text-slate-500 sm:text-lg">
            {STORAGE_LABEL[label.storageType]} · Lote {label.lot} · Cód. {label.shortCode}
          </div>
          <div className="mt-3 rounded-2xl bg-brand-600 px-4 py-3 text-white sm:mt-4 sm:px-5 sm:py-4">
            <div className="text-sm font-bold uppercase tracking-wider opacity-90">Descartar em</div>
            <div className="text-3xl font-extrabold sm:text-4xl">{formatBR(label.discardAt)}</div>
          </div>
        </div>
        {submitError && <p className="text-lg font-semibold text-rose-600">{submitError}</p>}
        <div className="flex w-full max-w-xl gap-3">
          <button
            type="button" disabled={submitting} onClick={() => void handleReprint()}
            className="btn btn-outline h-16 flex-1 gap-2 text-lg font-extrabold sm:h-20 sm:text-xl"
          >
            {submitting ? <Spinner size="sm" /> : <Printer className="h-6 w-6" />}
            {printed ? 'Reimprimir' : 'Tentar imprimir'}
          </button>
          <button
            type="button" onClick={() => navigate('/totem', { replace: true })}
            className="btn btn-accent h-16 flex-1 text-lg font-extrabold sm:h-20 sm:text-xl"
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
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3 p-3 sm:gap-5 sm:p-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <button
          type="button" aria-label="Voltar" onClick={() => navigate('/totem')}
          className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95 sm:h-20 sm:w-20"
        >
          <ArrowLeft className="h-7 w-7 sm:h-9 sm:w-9" />
        </button>
        <div className="min-w-0 flex-1 pt-0.5 sm:pt-1">
          <h1 className="line-clamp-4 break-words text-2xl font-extrabold leading-tight sm:line-clamp-3 sm:text-4xl">{product.name}</h1>
          <p className="mt-1 line-clamp-2 break-words text-base font-medium text-slate-500 sm:text-xl">
            {product.brand}{product.category ? ` · ${product.category}` : ''}
          </p>
        </div>
      </div>

      {expiredLots.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 text-base font-bold text-rose-800 sm:p-4 sm:text-lg">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
          <span className="min-w-0 break-words">
            {expiredLots.map((item) => `Lote ${item.code} venceu em ${formatBR(item.expiryDate)}`).join('; ')}. Não use: descarte.
          </span>
        </div>
      )}

      {/* A validade é a da embalagem em mãos: com vários lotes, nada vem marcado. */}
      <section className="rounded-3xl border-2 border-slate-200 bg-white p-3 sm:p-4">
        <h2 className="mb-2 text-lg font-extrabold text-slate-600 sm:mb-3 sm:text-xl">Qual embalagem está em mãos?</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
          {lots.map((item) => (
            <SourceButton
              key={item.id}
              selected={source?.lotId === item.id}
              title={`Validade ${formatBR(item.expiryDate)}`}
              subtitle={item.needsReview ? 'Confira na embalagem' : `Lote ${item.code}`}
              onClick={() => { setSource({ lotId: item.id }); setSubmitError(''); }}
            />
          ))}
          <SourceButton
            selected={isPackage}
            title={isPackage ? `Validade ${formatBR(packageExpiry)}` : 'Outra embalagem'}
            subtitle={isPackage ? 'Informada agora · toque para mudar' : 'Informar a validade impressa'}
            onClick={() => setSheet('expiry')}
          />
        </div>
      </section>

      {/* Armazenamento: cada cartão já mostra a data de descarte calculada. */}
      <div className={cn('grid grid-cols-1 gap-3 sm:gap-4', options.length > 1 && 'sm:grid-cols-2')}>
        {options.map((type) => (
          <StorageCard
            key={type}
            type={type}
            temp={temps[type]}
            selected={storage === type}
            state={previews[type]}
            waiting={!source}
            onSelect={() => { setStorage(type); setSubmitError(''); }}
          />
        ))}
      </div>

      {selectedPreview?.status === 'ok' && selectedPreview.data.cappedByOriginalExpiry && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-base font-semibold text-amber-900 sm:p-4 sm:text-lg">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
          <span className="min-w-0">
            Data limitada pela validade original do fabricante ({formatBR(selectedPreview.data.originalExpiryDate)}).
          </span>
        </div>
      )}

      {/* Dados já preenchidos: tocar só se precisar mudar. */}
      <div className={cn('grid grid-cols-1 gap-2 sm:gap-3', isPackage ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {isPackage && <FieldButton icon={<Hash className="h-6 w-6" />} label="Lote" value={lot || 'Informar'} onClick={() => setSheet('lot')} warn={!lot.trim()} />}
        <FieldButton icon={<Thermometer className="h-6 w-6" />} label="Temperatura" value={temps[storage]} onClick={() => setSheet('temp')} />
        <FieldButton icon={<User className="h-6 w-6" />} label="Responsável" value={operator || 'Informar'} onClick={openOperatorSheet} warn={!operator} />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 py-2 sm:px-5 sm:py-3">
        <span className="text-lg font-bold leading-tight text-slate-600 sm:text-xl">Quantidade de etiquetas</span>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button" aria-label="Diminuir" disabled={copies <= 1} onClick={() => setCopies((n) => Math.max(1, n - 1))}
            className="flex h-14 w-14 touch-manipulation items-center justify-center rounded-2xl bg-slate-100 active:scale-95 disabled:opacity-40 sm:h-16 sm:w-16"
          >
            <Minus className="h-7 w-7" />
          </button>
          <span className="w-10 text-center text-3xl sm:w-12 sm:text-4xl font-extrabold tabular-nums">{copies}</span>
          <button
            type="button" aria-label="Aumentar" disabled={copies >= MAX_COPIES} onClick={() => setCopies((n) => Math.min(MAX_COPIES, n + 1))}
            className="flex h-14 w-14 touch-manipulation items-center justify-center rounded-2xl bg-slate-100 active:scale-95 disabled:opacity-40 sm:h-16 sm:w-16"
          >
            <Plus className="h-7 w-7" />
          </button>
        </div>
      </div>

      {submitError && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 text-base font-bold text-rose-800 sm:p-4 sm:text-lg">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
          <span className="min-w-0 break-words">{submitError}</span>
        </div>
      )}

      <div className="sticky bottom-0 -mx-3 mt-auto bg-gradient-to-t from-[#F3F4F6] via-[#F3F4F6] to-transparent px-3 pb-3 pt-3 sm:-mx-5 sm:px-5 sm:pb-5 sm:pt-4">
        <button
          type="button"
          disabled={!canPrint}
          onClick={() => void handlePrint()}
          className="btn btn-accent flex h-auto min-h-[84px] w-full flex-col gap-0 rounded-3xl px-3 py-2 text-xl font-extrabold shadow-lg sm:h-28 sm:text-3xl [@media(max-height:500px)]:h-auto [@media(max-height:500px)]:min-h-[64px] [@media(max-height:500px)]:text-xl"
        >
          {submitting ? (
            <Spinner size="md" className="text-white" />
          ) : (
            <>
              <span className="flex items-center gap-2 sm:gap-3"><Printer className="h-6 w-6 shrink-0 sm:h-8 sm:w-8" /> IMPRIMIR ETIQUETA{copies > 1 ? ` (${copies})` : ''}</span>
              <span className="mt-1 text-sm font-semibold opacity-90 sm:text-lg">
                {STORAGE_LABEL[storage]}{discardText ? ` · descarte ${discardText}` : ''}
              </span>
            </>
          )}
        </button>
      </div>

      {sheet === 'lot' && (
        <KeyboardSheet
          title="Número do lote"
          hint="Use o lote impresso na embalagem. Se não houver lote legível, toque em Sem lote legível."
          placeholder="Ex.: L20261023"
          initialValue={lot}
          capitalize="upper"
          maxLength={60}
          confirmLabel="Salvar lote"
          cancelLabel={lot ? 'Cancelar' : 'Sem lote legível'}
          onCancel={() => { setLot((current) => current || UNREADABLE_LOT); setSheet(null); }}
          onConfirm={(value) => {
            const clean = value.trim();
            if (!clean) return 'Informe o lote.';
            setLot(clean);
            setSheet(null);
          }}
        />
      )}

      {sheet === 'expiry' && (
        <KeyboardSheet
          title="Validade da embalagem"
          hint="Digite dia, mês e ano impressos na embalagem. Ex.: 25122026"
          placeholder="DD/MM/AAAA"
          initialValue={packageExpiry ? dateDraft(packageExpiry) : ''}
          layout="date"
          maxLength={8}
          displayValue={formatDateDraft}
          confirmLabel="Usar esta validade"
          onCancel={() => setSheet(null)}
          onConfirm={(value) => {
            const expiry = parseDateDraft(value);
            if (!expiry) return 'Digite uma data real: dia, mês e ano.';
            setPackageExpiry(expiry);
            setSource({ originalExpiryDate: expiry });
            setSubmitError('');
            // Sem lote cadastrado, o código também vem da embalagem: pede logo em seguida.
            setSheet(lot.trim() ? null : 'lot');
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
function usableLots(product: Product): ProductLot[] {
  return (product.lots ?? []).filter((item) => item.computedStatus !== 'expired');
}

function storagesOf(product: Product): StorageType[] {
  const available = ALL_STORAGES.filter((type) =>
    (type === 'REFRIGERADO' ? product.daysValidRefrigerated : product.daysValidFrozen) > 0);
  // Sem prazo no produto, o servidor ainda pode ter regra: deixa o cálculo decidir.
  return available.length > 0 ? available : ALL_STORAGES;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-3 p-4 text-center sm:gap-5 sm:p-6">
      {children}
    </div>
  );
}

function SourceButton({ selected, title, subtitle, onClick }: {
  selected: boolean; title: string; subtitle: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex min-h-[72px] min-w-0 touch-manipulation items-center gap-3 rounded-2xl border-4 px-3 py-2 text-left active:scale-[0.98] sm:min-h-[88px] sm:gap-4 sm:px-5 sm:py-3',
        selected ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200 bg-white',
      )}
    >
      <CalendarDays className={cn('h-7 w-7 shrink-0 sm:h-8 sm:w-8', selected ? 'text-brand-600' : 'text-slate-400')} />
      <span className="min-w-0">
        <span className="block break-words text-xl font-extrabold leading-tight sm:text-2xl">{title}</span>
        <span className="block break-words text-base font-semibold leading-tight text-slate-500 sm:text-lg">{subtitle}</span>
      </span>
    </button>
  );
}

function StorageCard({ type, temp, selected, state, waiting, onSelect }: {
  type: StorageType; temp: string; selected: boolean; state?: PreviewState; waiting: boolean; onSelect: () => void;
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
        'relative flex min-h-[150px] min-w-0 touch-manipulation flex-col justify-between rounded-3xl border-4 bg-white p-4 text-left shadow-card transition-transform active:scale-[0.98] sm:min-h-[210px] sm:p-6',
        selected ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200',
      )}
    >
      {selected && (
        <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-white">
          <Check className="h-6 w-6" />
        </span>
      )}
      <div className="flex items-center gap-3">
        <Icon className={cn('h-8 w-8 sm:h-10 sm:w-10', iconColor)} />
        <div>
          <div className="text-2xl font-extrabold sm:text-3xl">{STORAGE_LABEL[type]}</div>
          <div className="text-lg font-semibold text-slate-500">{temp}</div>
        </div>
      </div>

      <div className="mt-3 sm:mt-4">
        {waiting ? (
          <p className="text-lg font-bold leading-snug text-slate-400">Escolha a embalagem para calcular o descarte.</p>
        ) : state?.status === 'error' ? (
          <p className="text-lg font-bold leading-snug text-rose-700">{state.message}</p>
        ) : ok ? (
          <>
            <div className="text-sm font-bold uppercase tracking-wider text-slate-400">Descartar em</div>
            <div className="text-4xl font-extrabold leading-none text-charcoal-800 sm:text-5xl">{formatBR(ok.discardAt)}</div>
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
        'flex min-h-[72px] min-w-0 touch-manipulation items-center gap-3 rounded-2xl border-2 bg-white px-4 py-2 text-left active:scale-[0.98] sm:min-h-[84px] sm:gap-4 sm:px-5 sm:py-3',
        warn ? 'border-brand-500 bg-brand-50' : 'border-slate-200',
      )}
    >
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <span className="block truncate text-xl font-extrabold sm:text-2xl">{value}</span>
      </span>
    </button>
  );
}


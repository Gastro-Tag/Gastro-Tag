import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Minus, Plus, Printer, Refrigerator, Scissors, Snowflake, Thermometer, User,
} from 'lucide-react';
import { labelApi, productApi } from '@/services';
import { extractError } from '@/services/api';
import type { Label, Product, SplitResult, StorageType } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { KeyboardSheet } from '@/components/totem/KeyboardSheet';
import { Centered, FieldButton, TempButton, storagesOf } from '@/pages/totem/TotemLabelPage';
import { useSplitPreview } from '@/hooks/useSplitPreview';
import { useTotemStore } from '@/store/totemStore';
import { formatBR } from '@/utils/date';
import { DEFAULT_TEMP, STORAGE_LABEL, getOperator, weekdayShort } from '@/utils/totem';
import { printSplitChildren } from '@/utils/split';
import { formatTemperatureRange, formatTemperatureShort, parseTemperature, temperatureDraft } from '@/utils/temperature';
import { createRequestKeeper } from '@/utils/requestId';
import { cn } from '@/utils/cn';

const SUCCESS_SECONDS = 10;
const MAX_COUNT = 20;

type Done = { result: SplitResult; printed: boolean; fractionedAt?: string };

function logo(): string | null {
  return localStorage.getItem('gastrotag_logo');
}

/** Dividir uma etiqueta ativa do produto em etiquetas filhas, no totem. */
export function TotemSplitPage() {
  const { productId = '' } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { operator, openOperatorSheet, syncOperator } = useTotemStore();

  const [product, setProduct] = useState<Product | null>(null);
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [parent, setParent] = useState<Label | null>(null);
  const [count, setCount] = useState(2);
  const [storage, setStorage] = useState<StorageType>('REFRIGERADO');
  // Só vale a temperatura confirmada NESTA divisão; a sugestão nunca é gravada sozinha.
  const [temps, setTemps] = useState<Partial<Record<StorageType, number>>>({});
  const [closeParent, setCloseParent] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [seconds, setSeconds] = useState(SUCCESS_SECONDS);
  const lock = useRef(false);
  const [requests] = useState(createRequestKeeper);

  // Produto e etiquetas ATIVAS não vencidas (a data de "hoje" é a da cozinha, no servidor).
  useEffect(() => {
    let active = true;
    setLabels(null);
    setLoadError('');
    Promise.all([
      productApi.getById(productId),
      labelApi.list({ productId, status: 'ATIVA', due: 'today', limit: 50 }),
      labelApi.list({ productId, status: 'ATIVA', due: 'upcoming', limit: 50 }),
    ])
      .then(([prod, today, upcoming]) => {
        if (!active) return;
        setProduct(prod.data.data);
        setTruncated(today.data.meta.total > today.data.data.length || upcoming.data.meta.total > upcoming.data.data.length);
        setLabels([...today.data.data, ...upcoming.data.data].sort((a, b) => a.discardAt.localeCompare(b.discardAt)));
      })
      .catch((err) => { if (active) setLoadError(extractError(err)); });
    return () => { active = false; };
  }, [productId, reload]);

  useEffect(() => {
    if (!operator) openOperatorSheet();
  }, [operator, openOperatorSheet]);

  useEffect(() => {
    if (!done?.printed) return;
    const timer = window.setInterval(() => setSeconds((value) => value - 1), 1_000);
    return () => window.clearInterval(timer);
  }, [done]);

  useEffect(() => {
    if (done?.printed && seconds <= 0) navigate('/totem', { replace: true });
  }, [done, seconds, navigate]);

  const confirmedTemp = temps[storage];
  const preview = useSplitPreview(parent?.id ?? null, storage, confirmedTemp ?? null);
  const canPrint = Boolean(parent && preview.status === 'ok' && !submitting);

  function choose(label: Label) {
    setParent(label);
    const options = product ? storagesOf(product) : [];
    setStorage(options.includes(label.storageType) ? label.storageType : (options[0] ?? label.storageType));
    setTemps({});
    setCount(2);
    setCloseParent(false);
    setSubmitError('');
  }

  async function handlePrint() {
    if (lock.current || !parent || preview.status !== 'ok') return;
    const responsible = getOperator();
    if (!responsible) { syncOperator(); openOperatorSheet(); return; }
    const temperature = temps[storage];
    if (temperature === undefined) { setSheet(true); return; }

    lock.current = true;
    setSubmitting(true);
    setSubmitError('');
    let created: SplitResult | null = null;
    try {
      const payload = { count, storageType: storage, storageTemperature: temperature, responsibleName: responsible, closeParent };
      const { data } = await labelApi.split(parent.id, { ...payload, requestId: requests.idFor({ ...payload, parentId: parent.id }) });
      created = data.data;
      requests.reset(); // a próxima divisão, mesmo igual, é outro pedido
      await printSplitChildren(created, logo(), preview.data.fractionedAt);
      setSeconds(SUCCESS_SECONDS);
      setDone({ result: created, printed: true, fractionedAt: preview.data.fractionedAt });
    } catch (err) {
      if (created) setDone({ result: created, printed: false, fractionedAt: preview.data.fractionedAt });
      else setSubmitError(extractError(err));
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  async function handleReprint() {
    if (lock.current || !done) return;
    lock.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      await printSplitChildren(done.result, logo(), done.fractionedAt);
      setSeconds(SUCCESS_SECONDS);
      setDone({ ...done, printed: true });
    } catch (err) {
      setSubmitError(extractError(err));
      setDone({ ...done, printed: false });
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
        <h1 className="text-2xl font-extrabold sm:text-3xl">Não foi possível carregar</h1>
        <p className="max-w-md text-lg text-slate-500 sm:text-xl">{loadError}</p>
        <div className="flex w-full max-w-md gap-3">
          <button type="button" className="btn btn-outline h-16 flex-1 text-lg font-extrabold" onClick={() => setReload((n) => n + 1)}>Tentar de novo</button>
          <button type="button" className="btn btn-primary h-16 flex-1 text-lg font-extrabold" onClick={() => navigate('/totem', { replace: true })}>Início</button>
        </div>
      </Centered>
    );
  }

  if (!product || !labels) {
    return <div className="flex h-full min-h-[50vh] items-center justify-center"><Spinner size="lg" /></div>;
  }

  if (done) {
    const { result, printed } = done;
    return (
      <Centered>
        {printed
          ? <CheckCircle2 className="h-16 w-16 text-emerald-500 sm:h-24 sm:w-24 [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:w-12" />
          : <AlertTriangle className="h-16 w-16 text-amber-500 sm:h-24 sm:w-24 [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:w-12" />}
        <h1 className="text-2xl font-extrabold sm:text-4xl">
          {printed ? 'Etiquetas enviadas para impressão' : 'Etiquetas salvas, mas a impressão falhou'}
        </h1>
        <div className="w-full max-w-xl rounded-3xl border-2 border-slate-200 bg-white p-4 text-left shadow-card sm:p-6">
          <div className="break-words text-xl font-extrabold sm:text-2xl">{product.name}</div>
          <div className="mt-1 break-words text-base font-medium text-slate-500 sm:text-lg">
            Fracionado de {result.parent.shortCode} · {result.children.length} {result.children.length === 1 ? 'etiqueta' : 'etiquetas'}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {result.children.map((child) => (
              <span key={child.id} className="rounded-xl bg-slate-100 px-3 py-1 font-mono text-base font-bold text-slate-700 sm:text-lg">{child.shortCode}</span>
            ))}
          </div>
          <div className="mt-3 rounded-2xl bg-brand-600 px-4 py-3 text-white sm:mt-4 sm:px-5 sm:py-4">
            <div className="text-sm font-bold uppercase tracking-wider opacity-90">Descartar em</div>
            <div className="text-3xl font-extrabold sm:text-4xl">{formatBR(result.children[0]?.discardAt ?? '')}</div>
          </div>
          {result.parent.status === 'ENCERRADA' && (
            <p className="mt-3 text-base font-semibold text-slate-500">A etiqueta {result.parent.shortCode} foi encerrada como Usado.</p>
          )}
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

  const header = (
    <div className="flex items-start gap-3 sm:gap-4">
      <button
        type="button" aria-label="Voltar"
        onClick={() => (parent ? setParent(null) : navigate(`/totem/etiqueta/${product.id}`))}
        className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95 sm:h-20 sm:w-20"
      >
        <ArrowLeft className="h-7 w-7 sm:h-9 sm:w-9" />
      </button>
      <div className="min-w-0 flex-1 pt-0.5 sm:pt-1">
        <h1 className="line-clamp-3 break-words text-2xl font-extrabold leading-tight sm:text-4xl">Dividir etiqueta</h1>
        <p className="mt-1 line-clamp-2 break-words text-base font-medium text-slate-500 sm:text-xl">{product.name} · {product.brand}</p>
      </div>
    </div>
  );

  // Passo 1: qual etiqueta ativa dividir.
  if (!parent) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3 p-3 sm:gap-5 sm:p-5">
        {header}
        <h2 className="text-lg font-extrabold text-slate-600 sm:text-xl">Qual etiqueta será dividida?</h2>
        {truncated && (
          <p role="alert" className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-base font-semibold text-amber-900">
            Há mais etiquetas ativas deste produto do que as mostradas. Aparecem as que vencem primeiro; encerre as já usadas para ver as demais.
          </p>
        )}
        {labels.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-white p-6 text-center">
            <p className="text-xl font-extrabold">Nenhuma etiqueta ativa e dentro do prazo</p>
            <p className="mt-1 text-lg text-slate-500">Este produto não tem etiqueta para dividir. Gere uma etiqueta nova ou descarte o que venceu.</p>
            <button type="button" className="btn btn-primary mt-4 h-16 px-8 text-lg font-extrabold" onClick={() => navigate(`/totem/etiqueta/${product.id}`)}>
              Gerar etiqueta
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
            {labels.map((label) => {
              const StorageIcon = label.storageType === 'REFRIGERADO' ? Refrigerator : Snowflake;
              return (
                <button
                  key={label.id} type="button" onClick={() => choose(label)}
                  className="flex min-h-[96px] min-w-0 touch-manipulation items-center gap-3 rounded-2xl border-4 border-slate-200 bg-white px-4 py-3 text-left active:scale-[0.98] sm:gap-4 sm:px-5"
                >
                  <StorageIcon className={cn('h-8 w-8 shrink-0', label.storageType === 'REFRIGERADO' ? 'text-sky-600' : 'text-indigo-600')} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-2xl font-extrabold">{label.shortCode}</span>
                    <span className="block break-words text-base font-semibold text-slate-500 sm:text-lg">
                      Lote {label.lot} · {STORAGE_LABEL[label.storageType]}
                      {label.parent ? ` · filha de ${label.parent.shortCode}` : ''}
                    </span>
                    <span className="block text-lg font-extrabold capitalize text-charcoal-800">
                      Descarte {weekdayShort(label.discardAt)}, {formatBR(label.discardAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Passo 2: quantidade, armazenamento, temperatura, responsável.
  const range = preview.status === 'ok' ? formatTemperatureRange(preview.data.rule.minTemperature, preview.data.rule.maxTemperature) : null;
  const discardText = preview.status === 'ok' ? `${weekdayShort(preview.data.discardAt)}, ${formatBR(preview.data.discardAt)}` : '';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3 p-3 sm:gap-5 sm:p-5">
      {header}

      <div className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3">
        <div className="text-sm font-bold uppercase tracking-wider text-slate-400">Etiqueta de origem</div>
        <div className="break-words text-xl font-extrabold sm:text-2xl">
          <span className="font-mono">{parent.shortCode}</span> · Lote {parent.lot} · descarte {formatBR(parent.discardAt)}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 py-2 sm:px-5 sm:py-3">
        <span className="text-lg font-bold leading-tight text-slate-600 sm:text-xl">Quantas etiquetas novas?</span>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button" aria-label="Diminuir" disabled={count <= 1} onClick={() => setCount((n) => Math.max(1, n - 1))}
            className="flex h-14 w-14 touch-manipulation items-center justify-center rounded-2xl bg-slate-100 active:scale-95 disabled:opacity-40 sm:h-16 sm:w-16"
          >
            <Minus className="h-7 w-7" />
          </button>
          <span aria-live="polite" className="w-12 text-center text-3xl font-extrabold tabular-nums sm:w-14 sm:text-4xl">{count}</span>
          <button
            type="button" aria-label="Aumentar" disabled={count >= MAX_COUNT} onClick={() => setCount((n) => Math.min(MAX_COUNT, n + 1))}
            className="flex h-14 w-14 touch-manipulation items-center justify-center rounded-2xl bg-slate-100 active:scale-95 disabled:opacity-40 sm:h-16 sm:w-16"
          >
            <Plus className="h-7 w-7" />
          </button>
        </div>
      </div>

      <div className={cn('grid gap-2 sm:gap-3', storagesOf(product).length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {storagesOf(product).map((type) => {
          const Icon = type === 'REFRIGERADO' ? Refrigerator : Snowflake;
          const selected = storage === type;
          return (
            <button
              key={type} type="button" aria-pressed={selected}
              onClick={() => { setStorage(type); setSubmitError(''); }}
              className={cn(
                'relative flex min-h-[84px] min-w-0 touch-manipulation items-center gap-3 rounded-2xl border-4 px-3 py-2 text-left active:scale-[0.98] sm:min-h-[96px] sm:px-5',
                selected ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200 bg-white',
              )}
            >
              <Icon className={cn('h-8 w-8 shrink-0 sm:h-10 sm:w-10', type === 'REFRIGERADO' ? 'text-sky-600' : 'text-indigo-600')} />
              <span className="min-w-0 text-xl font-extrabold sm:text-3xl">{STORAGE_LABEL[type]}</span>
              {selected && (
                <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-white">
                  <Check className="h-5 w-5" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Data calculada pelo servidor, nunca maior que a da origem. */}
      <div className="rounded-3xl border-2 border-slate-200 bg-white p-4 sm:p-5" aria-live="polite">
        <div className="text-sm font-bold uppercase tracking-wider text-slate-400">Descartar as filhas em</div>
        {preview.status === 'loading' && <div className="mt-1 flex items-center gap-3 text-xl font-semibold text-slate-400"><Spinner size="sm" /> Calculando…</div>}
        {preview.status === 'error' && <p role="alert" className="mt-1 text-lg font-bold text-rose-700">{preview.message}</p>}
        {preview.status === 'ok' && (
          <>
            <div className="text-4xl font-extrabold leading-none text-charcoal-800 sm:text-5xl">{formatBR(preview.data.discardAt)}</div>
            <div className="mt-2 text-lg font-semibold capitalize text-slate-500">{discardText.split(',')[0]} · {preview.data.rule.shelfLifeDays} dias</div>
          </>
        )}
      </div>

      {preview.status === 'ok' && preview.data.cappedByParent && (
        <Warn>Data limitada pela etiqueta de origem ({formatBR(parent.discardAt)}).</Warn>
      )}
      {preview.status === 'ok' && preview.data.cappedByOriginalExpiry && (
        <Warn>Data limitada pela validade original do fabricante.</Warn>
      )}
      {preview.status === 'ok' && !preview.data.rule.validated && (
        <Warn>Prazo do cadastro do produto, sem regra validada.</Warn>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
        <TempButton suggested={DEFAULT_TEMP[storage]} confirmed={confirmedTemp} range={range} onClick={() => setSheet(true)} />
        <FieldButton icon={<User className="h-6 w-6" />} label="Responsável" value={operator || 'Informar'} onClick={openOperatorSheet} warn={!operator} />
      </div>

      <button
        type="button" role="switch" aria-checked={closeParent} onClick={() => setCloseParent((value) => !value)}
        className={cn(
          'flex min-h-[72px] touch-manipulation items-center gap-3 rounded-2xl border-2 px-4 py-2 text-left active:scale-[0.99] sm:px-5',
          closeParent ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200 bg-white',
        )}
      >
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2', closeParent ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white')}>
          {closeParent && <Check className="h-6 w-6" />}
        </span>
        <span className="min-w-0">
          <span className="block text-xl font-extrabold sm:text-2xl">A embalagem original acabou</span>
          <span className="block text-base font-semibold text-slate-500">Encerra {parent.shortCode} como Usado</span>
        </span>
      </button>

      {submitError && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 text-base font-bold text-rose-800 sm:p-4 sm:text-lg">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
          <span className="min-w-0 break-words">{submitError}</span>
        </div>
      )}

      <div className="sticky bottom-0 -mx-3 mt-auto bg-gradient-to-t from-[#F3F4F6] via-[#F3F4F6] to-transparent px-3 pb-3 pt-3 sm:-mx-5 sm:px-5 sm:pb-5 sm:pt-4">
        <button
          type="button" disabled={!canPrint} onClick={() => void handlePrint()}
          className="btn btn-accent flex h-auto min-h-[84px] w-full flex-col gap-0 rounded-3xl px-3 py-2 text-xl font-extrabold shadow-lg sm:h-28 sm:text-3xl [@media(max-height:500px)]:h-auto [@media(max-height:500px)]:min-h-[64px] [@media(max-height:500px)]:text-xl"
        >
          {submitting ? <Spinner size="md" className="text-white" /> : (
            <>
              <span className="flex items-center gap-2 sm:gap-3">
                {confirmedTemp === undefined
                  ? <><Thermometer className="h-6 w-6 shrink-0 sm:h-8 sm:w-8" /> CONFIRMAR TEMPERATURA</>
                  : <><Scissors className="h-6 w-6 shrink-0 sm:h-8 sm:w-8" /> DIVIDIR E IMPRIMIR ({count})</>}
              </span>
              <span className="mt-1 text-sm font-semibold opacity-90 sm:text-lg">
                {confirmedTemp === undefined
                  ? `Antes de imprimir · sugerida ${formatTemperatureShort(DEFAULT_TEMP[storage])}`
                  : `${STORAGE_LABEL[storage]}${discardText ? ` · descarte ${discardText}` : ''}`}
              </span>
            </>
          )}
        </button>
      </div>

      {sheet && (
        <KeyboardSheet
          title={`Temperatura — ${STORAGE_LABEL[storage]}`}
          hint={`Sugestão: ${formatTemperatureShort(DEFAULT_TEMP[storage])}. Confira o termômetro e confirme o valor medido. Use ± para negativo.`}
          placeholder="Ex.: 4"
          initialValue={temperatureDraft(confirmedTemp ?? DEFAULT_TEMP[storage])}
          layout="numeric"
          maxLength={6}
          confirmLabel="Confirmar temperatura"
          onCancel={() => setSheet(false)}
          onConfirm={(value) => {
            const temperature = parseTemperature(value);
            if (temperature === null) return 'Digite uma temperatura válida, em °C (de −50 a 30).';
            setTemps((current) => ({ ...current, [storage]: temperature }));
            setSubmitError('');
            setSheet(false);
          }}
        />
      )}
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-base font-semibold text-amber-900 sm:p-4 sm:text-lg">
      <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

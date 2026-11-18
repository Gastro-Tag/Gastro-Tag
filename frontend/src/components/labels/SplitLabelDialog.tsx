import { useMemo, useState } from 'react';
import { AlertTriangle, Refrigerator, Snowflake, Thermometer } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useAuthStore } from '@/store/authStore';
import { labelApi } from '@/services';
import { extractError } from '@/services/api';
import { RULE_REQUIRED_CODE } from '@/utils/semRegra';
import { useSplitPreview } from '@/hooks/useSplitPreview';
import type { Label, SplitResult, StorageType } from '@/types';
import { formatBR } from '@/utils/date';
import { createRequestKeeper } from '@/utils/requestId';
import { printSplitChildren } from '@/utils/split';
import {
  SUGGESTED_TEMPERATURE, TEMP_MAX, TEMP_MIN, formatTemperatureRange, formatTemperatureShort,
  parseTemperature, temperatureDraft,
} from '@/utils/temperature';
import { cn } from '@/utils/cn';

interface Props {
  parent: Label;
  onClose: () => void;
  /** `printed` é false quando as filhas foram salvas mas a impressão falhou. */
  onDone: (result: SplitResult, printed: boolean) => void;
}

const STORAGES: { type: StorageType; name: string; Icon: typeof Refrigerator; color: string }[] = [
  { type: 'REFRIGERADO', name: 'Refrigerado', Icon: Refrigerator, color: 'text-sky-600' },
  { type: 'CONGELADO', name: 'Congelado', Icon: Snowflake, color: 'text-indigo-600' },
];

export function SplitLabelDialog({ parent, onClose, onDone }: Props) {
  const userName = useAuthStore((state) => state.user?.name ?? '');
  const [count, setCount] = useState('2');
  const [storage, setStorage] = useState<StorageType>(parent.storageType);
  // A sugestão não é medição: o campo começa vazio e o operador digita ou confirma o valor.
  const [tempText, setTempText] = useState('');
  const [responsible, setResponsible] = useState(userName);
  const [closeParent, setCloseParent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [requests] = useState(() => createRequestKeeper('gastrotag:requestId:split-dialog'));

  const temperature = parseTemperature(tempText);
  const tempInvalid = tempText.trim() !== '' && temperature === null;
  const quantity = /^\d+$/.test(count) ? Number(count) : NaN;
  const quantityOk = Number.isInteger(quantity) && quantity >= 1 && quantity <= 20;
  const preview = useSplitPreview(parent.id, storage, temperature);
  const suggested = SUGGESTED_TEMPERATURE[storage];

  const canSubmit = useMemo(
    () => !submitting && quantityOk && temperature !== null && responsible.trim().length > 0 && preview.status === 'ok',
    [submitting, quantityOk, temperature, responsible, preview.status],
  );

  async function submit() {
    if (!canSubmit || temperature === null || preview.status !== 'ok') return;
    setSubmitting(true);
    setError('');
    const payload = {
      count: quantity,
      storageType: storage,
      storageTemperature: temperature,
      responsibleName: responsible.trim(),
      closeParent,
    };
    let result: SplitResult;
    try {
      // Mesmo requestId se o pedido for reenviado (rede caiu, toque repetido): o servidor devolve as filhas já criadas.
      const { data } = await labelApi.split(parent.id, { ...payload, requestId: requests.idFor({ ...payload, parentId: parent.id }) });
      result = data.data;
      requests.reset();
    } catch (err) {
      setError(extractError(err));
      setSubmitting(false);
      return;
    }
    let printed = true;
    try {
      await printSplitChildren(result, localStorage.getItem('gastrotag_logo'), preview.data.fractionedAt);
    } catch {
      printed = false;
    }
    onDone(result, printed);
  }

  const range = preview.status === 'ok' ? formatTemperatureRange(preview.data.rule.minTemperature, preview.data.rule.maxTemperature) : null;

  return (
    <Modal title={`Dividir etiqueta ${parent.shortCode}`} onClose={onClose} widthClass="max-w-xl" busy={submitting}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p className="text-sm text-slate-500">
          {parent.productName ?? parent.product?.name} · Lote {parent.lot} · Descarte da origem {formatBR(parent.discardAt)}.
          Cada filha leva o código próprio e é impressa em 1 cópia.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="split-count" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
              Quantidade de etiquetas (1 a 20)
            </label>
            <input
              id="split-count" className={cn('input min-h-[44px]', count !== '' && !quantityOk && 'border-rose-400')}
              inputMode="numeric" autoComplete="off" maxLength={2}
              value={count} onChange={(e) => { setCount(e.target.value.replace(/\D/g, '')); setError(''); }}
              aria-invalid={count !== '' && !quantityOk} aria-describedby="split-count-help"
            />
            {!quantityOk && (
              <p id="split-count-help" role="alert" className="mt-1.5 text-[11px] font-semibold text-rose-600">
                Informe uma quantidade inteira de 1 a 20.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="split-responsible" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
              Responsável
            </label>
            <input
              id="split-responsible" className="input min-h-[44px]" maxLength={100} autoComplete="off"
              value={responsible} onChange={(e) => setResponsible(e.target.value)}
            />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">Armazenamento das filhas</legend>
          <div className="grid grid-cols-2 gap-2">
            {STORAGES.map(({ type, name, Icon, color }) => (
              <label
                key={type}
                className={cn(
                  'flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-bold',
                  storage === type ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200 bg-white',
                )}
              >
                <input type="radio" name="split-storage" className="h-4 w-4 accent-brand-600" checked={storage === type} onChange={() => { setStorage(type); setError(''); }} />
                <Icon className={cn('h-4 w-4', color)} />
                {name}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="split-temperature" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
            Temperatura medida no ponto (°C)
          </label>
          <div className="relative max-w-xs">
            <Thermometer className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="split-temperature" className={cn('input min-h-[44px] pl-10', tempInvalid && 'border-rose-400')}
              inputMode="decimal" autoComplete="off" maxLength={10} placeholder="Ex.: 4 ou -18"
              value={tempText} onChange={(e) => { setTempText(e.target.value); setError(''); }}
              aria-invalid={tempInvalid} aria-describedby="split-temperature-help"
            />
          </div>
          <div id="split-temperature-help" className="mt-1.5 space-y-1.5 text-[11px]">
            {tempInvalid && (
              <p role="alert" className="font-semibold text-rose-600">
                Digite um número entre {formatTemperatureShort(TEMP_MIN)} e {formatTemperatureShort(TEMP_MAX)} (aceita vírgula).
              </p>
            )}
            {temperature !== suggested && (
              <p className="flex flex-wrap items-center gap-2 text-slate-500">
                <span>Sugestão: {formatTemperatureShort(suggested)} (não é medição).</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setTempText(temperatureDraft(suggested))}>
                  Usar {formatTemperatureShort(suggested)}
                </button>
              </p>
            )}
            {range && <p className="font-semibold text-slate-600">Faixa da regra: {range}</p>}
            {temperature === null && !tempInvalid && <p className="text-slate-400">Informe a temperatura conferida agora.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Descarte previsto das filhas</p>
          {preview.status === 'loading' && <p className="mt-1 flex items-center gap-2 text-sm text-slate-500"><Spinner size="sm" /> Calculando…</p>}
          {preview.status === 'error' && (
            <p
              role="alert"
              className={preview.code === RULE_REQUIRED_CODE
                ? 'mt-1 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800'
                : 'mt-1 text-sm font-semibold text-rose-700'}
            >
              {preview.message}
            </p>
          )}
          {preview.status === 'ok' && (
            <>
              <p className="mt-1 text-2xl font-extrabold text-charcoal-800">{formatBR(preview.data.discardAt)}</p>
              <p className="text-xs text-slate-500">Prazo aplicado: {preview.data.rule.shelfLifeDays} dias (calculado pelo servidor).</p>
              {preview.data.cappedByParent && (
                <Notice>Data limitada pela etiqueta de origem ({formatBR(parent.discardAt)}): a filha nunca vence depois dela.</Notice>
              )}
              {preview.data.cappedByOriginalExpiry && (
                <Notice>Data limitada pela validade original do fabricante.</Notice>
              )}
              {!preview.data.rule.validated && <Notice>Prazo do cadastro do produto, sem regra validada.</Notice>}
            </>
          )}
        </div>

        <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={closeParent} onChange={(e) => setCloseParent(e.target.checked)} />
          <span>
            <span className="block text-sm font-bold text-charcoal-800">A embalagem original acabou</span>
            <span className="block text-xs text-slate-500">Encerra a etiqueta {parent.shortCode} como Usado ao criar as filhas.</span>
          </span>
        </label>

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button type="submit" className="btn btn-accent" disabled={!canSubmit}>
            {submitting && <Spinner size="sm" className="text-white" />}
            Criar e imprimir {quantityOk ? quantity : ''} {quantity === 1 ? 'etiqueta' : 'etiquetas'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-2 text-xs font-semibold text-amber-800">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span>{children}</span>
    </p>
  );
}

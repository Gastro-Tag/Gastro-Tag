import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw, Refrigerator, Snowflake, Thermometer, X,
} from 'lucide-react';
import { equipmentApi } from '@/services';
import { extractError } from '@/services/api';
import type { EquipmentToday } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { KeyboardSheet } from '@/components/totem/KeyboardSheet';
import { Centered } from '@/pages/totem/TotemLabelPage';
import { useTotemStore } from '@/store/totemStore';
import { formatDateTimeBR } from '@/utils/date';
import {
  NO_READING_TODAY, READING_INVALID_MESSAGE, equipmentRangeText, missingToday, outOfRangeMessage, parseReading,
} from '@/utils/equipment';
import { isHandlerInvalid } from '@/utils/handler';
import { createRequestKeeper } from '@/utils/requestId';
import { getHandlerToken, getOperator } from '@/utils/totem';
import { formatTemperatureShort } from '@/utils/temperature';
import { cn } from '@/utils/cn';

type Notice = { text: string; tone: 'ok' | 'error' | 'alert' };

/** "Temperaturas": uma leitura medida por equipamento. Registro separado da etiqueta; nunca sugere valor. */
export function TotemEquipmentPage() {
  const navigate = useNavigate();
  const { operator, operatorSheetOpen, openOperatorSheet, syncOperator, invalidateOperator } = useTotemStore();
  const [items, setItems] = useState<EquipmentToday[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EquipmentToday | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [requests] = useState(() => createRequestKeeper('gastrotag:requestId:totem-equipment'));
  const lock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await equipmentApi.today();
      setItems(data.data);
      setError('');
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Aviso comum some sozinho; o de fora da faixa fica até alguém fechar (ou o totem voltar ao início por inatividade).
  useEffect(() => {
    if (!notice || notice.tone === 'alert') return;
    const timer = window.setTimeout(() => setNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Se o operador não foi informado e a janela foi fechada, desiste da escolha.
  useEffect(() => {
    if (selected && !operator && !operatorSheetOpen) setSelected(null);
  }, [selected, operator, operatorSheetOpen]);

  function choose(item: EquipmentToday) {
    syncOperator();
    setNotice(null);
    setSelected(item);
    if (!getOperator()) openOperatorSheet(); // o responsável entra no registro: pede antes do teclado
  }

  async function submit(raw: string): Promise<string | void> {
    if (lock.current || !selected) return;
    const temperature = parseReading(raw);
    if (temperature === null) return READING_INVALID_MESSAGE;
    const responsible = getOperator();
    if (!responsible) { syncOperator(); openOperatorSheet(); return 'Informe o responsável antes de registrar.'; }
    lock.current = true;
    const equipment = selected;
    try {
      // Com PIN confirmado, o servidor usa o operador do token; sem ele, o nome do turno.
      const token = getHandlerToken();
      const who = token ? { handlerToken: token } : { responsibleName: responsible };
      const { data } = await equipmentApi.addReading(equipment.id, {
        temperature,
        ...who,
        requestId: requests.idFor({ equipmentId: equipment.id, temperature, ...who }),
      });
      requests.reset();
      const reading = data.data;
      setSelected(null);
      setNotice(reading.outOfRange
        ? { tone: 'alert', text: `${equipment.name}: ${formatTemperatureShort(reading.temperature)}. ${outOfRangeMessage(reading.minTemperature, reading.maxTemperature)}` }
        : { tone: 'ok', text: `${equipment.name}: ${formatTemperatureShort(reading.temperature)} registrada.` });
      void load();
    } catch (err) {
      if (isHandlerInvalid(err)) {
        requests.reset();
        invalidateOperator(); // limpa o operador e pede o PIN de novo
        setSelected(null);
        setNotice({ tone: 'error', text: extractError(err) });
        return;
      }
      // Erro de rede mantém o teclado aberto: tocar de novo reenvia com o mesmo requestId.
      void load(); // 409/422: o equipamento pode ter sido desativado ou o registro desligado
      return extractError(err);
    } finally {
      lock.current = false;
    }
  }

  const header = (
    <div className="flex items-start gap-3 sm:gap-4">
      <button
        type="button" aria-label="Voltar" onClick={() => navigate('/totem')}
        className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95 sm:h-20 sm:w-20"
      >
        <ArrowLeft className="h-7 w-7 sm:h-9 sm:w-9" />
      </button>
      <div className="min-w-0 flex-1 pt-0.5 sm:pt-1">
        <h1 className="break-words text-2xl font-extrabold leading-tight sm:text-4xl">Temperaturas</h1>
        <p className="mt-1 break-words text-base font-medium text-slate-500 sm:text-xl">
          Toque no equipamento e digite a temperatura medida
        </p>
      </div>
      <button
        type="button" aria-label="Atualizar lista" onClick={() => void load()}
        className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95 sm:h-20 sm:w-20"
      >
        <RefreshCw className={cn('h-6 w-6 sm:h-8 sm:w-8', loading && 'animate-spin')} />
      </button>
    </div>
  );

  if (!items) {
    if (error) {
      return (
        <Centered>
          <AlertTriangle className="h-16 w-16 text-rose-500" />
          <h1 className="text-2xl font-extrabold sm:text-3xl">Não foi possível carregar</h1>
          <p className="max-w-md text-lg text-slate-500 sm:text-xl">{error}</p>
          <div className="flex w-full max-w-md gap-3">
            <button type="button" className="btn btn-outline h-16 flex-1 text-lg font-extrabold" onClick={() => void load()}>Tentar de novo</button>
            <button type="button" className="btn btn-primary h-16 flex-1 text-lg font-extrabold" onClick={() => navigate('/totem', { replace: true })}>Início</button>
          </div>
        </Centered>
      );
    }
    return <div className="flex h-full min-h-[50vh] items-center justify-center"><Spinner size="lg" /></div>;
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3 p-3 sm:gap-5 sm:p-5">
      {header}

      {notice && (
        <div
          role={notice.tone === 'ok' ? 'status' : 'alert'}
          className={cn(
            'flex items-start gap-3 rounded-2xl border-4 p-4 font-extrabold',
            notice.tone === 'ok' && 'border-emerald-300 bg-emerald-50 text-base text-emerald-800 sm:text-lg',
            notice.tone === 'error' && 'border-rose-300 bg-rose-50 text-base text-rose-800 sm:text-lg',
            notice.tone === 'alert' && 'border-rose-600 bg-rose-600 text-xl text-white sm:p-6 sm:text-3xl',
          )}
        >
          {notice.tone === 'ok'
            ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />
            : <AlertTriangle className={cn('mt-0.5 shrink-0', notice.tone === 'alert' ? 'h-8 w-8 sm:h-10 sm:w-10' : 'h-6 w-6')} />}
          <span className="min-w-0 flex-1 break-words">{notice.text}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)} className="p-1"><X className="h-6 w-6" /></button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 text-base font-bold text-rose-800 sm:p-4">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
          <span className="min-w-0 flex-1 break-words">Não foi possível atualizar a lista: {error}</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white px-5 py-10 text-center sm:py-14">
          <Thermometer className="h-14 w-14 text-slate-300" />
          <h2 className="text-2xl font-extrabold">Nenhum equipamento cadastrado</h2>
          <p className="max-w-md text-lg text-slate-500">Um administrador cadastra as geladeiras e freezers no painel, em Temperaturas.</p>
        </div>
      ) : (
        <section aria-label="Equipamentos" className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          {items.map((item) => <EquipmentCard key={item.id} item={item} onPress={() => choose(item)} />)}
        </section>
      )}

      {selected && operator && (
        <KeyboardSheet
          title={selected.name}
          hint={`Faixa cadastrada: ${equipmentRangeText(selected.minTemperature, selected.maxTemperature)}. Digite a temperatura medida agora.`}
          placeholder="Temperatura em °C"
          layout="numeric"
          maxLength={6}
          confirmLabel="Registrar leitura"
          displayValue={(value) => `${value} °C`}
          onCancel={() => setSelected(null)}
          onConfirm={submit}
        />
      )}
    </div>
  );
}

function EquipmentCard({ item, onPress }: { item: EquipmentToday; onPress: () => void }) {
  const missing = missingToday(item);
  const last = item.lastReading;
  const Icon = item.storageType === 'CONGELADO' ? Snowflake : Refrigerator;
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        'flex min-h-[140px] min-w-0 touch-manipulation flex-col gap-2 rounded-3xl border-4 bg-white p-4 text-left shadow-card transition-transform active:scale-[0.98] sm:p-5',
        missing ? 'border-amber-300' : item.outOfRangeToday > 0 ? 'border-rose-300' : 'border-slate-200',
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-1 h-7 w-7 shrink-0', item.storageType === 'CONGELADO' ? 'text-indigo-600' : 'text-sky-600')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="break-words text-2xl font-extrabold leading-tight">{item.name}</div>
          <div className="text-base font-medium text-slate-500">Faixa cadastrada: {equipmentRangeText(item.minTemperature, item.maxTemperature)}</div>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        {missing && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-base font-extrabold text-amber-900">{NO_READING_TODAY}</span>
        )}
        {last && (
          <span className={cn('text-lg font-bold', last.outOfRange ? 'text-rose-700' : 'text-slate-600')}>
            Última: <span className="text-2xl font-extrabold">{formatTemperatureShort(last.temperature)}</span>
            {' · '}{formatDateTimeBR(last.readAt)}{last.responsibleName ? ` · ${last.responsibleName}` : ''}
            {last.outOfRange ? ' · fora da faixa' : ''}
          </span>
        )}
        {!missing && item.outOfRangeToday > 0 && (
          <span className="rounded-full bg-rose-600 px-3 py-1 text-base font-extrabold text-white">
            {item.outOfRangeToday} {item.outOfRangeToday === 1 ? 'leitura fora da faixa hoje' : 'leituras fora da faixa hoje'}
          </span>
        )}
      </div>
    </button>
  );
}

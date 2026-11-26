import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Pencil, Plus, Power, Thermometer } from 'lucide-react';
import { equipmentApi, settingsApi } from '@/services';
import { extractError } from '@/services/api';
import type {
  AppSettings, Equipment, EquipmentReadingRow, EquipmentReadingsMeta, EquipmentToday, StorageType,
} from '@/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadError } from '@/components/ui/LoadError';
import { Modal } from '@/components/ui/Modal';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { shiftDate, useKitchenInfo } from '@/hooks/useKitchenInfo';
import { formatDateTimeBR } from '@/utils/date';
import {
  EQUIPMENT_STORAGE_LABEL, NO_READING_TODAY, equipmentRangeText, missingToday, validateEquipmentForm,
} from '@/utils/equipment';
import { formatTemperatureShort } from '@/utils/temperature';
import { cn } from '@/utils/cn';

/** Temperaturas dos equipamentos (ADMIN): interruptor, cadastro, quadro de hoje e histórico. Não mexe na etiqueta. */
export function EquipmentPage() {
  const { toast } = useToastContext();
  const kitchen = useKitchenInfo();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);

  const [equipment, setEquipment] = useState<Equipment[] | null>(null);
  const [equipmentError, setEquipmentError] = useState('');
  const [today, setToday] = useState<EquipmentToday[] | null>(null);
  const [todayError, setTodayError] = useState('');

  const [editing, setEditing] = useState<Equipment | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<Equipment | null>(null);
  const [deactivateBusy, setDeactivateBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await settingsApi.get();
      setSettings(data.data);
      setSettingsError('');
    } catch (err) {
      setSettingsError(extractError(err));
    }
  }, []);

  const loadEquipment = useCallback(async () => {
    try {
      const { data } = await equipmentApi.list(true);
      setEquipment(data.data);
      setEquipmentError('');
    } catch (err) {
      setEquipmentError(extractError(err));
    }
  }, []);

  const loadToday = useCallback(async () => {
    try {
      const { data } = await equipmentApi.today();
      setToday(data.data);
      setTodayError('');
    } catch (err) {
      setTodayError(extractError(err));
    }
  }, []);

  useEffect(() => { void loadSettings(); void loadEquipment(); void loadToday(); }, [loadSettings, loadEquipment, loadToday]);

  async function toggle() {
    if (!settings || settingsBusy) return;
    setSettingsBusy(true);
    try {
      const { data } = await settingsApi.update({ equipmentTemperatureEnabled: !settings.equipmentTemperatureEnabled });
      setSettings(data.data);
      toast(data.data.equipmentTemperatureEnabled ? 'Registro de temperatura ligado.' : 'Registro de temperatura desligado.', 'success');
      void loadToday();
    } catch (err) {
      toast(extractError(err), 'error');
      void loadSettings(); // a resposta pode ter se perdido: o interruptor volta a refletir o servidor
    } finally {
      setSettingsBusy(false);
    }
  }

  async function deactivate() {
    if (!deactivating || deactivateBusy) return;
    setDeactivateBusy(true);
    try {
      await equipmentApi.deactivate(deactivating.id);
      toast(`${deactivating.name} desativado. O histórico continua.`, 'success');
      setDeactivating(null);
      void loadEquipment();
      void loadToday();
    } catch (err) {
      toast(extractError(err), 'error');
    } finally {
      setDeactivateBusy(false);
    }
  }

  function saved(message: string) {
    toast(message, 'success');
    setEditing(null);
    void loadEquipment();
    void loadToday();
  }

  const enabled = settings?.equipmentTemperatureEnabled === true;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <section className="card bg-white p-4 sm:p-5" aria-labelledby="temp-registro-titulo">
        {settings ? (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="temp-registro-titulo" className="text-base font-bold text-charcoal-800">Registro de temperatura dos equipamentos</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {enabled
                  ? 'Ligado: o totem mostra o botão "Temperaturas" e o operador digita a temperatura medida de cada geladeira ou freezer. É um registro à parte, que não interfere na etiqueta.'
                  : 'Desligado: o totem não mostra o botão. Ligue para registrar a temperatura medida dos equipamentos; a etiqueta não muda.'}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">A temperatura é a que o operador digita, não uma leitura de sensor. As faixas são as que a cozinha cadastra abaixo.</p>
            </div>
            <button
              type="button" role="switch" aria-checked={enabled} aria-labelledby="temp-registro-titulo"
              disabled={settingsBusy} onClick={() => void toggle()}
              className={cn(
                'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60',
                enabled ? 'bg-brand-500' : 'bg-slate-300',
              )}
            >
              <span className={cn('inline-block h-6 w-6 rounded-full bg-white shadow transition-transform', enabled ? 'translate-x-7' : 'translate-x-1')} />
              <span className="sr-only">{enabled ? 'Ligado' : 'Desligado'}</span>
            </button>
          </div>
        ) : settingsError ? (
          <LoadError title="Não foi possível carregar a configuração" message={settingsError} onRetry={() => void loadSettings()} />
        ) : (
          <div className="flex justify-center py-4"><Spinner /></div>
        )}
      </section>

      <TodayBoard items={today} error={todayError} onRetry={() => void loadToday()} />

      <section className="card bg-white p-4 sm:p-5" aria-labelledby="temp-equip-titulo">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="temp-equip-titulo" className="text-base font-bold text-charcoal-800">Equipamentos</h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Novo equipamento
          </button>
        </div>
        {equipmentError && !equipment ? (
          <div className="mt-3"><LoadError title="Não foi possível carregar os equipamentos" message={equipmentError} onRetry={() => void loadEquipment()} /></div>
        ) : !equipment ? (
          <PageLoader />
        ) : equipment.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Nenhum equipamento cadastrado. Cadastre cada geladeira ou freezer com a faixa de temperatura que a cozinha definiu.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {equipment.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <Thermometer className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className={cn('break-words text-sm font-bold', item.active ? 'text-charcoal-800' : 'text-slate-400')}>{item.name}</div>
                  <div className="text-xs text-slate-500">
                    {EQUIPMENT_STORAGE_LABEL[item.storageType]} · faixa {equipmentRangeText(item.minTemperature, item.maxTemperature)}
                  </div>
                </div>
                {item.active ? (
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-outline btn-sm" aria-label={`Editar ${item.name}`} onClick={() => setEditing(item)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" aria-label={`Desativar ${item.name}`} onClick={() => setDeactivating(item)}>
                      <Power className="h-3.5 w-3.5" aria-hidden="true" /> Desativar
                    </button>
                  </div>
                ) : (
                  <span className="badge badge-neutral">Desativado</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <History equipment={equipment ?? []} kitchenToday={kitchen?.kitchenToday ?? null} />

      {editing && (
        <EquipmentFormModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      <ConfirmDialog
        open={deactivating !== null}
        title="Desativar equipamento?"
        body={deactivating ? `${deactivating.name} deixa de aparecer no totem. As leituras já registradas continuam no histórico.` : ''}
        confirmLabel={deactivateBusy ? 'Desativando…' : 'Desativar'}
        danger
        onCancel={() => { if (!deactivateBusy) setDeactivating(null); }}
        onConfirm={() => void deactivate()}
      />
    </div>
  );
}

// ── Hoje ─────────────────────────────────────────────────
function TodayBoard({ items, error, onRetry }: { items: EquipmentToday[] | null; error: string; onRetry: () => void }) {
  return (
    <section className="card bg-white p-4 sm:p-5" aria-labelledby="temp-hoje-titulo">
      <h2 id="temp-hoje-titulo" className="text-base font-bold text-charcoal-800">Hoje</h2>
      {error && !items ? (
        <div className="mt-3"><LoadError title="Não foi possível carregar o quadro de hoje" message={error} onRetry={onRetry} /></div>
      ) : !items ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nenhum equipamento ativo.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs font-bold uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Equipamento</th>
                <th className="py-2 pr-3">Última leitura</th>
                <th className="py-2 pr-3 text-right">Leituras hoje</th>
                <th className="py-2 text-right">Fora da faixa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className={cn(missingToday(item) && 'bg-amber-50/60')}>
                  <td className="py-2 pr-3">
                    <div className="font-bold text-charcoal-800">{item.name}</div>
                    <div className="text-xs text-slate-500">faixa {equipmentRangeText(item.minTemperature, item.maxTemperature)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {missingToday(item) && (
                      <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {NO_READING_TODAY}
                      </span>
                    )}
                    {item.lastReading ? (
                      <div className={cn('text-sm', item.lastReading.outOfRange ? 'font-bold text-rose-700' : 'text-slate-700')}>
                        <strong>{formatTemperatureShort(item.lastReading.temperature)}</strong>
                        {' · '}{formatDateTimeBR(item.lastReading.readAt)}
                        {item.lastReading.responsibleName ? ` · ${item.lastReading.responsibleName}` : ''}
                      </div>
                    ) : (
                      !missingToday(item) && <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-bold">{item.readingsToday}</td>
                  <td className="py-2 text-right">
                    {item.outOfRangeToday > 0
                      ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">{item.outOfRangeToday}</span>
                      : <span className="text-slate-400">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Histórico ────────────────────────────────────────────
function History({ equipment, kitchenToday }: { equipment: Equipment[]; kitchenToday: string | null }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [rows, setRows] = useState<EquipmentReadingRow[] | null>(null);
  const [meta, setMeta] = useState<EquipmentReadingsMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const rangeInverted = Boolean(from && to && to < from);
  const periodInvalid = !from || !to || rangeInverted;

  const load = useCallback(async (params: { from: string; to: string; equipmentId: string }) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await equipmentApi.readings({
        from: params.from, to: params.to, ...(params.equipmentId ? { equipmentId: params.equipmentId } : {}),
      });
      setRows(data.data);
      setMeta(data.meta);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Padrão: últimos 7 dias da cozinha, assim que o "hoje" do servidor chega.
  useEffect(() => {
    if (!kitchenToday || from) return;
    const start = shiftDate(kitchenToday, -6);
    setFrom(start);
    setTo(kitchenToday);
    void load({ from: start, to: kitchenToday, equipmentId: '' });
  }, [kitchenToday, from, load]);

  return (
    <section className="card bg-white p-4 sm:p-5" aria-labelledby="temp-hist-titulo">
      <h2 id="temp-hist-titulo" className="text-base font-bold text-charcoal-800">Histórico de leituras</h2>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(event) => { event.preventDefault(); if (!periodInvalid && !loading) void load({ from, to, equipmentId }); }}
      >
        <div>
          <label htmlFor="hist-from" className="mb-1 block text-xs font-semibold text-slate-600">De</label>
          <input id="hist-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="hist-to" className="mb-1 block text-xs font-semibold text-slate-600">Até</label>
          <input id="hist-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="min-w-[12rem]">
          <label htmlFor="hist-equip" className="mb-1 block text-xs font-semibold text-slate-600">Equipamento</label>
          <select id="hist-equip" className="input" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
            <option value="">Todos</option>
            {equipment.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (desativado)'}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading || periodInvalid}>
          {loading ? <Spinner size="sm" className="text-white" /> : <span>Filtrar</span>}
        </button>
      </form>
      {rangeInverted && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">A data final não pode ser anterior à inicial.</p>}

      {error && (
        <div className="mt-3"><LoadError title="Não foi possível carregar o histórico" message={error} onRetry={() => { if (!periodInvalid) void load({ from, to, equipmentId }); }} /></div>
      )}

      {!error && rows && meta && (
        <>
          <p className="mt-3 text-sm text-slate-600">
            {meta.total} {meta.total === 1 ? 'leitura' : 'leituras'} no período
            {meta.outOfRange > 0 && (
              <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">
                {meta.outOfRange} fora da faixa
              </span>
            )}
          </p>
          {rows.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nenhuma leitura neste período.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Data e hora</th>
                    <th className="py-2 pr-3">Equipamento</th>
                    <th className="py-2 pr-3">Temperatura</th>
                    <th className="py-2 pr-3">Faixa no momento</th>
                    <th className="py-2">Responsável</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className={cn(row.outOfRange && 'bg-rose-50')}>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDateTimeBR(row.readAt)}</td>
                      <td className="py-2 pr-3 font-semibold">
                        {row.equipmentName ?? row.equipment?.name ?? '—'}
                        {row.equipmentCurrentName && row.equipmentCurrentName !== row.equipmentName && (
                          <span className="block text-xs font-normal text-slate-500">hoje: {row.equipmentCurrentName}</span>
                        )}
                        {row.equipmentActive === false && <span className="block text-xs font-normal text-slate-500">(desativado)</span>}
                      </td>
                      <td className={cn('py-2 pr-3 font-bold', row.outOfRange ? 'text-rose-700' : 'text-slate-800')}>
                        {formatTemperatureShort(row.temperature)}
                        {row.outOfRange && <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">Fora da faixa</span>}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{equipmentRangeText(row.minTemperature, row.maxTemperature)}</td>
                      <td className="py-2 text-slate-600">{row.responsibleName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Cadastro ─────────────────────────────────────────────
function EquipmentFormModal({ item, onClose, onSaved }: {
  item: Equipment | null; onClose: () => void; onSaved: (message: string) => void;
}) {
  // A faixa começa vazia no cadastro novo: não há padrão sugerido.
  const [name, setName] = useState(item?.name ?? '');
  const [storageType, setStorageType] = useState<StorageType>(item?.storageType ?? 'REFRIGERADO');
  const [min, setMin] = useState(item ? String(item.minTemperature).replace('.', ',') : '');
  const [max, setMax] = useState(item ? String(item.maxTemperature).replace('.', ',') : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const result = validateEquipmentForm({ name, storageType, min, max });
    if (!result.ok) { setError(result.error); return; }
    setBusy(true);
    setError('');
    try {
      // O armazenamento não muda depois de cadastrado (a API recusa): a edição manda só nome e faixa.
      if (item) {
        const { storageType: _fixed, ...editable } = result.value;
        await equipmentApi.update(item.id, editable);
      }
      else await equipmentApi.create(result.value);
      onSaved(item ? 'Equipamento atualizado.' : 'Equipamento cadastrado.');
    } catch (err) {
      setError(extractError(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={item ? 'Editar equipamento' : 'Novo equipamento'} onClose={onClose} busy={busy} widthClass="max-w-lg">
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="sm:col-span-2">
          <label htmlFor="eq-name" className="mb-1 block text-xs font-bold text-slate-500">Nome</label>
          <input id="eq-name" className="input min-h-[44px]" maxLength={60} placeholder="Ex.: Geladeira da cozinha fria" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="eq-storage" className="mb-1 block text-xs font-bold text-slate-500">Armazenamento</label>
          <select id="eq-storage" className="input min-h-[44px]" disabled={Boolean(item)} title={item ? 'O armazenamento não muda depois de cadastrado.' : undefined} value={storageType} onChange={(e) => setStorageType(e.target.value as StorageType)}>
            <option value="REFRIGERADO">Refrigerado</option>
            <option value="CONGELADO">Congelado</option>
          </select>
        </div>
        <div>
          <label htmlFor="eq-min" className="mb-1 block text-xs font-bold text-slate-500">Mínima (°C)</label>
          <input id="eq-min" className="input min-h-[44px]" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
        </div>
        <div>
          <label htmlFor="eq-max" className="mb-1 block text-xs font-bold text-slate-500">Máxima (°C)</label>
          <input id="eq-max" className="input min-h-[44px]" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2">A faixa é a que a cozinha define para o equipamento; o sistema não sugere valores. Mudar a faixa vale para as próximas leituras; as antigas guardam a faixa de quando foram feitas.</p>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner size="sm" className="text-white" /> : <span>Salvar</span>}
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpenCheck, History, Info, Plus, Power, RefreshCw, Refrigerator, Snowflake, Thermometer,
} from 'lucide-react';
import { productApi, ruleApi } from '@/services';
import { extractError } from '@/services/api';
import type {
  CreateRuleDTO, Product, RuleFilters, RuleSourceType, RuleVersionDTO, ShelfLifeRule, StorageType,
} from '@/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { InlineLoader, Spinner } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { formatBR, formatDateTimeBR } from '@/utils/date';
import { formatTemperatureRange } from '@/utils/temperature';
import { cn } from '@/utils/cn';

const SOURCE_TYPE_LABEL: Record<RuleSourceType, string> = {
  NORMA_LEGAL: 'Norma legal',
  REFERENCIA_TECNICA: 'Referência técnica',
  FABRICANTE: 'Fabricante',
  PROCEDIMENTO_INTERNO: 'Procedimento interno',
};
const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABEL) as RuleSourceType[];
const STORAGE_LABEL: Record<StorageType, string> = { REFRIGERADO: 'Refrigerado', CONGELADO: 'Congelado' };

type Dialog =
  | { kind: 'create' }
  | { kind: 'version'; rule: ShelfLifeRule }
  | { kind: 'history'; rule: ShelfLifeRule }
  | { kind: 'deactivate'; rule: ShelfLifeRule }
  | null;

function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function targetName(rule: ShelfLifeRule): string {
  return rule.product ? `${rule.product.name} (${rule.product.brand})` : `Categoria: ${rule.category ?? '—'}`;
}

export function ShelfLifeRulesPage() {
  const { toast } = useToastContext();
  const [rules, setRules] = useState<ShelfLifeRule[]>([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, page: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(1);
  const [productId, setProductId] = useState('');
  const [category, setCategory] = useState('');
  const [storageType, setStorageType] = useState<StorageType | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // O backend limita a 100 por página: percorre todas para o filtro e o formulário.
    void (async () => {
      const all: Product[] = [];
      for (let current = 1; current <= 50; current++) {
        const { data } = await productApi.list({ limit: 100, page: current, sort: 'name', order: 'asc' });
        all.push(...data.data);
        if (!data.meta.hasNext) break;
      }
      setProducts(all);
    })().catch(() => { /* filtro de produto fica parcial/vazio; a lista segue funcionando */ });
    void productApi.getCategories()
      .then(({ data }) => setCategories(data.data))
      .catch(() => { /* idem */ });
  }, []);

  useEffect(() => { setPage(1); }, [productId, category, storageType, includeInactive]);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const filters: RuleFilters = {
      page, limit: 20,
      productId: productId || undefined,
      category: category || undefined,
      storageType: storageType || undefined,
      includeInactive: includeInactive || undefined,
    };
    try {
      const { data } = await ruleApi.list(filters);
      setRules(data.data);
      setMeta({ total: data.meta.total, totalPages: data.meta.totalPages, page: data.meta.page });
    } catch (error) {
      setRules([]);
      setLoadError(extractError(error));
    } finally {
      setLoading(false);
    }
  }, [page, productId, category, storageType, includeInactive]);

  useEffect(() => { void fetchRules(); }, [fetchRules]);

  async function deactivate(rule: ShelfLifeRule) {
    setBusy(true);
    try {
      await ruleApi.deactivate(rule.id);
      toast('Regra desativada. As etiquetas já geradas continuam guardadas.', 'success');
      setDialog(null);
      void fetchRules();
    } catch (error) {
      toast(extractError(error), 'error');
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  const hasFilters = Boolean(productId || category || storageType || includeInactive);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Regras de validade</h1>
          <p className="page-subtitle">
            {meta.total} {meta.total === 1 ? (includeInactive ? 'regra' : 'regra ativa') : (includeInactive ? 'regras' : 'regras ativas')}{includeInactive ? ' (com inativas)' : ''}
          </p>
        </div>
        <button type="button" className="btn btn-primary shadow-sm" onClick={() => setDialog({ kind: 'create' })}>
          <Plus className="h-4 w-4" />
          <span>Nova regra</span>
        </button>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 text-xs leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span>
          O GastroTag não é um catálogo regulatório e não afirma conformidade sanitária. Os prazos valem pela fonte e
          pelo responsável pela validação que você informar em cada regra.
        </span>
      </div>

      <div className="card grid grid-cols-1 gap-3 bg-white p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-5">
        <select className="input text-xs" aria-label="Filtrar por produto" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Todos os produtos</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name} — {product.brand}</option>)}
        </select>
        <select className="input text-xs" aria-label="Filtrar por categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="input text-xs" aria-label="Filtrar por armazenamento" value={storageType} onChange={(e) => setStorageType(e.target.value as StorageType | '')}>
          <option value="">Todo armazenamento</option>
          <option value="REFRIGERADO">Refrigerado</option>
          <option value="CONGELADO">Congelado</option>
        </select>
        <label className="flex min-h-[2.5rem] items-center gap-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Mostrar inativas
        </label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void fetchRules()} className="btn btn-outline btn-sm gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            <span>Atualizar</span>
          </button>
          {hasFilters && (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-slate-500"
              onClick={() => { setProductId(''); setCategory(''); setStorageType(''); setIncludeInactive(false); }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <InlineLoader text="Carregando regras…" />
      ) : loadError ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{loadError}</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void fetchRules()}>Tentar de novo</button>
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Nenhuma regra encontrada"
          desc={hasFilters
            ? 'Nenhuma regra corresponde aos filtros. Sem regra, a etiqueta usa o prazo do cadastro do produto, com aviso.'
            : 'Sem regra validada, a etiqueta usa o prazo do cadastro do produto, com aviso. Cadastre uma regra com fonte e responsável.'}
          action={<button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}><Plus className="h-4 w-4" /> Nova regra</button>}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {rules.map((rule) => (
              <li key={rule.id}>
                <RuleCard
                  rule={rule}
                  onVersion={() => setDialog({ kind: 'version', rule })}
                  onHistory={() => setDialog({ kind: 'history', rule })}
                  onDeactivate={() => setDialog({ kind: 'deactivate', rule })}
                />
              </li>
            ))}
          </ul>
          <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />
        </>
      )}

      {(dialog?.kind === 'create' || dialog?.kind === 'version') && (
        <RuleFormDialog
          rule={dialog.kind === 'version' ? dialog.rule : null}
          products={products}
          categories={categories}
          onClose={() => setDialog(null)}
          onSaved={(message) => { toast(message, 'success'); setDialog(null); void fetchRules(); }}
        />
      )}
      {dialog?.kind === 'history' && <HistoryDialog rule={dialog.rule} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog?.kind === 'deactivate'}
        danger
        title="Desativar regra?"
        body={dialog?.kind === 'deactivate' ? (
          <>
            A regra de <strong>{targetName(dialog.rule)}</strong> ({STORAGE_LABEL[dialog.rule.storageType]}) deixa de valer
            para novas etiquetas. As etiquetas já geradas continuam guardadas. Sem outra regra, o cálculo volta ao prazo
            do cadastro do produto, com aviso de prazo sem regra validada.
          </>
        ) : null}
        confirmLabel={busy ? 'Desativando…' : 'Desativar'}
        onCancel={() => { if (!busy) setDialog(null); }}
        onConfirm={() => { if (dialog?.kind === 'deactivate' && !busy) void deactivate(dialog.rule); }}
      />
    </div>
  );
}

// ── Cartão ────────────────────────────────────────────────
function RuleCard({ rule, onVersion, onHistory, onDeactivate }: {
  rule: ShelfLifeRule; onVersion: () => void; onHistory: () => void; onDeactivate: () => void;
}) {
  const range = formatTemperatureRange(rule.minTemperature, rule.maxTemperature);
  const Icon = rule.storageType === 'REFRIGERADO' ? Refrigerator : Snowflake;
  return (
    <div className={cn('card flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between', !rule.active && 'bg-slate-50 opacity-80')}>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-words text-base font-bold text-charcoal-800">{targetName(rule)}</h3>
          <span className="badge badge-neutral">v{rule.version}</span>
          {!rule.active && <span className="badge badge-expired">Inativa</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Icon className={cn('h-3.5 w-3.5', rule.storageType === 'REFRIGERADO' ? 'text-sky-600' : 'text-indigo-600')} />
            {STORAGE_LABEL[rule.storageType]}
          </span>
          <span>Prazo: <strong className="text-charcoal-800">{rule.shelfLifeDays} {rule.shelfLifeDays === 1 ? 'dia' : 'dias'}</strong></span>
          {range && (
            <span className="inline-flex items-center gap-1"><Thermometer className="h-3.5 w-3.5 text-slate-400" />{range}</span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          <span className="badge badge-recent mr-2">{SOURCE_TYPE_LABEL[rule.sourceType]}</span>
          <span className="break-words">{rule.source}</span>
        </div>
        {rule.observation && <p className="break-words text-xs text-slate-500">Obs.: {rule.observation}</p>}
        <p className="text-[11px] text-slate-400">
          {rule.validatedByName ? `Validada por ${rule.validatedByName}` : 'Responsável pela validação não registrado'}{rule.validatedAt ? ` em ${formatBR(rule.validatedAt)}` : ''}
          {rule.createdBy ? ` · cadastrada por ${rule.createdBy.name}` : ''}
          {!rule.active && rule.deactivatedAt ? ` · desativada em ${formatDateTimeBR(rule.deactivatedAt)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-slate-100 pt-3 lg:max-w-xs lg:justify-end lg:border-t-0 lg:pt-0">
        {rule.active && (
          <button type="button" className="btn btn-outline btn-sm gap-1.5" onClick={onVersion}>
            <BookOpenCheck className="h-3.5 w-3.5" /> Nova versão
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm gap-1.5" onClick={onHistory}>
          <History className="h-3.5 w-3.5" /> Histórico
        </button>
        {rule.active && (
          <button type="button" className="btn btn-ghost btn-sm gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={onDeactivate}>
            <Power className="h-3.5 w-3.5" /> Desativar
          </button>
        )}
      </div>
    </div>
  );
}

// ── Formulário (criar / nova versão) ──────────────────────
interface FormState {
  target: 'product' | 'category';
  productId: string;
  category: string;
  storageType: StorageType;
  shelfLifeDays: string;
  minTemperature: string;
  maxTemperature: string;
  sourceType: RuleSourceType;
  source: string;
  observation: string;
  validatedByName: string;
  validatedAt: string;
}

function tempText(value: number | null | undefined): string {
  return value == null ? '' : String(value).replace('.', ',');
}

/** Campo opcional: vazio vira null; inválido vira undefined. Faixa da API: −50 a 100. */
function parseOptionalTemp(text: string): number | null | undefined {
  const clean = text.replace(/[−‒–]/g, '-').replace(/\s+/g, '').replace(',', '.');
  if (clean === '') return null;
  if (!/^[-+]?\d+(\.\d+)?$/.test(clean)) return undefined;
  const value = Number(clean);
  return value >= -50 && value <= 100 ? value : undefined;
}

function RuleFormDialog({ rule, products, categories, onClose, onSaved }: {
  rule: ShelfLifeRule | null;
  products: Product[];
  categories: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isVersion = rule !== null;
  const today = useMemo(todayLocal, []);
  const [form, setForm] = useState<FormState>(() => ({
    target: rule?.category ? 'category' : 'product',
    productId: rule?.productId ?? '',
    category: rule?.category ?? '',
    storageType: rule?.storageType ?? 'REFRIGERADO',
    shelfLifeDays: rule ? String(rule.shelfLifeDays) : '',
    minTemperature: tempText(rule?.minTemperature),
    maxTemperature: tempText(rule?.maxTemperature),
    sourceType: rule?.sourceType ?? 'REFERENCIA_TECNICA',
    source: rule?.source ?? '',
    observation: rule?.observation ?? '',
    validatedByName: rule?.validatedByName ?? '',
    // Nova versão exige nova validação: a data não é herdada.
    validatedAt: isVersion ? '' : today,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  }

  function validate(): RuleVersionDTO | string {
    if (!isVersion) {
      if (form.target === 'product' && !form.productId) return 'Escolha o produto da regra.';
      if (form.target === 'category' && !form.category) return 'Escolha a categoria da regra.';
    }
    const days = Number(form.shelfLifeDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return 'O prazo deve ser um número inteiro de 1 a 3650 dias.';
    const min = parseOptionalTemp(form.minTemperature);
    const max = parseOptionalTemp(form.maxTemperature);
    if (min === undefined || max === undefined) return 'Temperatura mínima e máxima devem ser números entre −50 e 100 °C.';
    if (min !== null && max !== null && min > max) return 'A temperatura mínima não pode ser maior que a máxima.';
    const source = form.source.trim();
    if (source.length < 3 || source.length > 300) return 'Informe a referência ou fonte (3 a 300 caracteres).';
    if (form.observation.trim().length > 500) return 'A observação aceita até 500 caracteres.';
    const name = form.validatedByName.trim();
    if (name.length < 2 || name.length > 100) return 'Informe o responsável pela validação (2 a 100 caracteres).';
    if (!form.validatedAt) return 'Informe a data da validação.';
    if (form.validatedAt > today) return 'A data da validação não pode ser futura.';
    return {
      shelfLifeDays: days,
      minTemperature: min,
      maxTemperature: max,
      sourceType: form.sourceType,
      source,
      observation: form.observation.trim() || null,
      validatedByName: name,
      validatedAt: form.validatedAt,
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const result = validate();
    if (typeof result === 'string') { setError(result); return; }
    setSaving(true);
    setError('');
    try {
      if (rule) {
        await ruleApi.newVersion(rule.id, result);
        onSaved(`Nova versão criada (v${rule.version + 1}). A anterior ficou guardada para as etiquetas já geradas.`);
      } else {
        const payload: CreateRuleDTO = {
          ...result,
          storageType: form.storageType,
          ...(form.target === 'product' ? { productId: form.productId } : { category: form.category.trim() }),
        };
        await ruleApi.create(payload);
        onSaved('Regra criada.');
      }
    } catch (err) {
      setError(extractError(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={rule ? `Nova versão — ${targetName(rule)}` : 'Nova regra de validade'} onClose={() => { if (!saving) onClose(); }}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {rule ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Os campos vêm preenchidos com a versão atual (v{rule.version}). Ao salvar, ela é desativada e fica
              guardada: as etiquetas já geradas continuam apontando para o prazo e a fonte que valiam na hora. Registre
              quem validou e a data da nova versão.
            </span>
          </div>
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">Vale para</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex min-h-[2.5rem] items-center gap-2">
                <input type="radio" name="target" className="accent-brand-600" checked={form.target === 'product'} onChange={() => set('target', 'product')} />
                Produto
              </label>
              <label className="flex min-h-[2.5rem] items-center gap-2">
                <input type="radio" name="target" className="accent-brand-600" checked={form.target === 'category'} onChange={() => set('target', 'category')} />
                Categoria
              </label>
            </div>
            {form.target === 'product' ? (
              <select className="input" aria-label="Produto" value={form.productId} onChange={(e) => set('productId', e.target.value)}>
                <option value="">Selecione o produto</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name} — {product.brand}</option>)}
              </select>
            ) : (
              <select className="input" aria-label="Categoria" value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Selecione a categoria</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            )}
          </fieldset>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Armazenamento" htmlFor="rule-storage">
            <select id="rule-storage" className="input" value={form.storageType} disabled={isVersion} onChange={(e) => set('storageType', e.target.value as StorageType)}>
              <option value="REFRIGERADO">Refrigerado</option>
              <option value="CONGELADO">Congelado</option>
            </select>
          </Field>
          <Field label="Prazo após a abertura (dias)" htmlFor="rule-days">
            <input id="rule-days" className="input" inputMode="numeric" value={form.shelfLifeDays} onChange={(e) => set('shelfLifeDays', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Ex.: 3" />
          </Field>
          <Field label="Temperatura mínima (°C, opcional)" htmlFor="rule-min">
            <input id="rule-min" className="input" inputMode="decimal" value={form.minTemperature} onChange={(e) => set('minTemperature', e.target.value)} placeholder="Ex.: 0" maxLength={6} />
          </Field>
          <Field label="Temperatura máxima (°C, opcional)" htmlFor="rule-max">
            <input id="rule-max" className="input" inputMode="decimal" value={form.maxTemperature} onChange={(e) => set('maxTemperature', e.target.value)} placeholder="Ex.: 5" maxLength={6} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tipo de fonte" htmlFor="rule-source-type">
            <select id="rule-source-type" className="input" value={form.sourceType} onChange={(e) => set('sourceType', e.target.value as RuleSourceType)}>
              {SOURCE_TYPES.map((type) => <option key={type} value={type}>{SOURCE_TYPE_LABEL[type]}</option>)}
            </select>
          </Field>
          <Field label="Referência / fonte" htmlFor="rule-source">
            <input id="rule-source" className="input" value={form.source} maxLength={300} onChange={(e) => set('source', e.target.value)} placeholder="Ex.: rótulo do fabricante, POP-012" />
          </Field>
        </div>

        <Field label="Observação (opcional)" htmlFor="rule-obs">
          <textarea id="rule-obs" className="input min-h-[4.5rem]" maxLength={500} value={form.observation} onChange={(e) => set('observation', e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Responsável pela validação" htmlFor="rule-validator">
            <input id="rule-validator" className="input" maxLength={100} value={form.validatedByName} onChange={(e) => set('validatedByName', e.target.value)} placeholder="Nome do responsável técnico" />
          </Field>
          <Field label="Data da validação" htmlFor="rule-validated-at">
            <input id="rule-validated-at" type="date" className="input" max={today} value={form.validatedAt} onChange={(e) => set('validatedAt', e.target.value)} />
          </Field>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-outline w-full sm:w-auto" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={saving}>
            {saving ? <Spinner size="sm" className="text-white" /> : isVersion ? 'Salvar nova versão' : 'Criar regra'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600">{label}</label>
      {children}
    </div>
  );
}

// ── Histórico ─────────────────────────────────────────────
function HistoryDialog({ rule, onClose }: { rule: ShelfLifeRule; onClose: () => void }) {
  const [versions, setVersions] = useState<ShelfLifeRule[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    ruleApi.versions(rule.id)
      .then(({ data }) => { if (active) setVersions(data.data); })
      .catch((err) => { if (active) setError(extractError(err)); });
    return () => { active = false; };
  }, [rule.id]);

  return (
    <Modal title={`Histórico — ${targetName(rule)}`} onClose={onClose}>
      {error ? (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>
      ) : !versions ? (
        <InlineLoader text="Carregando versões…" />
      ) : (
        <ol className="space-y-3">
          {versions.map((item) => {
            const range = formatTemperatureRange(item.minTemperature, item.maxTemperature);
            return (
              <li key={item.id} className={cn('rounded-2xl border p-3.5 text-xs', item.active ? 'border-brand-500/60 bg-orange-50/40' : 'border-slate-200 bg-slate-50')}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="badge badge-neutral">v{item.version}</span>
                  <span className={cn('badge', item.active ? 'badge-valid' : 'badge-expired')}>{item.active ? 'Em vigor' : 'Substituída ou desativada'}</span>
                  <strong className="text-charcoal-800">{item.shelfLifeDays} {item.shelfLifeDays === 1 ? 'dia' : 'dias'}</strong>
                  <span className="text-slate-500">{STORAGE_LABEL[item.storageType]}{range ? ` · ${range}` : ''}</span>
                </div>
                <p className="break-words text-slate-600">{SOURCE_TYPE_LABEL[item.sourceType]}: {item.source}</p>
                {item.observation && <p className="break-words text-slate-500">Obs.: {item.observation}</p>}
                <p className="mt-1 text-[11px] text-slate-400">
                  {item.validatedByName ? `Validada por ${item.validatedByName}` : 'Responsável pela validação não registrado'}{item.validatedAt ? ` em ${formatBR(item.validatedAt)}` : ''}
                  {item.createdBy ? ` · cadastrada por ${item.createdBy.name}` : ''} · criada em {formatDateTimeBR(item.createdAt)}
                  {item.deactivatedAt ? ` · encerrada em ${formatDateTimeBR(item.deactivatedAt)}` : ''}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}

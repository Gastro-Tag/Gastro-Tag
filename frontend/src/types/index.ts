// ── API envelope ───────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data:    T;
}

export interface PaginatedResponse<T> {
  success:  boolean;
  data:     T[];
  meta: {
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
    hasNext:    boolean;
    hasPrev:    boolean;
  };
}

// ── Auth ────────────────────────────────────────────────
export type UserRole = 'ADMIN' | 'OPERATOR';

export interface User {
  id:    string;
  name:  string;
  email: string;
  role:  UserRole;
}

export interface ManagedUser extends User {
  active:    boolean;
  createdAt: string;
  /** Tem PIN de operador definido (o PIN em si nunca vem do servidor). */
  hasPin?:   boolean;
}

export interface CreateUserDTO {
  name:     string;
  email:    string;
  role:     UserRole;
  password: string;
}

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
  user?:        User;
}

// ── Product ─────────────────────────────────────────────
export type ProductStatus = 'all' | 'valid' | 'expiring' | 'expired' | 'recent' | 'no_lot';
export type StorageType   = 'REFRIGERADO' | 'CONGELADO';

export interface ProductLot {
  id:              string;
  productId:       string;
  code:            string;
  expiryDate:      string;  // ISO date string
  daysUntilExpiry: number;
  computedStatus:  'valid' | 'expiring' | 'expired';
  /** Lote criado na migração: a validade antiga ainda precisa ser conferida. */
  needsReview:     boolean;
}

export interface Product {
  id:                     string;
  name:                   string;
  brand:                  string;
  category?:              string;
  daysValidRefrigerated:  number;
  daysValidFrozen:        number;
  unit?:                  string;
  notes?:                 string;
  active:                 boolean;
  createdAt:              string;
  updatedAt:              string;
  // computed
  nextExpiryDate:         string | null;
  daysUntilExpiry:        number | null;
  expiredLotCount:        number;
  pendingLotCount:        number;
  labelCount:             number;
  computedStatus:         'valid' | 'expiring' | 'expired' | 'no_lot';
  /** Lotes ativos, do mais próximo de vencer ao mais distante. Só em `getById`. */
  lots?:                  ProductLot[];
}

export interface CreateProductDTO {
  name:                   string;
  brand:                  string;
  /** `null` remove a categoria (edição). */
  category?:              string | null;
  daysValidRefrigerated:  number;
  daysValidFrozen:        number;
  unit?:                  string;
  notes?:                 string;
}

export interface ProductFilters {
  search?:   string;
  status?:   ProductStatus;
  storage?:  'refrigerado' | 'congelado' | '';
  category?: string;
  sort?:     'name' | 'brand' | 'date' | 'created';
  order?:    'asc' | 'desc';
  page?:     number;
  limit?:    number;
}

// ── Label ───────────────────────────────────────────────
export interface Label {
  id:          string;
  shortCode:   string;
  productId:   string;
  userId:      string;
  lot:         string;
  openedAt:    string;
  discardAt:   string;
  storageType: StorageType;
  /** Texto padronizado pelo servidor (ex.: "4,0 °C"); etiquetas antigas mantêm o texto original. */
  storageTemp: string;
  /** Número informado; nulo nas etiquetas antigas sem conversão possível. */
  storageTemperature?: number | null;
  ruleVersion?: number | null;
  /** Fonte da regra no momento da etiqueta (ou aviso de prazo sem regra validada). */
  ruleSource?: string | null;
  lotId?: string | null;
  /** Só vem em GET /labels (lista). Ausente em getById, /labels/due e nas respostas de criar/dividir/encerrar. */
  lotSource?: LotSource;
  ruleId?: string | null;
  shelfLifeDays?: number;
  originalExpiryDate?: string;
  cappedByOriginalExpiry?: boolean;
  productName?: string;
  productBrand?: string;
  responsibleName?: string | null;
  rule?: { id: string; shelfLifeDays: number; source: string; sourceType?: RuleSourceType | null; observation?: string | null } | null;
  printedAt?:  string;
  printCount:  number;
  createdAt:   string;
  product?:    Pick<Product, 'id' | 'name' | 'brand'>;
  user?:       { name: string };
  // Etapa F: destino e fracionamento
  status:        LabelStatus;
  outcome?:      LabelOutcome | null;
  discardReason?: DiscardReason | null;
  closeNote?:    string | null;
  closedAt?:     string | null;
  closedByName?: string | null;
  parentLabelId?: string | null;
  /** Dia em que a etiqueta foi dividida (YYYY-MM-DD); só nas filhas. */
  fractionedAt?: string | null;
  /** A data de descarte foi limitada pela etiqueta de origem. */
  cappedByParent?: boolean;
  /** Número de filhas (itens da lista). */
  childrenCount?: number;
  parent?:       { id: string; shortCode: string } | null;
  /** Só em GET /labels/:id. */
  children?:     LabelChild[];
  // Etapa G1: operador confirmado por PIN
  handlerId?:       string | null;
  /** O responsável foi confirmado por PIN no totem. */
  handlerVerified?: boolean;
}

export type LabelStatus  = 'ATIVA' | 'ENCERRADA';
export type LabelOutcome = 'USADO' | 'DESCARTADO' | 'CANCELADO';
export type DiscardReason = 'PRAZO_VENCIDO' | 'ALTERACAO_SENSORIAL' | 'EMBALAGEM_DANIFICADA' | 'OUTRO';

export interface LabelChild {
  id:        string;
  shortCode: string;
  status:    LabelStatus;
  discardAt: string;
}

export interface CloseLabelDTO {
  outcome:        LabelOutcome;
  /** Obrigatório se e só se DESCARTADO. */
  discardReason?: DiscardReason;
  /** Obrigatória (mín. 3) quando o motivo é OUTRO; até 300 caracteres. */
  note?:          string;
  /** Totem sem PIN: nome de quem encerrou (1..100). Sem ele, vale o nome da conta logada. */
  responsibleName?: string;
  /** Operador confirmado por PIN; o servidor usa o nome dele e ignora responsibleName. */
  handlerToken?:  string;
}

export interface CloseLabelResult {
  success: boolean;
  data:    Label;
  meta:    { activeChildren: Pick<LabelChild, 'id' | 'shortCode' | 'discardAt'>[] };
}

export interface SplitPreviewDTO {
  storageType:         StorageType;
  storageTemperature?: number;
}

export interface SplitPreview {
  discardAt: string;
  cappedByParent: boolean;
  cappedByOriginalExpiry: boolean;
  fractionedAt: string;
  rule: PreviewRule;
  storageTemperature: number | null;
  storageTemp: string | null;
}

export interface SplitLabelDTO {
  count:              number;
  storageType:        StorageType;
  storageTemperature: number;
  responsibleName:    string;
  closeParent?:       boolean;
  requestId?:         string;
  handlerToken?:      string;
}

export interface SplitResult {
  parent:   Label;
  children: Label[];
}

/** Origem do lote: cadastrado, "Outra embalagem" (validade digitada) ou anterior ao cadastro de lotes. */
export type LotSource = 'cadastrado' | 'informado' | 'anterior';

export interface LabelListParams {
  productId?: string; userId?: string; page?: number; limit?: number;
  q?: string; from?: string; to?: string; storageType?: string;
  status?: LabelStatus;
  /** Só com status ATIVA. */
  due?: 'expired' | 'today' | 'upcoming';
  lotSource?: LotSource;
  parentLabelId?: string;
}

/** Filtros da exportação CSV (ADMIN). `from`/`to` valem para a data de criação. */
export interface LabelExportParams {
  q?: string; from?: string; to?: string; storageType?: string;
  status?: LabelStatus;
  due?: 'expired' | 'today' | 'upcoming';
  lotSource?: LotSource;
  productId?: string;
  parentLabelId?: string;
}

/** GET /labels/due: etiquetas ATIVAS agrupadas pela data da cozinha. */
export interface DueLabels {
  expired:  Label[];
  today:    Label[];
  tomorrow: Label[];
}

export interface DueLabelsMeta {
  counts: { expired: number; today: number; tomorrow: number };
  kitchenToday: string;
}

export interface DueLabelsResult {
  success: boolean;
  data:    DueLabels;
  meta:    DueLabelsMeta;
}

/** Operador com PIN, listado no totem. */
export interface TotemOperator {
  id:   string;
  name: string;
}

export interface VerifyOperatorResult {
  operator:     TotemOperator;
  handlerToken: string;
  /** ISO 8601; fim da validade do token (turno de até 10 h). */
  expiresAt:    string;
}

/** Datas da cozinha: limite para trás da abertura. */
export interface KitchenInfo {
  kitchenToday:    string;
  maxBackdateDays: number;
  requireValidatedRule?: boolean;
}

export interface LabelPreview {
  product: Pick<Product, 'id' | 'name' | 'brand'>;
  storageType: StorageType;
  lot: { id: string; code: string } | null;
  openedAt: string;
  discardAt: string;
  rule: PreviewRule;
  /** Número informado (nulo se o preview rodou sem temperatura). */
  storageTemperature: number | null;
  storageTemp: string | null;
  originalExpiryDate: string;
  cappedByOriginalExpiry: boolean;
  /** Só com validade digitada (embalagem na mão); nulo com lote cadastrado. */
  expiryWarning?: ExpiryWarning | null;
}

export interface ExpiryWarning {
  reason: 'ABOVE_HISTORY' | 'ABOVE_LIMIT';
  typedDays: number;
  referenceDays: number;
  limitMonths: number | null;
}

export interface PreviewRule {
  id: string | null;
  shelfLifeDays: number;
  source: string;
  sourceType: RuleSourceType | null;
  observation: string | null;
  minTemperature: number | null;
  maxTemperature: number | null;
  version: number | null;
  validatedByName: string | null;
  validatedAt: string | null;
  /** false quando o prazo veio do cadastro do produto, sem regra validada. */
  validated: boolean;
}

/** A validade vem de um lote cadastrado ou da embalagem em mãos. */
export type ExpirySource =
  | { lotId: string; originalExpiryDate?: undefined }
  | { lotId?: undefined; originalExpiryDate: string };

interface LabelBaseDTO {
  productId:   string;
  /** Sem valor, o servidor usa a data atual da cozinha. */
  openedAt?:   string;
  storageType: StorageType;
}

export type LabelPreviewDTO = ExpirySource & LabelBaseDTO & {
  /** Opcional no preview; o servidor só valida a faixa da regra quando informada. */
  storageTemperature?: number;
};

export type CreateLabelDTO = ExpirySource & LabelBaseDTO & {
  /** Obrigatório: temperatura confirmada pelo operador, em °C. */
  storageTemperature: number;
  /** Só para embalagem avulsa: lote cadastrado já traz o código. */
  lot?:        string;
  responsibleName: string;
  /** Igual em cada reenvio do mesmo pedido: o servidor devolve a etiqueta já criada. */
  requestId?:  string;
  /** Operador confirmado por PIN (totem). Quando válido, o servidor usa o nome dele. */
  handlerToken?: string;
};

// ── Regras de validade ──────────────────────────────────
export type RuleSourceType = 'NORMA_LEGAL' | 'REFERENCIA_TECNICA' | 'FABRICANTE' | 'PROCEDIMENTO_INTERNO';

export interface ShelfLifeRule {
  id:                string;
  productId:         string | null;
  category:          string | null;
  storageType:       StorageType;
  shelfLifeDays:     number;
  minTemperature:    number | null;
  maxTemperature:    number | null;
  sourceType:        RuleSourceType;
  source:            string;
  observation:       string | null;
  validatedByName:   string | null;
  validatedAt:       string | null;  // YYYY-MM-DD
  version:           number;
  previousVersionId: string | null;
  active:            boolean;
  deactivatedAt:     string | null;
  createdAt:         string;
  product:           Pick<Product, 'id' | 'name' | 'brand'> | null;
  createdBy:         { name: string } | null;
}

/** Produto ativo que ainda imprime etiqueta "sem regra validada" (GET /products/without-rule, ADMIN). */
export interface ProductWithoutRule {
  id:       string;
  name:     string;
  brand:    string;
  category: string | null;
  missing:  { storageType: StorageType; productDays: number }[];
}

export interface ProductsWithoutRuleMeta {
  total:        number;
  missingCount: number;
}

/** GET/PUT /settings: configuração da cozinha (PUT só ADMIN). */
export interface AppSettings {
  requireValidatedRule: boolean;
  /** Meses acima dos quais a validade digitada gera aviso; null = desligado. */
  expiryWarningMonths:  number | null;
  updatedAt:            string | null;
  updatedByName:        string | null;
}

/** meta do PUT /settings: o que fica bloqueado com a exigência ligada. */
export interface SettingsUpdateMeta {
  blockedProducts:     number;
  blockedCombinations: number;
}

export interface RuleFilters {
  productId?:       string;
  category?:        string;
  storageType?:     StorageType;
  includeInactive?: boolean;
  page?:            number;
  limit?:           number;
}

/** Campos que mudam a cada versão. */
export interface RuleVersionDTO {
  shelfLifeDays:   number;
  minTemperature?: number | null;
  maxTemperature?: number | null;
  sourceType:      RuleSourceType;
  source:          string;
  observation?:    string | null;
  validatedByName: string;
  validatedAt:     string;
}

/** Exatamente um entre productId e category. */
export interface CreateRuleDTO extends RuleVersionDTO {
  productId?:  string;
  category?:   string;
  storageType: StorageType;
}

// ── Dashboard ───────────────────────────────────────────
export interface DashboardStats {
  products: {
    total:    number;
    expired:  number;
    expiring: number;
    valid:    number;
    recent:   number;
  };
  labels: {
    total:     number;
    today:     number;
    thisWeek:  number;
    byStorage: Record<string, number>;
  };
  topProducts: { id: string; name: string; brand: string; labelCount: number }[];
}

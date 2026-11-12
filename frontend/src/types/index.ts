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
  category?:              string;
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
  ruleId?: string | null;
  shelfLifeDays?: number;
  originalExpiryDate?: string;
  cappedByOriginalExpiry?: boolean;
  productName?: string;
  productBrand?: string;
  responsibleName?: string | null;
  rule?: { id: string; shelfLifeDays: number; source: string; observation?: string | null } | null;
  printedAt?:  string;
  printCount:  number;
  createdAt:   string;
  product?:    Pick<Product, 'id' | 'name' | 'brand'>;
  user?:       { name: string };
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

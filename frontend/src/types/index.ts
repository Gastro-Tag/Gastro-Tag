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
export interface User {
  id:    string;
  name:  string;
  email: string;
  role:  'ADMIN' | 'OPERATOR';
}

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
  user?:        User;
}

// ── Product ─────────────────────────────────────────────
export type ProductStatus = 'all' | 'valid' | 'expiring' | 'expired' | 'recent';
export type StorageType   = 'REFRIGERADO' | 'CONGELADO';

export interface Product {
  id:                     string;
  name:                   string;
  brand:                  string;
  category?:              string;
  originalExpiryDate:     string;  // ISO date string
  daysValidRefrigerated:  number;
  daysValidFrozen:        number;
  unit?:                  string;
  notes?:                 string;
  active:                 boolean;
  createdAt:              string;
  updatedAt:              string;
  // computed
  daysUntilExpiry:        number;
  labelCount:             number;
  computedStatus:         'valid' | 'expiring' | 'expired';
}

export interface CreateProductDTO {
  name:                   string;
  brand:                  string;
  category?:              string;
  originalExpiryDate:     string;
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
  storageTemp: string;
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
  openedAt: string;
  discardAt: string;
  rule: { id: string | null; shelfLifeDays: number; source: string; observation?: string | null };
  originalExpiryDate: string;
  cappedByOriginalExpiry: boolean;
}

export interface CreateLabelDTO {
  productId:   string;
  lot:         string;
  responsibleName: string;
  openedAt:    string;
  storageType: StorageType;
  storageTemp: string;
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

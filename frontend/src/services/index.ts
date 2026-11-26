import { api } from './api';
import type {
  ApiResponse, PaginatedResponse, AuthTokens, User, ManagedUser, CreateUserDTO,
  Product, ProductLot, CreateProductDTO, ProductFilters,
  Label, CreateLabelDTO, LabelPreview, LabelPreviewDTO,
  CloseLabelDTO, CloseLabelResult, SplitPreview, SplitPreviewDTO, SplitLabelDTO, SplitResult, LabelListParams,
  ShelfLifeRule, RuleFilters, AppSettings, SettingsUpdateMeta, ProductWithoutRule, ProductsWithoutRuleMeta, RuleVersionDTO, CreateRuleDTO,
  DashboardStats,
  DueLabelsResult, KitchenInfo, LabelMetrics, LabelMetricsParams, LabelExportParams, TotemOperator, VerifyOperatorResult,
} from '@/types';
import type { LabelTemplateId } from '@/utils/labelTemplates';

// ── Auth ────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<ApiResponse<AuthTokens & { user: User }>>('/auth/login', { email, password }),

  refresh: (refreshToken: string) =>
    api.post<ApiResponse<AuthTokens>>('/auth/refresh', { refreshToken }),

  /** Usa o refresh token: encerra a sessão mesmo com o token de acesso vencido. */
  logout: (refreshToken: string) =>
    api.post<ApiResponse<null>>('/auth/logout', { refreshToken }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch<ApiResponse<null>>('/auth/password', { currentPassword, newPassword }),

  verifyAdmin: (email: string, password: string) =>
    api.post<ApiResponse<{ valid: boolean }>>('/auth/verify-admin', { email, password }),

  /** `meta` traz kitchenToday e maxBackdateDays (G1); pode vir também dentro de `data`. */
  me: () =>
    api.get<ApiResponse<User & Partial<KitchenInfo>> & { meta?: Partial<KitchenInfo> }>('/auth/me'),
};

// ── Users ───────────────────────────────────────────────
export const userApi = {
  list: () =>
    api.get<ApiResponse<ManagedUser[]>>('/users'),

  create: (data: CreateUserDTO) =>
    api.post<ApiResponse<ManagedUser>>('/users', data),

  update: (id: string, data: Partial<Omit<CreateUserDTO, 'password'>> & { active?: boolean }) =>
    api.put<ApiResponse<ManagedUser>>(`/users/${id}`, data),

  resetPassword: (id: string, password: string) =>
    api.patch<ApiResponse<null>>(`/users/${id}/password`, { password }),

  /** PIN de operador (4 a 6 dígitos); `null` remove. ADMIN. */
  setPin: (id: string, pin: string | null) =>
    api.patch<ApiResponse<ManagedUser>>(`/users/${id}/pin`, { pin }),

  unlockPin: (id: string) =>
    api.post<ApiResponse<ManagedUser>>(`/users/${id}/pin/unlock`),
};

// ── Totem: operador com PIN ─────────────────────────────
export const totemApi = {
  operators: () =>
    api.get<ApiResponse<TotemOperator[]>>('/totem/operators'),

  /** 401 com PIN incorreto; 429 após 5 falhas em 15 min. */
  verifyOperator: (userId: string, pin: string) =>
    api.post<ApiResponse<VerifyOperatorResult>>('/totem/operators/verify', { userId, pin }),
};

// ── Products ────────────────────────────────────────────
export const productApi = {
  list: (filters?: ProductFilters) =>
    api.get<PaginatedResponse<Product>>('/products', { params: filters }),

  getById: (id: string) =>
    api.get<ApiResponse<Product>>(`/products/${id}`),

  create: (data: CreateProductDTO) =>
    api.post<ApiResponse<Product>>('/products', data),

  update: (id: string, data: Partial<CreateProductDTO>) =>
    api.put<ApiResponse<Product>>(`/products/${id}`, data),

  remove: (id: string) =>
    api.delete<ApiResponse<null>>(`/products/${id}`),

  /** Sem opções: só as categorias em uso. Com `withDefaults`: lista padrão + em uso, sem duplicatas. */
  getCategories: (opts?: { withDefaults?: boolean }) =>
    api.get<ApiResponse<string[]>>('/products/categories', {
      params: opts?.withDefaults ? { withDefaults: true } : undefined,
    }),

  /** ADMIN: produtos ativos que ainda imprimem etiqueta sem regra validada. */
  withoutRule: () =>
    api.get<ApiResponse<ProductWithoutRule[]> & { meta: ProductsWithoutRuleMeta }>('/products/without-rule'),
};

// ── Lots ────────────────────────────────────────────────
export const lotApi = {
  create: (productId: string, data: { code: string; expiryDate: string }) =>
    api.post<ApiResponse<ProductLot>>(`/products/${productId}/lots`, data),

  update: (productId: string, lotId: string, data: { code?: string; expiryDate?: string }) =>
    api.put<ApiResponse<ProductLot>>(`/products/${productId}/lots/${lotId}`, data),

  remove: (productId: string, lotId: string) =>
    api.delete<ApiResponse<ProductLot>>(`/products/${productId}/lots/${lotId}`),
};

// ── Labels ──────────────────────────────────────────────
export const labelApi = {
  list: (params?: LabelListParams) =>
    api.get<PaginatedResponse<Label>>('/labels', { params }),

  preview: (data: LabelPreviewDTO) =>
    api.post<ApiResponse<LabelPreview>>('/labels/preview', data),

  getById: (id: string) =>
    api.get<ApiResponse<Label>>(`/labels/${id}`),

  create: (data: CreateLabelDTO) =>
    api.post<ApiResponse<Label>>('/labels', data),

  registerPrint: (id: string) =>
    api.patch<ApiResponse<Label>>(`/labels/${id}/print`),

  /** Registra o destino (Usado/Descartado/Cancelado). Sem desfazer. */
  close: (id: string, data: CloseLabelDTO) =>
    api.post<CloseLabelResult>(`/labels/${id}/close`, data),

  /** Etiquetas ATIVAS vencidas, que vencem hoje e amanhã (data da cozinha). */
  due: () =>
    api.get<DueLabelsResult>('/labels/due'),

  /** Números da cozinha (ADMIN): tempo do fluxo e origem da temperatura. Sem datas, últimos 7 dias. */
  metrics: (params?: LabelMetricsParams) =>
    api.get<ApiResponse<LabelMetrics>>('/labels/metrics', { params }),

  /** CSV (ADMIN) com os filtros da lista + período de criação. Devolve o arquivo e o nome sugerido. */
  exportCsv: async (params: LabelExportParams): Promise<{ blob: Blob; filename: string }> => {
    try {
      const response = await api.get<Blob>('/labels/export.csv', { params, responseType: 'blob', timeout: 60_000 });
      const disposition = String(response.headers['content-disposition'] ?? '');
      const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? 'etiquetas.csv';
      return { blob: response.data, filename };
    } catch (err) {
      // Com responseType blob, o corpo do erro também vem como Blob: converte para o JSON da API.
      const body = (err as { response?: { data?: unknown } }).response?.data;
      if (body instanceof Blob) {
        try { (err as { response: { data: unknown } }).response.data = JSON.parse(await body.text()); } catch { /* corpo não é JSON */ }
      }
      throw err;
    }
  },

  splitPreview: (id: string, data: SplitPreviewDTO) =>
    api.post<ApiResponse<SplitPreview>>(`/labels/${id}/split/preview`, data),

  /** 201 na criação, 200 no reenvio com o mesmo requestId. */
  split: (id: string, data: SplitLabelDTO) =>
    api.post<ApiResponse<SplitResult>>(`/labels/${id}/split`, data),
};

// ── Regras de validade (ADMIN) ──────────────────────────
export const ruleApi = {
  list: (filters?: RuleFilters) =>
    api.get<PaginatedResponse<ShelfLifeRule>>('/shelf-life-rules', { params: filters }),

  /** Cadeia de versões da regra, da mais nova para a mais antiga. */
  versions: (id: string) =>
    api.get<ApiResponse<ShelfLifeRule[]>>(`/shelf-life-rules/${id}/versions`),

  create: (data: CreateRuleDTO) =>
    api.post<ApiResponse<ShelfLifeRule>>('/shelf-life-rules', data),

  /** PUT cria uma nova versão e desativa a anterior; nunca edita no lugar. */
  newVersion: (id: string, data: RuleVersionDTO) =>
    api.put<ApiResponse<ShelfLifeRule>>(`/shelf-life-rules/${id}`, data),

  deactivate: (id: string) =>
    api.delete<ApiResponse<ShelfLifeRule>>(`/shelf-life-rules/${id}`),
};

// ── Dashboard ────────────────────────────────────────────
export const dashboardApi = {
  getStats: () =>
    api.get<ApiResponse<DashboardStats>>('/dashboard/stats'),
};

// ── Configurações ───────────────────────────────────────
export const settingsApi = {
  get: () =>
    api.get<ApiResponse<AppSettings>>('/settings'),

  /** ADMIN. `meta` traz quantos produtos/combinações ficam bloqueados. */
  update: (changes: { requireValidatedRule?: boolean; expiryWarningMonths?: number | null; labelTemplate?: LabelTemplateId | null }) =>
    api.put<ApiResponse<AppSettings> & { meta: SettingsUpdateMeta }>('/settings', changes),
};

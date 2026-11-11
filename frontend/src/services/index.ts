import { api } from './api';
import type {
  ApiResponse, PaginatedResponse, AuthTokens, User, ManagedUser, CreateUserDTO,
  Product, ProductLot, CreateProductDTO, ProductFilters,
  Label, CreateLabelDTO, LabelPreview, LabelPreviewDTO,
  DashboardStats,
} from '@/types';

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

  me: () =>
    api.get<ApiResponse<User>>('/auth/me'),
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

  getCategories: () =>
    api.get<ApiResponse<string[]>>('/products/categories'),
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
  list: (params?: {
    productId?: string; userId?: string; page?: number; limit?: number;
    q?: string; from?: string; to?: string; storageType?: string;
  }) =>
    api.get<PaginatedResponse<Label>>('/labels', { params }),

  preview: (data: LabelPreviewDTO) =>
    api.post<ApiResponse<LabelPreview>>('/labels/preview', data),

  getById: (id: string) =>
    api.get<ApiResponse<Label>>(`/labels/${id}`),

  create: (data: CreateLabelDTO) =>
    api.post<ApiResponse<Label>>('/labels', data),

  registerPrint: (id: string) =>
    api.patch<ApiResponse<Label>>(`/labels/${id}/print`),
};

// ── Dashboard ────────────────────────────────────────────
export const dashboardApi = {
  getStats: () =>
    api.get<ApiResponse<DashboardStats>>('/dashboard/stats'),
};

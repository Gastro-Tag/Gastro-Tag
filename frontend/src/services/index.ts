import { api } from './api';
import type {
  ApiResponse, PaginatedResponse, AuthTokens, User,
  Product, CreateProductDTO, ProductFilters,
  Label, CreateLabelDTO,
  DashboardStats,
} from '@/types';

// ── Auth ────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<ApiResponse<AuthTokens & { user: User }>>('/auth/login', { email, password }),

  refresh: (refreshToken: string) =>
    api.post<ApiResponse<AuthTokens>>('/auth/refresh', { refreshToken }),

  me: () =>
    api.get<ApiResponse<User>>('/auth/me'),
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

// ── Labels ──────────────────────────────────────────────
export const labelApi = {
  list: (params?: { productId?: string; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<Label>>('/labels', { params }),

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

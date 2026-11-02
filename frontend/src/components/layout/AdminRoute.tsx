import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

/** Telas de gestão: a API já recusa com 403; aqui só evitamos abrir a tela para operadores. */
export function AdminRoute() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'ADMIN');
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}

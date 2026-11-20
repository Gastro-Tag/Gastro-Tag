import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuthStore } from '@/store/authStore';
import { AppLayout }   from '@/components/layout/AppLayout';
import { loginUrl }    from '@/utils/redirect';

export function ProtectedRoute() {
  const { user, accessToken } = useAuthStore();
  const location = useLocation();

  if (!accessToken || !user) {
    // Guarda a página pedida: depois do login o painel volta para ela, e não para o início.
    return <Navigate to={loginUrl(location.pathname, location.search)} replace />;
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

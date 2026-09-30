import { createBrowserRouter, Link } from 'react-router-dom';
import { ProtectedRoute }   from '@/components/layout/ProtectedRoute';
import { LoginPage }        from '@/pages/LoginPage';
import { DashboardPage }    from '@/pages/DashboardPage';
import { ProductsPage }     from '@/pages/ProductsPage';
import { ProductFormPage }  from '@/pages/ProductFormPage';
import { LabelFormPage }    from '@/pages/LabelFormPage';
import { LabelsPage }       from '@/pages/LabelsPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/',                   element: <DashboardPage /> },
      { path: '/products',           element: <ProductsPage /> },
      { path: '/products/new',       element: <ProductFormPage /> },
      { path: '/products/:id/edit',  element: <ProductFormPage /> },
      { path: '/labels',             element: <LabelsPage /> },
      { path: '/labels/new',         element: <LabelFormPage /> },
    ],
  },
  {
    path: '*',
    element: (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-3xl font-bold">Página não encontrada</h1>
        <p className="text-slate-500">Confira o endereço ou volte ao início.</p>
        <Link className="btn-primary btn" to="/">Voltar ao início</Link>
      </main>
    ),
  },
]);

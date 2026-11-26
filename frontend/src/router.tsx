import { createBrowserRouter, Link } from 'react-router';
import { ProtectedRoute }   from '@/components/layout/ProtectedRoute';
import { AdminRoute }       from '@/components/layout/AdminRoute';
import { LoginPage }        from '@/pages/LoginPage';
import { DashboardPage }    from '@/pages/DashboardPage';
import { ProductsPage }     from '@/pages/ProductsPage';
import { ProductFormPage }  from '@/pages/ProductFormPage';
import { ProductLotsPage }  from '@/pages/ProductLotsPage';
import { LabelFormPage }    from '@/pages/LabelFormPage';
import { LabelsPage }       from '@/pages/LabelsPage';
import { UsersPage }        from '@/pages/UsersPage';
import { ShelfLifeRulesPage } from '@/pages/ShelfLifeRulesPage';
import { ReportPage }       from '@/pages/ReportPage';
import { RouteErrorScreen } from '@/components/errors/ErrorBoundary';
import { TotemRoute }       from '@/components/totem/TotemShell';
import { TotemLoginPage }   from '@/pages/totem/TotemLoginPage';
import { TotemHomePage }    from '@/pages/totem/TotemHomePage';
import { TotemLabelPage }   from '@/pages/totem/TotemLabelPage';
import { TotemSplitPage }   from '@/pages/totem/TotemSplitPage';
import { TotemDuePage }     from '@/pages/totem/TotemDuePage';

export const router = createBrowserRouter([
  // Erro inesperado fora das áreas (login, 404): tela cheia. Cada área tem o seu errorElement abaixo,
  // dentro do layout, para o cabeçalho/menu continuar na tela.
  {
    errorElement: <RouteErrorScreen area="global" />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
      { path: '/totem/login', element: <TotemLoginPage /> },
      {
        element: <TotemRoute />,
        children: [
          {
            errorElement: <RouteErrorScreen area="totem" />,
            children: [
              { path: '/totem',                     element: <TotemHomePage /> },
              { path: '/totem/etiqueta/:productId', element: <TotemLabelPage /> },
              { path: '/totem/etiqueta/:productId/dividir', element: <TotemSplitPage /> },
              { path: '/totem/descartar',            element: <TotemDuePage /> },
            ],
          },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            errorElement: <RouteErrorScreen area="panel" />,
            children: [
              { path: '/',                   element: <DashboardPage /> },
              { path: '/products',           element: <ProductsPage /> },
              { path: '/labels',             element: <LabelsPage /> },
              { path: '/labels/new',         element: <LabelFormPage /> },
              {
                element: <AdminRoute />,
                children: [
                  { path: '/products/new',      element: <ProductFormPage /> },
                  { path: '/products/:id/edit', element: <ProductFormPage /> },
                  { path: '/products/:id/lots', element: <ProductLotsPage /> },
                  { path: '/users',             element: <UsersPage /> },
                  { path: '/rules',             element: <ShelfLifeRulesPage /> },
                  { path: '/reports',           element: <ReportPage /> },
                ],
              },
            ],
          },
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
    ],
  },
]);

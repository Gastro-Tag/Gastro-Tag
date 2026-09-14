import { createBrowserRouter } from 'react-router-dom';
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
    element: <LoginPage />,
  },
]);

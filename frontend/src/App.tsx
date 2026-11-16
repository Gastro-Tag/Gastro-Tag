import { RouterProvider } from 'react-router/dom';
import { router }         from './router';
import { ErrorBoundary } from '@/components/errors/ErrorBoundary';
import { ToastProvider }  from '@/components/ui/Toast';

export default function App() {
  return (
    <ErrorBoundary area="global">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ErrorBoundary>
  );
}

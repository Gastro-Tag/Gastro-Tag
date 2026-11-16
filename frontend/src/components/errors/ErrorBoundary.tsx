import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router';
import { ErrorScreen, type ErrorArea } from './ErrorScreen';

interface ErrorBoundaryProps {
  area: ErrorArea;
  children: ReactNode;
}

/** Última barreira: pega erros de renderização fora do router (providers, App). */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: unknown; failed: boolean }> {
  state = { error: null as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <ErrorScreen area={this.props.area} error={this.state.error} />;
    return this.props.children;
  }
}

/** `errorElement` do router: erros de renderização (e de loaders) de uma área. */
export function RouteErrorScreen({ area }: { area: ErrorArea }) {
  const error = useRouteError();
  return <ErrorScreen area={area} error={error} />;
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../../i18n/config';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render errors, including a failed lazy-chunk download after a new deploy
 * (old asset names no longer exist), and offers a reload instead of a blank page.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{i18n.t('errorBoundary.title')}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{i18n.t('errorBoundary.description')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
        >
          {i18n.t('errorBoundary.reload')}
        </button>
      </div>
    );
  }
}

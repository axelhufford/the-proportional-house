import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Top-level error boundary. Without it, a render-time throw anywhere in the
 * routed tree white-screens the whole site. This catches it and shows an
 * on-brand recovery screen instead. It wraps the routed <Outlet/> inside
 * Layout (so the masthead/footer/skip-link survive), and Layout keys it by
 * pathname so navigating to another route auto-clears the error state.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface it for debugging (and any analytics/console capture).
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-xs uppercase tracking-wider text-stone-500 font-medium">Something went wrong</p>
        <h1 className="mt-2 font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">
          This page hit a snag
        </h1>
        <p className="mt-4 text-stone-700 leading-relaxed">
          An unexpected error stopped this view from rendering. Reloading usually fixes it — if it
          keeps happening, the map is a safe place to start over.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-navy text-white px-4 py-2 hover:bg-brand-navy-mid transition-colors"
          >
            Reload the page
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full bg-white border border-stone-200 text-stone-700 px-4 py-2 hover:border-brand-navy/40 hover:text-brand-navy transition-colors"
          >
            Back to the map
          </Link>
        </div>
      </div>
    );
  }
}

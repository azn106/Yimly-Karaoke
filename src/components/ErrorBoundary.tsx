import React, { ReactNode, ErrorInfo } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0B10] text-zinc-100 flex items-center justify-center p-6 select-none font-sans">
          <div className="max-w-md w-full bg-[#141622] border border-white/10 rounded-3xl p-8 text-center shadow-2xl space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto text-red-400 shadow-lg shadow-red-500/10">
              <AlertCircle className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Something went wrong</h2>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                An unexpected error occurred. You can reload the page or return to the home screen.
              </p>
              {this.state.error && (
                <div className="mt-4 p-3 bg-red-950/40 border border-red-500/20 rounded-xl text-[11px] font-mono text-red-300 text-left overflow-x-auto max-h-28">
                  {this.state.error.message || String(this.state.error)}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleGoHome}
                className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 text-zinc-300 font-semibold text-xs rounded-xl transition-all border border-white/10 flex items-center justify-center gap-1.5"
              >
                <Home className="w-4 h-4" />
                <span>Home</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 py-3 px-4 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-xs rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

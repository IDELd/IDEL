import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches rendering errors anywhere below it and shows a recoverable
 * fallback instead of leaving the whole app blank. Without this, a single
 * unexpected error in one page/component used to take down the entire tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Unhandled render error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ error: null });
    window.location.hash = "#/";
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-7 w-7" />
          </span>
          <div className="space-y-1">
            <h1 className="text-lg font-bold">Что-то пошло не так</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу или вернуться на главную.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.handleGoHome}>
              На главную
            </Button>
            <Button onClick={this.handleReload}>Перезагрузить</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

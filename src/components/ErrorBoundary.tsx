import React, { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-3xl border-border shadow-md rounded-lg">
            <CardHeader className="bg-destructive/10 border-b border-border rounded-t-lg">
              <CardTitle className="flex items-center gap-2 text-destructive text-xl font-semibold">
                <AlertCircle className="w-6 h-6" />
                Application Error
              </CardTitle>
              <CardDescription className="text-destructive/80 font-medium text-sm">
                The application encountered an unexpected error and could not continue.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <h3 className="font-semibold text-sm text-foreground uppercase tracking-wider">Error Message</h3>
                <div className="bg-muted text-destructive p-4 rounded-md border border-border font-mono text-sm break-all">
                  {this.state.error?.message || 'Unknown error'}
                </div>
              </div>

              {this.state.errorInfo && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm text-foreground uppercase tracking-wider">Component Stack Trace</h3>
                  <ScrollArea className="h-[200px] w-full rounded-md border border-border bg-muted p-4">
                    <pre className="text-muted-foreground font-mono text-xs whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </ScrollArea>
                </div>
              )}

              {this.state.error?.stack && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm text-foreground uppercase tracking-wider">Error Stack Trace</h3>
                  <ScrollArea className="h-[200px] w-full rounded-md border border-border bg-muted p-4">
                    <pre className="text-muted-foreground font-mono text-xs whitespace-pre-wrap">
                      {this.state.error.stack}
                    </pre>
                  </ScrollArea>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <Button onClick={this.handleReset} className="gap-2 bg-success text-primary-foreground rounded-md hover:bg-success/90 font-semibold text-sm h-10 px-6 border border-border/20">
                  <RefreshCw className="w-4 h-4" />
                  Reload Application
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

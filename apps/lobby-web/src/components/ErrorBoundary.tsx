import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 点击「返回大厅」时的回调，用于回到可用的界面 */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * 视图级错误边界：任一游戏界面渲染抛错时只降级这一屏，
 * 而不是整站白屏。用户仍可回到大厅继续操作。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] 视图渲染异常', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="boot" role="alert">
        <p>这个界面出了点问题</p>
        <p style={{ opacity: 0.6, fontSize: 13, marginTop: 4 }}>
          {this.state.error.message || '未知错误'}
        </p>
        <button
          type="button"
          onClick={this.reset}
          style={{
            marginTop: 16,
            padding: '10px 24px',
            borderRadius: 10,
            border: '1px solid rgba(240,180,41,0.6)',
            background: 'rgba(240,180,41,0.14)',
            color: '#f0b429',
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          返回大厅
        </button>
      </div>
    );
  }
}

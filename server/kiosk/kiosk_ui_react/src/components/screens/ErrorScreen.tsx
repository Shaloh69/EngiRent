interface Props {
  message: string;
  onRetry: () => void;
  onHome: () => void;
}

export function ErrorScreen({ message, onRetry, onHome }: Props) {
  return (
    <div className="screen screen-error">
      <div className="error-wrap">
        <div className="error-icon">
          <span>✕</span>
        </div>
        <h1 className="error-title">Something went wrong</h1>
        <p className="error-msg">{message}</p>
        <div className="error-btns">
          <button className="err-btn btn-retry" onClick={onRetry}>
            Try Again
          </button>
          <button className="err-btn btn-err-home" onClick={onHome}>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

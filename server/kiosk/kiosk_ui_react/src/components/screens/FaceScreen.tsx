interface Props {
  instr: string;
  progress: number;
  label: string;
  isDemo: boolean;
}

export function FaceScreen({ instr, progress, label, isDemo }: Props) {
  const ts = Date.now();
  return (
    <div className="screen screen-face">
      <header className="flow-bar">
        <div className="flow-back flow-back-off">‹</div>
        <h2 className="flow-title">Identity Verification</h2>
        <span className="flow-step">Step 3 of 3</span>
      </header>

      <div className="cam-wrap">
        {!isDemo && <img className="cam-feed" src={`/camera/face/stream?t=${ts}`} alt="Face Camera" />}
        {isDemo && <div className="cam-feed cam-feed--placeholder">Face camera preview (demo mode)</div>}
        <div className="face-overlay">
          <div className="face-ring">
            <div className="face-ring-pulse" />
            <div className="face-ring-dot" />
          </div>
          <div className="face-corners">
            <span className="fc fc-tl" />
            <span className="fc fc-tr" />
            <span className="fc fc-bl" />
            <span className="fc fc-br" />
          </div>
        </div>
      </div>

      <div className="flow-foot">
        <p className="face-instr">{instr}</p>
        <div className="face-prog-wrap">
          <div className="face-prog">
            <div className="face-bar" style={{ width: `${progress}%` }} />
          </div>
          <span className="face-label">{label}</span>
        </div>
      </div>
    </div>
  );
}

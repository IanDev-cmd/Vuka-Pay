import { useEffect } from "react";

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2000);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="splash" role="status" aria-label="VukaPay">
      <p className="splash-title">
        {"VukaPay".split("").map((letter, index) => (
          <span key={`${letter}-${index}`} style={{ animationDelay: `${index * 0.08}s` }}>
            {letter}
          </span>
        ))}
      </p>
      <p className="splash-sub">EAC Cross-Border Escrow</p>
    </div>
  );
}

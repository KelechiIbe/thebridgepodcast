import { useEffect, type ReactNode } from "react";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: "min(1100px, 100%)" } : undefined}>
        <div className="row">
          <h2 className="sec" style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";

type InstallPrompt = Event & { prompt: () => Promise<void> };

export function PwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    QRCode.toDataURL(window.location.origin, {
      margin: 1,
      width: 180,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, []);

  return (
    <>
      <button type="button" className="install-link" onClick={() => setOpen(true)}>
        Scan to install
      </button>
      {open
        ? createPortal(
            <div className="install-sheet" role="dialog" aria-label="Install VukaPay">
              <div className="install-card">
                <h2>VukaPay - EAC Cross-Border Escrow</h2>
                <p>Scan this code on a phone, then add VukaPay to the home screen.</p>
                {qr ? <img src={qr} width={180} height={180} alt="QR code for this VukaPay address" /> : null}
                {prompt ? (
                  <button
                    type="button"
                    className="install-action"
                    onClick={() => {
                      void prompt.prompt();
                      setOpen(false);
                    }}
                  >
                    Install
                  </button>
                ) : null}
                <button type="button" className="install-close" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

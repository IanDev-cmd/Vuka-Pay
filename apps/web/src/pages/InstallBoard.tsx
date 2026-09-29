import { useEffect, useState } from "react";
import { CloneBoard } from "../components/CloneBoard";
import { PaymentQr } from "../components/PaymentQr";

type InstallPrompt = Event & { prompt: () => Promise<void> };

export function InstallBoard() {
  const [promptEvent, setPromptEvent] = useState<InstallPrompt | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      setPromptEvent(event as InstallPrompt);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  return (
    <CloneBoard
      title="Install VukaPay"
      rows={[
        { label: "App", value: "VukaPay" },
        { label: "Opens as", value: "Home screen app" },
        { label: "Address", value: window.location.host },
        { label: "Prompt", value: promptEvent ? "Chrome is ready" : "Waiting for Chrome" },
      ]}
      stats={[
        { label: "Install", value: "Chrome", share: "phone", tone: "light" },
        { label: "Display", value: "App", share: "not a tab", tone: "blue" },
      ]}
      chart={100}
      totalLabel="Scan on the phone, or use Chrome’s install prompt"
      totalValue="VukaPay"
      actionLabel={promptEvent ? "Install" : "Install in Chrome"}
      actionDisabled={!promptEvent}
      onAction={() => {
        const pending = promptEvent;
        if (!pending) {
          setNote("Open this page in Chrome on the phone. Chrome shows the install prompt when the app is ready.");
          return;
        }
        setPromptEvent(null);
        void pending.prompt();
      }}
      note={note}
      mark={<PaymentQr text={window.location.origin} />}
    />
  );
}

import { useState } from "react";
import { navigate } from "../nav";
import { PwaInstall } from "./PwaInstall";

export type HeaderPage = "session" | "trades" | "wallet";

export function AppHeader({ page }: { page: HeaderPage }) {
  const [menu, setMenu] = useState(false);

  function go(path: string) {
    setMenu(false);
    navigate(path);
  }

  return (
    <header className="session-bar app-header">
      <button type="button" className="wordmark" onClick={() => go("/")}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.2 8.2 L6.1 12.1 L13.8 3.6" fill="none" stroke="#1bb82b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        VukaPay
      </button>
      <div className="session-tools">
        <nav className={menu ? "session-nav open" : "session-nav"}>
          <button type="button" aria-current={page === "trades" ? "page" : undefined} onClick={() => go("/trades")}>
            Trades
          </button>
          <button type="button" aria-current={page === "session" ? "page" : undefined} onClick={() => go("/")}>
            Session
          </button>
          <button type="button" aria-current={page === "wallet" ? "page" : undefined} onClick={() => go("/wallet")}>
            Wallet
          </button>
          <PwaInstall />
        </nav>
        <button type="button" className="menu-button" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}

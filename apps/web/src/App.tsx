import { useEffect, useState } from "react";
import { AppHeader, type HeaderPage } from "./components/AppHeader";
import { InvoiceScreen } from "./pages/InvoiceScreen";
import { SessionScreen } from "./pages/SessionScreen";
import { WalletScreen } from "./pages/WalletScreen";
import { navigate } from "./nav";

const REMOVED = new Set(["/how-it-works", "/support"]);

export function App() {
  const path = usePath();

  useEffect(() => {
    if (REMOVED.has(path)) navigate("/");
  }, [path]);

  if (REMOVED.has(path)) return null;

  return (
    <div className="app-root">
      <AppHeader page={headerPage(path)} />
      {renderPage(path)}
    </div>
  );
}

function renderPage(path: string) {
  if (path === "/trades") return <InvoiceScreen initialTab="trades" />;
  if (path === "/wallet") return <WalletScreen />;
  if (path === "/invoice") return <SessionScreen viewer="exporter" tradeId={null} token={null} />;
  if (path.startsWith("/trades/")) {
    const id = decodeURIComponent(path.slice("/trades/".length));
    return <SessionScreen viewer="exporter" tradeId={id || null} token={null} />;
  }
  if (path.startsWith("/pay/")) {
    const token = decodeURIComponent(path.slice("/pay/".length));
    return <SessionScreen viewer="buyer" tradeId={null} token={token || null} />;
  }
  return <SessionScreen viewer="buyer" tradeId={null} token={null} />;
}

function headerPage(path: string): HeaderPage {
  if (path === "/wallet") return "wallet";
  if (path === "/trades") return "trades";
  return "session";
}

function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    function sync() {
      setPath(window.location.pathname);
    }
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return path;
}

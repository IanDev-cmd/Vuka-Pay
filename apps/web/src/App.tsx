import { useEffect, useState } from "react";
import { InvoiceScreen } from "./pages/InvoiceScreen";
import { SessionScreen } from "./pages/SessionScreen";
import { WalletScreen } from "./pages/WalletScreen";

export function App() {
  const path = usePath();
  if (path === "/trades") return <InvoiceScreen initialTab="trades" />;
  if (path === "/how-it-works") return <SessionScreen viewer="buyer" tradeId={null} token={null} page="how" />;
  if (path === "/support") return <SessionScreen viewer="buyer" tradeId={null} token={null} page="support" />;
  if (path === "/wallet") return <WalletScreen />;
  if (path === "/invoice") return <SessionScreen viewer="exporter" tradeId={null} token={null} page="session" />;
  if (path.startsWith("/trades/")) {
    const id = decodeURIComponent(path.slice("/trades/".length));
    return <SessionScreen viewer="exporter" tradeId={id || null} token={null} page="session" />;
  }
  if (path.startsWith("/pay/")) {
    const token = decodeURIComponent(path.slice("/pay/".length));
    return <SessionScreen viewer="buyer" tradeId={null} token={token || null} page="session" />;
  }
  return <SessionScreen viewer="buyer" tradeId={null} token={null} page="session" />;
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

import { useState } from "react";
import { SessionScreen } from "./pages/SessionScreen";
import { TradesBoard } from "./pages/TradesBoard";
import { WalletScreen } from "./pages/WalletScreen";
import { PayBoard } from "./pages/PayBoard";
import { InstallBoard } from "./pages/InstallBoard";
import { Splash } from "./pages/Splash";
import { isRemoved, useBoardKeys, usePath } from "./navigation";

export function App() {
  const path = usePath();
  const [booting, setBooting] = useState(true);
  useBoardKeys(path, !booting);
  if (booting) return <Splash onDone={() => setBooting(false)} />;
  if (isRemoved(path)) return null;
  return renderPage(path);
}

function renderPage(path: string) {
  if (path === "/install") return <InstallBoard />;
  if (path === "/trades") return <TradesBoard />;
  if (path === "/wallet") return <WalletScreen />;
  if (path === "/invoice") return <SessionScreen viewer="exporter" tradeId={null} token={null} />;
  if (path.startsWith("/trades/")) {
    const id = decodeURIComponent(path.slice("/trades/".length));
    return <SessionScreen viewer="exporter" tradeId={id || null} token={null} />;
  }
  if (path.startsWith("/pay/")) {
    const token = decodeURIComponent(path.slice("/pay/".length));
    return <PayBoard token={token || null} />;
  }
  return <SessionScreen viewer="buyer" tradeId={null} token={null} />;
}

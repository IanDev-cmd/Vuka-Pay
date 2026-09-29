import { useState } from "react";
import { SessionScreen } from "./pages/SessionScreen";
import { TradesBoard } from "./pages/TradesBoard";
import { WalletScreen } from "./pages/WalletScreen";
import { PayBoard } from "./pages/PayBoard";
import { InstallBoard } from "./pages/InstallBoard";
import { Splash } from "./pages/Splash";
import { isRemoved, useBoardKeys, usePath } from "./navigation";

const TAP_PHONE = "0741784323";
const TAP_AMOUNT: { amount_minor: string; currency: "KES" } = { amount_minor: "500", currency: "KES" };

function isNfcTap(): boolean {
  return new URLSearchParams(window.location.search).get("tap") === "1";
}

export function App() {
  const path = usePath();
  const tap = isNfcTap() || path === "/tap";
  const [booting, setBooting] = useState(!tap);
  useBoardKeys(path, !booting && !tap);
  if (booting) return <Splash onDone={() => setBooting(false)} />;
  if (isRemoved(path)) return null;
  return renderPage(path, tap);
}

function renderPage(path: string, tap: boolean) {
  if (tap) {
    return <PayBoard token={null} autoStart initialPhone={TAP_PHONE} kesGoods={TAP_AMOUNT} />;
  }
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

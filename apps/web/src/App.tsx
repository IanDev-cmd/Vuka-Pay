import { SessionScreen } from "./pages/SessionScreen";
import { TradesBoard } from "./pages/TradesBoard";
import { WalletScreen } from "./pages/WalletScreen";
import { isRemoved, useBoardKeys, usePath } from "./navigation";

export function App() {
  const path = usePath();
  useBoardKeys(path);
  if (isRemoved(path)) return null;
  return renderPage(path);
}

function renderPage(path: string) {
  if (path === "/trades") return <TradesBoard />;
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

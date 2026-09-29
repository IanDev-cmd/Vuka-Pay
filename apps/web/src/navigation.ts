import { useEffect, useState } from "react";
import { navigate } from "./nav";

const BOARDS = ["/", "/trades", "/wallet", "/install"] as const;
const REMOVED = new Set(["/how-it-works", "/support"]);

export function usePath(): string {
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

export function useBoardKeys(path: string, enabled = true): void {
  useEffect(() => {
    if (REMOVED.has(path)) navigate("/");
  }, [path]);

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      const index = BOARDS.indexOf(path as (typeof BOARDS)[number]);
      const next = index === -1 ? "/" : BOARDS[(index + 1) % BOARDS.length];
      navigate(next ?? "/");
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [path, enabled]);
}

export function isRemoved(path: string): boolean {
  return REMOVED.has(path);
}

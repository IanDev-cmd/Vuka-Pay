export interface PartyFace {
  display_name: string;
  business_name: string;
  avatar_url: string | null;
  logo_url: string | null;
  badge: "payout_verified" | null;
}

export function Avatar({
  party,
  size = 36,
}: {
  party: PartyFace;
  size?: number;
}) {
  const image = party.avatar_url || party.logo_url;
  const label = party.display_name || party.business_name || "Trader";
  return (
    <span className="avatar" style={{ width: size, height: size }} title={party.badge === "payout_verified" ? "Payout number verified" : label}>
      {image ? <img src={image} alt="" /> : <span className="avatar-fallback">{initials(label)}</span>}
      {party.badge === "payout_verified" ? (
        <span className="avatar-badge" aria-label="Payout number verified">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 5.2 L4.1 7.2 L8 2.8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || name.slice(0, 1) || "?").toUpperCase();
}

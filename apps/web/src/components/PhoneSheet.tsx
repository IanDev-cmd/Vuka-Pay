import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { normalizePhoneDigits } from "../format";
import type { NetworkOption } from "../types";
import { Flag, type FlagCode } from "./Flags";

export function PhoneSheet({
  title,
  hint,
  currency,
  flag,
  networks,
  networkId,
  onNetwork,
  showNetwork,
  name,
  onClose,
  onConfirm,
}: {
  title: string;
  hint: string;
  currency: "KES" | "UGX" | "TZS" | "RWF";
  flag: FlagCode;
  networks: NetworkOption[];
  networkId: string;
  onNetwork: (displayName: string) => void;
  showNetwork: boolean;
  name?: { value: string; onChange: (value: string) => void };
  onClose: () => void;
  onConfirm: (phone: string) => void;
}) {
  const fieldId = useId();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const prefix = currency === "KES" ? "254" : currency === "UGX" ? "256" : currency === "TZS" ? "255" : "250";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    if (name && name.value.trim().length === 0) {
      setError("Enter the buyer name.");
      return;
    }
    const phone = normalizePhoneDigits(raw, currency);
    if (phone.length !== 12) {
      setError(`Use 12 digits starting with ${prefix}.`);
      return;
    }
    setError(null);
    onConfirm(phone);
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <h2 id={`${fieldId}-title`}>{title}</h2>
        <p>{hint}</p>
        {name ? (
          <>
            <label className="field-label" htmlFor={`${fieldId}-name`}>
              Buyer name
            </label>
            <input id={`${fieldId}-name`} value={name.value} placeholder="Buyer name" onChange={(event) => name.onChange(event.target.value)} />
          </>
        ) : null}
        {showNetwork ? (
          <>
            <label className="field-label" htmlFor={`${fieldId}-network`}>
              Network
            </label>
            <select
              id={`${fieldId}-network`}
              value={networkId}
              onChange={(event) => onNetwork(event.target.value)}
            >
              {networks.map((network) => (
                <option key={network.display_name} value={network.display_name}>
                  {network.display_name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <label className="field-label" htmlFor={fieldId}>
          <Flag code={flag} size={14} /> Mobile money number
        </label>
        <input
          id={fieldId}
          inputMode="tel"
          autoComplete="tel"
          placeholder={`${prefix}…`}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
        />
        {error ? <p className="footnote error">{error}</p> : null}
        <button type="button" className="cta" onClick={submit}>
          <span className="cta-label">Confirm</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}

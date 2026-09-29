import { useState } from "react";
import { nfcAvailable, scanDeliveryTag, writeDeliveryTag } from "../nfcBrowser";

export function DeliveryActions({
  viewer,
  state,
  nfcToken,
  busy,
  onShip,
  onVerify,
  onCode,
}: {
  viewer: "exporter" | "buyer";
  state: string;
  nfcToken: string | null;
  busy: boolean;
  onShip: () => Promise<string | null>;
  onVerify: (token: string) => Promise<void>;
  onCode: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const waiting = state === "SHIPPED" || state === "DELIVERY_CLAIMED";
  const canShip = viewer === "exporter" && state === "FUNDED";
  if (!canShip && !waiting) return null;

  async function write(token: string | null) {
    setNote(null);
    const value = token ?? (await onShip());
    if (!value) {
      setNote("Ship the trade first. The delivery token is issued on dispatch.");
      return;
    }
    if (!nfcAvailable()) {
      setNote("This browser has no NFC writer. Give the buyer the SMS delivery code instead.");
      return;
    }
    try {
      await writeDeliveryTag(value);
      setNote("Delivery token written to the tag.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not write the NFC tag");
    }
  }

  async function scan() {
    setNote(null);
    if (!nfcAvailable()) {
      setNote("This phone has no Web NFC reader. Enter the SMS delivery code.");
      onCode();
      return;
    }
    try {
      const token = await scanDeliveryTag();
      await onVerify(token);
      setNote("Tag accepted. Escrow release has been sent.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not read the NFC tag");
    }
  }

  return (
    <div className="delivery-actions">
      {canShip || (viewer === "exporter" && waiting) ? (
        <button type="button" className="summary-button" disabled={busy} onClick={() => void write(nfcToken)}>
          {canShip ? "Ship and write NFC tag" : "Write NFC tag"}
        </button>
      ) : null}
      {viewer === "buyer" && waiting ? (
        <>
          <button type="button" className="summary-button" disabled={busy} onClick={() => void scan()}>
            Scan delivery tag
          </button>
          <button type="button" className="install-close" onClick={onCode}>
            Enter SMS code
          </button>
        </>
      ) : null}
      {note ? <p className="hint">{note}</p> : null}
    </div>
  );
}

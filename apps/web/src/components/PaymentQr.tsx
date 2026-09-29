import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function PaymentQr({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 180, color: { dark: "#000000", light: "#ffffff" } })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [text]);
  if (!src) return null;
  return <img className="pay-qr" src={src} width={180} height={180} alt="Payment QR code" />;
}

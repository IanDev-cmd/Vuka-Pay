type NdefRecord = { data?: BufferSource };
type NdefMessage = { records: NdefRecord[] };
type NdefReader = {
  scan: () => Promise<void>;
  write: (message: { records: { recordType: string; data: BufferSource }[] }) => Promise<void>;
  onreading: ((event: { message: NdefMessage }) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
};

export function nfcAvailable(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

function reader(): NdefReader {
  const Ctor = (window as unknown as { NDEFReader: new () => NdefReader }).NDEFReader;
  return new Ctor();
}

export async function writeDeliveryTag(token: string): Promise<void> {
  const tag = reader();
  await tag.write({
    records: [{ recordType: "text", data: new TextEncoder().encode(token) }],
  });
}

export function scanDeliveryTag(): Promise<string> {
  return new Promise((resolve, reject) => {
    const tag = reader();
    tag.onreadingerror = () => reject(new Error("Could not read the NFC tag"));
    tag.onreading = (event) => {
      const record = event.message.records[0];
      if (!record?.data) {
        reject(new Error("The NFC tag is empty"));
        return;
      }
      resolve(extractToken(new TextDecoder().decode(record.data)));
    };
    tag.scan().catch(reject);
  });
}

function extractToken(raw: string): string {
  const match = raw.match(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/);
  if (!match) throw new Error("This tag is not a VukaPay delivery token");
  return match[0];
}

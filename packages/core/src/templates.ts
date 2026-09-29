export type TemplateId =
  | "invoice_sent"
  | "payment_prompt"
  | "payment_received"
  | "payment_failed"
  | "ship_now"
  | "dispatch_declared"
  | "delivery_code"
  | "dispute_raised"
  | "dispute_resolved"
  | "payout_sent"
  | "payout_failed"
  | "otp";

export type Language = "en" | "sw";

const TEMPLATES: Record<Language, Record<TemplateId, string>> = {
  en: {
    invoice_sent: "VukaPay: {{exporter}} sent you an invoice. Pay here: {{link}}",
    payment_prompt: "VukaPay: approve the mobile-money prompt on {{phone}} to pay {{amount}}.",
    payment_received: "VukaPay: payment received. Funds are locked until delivery is verified.",
    payment_failed: "VukaPay: the payment was not completed. You can retry from the same link.",
    ship_now: "VukaPay: {{buyer}} has paid. Ship the goods and keep the waybill.",
    dispatch_declared: "VukaPay: {{exporter}} marked the order as shipped.",
    delivery_code: "VukaPay delivery code: {{code}}. Give this to the exporter at handover.",
    dispute_raised: "VukaPay: a dispute was opened. Funds stay locked until it is resolved.",
    dispute_resolved: "VukaPay: the dispute was resolved ({{decision}}).",
    payout_sent: "VukaPay: your KES payout to M-Pesa was submitted.",
    payout_failed: "VukaPay: the M-Pesa payout failed and is waiting for review.",
    otp: "VukaPay code: {{code}}. It confirms this M-Pesa number belongs to you.",
  },
  sw: {
    invoice_sent: "VukaPay: {{exporter}} amekutumia ankara. Lipa hapa: {{link}}",
    payment_prompt: "VukaPay: thibitisha ombi la pesa kwenye {{phone}} kulipa {{amount}}.",
    payment_received: "VukaPay: malipo yamepokelewa. Fedha zimefungwa hadi uthibitisho wa kupokea bidhaa.",
    payment_failed: "VukaPay: malipo hayajakamilika. Unaweza kujaribu tena kwenye kiungo hicho.",
    ship_now: "VukaPay: {{buyer}} amelipa. Tuma bidhaa na uhifadhi hati ya usafirishaji.",
    dispatch_declared: "VukaPay: {{exporter}} amethibitisha kuwa bidhaa zimetumwa.",
    delivery_code: "Nambari ya VukaPay: {{code}}. Mpe muuzaji unapopokea bidhaa.",
    dispute_raised: "VukaPay: malalamiko yamefunguliwa. Fedha zinasalia zimefungwa.",
    dispute_resolved: "VukaPay: malalamiko yametatuliwa ({{decision}}).",
    payout_sent: "VukaPay: malipo yako ya KES kwenda M-Pesa yametumwa.",
    payout_failed: "VukaPay: malipo ya M-Pesa yameshindwa na yanasubiri ukaguzi.",
    otp: "Nambari ya VukaPay: {{code}}. Inathibitisha nambari hii ya M-Pesa ni yako.",
  },
};

export function renderTemplate(language: Language, id: TemplateId, vars: Record<string, string>): string {
  const table = TEMPLATES[language] ?? TEMPLATES.en;
  return table[id].replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function languageFromHeader(header: string | undefined): Language {
  const value = (header ?? "en").toLowerCase();
  if (value.startsWith("sw")) return "sw";
  return "en";
}

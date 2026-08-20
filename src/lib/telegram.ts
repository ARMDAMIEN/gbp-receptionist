import { TELEGRAM_BOT_API_KEY, TELEGRAM_CHAT_ID } from "../config.js";

function escapeMarkdownV2(s: string): string {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export async function sendTelegramMessage(
  text: string,
  opts: { markdown?: boolean } = {}
): Promise<{ ok: boolean; message_id: number | null; error?: string }> {
  if (!TELEGRAM_BOT_API_KEY || !TELEGRAM_CHAT_ID) {
    return { ok: false, message_id: null, error: "Telegram not configured" };
  }
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_API_KEY}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: opts.markdown ? "MarkdownV2" : undefined,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok || !data?.ok) {
    return {
      ok: false,
      message_id: null,
      error: `Telegram API ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
    };
  }
  return { ok: true, message_id: data.result?.message_id ?? null };
}

export function formatAppointmentCard(input: {
  name: string;
  company: string;
  city: string;
  sector: string;
  phone: string;
  preferred_slot_iso: string;
  notes?: string;
  gcal_link?: string;
}): string {
  const e = escapeMarkdownV2;
  const lines = [
    "*📅 Nouveau RDV GBP Edge*",
    "",
    `👤 *${e(input.name)}* — ${e(input.company)}`,
    `📍 ${e(input.city)} · _${e(input.sector)}_`,
    `📞 \`${e(input.phone)}\``,
    `🕐 ${e(input.preferred_slot_iso)}`,
  ];
  if (input.notes) lines.push("", `📝 ${e(input.notes)}`);
  if (input.gcal_link) lines.push("", `🔗 [Google Calendar](${input.gcal_link})`);
  return lines.join("\n");
}

export function formatOwnerMessage(input: {
  tag: "prospect_question" | "message_general";
  name: string;
  phone?: string;
  message: string;
}): string {
  const e = escapeMarkdownV2;
  const header =
    input.tag === "prospect_question"
      ? "*❓ Question prospect \\(hors FAQ\\)*"
      : "*📨 Message général*";
  const lines = [header, "", `👤 *${e(input.name)}*`];
  if (input.phone) lines.push(`📞 \`${e(input.phone)}\``);
  lines.push("", `_${e(input.message)}_`);
  return lines.join("\n");
}

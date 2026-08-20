import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { promises as fs } from "node:fs";
import {
  APPOINTMENTS_JSON_PATH,
  CALLS_JSON_PATH,
} from "../config.js";
import {
  sendTelegramMessage,
  formatAppointmentCard,
  formatOwnerMessage,
} from "../lib/telegram.js";
import { createTentativeEvent } from "../lib/gcal.js";

async function appendJson(path: string, record: unknown) {
  let existing: unknown[] = [];
  try {
    const raw = await fs.readFile(path, "utf8");
    existing = JSON.parse(raw);
    if (!Array.isArray(existing)) existing = [];
  } catch {}
  existing.push(record);
  await fs.writeFile(path, JSON.stringify(existing, null, 2));
}

const bookAppointmentTool = tool(
  "book_appointment",
  "Enregistre un rendez-vous d'analyse gratuite pour un prospect qualifié. Crée un événement tentatif dans Google Calendar et envoie une notification Telegram à Mr Armourdom.",
  {
    name: z.string().describe("Nom complet du prospect"),
    company: z.string().describe("Nom de l'entreprise du prospect"),
    city: z.string().describe("Ville de l'entreprise"),
    sector: z.string().describe("Secteur d'activité"),
    phone: z.string().describe("Numéro de téléphone de rappel"),
    preferred_slot_iso: z
      .string()
      .describe(
        "Créneau souhaité en ISO 8601 avec fuseau horaire (ex: 2026-04-20T10:00:00+02:00). Si le prospect est vague, propose un créneau réaliste et confirme-le à l'oral."
      ),
    duration_minutes: z.number().int().positive().optional(),
    notes: z.string().optional(),
  },
  async (args) => {
    console.log(`  📅 book_appointment: ${args.name} (${args.company}) @ ${args.preferred_slot_iso}`);
    try {
      let gcal_link = "";
      let event_id = "";
      try {
        const ev = await createTentativeEvent(args);
        event_id = ev.event_id;
        gcal_link = ev.html_link;
      } catch (gcalErr) {
        console.error(`    ⚠️  GCal failed: ${gcalErr}`);
      }

      await appendJson(APPOINTMENTS_JSON_PATH, {
        ...args,
        gcal_event_id: event_id,
        gcal_link,
        created_at: new Date().toISOString(),
      });

      const telegram = await sendTelegramMessage(
        formatAppointmentCard({ ...args, gcal_link }),
        { markdown: true }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              gcal_event_id: event_id,
              telegram_ok: telegram.ok,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `book_appointment failed: ${err}` }],
        isError: true,
      };
    }
  },
  { annotations: { destructiveHint: false, openWorldHint: true } }
);

const notifyOwnerTool = tool(
  "notify_owner",
  "Transmet un message à Mr Armourdom via Telegram (question hors FAQ d'un prospect, ou message d'un appelant qui n'est pas un prospect).",
  {
    tag: z.enum(["prospect_question", "message_general"]),
    name: z.string(),
    phone: z.string().optional(),
    message: z.string().describe("Résumé fidèle de la demande ou du message laissé"),
  },
  async (args) => {
    console.log(`  📨 notify_owner [${args.tag}]: ${args.name}`);
    try {
      const res = await sendTelegramMessage(formatOwnerMessage(args), {
        markdown: true,
      });
      if (!res.ok) {
        return {
          content: [{ type: "text" as const, text: `Telegram failed: ${res.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: "ok" }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `notify_owner failed: ${err}` }],
        isError: true,
      };
    }
  },
  { annotations: { destructiveHint: false, openWorldHint: true } }
);

export const receptionistMcpServer = createSdkMcpServer({
  name: "gbp_receptionist",
  version: "1.0.0",
  tools: [bookAppointmentTool, notifyOwnerTool],
});

export async function logCall(record: {
  call_sid: string;
  started_at: string;
  ended_at: string;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
  outcome: string;
}) {
  await appendJson(CALLS_JSON_PATH, record);
}

import { google } from "googleapis";
import {
  GCAL_CLIENT_ID,
  GCAL_CLIENT_SECRET,
  GCAL_REFRESH_TOKEN,
  GCAL_CALENDAR_ID,
  GCAL_TIMEZONE,
} from "../config.js";

function calendarClient() {
  const oauth2 = new google.auth.OAuth2(GCAL_CLIENT_ID, GCAL_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GCAL_REFRESH_TOKEN });
  return google.calendar({ version: "v3", auth: oauth2 });
}

export interface CreateEventInput {
  name: string;
  company: string;
  city: string;
  sector: string;
  phone: string;
  preferred_slot_iso: string;
  duration_minutes?: number;
  notes?: string;
}

export async function createTentativeEvent(
  input: CreateEventInput
): Promise<{ event_id: string; html_link: string }> {
  if (!GCAL_CLIENT_ID || !GCAL_CLIENT_SECRET || !GCAL_REFRESH_TOKEN) {
    throw new Error(
      "Google Calendar not configured: set GCAL_CLIENT_ID/SECRET/REFRESH_TOKEN"
    );
  }
  const cal = calendarClient();
  const start = new Date(input.preferred_slot_iso);
  const duration = input.duration_minutes ?? 30;
  const end = new Date(start.getTime() + duration * 60 * 1000);

  const description = [
    `Entreprise : ${input.company}`,
    `Ville : ${input.city}`,
    `Secteur : ${input.sector}`,
    `Téléphone : ${input.phone}`,
    input.notes ? `Notes : ${input.notes}` : "",
    "",
    "RDV créé automatiquement par l'assistante téléphonique GBP Edge.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await cal.events.insert({
    calendarId: GCAL_CALENDAR_ID,
    requestBody: {
      summary: `[GBP Edge] Analyse gratuite — ${input.name} (${input.company})`,
      description,
      start: { dateTime: start.toISOString(), timeZone: GCAL_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: GCAL_TIMEZONE },
      status: "tentative",
    },
  });

  return {
    event_id: res.data.id ?? "",
    html_link: res.data.htmlLink ?? "",
  };
}

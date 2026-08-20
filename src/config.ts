import "dotenv/config";

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";

export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
export const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? "";
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "";

export const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY ?? "";
export const ASSEMBLYAI_LANGUAGE = process.env.ASSEMBLYAI_LANGUAGE ?? "fr";

export const ELEVENLABS_API_KEY =
  process.env.ELEVENLABS_API_KEY ?? process.env.ELEVEN_LABS_API_KEY ?? "";
export const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ?? "XB0fDUnXU5powFXDhCwa";
export const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";
export const ELEVENLABS_SPEED = Number(process.env.ELEVENLABS_SPEED ?? 1.05);

export const GCAL_CLIENT_ID = process.env.GCAL_CLIENT_ID ?? "";
export const GCAL_CLIENT_SECRET = process.env.GCAL_CLIENT_SECRET ?? "";
export const GCAL_REFRESH_TOKEN = process.env.GCAL_REFRESH_TOKEN ?? "";
export const GCAL_CALENDAR_ID = process.env.GCAL_CALENDAR_ID ?? "primary";
export const GCAL_TIMEZONE = process.env.GCAL_TIMEZONE ?? "Europe/Paris";

export const TELEGRAM_BOT_API_KEY = process.env.TELEGRAM_BOT_API_KEY ?? "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

export const PORT = Number(process.env.PORT ?? 8080);

export const DATA_DIR = new URL("../data/", import.meta.url).pathname;
export const CALLS_JSON_PATH = `${DATA_DIR}calls.json`;
export const APPOINTMENTS_JSON_PATH = `${DATA_DIR}appointments.json`;

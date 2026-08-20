import "dotenv/config";
import { google } from "googleapis";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// One-shot helper to obtain a Google Calendar refresh token.
// 1. In Google Cloud console, create an OAuth 2.0 Client (type: "Desktop").
// 2. Put client_id and client_secret in .env as GCAL_CLIENT_ID / GCAL_CLIENT_SECRET.
// 3. Run: npm run gcal:token
// 4. Open the printed URL, approve, paste the code back here.
// 5. Copy the printed refresh_token into .env as GCAL_REFRESH_TOKEN.

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

async function main() {
  const clientId = process.env.GCAL_CLIENT_ID;
  const clientSecret = process.env.GCAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GCAL_CLIENT_ID and GCAL_CLIENT_SECRET must be set in .env first.");
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\n1) Open this URL in your browser and approve:\n");
  console.log(url);
  console.log("\n2) Google will show you a code. Paste it below.\n");

  const rl = createInterface({ input, output });
  const code = (await rl.question("Authorization code: ")).trim();
  rl.close();

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("No refresh_token returned. Revoke access in Google account settings and try again.");
  }
  console.log("\n✅ Success. Add this to your .env:\n");
  console.log(`GCAL_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

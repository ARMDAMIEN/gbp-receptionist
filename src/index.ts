import "dotenv/config";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { PORT } from "./config.js";
import { registerIncomingVoice } from "./twilio/incoming.js";
import { registerMediaStream } from "./twilio/mediaStream.js";

const app = Fastify({ logger: false });

app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_req, _body, done) => done(null, {})
);

await app.register(fastifyWebsocket);

app.get("/health", async () => ({ ok: true, service: "gbp-receptionist" }));

registerIncomingVoice(app);
registerMediaStream(app);

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`🚀 gbp-receptionist listening on :${PORT}`);
} catch (err) {
  console.error("Failed to start server:", err);
  process.exit(1);
}

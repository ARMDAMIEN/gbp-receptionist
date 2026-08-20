import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PUBLIC_BASE_URL } from "../config.js";

export function registerIncomingVoice(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const host = PUBLIC_BASE_URL
      ? PUBLIC_BASE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : req.headers.host;
    const wsUrl = `wss://${host}/twilio/media`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`;

    reply.header("Content-Type", "text/xml").send(twiml);
  };

  app.post("/voice", handler);
  app.get("/voice", handler);
}

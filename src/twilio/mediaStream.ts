import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { AssemblyAIStream } from "../stt/assemblyai.js";
import { streamElevenLabsMuLaw } from "../tts/elevenlabs.js";
import { chunkMuLawFrames, muLawBufferToPcm16 } from "../lib/audio.js";
import { AgentSession } from "../agent/session.js";
import { GREETING } from "../prompt.js";
import { logCall } from "../agent/tools.js";

const TWILIO_FRAME_BYTES = 160;
const TWILIO_FRAME_MS = 20;

const SENTENCE_SPLIT_RE = /([^.!?…\n]+[.!?…\n]+)/g;

export function registerMediaStream(app: FastifyInstance) {
  app.get("/twilio/media", { websocket: true }, (connection /*, req */) => {
    const ws = connection as unknown as WebSocket;
    let streamSid = "";
    let callSid = "";
    const startedAt = new Date().toISOString();
    const transcript: Array<{ role: "user" | "assistant"; text: string }> = [];

    const aai = new AssemblyAIStream();
    let aaiReady = false;
    const pendingPcm: Buffer[] = [];

    aai.on("open", () => {
      aaiReady = true;
      for (const buf of pendingPcm) aai.sendPcm16(buf);
      pendingPcm.length = 0;
    });
    aai.on("error", (err) => console.error("[aai error]", err.message));

    let speaking = false;
    let turnAbort = { cancelled: false };
    let ttsChain: Promise<void> = Promise.resolve();
    let sentenceBuffer = "";

    const sendClear = () => {
      if (streamSid && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: "clear", streamSid }));
      }
    };

    const speakSentence = async (text: string, abort: { cancelled: boolean }) => {
      if (abort.cancelled || !text.trim()) return;
      speaking = true;
      try {
        let leftover = Buffer.alloc(0);
        for await (const chunk of streamElevenLabsMuLaw(text)) {
          if (abort.cancelled) return;
          const buf = Buffer.concat([leftover, chunk]);
          const fullFrames = Math.floor(buf.length / TWILIO_FRAME_BYTES);
          const frames = chunkMuLawFrames(
            buf.subarray(0, fullFrames * TWILIO_FRAME_BYTES),
            TWILIO_FRAME_BYTES
          );
          leftover = buf.subarray(fullFrames * TWILIO_FRAME_BYTES);
          for (const frame of frames) {
            if (abort.cancelled) return;
            if (ws.readyState !== ws.OPEN) return;
            ws.send(
              JSON.stringify({
                event: "media",
                streamSid,
                media: { payload: frame.toString("base64") },
              })
            );
            await new Promise((r) => setTimeout(r, TWILIO_FRAME_MS));
          }
        }
        if (leftover.length > 0 && !abort.cancelled && ws.readyState === ws.OPEN) {
          const padded = Buffer.alloc(TWILIO_FRAME_BYTES, 0xff);
          leftover.copy(padded);
          ws.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: padded.toString("base64") },
            })
          );
        }
      } catch (err) {
        console.error("[tts error]", err);
      }
    };

    const enqueue = (text: string) => {
      const t = text.trim();
      if (!t) return;
      console.log(`🗣  ${t}`);
      const abort = turnAbort;
      ttsChain = ttsChain.then(() => speakSentence(t, abort));
    };

    const flushSentencesFromBuffer = () => {
      let lastIdx = 0;
      let match: RegExpExecArray | null;
      SENTENCE_SPLIT_RE.lastIndex = 0;
      while ((match = SENTENCE_SPLIT_RE.exec(sentenceBuffer)) !== null) {
        enqueue(match[1]!);
        lastIdx = SENTENCE_SPLIT_RE.lastIndex;
      }
      if (lastIdx > 0) {
        sentenceBuffer = sentenceBuffer.slice(lastIdx);
      }
    };

    const agent = new AgentSession({
      onAssistantDelta: (delta) => {
        if (!delta) return;
        sentenceBuffer += delta;
        flushSentencesFromBuffer();
      },
      onAssistantTextBlockEnd: () => {
        if (sentenceBuffer.trim()) {
          enqueue(sentenceBuffer);
          sentenceBuffer = "";
        }
      },
      onAssistantText: (text) => {
        transcript.push({ role: "assistant", text });
        console.log(`🤖 ${text}`);
      },
      onToolUse: (name) => console.log(`🔧 ${name}`),
      onError: (err) => console.error("[agent error]", err),
    });
    agent.start();

    const greet = () => enqueue(GREETING);

    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.event) {
        case "start": {
          streamSid = msg.start?.streamSid ?? "";
          callSid = msg.start?.callSid ?? "";
          console.log(`📞 call start sid=${callSid}`);
          greet();
          break;
        }
        case "media": {
          const mu = Buffer.from(msg.media.payload, "base64");
          const pcm = muLawBufferToPcm16(mu);
          if (aaiReady) aai.sendPcm16(pcm);
          else pendingPcm.push(pcm);
          break;
        }
        case "stop": {
          console.log(`📞 call stop sid=${callSid}`);
          cleanup("caller_hangup");
          break;
        }
      }
    });

    aai.on("partial", (text) => {
      if (speaking && text.trim().length > 2) {
        turnAbort.cancelled = true;
        turnAbort = { cancelled: false };
        sentenceBuffer = "";
        ttsChain = Promise.resolve();
        speaking = false;
        sendClear();
      }
    });

    aai.on("final", (text) => {
      const clean = text.trim();
      if (!clean) return;
      transcript.push({ role: "user", text: clean });
      console.log(`👤 ${clean}`);
      agent.sendUserTurn(clean);
    });

    const cleanup = (outcome: string) => {
      turnAbort.cancelled = true;
      try {
        aai.close();
      } catch {}
      try {
        agent.end();
      } catch {}
      void logCall({
        call_sid: callSid,
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        transcript,
        outcome,
      }).catch((err) => console.error("[log_call error]", err));
    };

    ws.on("close", () => cleanup("ws_close"));
    ws.on("error", (err) => {
      console.error("[twilio ws error]", err);
      cleanup("ws_error");
    });
  });
}

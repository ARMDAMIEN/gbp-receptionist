import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { ASSEMBLYAI_API_KEY, ASSEMBLYAI_LANGUAGE } from "../config.js";

// AssemblyAI Universal Streaming (v3) accepts PCM16 mono.
// We feed 8 kHz PCM16 derived from Twilio's μ-law stream.
const ENDPOINT = "wss://streaming.assemblyai.com/v3/ws";
const SAMPLE_RATE = 8000;

export interface AssemblyAIStreamEvents {
  open: () => void;
  partial: (text: string) => void;
  final: (text: string) => void;
  error: (err: Error) => void;
  close: () => void;
}

export interface AssemblyAIStream extends EventEmitter {
  on<K extends keyof AssemblyAIStreamEvents>(
    event: K,
    listener: AssemblyAIStreamEvents[K]
  ): this;
  emit<K extends keyof AssemblyAIStreamEvents>(
    event: K,
    ...args: Parameters<AssemblyAIStreamEvents[K]>
  ): boolean;
}

export class AssemblyAIStream extends EventEmitter {
  private ws: WebSocket;
  private opened = false;

  constructor() {
    super();
    const url =
      `${ENDPOINT}?sample_rate=${SAMPLE_RATE}` +
      `&encoding=pcm_s16le` +
      `&speech_model=universal-streaming-multilingual` +
      `&language_code=${ASSEMBLYAI_LANGUAGE}` +
      `&format_turns=true`;
    this.ws = new WebSocket(url, {
      headers: { Authorization: ASSEMBLYAI_API_KEY },
    });

    console.log(`[aai] connecting to ${url}`);
    this.ws.on("open", () => {
      console.log("[aai] ws open");
      this.opened = true;
      this.emit("open");
    });
    this.ws.on("message", (data) => this.handleMessage(data));
    this.ws.on("error", (err) => {
      console.error("[aai] ws error:", err.message);
      this.emit("error", err);
    });
    this.ws.on("close", (code, reason) => {
      console.log(`[aai] ws close code=${code} reason=${reason?.toString() || ""}`);
      this.emit("close");
    });
  }

  private firstMessageLogged = 0;
  private handleMessage(data: WebSocket.RawData) {
    try {
      const raw = data.toString();
      if (this.firstMessageLogged < 3) {
        console.log(`[aai msg] ${raw.slice(0, 300)}`);
        this.firstMessageLogged++;
      }
      const msg = JSON.parse(raw);
      const type = msg.type ?? msg.message_type;
      if (type === "Turn" || type === "PartialTranscript" || type === "FinalTranscript") {
        const text: string = msg.transcript ?? msg.text ?? "";
        if (!text) return;
        const isFinal = msg.end_of_turn === true || type === "FinalTranscript";
        if (isFinal) this.emit("final", text);
        else this.emit("partial", text);
      }
    } catch (err) {
      this.emit("error", err as Error);
    }
  }

  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private static readonly FLUSH_BYTES = 1600;

  sendPcm16(pcm: Buffer) {
    if (!this.opened || this.ws.readyState !== WebSocket.OPEN) {
      this.pending.push(pcm);
      this.pendingBytes += pcm.length;
      return;
    }
    this.pending.push(pcm);
    this.pendingBytes += pcm.length;
    while (this.pendingBytes >= AssemblyAIStream.FLUSH_BYTES) {
      const merged = Buffer.concat(this.pending);
      const toSend = merged.subarray(0, AssemblyAIStream.FLUSH_BYTES);
      const rest = merged.subarray(AssemblyAIStream.FLUSH_BYTES);
      this.pending = rest.length > 0 ? [rest] : [];
      this.pendingBytes = rest.length;
      this.ws.send(toSend, { binary: true });
    }
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "Terminate" }));
      } catch {}
      this.ws.close();
    }
  }
}

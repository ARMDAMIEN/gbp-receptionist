# gbp-receptionist

A French-speaking phone receptionist that answers a real phone number, holds a natural
spoken conversation, qualifies the caller, and books a meeting in Google Calendar.

Built as a **full-duplex realtime voice loop** over a single websocket:
Twilio Media Streams → AssemblyAI streaming STT → Claude Haiku → ElevenLabs streaming TTS,
with barge-in so the caller can interrupt mid-sentence.

The whole design is shaped by one constraint: **a pause longer than about a second reads as
"the line went dead"**. Everything below is in service of that.

---

## What a call looks like

1. Twilio receives a call and POSTs to `/voice`.
2. The server answers with TwiML that opens a bidirectional media stream:
   `<Connect><Stream url="wss://…/twilio/media"/></Connect>`.
3. From there, one websocket carries the whole call in both directions — caller audio in,
   synthesized speech out, 8 kHz μ-law, 20 ms frames.
4. The agent greets, qualifies the caller, and either books a slot or takes a message.
5. On hangup, the full transcript and outcome are written to a call log.

The agent recognises four caller types and routes each differently: a prospect wanting an
appointment (collect details → `book_appointment`), a prospect with a FAQ question (answer,
then offer the appointment), a prospect with an off-FAQ question (`notify_owner` tagged
`prospect_question`), and anyone else (`notify_owner` tagged `message_general`).

---

## Architecture

```
                    ┌──────────── one websocket, full duplex ────────────┐
                    │                                                     │
   caller ──▶ Twilio ──▶ /twilio/media ──▶ μ-law→PCM16 ──▶ AssemblyAI streaming STT
                    │                                              │
                    │                                      partial │ final
                    │                                     (barge-in)│ (turn)
                    │                                              ▼
                    │                                   Claude Haiku (Agent SDK,
                    │                                    streaming-input session)
                    │                                              │
                    │                                     text deltas, split
                    │                                     into sentences
                    │                                              ▼
   caller ◀── Twilio ◀── 20 ms μ-law frames ◀────── ElevenLabs streaming TTS
                    │                                (output_format=ulaw_8000)
                    └─────────────────────────────────────────────────────┘
```

---

## Where the latency budget goes, and how it's spent

Four decisions do most of the work:

**1. Sentence-level pipelining, not turn-level.**
The model's text deltas are accumulated and split on sentence boundaries
(`/([^.!?…\n]+[.!?…\n]+)/`). Each completed sentence is handed to TTS *immediately* while
the model is still generating the rest. The caller hears the first sentence while the
second is still being written. Waiting for the full turn before synthesising would add the
model's entire generation time to every reply.

Sentences are queued through a promise chain (`ttsChain`) so they still play in order.

**2. μ-law end to end — no resampling, no transcoding.**
ElevenLabs is asked for `output_format=ulaw_8000`, which is exactly what Twilio Media
Streams wants. The bytes go from the TTS response straight into the websocket. No sample
rate conversion, no codec step, no ffmpeg in the hot path.

**3. Haiku, deliberately.**
This is the one place the model choice is dictated by physics rather than capability. Every
extra hundred milliseconds of time-to-first-token is silence on a live phone call. The task
— qualify a caller, follow a script, call one of two tools — is well within Haiku, so
spending latency on a larger model would buy nothing a caller could hear.

**4. One long-lived agent session per call.**
The Claude Agent SDK's `query()` is driven in *streaming-input mode*: an async generator
yields each finalized user utterance into a single session that stays open for the whole
call. The alternative — one request per turn — would re-send and re-process the
conversation every time the caller speaks.

Playback is paced at one 160-byte frame per 20 ms to match realtime. Trailing bytes that
don't fill a frame are padded with `0xff`, which is μ-law silence.

---

## Barge-in

The part that's easy to get subtly wrong.

When AssemblyAI emits a **partial** transcript while the agent is speaking, the caller has
started talking over it. Three things have to happen at once:

```ts
turnAbort.cancelled = true;   // stop the in-flight TTS generator
turnAbort = { cancelled: false };
sentenceBuffer = "";          // drop text not yet spoken
ttsChain = Promise.resolve(); // clear the queue of pending sentences
sendClear();                  // tell Twilio to flush its own buffer
```

That last line is the non-obvious one. Twilio buffers the frames it has already received,
so simply *stopping sending* is not enough — the caller keeps hearing several hundred
milliseconds of speech after the agent has "stopped". The `clear` event discards Twilio's
jitter buffer, which is what makes the interruption feel immediate.

The abort flag is captured per turn (`const abort = turnAbort`) rather than read from a
shared variable, so a cancelled turn's frames can't leak into the next one.

---

## Implementation details worth a look

- **`src/lib/audio.ts`** — μ-law codec written by hand (encode, decode, buffer helpers,
  frame chunking, linear downsampling). No native dependencies, so the container stays
  small and portable.
- **`src/stt/assemblyai.ts`** — AssemblyAI Universal Streaming v3 over websocket, PCM16
  mono at 8 kHz, multilingual model with `format_turns=true`. Audio is coalesced into
  1600-byte flushes (100 ms) rather than sent per 20 ms frame, to avoid a websocket write
  per frame. Audio arriving before the STT socket opens is buffered and replayed on `open`
  rather than dropped — otherwise the first word of every call is lost.
- **`src/agent/session.ts`** — the streaming-input wrapper around the Agent SDK, with a
  queue plus a parked promise so `sendUserTurn()` never blocks the websocket handler.
- **`src/twilio/mediaStream.ts`** — the call loop: greeting, media pump, barge-in,
  transcript accumulation, cleanup on hangup / close / error.

## Tools available to the agent

| Tool | Effect |
|---|---|
| `book_appointment` | Creates a tentative Google Calendar event and sends a formatted card to Telegram |
| `notify_owner` | Sends a Telegram message, tagged `prospect_question` or `message_general` |

The system prompt requires the agent to *say something first* — "Très bien, je note ça tout
de suite." — before invoking a tool, so the caller hears speech instead of dead air while
the call to Google or Telegram is in flight.

---

## Running it

```sh
npm install
cp .env.example .env     # fill in Twilio, AssemblyAI, ElevenLabs, Google Calendar
npm run gcal:token       # one-time: mints GCAL_REFRESH_TOKEN
npm start
```

Twilio must reach the server over the public internet. For local development, point
`PUBLIC_BASE_URL` at an ngrok tunnel and set the number's voice webhook to
`https://<host>/voice`.

### Deploy

```sh
fly deploy
fly secrets set TWILIO_ACCOUNT_SID=… ASSEMBLYAI_API_KEY=… ELEVENLABS_API_KEY=… …
```

Note `fly.toml` sets `min_machines_running = 1` and `auto_stop_machines = 'off'`. That is
deliberate and is the opposite of the scale-to-zero configuration used elsewhere in this
workspace: an inbound call cannot wait for a cold start, so this service stays warm.

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` | see the latency argument above |
| `ASSEMBLYAI_LANGUAGE` | `fr` | |
| `ELEVENLABS_SPEED` | `1.05` | slightly faster than natural; reads as brisk, not rushed |
| `PORT` | `8080` | |

---

## Why this one is not a scheduled agent

The other agents in this workspace are batch jobs that were migrated to scheduled Claude
Code routines running on a subscription. This one can't be, and the reason is structural
rather than incidental: it is **reactive and always-on**. There is no schedule to convert —
it is driven by inbound calls, it must hold a websocket open, and it has to respond inside
a human conversational gap. So it stays a long-lived service on the metered API, where its
cost is per actual inbound call.

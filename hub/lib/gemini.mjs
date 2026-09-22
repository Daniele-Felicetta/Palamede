// Palamede hub � narratori cloud via Google AI Studio (Gemini).
//
// Gemini espone un endpoint OpenAI-compatibile, quindi il dialogo usa lo
// stesso formato SSE di llama-server e il frontend riusa il parser Text.
// La chiave NON esce mai dal server: sta solo in env PALAMEDE_GEMINI_API_KEY,
// il client vede solo {configured, models} da GET /api/narrators.
//
// Uso: Bandersketch (narratore cloud con fallback al locale). Rate limit del
// free tier: una partita sono ~10 richieste, ampiamente dentro le quote.

import { Readable } from "node:stream";
import { json, readBody } from "./http.mjs";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const key = () => process.env.PALAMEDE_GEMINI_API_KEY || "";

export const GEMINI_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", hint: "cloud � gratis" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", hint: "cloud � gratis (riserva)" },
];

const validModel = (id) => GEMINI_MODELS.some((m) => m.id === id);

export function geminiStatus() {
  return { configured: !!key(), models: GEMINI_MODELS };
}

// POST /api/narrate {model, messages, system?, temperature?, max_tokens?}
// Risposta: SSE pass-through (stream di default) oppure {text} se stream:false.
export async function narrateGemini(req, res) {
  if (!key()) return json(res, 503, { error: { message: "narratore cloud non configurato: imposta PALAMEDE_GEMINI_API_KEY" } });
  let b;
  try {
    b = await readBody(req);
  } catch (e) {
    return json(res, 400, { error: { message: e.message } });
  }
  const model = b && typeof b.model === "string" ? b.model : GEMINI_MODELS[0].id;
  if (!validModel(model)) return json(res, 400, { error: { message: "modello cloud sconosciuto" } });
  const messages = Array.isArray(b.messages) ? b.messages.slice(0, 20) : null;
  if (!messages || !messages.length) return json(res, 400, { error: { message: "messages mancanti" } });
  // tetto anti-abuso: i frammenti del gioco sono corti, 30k caratteri bastano
  const total = JSON.stringify(messages).length;
  if (total > 30000) return json(res, 400, { error: { message: "prompt troppo lungo (max ~30k caratteri)" } });
  const temperature = Math.min(2, Math.max(0, Number(b.temperature ?? 0.6) || 0));
  const maxTokens = Math.min(4000, Math.max(1, Number(b.max_tokens ?? 400) || 400));
  const stream = b.stream !== false;
  const payload = {
    model,
    messages: b.system ? [{ role: "system", content: b.system }, ...messages] : messages,
    temperature,
    max_tokens: maxTokens,
    stream,
    // thinking LOW: il ragionamento interno consumerebbe budget di output
    // (con MEDIUM di default il testo arrivava vuoto), per narrare basta poco
    extra_body: { google: { thinking_config: { thinking_level: "LOW" } } },
  };
  let upstream;
  try {
    upstream = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300000),
    });
  } catch (e) {
    return json(res, 502, { error: { message: "Gemini non raggiungibile (" + (e.message || e) + ")" } });
  }
  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text().catch(() => "");
    return json(res, 502, { error: { message: "Gemini HTTP " + upstream.status + (err ? ": " + err.slice(0, 200) : "") } });
  }
  if (!stream) {
    try {
      const j = await upstream.json();
      const text = j && j.choices && j.choices[0] && j.choices[0].message
        ? String(j.choices[0].message.content || "") : "";
      return json(res, 200, { text });
    } catch (e) {
      return json(res, 502, { error: { message: "risposta Gemini illeggibile" } });
    }
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  try {
    for await (const chunk of upstream.body) res.write(chunk);
  } catch { /* client andato via */ }
  res.end();
}


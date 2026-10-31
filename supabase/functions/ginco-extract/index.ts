import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";

const num = { type: "number" };
const str = { type: "string" };
const schema = {
  type: "object",
  properties: {
    document_type: { type: "string", enum: ["invoice", "delivery_note", "order", "other"] },
    supplier_name: str,
    invoice_number: str,
    invoice_date: { type: "string", description: "YYYY-MM-DD" },
    currency: { type: "string", description: "3-letter code, default GBP" },
    net_amount: num,
    tax_amount: num,
    total_amount: num,
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: str,
          quantity: num,
          unit: { type: "string", description: "kg, g, l, case, box, each, etc." },
          pack_size: { type: "number", description: "base units per pack, e.g. 25 for a 25kg sack" },
          unit_price: { type: "number", description: "price per pack/unit as printed" },
          vat_rate: num,
          line_total: num,
          batch_code: str,
          best_before: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["description"],
      },
    },
    notes: { type: "string", description: "anything unclear or unreadable" },
    language: { type: "string", enum: ["en", "hi", "pa"], description: "main language the user spoke or typed: en English, hi Hindi, pa Punjabi" },
    transcript: { type: "string", description: "for audio: exactly what was said, in the original language and script" },
    reply: { type: "string", description: "one or two short friendly sentences, in the reply language, summarising what was understood and asking the user to check and save" },
  },
  required: ["lines"],
};

function pickText(r: any): string {
  if (typeof r?.output_text === "string") return r.output_text;
  // Interactions API: text lives in model_output steps (ignore echoed user input)
  const steps: any[] = Array.isArray(r?.steps) ? r.steps : Array.isArray(r?.outputs) ? r.outputs : [];
  const fromSteps = steps
    .filter((st) => !st?.type || st.type === "model_output" || st.type === "text")
    .flatMap((st) => (Array.isArray(st?.content) ? st.content : [st]))
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text).join("");
  if (fromSteps) return fromSteps;
  // generateContent (legacy) shape
  const parts = r?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((p: any) => p?.text ?? "").join("");
  return "";
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const names = ["GEMINI_API_KEY", "GEMINI_KEY", "GOOGLE_API_KEY", "GOOGLE_GEMINI_API_KEY", "GEMINI_API", "AI_API_KEY"];
  const key = names.map((n) => Deno.env.get(n)?.trim()).find(Boolean);
  if (!key) {
    // names only (never values), to help find a mistyped secret
    const seen = Object.keys(Deno.env.toObject()).filter((n) => !n.startsWith("SUPABASE_") && !/^(DENO|PATH|HOME|HOSTNAME|SB_|EDGE)/.test(n));
    return json({ error: `Gemini key not found. Add a secret named GEMINI_API_KEY in Supabase → Edge Functions → Secrets. Custom secrets found: ${seen.join(", ") || "none"}` }, 500);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { text, image_base64, mime_type, audio_base64, audio_mime, reply_language } = body ?? {};
  if (!text && !image_base64 && !audio_base64) return json({ error: "Send text, image_base64 or audio_base64" }, 400);
  if (image_base64 && image_base64.length > 14_000_000) return json({ error: "Image too large; resize and retry" }, 413);
  if (audio_base64 && audio_base64.length > 14_000_000) return json({ error: "Recording too long; keep it under a few minutes" }, 413);
  const aMime = String(audio_mime || "audio/webm").split(";")[0];
  const langName: Record<string, string> = { en: "English", hi: "Hindi (Devanagari script)", pa: "Punjabi (Gurmukhi script)" };

  const today = new Date().toISOString().slice(0, 10);
  const prompt =
    `Today is ${today}. Extract purchasing data for a UK food retail/wholesale business into the JSON schema. ` +
    `Rules: copy numbers exactly as printed; never invent values, leave a field out if unknown; dates as YYYY-MM-DD; currency GBP unless shown otherwise; ` +
    `put anything unclear in notes. If the input is a spoken or typed note (e.g. 'ordered 20kg basmati from Ali Foods at 1.20 a kilo today'), ` +
    `set document_type to order and fill supplier_name and lines. ` +
    `The user may speak or type in English, Hindi or Punjabi, including romanised Hindi/Punjabi or a mix with English words; detect it yourself and set language. ` +
    `Always write supplier_name and line descriptions in English (translate or transliterate product names, e.g. 'chawal' -> 'rice'). ` +
    (audio_base64 ? `An audio recording is attached: transcribe it into transcript, then extract from it. ` : "") +
    `Write reply in ${audio_base64 || text ? "the same language the user used (Hindi in Devanagari, Punjabi in Gurmukhi)" : (langName[reply_language] ?? "English")}. ` +
    (text ? `\n\nInput text:\n${text}` : "");

  const input: unknown[] = [{ type: "text", text: prompt }];
  if (image_base64) input.push({ type: "image", data: image_base64, mime_type: mime_type || "image/jpeg" });
  if (audio_base64) input.push({ type: "audio", data: audio_base64, mime_type: aMime });

  // 1st try: Interactions API (Google's default since June 2026)
  let res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input, response_format: { type: "text", mime_type: "application/json", schema } }),
  });
  let raw: any = await res.json().catch(() => ({}));
  let via = "interactions";

  // Fallback: generateContent (stable legacy endpoint)
  if (!res.ok || !pickText(raw)) {
    const parts: unknown[] = [{ text: prompt }];
    if (image_base64) parts.push({ inline_data: { mime_type: mime_type || "image/jpeg", data: image_base64 } });
    if (audio_base64) parts.push({ inline_data: { mime_type: aMime, data: audio_base64 } });
    const res2 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0 } }),
    });
    const raw2 = await res2.json().catch(() => ({}));
    if (res2.ok && pickText(raw2)) { res = res2; raw = raw2; via = "generateContent"; }
    else if (!res.ok) return json({ error: "Gemini request failed", status: res2.status || res.status, detail: raw2?.error ?? raw?.error ?? raw2 }, 502);
  }

  const out = pickText(raw).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return json({ ok: true, model: MODEL, via, data: JSON.parse(out) });
  } catch {
    return json({ error: "Could not parse model output", output: out }, 502);
  }
});

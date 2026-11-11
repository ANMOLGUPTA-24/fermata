// Gemini client. Model note: gemini-2.5-* is refused for keys created after its
// retirement ("no longer available to new users"), so we pin a stable alias that
// will still resolve during the Dec 1-15 judging window.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const FALLBACK = 'gemini-3.1-flash-lite';
const ENDPOINT = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

async function call(model, body, timeoutMs) {
  const res = await fetch(ENDPOINT(model), {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Gemini ${model} ${res.status}: ${json?.error?.message || ''}`);
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('');
  if (!text) throw new Error(`Gemini ${model} returned no text: ${JSON.stringify(json).slice(0, 300)}`);
  return text;
}

/**
 * Ask Gemini for a JSON object matching `schema`.
 * Falls back to a lighter model if the primary is rate-limited or unavailable,
 * so a judge hitting a free-tier quota ceiling still sees the product work.
 */
export async function judgeJSON({ prompt, schema, system }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  // Free-tier models time out or shed load under demand. Try the primary, then
  // the lighter model, then each once more, before giving up.
  const attempts = [[MODEL, 18_000], [FALLBACK, 12_000], [MODEL, 18_000], [FALLBACK, 12_000]];
  let raw, lastErr;
  for (const [model, ms] of attempts) {
    try {
      raw = await call(model, body, ms);
      break;
    } catch (err) {
      lastErr = err;
      if (!/429|404|500|503|RESOURCE_EXHAUSTED|timeout|aborted|fetch failed/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  if (raw === undefined) throw lastErr;
  return JSON.parse(raw);
}

export const MODEL_NAME = MODEL;

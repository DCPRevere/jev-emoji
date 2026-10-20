import { DEFAULT_EMOJIS } from "./emojis.js";

export { DEFAULT_EMOJIS };

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_CRITERIA = 255;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export class JevError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "JevError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Create a picker bound to one API key and emoji set.
 *
 * @param {import("./index.js").PickerOptions} [options]
 */
export function createEmojiPicker(options = {}) {
  const {
    apiKey = globalThis.process?.env?.TYPESAFE_API_KEY,
    model = "jev-latest",
    emojis = DEFAULT_EMOJIS,
    threshold = 0,
    fallback = null,
    top: defaultTop = Infinity,
    minProbability: defaultMinProbability = 0,
    questionsPerRequest = 5,
    timeoutMs = 30_000,
    attempts = 3,
    retryDelayMs = 500,
    endpoint = ENDPOINT,
    fetch: fetchImpl = globalThis.fetch,
  } = options;

  if (!apiKey) throw new TypeError("apiKey is required (or set TYPESAFE_API_KEY)");
  if (typeof fetchImpl !== "function") throw new TypeError("No fetch implementation available");

  const criteria = Array.isArray(emojis) ? Object.fromEntries(emojis.map((e) => [e, null])) : { ...emojis };
  const count = Object.keys(criteria).length;
  if (count < 2) throw new RangeError("Need at least two emojis to choose from");
  if (count > MAX_CRITERIA) throw new RangeError(`Jev accepts at most ${MAX_CRITERIA} emojis, got ${count}`);

  function toResult(answer, usedModel, { top = defaultTop, minProbability = defaultMinProbability } = {}) {
    const confidence = typeof answer?.confidence === "number" ? answer.confidence : 0;
    const known = typeof answer?.choice === "string" && Object.hasOwn(criteria, answer.choice);
    const accepted = known && confidence >= threshold;
    const probabilities = answer?.probabilities ?? {};
    // Every offered emoji, most likely first; Jev omits none, but treat a missing one as 0.
    const ranked = Object.keys(criteria)
      .map((emoji) => ({ emoji, probability: typeof probabilities[emoji] === "number" ? probabilities[emoji] : 0 }))
      .sort((a, b) => b.probability - a.probability)
      .filter((r) => r.probability >= minProbability)
      .slice(0, top);
    return {
      emoji: accepted ? answer.choice : fallback,
      choice: known ? answer.choice : null,
      confidence,
      ranked,
      probabilities,
      model: usedModel,
    };
  }

  async function send(body, signal) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(retryDelayMs * 2 ** (attempt - 2), signal);
      const timeout = AbortSignal.timeout(timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (res.ok) return await res.json();
        const text = await res.text().catch(() => "");
        lastError = new JevError(`Jev request failed with HTTP ${res.status}`, { status: res.status, body: text });
        if (!RETRYABLE.has(res.status)) throw lastError;
      } catch (err) {
        if (err instanceof JevError && !RETRYABLE.has(err.status)) throw err;
        if (signal?.aborted) throw signal.reason;
        lastError = err instanceof JevError ? err
          : timeout.aborted ? new JevError(`Jev request timed out after ${timeoutMs} ms`)
          : err;
      }
    }
    throw lastError;
  }

  /** Pick one emoji for `text`. */
  async function pick(text, { signal, ...rank } = {}) {
    const json = await send({
      model,
      state: String(text),
      questions: {
        emoji: { type: "choice", instructions: "Which emoji best fits this text?", criteria },
      },
    }, signal);
    return toResult(json.answers?.emoji, json.model, rank);
  }

  /**
   * Pick an emoji for each text, preserving order. Texts are sent in small batches
   * because Jev's answers drift on long batches.
   */
  async function pickMany(texts, { signal, ...rank } = {}) {
    const results = [];
    for (let start = 0; start < texts.length; start += questionsPerRequest) {
      const chunk = texts.slice(start, start + questionsPerRequest).map(String);
      const questions = Object.fromEntries(chunk.map((_, i) => [`text_${i}`, {
        type: "choice",
        instructions: `Which emoji best fits \`texts[${i}]\`?`,
        criteria,
      }]));
      const json = await send({ model, state: { texts: chunk }, questions }, signal);
      chunk.forEach((_, i) => results.push(toResult(json.answers?.[`text_${i}`], json.model, rank)));
    }
    return results;
  }

  return { pick, pickMany };
}

/** One-off convenience: `await pickEmoji("I got the job!")` → "🎉". */
export async function pickEmoji(text, options) {
  return (await createEmojiPicker(options).pick(text, options)).emoji;
}

/** One-off ranking: `await pickEmojis("I got the job!", { top: 3 })` → ["🎉", "🥳", "😀"]. */
export async function pickEmojis(text, options) {
  return (await createEmojiPicker(options).pick(text, options)).ranked.map((r) => r.emoji);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(id); reject(signal.reason); }, { once: true });
  });
}

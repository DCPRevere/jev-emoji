import { DEFAULT_EMOJIS } from "./emojis.js";

export { DEFAULT_EMOJIS };

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_CHOICES = 255;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export class JevError extends Error {
  constructor(message, { status, body, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
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
    emojis = "lite",
    minConfidence = 0,
    fallback = null,
    top = 5,
    minProbability = 0,
    categories = 3,
    batchSize = 5,
    timeoutMs = 30_000,
    attempts = 3,
    retryDelayMs = 500,
    endpoint = ENDPOINT,
    fetch: fetchImpl = globalThis.fetch,
  } = options;

  if (!apiKey) throw new TypeError("apiKey is required (or set TYPESAFE_API_KEY)");
  if (typeof fetchImpl !== "function") throw new TypeError("No fetch implementation available");
  checkInteger("batchSize", batchSize, 1);
  checkInteger("attempts", attempts, 1);
  checkInteger("categories", categories, 1);
  checkRank(top, minProbability);
  checkFraction("minConfidence", minConfidence);
  if (!(timeoutMs > 0 && Number.isFinite(timeoutMs))) throw new RangeError("timeoutMs must be a positive number");
  if (!(retryDelayMs >= 0 && Number.isFinite(retryDelayMs))) throw new RangeError("retryDelayMs must be a number ≥ 0");

  const full = emojis === "full";
  const criteria = full ? null : toCriteria(emojis === "lite" ? DEFAULT_EMOJIS : emojis);
  let fullSet; // loaded on first use so "lite" users never parse ~2,000 emojis

  function loadFull() {
    return fullSet ??= import("./emojis-full.js").then(({ FULL_EMOJIS }) => ({
      categories: Object.fromEntries(Object.entries(FULL_EMOJIS).map(([id, c]) => [id, c.description])),
      emojis: Object.fromEntries(Object.entries(FULL_EMOJIS).map(([id, c]) => [id, c.emojis])),
    }));
  }

  async function send(body, signal) {
    let lastError;
    let retryAfterMs = 0;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(Math.max(retryDelayMs * 2 ** (attempt - 2), retryAfterMs), signal);
      signal?.throwIfAborted();
      retryAfterMs = 0;
      const timeout = AbortSignal.timeout(timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const text = await res.text();
        if (res.ok) {
          try {
            return JSON.parse(text);
          } catch {
            throw new JevError("Jev returned invalid JSON", { status: res.status, body: text });
          }
        }
        lastError = new JevError(`Jev request failed with HTTP ${res.status}`, { status: res.status, body: text });
        if (!RETRYABLE.has(res.status)) throw lastError;
        const seconds = Number(res.headers?.get?.("retry-after"));
        if (seconds > 0) retryAfterMs = Math.min(seconds * 1000, timeoutMs);
      } catch (err) {
        if (err instanceof JevError) throw err;
        if (signal?.aborted) throw signal.reason;
        lastError = new JevError(
          timeout.aborted ? `Jev request timed out after ${timeoutMs} ms` : `Jev request failed: ${err?.message ?? err}`,
          { cause: err },
        );
      }
    }
    throw lastError;
  }

  /** Ask one choice question per text; returns `[{ answer, model }]` in order. */
  async function ask(texts, choices, about, signal) {
    const question = (instructions) => ({ type: "choice", instructions, criteria: choices });
    const single = texts.length === 1;
    const json = await send(single
      ? { model, state: texts[0], questions: { [about]: question(`Which ${about} best fits this text?`) } }
      : {
        model,
        state: { texts },
        questions: Object.fromEntries(texts.map((_, i) => [`text_${i}`, question(`Which ${about} best fits \`texts[${i}]\`?`)])),
      }, signal);
    return texts.map((_, i) => ({ answer: answerOf(json, single ? about : `text_${i}`), model: json.model ?? model }));
  }

  /** Full mode, second step: search the likeliest categories for `text`, all in one request. */
  async function searchCategories(text, category, set, signal) {
    const ids = Object.entries(category.probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, categories)
      .map(([id]) => id);
    const json = await send({
      model,
      state: text,
      questions: Object.fromEntries(ids.map((id, i) => [`category_${i}`, {
        type: "choice",
        instructions: "Which emoji best fits this text?",
        criteria: set.emojis[id],
      }])),
    }, signal);
    const probabilities = {};
    let best = null;
    ids.forEach((id, i) => {
      const answer = offered(answerOf(json, `category_${i}`), set.emojis[id]);
      const weight = category.probabilities[id];
      for (const [emoji, p] of Object.entries(answer.probabilities)) probabilities[emoji] = weight * p;
      const score = answer.choice === null ? -1 : probabilities[answer.choice];
      if (answer.choice !== null && (!best || score > best.score)) {
        best = { score, choice: answer.choice, confidence: weight * answer.confidence };
      }
    });
    return { answer: { choice: best?.choice ?? null, confidence: best?.confidence ?? 0, probabilities }, model: json.model ?? model };
  }

  function toResult({ choice, confidence, probabilities }, usedModel, n, min) {
    const ranked = Object.entries(probabilities)
      .map(([emoji, probability]) => ({ emoji, probability }))
      .sort((a, b) => b.probability - a.probability)
      .filter((r) => r.probability >= min)
      .slice(0, n);
    return {
      emoji: choice !== null && confidence >= minConfidence ? choice : fallback,
      choice,
      confidence,
      ranked,
      probabilities,
      model: usedModel,
    };
  }

  /**
   * Pick an emoji for each text, preserving order. Texts are sent `batchSize` at a time
   * because Jev's answers drift on long batches.
   */
  async function pickMany(texts, { signal, top: n = top, minProbability: min = minProbability } = {}) {
    if (!Array.isArray(texts) || texts.some((t) => typeof t !== "string")) {
      throw new TypeError("texts must be an array of strings");
    }
    checkRank(n, min);
    const set = full ? await loadFull() : null;
    const results = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const chunk = texts.slice(start, start + batchSize);
      const answers = await ask(chunk, full ? set.categories : criteria, full ? "category" : "emoji", signal);
      for (const [i, { answer, model: usedModel }] of answers.entries()) {
        const picked = full
          ? await searchCategories(chunk[i], offered(answer, set.categories), set, signal)
          : { answer: offered(answer, criteria), model: usedModel };
        results.push(toResult(picked.answer, picked.model, n, min));
      }
    }
    return results;
  }

  /** Pick one emoji for `text`. */
  async function pick(text, options) {
    if (typeof text !== "string") throw new TypeError("text must be a string");
    return (await pickMany([text], options))[0];
  }

  return { pick, pickMany };
}

/** One-off convenience: `await pickEmoji("I got the job!")` → "🎉". */
export async function pickEmoji(text, options) {
  return (await createEmojiPicker(options).pick(text, options)).emoji;
}

/** One-off ranking: `await rankEmojis("I got the job!", { top: 3 })` → ["💼", "🎉", "🥳"]. */
export async function rankEmojis(text, options) {
  return (await createEmojiPicker(options).pick(text, options)).ranked.map((r) => r.emoji);
}

function toCriteria(emojis) {
  let criteria;
  if (Array.isArray(emojis)) {
    if (emojis.some((e) => typeof e !== "string" || !e)) throw new TypeError("emojis must be non-empty strings");
    criteria = Object.fromEntries(emojis.map((e) => [e, null]));
  } else if (emojis && typeof emojis === "object") {
    criteria = { ...emojis };
  } else {
    throw new TypeError('emojis must be "lite", "full", an array or an object');
  }
  const count = Object.keys(criteria).length;
  if (count < 2) throw new RangeError("Need at least two emojis to choose from");
  if (count > MAX_CHOICES) throw new RangeError(`Jev accepts at most ${MAX_CHOICES} emojis, got ${count}`);
  return criteria;
}

function answerOf(json, key) {
  const answer = json?.answers?.[key];
  if (!answer || typeof answer.probabilities !== "object" || answer.probabilities === null) {
    throw new JevError(`Jev response has no answer for "${key}"`, { status: 200, body: JSON.stringify(json) });
  }
  return answer;
}

/**
 * Keep only offered choices, matched ignoring U+FE0F (so "❤" matches "❤️").
 * Every offered choice gets a probability; Jev omits none, but a missing one counts as 0.
 */
function offered(answer, choices) {
  const names = new Map(Object.keys(choices).map((name) => [bare(name), name]));
  const probabilities = Object.fromEntries(Object.keys(choices).map((name) => [name, 0]));
  for (const [name, p] of Object.entries(answer.probabilities)) {
    const known = names.get(bare(name));
    if (known !== undefined && typeof p === "number") probabilities[known] = p;
  }
  return {
    choice: typeof answer.choice === "string" ? names.get(bare(answer.choice)) ?? null : null,
    confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
    probabilities,
  };
}

function bare(name) {
  return name.replaceAll("\uFE0F", "");
}

function checkInteger(name, value, min) {
  if (!Number.isInteger(value) || value < min) throw new RangeError(`${name} must be an integer ≥ ${min}`);
}

function checkFraction(name, value) {
  if (!(value >= 0 && value <= 1)) throw new RangeError(`${name} must be between 0 and 1`);
}

function checkRank(top, minProbability) {
  if (top !== Infinity) checkInteger("top", top, 0);
  checkFraction("minProbability", minProbability);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal.reason);
    };
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

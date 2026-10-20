import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmojiPicker, pickEmoji, pickEmojis, JevError } from "../src/index.js";

/** Fake fetch: each handler answers one call; records request bodies. */
function fakeFetch(...handlers) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    return handler(body, init);
  };
  fn.calls = calls;
  return fn;
}

const json = (status, data) => new Response(JSON.stringify(data), { status });
const answerAll = (choice, confidence) => (body) => json(200, {
  model: "jev-1.13.0",
  answers: Object.fromEntries(Object.keys(body.questions).map((k) => [k, {
    type: "choice", choice, confidence, probabilities: { [choice]: confidence },
  }])),
  usage: { input_tokens: 1, output_tokens: 1 },
});

const opts = (fetch, extra = {}) => ({ apiKey: "k", fetch, retryDelayMs: 0, ...extra });

test("sends a single choice question with the documented shape", async () => {
  const fetch = fakeFetch(answerAll("🎉", 0.9));
  const result = await createEmojiPicker(opts(fetch, { emojis: ["🎉", "😢"] })).pick("I got the job!");

  const { url, init, body } = fetch.calls[0];
  assert.equal(url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer k");
  assert.equal(body.model, "jev-latest");
  assert.equal(body.state, "I got the job!");
  assert.equal(body.questions.emoji.type, "choice");
  assert.deepEqual(Object.keys(body.questions.emoji.criteria), ["🎉", "😢"]);
  assert.deepEqual(result, {
    emoji: "🎉", choice: "🎉", confidence: 0.9,
    ranked: [{ emoji: "🎉", probability: 0.9 }, { emoji: "😢", probability: 0 }],
    probabilities: { "🎉": 0.9 }, model: "jev-1.13.0",
  });
});

test("returns the fallback below the threshold but keeps the raw choice", async () => {
  const fetch = fakeFetch(answerAll("😢", 0.4));
  const r = await createEmojiPicker(opts(fetch, { threshold: 0.6, fallback: "💬" })).pick("hmm");
  assert.equal(r.emoji, "💬");
  assert.equal(r.choice, "😢");
});

test("rejects a choice that was not offered", async () => {
  const fetch = fakeFetch(answerAll("🦄", 0.99));
  const r = await createEmojiPicker(opts(fetch, { emojis: ["🎉", "😢"] })).pick("x");
  assert.equal(r.emoji, null);
  assert.equal(r.choice, null);
});

test("pickMany batches texts and preserves order", async () => {
  let n = 0;
  const fetch = fakeFetch((body) => answerAll(n++ === 0 ? "😀" : "😢", 0.9)(body));
  const texts = ["a", "b", "c"];
  const results = await createEmojiPicker(opts(fetch, { questionsPerRequest: 2 })).pickMany(texts);

  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(fetch.calls[0].body.state, { texts: ["a", "b"] });
  assert.deepEqual(fetch.calls[1].body.state, { texts: ["c"] });
  assert.match(fetch.calls[0].body.questions.text_1.instructions, /`texts\[1\]`/);
  assert.deepEqual(results.map((r) => r.emoji), ["😀", "😀", "😢"]);
});

test("retries on 429 and 529", async () => {
  const fetch = fakeFetch(() => json(429, {}), () => json(529, {}), answerAll("👍", 0.9));
  const r = await createEmojiPicker(opts(fetch)).pick("ok");
  assert.equal(fetch.calls.length, 3);
  assert.equal(r.emoji, "👍");
});

test("gives up after the configured attempts", async () => {
  const fetch = fakeFetch(() => json(503, {}));
  await assert.rejects(createEmojiPicker(opts(fetch)).pick("x"), (e) => e instanceof JevError && e.status === 503);
  assert.equal(fetch.calls.length, 3);
});

test("does not retry client errors", async () => {
  const fetch = fakeFetch(() => json(401, { detail: "bad key" }));
  await assert.rejects(createEmojiPicker(opts(fetch)).pick("x"), (e) => e.status === 401);
  assert.equal(fetch.calls.length, 1);
});

test("retries network errors", async () => {
  const fetch = fakeFetch(() => { throw new TypeError("fetch failed"); }, answerAll("👍", 0.9));
  assert.equal((await createEmojiPicker(opts(fetch)).pick("x")).emoji, "👍");
});

test("times out a hung request", async () => {
  const hang = (_, init) => new Promise((_, reject) =>
    init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const fetch = fakeFetch(hang);
  await assert.rejects(createEmojiPicker(opts(fetch, { timeoutMs: 20, attempts: 2 })).pick("x"), /timed out/);
  assert.equal(fetch.calls.length, 2);
});

test("validates options", () => {
  const fetch = fakeFetch();
  assert.throws(() => createEmojiPicker({ fetch, apiKey: "" }), /apiKey/);
  assert.throws(() => createEmojiPicker(opts(fetch, { emojis: ["🎉"] })), /at least two/);
  const many = Array.from({ length: 256 }, (_, i) => String.fromCodePoint(0x1f600 + i));
  assert.throws(() => createEmojiPicker(opts(fetch, { emojis: many })), /at most 255/);
});

test("pickEmoji returns just the emoji", async () => {
  assert.equal(await pickEmoji("yay", opts(fakeFetch(answerAll("🥳", 0.9)))), "🥳");
});

const spread = (probabilities) => () => json(200, {
  model: "jev-1.13.0",
  answers: { emoji: { type: "choice", choice: "🎉", confidence: probabilities["🎉"], probabilities } },
});
const SPREAD = { "😢": 0.05, "🎉": 0.6, "🥳": 0.3, "😀": 0.05, "🦄": 0.5 };

test("ranks every offered emoji, most likely first, ignoring unoffered ones", async () => {
  const r = await createEmojiPicker(opts(fakeFetch(spread(SPREAD)), { emojis: ["😢", "🎉", "🥳", "😀"] })).pick("x");
  assert.deepEqual(r.ranked.map((e) => e.emoji), ["🎉", "🥳", "😢", "😀"]);
  assert.equal(r.ranked[1].probability, 0.3);
});

test("top and minProbability trim the ranking, per picker or per call", async () => {
  const picker = createEmojiPicker(opts(fakeFetch(spread(SPREAD)), { emojis: ["😢", "🎉", "🥳", "😀"], top: 1 }));
  assert.deepEqual((await picker.pick("x")).ranked.map((e) => e.emoji), ["🎉"]);
  assert.deepEqual((await picker.pick("x", { top: 3, minProbability: 0.1 })).ranked.map((e) => e.emoji), ["🎉", "🥳"]);
  assert.equal((await picker.pickMany(["a"], { top: 2 }))[0].ranked.length, 2);
});

test("pickEmojis returns the top n emojis", async () => {
  const fetch = fakeFetch(spread(SPREAD));
  assert.deepEqual(await pickEmojis("yay", opts(fetch, { emojis: ["😢", "🎉", "🥳"], top: 2 })), ["🎉", "🥳"]);
});

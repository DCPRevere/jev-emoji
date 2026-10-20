import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmojiPicker, pickEmoji, rankEmojis, JevError } from "../src/index.js";

/** Fake fetch: each handler answers one call (the last repeats); records request bodies. */
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

const json = (status, data, headers) => new Response(JSON.stringify(data), { status, headers });

/** A fake Jev: `score(choices, key, body)` gives each question's probabilities; it picks the max. */
const jev = (score) => (body) => json(200, {
  model: "jev-1.13.0",
  answers: Object.fromEntries(Object.entries(body.questions).map(([key, q]) => {
    const probabilities = score(Object.keys(q.criteria), key, body);
    const [choice, confidence] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
    return [key, { type: "choice", choice, confidence, probabilities }];
  })),
});
/** Probabilities from `weights` for the offered choices, 0 for the rest. */
const prefer = (weights) => jev((choices) => Object.fromEntries(choices.map((c) => [c, weights[c] ?? 0])));

const opts = (fetch, extra = {}) => ({ apiKey: "k", fetch, retryDelayMs: 0, ...extra });
const pickWith = (handler, extra) => createEmojiPicker(opts(fakeFetch(handler), extra));

test("sends a single choice question with the documented shape", async () => {
  const fetch = fakeFetch(prefer({ "🎉": 0.9, "😢": 0.1 }));
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
    ranked: [{ emoji: "🎉", probability: 0.9 }, { emoji: "😢", probability: 0.1 }],
    probabilities: { "🎉": 0.9, "😢": 0.1 }, model: "jev-1.13.0",
  });
});

test("minConfidence: below gives the fallback but keeps the choice; equal is accepted", async () => {
  const picker = pickWith(prefer({ "😢": 0.6 }), { minConfidence: 0.6, fallback: "💬" });
  assert.equal((await picker.pick("hmm")).emoji, "😢");
  const low = await pickWith(prefer({ "😢": 0.4 }), { minConfidence: 0.6, fallback: "💬" }).pick("hmm");
  assert.equal(low.emoji, "💬");
  assert.equal(low.choice, "😢");
});

test("ignores choices that were not offered", async () => {
  const fake = () => json(200, { model: "m", answers: { emoji: { choice: "🦄", confidence: 0.99, probabilities: { "🦄": 0.99, "🎉": 0.01 } } } });
  const r = await pickWith(fake, { emojis: ["🎉", "😢"] }).pick("x");
  assert.equal(r.emoji, null);
  assert.equal(r.choice, null);
  assert.deepEqual(r.probabilities, { "🎉": 0.01, "😢": 0 });
});

test("matches choices with or without U+FE0F", async () => {
  const fake = () => json(200, { model: "m", answers: { emoji: { choice: "❤", confidence: 0.9, probabilities: { "❤": 0.9 } } } });
  const r = await pickWith(fake, { emojis: ["❤️", "💔"] }).pick("x");
  assert.equal(r.emoji, "❤️");
  assert.equal(r.probabilities["❤️"], 0.9);
});

test("pickMany batches texts and gives each text its own answer", async () => {
  const byText = { a: "😀", b: "😢", c: "🎉" };
  const fetch = fakeFetch(jev((choices, key, body) => {
    const text = typeof body.state === "string" ? body.state : body.state.texts[Number(key.slice(5))];
    return Object.fromEntries(choices.map((c) => [c, c === byText[text] ? 0.9 : 0]));
  }));
  const results = await createEmojiPicker(opts(fetch, { batchSize: 2 })).pickMany(["a", "b", "c"]);

  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(fetch.calls[0].body.state, { texts: ["a", "b"] });
  assert.match(fetch.calls[0].body.questions.text_1.instructions, /`texts\[1\]`/);
  assert.equal(fetch.calls[1].body.state, "c");
  assert.deepEqual(results.map((r) => r.emoji), ["😀", "😢", "🎉"]);
  assert.deepEqual(await createEmojiPicker(opts(fetch)).pickMany([]), []);
  assert.equal(fetch.calls.length, 2);
});

const SPREAD = { "😢": 0.05, "🎉": 0.6, "🥳": 0.3, "😀": 0.05 };

test("ranks offered emojis, most likely first, top 5 by default", async () => {
  const r = await pickWith(prefer(SPREAD)).pick("x");
  assert.equal(r.ranked.length, 5);
  assert.deepEqual(r.ranked.slice(0, 2), [{ emoji: "🎉", probability: 0.6 }, { emoji: "🥳", probability: 0.3 }]);
  assert.equal(Object.keys(r.probabilities).length, 91);
});

test("top and minProbability trim the ranking, per picker or per call", async () => {
  const picker = pickWith(prefer(SPREAD), { top: 1 });
  assert.deepEqual((await picker.pick("x")).ranked.map((e) => e.emoji), ["🎉"]);
  assert.deepEqual((await picker.pick("x", { top: 3, minProbability: 0.1 })).ranked.map((e) => e.emoji), ["🎉", "🥳"]);
  assert.equal((await picker.pick("x", { top: Infinity })).ranked.length, 91);
  const many = await picker.pickMany(["a", "b"], { top: 2 });
  assert.deepEqual(many.map((r) => r.ranked.map((e) => e.emoji)), [["🎉", "🥳"], ["🎉", "🥳"]]);
});

test("rankEmojis returns the top n emojis", async () => {
  assert.deepEqual(await rankEmojis("yay", opts(fakeFetch(prefer(SPREAD)), { top: 2 })), ["🎉", "🥳"]);
});

test("pickEmoji returns just the emoji", async () => {
  assert.equal(await pickEmoji("yay", opts(fakeFetch(prefer({ "🥳": 0.9 })))), "🥳");
});

test("full mode: picks categories, then searches the likeliest ones in one request", async () => {
  const fetch = fakeFetch(prefer({ "event": 0.6, "award-medal": 0.3, "face-smiling": 0.1, "🎉": 0.8, "🏆": 0.7, "😀": 1 }));
  const r = await createEmojiPicker(opts(fetch, { emojis: "full" })).pick("We won the cup!");

  assert.equal(fetch.calls.length, 2);
  assert.equal(Object.keys(fetch.calls[0].body.questions.category.criteria).length, 99);
  const search = fetch.calls[1].body;
  assert.equal(search.state, "We won the cup!");
  assert.deepEqual(Object.keys(search.questions), ["category_0", "category_1", "category_2"]);
  assert.ok("🎉" in search.questions.category_0.criteria);
  assert.ok("🏆" in search.questions.category_1.criteria);

  assert.equal(r.emoji, "🎉");
  assert.equal(r.confidence, 0.6 * 0.8);
  assert.deepEqual(r.ranked.slice(0, 3).map((e) => e.emoji), ["🎉", "🏆", "😀"]);
  assert.equal(r.ranked[1].probability, 0.3 * 0.7);
});

test("full mode: categories option and pickMany", async () => {
  const fetch = fakeFetch(prefer({ "event": 0.6, "award-medal": 0.3, "🎉": 0.8 }));
  const picker = createEmojiPicker(opts(fetch, { emojis: "full", categories: 1 }));
  const results = await picker.pickMany(["a", "b"]);

  assert.equal(fetch.calls.length, 3); // one category request for both texts, one search each
  assert.deepEqual(Object.keys(fetch.calls[0].body.questions), ["text_0", "text_1"]);
  assert.deepEqual(Object.keys(fetch.calls[1].body.questions), ["category_0"]);
  assert.deepEqual(results.map((r) => r.emoji), ["🎉", "🎉"]);
});

test("retries on 429 and 529", async () => {
  const fetch = fakeFetch(() => json(429, {}), () => json(529, {}), prefer({ "👍": 0.9 }));
  const r = await createEmojiPicker(opts(fetch)).pick("ok");
  assert.equal(fetch.calls.length, 3);
  assert.equal(r.emoji, "👍");
});

test("honours Retry-After", async () => {
  const fetch = fakeFetch(() => json(429, {}, { "Retry-After": "0.05" }), prefer({ "👍": 0.9 }));
  const started = Date.now();
  await createEmojiPicker(opts(fetch)).pick("ok");
  assert.ok(Date.now() - started >= 45);
});

test("gives up after the configured attempts", async () => {
  const fetch = fakeFetch(() => json(503, {}));
  await assert.rejects(createEmojiPicker(opts(fetch)).pick("x"), (e) => e instanceof JevError && e.status === 503);
  assert.equal(fetch.calls.length, 3);
});

test("does not retry client errors", async () => {
  const fetch = fakeFetch(() => json(401, { detail: "bad key" }));
  await assert.rejects(createEmojiPicker(opts(fetch)).pick("x"), (e) => e.status === 401 && /bad key/.test(e.body));
  assert.equal(fetch.calls.length, 1);
});

test("retries network errors, then wraps them in JevError", async () => {
  const fail = () => { throw new TypeError("fetch failed"); };
  assert.equal((await pickWith(fail, {}).pick("x").catch((e) => e)).cause?.message, "fetch failed");
  const fetch = fakeFetch(fail, prefer({ "👍": 0.9 }));
  assert.equal((await createEmojiPicker(opts(fetch)).pick("x")).emoji, "👍");
});

test("times out a hung request", async () => {
  const hang = (_, init) => new Promise((_, reject) =>
    init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const fetch = fakeFetch(hang);
  await assert.rejects(createEmojiPicker(opts(fetch, { timeoutMs: 20, attempts: 2 })).pick("x"),
    (e) => e instanceof JevError && /timed out/.test(e.message) && e.status === undefined);
  assert.equal(fetch.calls.length, 2);
});

test("malformed responses throw JevError without retrying", async () => {
  const html = fakeFetch(() => new Response("<html>proxy</html>", { status: 200 }));
  await assert.rejects(createEmojiPicker(opts(html)).pick("x"), (e) => e instanceof JevError && /invalid JSON/.test(e.message));
  assert.equal(html.calls.length, 1);
  await assert.rejects(pickWith(() => json(200, { model: "m" })).pick("x"), /no answer for "emoji"/);
});

test("abort: rejects with the signal's reason and cleans up its listeners", async () => {
  const fetch = fakeFetch(() => json(503, {}), prefer({ "👍": 0.9 }));
  const picker = createEmojiPicker(opts(fetch, { retryDelayMs: 1 }));
  await assert.rejects(picker.pick("x", { signal: AbortSignal.abort(new Error("stop")) }), /stop/);
  assert.equal(fetch.calls.length, 0);

  const controller = new AbortController();
  const during = picker.pick("x", { signal: controller.signal });
  controller.abort(new Error("later"));
  await assert.rejects(during, /later/);

  const { signal } = new AbortController();
  let listeners = 0;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...a) => { listeners++; add(...a); };
  signal.removeEventListener = (...a) => { listeners--; remove(...a); };
  const retrying = createEmojiPicker(opts(fakeFetch(() => json(503, {}), prefer({ "👍": 0.9 })), { retryDelayMs: 1 }));
  await retrying.pick("x", { signal });
  assert.equal(listeners, 0);
});

test("validates options and inputs before sending anything", async () => {
  const fetch = fakeFetch(prefer({}));
  const make = (extra) => () => createEmojiPicker(opts(fetch, extra));
  assert.throws(() => createEmojiPicker({ fetch, apiKey: "" }), /apiKey/);
  assert.throws(make({ emojis: ["🎉"] }), /at least two/);
  assert.throws(make({ emojis: Array.from({ length: 256 }, (_, i) => String.fromCodePoint(0x1f600 + i)) }), /at most 255/);
  assert.throws(make({ emojis: "🎉😀" }), TypeError);
  for (const bad of [{ batchSize: 0 }, { batchSize: "5" }, { attempts: 0 }, { top: -1 }, { categories: 0 },
    { minProbability: 2 }, { minConfidence: -0.1 }, { timeoutMs: Infinity }]) {
    assert.throws(make(bad), RangeError, JSON.stringify(bad));
  }
  const picker = createEmojiPicker(opts(fetch));
  await assert.rejects(picker.pick(undefined), TypeError);
  await assert.rejects(picker.pickMany("hello"), TypeError);
  await assert.rejects(picker.pick("x", { top: -1 }), RangeError);
  assert.equal(fetch.calls.length, 0);
});

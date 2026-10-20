// Calls the real Jev API (billed). Runs only when TYPESAFE_API_KEY is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmojiPicker, DEFAULT_EMOJIS } from "../src/index.js";

const skip = !process.env.TYPESAFE_API_KEY && "set TYPESAFE_API_KEY to run";

/** fetch that records Jev's raw answers, to check our assumptions about them. */
function recording() {
  const raw = [];
  const fn = async (url, init) => {
    const res = await fetch(url, init);
    raw.push(await res.clone().json());
    return res;
  };
  fn.raw = raw;
  return fn;
}

test("lite: one pick and a two-text batch", { skip }, async () => {
  const fetch = recording();
  const picker = createEmojiPicker({ fetch });
  const one = await picker.pick("I got the job!");
  const [a, b] = await picker.pickMany(["It's pouring with rain", "My dog learned to sit"]);

  for (const r of [one, a, b]) {
    assert.ok(r.emoji in DEFAULT_EMOJIS, `${r.emoji} was offered`);
    assert.match(r.model, /^jev-/);
  }
  // Jev returns a probability for every offered emoji.
  assert.equal(Object.keys(fetch.raw[0].answers.emoji.probabilities).length, Object.keys(DEFAULT_EMOJIS).length);
});

test("full: category then emoji", { skip }, async () => {
  const r = await createEmojiPicker({ emojis: "full" }).pick("We won the cup final!");
  assert.ok(r.emoji, "picked something");
  assert.ok(r.ranked.length > 1);
});

# jev-emoji

Pick an emoji for a piece of text with TypeSafe's [Jev](https://docs.typesafe.ai/api.md) model.
No dependencies; needs `fetch` and `AbortSignal.any` (Node 20.3+ or a modern browser).

```js
import { pickEmoji, createEmojiPicker } from "jev-emoji";

await pickEmoji("I got the job!"); // "🎉"  (key from TYPESAFE_API_KEY)

const picker = createEmojiPicker({
  apiKey: "…",
  threshold: 0.6,          // below this, `emoji` is `fallback`
  fallback: "💬",
  emojis: { "🐛": "A bug report", "🚀": "A release", "❓": "A question" }, // or ["🐛", "🚀"]
});
await picker.pick("Crash on login");      // { emoji, choice, confidence, ranked, probabilities, model }
await picker.pickMany(["a", "b", "c"]);   // sent 5 per request; Jev drifts on long batches

// Every emoji's probability, most likely first; trim with `top` and/or `minProbability`
// (set on the picker or per call).
const { ranked } = await picker.pick("Crash on login", { top: 3, minProbability: 0.05 });
// [{ emoji: "🐛", probability: 0.82 }, { emoji: "❓", probability: 0.12 }, …]

await pickEmojis("I got the job!", { top: 3 }); // ["🎉", "🥳", "😀"]
```

- Default set: ~90 everyday emojis in `src/emojis.js`. Jev allows at most 255 choices.
- Retries 429/529/5xx, network errors and timeouts (3 attempts); throws `JevError` otherwise.
- `npm test` runs offline against a fake `fetch`.

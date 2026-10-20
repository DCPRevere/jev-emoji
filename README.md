# jev-emoji

Pick an emoji for a piece of text with TypeSafe's [Jev](https://docs.typesafe.ai/api.md) model.
No dependencies; ESM; Node 20.19+ (or anything with `fetch` and `AbortSignal.any`).

```sh
npm i jev-emoji
export TYPESAFE_API_KEY=…   # from https://typesafe.ai
```

> Your text is sent to TypeSafe's paid API. Call it from a server; never ship your key to a browser.

```js
import { pickEmoji, rankEmojis, createEmojiPicker, JevError } from "jev-emoji";

await pickEmoji("I got the job!");               // "🎉"
await rankEmojis("I got the job!", { top: 3 });  // ["🎉", "💼", "🥳"]

const picker = createEmojiPicker({
  emojis: "full",       // "lite" (default, ~250 curated), "full" (all ~1,900), a list, or { emoji: "when it applies" }
  minConfidence: 0.6,   // below this, `emoji` is `fallback`
  fallback: "💬",
});
await picker.pick("Crash on login");
// { emoji, choice, confidence, ranked: [{ emoji, probability }, …top 5], probabilities, model }
await picker.pickMany(["a", "b", "c"], { top: 3, minProbability: 0.05 });
```

- **lite** (default) offers ~250 hand-picked emojis, each described by when it applies, in one question. ~4.7k input tokens per text.
- **full** offers every Unicode emoji. Jev allows at most 255 choices per question, so it's a knockout: 8 groups each send their top 2 (`finalists`) to a final question. Similar accuracy, more specific picks (🛬 rather than ✈️), but two requests and ~33k input tokens per text.
- At $0.042 per million input tokens (output is free; October 2026): lite ≈ $0.20 and full ≈ $1.40 per 1,000 texts. A smaller custom set costs proportionally less.
- `pickMany` sends `batchSize` (5) texts per request in lite mode; Jev drifts on long batches.
- Retries 408/429/5xx/529, network errors and timeouts (`attempts`: 3), honouring `Retry-After`. Failures throw `JevError` (`status`, `body`, `cause`); aborts reject with the signal's reason.
- All options are documented in [`src/index.d.ts`](src/index.d.ts).

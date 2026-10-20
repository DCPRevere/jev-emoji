# jev-emoji

Pick the right emoji for a piece of text, using TypeSafe's [Jev](https://docs.typesafe.ai/introduction.md) model.

```js
await pickEmoji("We won the cup final!");     // "🏆"
await pickEmoji("Is anyone free for coffee?"); // "☕"
await pickEmoji("The build is broken again");  // "🐛"
```

No dependencies. Works in Node 20.19+ and any server runtime with `fetch`. Answers come from a model, so they can vary slightly between calls.

## Install

```sh
npm install jev-emoji
```

Get an API key from the [TypeSafe console](https://console.typesafe.ai/keys) and set it as an environment variable:

```sh
export TYPESAFE_API_KEY=your-key
```

> **Keep the key on your server.** Each call sends your text to TypeSafe's API, which is billed per use. Never put the key in browser code.

## Usage

```js
import { pickEmoji, rankEmojis } from "jev-emoji";

await pickEmoji("I'm going to Italy!");             // "🇮🇹"
await rankEmojis("I'm going to Italy!", { top: 3 }); // ["🇮🇹", "✈️", "😀"]
```

For more control, create a picker once and reuse it:

```js
import { createEmojiPicker } from "jev-emoji";

const picker = createEmojiPicker({
  minConfidence: 0.6, // if Jev is less sure than this…
  fallback: "💬",     // …use this instead
});

const result = await picker.pick("Crash on login");
result.emoji;  // "🐛"
result.ranked; // [{ emoji: "🐛", probability: 0.78 }, { emoji: "💻", probability: 0.09 }, …]

const results = await picker.pickMany(["Happy Christmas!", "It's pouring with rain"]);
results.map((r) => r.emoji); // ["🎄", "🌧️"]
```

## Choosing emojis

| `emojis` | What Jev chooses from | Cost per 1,000 texts* |
| --- | --- | --- |
| `"lite"` (default) | About 250 hand-picked emojis, each described by when it applies | ~$0.20 |
| `"full"` | All ~1,900 Unicode emojis | ~$1.40 |
| `["🐛", "🚀", "❓"]` | Your own list (2–255 emojis) | less |
| `{ "🐛": "A bug report", "🚀": "A release" }` | Your own list, with a hint for each | less |

Lite is the best choice for most uses. Full can give more specific picks, such as 🛬 for "Just landed in Rome" where lite gives 🇮🇹, but costs about 7× as much.

<sub>* At TypeSafe's October 2026 price of $0.042 per million input tokens.</sub>

<details>
<summary>How full mode works</summary>

Jev can choose from at most 255 options at a time, so full mode runs a knockout. All the emojis are split into 8 groups and Jev picks the best 2 from each group. A final round then chooses between those 16. That takes two API requests per text.

</details>

## Options

Pass these to `createEmojiPicker`, `pickEmoji` or `rankEmojis`.

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | `TYPESAFE_API_KEY` | Your TypeSafe API key |
| `emojis` | `"lite"` | The emojis to choose from (see above) |
| `minConfidence` | `0` | How sure Jev must be (0–1) before its pick is used |
| `fallback` | `null` | Returned when Jev isn't sure enough |
| `top` | `5` | How many emojis to include in `ranked` |
| `minProbability` | `0` | Leave out emojis below this probability from `ranked` |
| `finalists` | `2` | Full mode only: emojis each group sends to the final |
| `batchSize` | `5` | Texts sent per request by `pickMany` |
| `timeoutMs` | `30000` | Timeout for each attempt |
| `attempts` | `3` | Tries before giving up on network or server errors |

`top` and `minProbability` can also be passed to a single `pick` or `pickMany` call, along with an `AbortSignal` as `signal`. Every option is documented in [`src/index.d.ts`](src/index.d.ts).

## Results

`pick` returns:

| Field | Description |
| --- | --- |
| `emoji` | The chosen emoji, or `fallback` if Jev wasn't sure enough |
| `choice` | Jev's pick, regardless of `minConfidence` |
| `confidence` | How sure Jev is, from 0 to 1 |
| `ranked` | The most likely emojis, best first, with their probabilities |
| `probabilities` | The probability of every emoji Jev considered |
| `model` | The Jev version that answered, e.g. `"jev-1.13.0"` |

## Errors

Network failures, timeouts and server errors are retried automatically. If every attempt fails, a `JevError` is thrown:

```js
import { JevError } from "jev-emoji";

try {
  await pickEmoji(text);
} catch (err) {
  if (err instanceof JevError) console.error(err.status, err.message);
}
```

## Development

```sh
npm test           # offline tests, using a fake API
npm run test:live  # calls the real API; reads TYPESAFE_API_KEY from .env
```

## Licence

MIT

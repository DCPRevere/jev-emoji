export declare const DEFAULT_EMOJIS: Readonly<Record<string, string>>;

export interface PickerOptions {
  /** TypeSafe API key. Defaults to `process.env.TYPESAFE_API_KEY`. */
  apiKey?: string;
  /** Model name or alias. Default `"jev-latest"`. */
  model?: string;
  /**
   * Candidate emojis. `"lite"` (default): ~90 curated everyday emojis, one request.
   * `"full"`: all ~1,900 Unicode emojis (no skin tones), two requests — pick a
   * category, then an emoji within the likeliest `categories`.
   * Or your own list, or emoji → description of when it applies (2–255).
   */
  emojis?: "lite" | "full" | readonly string[] | Readonly<Record<string, string | null>>;
  /** Minimum confidence (0–1) to accept Jev's choice; below it `emoji` is `fallback`. Default 0. */
  minConfidence?: number;
  /** Returned as `emoji` below `minConfidence` or when Jev picks something not offered. Default `null`. */
  fallback?: string | null;
  /** Default for `CallOptions.top`. Default 5. */
  top?: number;
  /** Default for `CallOptions.minProbability`. Default 0. */
  minProbability?: number;
  /** `"full"` only: how many of the likeliest categories to search. Default 3. */
  categories?: number;
  /** Texts per request in `pickMany`. Default 5. */
  batchSize?: number;
  /** Per-attempt timeout. Default 30000. */
  timeoutMs?: number;
  /** Attempts on 408/429/5xx/529, network errors and timeouts. Default 3. */
  attempts?: number;
  /** First retry delay, doubled each retry; a longer `Retry-After` wins. Default 500. */
  retryDelayMs?: number;
  endpoint?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface RankedEmoji {
  emoji: string;
  probability: number;
}

export interface PickResult {
  /** The accepted emoji, or `fallback`. */
  emoji: string | null;
  /** Jev's choice regardless of `minConfidence`; `null` if it wasn't offered. */
  choice: string | null;
  /** In `"full"` mode: category probability × confidence within it. */
  confidence: number;
  /** Most likely first, after `top` and `minProbability`. */
  ranked: RankedEmoji[];
  /**
   * Probability of each offered emoji. In `"full"` mode only emojis in the searched
   * categories, as category probability × probability within it.
   */
  probabilities: Record<string, number>;
  /** Resolved model, e.g. `"jev-1.13.0"`. */
  model: string;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Keep only the n most likely emojis in `ranked` (`Infinity` for all). */
  top?: number;
  /** Drop emojis below this probability (0–1) from `ranked`. */
  minProbability?: number;
}

export interface EmojiPicker {
  pick(text: string, options?: CallOptions): Promise<PickResult>;
  pickMany(texts: readonly string[], options?: CallOptions): Promise<PickResult[]>;
}

/** Thrown for HTTP errors, timeouts, network failures and malformed responses. Aborts reject with the signal's reason. */
export declare class JevError extends Error {
  constructor(message: string, options?: { status?: number; body?: string; cause?: unknown });
  name: "JevError";
  /** HTTP status; undefined for timeouts and network failures. */
  status?: number;
  body?: string;
}

export declare function createEmojiPicker(options?: PickerOptions): EmojiPicker;
export declare function pickEmoji(text: string, options?: PickerOptions & CallOptions): Promise<string | null>;
/** Emojis most likely first, honouring `top` and `minProbability`. */
export declare function rankEmojis(text: string, options?: PickerOptions & CallOptions): Promise<string[]>;

export declare const DEFAULT_EMOJIS: Record<string, string>;

export interface PickerOptions {
  /** TypeSafe API key. Defaults to `process.env.TYPESAFE_API_KEY`. */
  apiKey?: string;
  /** Model name or alias. Default `"jev-latest"`. */
  model?: string;
  /** Candidate emojis: a list, or emoji → description of when it applies. Max 255. */
  emojis?: string[] | Record<string, string | null>;
  /** Minimum confidence (0–1) to accept Jev's choice. Default 0. */
  threshold?: number;
  /** Returned as `emoji` when the choice is below `threshold`. Default `null`. */
  fallback?: string | null;
  /** Default for `CallOptions.top`. */
  top?: number;
  /** Default for `CallOptions.minProbability`. */
  minProbability?: number;
  /** Texts per request in `pickMany`. Default 5. */
  questionsPerRequest?: number;
  /** Per-attempt timeout. Default 30000. */
  timeoutMs?: number;
  /** Attempts on 429/5xx/network errors/timeouts. Default 3. */
  attempts?: number;
  /** First retry delay, doubled each retry. Default 500. */
  retryDelayMs?: number;
  endpoint?: string;
  fetch?: typeof fetch;
}

export interface PickResult {
  /** The accepted emoji, or `fallback` if below threshold. */
  emoji: string | null;
  /** Jev's raw choice, regardless of threshold. */
  choice: string | null;
  confidence: number;
  /** Offered emojis, most likely first, after `top` and `minProbability`. */
  ranked: RankedEmoji[];
  /** Jev's raw probability for every offered emoji. */
  probabilities: Record<string, number>;
  /** Resolved model, e.g. `"jev-1.13.0"`. */
  model: string;
}

export interface RankedEmoji {
  emoji: string;
  probability: number;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Keep only the n most likely emojis in `ranked`. Default: all. */
  top?: number;
  /** Drop emojis below this probability (0–1) from `ranked`. Default 0. */
  minProbability?: number;
}

export interface EmojiPicker {
  pick(text: string, options?: CallOptions): Promise<PickResult>;
  pickMany(texts: string[], options?: CallOptions): Promise<PickResult[]>;
}

export declare class JevError extends Error {
  status?: number;
  body?: string;
}

export declare function createEmojiPicker(options?: PickerOptions): EmojiPicker;
export declare function pickEmoji(text: string, options?: PickerOptions & CallOptions): Promise<string | null>;
/** Emojis most likely first, honouring `top` and `minProbability`. */
export declare function pickEmojis(text: string, options?: PickerOptions & CallOptions): Promise<string[]>;

import { createRequire } from "node:module";
import {
  get_encoding,
  type Tiktoken,
  type TiktokenEncoding,
} from "@dqbd/tiktoken";

const fallbackEncoding = "cl100k_base";
const encodingCache = new Map<string, Tiktoken>();

const require = createRequire(import.meta.url);
const modelToEncoding =
  require("@dqbd/tiktoken/model_to_encoding.json") as Record<string, string>;

function resolveEncodingName(model: string): string {
  return modelToEncoding[model] ?? fallbackEncoding;
}

function getEncoding(encodingName: string): Tiktoken {
  const cached = encodingCache.get(encodingName);
  if (cached) return cached;
  const encoding = get_encoding(encodingName as TiktokenEncoding);
  encodingCache.set(encodingName, encoding);
  return encoding;
}

export function countTokensForText(
  text: string,
  model: string,
): { tokens: number; encoding: string } {
  const encodingName = resolveEncodingName(model);
  const encoding = getEncoding(encodingName);
  const tokens = encoding.encode(text).length;
  return { tokens, encoding: encodingName };
}

export function countTokensForBatch(
  texts: string[],
  model: string,
): { tokens: number[]; total: number; encoding: string } {
  const encodingName = resolveEncodingName(model);
  const encoding = getEncoding(encodingName);
  const tokens = texts.map((text) => encoding.encode(text).length);
  const total = tokens.reduce((sum, value) => sum + value, 0);
  return { tokens, total, encoding: encodingName };
}

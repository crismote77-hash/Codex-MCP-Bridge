import { WebError } from "../errors.js";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

export type WebFetchResult = {
  url: string;
  status: number;
  contentType?: string;
  content: string;
  truncated: boolean;
};

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
};

function isIpv4(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((value) => Number(value));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  return false;
}

function isLocalHostname(hostname: string): boolean {
  if (hostname === "localhost") return true;
  if (hostname.endsWith(".localhost")) return true;
  if (isIpv4(hostname)) return isPrivateIpv4(hostname);
  if (hostname.includes(":")) return isPrivateIpv6(hostname);
  return false;
}

function validateUrl(input: string, allowLocalhost: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new WebError("Invalid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebError("Only http/https URLs are supported.");
  }
  if (!allowLocalhost && isLocalHostname(parsed.hostname)) {
    throw new WebError("Localhost/private URLs are not allowed.");
  }
  return parsed;
}

async function readResponseBodyToLimit(
  response: Response,
  maxBytes: number,
): Promise<{ buffer: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    const sliced = buffer.slice(0, maxBytes);
    return { buffer: sliced, truncated: buffer.length > maxBytes };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.length > maxBytes) {
      const remaining = maxBytes - total;
      if (remaining > 0) {
        chunks.push(value.slice(0, remaining));
        total += remaining;
      }
      truncated = true;
      break;
    }
    chunks.push(value);
    total += value.length;
  }

  if (truncated) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return { buffer, truncated };
}

function stripHtml(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchWeb(opts: {
  query: string;
  provider: "tavily";
  apiKey?: string;
  maxResults: number;
  timeoutMs: number;
  userAgent: string;
}): Promise<WebSearchResult[]> {
  if (opts.provider !== "tavily") {
    throw new WebError(`Unsupported web search provider: ${opts.provider}`);
  }
  if (!opts.apiKey) {
    throw new WebError("Tavily API key is required for web search.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": opts.userAgent,
      },
      body: JSON.stringify({
        api_key: opts.apiKey,
        query: opts.query,
        max_results: opts.maxResults,
        include_answer: false,
        include_images: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new WebError(
        text ? `Web search failed: ${text}` : "Web search failed.",
      );
    }

    const payload = (await response.json()) as TavilyResponse;
    const results = payload.results ?? [];
    return results
      .filter((item) => item?.title && item?.url)
      .map((item) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.content,
      }));
  } catch (error) {
    if (error instanceof WebError) throw error;
    throw new WebError(
      error instanceof Error ? error.message : "Web search failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchWeb(opts: {
  url: string;
  maxBytes: number;
  timeoutMs: number;
  userAgent: string;
  allowLocalhost: boolean;
}): Promise<WebFetchResult> {
  const target = validateUrl(opts.url, opts.allowLocalhost);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        "User-Agent": opts.userAgent,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new WebError(
        text ? `Web fetch failed: ${text}` : "Web fetch failed.",
      );
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const { buffer, truncated } = await readResponseBodyToLimit(
      response,
      opts.maxBytes,
    );
    const decoded = new TextDecoder().decode(buffer);
    const content =
      contentType && contentType.includes("text/html")
        ? stripHtml(decoded)
        : decoded.trim();

    return {
      url: target.toString(),
      status: response.status,
      contentType,
      content,
      truncated,
    };
  } catch (error) {
    if (error instanceof WebError) throw error;
    throw new WebError(
      error instanceof Error ? error.message : "Web fetch failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

import { describe, it, expect } from "vitest";
import { parseJsonlLine } from "../src/services/codexCli.js";
import { parseSseLine } from "../src/services/openaiClient.js";

describe("JSONL parser (CLI streaming)", () => {
  it("parses a valid message frame", () => {
    const line = '{"type":"message","role":"assistant","content":"Hello"}';
    const result = parseJsonlLine(line);
    expect(result).toEqual({
      type: "message",
      role: "assistant",
      content: "Hello",
    });
  });

  it("parses a valid function_call frame", () => {
    const line = '{"type":"function_call","name":"read_file","arguments":"{}"}';
    const result = parseJsonlLine(line);
    expect(result).toEqual({
      type: "function_call",
      name: "read_file",
      arguments: "{}",
    });
  });

  it("parses a valid done frame", () => {
    const line = '{"type":"done","content":"Final output"}';
    const result = parseJsonlLine(line);
    expect(result).toEqual({
      type: "done",
      content: "Final output",
    });
  });

  it("parses a done frame without content", () => {
    const line = '{"type":"done"}';
    const result = parseJsonlLine(line);
    expect(result).toEqual({ type: "done" });
  });

  it("returns null for empty line", () => {
    expect(parseJsonlLine("")).toBeNull();
    expect(parseJsonlLine("   ")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseJsonlLine("{invalid")).toBeNull();
    expect(parseJsonlLine("not json at all")).toBeNull();
  });

  it("handles frames with extra fields", () => {
    const line = '{"type":"custom","extra":"field","nested":{"a":1}}';
    const result = parseJsonlLine(line);
    expect(result).toEqual({
      type: "custom",
      extra: "field",
      nested: { a: 1 },
    });
  });
});

describe("SSE parser (API streaming)", () => {
  it("parses a text delta event", () => {
    const line = 'data: {"type":"response.output_text.delta","delta":"Hello"}';
    const result = parseSseLine(line);
    expect(result).toEqual({
      type: "response.output_text.delta",
      delta: "Hello",
    });
  });

  it("parses a done event with response", () => {
    const line =
      'data: {"type":"response.done","response":{"usage":{"input_tokens":10,"output_tokens":20}}}';
    const result = parseSseLine(line);
    expect(result).toEqual({
      type: "response.done",
      response: {
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      },
    });
  });

  it("returns done type for [DONE] marker", () => {
    const line = "data: [DONE]";
    const result = parseSseLine(line);
    expect(result).toEqual({ type: "done" });
  });

  it("returns null for empty line", () => {
    expect(parseSseLine("")).toBeNull();
    expect(parseSseLine("   ")).toBeNull();
  });

  it("returns null for non-data lines", () => {
    expect(parseSseLine("event: message")).toBeNull();
    expect(parseSseLine(": comment")).toBeNull();
    expect(parseSseLine("retry: 1000")).toBeNull();
  });

  it("returns null for invalid JSON in data", () => {
    expect(parseSseLine("data: {invalid")).toBeNull();
    expect(parseSseLine("data: not json")).toBeNull();
  });

  it("handles data with leading/trailing whitespace", () => {
    const line = "  data:   {\"type\":\"test\"}  ";
    const result = parseSseLine(line);
    expect(result).toEqual({ type: "test" });
  });

  it("handles complex response objects", () => {
    const line =
      'data: {"type":"response.output_text.delta","delta":"world","index":1,"logprobs":null}';
    const result = parseSseLine(line);
    expect(result).toEqual({
      type: "response.output_text.delta",
      delta: "world",
      index: 1,
      logprobs: null,
    });
  });
});

import { describe, it, expect } from "vitest";
import { buildCodexReviewArgs } from "../src/tools/codexReview.js";

describe("buildCodexReviewArgs", () => {
  it("omits prompt stdin when uncommitted", () => {
    const { args, input } = buildCodexReviewArgs({
      uncommitted: true,
      prompt: "Review these changes",
    });
    expect(args).toEqual(["review", "--uncommitted"]);
    expect(input).toBe("");
  });

  it("omits prompt stdin when base is set", () => {
    const { args, input } = buildCodexReviewArgs({
      base: "main",
      prompt: "Review these changes",
    });
    expect(args).toEqual(["review", "--base", "main"]);
    expect(input).toBe("");
  });

  it("omits prompt stdin when commit is set", () => {
    const { args, input } = buildCodexReviewArgs({
      commit: "deadbeef",
      prompt: "Review these changes",
    });
    expect(args).toEqual(["review", "--commit", "deadbeef"]);
    expect(input).toBe("");
  });

  it("uses stdin prompt when provided", () => {
    const { args, input } = buildCodexReviewArgs({
      prompt: "Review the diff",
    });
    expect(args).toEqual(["review", "-"]);
    expect(input).toBe("Review the diff");
  });

  it("includes skip-git-repo-check when requested", () => {
    const { args, input } = buildCodexReviewArgs({
      skipGitRepoCheck: true,
    });
    expect(args).toEqual(["review", "--skip-git-repo-check"]);
    expect(input).toBe("");
  });

  it("does not pass stdin when no prompt", () => {
    const { args, input } = buildCodexReviewArgs({});
    expect(args).toEqual(["review"]);
    expect(input).toBe("");
  });
});

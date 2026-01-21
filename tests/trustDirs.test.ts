import path from "node:path";
import { describe, it, expect } from "vitest";
import { addTrustedDir, isTrustedCwd } from "../src/utils/trustDirs.js";

describe("trustDirs", () => {
  it("treats subdirectories as trusted", () => {
    const root = path.resolve("repo");
    const child = path.resolve("repo/subdir");
    expect(isTrustedCwd(child, [root])).toBe(true);
  });

  it("does not trust sibling directories", () => {
    const root = path.resolve("repo");
    const sibling = path.resolve("repo-sibling");
    expect(isTrustedCwd(sibling, [root])).toBe(false);
  });

  it("dedupes trusted directories when adding", () => {
    const root = path.resolve("repo");
    const updated = addTrustedDir([root], root);
    expect(updated).toEqual([root]);
  });
});

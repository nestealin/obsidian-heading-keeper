import { describe, expect, it } from "vitest";
import { packageIdentity } from "../src/index.js";

describe("packageIdentity", () => {
  it("exposes the stable plugin identity", () => {
    expect(packageIdentity).toEqual({
      id: "heading-keeper",
      version: "0.2.1",
    });
  });
});

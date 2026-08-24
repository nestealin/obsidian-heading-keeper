import type { FragmentNormalization } from "./types.js";

export function normalizeHeadingFragment(
  rawFragment: string,
): FragmentNormalization {
  try {
    return {
      ok: true,
      value: decodeURIComponent(rawFragment).normalize("NFC"),
    };
  } catch {
    return { ok: false, code: "malformed-percent-encoding" };
  }
}

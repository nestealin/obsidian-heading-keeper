export const forbiddenPublicPaths = [
  /^docs\/superpowers(?:\/|$)/u,
  /^docs\/requirement-test-evidence\.md$/u,
];

const localMarkers = [
  ["/", "Users", "/"].join(""),
  ["/", "home", "/"].join(""),
  ["C:", "\\", "Users", "\\"].join(""),
  ["Synology", "Drive"].join(""),
  ["Nes", "Dev"].join(""),
  ["Nes", "Vault"].join(""),
  ["agent", "-tmp"].join(""),
  [".co", "dex"].join(""),
  [".clau", "de"].join(""),
  [".cc", "-switch"].join(""),
];

const credentialPatterns = [
  new RegExp(["-----BEGIN ", "[A-Z ]*", "PRIVATE KEY-----"].join(""), "u"),
  /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd)\s*[:=]\s*["'][^"'\s]{8,}/iu,
];

export function hasNonPublicContent(content) {
  return (
    localMarkers.some((marker) => content.includes(marker)) ||
    credentialPatterns.some((pattern) => pattern.test(content))
  );
}

// Scans every file git would publish for secrets, and fails (exit 1) when it finds one.
// Run before each push to the public repository:  npm run check:secrets
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

/** Files that must never be published, whatever is inside them. */
const FORBIDDEN_PATHS = [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, /^seed\/private\//, /\.pem$/, /(^|\/)\.vercel\//, /^\.dev-db\//];

const PATTERNS = [
  ["OpenAI API key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ["Postgres URL with a password", /postgres(?:ql)?:\/\/[^\s:@/"'`]+:[^\s@/"'`]+@(?!127\.0\.0\.1|localhost|HOST\b|host\b)[^\s/"'`]+/],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Vercel token", /\bvercel_[A-Za-z0-9]{20,}\b/i],
  ["Password in an env line", /^\s*(?:APP_PASSWORD|OPENAI_API_KEY|DATABASE_URL)\s*=\s*["']?[^\s"'#<$]{6,}/m],
  ["E-mail address of a person", /\b[A-Za-z0-9._%+-]+@(?:gmail|outlook|hotmail|yahoo|walla)\.[a-z.]{2,}\b/i],
];

/** Lines that are allowed to look like a secret: documentation of the local dev database. */
const ALLOWED = [/postgres:\/\/postgres:postgres@127\.0\.0\.1:54329\/postgres/];

const BINARY = /\.(png|ico|jpg|jpeg|gif|webp|woff2?|ttf|pdf|docx)$/i;
const findings = [];

for (const file of files) {
  if (FORBIDDEN_PATHS.some((re) => re.test(file))) {
    findings.push(`${file}: this file must not be published`);
    continue;
  }
  if (BINARY.test(file) || file === "package-lock.json") continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    if (ALLOWED.some((re) => re.test(line))) return;
    for (const [name, re] of PATTERNS) {
      if (re.test(line)) findings.push(`${file}:${i + 1}: ${name}`);
    }
  });
}

if (findings.length) {
  console.error(`✗ ${findings.length} possible secret(s) — do not push:\n` + findings.map((f) => `  ${f}`).join("\n"));
  process.exit(1);
}
console.log(`✓ no secrets found in ${files.length} files`);

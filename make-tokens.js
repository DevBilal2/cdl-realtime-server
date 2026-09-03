// Generate recruiter tokens.
//   node make-tokens.js sarah@cdl-cda.com greg@cdl-cda.com
// stdout is the RECRUITER_TOKENS value for Render; stderr is the per-person
// list to hand out. Redirect stdout to keep the two apart:
//   node make-tokens.js a@x.com b@x.com > tokens.json
import crypto from "crypto";

const emails = process.argv.slice(2).map(e => e.toLowerCase().trim()).filter(Boolean);

if (emails.length === 0) {
  console.error("usage: node make-tokens.js <email> [email...]");
  process.exit(1);
}

const map = {};
for (const email of emails) {
  map[crypto.randomBytes(18).toString("base64url")] = email;
}

console.log(JSON.stringify(map));

console.error("");
for (const [token, email] of Object.entries(map)) {
  console.error(email.padEnd(28), token);
}
console.error("\nPaste the JSON above into RECRUITER_TOKENS on Render.");

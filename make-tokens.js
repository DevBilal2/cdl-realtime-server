// Print each recruiter's access code.
//
//   TOKEN_SECRET=... node make-tokens.js sarah@cdl-cda.com greg@cdl-cda.com
//
// Codes are derived from the address, so re-running always produces the same
// code for the same person and nothing can drift out of sync with the server.
// The same code comes out of Deluge, which is how the Zoho-side lookup works:
//
//   zoho.encryption.hmacsha256(secret, email, "hex").subString(0, 24)
//
// This is normally only needed for spot-checking. Day to day the codes come
// from the Zoho function.
import crypto from "crypto";

const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) {
  console.error("TOKEN_SECRET is not set. It must match the value on the server.");
  process.exit(1);
}

const codeFor = (email) =>
  crypto.createHmac("sha256", TOKEN_SECRET)
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 24);

const emails = process.argv.slice(2).map(e => e.toLowerCase().trim()).filter(Boolean);

if (emails.length === 0) {
  console.error("usage: TOKEN_SECRET=... node make-tokens.js <email> [email...]");
  process.exit(1);
}

const width = Math.max(...emails.map(e => e.length));
for (const email of emails) {
  console.log(email.padEnd(width), email.includes("@") ? codeFor(email) : "(not an email address)");
}

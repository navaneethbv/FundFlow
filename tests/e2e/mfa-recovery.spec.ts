import { createHmac } from "node:crypto";
import { hasLiveCredentials, test, expect } from "./fixtures/authenticated";

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  }
  return Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
}

function totp(secret: string): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function enroll(page: import("@playwright/test").Page, name: string, button: string) {
  await page.getByLabel("Authenticator name").fill(name);
  await page.getByRole("button", { name: button, exact: true }).click();
  const secretText = await page.getByText(/^Secret:/).textContent();
  await page.getByLabel("Verification code").fill(totp(secretText!.replace("Secret:", "").trim()));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

test.describe("MFA recovery", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("enrolls two named TOTP factors and removes the backup from AAL2", async ({ authenticatedPage: page }) => {
    await page.goto("/settings?section=security");
    await enroll(page, "Primary phone", "Enable 2FA");
    await enroll(page, "Backup authenticator", "Add authenticator");
    const backupRow = page.getByText("Backup authenticator", { exact: true }).locator("..");
    page.once("dialog", (dialog) => dialog.accept());
    await backupRow.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Backup authenticator", { exact: true })).toBeHidden();
    await expect(page.getByText("Primary phone", { exact: true })).toBeVisible();
  });
});

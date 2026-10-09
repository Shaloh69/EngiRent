/**
 * D-114 on-screen check: log in to the LIVE admin console, open the review
 * modal of the lookalike return (rental 6a7ccbef) and screenshot the "AI
 * reasoning" panel. Credentials are read from client/admin/.env.local here, so
 * they never pass through a transcript. Usage:
 *   node design/tools/shot-admin-ai-reasoning.mjs <admin-url> <out.png>
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const [adminUrl, out] = process.argv.slice(2);
const env = Object.fromEntries(
  readFileSync("client/admin/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1500 } });
const problems = [];
p.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text().slice(0, 160)); });
await p.goto(adminUrl + "/login", { waitUntil: "networkidle", timeout: 90000 });
await p.getByLabel("Email").fill(env.ADMIN_EMAIL);
await p.getByLabel("Password").fill(env.ADMIN_PASSWORD);
await p.locator("form button[type=submit]").click();
await p.waitForURL(/dashboard|\/$/, { timeout: 60000 }).catch(() => {});
await p.goto(adminUrl + "/verifications", { waitUntil: "networkidle", timeout: 90000 });
// the lookalike return: Hand Rivets, REJECTED
const row = p.locator("tr", { hasText: "Hand Rivets" }).filter({ hasText: /Return/i }).first();
const count = await p.locator("tr", { hasText: "Hand Rivets" }).count();
console.log("rows mentioning Hand Rivets:", count);
await row.getByRole("button", { name: /review/i }).click();
await p.getByText("AI reasoning").first().waitFor({ timeout: 20000 });
await p.waitForTimeout(800);
await p.locator(".mantine-Modal-content").screenshot({ path: out });
const card = p.locator(".mantine-Card-root", { hasText: "AI reasoning" }).first();
await card.screenshot({ path: out.replace(/\.png$/, "-panel.png") });
console.log("panel text:\n" + (await p.locator(".mantine-Modal-body").innerText()).split("\n").filter(Boolean).slice(0, 40).join("\n"));
console.log("problems:", problems.length ? problems.join(" | ") : "none");
await b.close();

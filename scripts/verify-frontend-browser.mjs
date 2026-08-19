// Drives chrome-devtools-mcp over stdio to verify the campaign studio (with the
// allocation ledger) in a real Chrome at 390px and 1440px: navigation, console,
// horizontal overflow, and screenshots.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "frontend-verify@example.com";
const PASSWORD = "FrontendVerify!2026";

const ORGANIZATION = "9f566f3d-61bd-497f-b77e-76a74f9d07c1";
const CAMPAIGN = "783ab4e1-279d-4fba-8dc1-1a33cd3df2e5";
const APP_URL = "http://localhost:3000";
const PAGE_URL = `${APP_URL}/organizations/${ORGANIZATION}/campaigns/${CAMPAIGN}`;

const server = spawn(
  "chrome-devtools-mcp",
  ["--headless", "--no-usage-statistics", "--no-performance-crux", "-e", "/usr/bin/google-chrome"],
  { stdio: ["pipe", "pipe", "inherit"] },
);

let buf = "";
let nextId = 0;
const pending = new Map();

function send(msg) {
  server.stdin.write(JSON.stringify(msg) + "\n");
}

function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

server.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

function textOf(result) {
  return JSON.stringify(result, null, 2);
}

async function call(name, args) {
  const result = await withTimeout(request("tools/call", { name, arguments: args }), 120_000);
  if (result.isError) throw new Error(`${name} failed: ${textOf(result)}`);
  return result;
}

async function evalJson(expression) {
  const result = await call("evaluate_script", { function: `() => ${expression}` });
  const content = result.content ?? [];
  for (const item of content) {
    if (item.type === "text") {
      const text = item.text ?? "";
      const match = text.match(/```json\s*([\s\S]*?)```/);
      const raw = match ? match[1].trim() : text.replace(/^Script ran on page and returned:\s*/, "").trim();
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

async function screenshot(path) {
  const result = await call("take_screenshot", { format: "png", fullPage: false });
  for (const item of result.content ?? []) {
    if (item.type === "image") {
      const base64 = (item.data ?? item.image ?? "").replace(/^data:image\/\w+;base64,/, "");
      if (base64) {
        writeFileSync(path, Buffer.from(base64, "base64"));
        console.log(`WROTE ${path}`);
        return;
      }
    }
  }
  console.log("NO IMAGE IN SCREENSHOT RESULT:", textOf(result).slice(0, 500));
}

try {
  // Fresh session so the JWT is valid for this run.
  const signIn = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
  if (!signIn.access_token) throw new Error(`sign in failed: ${JSON.stringify(signIn).slice(0, 300)}`);
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(signIn), "utf8").toString("base64url");

  await withTimeout(
    request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "dsh-verify", version: "1.0" },
    }),
    20_000,
  );
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  // Land on the app origin, then plant the session cookie for subsequent loads.
  await call("navigate_page", { url: `${APP_URL}/` });
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  await call("evaluate_script", {
    function: `() => { document.cookie = "supabase.auth.token=${cookieValue}; path=/; max-age=34560000"; return document.cookie; }`,
  });

  await call("navigate_page", { url: PAGE_URL });
  // Give Next.js dev time to compile and the page to settle.
  await new Promise((resolve) => setTimeout(resolve, 20_000));

  const consoleBefore = await call("list_console_messages", {});
  const urlNow = await evalJson("location.href");
  const heading = await evalJson(`document.querySelector("h1")?.textContent ?? null`);
  const overflow = await evalJson(
    `({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > window.innerWidth })`,
  );
  console.log("URL_NOW:", urlNow);
  console.log("H1:", heading);
  console.log("OVERFLOW_390:", JSON.stringify(overflow));

  await call("resize_page", { width: 390, height: 844 });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await screenshot("/tmp/campaign-390.png");
  const console390 = await call("list_console_messages", {});
  const overflow390 = await evalJson(
    `({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > window.innerWidth })`,
  );
  console.log("OVERFLOW_CHECK_390:", JSON.stringify(overflow390));

  await call("resize_page", { width: 1440, height: 900 });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await screenshot("/tmp/campaign-1440.png");
  const overflow1440 = await evalJson(
    `({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > window.innerWidth })`,
  );
  console.log("OVERFLOW_CHECK_1440:", JSON.stringify(overflow1440));

  const consoleAfter = await call("list_console_messages", {});
  const consoleLines = [...(consoleBefore.content ?? []), ...(console390.content ?? []), ...(consoleAfter.content ?? [])]
    .map((item) => (item.type === "text" ? item.text : ""))
    .join("\n");
  const errors = consoleLines
    .split("\n")
    .filter((line) => /error|failed|unhandled|exception|500/i.test(line))
    .filter((line) => !/favicon|\.map|webpack|HMR|hot/i.test(line));
  console.log("CONSOLE_ERRORS:", errors.length ? errors.join("\n---\n") : "none");

  // DOM evidence that the ledger actually rendered, not just that the page loaded.
  const allocSection = await evalJson(`(() => {
    const section = [...document.querySelectorAll("section")].find(s => s.textContent.includes("Allocation decisions"));
    return section ? section.textContent.replace(/\\s+/g, " ").trim() : null;
  })()`);
  const variantCards = await evalJson(
    `document.querySelectorAll("ul[aria-label='Creative variants'] li").length`,
  );
  console.log("ALLOC_SECTION:", allocSection);
  console.log("VARIANT_CARDS:", variantCards);
} catch (error) {
  console.error("VERIFY_ERROR:", error.message);
  process.exitCode = 1;
} finally {
  server.kill();
}

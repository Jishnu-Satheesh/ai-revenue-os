// Phase 1 recon: sign in, open Growth Intelligence, dump snapshot + screenshot.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
process.chdir("/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "frontend-verify@example.com";
const PASSWORD = "FrontendVerify!2026";
const ORG = "9f566f3d-61bd-497f-b77e-76a74f9d07c1";
const APP_URL = "http://localhost:3000";
const PAGE_URL = `${APP_URL}/organizations/${ORG}/growth-intelligence`;

const server = spawn(
  "/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence/node_modules/.bin/chrome-devtools-mcp",
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
async function call(name, args) {
  const result = await withTimeout(request("tools/call", { name, arguments: args }), 120_000);
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result).slice(0, 800)}`);
  return result;
}
async function evalText(expression) {
  const result = await call("evaluate_script", { function: `() => ${expression}` });
  for (const item of result.content ?? []) {
    if (item.type === "text") return item.text;
  }
  return null;
}

async function signIn(retries = 3) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      const body = await res.json();
      if (body.access_token) return body;
      last = JSON.stringify(body).slice(0, 200);
    } catch (e) {
      last = String(e).slice(0, 200);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(`sign in failed: ${last}`);
}

try {
  const session = await signIn();
  const cookieValue =
    "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  await withTimeout(
    request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "gi-canary", version: "1.0" },
    }),
    20_000,
  );
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  await call("navigate_page", { url: `${APP_URL}/` });
  // Let any redirect/landing render settle before touching the page context.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3_000));
    try {
      const href = await evalText("location.href");
      console.log("LAND_HREF:", href);
      if (href && href.startsWith(APP_URL)) break;
    } catch {
      /* navigation in flight; keep waiting */
    }
  }
  console.log("STEP: plant cookie");
  await call("evaluate_script", {
    function: `() => { document.cookie = "supabase.auth.token=${cookieValue}; path=/; max-age=34560000"; return "planted"; }`,
  });

  await call("navigate_page", { url: PAGE_URL });
  console.log("STEP: navigated to GI, settling");
  await new Promise((r) => setTimeout(r, 25_000));
  console.log("STEP: settled, reading page");

  console.log("URL_NOW:", await evalText("location.href"));
  console.log("H1:", await evalText(`document.querySelector("h1")?.textContent ?? null`));
  console.log(
    "TABS:",
    await evalText(
      `[...document.querySelectorAll("[role=tab]")].map(t => t.textContent.trim()).join(" | ")`,
    ),
  );
  console.log(
    "BUTTONS:",
    await evalText(
      `[...document.querySelectorAll("button")].map(b => b.textContent.trim().replace(/\\s+/g, " ")).filter(Boolean).join(" || ")`,
    ),
  );

  const snapshot = await call("take_snapshot", {});
  writeFileSync("/tmp/opencode/gi-snapshot.json", JSON.stringify(snapshot, null, 1));
  console.log("SNAPSHOT_SAVED");

  const shot = await call("take_screenshot", { format: "png", fullPage: false });
  for (const item of shot.content ?? []) {
    if (item.type === "image") {
      const base64 = (item.data ?? "").replace(/^data:image\/\w+;base64,/, "");
      if (base64) {
        writeFileSync("/tmp/opencode/gi-market-watch.png", Buffer.from(base64, "base64"));
        console.log("SCREENSHOT_SAVED");
      }
    }
  }

  const consoleRes = await call("list_console_messages", {});
  const errors = (consoleRes.content ?? [])
    .map((i) => (i.type === "text" ? i.text : ""))
    .join("\n")
    .split("\n")
    .filter((l) => /error|failed|unhandled|exception|500/i.test(l))
    .filter((l) => !/favicon|\.map|webpack|HMR|hot/i.test(l));
  console.log("CONSOLE_ERRORS:", errors.length ? errors.join("\n---\n").slice(0, 2000) : "none");
  process.exit(0);
} catch (e) {
  console.error("RECON_FAILED:", String(e).slice(0, 1000));
  process.exit(1);
} finally {
  server.kill();
}

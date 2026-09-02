// A minimal MCP stdio client for chrome-devtools-mcp, driven from bash.
// Usage:
//   node scripts/cdp-driver.mjs tools/list
//   node scripts/cdp-driver.mjs tools/call '{"name":"navigate_page","arguments":{"url":"..."}}'
//   node scripts/cdp-driver.mjs tools/call '{"name":"take_screenshot","arguments":{"format":"png"}}'
// Screenshot results are written to the path in the result's `filePath`/`path`
// or, when the result embeds the image as base64, saved under /tmp/cdp-shot.png.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const mode = process.argv[2];
const payload = process.argv[3] ? JSON.parse(process.argv[3]) : {};

const server = spawn(
  process.env.CHROME_DEVTOOLS_MCP_BIN ?? "chrome-devtools-mcp",
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

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

try {
  await Promise.race([
    request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "dsh-verify", version: "1.0" },
    }),
    timeout(20_000),
  ]);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  if (mode === "tools/list") {
    const result = await request("tools/list", {});
    for (const tool of result.tools ?? []) {
      console.log(tool.name);
    }
  } else if (mode === "tools/call") {
    const result = await request("tools/call", payload);
    const text = JSON.stringify(result, null, 2);
    // Save screenshots: the tool returns them as base64 data in structured
    // content, or as a file path. We keep the JSON for inspection and write the
    // image out when a path is named.
    const savePath = payload.arguments?.savePath;
    if (savePath) {
      const content = result.content ?? [];
      for (const item of content) {
        if (item.type === "image") {
          const data = item.data ?? item.image ?? "";
          const base64 = data.replace(/^data:image\/\w+;base64,/, "");
          writeFileSync(savePath, Buffer.from(base64, "base64"));
          console.log(`WROTE ${savePath}`);
        }
        if (item.type === "resource") {
          const base64 = (item.resource?.blob ?? "").replace(/^data:image\/\w+;base64,/, "");
          if (base64) writeFileSync(savePath, Buffer.from(base64, "base64"));
          console.log(`WROTE ${savePath}`);
        }
      }
    }
    console.log(text);
  } else {
    console.error("unknown mode", mode);
    process.exitCode = 2;
  }
} catch (error) {
  console.error("DRIVER_ERROR:", error.message);
  process.exitCode = 1;
} finally {
  server.kill();
}

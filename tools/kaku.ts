#!/usr/bin/env bun
// 1人の鍵で窓口につなぎ、ページを1つ書く。AI が仕事の中で書き足す動きを、手で確かめるための道具。
// 使い方: bun kaku.ts <メンバーの id> <slug> "<題>" "<本文>" [--url http://127.0.0.1:3133] [--keys <フォルダ>]
import { readFileSync } from "fs";
const a = process.argv.slice(2);
const opt = (k: string, d: string) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const [id, slug, title, text] = a.filter((x, i) => !x.startsWith("--") && !["--url", "--keys"].includes(a[i - 1]));
const base = opt("--url", "http://127.0.0.1:3133"), keys = opt("--keys", "/srv/brain/keys");
if (!id || !slug || !title || !text) { console.error('使い方: bun kaku.ts <メンバーの id> <slug> "<題>" "<本文>"'); process.exit(2); }
const txt = readFileSync(`${keys}/${id}.txt`, "utf8");
const cid = /Client ID:\s+(\S+)/.exec(txt)![1], sec = /Client Secret:\s+(\S+)/.exec(txt)![1];
const t: any = await (await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: cid, client_secret: sec, scope: "read write" }) })).json();
if (!t.access_token) { console.log(`${id}: 書けない（鍵に書く権限がない: ${t.error ?? "不明"}）`); process.exit(1); }
const H: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${t.access_token}` };
let n = 1;
async function rpc(method: string, params: any, notify = false): Promise<any> {
  const body: any = { jsonrpc: "2.0", method, params }; if (!notify) body.id = n++;
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const sid = r.headers.get("mcp-session-id"); if (sid) H["mcp-session-id"] = sid;
  const s = await r.text(); if (!s) return {};
  const line = s.startsWith("{") ? s : (s.split("\n").filter(l => l.startsWith("data:")).pop() || "").slice(5);
  try { return JSON.parse(line); } catch { return { error: { message: s.slice(0, 200) } }; }
}
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "brain-kaku", version: "1" } });
await rpc("notifications/initialized", {}, true);
const res = await rpc("tools/call", { name: "put_page", arguments: { slug, content: `---\ntitle: ${title}\ntype: note\n---\n# ${title}\n\n${text}\n` } });
if (JSON.stringify(res).includes("insufficient_scope")) { console.log(`${id}: 書けない（この鍵は読むだけ）`); process.exit(1); }
// 同じ名前のページが既にある時、エンジンは「読んだ版の番号」が無い上書きを断る（他の人の書き足しを消さないため）
if (JSON.stringify(res).includes("revision_required")) { console.log(`${id}: 既に書いてあります（${slug}）`); process.exit(0); }
if (res.error || res.result?.isError) { console.log(`${id}: 書けない（${String(res.error?.message ?? res.result?.content?.[0]?.text ?? JSON.stringify(res)).slice(0, 200)}）`); process.exit(1); }
console.log(`${id} が書いた: ${title}（${slug}）`);

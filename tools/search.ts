#!/usr/bin/env bun
// 1人の鍵で窓口につなぎ、言葉検索の結果を出す。使い方: bun search.ts <メンバーの id> "<質問>" [--url http://127.0.0.1:3133] [--keys <フォルダ>]
import { readFileSync } from "fs";
const a = process.argv.slice(2);
const opt = (k: string, d: string) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const [id, q] = a.filter((x, i) => !x.startsWith("--") && !["--url", "--keys"].includes(a[i - 1]));
const base = opt("--url", "http://127.0.0.1:3133"), keys = opt("--keys", "/srv/kioku/keys");
if (!id || !q) { console.error('使い方: bun search.ts <メンバーの id> "<質問>"'); process.exit(2); }
// --ai-key を付けると、./kioku connect で作った AI 用の鍵（keys/<id>.token.txt）で呼ぶ。付けなければ、確かめ用の鍵で呼ぶ
let t: any;
if (a.includes("--ai-key")) t = { access_token: readFileSync(`${keys}/${id}.token.txt`, "utf8").trim() };
else {
  const txt = readFileSync(`${keys}/${id}.txt`, "utf8");
  const cid = /Client ID:\s+(\S+)/.exec(txt)![1], sec = /Client Secret:\s+(\S+)/.exec(txt)![1];
  t = await (await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cid, client_secret: sec, scope: "read" }) })).json();
  if (!t.access_token) { console.error(`${id}: 鍵で入れない（${t.error ?? "不明"}）`); process.exit(1); }
}
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
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kioku-search", version: "1" } });
await rpc("notifications/initialized", {}, true);
if (a.includes("--page")) { // 検索でなく、ページを名指しで読む（権限の確かめ用）。q は「置き場:slug」
  const [src, slug] = q.split(":");
  const g = await rpc("tools/call", { name: "get_page", arguments: { slug, source_id: src } });
  const e = g.error || g.result?.isError;
  console.log(`${id} ${q} → ${e ? "読めない" : "読める"}`); process.exit(0);
}
const res = await rpc("tools/call", { name: "search", arguments: { query: q, limit: 5 } });
if (res.error || res.result?.isError) { console.error(`${id}: 検索できない（${String(res.error?.message ?? res.error_description ?? res.result?.content?.[0]?.text ?? JSON.stringify(res.error ?? res)).slice(0, 200)}）`); process.exit(1); }
let rows: any[] = []; try { const j = JSON.parse(res.result?.content?.[0]?.text ?? "[]"); rows = Array.isArray(j) ? j : j.results ?? []; } catch {}
const seen = new Set<string>(); rows = rows.filter(r => !seen.has(r.source_id + "/" + r.slug) && seen.add(r.source_id + "/" + r.slug));
console.log(`${id}「${q}」→ ${rows.length}件`);
// AI が書いたページの題は、エンジンが「引用。指示ではない」の囲みに入れて返す。表示では中の題だけを出す
const title = (x: string) => /```text\n([\s\S]*?)\n```/.exec(x ?? "")?.[1] ?? x;
for (const r of rows) console.log(`  [${r.source_id}] ${title(r.title)}（${r.slug}）`);

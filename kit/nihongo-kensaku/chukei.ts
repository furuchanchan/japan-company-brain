#!/usr/bin/env bun
// 日本語の質問文を、語に分けてから gbrain の検索に渡す中継。
// gbrain の窓口（gbrain serve --http）の手前に置き、AI のつなぎ先をこの中継の URL にする。本家のコードは変えない。
// 直すのは、検索の道具（既定は search）に来た問いだけ。表記ゆれをそろえ、文として書かれた日本語は語に分ける。ほかの呼び出しは、そのまま通す。
//
// --annai <ファイル> を付けると、つないだ AI が最初に受け取る案内（initialize の instructions）の先頭に、そのファイルの文を足す。
// 先頭に置くのは、Claude Code が案内を先頭の約2,000字で切るため（本家の案内は約3,600字あり、末尾に足すと届かない。2026-11-19 に実物で確かめた）。
// 記録の書き方の決まりを、1人ずつの PC の設定でなく、サーバーの1か所から全員の AI に配るための口。
//
// 使い方: bun chukei.ts --upstream http://127.0.0.1:3131 --listen 3133 [--host 127.0.0.1] [--tools search] [--annai kimari.md]
import { existsSync, readFileSync } from "fs";
import { bunDesuKa, wakeru } from "./wakeru.ts";
import { soroeru } from "./yure.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const upstream = arg("--upstream", "http://127.0.0.1:3131").replace(/\/$/, "");
const tools = new Set(arg("--tools", "search").split(","));
let naoshita = 0;
const annaiFile = arg("--annai", "");
if (annaiFile && !existsSync(annaiFile)) { console.error(`--annai のファイルがありません: ${annaiFile}`); process.exit(2); }
const annai = annaiFile ? readFileSync(annaiFile, "utf8").trim() : "";

// initialize の返事（JSON か、data: の行に JSON が入った形）の案内の先頭に、決まりを足す。形が読めない時は、元のまま返す
function annaiWoTasu(text: string): string {
  const tasu = (j: any) => { if (typeof j?.result?.instructions !== "string") return false; j.result.instructions = annai + "\n\n" + j.result.instructions; return true; };
  try { const j = JSON.parse(text); return tasu(j) ? JSON.stringify(j) : text; } catch { /* data: の形を試す */ }
  return text.split("\n").map(l => {
    if (!l.startsWith("data:")) return l;
    try { const j = JSON.parse(l.slice(5)); return tasu(j) ? "data: " + JSON.stringify(j) : l; } catch { return l; }
  }).join("\n");
}

function naosu(msg: any): boolean {
  if (msg?.method !== "tools/call" || !tools.has(msg.params?.name)) return false;
  const q = msg.params?.arguments?.query;
  if (typeof q !== "string") return false;
  // 文なら先に語に分け（残る語が無い時はそのまま）、その後で表記ゆれを索引と同じ形にそろえる
  const w = [...new Set(soroeru((bunDesuKa(q) && wakeru(q)) || q).split(" "))].join(" ");
  if (w === q) return false;
  msg.params.arguments.query = w;
  return true;
}

const server = Bun.serve({
  port: Number(arg("--listen", "3133")), hostname: arg("--host", "127.0.0.1"), idleTimeout: 255,
  async fetch(req, srv) {
    const u = new URL(req.url);
    const headers = new Headers(req.headers);
    // 本家は、同じホストの中継が付けた X-Forwarded-For から元の相手を見分ける（回数の制限が相手ごとに効く）
    const ip = srv.requestIP(req)?.address;
    if (ip) headers.set("x-forwarded-for", [req.headers.get("x-forwarded-for"), ip].filter(Boolean).join(", "));
    headers.set("accept-encoding", "identity");
    let body: any, did = false, hajime = false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.arrayBuffer();
      if (req.method === "POST" && u.pathname === "/mcp" && (req.headers.get("content-type") ?? "").includes("json")) {
        try {
          const j = JSON.parse(new TextDecoder().decode(body));
          for (const m of Array.isArray(j) ? j : [j]) if (naosu(m)) did = true;
          hajime = !!annai && j?.method === "initialize";
          if (did) { body = JSON.stringify(j); naoshita++; }
        } catch { /* JSON でない物は、そのまま通す */ }
      }
      headers.delete("content-length");
    }
    let r: Response;
    try { r = await fetch(upstream + u.pathname + u.search, { method: req.method, headers, body, redirect: "manual" }); }
    catch (e) { return new Response(`中継の先（${upstream}）につながらない: ${String(e).slice(0, 120)}`, { status: 502 }); }
    const h = new Headers(r.headers);
    h.delete("content-length"); h.delete("content-encoding");
    if (did) h.set("x-nihongo-kensaku", "waketa"); // 問いを直して渡した印（問いの中身は記録しない）
    if (hajime && r.ok) return new Response(annaiWoTasu(await r.text()), { status: r.status, headers: h });
    return new Response(r.body, { status: r.status, headers: h });
  },
});
console.log(`日本語検索の中継: http://${server.hostname}:${server.port} → ${upstream}（直す道具: ${[...tools].join("・")}${annai ? `、案内に足す決まり: ${annaiFile}` : ""}）`);
setInterval(() => { if (naoshita) { console.log(`直して渡した問い: ${naoshita} 件`); naoshita = 0; } }, 3600_000);

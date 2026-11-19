#!/usr/bin/env bun
// 権限のひな形を入れた後の確かめ：1人ずつの鍵で窓口（HTTP の MCP）を実際に呼び、
// 「読める・読めない」が会社の形（company.json）で決めたとおりかを表にする。合わない所が1つでもあれば終了コード1。
//
// 使い方:
//   bun check.ts company.json --keys <鍵のフォルダ> --url http://127.0.0.1:3131
//   bun check.ts company.json --keys <鍵のフォルダ> --url <URL> --write-test
//     … 部門ごとに1人が確かめ用のページを1つ書き、同じ部門と役員が読めるかまで見る（終わりに消す。72時間は戻せる）
// 既定は読むだけで、記憶の中身を変えない。
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const opt = (k: string, d = "") => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const file = args.find((a, i) => !a.startsWith("--") && !["--keys", "--url"].includes(args[i - 1]));
const keysDir = opt("--keys", "./member-keys"), base = opt("--url", "http://127.0.0.1:3131"), writeTest = args.includes("--write-test");
if (!file) { console.error("使い方: bun check.ts company.json --keys <鍵のフォルダ> --url <窓口のURL> [--write-test]"); process.exit(2); }
const C = JSON.parse(readFileSync(file, "utf8"));
const Z = C.zensha, depts: any[] = C.departments ?? [], members: any[] = C.members ?? [];

// ---- 1人ずつの鍵で窓口につなぐ
type Sess = { H: Record<string, string>; n: number };
const sess: Record<string, Sess> = {};
async function connect(id: string): Promise<Sess> {
  if (sess[id]) return sess[id];
  const txt = readFileSync(`${keysDir}/${id}.txt`, "utf8");
  const cid = /Client ID:\s+(\S+)/.exec(txt)![1], sec = /Client Secret:\s+(\S+)/.exec(txt)![1];
  const scope = members.find(m => m.id === id)?.dan === "shagai" ? "read" : "read write";
  const t = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cid, client_secret: sec, scope }) });
  const tj: any = await t.json();
  if (!tj.access_token) throw new Error(`${id}: 鍵で入れない（${t.status} ${tj.error ?? ""}）`);
  const s: Sess = { H: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tj.access_token}` }, n: 1 };
  await rpc(s, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kengen-4dan-check", version: "1" } });
  await rpc(s, "notifications/initialized", {}, true);
  return (sess[id] = s);
}
async function rpc(s: Sess, method: string, params: any, notify = false): Promise<any> {
  const body: any = { jsonrpc: "2.0", method, params }; if (!notify) body.id = s.n++;
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: s.H, body: JSON.stringify(body) });
  const sid = r.headers.get("mcp-session-id"); if (sid) s.H["mcp-session-id"] = sid;
  const t = await r.text(); if (!t) return {};
  const line = t.startsWith("{") ? t : (t.split("\n").filter(l => l.startsWith("data:")).pop() || "").slice(5);
  try { return JSON.parse(line); } catch { return { error: { message: t.slice(0, 200) } }; }
}
async function call(id: string, tool: string, a: any): Promise<{ ok: boolean; j: any; code: string }> {
  const res = await rpc(await connect(id), "tools/call", { name: tool, arguments: a });
  const c = res.result?.content?.[0]?.text ?? ""; let j: any = null; try { j = JSON.parse(c); } catch {}
  if (res.error) return { ok: false, j, code: String(res.error.message).slice(0, 60) };
  if (res.result?.isError) return { ok: false, j, code: String(j?.code ?? j?.error?.code ?? j?.error ?? c).slice(0, 60) };
  return { ok: true, j, code: "" };
}

// ---- 決めた形から「読めるはず」を出す
const inGroup = (m: any, g: string) => g === "yakuin" ? m.dan === "yakuin" : g === "zensha" ? m.dan !== "shagai" : g === "shagai" ? m.dan === "shagai" : m.dan === "bumon" && m.department === g;
const under = (slug: string, ps: string[] = []) => ps.some(p => slug.startsWith(p));
function expected(m: any, source: string, slug: string): boolean {
  const grant = m.dan === "yakuin" ? true : m.dan === "bumon" ? source === Z.id || source === m.department : source === Z.id;
  if (!grant) return false;
  for (const r of C.rules ?? []) if (r.source === source && slug.startsWith(r.prefix) && m.id !== C.owner && !r.readers.some((x: string) => x === m.id || (x.startsWith("group:") && inGroup(m, x.slice(6))))) return false;
  if (source === Z.id && under(slug, Z.yakuin_folders)) return m.dan === "yakuin";
  if (source === Z.id && under(slug, Z.shagai_folders)) return true;
  return m.dan !== "shagai"; // 社外は、名指しされたフォルダだけ
}

// ---- 確かめるページを選ぶ（持ち主の鍵で一覧を読み、種類ごとに1つ）
type Probe = { label: string; source: string; slug: string };
const probes: Probe[] = [];
const notes: string[] = [];
async function pick(label: string, source: string, test: (slug: string) => boolean) {
  const r = await call(C.owner, "list_pages", { source_id: source, limit: 200 });
  const p = (Array.isArray(r.j) ? r.j : r.j?.pages ?? []).find((x: any) => test(x.slug));
  if (p) probes.push({ label, source, slug: p.slug }); else notes.push(`${label}：確かめるページが無い（${source}）`);
}
for (const p of Z.yakuin_folders ?? []) await pick(`役員だけ（${Z.name} ${p}）`, Z.id, s => s.startsWith(p));
await pick(`全社（${Z.name}）`, Z.id, s => !under(s, Z.yakuin_folders) && !under(s, Z.shagai_folders) && !(C.rules ?? []).some((r: any) => r.source === Z.id && s.startsWith(r.prefix)));
for (const p of Z.shagai_folders ?? []) await pick(`社外にも出す（${Z.name} ${p}）`, Z.id, s => s.startsWith(p));
for (const d of depts) await pick(`部門（${d.name}）`, d.id, s => !(C.rules ?? []).some((r: any) => r.source === d.id && s.startsWith(r.prefix)));
for (const r of C.rules ?? []) await pick(`追加の決まり（${r.source} ${r.prefix}）`, r.source, s => s.startsWith(r.prefix));

// ---- 表にする
let bad = 0, total = 0;
const mark = (exp: boolean, act: boolean) => { total++; if (exp !== act) bad++; return (act ? "読める" : "読めない") + (exp === act ? "" : " ★違う"); };
async function row(p: Probe) {
  const cells: string[] = [];
  for (const m of members) cells.push(mark(expected(m, p.source, p.slug), (await call(m.id, "get_page", { slug: p.slug, source_id: p.source })).ok));
  console.log(`${p.label}\t${p.source}:${p.slug}\t${cells.join("\t")}`);
}
console.log(["確かめる物", "ページ", ...members.map(m => m.name)].join("\t"));
for (const p of probes) await row(p);

// ---- 書いて確かめる（頼まれた時だけ）
if (writeTest) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  for (const d of depts) {
    const w = members.find(m => m.dan === "bumon" && m.department === d.id); if (!w) continue;
    const slug = `kakunin/hinagata-${stamp}`;
    const put = await call(w.id, "put_page", { slug, content: `---\ntitle: 権限のひな形の確かめ（消してよい）\ntype: note\n---\n# 権限のひな形の確かめ\n\n${w.name} が書いた確かめ用のページ。\n` });
    if (!put.ok) {
      console.log(`新しく書く（${d.name}）\t${d.id}:${slug}\t書けない ★違う（${put.code}）`); bad++; total++;
      if (put.code.includes("owner_unavailable")) notes.push(`${d.name}：記憶が古い形（classic）で、AI からの書き込みを断っている。company.json の kakikomi を file か database にして apply.ts を入れ直す（README の「AI から書けない時」）`);
      continue;
    }
    await row({ label: `新しく書いたページ（${d.name}、書いた人 ${w.name}）`, source: d.id, slug });
    await call(w.id, "delete_page", { slug, source_id: d.id });
  }
  for (const m of members.filter(x => x.dan === "shagai")) {
    const r = await call(m.id, "put_page", { slug: `kakunin/shagai-${stamp}`, content: "---\ntitle: 書けてはいけない\n---\n# 書けてはいけない\n" });
    total++; if (r.ok) bad++;
    console.log(`社外の鍵で書く（${m.name}）\t-\t${r.ok ? "書けた ★違う" : "書けない（" + r.code + "）"}`);
  }
}
for (const n of notes) console.log("注意：" + n);
console.log(`\n${total} か所を確かめ、決めた形と違う所は ${bad} か所。`);
process.exit(bad ? 1 : 0);

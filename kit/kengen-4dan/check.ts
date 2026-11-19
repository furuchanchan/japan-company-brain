#!/usr/bin/env bun
// 権限のひな形を入れた後の確かめ：1人ずつの鍵で窓口（HTTP の MCP）を実際に呼び、
// 「読める・読めない」が会社の形（company.json）で決めたとおりかを表にする。合わない所が1つでもあれば終了コード1。
//
// 使い方:
//   bun check.ts company.json --keys <鍵のフォルダ> --url http://127.0.0.1:3131
//   bun check.ts company.json --keys <鍵のフォルダ> --url <URL> --write-test
//     … 部門ごとに1人が確かめ用のページを1つ書き、同じ部門と役員が読めるかまで見る（終わりに消す。72時間は戻せる）
//   bun check.ts company.json --keys <鍵のフォルダ> --url <URL> --html <書き出すファイル>
//     … 同じ表を、理由つきの1枚の HTML に書き出す（ブラウザで開ける。外の部品は読み込まない）
// 既定は読むだけで、記憶の中身を変えない。
import { readFileSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const opt = (k: string, d = "") => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const file = args.find((a, i) => !a.startsWith("--") && !["--keys", "--url", "--html"].includes(args[i - 1]));
const keysDir = opt("--keys", "./member-keys"), base = opt("--url", "http://127.0.0.1:3131"), writeTest = args.includes("--write-test"), htmlOut = opt("--html");
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
const bumon = (m: any): string[] => m.dan === "bumon" ? [m.department, ...(m.kenmu ?? [])] : []; // 主の部門と、兼務の部門
const inGroup = (m: any, g: string) => g === "yakuin" ? m.dan === "yakuin" : g === "zensha" ? m.dan !== "shagai" : g === "shagai" ? m.dan === "shagai" : bumon(m).includes(g);
const under = (slug: string, ps: string[] = []) => ps.some(p => slug.startsWith(p));
function expected(m: any, source: string, slug: string): boolean {
  const grant = m.dan === "yakuin" ? true : m.dan === "bumon" ? source === Z.id || bumon(m).includes(source) : source === Z.id;
  if (!grant) return false;
  for (const r of C.rules ?? []) if (r.source === source && slug.startsWith(r.prefix) && m.id !== C.owner && !r.readers.some((x: string) => x === m.id || (x.startsWith("group:") && inGroup(m, x.slice(6))))) return false;
  if (source === Z.id && under(slug, Z.yakuin_folders)) return m.dan === "yakuin";
  if (source === Z.id && under(slug, Z.shagai_folders)) return true;
  return m.dan !== "shagai"; // 社外は、名指しされたフォルダだけ
}

// ---- 確かめるページを選ぶ（持ち主の鍵で一覧を読み、種類ごとに1つ）
type Probe = { label: string; source: string; slug: string; written?: boolean };
const probes: Probe[] = [];
const notes: string[] = [];
async function pick(label: string, source: string, test: (slug: string) => boolean) {
  const r = await call(C.owner, "list_pages", { source_id: source, limit: 200 });
  const p = (Array.isArray(r.j) ? r.j : r.j?.pages ?? []).find((x: any) => !x.slug.startsWith("kakunin/") && test(x.slug)); // 前の確かめで書いたページは選ばない
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
type Row = { p: Probe; act: boolean[]; exp: boolean[] };
const table: Row[] = [];
async function row(p: Probe) {
  const cells: string[] = [], r: Row = { p, act: [], exp: [] };
  for (const m of members) {
    const exp = expected(m, p.source, p.slug), act = (await call(m.id, "get_page", { slug: p.slug, source_id: p.source })).ok;
    r.act.push(act); r.exp.push(exp); cells.push(mark(exp, act));
  }
  table.push(r);
  console.log(`${p.label}\t${p.source}:${p.slug}\t${cells.join("\t")}`);
}
console.log(["確かめる物", "ページ", ...members.map(m => m.name)].join("\t"));
for (const p of probes) await row(p);

// ---- 書いて確かめる（頼まれた時だけ）
if (writeTest) {
  // 前の確かめで消したページと名前が重なると revision_required で断られるので、時刻に乱数を足す
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "") + "-" + Math.random().toString(16).slice(2, 6);
  for (const d of depts) {
    const w = members.find(m => m.dan === "bumon" && m.department === d.id); if (!w) continue;
    const slug = `kakunin/hinagata-${stamp}`;
    const put = await call(w.id, "put_page", { slug, content: `---\ntitle: 権限のひな形の確かめ（消してよい）\ntype: note\n---\n# 権限のひな形の確かめ\n\n${w.name} が書いた確かめ用のページ。\n` });
    if (!put.ok) {
      console.log(`新しく書く（${d.name}）\t${d.id}:${slug}\t書けない ★違う（${put.code}）`); bad++; total++;
      if (put.code.includes("owner_unavailable")) notes.push(`${d.name}：記憶が古い形（classic）で、AI からの書き込みを断っている。company.json の kakikomi を file か database にして apply.ts を入れ直す（README の「AI から書けない時」）`);
      continue;
    }
    await row({ label: `新しく書いたページ（${d.name}、書いた人 ${w.name}）`, source: d.id, slug, written: true });
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

// ---- 同じ表を1枚の HTML に書き出す（頼まれた時だけ）
if (htmlOut) {
  const h = (s: string) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  const nameOf = (id: string) => id === Z.id ? Z.name : depts.find(d => d.id === id)?.name ?? id;
  const who = (x: string) => x.startsWith("group:") ? ({ yakuin: "役員", zensha: "社内の全員", shagai: "社外" } as any)[x.slice(6)] ?? nameOf(x.slice(6)) : members.find(m => m.id === x)?.name ?? x;
  // その行がそうなる理由と、決めている所。expected() と同じ順で見る
  const why = (p: Probe): [string, string] => {
    const r = (C.rules ?? []).find((r: any) => r.source === p.source && p.slug.startsWith(r.prefix));
    const pre = p.written ? "AI から書いたページも、置き場の決まりのとおりに読めます。" : "";
    if (r) return [`${nameOf(p.source)}の ${r.prefix} は、${[members.find(m => m.id === C.owner)?.name, ...r.readers.map(who)].filter((x, i, a) => x && a.indexOf(x) === i).join("・")}だけに絞る決まりを足してあります。`, "company.json の rules"];
    if (p.source === Z.id && under(p.slug, Z.yakuin_folders)) return [`${Z.name}の ${Z.yakuin_folders.find((f: string) => p.slug.startsWith(f))} は、役員だけが読めます。`, "company.json の yakuin_folders"];
    if (p.source === Z.id && under(p.slug, Z.shagai_folders)) return [`${Z.name}の ${Z.shagai_folders.find((f: string) => p.slug.startsWith(f))} は、社外の鍵にも返します。`, "company.json の shagai_folders"];
    if (p.source === Z.id) return [`${Z.name}の置き場は、社内の全員が読めます。社外の鍵には返りません。`, "段の決まり（全社）"];
    return [`${pre}${nameOf(p.source)}の置き場は、${nameOf(p.source)}の人と役員が読めます。`, "段の決まり（部門）"];
  };
  // 列は 役員 → 部門ごと → 社外 の順にまとめる
  const groups: { name: string; idx: number[] }[] = [];
  const push = (name: string, f: (m: any) => boolean) => { const idx = members.map((m, i) => f(m) ? i : -1).filter(i => i >= 0); if (idx.length) groups.push({ name, idx }); };
  push("役員", m => m.dan === "yakuin");
  for (const d of depts) push(d.name, m => m.dan === "bumon" && m.department === d.id);
  push("社外", m => m.dan === "shagai");
  const order = groups.flatMap(g => g.idx), first = new Set(groups.slice(1).map(g => g.idx[0]));
  const sec = (i: number) => first.has(i) ? " sec" : "";
  const short = (m: any, g: string) => m.name.startsWith(g) ? m.name.slice(g.length).trim() || m.name : m.name;
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
  const body = table.map(r => {
    const [reason, where] = why(r.p);
    const cells = order.map(i => `<td class="c${sec(i)}">${r.act[i] ? '<span aria-label="読める">●</span>' : '<span aria-label="読めない"></span>'}${r.act[i] === r.exp[i] ? "" : '<b class="bad">違う</b>'}</td>`).join("");
    return `<tr tabindex="0" aria-expanded="false"><td>${h(r.p.label)}<span class="path">${h(nameOf(r.p.source))} ${h(r.p.slug)}</span></td>${cells}</tr>
<tr class="why" hidden><td colspan="${order.length + 1}"><dl><dt>理由</dt><dd>${h(reason)}</dd><dt>決めている所</dt><dd>${h(where)}</dd></dl></td></tr>`;
  }).join("\n");
  const page = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>読める範囲</title>
<style>
:root{--ink:#0D1117;--sub:#3C4B64;--mute:#7A8699;--line:#D9DEE6;--hair:#E9EDF2;--paper:#F4F6F9;--ground:#FCFCFD;--warn:#B42318}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.6 "Hiragino Sans","Noto Sans JP","Yu Gothic UI",system-ui,sans-serif}
main{padding:28px 36px 60px;max-width:1240px}h1{font-size:20px;margin:0 0 4px}
.lead{color:var(--sub);margin:0 0 20px;max-width:46em}
.state{font-size:13px;color:var(--sub);border-bottom:1px solid var(--ink);padding-bottom:10px}.state b{color:var(--ink)}.state b.ng{color:var(--warn)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--hair);white-space:nowrap;vertical-align:top}
thead th{font-weight:400;color:var(--sub);font-size:12px;border-bottom:1px solid var(--line);vertical-align:bottom}
thead th.grp{border-bottom:0;padding-bottom:0;color:var(--mute)}
td.c,th.c{text-align:center;width:76px}td.c{font-size:15px}.sec{border-left:1px solid var(--line)}
.bad{display:block;color:var(--warn);font-size:12px}
.path{display:block;color:var(--mute);font-size:12px;font-family:ui-monospace,"SF Mono",Menlo,monospace}
tr[tabindex]{cursor:pointer}tr[tabindex]:hover td{background:var(--paper)}tr[tabindex]:focus-visible{outline:2px solid var(--ink);outline-offset:-2px}
tr.why td{background:var(--paper);white-space:normal;color:var(--sub);font-size:13px;padding:10px 12px 14px}
tr.why dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;max-width:56em}tr.why dt{color:var(--ink)}tr.why dd{margin:0}
.note{color:var(--mute);font-size:12px;margin-top:14px}[hidden]{display:none!important}
@media (max-width:820px){main{padding:20px 16px 48px}}
</style></head><body><main>
<h1>読める範囲</h1>
<p class="lead">だれの AI にどの資料が返るかを、1人ずつの鍵で実際に呼んで確かめた結果です。行を押すと、そうなる理由が開きます。</p>
<p class="state"><b${bad ? ' class="ng"' : ""}>${total}か所を確かめ、決めた形と違う所は${bad}か所。</b>　${now} に確かめました</p>
<div class="scroll"><table>
<thead><tr><th class="grp"></th>${groups.map((g, i) => `<th class="grp c${i ? " sec" : ""}" colspan="${g.idx.length}">${h(g.name)}</th>`).join("")}</tr>
<tr><th>資料</th>${groups.map(g => g.idx.map(i => `<th class="c${sec(i)}">${h(short(members[i], g.name))}</th>`).join("")).join("")}</tr></thead>
<tbody>
${body}
</tbody></table></div>
<p class="note">● 読める　空欄は読めない（その人の AI には、資料が無いのと同じ答えが返ります）${notes.map(n => "<br>注意：" + h(n)).join("")}</p>
</main><script>
document.querySelectorAll("tr[tabindex]").forEach(function(tr){var w=tr.nextElementSibling;function t(){w.hidden=!w.hidden;tr.setAttribute("aria-expanded",String(!w.hidden))}
tr.addEventListener("click",t);tr.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();t()}})});
</script></body></html>
`;
  writeFileSync(htmlOut, page);
}
process.exit(bad ? 1 : 0);

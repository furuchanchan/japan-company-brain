#!/usr/bin/env bun
// 権限のひな形（4段：役員・部門・全社・社外）を、会社の形（company.json）から gbrain に入れる。
// 本家 gbrain のコマンドを順に呼ぶだけで、本家のコードは変えない。確かめた版は v0.60.736.0。
//
// 使い方（gbrain を動かしているホストで）:
//   bun apply.ts company.json                      … 下見。実行するコマンドを順に出すだけ
//   bun apply.ts company.json --yes --keys <フォルダ> … 実行。鍵は <フォルダ>/<メンバー>.txt に 0600 で置く
// 入れ直しても、既にある置き場・メンバー・グループ・決まり・鍵は飛ばす。
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--keys");
const yes = args.includes("--yes");
const keysDir = args.includes("--keys") ? args[args.indexOf("--keys") + 1] : "./member-keys";
if (!file) { console.error("使い方: bun apply.ts company.json [--keys <鍵を置くフォルダ>] [--yes]"); process.exit(2); }
const C = JSON.parse(readFileSync(file, "utf8"));

// ---- 会社の形を点検する（間違いは、何も実行する前に止める）
const ID = /^[a-z0-9][a-z0-9-]*$/;
const errs: string[] = [];
const depts: any[] = C.departments ?? [];
const members: any[] = C.members ?? [];
const Z = C.zensha ?? {};
for (const m of members) {
  if (!ID.test(m.id ?? "")) errs.push(`メンバーの id は半角の英数字とハイフン: ${m.id}`);
  if (!["yakuin", "bumon", "shagai"].includes(m.dan)) errs.push(`${m.id}: dan は yakuin・bumon・shagai のどれか`);
  if (m.dan === "bumon" && !depts.some(d => d.id === m.department)) errs.push(`${m.id}: department「${m.department}」が departments に無い`);
  // 兼務：主の部門（department）のほかに読める部門。書く先は主の部門のまま
  if (m.kenmu !== undefined && (m.dan !== "bumon" || !Array.isArray(m.kenmu))) errs.push(`${m.id}: kenmu（兼務）は、dan が bumon のメンバーに、部門の id の並びで書く`);
  for (const k of Array.isArray(m.kenmu) ? m.kenmu : []) if (k === m.department || !depts.some(d => d.id === k)) errs.push(`${m.id}: kenmu「${k}」は、departments にある、主の部門とは別の部門から選ぶ`);
}
for (const d of [Z, ...depts]) if (!ID.test(d.id ?? "")) errs.push(`置き場の id は半角の英数字とハイフン: ${d.id}`);
if (new Set(members.map(m => m.id)).size !== members.length) errs.push("メンバーの id が重なっている");
const owner = members.find(m => m.id === C.owner);
if (!owner || owner.dan !== "yakuin") errs.push(`owner「${C.owner}」は、dan が yakuin のメンバーから選ぶ`);
for (const g of ["yakuin", "zensha", "shagai"]) if (depts.some(d => d.id === g)) errs.push(`部門の id に ${g} は使えない（段のグループの名前）`);
if (errs.length) { console.error("会社の形に間違いがあります:\n- " + errs.join("\n- ")); process.exit(2); }

// ---- gbrain を呼ぶ
function gb(cmd: string[]): { code: number; out: string } {
  const r = Bun.spawnSync(["gbrain", ...cmd], { stdout: "pipe", stderr: "pipe" });
  // 本家が出す案内（[gbrain notice] の行と [AGENT]〜[/AGENT] の段）は、結果の表示から外す
  const out = (r.stdout.toString() + r.stderr.toString()).replace(/^\[AGENT\][\s\S]*?^\[\/AGENT\]\n?/gm, "").split("\n").filter(l => !l.startsWith("[gbrain notice")).join("\n");
  return { code: r.exitCode ?? 1, out };
}
function readJson(cmd: string[]): any {
  const r = Bun.spawnSync(["gbrain", ...cmd, "--json"], { stdout: "pipe", stderr: "pipe" });
  try { return JSON.parse(r.stdout.toString()); } catch { return {}; }
}

// ---- 今の状態を読む（読むだけ）
const curSources: any[] = readJson(["sources", "list"]).sources ?? [];
const curMembers: any[] = readJson(["access", "member", "list"]).members ?? [];
const curGroups: any[] = readJson(["access", "group", "list"]).groups ?? [];
const curOwner: string | null = readJson(["access", "owner"]).owner ?? null;
const curRules = (s: string): any[] => readJson(["access", "rule", "list", "--source", s]).rules ?? [];

// ---- 段ごとのグループ
const ids = (dan: string) => members.filter(m => m.dan === dan).map(m => m.id);
const groups: Record<string, string[]> = { yakuin: ids("yakuin"), zensha: [...ids("yakuin"), ...ids("bumon")], shagai: ids("shagai") };
const bumon = (m: any): string[] => m.dan === "bumon" ? [m.department, ...(m.kenmu ?? [])] : [];
for (const d of depts) groups[d.id] = members.filter(m => bumon(m).includes(d.id)).map(m => m.id);

type Step = { what: string; cmd: string[]; saveTo?: string; bind?: string };
const steps: Step[] = [];
const skipped: string[] = [];

// 1. 置き場。全社も部門も「連合しない」（isolated）で作る。
//    連合する置き場にメンバーの鍵で書くと、新しいページの読み手が書いた本人だけになる（本家の仕様）。
//    連合しない置き場なら、その置き場を読める鍵（同じ部門と役員）がそのまま読める。
for (const s of [Z, ...depts]) {
  const cur = curSources.find(x => x.id === s.id);
  if (!cur) steps.push({ what: `置き場「${s.name}」を作る（連合しない）`, cmd: ["sources", "add", s.id, "--path", s.path, "--name", s.name, "--no-federated", ...(s.plain_directory ? ["--force"] : [])] });
  else if (cur.federated) steps.push({ what: `置き場「${s.name}」を、連合しない設定に替える`, cmd: ["sources", "unfederate", s.id] });
  else skipped.push(`置き場 ${s.id}`);
}
// 2. メンバー
for (const m of members) {
  if (curMembers.some(x => x.id === m.id)) skipped.push(`メンバー ${m.id}`);
  else steps.push({ what: `メンバー「${m.name}」を足す`, cmd: ["access", "member", "add", m.id, "--name", m.name] });
}
// 3. グループ（段と部門）
for (const [g, want] of Object.entries(groups)) {
  const have: string[] = curGroups.find(x => x.id === g)?.members ?? [];
  const add = want.filter(x => !have.includes(x));
  if (add.length) steps.push({ what: `グループ ${g} に ${add.join("・")} を入れる`, cmd: ["access", "group", "add", g, "--members", add.join(",")] });
  else skipped.push(`グループ ${g}`);
}
// 4. 持ち主
if (curOwner === C.owner) skipped.push(`持ち主 ${C.owner}`);
else steps.push({ what: `持ち主を ${C.owner} にする`, cmd: ["access", "owner", "set", C.owner] });
// 5. 社外のメンバーは「名指しされたページだけ読む」設定にする
for (const id of groups.shagai) {
  if (curMembers.find(x => x.id === id)?.labelled_only) skipped.push(`社外の設定 ${id}`);
  else steps.push({ what: `社外の ${id} を、名指しされたページだけ読む設定にする`, cmd: ["access", "member", "labelled-only", id, "on"] });
}
// 6. フォルダの決まり。読み手には必ず持ち主を入れる（本家は、持ち主を外した決まりを断る）。
const rules: { source: string; prefix: string; readers: string[]; id: string }[] = [];
for (const p of Z.yakuin_folders ?? []) rules.push({ source: Z.id, prefix: p, readers: ["group:yakuin"], id: "yakuin-" + p.replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "") });
for (const p of Z.shagai_folders ?? []) rules.push({ source: Z.id, prefix: p, readers: ["group:zensha", "group:shagai"], id: "shagai-" + p.replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "") });
for (const r of C.rules ?? []) rules.push({ source: r.source, prefix: r.prefix, readers: r.readers, id: r.id ?? "kimari-" + r.prefix.replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "") });
for (const s of new Set(rules.map(r => r.source))) {
  const have = curSources.some(x => x.id === s) ? curRules(s) : [];
  for (const r of rules.filter(x => x.source === s)) {
    if (have.some(x => x.prefix === r.prefix)) skipped.push(`決まり ${s}:${r.prefix}`);
    else steps.push({ what: `決まり：${s} の ${r.prefix} は ${[C.owner, ...r.readers].join("・")} だけが読む`, cmd: ["access", "rule", "add", "--prefix", r.prefix, "--readers", [C.owner, ...r.readers].join(","), "--source", s, "--id", r.id, "--yes"] });
  }
}
// 7. 鍵。1人に1つ、必ずメンバーに結ぶ（2人以上の記憶では、人に結ばない鍵は本家が断る）。
for (const m of members) {
  const f = `${keysDir}/${m.id}.txt`;
  if (existsSync(f)) { skipped.push(`鍵 ${m.id}`); continue; }
  const write = m.dan === "bumon" ? m.department : Z.id;
  const read = m.dan === "yakuin" ? [Z.id, ...depts.map(d => d.id)] : m.dan === "bumon" ? [...bumon(m), Z.id] : [Z.id];
  const scopes = m.dan === "shagai" ? "read" : "read write";
  steps.push({ what: `鍵：${m.name}（書く先 ${m.dan === "shagai" ? "なし" : write}、読む範囲 ${read.join("・")}）`, saveTo: f,
    cmd: ["auth", "register-client", m.id, "--grant-types", "client_credentials", "--scopes", scopes, "--source", write, "--federated-read", read.join(","), "--member", m.id] });
}
// 8. AI からの書き込み（kakikomi）。確かめた事実（v0.60.736.0、2026-11-18）：
//    ・新しく立てた記憶は、AI が書いたページをファイルにも残す形（本家の managed）で始まり、足した置き場の書き手はこのホストに決まる。何もしなくてよい。
//    ・古い形（classic）の記憶では、AI からの書き込みは owner_unavailable で断られる。古い版から上げた記憶や、書き手の設定を外した記憶がこれに当たる。
//    "sonomama"＝記憶の今の設定のまま（既定）／"database"＝書き手の決まっていない置き場には、DB にだけ書く／
//    "file"＝このホストを各置き場のファイルの書き手に決め、managed を有効にする（classic の記憶を直す時）
//    "file" は、ファイルの書き手を1台に決める設定。記憶を2台以上のホストで動かす時は、先に本家の docs/architecture/topologies.md を読む。
const mode: string = C.kakikomi ?? "sonomama";
if (!["sonomama", "database", "file"].includes(mode)) { console.error(`kakikomi は sonomama・database・file のどれか: ${mode}`); process.exit(2); }
const writer = () => readJson(["sources", "writer", "status"]);
const boundNow = (w: any) => new Set((w.bindings ?? []).filter((b: any) => b.state === "active").map((b: any) => b.source_id));
if (mode === "database") {
  if (gb(["config", "get", "persistence.unbound_write"]).out.includes("database_only")) skipped.push("書き方 database");
  else steps.push({ what: "書き手の決まっていない置き場には、AI のページを DB にだけ書く設定にする", cmd: ["config", "set", "persistence.unbound_write", "database_only"] });
}
if (mode === "file") {
  const ws = writer(), bound = boundNow(ws);
  const def = curSources.find(x => x.id === "default");
  for (const s of [...(def?.local_path ? [{ id: "default", path: def.local_path }] : []), Z, ...depts]) {
    // managed の記憶では、これから足す置き場の書き手は足した時に決まるので、手順に入れない
    if (bound.has(s.id) || (ws.enabled && !curSources.some(x => x.id === s.id))) skipped.push(`書き手 ${s.id}`);
    else steps.push({ what: `置き場 ${s.id} のファイルの書き手を、このホストに決める`, bind: s.id, cmd: ["sources", "writer", "claim", s.id, "--path", s.path, "--admin-intent", "writer_claim", "--expected-state", "<admin_state>"] });
  }
  if (ws.enabled) skipped.push("書き方 file");
  else steps.push({ what: "AI が書いたページを、ファイルにも残す書き方（managed）を有効にする", cmd: ["sources", "writer", "activate", "--confirm-quiesced", "--admin-intent", "writer_activate", "--expected-state", "<admin_state>"] });
}

// ---- 下見か、実行か
console.log(`${yes ? "実行" : "下見"}：${steps.length} 件（既にある物 ${skipped.length} 件は飛ばす）`);
if (yes && steps.some(s => s.saveTo)) mkdirSync(keysDir, { recursive: true, mode: 0o700 });
let n = 0;
for (const s of steps) {
  n++;
  const shown = "gbrain " + s.cmd.map(a => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" ");
  console.log(`${String(n).padStart(2)}. ${s.what}\n    ${shown}`);
  if (!yes) continue;
  // <admin_state> は、本家が「今の状態を見たうえでの操作か」を確かめる番号。実行の直前に読んで入れる
  const w = s.cmd.includes("<admin_state>") ? writer() : null;
  if (s.bind && boundNow(w).has(s.bind)) { console.log("    → 既に決まっているので飛ばす"); continue; }
  const r = gb(s.cmd.map(a => (a === "<admin_state>" ? w.admin_state ?? "" : a)));
  if (r.code !== 0) { console.error(`    止まりました（終了コード ${r.code}）:\n${r.out.split("\n").slice(-6).join("\n")}`); process.exit(1); }
  if (s.saveTo) { writeFileSync(s.saveTo, r.out, { mode: 0o600 }); console.log(`    → 鍵を ${s.saveTo} に置いた（秘密は画面に出さない）`); }
  else { const last = r.out.trim().split("\n").filter(l => !l.startsWith("[access] operation")).pop(); if (last) console.log(`    → ${last.trim().slice(0, 160)}`); }
}
if (!yes) console.log("\nこのとおり入れる時は、同じ指定に --yes を足す。");
else console.log(`\n済み。次は確かめる: bun check.ts ${file} --keys ${keysDir} --url <窓口のURL>`);

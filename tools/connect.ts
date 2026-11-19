#!/usr/bin/env bun
// 1人のメンバーの AI（Claude Code など）をつなぐための、長く使える鍵を1つ作る。
// 鍵は必ずそのメンバーに結び、読める置き場は、その人の段（役員・部門・社外）と同じにする。
// 使い方: bun connect.ts <会社の形 company.json> <メンバーの id> [--keys <フォルダ>] [--url <AI から見た URL>]
import { readFileSync, existsSync, writeFileSync, chmodSync } from "fs";
const a = process.argv.slice(2);
const opt = (k: string, d: string) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const [file, id] = a.filter((x, i) => !x.startsWith("--") && !["--url", "--keys"].includes(a[i - 1]));
const keys = opt("--keys", "/srv/kioku/keys"), url = opt("--url", "http://127.0.0.1:3133/mcp");
if (!file || !id) { console.error("使い方: bun connect.ts company.json <メンバーの id>"); process.exit(2); }
const C = JSON.parse(readFileSync(file, "utf8"));
const m = (C.members ?? []).find((x: any) => x.id === id);
if (!m) { console.error(`会社の形に、メンバー ${id} がいません`); process.exit(2); }
const Z = C.zensha, depts: any[] = C.departments ?? [];
// 先頭が書く先。役員＝全社と全部門、部門＝自分の部門と全社、社外＝全社（読むだけ）
const sources = m.dan === "yakuin" ? [Z.id, ...depts.map(d => d.id)] : m.dan === "bumon" ? [m.department, Z.id] : [Z.id];
const scopes = m.dan === "shagai" ? "read" : "read,write";
const name = `${id}-ai`, out = `${keys}/${id}.token.txt`;
const gb = (cmd: string[]) => { const r = Bun.spawnSync(["gbrain", ...cmd], { stdout: "pipe", stderr: "pipe" }); return { code: r.exitCode ?? 1, out: r.stdout.toString() + r.stderr.toString() }; };
if (existsSync(out)) { console.log(`鍵は既にあります: keys/${id}.token.txt（作り直す時は、./kioku gbrain auth revoke ${name} の後にファイルを消す）`); }
else {
  const c = gb(["auth", "create", name, "--member", id, "--scopes", scopes]);
  const tok = /\b(gbrain_[A-Za-z0-9_-]{20,})\b/.exec(c.out)?.[1];
  if (c.code !== 0 || !tok) { console.error("鍵を作れませんでした:\n" + c.out.split("\n").filter(l => !l.startsWith("[gbrain notice")).join("\n").slice(0, 600)); process.exit(1); }
  writeFileSync(out, tok + "\n", { mode: 0o600 }); chmodSync(out, 0o600);
  const r = gb(["auth", "rescope", "--token", name, "--sources", sources.join(",")]);
  if (r.code !== 0) { gb(["auth", "revoke", name]); console.error("読める置き場を絞れなかったので、鍵を取り消しました:\n" + r.out.slice(0, 600)); process.exit(1); }
  console.log(`${m.name} の鍵を作りました（書く先 ${m.dan === "shagai" ? "なし" : sources[0]}、読む範囲 ${sources.join("・")}）`);
  console.log(`置いた所: keys/${id}.token.txt（本人だけに、安全な経路で渡してください）`);
}
console.log(`\nClaude Code につなぐ時（本人の PC で）:\n  claude mcp add kioku -t http ${url} -H "Authorization: Bearer <鍵のファイルの中身>"`);

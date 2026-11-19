#!/usr/bin/env bun
// 元のファイルが無くなったページを、検索から外す。./brain sync が、取り込みの前に動かす。
// エンジンは、git の管理でないフォルダから消えたファイルのページを残す（v0.60.736.0）。改定前の規程や、退職した人の資料が検索に残らないようにする。
// 外すのは、エンジンの修理の手順（gbrain repair ghost-pages）。外したページは72時間は戻せる（./brain gbrain restore <slug> --force）。
// 使い方: bun kesu.ts <会社の形 company.json> [--shitami]
import { existsSync, readdirSync, readFileSync } from "fs";
const file = process.argv[2], shitami = process.argv.includes("--shitami");
if (!file || !existsSync(file)) process.exit(0); // 会社の形がまだ無い時は、何もしない
const C = JSON.parse(readFileSync(file, "utf8"));
const gb = (cmd: string[]) => { const r = Bun.spawnSync(["gbrain", ...cmd], { stdout: "pipe", stderr: "pipe" }); return { code: r.exitCode ?? 1, out: r.stdout.toString(), err: r.stderr.toString() }; };
const json = (s: string): any => { try { return JSON.parse(s.slice(s.indexOf("{"))); } catch { return null; } };
for (const s of [C.zensha, ...(C.departments ?? [])]) {
  // フォルダが見えない・空の時は、置き場所の間違い（つなぎ忘れなど）として、何も外さない
  if (!existsSync(s.path) || readdirSync(s.path).length === 0) continue;
  const p = gb(["repair", "ghost-pages", "--source", s.id, "--json"]);
  const r = json(p.out)?.results?.[0];
  if (!r) continue; // 置き場がまだ無い時など
  const n: number = r.affected ?? 0, zen: number = r.residuals?.file_backed ?? 0;
  if (n === 0) continue;
  if (n >= 10 && n * 2 > zen) { console.log(`${s.name}：元のファイルが無いページが ${n} 件（${zen} 件のうち）あります。多すぎるので外していません。資料のフォルダを確かめてください。`); continue; }
  const hash: string | undefined = r.preview_hash; // 下見で見た中身のとおりに外す、という印
  if (shitami || !hash) { console.log(`${s.name}：元のファイルが無いページが ${n} 件あります（下見。例：${(r.sample ?? []).join("、")}）`); continue; }
  const a = gb(["repair", "ghost-pages", "--source", s.id, "--apply", "--expect", hash, "--yes"]);
  if (a.code !== 0) { console.error(`${s.name}：外せませんでした\n${(a.out + a.err).split("\n").filter(l => !l.startsWith("[gbrain notice")).join("\n").slice(-400)}`); process.exit(1); }
  console.log(`${s.name}：元のファイルが無くなったページ ${n} 件を、検索から外しました（${(r.sample ?? []).join("、")}）。72時間は戻せます。`);
}

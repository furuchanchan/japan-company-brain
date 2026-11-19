#!/usr/bin/env bun
// 資料のフォルダ（docs/ の下）が別の場所から置き直された後に、AI からの書き込みを通すための手当て。
// エンジンは、置き場ごとのフォルダが「自分が印を付けた物と同じか」を見ていて、復元や引っ越しで
// フォルダが作り直されると、書き込みを recovery_required で断る。中身（ファイルの一覧と要約値）が
// 同じことをエンジン自身に確かめさせたうえで、同じ場所に印を付け直す（エンジンの self-transfer）。
// 使い方: bun restamp.ts <会社の形 company.json>      既定は下見。--yes を付けると実行
import { readFileSync } from "fs";
const a = process.argv.slice(2), yes = a.includes("--yes"), file = a.find(x => !x.startsWith("--"));
if (!file) { console.error("使い方: bun restamp.ts company.json [--yes]"); process.exit(2); }
const C = JSON.parse(readFileSync(file, "utf8"));
const ids: string[] = [C.zensha.id, ...(C.departments ?? []).map((d: any) => d.id)];
const gb = (cmd: string[]) => {
  const r = Bun.spawnSync(["gbrain", ...cmd, "--json"], { stdout: "pipe", stderr: "pipe" });
  const out = r.stdout.toString(); let j: any = null; try { j = JSON.parse(out.slice(out.indexOf("{"))); } catch {}
  return { ok: (r.exitCode ?? 1) === 0 && j, j, text: (out + r.stderr.toString()).split("\n").filter(l => !l.startsWith("[gbrain notice")).join("\n").slice(0, 500) };
};
const state = () => gb(["sources", "writer", "status"]).j?.admin_state;
const SELF = ["--self-transfer", "--confirm-relocated-root"];
let n = 0;
for (const id of ids) {
  const dry = gb(["sources", "writer", "transfer", "prepare", id, ...SELF, "--dry-run"]);
  if (!dry.ok) { console.error(`${id}：調べられませんでした\n${dry.text}`); process.exit(1); }
  if (!dry.j.relocated) { console.log(`${id}：置き直されていません（何もしません）`); continue; }
  n++;
  if (!yes) { console.log(`${id}：置き直されています（${dry.j.binding.local_path}、ファイル ${dry.j.manifest.file_count} 件）。--yes で印を付け直します`); continue; }
  const p = gb(["sources", "writer", "transfer", "prepare", id, ...SELF, "--admin-intent", "writer_transfer_prepare", "--expected-state", state()]);
  if (!p.ok || !p.j.prepared) { console.error(`${id}：準備で止まりました\n${p.text}`); process.exit(1); }
  const acc = gb(["sources", "writer", "transfer", "accept", id, "--path", dry.j.binding.local_path, "--expected-epoch", String(p.j.owner_epoch), "--manifest", p.j.manifest.digest, ...SELF, "--admin-intent", "writer_transfer_accept", "--expected-state", state()]);
  if (!acc.ok) { console.error(`${id}：印の付け直しで止まりました\n${acc.text}`); process.exit(1); }
  console.log(`${id}：印を付け直しました`);
}
if (n && !yes) process.exit(3);

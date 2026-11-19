#!/usr/bin/env bun
// 表記ゆれをそろえる。問いの側（中継が使う soroeru）と、資料の索引の側（DB に入れる SQL）を、同じ表 yure.json から作る。
// そろえる物：全角の英数字、半角のカタカナ、人名や社名の異体字、(株) などの略、送り仮名、社内の略語、カタカナ語の語尾の長音、和暦（令和8年・令和八年・R8.4.1）。
// 資料の本文は書き換えない。そろえた形が元と違う文だけを、チャンクの末尾の「別の書き方」に足す。
//
// 使い方: bun yure.ts --sql      DB に入れる SQL を出す（関数・トリガー・今ある資料への反映）
//         bun yure.ts --remove   外す SQL を出す
import { existsSync, readFileSync } from "fs";
import T0 from "./yure.json";

// 会社ごとの語（社内の略語など）は、会社の表（既定は /srv/brain/config/yure.json）に書く。同じ形で、この表に足される。
const kaisha = process.env.BRAIN_YURE ?? "/srv/brain/config/yure.json";
const K: any = existsSync(kaisha) ? JSON.parse(readFileSync(kaisha, "utf8")) : {};
const T: any = { ...T0, itaiji: { ...T0.itaiji, ...(K.itaiji ?? {}) } };
for (const k of ["hojin", "okurigana", "ryakugo"]) T[k] = [...((T0 as any)[k] ?? []), ...(K[k] ?? [])];

export const SHIRUSHI = "［別の書き方］";
const ZEN = "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９";
const HAN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const itaiji = Object.entries(T.itaiji as Record<string, string>).filter(([a, b]) => [...a].length === 1 && [...b].length === 1);
const narabi = (a: string[][]) => [...a].sort((x, y) => y[0].length - x[0].length); // 長い語を先に
const hojin = narabi(T.hojin), okuri = narabi(T.okurigana), ryakugo = narabi(T.ryakugo);
const gengo = Object.entries(T.gengo as Record<string, number>);
const abc = Object.entries(T.gengo_abc as Record<string, string>);
const CHOON = "([ァ-ヴー]{3})ー(?![ァ-ヴー])"; // カタカナ4文字以上の語の、語尾の長音（サーバー → サーバ）
const G = gengo.map(g => g[0]).join("|"), KAN = "一二三四五六七八九", KS = `[${KAN}十]`;
const WAREKI = `(${G})(元|[0-9]{1,2})年`;
// 漢数字の和暦（令和八年四月一日）。月と日は、年のすぐ後ろに続く時だけ算用数字にする
const WAREKI_KAN = `((${G})(元|${KS}{1,3})年(?:(${KS}{1,2})月(?:(${KS}{1,3})日)?)?)`;
// アルファベットの和暦（R8.4.1、H30/3/31、R8年度）。前が英数字の時（型番の一部）はそろえない
const A = abc.map(x => x[0]).join("");
const WAREKI_ABC = `((?<![A-Za-z0-9])([${A}])([0-9]{1,2})(?:年|[./]([0-9]{1,2})[./]([0-9]{1,2})(?![0-9])))`;

/** 漢数字（一〜九十九、元）を数にする。DB の ja_kansuji と同じ結果を返す。 */
export function kansuji(s: string): number {
  if (s === "元") return 1;
  const i = s.indexOf("十");
  const ju = i < 0 ? 0 : i === 0 ? 10 : (KAN.indexOf(s[0]) + 1) * 10;
  return ju + (s.endsWith("十") ? 0 : KAN.indexOf(s[s.length - 1]) + 1);
}

/** 問いや文を、そろえた形にする。DB の ja_yure_k と同じ順で、同じ結果を返す。 */
export function soroeru(s: string): string {
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => HAN[ZEN.indexOf(c)]);
  s = s.replace(/[ｦ-ﾟ]+/g, m => m.normalize("NFKC"));
  for (const [a, b] of itaiji) s = s.replaceAll(a, b);
  for (const [a, b] of hojin) s = s.replaceAll(a, b);
  for (const [a, b] of okuri) s = s.replaceAll(a, b);
  for (const [a, b] of ryakugo) s = s.replaceAll(a, b);
  s = s.replace(new RegExp(CHOON, "g"), "$1");
  s = s.replace(new RegExp(WAREKI_KAN, "g"), (_, _a, g, n, m, d) => `${T.gengo[g] + kansuji(n)}年${m ? kansuji(m) + "月" : ""}${d ? kansuji(d) + "日" : ""}`);
  s = s.replace(new RegExp(WAREKI, "g"), (_, g, n) => `${T.gengo[g] + (n === "元" ? 1 : Number(n))}年`);
  s = s.replace(new RegExp(WAREKI_ABC, "g"), (_, _a, g, n, m, d) => `${T.gengo[T.gengo_abc[g]] + Number(n)}年${m ? `${Number(m)}月${Number(d)}日` : ""}`);
  return s;
}

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
export function sql(): string {
  const rep = (pairs: string[][]) => pairs.map(([a, b]) => `  s := replace(s, ${q(a)}, ${q(b)});`).join("\n");
  const nen = gengo.map(([g, y]) => `when ${q(g)} then ${y}`).join(" ");
  return `-- 表記ゆれの索引（kit/nihongo-kensaku/yure.ts が作った SQL。手で直さず、yure.json を直して作り直す）
create or replace function ja_kansuji(s text) returns int language sql immutable as $f$
  select case when s is null then null when s = '元' then 1 else
    (case when position('十' in s) = 0 then 0 when position('十' in s) = 1 then 10 else position(left(s, 1) in ${q(KAN)}) * 10 end)
    + (case when right(s, 1) = '十' then 0 else position(right(s, 1) in ${q(KAN)}) end) end
$f$;
create or replace function ja_yure_k(s text) returns text language plpgsql immutable
set search_path to 'pg_catalog', 'public' as $f$
declare r text; m text[];
begin
  s := translate(s, ${q(ZEN)}, ${q(HAN)});
  for r in select x[1] from (select distinct regexp_matches(s, '[ｦ-ﾟ]+', 'g') as x) t order by length(x[1]) desc loop
    s := replace(s, r, normalize(r, NFKC));
  end loop;
  s := translate(s, ${q(itaiji.map(x => x[0]).join(""))}, ${q(itaiji.map(x => x[1]).join(""))});
${rep(hojin)}
${rep(okuri)}
${rep(ryakugo)}
  s := regexp_replace(s, ${q(CHOON)}, '\\1', 'g');
  for m in select x from (select distinct regexp_matches(s, ${q(WAREKI_KAN)}, 'g') as x) t order by length(x[1]) desc loop
    s := replace(s, m[1], ((case m[2] ${nen} end) + ja_kansuji(m[3]))::text || '年'
      || coalesce(ja_kansuji(m[4])::text || '月', '') || coalesce(ja_kansuji(m[5])::text || '日', ''));
  end loop;
  for m in select distinct regexp_matches(s, ${q(WAREKI)}, 'g') loop
    s := replace(s, m[1] || m[2] || '年',
      ((case m[1] ${nen} end) + (case m[2] when '元' then 1 else m[2]::int end))::text || '年');
  end loop;
  for m in select x from (select distinct regexp_matches(s, ${q(WAREKI_ABC)}, 'g') as x) t order by length(x[1]) desc loop
    s := replace(s, m[1], ((case m[2] ${abc.map(([k, g]) => `when ${q(k)} then ${T.gengo[g]}`).join(" ")} end) + m[3]::int)::text || '年'
      || coalesce(m[4]::int::text || '月' || m[5]::int::text || '日', ''));
  end loop;
  return s;
end $f$;

-- 本文はそのまま残し、そろえた形が元と違う文だけを末尾に足す。何度かけても同じ結果になる。
create or replace function ja_yure(t text) returns text language plpgsql immutable
set search_path to 'pg_catalog', 'public' as $f$
declare base text; bun text; k text; tasu text := '';
begin
  if t is null then return null; end if;
  base := split_part(t, E'\\n\\n' || ${q(SHIRUSHI)}, 1);
  foreach bun in array regexp_split_to_array(base, E'\\n|(?<=。)') loop
    k := ja_yure_k(bun);
    if k <> bun then tasu := tasu || E'\\n' || btrim(k); end if;
  end loop;
  if tasu = '' then return base; end if;
  return base || E'\\n\\n' || ${q(SHIRUSHI)} || tasu;
end $f$;

create or replace function ja_yure_trg() returns trigger language plpgsql
set search_path to 'pg_catalog', 'public' as $f$
begin
  new.chunk_text := ja_yure(new.chunk_text);
  return new;
end $f$;

-- 名前を a_ で始めるのは、エンジンの索引づくり（chunk_search_vector_trigger）より先に動かすため
drop trigger if exists a_ja_yure on content_chunks;
create trigger a_ja_yure before insert or update of chunk_text on content_chunks
  for each row execute function ja_yure_trg();
update content_chunks set chunk_text = chunk_text where chunk_text is distinct from ja_yure(chunk_text);
`;
}
export function removeSql(): string {
  return `drop trigger if exists a_ja_yure on content_chunks;
update content_chunks set chunk_text = split_part(chunk_text, E'\\n\\n' || ${q(SHIRUSHI)}, 1) where position(${q(SHIRUSHI)} in chunk_text) > 0;
drop function if exists ja_yure_trg(); drop function if exists ja_yure(text); drop function if exists ja_yure_k(text); drop function if exists ja_kansuji(text);
`;
}

if (import.meta.main) {
  if (process.argv.includes("--sql")) console.log(sql());
  else if (process.argv.includes("--remove")) console.log(removeSql());
  // --soroeru：標準入力の行を、そろえた形にして出す（DB の ja_yure_k と同じ結果になるかの確かめに使う）
  else if (process.argv.includes("--soroeru")) for (const l of (await Bun.stdin.text()).split("\n")) { if (l) console.log(soroeru(l)); }
  else { console.log("使い方: bun yure.ts --sql | --remove | --soroeru"); process.exit(2); }
}

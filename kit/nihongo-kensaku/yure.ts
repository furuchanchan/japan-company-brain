#!/usr/bin/env bun
// 表記ゆれをそろえる。問いの側（中継が使う soroeru）と、資料の索引の側（DB に入れる SQL）を、同じ表 yure.json から作る。
// そろえる物：全角の英数字、半角のカタカナ、人名や社名の異体字、(株) などの略、送り仮名、カタカナ語の語尾の長音、和暦。
// 資料の本文は書き換えない。そろえた形が元と違う文だけを、チャンクの末尾の「別の書き方」に足す。
//
// 使い方: bun yure.ts --sql      DB に入れる SQL を出す（関数・トリガー・今ある資料への反映）
//         bun yure.ts --remove   外す SQL を出す
import T from "./yure.json";

export const SHIRUSHI = "［別の書き方］";
const ZEN = "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９";
const HAN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const itaiji = Object.entries(T.itaiji as Record<string, string>);
const narabi = (a: string[][]) => [...a].sort((x, y) => y[0].length - x[0].length); // 長い語を先に
const hojin = narabi(T.hojin), okuri = narabi(T.okurigana);
const gengo = Object.entries(T.gengo as Record<string, number>);
const CHOON = "([ァ-ヴー]{3})ー(?![ァ-ヴー])"; // カタカナ4文字以上の語の、語尾の長音（サーバー → サーバ）
const WAREKI = `(${gengo.map(g => g[0]).join("|")})(元|[0-9]{1,2})年`;

/** 問いや文を、そろえた形にする。DB の ja_yure_k と同じ順で、同じ結果を返す。 */
export function soroeru(s: string): string {
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => HAN[ZEN.indexOf(c)]);
  s = s.replace(/[ｦ-ﾟ]+/g, m => m.normalize("NFKC"));
  for (const [a, b] of itaiji) s = s.replaceAll(a, b);
  for (const [a, b] of hojin) s = s.replaceAll(a, b);
  for (const [a, b] of okuri) s = s.replaceAll(a, b);
  s = s.replace(new RegExp(CHOON, "g"), "$1");
  s = s.replace(new RegExp(WAREKI, "g"), (_, g, n) => `${(T.gengo as any)[g] + (n === "元" ? 1 : Number(n))}年`);
  return s;
}

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
export function sql(): string {
  const rep = (pairs: string[][]) => pairs.map(([a, b]) => `  s := replace(s, ${q(a)}, ${q(b)});`).join("\n");
  return `-- 表記ゆれの索引（kit/nihongo-kensaku/yure.ts が作った SQL。手で直さず、yure.json を直して作り直す）
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
  s := regexp_replace(s, ${q(CHOON)}, '\\1', 'g');
  for m in select distinct regexp_matches(s, ${q(WAREKI)}, 'g') loop
    s := replace(s, m[1] || m[2] || '年',
      ((case m[1] ${gengo.map(([g, y]) => `when ${q(g)} then ${y}`).join(" ")} end) + (case m[2] when '元' then 1 else m[2]::int end))::text || '年');
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
drop function if exists ja_yure_trg(); drop function if exists ja_yure(text); drop function if exists ja_yure_k(text);
`;
}

if (import.meta.main) {
  if (process.argv.includes("--sql")) console.log(sql());
  else if (process.argv.includes("--remove")) console.log(removeSql());
  else { console.log("使い方: bun yure.ts --sql | --remove"); process.exit(2); }
}

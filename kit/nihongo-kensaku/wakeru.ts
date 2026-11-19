// 日本語の質問文を、検索の語に分ける。追加の部品は使わない（Bun・Node に入っている Intl.Segmenter だけ）。
// 確かめた形（2026-11-18、100,000ページ・4つの質問）：そのまま投げると4問とも0件、語に分けると4問とも上位に正解。
const seg = new Intl.Segmenter("ja", { granularity: "word" });
const HIRAGANA = /^[぀-ゟ]+$/;

/** 文として書かれた日本語か。空白で区切った語の並び（例「見積 承認」）と英語は、そのまま通すので false。 */
export function bunDesuKa(q: string): boolean {
  const s = q.trim();
  return !/[\s　]/.test(s) && /[぀-ゟ]/.test(s) && /[゠-ヿ㐀-鿿]/.test(s);
}

/**
 * 質問文を語に分け、空白でつないで返す。落とす語は3つ：
 * ひらがなだけの語（助詞・語尾）、1文字の語、述語として使われた語（直後が し・す・さ・でき。例「確認しました」の確認）。
 * 述語を落とすのは、「確認」のようなどのページにもある語が入ると、絞り込めずに時間切れになるため。
 */
export function wakeru(q: string): string {
  const ws = [...seg.segment(q)].filter(x => x.isWordLike).map(x => x.segment);
  const keep = ws.filter((w, i) => w.length >= 2 && !HIRAGANA.test(w) && !/^(し|す|さ|でき)/.test(ws[i + 1] ?? ""));
  return [...new Set(keep)].join(" ");
}

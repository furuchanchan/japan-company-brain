// 使い方: bun test
import { expect, test } from "bun:test";
import { bunDesuKa, wakeru } from "./wakeru.ts";
import { soroeru } from "./yure.ts";

test("質問文を語に分ける（助詞・1文字・述語を落とす）", () => {
  expect(wakeru("値引きの承認は誰がしますか")).toBe("値引き 承認");
  expect(wakeru("瑕疵担保の条項は誰が確認しましたか")).toBe("瑕疵 担保 条項");
  expect(wakeru("熱交換器の型番はどこに確認しましたか")).toBe("熱交換 型番"); // 「器」は1文字の語として落ちる。述語の「確認」も落ちる
  expect(wakeru("見積の確認は誰がしますか")).toBe("見積 確認"); // 名詞として使われた「確認」は残る
});
test("文だけを直す。語の並び・英語・1語はそのまま通す", () => {
  expect(bunDesuKa("見積の確認は誰がしますか")).toBe(true);
  expect(bunDesuKa("見積 承認")).toBe(false);
  expect(bunDesuKa("warranty clause")).toBe(false);
  expect(bunDesuKa("瑕疵担保")).toBe(false);
});
test("表記ゆれをそろえる（索引の側の ja_yure_k と同じ結果）", () => {
  expect(soroeru("ＡＩ　Ｍｉｃｒｏｓｏｆｔ　３６５")).toBe("AI　Microsoft　365"); // 全角の英数字。全角の空白は残す
  expect(soroeru("ｲﾝﾎﾞｲｽ")).toBe("インボイス"); // 半角のカタカナ（濁点も）
  expect(soroeru("髙橋 渡邊 齋藤 斎藤")).toBe("高橋 渡辺 斉藤 斉藤"); // 異体字
  expect(soroeru("(株)青空建設 ㈱山並商事 （有）川辺")).toBe("株式会社青空建設 株式会社山並商事 有限会社川辺");
  expect(soroeru("見積もり 見積り 打ち合わせ 問い合わせ")).toBe("見積 見積 打合せ 問合せ"); // 送り仮名
  expect(soroeru("サーバー ユーザー コピー サーバールーム")).toBe("サーバ ユーザ コピー サーバールーム"); // 4文字以上の語尾の長音だけ
  expect(soroeru("令和8年4月1日 平成31年 令和元年 昭和64年")).toBe("2026年4月1日 2019年 2019年 1989年"); // 和暦
  expect(soroeru(soroeru("（株）髙橋サーバー 令和８年"))).toBe(soroeru("（株）髙橋サーバー 令和８年")); // 何度かけても同じ
});

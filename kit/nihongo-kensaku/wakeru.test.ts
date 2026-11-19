// 使い方: bun test
import { expect, test } from "bun:test";
import { bunDesuKa, wakeru } from "./wakeru.ts";

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

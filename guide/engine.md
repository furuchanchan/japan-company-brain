# エンジンの直し方と、本家の取り込み方

エンジンのコードは `engine/` に入っています。[gbrain](https://github.com/garrytan/gbrain)（MIT License、Copyright (c) 2026 Garry Tan）の v0.60.736.0 を fork した物です。

2026-11-21 の時点で、`engine/` の中身は本家の v0.60.736.0 と同じです。日本語で詰まる所は、これからこの中で直します。

## エンジンを直す

1. `engine/` の中のファイルを直す
2. `./brain up` で組み立て直す（`engine/` から組み立てます。外からコードは取ってきません）
3. まっさらな所で `./brain demo` を通す
4. PR を出す。何が日本語で詰まり、どう変わったかを、動かした結果と一緒に書く

本家でも同じ問題が起きる直しは、本家にも PR を出してください。本家に入れば、次の取り込みでこちらの差分が減ります。

## 本家の新しい版を取り込む

`engine/` は git subtree で入れています。

```bash
git subtree pull --prefix=engine https://github.com/garrytan/gbrain.git <取り込む版のタグ> --squash
./brain up
./brain demo
```

ぶつかった所は、こちらの直しを残す形で解きます。`./brain demo` が通るまでは main に入れません。

本家の版は毎回は追いません。取り込むのは、要る直しが本家に入った時と、安全に関わる直しが出た時です。

## 本家との違い

`engine/` に入れた直しは、ここに1行ずつ書きます。

- （まだありません）

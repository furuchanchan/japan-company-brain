#!/usr/bin/env python3
"""会社に今ある資料（Word・PDF・Excel・PowerPoint・テキスト）を、取り込める形（Markdown）の写しにする。

エンジンが取り込むのは Markdown だけなので、./brain sync がこの道具を先に動かす。
元のファイルは変えない。写しは元の隣に「元の名前.md」で置く（就業規則.docx → 就業規則.docx.md）。
元を直せば写しを作り直し、元を消せば写しも消す。変換はこのサーバーの中で行い、外へは何も送らない。

使い方: henkan.py <資料のフォルダ> [--shitami]     （--shitami は下見。何も書かない）
"""
import logging
import os
import re
import sys
import unicodedata

logging.getLogger("pdfminer").setLevel(logging.ERROR)  # 字の形の情報が欠けた PDF で出る警告。文字は取り出せている

SHIRUSHI = "henkan: japan-company-brain"  # この道具が作った写しの印。印の無い .md には触れない
KATACHI = {".docx": "Word", ".pdf": "PDF", ".xlsx": "Excel", ".pptx": "PowerPoint", ".txt": "テキスト"}
SUKUNAI = 20  # 変えた後の文字がこれより少ない時は、文字の入っていない資料として入れない
OOSUGI = 2_000_000  # 変えた後がこの字数をこえる資料（何万行もある Excel など）は入れない

NIHONGO = r"[぀-ヿ㐀-鿿＀-￯、。，．・「」『』（）]"


def haba(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in "WFA" else 1 for c in s)


def tsunagu(text: str) -> str:
    """PDF は見た目の行の終わりで改行が入り、語が2行に割れる（「値引\\nき」「行\\n\\nう」）。
    日本語の字で終わり日本語の字で始まる続きの行を、1行につなぐ。見出し・箇条書き・表の行はつながない。
    空行をはさんだ行は、前の行が紙の幅いっぱいまで来ている時（折り返し）だけつなぐ。"""
    lines = text.split("\n")
    ippai = max((haba(x.strip()) for x in lines), default=0) * 0.85
    out: list[str] = []
    for line in lines:
        s = line.strip()
        i = len(out) - 1
        while i >= 0 and not out[i].strip():
            i -= 1
        prev = out[i].strip() if i >= 0 else ""
        aki = len(out) - 1 - i  # 前の行との間の空行の数
        if (
            s and prev and aki <= 1
            and (aki == 0 or haba(prev) >= ippai)
            and not re.match(r"^(#|[-*+] |\||\d+[.)．]|[・●○■□◆▼※])", s)
            and not prev.startswith(("#", "|"))
            and not prev.endswith(("。", "．", "：", ":"))
            and re.search(NIHONGO + r"$", prev)
            and re.match(NIHONGO, s)
        ):
            del out[i + 1:]
            out[i] = out[i].rstrip() + s
        else:
            out.append(line.rstrip())
    return "\n".join(out)


def yomu_txt(path: str) -> str:
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp932"):  # 日本の会社のテキストは Shift_JIS が残っている
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("文字コードが UTF-8 でも Shift_JIS でもない")


# PDF から取り出した字には、見た目は同じで別の番号の字（部首の字）が混ざる。「⼿順書」は「手順書」で探しても当たらない
BUSHU = {"⺟": "母", "⺠": "民", "⻁": "虎", "⻄": "西", "⻑": "長", "⻘": "青", "⻝": "食", "⻤": "鬼", "⻨": "麦", "⻩": "黄", "⻫": "斉", "⻭": "歯", "⻯": "竜", "⻲": "亀", "⺒": "巳", "⺬": "示", "⺭": "礻", "⻌": "辶", "⻏": "阝", "⻖": "阝"}


def bushu(text: str) -> str:
    def f(m: "re.Match[str]") -> str:
        c = m.group(0)
        return BUSHU.get(c) or unicodedata.normalize("NFKC", c)
    return re.sub(r"[\u2e80-\u2eff\u2f00-\u2fdf]", f, text)


def hyo(text: str) -> str:
    """Excel を変えた表から、空のマス（NaN・Unnamed: 3）と、空の行・空の列を落とす。
    方眼紙のように使った Excel は、ほとんどのマスが空で、そのままだと本文が空のマスで埋まる。"""
    out: list[str] = []
    block: list[list[str]] = []

    def flush() -> None:
        if not block:
            return
        rows = [r for r in block if not all(re.fullmatch(r":?-{3,}:?", c) for c in r)]
        rows = [["" if re.fullmatch(r"NaN|Unnamed: \d+", c) else c for c in r] for r in rows]
        rows = [r for r in rows if any(r)]
        n = max((len(r) for r in rows), default=0)
        keep = [i for i in range(n) if any(i < len(r) and r[i] for r in rows)]
        for k, r in enumerate(rows):
            out.append("| " + " | ".join(r[i] if i < len(r) else "" for i in keep) + " |")
            if k == 0:
                out.append("|" + " --- |" * len(keep))
        block.clear()

    for line in text.split("\n"):
        if line.startswith("|") and line.rstrip().endswith("|"):
            block.append([c.strip() for c in re.split(r"(?<!\\)\|", line.strip()[1:-1])])
        else:
            flush()
            out.append(line)
    flush()
    return "\n".join(out)


_md = None


def kaeru(path: str, ext: str) -> str:
    if ext == ".txt":
        return yomu_txt(path)
    global _md
    if _md is None:
        from markitdown import MarkItDown  # 手元で動く変換の部品（MIT）。外のサービスは呼ばない
        _md = MarkItDown(enable_plugins=False)
    text = _md.convert_local(path).text_content or ""
    if ext == ".pdf":
        return tsunagu(bushu(text))
    return hyo(text) if ext == ".xlsx" else text


def utsushi(moto: str, ext: str, body: str) -> str:
    name = os.path.basename(moto)
    title = name[: -len(ext)].replace('"', "'")
    return (
        f'---\ntitle: "{title}"\ntype: note\n{SHIRUSHI}\nmoto: "{name}"\n---\n'
        f"# {title}\n\n元のファイル：{name}（{KATACHI[ext]}）\n\n{body.strip()}\n"
    )


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    shitami = "--shitami" in sys.argv
    if len(args) != 1 or not os.path.isdir(args[0]):
        print("使い方: henkan.py <資料のフォルダ> [--shitami]", file=sys.stderr)
        return 2
    root = args[0]
    kaeta, sonomama, keshita, dame = [], 0, [], []
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if not x.startswith("."))
        for f in sorted(files):
            p = os.path.join(d, f)
            rel = os.path.relpath(p, root)
            low = f.lower()
            ext = os.path.splitext(low)[1]
            if f.startswith(("~$", ".")):  # Word が開いている間の一時ファイルなど
                continue
            if ext == ".md":
                # この道具が作った写しで、元が無くなった物は消す（取り込みの時に、ページも消える）
                m = re.match(r"^(.*)\.md$", f)
                moto = os.path.join(d, m.group(1)) if m else ""
                if os.path.splitext(moto.lower())[1] in KATACHI and not os.path.exists(moto):
                    with open(p, encoding="utf-8", errors="replace") as fh:
                        if SHIRUSHI in fh.read(400):
                            keshita.append(rel)
                            if not shitami:
                                os.remove(p)
                continue
            if ext not in KATACHI:
                continue
            out = p + ".md"
            if os.path.exists(out):
                with open(out, encoding="utf-8", errors="replace") as fh:
                    if SHIRUSHI not in fh.read(400):
                        dame.append((rel, f"同じ名前の Markdown（{f}.md）が既にある"))
                        continue
                if os.path.getmtime(out) >= os.path.getmtime(p):
                    sonomama += 1
                    continue
            try:
                body = kaeru(p, ext)
            except Exception as e:  # 壊れたファイル・パスワードつきの資料など。1件の失敗で全体を止めない
                dame.append((rel, f"読めない（{type(e).__name__}: {str(e)[:80]}）"))
                continue
            moji = re.sub(r"<!--.*?-->|!\[[^\]]*\]\([^)]*\)|\s", "", body, flags=re.S)  # 画像の印とスライド番号は数えない
            if len(moji) < SUKUNAI:
                dame.append((rel, "文字が入っていない（スキャンした PDF や、画像だけのスライドは入れられません）"))
                continue
            if len(body) > OOSUGI:
                dame.append((rel, f"大きすぎる（変えた後が {len(body):,} 字。{OOSUGI:,} 字までです）"))
                continue
            kaeta.append(rel)
            if not shitami:
                with open(out, "w", encoding="utf-8") as fh:
                    fh.write(utsushi(p, ext, body))
    katachi = "・".join(dict.fromkeys(KATACHI.values()))
    print(f"{katachi} を Markdown の写しにした：{len(kaeta)}件（前のまま {sonomama}件、元が消えたので消した {len(keshita)}件、入れられなかった {len(dame)}件）" + ("　※下見" if shitami else ""))
    for rel, why in dame:
        print(f"  入れられなかった：{rel} … {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

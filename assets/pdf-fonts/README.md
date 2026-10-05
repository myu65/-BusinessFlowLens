# 日本語PDFの代替フォント

PDFにフォントが埋め込まれていない場合に、ページ画像の日本語を表示する。Canvasの `serif` と `sans-serif` に登録し、WindowsやApp RuntimeのOSフォントに依存しない。埋め込まれたフォントの字形はPDF.jsの既存の処理で描く。

Google Fontsから2026年10月6日に取得した、未改変のNoto Sans JPとNoto Serif JP。ファイル名だけを変更した。配布条件は各OFLファイルに記載されている。

| ファイル | 元ファイル | SHA-256 |
| --- | --- | --- |
| NotoSansJP.ttf | https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf | c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f |
| NotoSerifJP.ttf | https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf | 2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc |

字体は元の非埋込みフォントと異なる場合がある。元PDFのバイト列・文字・位置は保存し、ページ画像を表示・AIへ送信する際に代替書体を使う。読み取り結果は従来どおり推定として扱う。

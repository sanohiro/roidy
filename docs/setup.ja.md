# roidy setup — 設定ガイド

`roidy setup` は Android デバイスを roidy 向けに設定します。必須ではありません — なくても roidy は動きます — が、設定しておくとターミナルからの操作が快適になります。

すべてのプロンプトはデフォルトで変更なし（Enter を押すだけでスキップ）なので、何度実行しても安全です。

## GApps 設定

Google Play Services が検出された場合のみ表示されます。

### セットアップウィザードのスキップ

GApps イメージには初回起動時に画面を占有するセットアップウィザードが含まれています。ヘッドレス環境（物理ディスプレイなし）では、ウィザードがユーザー操作を待ち続けて画面が真っ黒になります。

スキップすると `device_provisioned=1` を設定し、ウィザードのパッケージを無効化します。

CLI: `--skip-wizard`

### Play Protect の無効化

Google Play Protect は Play ストア以外からのアプリインストールをブロックします。F-Droid や `roidy install`、`adb install` によるインストールも対象です。

Play Protect が有効な場合、インストールが無言で失敗するか、Android 画面上の確認ダイアログ待ちでハングします。

CLI: `--disable-play-protect`

## 一般設定

### タイムゾーン

デバイスのタイムゾーンを設定します。デバイスのタイムゾーンデータベースに対してバリデーションされ、無効な値は再入力を求められます。

例: `Asia/Tokyo`, `America/New_York`, `Europe/London`, `UTC`

CLI: `-t` または `--timezone`

### ロケール

表示言語と地域を設定します。バリデーションなし — Android は任意のロケール文字列を受け入れ、未対応の場合はフォールバックします。

例: `ja-JP`, `en-US`, `zh-CN`, `ko-KR`, `de-DE`

CLI: `-l` または `--locale`

### 時計形式

`24` で 24 時間表記、`12` で 12 時間表記（AM/PM）。

CLI: `--clock`

### 画面タイムアウト

画面が消えるまでの秒数。`0` で無制限。

roidy で使う場合は `0`（無制限）を推奨 — そうしないとアイドル中に画面が消えて screencap が真っ黒な画像を返します。

CLI: `--screen-timeout`

### 画面ロック

`on` で有効、`off` で無効。

roidy で使う場合は `off` を推奨 — 画面ロックのロック解除操作はターミナルからは難しいためです。

CLI: `--screen-lock`

## アプリインストール

### F-Droid

[F-Droid](https://f-droid.org/) はオープンソースのアプリストアです。インストールすると `roidy install`、`roidy search`、`roidy update` で画面操作なしにアプリを管理できます。

CLI: `--app-store`

### ランチャー

デフォルトの Android ランチャーはターミナルでの操作には向いていないかもしれません。roidy は 2 つの代替を提供します：

- **KISS Launcher** — 検索ベースのミニマルなランチャー。軽量で高速。
- **Discreet Launcher** — プライバシー重視のシンプルなインターフェース。

選択したランチャーはデフォルトのホームアプリに設定され、パーミッションも自動付与されます。

CLI: `--launcher <name>`

## 非対話モード

すべてのオプションをフラグで渡せば、プロンプトなしで実行できます：

```bash
roidy setup \
  --skip-wizard --disable-play-protect \
  -t Asia/Tokyo -l ja-JP \
  --clock 24 --screen-timeout 0 --screen-lock off \
  --app-store --no-install
```

`--no-install` で F-Droid とランチャーのインストールプロンプトをスキップします。

# roidy

[English](README.md)

ターミナルベースの adb フロントエンド — Kitty グラフィックスプロトコルを使って、ターミナルから Android デバイスを表示・操作します。

各アプリは独自の仮想ディスプレイで動作するため、複数のターミナルウィンドウで同時に複数のアプリを使えます。

<p align="center">
  <img src="https://raw.githubusercontent.com/sanohiro/roidy/main/docs/screenshot-home.png" width="480" alt="ターミナルで Android ホーム画面をミラー表示" /><br />
  <em>Android ホーム画面をミラー表示 — Linux コンソール（X11/Wayland なし）で動作</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/sanohiro/roidy/main/docs/screenshot-kindle.png" width="480" alt="roidy start で Kindle を仮想ディスプレイ起動" /><br />
  <em>アプリを仮想ディスプレイで起動 — <code>roidy start kindle</code></em>
</p>

## 前提条件

### Node.js

Node.js 18 以降。

### adb (Android Debug Bridge)

```bash
# macOS
brew install android-platform-tools

# Ubuntu / Debian
sudo apt install android-tools-adb

# Windows — developer.android.com から Android SDK Platform-Tools をダウンロード
```

adb 経由でアクセスできる Android 環境が必要です。以下のいずれかが使えます：

- **物理デバイス** (USB 接続)
- **Android Studio エミュレータ (AVD)**
- **Genymotion** 等のサードパーティエミュレータ
- **Redroid** (Docker ベースのヘッドレス Android)

完全にヘッドレスな環境には **Redroid** がおすすめです — 開発・テストで使っています。
Redroid は Linux カーネルの binder ドライバに依存するため、**Linux 限定**です。
セットアップ手順は [examples/redroid-setup-12](examples/redroid-setup-12/) を参照してください。

### ターミナル

[Kitty グラフィックスプロトコル](https://sw.kovidgoyal.net/kitty/graphics-protocol/) 対応のターミナル：

- [bcon](https://github.com/sanohiro/bcon)
- [Kitty](https://sw.kovidgoyal.net/kitty/)
- [Ghostty](https://ghostty.org/)
- [WezTerm](https://wezfurlong.org/wezterm/)

### ffmpeg (任意 — `roidy cast` 用)

`roidy cast`（scrcpy 経由の低遅延ストリーミング）を使う場合のみ必要。

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg

# Windows (winget)
winget install Gyan.FFmpeg
```

## インストール

```bash
npm install -g @sanohiro/roidy
```

## 使い方

```bash
# Android 画面全体をミラー表示
roidy

# アプリを仮想ディスプレイで起動
roidy start kindle
roidy start settings

# scrcpy + ffmpeg による低遅延ストリーミング
roidy cast
roidy cast kindle

# ホストとポートを指定
roidy --host 192.168.1.100 --port 5555

# キャプチャ間隔を変更 (ms)
roidy --interval 500
```

## コマンド

```bash
roidy                    # Android 画面をミラー表示 (display 0)
roidy start <app>        # アプリを仮想ディスプレイで起動
roidy cast [app]         # 低遅延ストリーミング (scrcpy + ffmpeg)
roidy list               # インストール済みアプリ一覧
roidy search <query>     # F-Droid でアプリ検索
roidy install <pkg|apk>  # F-Droid またはローカル APK からインストール
roidy update             # F-Droid 経由で全アプリ更新
roidy uninstall <pkg>    # アプリをアンインストール (-y で確認スキップ)
roidy info               # デバイス情報を表示
roidy screenshot [file]  # スクリーンショットを保存 (エイリアス: ss)
roidy restart            # システム UI を再起動 (zygote)
roidy setup              # デバイスの対話式セットアップ
```

### roidy start

アプリを独自の仮想ディスプレイで起動します。複数のアプリを別々のターミナルウィンドウで同時に実行できます。

```bash
# 短縮エイリアスを使用
roidy start kindle
roidy start settings

# フルパッケージ名を使用
roidy start com.amazon.kindle

# 部分一致
roidy start amazon

# メインディスプレイにフォールバック
roidy start kindle --display 0
```

### roidy cast

scrcpy-server + ffmpeg による低遅延ストリーミング。ホストに `ffmpeg` のインストールが必要です。scrcpy-server は初回使用時に自動ダウンロードされます。

```bash
# display 0 をミラー表示
roidy cast

# アプリを起動してストリーミング
roidy cast kindle

# 最大 fps を指定
roidy cast --fps 15

# JPEG 出力を強制 (bcon のみ — ファイル転送モードが必要)
roidy cast --format jpeg
```

### roidy setup

Android デバイスの対話式セットアップ。roidy の動作に必須ではありませんが、タイムゾーン、ロケール等を設定するとターミナルからの操作が快適になります。

```bash
# 対話モード — 各設定を順に聞いていきます
roidy setup

# フラグで非対話実行
roidy setup -t Asia/Tokyo -l ja-JP --clock 24 --screen-timeout 0 --screen-lock off

# GApps: ウィザードスキップと Play Protect 無効化
roidy setup --skip-wizard --disable-play-protect

# アプリインストールのプロンプトをスキップ
roidy setup -t Asia/Tokyo -l ja-JP --no-install
```

セットアップ項目：
- GApps: セットアップウィザードのスキップ、Play Protect の無効化（自動検出）
- タイムゾーン、ロケール、時計形式
- 画面タイムアウト、画面ロック
- ランチャー (KISS Launcher, Discreet Launcher)
- F-Droid (オープンソースアプリストア)

各設定の詳細は [docs/setup.ja.md](docs/setup.ja.md) を参照してください。

### roidy search / install / update

F-Droid 経由でアプリを管理。画面操作不要。

```bash
# アプリを検索
roidy search browser
roidy search keyboard

# F-Droid からインストール
roidy install org.mozilla.fennec_fdroid

# ローカル APK をインストール
roidy install ./app.apk

# F-Droid アプリを全更新
roidy update

# アンインストール
roidy uninstall fennec
```

## キーバインド

| キー | アクション |
|------|------------|
| Ctrl+Q | 終了 |
| Escape | Android の戻るボタン |
| マウスクリック | タップ |
| マウス長押し | 長押し (400ms 以上) |
| マウスドラッグ | スワイプ |
| スクロールホイール | スクロール |
| 矢印キー | D-pad |
| テキスト入力 | テキスト入力 (入力した文字が Android に送信) |

## 設定

`~/.roidy/config.json` で設定をカスタマイズ：

```json
{
  "host": "localhost",
  "port": 5555,
  "interval": 1000
}
```

キーバインドは `~/.roidy/keys.json` でカスタマイズできます。

アプリエイリアスは `~/.roidy/aliases.json` で追加できます：

```json
{
  "twitter": "com.twitter.android",
  "slack": "com.Slack"
}
```

ユーザーエイリアスはビルトインを上書きします。`roidy start twitter`、`roidy install twitter` 等で使えます。

ビルトインエイリアス：

| エイリアス | パッケージ |
|------------|------------|
| kindle | com.amazon.kindle |
| play | com.android.vending |
| chrome | com.android.chrome |
| settings | com.android.settings |
| calendar | com.android.calendar |
| contacts | com.android.contacts |
| clock | com.android.deskclock |
| gallery | com.android.gallery3d |
| files | com.android.documentsui |
| fdroid | org.fdroid.fdroid |
| magisk | com.topjohnwu.magisk |
| gboard | com.google.android.inputmethod.latin |
| firefox | org.mozilla.firefox |
| fennec | org.mozilla.fennec_fdroid |

## Redroid セットアップ (Linux)

roidy は adb でアクセスできる Android 環境であれば何でも動きます — 物理デバイス、エミュレータ、コンテナ問いません。僕らは X11/Wayland なしの Linux 環境で使っているため、完全にヘッドレス（GUI なし）で動作する唯一の選択肢である **Redroid** を使っています。

Redroid には binder カーネルモジュールが必要です：

```bash
# カーネルモジュールをロード
sudo modprobe binder_linux

# 再起動後も有効にする
echo "binder_linux" | sudo tee /etc/modules-load.d/redroid.conf

# Redroid コンテナを起動
docker run -d --name redroid --privileged --restart unless-stopped \
  -p 5555:5555 \
  redroid/redroid:12.0.0_64only-latest
```

### Google Play (GApps)

Google Play Services に依存するアプリ (例: Kindle) が必要な場合は、[redroid-script](https://github.com/ayasa520/redroid-script) で GApps 対応イメージをビルドします：

```bash
git clone https://github.com/ayasa520/redroid-script.git
cd redroid-script
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 redroid.py -a 12.0.0_64only -mtg -m -c docker
```

カスタムイメージで起動：

```bash
docker run -d --name redroid --privileged --restart unless-stopped \
  -p 5555:5555 \
  redroid/redroid:12.0.0_64only_mindthegapps_magisk
```

Google Play に依存しないアプリは F-Droid で十分です — `roidy install` で画面操作なしにインストールできます。

> **注意:** 一部のアプリは `FLAG_SECURE` を設定しており、スクリーンキャプチャが真っ黒になります。これらのアプリが必要な場合はパッチで回避できます — 詳細は [examples/redroid-setup-12](examples/redroid-setup-12/) を参照してください。

僕らの環境構築手順を [examples/redroid-setup-12](examples/redroid-setup-12/) に置いています — 参考にしてください。

## ライセンス

MIT

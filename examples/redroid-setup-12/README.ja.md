# Redroid セットアップ例 (Android 12)

僕らがやったRedroidのセットアップ手順です。メンテナンスはしません。
バージョン変わったりしたら各自で調整してください。

検証: Ubuntu 24.04 aarch64, Docker CE 27.x, Redroid 12.0.0_64only, MindTheGapps, Magisk 30.6, FlagSecurePatcher r17 (2026-03-21)

```bash
##
# Android SDK Platform Tools (済みの人はスキップ)
##
sudo apt install android-tools-adb

##
# Docker インストール（済みの人はスキップ）
##
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker $USER
newgrp docker

##
# binder カーネルモジュール — Redroid に必要
##
sudo modprobe binder_linux
echo "binder_linux" | sudo tee /etc/modules-load.d/redroid.conf

##
# redroid-script で GApps + Magisk イメージをビルド
# https://github.com/ayasa520/redroid-script
#
# Google Play Services が不要なら、この手順はスキップして
# redroid/redroid:12.0.0_64only-latest をそのまま使ってください
##
git clone https://github.com/ayasa520/redroid-script.git /tmp/redroid-script
cd /tmp/redroid-script
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# MindTheGapps (-mtg) を使用。OpenGapps は 11.0.0 のみ対応
# Magisk (-m) は root アクセス用
# -> redroid/redroid:12.0.0_64only_mindthegapps_magisk
python3 redroid.py -a 12.0.0_64only -mtg -m -c docker

##
# コンテナ起動
# --restart unless-stopped: システム再起動時に自動で立ち上がる
##
docker run -d --name redroid --privileged --restart unless-stopped \
  -p 5555:5555 \
  redroid/redroid:12.0.0_64only_mindthegapps_magisk

# 起動を待つ
adb connect localhost:5555
adb wait-for-device
adb shell getprop sys.boot_completed  # "1" が出れば準備完了

##
# roidy setup — タイムゾーン、ロケール、ランチャー等の設定
# GApps のセットアップウィザードは自動検出してスキップします
##
roidy setup -t Asia/Tokyo -l ja-JP --clock 24 --screen-timeout 0 --screen-lock off
# もしくは: roidy setup (対話モード)

##
# おしまい。roidy が使えます。
##
```

## FLAG_SECURE パッチ (任意)

FLAG_SECURE が設定されたアプリは画面が真っ黒になります。そういうアプリが必要なら
`patch-flag-secure.sh` を実行してください。
> このスクリプトは `examples/redroid-setup-12/` にあります

スクリプトは Docker イメージ

`redroid/redroid:12.0.0_64only_mindthegapps_magisk`

の `services.jar` を [FlagSecurePatcher](https://github.com/j-hc/FlagSecurePatcher) でパッチして、新しい Docker イメージ

`redroid/redroid:12.0.0_64only_mindthegapps_magisk_noflag`

に焼き込みます。

```bash
./patch-flag-secure.sh
# パッチ済みイメージで再起動
docker stop redroid && docker rm redroid
docker run -d --name redroid --privileged --restart unless-stopped \
  -p 5555:5555 \
  redroid/redroid:12.0.0_64only_mindthegapps_magisk_noflag
```

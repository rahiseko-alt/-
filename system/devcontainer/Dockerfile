# publishing-studio 開発コンテナ
#
# Playwright 公式イメージ（Node.js / Chromium / 依存ライブラリ同梱）に、
# 日本語フォント・ja_JP.UTF-8 ロケール・Asia/Tokyo・Git LFS・poppler を追加する。
# 注意: タグは package.json の playwright（1.56.1）と必ず一致させる。
#       片方だけ更新すると Chromium のリビジョンがずれて起動できなくなる。
FROM mcr.microsoft.com/playwright:v1.56.1-noble

ARG DEBIAN_FRONTEND=noninteractive
ARG USERNAME=pwuser
ARG USER_UID=1000
ARG USER_GID=1000

# OS パッケージ・ロケール・タイムゾーン
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      git-lfs \
      less \
      sudo \
      locales \
      tzdata \
      fontconfig \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      poppler-utils \
 && localedef -i ja_JP -c -f UTF-8 -A /usr/share/locale/locale.alias ja_JP.UTF-8 \
 && ln -snf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime \
 && echo "Asia/Tokyo" > /etc/timezone \
 && fc-cache -f \
 && git lfs install --system --skip-repo \
 && rm -rf /var/lib/apt/lists/*

# 非 root ユーザー: ベースイメージの pwuser を使う。
# Ubuntu 24.04 には UID 1000 の ubuntu ユーザーがあり pwuser が 1001 になるため、
# ubuntu を削除して pwuser を UID/GID 1000 に揃える（Dev Container がホストの UID に再マップできるように）。
RUN set -eux; \
    if id ubuntu >/dev/null 2>&1; then userdel --remove ubuntu || true; fi; \
    if getent group ubuntu >/dev/null; then groupdel ubuntu; fi; \
    if ! id "${USERNAME}" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash "${USERNAME}"; fi; \
    groupmod --gid "${USER_GID}" "${USERNAME}"; \
    usermod --uid "${USER_UID}" --gid "${USER_GID}" --shell /bin/bash "${USERNAME}"; \
    chown -R "${USER_UID}:${USER_GID}" "/home/${USERNAME}"; \
    echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > "/etc/sudoers.d/${USERNAME}"; \
    chmod 0440 "/etc/sudoers.d/${USERNAME}"

# ベースイメージは LC_ALL=C.UTF-8 を設定しているため LC_ALL も上書きする
ENV LANG=ja_JP.UTF-8 \
    LC_ALL=ja_JP.UTF-8 \
    TZ=Asia/Tokyo

USER ${USERNAME}

#!/bin/bash

# [ITssue GCP Server Setup Script]
# 
# Description:
# GCP e2-micro (1GB RAM) 환경에서 ITssue 프로젝트를 구동하기 위한 모든 설정을 자동화합니다.
# 
# Usage:
# 1. 파일 업로드: scp scripts/setup_gcp_server.sh user@server_ip:~/
# 2. 실행 권한 부여: chmod +x setup_gcp_server.sh
# 3. 실행: ./setup_gcp_server.sh

set -e # 에러 발생 시 즉시 중단

echo "🚀 [Setup] Starting ITssue Server Setup..."

# 1. 시스템 업데이트
echo "🔄 [1/7] Updating System Packages..."
sudo apt-get update && sudo apt-get upgrade -y

# 2. 필수 패키지 설치 (curl, git, unzip)
echo "📦 [2/7] Installing Basic Tools..."
sudo apt-get install -y curl git unzip build-essential

# 3. Swap Memory 설정 (2GB) 
# 중요: 1GB RAM 서버에서 Puppeteer가 튕기지 않게 함
echo "💾 [3/7] Configuring Swap Memory (2GB)..."
if grep -q "swapfile" /etc/fstab; then
    echo "   ✅ Swap file already exists. Skipping."
else
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "   ✅ Swap created and enabled."
fi

# 4. Node.js 설치 (v20 LTS)
echo "🟢 [4/7] Installing Node.js v20..."
if command -v node &> /dev/null; then
    echo "   ✅ Node.js is already installed: $(node -v)"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "   ✅ Node.js installed: $(node -v)"
fi

# 5. Puppeteer(Chrome) 의존성 라이브러리 설치
echo "🎭 [5/7] Installing Puppeteer Dependencies..."
# Ubuntu 22.04/24.04 기준 필수 라이브러리 (t64 패키지 대응)
sudo apt-get install -y \
ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc-s1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils

# 한글 폰트 설치 (카드 뉴스 깨짐 방지)
sudo apt-get install -y fonts-noto-cjk

# 6. PM2 설치 (프로세스 관리)
echo "⚙️ [6/7] Installing PM2..."
sudo npm install -g pm2 typescript ts-node

# 7. 프로젝트 의존성 설치
echo "📚 [7/7] Installing Project Dependencies..."
if [ -f "package.json" ]; then
    npm ci
else
    echo "⚠️ package.json not found. Please run this script in the project root."
fi

echo ""
echo "✨ [Setup] Server Setup Complete!"
echo ""
echo "👉 Next Steps:"
echo "1. Create .env file: 'cp .env.example .env' and edit it."
echo "2. Build project: 'npm run build'"
echo "3. Start Daemon: 'pm2 start npm --name itssue-daemon -- run daemon'"
echo "4. Save PM2 list: 'pm2 save' then 'pm2 startup'"

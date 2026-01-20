#!/bin/bash

# [ITssue-AI 환경 설정 스크립트]
# 역할: 분석 파이프라인 시작 전, 필요한 렌더링 환경을 준비합니다.

# 0. Load Environment Variables if available
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

echo "🚀 Setting up ITssue-AI environment..."

# 1. Check Rendering Environment
if [ ! -d "$HOME/.cache/puppeteer" ]; then
    echo "🌐 Rendering browser not found. Installing..."
    npx puppeteer browsers install chrome
else
    echo "✅ Rendering environment (Puppeteer) is ready."
fi

# 2. Check for Essential Credentials
if [ -z "$CLOUD_AI_KEY" ]; then
    echo "⚠️ Warning: CLOUD_AI_KEY is not defined in .env"
fi

echo "✨ Environment Ready!"

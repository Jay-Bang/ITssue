#!/bin/bash

# [ITssue-AI Environment Setup]
# 
# [Description] 분석 파이프라인 가동 전 필요한 런타임 이미지(Puppeteer Browser) 및 환경 설정을 전처리합니다.
# 
# [Design Intent]
# - CI/CD 또는 새로운 서버 환경에서 누락된 의존성(Chrome 등)을 자동 설치하기 위함.
# - 초기 실행 시 발생할 수 있는 렌더링 에러를 사전에 방지.

# [Step 1] 환경 변수(.env) 로드
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

echo "🚀 Setting up ITssue-AI environment..."

# [Step 2] 렌더링 엔진(Puppeteer Browser) 상태 확인 및 설치
if [ ! -d "$HOME/.cache/puppeteer" ]; then
    echo "🌐 Rendering browser not found. Installing..."
    npx puppeteer browsers install chrome
else
    echo "✅ Rendering environment (Puppeteer) is ready."
fi

# [Safety] 필수 API 자격 증명 존재 여부 확인
if [ -z "$CLOUD_AI_KEY" ]; then
    echo "⚠️ Warning: CLOUD_AI_KEY is not defined in .env"
fi

echo "✨ Environment Ready!"

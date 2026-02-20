/**
 * [Admin API: Retry SNS Publish]
 * 
 * [Description] 발행에 실패했거나 누락된 SNS 게시물을 재시도하기 위한 API 프록시입니다.
 * 
 * [Design Intent]
 * - [Logic] 특정 보드 ID를 백엔드로 전달하여 재발행 오케스트레이션을 트리거합니다.
 */
import { NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
    try {
        // [Safety] 관리자 세션 유효성 검증 (Supabase JWT 확인)
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            Logger.warn('[Proxy] Unauthorized access attempt: Missing Authorization header');
            return NextResponse.json({ error: 'Unauthorized: Missing token' }, { status: 401 });
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        if (authError || !user) {
            Logger.warn('[Proxy] Unauthorized access attempt: Invalid token');
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        const body = await request.json();
        const { boardId } = body;

        // [Config] 서버 사이드 전용 환경 변수 로드 (GCP 백엔드 연동)
        const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
        const API_KEY = process.env.ADMIN_API_KEY || process.env.NEXT_PUBLIC_ADMIN_API_KEY;

        if (!API_KEY || !BACKEND_URL) {
            return NextResponse.json(
                { error: 'Server Configuration Error: API Key or Backend URL missing.' },
                { status: 500 }
            );
        }

        Logger.info(`[Proxy] Forwarding retry publish request for board ${boardId} to ${BACKEND_URL}...`);

        // [Step] GCP 백엔드 서버로 게시 재시도(Retry) 요청 위임 (Server-to-Server)
        const response = await fetch(`${BACKEND_URL}/api/retry-publish`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                boardId: boardId,
                apiKey: API_KEY
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { error: `GCP Server Error: ${response.status} ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error: unknown) {
        const err = error as Error;
        Logger.error('[Proxy Error]', err);
        return NextResponse.json(
            { error: `Proxy Failed: ${err.message}` },
            { status: 500 }
        );
    }
}

/**
 * [Admin API: Republish Proxy]
 * 
 * [Description] 브라우저(Frontend)와 GCP 백엔드 서버 간의 통신을 중계하는 API Route입니다.
 * 
 * [Design Intent]
 * - [Safety] 클라이언트 사이드에서 백엔드 API 키가 노출되는 것을 방지하기 위해 서버 사이드 프록시 수행.
 * - [Connectivity] 도메인 간 제약(CORS) 없이 백엔드 웹훅을 안전하게 호출.
 */
import { NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
    try {
        // 1. Check Authentication (Verify Supabase JWT)
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

        Logger.info(`[Proxy] Authenticated user: ${user.email}`);

        const body = await request.json();
        const { boardId } = body;

        // Server-side Environment Variables (Set these in Vercel)
        const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL; // e.g. http://34.x.x.x:3000
        const API_KEY = process.env.ADMIN_API_KEY || process.env.NEXT_PUBLIC_ADMIN_API_KEY;

        if (!API_KEY) {
            return NextResponse.json(
                { error: 'Server Configuration Error: ADMIN_API_KEY is missing.' },
                { status: 500 }
            );
        }


        if (!BACKEND_URL) {
            return NextResponse.json(
                { error: 'Server Configuration Error: BACKEND_URL is missing.' },
                { status: 500 }
            );
        }

        Logger.info(`[Proxy] Forwarding republish request for ${boardId} to ${BACKEND_URL}...`);

        // Forward the request to the HTTP GCP Server
        // Server-to-Server communication allows HTTP even if the Frontend is HTTPS
        const response = await fetch(`${BACKEND_URL}/api/republish`, {
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

    } catch (error: any) {
        Logger.error('[Proxy Error]', error);
        return NextResponse.json(
            { error: `Proxy Failed: ${error.message}` },
            { status: 500 }
        );
    }
}

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

        const body = await request.json();
        const { itemId } = body;

        // Server-side Environment Variables (Set these in Vercel)
        const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
        const API_KEY = process.env.ADMIN_API_KEY || process.env.NEXT_PUBLIC_ADMIN_API_KEY;

        if (!API_KEY || !BACKEND_URL) {
            return NextResponse.json(
                { error: 'Server Configuration Error: API Key or Backend URL missing.' },
                { status: 500 }
            );
        }

        Logger.info(`[Proxy] Forwarding regenerate request for item ${itemId} to ${BACKEND_URL}...`);

        const response = await fetch(`${BACKEND_URL}/api/regenerate-item`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                itemId: itemId,
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

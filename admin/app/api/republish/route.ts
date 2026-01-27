import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { boardId } = body;

        // Server-side Environment Variables (Set these in Vercel)
        const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL; // e.g. http://34.x.x.x:3000
        const API_KEY = process.env.ADMIN_API_KEY || process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'itssue-secret-777';

        if (!BACKEND_URL) {
            return NextResponse.json(
                { error: 'Server Configuration Error: BACKEND_URL is missing.' },
                { status: 500 }
            );
        }

        console.log(`[Proxy] Forwarding republish request for ${boardId} to ${BACKEND_URL}...`);

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
        console.error('[Proxy Error]', error);
        return NextResponse.json(
            { error: `Proxy Failed: ${error.message}` },
            { status: 500 }
        );
    }
}

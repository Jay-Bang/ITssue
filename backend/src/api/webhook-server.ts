/**
 * [Webhook Server]
 * 
 * [Description] 외부 관리 도구(Admin Panel)로부터 재발행(Republish) 요청을 수신하는 정적 엔드포인트 서버입니다.
 * 
 * [Design Intent]
 * - [Safety] API Key 인증 기반의 간단하고 가벼운 보안 계층을 제공합니다.
 * - [Performance] 무거운 분석/발행 작업을 비동기(Background)로 처리하여 클라이언트 타임아웃을 방지합니다.
 */
import * as http from 'http';
import * as dotenv from 'dotenv';
import { Logger } from '../lib/logger';
import { republishBoard } from '../lib/republish-service';

dotenv.config();

const PORT = process.env.WEBHOOK_PORT || 3000;
const API_KEY = process.env.ADMIN_API_KEY;

if (!API_KEY) {
    Logger.error('❌ Security Error: ADMIN_API_KEY is not defined in .env');
    Logger.info('   Please set a secure ADMIN_API_KEY to start the webhook server.');
    process.exit(1);
}

const server = http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/republish') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { boardId, apiKey } = data;

                // 1. Security Check
                if (apiKey !== API_KEY) {
                    Logger.warn(`⚠️  Unauthorized access attempt from ${req.socket.remoteAddress}`);
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                if (!boardId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing boardId' }));
                    return;
                }

                // 2. Trigger Republish (Async)
                Logger.info(`🚀 [Webhook] Received republish request for board: ${boardId}`);

                // We return immediately to avoid timeout, but run the task in background
                republishBoard(boardId).catch(err => {
                    Logger.error(`[Webhook] Background republish failed for ${boardId}`, err);
                });

                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Republishing started in background' }));

            } catch (err) {
                Logger.error('[Webhook] Request parsing error', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/api/sync-instagram') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { boardId, apiKey } = data;

                if (apiKey !== API_KEY) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                if (!boardId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing boardId' }));
                    return;
                }

                Logger.info(`🔄 [Webhook] Received sync request for board: ${boardId}`);

                // Import dynamically to avoid circular dependencies if any
                const { syncInstagramId } = await import('../lib/sync-service');
                const result = await syncInstagramId(boardId);

                if (result.success) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: 'Synced successfully', mediaId: result.mediaId }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No matching post found' }));
                }

            } catch (err) {
                Logger.error('[Webhook] Sync request failed', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    Logger.info(`📡 ITssue Webhook Server running on port ${PORT}`);
    Logger.info(`🔒 Security: ADMIN_API_KEY is Active`);
});

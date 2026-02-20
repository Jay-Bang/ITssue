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
import { republishBoard, retryPublishBoard } from '../lib/republish-service';
import { regenerateItemSummary } from '../lib/item-generator';

dotenv.config();

const PORT = process.env.WEBHOOK_PORT || 3000;
const API_KEY = process.env.ADMIN_API_KEY;

if (!API_KEY) {
    Logger.error('❌ Security Error: ADMIN_API_KEY is not defined in .env');
    Logger.info('   Please set a secure ADMIN_API_KEY to start the webhook server.');
    process.exit(1);
}

const server = http.createServer(async (req, res) => {
    // [Logic] CORS Headers 설정 (Admin Panel 크로스 도메인 요청 허용)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // [Logic] Preflight 요청 처리
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

                // [Safety] API Key 인증 기반의 보안 검증
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

                // [Step] 보드 재발행(Republish) 트리거 (비동기 처리)
                Logger.info(`🚀 [Webhook] Received republish request for board: ${boardId}`);

                // [Optimization] 클라이언트 타임아웃 방지를 위해 즉시 응답 반환 후 백그라운드 작업 수행
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
    } else if (req.method === 'POST' && req.url === '/api/regenerate-item') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { itemId, apiKey } = data;

                // [Safety] API Key 인증 기반의 보안 검증
                if (apiKey !== API_KEY) {
                    Logger.warn(`⚠️  Unauthorized access attempt from ${req.socket.remoteAddress}`);
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                if (!itemId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing itemId' }));
                    return;
                }

                // [Step] 개별 아이템 요약 재생성 트리거 (동기 처리로 결과 즉시 반환)
                Logger.info(`🚀 [Webhook] Received regenerate request for item: ${itemId}`);

                try {
                    const newSummary = await regenerateItemSummary(itemId);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: 'Success', summary: newSummary }));
                } catch (genError: any) {
                    Logger.error(`[Webhook] Regeneration failed`, genError);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: genError.message }));
                }

            } catch (err) {
                Logger.error('[Webhook] Request parsing error', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/api/retry-publish') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { boardId, apiKey } = data;

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

                // [Step] 미발행 채널 퍼블리싱 재시도(Retry) 트리거 (비동기 처리)
                Logger.info(`🚀 [Webhook] Received Retry Publish request for board: ${boardId}`);

                // [Optimization] 타임아웃 방지를 위한 비동기 실행
                retryPublishBoard(boardId)
                    .then(result => {
                        Logger.success(`[Webhook] Background Retry success: ${boardId}`);
                    })
                    .catch(err => {
                        Logger.error(`[Webhook] Background Retry failed for ${boardId}`, err);
                    });

                // Immediate response
                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Retry Publish started in background' }));

            } catch (err) {
                Logger.error('[Webhook] Request parsing error', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

// [Logic] 서버 리스닝 시작
server.listen(PORT, () => {
    Logger.info(`📡 ITssue Webhook Server running on port ${PORT}`);
    Logger.info(`🔒 Security: ADMIN_API_KEY is Active`);
});

import * as http from 'http';
import * as dotenv from 'dotenv';
import { Logger } from '../lib/logger';
import { republishBoard } from '../lib/republish-service';

dotenv.config();

const PORT = process.env.WEBHOOK_PORT || 3000;
const API_KEY = process.env.ADMIN_API_KEY || 'itssue-secret-777'; // Fallback for safety, but user should set it

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
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    Logger.info(`📡 ITssue Webhook Server running on port ${PORT}`);
    Logger.info(`🔒 Security: ADMIN_API_KEY is ${API_KEY === 'itssue-secret-777' ? 'using DEFAULT (Please set in .env)' : 'Active'}`);
});

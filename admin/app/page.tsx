'use client';

/**
 * [Admin Dashboard: Boards List]
 * 
 * [Description] 발행된 모든 이슈 보드들을 목록 형태로 조회하고 관리할 수 있는 메인 대시보드 페이지입니다.
 */

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { Logger } from '@/lib/logger';
import { StatsCard } from '@/components/ui/StatsCard';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface Board {
  id: string;
  board_type: string;
  target_date: string;
  created_at: string;
  instagram_post_id: string | null;
  status: string;
  metadata?: { instagram_permalink?: string;[key: string]: unknown };
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoards();
  }, []);

  const stats = useMemo(() => {
    if (boards.length === 0) return { total: 0, successRate: 0, lastRun: '-' };
    const published = boards.filter(b => b.instagram_post_id).length;
    const successRate = Math.round((published / boards.length) * 100);
    const lastRun = boards[0].target_date;
    return { total: boards.length, successRate, lastRun };
  }, [boards]);

  async function fetchBoards() {
    Logger.info('Fetching boards...');
    try {
      const { data, error: fetchError } = await supabase
        .from('issue_boards')
        .select('id, board_type, target_date, created_at, instagram_post_id, metadata, status')
        .order('target_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      setBoards(data || []);
    } catch (e: unknown) {
      const err = e as Error;
      Logger.error('Error fetching boards:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync(boardId: string) {
    if (!confirm('Instagram Graph API에서 최신 게시물을 찾아 ID를 동기화하시겠습니까?')) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';
      const res = await fetch(`${apiUrl}/api/sync-instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardId,
          apiKey: process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'itssue-admin-secure-key-2026'
        })
      });

      const data = await res.json();
      if (res.ok) {
        alert(`✅ 성공: ${data.mediaId}`);
        fetchBoards();
      } else {
        alert(`❌ 실패: ${data.error}`);
      }
    } catch (e: unknown) {
      const err = e as Error;
      alert(`시스템 에러: ${err.message}`);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-accent-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-muted">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">Dashboard Overview</h1>
          <p className="text-sm sm:text-base text-muted font-medium">Monitoring ITssue-AI autonomous pipeline status.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchBoards} className="flex-1 sm:flex-none">Refresh</Button>
          <Button size="sm" className="flex-1 sm:flex-none">Create Board</Button>
        </div>
      </header>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        <StatsCard
          title="Total Reports"
          value={stats.total}
          icon="📅"
          color="indigo"
        />
        <StatsCard
          title="Publish Success"
          value={`${stats.successRate}%`}
          icon="🚀"
          color="emerald"
          trend={{ value: 'Active', isUp: true }}
        />
        <StatsCard
          title="Last Lifecycle"
          value={stats.lastRun}
          icon="🕒"
          color="amber"
        />
      </div>

      {/* Main Content: Boards Table */}
      <Card title="Board Distribution Analysis" description="Latest 50 automated issue boards and their statuses.">
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted/5 border-y border-muted/10">
                <th className="px-6 py-4 text-xs font-black text-muted uppercase tracking-widest">Board Name</th>
                <th className="px-6 py-4 text-xs font-black text-muted uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-xs font-black text-muted uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-xs font-black text-muted uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-muted/10">
              {boards.map((board) => (
                <tr key={board.id} className="hover:bg-muted/5 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-bold text-foreground">{board.board_type} Report</div>
                    <div className="text-xs text-muted font-medium">{board.target_date}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 bg-accent-primary/10 text-accent-primary rounded-full text-xs font-black">
                      AUTO
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${board.status === 'published' ? 'bg-accent-secondary animate-pulse' : 'bg-accent-orange'}`} />
                      <span className="text-sm font-bold text-foreground capitalize">{board.status}</span>
                      {board.instagram_post_id && (
                        <a
                          href={board.metadata?.instagram_permalink as string || `https://www.instagram.com/p/${board.instagram_post_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted hover:text-accent-primary transition-colors ml-1"
                        >
                          ↗
                        </a>
                      )}
                      {!board.instagram_post_id && (
                        <button
                          onClick={() => handleSync(board.id)}
                          className="text-muted hover:text-accent-secondary transition-colors"
                        >
                          ↻
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/boards/${board.id}`}>
                      <Button variant="ghost" size="sm" className="font-black">Manage →</Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {boards.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-20 text-center">
                    <p className="text-muted font-bold">No boards discovered yet.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

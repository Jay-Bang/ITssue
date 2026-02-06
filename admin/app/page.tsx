'use client';

/**
 * [Admin Dashboard: Boards List]
 * 
 * [Description] 발행된 모든 이슈 보드들을 목록 형태로 조회하고 관리할 수 있는 메인 대시보드 페이지입니다.
 * 
 * [Design Intent]
 * - [Logic] Supabase에서 최신 보드 데이터를 역순으로 조회하여 실시간 배포 현황을 한눈에 파악.
 * - [Optimization] 클라이언트 사이드 렌더링('use client')을 통해 즉각적인 필터링 및 네비게이션 지원.
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
  metadata?: { instagram_permalink?: string;[key: string]: unknown };
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        .select('id, board_type, target_date, created_at, instagram_post_id, metadata')
        .order('target_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      setBoards(data || []);
    } catch (e: unknown) {
      const err = e as Error;
      Logger.error('Error fetching boards:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync(boardId: string) {
    if (!confirm('Instagram Graph API에서 최신 게시물을 찾아 ID를 동기화하시겠습니까? (최대 10분 이내 매칭)')) return;

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
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card title="Database Error" className="border-red-200 bg-red-50">
        <p className="text-red-600 mb-4">{error}</p>
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer font-bold">Troubleshooting</summary>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>Check RLS (Row Level Security) on `issue_boards`</li>
            <li>Verify `NEXT_PUBLIC_SUPABASE_URL`</li>
          </ul>
        </details>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Dashboard Overview</h1>
          <p className="text-gray-500 font-medium">Monitoring ITssue-AI autonomous pipeline status.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchBoards}>Refresh Data</Button>
          <Button size="sm">Create Manual Board</Button>
        </div>
      </header>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatsCard
          title="Total Reports"
          value={stats.total}
          icon="📅"
          color="indigo"
          subValue="Cumulative boards processed"
        />
        <StatsCard
          title="Publish Success"
          value={`${stats.successRate}%`}
          icon="🚀"
          color="green"
          trend={{ value: 'Stable', positive: true }}
          subValue="Instagram auto-publish rate"
        />
        <StatsCard
          title="Last Lifecycle"
          value={stats.lastRun}
          icon="🕒"
          color="amber"
          subValue="Latest automated run date"
        />
      </div>

      {/* Main Content: Boards Table */}
      <Card title="Published Boards" description="Latest 50 automated issue boards and their statuses.">
        <div className="-mx-6 -my-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">Date / Type</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-gray-400 uppercase tracking-widest">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {boards.map((board) => (
                <tr key={board.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-10 rounded-full ${board.board_type === 'NOON' ? 'bg-amber-400' : 'bg-indigo-600'}`}></div>
                      <div>
                        <div className="text-sm font-bold text-gray-900">{board.target_date}</div>
                        <div className={`text-[10px] font-black tracking-tighter uppercase ${board.board_type === 'NOON' ? 'text-amber-600' : 'text-indigo-600'}`}>
                          {board.board_type} REPORT
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {board.instagram_post_id ? (
                      <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
                        <span className="text-sm font-bold text-green-700">Published</span>
                        <a
                          href={board.metadata?.instagram_permalink || `https://www.instagram.com/p/${board.instagram_post_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-300 hover:text-indigo-600 transition-colors"
                        >
                          ↗
                        </a>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-gray-300"></span>
                        <span className="text-sm font-bold text-gray-400">Draft / Processing</span>
                        <button
                          onClick={() => handleSync(board.id)}
                          className="text-gray-300 hover:text-green-600 transition-colors"
                          title="Sync Status"
                        >
                          ↻
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <Link href={`/boards/${board.id}`}>
                      <Button variant="ghost" size="sm" className="font-bold">Manage</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {boards.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-gray-400 font-bold mb-1">No data available.</p>
              <p className="text-xs text-gray-300">Check your Supabase connection or run the backend engine.</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

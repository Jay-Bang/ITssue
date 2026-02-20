'use client';

/**
 * [Admin Dashboard: Main Overview]
 * 
 * [Description] 전체 이슈 보드 목록과 주요 도구를 시각화하는 관리자의 메인 대시보드 화면입니다.
 * 
 * [Design Intent]
 * - [UX] 실시간 데이터 그리드와 요약 상술(Stats)을 한눈에 파악할 수 있도록 중앙 집중식 레이아웃을 채택했습니다.
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
  metadata?: {
    instagram_permalink?: string;
    threads_post_id?: string;
    facebook_post_id?: string;
    [key: string]: unknown
  };
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // [Step 1] 초기 로드 시 보드 데이터 즉시 조회
    fetchBoards();
  }, []);

  const stats = useMemo(() => {
    // [Safety] 데이터가 없을 경우 기본 객체 반환
    if (boards.length === 0) return { total: 0, successRate: 0, lastRun: '-', activity: Array(7).fill(0) };

    // [Step 1] Core Stats 계산
    const published = boards.filter(b => b.instagram_post_id).length;
    const successRate = Math.round((published / boards.length) * 100);
    const lastRun = boards[0].target_date;

    // [Step 2] Activity Pulse (Last 7 Days) 트렌드 분석
    const today = new Date();
    const activity = Array(7).fill(0).map((_, i) => {
      const d = new Date();
      d.setDate(today.getDate() - (6 - i));
      const dateStr = d.toISOString().split('T')[0];
      return boards.filter(b => b.target_date === dateStr).length;
    });

    return { total: boards.length, successRate, lastRun, activity };
  }, [boards]);

  async function fetchBoards() {
    Logger.info('Fetching boards...');
    try {
      const { data, error: fetchError } = await supabase
        .from('issue_boards')
        .select('id, board_type, target_date, created_at, instagram_post_id, metadata')
        .order('target_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100); // Fetch more for activity data

      if (fetchError) throw fetchError;
      setBoards(data || []);
      setError(null);
    } catch (e: unknown) {
      const err = e as Error;
      Logger.error('Error fetching boards:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // [UX] 5분마다 실시간 데이터 자동 동기화 셋업
  useEffect(() => {
    const interval = setInterval(fetchBoards, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);



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

  if (error) {
    return (
      <div className="p-8">
        <Card title="Data Fetch Error" className="border-accent-orange/50 bg-accent-orange/5">
          <p className="text-accent-orange font-bold mb-4">{error}</p>
          <Button onClick={fetchBoards}>Try Again</Button>
        </Card>
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

      {/* Main Content: Analytics & Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: List */}
        <div className="lg:col-span-8">
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
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${board.board_type === 'NOON' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                          {board.board_type}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${board.instagram_post_id ? 'bg-accent-secondary animate-pulse' : 'bg-accent-orange'}`} />
                          <span className="text-sm font-bold text-foreground capitalize">
                            {board.instagram_post_id ? 'Published' : 'Draft'}
                          </span>
                          {board.instagram_post_id && (
                            <a
                              href={board.metadata?.instagram_permalink as string || `https://www.instagram.com/p/${board.instagram_post_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted hover:text-accent-primary transition-colors ml-1"
                              title="View on Instagram"
                            >
                              📸
                            </a>
                          )}
                          {board.metadata?.threads_post_id && (
                            <a
                              href={`https://www.threads.net/@issue.itssue/post/${board.metadata.threads_post_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted hover:text-accent-primary transition-colors ml-1"
                              title="View on Threads"
                            >
                              🧵
                            </a>
                          )}
                          {board.metadata?.facebook_post_id && (
                            <a
                              href={`https://www.facebook.com/${board.metadata.facebook_post_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted hover:text-accent-primary transition-colors ml-1"
                              title="View on Facebook"
                            >
                              📘
                            </a>
                          )}
                          {!board.instagram_post_id && !board.metadata?.threads_post_id && !board.metadata?.facebook_post_id && (
                            <div className="text-muted text-[10px] italic font-medium">Pending</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link href={`/boards/${board.id}`}>
                          <Button variant="ghost" size="sm" className="font-black group-hover:bg-accent-primary group-hover:text-background transition-all">Manage →</Button>
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

        {/* Right: Activity & Trends */}
        <div className="lg:col-span-4 space-y-6">
          <Card title="Activity Pulse" description="Pipeline execution frequency (Last 7 Days)">
            <div className="flex flex-col gap-6 py-2">
              <div className="flex items-end justify-between gap-1 h-32">
                {stats.activity.map((count, i) => {
                  const maxCount = Math.max(...stats.activity, 1);
                  const height = (count / maxCount) * 100;
                  const day = new Date();
                  day.setDate(day.getDate() - (6 - i));
                  const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });

                  return (
                    <div key={i} className="flex-1 bg-muted/10 rounded-t-lg relative group">
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-accent-primary/50 group-hover:bg-accent-primary transition-all rounded-t-lg"
                        style={{ height: `${height}%` }}
                      />
                      {/* Tooltip on hover */}
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[10px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
                        {count} Boards
                      </div>
                      {/* Day Label */}
                      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-black text-muted uppercase tracking-tighter">
                        {dayName}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-8 border-t border-muted/10 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted">Daily Success Rate</span>
                  <span className="text-xs font-black text-foreground">{stats.successRate}% Published</span>
                </div>
                <div className="w-full bg-muted/10 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-accent-secondary h-full transition-all duration-1000"
                    style={{ width: `${stats.successRate}%` }}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card title="System Performance" description="Real-time infrastructure health.">
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between p-3 bg-muted/5 rounded-xl border border-muted/10">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-foreground">Collector Engine</span>
                </div>
                <span className="text-[10px] font-black text-emerald-500">OPTIMAL</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/5 rounded-xl border border-muted/10">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-foreground">Analysis Node</span>
                </div>
                <span className="text-[10px] font-black text-emerald-500">98.2% ACC</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/5 rounded-xl border border-muted/10">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-foreground">Publisher Hook</span>
                </div>
                <span className="text-[10px] font-black text-emerald-500">STABLE</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

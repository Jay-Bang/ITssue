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

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { Logger } from '@/lib/logger';

interface Board {
  id: string;
  board_type: string;
  target_date: string;
  created_at: string;
  instagram_post_id: string | null;
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBoards();
  }, []);

  async function fetchBoards() {
    Logger.info('Fetching boards...');
    const { data, error } = await supabase
      .from('issue_boards')
      .select('id, board_type, target_date, created_at, instagram_post_id')
      .order('target_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);

    // Logger.info('Supabase response:', { data, error });

    if (error) {
      Logger.error('Error fetching boards:', error);
      setError(error.message);
    } else {
      setBoards(data || []);
    }
    setLoading(false);
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
        fetchBoards(); // Refresh status
      } else {
        alert(`❌ 실패: ${data.error}`);
      }
    } catch (e: any) {
      alert(`시스템 에러: ${e.message}`);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-2xl">
          <h2 className="text-red-800 font-bold mb-2">Database Error</h2>
          <p className="text-red-600 mb-4">{error}</p>
          <details className="text-sm text-gray-600">
            <summary className="cursor-pointer font-medium">Possible solutions:</summary>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li>Check if RLS (Row Level Security) is enabled on issue_boards table</li>
              <li>Verify API key in .env.local is correct</li>
              <li>Ensure you have read permissions on the table</li>
            </ul>
          </details>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          📊 ITssue Admin Dashboard
        </h1>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {boards.map((board) => (
                  <tr key={board.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {board.target_date}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${board.board_type === 'NOON'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-blue-100 text-blue-800'
                          }`}
                      >
                        {board.board_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {board.instagram_post_id ? (
                        <div className="flex items-center space-x-2">
                          <span className="text-green-600 font-medium">✓ Published</span>
                          <a
                            href={`https://www.instagram.com/p/${board.instagram_post_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-gray-600"
                          >
                            ↗
                          </a>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <span className="text-gray-400 font-medium">Draft</span>
                          <button
                            onClick={() => handleSync(board.id)}
                            className="text-gray-400 hover:text-green-600 p-1 rounded-full hover:bg-green-50 transition-colors"
                            title="Sync Instagram ID"
                          >
                            ↻
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link
                        href={`/boards/${board.id}`}
                        className="text-indigo-600 hover:text-indigo-900 inline-block py-2 px-4 -m-2"
                      >
                        Edit →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {boards.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg shadow mt-4">
            <p className="text-gray-500 mb-2">No boards found.</p>
            <p className="text-sm text-gray-400">
              Check browser console for details or verify database has data.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

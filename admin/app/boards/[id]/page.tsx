'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useParams, useRouter } from 'next/navigation';

interface BoardItem {
    id: string;
    rank: number;
    keyword: string;
    instagram_summary: string;
    tags: string[];
}

interface Board {
    id: string;
    board_type: string;
    target_date: string;
    instagram_post_id: string | null;
}

export default function BoardDetailPage() {
    const params = useParams();
    const router = useRouter();
    const boardId = params.id as string;

    const [board, setBoard] = useState<Board | null>(null);
    const [items, setItems] = useState<BoardItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [republishing, setRepublishing] = useState(false);

    useEffect(() => {
        fetchBoardDetails();
    }, [boardId]);

    async function fetchBoardDetails() {
        // Fetch board info
        const { data: boardData } = await supabase
            .from('issue_boards')
            .select('id, board_type, target_date, instagram_post_id')
            .eq('id', boardId)
            .single();

        // Fetch board items
        const { data: itemsData } = await supabase
            .from('issue_board_items')
            .select('id, rank, keyword, instagram_summary, tags')
            .eq('board_id', boardId)
            .order('rank', { ascending: true });

        setBoard(boardData);
        setItems(itemsData || []);
        setLoading(false);
    }

    async function handleSave(itemId: string, field: 'instagram_summary' | 'tags', value: string | string[]) {
        setSaving(true);
        const { error } = await supabase
            .from('issue_board_items')
            .update({ [field]: value })
            .eq('id', itemId);

        if (error) {
            alert('Failed to save: ' + error.message);
        } else {
            // alert('✓ Saved successfully!');
            console.log('✓ Saved successfully!');
        }
        setSaving(false);
    }

    async function handleRepublish() {
        if (!confirm('정말 다시 발행하시겠습니까? 기존 인스타그램 게시물이 삭제되고 새 이미지가 업로드됩니다.')) return;

        setRepublishing(true);
        try {
            const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || `http://${window.location.hostname}:3000`;
            const apiKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'itssue-secret-777';

            const response = await fetch(`${backendUrl}/api/republish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    boardId: boardId,
                    apiKey: apiKey
                })
            });

            if (response.ok) {
                alert('🚀 재발행 요청이 서버로 전달되었습니다! 잠시 후 인스타그램과 텔레그램을 확인해 주세요.');
            } else {
                const err = await response.json();
                alert('❌ 재발행 요청 실패: ' + (err.error || '알 수 없는 에러'));
            }
        } catch (error: any) {
            alert('❌ 네트워크 에러: ' + error.message);
        } finally {
            setRepublishing(false);
        }
    }

    function updateItem(itemId: string, field: 'instagram_summary' | 'tags', value: string | string[]) {
        setItems(items.map(item =>
            item.id === itemId ? { ...item, [field]: value } : item
        ));
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-gray-600">Loading...</div>
            </div>
        );
    }

    if (!board) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-red-600">Board not found</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <button
                    onClick={() => router.push('/')}
                    className="mb-4 text-indigo-600 hover:text-indigo-800"
                >
                    ← Back to list
                </button>

                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">
                        {board.board_type} Board - {board.target_date}
                    </h1>
                    <p className="text-sm text-gray-500">
                        {board.instagram_post_id ? (
                            <span className="text-green-600">✓ Published (ID: {board.instagram_post_id})</span>
                        ) : (
                            <span className="text-gray-400">Draft</span>
                        )}
                    </p>
                </div>

                <div className="space-y-4">
                    {items.map((item) => (
                        <div key={item.id} className="bg-white rounded-lg shadow p-4 sm:p-6">
                            <div className="flex items-start gap-3 sm:gap-4">
                                <div className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-sm sm:text-base">
                                    {item.rank}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-lg font-semibold text-gray-900 mb-3 truncate">
                                        {item.keyword}
                                    </h3>

                                    {/* Summary Editor */}
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Summary
                                        </label>
                                        <textarea
                                            value={item.instagram_summary}
                                            onChange={(e) => updateItem(item.id, 'instagram_summary', e.target.value)}
                                            onBlur={(e) => handleSave(item.id, 'instagram_summary', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 text-sm sm:text-base bg-white"
                                            rows={4}
                                        />
                                    </div>

                                    {/* Tags Editor */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Tags (comma-separated)
                                        </label>
                                        <input
                                            type="text"
                                            value={item.tags.join(', ')}
                                            onChange={(e) => {
                                                const newTags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                                                updateItem(item.id, 'tags', newTags);
                                            }}
                                            onBlur={(e) => {
                                                const newTags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                                                handleSave(item.id, 'tags', newTags);
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 text-sm bg-white"
                                        />
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {item.tags.map((tag, idx) => (
                                                <span
                                                    key={idx}
                                                    className="px-2 py-1 bg-indigo-100 text-indigo-800 text-[10px] sm:text-xs rounded-full"
                                                >
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Republish Button */}
                <div className="mt-8 bg-white rounded-lg shadow p-6 text-center border-2 border-dashed border-indigo-200">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">🚀 인스타그램 재발행</h2>
                    <p className="text-sm text-gray-500 mb-6 text-balance">
                        현재 수정된 내용을 바탕으로 카드 뉴스 이미지를 다시 생성하고<br />
                        인스타그램 게시물을 교체(삭제 후 재발행)합니다.
                    </p>
                    <button
                        onClick={handleRepublish}
                        disabled={republishing}
                        className={`px-8 py-3 rounded-full font-bold text-white shadow-lg transition-all ${republishing
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 hover:scale-105 active:scale-95'
                            }`}
                    >
                        {republishing ? '🔄 발행 중...' : '지금 바로 재발행하기'}
                    </button>
                    <p className="mt-4 text-[10px] text-gray-400">
                        * 서버 사양(e2-micro)에 따라 렌더링에 약 1~2분 정도 소요될 수 있습니다.
                    </p>
                </div>

                {saving && (
                    <div className="fixed bottom-4 right-4 bg-indigo-600 text-white px-4 py-2 rounded-lg shadow-lg">
                        Saving...
                    </div>
                )}
            </div>
        </div>
    );
}

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
            alert('✓ Saved successfully!');
        }
        setSaving(false);
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

                {/* Future: Republish Button */}
                <div className="mt-8 bg-gray-100 rounded-lg p-6 text-center">
                    <button
                        disabled
                        className="px-6 py-3 bg-gray-400 text-white rounded-md cursor-not-allowed"
                    >
                        🚀 Republish (Coming Soon)
                    </button>
                    <p className="mt-2 text-sm text-gray-500">
                        Server integration required
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

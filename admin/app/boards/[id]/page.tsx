'use client';

/**
 * [Admin Dashboard: Board Detail & Editor]
 * 
 * [Description] 특정 이슈 보드의 세부 내용을 확인하고, AI 요약문이나 태그를 수동으로 수정 및 재발행할 수 있는 편집 페이지입니다.
 * 
 * [Design Intent]
 * - [Logic] 보드 아이템의 순위(Rank)와 컨텐츠를 직접 제어할 수 있는 인터페이스 제공.
 * - [Connectivity] 수동 수정 후 백엔드 웹훅을 호출하여 인스타그램에 즉시 반영하는 flow 지원.
 */

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

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
    const boardId = params.id as string;

    const [board, setBoard] = useState<Board | null>(null);
    const [items, setItems] = useState<BoardItem[]>([]);
    const [originalItems, setOriginalItems] = useState<BoardItem[]>([]);
    const [activeItemIdx, setActiveItemIdx] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [republishing, setRepublishing] = useState(false);

    const fetchBoardDetails = useCallback(async () => {
        const { data: boardData } = await supabase
            .from('issue_boards')
            .select('id, board_type, target_date, instagram_post_id')
            .eq('id', boardId)
            .single();

        const { data: itemsData } = await supabase
            .from('issue_board_items')
            .select('id, rank, keyword, instagram_summary, tags')
            .eq('board_id', boardId)
            .order('rank', { ascending: true });

        setBoard(boardData);
        setItems(itemsData || []);
        setOriginalItems(JSON.parse(JSON.stringify(itemsData || [])));
        setLoading(false);
    }, [boardId]);

    useEffect(() => {
        fetchBoardDetails();
    }, [fetchBoardDetails]);

    const activeItem = items[activeItemIdx];

    const isModified = (item: BoardItem) => {
        const original = originalItems.find(o => o.id === item.id);
        if (!original) return false;
        return item.instagram_summary !== original.instagram_summary ||
            JSON.stringify(item.tags) !== JSON.stringify(original.tags);
    };

    async function handleSaveItem(item: BoardItem) {
        setSaving(true);
        const { error } = await supabase
            .from('issue_board_items')
            .update({
                instagram_summary: item.instagram_summary,
                tags: item.tags
            })
            .eq('id', item.id);

        if (error) {
            alert('Failed to save: ' + error.message);
        } else {
            setOriginalItems(originalItems.map((o: BoardItem) => o.id === item.id ? { ...item } : o));
        }
        setSaving(false);
    }

    async function handleRepublish() {
        if (!confirm('정말 다시 발행하시겠습니까? 기존 인스타그램 게시물이 삭제되고 새 이미지가 업로드됩니다.')) return;

        setRepublishing(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch(`/api/republish`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ boardId: boardId })
            });

            if (response.ok) {
                alert('🚀 재발행 요청이 서버로 전달되었습니다!');
            } else {
                const err = await response.json();
                alert('❌ 실패: ' + (err.error || '알 수 없는 에러'));
            }
        } catch (error: unknown) {
            const err = error as Error;
            alert('❌ 네트워크 에러: ' + err.message);
        } finally {
            setRepublishing(false);
        }
    }

    function updateItem(itemId: string, field: 'instagram_summary' | 'tags', value: string | string[]) {
        setItems(items.map((item: BoardItem) =>
            item.id === itemId ? { ...item, [field]: value } : item
        ));
    }

    if (loading) return <div>Loading...</div>;
    if (!board) return <div>Board not found</div>;

    return (
        <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <Link href="/" className="text-xs sm:text-sm font-bold text-indigo-600 hover:underline mb-1 sm:mb-2 block">← Back to Dashboard</Link>
                    <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">Board Editor</h1>
                    <p className="text-sm sm:text-base text-gray-500 font-medium">{board.board_type} Report • {board.target_date}</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handleRepublish} loading={republishing} className="flex-1 sm:flex-none">
                        {republishing ? 'Republishing...' : '🚀 Republish'}
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Left: Item List and Editor */}
                <div className="lg:col-span-7 space-y-6">
                    <Card title="Issue Shards" description="Select an issue to edit its summary and tags.">
                        <div className="space-y-2">
                            {items.map((item: BoardItem, idx: number) => (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveItemIdx(idx)}
                                    className={`w-full text-left p-4 rounded-xl border transition-all ${activeItemIdx === idx
                                        ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100 shadow-sm'
                                        : 'border-gray-100 hover:border-gray-300'
                                        }`}
                                >
                                    <div className="flex items-center gap-4">
                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${activeItemIdx === idx ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                            {item.rank}
                                        </span>
                                        <span className={`font-bold ${activeItemIdx === idx ? 'text-indigo-900' : 'text-gray-700'}`}>{item.keyword}</span>
                                        {isModified(item) && <span className="ml-auto w-2 h-2 bg-amber-400 rounded-full"></span>}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </Card>

                    {activeItem && (
                        <Card title={`Editing Rank ${activeItem.rank}`} className="border-indigo-100">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Summary Content</label>
                                    <textarea
                                        value={activeItem.instagram_summary}
                                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateItem(activeItem.id, 'instagram_summary', e.target.value)}
                                        rows={6}
                                        className="w-full p-4 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium leading-relaxed"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Tags (comma separated)</label>
                                    <input
                                        type="text"
                                        value={activeItem.tags.join(', ')}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(activeItem.id, 'tags', e.target.value.split(',').map((t: string) => t.trim()))}
                                        className="w-full p-3 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-bold"
                                    />
                                </div>
                                <div className="pt-4 flex justify-end gap-3">
                                    <Button
                                        variant="primary"
                                        disabled={!isModified(activeItem)}
                                        onClick={() => handleSaveItem(activeItem)}
                                        loading={saving}
                                    >
                                        Save Changes
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>

                {/* Right: Sticky Mockup Preview */}
                <div className="lg:col-span-5 lg:sticky lg:top-8 order-first lg:order-last">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Card Preview (Mockup)</h3>
                            <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">Arcade Theme v3.1</span>
                        </div>

                        {/* The Mockup */}
                        <div className="aspect-[4/5] bg-white border-[12px] border-white shadow-2xl rounded-sm overflow-hidden flex flex-col font-sans relative">
                            {/* Header Mock */}
                            <div className="p-6 border-b-4 border-indigo-600 flex justify-between items-baseline mb-8">
                                <div className="text-4xl font-black tracking-tighter text-indigo-600">ITssue</div>
                                <div className="text-right">
                                    <div className="text-xs font-bold text-gray-400">{board.target_date}</div>
                                    <div className="text-sm font-black text-indigo-400 uppercase tracking-tighter">{board.board_type} REPORT</div>
                                </div>
                            </div>

                            {/* Main Body Mock */}
                            <div className="flex-1 px-8 py-2 flex flex-col justify-center">
                                <div className="text-xl font-black text-gray-300 tracking-widest uppercase mb-4 italic">TOP {activeItem?.rank || '?'}</div>
                                <h2 className="text-6xl font-black text-gray-900 leading-none tracking-tighter mb-6">{activeItem?.keyword || 'Keyword'}</h2>

                                <div className="flex flex-wrap gap-2 mb-8">
                                    {activeItem?.tags.slice(0, 3).map((tag: string) => (
                                        <span key={tag} className="text-xs font-black bg-indigo-600 text-white px-3 py-1 rounded-sm tracking-tighter uppercase italic">#{tag}</span>
                                    ))}
                                </div>

                                <div className="space-y-4">
                                    {activeItem?.instagram_summary.split('\n').map((line: string, i: number) => (
                                        <p key={i} className="text-2xl font-bold text-gray-700 leading-snug tracking-tight">• {line}</p>
                                    ))}
                                </div>
                            </div>

                            {/* Footer Mock */}
                            <div className="p-4 border-t-4 border-indigo-600 mt-auto bg-gray-50 flex justify-center items-center">
                                <div className="text-[10px] font-black tracking-widest text-gray-300 uppercase">ITssue Intelligence Feed</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

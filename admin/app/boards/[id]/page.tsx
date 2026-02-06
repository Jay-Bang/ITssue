'use client';

/**
 * [Admin Dashboard: Board Detail & Editor]
 * 
 * [Description] 특정 이슈 보드의 세부 내용을 확인하고 AI가 생성한 요약/태그를 수정할 수 있는 편집 페이지입니다.
 */

import { useEffect, useState, use, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { Logger } from '@/lib/logger';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface Item {
    id: string;
    keyword: string; // Map to title in UI
    instagram_summary: string; // Map to summary in UI
    tags: string[];
    rank: number;
}

interface Board {
    id: string;
    board_type: string;
    target_date: string;
    issue_board_items: Item[]; // Supabase join result
}

export default function BoardDetailPage(props: { params: Promise<{ id: string }> }) {
    const params = use(props.params);
    const [board, setBoard] = useState<Board | null>(null);
    const [loading, setLoading] = useState(true);
    const [editingItem, setEditingItem] = useState<Item | null>(null);
    const [republishing, setRepublishing] = useState(false);

    const fetchBoard = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('issue_boards')
                .select('*, issue_board_items(*)')
                .eq('id', params.id)
                .single();

            if (error) throw error;
            setBoard(data);
        } catch (error: unknown) {
            const err = error as Error;
            Logger.error('Error fetching board:', err);
        } finally {
            setLoading(false);
        }
    }, [params.id]);

    useEffect(() => {
        fetchBoard();
    }, [fetchBoard]);

    const handleSaveItem = async () => {
        if (!board || !editingItem) return;

        const updatedItems = board.issue_board_items.map(item =>
            item.id === editingItem.id ? editingItem : item
        );

        try {
            // Update individual item in issue_board_items table
            const { error } = await supabase
                .from('issue_board_items')
                .update({
                    keyword: editingItem.keyword,
                    instagram_summary: editingItem.instagram_summary,
                    tags: editingItem.tags
                })
                .eq('id', editingItem.id);

            if (error) throw error;
            setBoard({ ...board, issue_board_items: updatedItems });
            setEditingItem(null);
            alert('✅ Item saved successfully');
        } catch (error: unknown) {
            const err = error as Error;
            alert(`❌ Error saving: ${err.message}`);
        }
    };

    const handleRepublish = async () => {
        if (!confirm('변경된 내용으로 이미지를 다시 렌더링하고 인스타그램에 재발행하시겠습니까?')) return;

        setRepublishing(true);
        try {
            const res = await fetch('/api/republish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boardId: board?.id })
            });

            const data = await res.json();
            if (res.ok) {
                alert('🚀 재발행 요청 성공! 약 1-2분 뒤 인스타그램을 확인하세요.');
            } else {
                alert(`❌ 실패: ${data.error}`);
            }
        } catch (error: unknown) {
            const err = error as Error;
            alert(`❌ 네트워크 에러: ${err.message}`);
        } finally {
            setRepublishing(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-muted font-bold">Loading board data...</div>;
    if (!board) return <div className="p-8 text-center text-accent-orange font-bold">Board not found.</div>;

    const items = board.issue_board_items || [];
    const activeItem = editingItem || items[0];

    return (
        <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <Link href="/" className="text-xs sm:text-sm font-bold text-accent-primary hover:underline mb-1 sm:mb-2 block">← Back to Dashboard</Link>
                    <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">Board Editor</h1>
                    <p className="text-sm sm:text-base text-muted font-medium uppercase">{board.board_type} Report • {board.target_date}</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handleRepublish} loading={republishing} className="flex-1 sm:flex-none">
                        {republishing ? 'Republishing...' : '🚀 Republish'}
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Left: Content Editor */}
                <div className="lg:col-span-7 space-y-6">
                    <Card title="Issue Items" description="Click an item to edit its AI-generated content.">
                        <div className="space-y-3">
                            {items.map((item, idx) => (
                                <button
                                    key={item.id}
                                    onClick={() => setEditingItem(item)}
                                    className={`w-full text-left p-4 rounded-xl border transition-all ${activeItem?.id === item.id
                                        ? 'border-accent-primary bg-accent-primary/5 ring-1 ring-accent-primary'
                                        : 'border-muted/10 bg-muted/5 hover:border-muted/30'
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-black bg-foreground text-background w-6 h-6 flex items-center justify-center rounded-md">
                                            {item.rank || idx + 1}
                                        </span>
                                        <span className="font-bold text-foreground line-clamp-1">{item.keyword}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </Card>

                    {editingItem && (
                        <Card title="Edit Content" description={`Editing #${items.findIndex(i => i.id === editingItem.id) + 1} - ${editingItem.keyword}`}>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-black text-muted uppercase mb-2">Issue Title</label>
                                    <input
                                        type="text"
                                        value={editingItem.keyword}
                                        onChange={e => setEditingItem({ ...editingItem, keyword: e.target.value })}
                                        className="w-full p-3 bg-muted/5 border border-muted/20 rounded-xl focus:ring-2 focus:ring-accent-primary outline-none text-foreground font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-muted uppercase mb-2">Summary (Card Text)</label>
                                    <textarea
                                        rows={4}
                                        value={editingItem.instagram_summary}
                                        onChange={e => setEditingItem({ ...editingItem, instagram_summary: e.target.value })}
                                        className="w-full p-3 bg-muted/5 border border-muted/20 rounded-xl focus:ring-2 focus:ring-accent-primary outline-none text-foreground font-medium"
                                    />
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <Button variant="ghost" onClick={() => setEditingItem(null)}>Cancel</Button>
                                    <Button onClick={handleSaveItem}>Save Changes</Button>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>

                {/* Right: Sticky Mockup Preview */}
                <div className="lg:col-span-5 lg:sticky lg:top-8 order-first lg:order-last">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-xs font-black text-muted uppercase tracking-widest">Card Preview (Mockup)</h3>
                            <span className="px-2 py-0.5 bg-accent-orange/10 text-accent-orange text-[10px] font-black rounded uppercase">Live Sync</span>
                        </div>

                        {/* Instagram Style Card Mockup */}
                        <div className="aspect-[4/5] bg-background border border-muted/20 rounded-3xl shadow-2xl overflow-hidden relative group">
                            {/* Theme Overlay (Arcade feel) */}
                            <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/5 to-accent-secondary/5 pointer-events-none" />

                            <div className="p-10 h-full flex flex-col justify-between relative z-10">
                                <header className="border-b-4 border-foreground pb-4 flex justify-between items-start">
                                    <span className="text-4xl font-black text-accent-primary tracking-tighter">ITssue</span>
                                    <div className="text-right">
                                        <div className="text-xs font-black text-foreground">{board.target_date}</div>
                                        <div className="text-xs font-black text-accent-secondary uppercase">{board.board_type} REPORT</div>
                                    </div>
                                </header>

                                <main className="flex-1 flex flex-col justify-center py-8">
                                    <div className="mb-6 flex gap-2">
                                        <span className="bg-accent-primary text-background text-sm font-black px-3 py-1 rounded">HOT ISSUE</span>
                                    </div>
                                    <h2 className="text-5xl font-black text-foreground leading-[0.9] tracking-tight mb-8">
                                        {activeItem?.keyword || "Loading..."}
                                    </h2>
                                    <div className="space-y-4">
                                        {activeItem?.instagram_summary.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => (
                                            <p key={i} className="text-xl font-bold text-foreground leading-tight bg-card-bg/50 backdrop-blur-sm p-2 rounded border-l-4 border-accent-primary">
                                                {line}
                                            </p>
                                        )) || <div className="h-32 bg-muted/10 rounded animate-pulse" />}
                                    </div>
                                </main>

                                <footer className="border-t-4 border-foreground pt-4 flex justify-between items-center text-[10px] font-black text-muted tracking-widest uppercase">
                                    <div>AI AUTONOMOUS ENGINE • V2.1</div>
                                    <div className="text-accent-primary">@itssue.news</div>
                                </footer>
                            </div>
                        </div>

                        <div className="bg-muted/5 p-4 rounded-2xl border border-muted/10">
                            <p className="text-[10px] text-muted font-bold leading-relaxed italic">
                                * This is a visual approximation of the final IG report. The actual output uses specific fonts (Outfit, Space Mono) and 1080x1350 resolution.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

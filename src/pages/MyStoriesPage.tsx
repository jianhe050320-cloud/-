import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageTopBar, PhoneShell } from '../components/layout/PhoneShell';
import { SoftButton } from '../components/common/SoftButton';
import { StoryCard } from '../components/stories/StoryCard';
import { listStories } from '../services/storyService';
import { useStoriesStore } from '../store/useStoriesStore';
import { sortStoriesByRecency } from '../data/storyCategories';
import { cn } from '../lib/cn';
import type { SyncStatus } from '../types/models';

/**
 * 我的故事 —— 一个人保存自己人生经历的地方。
 *
 * 它不是 AI 文章列表、不是聊天记录、不是完成度管理器。
 * 打开它应该让人觉得：「这些是我以前讲过的事情」「这个故事还可以继续讲」。
 *
 * 结构只有三层：
 *   顶部（我的故事 / 已经留下 N 个故事 / 同步状态）
 *   → 故事卡片列表（按最近记录倒序）
 *   → 底部「继续讲一个故事」
 *
 * 这里不展示任何内部概念：不出现 MemoryEntry / seed / note / maturity / threadId。
 */
export function MyStoriesPage() {
  const navigate = useNavigate();
  const stories = useStoriesStore((state) => state.stories);
  const setStories = useStoriesStore((state) => state.setStories);
  const syncStatus = useStoriesStore((state) => state.syncStatus);

  // 拉取云端已保存的故事；离线时保留本地，不报错。
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await listStories();
        if (active) setStories(list);
      } catch {
        /* 离线：用本地 */
      }
    })();
    return () => {
      active = false;
    };
  }, [setStories]);

  /** 最近被重新讲过的故事应该回到最前面 —— 故事会随着记忆继续生长 */
  const ordered = useMemo(() => sortStoriesByRecency(stories), [stories]);

  const hasStories = ordered.length > 0;

  return (
    <PhoneShell
      footer={
        hasStories ? (
          /* 底部入口：重要，但不该抢走整页的视觉重心——所以高度降一档、去掉投影、颜色收敛 */
          <div className="shrink-0 border-t border-paper-edge/50 bg-paper/95 px-4 pb-3 pt-2.5 backdrop-blur-xl">
            <div className="mx-auto w-full max-w-[640px]">
              <SoftButton
                variant="primary"
                size="md"
                block
                onClick={() => navigate('/interview')}
                className="bg-none bg-amber-500 text-[14.5px] shadow-none hover:bg-amber-400"
              >
                继续讲一个故事
              </SoftButton>
              <p className="mt-2 text-center text-[11.5px] leading-relaxed text-ink-300">
                想起什么，就从什么开始。
              </p>
            </div>
          </div>
        ) : undefined
      }
    >
      <PageTopBar title="我的故事" subtitle={`已经留下 ${ordered.length} 个故事`} />

      {/* pb 留足底部空间：最后一张故事卡必须能完整读完，不能被底部入口压住 */}
      <div className="mx-auto w-full max-w-[640px] px-6 pb-16 pt-3">
        {/* 同步状态 + 跨设备提示：故事确实在云端，但身份与这台设备绑定，
            所以必须让用户知道「换个设备就是换个身份」，并给出搬运办法。 */}
        <div className="flex items-center justify-between gap-2">
          <SyncBar status={syncStatus} />
          {hasStories && (
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="tap shrink-0 text-[11px] text-ink-300 hover:text-ink-500"
            >
              换设备？先导出再导入 →
            </button>
          )}
        </div>

        {!hasStories ? (
          <EmptyState onStart={() => navigate('/interview')} />
        ) : (
          <>
            {/* 封面语：这一页是「我的人生」，不是一份列表 */}
            <p className="mt-8 text-[13.5px] leading-[1.9] text-ink-500">
              我把那些值得记住的时刻，留在这里。
            </p>
            <div className="mt-6 h-px w-full bg-paper-edge/60" />
            {/* 目录：编号按当前顺序给，打开就是 01 / 02 / 03 */}
            <div>
              {ordered.map((story, index) => (
                <StoryCard
                  key={story.id}
                  no={index + 1}
                  story={story}
                  onClick={() => navigate(`/story/${story.id}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </PhoneShell>
  );
}

/**
 * 同步状态文案。
 *
 * 两件事都要说清楚，缺一个都会误导用户：
 *   1. 故事确实写进了云端（不是只存在这台设备上）；
 *   2. 但当前是**游客身份**，云端那行数据与这个浏览器绑定——
 *      换手机、换浏览器、在微信里打开，都会被当成一台新设备，看到的是另一份「我的故事」。
 * 之前只写「已同步到云端」，用户会以为换个设备就能看到，这正是"故事看起来丢了"的来源。
 */
const SYNC_TEXT: Record<SyncStatus, string> = {
  idle: '已同步到云端 · 这台设备',
  syncing: '正在同步',
  synced: '已同步到云端 · 这台设备',
  offline: '离线暂存中',
};

/** 同步状态只是一条很轻的提示：让人知道「我的故事有没有保存好」，不抢视线。 */
function SyncBar({ status }: { status: SyncStatus }) {
  const offline = status === 'offline';
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 px-0.5 text-[11px] tracking-wide',
        offline ? 'text-amber-700' : 'text-ink-300',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          offline ? 'bg-amber-500' : status === 'syncing' ? 'bg-clay/60' : 'bg-emerald-500/70',
        )}
        aria-hidden
      />
      {SYNC_TEXT[status]}
    </p>
  );
}

/**
 * 空状态：一本还没有开始写的杂志。
 *
 * 不用圆角卡片 + 图标徽章（那是后台空态的样子），也不用 emoji——
 * 只留一道细线、大量留白和一句邀请，让它像扉页。
 */
function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="pb-8 pt-16 text-center">
      <div className="mx-auto h-px w-14 bg-paper-edge" />
      <p className="mt-9 text-[15px] leading-[1.95] text-ink-700">
        这里会放下你想留下的人生片段。
      </p>
      <p className="mt-7 text-[13.5px] font-medium text-ink-500">想起一件事了吗？</p>
      <p className="mt-2 text-[13px] leading-[1.95] text-ink-300">
        不用准备，也不用讲完整。
        <br />
        想到哪里，就从哪里说起。
      </p>
      <div className="mx-auto mt-10 max-w-[236px]">
        <SoftButton variant="primary" size="lg" block onClick={onStart}>
          开始讲一件事
        </SoftButton>
      </div>
    </div>
  );
}

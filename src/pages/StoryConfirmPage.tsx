import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageTopBar, PhoneShell } from '../components/layout/PhoneShell';
import { SoftButton } from '../components/common/SoftButton';
import { INTERVIEWER } from '../data/seed';
import { findTopic } from '../data/topics';
import { listStories, saveStory, updateStory } from '../services/storyService';
import { displayContent, resolveSaveContent } from '../services/storyContent';
import { useStoriesStore } from '../store/useStoriesStore';
import { useInterviewStore } from '../store/useInterviewStore';
import { cn } from '../lib/cn';
import type { Story } from '../types/models';
import type { StoryOutline, StoryDraft, StoryMemory, StoryKind } from '../types/interview';

/**
 * 保存确认页：不是「AI 给你改好了一份」的终审，而是一次「我听到的是不是这样」的对看。
 *
 * 两个来源都能进这里：
 *   - 采访刚结束（/story/:sessionId）：草稿在 useInterviewStore.draft，确认即落库（插入）。
 *   - 从「我的故事」点开已保存的故事（/story/:id）：确认即回写（更新）。
 *
 * 三个区块各司其职，且互相隔离：
 *   1. 我听到的是 —— 来自事实地图 / 记忆，把「被听见的东西」用自然语言还给用户。
 *   2. AI 整理版 —— 仅供参考，不是定稿；用户没有被强迫接受。
 *   3. 你的版本 —— 真正会被保存的内容，用户可自由改写。
 * aiDraft（AI 原稿）与 content（你的版本）在落库时分别存储，逻辑上不互相覆盖。
 */
export function StoryConfirmPage() {
  /*
   * 路由里这个参数叫 :id（/story/:id/confirm），之前这里读的是 storyId，
   * 导致「从我的故事点进确认页」拿不到 id、只会看到「没有找到这段讲述」。
   * 这里两种写法都兼容。
   */
  const params = useParams();
  const storyId = params.id ?? params.storyId ?? '';
  const navigate = useNavigate();

  const liveDraft = useInterviewStore((state) => state.draft);
  const storeThreadId = useInterviewStore((state) => state.threadId);
  const storeTopicId = useInterviewStore((state) => state.topicId);
  const storeTopicLabel = useInterviewStore((state) => state.topicLabel);
  const storeMemory = useInterviewStore((state) => state.memory);
  const markSaved = useInterviewStore((state) => state.markSaved);

  const [existing, setExisting] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  /** 用户是否真的动过正文/标题（只看编辑动作，不比对字符串） */
  const [userTouched, setUserTouched] = useState(false);
  const [showHeard, setShowHeard] = useState(false);
  /** 默认以「阅读」呈现，用户主动点编辑才进入改写 */
  const [editing, setEditing] = useState(false);
  /** 用户主动点了「用刚整理出来的这一版」 */
  const [adoptedAi, setAdoptedAi] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const syncedRef = useRef('');

  // 数据来源：先看是不是已保存的故事，否则用会话草稿
  useEffect(() => {
    let active = true;
    void (async () => {
      let found: Story | null = null;
      const local = useStoriesStore.getState().stories.find((story) => story.id === storyId);
      if (local) found = local;
      else {
        try {
          const list = await listStories();
          found = list.find((story) => story.id === storyId) ?? null;
        } catch {
          /* 离线：只看本地 */
        }
      }
      if (!active) return;
      if (found) {
        setExisting(found);
        setLoading(false);
        return;
      }
      const draft = useInterviewStore.getState().draft;
      if (draft) {
        setExisting(null);
        setLoading(false);
      } else {
        setNotFound(true);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [storyId]);

  // 底层内容变化时同步可编辑字段（初始化 / 重新整理）
  useEffect(() => {
    const key = existing
      ? `e:${existing.id}:${existing.updatedAt}`
      : liveDraft
        ? `d:${liveDraft.title}:${(liveDraft.content ?? '').length}`
        : '';
    if (key && key !== syncedRef.current) {
      syncedRef.current = key;
      // 用户版本优先：只有「不是用户版本」时才允许被新的整理稿替换
      const userOwned = existing?.contentSource === 'user';
      if (existing && liveDraft) {
        // 继续讲之后重新整理（故事生长）：用户写过的版本绝不被覆盖
        setTitle(liveDraft.title || existing.title);
        if (!userOwned) setContent(liveDraft.content ?? '');
      } else if (existing) {
        setTitle(existing.title);
        // 打开已保存的故事：给用户看的就是最终会被读到的那一版
        setContent(displayContent(existing));
      } else if (liveDraft) {
        setTitle(liveDraft.title);
        setContent(liveDraft.content ?? '');
      }
      setUserTouched(false);
      setAdoptedAi(false);
    }
  }, [existing, liveDraft]);

  const isExisting = !!existing;
  /**
   * 继续讲之后重新整理：原故事还在，同时刚生成了一版新的整理稿。
   * 这是「故事生长」的场景——新内容要长回原来的 Story，而不是另建一条。
   */
  const reorganized = isExisting && !!liveDraft;

  // AI 整理版：有刚整理出来的稿子就用新的，否则沿用原故事里留着的 AI 原稿
  const aiDraft: string | null = liveDraft?.content ?? (isExisting ? (existing?.aiDraft ?? null) : null);
  const outline: StoryOutline | undefined = liveDraft?.outline ?? (isExisting ? existing?.outline : undefined);
  /**
   * 事实来源优先级：用户真实说过的话 > 记忆 > 上一版 AI 文章。
   * 继续讲之后最新的一版记忆 = 原故事记忆 + 新的讲述，所以这里用 storeMemory。
   */
  const memory: StoryMemory | null = liveDraft
    ? storeMemory
    : isExisting
      ? (existing?.memory ?? null)
      : storeMemory;
  const topic = isExisting ? existing?.topic : storeTopicId;
  const topicLabel = isExisting
    ? existing && findTopic(existing.topic)?.label
    : storeTopicLabel || findTopic(storeTopicId)?.label;
  const kind: StoryKind | undefined = liveDraft?.kind ?? (isExisting ? existing?.kind : undefined);
  const threadId = (isExisting ? existing?.threadId : '') || storeThreadId;
  const sourceMessageIds = liveDraft?.sourceMessageIds ?? (isExisting ? existing?.sourceMessageIds : undefined);
  /*
   * 注意：这里**故意不再有** userEdited 这类判断。
   * 「用户是否编辑过」只能由 contentSource 这个显式状态决定；
   * 拿 content 和 aiDraft 比字符串会误判——用户完全可能把自己的版本改回和 AI 一样。
   */

  const heard = useMemo(() => buildHeard(outline, memory), [outline, memory]);

  /** 正文按段落阅读（与详情页同一套排版） */
  const paragraphs = useMemo(
    () =>
      content
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean),
    [content],
  );

  async function handleConfirm() {
    if (regenerating) return;
    setSaving(true);
    try {
      // 只有「用户真的动过编辑区」才算用户版本；不比对字符串
      const saved = resolveSaveContent({
        aiDraft: aiDraft ?? '',
        userContent: content,
        userTouched,
        previousSource: existing?.contentSource,
        adoptedAiDraft: adoptedAi,
      });

      if (isExisting && existing) {
        await updateStory(existing.id, {
          title: title.trim() || existing.title || '未命名的故事',
          content: saved.content,
          contentSource: saved.contentSource,
          aiDraft: aiDraft ?? undefined,
          kind,
          threadId,
          sourceMessageIds,
          outline: outline ?? null,
          memory: memory ?? null,
          /*
           * 「关于你」只由原始语料生成；这里只负责把它随故事一起存下来。
           * 关键：重新整理时如果这一轮**没生成出**「关于你」（生成失败/被闸门全部拦下），
           * 绝不能用空数组把以前已经生成好的那一份覆盖掉——旧数据比空数据有价值得多。
           */
          discoveries:
            liveDraft?.discoveries && liveDraft.discoveries.length > 0
              ? liveDraft.discoveries
              : (existing.discoveries ?? []),
          // 回到原始采访语料的钥匙（继续讲之后会有新 session，threadId 才是完整语料）
          sessionId: existing.sessionId ?? (useInterviewStore.getState().sessionId || null),
        });
        navigate(`/story/${existing.id}`);
      } else if (liveDraft) {
        const created = await saveStory({
          title: title.trim() || liveDraft.title || '未命名的故事',
          topic: topic ?? 'random_question',
          content: saved.content,
          contentSource: saved.contentSource,
          kind: kind ?? 'fragment',
          threadId,
          aiDraft: aiDraft ?? undefined,
          sourceMessageIds,
          outline,
          memory,
          // 私享版：故事 + 故事之外的「关于你」（只由原始采访语料生成）
          discoveries: liveDraft.discoveries ?? [],
          // 回到原始采访语料的钥匙
          sessionId: useInterviewStore.getState().sessionId || null,
        });
        markSaved();
        // 保存完直接读到最终版本：讲 → 整理 → 看见自己的故事
        navigate(`/story/${created.id}`);
      } else {
        navigate('/stories');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    if (isExisting || !liveDraft) return;
    setRegenerating(true);
    try {
      await useInterviewStore.getState().generateDraft();
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return (
      <PhoneShell>
        <PageTopBar title="整理中" onBack={() => navigate(-1)} />
        <div className="px-4 py-10 text-center text-[14px] text-ink-300">正在把刚才讲的整理出来…</div>
      </PhoneShell>
    );
  }

  if (notFound) {
    return (
      <PhoneShell>
        <PageTopBar title="出了一点问题" onBack={() => navigate('/stories')} />
        <div className="px-4 py-10 text-center text-[14px] text-ink-500">
          没有找到这段讲述，先回到「我的故事」看看。
        </div>
      </PhoneShell>
    );
  }

  return (
    <PhoneShell hideTabBar>
      <PageTopBar
        title="你的故事"
        subtitle="我把刚才你讲的整理成了一页"
        onBack={() => navigate(-1)}
      />

      <div className="mx-auto w-full max-w-[640px] px-6 pb-28 pt-4">
        {/* 次级区域：刚才你讲到的片段。默认收起，只作为核对用，不做成汇报卡片 */}
        {heard.length > 0 && (
          <section className="mb-5 border-b border-paper-edge/50 pb-4">
            <button
              type="button"
              onClick={() => setShowHeard((value) => !value)}
              className="tap flex w-full items-center justify-between text-left"
            >
              <span className="text-[12px] tracking-[0.08em] text-ink-300">刚才你讲到的</span>
              <span className="text-[12px] text-ink-300">{showHeard ? '收起' : '展开'}</span>
            </button>
            {showHeard && (
              <>
                <ul className="mt-2.5 space-y-2">
                  {heard.map((item, index) => (
                    <li
                      key={index}
                      className="flex gap-2 text-[13.5px] leading-relaxed text-ink-500"
                    >
                      <span className="text-ink-300" aria-hidden>
                        ·
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-300">
                  你讲过的片段、人物和原话会保留在这里，方便你核对。
                </p>
              </>
            )}
          </section>
        )}

        {/* 主区域：你的故事。整理后的正文是这一页的主角 */}
        <h2 className="text-[19px] font-semibold leading-snug text-ink-900">
          {title.trim() || '一段还没有名字的故事'}
        </h2>
        {reorganized && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-300">
            这是接着你以前讲过的那一段整理的。
          </p>
        )}

        {editing ? (
          <div className="mt-4 space-y-3">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setUserTouched(true);
              }}
              placeholder="给这段起个名字（可留空）"
              className="w-full rounded-2xl border border-paper-edge/70 bg-paper-warm px-3.5 py-3 text-[15px] font-medium text-ink-900 placeholder:text-ink-300"
            />
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setUserTouched(true);
                // 一旦自己动手改，就不再算「采用 AI 版」
                setAdoptedAi(false);
              }}
              rows={16}
              placeholder="这是你愿意留下的样子。"
              className="w-full resize-none rounded-2xl border border-paper-edge/70 bg-paper-warm px-3.5 py-3 text-[14px] leading-[1.8] text-ink-900 placeholder:text-ink-300"
            />
          </div>
        ) : (
          <article className="reader mt-4 space-y-4 text-[15px] leading-[1.85] text-ink-800">
            {paragraphs.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 8)}`}>{paragraph}</p>
            ))}
          </article>
        )}

        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="tap text-[13px] text-amber-700 hover:text-amber-600"
          >
            {editing ? '改好了' : '编辑'}
          </button>
          {/*
            重新整理后，如果这一篇是用户版本，就把选择权交还给他：
            只有他主动点，AI 整理版才会替换他的版本。
          */}
          {reorganized && aiDraft && (
            <button
              type="button"
              onClick={() => {
                setContent(aiDraft);
                setUserTouched(false);
                setAdoptedAi(true);
                setEditing(true);
              }}
              className="tap text-[13px] text-ink-300 hover:text-ink-500"
            >
              用刚整理出来的这一版
            </button>
          )}
        </div>

        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-300">
          {INTERVIEWER.honestNote}你改的只属于你，下次重新整理以你讲过的为准，不会把你的改写当成新的事实。
        </p>

        {/* 「关于你」这一轮没能生成：诚实说明，而不是让用户之后对着空栏目困惑 */}
        {liveDraft?.discoveryError && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-clay">
            「关于你」这次没能生成（{liveDraft.discoveryError}）。不影响故事本身，保存后可以在故事页点「生成关于你」再试一次。
          </p>
        )}
      </div>

      <div className="safe-bottom sticky bottom-0 z-20 border-t border-paper-edge/70 bg-paper-warm/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[640px] gap-2.5">
          <SoftButton
            variant="paper"
            block
            size="lg"
            disabled={regenerating || isExisting}
            onClick={handleRegenerate}
          >
            {regenerating ? '重新整理中…' : '换一版整理'}
          </SoftButton>
          <SoftButton
            variant="primary"
            block
            size="md"
            disabled={saving}
            className="bg-none bg-amber-500 shadow-none hover:bg-amber-400"
            onClick={handleConfirm}
          >
            {saving ? '保存中…' : '保存这个故事'}
          </SoftButton>
        </div>
      </div>
    </PhoneShell>
  );
}

/**
 * 把事实地图（outline）和用户原话（memory）翻成自然语言，给用户「被听见」的确认。
 * 只呈现真实出现过的人 / 画面 / 原话，不做文学化。
 */
function buildHeard(outline: StoryOutline | undefined, memory: StoryMemory | null): string[] {
  const items: string[] = [];
  if (outline?.core) items.push(outline.core);
  const people = outline?.people?.map((person) => person.name).filter(Boolean);
  if (people && people.length) items.push(`你讲到了：${people.join('、')}`);
  const moments = (outline?.moments ?? []).filter(Boolean);
  if (moments.length) items.push(...moments.map((moment) => `${moment}`));
  const quotes = (outline?.quotes?.filter(Boolean) ?? []).slice(0, 3);
  const memoryQuotes = (memory?.user_quotes?.filter(Boolean) ?? []).slice(-3);
  const shownQuotes = quotes.length ? quotes : memoryQuotes;
  for (const quote of shownQuotes) items.push(`你原话：「${quote}」`);
  return items;
}

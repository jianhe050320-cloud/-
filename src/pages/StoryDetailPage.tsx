import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageTopBar, PhoneShell } from '../components/layout/PhoneShell';
import { SoftButton } from '../components/common/SoftButton';
import { AboutYou } from '../components/stories/AboutYou';
import { MagazineArticle } from '../components/stories/MagazineArticle';
import { chapterNo, coverDate } from '../components/stories/StoryCard';
import { findTopic } from '../data/topics';
import { sortStoriesByRecency, storyTitle } from '../data/storyCategories';
import { listStories, updateStory, updateStoryDerived } from '../services/storyService';
import { displayContent } from '../services/storyContent';
import { buildRecallPrompts } from '../services/recallPrompts';
import { collectSourceTranscript } from '../services/storySource';
import { writeDiscoveries } from '../services/discoveryWriter';
import { writeShareStory } from '../services/shareWriter';
import { resolveEngineId } from '../services/llmGateway';
import { useStoriesStore } from '../store/useStoriesStore';
import type { Discovery } from '../types/discovery';
import type { Story } from '../types/models';

/**
 * 故事详情 —— **一本只属于自己的私人文字杂志中的一页**。
 *
 * 这一页有两个读法，来自**同一份原始采访语料**：
 *   私享版 = 故事正文 + 故事之外的「关于你」（帮用户重新看见自己）
 *   分享版 = 只有故事（可以发给朋友，不含任何对用户的分析）
 *
 * 三条不可退让的底线：
 *   1. 正文只来自 `displayContent(story)`，一个字都不改写、不重新生成、不总结；
 *   2. 「关于你」与分享版都**只吃原始采访语料**（collectSourceTranscript），
 *      拿不回语料就诚实说明，绝不退回去用 AI 写的故事正文二次编造；
 *   3. 不出现任何 AI 痕迹（AI生成 / ai_draft / 模型名 / 人格标签 / 心理诊断）。
 */

type ViewMode = 'private' | 'share';

export function StoryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  // 本地已有的故事**同步**读出来：从卡片点进来时不能先闪一下「正在打开…」。
  const storeStory = useStoriesStore((state) => state.stories.find((item) => item.id === id) ?? null);
  const upsertStory = useStoriesStore((state) => state.upsertStory);

  const [remote, setRemote] = useState<Story | null>(null);
  const [checked, setChecked] = useState(false);

  const story = storeStory ?? remote;
  const loading = !story && !checked;
  const notFound = !story && checked;

  const [view, setView] = useState<ViewMode>('private');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  /** 派生的「关于你」：本地态先行，落库走 updateStoryDerived（不动 updated_at） */
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [generatingDiscoveries, setGeneratingDiscoveries] = useState(false);
  const [discoveryNote, setDiscoveryNote] = useState<string | null>(null);

  /** 分享版正文：按需生成，生成过一次就落库 */
  const [shareDraft, setShareDraft] = useState('');
  const [generatingShare, setGeneratingShare] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  // 本地没有才去云端取（离线就当作没找到，不报错）
  useEffect(() => {
    if (storeStory) {
      setChecked(true);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const list = await listStories();
        const found = list.find((item) => item.id === id) ?? null;
        if (active) setRemote(found);
      } catch {
        /* 离线：当作没找到 */
      } finally {
        if (active) setChecked(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, storeStory]);

  // 进入/切换故事时同步可编辑字段（不主动覆盖用户正在编辑的内容）
  useEffect(() => {
    if (!story) return;
    setTitle(story.title ?? '');
    // 编辑区里就是「用户读到的那一版」：改过就是改这一版
    setContent(displayContent(story));
  }, [story?.id, story?.updatedAt]);

  // 换一篇故事时，把派生内容重置为这一篇自己的
  useEffect(() => {
    setDiscoveries(story?.discoveries ?? []);
    setShareDraft(story?.shareDraft ?? '');
    setDiscoveryNote(null);
    setShareNote(null);
    setView('private');
    setEditing(false);
  }, [story?.id]);

  const date = useMemo(() => coverDate(story?.updatedAt), [story?.updatedAt]);
  const topicLabel = useMemo(() => {
    if (!story) return '我的一个故事';
    return findTopic(story.topic)?.label ?? '我的一个故事';
  }, [story?.topic]);

  /** 章节编号：与「我的故事」目录里看到的编号一致（同一套「按最近记录」的顺序） */
  const allStories = useStoriesStore((state) => state.stories);
  const chapter = useMemo(() => {
    const index = sortStoriesByRecency(allStories).findIndex((item) => item.id === id);
    return index >= 0 ? index + 1 : undefined;
  }, [allStories, id]);

  const recalls = useMemo(() => (story ? buildRecallPrompts(story, 3) : []), [story]);

  /** 页脚档案落款：`MY STORY · 03`。很轻，只用来让人觉得自己这一页被保存了下来 */
  const pageMark = chapter ? `MY STORY · ${String(chapter).padStart(2, '0')}` : 'MY STORY';

  async function handleSave() {
    if (!story) return;
    setSaving(true);
    try {
      const next: Story = {
        ...story,
        title: title.trim() || story.title,
        content: content.trim(),
        contentSource: 'user',
        updatedAt: new Date().toISOString(),
      };
      // 用户在详情页里改过 → 从此这一篇的定稿就是用户版本，AI 不得再覆盖
      await updateStory(story.id, {
        title: next.title,
        content: next.content,
        contentSource: 'user',
      });
      upsertStory(next);
      setEditing(false);
    } catch (error) {
      console.error('[story] 保存修改失败：', error);
    } finally {
      setSaving(false);
    }
  }

  function handleContinue() {
    if (!story) return;
    // 必须携带原 Story 的 threadId：继续讲是补充原来的故事，不是另起一篇。
    navigate(
      `/interview?topic=${encodeURIComponent(story.topic)}&thread=${encodeURIComponent(story.threadId)}&story=${encodeURIComponent(story.id)}`,
    );
  }

  /** 「关于你」：只从原始采访语料生成；拿不回语料就诚实说明，绝不拿 AI 写的正文凑一份 */
  async function handleGenerateDiscoveries() {
    if (!story) return;
    setDiscoveryNote(null);
    setGeneratingDiscoveries(true);
    try {
      const source = await collectSourceTranscript(story);
      if (source.origin === 'none') {
        setDiscoveryNote('没能找回这段故事的原始讲述，所以先不生成——我不会拿 AI 写的那一版去替你分析。');
        return;
      }
      const engine = await resolveEngineId();
      const result = await writeDiscoveries({ lines: source.lines, memory: story.memory, engine });
      if (result.discoveries.length === 0) {
        setDiscoveryNote('这次没有找到站得住的发现。宁可不写，也不替你下结论。');
        return;
      }
      setDiscoveries(result.discoveries);
      await updateStoryDerived(story.id, { discoveries: result.discoveries });
      upsertStory({ ...story, discoveries: result.discoveries });
    } catch (error) {
      console.error('[story] 生成「关于你」失败：', error);
      setDiscoveryNote('生成时出了点问题，可以稍后再试。');
    } finally {
      setGeneratingDiscoveries(false);
    }
  }

  /**
   * 分享版：同一份语料的另一种编辑方式。
   * 失败时**退回到已经过质检的私享版正文**（同一份事实），而不是放行一份没通过检查的稿子。
   */
  async function handleGenerateShare() {
    if (!story) return;
    setShareNote(null);
    setGeneratingShare(true);
    try {
      const source = await collectSourceTranscript(story);
      let text = '';
      if (source.origin === 'none') {
        text = displayContent(story);
        setShareNote('没能找回这段故事的原始讲述，先给你已经读过的那一版。');
      } else {
        try {
          const engine = await resolveEngineId();
          const result = await writeShareStory({
            topicLabel,
            lines: source.lines,
            memory: story.memory,
            engine,
            fallbackTitle: storyTitle(story),
          });
          text = result.content;
        } catch (error) {
          console.error('[story] 生成分享版失败，回落到私享版正文：', error);
          text = displayContent(story);
          setShareNote('这一版整理没通过检查，先给你已经读过的那一版。');
        }
      }
      setShareDraft(text);
      await updateStoryDerived(story.id, { shareDraft: text });
      upsertStory({ ...story, shareDraft: text });
    } catch (error) {
      console.error('[story] 生成分享版失败：', error);
      setShareNote('生成时出了点问题，可以稍后再试。');
    } finally {
      setGeneratingShare(false);
    }
  }

  async function handleOpenShare() {
    setView('share');
    if (!shareDraft) await handleGenerateShare();
  }

  if (loading) {
    return (
      <PhoneShell hideTabBar>
        <PageTopBar title="我的故事" onBack={() => navigate('/stories')} />
        <div className="px-6 py-10 text-center text-[14px] text-ink-300">正在打开这一段…</div>
      </PhoneShell>
    );
  }

  if (notFound || !story) {
    return (
      <PhoneShell hideTabBar>
        <PageTopBar title="我的故事" onBack={() => navigate('/stories')} />
        <div className="px-6 py-10 text-center text-[14px] leading-relaxed text-ink-500">
          没有找到这一段。
          <br />
          它也许还没保存下来，先回到「我的故事」看看。
        </div>
      </PhoneShell>
    );
  }

  const shareMode = view === 'share';

  return (
    <PhoneShell hideTabBar>
      <PageTopBar
        /* 顶栏刻意不放标题：这一页的主角是正文。
           「编辑」是辅助功能，不该成为视觉焦点；「分享版」是同一份故事的另一个读法。 */
        title=""
        onBack={() => navigate('/stories')}
        right={
          editing ? undefined : (
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (shareMode) setView('private');
                  else void handleOpenShare();
                }}
                className="tap px-1 py-1.5 text-[12.5px] text-amber-700 hover:text-amber-600"
              >
                {shareMode ? '私享版' : '分享版'}
              </button>
              {!shareMode && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="tap px-1 py-1.5 text-[12.5px] text-ink-300 hover:text-ink-500"
                >
                  编辑
                </button>
              )}
            </div>
          )
        }
      />

      <div className="mx-auto w-full max-w-[640px] px-6 pb-16 pt-4">
        {editing ? (
          <div className="mx-auto w-full max-w-[330px] space-y-3">
            <h2 className="text-[12px] tracking-[0.08em] text-ink-300">编辑这一段</h2>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="给这段起个名字"
              className="w-full rounded-2xl border border-paper-edge/70 bg-paper-warm px-3.5 py-2.5 text-[15px] font-medium text-ink-900"
            />
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={14}
              className="w-full resize-none rounded-2xl border border-paper-edge/70 bg-paper-warm px-3.5 py-3 text-[14px] leading-[1.8] text-ink-900"
            />
            <div className="flex gap-2.5">
              <SoftButton variant="paper" size="md" block onClick={() => setEditing(false)}>
                取消
              </SoftButton>
              <SoftButton variant="primary" size="md" block disabled={saving} onClick={() => void handleSave()}>
                {saving ? '保存中…' : '保存我的版本'}
              </SoftButton>
            </div>
            <p className="text-[12px] leading-relaxed text-ink-300">
              你改的就是这一段的定稿。以后无论怎样，都不会悄悄覆盖你写下的版本。
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[330px]">
            {/*
              同一套排版，两种读法：
                私享版 → displayContent(story)（用户会一直读到的那一版）
                分享版 → shareDraft（同一份语料的另一种编辑方式，只有故事）
            */}
            <MagazineArticle
              title={storyTitle(story)}
              content={shareMode ? shareDraft : displayContent(story)}
              chapter={chapter}
              updatedAt={story.updatedAt}
              chapters={!shareMode && story.contentSource !== 'user' ? story.outline?.chapters : undefined}
              pullQuote={!shareMode && story.contentSource !== 'user' ? story.outline?.pullQuote : undefined}
              chapterIntros={
                !shareMode && story.contentSource !== 'user' && (story.outline?.chapters?.length ?? 0) >= 2
                  ? (story.outline?.chapterPlan ?? []).map((item) => item.intro)
                  : undefined
              }
              ending={!shareMode && story.contentSource !== 'user' ? story.outline?.ending : undefined}
            />

            {shareNote && (
              <p className="mt-8 text-[12px] leading-relaxed text-ink-300">{shareNote}</p>
            )}

            {shareMode && generatingShare && !shareDraft && (
              <p className="mt-8 text-[13px] leading-relaxed text-ink-300">
                正在整理可以分享的那一版…
              </p>
            )}

            {/* 私享版专属：故事之外的「关于你」 */}
            {!shareMode && (
              <AboutYou
                discoveries={discoveries}
                generating={generatingDiscoveries}
                error={discoveryNote}
                onGenerate={() => void handleGenerateDiscoveries()}
              />
            )}

            {/* 回忆入口：故事结束后的余韵，不是 CTA 卡片。分享版不出现（它是给朋友读的） */}
            {!shareMode && (
              <section className="mt-24">
                {/*
                  与「关于你」同一套左标记栏语言，但线色用浅灰（paper-edge）：
                  两个板块识别方式一致，灰度分出层级 —— 关于你（琥珀）比回忆区更「实」。
                */}
                <div className="border-l-2 border-paper-edge pl-5">
                  <h2 className="font-serif text-[17px] font-semibold leading-[1.4] text-ink-700">
                    想起来了吗？
                  </h2>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300">也许你还记得……</p>

                  {recalls.length > 0 && (
                    <ul className="mt-5">
                    {recalls.map((item) => (
                      <li key={item}>
                        {/* 整行都可以点：想说的那一条，点一下就能接着说 */}
                        <button
                          type="button"
                          onClick={handleContinue}
                          className="tap flex w-full items-baseline gap-2.5 py-2.5 text-left text-[13.5px] leading-[1.85] text-ink-500 hover:text-ink-700"
                        >
                            <span className="text-ink-300" aria-hidden>
                              ·
                            </span>
                            <span>{item}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                    <button
                      type="button"
                      onClick={handleContinue}
                      className="tap mt-8 flex w-full items-baseline justify-between gap-3 text-[14.5px] font-medium tracking-[0.02em] text-amber-700 hover:text-amber-600"
                    >
                      <span>继续讲这一段</span>
                      <span aria-hidden className="text-[15px] leading-none">
                        →
                      </span>
                    </button>
                  </div>
              </section>
            )}

            {/* 档案落款：只是视觉上的「保存感」，不是功能组件 */}
            <footer className="mt-20">
              <div className="h-px w-full bg-paper-edge/70" />
              <p className="mt-8 text-[10.5px] tracking-[0.34em] text-amber-700/75">{pageMark}</p>
              {date && <p className="mt-2 text-[10.5px] tracking-[0.2em] text-ink-300">{date}</p>}
            </footer>
          </div>
        )}
      </div>
    </PhoneShell>
  );
}

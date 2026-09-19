import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, RefreshCw, Settings as SettingsIcon, Shuffle, Sparkles } from 'lucide-react';
import { PhoneShell } from '../components/layout/PhoneShell';
import { SoftButton } from '../components/common/SoftButton';
import {
  TOPIC_CATEGORIES,
  findCategory,
  pickRandomQuestion,
  pickRandomTopic,
} from '../data/topics';
import { INTERVIEWER } from '../data/seed';
import { useStoriesStore } from '../store/useStoriesStore';
import { useInterviewStore } from '../store/useInterviewStore';
import { cn } from '../lib/cn';
import { isUuid } from '../lib/storage';
import { elapsedLabel } from '../lib/time';
import type { TopicCategoryId } from '../types/models';

export function HomePage() {
  const navigate = useNavigate();
  const stories = useStoriesStore((state) => state.stories);
  const [activeCategory, setActiveCategory] = useState<TopicCategoryId>('first');
  const [randomQuestion, setRandomQuestion] = useState<string | null>(null);

  /* 有没有一段没讲完的会话可以接着讲 */
  const lastSessionId = useInterviewStore((state) => state.sessionId);
  const lastTopicId = useInterviewStore((state) => state.topicId);
  const lastTopicLabel = useInterviewStore((state) => state.topicLabel);
  const lastMessageCount = useInterviewStore((state) => state.messages.length);
  const lastState = useInterviewStore((state) => state.state);
  const lastStartedAt = useInterviewStore((state) => state.startedAt);
  const resumable =
    isUuid(lastSessionId) &&
    Boolean(lastTopicId) &&
    lastMessageCount > 1 &&
    lastState !== 'SAVED';

  const category = findCategory(activeCategory) ?? TOPIC_CATEGORIES[0];

  const openTopic = (topicId: string) => navigate(`/interview?topic=${topicId}`);
  const startAnyTopic = () => openTopic(pickRandomTopic().id);
  const rollQuestion = () => setRandomQuestion((prev) => pickRandomQuestion(prev ?? undefined));
  const startQuestion = () => {
    if (!randomQuestion) {
      rollQuestion();
      return;
    }
    navigate(`/interview?q=${encodeURIComponent(randomQuestion)}`);
  };

  return (
    <PhoneShell>
      {/* Header */}
      <header className="safe-top px-5 pb-2 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink-900">
              {INTERVIEWER.title}
            </h1>
            <p className="mt-1 text-[13px] tracking-wide text-ink-300">{INTERVIEWER.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label="设置"
            className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-paper-edge/80 bg-paper-warm text-ink-500 shadow-soft hover:text-ink-900"
          >
            <SettingsIcon className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>

        {stories.length > 0 && (
          <button
            type="button"
            onClick={() => navigate('/stories')}
            className="tap mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[12px] font-medium text-amber-700"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            已经留下 {stories.length} 个故事
          </button>
        )}
      </header>

      {/* 接着上次讲：不要让用户重新开始一遍已经讲过的内容 */}
      {resumable && (
        <section className="px-5 pt-1">
          <button
            type="button"
            onClick={() => navigate(`/interview?topic=${lastTopicId}`)}
            className="tap flex w-full items-center justify-between gap-3 rounded-3xl border border-amber-400/50 bg-gradient-to-br from-amber-400/15 to-paper-warm p-3.5 text-left shadow-paper"
          >
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold text-ink-900">接着上次讲</span>
              <span className="mt-0.5 block truncate text-[12px] text-ink-300">
                {lastTopicLabel || '上次那个话题'}
                {lastStartedAt ? ` · ${elapsedLabel(lastStartedAt)}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-[12px] font-medium text-amber-700">继续 →</span>
          </button>
        </section>
      )}

      {/* 主行动区 */}
      <section className="relative px-5 pb-6 pt-5">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-2 h-52 w-52 -translate-x-1/2 rounded-full bg-amber-400/20 blur-3xl"
        />
        <div className="relative flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={startAnyTopic}
            className="tap animate-breathe flex h-32 w-32 flex-col items-center justify-center gap-1.5 rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700 text-white shadow-glow"
          >
            <Mic className="h-8 w-8" strokeWidth={1.7} />
            <span className="text-[13px] font-semibold tracking-wide">开始和我聊聊</span>
          </button>
          <p className="text-[12px] text-ink-300">随手点一下，我会陪你慢慢说</p>
        </div>
      </section>

      {/* 话题分类 */}
      <section className="pb-6">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-3">
          {TOPIC_CATEGORIES.map((item) => {
            const active = item.id === activeCategory;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveCategory(item.id)}
                className={cn(
                  'tap shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-amber-500/60 bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-soft'
                    : 'border-paper-edge/80 bg-paper-warm text-ink-500 hover:text-ink-900',
                )}
              >
                <span className="mr-1">{item.emoji}</span>
                {item.name}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2.5 px-5">
          {category.topics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => openTopic(topic.id)}
              className="tap group flex min-h-[86px] flex-col justify-between rounded-3xl border border-paper-edge/70 bg-paper-warm p-3.5 text-left shadow-paper transition-transform hover:-translate-y-0.5"
            >
              <span className="text-xl leading-none">{topic.icon}</span>
              <span className="mt-2 text-[14px] font-medium leading-snug text-ink-900">
                {topic.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 随机入口 */}
      <section className="px-5 pb-8">
        <div className="rounded-3xl border border-paper-edge/70 bg-gradient-to-br from-paper-warm to-amber-400/10 p-4 shadow-paper">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Shuffle className="h-4 w-4 text-amber-600" strokeWidth={2} />
              <span className="text-[14px] font-semibold text-ink-900">随机问我一个</span>
            </div>
            <SoftButton size="sm" variant="paper" onClick={rollQuestion}>
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
              {randomQuestion ? '换一个' : '抽一个'}
            </SoftButton>
          </div>

          {randomQuestion ? (
            <div key={randomQuestion} className="animate-flip-in mt-3">
              <p className="reader text-[16px] leading-[1.85] text-ink-900">“{randomQuestion}”</p>
              <SoftButton variant="primary" size="md" block className="mt-3" onClick={startQuestion}>
                就讲这个
              </SoftButton>
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300">
              不知道从哪讲起的时候，让我先问你一句。
            </p>
          )}
        </div>
      </section>
    </PhoneShell>
  );
}

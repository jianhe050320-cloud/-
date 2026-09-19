import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Brain } from 'lucide-react';
import { PageTopBar, PhoneShell } from '../components/layout/PhoneShell';
import { SoftButton } from '../components/common/SoftButton';
import { Bubble, RecapCard, ThinkingBubble } from '../components/interview/Bubble';
import { ComposerBar } from '../components/interview/ComposerBar';
import { EndSheet } from '../components/interview/EndSheet';
import { ObserverDrawer } from '../components/interview/ObserverDrawer';
import { useInterviewStore } from '../store/useInterviewStore';
import { useStoriesStore } from '../store/useStoriesStore';
import { listStories } from '../services/storyService';
import { findTopic, pickRandomTopic } from '../data/topics';
import { elapsedLabel } from '../lib/time';
import { isUuid } from '../lib/storage';

export function InterviewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const topicParam = params.get('topic');
  const question = params.get('q');
  /** 从「我的故事 → 继续讲这段」进来：thread = 原故事的线程，story = 原故事 id */
  const threadParam = params.get('thread');
  const storyParam = params.get('story');
  const topic = findTopic(topicParam) ?? (topicParam || question ? undefined : pickRandomTopic());

  const sessionId = useInterviewStore((state) => state.sessionId);
  const topicIdInStore = useInterviewStore((state) => state.topicId);
  const topicLabel = useInterviewStore((state) => state.topicLabel);
  const state = useInterviewStore((state) => state.state);
  const messages = useInterviewStore((state) => state.messages);
  const thinking = useInterviewStore((state) => state.thinking);
  const observer = useInterviewStore((state) => state.observer);
  const memory = useInterviewStore((state) => state.memory);
  const startedAt = useInterviewStore((state) => state.startedAt);
  const ended = useInterviewStore((state) => state.ended);
  const resumed = useInterviewStore((state) => state.resumed);
  const start = useInterviewStore((store) => store.start);
  const resume = useInterviewStore((store) => store.resume);
  const continueStory = useInterviewStore((store) => store.continueStory);
  const send = useInterviewStore((store) => store.send);
  const endChat = useInterviewStore((store) => store.endChat);
  const generateDraft = useInterviewStore((store) => store.generateDraft);
  const nextSampleAnswer = useInterviewStore((store) => store.nextSampleAnswer);

  const [input, setInput] = useState('');
  const [observerOpen, setObserverOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [, setClock] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef('');

  const resolvedTopicId = topic?.id ?? 'random_question';
  const resolvedLabel = topic?.label ?? (question ? '随机问我一个' : '聊聊');

  /**
   * 初始化会话：
   * 先试着把同一话题「上次没讲完」的会话整个续回来（云端优先，本地兜底），
   * 续不上才开新的。这样用户再次点进同一个话题时不会从零开始。
   */
  useEffect(() => {
    const key = `${resolvedTopicId}::${question ?? ''}::${storyParam ?? ''}`;
    if (initializedRef.current === key) return;
    // 旧版本可能留下了非 uuid 的会话 ID（本地缓存），那种 ID 拿到 PG 会直接 400，必须重开
    if (isUuid(sessionId) && topicIdInStore === resolvedTopicId && messages.length > 0) {
      initializedRef.current = key;
      return;
    }
    initializedRef.current = key;

    const boot = async () => {
      const base = {
        topicId: resolvedTopicId,
        topicLabel: resolvedLabel,
        topicSeed: topic?.seed,
        question,
      };

      // 「继续讲这段」：回到原 Story 的 threadId，并把原故事的记忆带回来，
      // 让新的讲述长在原来的故事上，而不是另起一篇无关的新故事。
      if (storyParam) {
        let found =
          useStoriesStore.getState().stories.find((item) => item.id === storyParam) ?? null;
        if (!found) {
          try {
            const list = await listStories();
            found = list.find((item) => item.id === storyParam) ?? null;
          } catch {
            /* 离线：用本地已知的信息继续 */
          }
        }
        continueStory({
          ...base,
          threadId: found?.threadId || threadParam || '',
          memory: found?.memory ?? null,
        });
        return;
      }

      const resumedOk = await resume(base);
      if (!resumedOk) start(base);
    };
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTopicId, question, storyParam, threadParam]);

  /* 计时器：每分钟刷一次「今天已经聊了 N 分钟」 */
  useEffect(() => {
    const timer = setInterval(() => setClock((value) => value + 1), 20_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, thinking]);

  /** 立刻产出故事并跳到确认页（结构不齐时会自动走「短版本」） */
  const runGenerate = async () => {
    setGenerating(true);
    try {
      const draft = await generateDraft();
      // 继续讲旧故事时回到那个故事的确认页（会更新原 Story，而不是新建一条）
      if (draft) navigate(`/story/${storyParam || sessionId || 'current'}/confirm`);
    } finally {
      setGenerating(false);
      setEndOpen(false);
    }
  };

  const sendText = async (text: string) => {
    setInput('');
    const result = await send(text);
    // 用户说「今天先到这里」或明确要故事：不再追问，当场把故事交出来。
    // 「聊完了却什么都没拿到」是这个产品最伤人的失败方式。
    if (result && (result.intent === 'end' || result.intent === 'story_request')) {
      void runGenerate();
    }
  };

  const canSummarize = state === 'COMPLETING' || state === 'SUMMARY_CONFIRM' || ended;

  return (
    <PhoneShell
      hideTabBar
      overlay={
        <>
          <ObserverDrawer
            open={observerOpen}
            onClose={() => setObserverOpen(false)}
            observer={observer}
            memory={memory}
            state={state}
            onInject={(text) => {
              setInput(text);
              setObserverOpen(false);
            }}
            sampleAnswer={nextSampleAnswer()}
          />
          <EndSheet
            open={endOpen}
            onClose={() => setEndOpen(false)}
            title="要不要先把今天聊的整理成故事？"
          >
            <div className="space-y-2">
              <SoftButton
                variant="primary"
                size="lg"
                block
                disabled={generating}
                onClick={() => void runGenerate()}
              >
                {generating ? '正在整理…' : '整理成故事'}
              </SoftButton>
              <SoftButton variant="ghost" size="md" block onClick={() => navigate('/')}>
                先收好，下次接着讲
              </SoftButton>
            </div>
          </EndSheet>
        </>
      }
      footer={
        <ComposerBar
          value={input}
          onChange={setInput}
          onSend={() => void sendText(input)}
          busy={thinking}
          sampleAnswer={nextSampleAnswer()}
        />
      }
    >
      <PageTopBar
        title={topicLabel || resolvedLabel}
        subtitle={startedAt ? elapsedLabel(startedAt) : '刚刚开始'}
        onBack={() => navigate('/')}
        right={
          <button
            type="button"
            onClick={() => setObserverOpen(true)}
            className="tap flex min-h-[36px] items-center gap-1.5 rounded-2xl border border-amber-500/40 bg-amber-400/10 px-2.5 text-[11.5px] font-medium text-amber-700"
          >
            <Brain className="h-3.5 w-3.5" strokeWidth={2} />
            AI观察
          </button>
        }
      />

      <div className="flex justify-end px-4 pt-1.5">
        <button
          type="button"
          onClick={() => setEndOpen(true)}
          className="tap text-[11.5px] text-ink-300 hover:text-ink-500"
        >
          结束今天的聊天
        </button>
      </div>

      <div className="space-y-3 px-4 pb-4 pt-3">
        {resumed && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-700">
            接着上次讲。之前的内容我都还记得，直接从还没讲到的地方继续就好。
          </div>
        )}

        {messages.map((message) =>
          message.kind === 'recap' ? (
            <RecapCard key={message.id} text={message.text} />
          ) : (
            <Bubble key={message.id} role={message.role} text={message.text} />
          ),
        )}
        {thinking && <ThinkingBubble />}

        {canSummarize && !thinking && (
          <div className="card-paper animate-fade-up space-y-2 p-3.5">
            <p className="text-[12.5px] leading-relaxed text-ink-500">
              这个故事已经能独立成立了。要不要我把它整理成一页纸，您再看看？
            </p>
            <SoftButton
              variant="primary"
              size="md"
              block
              disabled={generating}
              onClick={() => void runGenerate()}
            >
              {generating ? '正在整理…' : '看看整理出来的故事'}
            </SoftButton>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </PhoneShell>
  );
}

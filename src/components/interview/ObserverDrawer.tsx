import { Brain, Check, X } from 'lucide-react';
import { ObserverStory } from './ObserverStory';
import { BADCASE_INPUTS } from '../../data/seed';
import type { InterviewState, ObserverSnapshot, StoryMemory } from '../../types/interview';
import { cn } from '../../lib/cn';

interface ObserverDrawerProps {
  open: boolean;
  onClose: () => void;
  observer: ObserverSnapshot | null;
  memory: StoryMemory;
  /** 实时状态机位置（快照会落后一拍） */
  state: InterviewState;
  /** 把测试输入或剧本台词直接灌进输入框 */
  onInject: (text: string) => void;
  sampleAnswer?: string | null;
}

/**
 * 🧠 AI观察模式 —— 开发测试用，不是普通用户功能。
 * 目的只有一个：把「AI 到底是怎么做判断的」摊开给人看。
 */
export function ObserverDrawer({
  open,
  onClose,
  observer,
  memory,
  state,
  onInject,
  sampleAnswer,
}: ObserverDrawerProps) {
  if (!open) return null;
  const candidates = observer?.candidates ?? [];

  return (
    <>
      <button
        type="button"
        aria-label="关闭 AI观察"
        onClick={onClose}
        className="absolute inset-0 z-40 cursor-default bg-night-900/70 backdrop-blur-sm"
      />

      <aside className="glass-night absolute inset-y-0 right-0 z-50 flex w-[88%] max-w-[370px] animate-drawer-in flex-col rounded-l-[26px]">
        <header className="safe-top flex shrink-0 items-center gap-2 border-b border-paper/10 px-4 pb-3">
          <Brain className="h-4 w-4 text-amber-400" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-paper">AI观察</h2>
            <p className="text-[10.5px] text-paper/45">
              {observer?.engine === 'llm' ? '真实模型驱动' : '演示剧本驱动（未配置密钥）'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="tap flex h-9 w-9 items-center justify-center rounded-full text-paper/70 hover:bg-paper/10"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="no-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <ObserverStory observer={observer} memory={memory} state={state} />

          <section className="space-y-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-paper/70">
              候选追问对比
            </h3>
            {candidates.length === 0 ? (
              <p className="text-[11.5px] text-paper/35">还没有候选问题。</p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((candidate) => {
                  const selected = candidate.id === observer?.selected?.id;
                  return (
                    <li
                      key={candidate.id}
                      className={cn(
                        'rounded-2xl border px-2.5 py-2',
                        candidate.blocked
                          ? 'border-clay/40 bg-clay/10'
                          : selected
                            ? 'border-amber-400/50 bg-amber-400/10'
                            : 'border-paper/10 bg-paper/5',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        {candidate.priority && (
                          <span className="rounded-full border border-paper/20 px-1.5 text-[10px] text-paper/70">
                            {candidate.priority}
                          </span>
                        )}
                        {typeof candidate.score === 'number' && (
                          <span className="text-[10.5px] text-paper/50">score {candidate.score}</span>
                        )}
                        {candidate.blocked ? (
                          <span className="text-[10.5px] text-clay">已拦下 · {candidate.blockedReason}</span>
                        ) : (
                          selected && (
                            <span className="inline-flex items-center gap-0.5 text-[10.5px] text-amber-300">
                              <Check className="h-3 w-3" strokeWidth={2.4} />
                              选中
                            </span>
                          )
                        )}
                      </div>
                      {candidate.ack && (
                        <p className="mt-1 text-[12px] leading-relaxed text-paper/55">
                          <span className="text-paper/35">接住　</span>
                          {candidate.ack}
                        </p>
                      )}
                      <p className="mt-1 text-[12.5px] leading-relaxed text-paper/85">
                        {candidate.ask === false ? (
                          <span className="text-paper/45">（这一轮不问，只接住）</span>
                        ) : (
                          candidate.question
                        )}
                      </p>
                      <p className="mt-1 text-[10.5px] text-paper/40">针对线索：{candidate.target_clue || '—'}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-paper/70">
              命中的判断
            </h3>
            {(observer?.ruleHits ?? []).length === 0 ? (
              <p className="text-[11.5px] text-paper/35">这一轮没有命中特殊规则。</p>
            ) : (
              <ul className="space-y-1.5">
                {observer?.ruleHits.map((hit) => (
                  <li key={hit} className="flex items-start gap-2 text-[12px] leading-relaxed text-paper/80">
                    <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                    {hit}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2 pb-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-paper/70">
              测试输入一键注入
            </h3>
            <p className="text-[11px] leading-relaxed text-paper/40">
              这 10 句是刻意拿来「攻击」这个产品的：看它是在执行问答，还是在理解一个正在发生的人生故事。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {BADCASE_INPUTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onInject(item.text)}
                  className="tap rounded-full border border-paper/15 bg-paper/5 px-2.5 py-1 text-[11.5px] text-paper/75 hover:bg-paper/10"
                  title={item.text}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {sampleAnswer && (
              <button
                type="button"
                onClick={() => onInject(sampleAnswer)}
                className="tap mt-1 w-full rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-[11.5px] leading-relaxed text-amber-100"
              >
                <span className="block text-[10.5px] text-amber-300/80">测试集 · 下一句剧本台词</span>
                {sampleAnswer}
              </button>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

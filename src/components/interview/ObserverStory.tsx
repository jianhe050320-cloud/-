import { Star } from 'lucide-react';
import { Stars } from '../common/Stars';
import { REASON_CATALOG } from '../../data/seed';
import { stateMeta, storyStatusLabel } from '../../types/interview';
import type { InterviewState, ObserverSnapshot, StoryMemory } from '../../types/interview';
import { describeLayers } from '../../services/memoryService';
import { cn } from '../../lib/cn';

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-paper/70">{title}</h3>
        {hint && <span className="text-[10.5px] text-paper/35">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[11.5px] leading-relaxed text-paper/35">{text}</p>;
}

/** AI观察模式的「当前故事」区块：人物 / 事件 / 情绪 / 高价值线索 / 状态 */
export function ObserverStory({
  observer,
  memory,
  state,
}: {
  observer: ObserverSnapshot | null;
  memory: StoryMemory;
  /** 状态用 store 里的实时值：快照只在回合结束时更新，会落后一拍 */
  state: InterviewState;
}) {
  const layers = describeLayers(memory);
  const { label: stateLabel, hint: stateHint } = stateMeta(state);

  return (
    <div className="space-y-5">
      <Section title="当前故事">
        <p className="text-[15px] font-semibold text-paper">{observer?.topic || '还没有开始'}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] text-amber-300">
            {stateLabel}
          </span>
          <span className="rounded-full border border-paper/15 px-2.5 py-0.5 text-[11px] text-paper/60">
            {storyStatusLabel(memory.story_status)}
          </span>
          {observer && (
            <span className="text-[11px] text-paper/40">完整度 {Math.round(observer.completeness * 100)}%</span>
          )}
        </div>
        {stateHint && <p className="pt-1 text-[11px] leading-relaxed text-paper/40">{stateHint}</p>}
      </Section>

      <Section title="人物" hint="按重要度排序">
        {memory.people.length === 0 ? (
          <Empty text="还没有识别到重要人物。" />
        ) : (
          <ul className="space-y-1.5">
            {memory.people.map((person) => (
              <li key={person.name} className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-paper/90">
                  {person.name}
                  {person.relationship && <span className="text-paper/40">（{person.relationship}）</span>}
                </span>
                <Stars value={person.importance} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="事件">
        {memory.events.length === 0 ? (
          <Empty text="还没有形成事件。" />
        ) : (
          <ul className="space-y-1.5">
            {memory.events.map((event, index) => (
              <li key={`${event.description}-${index}`} className="flex items-start justify-between gap-2">
                <span className="text-[12.5px] leading-relaxed text-paper/85">{event.description}</span>
                <Stars value={event.importance} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="情绪">
        {memory.emotions.length === 0 ? (
          <Empty text="还没有捕捉到情绪。" />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {memory.emotions.map((emotion) => (
              <span
                key={emotion.emotion}
                className="rounded-full border border-paper/15 bg-paper/5 px-2.5 py-1 text-[11.5px] text-paper/80"
                title={emotion.evidence}
              >
                {emotion.emotion}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="高价值线索">
        {(observer?.highValueClues ?? []).length === 0 ? (
          <Empty text="还没有出现值得重点跟进的高价值线索。" />
        ) : (
          <ul className="space-y-1.5">
            {observer?.highValueClues.map((clue) => (
              <li
                key={clue}
                className="flex items-start gap-2 rounded-r-xl border-l-2 border-amber-400 bg-amber-400/10 py-1.5 pl-2.5 pr-2 text-[12.5px] leading-relaxed text-amber-100"
              >
                <Star className="mt-[3px] h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                {clue}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="推荐追问" hint="本轮实际会问的那一句">
        {observer?.selected ? (
          <p className="reader rounded-2xl border border-paper-edge/30 bg-paper/95 px-3.5 py-3 text-[13.5px] text-ink-900">
            {observer.selected.question}
          </p>
        ) : (
          <Empty text="还没有产生推荐追问（可能命中硬规则，直接用了固定回复）。" />
        )}
      </Section>

      <Section title="推荐理由">
        <ul className="space-y-1.5">
          {REASON_CATALOG.map((reason) => {
            const hit = (observer?.reasons ?? []).includes(reason);
            return (
              <li
                key={reason}
                className={cn(
                  'flex items-center gap-2 text-[12.5px]',
                  hit ? 'text-paper/90' : 'text-paper/30',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                    hit ? 'bg-sage/25 text-sage' : 'bg-paper/10 text-paper/25',
                  )}
                  aria-hidden
                >
                  {hit ? '✓' : '·'}
                </span>
                {reason}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="记忆分层" hint="L4 需谨慎，L5 必须用户确认">
        <ul className="space-y-2">
          {(
            [
              ['L1', '事实', layers.L1],
              ['L2', '故事', layers.L2],
              ['L3', '情绪', layers.L3],
              ['L4', '主题（未确认）', layers.L4],
              ['L5', '对用户的理解（已确认）', layers.L5],
            ] as const
          ).map(([level, label, items]) => (
            <li key={level} className="rounded-2xl border border-paper/10 bg-paper/5 px-2.5 py-2">
              <p className="text-[11px] text-paper/50">
                <span className="mr-1.5 font-semibold text-paper/70">{level}</span>
                {label}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-paper/80">
                {items.length ? items.join('；') : '—'}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

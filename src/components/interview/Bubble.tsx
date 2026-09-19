import { cn } from '../../lib/cn';

/** AI 纸感气泡 / 用户琥珀气泡；AI 侧带一个极小的头像圆点 */
export function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div className={cn('animate-fade-up flex w-full gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <span
          aria-hidden
          className="mt-2 h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 shadow-soft"
        />
      )}
      <p
        className={cn(
          'max-w-[80%] px-3.5 py-2.5 text-[15px] leading-[1.75]',
          isUser ? 'bubble-user' : 'bubble-ai',
        )}
      >
        {text}
      </p>
    </div>
  );
}

/**
 * 记忆板回执（原则 9）。
 * 刻意做成一张「回执单」而不是气泡——它是保存的凭证，不是一句聊天。
 */
export function RecapCard({ text }: { text: string }) {
  return (
    <div className="animate-fade-up flex w-full justify-start gap-2">
      <span
        aria-hidden
        className="mt-2 h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 shadow-soft"
      />
      <div className="card-paper max-w-[86%] rounded-2xl border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5">
        <p className="text-[11px] font-medium tracking-wide text-amber-700">记忆板</p>
        <p className="mt-1 text-[14px] leading-[1.75] text-ink-900">{text}</p>
      </div>
    </div>
  );
}

/** AI 停顿：不显示「AI 正在分析」，只显示三个缓慢起伏的点 */
export function ThinkingBubble() {
  return (
    <div className="animate-fade-in flex w-full items-center gap-2">
      <span
        aria-hidden
        className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 shadow-soft"
      />
      <span className="bubble-ai flex items-center gap-1 px-4 py-3.5" aria-label="正在想">
        <span className="thinking-dot animate-dots" />
        <span className="thinking-dot animate-dots" />
        <span className="thinking-dot animate-dots" />
      </span>
    </div>
  );
}

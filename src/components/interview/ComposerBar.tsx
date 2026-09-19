import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Lightbulb, Mic, PenLine, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import { SOFT_HINTS } from '../../data/seed';

interface ComposerBarProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  /** 演示剧本里「用户本该说的下一句」，点一下直接填入 */
  sampleAnswer?: string | null;
}

/**
 * 输入区。
 * MVP 只做文字输入，但语音入口按规格保留——点它不会假装能录音，
 * 而是明确告诉用户这一版先支持打字。
 */
export function ComposerBar({ value, onChange, onSend, busy, sampleAnswer }: ComposerBarProps) {
  const [showHints, setShowHints] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!voiceNotice) return;
    const timer = setTimeout(() => setVoiceNotice(false), 2600);
    return () => clearTimeout(timer);
  }, [voiceNotice]);

  const send = () => {
    if (!value.trim() || busy) return;
    onSend();
    setShowHints(false);
  };

  return (
    <div className="safe-bottom sticky bottom-0 z-20 shrink-0 border-t border-paper-edge/70 bg-paper/95 px-3 pb-2 pt-2 backdrop-blur-xl">
      {/* 次级操作 */}
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <button
          type="button"
          onClick={() => setShowHints((prev) => !prev)}
          className="tap inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink-500 hover:bg-ink-900/5"
        >
          <Lightbulb className="h-3.5 w-3.5" strokeWidth={1.9} />
          我不知道怎么说
        </button>

        {sampleAnswer && (
          <button
            type="button"
            onClick={() => onChange(sampleAnswer)}
            className="tap inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 text-[12px] text-amber-700"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
            用剧本台词
          </button>
        )}
      </div>

      {/* 很轻的提示 */}
      {showHints && (
        <div className="animate-fade-up mb-2 space-y-1.5">
          {SOFT_HINTS.map((hint) => (
            <button
              key={hint}
              type="button"
              onClick={() => {
                onChange(hint);
                setShowHints(false);
                inputRef.current?.focus();
              }}
              className="tap block w-full rounded-2xl border border-paper-edge/70 bg-white/80 px-3 py-2 text-left text-[12.5px] leading-relaxed text-ink-500 hover:text-ink-900"
            >
              {hint}
            </button>
          ))}
        </div>
      )}

      {voiceNotice && (
        <p className="animate-fade-in mb-2 rounded-2xl bg-ink-900/5 px-3 py-2 text-[12px] text-ink-500">
          这一版先支持打字。您想到什么，写几个字也可以。
        </p>
      )}

      {/* 主输入行 */}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => setVoiceNotice(true)}
          aria-label="按住说话"
          className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 text-white shadow-soft"
        >
          <Mic className="h-5 w-5" strokeWidth={1.8} />
        </button>

        <div className="flex min-h-[44px] flex-1 items-end rounded-[22px] border border-paper-edge/80 bg-white/85 px-3 py-2 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-400/25">
          <textarea
            ref={inputRef}
            value={value}
            rows={1}
            placeholder="想到什么就说什么，写几个字也可以"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            className="no-scrollbar max-h-32 w-full resize-none border-0 bg-transparent p-0 text-[14.5px] leading-relaxed text-ink-900 placeholder:text-ink-100 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={send}
          disabled={busy || !value.trim()}
          aria-label="发送"
          className={cn(
            'tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-soft',
            busy || !value.trim()
              ? 'cursor-not-allowed bg-ink-100'
              : 'bg-gradient-to-br from-amber-400 to-amber-600',
          )}
        >
          {busy ? <PenLine className="h-4 w-4" strokeWidth={2} /> : <ArrowUp className="h-5 w-5" strokeWidth={2.2} />}
        </button>
      </div>
    </div>
  );
}

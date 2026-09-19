import { DISCOVERY_KIND_LABEL, type Discovery, type DiscoveryKind } from '../../types/discovery';

/**
 * 「关于你」——故事之外的独立栏目。
 *
 * 三条不能破的线：
 *   1. 它不是故事正文的一部分，必须与正文有明显视觉分野（独立细线 + 大留白）；
 *   2. 它不是 data dashboard：**不出现「人格 / 性格 / 关键词」这类字段名**，
 *      也不用表格、卡片、进度条。它就是杂志里的一个栏目；
 *   3. 它不给用户下结论，只把用户自己说过的话指回给他看，
 *      所以每一条都带一行很轻的「依据」。
 */

const KIND_ORDER: DiscoveryKind[] = ['care', 'want', 'refuse', 'express', 'people', 'change'];

export function AboutYou({
  discoveries,
  generating,
  error,
  onGenerate,
}: {
  discoveries: Discovery[];
  generating: boolean;
  /** 生成失败时的诚实说明（例如找不回原始语料）；null 表示没有出错 */
  error: string | null;
  onGenerate: () => void;
}) {
  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: discoveries.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <section className="mt-24">
      {/*
        方案四「左标记栏」：整块用一根左侧竖线标记为独立栏目，
        与正文重点句（左竖线引文式）是同一种视觉语言 —— 统一里带区分。
        线色用琥珀，比正文重点句更实一点，表示「这是另一个板块」。
      */}
      <div className="border-l-2 border-amber-600/30 pl-5">
        <h2 className="font-serif text-[20px] font-semibold leading-[1.4] text-ink-900">关于你</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300">
          都是从你刚才讲过的话里找到的。
        </p>

      {grouped.length > 0 ? (
        <div className="mt-7 space-y-7">
          {grouped.map((group) => (
            <div key={group.kind}>
              {/* 分组标签前的小琥珀点：与左侧竖线呼应，成本很低的一个层级信号 */}
              <p className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-ink-300">
                <span className="h-1 w-1 shrink-0 rounded-full bg-amber-600/55" aria-hidden />
                {DISCOVERY_KIND_LABEL[group.kind]}
              </p>
              <ul className="mt-2.5 space-y-6">
                {group.items.map((item) => (
                  <li key={item.id}>
                    {/* 发现句用衬线，与故事正文同一字体：这是「统一」的关键 */}
                    <p className="font-serif text-[16.5px] font-medium leading-[1.9] text-ink-800">
                      {item.text}
                    </p>
                    {item.support && item.support.length > 0 && (
                      <p className="mt-2 text-[13px] leading-[1.85] text-ink-500">{item.support}</p>
                    )}
                    {item.evidence.length > 0 && (
                      <p className="mt-1.5 text-[12px] leading-[1.85] text-ink-300">
                        {item.support ? '你讲过：' : '依据：'}
                        {item.evidence.join('；')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        /* 老故事没有「关于你」时，不显示空壳，只留一个很轻的入口 */
        <div className="mt-7">
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="tap text-[13.5px] font-medium text-amber-700 hover:text-amber-600 disabled:text-ink-100"
          >
            {generating ? '正在从你讲过的话里找…' : '生成关于你'}
          </button>
          <p className="mt-2.5 text-[12px] leading-relaxed text-ink-300">
            {error ??
              '这次还没生成出来，点上面再试一次。只会用你自己讲过的话，不会替你分析性格，也不会给你下结论。'}
          </p>
        </div>
      )}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Plug, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { PageTopBar, PhoneShell } from '../components/layout/PhoneShell';
import { PaperCard } from '../components/common/PaperCard';
import { SoftButton } from '../components/common/SoftButton';
import { useSettingsStore } from '../store/useSettingsStore';
import { useStoriesStore } from '../store/useStoriesStore';
import { PROVIDER_PRESETS } from '../data/seed';
import { probeServerKey, testLlmConnection } from '../services/llmGateway';
import { importStories } from '../services/storyService';
import { parseStoryExport, planImport } from '../services/storyTransfer';
import { ensureSession, type SessionInfo } from '../lib/cloudbase';
import { clearAllAppData } from '../lib/storage';
import { cn } from '../lib/cn';
import type { LlmProvider } from '../types/llm';

const PROVIDERS: { id: LlmProvider; label: string }[] = [
  { id: 'deepseek', label: PROVIDER_PRESETS.deepseek.label },
  { id: 'zhipu', label: PROVIDER_PRESETS.zhipu.label },
  { id: 'custom', label: '自定义' },
];

const FIELD =
  'w-full rounded-2xl border border-paper-edge/80 bg-white/80 px-3.5 py-2.5 text-[13.5px] text-ink-900 placeholder:text-ink-100 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25';

/**
 * 构建版本标记：读取 index.html 里 stamp-build.mjs 写入的 meta。
 * 只有生产构建才有；本地 dev 读不到就为空字符串，界面上不显示。
 * 用途：打开线上链接时，在这里一眼确认「是不是我刚部署的那一版」，
 * 不用再去和 CloudBase 测试域名的风险提醒拦截页搏斗。
 */
const BUILD_INFO = [
  document.querySelector('meta[name="build-time"]')?.getAttribute('content') ?? '',
  document.querySelector('meta[name="build-id"]')?.getAttribute('content') ?? '',
]
  .filter(Boolean)
  .join(' · ');

export function SettingsPage() {
  const navigate = useNavigate();
  const llm = useSettingsStore((state) => state.llm);
  const setLlm = useSettingsStore((state) => state.setLlm);
  const stories = useStoriesStore((state) => state.stories);
  const syncStatus = useStoriesStore((state) => state.syncStatus);
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  /** undefined = 还在连接中；null = 连不上 */
  const [identity, setIdentity] = useState<SessionInfo | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [serverKeyReady, setServerKeyReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void probeServerKey().then(setServerKeyReady);
  }, []);

  const refreshIdentity = async () => {
    setChecking(true);
    const session = await ensureSession();
    setIdentity(session);
    setChecking(false);
  };

  useEffect(() => {
    void refreshIdentity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchProvider = (provider: LlmProvider) => {
    setProbe(null);
    if (provider === 'custom') {
      setLlm({ provider });
      return;
    }
    const preset = PROVIDER_PRESETS[provider];
    setLlm({ provider, baseUrl: preset.baseUrl, model: preset.model });
  };

  const runProbe = async () => {
    setProbing(true);
    setProbe(null);
    const result = await testLlmConnection();
    setProbe(result);
    setProbing(false);
  };

  const exportStories = () => {
    const blob = new Blob([JSON.stringify({ stories }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `我的故事-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearLocal = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    clearAllAppData();
    useStoriesStore.getState().setStories([]);
    setConfirmClear(false);
  };

  /**
   * 导入此前导出的 JSON。
   * 追加/合并：不覆盖已有故事；按 id（以及「标题+创建时间」兜底）去重；
   * 任何失败都给出明确原因，绝不静默。
   */
  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportNote(null);
    try {
      const incoming = parseStoryExport(await file.text());
      const plan = planImport(useStoriesStore.getState().stories, incoming);

      if (plan.toInsert.length === 0) {
        setImportNote({
          ok: true,
          text: `这 ${plan.skipped} 个故事已经在你的「我的故事」里了，没有重复导入。`,
        });
        return;
      }

      const result = await importStories(plan.toInsert);
      result.inserted.forEach((story) => useStoriesStore.getState().upsertStory(story));

      const parts = [`已导入 ${result.inserted.length} 个故事`];
      if (plan.skipped > 0) parts.push(`${plan.skipped} 个已存在，跳过`);
      if (result.failed.length > 0) {
        const first = result.failed[0];
        parts.push(`${result.failed.length} 个没成功（${first.title}：${first.reason}）`);
      }
      setImportNote({ ok: result.failed.length === 0, text: `${parts.join('；')}。` });
    } catch (error) {
      setImportNote({
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <PhoneShell>
      <PageTopBar title="设置" subtitle="模型接入与数据" onBack={() => navigate('/')} />

      <div className="space-y-4 px-4 pb-8 pt-4">
        {/* 模型接入 */}
        <PaperCard className="space-y-3">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-amber-600" strokeWidth={2} />
            <h2 className="text-[15px] font-semibold text-ink-900">模型接入</h2>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-300">
            {llm.apiKey.trim()
              ? '正在使用你自己填写的密钥。它只保存在这台设备的浏览器里，不会上传到任何地方。'
              : serverKeyReady
                ? '正在使用服务端已配置好的密钥（不会下发到浏览器）。你也可以填自己的密钥覆盖它。'
                : '还没有可用的密钥。不填也能用内置的采访剧本完整体验一遍采访。'}
          </p>

          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => switchProvider(item.id)}
                className={cn(
                  'tap rounded-full border px-3 py-1.5 text-[12.5px] font-medium',
                  llm.provider === item.id
                    ? 'border-amber-500/60 bg-amber-400/20 text-amber-700'
                    : 'border-paper-edge/80 bg-white/70 text-ink-500',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">Base URL</span>
            <input
              className={FIELD}
              value={llm.baseUrl}
              placeholder="https://api.deepseek.com"
              onChange={(event) => setLlm({ baseUrl: event.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">密钥</span>
            <input
              className={FIELD}
              type="password"
              value={llm.apiKey}
              placeholder="sk-..."
              onChange={(event) => setLlm({ apiKey: event.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-500">模型名</span>
            <input
              className={FIELD}
              value={llm.model}
              placeholder="deepseek-chat"
              onChange={(event) => setLlm({ model: event.target.value })}
            />
          </label>

          <div className="flex items-center gap-2">
            <SoftButton
              variant="primary"
              size="md"
              onClick={runProbe}
              disabled={probing}
              className="flex-1"
            >
              {probing ? '正在连接…' : '测试连接'}
            </SoftButton>
          </div>

          {probe && (
            <p
              className={cn(
                'rounded-2xl px-3 py-2 text-[12px] leading-relaxed',
                probe.ok ? 'bg-sage/10 text-sage' : 'bg-clay/10 text-clay',
              )}
            >
              {probe.message}
            </p>
          )}
        </PaperCard>

        {/* 运行模式 */}
        <PaperCard className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-600" strokeWidth={2} />
            <h2 className="text-[15px] font-semibold text-ink-900">运行模式</h2>
          </div>
          {(
            [
              {
                id: 'auto' as const,
                label: '自动',
                desc: '有密钥时走真实模型，没有时自动用演示剧本，不会白屏。',
              },
              {
                id: 'demo' as const,
                label: '强制演示',
                desc: '始终使用内置的《第一次离开家》剧本，用来演示完整采访过程。',
              },
            ]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLlm({ mode: item.id })}
              className={cn(
                'tap w-full rounded-2xl border p-3 text-left',
                llm.mode === item.id
                  ? 'border-amber-500/60 bg-amber-400/10'
                  : 'border-paper-edge/80 bg-white/70',
              )}
            >
              <span className="block text-[13.5px] font-medium text-ink-900">{item.label}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-300">
                {item.desc}
              </span>
            </button>
          ))}
        </PaperCard>

        {/* 账号与同步 */}
        <PaperCard className="space-y-2">
          <h2 className="text-[15px] font-semibold text-ink-900">账号与同步</h2>
          <p className="text-[12px] leading-relaxed text-ink-300">
            {identity === undefined
              ? '正在连接云端…'
              : identity
                ? `当前是游客身份（${identity.uid.slice(0, 8)}）。故事会同步到云端，用同一台设备和同一个浏览器回来，故事都还在。`
                : '暂时连不上云端。故事会先存在这台设备上，网络恢复后自动补传，不会丢。'}
          </p>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span
              className={cn(
                'text-[11.5px]',
                syncStatus === 'offline'
                  ? 'text-clay'
                  : syncStatus === 'synced'
                    ? 'text-sage'
                    : 'text-ink-300',
              )}
            >
              {syncStatus === 'syncing'
                ? '正在同步…'
                : syncStatus === 'offline'
                  ? '离线暂存中'
                  : '已同步到云端'}
            </span>
            <SoftButton
              size="sm"
              variant="paper"
              disabled={checking}
              onClick={() => void refreshIdentity()}
            >
              {checking ? '检查中…' : '重新检查连接'}
            </SoftButton>
          </div>
        </PaperCard>

        {/* 数据 */}
        <PaperCard className="space-y-3">
          <h2 className="text-[15px] font-semibold text-ink-900">数据</h2>
          <p className="text-[12px] text-ink-300">已经留下 {stories.length} 个故事。</p>

          {/* 数据说明：数据在云端，但游客身份与当前浏览器绑定 */}
          <div className="rounded-2xl bg-paper-warm/80 p-3">
            <p className="text-[12px] font-medium text-ink-700">数据说明</p>
            <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-ink-500">
              <li>你的故事会同步保存到云端。</li>
              <li>当前设备使用的是游客身份，数据会与当前浏览器绑定。</li>
              <li>
                换一台手机、换一个浏览器、或在微信里打开，都会被当作一台新设备，看到的是那一台设备上的故事。
              </li>
              <li>所以换设备前，请先在旧设备「导出 JSON」，再到新设备「导入故事」。导入是追加，不会覆盖已有内容。</li>
              <li>后续会支持绑定账号，让故事可以在不同设备间继续使用。</li>
            </ul>
          </div>

          <div className="flex gap-2">
            <SoftButton variant="paper" size="md" onClick={exportStories} className="flex-1">
              <Download className="h-4 w-4" strokeWidth={1.9} />
              导出 JSON
            </SoftButton>
            <SoftButton
              variant="paper"
              size="md"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
              className="flex-1"
            >
              <Upload className="h-4 w-4" strokeWidth={1.9} />
              {importing ? '导入中…' : '导入故事'}
            </SoftButton>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />
          <p className="text-[11.5px] leading-relaxed text-ink-300">
            导入是追加，不会覆盖你已有的故事；同一篇故事不会被重复导入。
          </p>

          {importNote && (
            <p
              className={cn(
                'rounded-2xl px-3 py-2 text-[12px] leading-relaxed',
                importNote.ok ? 'bg-sage/10 text-sage' : 'bg-clay/10 text-clay',
              )}
            >
              {importNote.text}
            </p>
          )}

          <div className="pt-1">
            <SoftButton variant="paper" size="md" block onClick={clearLocal}>
              <Trash2 className="h-4 w-4" strokeWidth={1.9} />
              {confirmClear ? '确认清空这台设备的本地数据？' : '清空本地'}
            </SoftButton>
          </div>
        </PaperCard>

        {/* 版本标记：确认线上跑的是不是最新构建。
            与 index.html 里的 build meta 同源（stamp-build.mjs 写入）；
            本地 dev 没有这个 meta，就不显示，避免干扰。 */}
        {BUILD_INFO && (
          <p className="pb-2 pt-1 text-center text-[11px] tracking-[0.06em] text-ink-300">
            构建 {BUILD_INFO}
          </p>
        )}
      </div>
    </PhoneShell>
  );
}

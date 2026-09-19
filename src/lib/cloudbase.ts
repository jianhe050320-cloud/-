import cloudbase from '@cloudbase/js-sdk';

/**
 * CloudBase 云库访问边界。
 *
 * 这个环境是 PostgreSQL 模式，所以浏览器侧只能走 app.rdb()（postgREST 风格链式 API）：
 * 不要用 app.database() / db.collection() / .where() / .orderBy() / .count()。
 * 页面与 store 都不直连 SDK，统一从这里进出。
 */

const ENV_ID =
  (import.meta.env.VITE_CLOUDBASE_ENV_ID as string | undefined)?.trim() ||
  'hj-d5ggpl6f9e4e8453b';

export const app = cloudbase.init({ env: ENV_ID });
export const auth = app.auth;
export const rdb = app.rdb();

export interface SessionInfo {
  uid: string;
  isAnonymous: boolean;
}

let pending: Promise<SessionInfo | null> | null = null;

type LooseSession = {
  data?: { session?: { user?: { id?: string; is_anonymous?: boolean } } } | null;
  error?: unknown;
};

/**
 * 零门槛：打开就是游客身份。
 * 只有真正拿到 session 才允许写云库，否则一律走本地暂存，避免网络抖动打断讲述。
 */
export function ensureSession(): Promise<SessionInfo | null> {
  if (!pending) pending = bootstrapSession();
  return pending;
}

async function bootstrapSession(): Promise<SessionInfo | null> {
  try {
    const existing = (await auth.getSession()) as LooseSession;
    const current = existing?.data?.session?.user;
    if (current?.id) {
      return { uid: current.id, isAnonymous: Boolean(current.is_anonymous) };
    }

    const created = (await auth.signInAnonymously()) as LooseSession;
    const fresh = created?.data?.session?.user;
    if (fresh?.id) {
      return { uid: fresh.id, isAnonymous: Boolean(fresh.is_anonymous) };
    }
    console.error('[interviewer] 匿名登录没有返回 session');
    return null;
  } catch (error) {
    console.error('[interviewer] 云库登录失败，改用本地暂存：', error);
    return null;
  }
}

/** 退出游客会话（设置页「换个身份」用） */
export async function signOutSession(): Promise<void> {
  try {
    await auth.signOut();
  } catch (error) {
    console.error('[interviewer] 退出失败：', error);
  }
  pending = null;
}

const PREFIX = 'interviewer.v1:';

export interface StorageLike {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

/** 统一的 localStorage 适配器（带命名空间与版本），禁止页面散落裸调用 */
export function createAppStorage(): StorageLike {
  return {
    getItem: (name: string) => {
      try {
        return localStorage.getItem(PREFIX + name);
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string) => {
      try {
        localStorage.setItem(PREFIX + name, value);
      } catch {
        /* 存储满/隐私模式下静默忽略 */
      }
    },
    removeItem: (name: string) => {
      try {
        localStorage.removeItem(PREFIX + name);
      } catch {
        /* ignore */
      }
    },
  };
}

export function clearAllAppData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 会话 / 故事用真 uuid，直接对上 PG 里的 uuid 主键 */
export function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* 降级到下面的手写实现 */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 本地可能残留旧版本生成的 ID；不是 uuid 就不能拿去查 PG（会直接 400） */
export function isUuid(value: string | undefined | null): boolean {
  return Boolean(value && UUID_RE.test(value));
}

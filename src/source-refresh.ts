/** Shared cooldown/in-flight state survives switching between a project's chats. */
export function sourceRefresher<T>(options: {
  key: string;
  attempts: Record<string, number>;
  pending: Set<string>;
  available: () => boolean;
  refresh: () => Promise<T>;
  updated: (result: T) => void;
  failed: (error: unknown) => void;
  now?: () => number;
}) {
  let disposed = false;
  const clock = options.now || Date.now;
  return {
    async run(minAge = 60000) {
      const previous = options.attempts[options.key];
      if (disposed || !options.available() || options.pending.has(options.key) ||
          (previous !== undefined && clock() - previous < minAge)) return;
      options.attempts[options.key] = clock();
      options.pending.add(options.key);
      try {
        const result = await options.refresh();
        if (!disposed) options.updated(result);
      } catch (error) {
        if (!disposed) options.failed(error);
      } finally { options.pending.delete(options.key); }
    },
    dispose() { disposed = true; },
  };
}

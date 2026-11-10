// Shared by service instances so concurrent requests cannot mutate one conversation at once.
export class KeyedTaskQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
    this.tails.set(key, result);
    void result.finally(() => {
      if (this.tails.get(key) === result) this.tails.delete(key);
    }).catch(() => {});
    return result;
  }
}

export const conversationTurnQueue = new KeyedTaskQueue();

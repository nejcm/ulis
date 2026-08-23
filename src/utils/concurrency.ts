import { throwIfAborted } from "./interrupt.js";

/**
 * Run `runItem` over `items` with at most `concurrency` in flight at once, preserving input order
 * in the returned results regardless of completion order.
 */
export async function runBounded<T, U>(
  items: readonly T[],
  concurrency: number,
  runItem: (item: T) => Promise<U>,
  signal?: AbortSignal,
): Promise<readonly U[]> {
  let nextIndex = 0;
  const results: U[] = [];
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      throwIfAborted(signal);
      const itemIndex = nextIndex;
      const item = items[itemIndex]!;
      nextIndex += 1;
      results[itemIndex] = await runItem(item);
    }
  });
  await Promise.all(workers);
  return results;
}

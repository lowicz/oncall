/** Runs `step` for each item one after another, each starting once the one
 *  before has finished; the first that fails stops the rest. */
export async function inOrder<T>(items: Iterable<T>, step: (item: T) => Promise<unknown>): Promise<void> {
  await Array.from(items).reduce<Promise<unknown>>((done, item) => done.then(() => step(item)), Promise.resolve())
}

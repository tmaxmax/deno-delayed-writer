const noop = () => {};

type Operation = readonly [() => void, Promise<unknown>];

class DelayedWriterError extends Error {
  constructor(message: string) {
    super(`DelayedWriter: ${message}`);
  }
}

export class DelayedWriter {
  private readonly operationQueue: (() => Operation)[] = [];
  private readonly encoder = new TextEncoder();
  private isExecuting = false;

  constructor(
    private readonly writer: Deno.Writer = Deno.stdout,
    private time = 500,
  ) {}

  private assertNotExecuting() {
    if (this.isExecuting) {
      throw new DelayedWriterError(
        "operations are executing, cannot add new operation",
      );
    }
  }

  private createWaitOperation(time: number): () => Operation {
    return () => {
      let clearFn: () => void;
      const promise = new Promise<void>((resolve, reject) => {
        const handle = setTimeout(resolve, time);

        clearFn = () => {
          clearTimeout(handle);
          reject(new DelayedWriterError("operation canceled"));
        };
      });

      return [clearFn!, promise] as const;
    };
  }

  private createTextOperation(text: string): () => Operation {
    return () => {
      const promise = this.writer.write(this.encoder.encode(text));

      return [noop, promise] as const;
    };
  }

  wait(time = this.time): this {
    this.assertNotExecuting();
    this.time = time;
    this.operationQueue.push(this.createWaitOperation(time));
    return this;
  }

  write(text: string, time = this.time): this {
    this.assertNotExecuting();

    this.time = time;

    const delayBetweenLetters = (time / text.length) | 0;
    let first = false;
    for (const letter of text) {
      if (!first) {
        this.operationQueue.push(this.createWaitOperation(delayBetweenLetters));
      } else {
        first = true;
      }

      this.operationQueue.push(this.createTextOperation(letter));
    }

    return this;
  }

  async do(abort?: AbortSignal): Promise<void> {
    this.isExecuting = true;

    let lastCancelFn: () => void;

    const cleanup = () => {
      abort?.removeEventListener("abort", lastCancelFn);
      this.operationQueue.splice(0);
      this.isExecuting = false;
    };

    try {
      for (const operation of this.operationQueue) {
        const [cancel, promise] = operation();

        lastCancelFn = cancel;

        abort?.addEventListener("abort", cancel);

        await promise;

        abort?.removeEventListener("abort", cancel);
      }
    } catch (err) {
      if (!(err instanceof DelayedWriterError)) {
        cleanup();

        throw err;
      }
    }

    cleanup();
  }
}

export const wait = (time: number): DelayedWriter =>
  new DelayedWriter(Deno.stdout, time).wait();

export const write = (text: string, time: number): DelayedWriter =>
  new DelayedWriter(Deno.stdout, time).write(text);

export const doWait = (time: number, abort?: AbortSignal): Promise<void> =>
  wait(time).do(abort);

export const doWrite = (
  text: string,
  time: number,
  abort?: AbortSignal,
): Promise<void> => write(text, time).do(abort);

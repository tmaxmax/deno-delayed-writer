import { readline } from "https://deno.land/x/readline@v1.1.0/mod.ts";

const noop = () => {};

type Operation = () => readonly [() => void, Promise<unknown>];

class DelayedWriterError extends Error {
  constructor(message: string) {
    super(`DelayedWriter: ${message}`);
  }
}

export class DelayedWriter {
  private readonly operationQueue: Operation[] = [];
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly inputs: string[] = [];
  private isExecuting = false;

  constructor(
    private readonly reader: Deno.Reader = Deno.stdin,
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

  private pushWaitOperation(time: number) {
    this.operationQueue.push(() => {
      let clearFn: () => void;
      const promise = new Promise<void>((resolve, reject) => {
        const handle = setTimeout(resolve, time);

        clearFn = () => {
          clearTimeout(handle);
          reject(new DelayedWriterError("operation canceled"));
        };
      });

      return [clearFn!, promise] as const;
    });
  }

  private pushTextOperation(text: string) {
    this.operationQueue.push(() => {
      const promise = this.writer.write(this.encoder.encode(text));

      return [noop, promise] as const;
    });
  }

  private pushWriteOperation(text: string, time: number) {
    if (time === 0) {
      this.pushTextOperation(text);

      return;
    }

    const delayBetweenLetters = (time / text.length) | 0;
    let first = false;
    for (const letter of text) {
      if (!first) {
        this.pushWaitOperation(delayBetweenLetters);
      } else {
        first = true;
      }

      this.pushTextOperation(letter);
    }
  }

  private pushInputOperation(prompt: string | undefined, time: number) {
    if (prompt) {
      this.pushWriteOperation(prompt, time);
    }

    this.operationQueue.push(() => {
      const it = readline(this.reader);

      const promise = it.next().then(({ value }) => {
        this.inputs.push(this.decoder.decode(value));
      });

      return [noop, promise] as const;
    });
  }

  wait(time = this.time): this {
    this.assertNotExecuting();
    this.time = time;
    this.pushWaitOperation(time);
    return this;
  }

  write(text: string, time = this.time): this {
    this.assertNotExecuting();
    this.time = time;
    this.pushWriteOperation(text, time);
    return this;
  }

  input(prompt?: string, time = this.time): this {
    this.assertNotExecuting();
    this.time = time;
    this.pushInputOperation(prompt, time);
    return this;
  }

  async do(abort?: AbortSignal): Promise<string[]> {
    this.isExecuting = true;

    let lastCancelFn: () => void;
    let inputs: string[];

    const cleanup = () => {
      abort?.removeEventListener("abort", lastCancelFn);
      this.operationQueue.splice(0);
      inputs = this.inputs.splice(0);
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

    return inputs!;
  }
}

export const wait = (time: number): DelayedWriter =>
  new DelayedWriter().wait(time);

export const write = (text: string, time: number): DelayedWriter =>
  new DelayedWriter().write(text, time);

export const doWait = (time: number, abort?: AbortSignal): Promise<void> =>
  wait(time).do(abort).then(noop);

export const doWrite = (
  text: string,
  time: number,
  abort?: AbortSignal,
): Promise<void> => write(text, time).do(abort).then(noop);

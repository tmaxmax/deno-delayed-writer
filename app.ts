import { write } from "./mod.ts";

const abortAfter = (time: number) => {
  const abort = new AbortController();
  const handle = setTimeout(() => abort.abort(), time);

  return [abort.signal, () => clearTimeout(handle)] as const;
};

await write("Hello world!\n", 500)
  .wait()
  .write("How are you?\n")
  .wait()
  .write(`I'm glad you're fine!\n`)
  .do();

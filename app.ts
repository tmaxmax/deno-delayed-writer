import { write } from "./mod.ts";

const abortAfter = (time: number) => {
  const abort = new AbortController();
  const handle = setTimeout(() => abort.abort(), time);

  return [abort.signal, () => clearTimeout(handle)] as const;
};

const [signal, clearAbort] = abortAfter(1600);

const [howIsUser] = await write("Hello world!\n", 500)
  .wait()
  .input("How are you? ")
  .wait()
  .do(signal);

clearAbort();
console.log(howIsUser);

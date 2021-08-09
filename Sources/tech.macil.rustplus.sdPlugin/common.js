"use strict";

function newPromiseDefer() {
  let resolve, reject;
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
}

function parseConnectionConfig(connectionConfigStr) {
  if (!connectionConfigStr) {
    return null;
  }
  try {
    // TODO can we parse this without using eval? Maybe we can
    // use a regex on the string and then JSON.parse it.
    const indirectEval = eval;
    return indirectEval("(" + connectionConfigStr + ")");
  } catch (e) {
    return null;
  }
}

// Compares what the voice was asked to say with what speech recognition heard.

function tokens(s: string): string[] {
  const raw = s
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}%]/gu, ""))
    .filter(Boolean);
  // join spelled-out letters ("c. a. c." -> "cac")
  const out: string[] = [];
  let run = "";
  for (const w of raw) {
    if (w.length === 1 && /\p{L}/u.test(w)) run += w;
    else {
      if (run) out.push(run);
      run = "";
      out.push(w);
    }
  }
  if (run) out.push(run);
  return out;
}

/** Words in `expected` that recognition didn't hear (order-aware LCS). */
export function missingWords(expected: string, heard: string): string[] {
  const a = tokens(expected);
  const b = tokens(heard);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const miss: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length) {
    if (j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < b.length && dp[i][j + 1] >= dp[i + 1][j]) j++;
    else {
      miss.push(a[i]);
      i++;
    }
  }
  return miss;
}

/**
 * Offset -> 1-based line lookup for one source text: the line starts are
 * computed once, then every lookup is a binary search. Both the AST walker
 * and the text scanner report many lines per file, so a linear scan per
 * lookup would be quadratic on large files.
 */
export const makeLineIndex = (text: string): ((offset: number) => number) => {
  const starts: Array<number> = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
};

/** Lines that contain anything but whitespace: the LOC measure of every file row. */
export const countLoc = (text: string): number => {
  let loc = 0;
  let blank = true;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      if (!blank) loc++;
      blank = true;
    } else if (blank && code !== 32 && code !== 9 && code !== 13) {
      blank = false;
    }
  }
  return blank ? loc : loc + 1;
};

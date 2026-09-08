// Turn a heat-list headline into a single discussion prompt.  Headlines often
// bundle an event, a person and several claims; keeping the headline as the
// question makes the first retrieval query unnecessarily diffuse.

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().replace(/[。！!]+$/, '');
}

/**
 * Returns one question for retrieval, while leaving the original headline to
 * be kept as background.  Existing questions are preserved verbatim; for a
 * declarative headline we ask the user to verify its central claim instead of
 * pretending to know which conclusion they want.
 */
export function makeHotlistCoreQuestion(title: string): string {
  const cleaned = cleanTitle(title);
  if (!cleaned) return '';
  if (/[？?]$/.test(cleaned)) return cleaned;
  return `围绕“${cleaned}”，其中最值得核实的核心说法是什么？`;
}

export function hotlistBackground(title: string, coreQuestion: string): string | null {
  const cleaned = cleanTitle(title);
  return cleaned && cleaned !== coreQuestion ? `热榜背景：${cleaned}` : null;
}

// Remove only unambiguous disfluencies. Keep meaningful replies and Japanese words
// such as あの (that), ええ (yes), and うん (yes).
export function cleanCaption(text, enabled = true) {
  if (!enabled) return text.trim();
  return text.replace(/\b(?:um+|uh+|erm+)\b[ ,]*/gi, '')
    .replace(/(^|[\s、。])(?:えー+と|えー+|えっと|ええと)(?:[\s、]+|$)/g, '$1')
    .replace(/\s{2,}/g, ' ').trim();
}
export function languageOf(text) { return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text) ? 'ja' : 'en'; }
export function orderedItems(items) {
  const byId = new Map(items.map(x => [x.id, x]));
  const result = [], visiting = new Set(), visited = new Set();
  function visit(item) {
    if (visited.has(item.id) || visiting.has(item.id)) return;
    visiting.add(item.id);
    if (byId.has(item.previous)) visit(byId.get(item.previous));
    visited.add(item.id); result.push(item);
  }
  items.forEach(visit); return result;
}
// 100 ms PCM frames. Adaptive energy gate is deliberately modest: it rejects
// quiet background, not every cough or laugh. Recognition still decides content.
export class SpeechGate {
  constructor() { this.floor = .003; this.pre = []; this.active = false; this.frames = 0; this.quiet = 0; }
  push(frame, rms) {
    const speech = rms > Math.max(.009, this.floor * 3);
    if (!this.active) {
      if (!speech) this.floor = .97 * this.floor + .03 * Math.min(rms, this.floor * 2);
      this.pre.push(frame); if (this.pre.length > 3) this.pre.shift();
      if (!speech) return { frames: [], commit: false };
      this.active = true; this.frames = this.pre.length; this.quiet = 0;
      const frames = this.pre; this.pre = []; return { frames, commit: false };
    }
    this.frames++; this.quiet = speech ? 0 : this.quiet + 1;
    // Finalize after 600 ms silence, or at a pause after 4 s, or at 8 s.
    const commit = this.quiet >= 6 || (this.frames >= 40 && this.quiet >= 3) || this.frames >= 80;
    if (commit) { this.active = false; this.frames = 0; this.quiet = 0; }
    return { frames: [frame], commit };
  }
  finish() { const active = this.active; this.active = false; this.pre = []; return active; }
}

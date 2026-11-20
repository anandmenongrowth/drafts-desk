/* Drafts Desk core - pure logic, no DOM, no network. Shared by the app (browser) and the tests (Node). */
(function (root) {
  const pad = n => String(n).padStart(2, '0');

  /** id for a new idea file, e.g. 2026-11-20-0915-tiering-is-the-part */
  function ideaId(text, now) {
    const d = now || new Date();
    const slug = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join('-').slice(0, 32) || 'idea';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '-' + slug;
  }

  /** idea file text */
  function ideaFile(text, buildOn) {
    return 'build_on: ' + (buildOn || 'none') + '\n\n' + String(text || '').trim() + '\n';
  }

  /** parse an idea file into {buildOn, body} */
  function parseIdea(txt) {
    const t = String(txt || '').replace(/\r/g, '');
    const m = t.match(/^build_on:\s*(.*)\n+/);
    return { buildOn: m ? m[1].trim() : 'none', body: (m ? t.slice(m[0].length) : t).trim() };
  }

  /** parse short-posts/<id>.md written by the mdf-short-post agent */
  function parsePost(txt) {
    const t = String(txt || '').replace(/\r/g, '');
    const parts = t.split(/^## /m);
    const head = parts.shift() || '';
    const get = (blk, k) => { const m = blk.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')); return m ? m[1].trim() : ''; };
    const out = { status: get(head, 'status') || 'ready', check: get(head, 'check'), question: get(head, 'question'), alt: get(head, 'alternative'), variants: [], editor: '', sources: '' };
    parts.forEach(p => {
      const title = p.split('\n')[0].trim();
      const body = p.slice(p.indexOf('\n') + 1);
      if (/^Variant\s+([AB])/i.test(title)) {
        const lines = body.split('\n');
        const meta = {}; let i = 0;
        while (i < lines.length && (/^(persona|hook):/i.test(lines[i]) || lines[i].trim() === '')) {
          const m = lines[i].match(/^(persona|hook):\s*(.*)$/i);
          if (m) meta[m[1].toLowerCase()] = m[2].trim();
          i++;
          if (meta.persona !== undefined && meta.hook !== undefined) break;
        }
        out.variants.push({ id: title.match(/^Variant\s+([AB])/i)[1].toUpperCase(), persona: meta.persona || '', hook: meta.hook || '', text: lines.slice(i).join('\n').trim() });
      } else if (/^Editor/i.test(title) || /^Self review/i.test(title)) out.editor = body.trim();
      else if (/^Sources/i.test(title)) out.sources = body.trim();
    });
    return out;
  }

  /** where an idea sits, from its post (parsed or null) and decision (object or null) */
  function stateOf(post, dec) {
    if (dec && (dec.action === 'posted' || dec.action === 'park' || dec.action === 'long')) return dec.action;
    if (dec && dec.action === 'revise' && !dec.handled) return 'revising';
    if (!post) return 'drafting';
    return post.status || 'ready';
  }

  const LABEL = { drafting: 'Drafting', revising: 'Revising', ready: 'Ready', 'needs-more': 'Needs more', repeat: 'Repeat', posted: 'Posted', park: 'Parked', long: 'Long article' };

  /** slug for a new long post, valid for the pipeline engine (a-z, 0-9, hyphens) */
  function slugify(title, now) {
    const d = now || new Date();
    const base = String(title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean).slice(0, 6).join('-').slice(0, 40).replace(/-+$/, '') || 'post';
    return base + '-' + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  /** topics.md written by the topic scout step, three options */
  function parseTopics(txt) {
    const get = (blk, k) => { const m = blk.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')); return m ? m[1].trim() : ''; };
    return String(txt || '').replace(/\r/g, '').split(/^## /m).slice(1).map(b => ({ question: get(b, 'question'), persona: get(b, 'persona'), source: get(b, 'source') })).filter(o => o.question);
  }

  /** first line of review.md, 'verdict: PASS' or 'verdict: FIX' */
  function verdict(txt) {
    const m = String(txt || '').match(/^\s*verdict:\s*([\w-]+)/i);
    return m ? m[1].toUpperCase() : '';
  }

  /** compact relative time */
  function relTime(iso, now) {
    const t = Date.parse(iso); if (isNaN(t)) return '';
    const m = Math.round(((now || Date.now()) - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  /** the numbered stages of a post (steps sharing the same n are one stage), with done / current flags */
  function stages(steps, post) {
    const map = new Map();
    steps.forEach(s => { if (!map.has(s.n)) map.set(s.n, { n: s.n, label: s.group, ids: [] }); map.get(s.n).ids.push(s.id); });
    const done = post.done || [];
    return [...map.values()].map(g => ({
      n: g.n, label: g.label,
      done: post.state === 'done' || g.ids.every(i => done.includes(i)),
      current: post.state !== 'done' && g.ids.includes(post.step)
    }));
  }

  /** what to show for a post's state */
  const POST_STATE = { running: ['Claude is working', 'dim'], waiting: ['Your turn', 'ready'], ready: ['Ready to run', 'ready'], error: ['Needs attention', 'warn'], done: ['Published', 'posted'], queued: ['Sent to Claude', 'dim'], deleting: ['Deleting', 'dim'] };

  const C = { ideaId, ideaFile, parseIdea, parsePost, stateOf, LABEL, slugify, parseTopics, verdict, relTime, stages, POST_STATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = C; else root.DD = C;
})(typeof window !== 'undefined' ? window : globalThis);

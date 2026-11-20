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
    const out = { status: get(head, 'status') || 'ready', check: get(head, 'check'), question: get(head, 'question'), alt: get(head, 'alternative'), variants: [], editor: '' };
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
      } else if (/^Editor/i.test(title)) out.editor = body.trim();
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

  const C = { ideaId, ideaFile, parseIdea, parsePost, stateOf, LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = C; else root.DD = C;
})(typeof window !== 'undefined' ? window : globalThis);

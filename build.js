/* Content/build.py, ported for the preview.

   buildContent(src, include) turns source.json into the content.json the web
   page reads: the published questions, plus the question `include` whatever
   its status (a draft, a hidden or archived post), written out as published
   so the page shows it the way readers will once it is.

   Keep this in step with build.py, line for line. Tools/check-editor-build.mjs
   builds the published set both ways and fails if they differ.

   build.py stops at the first bad row; a preview should still draw while a
   post is half-written, so here a bad row is left out and named in
   `problems` instead. Validation (the quote rule) is not run here: the
   editor's Check and the publish build do that. */

function buildContent(src, include) {
  const problems = [];
  const voices = new Map(src.voices.map(v => [v.id, v]));
  const works  = new Map(src.works.map(w => [w.id, w]));
  const outQuestions = [], outResponses = [];
  const usedVoices = new Set(), usedWorks = new Set();
  const get = (o, k, d = null) => (o && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : d;

  const live = src.questions.filter(q => q.status === 'published' || q.id === include)
                            .sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);

  live.forEach((q, i) => {
    const answers = {};
    for (const o of q.options) answers[o.key] = { verdict: null, verdictSub: null, responseIds: [], workIds: [] };
    const seen = new Set(), counter = {};
    for (const r of q.responses) {
      const vid = r.voice;
      if (!voices.has(vid)) { problems.push(`${q.id}: unknown voice ${vid}`); continue; }
      if (seen.has(vid)) { problems.push(`${q.id}: ${vid} appears twice`); continue; }
      seen.add(vid);
      const opt = r.option;
      if (!(opt in answers)) { problems.push(`${q.id}: ${vid} holds unknown option ${opt}`); continue; }
      const n = counter[opt] || 0; counter[opt] = n + 1;
      const rid = `${q.id}.${opt}.${n}`;
      const v = voices.get(vid);
      const quote = get(r, 'quote');
      outResponses.push({
        id: rid, questionId: q.id, optionKey: opt,
        voiceId: `v-${vid}`, kind: get(r, 'kind', v.kind),
        claim: r.claim, detail: get(r, 'detail'), extra: null,
        quote: quote ? quote.text : null,
        origin: get(r, 'origin', v.origin),
        source: quote ? { label: quote.source, url: get(quote, 'url') } : null,
      });
      answers[opt].responseIds.push(rid);
      usedVoices.add(vid);
    }

    const perOption = q.options.some(o => 'works' in o);
    for (const o of q.options) {
      for (const wid of (perOption ? get(o, 'works', []) : get(q, 'works', []))) {
        if (!works.has(wid)) { problems.push(`${q.id}: unknown work ${wid}`); continue; }
        usedWorks.add(wid);
        answers[o.key].workIds.push(`w-${wid}`);
      }
    }

    outQuestions.push({
      id: q.id, index: i, date: q.date, status: 'published',
      title: q.title, why: q.why,
      baselinePct: get(q, 'baselinePct'), joined: get(q, 'joined'),
      votesArePlaceholder: get(q, 'votesArePlaceholder', false),
      options: q.options.map(o => ({ key: o.key, label: o.label })),
      answers,
      ...(q.topics && q.topics.length ? { topics: q.topics } : {}),
    });
  });

  for (const vid of [...usedVoices])
    for (const wid of (voices.get(vid).works || [])) if (works.has(wid)) usedWorks.add(wid);

  const voiceOut = (v) => ({
    id: `v-${v.id}`, name: v.name, kind: v.kind, type: v.type,
    origin: v.origin, wiki: get(v, 'wiki'), reach: get(v, 'reach'),
    image: get(v, 'image'),
    workIds: (v.works || []).filter(w => works.has(w)).map(w => `w-${w}`),
  });
  const workOut = (w) => ({
    id: `w-${w.id}`, title: { en: w.title, zh: w.title },
    author: w.author, year: w.year, place: w.place,
    desc: w.desc, why: w.why, wiki: get(w, 'wiki'),
    image: get(w, 'image'),
    authorWiki: null, authorBlurb: null,
  });

  return {
    content: {
      strings: src.strings, kinds: src.kinds, optionStyle: src.optionStyle,
      questions: outQuestions, responses: outResponses,
      voices: src.voices.filter(v => usedVoices.has(v.id)).map(voiceOut),
      works:  src.works.filter(w => usedWorks.has(w.id)).map(workOut),
      upcoming: [],
    },
    problems,
  };
}

/* The id build.py gives a reply: question, option, and its place among that
   option's replies in source order. The preview scrolls to it by this id. */
function responseId(q, r) {
  let n = 0;
  for (const x of q.responses) { if (x === r) break; if (x.option === r.option) n++; }
  return `${q.id}.${r.option}.${n}`;
}

if (typeof module !== 'undefined') module.exports = { buildContent, responseId };

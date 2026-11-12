/* Prompts handed to Claude. The house rules live here, so every generated post
   arrives already holding the standard the validator enforces. */

const HOUSE_RULES = `
You are drafting for Still, an app where historical thinkers appear as the
comment section under a question about modern life.

Rules that outrank everything else:
1. NEVER invent a quotation. Every response must carry a VERBATIM quote you are
   confident is genuinely that author's, from that work, at that location.
   If you cannot place a real quote, choose a different thinker who can be quoted.
2. Name the translator whenever the English is a translator's work, and prefer
   public-domain translations that can be linked on Wikisource.
3. For Chinese, Sanskrit or Pali sources the "zh" quote must be the ORIGINAL
   text, not a translation back from English.
4. Never invent vote counts, participant numbers or percentages.
5. Every voice votes FOR one option. There is no "against" — a thinker who
   rejects option A holds B or C, and that is where they go.
6. One voice may appear only ONCE per question.
7. "claim" is written in the FIRST PERSON, as the thinker speaking: one or two
   plain sentences restating what their own texts argue ("I argued that a child
   should learn from things before books"). It must never speak to the modern
   case as if they answered it ("about your phone, I'd say..."). "detail" is two
   or three sentences in our own third-person voice: what the text was about,
   that applying it here is our step, and the strongest objection to the
   position or where it fails. Neither may be phrased as a quote.
8. EXACTLY THREE options, A, B and C, and they must be truly different answers:
   mutually exclusive choices about what to do or what is right, never a cause
   vs an evaluation vs a mechanism. Test: could someone sensibly pick two at
   once? If yes, rewrite them. Bad: "success comes from effort / we admire the
   rich / it rests on others' labour" (all can be true at once). Good: "Should
   luck change how much a person deserves? No / Yes, partly / Yes, entirely."
9. Spread the voices across all three options, at least two on each.
   Disagreement is the point. Prefer a surprise the texts truly support (Adam
   Smith criticising the worship of the rich) over stereotyped casting.

Voice "kind" must be one of: philosophy, religiousTeaching, evidence,
speculation, contestedArgument.
Voice "type" must be one of: person, text, school, community, field.

Reply with ONE fenced json block and nothing else.
`.trim();

/* What the editors have liked so far: the "For the drafter" section of
   Content/editor-feedback-summary.md (Docs/editor-role.md), which app.js reads
   from the private repo at load. It never lives in this file, which is public.
   A description of taste, ranked below the house rules. */
function tasteNote(taste) {
  if (!taste) return '';
  return `

What our editors have rated well and badly so far (1–5 stars per draft). Lean
toward what scored well; never copy a past post, and never bend a rule above
to chase a score:
${taste}`;
}

function promptNewPost(existingVoices, taste) {
  return `${HOUSE_RULES}${tasteNote(taste)}

Write ONE complete post: a provocative question about modern life, exactly
three mutually exclusive answers, and 6–8 responses from historical thinkers.

Prefer these voices where they genuinely fit, so the library stays connected —
but add new ones freely if the question calls for them:
${existingVoices.join(', ')}

Shape:
\`\`\`json
{
  "id": "q-short-slug",
  "date": "YYYY-MM-DD",
  "status": "draft",
  "title": {"en": "...", "zh": "..."},
  "why":   {"en": "2–3 sentences setting up the real question", "zh": "..."},
  "options": [
    {"key":"A","label":{"en":"...","zh":"..."}},
    {"key":"B","label":{"en":"...","zh":"..."}},
    {"key":"C","label":{"en":"...","zh":"..."}}
  ],
  "works": [],
  "newVoices": [
    {"id":"slug","name":{"en":"...","zh":"..."},"kind":"philosophy","type":"person",
     "origin":{"en":"Athens, c. 300 BCE","zh":"雅典，约公元前 300 年"},
     "wiki":"Wikipedia_article_title",
     "reach":{"weight":50,"note":{"en":"why this voice carries weight","zh":"..."}},"works":[]}
  ],
  "responses": [
    {"voice":"slug","option":"A",
     "claim":{"en":"...","zh":"..."},
     "detail":{"en":"...","zh":"..."},
     "quote":{"text":{"en":"verbatim","zh":"original or translation"},
              "source":{"en":"Author, Work I.2, trans. Name","zh":"..."},
              "url":"https://en.wikisource.org/wiki/...","verified":false}}
  ]
}
\`\`\``;
}

function promptRewrite(instruction, label, value, context) {
  return `${HOUSE_RULES}

Rewrite one field of an existing Still post.

Field: ${label}
Instruction: ${instruction}

Context — the post this belongs to:
${context}

Current text:
EN: ${value.en}
ZH: ${value.zh}

Keep both languages saying the same thing. Do not turn a paraphrase into
something that reads as a quotation. Reply with only:
\`\`\`json
{"en":"...","zh":"..."}
\`\`\``;
}

function promptResponses(question, existingVoices, n, taste) {
  return `${HOUSE_RULES}${tasteNote(taste)}

Add ${n} more responses to an existing question. Do not repeat any voice
already present, and put them where the spread is thinnest.

Question: ${question.title.en}
Setup: ${question.why.en}
Options: ${question.options.map(o => `${o.key} — ${o.label.en}`).join(' · ')}
Voices already here: ${question.responses.map(r => r.voice).join(', ') || 'none'}

Voices available to reuse: ${existingVoices.join(', ')}

\`\`\`json
{
  "newVoices": [],
  "responses": [
    {"voice":"slug","option":"A",
     "claim":{"en":"...","zh":"..."},
     "detail":{"en":"...","zh":"..."},
     "quote":{"text":{"en":"...","zh":"..."},
              "source":{"en":"Author, Work I.2, trans. Name","zh":"..."},
              "url":"https://en.wikisource.org/wiki/...","verified":false}}
  ]
}
\`\`\``;
}

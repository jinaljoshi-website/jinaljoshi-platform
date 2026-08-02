// backend/lib/merchDesign.js
// Turns a fan's name into printable design options.
//
// Deliberately NOT an image-generation model. Two reasons, both fatal here:
// diffusion models mangle lettering, and the one thing this design must get
// right is somebody's own name; and a 1024px raster cannot be printed at 25cm.
// Claude writing SVG gives real text in real fonts, vector output that scales to
// any print size, and something we can inspect and constrain before it is
// committed to fabric.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Qikink's DTF minimum stroke width is still to be confirmed with them. Until
// it is, 1.2mm is used as a conservative floor — thin strokes are the thing that
// fails to transfer, and a slightly heavy design is recoverable where a broken
// letterform on a customer's shirt is not.
const MIN_STROKE_MM = 1.2;
const MM_PER_INCH   = 25.4;

// A compact chest print sits under Qikink's Rs.80 minimum print charge, where a
// full-front or back print is charged by the square inch. Designing to this size
// is both cheaper and better looking on a garment.
const PRINT_SIZES = {
  chest:      { widthIn: 10, heightIn: 5,  placement: 'fr' },
  fullFront:  { widthIn: 12, heightIn: 14, placement: 'fr' },
  back:       { widthIn: 14, heightIn: 16, placement: 'bk' },
  pocket:     { widthIn: 4,  heightIn: 4,  placement: 'lp' },
};

function minStrokePx(widthIn, viewBoxWidth) {
  // Stroke floor expressed in the SVG's own coordinate space.
  const pxPerMm = viewBoxWidth / (widthIn * MM_PER_INCH);
  return +(MIN_STROKE_MM * pxPerMm).toFixed(2);
}

const SYSTEM = `You design typographic apparel graphics for a single fashion label.

The label belongs to Jinal Joshi — an Indian actor. The visual language is
restrained and editorial: generous letter-spacing, a lot of empty space, one
idea per design. It is not streetwear, not novelty, not cute. Think of a considered
fashion label rather than fan merchandise.

You will be given a person's name. Produce designs built around that name.

RULES, all of them hard:
- Output ONLY a JSON array. No prose, no markdown, no code fences.
- Every design is a complete standalone SVG string.
- Use only these font families: 'Cormorant Garamond', serif — or a generic
  sans-serif stack. Nothing else will render at the printer.
- All text must be real <text> elements. Never convert to paths, never use
  images, never use external references.
- No gradients, no filters, no opacity below 0.85, no drop shadows. These do not
  survive DTF transfer.
- Minimum stroke width is given to you. Nothing thinner, anywhere.
- Use at most two colours plus the garment showing through.
- The design must read at arm's length. If it needs to be studied, it is wrong.

Return exactly this shape:
[{"name":"short label","rationale":"one sentence","svg":"<svg .../>"}]`;

function buildPrompt({ fanName, sizeKey, garmentColour, count }) {
  const size = PRINT_SIZES[sizeKey] || PRINT_SIZES.chest;
  const vbW = 1000;
  const vbH = Math.round(vbW * (size.heightIn / size.widthIn));

  return `Name: ${fanName}

Canvas: viewBox="0 0 ${vbW} ${vbH}" — this prints at ${size.widthIn} x ${size.heightIn} inches.
Garment colour: ${garmentColour}. The design must read clearly on it.
Minimum stroke width: ${minStrokePx(size.widthIn, vbW)} units. Nothing thinner.

Produce ${count} genuinely different treatments. Different means a different
IDEA — not the same layout in another font. Vary between: the name set large and
alone; initials as a monogram; the name broken across lines; the name small with
generous space around it.

Every design must include the words "Designed by JJ" as a small, quiet element —
part of the composition, not a sticker added on. It should be legible but never
compete with the name.

Keep at least 8% clear margin on all sides.`;
}

// The model returns a design, not a guarantee. Anything that reaches a printer
// is checked here first — a bad SVG is a wasted garment and an unhappy fan.
function validateSvg(svg, { widthIn, viewBoxWidth }) {
  const problems = [];
  if (!svg || typeof svg !== 'string') return ['empty'];
  if (!/^<svg[\s>]/.test(svg.trim())) problems.push('does not start with <svg>');
  if (!/<\/svg>\s*$/.test(svg.trim()))  problems.push('not closed');
  if (/<image|xlink:href|href\s*=\s*["']https?:/i.test(svg)) problems.push('external reference');
  if (/<script|onload=|onclick=/i.test(svg))                 problems.push('script content');
  if (/filter\s*[:=]|<filter|feGaussian/i.test(svg))         problems.push('filter — will not print');
  if (/<linearGradient|<radialGradient/i.test(svg))          problems.push('gradient — will not print');
  if (!/<text[\s>]/.test(svg))                               problems.push('no real text element');

  const floor = minStrokePx(widthIn, viewBoxWidth);
  for (const m of svg.matchAll(/stroke-width\s*[:=]\s*["']?([\d.]+)/gi)) {
    if (parseFloat(m[1]) < floor) { problems.push(`stroke ${m[1]} below ${floor}`); break; }
  }
  return problems;
}

async function generateDesigns({ fanName, sizeKey = 'chest', garmentColour = 'black', count = 4 }) {
  const clean = String(fanName || '').trim().slice(0, 40);
  if (!clean) throw new Error('A name is required');

  const size = PRINT_SIZES[sizeKey] || PRINT_SIZES.chest;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':          process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt({ fanName: clean, sizeKey, garmentColour, count }) }],
    }),
  });

  if (!res.ok) throw new Error(`Design service returned ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error('Could not read the generated designs');
  }
  if (!Array.isArray(parsed)) throw new Error('Unexpected design format');

  // Invalid options are dropped rather than shown. A fan choosing a design that
  // cannot be printed is worse than being offered three instead of four.
  return parsed
    .map((d) => ({
      name:      String(d.name || 'Untitled').slice(0, 40),
      rationale: String(d.rationale || '').slice(0, 200),
      svg:       d.svg,
      problems:  validateSvg(d.svg, { widthIn: size.widthIn, viewBoxWidth: 1000 }),
    }))
    .filter((d) => {
      if (d.problems.length) console.warn('design rejected:', d.name, d.problems.join('; '));
      return d.problems.length === 0;
    })
    .map(({ problems, ...keep }) => ({ ...keep, ...size }));
}

module.exports = { generateDesigns, validateSvg, PRINT_SIZES, MIN_STROKE_MM, minStrokePx };
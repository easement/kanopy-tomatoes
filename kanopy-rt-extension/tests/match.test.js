const assert = require('assert')

const normalizeTitleForMatch = (rawTitle) => {
  if (!rawTitle) return ''
  return String(rawTitle)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const tokenizeTitle = (normalizedTitle) => {
  if (!normalizedTitle) return []
  const drop = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'for', 'with'])
  return normalizedTitle
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length > 1)
    .filter((t) => !drop.has(t))
}

const jaccardSimilarity = (aTokens, bTokens) => {
  const a = new Set(aTokens)
  const b = new Set(bTokens)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

const computeCandidateScore = ({ targetTitle, targetYear, candidateTitle, candidateYear }) => {
  const targetNorm = normalizeTitleForMatch(targetTitle)
  const candNorm = normalizeTitleForMatch(candidateTitle)

  const targetTokens = tokenizeTitle(targetNorm)
  const candTokens = tokenizeTitle(candNorm)

  const tokenSim = jaccardSimilarity(targetTokens, candTokens)
  const exactNorm = targetNorm && candNorm && targetNorm === candNorm

  let yearScore = 0
  if (targetYear && candidateYear) {
    const diff = Math.abs(Number(targetYear) - Number(candidateYear))
    if (diff === 0) yearScore = 1
    else if (diff === 1) yearScore = 0.6
    else if (diff === 2) yearScore = 0.2
    else yearScore = -0.5
  } else if (!targetYear) {
    yearScore = 0.2
  }

  const titleScore = exactNorm ? 1 : tokenSim
  return titleScore * 10 + yearScore * 3
}

const pickBestCandidate = (candidates, targetTitle, targetYear) => {
  let best = null
  let bestScore = -Infinity
  for (const candidate of candidates) {
    const score = computeCandidateScore({
      targetTitle,
      targetYear,
      candidateTitle: candidate.title,
      candidateYear: candidate.year,
    })
    if (score > bestScore) {
      bestScore = score
      best = { ...candidate, score }
    }
  }
  return best
}

// normalizeTitleForMatch
assert.strictEqual(normalizeTitleForMatch("C'mon C'mon"), 'cmon cmon')
assert.strictEqual(normalizeTitleForMatch('Amélie'), 'amelie')
assert.strictEqual(normalizeTitleForMatch('Wall·E'), 'wall e')
assert.strictEqual(normalizeTitleForMatch('A & B'), 'a and b')

// tokenizeTitle / similarity
assert.deepStrictEqual(tokenizeTitle('the good the bad and the ugly'), ['good', 'bad', 'ugly'])
assert.ok(jaccardSimilarity(['good', 'bad'], ['good', 'bad', 'ugly']) > 0.6)

// scoring prefers exact title even if year absent
{
  const best = pickBestCandidate(
    [
      { url: '/x', title: 'Some Other Movie', year: '2020' },
      { url: '/y', title: "C'mon C'mon", year: '2021' },
    ],
    "C'mon C'mon",
    null
  )
  assert.strictEqual(best.url, '/y')
}

// scoring uses soft year to break ties
{
  const best = pickBestCandidate(
    [
      { url: '/a', title: 'The Thing', year: '1982' },
      { url: '/b', title: 'The Thing', year: '2011' },
    ],
    'The Thing',
    '1982'
  )
  assert.strictEqual(best.url, '/a')
}

// scoring accepts +/-1 year drift over a wrong title
{
  const best = pickBestCandidate(
    [
      { url: '/a', title: 'Drive', year: '2012' }, // close year but same title
      { url: '/b', title: 'Driver', year: '2011' }, // exact year but different title
    ],
    'Drive',
    '2011'
  )
  assert.strictEqual(best.url, '/a')
}

console.log('match.test.js OK')


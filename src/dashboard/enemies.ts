/**
 * Enemy system: turns a solved problem into a samurai-world enemy.
 *
 * Pure logic, no DOM, no dependencies. Tier comes from LeetCode's acceptance
 * rate when it is known, and falls back to difficulty when it is not, so this
 * works today and gets sharper once `acceptanceRate` is added to ProblemSummary.
 */

export type EnemyTier = 'grunt' | 'soldier' | 'elite' | 'boss';

export interface EnemyInput {
  difficulty: string;
  officialTags: readonly string[];
  /** Percent, 0-100, as shown on LeetCode. Optional until the data layer provides it. */
  acceptanceRate?: number | null;
}

export interface Enemy {
  tier: EnemyTier;
  name: string;
  kanji: string;
  tierLabel: string;
  /** 0-100. Higher means a tougher enemy (100 - acceptance rate). */
  toughness: number | null;
}

/**
 * Lower bounds, highest first. Tune these against your own data.
 * LeetCode acceptance rates are mostly 25-75%, so thresholds near 85% would
 * leave almost nothing in the lowest tier.
 */
export const TIER_FLOORS: readonly { tier: EnemyTier; min: number }[] = [
  { tier: 'grunt', min: 60 },
  { tier: 'soldier', min: 50 },
  { tier: 'elite', min: 40 },
  { tier: 'boss', min: 0 },
];

const TIER_META: Record<EnemyTier, { title: string; kanji: string; label: string }> = {
  grunt: { title: 'Footman', kanji: '影', label: 'Grunt' },
  soldier: { title: 'Ronin', kanji: '浪', label: 'Soldier' },
  elite: { title: 'Oni Captain', kanji: '鬼', label: 'Elite' },
  boss: { title: 'Warlord', kanji: '将', label: 'Boss' },
};

const TAG_EPITHET: Record<string, string> = {
  Array: 'Lattice',
  String: 'Thread',
  'Hash Table': 'Lockpick',
  'Dynamic Programming': 'Labyrinth',
  Math: 'Abacus',
  Sorting: 'Ranking',
  Greedy: 'Hungry',
  'Depth-First Search': 'Abyss',
  'Breadth-First Search': 'Tide',
  'Binary Search': 'Halving',
  Tree: 'Cedar',
  'Binary Tree': 'Cedar',
  'Two Pointers': 'Twin-Blade',
  Stack: 'Tower',
  Graph: 'Web',
  'Linked List': 'Chain',
  Backtracking: 'Revenant',
  'Heap (Priority Queue)': 'Summit',
  'Sliding Window': 'Drifting',
  'Bit Manipulation': 'Flicker',
  Recursion: 'Echo',
};

function tierFromRate(rate: number): EnemyTier {
  for (const { tier, min } of TIER_FLOORS) {
    if (rate >= min) return tier;
  }
  return 'boss';
}

function tierFromDifficulty(difficulty: string): EnemyTier {
  switch (difficulty.toLowerCase()) {
    case 'easy':
      return 'grunt';
    case 'hard':
      return 'boss';
    default:
      return 'soldier';
  }
}

export function enemyFor(input: EnemyInput): Enemy {
  const rate = input.acceptanceRate;
  const known = typeof rate === 'number' && Number.isFinite(rate);
  const tier = known ? tierFromRate(rate) : tierFromDifficulty(input.difficulty);
  const meta = TIER_META[tier];
  const tag = input.officialTags.find((t) => TAG_EPITHET[t] !== undefined);
  const epithet = tag === undefined ? 'Shadow' : (TAG_EPITHET[tag] ?? 'Shadow');

  return {
    tier,
    name: `${epithet} ${meta.title}`,
    kanji: meta.kanji,
    tierLabel: meta.label,
    toughness: known ? Math.max(0, Math.min(100, Math.round(100 - rate))) : null,
  };
}
// Fuzzy product filter: maps a planner-supplied name ("BrewMaster Y") onto the
// stored KB product names (lowercased filename stems, "brewmaster y coffee machine").
const STOPWORDS = new Set(['the', 'a', 'an']);

function tokenize(name: string): string[] {
   return name
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t && !STOPWORDS.has(t));
}

// A stored name matches when every query token is a prefix of one of its tokens
// ("neobook air 14" → "neobook air 14 laptop"), or when the query without spaces
// is a prefix of the stored name without spaces ("brew master y" → "brewmaster y …").
export function matchProductNames(
   query: string,
   storedNames: readonly string[]
): string[] {
   const queryTokens = tokenize(query);
   if (!queryTokens.length) return [];
   const queryCompact = queryTokens.join('');

   return storedNames.filter((stored) => {
      const storedTokens = tokenize(stored);
      const tokenMatch = queryTokens.every((q) =>
         storedTokens.some((s) => s.startsWith(q))
      );
      return tokenMatch || storedTokens.join('').startsWith(queryCompact);
   });
}

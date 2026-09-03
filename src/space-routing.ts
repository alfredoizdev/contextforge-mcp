// Agent-driven space routing helper.
//
// When the agent saves a memory WITHOUT choosing a space, it lands in the
// project's default space — so in multi-space projects everything piles into
// one place. To fix that without silently re-routing on the server, we hand the
// agent the actual list of spaces right when it defaulted, so it can route the
// next save (and move this one). This builds that hint.

/**
 * Build the routing hint shown after a save that did not specify a space.
 *
 * @param spaceNames names of the routable (non-git) spaces in the project
 * @param maxShown   how many names to list before collapsing to "…"
 * @returns the hint string, or null when there are fewer than 2 spaces (nothing
 *          meaningful to route between)
 */
export function buildRoutingHint(
  spaceNames: string[],
  maxShown = 8,
): string | null {
  if (spaceNames.length < 2) return null;
  const shown = spaceNames.slice(0, maxShown).join(" · ");
  const overflow = spaceNames.length > maxShown ? " …" : "";
  return (
    `💡 No space chosen — this went to the default space. ` +
    `Route the next save by topic: pass space:"<name>". ` +
    `Your spaces: ${shown}${overflow}. ` +
    `Move this one with memory_move_item.`
  );
}

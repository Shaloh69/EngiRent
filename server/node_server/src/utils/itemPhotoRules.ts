/**
 * D-89 — how many listing photos an item must have.
 *
 * ONE number, used by the create route's validator and by updateItem, so the
 * two cannot drift apart.
 *
 * Why 3. The locker's item check compares what it photographs against these
 * listing photos, and the second physical test showed one angle is not enough:
 * a correct glue gun scored ~53 partly because one of its two listing photos
 * showed the OTHER side of it. With three angles the comparison always has a
 * view close to however the item ends up lying in the locker, and the check
 * scores the best-matching pairs rather than an average dragged down by a
 * view that could never match.
 *
 * The app enforces the same minimum, but that is a UX courtesy: this is the
 * authority. A client cannot be trusted to have a minimum, and older app
 * builds do not know about it.
 */
export const MIN_ITEM_PHOTOS = 3;

/** The message a person sees when a listing has too few photos. */
export function tooFewPhotosMessage(count: number): string {
  const missing = MIN_ITEM_PHOTOS - count;
  return (
    `Add ${missing} more photo${missing === 1 ? "" : "s"}: at least ${MIN_ITEM_PHOTOS} photos ` +
    `from different angles are needed so the locker can recognise your item when it is dropped off.`
  );
}

# Performer ownership isolation — status

Implemented fail-closed owner scoping for shared list APIs. Sharegram must send `GET /api/performers?user_id=<Firebase uid>` or `GET /api/sharegram/performers?user_id=<Sharegram account id>`; omission returns HTTP 400 by design. Backfill existing rows with `node server/scripts/backfill-performer-sharegram-owner.js`. The script only copies a known `Users.sharegramUserId` to a performer with a known `userId`; unresolvable rows are reported as skipped.

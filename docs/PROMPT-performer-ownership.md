# Performer ownership isolation — status

The original KYC flow assigns performers to the authenticated KYC user (`Performer.userId`). A signed Sharegram claim is optional metadata, not a prerequisite for safe ownership. Shared list APIs require an owner scope and never return a global list. Sharegram should call `GET /api/performers?firebase_uid=<Firebase uid>` or `GET /api/sharegram/performers?firebase_uid=<Firebase uid>`; `user_id` remains compatible for Firebase UID or canonical Sharegram account ID. `external_ids` only narrows an already owner-scoped list.


## Mandatory performer list ownership scope
Sharegram must send `GET /api/performers?user_id=<Firebase uid>` or `GET /api/sharegram/performers?user_id=<Sharegram account id>`. Omitting the scope is now an error by design: the API returns HTTP 400 and never exposes a global list. `external_ids` can be used as an explicit scope on `/api/sharegram/performers`.


## Firebase account and Sharegram owner claims
The Firebase ID token must identify a Firebase account with an email address. Custom-auth tokens may omit the email claim; KYC looks up the Firebase Auth user record by UID and returns `422 FIREBASE_EMAIL_REQUIRED` if no email is available.

The authenticated Firebase identity establishes the KYC user. New performers are owned by that KYC user through `Performer.userId`, matching the original flow; a Sharegram custom claim is optional metadata, not a prerequisite for safe KYC ownership. KYC never infers `sharegramUserId` from email, Firebase UID, or request-body data. When Sharegram needs its canonical account ID, use a trusted mapping/claim; otherwise list performers by Firebase UID.

## Mandatory performer list ownership scope
Sharegram must request a creator-scoped list with `GET /api/performers?firebase_uid=<Firebase uid>` or `GET /api/sharegram/performers?firebase_uid=<Firebase uid>`. The compatible `user_id` parameter resolves as Firebase UID first and then Sharegram account ID. Requests without owner scope return HTTP 400. `external_ids` may narrow an owner-scoped result but is never ownership proof by itself.

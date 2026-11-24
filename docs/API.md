# Campus Find API

Base URL: your Render address, for example `https://campusfind-uid7.onrender.com`.
All bodies are JSON. Responses are JSON, except `GET /health`, which returns the text `ok`.

## Contents
- [Conventions](#conventions) · [Sign up and login](#sign-up-and-login) · [Browsing](#browsing)
- [Posting items](#posting-items) · [AI ownership questions](#ai-ownership-questions-found-items)
- [Claiming a found item](#claiming-a-found-item) · [Responding to a lost item](#responding-to-a-lost-item)
- [Contact and returns](#contact-and-returns) · [My activity](#my-activity) · [Reports](#reports)
- [Account](#account) · [Admin](#admin) · [Health](#health)

## Conventions

**Authentication.** Every route except sign-up, login, password reset and `/health` needs the header
`Authorization: Bearer <token>`. Tokens last 30 days. They stop working after the person uses
*sign out of all devices*, changes their password, or deletes the account.

**Errors.** Failures return `{ "error": "message you can show to the person" }` with one of these codes:

| Code | Meaning |
|---|---|
| 400 | The request is missing something or breaks a rule |
| 401 | Not logged in, or the session ended |
| 403 | Logged in, but not allowed to do this (or a wrong answer) |
| 404 | Not found, or no longer available to you |
| 409 | Conflict, such as an email already registered or an item already claimed |
| 422 | The photo or question check rejected the post |
| 429 | Too many requests or too many wrong attempts |
| 502 / 503 | A helper service (SMS or the AI photo check) is unavailable or not set up |

**Rate limits.** 300 requests per 15 minutes per IP overall. Login, sign-up, password and claim routes
allow 20 per 15 minutes per IP. Photo and question checks allow 15 per 15 minutes per person.

**Item values.** `type` is `FOUND` or `LOST`. `category` is `ID_CARD`, `PHONE`, `CARD`, `BAG`, `KEYS` or `OTHER`.
`status` is `OPEN`, `CLAIM_PENDING`, `VERIFIED` or `RETURNED`.

**Photos.** The app uploads photos straight to Cloudinary with an unsigned preset, then sends the
resulting `https://res.cloudinary.com/<your cloud>/...` URL. Any other image host is rejected.

---

## Sign up and login

### `POST /api/auth/register/start`
Checks the details and texts a 6-digit code. No account exists yet. If the server has
`REQUIRE_PHONE_VERIFY=false`, the account is created at once and the response is the same as
`/api/auth/register/verify`.

Body: `{ "full_name", "student_email", "phone", "password" }` (password 8+ characters, phone a Ghana number).
Response: `{ "message": "Code sent by SMS" }`.
Errors: 400 invalid details, 409 email or phone already registered, 429 asked again within a minute, 502 SMS failed.

### `POST /api/auth/register/verify`
Body: `{ "student_email", "code" }`. Codes last 10 minutes and allow 5 tries.
Response: `{ "token", "user": { "id", "full_name", "role" } }`.

### `POST /api/auth/login`
Body: `{ "student_email", "password" }`. Response: same as above. Error 401 for a wrong email or password.

```bash
curl -X POST $API/api/auth/login -H 'content-type: application/json' \
  -d '{"student_email":"ama@stu.ucc.edu.gh","password":"correct horse battery"}'
```

### `POST /api/auth/forgot`
Body: `{ "student_email" }`. Always answers `{ "message" }` the same way, so nobody can test which emails exist.
If the email is registered, a 6-digit code is texted to the phone on the account.

### `POST /api/auth/reset`
Body: `{ "student_email", "code", "new_password" }`. Signs out every device. Response: `{ "message" }`.

---

## Browsing

### `GET /api/items`
Query (all optional): `type`, `category`, `q` (searches title, masked ID and location).
Returns up to 100 open, visible items from the last 60 days, newest first.

```json
[{ "id": 12, "type": "FOUND", "category": "PHONE", "title": "Black Tecno phone",
   "description": "Blue case", "masked_identifier": null, "location": "Main Library",
   "handoff_zone": "Porter's Lodge", "image_url": "https://res.cloudinary.com/...",
   "status": "OPEN", "created_at": "2026-11-23T09:12:00Z",
   "security_question": null, "qcount": 3, "mine": false }]
```
`qcount` is the number of ownership questions. `mine` is true for the caller's own posts.
Phone numbers, full ID numbers and answers are never included.

---

## Posting items

### `POST /api/items`
Creates a post. Photo rules: a photo is required for `FOUND`, optional for `LOST`.
A server-side AI check must accept that the item fits the category and the photo shows it.

Body for **FOUND**:
`{ "type":"FOUND", "category", "title", "description", "identifier", "location", "handoff_zone", "image_url", "draft_id", "picks": [{ "slot": 0, "answer": "..." }, ...] }`
`draft_id` and `picks` come from the question generator below. At least 2 picks are required.

Body for **LOST**:
`{ "type":"LOST", "category", "title", "description", "identifier", "location", "handoff_zone", "image_url", "security_question", "security_answer" }`
For `ID_CARD`, `identifier` (the full ID number) is required. It is stored as a keyed hash, and the feed shows only the masked form.

Response `201`: `{ "id": 12 }`. Errors: 400 missing fields or invalid image URL, 422 the check rejected it, 429, 502, 503.

### `PATCH /api/items/:id/photo`
Adds or replaces the photo. Body `{ "image_url" }`. Only the poster (or an admin), and not after the item is returned.
The new photo goes through the same AI check. Response `{ "message": "Photo saved" }`.

---

## AI ownership questions (found items)

The finder takes a **private** photo of a hidden detail. It is read once by Claude, held in server memory
for 30 minutes and then discarded. It is never stored or shown.

### `POST /api/questions/generate`
Body: `{ "image_b64": "<JPEG, base64>", "category", "title" }`.
Response: `{ "draft_id": "...", "questions": [{ "slot": 0, "question": "...", "answer": "...", "left": 3 }, ...] }`.
Questions never ask about colour or brand, and never for ID or card numbers. Error 422 when the photo shows too little detail.

### `POST /api/questions/regenerate`
Body: `{ "draft_id", "slot" }`. Each question can be changed 3 times.
Response: `{ "slot", "question", "answer", "left" }`. Error 429 when the changes are used up.

---

## Claiming a found item

### `GET /api/items/:id/questions`
Returns what a claimant must answer. Answers are never returned.
`{ "mode": "multi", "questions": [{ "id": 7, "question": "..." }], "attempts_left": 3, "locked": false }`.
Older posts return `{ "mode": "single", "question": "..." }`.

### `POST /api/items/:id/claim`
Body: `{ "answers": { "<question id>": "text", ... } }` for `multi`, or `{ "answer": "text" }` for `single`.
Answers are judged by meaning ("navy" matches "dark blue"). Every answer must be right.

- **All correct:** `{ "approved": true, "message": "..." }`. The item becomes `VERIFIED` and the finder is texted. The claimant can then call `GET /api/items/:id/contact`.
- **Some wrong:** 403 `{ "error", "attempts_left", "locked" }`. It never says which answer was wrong.
- **3 wrong in 24 hours:** 429 with `"locked": true`.
- Not allowed: your own post, or a post from the same phone number as yours (400). Already claimed: 409.

### `POST /api/items/:id/contact-request`
For a locked-out claimant. Shares their number with the finder, who decides. The finder's number stays hidden.
Response `{ "message" }`. Error 400 if the attempts were not used up.

### `GET /api/my/contact-requests`
The finder's list of people who shared their number: `[{ "id", "created_at", "title", "full_name", "phone", "attempts" }]`.

### `PATCH /api/contact-requests/:id/approve`
The finder approves. The item becomes `VERIFIED` and the claimant is texted and can get the finder's contact.

### `PATCH /api/contact-requests/:id/dismiss`
The finder declines. Response `{ "message": "Dismissed" }`.

---

## Responding to a lost item

A finder proves they hold it with three things: the owner's secret question, for ID cards the full ID number,
and a live photo showing a one-off code.

### `GET /api/items/:id/proof-code`
Response `{ "code": "K7Q2" }`. The code is tied to this person and item and lasts the day.

### `POST /api/items/:id/found-it`
Body: `{ "answer", "proof_url", "identifier", "code" }` (`identifier` only for ID cards).
Wrong answers or ID numbers are rejected before any photo check. 3 wrong tries lock the item for that person.
The photo must show the item and the code. Response `{ "message": "Sent. The owner will review your proof." }`.

### `GET /api/my/claims`
The owner's review list: `[{ "id", "item_id", "title", "item_type", "proof_url", "id_matched", "claimant", "created_at" }]`.

### `PATCH /api/claims/:id/approve`
The owner approves a finder's proof. The item becomes `VERIFIED` and the finder is texted. Response `{ "message": "Approved" }`.

### `PATCH /api/claims/:id/reject`
Rejects the proof and reopens the item. Response `{ "message": "Rejected" }`.

---

## Contact and returns

### `GET /api/items/:id/contact`
Needs the item to be `VERIFIED`.
- For a `FOUND` item, the approved claimant (or the finder) gets the finder's details.
- For a `LOST` item, the owner gets the approved finder's details.

Response `{ "finder": "Kofi Mensah", "phone": "0241234567", "handoff_zone": "Porter's Lodge" }`. Anyone else gets 403.

### `PATCH /api/items/:id/resolve`
Marks an item returned. Allowed for: an admin; the owner of a `LOST` report; the approved claimant of a `FOUND`
item that is `VERIFIED`. **The finder cannot close their own found item.** Response `{ "message": "Marked as returned" }`.

---

## My activity

### `GET /api/my/items`
The caller's posts: `[{ "id", "type", "category", "title", "image_url", "status", "hidden", "created_at", "pending_claims" }]`.

### `GET /api/my/claimed`
Items the caller has claimed: `[{ "id", "title", "type", "handoff_zone", "claim_status", "created_at" }]`.

---

## Reports

### `POST /api/items/:id/report`
Body `{ "reason" }`. One report per person per item. Three different reporters hide the post until an admin reviews it.
Response `{ "message": "Thanks. We will review this item." }`.

---

## Account

### `GET /api/account`
`{ "id", "full_name", "student_email", "phone", "role", "created_at" }`.

### `PATCH /api/account`
Body `{ "full_name", "phone" }`. The email cannot be changed. Error 409 if the phone belongs to another account.

### `POST /api/account/password`
Body `{ "current_password", "new_password" }`. Signs out other devices and returns `{ "message", "token" }` so this device stays signed in.

### `POST /api/account/logout-all`
Cancels every session, including this one. Response `{ "message": "Signed out of all devices" }`.

### `GET /api/account/export`
Everything stored about the caller: `{ "exported_at", "profile", "items", "claims" }`.

### `DELETE /api/account`
Body `{ "password" }`. Permanently removes the account, its posts and its claims. A wrong password returns 403, not 401.

---

## Admin

These need `role = admin` (checked in the database on every call). Others get 403.

### `GET /api/admin/items`
All items, most reported first: `[{ "id", "type", "title", "status", "hidden", "created_at", "poster", "reports" }]`.

### `GET /api/admin/stats`
Numbers for the Overview screen:
```json
{ "totals": { "users": 120, "items": 340, "found": 190, "lost": 150, "returned": 88, "active": 140,
              "hidden": 3, "claims_approved": 95, "claims_rejected": 41, "reported_items": 5 },
  "per_day": [{ "day": "23 Nov", "found": 4, "lost": 2 }],
  "by_category": [{ "category": "PHONE", "n": 90 }],
  "by_status": [{ "status": "OPEN", "n": 140 }] }
```
`per_day` covers the last 14 days.

### `PATCH /api/admin/items/:id/hide`
Body `{ "hidden": true | false }`.

### `DELETE /api/admin/items/:id`
Permanently deletes an item and everything attached to it.

---

## Health

### `GET /health`
Returns `ok`. Needs no login and no database. Used by Render and the Docker health check.

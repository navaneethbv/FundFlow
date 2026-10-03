# Statement vault API contract

The statement vault is disabled by default behind `statementVault`.
It stores user-uploaded PDF metadata and bytes only; it never parses or interprets statement contents.

## `POST /api/statements`

Accepts `multipart/form-data` with:

- `account`: `account:<uuid>` for a connected account or `manual:<uuid>` for a manual account owned by the signed-in user.
- `month`: a first-of-month `YYYY-MM-01` value.
- `file`: one PDF, validated by content type, filename, size, and PDF magic bytes.

Success: `201 { statement: { id, account, month, filename, sizeBytes, createdAt } }`.

Errors: `400` for invalid fields or file, `401` for an unauthenticated request, `404` when the account is not owned by the user, and `413` when the file exceeds the bounded limit.

## `GET /api/statements`

Returns only metadata for the signed-in user's statements.
The optional `account` and `month` query parameters use the same formats as the upload fields.

Success: `200 { statements: [{ id, account, month, filename, sizeBytes, createdAt }] }`.

The route does not return storage URLs or PDF bytes.

## `DELETE /api/statements/:id`

Deletes one statement owned by the signed-in user, including its private storage object.

Success: `200 { ok: true }`.

An unknown or non-owned statement returns `404` without revealing whether another user has a matching id.

## Account deletion

Deleting the FundFlow account removes every object under the user's folder in the private `statements` bucket before the auth user is deleted, and the deletion fails closed if any removal fails.
Unlinking a bank removes its statement rows through the account cascade, but not yet their stored PDFs; that cleanup is tracked in `docs/TODO.md`.

# Security Specification — MoE School Portal Firestore

## Architecture & Trust Model
All browser clients communicate exclusively with our Express backend (`server.ts`) over HTTPS (`/api/*`). The backend authenticates callers via HMAC-signed Bearer tokens and enforces role-based access control (`admin`, `nodal_officer`, `staff` with `Class Teacher` / `Subject Teacher` / `Both` and assigned class/section/subject boundaries) before reading or writing Firestore through `firebase-admin`.

Because no client SDK reads or writes Firestore directly, `firestore.rules` enforces a **strict zero-trust default-deny policy** (`allow read, write: if false`) on every single collection and subcollection in `firebase-blueprint.json`, as well as the global catch-all match block.

## Data Invariants
1. No unauthenticated or Firebase-client-SDK caller may read `settings` (which holds `auth_secret`), `users` (which holds `password_hash`), `admission_applications` (which holds student/parent PII), or any other collection.
2. No client may create, update, or delete `counters`, `marking_schemes`, `result_publications`, `marks`, `attendance`, `students`, `circulars`, `question_papers`, or `stored_files` directly.
3. Only the Express server's `firebase-admin` service identity (which operates with IAM credentials) performs validated reads and writes.

## Adversarial Payloads Checked
1. Unauthenticated read on `/settings/auth_secret` -> DENIED (`if false`).
2. Client read on `/users/{userDocId}` to scrape password hashes -> DENIED (`if false`).
3. Client list query on `/admission_applications` to harvest applicant PII -> DENIED (`if false`).
4. Client write to `/users/{userDocId}` attempting self-promotion to `admin` -> DENIED (`if false`).
5. Client write to `/marks/{markId}` attempting score tampering -> DENIED (`if false`).
6. Client write to `/result_publications/{className}` attempting unauthorized publish -> DENIED (`if false`).
7. Client delete on `/circulars/{circularId}` -> DENIED (`if false`).
8. Client write to `/counters/{counterName}` attempting ID/roll sequence poisoning -> DENIED (`if false`).
9. Client write to `/students/{studentDocId}` -> DENIED (`if false`).
10. Client write to `/attendance/{attendanceId}` -> DENIED (`if false`).
11. Client read/write on `/stored_files/{fileId}/chunks/{chunkId}` -> DENIED (`if false`).
12. Client write to any arbitrary unmatched path `/{document=**}` -> DENIED (`if false`).

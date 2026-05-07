# HR Interview Query System Security Specification

## Data Invariants
1. A Record must always belong to a valid Candidate.
2. Every read access to Candidate details must be accompanied by an audit log entry (enforced via application logic, monitored via rules if possible, but Firestore doesn't easily enforce 'must write to A to read B' without a backend, so I will rely on strict `allow list` and `allow get`).
3. Candidates are identified by Name + Birthday to prevent collision.

## The "Dirty Dozen" Payloads (Red Team Test Cases)
1. Unauthorized User Read: Trying to read `candidates` without login.
2. Identity Spoofing: HR user A trying to write a log as user B.
3. Massive Query: Searching for candidates with a 1MB junk string in name.
4. Record Orphan: Creating a record with a non-existent candidateId.
5. PII Leak: Listing all candidates without specific name filters (enforced via `allow list: if false` or similar if we want strict point-lookup).
6. Field Poison: Updating a candidate's `birthday` after creation (should be immutable).
7. System Hijack: Updating `createdBy` field in a Record.
8. Log Deletion: Trying to delete an audit log.
9. Privilege Escalation: Trying to create a candidate with `isAdmin: true` (if we had such field).
10. Anonymous Write: Posting a record without auth.
11. State Shortcut: Marking an interview as "Pass" without required interview date.
12. Denial of Wallet: Writing 10,000 records in a loop (enforced via rate limiting at rules if possible, but mainly size checks).

## Test Runner (Draft)
```typescript
// firestore.rules.test.ts (placeholder logic)
test('unauthenticated users cannot read candidates', () => {
  // expect(get(candidates/1)).toFail();
});
```

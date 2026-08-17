# Data Model

## Hero

Represents Dota hero.

Fields:

- id
- name
- roles[]
- attributes[]
- tags[]
- synergy_tags[]
- counter_tags[]
- evaluation_values

---

## Draft

Represents user-created team.

Fields:

- id
- owner_token (anonymous browser identity; required on new drafts)
- heroes[]
- roles[]
- created_at

---

## DraftHero

Connection between hero and draft.

Fields:

- draft_id
- hero_id
- assigned_role
- pick_order

---

## Match

Professional or historical match.

Fields:

- id
- patch
- duration
- winner
- radiant_team
- dire_team

---

## Team

Represents five heroes.

Fields:

- heroes[]
- roles[]
- vector

---

## Evaluation Result

Temporary object.

Should NOT be permanently stored in MVP.

Contains:

- scores
- explanations
- warnings

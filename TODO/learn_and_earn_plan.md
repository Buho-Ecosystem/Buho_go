# Learn & Earn — Implementation Plan

## Overview

A Bitcoin education quiz game inside BuhoGO. Users read short lessons, answer multiple-choice questions, and earn real sats. 1 sat per correct answer. Complete all questions and the total earned gets doubled.

---

## Reward System

| Event | Reward |
|-------|--------|
| Correct answer | 1 sat |
| Every 25 correct answers | Auto-payout accumulated sats to user's chosen wallet |
| All questions completed | Bonus: total earned so far is doubled (one final payout) |
| Wrong answer | No penalty, try again immediately |

### Payout Flow

1. User selects target wallet before first question (bottom sheet, saved in store)
2. On correct answer: `pendingSats += 1`, `totalCorrect += 1`
3. Every 25th correct answer:
   - Generate LNURL-withdraw from LNbits funding source
   - Create invoice on user's selected wallet for `pendingSats` amount
   - Auto-claim the LNURL-withdraw
   - Show celebration animation
   - Reset `pendingSats = 0`
4. When ALL questions completed:
   - Calculate bonus = `totalEarned` (doubles everything)
   - One final payout for the bonus amount
   - Show big celebration: "You completed all quizzes and doubled your sats!"
5. If funding source is unavailable: track sats, pay out when funding is restored

### Funding Source (LNbits)

You will provide the LNbits API endpoint + admin key for generating LNURL-withdraw codes on the fly. The store will call this API to create a one-time withdraw link, then claim it by creating an invoice on the user's wallet.

---

## Content

### Source

- Galoy/Blink "earn" repo (121 questions, MIT licensed)
- Remove Blink-specific questions
- Simplify language for teenage audience
- Add ~15 BuhoGO-specific questions (Spark, Lightning addresses, self-custody, hardware wallets, LNURL)

### Structure

6 topic groups, 19+ chapters, ~130 questions total:

| Group | Chapters | Illustration |
|-------|----------|-------------|
| 1. Bitcoin Basics | What is Bitcoin, What is Money, How Money Works, Why Bitcoin is Special | `education.svg` |
| 2. Money History | Origins of Money, Store of Value, Evolution of Money I-IV | `book-lover.svg` |
| 3. Bitcoin Deep Dive | Why Bitcoin was Created, How Bitcoin Works | `learning.svg` |
| 4. Lightning Network | Lightning Network | `online-learning.svg` |
| 5. Criticisms & Myths | Criticisms I-III | `mathematics.svg` |
| 6. BuhoGO & Practical | Spark wallets, Self-custody, LNURL, Hardware wallets | `webinar.svg` |

Dashboard header: `exams.svg`

### Question Format

```json
{
  "id": "bitcoin-basics.what-is-bitcoin.q1",
  "title": "So what exactly is Bitcoin?",
  "text": "Bitcoin is digital money. Unlike dollars or euros, no government or bank controls it...",
  "question": "What is Bitcoin?",
  "answers": ["Digital money", "A video game", "A new cartoon character"],
  "feedback": [
    "Correct! Bitcoin is digital money that works without banks.",
    "Not quite. Bitcoin is not a game, it's real money.",
    "Nope! Bitcoin is money, not a character."
  ]
}
```

- `answers[0]` is always correct (shuffled on display)
- `feedback[i]` matches `answers[i]` (shuffled together)

---

## Progression

### Semi-Open

- 6 topic groups unlock linearly (complete group 1 to unlock group 2)
- Within a group, all chapters are open (pick what interests you)
- Within a chapter, questions are linear (complete q1 to see q2)

### Unlocking Rules

- Group 1 (Bitcoin Basics): Always unlocked
- Group 2-6: Unlocked when ALL questions in the previous group are completed
- Completion = answered correctly (wrong attempts don't count, user retries until correct)

---

## Retry Pattern

- Wrong answer: red highlight + feedback text explaining why it's wrong
- "Try again" button — user stays on same question
- No limit on attempts
- Only correct answers increment progress and earn sats

---

## Files to Create

### Data

```
src/data/earn-quizzes.json          — All questions organized by group > chapter > question
```

### Store

```
src/stores/earn.js                   — Progress tracking, payout logic, wallet selection
```

**State:**
```js
{
  completedQuestions: [],            // Array of question IDs
  selectedWalletId: null,            // Target wallet for rewards
  pendingSats: 0,                    // Accumulated since last payout
  totalEarned: 0,                    // Lifetime sats earned
  bonusPaid: false,                  // Whether completion bonus was paid
  fundingApiUrl: '',                 // LNbits API endpoint (set later)
  fundingApiKey: '',                 // LNbits admin key (set later)
}
```

**Key methods:**
- `markQuestionComplete(questionId)` — adds to completed, increments pendingSats
- `shouldPayout()` — returns true every 25 correct answers
- `executePayout()` — generates LNURL-withdraw, claims to user wallet
- `executeCompletionBonus()` — doubles total earned on full completion
- `getGroupProgress(groupId)` — returns { completed, total, percentage }
- `isGroupUnlocked(groupId)` — checks if previous group is complete
- `isChapterComplete(chapterId)` — all questions in chapter answered

### Pages

```
src/pages/LearnDashboard.vue         — Topic group cards with progress bars
src/pages/LearnChapter.vue           — Question list for a chapter
src/pages/LearnQuestion.vue          — Lesson + quiz + feedback
```

### Route

```js
{ path: '/learn', component: () => import('pages/LearnDashboard.vue') },
{ path: '/learn/:chapterId', component: () => import('pages/LearnChapter.vue') },
{ path: '/learn/:chapterId/:questionId', component: () => import('pages/LearnQuestion.vue') },
```

---

## UI Design

### LearnDashboard (`/learn`)

```
← Learn & Earn

  [header illustration]
  
  Total earned: 42 sats
  Progress: 42/130 questions

  ┌──────────────────────────┐
  │ 📚 Bitcoin Basics        │
  │ ████████░░ 16/22         │
  │ 4 chapters               │
  └──────────────────────────┘

  ┌──────────────────────────┐
  │ 📖 Money History         │
  │ ░░░░░░░░░░ 0/42          │
  │ 🔒 Complete Bitcoin Basics│
  └──────────────────────────┘
  
  ...
```

### LearnChapter (`/learn/bitcoin-basics`)

```
← Bitcoin Basics

  ┌─ What is Bitcoin? ────────┐
  │ ✅ q1  ✅ q2  ✅ q3       │
  │ ○ q4   ○ q5              │
  │ 3/5 complete              │
  └───────────────────────────┘

  ┌─ What is Money? ──────────┐
  │ ○ q1  ○ q2  ...          │
  │ 0/6 complete              │
  └───────────────────────────┘
```

### LearnQuestion (`/learn/bitcoin-basics/what-is-bitcoin/q1`)

```
  What exactly is Bitcoin?

  Bitcoin is digital money. Unlike dollars
  or euros, no government or bank controls it.
  It works everywhere in the world and you
  can send it to anyone, anytime.

  ─────────────────────────

  What is Bitcoin?

  [ Digital money          ]    ← shuffled
  [ A video game           ]
  [ A new cartoon character ]
```

**On correct answer:**
```
  ✅ Correct!

  Bitcoin is digital money that works
  without banks.

  +1 sat earned

  [ Next Question ]
```

**On wrong answer:**
```
  ❌ Not quite

  Bitcoin is not a game, it's real money.

  [ Try Again ]
```

**Every 25th correct answer — celebration overlay:**
```
  🎉 Payout!

  25 sats sent to your Business wallet

  [ Continue ]
```

---

## Wallet Selection (First Launch)

Before the first question, show a bottom sheet:

```
  Where should your rewards go?

  ● Business          42,000 sats
  ○ Personal          12,000 sats
  ○ My NWC Wallet     5,000 sats

  [ Start Learning ]
```

Saved in earn store. Can be changed via a settings icon on the dashboard.

---

## Settings Integration

The existing "Learn & Earn" section in Settings already has the "Onboarding Guide" row. Add below it:

```
LEARN & EARN

  [school]  Onboarding Guide
             Learn about all BuhoGO features    >
  ──────────────────────────────────────────────
  [trophy]  Bitcoin Quiz
             Answer questions, earn real sats    >
```

The "Bitcoin Quiz" row navigates to `/learn`.

---

## Implementation Order

1. **Phase 1: Data + Store** — Create the quiz JSON and earn store with progress tracking
2. **Phase 2: Pages** — Build the 3 pages (dashboard, chapter, question)
3. **Phase 3: Payout** — Wire up LNbits funding + auto-claim logic
4. **Phase 4: Completion Bonus** — Double-sats celebration on full completion
5. **Phase 5: Polish** — Animations, i18n, illustrations

Phase 1+2 can ship without the payout system (sats are tracked but not paid out yet). Phase 3 ships when you provide the LNbits credentials.

---

## Open Items

- [ ] You provide: LNbits API endpoint + admin key for LNURL-withdraw generation
- [ ] You review: final quiz content after I curate it from Galoy + add BuhoGO questions
- [ ] Decide: illustration mapping to topic groups (I proposed a mapping above, you confirm)

---
description: Publish an OTA update, with the checks that stop it reaching nobody or crashing someone
argument-hint: "[channel] — main (default) or production"
allowed-tools: Bash(git:*), Bash(npx expo-updates:*), Bash(npx eas-cli:*), Bash(npx tsc:*), Bash(npx jest:*), Bash(npx expo:*), Bash(textutil:*), Bash(unzip:*), Bash(zip:*), Bash(sed:*), Read, Edit, Write
---

Publish an over-the-air update to channel **$1** for Android. If that is empty,
the channel is `main` — substitute it everywhere below before running anything.

Current state:
- branch: !`git branch --show-current`
- uncommitted: !`git status --short || echo "(clean)"`
- last commits: !`git log --oneline -5`

An OTA goes straight onto people's phones with no build step in between, and
it cannot be recalled — only superseded. Work through the gates below in order
and **stop at the first one that fails**, reporting why rather than pushing on.

## Gate 1 — the tree is committed

EAS stamps the commit onto the update; publishing from a dirty tree produces
an update nothing can be traced back to. If there are uncommitted changes,
show them and ask whether to commit before continuing.

## Gate 2 — it compiles, lints, and passes

```bash
npx tsc --noEmit && npx expo lint && npx jest
```

Nothing downstream catches a type error in an OTA. Any failure stops the push.

## Gate 3 — the fingerprint matches a build that exists

`runtimeVersion` is `{"policy":"fingerprint"}`, so an update only reaches
installs whose native fingerprint is *identical* to this tree. This is the gate
that matters: a mismatch is **not an error** — the update publishes, reaches
nobody, and reports success.

```bash
npx expo-updates fingerprint:generate --platform android
npx eas-cli build:list --limit 5
```

Compare the hash against the `runtimeVersion` of the finished builds. If no
installed build carries it, **stop**: a new native build is needed first
(`eas build --platform android --profile preview`). Say so instead of
publishing into the void.

## Gate 4 — know who you are about to reach

```bash
npx eas-cli channel:view $1
```

Each runtime version is served independently — that is what lets several
generations of the app coexist. Report which runtimes the channel carries and
which one this update will land on, so it is clear whose phones change.

## Publish

Write the message from the **actual diff** since the last update, not from
memory: read `git log` and say what changed for the person using the app, in
plain English, no commit hashes. One sentence or two.

```bash
npx eas-cli update --branch $1 --platform android --message "..."
```

## After

1. `npx eas-cli channel:view $1` — confirm the new group is on top, and report
   its group ID, runtime and commit.
2. If the change is user-visible, add it to the current version block in
   `RELEASE_NOTES.html` and regenerate the .docx — procedure and the colour fix
   are in MAINTENANCE.md §8. Never hand-edit the .docx.
3. Tell the user how to pick it up: force-close the app and reopen it twice —
   expo-updates downloads on one launch and applies on the next.

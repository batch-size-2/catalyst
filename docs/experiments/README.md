# Experiments

One file per ticket in [../TICKETS.md](../TICKETS.md), named `<ticket>.md` (e.g. `T1.md`).

Each file starts with the pre-registered part, committed **before** anything is run: hypothesis, exact metric, reading and stop rules. Results are appended below it afterwards. The rules are never edited after seeing numbers.

An experiment never changes the model by itself. When a result is taken into the model, the ticket's file says so in an "Adoption" section with the check that was run first (so far: T14, 4 Oct).

Exception: [T18.md](T18.md) was run after the ground truth of the test samples was known and is not pre-registered; it says so at the top and reads its p-values as uncorrected.

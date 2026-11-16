# RICHGANGFX AI — temporary snapshot (stage 6.4)

Public snapshot of the personal Deriv desk after the digit-engine weakness correction and payout-reality upgrade.

This repository is temporary. Delete it when you are done reviewing. It is not a live trading service, and nothing in this snapshot places an order by itself.

Stage 6.4 does not claim a profitable strategy. If walk-forward evidence is insufficient, the desk shows:

`NO VERIFIED EDGE — INSUFFICIENT EVIDENCE.`

What this snapshot keeps from earlier stages:

- Digit contracts stay one-shot proposals: Matches, Differs, Over, Under, Even, Odd.
- Full auto can buy a valid one-shot proposal from the authorized trading socket only.
- Public quotes, manual mode, a missing or repeated proposal id, a changed account, a disarmed real account, and the emergency stop do not buy.
- A negative expected return is shown. It is not a hidden purchase block.
- Martingale stays off unless you turn it on. A loss streak does not suspend a strategy.
- Real trading stays disarmed until you type ARM REAL for that exact account.

What stage 6.4 adds:

- Theoretical baseline, observed frequency, and predictive power are labelled separately. A frequency above the baseline is not called profit.
- Over and Under use the digit you pick, then a saved barrier for that contract. A blank digit is not filled in. Auto barrier selection is off by default and never rotates Matches or Differs. Over 9 and Under 0 cannot signal. A digit equal to the barrier is a loss.
- Backtests are four labelled categories, not a historical trading record: synthetic probability test, historical tick simulation on earlier ticks only, a current-payout simulation, and historical Deriv proposal performance (not available; none was invented).
- Differs quotes show ask, total payout if won, net if won, a full-stake loss, break-even, payout-to-stake ratio, and expected return.

Demo and local tests only. No live Deriv order was sent from this workspace.

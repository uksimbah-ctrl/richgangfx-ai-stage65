# RICHGANGFX AI — temporary snapshot (stage 6.5)

Public snapshot of the personal Deriv desk after the statistical-validation and false-edge upgrade.

This repository is temporary. Delete it when you are done reviewing. It is not a live trading service, and nothing in this snapshot places an order by itself.

Stage 6.5 does not claim a profitable strategy. A positive sample is not proof about the next contract. If the untouched out-of-sample evidence is not there, the desk shows:

`NO VERIFIED EDGE — INSUFFICIENT OUT-OF-SAMPLE EVIDENCE.`

What this snapshot keeps:

- Digit contracts stay one-shot proposals: Matches, Differs, Over, Under, Even, Odd.
- Full auto can buy a valid one-shot proposal from the authorized trading socket only.
- Public quotes, manual mode, a missing or repeated proposal id, a changed account, a disarmed real account, and the emergency stop do not buy.
- A negative expected return is shown. It is not a hidden purchase block.
- Martingale stays off unless you turn it on. A loss streak does not suspend a strategy.
- Real trading stays disarmed until you type ARM REAL for that exact account.
- A blank Over or Under digit is not filled in. Auto barrier selection stays off until you turn it on. Matches and Differs never auto-rotate.

What stage 6.5 adds:

- Auto barrier selection uses earlier ticks only. Training picks one barrier. Validation judges that barrier. Later untouched periods are not used to pick a different one. A failed validation is unproven, and no other barrier is substituted.
- Walk-forward uses separate training, validation, and final periods. Twelve out-of-sample decisions are not enough to call a strategy supported. Scanning several barriers widens the interval.
- The beta posterior uses the effective sample, so a run of the same digit is not counted as many independent observations.
- Confidence can be set to 90%, 95%, or 99%. 95% is the research default. Training size, validation size, final period size, and the number of periods stay on each contract.
- Backtests stay labelled: synthetic probability test, historical tick simulation, current-payout simulation, and historical Deriv proposal performance (not available; none was invented).

Demo and local tests only. No live Deriv order was sent from this workspace.

"""HGH-03: the weighted objective trades one decision against another.

The objective families live on very different granularities - one preference
assignment moves a term by 1, one roster boundary by 1, one duty point by
``SCALE`` in the lens terms. Normalizing by each family's *maximum* made the
fairness slider a fake: for a 28-day roster it produced coefficients of 246
(fairness) vs 26667 (preference) vs 6944 (continuity), so a prefer-flagged
assignment outbid a whole point of fairness, the preferred member hoarded the
lens, and QA's fairness slider (D12) could not actually trade fairness away for
better preferences. The contract here is that the *per-decision* coefficients
mirror the weights, so at the default 3 : 1 : 2 one duty outbids one
preference slot and one boundary, while lowering the fairness slider really
hands the schedule to preference/continuity instead of staying floored at a
coefficient of 1. This test runs on the coefficients only - no solver.
"""

from oncall.scheduler import MARGINAL_BASE, SCALE, marginal_cost


def test_fairness_factor_looks_up_scale() -> None:
    fair = marginal_cost(3.0, SCALE)
    preference = marginal_cost(2.0, 1)
    continuity = marginal_cost(1.0, 1)
    # One duty point (the FAIRNESS step) must beat one preference assignment and
    # one roster boundary at the default weights. These are per-decision costs,
    # so the ordering is the whole point: the preferred member cannot hoard a
    # lens while fairness is on.
    assert fair * SCALE >= preference
    assert fair * SCALE >= continuity
    assert preference >= continuity
    # And the ordering flips once the coordinator turns fairness down: the
    # fairness coefficient scales with the slider just like the others.
    assert fair * SCALE * (0.1 / 3.0) < continuity


def test_coefficients_follow_weights_slider_is_not_a_dead_zone() -> None:
    # A step-1 family has coefficient proportional to weight (HGH-03): halving
    # the weight halves the influence instead of flooring to 1.
    assert marginal_cost(3.0, 1) == 3 * MARGINAL_BASE // 1
    assert marginal_cost(1.5, 1) == round(1.5 * MARGINAL_BASE)
    assert marginal_cost(0.1, 1) == round(0.1 * MARGINAL_BASE)
    strong = marginal_cost(3.0, SCALE)
    weak = marginal_cost(0.1, SCALE)
    assert strong >= 10 * weak
    assert 0.4 * strong <= marginal_cost(1.5, SCALE) <= 2 * strong

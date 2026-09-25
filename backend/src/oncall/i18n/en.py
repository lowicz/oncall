"""English: the same keys as `pl.py`, served on `Accept-Language: en`."""

MESSAGES: dict[str, str] = {
    # --- shared -------------------------------------------------------------
    "domain.not_a_team_member": "The account is not linked to a team member",
    # --- sign-in and sessions (oncall.domain.access, oncall.auth) ------------
    "access.login_throttled": "Too many sign-in attempts",
    "access.login_rejected": "Wrong username or password",
    "access.directory_failure": "{reason}",
    "access.directory_login_unavailable": "Directory sign-in is temporarily unavailable",
    "access.directory_unavailable": "The directory is temporarily unavailable",
    "access.identity_taken": (
        "The username or personnel number is already assigned to another account"
    ),
    "access.account_link_invalid": "The link is invalid or has expired",
    "access.account_already_activated": "The account has already been activated",
    "access.password_same_as_login": "The password cannot be the same as the username",
    "access.share_session_has_no_account": "The link session has no account to edit",
    "access.account_gone": "The account does not exist",
    "access.no_active_session": "No active session",
    "access.session_expired": "The session has expired",
    "access.account_inactive": "The account is inactive",
    "access.share_session_not_an_account": "The link session is not linked to a user account",
    "access.invalid_csrf_token": "Invalid CSRF token",
    "access.session_link_missing": "The session link is missing",
    "access.no_directory_photo": "No photo in the directory",
    "access.forbidden": "You are not allowed to do this",
    "access.password_too_easy": "The password is too easy to guess",
    # --- accounts and the rotation (oncall.domain.admin) ---------------------
    "admin.account_not_found": "User not found",
    "admin.rotation_member_not_found": "Person not found in the rotation",
    "admin.eligibility_not_found": "Eligibility period not found",
    "admin.first_name_required": "The first name cannot be empty",
    "admin.last_name_cleared": "The last name cannot be null",
    "admin.username_taken": "An account with this username already exists",
    "admin.email_taken": "An account with this e-mail address already exists",
    "admin.personnel_number_taken": "The personnel number is already in use",
    "admin.directory_identity_read_only": "The personal data of an LDAP account is managed by AD",
    "admin.directory_password_read_only": "The password of an LDAP account is managed by AD",
    "admin.account_already_activated": (
        "The account already has a password; generate a password reset instead of an activation "
        "link"
    ),
    "admin.disabled_account_activation": (
        "The account is disabled; enable it before generating an activation link"
    ),
    "admin.own_role_or_status_change": "You cannot change your own role or status",
    "admin.last_active_admin_demotion": (
        "The last active administrator cannot be disabled or demoted"
    ),
    "admin.own_account_deletion": "You cannot delete your own account",
    "admin.last_active_admin_deletion": "The last active administrator cannot be deleted",
    "admin.account_still_referenced": (
        "The account cannot be deleted because other data refers to it. "
        "Deactivate the account or remove the references."
    ),
    "admin.account_already_in_rotation": "The account is already assigned to the rotation",
    "admin.membership_ends_before_start": ("The rotation exit date cannot precede the entry date"),
    "admin.eligibility_outlives_membership": (
        "Eligibility periods must fit inside the rotation membership period"
    ),
    "admin.duties_after_exit": (
        "The person holds duties after the rotation exit date. "
        "Reassign or release these slots first: {slots}"
    ),
    "admin.eligibility_outside_membership": (
        "The eligibility period must fit inside the rotation membership period"
    ),
    "admin.eligibility_ends_before_start": "The end date cannot precede the start date",
    "admin.eligibility_overlaps": "The eligibility period overlaps an existing period of this role",
    "admin.duties_lose_eligibility": (
        "The eligibility change would leave published duties without eligibility. "
        "Reassign these slots first: {slots}"
    ),
    "admin.username_has_spaces": "The username cannot contain spaces",
    "admin.membership_end_before_entry": "The end date cannot precede the entry date",
    # --- availability (oncall.domain.availability) ---------------------------
    "availability.team_member_not_found": "Team member not found",
    "availability.range_reversed": "The end date cannot precede the start date",
    "availability.range_too_long": "One availability entry can cover at most 366 days",
    "availability.in_the_past": "An availability entry cannot lie entirely in the past",
    "availability.already_exists": "This availability entry already exists",
    "availability.overlaps": "The range overlaps an existing availability entry",
    "availability.entry_not_found": "Entry not found",
    "availability.on_duty_warning": (
        "You are on duty during this time. Reporting it does not take the duty away; "
        "ask for a swap or contact the coordinator."
    ),
    "availability.on_duty_warning_on_behalf": (
        "{name} is on duty during this time. Reporting it does not take the duty away; "
        "it has to be handed over by a swap or a coordinator's correction."
    ),
    # --- balance and fairness (oncall.domain.balance) ------------------------
    "balance.points_team_only": "Points are visible to the team only",
    "balance.own_duties_only": "You can only look up your own duties",
    "balance.member_not_found": "Team member not found",
    # --- calendar and events (oncall.domain.calendar) ------------------------
    "calendar.range_ends_before_start": "The end date cannot precede the start date",
    "calendar.event_range_too_long": "The events range must cover 1 to 90 days",
    "calendar.range_invalid": "The calendar range must cover 1 to 90 days",
    "calendar.outside_share_range": "The requested range is outside the link's date range",
    "calendar.dashboard_range_reversed": "ends_on cannot be earlier than starts_on",
    "calendar.event_not_found": "Event not found",
    # --- history import (oncall.domain.history, oncall.history_import) -------
    "history.rejected": "The history import contains errors",
    "history.file_not_utf8": "The file must be saved as UTF-8",
    "history.columns_missing": "Required columns are missing: {columns}",
    "history.too_many_rows": "The file can contain at most {max_rows} rows",
    "history.date_format": "Expected format YYYY-MM-DD",
    "history.role_allowed": "Allowed: primary, secondary, late_shift",
    "history.late_shift_working_days_only": "The 11–19 shift can only fall on working days",
    "history.assignee_required": "The person is required",
    "history.duplicate_role": "Duplicate role for this day",
    "history.file_empty": "The file contains no data",
    "history.file_too_large": "The file exceeds 1 MB",
    "history.not_in_team": "The person is not in the team",
    "history.outside_membership": (
        "The duty date is outside this person's rotation membership period"
    ),
    "history.not_eligible": "The person has no eligibility for the {role} role on this day",
    "history.late_shift_allowed_working_days_only": (
        "The 11–19 shift is allowed on working days only"
    ),
    "history.covered_by_publication": "The duty date is covered by a published schedule",
    "history.same_person_both_roles": (
        "The same person cannot be primary and secondary on one day"
    ),
    # --- corrections of the published schedule (oncall.domain.overrides) -----
    "overrides.late_shift_working_days_only": "The 11–19 shift is available on working days only",
    "overrides.published_schedule_not_found": "Published schedule not found",
    "overrides.person_not_found": "Person not found",
    "overrides.person_not_eligible": "The person has no eligibility",
    "overrides.person_unavailable": "The person is unavailable",
    "overrides.person_already_holds_role": "This person already holds this role on that day",
    "overrides.person_already_on_call": "The person already has a second on-call on that day",
    "overrides.roster_changed_meanwhile": "The schedule has changed; refresh the calendar",
    "overrides.repeated_slot_in_batch": "The list contains a repeated slot",
    "overrides.empty_batch": "A batch correction must cover at least one slot",
    "overrides.slot_not_found": "Schedule slot not found",
    "overrides.historical_correction_needs_reason": (
        "A historical correction requires a reason (at least 10 characters)"
    ),
    "overrides.batch_correction_needs_reason": (
        "A batch correction requires a reason (at least 10 characters)"
    ),
    "overrides.rule_violations_not_acknowledged": (
        "The correction would break the schedule's hard rules; confirm the deliberate violation"
    ),
    "overrides.acknowledge_next_step": (
        "Choose another person or confirm a deliberate violation of the hard rules;"
        " it will be recorded in the audit log."
    ),
    # --- reports (oncall.domain.reports) -------------------------------------
    "reports.invalid_month": "The month must have the format YYYY-MM",
    # --- drafts, proposals, publication (oncall.domain.scheduling) -----------
    "scheduling.schedule_not_found": "Schedule not found",
    "scheduling.generation_run_not_found": "Generator run not found",
    "scheduling.policy_without_weight": "At least one generator weight must be greater than zero",
    "scheduling.generation_failed": "A complete schedule cannot be created",
    "scheduling.generation_failed.precheck": "A complete schedule model cannot be built",
    "scheduling.generation_failed.infeasible": (
        "The hard rules do not allow a complete schedule to be created"
    ),
    "scheduling.generation_failed.unknown": (
        "The solver used up its time budget without a complete schedule"
    ),
    "scheduling.editable_draft_not_found": "Editable draft not found",
    "scheduling.draft_changed": "The draft has changed; refresh the generator",
    "scheduling.date_outside_draft": "The date is outside the draft's range",
    "scheduling.late_shift_working_days_only": "The 11–19 shift is available on working days only",
    "scheduling.replacement_not_found": "Person not found",
    "scheduling.replacement_not_eligible": "The person has no eligibility",
    "scheduling.replacement_unavailable": "The person is unavailable",
    "scheduling.draft_slot_not_found": "Assignment not found in the draft",
    "scheduling.second_on_call_same_day": "The person already has a second on-call on that day",
    "scheduling.variant_not_found": "One of the variants was not found",
    "scheduling.variant_ranges_differ": "Compared variants must cover the same date range",
    "scheduling.variant_modes_mismatch": "Choose one daily and one weekly variant",
    "scheduling.schedule_not_deletable": (
        "Only a draft, a proposal or imported history can be deleted"
    ),
    "scheduling.draft_state_changed": (
        "The draft changed its state or version; refresh the generator"
    ),
    "scheduling.proposal_state_changed": "The proposal changed its state or version",
    "scheduling.publication_state_changed": (
        "The proposal changed its state or version; refresh the generator"
    ),
    "scheduling.only_proposal_publishable": "Only a proposal can be published",
    "scheduling.incomplete_schedule": "The schedule does not have full coverage",
    "scheduling.same_person_on_both_on_call_roles": (
        "The same person cannot be primary and secondary on one day"
    ),
    "scheduling.proposal_has_unavailable_people": (
        "The draft contains people with hard unavailability. Fix the marked "
        "cells with a correction in the draft matrix or generate the schedule again"
    ),
    "scheduling.publication_has_unavailable_people": (
        "The schedule contains people with hard unavailability; generate it again"
    ),
    "scheduling.lost_changes_not_acknowledged": (
        "Publication will replace manual changes; confirm their loss"
    ),
    "scheduling.change_resolution_required": "Choose a resolution for every conflicting change",
    "scheduling.gap_not_acknowledged": "Days before the start of the schedule remain unstaffed",
    "scheduling.change_resolution_invalid": (
        "The “keep the earlier change” resolution would break the schedule's rules"
    ),
    "scheduling.rest_violations_not_acknowledged": "Publication will break the rest rules",
    "scheduling.unavailability_conflict": "{service_date} · {role}: {name} has hard unavailability",
    "scheduling.run_range_reversed": "The end date cannot precede the start date",
    "scheduling.run_range_too_long": "One run can cover at most 35 days",
    # why a protected change cannot be carried into a new publication
    "scheduling.carry.original_unknown": "The original holder of the change cannot be determined",
    "scheduling.carry.replacement_not_member": "The replacement is no longer a team member",
    "scheduling.carry.different_original": (
        "The new draft has a different original holder in this slot"
    ),
    "scheduling.carry.replacement_not_eligible": (
        "The replacement has no eligibility or is unavailable"
    ),
    "scheduling.carry.breaks_rules": "Carrying the change over breaks the schedule's rules",
    "scheduling.carry.second_on_call_same_day": (
        "This person would already have a second on-call duty on that day"
    ),
    # --- share links and calendar feeds (oncall.domain.sharing) --------------
    "sharing.link_not_found": "Link not found",
    "sharing.token_unknown": "The link does not exist",
    "sharing.link_already_used": "The link has already been used",
    "sharing.link_expired_or_revoked": "The link has expired or has been revoked",
    "sharing.feed_not_found": "Subscription not found",
    "sharing.feed_unavailable": "The subscription does not exist",
    "sharing.range_reversed": "The end date cannot precede the start date",
    "sharing.range_too_long": "The link's range can cover at most 366 days",
    # --- swaps (oncall.domain.swaps) -----------------------------------------
    "swaps.in_the_past": "A duty that has already taken place cannot be swapped",
    "swaps.slot_not_published": "Published schedule not found",
    "swaps.slot_not_yours": "This slot is not yours",
    "swaps.replacement_not_eligible": "The replacement has no eligibility",
    "swaps.cannot_swap_with_yourself": "You cannot swap with yourself",
    "swaps.replacement_has_no_account": "The replacement has no account",
    "swaps.replacement_unavailable": "The replacement is unavailable",
    "swaps.replacement_already_on_call": (
        "The replacement already has a second on-call on that day"
    ),
    "swaps.slot_has_active_swap": "An active swap exists for this slot",
    "swaps.breaks_hard_rules": "The operation breaks the schedule's hard rules",
    "swaps.blocked_next_step": "Choose another day or ask the coordinator to correct the schedule.",
    "swaps.not_found": "Swap not found",
    "swaps.only_named_replacement_may_accept": "Only the named replacement can accept",
    "swaps.only_named_replacement_may_reject": "Only the named replacement can decline the request",
    "swaps.only_coordinator_may_reject_accepted": (
        "Only a coordinator can reject an accepted request"
    ),
    "swaps.only_requester_may_cancel": "Only the author can withdraw the request",
    "swaps.not_awaiting_replacement": "The swap is not awaiting the replacement",
    "swaps.not_awaiting_coordinator": "The swap is not awaiting a coordinator",
    "swaps.no_longer_rejectable": "This swap can no longer be rejected",
    "swaps.no_longer_cancellable": "This swap can no longer be withdrawn",
    "swaps.decision_reason_required": "Give a reason for the decision",
    "swaps.parties_gone": "The schedule or the replacement no longer exists",
    "swaps.self_approval_not_allowed": "Your own swap is approved by another coordinator",
    "swaps.schedule_changed_since_request": "The schedule has changed; create a new swap",
    "swaps.slot_changed_owner": (
        "The slot changed its holder; the request was cancelled automatically"
    ),
    "swaps.points_hidden_from_viewers": "Points are visible to the team only",
    "swaps.replacement_not_found": "Replacement not found",
    "swaps.no_publication_for_day": "No published schedule for this day",
    "swaps.slot_has_no_published_duty": "This slot has no published assignment",
    "swaps.slot_holder_not_a_team_member": "The person in this slot is not a team member",
    "swaps.only_own_swaps_preview": "You can only look up your own swaps",
    "swaps.no_balance_in_window": "No balance for {display_name} in this window",
    # --- hard roster rules (oncall.rules) ------------------------------------
    "rules.max_consecutive": "More than 3 consecutive on-call days.",
    "rules.three_in_seven": "More than 3 on-call duties within 7 days.",
    "rules.rest_after_run": "Less than 2 days of rest after a run of on-call duties.",
    "rules.late_shift_anchor": "The 11–19 shift and the anchor role are held by different people.",
    "rules.day_off_block": "A block of days off is split between people.",
    "rules.late_shift_on_day_off": "The 11–19 shift falls on a day off.",
    "rules.oncall_late_shift_overlap": (
        "The same person has an on-call duty and the 11–19 shift on that day."
    ),
    "rules.same_day_oncall": "The same person holds both on-call duties on that day.",
    "rules.double_oncall": "The replacement already has a second on-call duty on that day.",
    "rules.described": "{member}: {message} Days: {days}.",
    "rules.more_days": "{shown} and {rest} more",
    # --- the calendar's weekday abbreviations, Monday first ------------------
    "weekday.0": "Mon",
    "weekday.1": "Tue",
    "weekday.2": "Wed",
    "weekday.3": "Thu",
    "weekday.4": "Fri",
    "weekday.5": "Sat",
    "weekday.6": "Sun",
    # --- request validation (oncall.bootstrap.http, oncall.presentation) -----
    "validation.missing": "This field is required.",
    "validation.string_too_short": "The value is too short (at least {min_length} characters).",
    "validation.string_too_long": "The value is too long (at most {max_length} characters).",
    "validation.enum": "Invalid value. Allowed: {expected}.",
    "validation.string_pattern_mismatch": "The value has an invalid format.",
    "validation.phone": "The phone number must have 9-15 digits, with an optional + prefix",
}

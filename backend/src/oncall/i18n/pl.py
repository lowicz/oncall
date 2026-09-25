"""Polish: the default language and the source of every key.

The sentences are exactly what the API answered before it learned English.
`{name}` placeholders are filled by `translate()` with `str.format`.
"""

MESSAGES: dict[str, str] = {
    # --- shared -------------------------------------------------------------
    "domain.not_a_team_member": "Konto nie jest powiązane z członkiem zespołu",
    # --- sign-in and sessions (oncall.domain.access, oncall.auth) ------------
    "access.login_throttled": "Zbyt wiele prób logowania",
    "access.login_rejected": "Nieprawidłowy login lub hasło",
    "access.directory_failure": "{reason}",
    "access.directory_login_unavailable": "Logowanie katalogowe jest chwilowo niedostępne",
    "access.directory_unavailable": "Katalog jest chwilowo niedostępny",
    "access.identity_taken": "Login lub numer pracownika jest już przypisany do innego konta",
    "access.account_link_invalid": "Link jest nieprawidłowy lub wygasł",
    "access.account_already_activated": "Konto zostało już aktywowane",
    "access.password_same_as_login": "Hasło nie może być takie jak login",
    "access.share_session_has_no_account": "Sesja linku nie ma konta do edycji",
    "access.account_gone": "Konto nie istnieje",
    "access.no_active_session": "Brak aktywnej sesji",
    "access.session_expired": "Sesja wygasła",
    "access.account_inactive": "Konto jest nieaktywne",
    "access.share_session_not_an_account": "Sesja linku nie jest powiązana z kontem użytkownika",
    "access.invalid_csrf_token": "Nieprawidłowy token CSRF",
    "access.session_link_missing": "Brak linku sesji",
    "access.no_directory_photo": "Brak zdjęcia w katalogu",
    "access.forbidden": "Nie masz uprawnień do tej operacji",
    "access.password_too_easy": "Hasło jest zbyt łatwe do odgadnięcia",
    # --- accounts and the rotation (oncall.domain.admin) ---------------------
    "admin.account_not_found": "Nie znaleziono użytkownika",
    "admin.rotation_member_not_found": "Nie znaleziono osoby w rotacji",
    "admin.eligibility_not_found": "Nie znaleziono okresu eligibility",
    "admin.first_name_required": "Imię nie może być puste",
    "admin.last_name_cleared": "Nazwisko nie może być wartością null",
    "admin.username_taken": "Konto o takim loginie już istnieje",
    "admin.email_taken": "Konto o takim adresie e-mail już istnieje",
    "admin.personnel_number_taken": "Numer pracownika jest już używany",
    "admin.directory_identity_read_only": "Dane osobowe konta LDAP są zarządzane przez AD",
    "admin.directory_password_read_only": "Hasło konta LDAP jest zarządzane przez AD",
    "admin.account_already_activated": (
        "Konto ma już hasło; zamiast linku aktywacyjnego wygeneruj reset hasła"
    ),
    "admin.disabled_account_activation": (
        "Konto jest wyłączone; włącz je, zanim wygenerujesz link aktywacyjny"
    ),
    "admin.own_role_or_status_change": "Nie możesz zmienić własnej roli ani statusu",
    "admin.last_active_admin_demotion": (
        "Nie można wyłączyć ani zdegradować ostatniego aktywnego administratora"
    ),
    "admin.own_account_deletion": "Nie możesz usunąć własnego konta",
    "admin.last_active_admin_deletion": "Nie można usunąć ostatniego aktywnego administratora",
    "admin.account_still_referenced": (
        "Nie można usunąć konta, bo jest powiązane z innymi danymi. "
        "Dezaktywuj konto albo usuń powiązania."
    ),
    "admin.account_already_in_rotation": "Konto jest już przypisane do rotacji",
    "admin.membership_ends_before_start": (
        "Data wyjścia z rotacji nie może poprzedzać daty wejścia"
    ),
    "admin.eligibility_outlives_membership": (
        "Okresy eligibility muszą mieścić się w okresie członkostwa w rotacji"
    ),
    "admin.duties_after_exit": (
        "Osoba ma dyżury po dacie wyjścia z rotacji. Najpierw przepisz lub zwolnij sloty: {slots}"
    ),
    "admin.eligibility_outside_membership": (
        "Okres eligibility musi mieścić się w okresie członkostwa w rotacji"
    ),
    "admin.eligibility_ends_before_start": "Data końcowa nie może poprzedzać daty początkowej",
    "admin.eligibility_overlaps": "Okres eligibility nakłada się na istniejący okres tej roli",
    "admin.duties_lose_eligibility": (
        "Zmiana eligibility pozostawiłaby opublikowane dyżury bez uprawnień. "
        "Najpierw przepisz sloty: {slots}"
    ),
    "admin.username_has_spaces": "Login nie może zawierać spacji",
    "admin.membership_end_before_entry": "Data końcowa nie może poprzedzać daty wejścia",
    # --- availability (oncall.domain.availability) ---------------------------
    "availability.team_member_not_found": "Nie znaleziono członka zespołu",
    "availability.range_reversed": "Data końcowa nie może poprzedzać początkowej",
    "availability.range_too_long": "Jeden wpis dostępności może obejmować maksymalnie 366 dni",
    "availability.in_the_past": "Nie można dodać dostępności w całości w przeszłości",
    "availability.already_exists": "Taki wpis dostępności już istnieje",
    "availability.overlaps": "Zakres nakłada się na istniejący wpis dostępności",
    "availability.entry_not_found": "Nie znaleziono wpisu",
    "availability.on_duty_warning": (
        "Masz w tym czasie dyżur. Zgłoszenie go nie zdejmuje, poproś o zamianę "
        "albo skontaktuj się z koordynatorem."
    ),
    "availability.on_duty_warning_on_behalf": (
        "{name} ma w tym czasie dyżur. Zgłoszenie go nie zdejmuje, "
        "trzeba je przekazać zamianą albo korektą koordynatora."
    ),
    # --- balance and fairness (oncall.domain.balance) ------------------------
    "balance.points_team_only": "Punkty są widoczne tylko dla zespołu",
    "balance.own_duties_only": "Możesz sprawdzić tylko własne dyżury",
    "balance.member_not_found": "Nie znaleziono członka zespołu",
    # --- calendar and events (oncall.domain.calendar) ------------------------
    "calendar.range_ends_before_start": "Data końcowa nie może poprzedzać początkowej",
    "calendar.event_range_too_long": "Zakres wydarzeń musi obejmować od 1 do 90 dni",
    "calendar.range_invalid": "Zakres kalendarza musi obejmować od 1 do 90 dni",
    "calendar.outside_share_range": "Żądany zakres jest poza zakresem dat linku",
    "calendar.dashboard_range_reversed": ("Data ends_on nie może być wcześniejsza niż starts_on"),
    "calendar.event_not_found": "Nie znaleziono wydarzenia",
    # --- history import (oncall.domain.history, oncall.history_import) -------
    "history.rejected": "Import historii zawiera błędy",
    "history.file_not_utf8": "Plik musi być zapisany jako UTF-8",
    "history.columns_missing": "Brak wymaganych kolumn: {columns}",
    "history.too_many_rows": "Plik może zawierać maksymalnie {max_rows} wierszy",
    "history.date_format": "Oczekiwany format RRRR-MM-DD",
    "history.role_allowed": "Dozwolone: primary, secondary, late_shift",
    "history.late_shift_working_days_only": "Zmiana 11–19 może występować tylko w dni robocze",
    "history.assignee_required": "Osoba jest wymagana",
    "history.duplicate_role": "Duplikat roli dla tego dnia",
    "history.file_empty": "Plik nie zawiera danych",
    "history.file_too_large": "Plik przekracza 1 MB",
    "history.not_in_team": "Osoby nie ma w zespole",
    "history.outside_membership": "Data dyżuru jest poza okresem członkostwa tej osoby w rotacji",
    "history.not_eligible": "Osoba nie ma eligibility do roli {role} w tym dniu",
    "history.late_shift_allowed_working_days_only": (
        "Zmiana 11–19 jest dozwolona tylko w dni robocze"
    ),
    "history.covered_by_publication": "Data dyżuru jest objęta grafikiem opublikowanym",
    "history.same_person_both_roles": (
        "Ta sama osoba nie może być primary i secondary jednego dnia"
    ),
    # --- corrections of the published schedule (oncall.domain.overrides) -----
    "overrides.late_shift_working_days_only": "Zmiana 11–19 jest dostępna tylko w dni robocze",
    "overrides.published_schedule_not_found": "Nie znaleziono opublikowanego grafiku",
    "overrides.person_not_found": "Nie znaleziono osoby",
    "overrides.person_not_eligible": "Osoba nie ma eligibility",
    "overrides.person_unavailable": "Osoba jest niedostępna",
    "overrides.person_already_holds_role": "Ta osoba już pełni tę rolę tego dnia",
    "overrides.person_already_on_call": "Osoba ma już drugi on-call tego dnia",
    "overrides.roster_changed_meanwhile": "Grafik zmienił się; odśwież kalendarz",
    "overrides.repeated_slot_in_batch": "Lista zawiera powtórzony slot",
    "overrides.empty_batch": "Korekta wsadowa musi obejmować co najmniej jeden slot",
    "overrides.slot_not_found": "Nie znaleziono slotu grafiku",
    "overrides.historical_correction_needs_reason": (
        "Korekta historyczna wymaga powodu (minimum 10 znaków)"
    ),
    "overrides.batch_correction_needs_reason": (
        "Korekta wsadowa wymaga powodu (minimum 10 znaków)"
    ),
    "overrides.rule_violations_not_acknowledged": (
        "Korekta złamie reguły twarde grafiku; potwierdź świadome naruszenie"
    ),
    "overrides.acknowledge_next_step": (
        "Wybierz inną osobę albo potwierdź świadome naruszenie reguł twardych;"
        " trafi ono do dziennika audytu."
    ),
    # --- reports (oncall.domain.reports) -------------------------------------
    "reports.invalid_month": "Miesiąc musi mieć format RRRR-MM",
    # --- drafts, proposals, publication (oncall.domain.scheduling) -----------
    "scheduling.schedule_not_found": "Nie znaleziono grafiku",
    "scheduling.generation_run_not_found": "Nie znaleziono zadania generatora",
    "scheduling.policy_without_weight": (
        "Co najmniej jedna waga generatora musi być większa od zera"
    ),
    "scheduling.generation_failed": "Nie można utworzyć kompletnego grafiku",
    "scheduling.generation_failed.precheck": "Nie można zbudować kompletnego modelu grafiku",
    "scheduling.generation_failed.infeasible": (
        "Reguły twarde nie pozwalają utworzyć kompletnego grafiku"
    ),
    "scheduling.generation_failed.unknown": (
        "Solver wyczerpał budżet czasu bez kompletnego grafiku"
    ),
    "scheduling.editable_draft_not_found": "Nie znaleziono edytowalnego szkicu",
    "scheduling.draft_changed": "Szkic zmienił się; odśwież generator",
    "scheduling.date_outside_draft": "Data jest poza zakresem szkicu",
    "scheduling.late_shift_working_days_only": "Zmiana 11–19 jest dostępna tylko w dni robocze",
    "scheduling.replacement_not_found": "Nie znaleziono osoby",
    "scheduling.replacement_not_eligible": "Osoba nie ma eligibility",
    "scheduling.replacement_unavailable": "Osoba jest niedostępna",
    "scheduling.draft_slot_not_found": "Nie znaleziono przydziału w szkicu",
    "scheduling.second_on_call_same_day": "Osoba ma już drugi on-call tego dnia",
    "scheduling.variant_not_found": "Nie znaleziono jednego z wariantów",
    "scheduling.variant_ranges_differ": ("Porównywane warianty muszą obejmować ten sam zakres dat"),
    "scheduling.variant_modes_mismatch": "Wybierz jeden wariant dzienny i jeden tygodniowy",
    "scheduling.schedule_not_deletable": (
        "Można usunąć tylko szkic, propozycję albo zaimportowaną historię"
    ),
    "scheduling.draft_state_changed": "Szkic zmienił stan lub wersję; odśwież generator",
    "scheduling.proposal_state_changed": "Propozycja zmieniła stan lub wersję",
    "scheduling.publication_state_changed": (
        "Propozycja zmieniła stan lub wersję; odśwież generator"
    ),
    "scheduling.only_proposal_publishable": "Tylko propozycję można opublikować",
    "scheduling.incomplete_schedule": "Grafik nie ma pełnego pokrycia",
    "scheduling.same_person_on_both_on_call_roles": (
        "Ta sama osoba nie może być primary i secondary jednego dnia"
    ),
    "scheduling.proposal_has_unavailable_people": (
        "Szkic zawiera osoby z twardą niedostępnością. Popraw wskazane "
        "komórki korektą w macierzy szkicu albo wygeneruj grafik ponownie"
    ),
    "scheduling.publication_has_unavailable_people": (
        "Grafik zawiera osoby z twardą niedostępnością; wygeneruj go ponownie"
    ),
    "scheduling.lost_changes_not_acknowledged": (
        "Publikacja zastąpi ręczne zmiany; potwierdź ich utratę"
    ),
    "scheduling.change_resolution_required": (
        "Wybierz rozstrzygnięcie dla każdej kolidującej zmiany"
    ),
    "scheduling.gap_not_acknowledged": "Przed początkiem grafiku pozostają nieobsadzone dni",
    "scheduling.change_resolution_invalid": (
        "Rozstrzygnięcie „zachowaj wcześniejszą zmianę” złamałoby reguły grafiku"
    ),
    "scheduling.rest_violations_not_acknowledged": "Publikacja naruszy reguły odpoczynku",
    "scheduling.unavailability_conflict": "{service_date} · {role}: {name} ma twardą niedostępność",
    "scheduling.run_range_reversed": "Data końcowa nie może poprzedzać początkowej",
    "scheduling.run_range_too_long": "Jedno uruchomienie może obejmować maksymalnie 35 dni",
    # why a protected change cannot be carried into a new publication
    "scheduling.carry.original_unknown": "Nie można ustalić pierwotnego wykonawcy zmiany",
    "scheduling.carry.replacement_not_member": "Zastępca nie jest już członkiem zespołu",
    "scheduling.carry.different_original": (
        "Nowy szkic ma w tym slocie innego pierwotnego wykonawcę"
    ),
    "scheduling.carry.replacement_not_eligible": (
        "Zastępca nie ma eligibility albo jest niedostępny"
    ),
    "scheduling.carry.breaks_rules": "Przeniesienie narusza reguły grafiku",
    "scheduling.carry.second_on_call_same_day": (
        "Ta osoba miałaby już drugi dyżur on-call tego dnia"
    ),
    # --- share links and calendar feeds (oncall.domain.sharing) --------------
    "sharing.link_not_found": "Nie znaleziono linku",
    "sharing.token_unknown": "Link nie istnieje",
    "sharing.link_already_used": "Link został już użyty",
    "sharing.link_expired_or_revoked": "Link wygasł lub został odwołany",
    "sharing.feed_not_found": "Nie znaleziono subskrypcji",
    "sharing.feed_unavailable": "Subskrypcja nie istnieje",
    "sharing.range_reversed": "Data końcowa nie może poprzedzać początkowej",
    "sharing.range_too_long": "Zakres linku może obejmować maksymalnie 366 dni",
    # --- swaps (oncall.domain.swaps) -----------------------------------------
    "swaps.in_the_past": "Nie można zamienić dyżuru, który już się odbył",
    "swaps.slot_not_published": "Nie znaleziono opublikowanego grafiku",
    "swaps.slot_not_yours": "Ten slot nie należy do Ciebie",
    "swaps.replacement_not_eligible": "Zastępca nie ma eligibility",
    "swaps.cannot_swap_with_yourself": "Nie można zamienić się ze sobą",
    "swaps.replacement_has_no_account": "Zastępca nie ma konta",
    "swaps.replacement_unavailable": "Zastępca jest niedostępny",
    "swaps.replacement_already_on_call": "Zastępca ma już drugi on-call tego dnia",
    "swaps.slot_has_active_swap": "Dla tego slotu istnieje aktywna zamiana",
    "swaps.breaks_hard_rules": "Operacja łamie reguły twarde grafiku",
    "swaps.blocked_next_step": "Wybierz inny dzień albo poproś koordynatora o korektę grafiku.",
    "swaps.not_found": "Nie znaleziono zamiany",
    "swaps.only_named_replacement_may_accept": "Tylko wskazany zastępca może zaakceptować",
    "swaps.only_named_replacement_may_reject": "Tylko wskazany zastępca może odrzucić prośbę",
    "swaps.only_coordinator_may_reject_accepted": (
        "Tylko koordynator może odrzucić zaakceptowaną prośbę"
    ),
    "swaps.only_requester_may_cancel": "Tylko autor może wycofać prośbę",
    "swaps.not_awaiting_replacement": "Zamiana nie oczekuje na zastępcę",
    "swaps.not_awaiting_coordinator": "Zamiana nie oczekuje na koordynatora",
    "swaps.no_longer_rejectable": "Tej zamiany nie można już odrzucić",
    "swaps.no_longer_cancellable": "Tej zamiany nie można już wycofać",
    "swaps.decision_reason_required": "Podaj powód decyzji",
    "swaps.parties_gone": "Grafik lub zastępca już nie istnieje",
    "swaps.self_approval_not_allowed": "Własną zamianę zatwierdza inny koordynator",
    "swaps.schedule_changed_since_request": "Grafik zmienił się; utwórz nową zamianę",
    "swaps.slot_changed_owner": "Slot zmienił właściciela; prośba została automatycznie anulowana",
    "swaps.points_hidden_from_viewers": "Punkty są widoczne tylko dla zespołu",
    "swaps.replacement_not_found": "Nie znaleziono zastępcy",
    "swaps.no_publication_for_day": "Brak opublikowanego grafiku na ten dzień",
    "swaps.slot_has_no_published_duty": "Ten slot nie ma opublikowanego przydziału",
    "swaps.slot_holder_not_a_team_member": "Osoba z tego slotu nie jest członkiem zespołu",
    "swaps.only_own_swaps_preview": "Możesz sprawdzić tylko własne zamiany",
    "swaps.no_balance_in_window": "Brak bilansu dla osoby {display_name} w tym oknie",
    # --- hard roster rules (oncall.rules) ------------------------------------
    "rules.max_consecutive": "Więcej niż 3 kolejne dni dyżuru on-call.",
    "rules.three_in_seven": "Więcej niż 3 dyżury on-call w okresie 7 dni.",
    "rules.rest_after_run": "Mniej niż 2 dni przerwy po serii dyżurów on-call.",
    "rules.late_shift_anchor": "Zmiana 11–19 i rola kotwicząca są u różnych osób.",
    "rules.day_off_block": "Blok dni wolnych jest podzielony między osoby.",
    "rules.late_shift_on_day_off": "Zmiana 11–19 przypada na dzień wolny od pracy.",
    "rules.oncall_late_shift_overlap": "Ta sama osoba ma dyżur on-call i zmianę 11–19 tego dnia.",
    "rules.same_day_oncall": "Ta sama osoba ma oba dyżury on-call tego dnia.",
    "rules.double_oncall": "Zastępca ma już drugi dyżur on-call tego dnia.",
    "rules.described": "{member}: {message} Dni: {days}.",
    "rules.more_days": "{shown} i {rest} więcej",
    # --- the calendar's weekday abbreviations, Monday first ------------------
    "weekday.0": "pon",
    "weekday.1": "wt",
    "weekday.2": "śr",
    "weekday.3": "czw",
    "weekday.4": "pt",
    "weekday.5": "sob",
    "weekday.6": "niedz",
    # --- request validation (oncall.bootstrap.http, oncall.presentation) -----
    "validation.missing": "To pole jest wymagane.",
    "validation.string_too_short": "Wartość jest za krótka (minimum {min_length} znaków).",
    "validation.string_too_long": "Wartość jest za długa (maksimum {max_length} znaków).",
    "validation.enum": "Nieprawidłowa wartość. Dozwolone: {expected}.",
    "validation.string_pattern_mismatch": "Wartość ma nieprawidłowy format.",
    "validation.phone": "Numer telefonu musi mieć 9-15 cyfr, z opcjonalnym prefiksem +",
}

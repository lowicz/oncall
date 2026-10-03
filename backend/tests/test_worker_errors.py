from oncall.domain.scheduling.errors import GenerationFailed
from oncall.worker import _generation_failure


def test_generation_error_preserves_reason_and_named_conflicts() -> None:
    exc = GenerationFailed("INFEASIBLE", ("Brak eligible osoby", "Limit kolejnych dyżurów"))

    summary, conflicts = _generation_failure(exc)
    assert "Powód: INFEASIBLE" in summary
    assert conflicts == ["Brak eligible osoby", "Limit kolejnych dyżurów"]


def test_a_generation_failed_without_a_reason_is_just_its_message() -> None:
    summary, conflicts = _generation_failure(GenerationFailed("", ()))

    assert "Powód" not in summary
    assert conflicts == []


def test_an_error_carrying_a_structured_detail_is_read_like_a_generation_failure() -> None:
    """An HTTP-style error (a `detail` dict) keeps its message and reason; a
    conflicts field that is not a list is dropped rather than split into
    characters."""

    class Refused(Exception):
        detail = {"reason": "TIMEOUT", "conflicts": "za mało osób"}

    summary, conflicts = _generation_failure(Refused())

    assert summary == "Generator zakończył się błędem | Powód: TIMEOUT"
    assert conflicts is None


def test_a_plain_error_is_its_text_cut_to_the_column() -> None:
    summary, conflicts = _generation_failure(ValueError("x" * 600))

    assert summary == "x" * 500
    assert conflicts is None

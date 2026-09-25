from oncall.domain.scheduling.errors import GenerationFailed
from oncall.worker import _generation_error, _generation_failure


def test_generation_error_preserves_reason_and_named_conflicts() -> None:
    exc = GenerationFailed("INFEASIBLE", ("Brak eligible osoby", "Limit kolejnych dyżurów"))

    message = _generation_error(exc)

    assert "Powód: INFEASIBLE" in message
    assert "Brak eligible osoby" in message
    assert "Limit kolejnych dyżurów" in message
    assert not message.startswith("{")

    summary, conflicts = _generation_failure(exc)
    assert "Powód: INFEASIBLE" in summary
    assert conflicts == ["Brak eligible osoby", "Limit kolejnych dyżurów"]

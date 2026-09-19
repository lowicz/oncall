from oncall.auth import hash_password, verify_password


def test_password_hash_round_trip() -> None:
    password_hash = hash_password("correct horse battery staple")
    assert verify_password(password_hash, "correct horse battery staple")
    assert not verify_password(password_hash, "wrong password")

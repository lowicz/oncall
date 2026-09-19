import os

from oncall.config import available_cpu_count


def test_cpu_count_uses_cgroup_v2_quota(tmp_path) -> None:
    (tmp_path / "cpu.max").write_text("200000 100000\n")

    assert available_cpu_count(tmp_path) == 2


def test_cpu_count_rounds_partial_cgroup_v2_cpu_up(tmp_path) -> None:
    (tmp_path / "cpu.max").write_text("150000 100000\n")

    assert available_cpu_count(tmp_path) == 2


def test_cpu_count_uses_cgroup_v1_quota(tmp_path) -> None:
    cpu = tmp_path / "cpu"
    cpu.mkdir()
    (cpu / "cpu.cfs_quota_us").write_text("300000\n")
    (cpu / "cpu.cfs_period_us").write_text("100000\n")

    assert available_cpu_count(tmp_path) == 3


def test_cpu_count_uses_affinity_without_a_cgroup_limit(tmp_path, monkeypatch) -> None:
    (tmp_path / "cpu.max").write_text("max 100000\n")
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(6)))

    assert available_cpu_count(tmp_path) == 6


def test_cpu_count_is_limited_to_eight(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(16)))

    assert available_cpu_count(tmp_path) == 8

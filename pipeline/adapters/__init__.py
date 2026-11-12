"""Adapters package initialization and shared provider registry."""

from pathlib import Path
from typing import Iterator

from pipeline.adapters.base import BaseAdapter, FundExtractionResult, RawHolding
from pipeline.adapters.betashares_adapter import BetasharesAdapter
from pipeline.adapters.ishares_adapter import ISharesAdapter
from pipeline.adapters.kernel_adapter import KernelAdapter
from pipeline.adapters.smartshares_direct_adapter import SmartsharesDirectAdapter
from pipeline.adapters.vanguard_adapter import VanguardAdapter

PROVIDER_ADAPTERS: dict[str, type[BaseAdapter]] = {
    "vanguard": VanguardAdapter,
    "ishares": ISharesAdapter,
    "smartshares": SmartsharesDirectAdapter,
    "kernel": KernelAdapter,
    "betashares": BetasharesAdapter,
}


def iter_staged_files(
    staging_dir: Path,
    provider: str,
    extensions: tuple[str, ...] = (".csv", ".xlsx"),
) -> Iterator[Path]:
    """Yields sorted disclosure files staged under a provider folder matching supported extensions."""
    provider_dir = staging_dir / provider
    if not provider_dir.exists():
        return
    allowed = {ext.lower() for ext in extensions}
    for path in sorted(provider_dir.iterdir()):
        if path.is_file() and path.suffix.lower() in allowed:
            yield path


__all__ = [
    "BaseAdapter",
    "RawHolding",
    "FundExtractionResult",
    "VanguardAdapter",
    "ISharesAdapter",
    "SmartsharesDirectAdapter",
    "KernelAdapter",
    "BetasharesAdapter",
    "PROVIDER_ADAPTERS",
    "iter_staged_files",
]

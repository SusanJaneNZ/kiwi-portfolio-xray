"""Adapters package initialization."""

from pipeline.adapters.base import BaseAdapter, FundExtractionResult, RawHolding
from pipeline.adapters.disclose_register_adapter import DiscloseRegisterAdapter, FeederWrapperDisclosure
from pipeline.adapters.ishares_adapter import ISharesAdapter
from pipeline.adapters.kernel_adapter import KernelAdapter
from pipeline.adapters.smartshares_direct_adapter import SmartsharesDirectAdapter
from pipeline.adapters.vanguard_adapter import VanguardAdapter

__all__ = [
    "BaseAdapter",
    "RawHolding",
    "FundExtractionResult",
    "VanguardAdapter",
    "ISharesAdapter",
    "SmartsharesDirectAdapter",
    "KernelAdapter",
    "DiscloseRegisterAdapter",
    "FeederWrapperDisclosure",
]


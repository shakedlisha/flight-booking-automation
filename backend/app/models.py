from __future__ import annotations

from pydantic import BaseModel, Field


class ExtractRequest(BaseModel):
    raw_text: str = Field(..., min_length=1, max_length=120_000)


class Passenger(BaseModel):
    name: str | None = None
    id: str | None = Field(default=None, description="Passenger ID / document id as text")


class ExtractResult(BaseModel):
    route: str | None = None
    flightNumber: str | None = None
    date: str | None = Field(
        default=None,
        description="Date in DD.MM.YYYY when known",
    )
    depArr: str | None = Field(
        default=None,
        description="Departure/arrival time pair e.g. '08:40/11:45' when present",
    )
    pnr: str | None = None
    sPnr: str | None = Field(
        default=None,
        description="Supplier PNR / secondary PNR when distinct from primary PNR",
    )
    flightClass: str | None = None
    passengers: list[Passenger] = Field(default_factory=list)

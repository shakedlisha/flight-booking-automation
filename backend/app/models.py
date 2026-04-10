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
    pnr: str | None = None
    flightClass: str | None = None
    passengers: list[Passenger] = Field(default_factory=list)

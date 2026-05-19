from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException


def parse_oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=422, detail="Invalid ID format")

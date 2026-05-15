import os
import warnings
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

_DEFAULT_SECRET = "dev-secret-change-in-production"
SECRET_KEY = os.getenv("JWT_SECRET", _DEFAULT_SECRET)
ALGORITHM = "HS256"

if SECRET_KEY == _DEFAULT_SECRET:
    warnings.warn(
        "JWT_SECRET is not set — using insecure default. Set the JWT_SECRET environment variable in production.",
        stacklevel=1,
    )
TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def create_exchange_code(user_id: int, name: str) -> str:
    """Short-lived (90s) signed code for the OAuth callback exchange. Stateless — safe with multiple workers."""
    expire = datetime.now(timezone.utc) + timedelta(seconds=90)
    return jwt.encode(
        {"sub": str(user_id), "name": name, "purpose": "oauth_exchange", "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_exchange_code(code: str) -> Optional[dict]:
    """Returns {"user_id": int, "name": str} or None if invalid/expired/wrong purpose."""
    try:
        payload = jwt.decode(code, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") != "oauth_exchange":
            return None
        return {"user_id": int(payload["sub"]), "name": payload.get("name", "User")}
    except (JWTError, KeyError, ValueError):
        return None


def decode_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose"):
            return None
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None

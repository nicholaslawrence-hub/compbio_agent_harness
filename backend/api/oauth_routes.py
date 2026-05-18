import os
from urllib.parse import urlencode, quote

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import create_access_token, create_exchange_code, decode_exchange_code
from db.database import get_db
from db.user_models import User

router = APIRouter(prefix="/auth", tags=["oauth"])

FRONTEND_URL     = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
BACKEND_URL      = os.getenv("BACKEND_URL",  "http://localhost:8000").rstrip("/")

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

GITHUB_CLIENT_ID     = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")


def _google_redirect_uri():
    return f"{BACKEND_URL}/api/v1/auth/google/callback"

def _github_redirect_uri():
    return f"{BACKEND_URL}/api/v1/auth/github/callback"


def _get_or_create_oauth_user(db: Session, provider: str, oauth_id: str, email: str | None, name: str) -> User:
    user = db.query(User).filter(User.oauth_provider == provider, User.oauth_id == oauth_id).first()
    if user:
        return user
    if email:
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.oauth_provider = provider
            user.oauth_id = oauth_id
            db.commit()
            return user
    user = User(
        email=email or f"{provider}_{oauth_id}@oauth.invalid",
        name=name or "User",
        hashed_password="",
        oauth_provider=provider,
        oauth_id=oauth_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _error_redirect(msg: str = "oauth_failed"):
    return RedirectResponse(f"{FRONTEND_URL}/oauth/callback?error={msg}")


def _success_redirect(user: User) -> RedirectResponse:
    first = user.name.split()[0] if user.name else "User"
    code = create_exchange_code(user.id, first)
    return RedirectResponse(f"{FRONTEND_URL}/oauth/callback?code={quote(code)}")


# Token exchange ──────────────────────────────────────────────────────────────

class ExchangePayload(BaseModel):
    code: str


@router.post("/oauth/exchange")
def exchange_oauth_code(payload: ExchangePayload):
    entry = decode_exchange_code(payload.code)
    if not entry:
        raise HTTPException(status_code=400, detail="Invalid or expired exchange code.")
    token = create_access_token(entry["user_id"])
    return {"token": token, "name": entry["name"]}


# Google ──────────────────────────────────────────────────────────────────────

@router.get("/google/login")
def google_login():
    if not GOOGLE_CLIENT_ID:
        return _error_redirect("google_not_configured")
    params = urlencode({
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  _google_redirect_uri(),
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "online",
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@router.get("/google/callback")
def google_callback(code: str = None, error: str = None, db: Session = Depends(get_db)):
    if error or not code:
        return _error_redirect("oauth_cancelled")

    with httpx.Client(timeout=10) as client:
        tok = client.post("https://oauth2.googleapis.com/token", data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  _google_redirect_uri(),
            "grant_type":    "authorization_code",
        })
        if not tok.is_success:
            return _error_redirect()

        access_token = tok.json().get("access_token")
        info_res = client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if not info_res.is_success:
            return _error_redirect()
        info = info_res.json()

    user = _get_or_create_oauth_user(db, "google", info["id"], info.get("email"), info.get("name", "User"))
    return _success_redirect(user)


# GitHub ──────────────────────────────────────────────────────────────────────

@router.get("/github/login")
def github_login():
    if not GITHUB_CLIENT_ID:
        return _error_redirect("github_not_configured")
    params = urlencode({
        "client_id":    GITHUB_CLIENT_ID,
        "redirect_uri": _github_redirect_uri(),
        "scope":        "user:email",
    })
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{params}")


@router.get("/github/callback")
def github_callback(code: str = None, error: str = None, db: Session = Depends(get_db)):
    if error or not code:
        return _error_redirect("oauth_cancelled")

    with httpx.Client(timeout=10) as client:
        tok = client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "code":          code,
                "client_id":     GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "redirect_uri":  _github_redirect_uri(),
            },
            headers={"Accept": "application/json"},
        )
        if not tok.is_success:
            return _error_redirect()

        access_token = tok.json().get("access_token")
        headers = {"Authorization": f"token {access_token}", "Accept": "application/json"}

        user_res = client.get("https://api.github.com/user", headers=headers)
        if not user_res.is_success:
            return _error_redirect()
        info = user_res.json()

        email = info.get("email")
        if not email:
            emails_res = client.get("https://api.github.com/user/emails", headers=headers)
            if emails_res.is_success:
                primary = next(
                    (e for e in emails_res.json() if e.get("primary") and e.get("verified")),
                    None,
                )
                email = primary["email"] if primary else None

    name = info.get("name") or info.get("login") or "GitHub User"
    user = _get_or_create_oauth_user(db, "github", str(info["id"]), email, name)
    return _success_redirect(user)

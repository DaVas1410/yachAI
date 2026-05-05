from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    if body.username == settings.admin_username and body.password == settings.admin_password:
        token = create_access_token(body.username, is_admin=True)
        return TokenResponse(access_token=token)
    raise HTTPException(status_code=401, detail="Credenciales inválidas.")

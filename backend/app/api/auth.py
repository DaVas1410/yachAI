import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    is_admin: bool = False


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(User).where(
            (User.username == body.username) | (User.email == body.email)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="El usuario o correo ya existe.")

    hashed = await asyncio.to_thread(hash_password, body.password)
    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hashed,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    # Admin shortcut — not stored in DB
    if (
        body.username == settings.admin_username
        and body.password == settings.admin_password
    ):
        token = create_access_token(body.username, is_admin=True)
        return TokenResponse(access_token=token, is_admin=True)

    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if not user or not await asyncio.to_thread(verify_password, body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Credenciales inválidas.")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Cuenta desactivada.")

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mongodb_url: str = Field(..., validation_alias="MONGODB_URL")
    database_name: str = Field("atomquest", validation_alias="DATABASE_NAME")
    jwt_secret_key: str = Field(..., validation_alias="JWT_SECRET_KEY")
    jwt_algorithm: str = Field("HS256", validation_alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(480, validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    enable_mock_login: bool = Field(False, validation_alias="ENABLE_MOCK_LOGIN")


settings = Settings()
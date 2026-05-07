import pytest
from app.services.rag import _check_sensitivity, _build_prompt, _SUPPORT_MESSAGE


# ── _check_sensitivity ──────────────────────────────────────────────────────

def test_sensitivity_gender_violence_detected():
    result = _check_sensitivity("mi pareja me golpea y no sé qué hacer")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_harassment_detected():
    result = _check_sensitivity("hay mucho acoso sexual en mi facultad")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_mental_health_detected():
    result = _check_sensitivity("ya no quiero vivir, no puedo más")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_discrimination_detected():
    result = _check_sensitivity("me discriminan por ser indígena")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_case_insensitive():
    result = _check_sensitivity("VIOLENCIA DE GÉNERO en el campus")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_clean_query_returns_none():
    result = _check_sensitivity("¿cuáles son los requisitos de graduación?")
    assert result is None

def test_sensitivity_institutional_query_returns_none():
    result = _check_sensitivity("¿cómo solicitar una beca estudiantil?")
    assert result is None

def test_sensitivity_no_false_positive_substring():
    # "fracaso" contains "aso" but not the keyword "acoso" as a word
    result = _check_sensitivity("el fracaso académico me preocupa")
    assert result is None

def test_sensitivity_word_boundary_matches_whole_word():
    # "acoso escolar" should still match (acoso is a complete word here)
    result = _check_sensitivity("hay acoso escolar en mi clase")
    assert result == _SUPPORT_MESSAGE


# ── _build_prompt ────────────────────────────────────────────────────────────

def test_build_prompt_system_forbids_invention():
    messages = _build_prompt("¿cuál es el artículo 3?", ["Artículo 3: texto de ejemplo."])
    system_content = messages[0]["content"]
    assert "No encontré información" in system_content
    assert "inventes" in system_content or "Nunca inventes" in system_content

def test_build_prompt_context_appears_in_user_message():
    messages = _build_prompt("pregunta", ["chunk de prueba"])
    user_content = messages[1]["content"]
    assert "chunk de prueba" in user_content
    assert "pregunta" in user_content

def test_build_prompt_returns_two_messages():
    messages = _build_prompt("test", ["ctx"])
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"


# ── embedding ────────────────────────────────────────────────────────────────

from unittest.mock import MagicMock, patch
import numpy as np


@pytest.mark.asyncio
async def test_get_embedding_returns_768_dims():
    mock_model = MagicMock()
    mock_model.encode.return_value = np.random.rand(1, 768).astype(np.float32)
    with patch("app.services.ingestion._get_embed_model", return_value=mock_model):
        from app.services.ingestion import get_embedding
        result = await get_embedding("reglamento de evaluaciones")
    assert len(result) == 768
    assert all(isinstance(x, float) for x in result)

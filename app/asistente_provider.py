# ----------------------------------------------------------------------
# asistente_provider.py — Wrapper agnóstico sobre LiteLLM.
# ----------------------------------------------------------------------
# LiteLLM expone una API unificada para llamar a cualquier proveedor
# (OpenAI, Anthropic, OpenRouter, Gemini, etc.) con el mismo formato
# OpenAI-compatible. Esto nos deja cambiar de modelo o proveedor en una
# línea cuando lo decidamos.
#
# Variables de entorno que respetamos:
#   - OPENROUTER_API_KEY  → para modelos via OpenRouter
#   - OPENAI_API_KEY      → para OpenAI directo
#   - ANTHROPIC_API_KEY   → para Claude directo
#   - LITELLM_MODEL       → override del modelo (gana sobre AsistenteConfig)
#
# Uso:
#   from .asistente_provider import chat
#   resp = chat(messages=[...], tools=[...], model=None)
#   # resp = {"text": "...", "tool_calls": [...], "raw": <obj>, "usage": {...}}
# ----------------------------------------------------------------------

import json
import logging
import os
from typing import Any

log = logging.getLogger(__name__)


class AsistenteError(RuntimeError):
    """Error genérico del asistente — el view lo convierte a 5xx."""
    pass


def _resolve_model(model: str | None) -> str:
    """Modelo override de env > argumento > default."""
    return (
        os.environ.get('LITELLM_MODEL')
        or model
        or 'openrouter/openai/gpt-4o-mini'
    )


def chat(messages: list[dict], tools: list[dict] | None = None,
         model: str | None = None, temperature: float = 0.3,
         max_tokens: int = 1024) -> dict[str, Any]:
    """Llamada al LLM. Devuelve estructura normalizada agnóstica al proveedor.

    Args:
        messages: lista de {role, content} (formato OpenAI). Cuando hay tool_use
            también pueden traer tool_calls / tool_call_id.
        tools: lista de schemas OpenAI-compatible (function calling). None
            si no queremos tools.
        model: identificador litellm (ej. "openrouter/openai/gpt-4o-mini").
            Si es None usa LITELLM_MODEL del env o el default.
        temperature: 0.0-1.0. 0.3 da respuestas más deterministas (recomendado
            para queries de datos).
        max_tokens: tope de tokens generados.

    Returns:
        {
          "text": str | None,
          "tool_calls": [{id, name, arguments_str, arguments}, ...] | None,
          "finish_reason": str,
          "usage": {"input_tokens": int, "output_tokens": int} | {},
          "raw": <objeto LiteLLM>,
        }
    """
    try:
        # Import diferido — litellm carga muchos providers y tarda ~500ms al
        # importar la primera vez. No queremos que Django startup lo cargue
        # si nadie usa el asistente.
        import litellm
        from litellm import completion
    except ImportError as e:
        raise AsistenteError(
            f"LiteLLM no está instalado. Corre `pip install litellm`. ({e})"
        ) from e

    resolved = _resolve_model(model)

    # Silenciar el logging muy verboso de litellm en producción.
    litellm.suppress_debug_info = True

    kwargs: dict[str, Any] = {
        'model': resolved,
        'messages': messages,
        'temperature': temperature,
        'max_tokens': max_tokens,
    }
    if tools:
        kwargs['tools'] = tools
        kwargs['tool_choice'] = 'auto'

    try:
        resp = completion(**kwargs)
    except Exception as e:
        log.exception('LiteLLM completion error (model=%s): %s', resolved, e)
        raise AsistenteError(f'Error llamando al modelo: {e}') from e

    # Normalizar la respuesta — LiteLLM ya entrega formato OpenAI-compatible.
    choice = resp.choices[0]
    msg = choice.message
    text = (msg.content or '').strip() if hasattr(msg, 'content') else ''

    tool_calls_norm = []
    raw_tool_calls = getattr(msg, 'tool_calls', None) or []
    for tc in raw_tool_calls:
        fn = getattr(tc, 'function', None)
        args_str = (getattr(fn, 'arguments', '') or '') if fn else ''
        try:
            args = json.loads(args_str) if args_str else {}
        except json.JSONDecodeError:
            args = {}
        tool_calls_norm.append({
            'id': getattr(tc, 'id', '') or '',
            'name': (getattr(fn, 'name', '') or '') if fn else '',
            'arguments_str': args_str,
            'arguments': args,
        })

    usage = {}
    if getattr(resp, 'usage', None):
        usage = {
            'input_tokens': getattr(resp.usage, 'prompt_tokens', 0) or 0,
            'output_tokens': getattr(resp.usage, 'completion_tokens', 0) or 0,
        }

    return {
        'text': text or None,
        'tool_calls': tool_calls_norm or None,
        'finish_reason': getattr(choice, 'finish_reason', '') or '',
        'usage': usage,
        'raw': resp,
        'model_used': resolved,
    }

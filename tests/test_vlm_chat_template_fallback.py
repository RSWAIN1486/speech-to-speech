from __future__ import annotations

from speech_to_speech.LLM.language_model import VisionLanguageModelHandler


class _FakeTokenizer:
    def __init__(self, prompt: str = "TOKENIZER_PROMPT") -> None:
        self.chat_template = "fake-tokenizer-template"
        self.prompt = prompt
        self.messages = None

    def apply_chat_template(self, messages, **kwargs):
        self.messages = (messages, kwargs)
        return self.prompt

    def encode(self, text: str, /, **kwargs):
        return [1, 2, 3]


class _FakeProcessor:
    def __init__(self, tokenizer: _FakeTokenizer, *, chat_template="fake-processor-template", prompt="PROCESSOR_PROMPT"):
        self.tokenizer = tokenizer
        self.chat_template = chat_template
        self.prompt = prompt
        self.messages = None

    def apply_chat_template(self, messages, **kwargs):
        if self.chat_template is None:
            raise ValueError("Cannot use apply_chat_template because this processor does not have a chat template.")
        self.messages = (messages, kwargs)
        return self.prompt


def _make_handler(processor: _FakeProcessor) -> VisionLanguageModelHandler:
    handler = object.__new__(VisionLanguageModelHandler)
    handler.processor = processor
    handler.tokenizer = processor.tokenizer
    return handler


def test_apply_vlm_chat_template_uses_processor_when_available():
    tokenizer = _FakeTokenizer()
    processor = _FakeProcessor(tokenizer)
    handler = _make_handler(processor)

    prompt = handler._apply_vlm_chat_template([{"role": "user", "content": "Hello"}])

    assert prompt == "PROCESSOR_PROMPT"
    assert processor.messages == (
        [{"role": "user", "content": "Hello"}],
        {"tokenize": False, "add_generation_prompt": True},
    )
    assert tokenizer.messages is None


def test_apply_vlm_chat_template_falls_back_to_tokenizer_when_processor_template_is_missing():
    tokenizer = _FakeTokenizer()
    processor = _FakeProcessor(tokenizer, chat_template=None)
    handler = _make_handler(processor)

    prompt = handler._apply_vlm_chat_template([{"role": "user", "content": [{"type": "text", "text": "Hello"}]}])

    assert prompt == "TOKENIZER_PROMPT"
    assert tokenizer.messages == (
        [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}],
        {"tokenize": False, "add_generation_prompt": True},
    )


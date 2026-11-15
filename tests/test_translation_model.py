import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import translator


class TranslationModelTests(unittest.TestCase):
    def test_selected_model_falls_back_to_default_after_daily_quota(self):
        with patch.object(translator, "OAUTH_CREDENTIALS", True), \
             patch.object(translator, "DISABLED_MODELS", set()), \
             patch.object(translator, "_is_quota_error", return_value=True), \
             patch.object(translator, "_is_daily_quota_error", return_value=True), \
             patch.object(translator, "_is_model_unavailable_error", return_value=False), \
             patch.object(translator, "_oauth_generate_content", side_effect=[
                 RuntimeError("quota"), '[{"id":1,"text":"Xin chào"}]',
             ]) as generate:
            result = translator.translate_batch(
                [{"id": 1, "text": "你好"}], translation_model="gemini-3.8-flash",
            )
        self.assertEqual(result[0]["text"], "Xin chào")
        self.assertEqual([call.args[0] for call in generate.call_args_list], [
            "gemini-3.8-flash", "gemini-3.1-flash-lite",
        ])


if __name__ == "__main__":
    unittest.main()

"""The assistant can suggest settings, but only supported values may reach the UI."""

import base64
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import assistant_service


class AssistantServiceTests(unittest.TestCase):
    def test_settings_reject_unsupported_fields_and_out_of_range_values(self):
        settings = assistant_service._safe_settings({
            "aspect_ratio": "shorts",
            "tts_speed": 8,
            "original_volume": 0.2,
            "voice": "untrusted voice",
            "logo_path": "D:/somewhere/secret.txt",
        }, "voiceover")
        self.assertEqual(settings, {"aspect_ratio": "shorts", "original_volume": 0.2})

    def test_image_input_accepts_only_small_supported_data_urls(self):
        valid = "data:image/png;base64," + base64.b64encode(b"image").decode("ascii")
        self.assertEqual(assistant_service._image_part(valid)["inlineData"]["mimeType"], "image/png")
        with self.assertRaises(ValueError):
            assistant_service._image_part("data:image/svg+xml;base64,PHN2Zz4=")

    @patch.object(assistant_service, "get_credentials", return_value=SimpleNamespace(token="test-token"))
    @patch.object(assistant_service, "get_project_id", return_value="my-project")
    @patch.object(assistant_service, "authorized_request")
    def test_question_never_returns_model_supplied_actions(self, post, _project, _credentials):
        post.return_value = SimpleNamespace(
            ok=True, status_code=200,
            json=lambda: {"candidates": [{"content": {"parts": [{"text": json.dumps({
                "answer": "Hãy kiểm tra nguồn video.",
                "settings": {"aspect_ratio": "shorts"},
            })}]}}]},
        )
        result = assistant_service.ask_assistant(message="Lỗi tải video là gì?")
        self.assertEqual(result, {"answer": "Hãy kiểm tra nguồn video.", "settings": {}})
        self.assertEqual(post.call_args.kwargs["project_id"], "my-project")

    @patch.object(assistant_service, "get_credentials", return_value=SimpleNamespace(token="test-token"))
    @patch.object(assistant_service, "get_project_id", return_value="my-project")
    @patch.object(assistant_service, "authorized_request")
    def test_config_suggestion_is_bounded_before_it_reaches_browser(self, post, _project, _credentials):
        post.return_value = SimpleNamespace(
            ok=True, status_code=200,
            json=lambda: {"candidates": [{"content": {"parts": [{"text": json.dumps({
                "answer": "Nên giữ bố cục dọc.",
                "settings": {"aspect_ratio": "shorts", "original_volume": 0.1,
                             "tts_speed": 99, "logo_path": "C:/private.png"},
            })}]}}]},
        )
        result = assistant_service.ask_assistant(message="Làm video dọc", kind="config", mode="voiceover")
        self.assertEqual(result["settings"], {"aspect_ratio": "shorts", "original_volume": 0.1})

    @patch.object(assistant_service, "get_credentials", return_value=SimpleNamespace(token="test-token"))
    @patch.object(assistant_service, "get_project_id", return_value="my-project")
    @patch.object(assistant_service, "authorized_request")
    def test_retired_model_falls_back_without_reconnecting_google(self, post, _project, _credentials):
        post.side_effect = [
            SimpleNamespace(ok=False, status_code=404),
            SimpleNamespace(ok=True, status_code=200,
                            json=lambda: {"candidates": [{"content": {"parts": [{"text": json.dumps({
                                "answer": "Xin chào!", "settings": {},
                            })}]}}]}),
        ]
        result = assistant_service.ask_assistant(message="hi")
        self.assertEqual(result["answer"], "Xin chào!")
        self.assertIn("gemini-3.5-flash-lite", post.call_args_list[0].args[1])
        self.assertIn("gemini-3.6-flash", post.call_args_list[1].args[1])

    @patch.object(assistant_service, "get_credentials", return_value=SimpleNamespace(token="test-token"))
    @patch.object(assistant_service, "get_project_id", return_value="my-project")
    @patch.object(assistant_service, "authorized_request")
    def test_auth_failure_does_not_try_other_models(self, post, _project, _credentials):
        post.return_value = SimpleNamespace(ok=False, status_code=401)
        with self.assertRaisesRegex(RuntimeError, "kết nối lại Google"):
            assistant_service.ask_assistant(message="hi")
        self.assertEqual(post.call_count, 1)


if __name__ == "__main__":
    unittest.main()
